param(
  [string]$TaskName = "MilkVillageAttendanceQuarterlyBackup",
  [string]$At = "03:10"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env.local"
$ExamplePath = Join-Path $RepoRoot ".env.local.example"

if (-not (Test-Path $EnvPath)) {
  Copy-Item $ExamplePath $EnvPath
  Write-Host "Created .env.local. Paste your Supabase key before relying on the backup task."
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\run-attendance-backup.ps1`""

$Trigger = New-ScheduledTaskTrigger -Daily -At $At
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Description "Back up Milk Village attendance records to C:\milk village\03_attendance_backups. The script runs daily and writes one backup per quarter." `
  -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName'. It checks daily at $At and writes one backup per quarter."
