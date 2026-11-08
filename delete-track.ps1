param(
  [Parameter(Mandatory=$true)] [string]$Query,
  [switch]$Push
)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
# Try as id first
if ($Query -match '^\d+$') {
  python scripts/delete_track.py --id $Query $(if ($Push) { "--push" })
} else {
  python scripts/delete_track.py --title $Query $(if ($Push) { "--push" })
}
if ($LASTEXITCODE -ne 0) { Write-Host "Failed." -ForegroundColor Red; exit $LASTEXITCODE }
Write-Host "Done." -ForegroundColor Green
