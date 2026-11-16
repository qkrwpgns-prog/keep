// Deno 전용: Anthropic 공식 SDK로 AiClient 구현. 키는 Supabase secret(ANTHROPIC_API_KEY)에서만 읽는다.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { AiClient } from './ai.ts';

export function claudeClient(): AiClient | null {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  return {
    async json({ model, system, content, schema, maxTokens }) {
      const r = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        // 빠른 추출·판독용: 생각은 짧게. 형식은 JSON 스키마로 고정
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{
          role: 'user',
          content: content.map((c) => c.type === 'text'
            ? { type: 'text' as const, text: c.text }
            : { type: 'image' as const, source: { type: 'base64' as const, media_type: c.mediaType, data: c.data } }),
        }],
      });
      if (r.stop_reason === 'refusal') throw new Error('refusal');
      if (r.stop_reason === 'max_tokens') throw new Error('max_tokens');
      const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return JSON.parse(text);
    },
    async stream({ model, system, prompt, maxTokens, onText }) {
      // 상위 모델 + 서버 측 대체 모델(거절 시 같은 요청을 다른 모델로 이어서 처리)
      const s = client.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: prompt }],
      });
      let all = '';
      for await (const ev of s) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { all += ev.delta.text; onText(ev.delta.text); }
      }
      const fin = await s.finalMessage();
      if (fin.stop_reason === 'refusal') throw new Error('refusal');
      return all;
    },
  };
}
