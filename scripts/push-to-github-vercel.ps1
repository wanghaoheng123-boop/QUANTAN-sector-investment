# Sync this folder (quantan app) to the GitHub repo linked to Vercel, then push.
# Usage (from antigravity-sectors):  .\scripts\push-to-github-vercel.ps1
# Optional message: .\scripts\push-to-github-vercel.ps1 "fix: BTC chart"
# Override clone path: $env:QUANTAN_REPO = "D:\path\to\QUANTAN-sector-investment"
#
# Vercel deploys when GitHub main updates; push is enough.

$ErrorActionPreference = "Stop"
$appRoot = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $appRoot -Parent
$desktop = Split-Path $workspace -Parent
$dest = if ($env:QUANTAN_REPO) { $env:QUANTAN_REPO } else { Join-Path $desktop "QUANTAN-sector-investment" }

if (-not (Test-Path (Join-Path $dest ".git"))) {
  Write-Error "No git repo at: $dest — set `$env:QUANTAN_REPO to your QUANTAN-sector-investment clone."
  exit 1
}

Write-Host "Mirroring $appRoot -> $dest"
robocopy $appRoot $dest /MIR /XD node_modules .next .git .vercel /NFL /NDL /NJH /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { Write-Error "robocopy failed with exit $rc"; exit $rc }

Push-Location $dest
try {
  git add -A
  $porcelain = git status --porcelain
  if ($porcelain) {
    $msg = if ($args[0]) { $args[0] } else { "chore: sync from dev workspace ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" }
    git commit -m $msg
  } else {
    Write-Host "No file changes to commit."
  }
  git push origin main
  Write-Host "Done. Vercel will build from GitHub main if the project is linked."
} finally {
  Pop-Location
}
