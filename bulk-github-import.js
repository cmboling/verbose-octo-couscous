#!/usr/bin/env node

/**
 * FOSSA Bulk GitHub Import Script
 * 
 * This script automates bulk importing of GitHub repositories into FOSSA
 * using the same Quick Import API that the web interface uses.
 * 
 * Usage:
 *   node bulk-github-import.js --org <org-name> --token <github-token> --session <fossa-session> --filter-value <id> [options]
 * 
 * Options:
 *   --dry-run              Show what would be imported without actually importing
 *   --exclude-forks        Skip forked repositories
 *   --exclude-private      Skip private repositories
 *   --filter-value <id>    GitHub App installation ID (required)
 *   --instance-name <name> GitHub App instance name (optional)
 *   --csrf-token <token>   CSRF token from browser (may be required)
 *   --batch-size <size>    Number of repos to import per batch (default: 50)
 *   --help                 Show help message
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class FossaBulkImporter {
  constructor(options) {
    this.options = {
      dryRun: false,
      excludeForks: false,
      excludePrivate: false,
      batchSize: 50,
      instanceName: '',
      csrfToken: null,
      ...options
    };
    
    this.validateOptions();
    this.stats = {
      totalGitHubRepos: 0,
      filteredRepos: 0,
      existingProjects: 0,
      newImports: 0,
      skipped: 0,
      errors: 0
    };
  }

  validateOptions() {
    const required = ['org', 'githubToken', 'fossaSession', 'filterValue'];
    for (const field of required) {
      if (!this.options[field]) {
        throw new Error(`Missing required option: ${field}`);
      }
    }
  }

  async makeRequest(hostname, path, options = {}) {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname,
        path,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'FOSSA-Bulk-Importer/1.0',
          'Accept': 'application/json',
          ...options.headers
        }
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, data: parsed, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, data: data, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      
      req.end();
    });
  }

  async makeGitHubRequest(path, page = 1, perPage = 100) {
    const url = `${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`;
    return await this.makeRequest('api.github.com', url, {
      headers: {
        'Authorization': `token ${this.options.githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
  }

  async makeFossaRequest(path, options = {}) {
    const headers = {
      'Cookie': `fossa.sid=${this.options.fossaSession}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': 'https://app.fossa.com',
      'Referer': 'https://app.fossa.com/projects/import/github-app',
      ...options.headers
    };
    
    // Add CSRF token if provided
    if (this.options.csrfToken) {
      headers['csrf-token'] = this.options.csrfToken;
    }
    
    return await this.makeRequest('app.fossa.com', path, {
      ...options,
      headers
    });
  }

  async getAllGitHubRepos() {
    console.log(`\n📥 Fetching repositories from GitHub organization: ${this.options.org}`);
    
    const allRepos = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      console.log(`  Fetching page ${page}...`);
      
      const response = await this.makeGitHubRequest(`/orgs/${this.options.org}/repos`, page);
      
      if (response.status !== 200) {
        throw new Error(`GitHub API error: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      const repos = response.data;
      allRepos.push(...repos);

      // Check if we have more pages
      hasMore = repos.length === 100; // GitHub returns 100 per page max
      page++;
    }

    this.stats.totalGitHubRepos = allRepos.length;
    console.log(`  ✅ Found ${allRepos.length} repositories`);
    
    return allRepos;
  }

  async getAllFossaProjects() {
    console.log(`\n📋 Fetching existing FOSSA projects...`);
    
    const response = await this.makeFossaRequest('/api/projects?count=10000');
    
    if (response.status !== 200) {
      throw new Error(`FOSSA API error: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    const projects = response.data;
    console.log(`  ✅ Found ${projects.length} existing FOSSA projects`);
    
    // Create lookup maps for efficient duplicate detection
    const projectsByLocator = new Map();
    const projectsByUrl = new Map();
    
    for (const project of projects) {
      if (project.locator) {
        projectsByLocator.set(project.locator, project);
      }
      
      // Try to extract GitHub URL from various fields
      const urls = [
        project.url,
        project.git_url,
        project.repository_url
      ].filter(Boolean);
      
      for (const url of urls) {
        if (url && url.includes('github.com')) {
          projectsByUrl.set(this.normalizeGitHubUrl(url), project);
        }
      }
    }
    
    return { projects, projectsByLocator, projectsByUrl };
  }

  normalizeGitHubUrl(url) {
    // Normalize GitHub URLs for comparison
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^git@github\.com:/, 'github.com/')
      .replace(/\.git$/, '')
      .toLowerCase();
  }

  async getBranches(owner, repo) {
    const response = await this.makeGitHubRequest(`/repos/${owner}/${repo}/branches`);
    
    if (response.status !== 200) {
      console.warn(`    ⚠️  Could not fetch branches for ${owner}/${repo}: ${response.status}`);
      return ['main']; // Default fallback
    }
    
    return response.data.map(branch => branch.name);
  }

  async transformRepoForFossa(repo) {
    // Get branches for this repository
    const branches = await this.getBranches(repo.owner.login, repo.name);
    const defaultBranch = repo.default_branch || 'main';
    
    return {
      id: repo.id,
      title: repo.name,
      locator: `git+github.com/${repo.owner.login}/${repo.name}`,
      url: repo.html_url,
      description: repo.description || '',
      isFork: repo.fork,
      isPrivate: repo.private,
      updated_at: repo.updated_at,
      branch: defaultBranch,
      branches: branches,
      sshCloneURL: repo.ssh_url,
      httpsCloneURL: repo.clone_url,
      connectableProjects: [],
      connectedProjects: []
    };
  }

  filterRepositories(repos) {
    console.log(`\n🔍 Filtering repositories...`);
    
    let filtered = repos;
    
    if (this.options.excludeForks) {
      const beforeCount = filtered.length;
      filtered = filtered.filter(repo => !repo.fork);
      console.log(`  📌 Excluded ${beforeCount - filtered.length} forks`);
    }
    
    if (this.options.excludePrivate) {
      const beforeCount = filtered.length;
      filtered = filtered.filter(repo => !repo.private);
      console.log(`  📌 Excluded ${beforeCount - filtered.length} private repositories`);
    }
    
    this.stats.filteredRepos = filtered.length;
    console.log(`  ✅ ${filtered.length} repositories after filtering`);
    
    return filtered;
  }

  findDuplicates(transformedRepos, fossaProjects) {
    console.log(`\n🔍 Checking for existing projects...`);
    
    const { projectsByLocator, projectsByUrl } = fossaProjects;
    const newRepos = [];
    const existingRepos = [];
    
    for (const repo of transformedRepos) {
      const locator = repo.locator;
      const normalizedUrl = this.normalizeGitHubUrl(repo.url);
      
      const existingByLocator = projectsByLocator.get(locator);
      const existingByUrl = projectsByUrl.get(normalizedUrl);
      
      if (existingByLocator || existingByUrl) {
        existingRepos.push({
          repo,
          existing: existingByLocator || existingByUrl,
          matchType: existingByLocator ? 'locator' : 'url'
        });
      } else {
        newRepos.push(repo);
      }
    }
    
    this.stats.existingProjects = existingRepos.length;
    this.stats.newImports = newRepos.length;
    
    console.log(`  ✅ Found ${existingRepos.length} existing projects`);
    console.log(`  ✅ Found ${newRepos.length} new repositories to import`);
    
    if (existingRepos.length > 0) {
      console.log(`\n📋 Already imported repositories:`);
      existingRepos.slice(0, 10).forEach(({ repo, existing, matchType }) => {
        console.log(`    ${repo.title} (matched by ${matchType})`);
      });
      if (existingRepos.length > 10) {
        console.log(`    ... and ${existingRepos.length - 10} more`);
      }
    }
    
    return { newRepos, existingRepos };
  }

  async importBatch(repos) {
    const payload = {
      repos: repos,
      options: {
        selectedTeams: [],
        send_badge_pr: true,
        policy_update: 'organization',
        policy_access: 'default',
        update_hook: null,
        vcs_host: 'github-app',
        type: 'autobuild',
        skip_notifications: false,
        policy_notifications: 'true'
      },
      instanceName: this.options.instanceName,
      filterValue: this.options.filterValue
    };

    console.log(`\n🚀 Importing batch of ${repos.length} repositories...`);
    
    if (this.options.dryRun) {
      console.log(`  🔍 DRY RUN: Would import:`);
      repos.forEach(repo => {
        console.log(`    - ${repo.title} (${repo.locator})`);
      });
      return { success: true, imported: repos.length };
    }

    const response = await this.makeFossaRequest('/api/services/github-app/import', {
      method: 'POST',
      body: payload
    });

    if (response.status !== 200) {
      console.error(`  ❌ Import failed: ${response.status}`);
      console.error(`  Response: ${JSON.stringify(response.data, null, 2)}`);
      return { success: false, error: response.data };
    }

    console.log(`  ✅ Import successful: ${JSON.stringify(response.data)}`);
    return { success: true, ...response.data };
  }

  async run() {
    console.log(`\n🔧 FOSSA Bulk GitHub Import${this.options.dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`   Organization: ${this.options.org}`);
    console.log(`   Filter Value: ${this.options.filterValue}`);
    console.log(`   Exclude Forks: ${this.options.excludeForks}`);
    console.log(`   Exclude Private: ${this.options.excludePrivate}`);
    console.log(`   Batch Size: ${this.options.batchSize}`);

    try {
      // Step 1: Get all GitHub repositories
      const allGitHubRepos = await this.getAllGitHubRepos();
      
      // Step 2: Filter repositories
      const filteredRepos = this.filterRepositories(allGitHubRepos);
      
      // Step 3: Get existing FOSSA projects
      const fossaProjects = await this.getAllFossaProjects();
      
      // Step 4: Transform repositories for FOSSA format
      console.log(`\n🔄 Transforming repositories for FOSSA format...`);
      const transformedRepos = [];
      
      for (const repo of filteredRepos) {
        try {
          const transformed = await this.transformRepoForFossa(repo);
          transformedRepos.push(transformed);
        } catch (error) {
          console.warn(`  ⚠️  Failed to transform ${repo.name}: ${error.message}`);
          this.stats.errors++;
        }
      }
      
      // Step 5: Find duplicates
      const { newRepos, existingRepos } = this.findDuplicates(transformedRepos, fossaProjects);
      
      if (newRepos.length === 0) {
        console.log(`\n✅ No new repositories to import!`);
        this.printStats();
        return;
      }
      
      // Step 6: Import in batches
      console.log(`\n📦 Importing ${newRepos.length} repositories in batches of ${this.options.batchSize}...`);
      
      for (let i = 0; i < newRepos.length; i += this.options.batchSize) {
        const batch = newRepos.slice(i, i + this.options.batchSize);
        const batchNum = Math.floor(i / this.options.batchSize) + 1;
        const totalBatches = Math.ceil(newRepos.length / this.options.batchSize);
        
        console.log(`\n📦 Batch ${batchNum}/${totalBatches}`);
        
        try {
          const result = await this.importBatch(batch);
          
          if (result.success) {
            this.stats.newImports += result.imported || batch.length;
          } else {
            this.stats.errors += batch.length;
            console.error(`  ❌ Batch ${batchNum} failed`);
          }
        } catch (error) {
          console.error(`  ❌ Batch ${batchNum} error: ${error.message}`);
          this.stats.errors += batch.length;
        }
        
        // Add delay between batches to avoid rate limiting
        if (i + this.options.batchSize < newRepos.length) {
          console.log(`  ⏱️  Waiting 2 seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      this.printStats();
      
    } catch (error) {
      console.error(`\n❌ Fatal error: ${error.message}`);
      process.exit(1);
    }
  }

  printStats() {
    console.log(`\n📊 Final Statistics:`);
    console.log(`   Total GitHub repositories: ${this.stats.totalGitHubRepos}`);
    console.log(`   After filtering: ${this.stats.filteredRepos}`);
    console.log(`   Already in FOSSA: ${this.stats.existingProjects}`);
    console.log(`   New imports: ${this.stats.newImports}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`\n${this.options.dryRun ? '🔍 DRY RUN COMPLETE' : '✅ IMPORT COMPLETE'}`);
  }
}

// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
        console.log(`
FOSSA Bulk GitHub Import Script

Usage: node bulk-github-import.js [options]

Required Options:
  --org <name>           GitHub organization name
  --token <token>        GitHub personal access token
  --session <session>    FOSSA session cookie value
  --filter-value <id>    GitHub App installation ID

Optional Options:
  --dry-run             Show what would be imported without actually importing
  --exclude-forks       Skip forked repositories
  --exclude-private     Skip private repositories
  --instance-name <name> GitHub App instance name
  --csrf-token <token>  CSRF token from browser (may be required)
  --batch-size <size>   Number of repos to import per batch (default: 50)
  --help                Show this help message

Examples:
  # Dry run to see what would be imported
  node bulk-github-import.js --org myorg --token ghp_xxx --session xxx --filter-value 12345 --dry-run

  # Import all repositories excluding forks
  node bulk-github-import.js --org myorg --token ghp_xxx --session xxx --filter-value 12345 --exclude-forks

  # Import only public repositories in smaller batches
  node bulk-github-import.js --org myorg --token ghp_xxx --session xxx --filter-value 12345 --exclude-private --batch-size 25
        `);
        process.exit(0);
        break;
      
      case '--org':
        options.org = args[++i];
        break;
      
      case '--token':
        options.githubToken = args[++i];
        break;
      
      case '--session':
        options.fossaSession = args[++i];
        break;
      
      case '--filter-value':
        options.filterValue = args[++i];
        break;
      
      case '--instance-name':
        options.instanceName = args[++i];
        break;
      
      case '--csrf-token':
        options.csrfToken = args[++i];
        break;
      
      case '--batch-size':
        options.batchSize = parseInt(args[++i]);
        break;
      
      case '--dry-run':
        options.dryRun = true;
        break;
      
      case '--exclude-forks':
        options.excludeForks = true;
        break;
      
      case '--exclude-private':
        options.excludePrivate = true;
        break;
      
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }
  
  return options;
}

// Main execution
if (require.main === module) {
  const options = parseArgs();
  const importer = new FossaBulkImporter(options);
  importer.run();
}

module.exports = FossaBulkImporter;