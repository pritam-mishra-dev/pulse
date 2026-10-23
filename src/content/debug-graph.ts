// Phase-1 diagnostic: a small bar graph in the corner proving audio is
// flowing (bands, peak caps, beats, capture state). Off via settings.debugGraph.
// Also mirrors key numbers into data-* attributes for the e2e test.

import type { AudioEngine, CaptureState } from './audio-engine';

const W = 280;
const H = 96;

export class DebugGraph {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private frames = 0;
  private fpsT = 0;
  private fps = 0;

  constructor() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.canvas;
    c.id = 'pulse-debug-graph';
    c.width = W * dpr;
    c.height = H * dpr;
    Object.assign(c.style, {
      position: 'fixed', left: '12px', bottom: '12px', width: `${W}px`, height: `${H}px`,
      zIndex: '2000', pointerEvents: 'none', borderRadius: '10px',
      background: 'rgba(10,10,14,.82)', boxShadow: '0 0 0 1px rgba(255,255,255,.12)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.ctx = c.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    document.body.appendChild(c);
  }

  draw(engine: AudioEngine, now: number, drawMs: number) {
    this.frames++;
    if (now - this.fpsT >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT);
      this.frames = 0;
      this.fpsT = now;
    }
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    const n = engine.bands.length;
    const bw = (W - 16) / n;
    const base = H - 8;
    const maxH = H - 30;
    for (let i = 0; i < n; i++) {
      const h = engine.bands[i]! * maxH;
      g.fillStyle = `hsl(${(i / n) * 300} 100% 60%)`;
      g.fillRect(8 + i * bw, base - h, Math.max(1, bw - 1), h);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillRect(8 + i * bw, base - engine.caps[i]! * maxH - 2, Math.max(1, bw - 1), 1.5);
    }
    g.fillStyle = `rgba(255,60,120,${0.25 + engine.beat * 0.75})`;
    g.beginPath();
    g.arc(W - 14, 13, 5 + engine.beat * 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(`PULSE ${engine.state} · ${n} bands · ${this.fps.toFixed(0)} fps · ${drawMs.toFixed(2)} ms · beats ${engine.beatCount}`, 8, 14);
    const d = this.canvas.dataset;
    d.state = engine.state;
    d.level = engine.level.toFixed(3);
    d.beats = String(engine.beatCount);
    d.fps = this.fps.toFixed(0);
    d.ms = drawMs.toFixed(2);
  }

  showState(state: CaptureState) {
    this.canvas.dataset.state = state;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    const msg: Record<CaptureState, string> = {
      idle: 'no video', waiting: 'waiting for play / click to start audio', running: 'paused',
      taken: 'audio is used by another extension', unavailable: 'audio capture unavailable',
    };
    g.fillText(`PULSE · ${msg[state]}`, 8, 14);
  }

  remove() {
    this.canvas.remove();
  }
}
