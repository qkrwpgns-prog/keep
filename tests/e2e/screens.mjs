// 375px · 카카오톡 인앱 UA로 주요 화면을 캡처한다. Supabase 응답은 page.route로 흉내 낸다.
// 사용: npm run build && npx vite preview --port 4173 & node tests/e2e/screens.mjs <출력폴더>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
const OUT = process.argv[2] || 'screens';
const BASE = 'http://localhost:4173/keep/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const ymd = (d) => new Date(Date.now() + 9 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

const promise = (over) => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001', share_code: 'K7MX2QPA', template: 'loan', title: '민수 월세 30만원', amount: 300000,
  interest_rate: null, late_interest_rate: null, repay_account: '국민 123-456-789012', item: null, task: null, deadline: ymd(-4), method: '계좌이체',
  penalty: '늦으면 밥 한 번 사기', memo: null, installments: [], amendments: [], status: 'active', revise_note: null, current_hash: 'a3f19c0e5b7d2e8841c6f0aa9d3e2b17c55e0f9a8b7c6d5e4f3a2b1c0d9e8f7a',
  canonical_version: 3, legacy_doc: null, deadline_version: 1, version: 3, is_demo: false, created_by: A, created_at: now, updated_at: now,
  parties: [
    { promise_id: 'x', role: 'A', user_id: A, display_name: '박제훈', signature_sha256: 'ab12cd34ef', signed_at: now, consent_at: now },
    { promise_id: 'x', role: 'B', user_id: B, display_name: '김민수', signature_sha256: 'cd34ef56ab', signed_at: now, consent_at: now },
  ], ...over,
});
const SIG = { v: 1, w: 200, h: 60, strokes: [[20, 40, 40, 15, 60, 45, 80, 18, 100, 42, 130, 20, 160, 35]] };

async function shot(page, name) {
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) console.warn('가로 넘침:', name);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('📸', name);
}

async function ctxFor(browser, user, rows) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 }, userAgent: UA, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  if (user) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const tok = 'h.' + Buffer.from(JSON.stringify({ sub: user, exp, role: 'authenticated' })).toString('base64url') + '.s';
    await ctx.addInitScript(([u, t, e]) => localStorage.setItem('keep.auth', JSON.stringify({ access_token: t, refresh_token: 'r', expires_at: e, expires_in: 3600, token_type: 'bearer', user: { id: u, aud: 'authenticated', email: 'x@example.com', app_metadata: {}, user_metadata: {}, created_at: '' } })), [user, tok, exp]);
  }
  await ctx.route('**/rest/v1/**', (route) => {
    const u = route.request().url();
    const one = route.request().headers()['accept']?.includes('vnd.pgrst.object');
    let body = [];
    if (u.includes('/profiles')) body = [{ id: user, display_name: '박제훈', notify_email: null, notify_push: true }];
    else if (u.includes('/promises')) body = rows;
    else if (u.includes('/events')) body = rows[0]?._events || [];
    else body = [];
    route.fulfill({ json: one ? body[0] ?? null : body });
  });
  await ctx.route('**/functions/v1/promise-action', (route) => route.fulfill({ json: { A: SIG, B: SIG } }));
  await ctx.route('**/functions/v1/promise-public', (route) => route.fulfill({ json: {
    code: 'K7MX2QPA', tpl: 'loan', title: '민수 월세 30만원', status: 'pending_b', aName: '박*훈', bName: '김*수', amount: 300000, interestRate: null, lateInterestRate: null,
    item: '', task: '', deadline: ymd(25), method: '계좌이체', penalty: '늦으면 밥 한 번 사기', hasAccount: true, hasMemo: false, signedA: true, signedB: false, bLinked: false, createdAt: now } }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.continue());
  return ctx;
}

const browser = await chromium.launch();
{ // 로그인 전
  const ctx = await ctxFor(browser, null, []);
  const p = await ctx.newPage();
  await p.goto(BASE); await shot(p, '01-홈-로그인전');
  await p.goto(BASE + '#/new'); await p.getByText('예시 넣기').click(); await p.getByText('증서 초안 만들기').click(); await shot(p, '02-새약속-2단계');
  await p.getByText('서명하러 가기').click(); await shot(p, '03-새약속-3단계');
  await p.getByText('로그인하고 서명하기').click(); await p.mouse.move(0, 0);
  await shot(p, '04-로그인시트');
  await p.goto(BASE + '#/p/K7MX2QPA'); await p.reload(); await shot(p, '05-B-첫진입-미리보기');
  await ctx.close();
}
{ // A: 서명 대기 (QR)
  const pending = promise({ status: 'pending_b', version: 1, current_hash: 'x', parties: [promise().parties[0], { ...promise().parties[1], user_id: null, signed_at: null, signature_sha256: null, consent_at: null }] });
  const ctx = await ctxFor(browser, A, [pending]);
  const p = await ctx.newPage();
  await p.goto(BASE + '#/p/K7MX2QPA'); await shot(p, '06-A-서명요청-QR');
  await ctx.close();
}
{ // B: 진행 중 (D+4)
  const ctx = await ctxFor(browser, B, [promise()]);
  const p = await ctx.newPage();
  await p.goto(BASE + '#/p/K7MX2QPA'); await shot(p, '07-B-진행중');
  await p.goto(BASE + '#/'); await shot(p, '08-홈-B목록');
  await ctx.close();
}
{ // A: 완료
  const done = promise({ status: 'done', _events: [{ id: 1, promise_id: 'x', actor_role: 'A', type: 'done', payload: { early_days: 0 }, canon: '{"early_days":0}', created_at: now, sim_at: null, prev_hash: null, hash: 'h' }] });
  const ctx = await ctxFor(browser, A, [done]);
  const p = await ctx.newPage();
  await p.goto(BASE + '#/p/K7MX2QPA'); await p.waitForTimeout(800); await shot(p, '09-A-완료');
  await ctx.close();
}
await browser.close();
