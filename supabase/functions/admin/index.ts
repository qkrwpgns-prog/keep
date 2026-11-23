// 운영자 화면: 신고 목록·처리(ADMIN_EMAILS에 든 로그인 이메일만)
import { adminList, handleAdmin, type AdminDb } from '../_shared/adminActions.ts';
import { adminClient, context, cors, errorResponse, json, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'METHOD' }, 405);
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    const body = await req.json().catch(() => ({}));
    const base = supabaseDb(admin);
    const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    };
    const db: AdminDb = {
      ...base,
      funnelStats: (days) => rpc('keep_funnel_stats', { p_days: days }),
      adminReports: (status) => rpc('keep_admin_reports', { p_status: status }),
      adminHandle: (id, adminId, status, note, block, days) =>
        rpc('keep_admin_handle', { p_report: id, p_admin: adminId, p_status: status, p_note: note, p_block: block, p_suspend_days: days }),
    };
    return json(req, await handleAdmin(db, ctx, adminList(Deno.env.get('ADMIN_EMAILS')), body));
  } catch (e) {
    return errorResponse(req, e);
  }
});
