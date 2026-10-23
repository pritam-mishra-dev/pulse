// Audio capture and analysis.
//
// The rule everything here is built around: once createMediaElementSource()
// captures a <video>, its sound only reaches the speakers *through our
// AudioContext*. If that context is suspended (autoplay policy), the video
// goes silent. So we never capture until resume() has actually succeeded —
// before that, YouTube plays natively and we simply draw nothing.

/** One source node per element, ever — a second createMediaElementSource on the same element throws. */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

export type CaptureState =
  | 'idle' // no video yet
  | 'waiting' // context suspended until a play/gesture lets it resume
  | 'running'
  | 'taken' // another extension (EQ, volume booster) already owns the element
  | 'unavailable'; // Web Audio refused for some other reason

const F_MIN = 30;
const F_MAX = 16000;
const BASS_MIN = 30;
const BASS_MAX = 150;
const BEAT_RATIO = 1.35;
const BEAT_MIN_GAP_MS = 180;
/** Ignore "beats" in near-silence, where ratio tests are pure noise. */
const BEAT_FLOOR = 0.12;
/** Auto-gain reference never drops below this, so silence isn't amplified into hiss. */
const GAIN_FLOOR = 0.35;
/** Per-frame (60 fps) decay of the auto-gain reference: halves in ~4 s. */
const GAIN_RELEASE = 0.997;
const CAP_HOLD_MS = 260;
const CAP_FALL_PER_S = 0.9;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private video: HTMLVideoElement | null = null;
  private freq = new Uint8Array(0);
  private binHz = 0;
  private bandLo = new Float32Array(0);
  private bandHi = new Float32Array(0);
  private bassLo = 0;
  private bassHi = 0;
  private gainRef = GAIN_FLOOR;
  private bassAvg = 0;
  private lastBeat = 0;
  private lastFrame = 0;
  private capHold = new Float64Array(0);

  state: CaptureState = 'idle';
  /** Smoothed band values, 0–1. Reused every frame — callers must not keep references across settings changes. */
  bands = new Float32Array(0);
  caps = new Float32Array(0);
  /** 1 on a beat, decaying toward 0. */
  beat = 0;
  beatCount = 0;
  /** Mean band value this frame (after gain), for silence/idle detection. */
  level = 0;

  sensitivity = 1;
  decay = 0.88;

  constructor(bandCount: number, private onState: (s: CaptureState) => void) {
    this.setBandCount(bandCount);
  }

  setBandCount(n: number) {
    if (n === this.bands.length) return;
    this.bands = new Float32Array(n);
    this.caps = new Float32Array(n);
    this.capHold = new Float64Array(n);
    this.bandLo = new Float32Array(n);
    this.bandHi = new Float32Array(n);
    this.layoutBands();
  }

  setSmoothness(v: number) {
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
    this.smoothness = v;
  }
  private smoothness = 0.75;

  /** Point the engine at a (possibly new) video element. Safe to call repeatedly. */
  attach(video: HTMLVideoElement | null) {
    if (video === this.video) return;
    this.video = video;
    if (!video) return;
    if (this.ctx?.state === 'running') this.capture(video);
    else void this.resume();
  }

  /** Called on the video's play event and on user gestures — the moments autoplay policy allows audio. */
  async resume() {
    if (!this.video || this.state === 'taken' || this.state === 'unavailable') return;
    try {
      if (!this.ctx) this.createContext();
      if (this.ctx!.state !== 'running') await this.ctx!.resume();
    } catch {
      // resume() rejects without a user activation; we'll retry on the next gesture.
    }
    if (this.ctx?.state === 'running') this.capture(this.video);
    else this.setState('waiting');
  }

  private createContext() {
    // 'playback' trades latency for fewer glitches; a visualizer doesn't need low latency.
    const ctx = new AudioContext({ latencyHint: 'playback' });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = this.smoothness;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    // Required: without this the captured video goes silent.
    analyser.connect(ctx.destination);
    // If the browser suspends us mid-playback, audio is cut until we resume.
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && this.state === 'running') this.setState('waiting');
    });
    this.ctx = ctx;
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / analyser.fftSize;
    this.layoutBands();
  }

  private capture(video: HTMLVideoElement) {
    const ctx = this.ctx!;
    let src = sources.get(video);
    if (!src) {
      try {
        src = ctx.createMediaElementSource(video);
      } catch (err) {
        // InvalidStateError: the element is already wired to someone else's
        // graph. Leave it alone — their routing is what keeps it audible.
        this.setState(err instanceof DOMException && err.name === 'InvalidStateError' ? 'taken' : 'unavailable');
        return;
      }
      sources.set(video, src);
      // Never disconnected, even on teardown: disconnecting would silence the video.
      src.connect(this.analyser!);
    }
    this.setState('running');
  }

  private setState(s: CaptureState) {
    if (s === this.state) return;
    this.state = s;
    this.onState(s);
  }

  /**
   * Log-spaced bands from 30 Hz to 16 kHz. A linear split would spend ~90%
   * of the bands above 2 kHz, where music has the least visible motion.
   */
  private layoutBands() {
    const n = this.bands.length;
    if (!this.binHz || !n) return;
    const ratio = Math.pow(F_MAX / F_MIN, 1 / n);
    for (let i = 0; i < n; i++) {
      this.bandLo[i] = (F_MIN * Math.pow(ratio, i)) / this.binHz;
      this.bandHi[i] = (F_MIN * Math.pow(ratio, i + 1)) / this.binHz;
    }
    this.bassLo = Math.floor(BASS_MIN / this.binHz);
    this.bassHi = Math.ceil(BASS_MAX / this.binHz);
  }

  /** Advance one frame. Allocation-free. Returns false when there's no live audio to show. */
  update(now: number): boolean {
    const a = this.analyser;
    if (!a || this.state !== 'running') return false;
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16.7;
    this.lastFrame = now;
    const f = dt / 16.667; // decay constants are specified per 60 fps frame
    a.getByteFrequencyData(this.freq);
    const data = this.freq;
    const n = this.bands.length;
    const last = data.length - 1;

    let frameMax = 0;
    let sum = 0;
    const decay = Math.pow(this.decay, f);
    const gainRef = this.gainRef;
    for (let i = 0; i < n; i++) {
      const lo = this.bandLo[i]!;
      const hi = this.bandHi[i]!;
      let raw: number;
      if (hi - lo < 1) {
        // Narrow (bass) band thinner than one FFT bin: interpolate at its centre
        // instead of letting neighbouring bands show identical values.
        const c = Math.min(last, (lo + hi) / 2);
        const b = Math.floor(c);
        const t = c - b;
        raw = (data[b]! * (1 - t) + data[Math.min(last, b + 1)]! * t) / 255;
      } else {
        let m = 0;
        const end = Math.min(last, Math.ceil(hi));
        for (let b = Math.floor(lo); b <= end; b++) if (data[b]! > m) m = data[b]!;
        raw = m / 255;
      }
      // Music energy falls with frequency; tilt upward so treble isn't always flat.
      raw *= 1 + 0.5 * (i / n);
      if (raw > frameMax) frameMax = raw;
      const v = Math.min(1, (raw / gainRef) * this.sensitivity);
      // Attack instantly, release smoothly.
      const prev = this.bands[i]! * decay;
      const out = v > prev ? v : prev;
      this.bands[i] = out;
      sum += out;

      if (out >= this.caps[i]!) {
        this.caps[i] = out;
        this.capHold[i] = now + CAP_HOLD_MS;
      } else if (now > this.capHold[i]!) {
        this.caps[i] = Math.max(out, this.caps[i]! - CAP_FALL_PER_S * (dt / 1000));
      }
    }
    // Auto-gain: jump up to new peaks immediately, relax slowly toward quiet passages.
    this.gainRef = Math.max(GAIN_FLOOR, frameMax, gainRef * Math.pow(GAIN_RELEASE, f));
    this.level = n ? sum / n : 0;

    // Beat: bass energy vs. its ~1 s exponential moving average.
    let bass = 0;
    const bEnd = Math.min(last, this.bassHi);
    for (let b = this.bassLo; b <= bEnd; b++) bass += data[b]!;
    bass /= (bEnd - this.bassLo + 1) * 255;
    if (bass > BEAT_FLOOR && bass > this.bassAvg * BEAT_RATIO && now - this.lastBeat >= BEAT_MIN_GAP_MS) {
      this.lastBeat = now;
      this.beat = 1;
      this.beatCount++;
    } else {
      this.beat *= Math.pow(0.9, f);
    }
    this.bassAvg += (bass - this.bassAvg) * Math.min(1, dt / 1000);
    return true;
  }
}
