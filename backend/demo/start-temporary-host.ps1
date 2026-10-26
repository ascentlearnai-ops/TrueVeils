$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$folder = Join-Path $root '.readiness\temporary-relay'
$node = (Get-Command node.exe).Source
$env:TRUVEIL_CLOUDFLARED = (Get-Command cloudflared.exe).Source
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TruveilAwake {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint flags);
}
'@
$child = $null
try {
  if ([TruveilAwake]::SetThreadExecutionState([uint32]2147483649) -eq 0) { throw 'Could not request system awake state.' }
  $helper = Join-Path $PSScriptRoot 'temporary-host.js'
  $child = Start-Process -FilePath $node -ArgumentList @(('"' + $helper + '"'), 'run') -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $folder 'host-output.log') -RedirectStandardError (Join-Path $folder 'host-error.log')
  @{ supervisorPid = $PID; nodePid = $child.Id; awakeRequested = $true; startedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'supervisor.json')
  while (-not $child.WaitForExit(20000)) {
    if ([TruveilAwake]::SetThreadExecutionState([uint32]2147483649) -eq 0) { throw 'System awake request was lost.' }
  }
} finally {
  if ($child -and -not $child.HasExited) {
    [IO.File]::WriteAllText((Join-Path $folder 'stop-request'), 'stop')
    [void]$child.WaitForExit(10000)
  }
  [void][TruveilAwake]::SetThreadExecutionState([uint32]2147483648)
}
