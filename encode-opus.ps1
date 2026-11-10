param(
  [int]$Bitrate = 16,
  [int]$Limit = 0,
  [switch]$SkipExisting,
  [switch]$Force
)

$argsList = @("--bitrate", "${Bitrate}k")
if ($Limit -gt 0) { $argsList += @("--limit", $Limit) }
if ($SkipExisting) { $argsList += "--skip-existing" }
if ($Force) { $argsList += "--force" }

python "$PSScriptRoot\scripts\encode_opus.py" @argsList
exit $LASTEXITCODE