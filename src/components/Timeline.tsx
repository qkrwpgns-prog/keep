import { useEffect, useState } from 'react';
import { stamp } from '@domain/dates.ts';
import { eventText, type EventRow } from '@domain/events.ts';
import { eventHash } from '@domain/canonical.ts';

/** 증거 타임라인 + 해시 체인 검증 결과 */
export function Timeline({ events, names }: { events: EventRow[]; names: { a: string; b: string } }) {
  const [chain, setChain] = useState<'checking' | 'ok' | 'bad'>('checking');
  useEffect(() => {
    let alive = true;
    (async () => {
      let prev: string | null = null;
      for (const e of events) {
        if (e.prev_hash !== prev || (await eventHash(prev, e.canon, e.created_at)) !== e.hash) { if (alive) setChain('bad'); return; }
        prev = e.hash;
      }
      if (alive) setChain('ok');
    })();
    return () => { alive = false; };
  }, [events]);
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>증거 타임라인</h2>
        {events.length > 0 && <span className={'pill ' + (chain === 'ok' ? 'ok' : chain === 'bad' ? 'seal' : '')}>{chain === 'ok' ? '기록 사슬 정상' : chain === 'bad' ? '기록 사슬 불일치' : '검사 중'}</span>}
      </div>
      <div className="tl" style={{ marginTop: 12 }}>
        {events.length === 0 && <div className="faint">기록이 없어요.</div>}
        {[...events].reverse().map((e) => {
          const t = eventText(e, names);
          const who = e.actor_role === 'A' ? names.a : e.actor_role === 'B' ? names.b : '키프';
          return (
            <div key={e.id} className={'ev ' + t.tone}>
              <b>{t.title}</b>
              <time>{stamp(e.created_at)}{e.sim_at ? ' · 시연 날짜 ' + e.sim_at : ''} · {who}</time>
              {t.detail && <div>{t.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
