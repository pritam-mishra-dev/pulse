// Drawing styles. Phase 2: Spikes with RGB Flow. Allocation-free per frame —
// colors come from a precomputed 360-entry table instead of building an
// hsl() string for every spike on every frame.

import type { Perimeter } from './perimeter';

const HUE_LUT: string[] = Array.from({ length: 360 }, (_, h) => `hsl(${h} 100% 60%)`);

export interface DrawParams {
  bands: Float32Array;
  length: number;
  thickness: number;
  /** Degrees per second. */
  rainbowSpeed: number;
  now: number;
}

export function drawSpikes(g: CanvasRenderingContext2D, p: Perimeter, o: DrawParams) {
  const shift = (o.now / 1000) * o.rainbowSpeed;
  const half = o.thickness / 2;
  for (let j = 0; j < p.count; j++) {
    const v = o.bands[p.band[j]!]!;
    if (v < 0.01) continue;
    const len = v * o.length;
    const x = p.x[j]!;
    const y = p.y[j]!;
    const nx = p.nx[j]!;
    const ny = p.ny[j]!;
    // Tangent = normal rotated 90°: the spike's base runs along the border.
    const tx = -ny * half;
    const ty = nx * half;
    g.fillStyle = HUE_LUT[Math.floor((p.pos[j]! * 360 + shift) % 360)]!;
    g.beginPath();
    g.moveTo(x + tx, y + ty);
    g.lineTo(x + nx * len, y + ny * len);
    g.lineTo(x - tx, y - ty);
    g.closePath();
    g.fill();
  }
}
