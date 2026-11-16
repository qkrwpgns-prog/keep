// 계정: 탈퇴 (정책 (가): 서명 미완료 약속은 삭제, 양측 서명 완료 증서는 상대의 증거로 보존하고 식별정보 최소화)
import { adminClient, context, cors, errorResponse, json } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    if (!ctx.userId) return json(req, { error: 'LOGIN', message: '로그인이 필요해요.' }, 401);
    const body = await req.json().catch(() => ({}));
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
