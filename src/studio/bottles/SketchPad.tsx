import {useEffect, useRef, useState} from 'react';
import * as F from './vendor/fit.mjs';
import type {Point} from './vendor/fit.mjs';

const {w: W0, h: H0, axis: AX} = F.CANVAS;

/**
 * Draw the outline base to mouth (one side of the axis is enough), or upload a sketch or photo:
 * its outline is traced onto the pad, where it can be drawn over or cleared.
 */
export function SketchPad({strokes, setStrokes, read}: {strokes: Point[][]; setStrokes: (s: Point[][]) => void; read: F.Read | null}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Point[] | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [note, setNote] = useState('');
  const [, force] = useState(0);

  const paint = () => {
    const c = cv.current;
    if (!c) return;
    const w = c.getBoundingClientRect().width;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round((w * H0 / W0) * dpr);
    const g = c.getContext('2d')!;
    const k = c.width / W0;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W0, H0);
    if (img) {
      const s = Math.min(W0 / img.width, H0 / img.height);
      g.globalAlpha = 0.28;
      g.drawImage(img, (W0 - img.width * s) / 2, (H0 - img.height * s) / 2, img.width * s, img.height * s);
      g.globalAlpha = 1;
    }
    if (read) {
      const Hs = read.bot - read.top, cx = read.center;
      g.beginPath();
      read.r.forEach((v, j) => { const y = read.bot - F.FRACS[j] * Hs; if (j) g.lineTo(cx + v * Hs, y); else g.moveTo(cx + v * Hs, y); });
      for (let j = F.K - 1; j >= 0; j--) g.lineTo(cx - read.r[j] * Hs, read.bot - F.FRACS[j] * Hs);
      g.closePath();
      g.fillStyle = 'rgba(235, 211, 0, 0.32)';
      g.fill();
    }
    g.setLineDash([4, 6]); g.strokeStyle = '#b5b3ad'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(AX, 8); g.lineTo(AX, H0 - 8); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const st of all) {
      g.beginPath();
      st.forEach((q, j) => { if (j) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
      if (st.length === 1) g.lineTo(st[0].x + 0.1, st[0].y);
      g.stroke();
    }
  };

  useEffect(paint);
  useEffect(() => {
    const ro = new ResizeObserver(() => paint());
    if (cv.current) ro.observe(cv.current);
    return () => ro.disconnect();
  });

  const at = (e: React.PointerEvent): Point => {
    const r = cv.current!.getBoundingClientRect();
    return {x: ((e.clientX - r.left) * W0) / r.width, y: ((e.clientY - r.top) * H0) / r.height};
  };

  const upload = (f: File) => {
    const im = new Image();
    im.onload = () => {
      setImg(im);
      const s = Math.min(1, 700 / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      const g = c.getContext('2d')!;
      g.drawImage(im, 0, 0, c.width, c.height);
      const traced = F.traceImage(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (traced) { setStrokes(traced); setNote(''); } else setNote('No outline found. Trace it by hand over the image.');
    };
    im.src = URL.createObjectURL(f);
  };

  return (
    <div className="bs-pad">
      <canvas
        ref={cv} className="bs-pad-canvas" aria-label="Sketch pad: draw a bottle outline"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = [at(e)]; force(n => n + 1); }}
        onPointerMove={e => {
          const d = drawing.current;
          if (!d) return;
          const q = at(e), last = d[d.length - 1];
          if (Math.hypot(q.x - last.x, q.y - last.y) < 1.5) return;
          d.push(q); paint();
        }}
        onPointerUp={() => { const d = drawing.current; drawing.current = null; if (d) setStrokes([...strokes, d]); }}
        onPointerCancel={() => { drawing.current = null; force(n => n + 1); }}
      />
      {!strokes.length && !img && <p className="bs-pad-empty">Draw the outline, base to mouth</p>}
      <div className="bs-pad-tools">
        <button type="button" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={!strokes.length}>Undo</button>
        <button type="button" onClick={() => { setStrokes([]); setImg(null); setNote(''); }}>Clear</button>
        <label className="bs-file">Upload sketch<input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
        <select aria-label="Example sketches" value="" onChange={e => { if (e.target.value) { setImg(null); setStrokes(F.exampleStrokes(e.target.value)); } }}>
          <option value="">Examples</option>
          {Object.entries(F.EXAMPLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {note && <p className="bs-note">{note}</p>}
    </div>
  );
}
