// AI 경로: Claude 대신 가짜 클라이언트로 검증·대체 동작을 확인한다(키 없이 실행)
import { describe, expect, it } from 'vitest';
import { aiExtract, aiNudge, aiProof, compareProof, finishNotice, validateExtract, type AiClient, type AiEnv } from '../../supabase/functions/_shared/ai.ts';
import { EXAMPLES } from '../../supabase/functions/_shared/domain/examples.ts';
import { ruleCheck, ruleExtract } from '../../supabase/functions/_shared/domain/rules.ts';
import { checkBanned } from '../../supabase/functions/_shared/domain/nudge.ts';

const NOW = new Date('2026-11-16T05:00:00Z'); // 2026-11-16(월) 14시 KST
const TODAY = '2026-11-16';
const env = (client: AiClient | null, ok = true): AiEnv => ({ client, fastModel: 'fast', smartModel: 'smart', dailyLimit: 30, take: async () => ok });
const fake = (out: unknown | (() => unknown)): AiClient => ({
  json: async () => (typeof out === 'function' ? (out as () => unknown)() : out),
  stream: async ({ onText }) => { onText('x'); return 'x'; },
});

describe('예시 대화 5개 — 규칙 기반(키 없을 때 대체 경로)', () => {
  const r = Object.fromEntries(EXAMPLES.map((e) => [e.key, ruleExtract({ raw: e.text, tpl: e.tpl, myName: e.myName }, TODAY)]));
  it('차용: 금액·기한·방법·상대·어겼을 때', () => {
    expect(r.loan).toMatchObject({ bName: '민수', amount: 300000, deadline: '2026-12-15', method: '계좌이체' });
  });
  it('대여: 물건·기한(다음 주 금요일)·방법', () => {
    expect(r.lend).toMatchObject({ bName: '김하늘', deadline: '2026-11-27', method: '직접 전달' });
    expect(r.lend.item).toContain('스위치');
  });
  it('역할: 맡은 일·기한', () => {
    expect(r.team.bName).toBe('최수빈');
    expect(r.team.deadline).toBe('2026-12-03');
    expect(r.team.task).toContain('PPT');
  });
  it('정산: 금액·방법', () => {
    expect(r.split).toMatchObject({ bName: '오태양', amount: 80000, method: '토스 송금' });
  });
  it('모호: 기한·내용이 비고, 확인 질문이 나온다', () => {
    expect(r.vague.deadline).toBe('');
    const q = ruleCheck({ ...r.vague, aName: '윤도현' }, 'pledge', TODAY);
    expect(q.some((x) => x.includes('기한'))).toBe(true);
  });
});

describe('AI 추출', () => {
  const good = { template: 'loan', title: '민수 30만원', aName: '박제훈', bName: '민수', amount: 300000, item: '', task: '', deadline: '2026-12-15', method: '계좌이체', penalty: '늦으면 밥 한 번 사기', questions: ['민수 님의 성을 포함한 실명을 확인해 주세요.'], quote: '민수: 다음 달 15일에 알바비 들어오면 바로 계좌로 보낼게!' };
  it('검증을 통과하면 그대로 쓴다', async () => {
    const r = await aiExtract(env(fake(good)), 'u', NOW, { text: EXAMPLES[0].text, myName: '박제훈' });
    expect(r).toEqual({ ai: true, data: { ...good } });
  });
  it('키가 없으면 NO_KEY, 한도를 넘으면 LIMIT → 화면은 규칙 기반으로', async () => {
    expect(await aiExtract(env(null), 'u', NOW, { text: 'x' })).toEqual({ ai: false, reason: 'NO_KEY' });
    expect(await aiExtract(env(fake(good), false), 'u', NOW, { text: 'x' })).toEqual({ ai: false, reason: 'LIMIT' });
  });
  it('스키마가 틀리면 INVALID, 호출이 실패하면 FAILED', async () => {
    expect(await aiExtract(env(fake({ template: 'rent' })), 'u', NOW, { text: 'x' })).toEqual({ ai: false, reason: 'INVALID' });
    expect(await aiExtract(env(fake(() => { throw new Error('boom'); })), 'u', NOW, { text: 'x' })).toEqual({ ai: false, reason: 'FAILED' });
  });
  it('원문에 없는 이름·인용은 비우고, 이상한 날짜·금액은 버린다', () => {
    const v = validateExtract({ ...good, bName: '홍길동', quote: '지어낸 문장', deadline: '2026-02-30', amount: -5 }, EXAMPLES[0].text)!;
    expect(v).toMatchObject({ bName: '', quote: '', deadline: '', amount: null });
  });
  it('질문은 최대 4개', () => {
    expect(validateExtract({ ...good, questions: ['a', 'b', 'c', 'd', 'e'] }, null)!.questions).toHaveLength(4);
  });
});

describe('AI 재촉 문구', () => {
  const doc = { tpl: 'loan' as const, title: '민수 30만원', amount: 300000, item: '', task: '', aName: '박제훈', bName: '김민수', deadline: '2026-11-13' };
  it('금지어가 섞인 안은 같은 자리의 템플릿 문구로 바뀌고, 모자라면 채운다', async () => {
    const r = await aiNudge(env(fake({ messages: [{ label: '단호', text: '안 갚으면 고소하겠다 진짜로' }, { label: '안부', text: '민수야 잘 지내? 30만원 건 언제쯤 가능할지 알려줘!' }] })), 'u', { doc, stage: 3, rel: '친구', tone: 3, previous: [], today: TODAY });
    expect(r.ai).toBe(true);
    if (!r.ai) return;
    expect(r.data).toHaveLength(3);
    expect(r.data[1].text).toContain('잘 지내');
    for (const m of r.data) expect(checkBanned(m.text)).toBeNull();
  });
});

describe('송금 캡처 판독', () => {
  it('약속 금액·남은 금액과 비교', () => {
    expect(compareProof({ readable: true, amount: 150000, date: '2026-11-16', sender: '김민수', receiver: '박제훈' }, 150000, 300000)).toMatchObject({ matchesExpected: true, withinRemaining: true });
    expect(compareProof({ readable: true, amount: 350000, date: '', sender: '', receiver: '' }, 300000, 300000)).toMatchObject({ matchesExpected: false, withinRemaining: false });
  });
  it('읽을 수 없는 화면이면 값을 비운다, 계좌번호 같은 긴 숫자는 가린다', async () => {
    const r = await aiProof(env(fake({ readable: false, amount: 5, date: 'x', sender: 'y', receiver: 'z' })), 'u', NOW, { mediaType: 'image/jpeg', data: 'AAAA' }, 300000, 300000);
    expect(r).toMatchObject({ ai: true, data: { readable: false, amount: null } });
    const r2 = await aiProof(env(fake({ readable: true, amount: 300000, date: '2026-11-16', sender: '김민수 1234567890', receiver: '박제훈' })), 'u', NOW, { mediaType: 'image/jpeg', data: 'AAAA' }, 300000, 300000);
    expect(r2.ai && r2.data.sender).toBe('김민수 ****');
  });
});

describe('촉구서 다듬기', () => {
  it('고지 문구가 없으면 붙이고, 마크다운 기호를 지운다', () => {
    const t = finishNotice('## 이행 촉구서\n**수신**: 김민수')!;
    expect(t).toContain('법률 자문이 아닙니다');
    expect(t).not.toContain('**');
  });
  it('금지어가 있으면 null(→ 템플릿 사용)', () => {
    expect(finishNotice('이행 촉구서\n안 갚으면 고소하겠다')).toBeNull();
  });
});
