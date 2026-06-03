param(
  [switch]$Force,
  [switch]$Current
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $PSScriptRoot "attendance-backup.log"
$Node = "node"
$Args = @(".\scripts\backup-attendance-records.js")

if ($Force) {
  $Args += "--force"
}

if ($Current) {
  $Args += "--current"
}

Set-Location $RepoRoot
& $Node $Args *>> $LogPath
