// 운영자: 신고 목록·처리. 런타임 무관 → 로컬 테스트와 Edge Function이 같은 코드를 쓴다
// 운영자 여부는 로그인 이메일이 ADMIN_EMAILS(쉼표로 구분)에 있는지로 정한다.
import { ActionError, type Ctx } from './actions.ts';
import { enqueue, flush, promiseUrl, type NotifyDb } from './notify.ts';

export interface AdminReport {
  id: string; reason: string; status: 'open' | 'dismissed' | 'actioned'; admin_note: string | null; created_at: string; handled_at: string | null;
  reporter_role: 'A' | 'B' | null;
  promise: { id: string; share_code: string; template: string; title: string; status: string; deadline: string | null; amount: number | null; is_demo: boolean; nudge_blocked: boolean };
  parties: { role: 'A' | 'B'; name: string; user_id: string | null }[];
  nudges: { stage: number; status: string; message: string | null; tone: number | null; sent_at: string | null }[];
  author: { user_id: string; suspended_until: string | null; reports: number } | null;
}
export interface FunnelStats { days: number; created: number; viewed: number; otp: number; login: number; joined: number; signed: number; revise: number; declined: number; median_hours_to_sign: number | null }
export interface HandleResult { promise_id: string; reporter: string | null; author: string | null; blocked: boolean; suspended_until: string | null }

export interface AdminDb extends NotifyDb {
  adminReports(status: string): Promise<AdminReport[]>;
  funnelStats(days: number): Promise<FunnelStats>;
  adminHandle(reportId: string, adminId: string, status: string, note: string, block: boolean | null, suspendDays: number | null): Promise<HandleResult>;
}

const fail = (status: number, code: string, message: string): never => { throw new ActionError(status, code, message); };

export const adminList = (raw: string | undefined) => (raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (ctx: Ctx, admins: string[]) => !!ctx.userId && !!ctx.userEmail && admins.includes(ctx.userEmail.toLowerCase());

const STATUSES = ['open', 'dismissed', 'actioned'];

export async function handleAdmin(db: AdminDb, ctx: Ctx, admins: string[], b: Record<string, unknown>) {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  if (b.action === 'me') return { admin: isAdmin(ctx, admins) };
  if (!isAdmin(ctx, admins)) fail(403, 'NOT_ADMIN', '운영자만 볼 수 있어요.');

  switch (b.action) {
    case 'reports': {
      const st = String(b.status || 'open');
      return { reports: await db.adminReports([...STATUSES, 'all'].includes(st) ? st : 'open') };
    }
    case 'funnel': {
      const days = Math.min(365, Math.max(1, Math.round(Number(b.days) || 30)));
      return { funnel: await db.funnelStats(days) };
    }
    case 'handle': {
      const id = String(b.id || '').slice(0, 40);
      const status = String(b.status || '');
      if (!STATUSES.includes(status)) fail(400, 'STATUS', '처리 상태를 골라 주세요.');
      const note = String(b.note || '').trim().slice(0, 500);
      const block = typeof b.block === 'boolean' ? b.block : null;
      const days = b.suspendDays === null || b.suspendDays === undefined || b.suspendDays === '' ? null : Math.round(Number(b.suspendDays));
      if (days !== null && (!Number.isFinite(days) || days < 0 || days > 365)) fail(400, 'DAYS', '정지 기간은 0~365일로 적어 주세요.');
      if (status === 'actioned' && block !== true && !days) fail(400, 'ACTION', "'조치함'으로 닫으려면 재촉 차단이나 작성자 정지 중 하나를 골라 주세요.");
      const r = await db.adminHandle(id, ctx.userId!, status, note, block, days).catch((e) => {
        if (String(e.message).includes('NOT_FOUND')) fail(404, 'NOT_FOUND', '신고를 찾지 못했어요.');
        throw e;
      });

      // 결과 알림: 신고한 사람에게는 처리 결과, 작성자에게는 조치 내용(조치했을 때만)
      if (status !== 'open') {
        const reports = await db.adminReports('all');
        const rep = reports.find((x) => x.id === id);
        const code = rep?.promise.share_code ?? '', title = rep?.promise.title ?? '';
        const url = code ? promiseUrl(ctx.appUrl || 'https://qkrwpgns-prog.github.io/keep/', code) : null;
        const ids: number[] = [];
        try {
          if (r.reporter) ids.push(...(await enqueue(db, ctx.now, {
            userId: r.reporter, promiseId: r.promise_id, kind: 'report_result', url, respectMute: false,
            title: '[키프] 신고를 확인했어요',
            body: status === 'actioned'
              ? `'${title}' 약속 신고를 확인하고 ${r.blocked ? '이 약속의 재촉을 멈췄어요' : '작성자의 재촉 기능을 제한했어요'}. 알려 주셔서 고마워요.`
              : `'${title}' 약속 신고를 확인했어요. 이번에는 운영 정책 위반으로 보기 어려워 별도 조치는 하지 않았어요. 이 약속 알림은 계속 꺼 둘 수 있어요.`,
          })));
          if (status === 'actioned' && r.author) ids.push(...(await enqueue(db, ctx.now, {
            userId: r.author, promiseId: r.promise_id, kind: 'report_action', url, respectMute: false,
            title: '[키프] 재촉 기능이 제한됐어요',
            body: `'${title}' 약속에 대한 신고를 검토했어요. ${r.blocked ? '이 약속에서는 재촉·이행 촉구서를 더 보낼 수 없어요.' : ''}${r.suspended_until ? ` ${r.suspended_until.slice(0, 10)}까지 모든 약속의 재촉을 보낼 수 없어요.` : ''} 약속증서와 기록은 그대로 남아 있어요.`.trim(),
          })));
          if (ids.length && ctx.senders) await flush(db, ctx.senders, { ids });
        } catch (e) { console.error('notify', e); }
      }
      return { ok: true, ...r };
    }
    default:
      return fail(400, 'ACTION', '알 수 없는 요청이에요.');
  }
}
