import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hangulAmount, pp, callName, maskName, maskAccount, maskPhones, won } from '../../supabase/functions/_shared/domain/korean.ts';
import { addDays, ddayLabel, diffDays, kstToday, korDate, stageOf, stamp } from '../../supabase/functions/_shared/domain/dates.ts';
import { parseAmount, parseDate, ruleCheck, ruleExtract } from '../../supabase/functions/_shared/domain/rules.ts';
import { canonicalV2, canonicalV3, jcs, sha256Hex, shortCode } from '../../supabase/functions/_shared/domain/canonical.ts';
import { checkRates } from '../../supabase/functions/_shared/domain/guardrails.ts';
import { splitPlan } from '../../supabase/functions/_shared/domain/progress.ts';
import { newShareCode, SHARE_CODE_RE } from '../../supabase/functions/_shared/domain/mapping.ts';
import { strokesToVector, validateVector } from '../../supabase/functions/_shared/domain/signature.ts';
import { certHTML, certBody } from '../../supabase/functions/_shared/domain/certificate.ts';
import { EXAMPLE_CHAT } from '../../supabase/functions/_shared/domain/templates.ts';

const legacySrc = readFileSync(join(import.meta.dirname, '../../legacy/index.html'), 'utf8');
/** legacy/index.html 안의 함수 소스를 그대로 꺼내 실행 (호환성 검증용) */
function legacyFn<T>(name: string, deps = ''): T {
  const start = legacySrc.indexOf(`function ${name}(`);
  let i = legacySrc.indexOf('{', start), depth = 0;
  for (; i < legacySrc.length; i++) {
    if (legacySrc[i] === '{') depth++;
    else if (legacySrc[i] === '}' && --depth === 0) break;
  }
  return new Function(`${deps}\n${legacySrc.slice(start, i + 1)}\nreturn ${name};`)() as T;
}

describe('금액·조사', () => {
  it('금액 한글 표기', () => {
    expect(hangulAmount(300000)).toBe('삼십만');
    expect(hangulAmount(1250000)).toBe('일백이십오만');
    expect(hangulAmount(100010001)).toBe('일억일만일');
    expect(hangulAmount(0)).toBe('');
    const legacy = legacyFn<(n: number) => string>('hangulAmount');
    for (const n of [1, 15, 9999, 10000, 123456789, 3000000000]) expect(hangulAmount(n)).toBe(legacy(n));
  });
  it('조사 자동 처리', () => {
    expect(pp('김민수', '은', '는')).toBe('는');
    expect(pp('박제훈', '은', '는')).toBe('은');
    expect(pp('Tom', '은', '는')).toBe('은(는)');
    expect(callName('김민수')).toBe('민수야');
    expect(callName('지훈')).toBe('지훈아');
    expect(won(300000)).toBe('300,000원');
  });
  it('개인정보 가림', () => {
    expect(maskName('김민수')).toBe('김*수');
    expect(maskName('남궁민수')).toBe('남**수');
    expect(maskAccount('국민 123-456-789012')).toBe('국민 123-***-**9012');
    expect(maskPhones('연락처 010-1234-5678')).toBe('연락처 010-****-5678');
  });
});

describe('날짜 (KST 고정)', () => {
  it('UTC 자정 직전·직후도 KST 날짜로 계산', () => {
    expect(kstToday(Date.UTC(2026, 10, 15, 14, 59))).toBe('2026-11-15'); // KST 23:59
    expect(kstToday(Date.UTC(2026, 10, 15, 15, 0))).toBe('2026-11-16'); // KST 00:00
    expect(stamp('2026-11-16T00:00:00.000Z')).toBe('2026.11.16 09:00');
  });
  it('D-day와 단계', () => {
    expect(ddayLabel('2026-11-16', '2026-11-19')).toBe('D-3');
    expect(ddayLabel('2026-11-19', '2026-11-19')).toBe('D-day');
    expect(ddayLabel('2026-12-03', '2026-11-19')).toBe('D+14');
    expect([-4, -3, 0, 3, 7, 14].map(stageOf)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2027-03-01', '2027-02-28')).toBe(1);
    expect(korDate('2026-12-15')).toBe('2026년 12월 15일');
  });
});

describe('규칙 기반 추출', () => {
  const today = '2026-11-16';
  it('상대 날짜는 기준일로 계산', () => {
    expect(parseDate('다음 달 15일까지', today)).toBe('2026-12-15');
    expect(parseDate('이번 달 말', today)).toBe('2026-11-30');
    expect(parseDate('다음 주 금요일', today)).toBe('2026-11-27');
    expect(parseDate('3/2까지', today)).toBe('2027-03-02');
    expect(parseDate('모레', today)).toBe('2026-11-18');
    expect(parseDate('2주 뒤', today)).toBe('2026-11-30');
    expect(parseDate('10일까지', today)).toBe('2026-12-10');
  });
  it('금액', () => {
    expect(parseAmount('30만원만 빌려줘')).toBe(300000);
    expect(parseAmount('5만 5천원')).toBe(55000);
    expect(parseAmount('12,500원')).toBe(12500);
  });
  it('예시 대화', () => {
    const r = ruleExtract({ raw: EXAMPLE_CHAT, tpl: 'loan', myName: '제훈' }, today);
    expect(r).toMatchObject({ bName: '민수', amount: 300000, deadline: '2026-12-15', method: '계좌이체', title: '민수 30만원' });
    expect(r.penalty).toContain('밥 한 번');
    const q = ruleCheck({ ...r, amount: r.amount, aName: '제훈' }, 'loan', today);
    expect(q.some((x) => x.includes('실명'))).toBe(true);
  });
});

describe('확인코드', () => {
  it('JCS는 키를 정렬하고 공백이 없다', () => {
    expect(jcs({ b: 1, a: [true, null, '한'], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"한"],"b":1,"c":{"y":2,"z":1}}');
  });
  it('v2 정규화는 legacy canonical()과 바이트 단위로 같다', async () => {
    const legacy = legacyFn<(p: unknown) => string>('canonical');
    const p = {
      id: 'mabc12', tpl: 'loan', title: '민수 30만원', aName: '박제훈', bName: '김민수', amount: 300000, item: '', task: '',
      deadline: '2026-12-15', method: '계좌이체', penalty: '', memo: '', installments: [{ amount: 150000, date: '2026-12-20', paid: true }],
      amendments: [{ at: 1760000000000, text: '연장' }], sigA: { at: 1, name: '박제훈', ph: '1234', svHash: 'aa' }, sigB: null,
    };
    expect(canonicalV2(p)).toBe(legacy(p));
  });
  it('v3 해시는 내용이 한 글자만 바뀌어도 달라진다', async () => {
    const base = { code: 'ABCDEFGH', tpl: 'loan' as const, title: 't', aName: 'a', bName: 'b', amount: 300000, interestRate: null, lateInterestRate: null, repayAccount: '', item: '', task: '', deadline: '2026-12-15', method: '', penalty: '', memo: '', installments: [], amendments: [], sigA: null, sigB: null };
    const h1 = await sha256Hex(canonicalV3(base));
    const h2 = await sha256Hex(canonicalV3({ ...base, amount: 300001 }));
    expect(h1).not.toBe(h2);
    expect(shortCode(h1)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});

describe('가드레일·기타', () => {
  it('이자율 상한', () => {
    expect(checkRates({ amount: 1_000_000, interestRate: 20, lateInterestRate: null }).ok).toBe(true);
    expect(checkRates({ amount: 1_000_000, interestRate: 20.5, lateInterestRate: null }).ok).toBe(false);
    expect(checkRates({ amount: 1_000_000, interestRate: 5, lateInterestRate: 21 }).error).toMatch(/연체이자율/);
    expect(checkRates({ amount: 50_000, interestRate: 5, lateInterestRate: null }).notice).toMatch(/10만 원 미만/);
  });
  it('분할 계획', () => {
    const plan = splitPlan(300000, 3, 14, '2026-12-15', '2026-11-16');
    expect(plan.map((x) => x.amount)).toEqual([100000, 100000, 100000]);
    expect(plan.map((x) => x.date)).toEqual(['2026-12-22', '2027-01-05', '2027-01-19']);
  });
  it('공유 코드', () => {
    for (let i = 0; i < 200; i++) expect(newShareCode()).toMatch(SHARE_CODE_RE);
  });
  it('서명 벡터', () => {
    const v = strokesToVector([[[0, 0], [280, 85], [560, 170]], [[10, 160], [550, 10]]]);
    expect(v).not.toBeNull();
    expect(validateVector(v)).toBe(true);
    expect(validateVector([[1, 2]])).toBe(false);
  });
  it('증서 HTML은 이름을 이스케이프하고 금액을 한글로 적는다', () => {
    const doc = { code: 'ABCDEFGH', tpl: 'loan' as const, title: 't', aName: '<b>x', bName: '김민수', amount: 300000, interestRate: null, lateInterestRate: null, repayAccount: '국민 123-456-789012', item: '', task: '', deadline: '2026-12-15', method: '계좌이체', penalty: '', memo: '', installments: [], amendments: [], sigA: null, sigB: null, createdAt: '2026-11-16T00:00:00.000Z' };
    const html = certHTML(doc);
    expect(html).toContain('금 삼십만원정');
    expect(html).toContain('&lt;b&gt;x');
    expect(html).toContain('123-***-**9012');
    expect(certBody(doc).lead).toContain('김민수</b>는');
  });
});

import { checkBanned, nextSendTime, nudgeBank, noticeText } from '../../supabase/functions/_shared/domain/nudge.ts';
describe('재촉 문구·금지어·야간', () => {
  const p = { tpl: 'loan' as const, amount: 300000, item: '', task: '', aName: '박제훈', bName: '김민수', deadline: '2026-11-10', method: '계좌이체', penalty: '', amendments: [], currentHash: 'ab'.repeat(32) };
  it('선배·지인은 존댓말, 친구는 반말', () => {
    expect(nudgeBank(p, 3, 2, '선배', '2026-11-13')[0].text).toContain('김민수님');
    expect(nudgeBank(p, 3, 2, '친구', '2026-11-13')[0].text).toContain('민수야');
  });
  it('템플릿 문구와 촉구서에는 금지어가 없다(이름 오탐 없음)', () => {
    for (const rel of ['친구', '선배']) for (const st of [3, 4]) for (const t of [1, 3, 5]) for (const o of nudgeBank(p, st, t, rel, '2026-11-13')) expect(checkBanned(o.text)).toBeNull();
    expect(checkBanned(noticeText(p, 2, '2026-11-24'))).toBeNull();
  });
  it('욕설·협박·과장된 법적 위협을 잡는다', () => {
    for (const t of ['씨발 언제 줄래', '안 갚으면 고소하겠다', '회사에 알릴 거야', '부모님한테 말할게', '에타에 올릴 거야', '경찰에 신고할게']) expect(checkBanned(t)).not.toBeNull();
  });
  it('밤 9시~아침 9시(KST)에는 다음 오전 9시로 미룬다', () => {
    expect(nextSendTime(new Date('2026-11-16T05:00:00Z')).toISOString()).toBe('2026-11-16T05:00:00.000Z'); // 14시
    expect(nextSendTime(new Date('2026-11-16T13:30:00Z')).toISOString()).toBe('2026-11-17T00:00:00.000Z'); // 22:30 → 다음 날 9시
    expect(nextSendTime(new Date('2026-11-16T20:00:00Z')).toISOString()).toBe('2026-11-17T00:00:00.000Z'); // 새벽 5시 → 그날 9시
  });
});
