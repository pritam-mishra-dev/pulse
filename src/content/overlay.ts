// The canvas that frames the player. Fixed-position on <body> so it can draw
// *outside* the player (the player clips its own overflow), with
// pointer-events: none so every YouTube control underneath stays clickable.

import { layoutPerimeter, type Perimeter } from './perimeter';
import type { PlayerKind } from './player-locator';

/**
 * Above page content, below YouTube's chrome: the masthead sits around
 * z-index 2020 and popups/menus above that, so spikes slide *under* the top
 * bar when the player scrolls up instead of painting over it.
 */
const Z_INDEX = '2000';
const MAX_DPR = 2;
/** The miniplayer is small; full-size spikes would dwarf it. */
const MINIPLAYER_SCALE = 0.5;

export class Overlay {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  private player: HTMLElement | null = null;
  private kind: PlayerKind = 'watch';
  private resizeObs = new ResizeObserver(() => (this.dirty = true));
  private dirty = true;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  /** Player size within the canvas. */
  w = 0;
  h = 0;
  margin = 60;
  visible = false;
  perimeter: Perimeter | null = null;
  private layoutKey = '';

  constructor(public spikeLength: number, public bands: number, public mirrored: boolean) {
    const c = this.canvas;
    c.id = 'pulse-overlay';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: Z_INDEX, display: 'none' });
    this.ctx = c.getContext('2d')!;
    document.body.appendChild(c);
    // Scroll/resize only mark dirty; the rect is read once, inside rAF.
    window.addEventListener('scroll', this.markDirty, { capture: true, passive: true });
    window.addEventListener('resize', this.markDirty, { passive: true });
  }

  markDirty = () => {
    this.dirty = true;
  };

  setPlayer(player: HTMLElement | null, kind: PlayerKind) {
    if (player === this.player && kind === this.kind) return;
    if (this.player) this.resizeObs.unobserve(this.player);
    this.player = player;
    this.kind = kind;
    if (player) this.resizeObs.observe(player);
    this.dirty = true;
  }

  /** Called at the top of each frame; cheap unless something moved. */
  sync() {
    if (!this.dirty) return;
    this.dirty = false;
    const p = this.player;
    const r = p?.getBoundingClientRect();
    if (!p || !r || r.width < 2 || r.height < 2) {
      this.hide();
      return;
    }
    const margin = Math.round(this.spikeLength * (this.kind === 'miniplayer' ? MINIPLAYER_SCALE : 1)) + 4;
    const cssW = Math.round(r.width + margin * 2);
    const cssH = Math.round(r.height + margin * 2);
    // Clamped at 2: beyond that the canvas costs 2.25×+ the fill rate for no visible gain.
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const s = this.canvas.style;
    s.transform = `translate(${Math.round(r.left - margin)}px, ${Math.round(r.top - margin)}px)`;
    if (cssW !== this.cssW || cssH !== this.cssH || dpr !== this.dpr) {
      this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
      s.width = `${cssW}px`;
      s.height = `${cssH}px`;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.margin = margin;
    this.w = r.width;
    this.h = r.height;
    const radius = this.radiusOf(p);
    const key = `${Math.round(r.width)}|${Math.round(r.height)}|${radius}|${this.bands}|${this.mirrored}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.perimeter = layoutPerimeter(r.width, r.height, radius, this.bands, this.mirrored, this.perimeter ?? undefined);
    }
    if (!this.visible) {
      s.display = 'block';
      this.visible = true;
    }
  }

  /**
   * YouTube rounds the player via an ancestor (ytd-player, 12 px) that clips
   * #movie_player, so look a few levels up for the effective radius.
   */
  private radiusOf(el: HTMLElement): number {
    let best = 0;
    for (let e: HTMLElement | null = el, i = 0; e && i < 4; e = e.parentElement, i++) {
      best = Math.max(best, parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0);
    }
    return best;
  }

  /** Reset the transform to DPR scale with the player's top-left at the origin. */
  beginFrame() {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, this.margin * this.dpr, this.margin * this.dpr);
  }

  invalidateLayout() {
    this.layoutKey = '';
    this.dirty = true;
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.canvas.style.display = 'none';
    this.clear();
  }

  get effectiveLength(): number {
    return this.margin - 4;
  }

  destroy() {
    this.resizeObs.disconnect();
    window.removeEventListener('scroll', this.markDirty, { capture: true });
    window.removeEventListener('resize', this.markDirty);
    this.canvas.remove();
  }
}
