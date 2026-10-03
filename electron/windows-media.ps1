param([switch]$Library)

function Wait-DashboardWinRT($Operation, $ResultType) {
  $task = $script:asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if (-not $task.Wait(2000)) { throw 'Windows media request timed out' }
  $task.Result
}

function Get-DashboardMedia {
 try {
  $ErrorActionPreference = 'Stop'
  if ($null -eq $script:mediaManager) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  $script:mediaManager = Wait-DashboardWinRT ($managerType::RequestAsync()) $managerType
  }
  $session = $script:mediaManager.GetCurrentSession()
  if ($null -eq $session -or $session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') {
    $session = $script:mediaManager.GetSessions() | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
  }
  if ($null -eq $session) { return $null }
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
  $props = Wait-DashboardWinRT ($session.TryGetMediaPropertiesAsync()) $propsType
  $timeline = $session.GetTimelineProperties()
  $duration = [Math]::Max([double]0, ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds * 1000)
  $position = [Math]::Max([double]0, ($timeline.Position - $timeline.StartTime).TotalMilliseconds * 1000)
  $rate = $session.GetPlaybackInfo().PlaybackRate
  if ($null -eq $rate) { $rate = 1 }
  if ($timeline.LastUpdatedTime.Year -ge 1970) {
    $position += [Math]::Max([double]0, ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalMilliseconds) * 1000 * $rate
  }
  if ($duration -gt 0) { $position = [Math]::Min($duration, $position) }
  return @{
    title = [string]$props.Title
    artist = [string]$props.Artist
    album = [string]$props.AlbumTitle
    artUrl = ''
    durationUs = [int64]$duration
    positionUs = [int64]$position
    status = 'Playing'
  }
 } catch {
  $script:mediaManager = $null
  [Console]::Error.WriteLine($_.Exception.Message)
  return $null
 }
}

if (-not $Library) {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $value = Get-DashboardMedia
  if ($null -eq $value) { [Console]::WriteLine('null') }
  else { [Console]::WriteLine((ConvertTo-Json -InputObject $value -Compress)) }
}
