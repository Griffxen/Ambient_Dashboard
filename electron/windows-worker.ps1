param([ValidateSet('media', 'telemetry')][string]$Service)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ($Service -eq 'media') { . (Join-Path $PSScriptRoot 'windows-media.ps1') -Library }

function Get-DashboardTelemetry {
  $net = $null
  $disk = $null
  $gpu = $null
  try {
    $rows = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
    if ($rows.Count) { $net = [double](($rows | Measure-Object BytesTotalPersec -Sum).Sum) }
  } catch {}
  try {
    $row = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
    if ($null -ne $row) { $disk = [double]$row.DiskBytesPersec }
  } catch {}
  try {
    $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
    if ($rows.Count) {
      # Sum process usage on the same physical engine, then use the busiest engine.
      # Summing independent engines would incorrectly exceed 100%.
      $engines = @{}
      foreach ($row in $rows) {
        $key = [string]$row.Name -replace '^pid_\d+_', ''
        $engines[$key] += [double]$row.UtilizationPercentage
      }
      $use = [Math]::Min(100, [Math]::Max(0, ($engines.Values | Measure-Object -Maximum).Maximum))
      $gpu = @{ use = $use; vramUsedMB = $null; vramTotalMB = $null; tempC = $null; powerW = $null; fanPercent = $null; clockMHz = $null }
    }
  } catch {}
  @{ netBytesPerSecond = $net; diskBytesPerSecond = $disk; gpu = $gpu }
}

while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $value = if ($Service -eq 'media') { Get-DashboardMedia } else { Get-DashboardTelemetry }
    [Console]::WriteLine((@{ id = $request.id; value = $value } | ConvertTo-Json -Depth 6 -Compress))
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if ($null -ne $request) { [Console]::WriteLine((@{ id = $request.id; value = $null } | ConvertTo-Json -Compress)) }
  }
}
