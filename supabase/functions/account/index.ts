// 계정: 알림 이메일 변경(인증 코드) · 탈퇴
//  탈퇴 정책 (가): 서명 미완료 약속은 삭제, 양측 서명 완료 증서는 상대의 증거로 보존하고 식별정보 최소화
import { handleAccount, type AccountDb } from '../_shared/accountActions.ts';
import { adminClient, context, cors, errorResponse, json } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    if (!ctx.userId) return json(req, { error: 'LOGIN', message: '로그인이 필요해요.' }, 401);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'ip_check') {
      // 진단: 서버가 받은 IP 관련 헤더와 고른 값(본인 요청의 값만 보여 줌). 가짜 헤더를 넣어 위조되는지 확인할 때 쓴다
      const pick = (k: string) => req.headers.get(k);
      return json(req, { ip: ctx.ip, source: ctx.ipSource, headers: { 'cf-connecting-ip': pick('cf-connecting-ip'), 'x-real-ip': pick('x-real-ip'), 'x-forwarded-for': pick('x-forwarded-for') } });
    }
    if (body.action === 'email_request' || body.action === 'email_verify') {
      const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
        const { data, error } = await admin.rpc(fn, args);
        if (error) throw new Error(error.message);
        return data as T;
      };
      const db: AccountDb = {
        rateCheck: (key, limit, windowSec) => rpc<boolean>('keep_rate_check', { p_key: key, p_limit: limit, p_window_sec: windowSec }),
        loginEmail: async (uid) => (await admin.auth.admin.getUserById(uid)).data.user?.email ?? null,
        emailSetPending: async (uid, email, hash) => { await rpc('keep_email_set_pending', { p_user: uid, p_email: email, p_code_hash: hash }); },
        emailSetDirect: async (uid, email) => { await rpc('keep_email_set_direct', { p_user: uid, p_email: email }); },
        emailVerify: (uid, hash) => rpc('keep_email_verify', { p_user: uid, p_code_hash: hash }),
      };
      return json(req, await handleAccount(db, ctx, body));
    }

    if (body.action !== 'delete' || body.confirm !== '탈퇴') return json(req, { error: 'CONFIRM', message: "확인 문구 '탈퇴'를 입력해 주세요." }, 400);
    const { data, error } = await admin.rpc('keep_delete_account', { p_user: ctx.userId });
    if (error) throw new Error(error.message);
    const deleted = (data?.deleted || []) as { id: string; paths: string[] }[];
    const paths = deleted.flatMap((d) => d.paths || []);
    if (paths.length) await admin.storage.from('signatures').remove(paths);
    const { error: delErr } = await admin.auth.admin.deleteUser(ctx.userId);
    if (delErr) throw new Error(delErr.message);
    return json(req, { ok: true, deleted: deleted.length, kept: data?.kept ?? 0 });
  } catch (e) {
    return errorResponse(req, e);
  }
});
