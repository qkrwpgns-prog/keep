// 규칙 기반 정리 (legacy parseAmount·parseDate·ruleExtract·ruleCheck 이식)
// AI가 실패하거나 한도를 넘으면 이 경로로 대체한다.

import { TPL, type TemplateKey } from './templates.ts';
import { addDays, diffDays, isYmd, kstToday, mkYmd, parseYmd, ymdUTC } from './dates.ts';
import { won } from './korean.ts';

export function parseAmount(t: string): number | null {
  let m = t.match(/(\d+)\s*만\s*(?:(\d+)\s*천)?\s*원?/);
  if (m) return +m[1] * 10000 + (m[2] ? +m[2] * 1000 : 0);
  m = t.match(/(\d+)\s*천\s*원/);
  if (m) return +m[1] * 1000;
  m = t.match(/(\d[\d,]{2,})\s*원/);
  if (m) return +m[1].replace(/,/g, '');
  return null;
}

/** 상대 날짜는 today(KST 'YYYY-MM-DD') 기준으로 계산 */
export function parseDate(t: string, today: string = kstToday()): string {
  const base = parseYmd(today);
  const Y = base.getUTCFullYear(), M = base.getUTCMonth(), D = base.getUTCDate();
  const plus = (n: number) => addDays(today, n);
  const before = (y: number, mo: number, d: number) => parseYmd(mkYmd(y, mo, d)) < base;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/))) return mkYmd(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) { let y = Y; if (before(y, +m[1] - 1, +m[2])) y++; return mkYmd(y, +m[1] - 1, +m[2]); }
  if ((m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/))) { let y = Y; if (before(y, +m[1] - 1, +m[2])) y++; return mkYmd(y, +m[1] - 1, +m[2]); }
  if ((m = t.match(/다음\s*달\s*(\d{1,2})\s*일/))) return mkYmd(Y, M + 1, +m[1]);
  if ((m = t.match(/이번\s*달\s*(\d{1,2})\s*일/))) return mkYmd(Y, M, +m[1]);
  if (/다음\s*달\s*말/.test(t)) return mkYmd(Y, M + 2, 0);
  if (/이번\s*달\s*말/.test(t)) return mkYmd(Y, M + 1, 0);
  if ((m = t.match(/(이번|다음|담)\s*주\s*([월화수목금토일])요일/))) {
    const days = '월화수목금토일';
    const mon = new Date(base);
    mon.setUTCDate(D - ((base.getUTCDay() + 6) % 7));
    mon.setUTCDate(mon.getUTCDate() + (m[1] === '이번' ? 0 : 7) + days.indexOf(m[2]));
    return ymdUTC(mon);
  }
  if ((m = t.match(/(\d+)\s*주\s*(뒤|후)/))) return plus(7 * +m[1]);
  if ((m = t.match(/(\d+)\s*일\s*(뒤|후)/))) return plus(+m[1]);
  if (/글피/.test(t)) return plus(3);
  if (/모레/.test(t)) return plus(2);
  if (/내일/.test(t)) return plus(1);
  if ((m = t.match(/(\d{1,2})\s*일\s*(까지|에|날)/))) { let mo = M; if (+m[1] < D) mo++; return mkYmd(Y, mo, +m[1]); }
  return '';
}

export interface Extracted {
  template?: TemplateKey;
  title: string;
  aName: string;
  bName: string;
  amount: number | null;
  item: string;
  task: string;
  deadline: string;
  method: string;
  penalty: string;
  quote: string;
  questions?: string[];
}

export function ruleExtract(d: { raw: string; tpl: TemplateKey; myName?: string }, today: string = kstToday()): Extracted {
  const t = String(d.raw || '');
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const body = (l: string) => l.replace(/^[^:：]{1,10}[:：]\s*/, '');
  const promiseRe = /갚|줄게|보낼게|돌려|할게|하기로|까지|정산|보내줘|꼭 줘|만들게|맡을게|해올게|올려둘게|올릴게/;
  const key = lines.filter((l) => promiseRe.test(l));
  const scan = <T>(fn: (s: string) => T): T => {
    for (const l of key) { const v = fn(body(l)); if (v) return v; }
    return fn(t);
  };
  const out: Extracted = { aName: d.myName || '', bName: '', amount: null, item: '', task: '', deadline: '', method: '', penalty: '', quote: '', title: '' };
  const kind = TPL[d.tpl].kind;
  if (kind === 'money') out.amount = scan(parseAmount);
  out.deadline = scan((s) => parseDate(s, today));
  if (/계좌|이체|송금/.test(t)) out.method = '계좌이체';
  else if (/토스/.test(t)) out.method = '토스 송금';
  else if (/카카오페이|카페/.test(t)) out.method = '카카오페이 송금';
  else if (/만나서|직접|학교에서|가져다/.test(t)) out.method = '직접 전달';
  const pen = t.match(/(늦으면|못\s*갚으면|안\s*주면|어기면|못\s*지키면)\s*([^\n.!?ㅋㅎ]+)/);
  if (pen) out.penalty = (pen[1] + ' ' + pen[2]).replace(/\s+/g, ' ').trim();
  const names = [...t.matchAll(/^\s*([가-힣A-Za-z]{2,6})\s*[:：]/gm)].map((x) => x[1]).filter((n) => n !== '나' && n !== d.myName);
  if (names.length) out.bName = names[0];
  if (kind === 'item') {
    const m = t.match(/([가-힣A-Za-z0-9][가-힣A-Za-z0-9 ]{0,24}?)\s*(?:좀\s*)?(?:빌려|빌릴)/);
    if (m) out.item = m[1].trim().split(/\s+/).slice(-3).join(' ').replace(/^(나|너|혹시|그|그거|저|제)\s*/, '');
  }
  if (kind === 'task') {
    // 상대가 한 약속 줄을 먼저(작성자 '나'의 말은 뒤로)
    const mine = (x: string) => /^\s*(나|${d.myName || '나'})\s*[:：]/.test(x);
    const re = /할게|하기로|맡을게|해올게|만들게|보낼게|올려둘게|올릴게/;
    const l = key.find((x) => re.test(x) && !mine(x)) || key.find((x) => re.test(x));
    if (l) out.task = body(l).replace(/[ㅋㅎㅠㅜ!~]+/g, '').trim();
  }
  const q = key.find((l) => /(갚을게|줄게|보낼게|돌려줄게|할게|갚겠|드릴게)/.test(l) && !/\?/.test(l)) || key.find((l) => !/\?/.test(l));
  out.quote = q || '';
  if (kind === 'money' && out.amount) out.title = `${out.bName || '상대'} ${out.amount % 10000 === 0 ? out.amount / 10000 + '만원' : won(out.amount)}`;
  else if (kind === 'item' && out.item) out.title = `${out.item} 대여`;
  else if (kind === 'task' && out.task) out.title = out.task.slice(0, 14);
  return out;
}

export interface CheckFields {
  aName: string;
  bName: string;
  deadline: string;
  amount: string | number | null;
  item: string;
  task: string;
  method: string;
}

export function ruleCheck(f: CheckFields, tpl: TemplateKey, today: string = kstToday()): string[] {
  const q: string[] = [];
  const k = TPL[tpl].kind;
  if (!f.aName) q.push('작성자(본인) 이름을 적어 주세요.');
  if (!f.bName) q.push('상대방 실명을 적어 주세요. 별명만 있으면 나중에 누구인지 다툼이 생길 수 있어요.');
  else if (f.bName.length <= 2) q.push(`'${f.bName}'의 성을 포함한 실명인지 확인해 주세요.`);
  if (!isYmd(f.deadline)) q.push('기한이 없어요. "언제까지"를 날짜로 정해 주세요.');
  else if (diffDays(f.deadline, today) < 0) q.push('기한이 이미 지난 날짜예요. 맞는지 확인해 주세요.');
  if (k === 'money' && !(Number(String(f.amount ?? '').replace(/[^\d]/g, '')) > 0)) q.push('금액이 비어 있어요.');
  if (k === 'item' && !f.item) q.push('어떤 물건인지 구체적으로 적어 주세요(모델명·상태 등).');
  if (k === 'task' && !f.task) q.push('무엇을 하기로 했는지 구체적으로 적어 주세요.');
  if (!f.method) q.push('어떤 방법으로 지킬지(예: 계좌이체, 직접 전달) 정해 두면 좋아요.');
  return q.slice(0, 4);
}
