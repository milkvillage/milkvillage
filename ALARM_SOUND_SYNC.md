# Alarm Sound Auto Sync

`C:\milk village\02_sound` 폴더에 mp3 파일을 넣으면 `scripts/sync-alarm-sounds.js`가 Supabase Storage의 `alarm-sounds` 버킷에 업로드하고, 앱의 알림음 선택 목록에도 자동으로 추가합니다.

## 최초 1회 설정

1. PowerShell에서 아래 명령을 실행하고 Supabase service role key를 붙여넣습니다.

```powershell
.\scripts\set-alarm-sync-key.ps1
```

2. 아래 명령으로 5분마다 자동 확인하는 Windows 작업을 등록합니다.

```powershell
.\scripts\install-alarm-sound-sync.ps1
```

설치 후 Windows 작업 스케줄러가 5분마다 `C:\milk village\02_sound` 폴더를 확인합니다.

## 수동 실행

```powershell
.\scripts\run-alarm-sound-sync.ps1
```

## 보안

`.env.local`은 `.gitignore`에 포함되어 GitHub에 올라가지 않습니다. Supabase service role key는 이 파일에만 저장하세요.
