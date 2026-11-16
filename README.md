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
| `supabase/functions/*/index.ts` | Edge Function: `promise-action`(유일한 쓰기 경로), `promise-public`(로그인 전 미리보기), `account`(탈퇴) |
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
| `ANTHROPIC_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_SMART`, `AI_DAILY_LIMIT` | 3 | AI |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SMTP_*` | 2 | 알림 |

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

## 이전 버전 데이터 옮기기
주소가 `ulsang4-dev.github.io` → `qkrwpgns-prog.github.io`로 바뀌어 예전 브라우저 저장소는 자동으로 넘어오지 않습니다.
1. 예전 주소에서 홈 아래 **백업 저장** → JSON 파일 저장
2. 새 키프에 로그인 → **설정 → 이전 버전 약속 가져오기**에서 파일 선택
   - 양쪽 서명이 있던 증서는 기존 확인코드를 다시 계산해 일치하면 '확인코드 일치'로 표시됩니다.
   - 가져온 약속은 내 계정에만 연결되고, 상대는 약속 화면의 공유 링크로 들어와 연결할 수 있습니다.

## 시연 방법
4단계에서 설정의 '시연 모드'(시간 되감기, A/B 전환, cron 즉시 실행)가 추가됩니다. 1단계에서는 서로 다른 이메일 두 개로 확인하세요.
1. 계정 A: 새 약속 → 예시 넣기 → 서명 → QR/링크
2. 계정 B(다른 브라우저나 카톡 인앱): 링크 열기 → 증서 확인 → 개인정보 동의 → 로그인 → 서명
3. A 화면이 자동으로 '진행 중'으로 바뀌고 같은 확인코드가 보입니다.
4. B: 이행 완료 신고 → A: 받았어요 → 완료 카드
