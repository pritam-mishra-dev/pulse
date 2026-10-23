// Content-script entry: lifecycle, SPA navigation, and the render loop.
// Phase 1 wires capture → analysis → a debug graph; the frame overlay comes in phase 2.

import { isContextValid, loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { AudioEngine, type CaptureState } from './audio-engine';
import { DebugGraph } from './debug-graph';
import { Overlay } from './overlay';
import { drawSpikes } from './renderer';
import { currentSite, locatePlayer, type PlayerTarget, type Site } from './player-locator';

const POLL_MS = 1000;

class Pulse {
  private engine: AudioEngine;
  private target: PlayerTarget | null = null;
  private graph: DebugGraph | null = null;
  private overlay: Overlay;
  private raf = 0;
  private poll: number | undefined;
  private unsubscribe = () => {};
  private destroyed = false;
  private forced = matchMedia('(forced-colors: active)');

  constructor(private site: Site, private settings: Settings) {
    this.engine = new AudioEngine(settings.bandCount, (s) => this.onCaptureState(s));
    this.overlay = new Overlay(settings.spikeLength, settings.bandCount, settings.mirrored);
    this.applySettings();
  }

  start() {
    for (const e of ['yt-navigate-finish', 'yt-page-data-updated']) document.addEventListener(e, this.refresh);
    window.addEventListener('popstate', this.refresh);
    document.addEventListener('visibilitychange', this.loop);
    // Autoplay policy: these are the moments resume() is allowed to succeed.
    window.addEventListener('pointerdown', this.onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', this.onGesture, { capture: true, passive: true });
    this.forced.addEventListener('change', this.loop);
    this.unsubscribe = onSettingsChanged((s) => {
      if (!this.guard()) return;
      this.settings = s;
      this.applySettings();
      this.refresh();
    });
    this.refresh();
    // Safety net for player swaps YouTube makes without any event we know of.
    this.poll = window.setInterval(this.refresh, POLL_MS);
  }

  private get active(): boolean {
    return this.settings.enabled && this.settings.sites[this.site] && !this.forced.matches;
  }

  private applySettings() {
    const s = this.settings;
    this.engine.setBandCount(s.bandCount);
    this.engine.setSmoothness(s.smoothness);
    this.engine.sensitivity = s.sensitivity;
    const o = this.overlay;
    if (o.spikeLength !== s.spikeLength || o.bands !== s.bandCount || o.mirrored !== s.mirrored) {
      o.spikeLength = s.spikeLength;
      o.bands = s.bandCount;
      o.mirrored = s.mirrored;
      o.invalidateLayout();
    }
    const wantGraph = this.active && s.debugGraph;
    if (wantGraph && !this.graph) this.graph = new DebugGraph();
    if (!wantGraph && this.graph) {
      this.graph.remove();
      this.graph = null;
    }
  }

  private refresh = () => {
    if (!this.guard()) return;
    const next = this.active ? locatePlayer(this.site) : null;
    if (next?.video !== this.target?.video) {
      this.target?.video.removeEventListener('play', this.onPlay);
      this.target?.video.removeEventListener('pause', this.loop);
      next?.video.addEventListener('play', this.onPlay);
      next?.video.addEventListener('pause', this.loop);
      // Capture is only attempted once; the engine keeps prior elements wired
      // (never disconnecting them), so swapping back and forth is safe.
      if (next) this.engine.attach(next.video);
    }
    this.target = next;
    this.overlay.setPlayer(next?.player ?? null, next?.kind ?? 'watch');
    if (!next) this.overlay.hide();
    this.loop();
  };

  private onPlay = () => {
    void this.engine.resume().then(this.loop);
  };

  private onGesture = () => {
    if (this.engine.state === 'waiting' && this.target) void this.engine.resume().then(this.loop);
  };

  private onCaptureState(s: CaptureState) {
    if (s !== 'running') this.graph?.showState(s);
    this.loop();
  }

  /** Run rAF only while there is something to draw: enabled, visible, playing, capturing. */
  private loop = () => {
    const v = this.target?.video;
    const run =
      !this.destroyed && this.active && document.visibilityState === 'visible' &&
      !!v && !v.paused && this.engine.state === 'running';
    if (run && !this.raf) this.raf = requestAnimationFrame(this.frame);
    if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.overlay.clear(); // phase 3 replaces this with the breathing idle outline
      this.graph?.showState(this.engine.state);
    }
  };

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    if (!this.engine.update(now)) return;
    const o = this.overlay;
    o.sync();
    if (o.visible && o.perimeter) {
      o.beginFrame();
      drawSpikes(o.ctx, o.perimeter, {
        bands: this.engine.bands,
        length: o.effectiveLength,
        thickness: this.settings.thickness,
        rainbowSpeed: this.settings.rainbowSpeed,
        now,
      });
    }
    this.graph?.draw(this.engine, now, performance.now() - t0);
  };

  /**
   * After an extension update/disable, chrome.* throws but this script keeps
   * running. Stop drawing — but leave the audio graph connected, because
   * disconnecting it would silence the video mid-playback.
   */
  private guard(): boolean {
    if (this.destroyed) return false;
    if (isContextValid()) return true;
    this.destroy();
    return false;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearInterval(this.poll);
    for (const e of ['yt-navigate-finish', 'yt-page-data-updated']) document.removeEventListener(e, this.refresh);
    window.removeEventListener('popstate', this.refresh);
    document.removeEventListener('visibilitychange', this.loop);
    window.removeEventListener('pointerdown', this.onGesture, { capture: true });
    window.removeEventListener('keydown', this.onGesture, { capture: true });
    this.forced.removeEventListener('change', this.loop);
    this.target?.video.removeEventListener('play', this.onPlay);
    this.target?.video.removeEventListener('pause', this.loop);
    this.unsubscribe();
    this.graph?.remove();
    this.overlay.destroy();
  }
}

async function main() {
  const site = currentSite();
  if (!site || window.top !== window || location.pathname.startsWith('/embed/')) return;
  let settings: Settings;
  try {
    settings = await loadSettings();
  } catch {
    return;
  }
  new Pulse(site, settings).start();
}

void main();
