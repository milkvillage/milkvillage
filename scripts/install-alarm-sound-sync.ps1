param(
  [string]$TaskName = "MilkVillageAlarmSoundSync",
  [int]$Minutes = 60
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env.local"
$ExamplePath = Join-Path $RepoRoot ".env.local.example"

if (-not (Test-Path $EnvPath)) {
  Copy-Item $ExamplePath $EnvPath
  Write-Host "Created .env.local. Open it and paste MILK_VILLAGE_API_BASE_URL before relying on the task."
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\run-alarm-sound-sync.ps1`""

$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutes)

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Description "Upload Milk Village alarm mp3 files from C:\milk village\02_sound to Cloudflare R2." `
  -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' to run every $Minutes minutes."
