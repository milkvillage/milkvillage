param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [string]$AdminSyncKey = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env.local"

$lines = @(
  "MILK_VILLAGE_API_BASE_URL=$($ApiBaseUrl.TrimEnd('/'))",
  "CLOUDFLARE_ADMIN_SYNC_KEY=$AdminSyncKey",
  "REMOTE_STATE_ID=main",
  "SOUND_FOLDER=C:\milk village\02_sound",
  "ATTENDANCE_BACKUP_FOLDER=C:\milk village\03_attendance_backups",
  "ATTENDANCE_DETAIL_RETENTION_MONTHS=3",
  "ATTENDANCE_PDF_BROWSER_PATH="
)

Set-Content -Path $envPath -Value $lines -Encoding UTF8
Write-Host "Saved Cloudflare API settings to $envPath"
