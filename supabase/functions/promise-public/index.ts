// 로그인 전 상대방(B)이 공유 코드로 증서 미리보기 (이름 가림, 진행 기록 없음) · B 진입 퍼널 단계 기록
import { publicPreview } from '../_shared/actions.ts';
import { adminClient, context, cors, errorResponse, json, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    const body = req.method === 'GET' ? Object.fromEntries(new URL(req.url).searchParams) : await req.json().catch(() => ({}));
    return json(req, await publicPreview(supabaseDb(admin), ctx, String(body.code || ''), body.step));
  } catch (e) {
    return errorResponse(req, e);
  }
});
