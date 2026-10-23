// Phase-1 smoke test against live YouTube / YouTube Music.
//   CHROME_PATH=/path/to/chrome-for-testing npm run e2e
// (Branded Chrome ignores --load-extension; use `npx @puppeteer/browsers install chrome@stable`.)
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL(process.env.E2E_DIST ?? '../dist-dev/', import.meta.url));
const VIDEO = process.env.E2E_VIDEO ?? 'aqz-KE-bpKQ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  pipe: true,
  enableExtensions: [DIST],
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US'],
  defaultViewport: { width: 1400, height: 900 },
});
// The debug graph is how this test reads engine state; it is off by default.
const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/src/popup/index.html`);
await ext.evaluate(async () => {
  const k = 'pulse.settings';
  const s = (await chrome.storage.sync.get(k))[k] ?? {};
  await chrome.storage.sync.set({ [k]: { ...s, version: 1, debugGraph: true } });
});
await ext.close();
const errors = [];
const watchErrors = (page) => {
  page.on('console', (m) => m.type() === 'error' && /chrome-extension:|pulse/i.test(m.text() + (m.location()?.url ?? '')) && errors.push(m.text()));
  page.on('pageerror', (e) => /pulse|chrome-extension:/i.test(String(e.stack ?? e)) && errors.push(String(e)));
};
const graph = (page) => page.evaluate(() => {
  const g = document.querySelectorAll('#pulse-debug-graph');
  const v = document.querySelector('#movie_player video, ytmusic-player video');
  return { count: g.length, ...(g[0] ? { ...g[0].dataset } : {}), t: v ? +v.currentTime.toFixed(1) : null, paused: v?.paused, muted: v?.muted, url: location.pathname + location.search };
});
const play = (page) => page.evaluate(() => { const v = document.querySelector('#movie_player video, ytmusic-player video'); v?.play().catch(() => {}); });

const page = await browser.newPage();
watchErrors(page);
await page.goto(`https://www.youtube.com/watch?v=${VIDEO}&t=30s`, { waitUntil: 'networkidle2', timeout: 60000 });
await play(page);
await sleep(8000);
let g = await graph(page);
const t1 = g.t;
console.log(JSON.stringify(g));
check('debug graph present (exactly one)', g.count === 1);
check('audio captured and running', g.state === 'running', g.state);
check('band data flowing', Number(g.level) > 0.02, `level ${g.level}`);
check('beats detected', Number(g.beats) > 3, `${g.beats} beats in ~8 s`);
check('render loop near 60 fps', Number(g.fps) >= 50, `${g.fps} fps`);
await sleep(3000);
g = await graph(page);
check('playback keeps running through our graph', g.t > t1 + 2 && !g.paused && !g.muted, `t ${t1} → ${g.t}`);
await page.screenshot({ path: `${process.env.E2E_OUT ?? '.'}/phase1-watch.png` });

// ---- Phase 2: overlay around the player
const overlay = (pg) => pg.evaluate(() => {
  const c = document.querySelectorAll('#pulse-overlay');
  const cv = c[0];
  const p = document.querySelector('#movie_player, #shorts-player');
  if (!cv || !p) return { count: c.length };
  const cr = cv.getBoundingClientRect(), pr = p.getBoundingClientRect();
  // Count drawn pixels in the margin band (outside the player).
  const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
  const sx = cv.width / cr.width;
  let outside = 0, inside = 0;
  for (let y = 0; y < cv.height; y += 3) for (let x = 0; x < cv.width; x += 3) {
    if (d[(y * cv.width + x) * 4 + 3] < 20) continue;
    const cx = cr.left + x / sx, cy = cr.top + y / sx;
    const inP = cx > pr.left + 2 && cx < pr.right - 2 && cy > pr.top + 2 && cy < pr.bottom - 2;
    inP ? inside++ : outside++;
  }
  return {
    count: c.length,
    offL: +(pr.left - cr.left).toFixed(1), offT: +(pr.top - cr.top).toFixed(1),
    offR: +(cr.right - pr.right).toFixed(1), offB: +(cr.bottom - pr.bottom).toFixed(1),
    dprRatio: +(cv.width / cr.width).toFixed(2), pe: getComputedStyle(cv).pointerEvents, outside, inside,
    draw: document.querySelector('#pulse-debug-graph')?.dataset,
  };
});
let o = await overlay(page);
console.log(JSON.stringify(o));
const even = (o) => Math.max(o.offL, o.offT, o.offR, o.offB) - Math.min(o.offL, o.offT, o.offR, o.offB) <= 1.5 && o.offL > 40;
check('overlay: one canvas framing the player with an even margin', o.count === 1 && even(o), `margins L${o.offL} T${o.offT} R${o.offR} B${o.offB}`);
check('overlay: spikes drawn outside the player, video area left clear', o.outside > 200 && o.inside < o.outside * 0.02, `${o.outside} px outside · ${o.inside} inside`);
check('overlay: click-through', o.pe === 'none');
// Draw time from the debug graph's own measurement over many frames.
const drawMs = [];
for (let i = 0; i < 20; i++) { drawMs.push(Number(await page.evaluate(() => document.querySelector('#pulse-debug-graph').dataset.ms))); await sleep(100); }
drawMs.sort((a, b) => a - b);
check('draw + analysis < 2 ms per frame', drawMs[18] < 2, `median ${drawMs[10]} ms, p95 ${drawMs[18]} ms`);
// Theater mode resizes the player: overlay must follow.
await page.keyboard.press('t');
await sleep(1200);
o = await overlay(page);
check('theater mode: overlay follows the player', o.count === 1 && even(o), `margins L${o.offL} T${o.offT} R${o.offR} B${o.offB}`);
await page.screenshot({ path: `${process.env.E2E_OUT ?? '.'}/phase2-theater.png` });
await page.keyboard.press('t');
await sleep(1200);
// Scrolling moves the player: overlay must stay attached.
await page.evaluate(() => window.scrollBy(0, 300));
await sleep(400);
o = await overlay(page);
check('scrolling: overlay stays attached', even(o), `margins L${o.offL} T${o.offT} R${o.offR} B${o.offB}`);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(400);
// Player settings menu must remain clickable and on top.
await page.hover('#movie_player');
await page.click('.ytp-settings-button');
await sleep(500);
const menu = await page.evaluate(() => {
  const m = document.querySelector('.ytp-settings-menu');
  if (!m || getComputedStyle(m).display === 'none') return 'menu not open';
  const r = m.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
  return m.contains(hit) ? 'ok' : `hit ${hit?.id || hit?.className}`;
});
check('YouTube settings menu opens and stays on top', menu === 'ok', menu);
await page.keyboard.press('Escape');
await page.screenshot({ path: `${process.env.E2E_OUT ?? '.'}/phase2-watch.png` });

// Pause: loop should stop (fps attribute freezes) and resume on play.
await page.evaluate(() => document.querySelector('#movie_player video').pause());
await sleep(1500);
g = await graph(page);
check('pause stops the render loop', g.state === 'running' && g.paused, `state ${g.state}`);
await play(page);

// SPA navigation ×3 to related videos: same element reused or swapped, never duplicated.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/watch?v="]')].find((x) => !x.href.includes(location.search.slice(3, 14)));
    a?.click();
  });
  await sleep(5000);
  await play(page);
  await sleep(2500);
}
g = await graph(page);
check('after 3 SPA navigations: one graph, still capturing', g.count === 1 && g.state === 'running' && Number(g.level) > 0.01, `${g.url} · ${g.state} · level ${g.level}`);
await page.goBack();
await sleep(4000);
await play(page);
await sleep(2500);
g = await graph(page);
check('back button: still capturing', g.state === 'running' && !g.paused, `${g.url} · t ${g.t}`);

// Another extension (EQ / volume booster) captured the element first.
// Shorts: frame the vertical player.
const sh = await browser.newPage();
await sh.goto('https://www.youtube.com/shorts', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(7000);
o = await overlay(sh);
check('Shorts: overlay frames the vertical player', o.count === 1 && even(o) && o.outside > 100, `margins L${o.offL} T${o.offT} R${o.offR} B${o.offB} · ${o.outside} px drawn`);
await sh.screenshot({ path: `${process.env.E2E_OUT ?? '.'}/phase2-shorts.png` });
await sh.close();

const p2 = await browser.newPage();
watchErrors(p2);
await p2.evaluateOnNewDocument(() => {
  // Main world, like an equalizer extension would run: grab every <video> as it appears.
  const grab = (v) => {
    if (v.__eq) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(v);
    src.connect(ctx.destination);
    v.__eq = ctx;
    v.addEventListener('play', () => ctx.resume());
  };
  new MutationObserver(() => document.querySelectorAll('video').forEach(grab)).observe(document, { childList: true, subtree: true });
});
await p2.goto(`https://www.youtube.com/watch?v=${VIDEO}&t=30s`, { waitUntil: 'networkidle2', timeout: 60000 });
await play(p2);
await sleep(6000);
g = await graph(p2);
const tA = g.t;
await sleep(2500);
const g2 = await graph(p2);
check('another extension owns the audio → Pulse backs off', g.state === 'taken', g.state);
check('…and playback is untouched', g2.t > tA + 1.5 && !g2.paused, `t ${tA} → ${g2.t}`);
await p2.close();

// YouTube Music
const m = await browser.newPage();
watchErrors(m);
// YouTube Music shows "browser not supported" to a HeadlessChrome user agent.
await m.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
await m.goto(`https://music.youtube.com/watch?v=${VIDEO}`, { waitUntil: 'networkidle2', timeout: 60000 });
await play(m);
await sleep(8000);
g = await graph(m);
check('YouTube Music: capturing', g.state === 'running' && Number(g.level) > 0.02, `${g.state} · level ${g.level} · t ${g.t}`);
await m.screenshot({ path: `${process.env.E2E_OUT ?? '.'}/phase1-music.png` });

check('zero console errors from the extension', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
