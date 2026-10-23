// Typed settings schema, defaults, versioned migrations and storage helpers.
// Every read goes through sanitize(), so hand-edited, stale or truncated
// sync data can never put the content script in an impossible state.

export const SETTINGS_KEY = 'pulse.settings';
export const SETTINGS_VERSION = 1;

export type Style = 'spikes' | 'bars' | 'wave' | 'dots';
export type ColorMode = 'rgb' | 'neon' | 'heat' | 'custom';
export type NeonPreset = 'cyan-magenta' | 'lime-blue' | 'orange-pink';
export type PerformanceMode = 'quality' | 'auto' | 'battery';

export interface Settings {
  version: number;
  enabled: boolean;
  style: Style;
  colorMode: ColorMode;
  neonPreset: NeonPreset;
  /** 2–4 hex stops for Custom. */
  customStops: string[];
  /** Gain multiplier, 0.5–3. */
  sensitivity: number;
  /** Max spike length in CSS px. */
  spikeLength: number;
  thickness: number;
  bandCount: number;
  /** AnalyserNode.smoothingTimeConstant. */
  smoothness: number;
  /** 0–100. */
  glow: number;
  /** Degrees per second the rainbow travels. */
  rainbowSpeed: number;
  mirrored: boolean;
  peakCaps: boolean;
  beatPulse: boolean;
  calmMode: boolean;
  sites: { youtube: boolean; music: boolean };
  fullscreen: 'inward' | 'off';
  performance: PerformanceMode;
  /** Keep visualizing during ads, or pause visuals. */
  ads: 'keep' | 'pause';
  hideAfterPausedSec: number;
  /** Phase-1 diagnostic bar graph in the corner. */
  debugGraph: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: SETTINGS_VERSION,
  enabled: true,
  style: 'spikes',
  colorMode: 'rgb',
  neonPreset: 'cyan-magenta',
  customStops: ['#00e5ff', '#ff2bd6'],
  sensitivity: 1,
  spikeLength: 60,
  thickness: 3,
  bandCount: 96,
  smoothness: 0.75,
  glow: 70,
  rainbowSpeed: 40,
  mirrored: true,
  peakCaps: true,
  beatPulse: true,
  calmMode: false,
  sites: Object.freeze({ youtube: true, music: true }),
  fullscreen: 'inward',
  performance: 'auto',
  ads: 'keep',
  hideAfterPausedSec: 3,
  debugGraph: false,
}) as Settings;

type Loose = Record<string, unknown>;
/** MIGRATIONS[n] upgrades a version-n object to n+1. Version 0 = unversioned. */
const MIGRATIONS: Record<number, (s: Loose) => Loose> = {
  0: (s) => ({ ...s, version: 1 }),
};

export function migrate(raw: unknown): Settings {
  let s: Loose = raw && typeof raw === 'object' ? { ...(raw as Loose) } : {};
  let v = typeof s.version === 'number' ? s.version : 0;
  while (v < SETTINGS_VERSION) {
    s = (MIGRATIONS[v] ?? ((x: Loose) => ({ ...x, version: v + 1 })))(s);
    v = s.version as number;
  }
  return sanitize(s);
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const oneOf = <T>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const HEX = /^#[0-9a-f]{6}$/i;

export function sanitize(r: Loose): Settings {
  const d = DEFAULT_SETTINGS;
  const sites = (r.sites && typeof r.sites === 'object' ? r.sites : {}) as Loose;
  const stops = Array.isArray(r.customStops) ? r.customStops.filter((c): c is string => typeof c === 'string' && HEX.test(c)) : [];
  return {
    version: SETTINGS_VERSION,
    enabled: bool(r.enabled, d.enabled),
    style: oneOf(r.style, ['spikes', 'bars', 'wave', 'dots'] as const, d.style),
    colorMode: oneOf(r.colorMode, ['rgb', 'neon', 'heat', 'custom'] as const, d.colorMode),
    neonPreset: oneOf(r.neonPreset, ['cyan-magenta', 'lime-blue', 'orange-pink'] as const, d.neonPreset),
    customStops: stops.length >= 2 ? stops.slice(0, 4) : [...d.customStops],
    sensitivity: num(r.sensitivity, d.sensitivity, 0.5, 3),
    spikeLength: num(r.spikeLength, d.spikeLength, 20, 120),
    thickness: num(r.thickness, d.thickness, 1, 10),
    bandCount: Math.round(num(r.bandCount, d.bandCount, 48, 192)),
    smoothness: num(r.smoothness, d.smoothness, 0, 0.95),
    glow: num(r.glow, d.glow, 0, 100),
    rainbowSpeed: num(r.rainbowSpeed, d.rainbowSpeed, 0, 180),
    mirrored: bool(r.mirrored, d.mirrored),
    peakCaps: bool(r.peakCaps, d.peakCaps),
    beatPulse: bool(r.beatPulse, d.beatPulse),
    calmMode: bool(r.calmMode, d.calmMode),
    sites: { youtube: bool(sites.youtube, d.sites.youtube), music: bool(sites.music, d.sites.music) },
    fullscreen: oneOf(r.fullscreen, ['inward', 'off'] as const, d.fullscreen),
    performance: oneOf(r.performance, ['quality', 'auto', 'battery'] as const, d.performance),
    ads: oneOf(r.ads, ['keep', 'pause'] as const, d.ads),
    hideAfterPausedSec: num(r.hideAfterPausedSec, d.hideAfterPausedSec, 0, 30),
    debugGraph: bool(r.debugGraph, d.debugGraph),
  };
}

export async function loadSettings(): Promise<Settings> {
  return migrate((await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

export async function updateSettings(patch: Partial<Omit<Settings, 'version'>>): Promise<Settings> {
  const next = sanitize({ ...(await loadSettings()), ...patch } as unknown as Loose);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && SETTINGS_KEY in changes) cb(migrate(changes[SETTINGS_KEY]!.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // context already invalidated
    }
  };
}

export function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
