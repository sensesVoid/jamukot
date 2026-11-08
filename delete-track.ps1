param(
  [Parameter(Mandatory=$true)] [string]$Query,
  [string]$Artist = "",
  [switch]$Push
)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$extra = if ($Push) { "--push" } else { "" }
$artistArg = if ($Artist) { "--artist `"$Artist`"" } else { "" }
if ($Query -match '^\d+$') {
  python scripts/delete_track.py --id $Query $artistArg $extra
} else {
  python scripts/delete_track.py --title $Query $artistArg $extra
}
if ($LASTEXITCODE -ne 0) { Write-Host "Failed." -ForegroundColor Red; exit $LASTEXITCODE }
Write-Host "Done." -ForegroundColor Green
