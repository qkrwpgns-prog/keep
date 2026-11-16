# 키프 Keep

친구·지인과의 약속(돈 빌려주기, 물건 대여, 역할 분담, 경비 정산)을 **약속증서**로 남기고, 기한이 지나면 **단계적으로 재촉**하도록 돕는 모바일 웹앱(PWA)입니다. 멀티모달콘텐츠 수업 MVP를 실제 사용 가능한 수준으로 고도화하는 중입니다.

- 배포 주소: https://qkrwpgns-prog.github.io/keep/
- 이전 버전(이 기기에만 저장): https://qkrwpgns-prog.github.io/keep/legacy/ — 원본은 `legacy/`에 그대로 보존
- 진행 계획: [`docs/PLAN.md`](docs/PLAN.md)

> 키프는 약속의 증거를 남기고 이행을 돕는 도구입니다. 법률 자문이 아니며, 증서는 공증·강제집행력이 있는 문서가 아닙니다.

## 구조

| 위치 | 내용 |
|---|---|
| `src/` | React + TypeScript 프론트엔드 (해시 라우터 `#/p/공유코드`, PWA) |
| `supabase/functions/_shared/domain/` | 증서·금액 한글 표기·조사·날짜(KST)·규칙 기반 추출·확인코드 등 **프론트와 서버가 함께 쓰는** 순수 함수 |
| `supabase/functions/_shared/actions.ts` | 상태 변경(서명·요청·신고·확인 등) 핵심 로직 |
| `supabase/functions/*/index.ts` | Edge Function: `promise-action`(유일한 쓰기 경로), `promise-public`(로그인 전 미리보기), `account`(탈퇴), `cron-daily`(매일 09:00 단계 점검), `notify-flush`(15분마다 알림 큐 발송) |
| `supabase/migrations/` | 스키마·RLS·해시 체인 트리거·서버 전용 함수 |
| `tests/unit` · `tests/db` | 단위 테스트 · 로컬 PostgreSQL로 RLS와 두 계정 흐름 통합 테스트 |
| `legacy/` | 기존 단일 파일 버전 |

### 보안 설계 요약
- 클라이언트는 **읽기만** 합니다(RLS: 약속 당사자만). 상태 변경·서명은 모두 Edge Function → `keep_commit()` 한 트랜잭션.
- `events`는 INSERT만 가능하고, 해시 `sha256(prev_hash + JCS(payload) + created_at)`를 DB 트리거가 계산합니다. 서버 권한으로도 수정·삭제가 막혀 있습니다.
- 상대의 IP·UA·서명 파일 경로는 열 권한으로 가려져 있고, 서명 파일은 비공개 버킷에서 서버만 읽습니다.
- 이자·연체이자는 연 20% 초과 입력을 프론트·서버·DB CHECK에서 3중으로 막습니다.

## 로컬 개발

```bash
npm ci
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

`http://localhost:5173/keep/` 에서 열립니다. 로그인·서명은 Supabase 프로젝트가 설정돼 있어야 동작합니다(아래 준비물).

### 검사

```bash
npm run typecheck && npm run lint && npm test
```

DB·RLS 통합 테스트는 로컬 PostgreSQL 16이 필요합니다(기본 `postgres://postgres:postgres@localhost:5432/postgres`, `TEST_PG_ADMIN_URL`로 변경). 테스트용 DB `keep_test`를 매번 새로 만들고 Supabase 흉내 장치(`supabase/tests/supabase_shim.sql`)와 마이그레이션을 올립니다.

```bash
npm run test:db
```

Edge Function 타입 검사(Deno):

```bash
npm run check:functions
```

## 환경 변수

**프론트 (`.env.local`, 공개 값만)**

| 이름 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | publishable(anon) 키. **service_role 키는 절대 넣지 마세요** |
| `VITE_PUBLIC_BASE_URL` | 공유 링크·QR 기준 주소 `https://qkrwpgns-prog.github.io/keep/` |
| `VITE_VAPID_PUBLIC_KEY` | (2단계) Web Push 공개키 |

**Edge Function (Supabase secrets)** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 자동 주입됩니다.

| 이름 | 단계 | 설명 |
|---|---|---|
| `APP_ORIGINS` | 1 | CORS 허용 출처(쉼표 구분). 기본값 `https://qkrwpgns-prog.github.io,http://localhost:5173,http://localhost:4173` |
| `ANTHROPIC_API_KEY` | 3 | Claude API 키(없으면 AI 없이 규칙·템플릿으로 동작) |
| `AI_MODEL_FAST` · `AI_MODEL_SMART` · `AI_DAILY_LIMIT` | 3 | 선택. 기본값 `claude-haiku-5-5`(추출·재촉·캡처 판독) · `claude-opus-5-5`(촉구서) · `30`(사용자당 하루 호출 수) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 2 | Web Push 키 쌍 |
| `SMTP_USER`, `SMTP_PASS` (`SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT` 선택) | 2 | 알림 메일(Gmail 주소·앱 비밀번호, 465 포트) |
| `APP_BASE_URL` | 2 | 알림 속 링크 기준 주소(기본 `https://qkrwpgns-prog.github.io/keep/`) |

## 준비물 설정 (1단계)

### 1) Supabase 대시보드
1. **Authentication → URL Configuration**
   - Site URL: `https://qkrwpgns-prog.github.io/keep/`
   - Redirect URLs: `https://qkrwpgns-prog.github.io/keep/`, `http://localhost:5173/keep/`
2. **Authentication → Sign In / Providers → Email**: 켜기
3. **Authentication → Emails → Templates → Magic Link**: 본문에 인증 코드가 보이도록 `{{ .Token }}`을 넣어 주세요. 예)
   `<h2>키프 로그인 코드</h2><p>아래 코드를 키프 화면에 입력해 주세요.</p><p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>`
   - 처음 로그인하는 이메일에는 **Confirm signup** 템플릿이 쓰이니 그 템플릿에도 똑같이 `{{ .Token }}`을 넣어 주세요.
   - 코드 길이는 Sign In / Providers → Email → **Email OTP Length**에서 정합니다(키프는 6~10자리 모두 받음).
   (카톡 안에서 메일의 링크를 누르면 다른 브라우저가 열려 로그인이 이어지지 않아서, 키프는 **코드 입력**을 씁니다.)
4. **Authentication → Emails → SMTP Settings** (Gmail SMTP, 무료)
   - 먼저 Google 계정 → 보안 → **2단계 인증** 켜기 → **앱 비밀번호** 만들기(16자리)
   - Host `smtp.gmail.com`, Port `465`, Username = Gmail 주소, Password = 앱 비밀번호, Sender email = 같은 Gmail 주소, Sender name `키프`
   - Gmail은 하루 발송 한도(일반 계정 약 500통)가 있어 시연·소규모 사용에 맞습니다.

### 2) 배포
- GitHub 저장소 **Settings → Pages → Source: GitHub Actions**
- `main`에 병합되면 `.github/workflows/deploy.yml`이 빌드해 Pages에 올립니다.
- Supabase 자동 배포(선택): 저장소 **Settings → Secrets and variables → Actions → Secrets**에
  - `SUPABASE_ACCESS_TOKEN`: supabase.com → 우측 상단 계정 → **Access Tokens** → Generate
  - `SUPABASE_DB_PASSWORD`: 프로젝트 만들 때 정한 DB 비밀번호
  를 넣으면 마이그레이션과 Edge Function도 함께 배포됩니다. 넣지 않으면 아래처럼 수동으로 배포하세요.

```bash
npx supabase@3.1.0 login
```

```bash
npx supabase@3.1.0 link --project-ref gwtpmwzxbxoujckhbttc
```

```bash
npx supabase@3.1.0 db push --remote
```

```bash
npx supabase@3.1.0 functions deploy --use-api
```

## 알림 설정 (2단계)

1. **Edge Function 비밀값**: Supabase → **Edge Functions → Secrets → Add new secret**
   - `SMTP_USER`: 로그인 메일에 쓴 Gmail 주소
   - `SMTP_PASS`: 같은 Gmail의 앱 비밀번호(16자리, 공백 없이)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: 따로 전달한 `vapid-keys.txt`의 값(공개키는 프론트에도 이미 들어 있음)
2. **예약 작업**: `main`에 병합하면 마이그레이션이 pg_cron·pg_net을 켜고 두 작업을 등록합니다. Supabase → **Integrations → Cron**에서 `keep-daily`(매일 00:00 UTC = 09:00 KST), `keep-flush`(15분마다)가 보이면 정상입니다.
3. **휴대폰 알림 받기**: 키프 → 설정 → '이 기기 알림 켜기'. iPhone은 사파리 공유 → 홈 화면에 추가 후 홈 화면 아이콘으로 열어야 켤 수 있고, 카톡 인앱 브라우저에서는 앱 알림이 안 돼서 이메일로 보냅니다.

**규칙**: D-3·D-day는 B에게 자동 알림, D+3·D+7·D+14는 A에게 "재촉할 때예요" 안내만 하고 실제 재촉은 A가 문구를 확인하고 보낼 때만 나갑니다. 같은 단계는 한 번만 보낼 수 있고(DB 고유 제약), 밤 21시~아침 9시(KST)에는 보내지 않고 9시로 미룹니다. B는 약속별로 알림을 끄거나 신고할 수 있습니다. 욕설·협박·과장된 법적 위협 표현은 보내기 전에 막습니다.

## AI (3단계)

Claude API는 Edge Function `ai`에서만 호출하고, 키는 Supabase Secrets(`ANTHROPIC_API_KEY`)에만 둡니다. 화면 코드와 저장소에는 키가 없습니다.

| 기능 | 모델 | 대체 경로(키 없음·한도 초과·응답 검증 실패) |
|---|---|---|
| 대화 글·카톡 캡처 → 증서 초안 | `AI_MODEL_FAST` | 규칙 기반 추출(`ruleExtract`) |
| 재촉 메시지 3안(관계·어조·이전 메시지 반영) | `AI_MODEL_FAST` | 재촉 템플릿(`nudgeBank`) |
| 송금 완료 캡처 판독 → 약속·남은 금액과 비교 | `AI_MODEL_FAST` | 금액·날짜 직접 입력 |
| 이행 촉구서 초안(스트리밍) | `AI_MODEL_SMART` | 촉구서 템플릿(`noticeText`) |

- 모든 응답은 JSON 스키마(구조화 출력)로 받고 서버에서 다시 검사합니다. 원문에 없는 이름·인용은 비우고, 금지어가 있는 재촉 문구는 템플릿으로 바꾸고, 촉구서에는 '법률 자문 아님' 문구를 보장합니다.
- 화면에는 "AI가 채운 내용이에요, 확인해 주세요"를 표시하고, 보내기·완료 처리는 항상 사람이 확인한 뒤에만 됩니다.
- 사용자당 하루 30회(`AI_DAILY_LIMIT`), 한도를 넘으면 Claude를 부르지 않습니다. 대략 비용: 추출·재촉·판독 1회 $0.001 미만, 촉구서 1회 약 $0.04.
- 촉구서는 상위 모델이 거절하면 같은 요청을 대체 모델로 이어 처리하는 서버 측 대체(fallbacks) 설정을 켜 두었습니다.

**설정**: Anthropic Console → API Keys → Create Key → Supabase → Edge Functions → Secrets에 `ANTHROPIC_API_KEY`로 저장. 지출 한도는 Console → Limits에서 낮게 걸어 두세요.

## 상환 장부·여러 명 정산·증거 PDF·캘린더 (5단계)

- **상환 장부**: 돈 약속은 확인된 상환을 건별로 쌓아 남은 금액과 진행률을 보여 줍니다. B의 이행 신고를 A가 확인하거나, A가 '직접 받은 금액 기록'으로 남길 수 있고, 다 받으면 자동으로 완료됩니다. 분할을 수락하면 회차마다 D-3·당일(B), D+3(A) 알림이 갑니다.
- **여러 명 정산**: 새 약속 → 경비 정산 확인서 → '여러 명에게 한 번에'. 총액과 멤버를 넣고 한 번 서명하면 멤버별 확인서와 공유 링크가 만들어지고, '정산 현황' 화면에서 링크·QR을 보내고 진행을 봅니다(10원 단위로 나누고 남는 돈은 내 몫 또는 첫 멤버).
- **증거 묶음 PDF**: 약속 화면 → 약속증서 → '증거 묶음 PDF'. 증서, 서명(획을 벡터로), 서명 메타데이터(시각·IP·기기·동의), 이벤트 해시 체인과 각 해시, 첨부 송금 캡처를 담습니다. 한글 폰트는 나눔명조·나눔고딕에서 파생한 Keep Serif/Sans(SIL OFL, `public/fonts`)를 내장합니다.
- **캘린더**: 진행 중 약속 화면의 '캘린더에 기한 추가'로 .ics 파일을 받습니다(분할이면 남은 회차별, 전날 오전 9시 알림).

## 이전 버전 데이터 옮기기
주소가 `ulsang4-dev.github.io` → `qkrwpgns-prog.github.io`로 바뀌어 예전 브라우저 저장소는 자동으로 넘어오지 않습니다.
1. 예전 주소에서 홈 아래 **백업 저장** → JSON 파일 저장
2. 새 키프에 로그인 → **설정 → 이전 버전 약속 가져오기**에서 파일 선택
   - 양쪽 서명이 있던 증서는 기존 확인코드를 다시 계산해 일치하면 '확인코드 일치'로 표시됩니다.
   - 가져온 약속은 내 계정에만 연결되고, 상대는 약속 화면의 공유 링크로 들어와 연결할 수 있습니다.

## 시연 방법
### 혼자 시연하기 (시연 모드)
1. 로그인 → **설정 → 시연 모드 켜기**
2. 홈의 **시연 약속** 칸에서 예시(돈 빌려주기·물건 대여·조별과제 역할·여행 경비 정산·모호한 대화)를 누르면, A·B 서명까지 끝난 진행 중 약속이 만들어집니다(같은 계정이 두 역할).
3. 약속 화면 위 **시연 도구**에서
   - **시간 되감기**: 실제 / D-3 / D-day / D+3 / D+7 / D+14 — 재촉 단계, 기본 날짜, 서버 판정이 모두 이 날짜를 따릅니다.
   - **화면 전환**: A 작성자 ↔ B 상대방
   - **오전 9시 점검 지금 실행**: 그 날짜에 맞는 알림(D-3·D-day는 B, D+3·D+7·D+14는 A)을 실제 기기·이메일로 보냅니다. 시연 약속은 밤에도 바로 보냅니다.
4. 예: D-3 → 점검 실행(알림 확인) → D+3 → 점검 실행 → A 화면에서 재촉(AI 문구) 보내기 → B 화면에서 받은 알림 확인 → D+14 → 촉구서 AI 초안 → B 화면에서 이행 신고(송금 캡처) → A 화면에서 완료.

시연 약속에는 '시연' 표시가 붙고 일반 목록·통계·전체 크론에서 빠집니다. 증거 기록에는 실제 서버 시각과 시연 날짜가 함께 남습니다.

### 두 계정으로 시연하기
서로 다른 이메일 두 개로 실제 흐름을 보여 줄 수 있습니다.
1. 계정 A: 새 약속 → 예시 → 증서 초안 만들기 → 서명 → QR/링크
2. 계정 B(다른 브라우저나 카톡 인앱): 링크 열기 → 증서 확인 → 개인정보 동의 → 로그인 → 서명
3. A 화면이 자동으로 '진행 중'으로 바뀌고 같은 확인코드가 보입니다.
4. B: 이행 완료 신고 → A: 받았어요 → 완료 카드
