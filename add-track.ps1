param(
  [Parameter(Mandatory=$true)] [string]$Url,
  [Parameter(Mandatory=$true)] [string]$Title,
  [Parameter(Mandatory=$true)] [string]$Artist
)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
python scripts/add_track.py $Url --title $Title --artist $Artist --push
if ($LASTEXITCODE -ne 0) { Write-Host "Failed." -ForegroundColor Red; exit $LASTEXITCODE }
Write-Host "Done! Refresh https://sensesvoid.github.io/jamukot/ in ~1 min." -ForegroundColor Green
