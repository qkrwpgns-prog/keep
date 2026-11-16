// 약속 상태 변경·서명·조회의 유일한 쓰기 경로
import { handleAction } from '../_shared/actions.ts';
import { adminClient, context, cors, errorResponse, json, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'METHOD' }, 405);
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    const body = await req.json().catch(() => ({}));
    const out = await handleAction(supabaseDb(admin), ctx, body);
    return json(req, out);
  } catch (e) {
    return errorResponse(req, e);
  }
});
