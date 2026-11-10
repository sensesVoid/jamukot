param(
  [int]$Limit = 0
)
$argsList = @()
if ($Limit -gt 0) { $argsList += @("--limit", $Limit) }
python "$PSScriptRoot\scripts\fetch_lyrics.py" @argsList
exit $LASTEXITCODE