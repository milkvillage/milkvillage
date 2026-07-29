# Cloudflare 전환 설정

Supabase 사용량 제한을 피하기 위해 앱 상태는 Cloudflare D1에, MP3 알림음은 Cloudflare R2에 저장합니다.

## 1. Cloudflare 리소스 만들기

PowerShell에서 저장소 폴더로 이동합니다.

```powershell
cd "C:\milk village\01_managing code"
```

Cloudflare에 로그인합니다.

```powershell
npx wrangler login
```

D1 데이터베이스를 만듭니다.

```powershell
npx wrangler d1 create milk-village-db
```

출력된 `database_id`를 복사한 뒤 `cloudflare\wrangler.toml.example`을 `cloudflare\wrangler.toml`로 복사하고 `database_id`에 붙여넣습니다.

R2 버킷을 만듭니다.

```powershell
npx wrangler r2 bucket create milk-village-alarm-sounds
```

D1 테이블을 생성합니다.

```powershell
cd "C:\milk village\01_managing code\cloudflare"
npx wrangler d1 execute milk-village-db --remote --file=./schema.sql
```

Worker를 배포합니다.

```powershell
npx wrangler deploy
```

배포 후 나오는 URL이 앱에서 사용할 DB/API 주소입니다. 예:

```text
https://milk-village-api.your-subdomain.workers.dev
```

## 2. 앱에 Worker URL 넣기

`remote-config.js`를 열고 Worker URL을 넣습니다.

```js
window.MILK_VILLAGE_API_BASE_URL = "https://milk-village-api.your-subdomain.workers.dev";
```

변경 후 GitHub에 커밋/푸시하면 태블릿 앱도 같은 API를 사용합니다.

## 3. 첫 데이터 업로드 순서

D1이 비어 있는 상태에서 앱을 처음 열면, 그 기기의 로컬 데이터가 서버에 최초 저장됩니다.

따라서 반드시 현재 데이터가 가장 정확한 기기에서 먼저 앱을 열고, 상단 상태가 `DB 연결됨`이 되는지 확인하세요.

그 다음 다른 태블릿/노트북/모바일을 새로고침하면 같은 데이터로 맞춰집니다.

## 4. MP3 알림음 동기화

로컬 스크립트용 API 주소를 저장합니다.

```powershell
.\scripts\set-cloudflare-api-url.ps1 -ApiBaseUrl "https://milk-village-api.your-subdomain.workers.dev"
```

Cloudflare Worker의 `ADMIN_SYNC_KEY`를 설정했다면 같은 값을 함께 넣습니다.

```powershell
.\scripts\set-cloudflare-api-url.ps1 -ApiBaseUrl "https://milk-village-api.your-subdomain.workers.dev" -AdminSyncKey "내가정한키"
```

그 뒤 기존처럼 MP3 파일을 `C:\milk village\02_sound` 폴더에 넣고 동기화 버튼을 누르면 R2에 업로드됩니다.

