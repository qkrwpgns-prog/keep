// 이벤트 종류와 타임라인 문구
import { korDate } from './dates.ts';
import { shortCode } from './canonical.ts';
import { won } from './korean.ts';

export type EventType =
  | 'created' | 'edited' | 'joined' | 'signed' | 'revise_requested' | 'declined' | 'cancelled'
  | 'request_made' | 'request_answered' | 'reported' | 'confirmed' | 'report_rejected' | 'done'
  | 'imported' | 'party_left' | 'reminder' | 'nudge_sent' | 'notice_sent' | 'demo_time' | 'demo_cron';

export interface EventRow {
  id: number;
  promise_id: string;
  actor_role: 'A' | 'B' | 'system';
  type: EventType | string;
  payload: Record<string, unknown>;
  canon: string;
  created_at: string;
  sim_at: string | null;
  prev_hash: string | null;
  hash: string;
}

type P = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));

/** 타임라인 한 줄: 제목, 상세, 점 색 */
export function eventText(e: Pick<EventRow, 'type' | 'payload'>, names: { a: string; b: string }): { title: string; detail: string; tone: '' | 'seal' | 'ok' } {
  const p = (e.payload || {}) as P;
  const A = names.a || '작성자', B = names.b || '상대방';
  switch (e.type) {
    case 'created': return { title: `${A}님이 증서를 작성하고 서명`, detail: p.quote ? '근거 대화: ' + s(p.quote) : '', tone: 'seal' };
    case 'edited': return { title: `${A}님이 수정한 내용으로 다시 서명`, detail: '', tone: 'seal' };
    case 'joined': return { title: `${B}님이 개인정보 수집·이용에 동의하고 증서를 열람`, detail: '', tone: '' };
    case 'signed': return { title: `${B}님이 서명 · 증서 확정`, detail: '확인코드 ' + shortCode(s(p.hash)), tone: 'seal' };
    case 'revise_requested': return { title: `${B}님이 수정 요청`, detail: s(p.note), tone: '' };
    case 'declined': return { title: `${B}님이 서명을 거절`, detail: s(p.note), tone: '' };
    case 'cancelled': return { title: `${A}님이 서명 요청을 취소`, detail: s(p.note), tone: '' };
    case 'request_made':
      return {
        title: p.kind === 'extend' ? `${B}님이 기한 연장 요청 (${korDate(s(p.new_deadline))})` : `${B}님이 ${Array.isArray(p.installments) ? p.installments.length : ''}회 분할 이행 요청`,
        detail: p.note ? '사유: ' + s(p.note) : '', tone: '',
      };
    case 'request_answered':
      return p.ok
        ? { title: '요청 수락 · 증서 변경', detail: s(p.text) + (p.hash ? '\n새 확인코드 ' + shortCode(s(p.hash)) : ''), tone: 'seal' }
        : { title: '요청 거절 · 기존 기한 유지', detail: s(p.note), tone: '' };
    case 'reported': {
      const n = p.installment_no != null ? ` (${Number(p.installment_no) + 1}회차)` : '';
      const amt = p.amount ? `보낸 금액 ${won(p.amount as number)}${p.paid_on ? ' · ' + korDate(s(p.paid_on)) : ''}${p.match === true ? ' · 약속 금액과 일치' : p.match === false ? ' · 약속 금액과 다름' : ''}` : '';
      return { title: `${B}님이 이행 완료 신고${n}`, detail: [amt, s(p.note)].filter(Boolean).join('\n'), tone: '' };
    }
    case 'confirmed':
      return p.amount
        ? { title: `상환 ${won(p.amount as number)} ${p.recorded ? '기록' : '확인'}`, detail: `누적 ${won(p.paid_total as number)} · 남은 금액 ${won(p.remaining as number)}`, tone: 'ok' }
        : { title: `${Number(p.installment_no) + 1}회차 이행 확인`, detail: '', tone: 'ok' };
    case 'report_rejected': return { title: '이행 신고를 확인하지 못함 · 진행 중으로 되돌림', detail: s(p.note), tone: '' };
    case 'done': return { title: `${A}님이 이행 확인 · 약속 지킴 완료`, detail: '', tone: 'ok' };
    case 'imported': return { title: '기존 키프(이 기기 저장 버전)에서 가져옴', detail: p.legacy_hash ? '기존 확인코드 ' + shortCode(s(p.legacy_hash)) : '', tone: '' };
    case 'reminder': {
      const st = Number(p.stage);
      if (p.installment_no != null) {
        const n = Number(p.installment_no) + 1;
        return p.to === 'B'
          ? { title: `${B}님에게 ${n}회차 ${st === 1 ? '3일 전' : '당일'} 알림 발송`, detail: '', tone: '' }
          : { title: `${A}님에게 ${n}회차 확인 안내(3일 지남)`, detail: '', tone: '' };
      }
      return p.to === 'B'
        ? { title: `${B}님에게 ${st === 1 ? '기한 3일 전' : '약속 당일'} 알림 발송`, detail: '', tone: '' }
        : { title: `${A}님에게 ${st === 5 ? '공식 통지(이행 촉구서) 가능' : st === 3 ? '1차 재촉' : '2차 재촉'} 안내`, detail: '', tone: '' };
    }
    case 'nudge_sent': return { title: `${Number(p.stage) === 3 ? '1차' : '2차'} 재촉 메시지 보냄`, detail: s(p.text), tone: 'seal' };
    case 'notice_sent': return { title: '이행 촉구서 보냄', detail: '', tone: 'seal' };
    case 'demo_time': return { title: `시연 날짜 바꿈 · ${p.offset == null ? '실제 오늘' : Number(p.offset) === 0 ? 'D-day' : Number(p.offset) > 0 ? 'D+' + p.offset : 'D' + p.offset}`, detail: '시연 기록이에요. 실제 시각은 위 시각이에요.', tone: '' };
    case 'demo_cron': return { title: '시연: 오전 9시 점검을 지금 실행', detail: s(p.result), tone: '' };
    case 'party_left': return { title: '한 당사자가 탈퇴함 · 증서는 보존', detail: '', tone: '' };
    default: return { title: e.type, detail: '', tone: '' };
  }
}
