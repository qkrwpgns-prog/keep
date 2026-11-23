import { useEffect, useRef } from 'react';
import { strokesToVector, normName } from '@domain/signature.ts';
import type { SigShown } from '@domain/types.ts';

export type Strokes = [number, number][][];

/** 서버로 보낼 서명: 이름 입력 모드면 { typed }, 아니면 획 벡터. 비었거나 이름이 다르면 오류 문구 */
export function signaturePayload(strokes: Strokes, typed: string | null | undefined, name: string): { sig: SigShown } | { error: string } {
  if (typed != null) {
    const t = typed.trim();
    if (!t) return { error: '서명할 이름을 입력해 주세요.' };
    if (normName(t) !== normName(name)) return { error: `증서에 적힌 이름(${name})과 똑같이 입력해 주세요.` };
    return { sig: { typed: t } };
  }
  const sv = strokesToVector(strokes);
  return sv ? { sig: sv } : { error: '서명 칸에 손가락으로 서명해 주세요.' };
}

/**
 * 손글씨 서명 패드 (legacy mountPad 이식). 획은 캔버스 좌표(560×170)로 부모에 전달.
 * onTyped를 주면 '이름 입력으로 서명'(손으로 쓰기 어려운 사람·화면 낭독기 사용자용)을 고를 수 있다.
 */
export function SignaturePad({ value, onChange, typed, onTyped, name }: { value: Strokes; onChange: (s: Strokes) => void; typed?: string | null; onTyped?: (t: string | null) => void; name?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Strokes>(value);
  const cur = useRef<[number, number][] | null>(null);

  const redraw = () => {
    const c = ref.current!, ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f1b2d'; ctx.lineWidth = 3.2;
    strokes.current.forEach((s) => {
      ctx.beginPath();
      s.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      ctx.stroke();
    });
  };

  useEffect(() => { strokes.current = value; redraw(); }, [value]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = ref.current!, r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height];
  };
  const end = () => { if (cur.current) { cur.current = null; onChange(strokes.current.map((s) => s.slice())); } };

  if (onTyped && typed != null) {
    return (
      <>
        <label className="f" htmlFor="typed-sig">이름 입력 서명</label>
        <input id="typed-sig" className="i" autoComplete="name" placeholder={name || '이름'} value={typed} maxLength={40} onChange={(e) => onTyped(e.target.value)} aria-describedby="typed-sig-help" />
        <div className="typed-preview" aria-hidden="true">{typed.trim() || name || ''}</div>
        <p id="typed-sig-help" className="faint" style={{ marginTop: 4 }}>증서에 적힌 이름{name ? `(${name})` : ''}과 똑같이 입력해 주세요. 손글씨처럼 서명 시각·로그인 계정·기기 정보가 함께 기록되고, 증서에는 '이름 입력 서명'으로 표시돼요.</p>
        <div className="row end" style={{ marginTop: 6 }}>
          <button type="button" className="btn small ghost" onClick={() => onTyped(null)}>손글씨로 서명하기</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pad-wrap">
        <canvas
          ref={ref} width={560} height={170} aria-label="손글씨 서명 칸"
          onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 무시 */ } cur.current = [pos(e)]; strokes.current = [...strokes.current, cur.current]; redraw(); }}
          onPointerMove={(e) => { if (!cur.current) return; e.preventDefault(); cur.current.push(pos(e)); redraw(); }}
          onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
        />
        {!value.length && <div className="ph">여기에 서명해 주세요</div>}
      </div>
      <div className="row end" style={{ marginTop: 6 }}>
        {onTyped && <button type="button" className="btn small ghost" onClick={() => onTyped('')}>손으로 쓰기 어렵나요? 이름 입력으로 서명</button>}
        <button type="button" className="btn small ghost" onClick={() => { strokes.current = []; onChange([]); }}>지우기</button>
      </div>
    </>
  );
}
