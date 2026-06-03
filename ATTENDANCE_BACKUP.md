# Milk Village Attendance Backup

근퇴기록은 앱에서 자동 삭제하지 않습니다.

분기별 로컬 백업은 Windows 작업 스케줄러로 처리합니다. 설치 후 작업은 매일 한 번 실행되지만, 실제 백업 파일은 새 분기가 시작된 뒤 이전 분기 기준으로 한 번만 생성됩니다.

기본 저장 위치:

```text
C:\milk village\03_attendance_backups
```

생성 파일:

```text
milk-village-attendance-YYYY-QN.json
milk-village-attendance-YYYY-QN.csv
```

`json`에는 서명 이미지까지 포함된 원본 기록이 들어가고, `csv`에는 확인용 요약 정보만 들어갑니다.

설치:

```powershell
.\scripts\install-attendance-backup.ps1
```

수동 테스트:

```powershell
.\scripts\run-attendance-backup.ps1 -Force -Current
```
