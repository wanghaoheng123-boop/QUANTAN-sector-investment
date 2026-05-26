#Requires -Version 5.1
<#
  Sync this project to a local folder so npm install / next build work (avoids EBADF on synced G: paths).

  Examples (run from repo root: QUANTAN-sector-investment):
    powershell -ExecutionPolicy Bypass -File .\scripts\sync-to-local-build.ps1
    .\scripts\sync-to-local-build.ps1 -Install -Dev

  From File Explorer: double-click sync-to-local-build.cmd
#>
param(
  [switch]$Install,
  [switch]$Dev,
  [switch]$Build
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dest = Join-Path $env:LOCALAPPDATA 'Temp\quantan-sector-build'

$env:Path = "$env:ProgramFiles\nodejs;$env:Path"

Write-Host "Source: $ProjectRoot"
Write-Host "Dest:   $Dest"

if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
}

$robocopyArgs = @(
  $ProjectRoot,
  $Dest,
  '/E',
  '/XD', 'node_modules', '.next', '.git',
  '/R:2',
  '/W:1',
  '/NFL', '/NDL', '/NJH', '/NJS',
  '/nc', '/ns', '/np'
)
& robocopy @robocopyArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) {
  Write-Error "robocopy failed with exit code $rc"
  exit $rc
}

Write-Host "Sync finished (robocopy exit $rc; 0–7 means success)."

Push-Location $Dest
try {
  if ($Install -or $Dev -or $Build) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
      Write-Error "npm not found. Install Node.js LTS and reopen the terminal."
      exit 1
    }
  }

  if ($Install) {
    npm install --no-audit --no-fund
  }

  if ($Build) {
    npm run build
  }

  if ($Dev) {
    npm run dev -- --hostname 127.0.0.1 --port 3000
  }

  if (-not ($Install -or $Dev -or $Build)) {
    Write-Host ""
    Write-Host "Next time — open PowerShell and run:"
    Write-Host "  cd `"$Dest`""
    Write-Host '  $env:Path = "$env:ProgramFiles\nodejs;$env:Path"'
    Write-Host "  npm install   # only after fresh machine or package.json changed"
    Write-Host "  npm run dev -- --hostname 127.0.0.1 --port 3000"
    Write-Host ""
    Write-Host "Or one shot from repo root:"
    Write-Host "  .\scripts\sync-to-local-build.ps1 -Install -Dev"
  }
}
finally {
  Pop-Location
}
