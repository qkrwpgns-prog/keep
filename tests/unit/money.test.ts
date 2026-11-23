// 받을 돈·갚을 돈 현황 계산
import { describe, expect, it } from 'vitest';
import { moneySummary, type MoneyItem } from '../../supabase/functions/_shared/domain/money.ts';

const base = { tpl: 'loan' as const, title: '', amount: 300000, status: 'active' as const, deadline: '2026-12-01', installments: [], aName: '나', bName: '민수', isDemo: false };
const it_ = (id: string, myRole: 'A' | 'B', over: Partial<MoneyItem['doc']> = {}): MoneyItem => ({ doc: { ...base, id, code: id.toUpperCase(), ...over }, myRole });
const TODAY = '2026-11-23';

describe('받을 돈·갚을 돈', () => {
  const items = [
    it_('a1', 'A', { title: '민수 30만원', deadline: '2026-11-20' }), // 받을 돈, 3일 지남, 10만원 받음
    it_('a2', 'A', { bName: '지은', amount: 50000, deadline: '2026-12-10' }),
    it_('b1', 'B', { aName: '민수', bName: '나', amount: 80000, deadline: '2026-11-25' }), // 갚을 돈
    it_('a3', 'A', { status: 'pending_b', amount: 20000 }), // 서명 대기
    it_('a4', 'A', { status: 'done' }), // 완료
    it_('a5', 'A', { isDemo: true }), // 시연
    it_('t1', 'A', { tpl: 'lend', amount: null }), // 물건
    it_('a6', 'A', { amount: 40000, installments: [{ amount: 20000, date: '2026-11-10', paid: true }, { amount: 20000, date: '2026-11-30' }], deadline: '2026-11-30', bName: '지은' }),
  ];
  const s = moneySummary(items, {
    a1: [{ amount: 100000, confirmed_by_a: true }, { amount: 50000, confirmed_by_a: null }],
    a6: [{ amount: 20000, confirmed_by_a: true }],
  }, TODAY);

  it('진행 중 돈 약속만 합친다(서명 대기는 따로, 완료·시연·물건 제외)', () => {
    expect(s.rows.map((r) => r.id)).toEqual(['a1', 'b1', 'a6', 'a2']);
    expect(s.incoming).toEqual({ remaining: 200000 + 50000 + 20000, overdue: 200000, count: 3, paid: 120000 });
    expect(s.outgoing).toEqual({ remaining: 80000, overdue: 0, count: 1, paid: 0 });
    expect(s.waitingSign).toEqual({ in: 20000, out: 0 });
  });
  it('확인 대기 상환은 남은 금액에서 빼지 않는다', () => {
    expect(s.rows[0]).toMatchObject({ remaining: 200000, pending: 50000, overdue: true, daysLeft: -3 });
  });
  it('분할이면 다음 회차 날짜·금액', () => {
    expect(s.rows.find((r) => r.id === 'a6')).toMatchObject({ due: '2026-11-30', dueAmount: 20000, remaining: 20000 });
  });
  it('사람별 순액: 민수는 받을 20만 - 갚을 8만', () => {
    expect(s.people[0]).toEqual({ name: '민수', incoming: 200000, outgoing: 80000, net: 120000 });
    expect(s.people.find((p) => p.name === '지은')).toMatchObject({ incoming: 70000, net: 70000 });
  });
});
