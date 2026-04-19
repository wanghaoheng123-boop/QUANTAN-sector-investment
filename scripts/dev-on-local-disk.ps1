<#
.SYNOPSIS
  Work around Google Drive / OneDrive npm failures (TAR_ENTRY_ERROR, EBADF).

.DESCRIPTION
  Clones this repo to a path on a local drive (default E:\), runs npm install with
  cache on that drive, then typecheck + tests + benchmark:optimizer.

  Usage (from repo root, or pass -SourceRepo):
    powershell -ExecutionPolicy Bypass -File scripts/dev-on-local-disk.ps1

  After a successful run, if package-lock.json changed, copy it back to your
  synced workspace and commit so Vercel `npm ci` can work again.
#>
param(
  [string]$Branch = "cursor/trading-simulator",
  [string]$Remote = "https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment.git",
  [string]$BuildRoot = "E:\QUANTAN-sector-investment-build",
  [string]$NpmCache = "E:\npm-cache-quantan"
)

$ErrorActionPreference = "Stop"

if (Test-Path $BuildRoot) {
  Write-Host "Removing existing $BuildRoot"
  Remove-Item -Recurse -Force $BuildRoot
}

Write-Host "Cloning $Remote (branch $Branch) -> $BuildRoot"
git clone --depth 1 --branch $Branch $Remote $BuildRoot

Push-Location $BuildRoot
try {
  New-Item -ItemType Directory -Force -Path $NpmCache | Out-Null
  $env:npm_config_cache = $NpmCache
  Write-Host "npm install (cache: $NpmCache)"
  npm install

  Write-Host "`n=== npm run test:types ==="
  npm run test:types

  Write-Host "`n=== npm run test ==="
  npm run test

  Write-Host "`n=== npm run benchmark:optimizer ==="
  npm run benchmark:optimizer

  Write-Host "`nDone. If package-lock.json changed, compare with your Drive copy:"
  Write-Host "  fc /N package-lock.json <path-to-drive-copy>\package-lock.json"
}
finally {
  Pop-Location
}
