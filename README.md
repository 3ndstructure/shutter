# 셔터값 배포 순서

구성: **GitHub Pages**(화면) → **Cloudflare Worker**(가격·사진 수집) → 네이버·eBay API, 각 중고 사이트

```
shutter/
├─ index.html               ← GitHub Pages 화면 (Pages가 읽도록 저장소 맨 위에 둠)
└─ worker/
   ├─ wrangler.toml         ← Worker 설정
   └─ src/index.js          ← 수집 코드
```

## 진행 상황

- [x] 파일 구조 정리 (`worker/` 폴더로 분리, `wrangler deploy` 빌드 확인)
- [x] 3단계 Worker 설정 (`ALLOWED_ORIGINS`, `CONTACT` 입력 완료)
- [x] eBay 키가 없어도 화면이 동작하도록 처리 (수집 상태에 "키 없음"으로 표시)
- [x] 1단계 네이버 키 받기 (Flickr 키는 선택)
- [x] 2단계 저장소 공개 전환 + GitHub Pages 켜기
- [x] 4단계 Worker 배포 (eBay 빼고 먼저) → `https://shutter-price.shutter-price.workers.dev`
- [x] 5단계 연결 확인
- [ ] 네이버 키 다시 넣기 — 지금 401 오류 ([아래](#네이버-api가-401일-때))
- [ ] (선택) 자동 배포 토큰 등록 ([아래](#자동-배포-github-actions))
- [ ] eBay 승인 후 키 두 개 추가 ([아래](#ebay-승인-후-5분))

---

## 0단계. 준비물 (10분)

- GitHub 계정, Cloudflare 계정 (둘 다 무료)
- 컴퓨터에 **Node.js LTS** 설치 → 터미널에서 `node -v` 가 나오면 됨

## 1단계. API 키 받기 (20~30분, eBay는 승인에 하루 이상)

| 키 | 어디서 | 받을 값 |
|---|---|---|
| 네이버 | developers.naver.com → Application → 애플리케이션 등록 → 사용 API에 **검색** 선택, 환경은 WEB에 `https://3ndstructure.github.io` | Client ID, Client Secret |
| eBay | developer.ebay.com 가입 → (승인 후) Application Keys → **Production** 키 생성 | App ID(Client ID), Cert ID(Client Secret) |
| Flickr (선택) | flickr.com/services/apps/create | API Key |

- **eBay 개발자 계정은 승인까지 최소 하루가 걸려요.** 기다리지 말고 네이버 키만으로 2~5단계를 먼저 끝내세요. eBay 키가 없으면 수집 상태에 "eBay 키 없음"으로 나오고 나머지는 정상 동작해요.
- Flickr 키가 없으면 작례는 위키미디어 공용 사진으로 대신 나와요 (기종에 따라 적을 수 있음).

## 2단계. 화면을 GitHub Pages에 올리기 (5분)

`index.html` 은 이미 이 저장소(`3ndstructure/shutter`) 맨 위에 있어요.

1. 이 작업 브랜치가 `main` 에 합쳐져 있는지 확인 (Pages는 `main` 을 읽어요)
2. **저장소 공개 전환**: 지금 저장소가 Private이라 무료 계정에서는 Pages를 켤 수 없어요.
   Settings → General → 맨 아래 Danger Zone → **Change visibility → Public**
   (비밀 키는 저장소가 아니라 Cloudflare에 들어가니 공개해도 괜찮아요. GitHub Pro라면 Private 그대로 가능)
3. Settings → Pages → Source: **Deploy from a branch**, Branch: `main`, 폴더 `/ (root)` → Save
4. 1~2분 뒤 주소 확인: `https://3ndstructure.github.io/shutter/`

## 3단계. Worker 설정 고치기 — 완료

`worker/wrangler.toml` 에 이미 들어가 있어요:

```toml
ALLOWED_ORIGINS = "https://3ndstructure.github.io"
CONTACT = "https://3ndstructure.github.io/shutter/"
```

- `CONTACT` 는 위키미디어에 보내는 연락처예요. 저장소가 공개되므로 이메일 대신 사이트 주소를 넣었어요. 이메일을 쓰고 싶으면 바꿔도 돼요.
- 나중에 개인 도메인을 쓰면 `ALLOWED_ORIGINS` 에 쉼표로 추가하세요.

## 4단계. Worker 배포 (15분)

터미널에서 `worker` 폴더로 이동 후 순서대로:

```bash
cd worker
npx wrangler login                          # 브라우저가 열리면 Cloudflare 로그인 후 허용
npx wrangler kv namespace create CACHE      # 완료: id 는 wrangler.toml 에 들어가 있음 (다시 만들지 않기)

npx wrangler secret put ACCESS_KEY          # 개인 키: 아무도 모를 긴 문자열 직접 만들어 입력
npx wrangler secret put NAVER_ID
npx wrangler secret put NAVER_SECRET
npx wrangler secret put FLICKR_KEY          # 선택
# EBAY_ID, EBAY_SECRET 은 승인 후에 넣어요 (아래 "eBay 승인 후")

npx wrangler deploy                          # 주소: https://shutter-price.shutter-price.workers.dev
```

- KV id를 바꾼 `wrangler.toml` 은 커밋해서 올려도 돼요 (id는 비밀값이 아님).

## 5단계. 연결 확인 (5분)

1. 브라우저 주소창에 `https://shutter-price.shutter-price.workers.dev/api/health` → `{"ok":true, ...}` 가 보이면 성공
2. GitHub Pages 사이트 열기 → 오른쪽 위 **자동 수집 꺼짐** 누르기
3. Worker 주소와 개인 키(ACCESS_KEY와 같은 값) 입력 → **저장하고 연결 확인**
4. 네이버·개인용 수집·저장소가 "켜짐"으로 나오면 완료 (eBay는 승인 전까지 "꺼짐"이 정상)

**`ERR_SSL_VERSION_OR_CIPHER_MISMATCH` 가 뜨면**: workers.dev 하위 도메인(`shutter-price.workers.dev`)을 방금 처음 만들어서 Cloudflare가 아직 HTTPS 인증서를 발급하는 중이에요. 코드나 설정 문제가 아니라 기다리면 풀려요.

1. 10~30분 기다린 뒤 **시크릿 창**에서 다시 열기 (브라우저가 실패한 연결을 기억하고 있을 수 있음)
2. PowerShell에서 확인: `curl.exe https://shutter-price.shutter-price.workers.dev/api/health` → JSON이 나오면 해결된 것
3. 한두 시간이 지나도 그대로면: Cloudflare 대시보드 → Workers & Pages → `shutter-price` → Settings → Domains & Routes 에서 workers.dev 가 **Enabled** 인지 확인
4. 그래도 안 되면 백신의 HTTPS 검사·VPN을 잠시 끄고 열어보기

## 네이버 API가 401일 때

401은 네이버가 키를 거절했다는 뜻이에요. 칩에 마우스를 올리면 Worker에 들어간 키 길이가 보여요.

- **Client ID는 20자, Client Secret은 10자**예요. 둘을 바꿔 넣었거나 두 번 붙여넣으면 401이 나요.
  `wrangler secret put` 을 할 때 입력창의 `*` 개수로 확인할 수 있어요.
- 다시 넣기: `worker` 폴더에서
  ```bash
  npx wrangler secret put NAVER_ID       # Client ID (20자) → * 가 20개인지 확인
  npx wrangler secret put NAVER_SECRET   # Client Secret (10자) → * 가 10개인지 확인
  ```
  터미널 붙여넣기가 계속 이상하면 Cloudflare 대시보드 → Workers & Pages → `shutter-price` → Settings → Variables and Secrets 에서 값을 고쳐도 돼요.
- 길이가 맞는데도 401이면: developers.naver.com → 내 애플리케이션 → API 설정 → 사용 API에 **검색** 이 있는지 확인
- 비밀값은 넣는 즉시 적용돼요. 사이트를 새로고침해서 확인하세요.

## 자동 배포 (GitHub Actions)

`main` 에 `worker/` 변경이 합쳐지면 `.github/workflows/deploy-worker.yml` 이 Worker를 배포해요. 한 번만 설정하면 이후 수정은 PR merge만으로 배포돼요.

1. Cloudflare 대시보드 → 오른쪽 위 프로필 → **My Profile → API Tokens → Create Token** → 템플릿 **Edit Cloudflare Workers** → Account Resources는 내 계정, Zone Resources는 All zones → 생성 후 토큰 복사
2. GitHub 저장소 → Settings → Secrets and variables → **Actions** → New repository secret → 이름 `CLOUDFLARE_API_TOKEN`, 값에 토큰 붙여넣기
3. 저장소 Actions 탭 → **Deploy Worker** → Run workflow 로 바로 배포해 볼 수 있어요

- 토큰이 없으면 이 작업은 배포를 건너뛰고 초록색으로 끝나요.
- 비밀값(`NAVER_*`, `EBAY_*`, `ACCESS_KEY`)은 배포해도 그대로 유지돼요.

## eBay 승인 후 (5분)

1. developer.ebay.com → Application Keys → **Production** 키 생성
2. "계정 삭제 알림(Marketplace Account Deletion)" 설정을 요구하면, 개인 데이터를 저장하지 않는 앱이라 **면제(opt out)** 를 선택
3. `worker` 폴더에서:
   ```bash
   npx wrangler secret put EBAY_ID       # App ID (Client ID)
   npx wrangler secret put EBAY_SECRET   # Cert ID (Client Secret)
   ```
   비밀값을 넣으면 바로 적용돼요. `deploy` 를 다시 할 필요 없어요.
4. 사이트를 새로고침 → 설정에서 eBay "켜짐" 확인

## 6단계. 사이트별 동작 점검

시세 탭의 **수집 상태** 칩에서 사이트마다 건수가 나와요. 칩에 마우스를 올리면 실패 이유가 보여요.

| 사이트 | 방식 | 실패하면 |
|---|---|---|
| 네이버쇼핑, eBay | 공식 API | 키 오타, eBay Production 키 활성화 여부 확인. "키 없음"은 Worker에 키를 아직 안 넣은 것. 네이버 401은 [위](#네이버-api가-401일-때) 참고 |
| 번개장터, 중고나라, 당근(서울), 야후옥션 | 개인용 수집 | 사이트 구조가 바뀐 것. 실패 메시지를 Claude에게 보내면 수정 |
| 후르츠패밀리 | 개인용 수집 (실험) | 앱 중심 사이트라 0건일 수 있음 |
| N플리마켓, 메루카리, 쿠팡, 커뮤니티 장터 | 바로가기 링크 | 공개 검색 경로가 없어 수집하지 않음 |

## 알아둘 것

- 개인용 수집은 **개인 키가 있을 때만** 동작하고, 결과를 6시간 저장해서 같은 검색을 반복하지 않아요. 사이트를 다른 사람과 공유해도 키를 모르면 공식 API 결과만 보여요.
- 무료 한도: Worker 하루 10만 요청, KV 저장 하루 1,000회. 혼자 쓰기엔 충분해요.
- 다음 단계 후보: 기록을 Firebase Firestore에 저장해 폰·PC 동기화, 관심 기종을 매일 새벽 자동 수집(Cron)해 시세 추이 그래프 만들기.
