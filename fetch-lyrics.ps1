param(
  [switch]$Limit
)
$argsList = @()
if ($Limit) { $argsList += @("--limit", $Limit) }
python "$PSScriptRoot\scripts\fetch_lyrics.py" @argsList
exit $LASTEXITCODE