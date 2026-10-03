$ErrorActionPreference = 'Stop'
$fixture = Join-Path $PSScriptRoot '../release/windows-smoke/silence.wav'
[System.IO.Directory]::CreateDirectory((Split-Path $fixture -Parent)) | Out-Null
$stream = [System.IO.File]::Create($fixture)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
  $length = 44100 * 2 * 15
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
  $writer.Write([int](36 + $length))
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
  $writer.Write([int]16)
  $writer.Write([int16]1)
  $writer.Write([int16]1)
  $writer.Write([int]44100)
  $writer.Write([int]88200)
  $writer.Write([int16]2)
  $writer.Write([int16]16)
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
  $writer.Write([int]$length)
  $writer.Write((New-Object byte[] $length))
} finally { $writer.Dispose() }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$playerType = [Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType=WindowsRuntime]
$sourceType = [Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType=WindowsRuntime]
$player = New-Object $playerType
try {
  $player.CommandManager.IsEnabled = $false
  $controls = $player.SystemMediaTransportControls
  $controls.IsEnabled = $true
  $controls.IsPlayEnabled = $true
  $controls.IsPauseEnabled = $true
  $updater = $controls.DisplayUpdater
  $updater.Type = [Windows.Media.MediaPlaybackType, Windows.Media, ContentType=WindowsRuntime]::Music
  $title = [string]::Concat([char]0x4e2d, [char]0x6587, ' media test')
  $updater.MusicProperties.Title = $title
  $updater.MusicProperties.Artist = 'Dashboard smoke test'
  $updater.Update()
  $player.Source = $sourceType::CreateFromUri([uri]$fixture)
  $player.Volume = 0
  $player.Play()
  $controls.PlaybackStatus = [Windows.Media.MediaPlaybackStatus, Windows.Media, ContentType=WindowsRuntime]::Playing
  $timeline = New-Object ([Windows.Media.SystemMediaTransportControlsTimelineProperties, Windows.Media, ContentType=WindowsRuntime])
  $timeline.StartTime = [TimeSpan]::FromSeconds(100)
  $timeline.EndTime = [TimeSpan]::FromSeconds(3700)
  $timeline.MinSeekTime = $timeline.StartTime
  $timeline.MaxSeekTime = $timeline.EndTime
  $timeline.Position = [TimeSpan]::FromSeconds(3100)
  $controls.UpdateTimelineProperties($timeline)
  Start-Sleep -Seconds 1
  node -e "const s=require('./electron/services.cjs'); const w=require('./electron/windows-worker.cjs'); (async()=>{try{const result=await s.media(); console.log(JSON.stringify(result)); if(!result || result.artist!=='Dashboard smoke test' || !result.title.startsWith('\u4e2d\u6587')) throw Error('Media metadata missing'); if(result.durationUs!==3600000000 || result.positionUs<3000000000 || result.positionUs>3010000000) throw Error('Media timeline incorrect');}finally{w.stopWindowsWorkers()}})().catch(e=>{console.error(e);process.exitCode=1})"
  if ($LASTEXITCODE -ne 0) { throw 'Media smoke failed' }
  $controls.PlaybackStatus = [Windows.Media.MediaPlaybackStatus, Windows.Media, ContentType=WindowsRuntime]::Paused
  Start-Sleep -Milliseconds 900
  node -e "const s=require('./electron/services.cjs'); const w=require('./electron/windows-worker.cjs'); (async()=>{try{const result=await s.media(); console.log(JSON.stringify(result)); if(result?.artist==='Dashboard smoke test') throw Error('Paused session was returned');}finally{w.stopWindowsWorkers()}})().catch(e=>{console.error(e);process.exitCode=1})"
  if ($LASTEXITCODE -ne 0) { throw 'Paused media smoke failed' }
  Write-Output 'MEDIA SMOKE PASSED'
} finally {
  $controls.IsEnabled = $false
  $player.Dispose()
}
