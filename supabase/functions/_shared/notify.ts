// 알림: 매일 단계 점검(cron-daily), 큐 발송(notify-flush), 동작 후 상대에게 알리기.
// 런타임 의존 없음(발송 수단은 Senders로 주입) → 로컬 테스트에서 가짜 발송기로 검증한다.
import { addDays, diffDays, korDate, kstToday, stageOf } from './domain/dates.ts';
import { jcs } from './domain/canonical.ts';
import { nextSendTime } from './domain/nudge.ts';
import { subjectText } from './domain/progress.ts';
import { esc } from './domain/certificate.ts';
import { DISCLAIMER, type TemplateKey } from './domain/templates.ts';

export const DEFAULT_APP_URL = 'https://qkrwpgns-prog.github.io/keep/';

export interface Candidate {
  id: string; share_code: string; template: TemplateKey; title: string; amount: number | null; item: string | null; task: string | null;
  deadline: string; deadline_version: number; status: string; is_demo: boolean; demo_offset_days: number | null;
  installments?: { amount: number; date: string; paid?: boolean }[] | null;
  parties: { role: 'A' | 'B'; user_id: string | null; display_name: string }[]; done_stages: number[];
}
export interface Due { id: number; user_id: string; promise_id: string | null; channel: 'push' | 'email'; kind: string; title: string; body: string; url: string | null; email: string | null; subs: { endpoint: string; keys: Record<string, string> }[] | null }

export interface NotifyDb {
  cronCandidates(promiseId?: string | null): Promise<Candidate[]>;
  nudgeMark(promiseId: string, dv: number, stage: number, status: 'auto_sent' | 'prompted'): Promise<boolean>;
  installmentMark(promiseId: string, dv: number, no: number, stage: number): Promise<boolean>;
  enqueue(p: Record<string, unknown>): Promise<number[]>;
  claimDue(limit: number, ids?: number[] | null): Promise<Due[]>;
  finish(id: number, status: 'sent' | 'failed' | 'skipped', error?: string | null): Promise<void>;
  dropSubscription(endpoint: string): Promise<void>;
  systemEvent(promiseId: string, type: string, canon: string, simAt: string | null): Promise<void>;
  purgeExpired(): Promise<string[]>;
  removeFiles(bucket: string, paths: string[]): Promise<void>;
}

export interface Senders {
  /** 'ok' | 'gone'(구독 만료) | 그 밖의 오류 문자열 */
  push(sub: { endpoint: string; keys: Record<string, string> }, payload: string): Promise<string>;
  email(to: string, subject: string, text: string, html: string): Promise<void>;
}

export const promiseUrl = (base: string, code: string) => `${base.replace(/\/?$/, '/')}#/p/${code}`;

/** 알림 메일 본문(HTML) */
export function emailHtml(title: string, body: string, url: string | null) {
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#1f1b2d">
<div style="font-weight:800;font-size:18px;color:#cf3d28;margin-bottom:12px">約 키프 Keep</div>
<h2 style="font-size:18px;margin:0 0 10px">${esc(title.replace(/^\[키프\]\s*/, ''))}</h2>
<div style="white-space:pre-wrap;font-size:15px;line-height:1.6">${esc(body)}</div>
${url ? `<p style="margin:20px 0"><a href="${esc(url)}" style="display:inline-block;background:#1f1b2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">키프에서 열기</a></p>` : ''}
<p style="font-size:12px;color:#8b8597;margin-top:24px">알림을 끄려면 키프 → 설정 또는 약속 화면의 '이 약속 알림 끄기'를 이용하세요.<br>${esc(DISCLAIMER)}</p></div>`;
}

interface EnqueueMsg { userId: string | null; promiseId: string | null; kind: string; title: string; body: string; emailBody?: string; url: string | null; respectMute?: boolean; immediate?: boolean }

export async function enqueue(db: NotifyDb, now: Date, m: EnqueueMsg): Promise<number[]> {
  if (!m.userId) return [];
  return db.enqueue({
    user_id: m.userId, promise_id: m.promiseId, kind: m.kind, title: m.title, body: m.body, email_body: m.emailBody ?? m.body,
    url: m.url, send_after: (m.immediate ? now : nextSendTime(now)).toISOString(), respect_mute: m.respectMute ?? true,
  });
}

/** 큐 발송. ids를 주면 그 알림만(동작 직후 즉시 발송) */
export async function flush(db: NotifyDb, senders: Senders, opts: { ids?: number[] | null; limit?: number } = {}) {
  const due = await db.claimDue(opts.limit ?? 50, opts.ids ?? null);
  let sent = 0, failed = 0;
  for (const n of due) {
    try {
      if (n.channel === 'push') {
        const subs = n.subs || [];
        if (!subs.length) { await db.finish(n.id, 'skipped', 'no subscription'); continue; }
        const payload = JSON.stringify({ title: n.title, body: n.body.slice(0, 300), url: n.url, tag: n.promise_id || n.kind });
        let ok = false, err = '';
        for (const s of subs) {
          const r = await senders.push(s, payload);
          if (r === 'ok') ok = true;
          else if (r === 'gone') await db.dropSubscription(s.endpoint);
          else err = r;
        }
        await db.finish(n.id, ok ? 'sent' : err ? 'failed' : 'skipped', ok ? null : err || 'subscription expired');
        if (ok) sent++; else failed++;
      } else {
        if (!n.email) { await db.finish(n.id, 'skipped', 'no email'); continue; }
        await senders.email(n.email, n.title, `${n.body}\n\n${n.url ? '키프에서 열기: ' + n.url + '\n\n' : ''}${DISCLAIMER}`, emailHtml(n.title, n.body, n.url));
        await db.finish(n.id, 'sent');
        sent++;
      }
    } catch (e) {
      await db.finish(n.id, 'failed', String((e as Error)?.message || e));
      failed++;
    }
  }
  return { claimed: due.length, sent, failed };
}

/** 시연 약속은 되감은 날짜, 아니면 KST 오늘 */
export const todayOf = (c: Pick<Candidate, 'is_demo' | 'demo_offset_days' | 'deadline'>, now: Date) =>
  c.is_demo && c.demo_offset_days != null ? addDays(c.deadline, c.demo_offset_days) : kstToday(now);

/**
 * 매일 09:00 KST 단계 점검.
 *  · D-3(1), D-day(2): B에게 자동 알림
 *  · D+3(3), D+7(4), D+14(5): A에게 "재촉할 때예요"
 * 각 (약속, 기한 버전, 단계)는 한 번만 처리된다. 놓친 날이 있어도 '지금 단계'만 처리(지난 단계를 몰아서 보내지 않음).
 * 시연 약속은 promiseId로 콕 집어 실행할 때만 처리한다.
 */
export async function runDaily(db: NotifyDb, now: Date, opts: { appUrl?: string; promiseId?: string | null; immediate?: boolean } = {}) {
  const appUrl = opts.appUrl || DEFAULT_APP_URL;
  const list = await db.cronCandidates(opts.promiseId ?? null);
  const ids: number[] = [];
  const log: string[] = [];
  for (const c of list) {
    if (c.is_demo && !opts.promiseId) continue;
    if (c.status !== 'active') continue; // 이행 신고 후 확인 대기 중이면 재촉하지 않음
    const today = todayOf(c, now);
    const A0 = c.parties.find((p) => p.role === 'A')!, B0 = c.parties.find((p) => p.role === 'B')!;
    const url0 = promiseUrl(appUrl, c.share_code);
    const simAt0 = c.is_demo && c.demo_offset_days != null ? today : null;
    // 분할 이행: 마지막 회차 전의 '다음 회차'마다 D-3·D-day는 B에게, D+3은 A에게 (마지막 회차는 아래 기한 단계가 처리)
    const inst = c.installments || [];
    const ni = inst.findIndex((x) => !x.paid);
    if (ni >= 0 && ni < inst.length - 1) {
      const d = diffDays(today, inst[ni].date);
      const ist = d >= 3 ? 3 : d >= 0 ? 2 : d >= -3 ? 1 : 0;
      if (ist && (await db.installmentMark(c.id, c.deadline_version, ni, ist))) {
        const amt = Number(inst[ni].amount).toLocaleString('ko-KR');
        if (ist <= 2) {
          ids.push(...(await enqueue(db, now, { userId: B0.user_id, promiseId: c.id, kind: `inst_${ist}`, title: ist === 1 ? `[키프] ${ni + 1}회차 3일 전이에요` : `[키프] 오늘이 ${ni + 1}회차 날이에요`, body: `${A0.display_name}님과의 '${c.title}' ${ni + 1}회차 ${amt}원이 ${korDate(inst[ni].date)}까지예요.${ist === 2 ? ' 보냈다면 키프에서 신고해 주세요.' : ''}`, url: url0, immediate: opts.immediate })));
        } else {
          ids.push(...(await enqueue(db, now, { userId: A0.user_id, promiseId: c.id, kind: 'inst_3', title: `[키프] ${ni + 1}회차가 3일 지났어요`, body: `${B0.display_name}님과의 '${c.title}' ${ni + 1}회차(${amt}원)가 아직 확인되지 않았어요. 받았다면 기록하고, 아니라면 카톡으로 가볍게 물어보세요.`, url: url0, respectMute: false, immediate: opts.immediate })));
        }
        await db.systemEvent(c.id, 'reminder', jcs({ stage: ist, to: ist <= 2 ? 'B' : 'A', installment_no: ni }), simAt0);
        log.push(`${c.share_code}: ${ni + 1}회차 ${ist}단계`);
      }
    }
    const late = diffDays(today, c.deadline);
    const stage = stageOf(late);
    if (!stage || c.done_stages.includes(stage)) continue;
    const A = c.parties.find((p) => p.role === 'A')!, B = c.parties.find((p) => p.role === 'B')!;
    const url = promiseUrl(appUrl, c.share_code);
    const subj = subjectText({ tpl: c.template, amount: c.amount, item: c.item || '', task: c.task || '' });
    const simAt = c.is_demo && c.demo_offset_days != null ? today : null;
    if (stage <= 2) {
      if (!(await db.nudgeMark(c.id, c.deadline_version, stage, 'auto_sent'))) continue;
      const msg = stage === 1
        ? { title: '[키프] 약속 3일 전이에요', body: `${A.display_name}님과의 '${c.title}' 약속(${subj})이 ${korDate(c.deadline)}까지예요. 미리 준비해 주세요. 어려우면 키프에서 연장·분할을 요청할 수 있어요.` }
        : { title: '[키프] 오늘이 약속일이에요', body: `${A.display_name}님과의 '${c.title}' 약속(${subj}) 기한이 오늘이에요. 지켰다면 키프에서 이행 완료를 신고해 주세요.` };
      ids.push(...(await enqueue(db, now, { userId: B.user_id, promiseId: c.id, kind: `auto_${stage}`, ...msg, url, immediate: opts.immediate })));
      await db.systemEvent(c.id, 'reminder', jcs({ stage, to: 'B' }), simAt);
      log.push(`${c.share_code}: ${stage}단계 B 알림`);
    } else {
      if (!(await db.nudgeMark(c.id, c.deadline_version, stage, 'prompted'))) continue;
      const body = stage === 5
        ? `${B.display_name}님과의 '${c.title}' 약속이 ${late}일 지났어요. 그동안의 기록으로 이행 촉구서 초안을 준비했어요. 확인하고 보낼지 정해 주세요.`
        : `${B.display_name}님과의 '${c.title}' 약속이 ${late}일 지났어요. ${stage === 3 ? '1차' : '2차'} 재촉 메시지를 골라 확인한 뒤 보내 주세요.`;
      ids.push(...(await enqueue(db, now, { userId: A.user_id, promiseId: c.id, kind: `prompt_${stage}`, title: stage === 5 ? '[키프] 이행 촉구서를 보낼 수 있어요' : '[키프] 재촉할 때예요', body, url, respectMute: false, immediate: opts.immediate })));
      await db.systemEvent(c.id, 'reminder', jcs({ stage, to: 'A' }), simAt);
      log.push(`${c.share_code}: ${stage}단계 A 안내`);
    }
  }
  return { checked: list.length, queued: ids, log };
}

/** 매일 크론에 함께: 보존 기한 지난 약속 파기 */
export async function purge(db: NotifyDb) {
  const paths = await db.purgeExpired();
  if (paths.length) await db.removeFiles('signatures', paths);
  return paths.length;
}
