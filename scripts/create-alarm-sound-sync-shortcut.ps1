param(
  [string]$ShortcutName = "Milk Village MP3 Sync"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $PSScriptRoot "run-alarm-sound-sync.ps1"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "$ShortcutName.lnk"
$PowerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path $ScriptPath)) {
  throw "Sync script not found: $ScriptPath"
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellPath
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
$Shortcut.WorkingDirectory = $RepoRoot
$Shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,167"
$Shortcut.Description = "Sync Milk Village mp3 alarm sounds to Cloudflare R2."
$Shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"
