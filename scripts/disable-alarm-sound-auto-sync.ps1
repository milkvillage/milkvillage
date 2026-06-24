param(
  [string]$TaskName = "MilkVillageAlarmSoundSync"
)

$ErrorActionPreference = "Stop"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $Task) {
  Write-Host "Scheduled task '$TaskName' is not installed."
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'. Use the desktop shortcut or run scripts\run-alarm-sound-sync.ps1 manually."
