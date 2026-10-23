// Places spikes on a rounded rectangle: each gets a point and an outward
// normal. Recomputed only when the player's size or radius changes; the render
// loop just reads the typed arrays.

export interface Perimeter {
  count: number;
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  /** Which band drives each spike. */
  band: Uint16Array;
  /** 0–1 position used for color (mirrored spikes share their twin's hue). */
  pos: Float32Array;
}

/**
 * Point at arc length `s` along a w×h rounded rect, starting at bottom centre
 * and running clockwise on screen (left along the bottom, up the left side…).
 * Writes into `out` to stay allocation-free.
 */
function pointAt(s: number, w: number, h: number, r: number, out: Float32Array) {
  const cx = w / 2;
  const straightH = w - 2 * r;
  const straightV = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const segs = [cx - r, arc, straightV, arc, straightH, arc, straightV, arc, cx - r];
  let i = 0;
  while (i < segs.length - 1 && s > segs[i]!) s -= segs[i++]!;
  const corner = (ccx: number, ccy: number, a0: number) => {
    const a = a0 + (r > 0 ? s / r : 0);
    out[0] = ccx + r * Math.cos(a); out[1] = ccy + r * Math.sin(a);
    out[2] = Math.cos(a); out[3] = Math.sin(a);
  };
  const line = (x: number, y: number, nx: number, ny: number) => { out[0] = x; out[1] = y; out[2] = nx; out[3] = ny; };
  switch (i) {
    case 0: return line(cx - s, h, 0, 1);
    case 1: return corner(r, h - r, Math.PI / 2);
    case 2: return line(0, h - r - s, -1, 0);
    case 3: return corner(r, r, Math.PI);
    case 4: return line(r + s, 0, 0, -1);
    case 5: return corner(w - r, r, (3 * Math.PI) / 2);
    case 6: return line(w, r + s, 1, 0);
    case 7: return corner(w - r, h - r, 0);
    default: return line(w - r - s, h, 0, 1);
  }
}

export function perimeterLength(w: number, h: number, r: number): number {
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
}

/**
 * Mirrored: bass at bottom centre, rising up both sides symmetrically, treble
 * meeting at top centre — reads as deliberate rather than lopsided.
 * Loop: bands run once around clockwise.
 */
export function layoutPerimeter(w: number, h: number, radius: number, bands: number, mirrored: boolean, prev?: Perimeter): Perimeter {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const count = mirrored ? bands * 2 : bands;
  const p =
    prev && prev.count === count
      ? prev
      : { count, x: new Float32Array(count), y: new Float32Array(count), nx: new Float32Array(count), ny: new Float32Array(count), band: new Uint16Array(count), pos: new Float32Array(count) };
  const L = perimeterLength(w, h, r);
  const tmp = new Float32Array(4);
  for (let i = 0; i < bands; i++) {
    const t = (i + 0.5) / bands;
    if (mirrored) {
      pointAt(t * (L / 2), w, h, r, tmp);
      // Left half follows the path; the right half is its reflection.
      set(p, i, tmp[0]!, tmp[1]!, tmp[2]!, tmp[3]!, i, t);
      set(p, bands + i, w - tmp[0]!, tmp[1]!, -tmp[2]!, tmp[3]!, i, t);
    } else {
      pointAt(t * L, w, h, r, tmp);
      set(p, i, tmp[0]!, tmp[1]!, tmp[2]!, tmp[3]!, i, t);
    }
  }
  return p;
}

function set(p: Perimeter, j: number, x: number, y: number, nx: number, ny: number, band: number, pos: number) {
  p.x[j] = x; p.y[j] = y; p.nx[j] = nx; p.ny[j] = ny; p.band[j] = band; p.pos[j] = pos;
}
