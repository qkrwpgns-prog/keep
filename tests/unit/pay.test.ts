import { describe, expect, it } from 'vitest';
import { cleanKakaoUrl, cleanTossId, tossUrl } from '../../supabase/functions/_shared/domain/pay.ts';

describe('송금 바로가기 링크', () => {
  it('토스 아이디: 여러 형태를 아이디로, 이상한 값은 null, 빈 값은 빈 문자열', () => {
    expect(cleanTossId('https://toss.me/keep_jh/')).toBe('keep_jh');
    expect(cleanTossId('toss.me/keep.jh/30000')).toBe('keep.jh');
    expect(cleanTossId('@keepjh')).toBe('keepjh');
    expect(cleanTossId('한글아이디')).toBeNull();
    expect(cleanTossId('  ')).toBe('');
  });
  it('카카오페이: qr.kakaopay.com 주소만', () => {
    expect(cleanKakaoUrl('qr.kakaopay.com/Ej7AbC123')).toBe('https://qr.kakaopay.com/Ej7AbC123');
    expect(cleanKakaoUrl('https://qr.kakaopay.com/Ej7AbC123?utm=x')).toBe('https://qr.kakaopay.com/Ej7AbC123');
    expect(cleanKakaoUrl('https://evil.com/qr.kakaopay.com.x')).toBeNull();
    expect(cleanKakaoUrl('https://evil.com/qr.kakaopay.com/Ej7AbC123')).toBeNull();
    expect(cleanKakaoUrl('')).toBe('');
  });
  it('토스 링크에 금액을 붙인다', () => {
    expect(tossUrl('keep_jh', 150000)).toBe('https://toss.me/keep_jh/150000');
    expect(tossUrl('keep_jh', null)).toBe('https://toss.me/keep_jh');
  });
});

import { pRo } from '../../supabase/functions/_shared/domain/korean.ts';
describe('조사 (으)로', () => {
  it('받침 없음·ㄹ받침은 로, 그 밖은 으로', () => {
    expect(['김민수', '박제훈', '서울', 'abc'].map(pRo)).toEqual(['로', '으로', '로', '(으)로']);
  });
});
