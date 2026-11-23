import { describe, expect, it } from 'vitest';
import { addMonthsClamp, describeRepeat, repeatError, repeatPlan } from '../../supabase/functions/_shared/domain/repeat.ts';

describe('반복 약속', () => {
  it('매달: 같은 날, 없는 날은 그 달 마지막 날', () => {
    expect(addMonthsClamp('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamp('2026-11-30', 3)).toBe('2027-02-28');
    expect(repeatPlan({ every: 'month', count: 3, per: 50000, first: '2026-12-25' }).map((x) => x.date)).toEqual(['2026-12-25', '2027-01-25', '2027-02-25']);
  });
  it('매주: 7일 간격', () => {
    expect(repeatPlan({ every: 'week', count: 3, per: 10000, first: '2026-11-27' }).map((x) => x.date)).toEqual(['2026-11-27', '2026-12-04', '2026-12-11']);
  });
  it('설명은 규칙 모양일 때만', () => {
    expect(describeRepeat(repeatPlan({ every: 'month', count: 12, per: 50000, first: '2026-12-25' }))).toBe('매달 25일 50,000원씩 12회');
    expect(describeRepeat(repeatPlan({ every: 'month', count: 4, per: 50000, first: '2026-11-30' }))).toBe('매달 30일 50,000원씩 4회');
    expect(describeRepeat(repeatPlan({ every: 'week', count: 4, per: 9000, first: '2026-11-27' }))).toBe('매주 금요일 9,000원씩 4회');
    expect(describeRepeat([{ amount: 100000, date: '2026-12-01' }, { amount: 200000, date: '2027-01-01' }])).toBeNull();
    expect(describeRepeat([{ amount: 100000, date: '2026-12-01' }, { amount: 100000, date: '2026-12-15' }])).toBeNull();
  });
  it('규칙 검사', () => {
    const ok = { every: 'month' as const, count: 12, per: 50000, first: '2026-12-25' };
    expect(repeatError(ok, '2026-11-23')).toBeNull();
    expect(repeatError({ ...ok, count: 1 }, '2026-11-23')).toContain('2~24회');
    expect(repeatError({ ...ok, count: 25 }, '2026-11-23')).toContain('2~24회');
    expect(repeatError({ ...ok, first: '2026-11-01' }, '2026-11-23')).toContain('오늘이나');
    expect(repeatError({ ...ok, per: 0 }, '2026-11-23')).toContain('금액');
  });
});
