$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $workspace 'release/win-unpacked/Ambient Dashboard.exe'
$base = 'http://127.0.0.1:3988/api/dashboard'
function Send-DashboardCommand([string]$action) {
  Invoke-RestMethod -Uri "$base/control" -Method Post -ContentType 'application/json' -Body (@{ action = $action } | ConvertTo-Json -Compress) -TimeoutSec 15
}
$running = Start-Process -FilePath $executable -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
try {
  $status = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $status = Invoke-RestMethod -Uri "$base/control" -TimeoutSec 2; if ($status.connected) { break } } catch {}
    Start-Sleep -Milliseconds 300
  }
  if (-not $status.connected) { throw 'Packaged display did not connect' }
  Write-Output ('STATUS ' + ($status | ConvertTo-Json -Compress))
  $sample = Invoke-RestMethod -Uri "$base/system/telemetry" -TimeoutSec 15
  if ($null -eq $sample.netBytesPerSecond -or $null -eq $sample.diskBytesPerSecond -or $null -eq $sample.gpu.use) { throw 'Packaged telemetry is incomplete' }
  Write-Output ('TELEMETRY ' + ($sample | ConvertTo-Json -Depth 5 -Compress))
  $media = Invoke-RestMethod -Uri "$base/system/media" -TimeoutSec 15
  Write-Output ('MEDIA ' + (ConvertTo-Json -InputObject $media -Compress))
  $status = Send-DashboardCommand 'performance'
  if ($status.mode -ne 'performance') { throw 'Performance mode failed' }
  $status = Send-DashboardCommand 'normal'
  if ($status.mode -ne 'normal') { throw 'Normal mode failed' }
  $status = Send-DashboardCommand 'close-display'
  if ($status.connected) { throw 'Display close failed' }
  Send-DashboardCommand 'open-display' | Out-Null
  Start-Sleep -Seconds 1
  $status = Invoke-RestMethod -Uri "$base/control" -TimeoutSec 5
  if (-not $status.connected) { throw 'Display reopen failed' }
  Write-Output 'PACKAGE SMOKE PASSED'
} finally {
  Send-DashboardCommand 'quit' | Out-Null
  if (-not $running.WaitForExit(10000)) { throw 'Packaged application did not exit' }
}
