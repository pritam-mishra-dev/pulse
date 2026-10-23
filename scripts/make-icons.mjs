// Glowing RGB ring with spikes, rendered per size with 4×4 supersampling so
// 16 px gets fewer, chunkier spikes instead of a blurred-down 128 px image.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};
function shade(x, y, size) {
  const d = Math.hypot(x, y);
  const ang = Math.atan2(y, x);
  const spikes = size <= 16 ? 8 : size <= 32 ? 12 : 24;
  const R = 0.5, ringW = size <= 16 ? 0.16 : 0.1;
  // Spike length varies like an audio spectrum frozen in time.
  const k = ((ang / (2 * Math.PI)) * spikes + spikes) % 1;
  const idx = Math.floor(((ang / (2 * Math.PI)) * spikes + spikes) % spikes);
  const len = 0.16 + 0.26 * Math.abs(Math.sin(idx * 2.4 + 1));
  const spikeHalf = (size <= 16 ? 0.32 : 0.22) * (1 - (d - R) / len);
  const inSpike = d > R && d < R + len && Math.abs(k - 0.5) < spikeHalf;
  const inRing = Math.abs(d - R) < ringW / 2;
  const glow = Math.exp(-Math.pow((d - R) / 0.12, 2)) * 0.55;
  const c = hsl(((ang * 180) / Math.PI + 360) % 360, 1, 0.6);
  if (inRing || inSpike) return [...c, 1];
  return [...c, glow];
}
function render(size) {
  const SS = 4, px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const [cr, cg, cb, ca] = shade(((x + (sx + 0.5) / SS) / size) * 2 - 1, ((y + (sy + 0.5) / SS) / size) * 2 - 1, size);
      r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
    }
    const i = (y * size + x) * 4;
    px[i] = a ? r / a : 0; px[i + 1] = a ? g / a : 0; px[i + 2] = a ? b / a : 0; px[i + 3] = (a / (SS * SS)) * 255;
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`icon${s}.png`, OUT), render(s));
writeFileSync(new URL('../icon-preview-256.png', import.meta.url), render(256));
console.log('icons written');
