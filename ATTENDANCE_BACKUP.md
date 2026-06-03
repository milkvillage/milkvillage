# Milk Village Attendance Backup

근퇴기록은 앱에서 자동 삭제하지 않습니다.

분기별 로컬 백업은 Windows 작업 스케줄러로 처리합니다. 설치 후 작업은 매일 한 번 실행되지만, 실제 PDF는 새 분기가 시작된 뒤 이전 분기 기준으로 한 번만 생성됩니다.

기본 저장 위치:

```text
C:\milk village\03_attendance_backups
```

생성 파일:

```text
milk-village-attendance-YYYY-QN.pdf
```

PDF에는 근무자 이름, 출근/결근 상태, 예정/실제 근무시간, 변경 사유, 근무자 서명, 매니저 확인 서명이 함께 들어갑니다.

PDF 생성에는 Microsoft Edge 또는 Chrome의 인쇄 기능을 사용합니다. 기본 Edge 경로를 자동으로 찾으며, 별도 경로가 필요하면 `.env.local`에 `ATTENDANCE_PDF_BROWSER_PATH`를 설정합니다.

설치:

```powershell
.\scripts\install-attendance-backup.ps1
```

수동 테스트:

```powershell
.\scripts\run-attendance-backup.ps1 -Force -Current
```
