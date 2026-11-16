import { useEffect, useRef } from 'react';

export type Strokes = [number, number][][];

/** 손글씨 서명 패드 (legacy mountPad 이식). 획은 캔버스 좌표(560×170)로 부모에 전달 */
export function SignaturePad({ value, onChange }: { value: Strokes; onChange: (s: Strokes) => void }) {
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
        <button type="button" className="btn small ghost" onClick={() => { strokes.current = []; onChange([]); }}>지우기</button>
      </div>
    </>
  );
}
