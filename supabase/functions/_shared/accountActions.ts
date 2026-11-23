// 계정: 알림 이메일 변경(인증 코드 확인). 런타임 무관 → 로컬 테스트와 Edge Function이 같은 코드를 쓴다
import { ActionError, type Ctx } from './actions.ts';
import { sha256Hex } from './domain/canonical.ts';
import { DISCLAIMER } from './domain/templates.ts';
import { emailHtml } from './notify.ts';

export interface AccountDb {
  rateCheck(key: string, limit: number, windowSec: number): Promise<boolean>;
  loginEmail(userId: string): Promise<string | null>;
  emailSetPending(userId: string, email: string, codeHash: string): Promise<void>;
  emailSetDirect(userId: string, email: string): Promise<void>;
  emailVerify(userId: string, codeHash: string): Promise<'ok' | 'none' | 'expired' | 'locked' | 'mismatch'>;
}

const fail = (status: number, code: string, message: string): never => { throw new ActionError(status, code, message); };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const codeHash = (userId: string, code: string) => sha256Hex(`notify-email:${userId}:${code}`);

export function newCode(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1_000_000).padStart(6, '0');
}

export async function handleAccount(db: AccountDb, ctx: Ctx, b: Record<string, unknown>) {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  const uid = ctx.userId!;
  switch (b.action) {
    case 'email_request': {
      const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email)) fail(400, 'EMAIL', '이메일 주소를 확인해 주세요.');
      // 로그인 이메일은 이미 확인된 주소라 코드 없이 바로
      if (email === (await db.loginEmail(uid))?.toLowerCase()) {
        await db.emailSetDirect(uid, email);
        return { verified: true };
      }
      if (!(await db.rateCheck('email-code:' + uid, 5, 3600))) fail(429, 'RATE', '인증 코드는 1시간에 5번까지 받을 수 있어요.');
      const code = newCode();
      await db.emailSetPending(uid, email, await codeHash(uid, code));
      if (!ctx.senders) fail(500, 'MAIL', '메일을 보낼 수 없어요.');
      const body = `키프 알림을 이 주소로 받으려면 아래 코드를 키프 설정 화면에 입력해 주세요.\n\n${code}\n\n10분 동안 쓸 수 있어요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`;
      await ctx.senders!.email(email, `[키프] 알림 이메일 확인 코드 ${code}`, `${body}\n\n${DISCLAIMER}`, emailHtml('[키프] 알림 이메일 확인', body, null));
      return { sent: true };
    }
    case 'email_verify': {
      const code = String(b.code || '').replace(/\D/g, '');
      if (code.length !== 6) fail(400, 'CODE', '6자리 코드를 입력해 주세요.');
      const r = await db.emailVerify(uid, await codeHash(uid, code));
      if (r === 'ok') return { verified: true };
      const msg = { none: '먼저 인증 코드를 받아 주세요.', expired: '코드가 만료됐어요. 다시 받아 주세요.', locked: '여러 번 틀려서 잠겼어요. 코드를 다시 받아 주세요.', mismatch: '코드가 맞지 않아요.' }[r];
      return fail(400, r.toUpperCase(), msg);
    }
    default:
      return fail(400, 'ACTION', '알 수 없는 요청이에요.');
  }
}
