// 요청한 쪽의 접속 IP 고르기
// x-forwarded-for의 '첫 값'은 요청하는 쪽이 마음대로 넣을 수 있어(위조 가능) 쓰지 않는다.
// 우선순위: cf-connecting-ip(Cloudflare가 덮어씀) → x-real-ip(게이트웨이) → x-forwarded-for의 '마지막' 값(가장 가까운 프록시가 붙인 값)
// Supabase가 공식으로 보장한 헤더가 아니라서, 어느 헤더에서 왔는지(source)를 함께 남기고 증거에는 '참고용'으로 표기한다.
export type IpSource = 'cf' | 'real' | 'xff-last' | 'none';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;
const valid = (v: string) => IPV4.test(v) ? v.split('.').every((n) => +n <= 255) : IPV6.test(v) && v.includes(':');

export function clientIp(h: { get(name: string): string | null }): { ip: string; source: IpSource } {
  const cf = (h.get('cf-connecting-ip') || '').trim();
  if (valid(cf)) return { ip: cf, source: 'cf' };
  const real = (h.get('x-real-ip') || '').trim();
  if (valid(real)) return { ip: real, source: 'real' };
  const parts = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  if (valid(last)) return { ip: last, source: 'xff-last' };
  return { ip: '', source: 'none' };
}
