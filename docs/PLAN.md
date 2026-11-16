# 키프(Keep) 고도화 계획 — 0단계

> 작성 기준: `legacy/index.html`(1,139줄, 원본 `ulsang4-dev/keep@180c669`)을 전부 읽고 정리했습니다.
> 이 문서는 계획이며, 확인을 받은 뒤 1단계부터 구현합니다.

---

## 1. 현재 버전 기능 목록

| 영역 | 기능 | 비고 |
|---|---|---|
| 홈 | 히어로 문구, 통계 3칸(진행 중·서명 대기·지킴 완료), 약속 목록(D-day, 상태·단계 배지), 링크 붙여넣기, 백업 저장·불러오기(JSON) | |
| 새 약속 1단계 | 템플릿 5종 선택, 내 이름, 입력 방식(대화 붙여넣기·직접 입력), 예시 대화 넣기 | |
| 새 약속 2단계 | 규칙 기반 추출 결과 확인·수정, 근거 인용(quote), "확인이 필요해요" 질문(최대 4개), 빈칸 점검 | |
| 새 약속 3단계 | 증서 미리보기, 휴대폰 번호(끝 4자리만 저장), 캔버스 서명, 확인 체크 → A 서명 | |
| 서명 요청 | `#s=` 압축 링크 + QR(너무 촘촘함), 카톡 공유(navigator.share)·복사 | |
| B 화면 | 증서 확인 → 서명(번호·서명·체크) 또는 수정 요청 | 서명 거절 없음 |
| 수정 요청 | B 사유 → A가 내용 고쳐 재서명 | |
| 확정 | SHA-256 확인코드(`canonical()` v2), 인장 '키프 확인', 검증 QR(`KEEP|id|hash`) | |
| 진행 | D-day 큰 숫자, 5단계 트랙, 시연용 시간 되감기 칩(실제/D-3/D-day/D+3/D+7/D+14), A/B 화면 전환 | |
| A 패널 | 이행 신고 확인/거절, 연장·분할 요청 수락/거절, 재촉(관계 6종·어조 1~5·3안·편집·단계당 1회), D+14 촉구서 초안 편집·발송, 직접 완료 처리 | |
| B 패널 | 받은 알림함(D-3, D-day, 재촉), 이행 신고(금액 일치 검사), 연장 요청(날짜)·분할 요청(2~4회, 7/14/30일 간격) | |
| 변경 이력 | 수락 시 `amendments`에 기록, 증서에 '변경 이력' 표시, 해시 재발급, 재촉 단계 초기화 | |
| 완료 | 완료 카드(1080×1080 캔버스, PNG 저장), 일찍/당일/늦게 지킴 문구 | |
| 위변조 확인 | 증서 HTML 업로드 → 내장 JSON 해시 재계산 + 화면 글자(`data-f`)와 비교, 기기 저장본 검사 | |
| 파일 | 증서 HTML, 증거 묶음 HTML(타임라인 포함), 촉구서 TXT | |
| 타임라인 | 이벤트(시각·시연 시각·행위자·상세) 역순 표시 | |
| 공통 | 하단 고지, 토스트, 카톡 인앱 안내(orphan 화면) | |

## 2. 옮길 함수 목록 (→ 새 위치)

순수 함수는 **프론트와 Edge Function이 같은 코드를 쓰도록** `supabase/functions/_shared/domain/`에 두고 Vite에서 별칭(`@domain`)으로 가져옵니다.

| 기존 | 새 위치 | 변경점 |
|---|---|---|
| `TPL`, `STAGES`, `STATUS`, `TONES`, `EXAMPLE_CHAT` | `domain/templates.ts`, `domain/stages.ts` | 상태에 `draft`, `cancelled`, `declined` 추가 |
| `pad2`, `ymd`, `parseYmd`, `addDays`, `diffDays`, `isYmd`, `korDate`, `shortDate`, `stamp`, `ddayLabel`, `stageOf` | `domain/dates.ts` | **KST 고정**(서버는 UTC라서 `Asia/Seoul` 기준 오늘 계산 함수 추가), `todayFor`는 시연 오프셋 인자로 |
| `won`, `hangulAmount`, `hasJong`, `pp`, `callName`, `subjectText`, `clip` | `domain/korean.ts` | 그대로 + 단위 테스트 |
| `sha256`, `canonical`, `shortCode` | `domain/hash.ts`, `domain/canonical.ts` | canonical **v3**: 서명은 획 벡터 대신 서명 파일 SHA-256, 이자율 등 새 필드 포함. v2 검증 함수는 가져오기·옛 증서 검사용으로 유지 |
| `rdp`, `padVector`, `sigImg`, `mountPad` | `domain/signature.ts` + `components/SignaturePad.tsx` | 서명은 벡터(JSON) + PNG 둘 다 Storage 저장 |
| `certBody`, `sigBox`, `certHTML` | `components/Certificate.tsx` + `domain/certificate.ts`(필드 문자열 생성) | `data-f` 속성 유지(위변조 검사용), 서명 메타는 시각·확인코드 위주(IP·UA는 증거 묶음에만) |
| `parseAmount`, `parseDate`, `ruleExtract`, `ruleCheck` | `domain/rules.ts` | `parseDate(text, now)`로 기준 시각 주입(KST), AI 실패 시 대체 경로 |
| `nudgeBank`, `noticeText` | `domain/nudge-bank.ts`, `domain/notice.ts` | AI 대체 경로 + 금지어 검사 대상 |
| `applyAction`, `OUT_TITLE`, `outMessage`, `act` | `supabase/functions/promise-action/` (서버 상태 기계) | 링크로 상태를 주고받던 방식 → **서버 기록 + 알림**으로 대체 |
| `splitPlan` | `domain/installments.ts` | |
| `pack`/`unpack`, `b64u`, `handleIncoming` | `legacy-import/` | 옛 `#s=`/`#u=` 링크·localStorage를 읽어 가져오기에만 사용 |
| `exportHTML`, 위변조 파일 검사 로직 | `features/verify/` | 옛 증서 파일(v2)과 새 증서 파일(v3) 모두 검사 |
| `drawCard`, `roundRect` | `features/done/DoneCard.tsx` | |
| `copyText`, `shareText`, `saveFile`, `devInfo`, `toast` | `lib/share.ts`, `lib/file.ts`, `components/Toast.tsx` | |
| `qrSVG` (qrcode-generator) | `lib/qr.ts` (npm `qrcode-generator`, MIT) | QR엔 짧은 주소만 → 버전 2~3 수준으로 성기게 |

## 3. 폴더 구조

```
keep/
├─ legacy/                    # 기존 버전 그대로 보존 (배포 시 /keep/legacy/ 로도 열림)
├─ docs/PLAN.md
├─ index.html                 # Vite 진입점
├─ public/                    # manifest.webmanifest, 아이콘, 404.html(안전망)
├─ src/
│  ├─ main.tsx, App.tsx, router.tsx        # 해시 라우터 (#/, #/new, #/p/:code, #/verify, #/settings)
│  ├─ styles/tokens.css                    # 기존 :root 토큰·클래스 그대로 이식
│  ├─ lib/ (supabase.ts, api.ts, push.ts, share.ts, qr.ts, ics.ts, file.ts)
│  ├─ components/ (Certificate, SignaturePad, Timeline, StageTrack, BottomNav, Toast, AiBadge, Disclaimer …)
│  ├─ features/ (home, new-promise, detail, sign, nudge, notice, request, report, verify, settings, demo, legacy-import, auth)
│  └─ sw.ts                                # 서비스 워커(오프라인 셸 + push 수신)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/ (0001_schema.sql, 0002_rls.sql, 0003_functions.sql, 0004_cron.sql …)
│  ├─ functions/
│  │  ├─ _shared/ (domain/, cors.ts, auth.ts, events.ts, notify.ts, ai.ts, schemas.ts, banned-words.ts)
│  │  ├─ promise-public/  promise-action/  ai/  cron-daily/  notify-flush/  account/
│  └─ tests/ (rls.test.sql — pgTAP)
├─ tests/ (Vitest 단위 + 두 계정 통합 테스트)
├─ .github/workflows/ (ci.yml, deploy.yml)
├─ .env.example, .gitignore, README.md
```

## 4. 마이그레이션 (요청 스키마 + 제안 추가분)

요청하신 7개 테이블은 그대로 만들고, 요구사항을 지키려면 아래가 더 필요해서 **추가를 제안**합니다(★).

| 테이블 | 내용 |
|---|---|
| profiles | 요청대로 + ★`deleted_at` |
| promises | 요청대로 + ★`late_interest_rate`, ★`is_demo`(시연 데이터 분리), ★`demo_offset_days`, ★`deadline_version`(연장 수락마다 +1, 재촉 회차 구분), ★`canonical_version`. CHECK: `interest_rate <= 20`, `late_interest_rate <= 20` |
| parties | 요청대로 (`signature_path`는 비공개 버킷) + ★`signature_sha256`, ★`consent_version` |
| events | 요청대로. INSERT만(UPDATE·DELETE 트리거로 차단, 서비스 롤도 막음). ★`server_at`(=created_at)·★`sim_at`(시연 시각) |
| requests / payments / push_subscriptions | 요청대로 (payments에 ★`installment_no`) |
| ★nudges | `(promise_id, deadline_version, stage)` UNIQUE, `status[suggested→approved→sent]`, `message`, `ai_used` → **"단계당 1회"를 DB가 보장** |
| ★notifications | 발송 큐: `user_id, channel[push|email], send_after, sent_at, error` → 야간(21~09시 KST) 요청은 09:00로 미룸 |
| ★ai_usage | `user_id, day, count` → 하루 30회 제한 |
| ★abuse_reports | B의 약속별 신고 |
| ★notification_prefs | 약속별 알림 끄기(B) |

**해시 체인**: `append_event()` SQL 함수(SECURITY DEFINER, 약속별 advisory lock)가 직전 hash를 읽어 `prev_hash`를 채우고, Edge Function이 계산한 `hash = sha256(prev_hash + JCS(payload) + created_at)`가 맞는지 검증 후 INSERT. JCS(RFC 8785)를 쓰면 브라우저·PDF 검증에서도 같은 값이 나옵니다.

**RLS 요약**
- `promises / parties / events / requests / payments / nudges`: `exists(parties where promise_id = … and user_id = auth.uid())`일 때만 SELECT.
- INSERT/UPDATE/DELETE 정책은 **두지 않음** → 클라이언트는 쓰기 불가. 모든 쓰기는 Edge Function(service role)에서.
- `profiles / push_subscriptions / notification_prefs`: 본인 행만 읽기·쓰기.
- Storage `signatures`, `evidence` 버킷: 비공개, 경로 `promise_id/…`에 당사자만 읽기(서명 URL).
- B의 `parties.user_id` 연결은 `promise-action`의 `claim` 동작에서만.

## 5. Edge Function 목록 (무료 한도와 관리 편의를 위해 6개로 묶음)

| 함수 | 역할 |
|---|---|
| `promise-public` | 로그인 없이 share_code로 **증서 미리보기**(이름 일부 가림, 이벤트 없음). IP별 속도 제한(코드 무작위 대입 방지) |
| `promise-action` | 상태 기계 하나: `create`(A 서명 포함) · `claim`(B 연결+동의) · `sign` · `revise` · `decline` · `cancel` · `request` · `answer` · `report` · `confirm` · `reject` · `nudge_approve` · `notice_send`. 서명 시 IP·UA·시각 기록, 이벤트 추가, `current_hash` 갱신, 알림 큐 적재 |
| `ai` | `extract`(텍스트·이미지) · `nudge` · `proof`(이미지) · `notice`(스트리밍). JSON 스키마 검증, 금지어 검사, 일일 한도, 실패 시 `{fallback:true}` 반환 → 프론트가 규칙·템플릿 사용 |
| `cron-daily` | pg_cron 매일 00:00 UTC(=09:00 KST). D-3·D-day → B 알림, D+3·D+7·D+14 → A "재촉할 때예요". 시연 모드는 `as_of` 인자(시연 약속만 대상) |
| `notify-flush` | 15분마다 `notifications` 큐에서 `send_after` 지난 것 발송(Web Push + 이메일). 야간 차단 |
| `account` | 내보내기, 탈퇴(정책 결정 후), 기존 localStorage 데이터 가져오기 |

## 6. AI 설계 (Claude API, Edge Function에서만)

| 용도 | 모델(환경 변수) | 형식 |
|---|---|---|
| extract, nudge, proof | `AI_MODEL_FAST` = `claude-haiku-5-5` (입력 $0.10 / 출력 $0.50 per 1M) | 구조화 출력(`output_config.format` JSON 스키마) + 서버에서 zod로 재검증 |
| notice | `AI_MODEL_SMART` = `claude-opus-5-5` (입력 $4 / 출력 $20 per 1M) | 스트리밍 평문 |

- 1회 비용 추정: 추출 ≈ $0.0004, 재촉 ≈ $0.0003, 송금 캡처 판독 ≈ $0.0005, 촉구서 ≈ $0.04. 하루 30회 제한이면 사용자당 최악 하루 약 $1, 일반적으로 월 몇 센트 수준.
- 공식 SDK `npm:@anthropic-ai/sdk`를 Deno에서 사용. 키는 `supabase secrets`에만.
- 재촉 금지어 목록(욕설·협박·"고소/경찰/신상공개" 등 과장된 법적 위협) 후처리 → 걸리면 해당 안을 템플릿으로 교체.

## 7. 환경 변수

**프론트(.env, 공개돼도 되는 값만)**
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=         # anon(publishable) 키. service_role 키는 절대 넣지 않음
VITE_VAPID_PUBLIC_KEY=
VITE_PUBLIC_BASE_URL=https://<계정>.github.io/keep/
```
**Supabase secrets(서버 전용)**
```
ANTHROPIC_API_KEY=  AI_MODEL_FAST=claude-haiku-5-5  AI_MODEL_SMART=claude-opus-5-5  AI_DAILY_LIMIT=30
VAPID_PUBLIC_KEY=  VAPID_PRIVATE_KEY=  VAPID_SUBJECT=mailto:<연락용 주소>
RESEND_API_KEY=  EMAIL_FROM="키프 <noreply@도메인>"
APP_BASE_URL=  CRON_SECRET=
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Edge Function에 자동 주입
```
**GitHub Actions secrets**: `VITE_*` 4개, (선택) `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` — 마이그레이션·함수 자동 배포용.

## 8. 직접 만들어 주셔야 하는 것 (클릭 경로)

> 콘솔 메뉴 이름은 개편으로 조금 다를 수 있습니다. 막히면 화면 캡처를 보내 주세요.

### ① Supabase (무료)
1. supabase.com → **Start your project** → GitHub로 로그인 → **New project**
2. 이름 `keep`, Region **Northeast Asia (Seoul)**, DB 비밀번호 생성 후 따로 보관 → Create
3. **Project Settings → API**: `Project URL`, `anon public` 키 복사 → 저에게는 이 둘만 알려 주세요(공개 가능한 값).
4. **Authentication → URL Configuration**: Site URL = `https://<계정>.github.io/keep/`, Redirect URLs에 같은 주소와 `http://localhost:5173/keep/` 추가
5. **Authentication → Providers → Email**: 켜기 (매직링크 + 6자리 코드)
6. **Database → Extensions**: `pg_cron`, `pg_net` 켜기
7. **Account(우상단) → Access Tokens → Generate new token** → GitHub Secrets에 `SUPABASE_ACCESS_TOKEN`으로 저장(자동 배포 원할 때)
8. 주의: 무료 프로젝트는 **7일간 요청이 없으면 일시정지**됩니다. 시연 전날 대시보드에서 Restore 확인 필요.

### ② 카카오 디벨로퍼스 (무료)
1. developers.kakao.com → 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름 "키프")
2. **앱 키**에서 **REST API 키** 복사
3. **카카오 로그인 → 활성화 설정 ON**, **Redirect URI** = `https://<프로젝트ref>.supabase.co/auth/v1/callback`
4. **카카오 로그인 → 보안 → Client Secret** 코드 생성 → 활성화 상태 **사용함**
5. **카카오 로그인 → 동의항목**: 닉네임(필수). 이메일(`account_email`)은 **비즈 앱 전환**이 필요(개인 개발자도 본인 인증으로 전환 가능, 사업자 등록 불필요한 경로가 있음) → 아래 질문 ③ 참고
6. **앱 설정 → 플랫폼 → Web**: `https://<계정>.github.io` 등록
7. Supabase **Authentication → Providers → Kakao**: Client ID = REST API 키, Secret = Client Secret → Save

### ③ Anthropic API 키 (유일한 유료)
1. platform.claude.com → **Settings → Billing**: 크레딧 충전(최소 금액부터)
2. **Settings → Limits**: 월 지출 한도를 낮게(예: $5) 설정 권장
3. **Settings → API Keys → Create Key** → 채팅에 붙여넣지 말고 직접 터미널에서:
   `npx supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>`

### ④ VAPID 키 (무료, 로컬에서 생성)
`npx web-push generate-vapid-keys` → 공개키는 `VITE_VAPID_PUBLIC_KEY`·`VAPID_PUBLIC_KEY`, 비밀키는 Supabase secrets에만.

### ⑤ Resend (무료: 월 3,000통·일 100통)
1. resend.com 가입 → **API Keys → Create API Key** (Sending access)
2. **Domains → Add Domain** → 안내된 DNS 레코드(SPF·DKIM)를 도메인 관리 화면에 추가 → Verify
3. Supabase **Authentication → Emails → SMTP Settings**에 Resend SMTP(host `smtp.resend.com`, port 465, user `resend`, pass = API 키) 입력 → 로그인 메일도 Resend로 발송
4. ⚠️ **도메인 없이는 내 계정 이메일로만 발송**됩니다 → 아래 질문 ②

### ⑥ GitHub
**Settings → Pages → Source: GitHub Actions**, **Settings → Secrets and variables → Actions**에 위 값 등록.

## 9. 단계별 브랜치·검증 계획

| 단계 | 브랜치 | 검증 |
|---|---|---|
| 1 | `stage-1-cloud` | Vitest(도메인 함수: 금액 한글·조사·날짜·canonical 호환), pgTAP RLS 테스트(로컬 Supabase, Docker 사용 가능 확인됨), 두 계정 통합 테스트, Playwright 375px·카톡 UA 스크린샷 |
| 2 | `stage-2-notify` | 시연 날짜별 cron 실행 → notifications 큐 검증, 같은 단계 재발송 UNIQUE 위반 테스트, 야간 지연 테스트 |
| 3 | `stage-3-ai` | 예시 대화 5종 추출 스냅샷, 스키마 실패·한도 초과·키 없음 → 규칙 대체 테스트 |
| 4 | `stage-4-demo` | 시연 데이터가 일반 목록에 안 보이는지, 이벤트에 server_at·sim_at 둘 다 |
| 5 | `stage-5-ledger` | 분할 회차 알림, 정산 일괄 생성, PDF 한글(Noto Sans KR/나눔명조 서브셋 임베드), .ics |

※ 이 세션에서 제가 push할 수 있는 브랜치는 `claude/funny-darwin-cj7o3n` 하나뿐이라, 단계별 브랜치는 그 위에서 만들고 push 권한은 단계마다 확인받겠습니다.

## 10. 설계상 판단 (미리 공유)

- **이메일 로그인은 6자리 코드 입력을 기본**으로: 카톡 인앱 브라우저에서 메일 앱의 매직링크를 누르면 다른 브라우저가 열려 로그인이 이어지지 않습니다(PKCE). 코드 입력은 같은 창에서 끝납니다.
- **OAuth 콜백과 해시 라우터 충돌**: PKCE 방식(`?code=`가 쿼리로 옴)을 써서 `#/p/코드` 해시와 겹치지 않게 합니다.
- **B 미리보기 범위**: 로그인 전엔 증서 본문만, 이름은 "김*수"처럼 가림. 동의·로그인 뒤 전체 공개.
- **서명 거절** 상태(`declined`)를 추가합니다(기존엔 없음).
- **iOS 푸시**는 홈 화면 설치 후에만 → 설치 안내 화면 + 이메일 병행.
- **이자 가드레일**: 연 20% 초과 입력 불가(프론트·DB CHECK 이중), 원금 10만 원 미만은 상한 미적용 안내, 같은 사용자가 이자 있는 차용증을 일정 횟수(예: 최근 90일 3건) 넘게 만들면 대부업 등록 관련 안내.
- **개인정보**: 휴대폰 번호는 더 이상 받지 않음(로그인으로 본인 확인 대체). 계좌번호는 화면에서 `123-***-**89`로 가림.

## 11. 탈퇴 시 데이터 정책 (제안 — 결정 필요)

| 데이터 | 처리 |
|---|---|
| 상대가 없는 초안·서명 전 약속, 혼자만 있는 데이터 | 즉시 삭제 |
| 상대 서명 전 대기 중 약속 | 취소 이벤트 기록 후 삭제, 상대에게 "취소됨" 알림 |
| **양측 서명 완료 증서** | 상대의 증거로 **보존**. 탈퇴자 쪽은 `user_id`를 NULL로, 이메일·푸시 구독·프로필 삭제. 증서상 **표시 이름과 서명 이미지, 서명 시각, 확인코드는 유지**(지우면 증서가 무의미해짐). IP는 앞 두 자리만 남기고 마스킹, UA는 "iOS · Safari" 수준으로 축약 |
| 보존 기간 | 선택 필요: (가) 완료 약속은 완료 후 1년, 미완료는 기한 후 10년(개인 간 금전 채권의 일반 소멸시효가 10년이라 상대의 증거 보존 기간과 맞춤) / (나) 일괄 5년. 기본안은 (가) |
| 고지 | 가입 시 동의서와 탈퇴 화면에 위 내용을 명시 |
