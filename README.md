# 셔터값 배포 순서

구성: **GitHub Pages**(화면) → **Cloudflare Worker**(가격·사진 수집) → 네이버·eBay API, 각 중고 사이트

```
shutter/
├─ site/index.html          ← GitHub에 올릴 화면
└─ worker/
   ├─ wrangler.toml         ← Worker 설정
   └─ src/index.js          ← 수집 코드
```

---

## 0단계. 준비물 (10분)

- GitHub 계정, Cloudflare 계정 (둘 다 무료)
- 컴퓨터에 **Node.js LTS** 설치 → 터미널에서 `node -v` 가 나오면 됨

## 1단계. API 키 받기 (20~30분, 승인 대기가 있을 수 있음)

| 키 | 어디서 | 받을 값 |
|---|---|---|
| 네이버 | developers.naver.com → Application → 애플리케이션 등록 → 사용 API에 **검색** 선택, 환경은 WEB에 GitHub 주소 | Client ID, Client Secret |
| eBay | developer.ebay.com 가입 → Application Keys → **Production** 키 생성 | App ID(Client ID), Cert ID(Client Secret) |
| Flickr (선택) | flickr.com/services/apps/create | API Key |

- eBay Production 키를 켤 때 "계정 삭제 알림(Marketplace Account Deletion)" 설정을 요구하면, 개인 데이터를 저장하지 않는 앱이라 **면제(opt out)** 를 선택하면 돼요.
- Flickr 키가 없으면 작례는 위키미디어 공용 사진으로 대신 나와요 (기종에 따라 적을 수 있음).

## 2단계. 화면을 GitHub Pages에 올리기 (10분)

1. GitHub에서 새 저장소 `shutter-price` 만들기 (Public)
2. `site/index.html` 을 저장소 **맨 위(root)** 에 업로드
3. 저장소 Settings → Pages → Branch: `main`, 폴더 `/ (root)` → Save
4. 1~2분 뒤 주소 확인: `https://내아이디.github.io/shutter-price/`

## 3단계. Worker 설정 고치기 (5분)

`worker/wrangler.toml` 에서 두 줄 바꾸기:

```toml
ALLOWED_ORIGINS = "https://내아이디.github.io"   # 뒤에 /shutter-price 붙이지 않음
CONTACT = "내이메일@gmail.com"
```

## 4단계. Worker 배포 (15분)

터미널에서 `worker` 폴더로 이동 후 순서대로:

```bash
npx wrangler login                          # 브라우저가 열리면 Cloudflare 로그인 후 허용
npx wrangler kv namespace create CACHE      # 나온 id 를 wrangler.toml 의 PUT-KV-ID-HERE 자리에 붙여넣기

npx wrangler secret put ACCESS_KEY          # 개인 키: 아무도 모를 긴 문자열 직접 만들어 입력
npx wrangler secret put NAVER_ID
npx wrangler secret put NAVER_SECRET
npx wrangler secret put EBAY_ID
npx wrangler secret put EBAY_SECRET
npx wrangler secret put FLICKR_KEY          # 선택

npx wrangler deploy                          # 끝나면 https://shutter-price.○○.workers.dev 주소가 나옴
```

## 5단계. 연결 확인 (5분)

1. 브라우저 주소창에 `https://shutter-price.○○.workers.dev/api/health` → `{"ok":true, ...}` 가 보이면 성공
2. GitHub Pages 사이트 열기 → 오른쪽 위 **자동 수집 꺼짐** 누르기
3. Worker 주소와 개인 키(ACCESS_KEY와 같은 값) 입력 → **저장하고 연결 확인**
4. 네이버·eBay·개인용 수집·저장소가 "켜짐"으로 나오면 완료

## 6단계. 사이트별 동작 점검

시세 탭의 **수집 상태** 칩에서 사이트마다 건수가 나와요. 칩에 마우스를 올리면 실패 이유가 보여요.

| 사이트 | 방식 | 실패하면 |
|---|---|---|
| 네이버쇼핑, eBay | 공식 API | 키 오타, eBay Production 키 활성화 여부 확인 |
| 번개장터, 중고나라, 당근(서울), 야후옥션 | 개인용 수집 | 사이트 구조가 바뀐 것. 실패 메시지를 Claude에게 보내면 수정 |
| 후르츠패밀리 | 개인용 수집 (실험) | 앱 중심 사이트라 0건일 수 있음 |
| N플리마켓, 메루카리, 쿠팡, 커뮤니티 장터 | 바로가기 링크 | 공개 검색 경로가 없어 수집하지 않음 |

## 알아둘 것

- 개인용 수집은 **개인 키가 있을 때만** 동작하고, 결과를 6시간 저장해서 같은 검색을 반복하지 않아요. 사이트를 다른 사람과 공유해도 키를 모르면 공식 API 결과만 보여요.
- 무료 한도: Worker 하루 10만 요청, KV 저장 하루 1,000회. 혼자 쓰기엔 충분해요.
- 다음 단계 후보: 기록을 Firebase Firestore에 저장해 폰·PC 동기화, 관심 기종을 매일 새벽 자동 수집(Cron)해 시세 추이 그래프 만들기.
