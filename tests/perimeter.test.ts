import { describe, expect, it } from 'vitest';
import { layoutPerimeter } from '../src/content/perimeter';

describe('perimeter', () => {
  const W = 960, H = 540, R = 12;

  it('puts every point on the rounded rect with a unit outward normal', () => {
    const p = layoutPerimeter(W, H, R, 96, false);
    for (let j = 0; j < p.count; j++) {
      const x = p.x[j]!, y = p.y[j]!;
      expect(Math.hypot(p.nx[j]!, p.ny[j]!)).toBeCloseTo(1, 4);
      const onEdge = Math.abs(x) < 0.01 || Math.abs(x - W) < 0.01 || Math.abs(y) < 0.01 || Math.abs(y - H) < 0.01;
      const onCorner = [[R, R], [W - R, R], [R, H - R], [W - R, H - R]].some(([cx, cy]) => Math.abs(Math.hypot(x - cx!, y - cy!) - R) < 0.01);
      expect(onEdge || onCorner, `point ${j} (${x}, ${y})`).toBe(true);
      // Outward: moving along the normal leaves the rectangle's centre behind.
      expect((x - W / 2) * p.nx[j]! + (y - H / 2) * p.ny[j]!).toBeGreaterThan(0);
    }
  });

  it('mirrors bass at bottom centre and treble at top centre', () => {
    const p = layoutPerimeter(W, H, R, 48, true);
    expect(p.count).toBe(96);
    expect(p.y[0]).toBeCloseTo(H, 3); // band 0 = bass, bottom edge
    expect(Math.abs(p.x[0]! - W / 2)).toBeLessThan(W / 20);
    expect(p.y[47]).toBeCloseTo(0, 3); // last band = treble, top edge
    for (let i = 0; i < 48; i++) {
      expect(p.x[48 + i]).toBeCloseTo(W - p.x[i]!, 3);
      expect(p.y[48 + i]).toBeCloseTo(p.y[i]!, 3);
      expect(p.band[48 + i]).toBe(i);
    }
  });

  it('spaces spikes evenly along the path', () => {
    const p = layoutPerimeter(W, H, 0, 64, false);
    const gaps: number[] = [];
    for (let j = 1; j < p.count; j++) gaps.push(Math.abs(p.x[j]! - p.x[j - 1]!) + Math.abs(p.y[j]! - p.y[j - 1]!));
    const L = 2 * (W + H);
    // Manhattan distance equals arc length except where a step turns a corner.
    expect(gaps.filter((g) => Math.abs(g - L / 64) < 0.5).length).toBeGreaterThan(55);
  });
});
