// 로그인 전 상대방(B)이 공유 코드로 증서 미리보기 (이름 가림, 진행 기록 없음)
import { publicPreview } from '../_shared/actions.ts';
import { adminClient, context, cors, errorResponse, json, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    const code = req.method === 'GET' ? new URL(req.url).searchParams.get('code') || '' : String((await req.json().catch(() => ({}))).code || '');
    return json(req, await publicPreview(supabaseDb(admin), ctx, code));
  } catch (e) {
    return errorResponse(req, e);
  }
});
