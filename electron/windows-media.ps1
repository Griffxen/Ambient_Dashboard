try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  $manager = $asTask.MakeGenericMethod($managerType).Invoke($null, @($managerType::RequestAsync())).Result
  $session = $manager.GetCurrentSession()
  if ($null -eq $session -or $session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') { 'null'; exit }
  $props = $asTask.MakeGenericMethod($propsType).Invoke($null, @($session.TryGetMediaPropertiesAsync())).Result
  $timeline = $session.GetTimelineProperties()
  @{
    title = [string]$props.Title
    artist = [string]$props.Artist
    album = [string]$props.AlbumTitle
    artUrl = ''
    durationUs = [int64]($timeline.EndTime.TotalMilliseconds * 1000)
    positionUs = [int64]($timeline.Position.TotalMilliseconds * 1000)
    status = 'Playing'
  } | ConvertTo-Json -Compress
} catch {
  'null'
}
