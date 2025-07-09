# FOSSA Bulk GitHub Import Tool

This tool allows you to bulk import GitHub repositories into FOSSA using the same Quick Import API that the web interface uses. It includes duplicate detection, filtering options, and dry-run capability.

## Features

- ✅ **Bulk Import**: Import all repositories from a GitHub organization
- ✅ **Duplicate Detection**: Automatically skips repositories already imported into FOSSA
- ✅ **Filtering**: Exclude forks and/or private repositories
- ✅ **Dry Run**: Preview what would be imported without actually importing
- ✅ **Batch Processing**: Process repositories in configurable batches
- ✅ **Progress Tracking**: Detailed progress reporting and statistics
- ✅ **Error Handling**: Robust error handling with retry logic

## Prerequisites

1. **GitHub Personal Access Token** with `repo` and `read:org` permissions
2. **FOSSA Session Cookie** from your browser (logged into FOSSA)
3. **GitHub App Installation ID** (filterValue) from the Quick Import page
4. **Node.js** installed on your system

## Quick Start

### 1. Extract Session Information from Browser

#### Get FOSSA Session Cookie:
1. **Open FOSSA in your browser** and navigate to the Quick Import page: `Projects → Import → GitHub App`
2. **Open Developer Tools** (F12) → Go to **Application** tab
3. **Expand Cookies** → Click on `https://app.fossa.com`
4. **Find `fossa.sid`** cookie and copy its **Value** (e.g., `s%3LolHAHAoblOGrEaTgbGKgvdL5-gEet2034OuWVB.Rx755JI%2FiKRGEDgdfdILiesbGeblgtBr3w`)

#### Get GitHub App Installation ID (filterValue):
1. **Still on the Quick Import page**, look at the URL
2. **Find the `filterValue` parameter** in the URL (e.g., `filterValue=12345678`)
3. **Copy the numeric ID** (e.g., `74088488`)

#### Get CSRF Token (if needed):
1. **On the Quick Import page**, open **Developer Tools** (F12) → Go to **Network** tab
2. **Try to import a repository** (or just browse the list)
3. **Look for requests** to `/api/services/github-app/import` or `/api/services/github-app/repositories`
4. **Click on the request** → Go to **Request Headers**
5. **Find `csrf-token`** header and copy its value (e.g., `7SLZQa8u-GrEaTNumBER_0AFIxX2025a0abk`)

### 2. Run a Dry Run

Always start with a dry run to see what would be imported:

```bash
node bulk-github-import.js \
  --org YOUR_ORG_NAME \
  --token YOUR_GITHUB_TOKEN \
  --session "YOUR_SESSION_COOKIE" \
  --filter-value "YOUR_FILTER_VALUE" \
  --csrf-token "YOUR_CSRF_TOKEN" \
  --dry-run
```

### 3. Run the Import

If the dry run looks good, remove `--dry-run` to perform the actual import:

```bash
node bulk-github-import.js \
  --org YOUR_ORG_NAME \
  --token YOUR_GITHUB_TOKEN \
  --session "YOUR_SESSION_COOKIE" \
  --filter-value "YOUR_FILTER_VALUE" \
  --csrf-token "YOUR_CSRF_TOKEN" \
  --exclude-forks \
  --exclude-private
```

## Command Line Options

### Required Options

- `--org <name>`: GitHub organization name
- `--token <token>`: GitHub personal access token
- `--session <session>`: FOSSA session cookie value (from browser)
- `--filter-value <id>`: GitHub App installation ID

### Optional Options

- `--dry-run`: Show what would be imported without actually importing
- `--exclude-forks`: Skip forked repositories
- `--exclude-private`: Skip private repositories
- `--csrf-token <token>`: CSRF token from browser (may be required for imports)
- `--instance-name <name>`: GitHub App instance name (usually empty)
- `--batch-size <size>`: Number of repos to import per batch (default: 50)
- `--help`: Show help message

## Examples

### Preview all repositories (dry run)
```bash
node bulk-github-import.js \
  --org mycompany \
  --token ghp_xxxxxxxxxxxx \
  --session "s%3ACR4W1InGtOUP362" \
  --filter-value "12345678" \
  --csrf-token "R0tT-Ingbo0TY980" \
  --dry-run
```

### Import only public, non-fork repositories
```bash
node bulk-github-import.js \
  --org mycompany \
  --token ghp_xxxxxxxxxxxx \
  --session "s%3AD15oBloopBloop..." \
  --filter-value "12345678" \
  --csrf-token "gHoU-1IsHB4RF" \
  --exclude-forks \
  --exclude-private
```

### Import with smaller batch size (for large organizations)
```bash
node bulk-github-import.js \
  --org mycompany \
  --token ghp_xxxxxxxxxxxx \
  --session "s%3ACr4WLinGPUKE682" \
  --filter-value "12345678" \
  --csrf-token "chunk-YtHR04t486" \
  --batch-size 25
```

## How It Works

1. **Fetch GitHub Repositories**: Uses GitHub API to list all repositories in the organization
2. **Apply Filters**: Excludes forks and/or private repositories if requested
3. **Fetch Existing FOSSA Projects**: Gets all existing projects from FOSSA
4. **Duplicate Detection**: Compares GitHub repositories against existing FOSSA projects by:
   - Locator (e.g., `git+github.com/org/repo`)
   - Normalized GitHub URL
5. **Transform Format**: Converts GitHub repository format to FOSSA import format
6. **Batch Import**: Sends repositories to FOSSA Quick Import API in batches

## Getting the Required Values

### GitHub Personal Access Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` and `read:org` scopes
3. Copy the token (starts with `ghp_`)

### FOSSA Session Cookie
1. **Open FOSSA in your browser** and navigate to the Quick Import page: `Projects → Import → GitHub App`
2. **Open Developer Tools** (F12) → Go to **Application** tab
3. **Expand Cookies** → Click on `https://app.fossa.com`
4. **Find `fossa.sid`** cookie and copy its **Value**
5. **Use the full URL-encoded value** (e.g., `s%3AD15oblqwegfgfbGKgvdL5-gEetI4OuWVB.Rx123JI%2FiKl2UcrnILizB0PBqwert9SbGeblgtBr3w`)

### GitHub App Installation ID (filterValue)
1. **On the Quick Import page**, look at the URL (or in GitHub settings)
2. **Find the `filterValue` parameter** in the URL (e.g., `filterValue=12345678`)
3. **Copy the numeric ID** (e.g., `74088488`)

### CSRF Token (if needed)
1. **On the Quick Import page**, open **Developer Tools** (F12) → Go to **Network** tab
2. **Try to import a repository** (or just browse the list)
3. **Look for requests** to `/api/services/github-app/import` or `/api/services/github-app/repositories`
4. **Click on the request** → Go to **Request Headers**
5. **Find `csrf-token`** header and copy its value.

## Troubleshooting

### "Missing required option" error
Make sure all required options are provided: `--org`, `--token`, `--session`, `--filter-value`

### "GitHub API error: 401"
Your GitHub token is invalid or expired. Generate a new one.

### "FOSSA API error: 401/403"
Your FOSSA session cookie is invalid or expired. Get a new one from your browser using the steps above. You may also need to include the `--csrf-token` parameter.

### "Cannot read properties of undefined (reading 'find')"
This is the original bug in FOSSA's Quick Import. The script includes error handling for this.

### Rate limiting
The script includes delays between batches to avoid rate limiting. If you hit limits, try reducing the batch size.

## Output

The script provides detailed progress information:

```
📥 Fetching repositories from GitHub organization: mycompany
  ✅ Found 150 repositories

🔍 Filtering repositories...
  📌 Excluded 45 forks
  📌 Excluded 20 private repositories
  ✅ 85 repositories after filtering

📋 Fetching existing FOSSA projects...
  ✅ Found 1250 existing FOSSA projects

🔍 Checking for existing projects...
  ✅ Found 12 existing projects
  ✅ Found 73 new repositories to import

📦 Importing 73 repositories in batches of 50...

📦 Batch 1/2
🚀 Importing batch of 50 repositories...
  ✅ Import successful: {"imported": 50}

📦 Batch 2/2
🚀 Importing batch of 23 repositories...
  ✅ Import successful: {"imported": 23}

📊 Final Statistics:
   Total GitHub repositories: 150
   After filtering: 85
   Already in FOSSA: 12
   New imports: 73
   Errors: 0

✅ IMPORT COMPLETE
```

## Security Notes

- Never commit your GitHub token or session cookie to version control
- Session cookies expire periodically; you may need to refresh them
- GitHub tokens should have minimal required permissions (repo, read:org)
- The script only makes read requests to GitHub and import requests to FOSSA

## Support

If you encounter issues:
1. Check that all required parameters are correct
2. Verify your GitHub token has the required permissions
3. Ensure your FOSSA session cookie is valid
4. Try running with `--dry-run` first to debug issues
