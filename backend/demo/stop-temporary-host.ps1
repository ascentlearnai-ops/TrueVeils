$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$folder = Join-Path $root '.readiness\temporary-relay'
if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'No temporary relay configuration found.' }
[IO.File]::WriteAllText((Join-Path $folder 'stop-request'), 'stop')
Write-Output 'Stop requested. Current demo rooms will disconnect and the awake request will be released.'
