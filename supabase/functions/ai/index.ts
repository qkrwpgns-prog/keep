// AI: 대화·캡처 추출, 재촉 문구, 송금 캡처 판독, 이행 촉구서 초안(스트리밍)
// 키가 없거나 한도(하루 AI_DAILY_LIMIT회)를 넘거나 응답 검증에 실패하면 { ai:false } → 화면이 규칙·템플릿으로 대체
import { handleAi, noticeInput } from '../_shared/aiActions.ts';
import { finishNotice, NOTICE_SYSTEM, type AiEnv } from '../_shared/ai.ts';
import { claudeClient } from '../_shared/claude.ts';
import { adminClient, context, cors, errorResponse, json, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'METHOD' }, 405);
  try {
    const admin = adminClient();
    const ctx = await context(req, admin);
    const db = supabaseDb(admin);
    const limit = Number(Deno.env.get('AI_DAILY_LIMIT') || 30);
    const env: AiEnv = {
      client: claudeClient(),
      fastModel: Deno.env.get('AI_MODEL_FAST') || 'claude-haiku-5-5',
      smartModel: Deno.env.get('AI_MODEL_SMART') || 'claude-opus-5-5',
      dailyLimit: limit,
      take: (u) => db.aiTake(u, limit),
    };
    const body = await req.json().catch(() => ({}));

    if (body.action !== 'notice') return json(req, await handleAi(db, ctx, env, body));

    // 촉구서: 텍스트를 받는 대로 흘려보낸다. 시작할 수 없으면 JSON으로 대체 안내
    const facts = await noticeInput(db, ctx, body.id);
    if (!env.client) return json(req, { ai: false, reason: 'NO_KEY' });
    if (!(await env.take(ctx.userId!))) return json(req, { ai: false, reason: 'LIMIT' });
    const client = env.client;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        try {
          const all = await client.stream({ model: env.smartModel, system: NOTICE_SYSTEM, prompt: facts, maxTokens: 4000, onText: (t) => ctrl.enqueue(enc.encode(t)) });
          // 고지 문구가 빠졌으면 끝에 붙인다(금지어 검사는 화면과 발송 시 서버에서 다시 한다)
          const fin = finishNotice(all);
          if (fin && fin.length > all.trim().length) ctrl.enqueue(enc.encode(fin.slice(all.trim().length)));
        } catch (e) {
          console.error('notice stream', (e as Error)?.message);
          ctrl.enqueue(enc.encode('\n\u0000FAILED'));
        } finally {
          ctrl.close();
        }
      },
    });
    return new Response(stream, { headers: { ...cors(req), 'Content-Type': 'text/plain; charset=utf-8', 'X-Keep-AI': '1', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return errorResponse(req, e);
  }
});
