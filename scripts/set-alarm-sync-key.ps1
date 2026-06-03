$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env.local"

$SecureKey = Read-Host "Paste Supabase service_role key" -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
  $ServiceRoleKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}

if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
  throw "Service role key is empty."
}

@"
SUPABASE_URL=https://irfalbrkahcouaugbqwj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$ServiceRoleKey
SUPABASE_STORAGE_BUCKET=alarm-sounds
SUPABASE_STATE_TABLE=milk_village_state
SUPABASE_STATE_ID=main
SOUND_FOLDER=C:\milk village\02_sound
"@ | Set-Content -Path $EnvPath -Encoding UTF8

Write-Host ".env.local updated. The key is stored locally and is ignored by Git."
