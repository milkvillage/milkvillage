$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $PSScriptRoot "alarm-sound-sync.log"
$Node = "node"

Set-Location $RepoRoot
& $Node ".\scripts\sync-alarm-sounds.js" *>> $LogPath
