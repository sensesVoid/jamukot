param(
  [Parameter(Mandatory=$true)] [string]$OldQuery,
  [string]$OldArtist = "",
  [Parameter(Mandatory=$true)] [string]$Url,
  [Parameter(Mandatory=$true)] [string]$NewTitle,
  [Parameter(Mandatory=$true)] [string]$NewArtist,
  [switch]$Push
)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$extra = if ($Push) { "--push" } else { "" }
$artistArg = if ($OldArtist) { "--artist `"$OldArtist`"" } else { "" }
if ($OldQuery -match '^\d+$') {
  python scripts/replace_track.py --id $OldQuery $Url --new-title $NewTitle --new-artist $NewArtist $artistArg $extra
} else {
  python scripts/replace_track.py --title $OldQuery $Url --new-title $NewTitle --new-artist $NewArtist $artistArg $extra
}
if ($LASTEXITCODE -ne 0) { Write-Host "Failed." -ForegroundColor Red; exit $LASTEXITCODE }
Write-Host "Done." -ForegroundColor Green
