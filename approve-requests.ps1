param(
  [switch]$DryRun,
  [switch]$Push,
  [switch]$NoPull
)

$argsList = @()
if ($DryRun) { $argsList += '--dry-run' }
if ($Push) { $argsList += '--push' }
if ($NoPull) { $argsList += '--no-pull' }

python "$PSScriptRoot\scripts\approve_requests.py" @argsList
exit $LASTEXITCODE
