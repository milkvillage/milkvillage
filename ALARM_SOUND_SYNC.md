# Alarm Sound Manual Sync

`C:\milk village\02_sound` 폴더에 mp3 파일을 넣은 뒤, 직접 버튼을 눌렀을 때만 Supabase Storage의 `alarm-sounds` 버킷과 앱의 알림음 목록을 동기화합니다.

## 최초 1회 설정

1. Supabase service role key를 로컬에 저장합니다.

```powershell
.\scripts\set-alarm-sync-key.ps1
```

2. 바탕화면에 수동 동기화 버튼을 만듭니다.

```powershell
.\scripts\create-alarm-sound-sync-shortcut.ps1
```

3. 기존 자동 동기화 작업이 설치되어 있다면 제거합니다.

```powershell
.\scripts\disable-alarm-sound-auto-sync.ps1
```

## 사용 방법

1. `C:\milk village\02_sound` 폴더에 mp3 파일을 추가하거나 삭제합니다.
2. 바탕화면의 `Milk Village MP3 Sync` 버튼을 누릅니다.
3. 동기화가 끝난 뒤 앱의 알림 관리에서 새 알림음을 선택합니다.

바탕화면 버튼 대신 PowerShell에서 직접 실행해도 됩니다.

```powershell
.\scripts\run-alarm-sound-sync.ps1
```

## 보안

`.env.local`과 `%APPDATA%\MilkVillage\alarm-sound-sync.env`는 GitHub에 올라가지 않습니다. Supabase service role key는 로컬 컴퓨터에만 보관하세요.
