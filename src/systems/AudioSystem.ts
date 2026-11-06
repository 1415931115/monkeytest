import * as THREE from 'three';

/**
 * Fully procedural Web Audio sound system for MONKEYBRO. No files: every
 * sound is synthesized at runtime (oscillators, a shared noise buffer, filters,
 * envelopes, one shared procedural convolution reverb, HRTF panners).
 *
 * Graph:
 *   [layers / one-shots] -> groups (sfx, ambience, voice, music, sting)
 *                        -> muffle low-pass (health) -> master -> compressor -> out
 *   shared reverb: per-shot send -> convolver -> reverbReturn -> muffle
 */
export type PeachTier = 0 | 1 | 2 | 3; // 10y, 100y, 1000y, 10000y

export interface AudioFrameState {
  /** 0..1 horizontal speed relative to sprint speed. */
  moveSpeed01: number;
  sprinting: boolean;
  /** 0..1 closeness of the nearest hunting monster (1 = touching). */
  danger01: number;
  /** True while the Howler's summons are active. */
  hunt: boolean;
  /** 0..1 player health. */
  health01: number;
  /** True while gameplay is running (not in menus / paused / dead). */
  playing: boolean;
}

type Dest = AudioNode | AudioParam;

const MASTER_VOLUME = 0.9;
const CALLER_DURATION = 1.65;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
function link(src: AudioNode, dest: Dest): void {
  if (dest instanceof AudioParam) src.connect(dest);
  else src.connect(dest);
}

/**
 * Owns the nodes of one transient sound. When every source in the shot has
 * ended, all of its nodes are disconnected (shared buses are never added).
 */
class Shot {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private readonly registry: Set<AudioScheduledSourceNode> | null;

  constructor(registry: Set<AudioScheduledSourceNode> | null) {
    this.registry = registry;
  }

  node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  play<T extends AudioScheduledSourceNode>(s: T, start: number, stop: number, offset?: number): T {
    this.nodes.push(s);
    this.sources.push(s);
    this.pending++;
    this.registry?.add(s);
    s.onended = () => {
      this.registry?.delete(s);
      this.pending--;
      if (this.pending <= 0) this.free();
    };
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(start, offset);
    else s.start(start);
    s.stop(Math.max(stop, start + 0.005));
    return s;
  }

  stop(t: number): void {
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
  }

  private free(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}

interface HarvestLoop {
  tier: PeachTier;
  shot: Shot;
  gain: GainNode;
}

/** Formant keyframe: t, F1, F2, F3, voiced amplitude, aspiration (noise) amplitude. */
type FormantKey = [number, number, number, number, number, number];

// Mandarin "猴哥" (hóu gē), sung as a breathy, coaxing female whisper-call:
// [h] (long breath) -> [ou] (tone 2 rising, drawn out) | gap | [g] -> [ɤ] (tone 1 high level, held) -> sigh.
// Formants sit ~15% above an adult male's (shorter vocal tract).
const CALLER_KEYS: FormantKey[] = [
  [0.0, 580, 1040, 2800, 0.0, 0.0],
  [0.03, 580, 1040, 2800, 0.0, 1.0], // h: long breathy onset through the vowel's formants
  [0.11, 580, 1040, 2800, 0.25, 0.75],
  [0.16, 580, 1040, 2800, 0.95, 0.25], // o
  [0.32, 550, 1000, 2780, 1.0, 0.2],
  [0.52, 380, 860, 2700, 0.85, 0.2], // -> u (slow, lingering glide)
  [0.57, 370, 850, 2700, 0.0, 0.05],
  [0.63, 460, 1500, 2700, 0.0, 0.0], // gap / g closure (velar pinch)
  [0.66, 500, 1430, 2850, 0.55, 0.15], // g release (soft)
  [0.74, 530, 1260, 2950, 1.0, 0.2], // ɤ held
  [1.22, 530, 1260, 2950, 0.9, 0.3],
  [1.42, 520, 1240, 2950, 0.3, 0.75], // long breathy sigh-out
  [1.62, 520, 1240, 2950, 0.0, 0.0],
];
// Female register (~195-280 Hz). Tone 2 rises slowly with a small scoop, tone 1
// stays high and level; the tail barely sags so it never reads as tone 4.
const CALLER_PITCH: Array<[number, number]> = [
  [0.0, 204],
  [0.16, 204],
  [0.24, 197],
  [0.52, 246], // tone 2: rising
  [0.6, 258],
  [0.7, 270],
  [1.0, 276], // tone 1: high and flat
  [1.3, 274],
  [1.62, 262],
];
// F1..F3 follow CALLER_KEYS; F4 is a fixed "air" band that carries the breath and
// gives the HRTF plenty of >3 kHz content to work with (front/back cues live there).
const FORMANT_BW = [110, 140, 210, 520];
const FORMANT_LEVEL = [1.0, 0.85, 0.6, 0.38];
const CALLER_F4 = 4300;
/** Vibrato depth as a fraction of f0: small during "hóu", blooming on the held "gē". */
const CALLER_VIBRATO: Array<[number, number]> = [
  [0.0, 0.004],
  [0.5, 0.008],
  [0.8, 0.012],
  [1.3, 0.026],
  [1.62, 0.03],
];
/** Lift above the monster's given position so it seems to lean in from over the shoulder. */
const CALLER_LIFT = 0.35;
/** Extra high-shelf cut (dB) when the caller is directly behind the listener (exaggerates HRTF rear cue). */
const CALLER_REAR_SHADOW_DB = -7;
/** SpeechSynthesis cannot be routed through the HRTF panner, so it stays a barely-there, late double. */
const CALLER_TTS_VOLUME = 0.06;

export class AudioSystem {
  muted = false;

  private ctx: AudioContext | null = null;
  private built = false;

  // buses
  private comp!: DynamicsCompressorNode;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private voice!: GainNode;
  private music!: GainNode;
  private sting!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;

  // shared resources
  private noiseBuf!: AudioBuffer;
  private distCurve!: Float32Array<ArrayBuffer>;
  /** Breathy (steep-tilt) glottal source for the Caller's female voice. */
  private glottal!: PeriodicWave;

  // continuous layers
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windPan: StereoPannerNode | null = null;
  private whistleFilter!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private footGain!: GainNode;
  private heartGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private chaseFilter!: BiquadFilterNode;
  private chaseGain!: GainNode;
  private chaseLfo!: OscillatorNode;
  private extractOscs: OscillatorNode[] = [];
  private extractFilter!: BiquadFilterNode;
  private extractGain!: GainNode;
  private extractLfo!: OscillatorNode;
  private persistent: AudioScheduledSourceNode[] = [];

  // state
  private readonly transient = new Set<AudioScheduledSourceNode>();
  private lastTargets = new WeakMap<AudioParam, number>();
  private harvest: HarvestLoop | null = null;
  private readonly listenerPos = new THREE.Vector3();
  private readonly listenerFwd = new THREE.Vector3(0, 0, -1);
  private stepPhase = 0.7;
  private nextBeat = 0;
  private nextDrum = 0;
  private drumStep = 0;
  private nextCricket = 0;
  private nextEvent = 0;
  private cricketSilenceUntil = 0;
  private lastExtract = -1;
  private duckUntil = 0;
  private lastPlay = new Map<string, number>();
  private callerStart = -10;
  /** Live rear-shadow filter of the current Caller call, re-aimed every setListener(). */
  private callerRear: { shelf: BiquadFilterNode; pos: THREE.Vector3; until: number } | null = null;

  // ------------------------------------------------------------------ setup

  async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const w = window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.build();
        try {
          window.speechSynthesis?.getVoices(); // warm up the voice list
        } catch {
          /* ignore */
        }
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      /* audio unavailable: stay silent */
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.25;
    this.comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.comp);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = Math.min(20000, sr * 0.45);
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.master);

    const group = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.muffle);
      return g;
    };
    this.sfx = group(1);
    this.amb = group(1);
    this.voice = group(1);
    this.music = group(1);
    this.sting = group(1);

    // shared noise (2 s white)
    this.noiseBuf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // shared dark reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.8);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.55;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.muffle);

    // soft-clip curve
    const n = 1024;
    this.distCurve = new Float32Array(n);
    const k = 3;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      this.distCurve[i] = Math.tanh(k * x) / Math.tanh(k);
    }

    // breathy glottal source (~ -11 dB/oct): weak upper harmonics, the noise carries the top end
    const H = 48;
    const real = new Float32Array(H);
    const imag = new Float32Array(H);
    for (let h = 1; h < H; h++) imag[h] = 1 / Math.pow(h, 1.85);
    this.glottal = ctx.createPeriodicWave(real, imag);

    this.buildAmbience();
    this.buildDrone();
    this.buildChase();
    this.buildExtract();

    this.footGain = ctx.createGain();
    this.footGain.gain.value = 0;
    this.footGain.connect(this.sfx);
    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0;
    this.heartGain.connect(this.sfx);

    const t = ctx.currentTime;
    this.nextCricket = t + 1.5;
    this.nextEvent = t + rand(8, 16);
    this.built = true;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const pre = Math.floor(sr * 0.025);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) {
          d[i] = 0;
          continue;
        }
        const x = (i - pre) / (len - pre);
        const env = Math.pow(1 - x, 2.2) * Math.exp(-x * 2.2);
        const a = 0.5 - 0.44 * x; // one-pole LP gets darker over time
        lp += a * (Math.random() * 2 - 1 - lp);
        // a few sparse early reflections
        const er = x < 0.04 && Math.random() < 0.002 ? (Math.random() - 0.5) * 3 : 0;
        d[i] = lp * env * 1.6 + er;
      }
    }
    return buf;
  }

  private loopNoise(offset = 0): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(0, offset);
    this.persistent.push(src);
    return src;
  }

  private persistentOsc(type: OscillatorType, freq: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    this.persistent.push(o);
    return o;
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    // wind body
    const n1 = this.loopNoise(0);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    n1.connect(this.windFilter).connect(this.windGain);
    if (typeof ctx.createStereoPanner === 'function') {
      this.windPan = ctx.createStereoPanner();
      this.windGain.connect(this.windPan).connect(this.amb);
    } else {
      this.windGain.connect(this.amb);
    }
    // whistling gust through branches
    const n2 = this.loopNoise(1.0);
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.frequency.value = 800;
    this.whistleFilter.Q.value = 6;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    n2.connect(this.whistleFilter).connect(this.whistleGain).connect(this.amb);
  }

  private buildDrone(): void {
    const ctx = this.ctx!;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;
    this.droneFilter.Q.value = 1.5;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.music);

    const lfo = this.persistentOsc('sine', 0.06);
    const depth = ctx.createGain();
    depth.gain.value = 9; // cents
    lfo.connect(depth);
    const voices: Array<[OscillatorType, number, number]> = [
      ['sawtooth', 55, 0.35],
      ['sawtooth', 58.27, 0.18], // minor 2nd rub
      ['sawtooth', 82.41, 0.22],
      ['sine', 36.71, 0.6],
    ];
    voices.forEach(([type, f, lvl], i) => {
      const o = this.persistentOsc(type, f);
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(this.droneFilter);
      if (i < 3) depth.connect(o.detune);
    });
  }

  private buildChase(): void {
    const ctx = this.ctx!;
    this.chaseGain = ctx.createGain();
    this.chaseGain.gain.value = 0;
    this.chaseGain.connect(this.music);

    const pulse = ctx.createGain();
    pulse.gain.value = 0.55;
    pulse.connect(this.chaseGain);
    this.chaseLfo = this.persistentOsc('sine', 4);
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.45;
    this.chaseLfo.connect(pulseDepth).connect(pulse.gain);

    this.chaseFilter = ctx.createBiquadFilter();
    this.chaseFilter.type = 'lowpass';
    this.chaseFilter.frequency.value = 700;
    this.chaseFilter.Q.value = 3;
    this.chaseFilter.connect(pulse);
    for (const f of [73.42, 77.78, 103.83]) {
      const o = this.persistentOsc('sawtooth', f);
      const g = ctx.createGain();
      g.gain.value = 0.3;
      o.connect(g).connect(this.chaseFilter);
    }
    // thin, beating high whine
    const hi = ctx.createGain();
    hi.gain.value = 0.035;
    hi.connect(pulse);
    for (const f of [1108.7, 1174.7]) this.persistentOsc('sine', f).connect(hi);
  }

  private buildExtract(): void {
    const ctx = this.ctx!;
    this.extractGain = ctx.createGain();
    this.extractGain.gain.value = 0;
    this.extractGain.connect(this.sfx);
    const vca = ctx.createGain();
    vca.gain.value = 0.7;
    vca.connect(this.extractGain);
    this.extractLfo = this.persistentOsc('sine', 4);
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    this.extractLfo.connect(depth).connect(vca.gain);
    this.extractFilter = ctx.createBiquadFilter();
    this.extractFilter.type = 'lowpass';
    this.extractFilter.frequency.value = 600;
    this.extractFilter.connect(vca);
    const defs: Array<[OscillatorType, number, number]> = [
      ['sine', 110, 0.6],
      ['triangle', 165, 0.35],
      ['sine', 220, 0.2],
    ];
    for (const [type, f, lvl] of defs) {
      const o = this.persistentOsc(type, f);
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(this.extractFilter);
      this.extractOscs.push(o);
    }
  }

  // ---------------------------------------------------------------- helpers

  private ok(): boolean {
    return !!this.ctx && this.built && !this.muted && this.ctx.state !== 'closed';
  }

  private safe<T>(fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  /** Throttle: returns false if `key` played less than `gap` seconds ago. */
  private gate(key: string, gap: number): boolean {
    const now = this.ctx!.currentTime;
    const last = this.lastPlay.get(key) ?? -1e9;
    if (now - last < gap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  /** Smooth per-frame target with change detection (avoids flooding the timeline). */
  private tgt(p: AudioParam, v: number, tc: number): void {
    const last = this.lastTargets.get(p);
    if (last !== undefined && Math.abs(last - v) <= 1e-4 + Math.abs(v) * 0.002) return;
    this.lastTargets.set(p, v);
    p.setTargetAtTime(v, this.ctx!.currentTime, tc);
  }

  private hold(p: AudioParam, t: number): void {
    const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (typeof anyP.cancelAndHoldAtTime === 'function') {
      anyP.cancelAndHoldAtTime(t);
    } else {
      const v = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    }
    this.lastTargets.delete(p);
  }

  /** Exponential AD(SR) envelope; safe (never ramps exponentially to/from 0). */
  private env(p: AudioParam, t: number, attack: number, peak: number, decay: number, holdT = 0): number {
    const pk = Math.max(peak, 0.0002);
    const a = Math.max(attack, 0.001);
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(pk, t + a);
    if (holdT > 0) p.setValueAtTime(pk, t + a + holdT);
    const end = t + a + holdT + Math.max(decay, 0.005);
    p.exponentialRampToValueAtTime(0.0001, end);
    p.setValueAtTime(0, end + 0.01);
    return end + 0.02;
  }

  private gain(shot: Shot, value: number, dest?: Dest): GainNode {
    const g = shot.node(this.ctx!.createGain());
    g.gain.value = value;
    if (dest) link(g, dest);
    return g;
  }

  private filt(shot: Shot, type: BiquadFilterType, freq: number, q: number, dest: Dest): BiquadFilterNode {
    const f = shot.node(this.ctx!.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    link(f, dest);
    return f;
  }

  private osc(
    shot: Shot,
    type: OscillatorType | PeriodicWave,
    freq: number,
    t0: number,
    t1: number,
    dest: Dest,
  ): OscillatorNode {
    const o = this.ctx!.createOscillator();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type);
    else o.type = type;
    o.frequency.value = freq;
    link(o, dest);
    return shot.play(o, t0, t1);
  }

  private noise(shot: Shot, t0: number, t1: number, dest: Dest): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    link(s, dest);
    return shot.play(s, t0, t1, Math.random() * 1.8);
  }

  private shaper(shot: Shot, dest: Dest): WaveShaperNode {
    const ws = shot.node(this.ctx!.createWaveShaper());
    ws.curve = this.distCurve;
    ws.oversample = '2x';
    link(ws, dest);
    return ws;
  }

  private panner(shot: Shot, pos: THREE.Vector3, ref: number, rolloff: number, dest: AudioNode): PannerNode {
    const p = shot.node(this.ctx!.createPanner());
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 10000;
    const x = Number.isFinite(pos.x) ? pos.x : 0;
    const y = Number.isFinite(pos.y) ? pos.y : 0;
    const z = Number.isFinite(pos.z) ? pos.z : 0;
    const anyP = p as unknown as { positionX?: AudioParam; setPosition?: (x: number, y: number, z: number) => void };
    if (anyP.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      anyP.setPosition?.(x, y, z);
    }
    p.connect(dest);
    return p;
  }

  private stereo(shot: Shot, pan: number, dest: AudioNode): AudioNode {
    const ctx = this.ctx!;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = shot.node(ctx.createStereoPanner());
      p.pan.value = clamp(pan, -1, 1);
      p.connect(dest);
      return p;
    }
    return this.gain(shot, 1, dest);
  }

  private send(shot: Shot, from: AudioNode, amount: number): void {
    const g = this.gain(shot, amount, this.reverb);
    from.connect(g);
  }

  /** Bell/chime voice with inharmonic partials. */
  private bell(shot: Shot, f: number, t: number, dur: number, level: number, dest: AudioNode): void {
    const partials: Array<[number, number, number]> = [
      [1, 1, 1],
      [2.0, 0.35, 0.6],
      [2.76, 0.25, 0.45],
      [5.4, 0.1, 0.25],
    ];
    const nyq = this.ctx!.sampleRate * 0.45;
    for (const [r, a, dk] of partials) {
      if (f * r > nyq) continue;
      const g = this.gain(shot, 0, dest);
      const end = this.env(g.gain, t, 0.004, level * a, dur * dk);
      this.osc(shot, 'sine', f * r * rand(0.998, 1.002), t, end, g);
    }
  }

  // --------------------------------------------------------------- listener

  setListener(position: THREE.Vector3, forward: THREE.Vector3): void {
    this.safe(undefined, () => {
      if (!this.ctx || !this.built) return;
      if (!Number.isFinite(position.x + position.y + position.z)) return;
      this.listenerPos.copy(position);
      let fx = forward.x;
      let fy = forward.y;
      let fz = forward.z;
      const len = Math.hypot(fx, fy, fz);
      if (!Number.isFinite(len) || len < 1e-5) return;
      fx /= len;
      fy /= len;
      fz /= len;
      if (Math.abs(fy) > 0.995) {
        // avoid degenerate forward/up; nudge toward horizontal
        fy = Math.sign(fy) * 0.995;
      }
      const l = this.ctx.listener as unknown as {
        positionX?: AudioParam;
        positionY: AudioParam;
        positionZ: AudioParam;
        forwardX: AudioParam;
        forwardY: AudioParam;
        forwardZ: AudioParam;
        upX: AudioParam;
        upY: AudioParam;
        upZ: AudioParam;
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
      };
      if (l.positionX && l.forwardX) {
        l.positionX.value = position.x;
        l.positionY.value = position.y;
        l.positionZ.value = position.z;
        l.forwardX.value = fx;
        l.forwardY.value = fy;
        l.forwardZ.value = fz;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        l.setPosition?.(position.x, position.y, position.z);
        l.setOrientation?.(fx, fy, fz, 0, 1, 0);
      }
      this.listenerFwd.set(fx, fy, fz);
      this.aimCallerRear(fx, fz);
    });
  }

  /** Deepens the Caller's high-frequency rear shadow the more it sits behind the listener's head. */
  private aimCallerRear(fx: number, fz: number): void {
    const r = this.callerRear;
    if (!r || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (t > r.until) {
      this.callerRear = null;
      return;
    }
    const dx = r.pos.x - this.listenerPos.x;
    const dz = r.pos.z - this.listenerPos.z;
    const fl = Math.hypot(fx, fz);
    const dl = Math.hypot(dx, dz);
    // 1 = straight behind, 0 = to the side or in front
    const behind = fl > 1e-4 && dl > 1e-4 ? clamp(-(fx * dx + fz * dz) / (fl * dl), 0, 1) : 0;
    r.shelf.gain.setTargetAtTime(CALLER_REAR_SHADOW_DB * behind, t, 0.06);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.safe(undefined, () => {
      if (!this.ctx || !this.built) return;
      const t = this.ctx.currentTime;
      this.hold(this.master.gain, t);
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, t, 0.08);
      if (muted) {
        this.harvestStop();
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* ignore */
        }
      }
    });
  }

  // ----------------------------------------------------------------- update

  update(dt: number, state: AudioFrameState): void {
    this.safe(undefined, () => {
      if (!this.ctx || !this.built || this.ctx.state === 'closed') return;
      const now = this.ctx.currentTime;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const playing = !!state.playing;
      const speed = clamp(state.moveSpeed01 || 0, 0, 1);
      const danger = clamp(state.danger01 || 0, 0, 1);
      const health = clamp(Number.isFinite(state.health01) ? state.health01 : 1, 0, 1);
      const hunt = !!state.hunt;
      const live = !this.muted;

      // --- ambience bed: wind with slow gusts
      const gust = clamp(
        0.5 + 0.25 * Math.sin(now * 0.11) + 0.15 * Math.sin(now * 0.29 + 1.3) + 0.1 * Math.sin(now * 0.73 + 0.4),
        0,
        1,
      );
      const ambLevel = playing ? 1 : 0.55;
      this.tgt(this.windGain.gain, ambLevel * (0.35 + 0.6 * gust), 0.6);
      this.tgt(this.windFilter.frequency, 220 + 600 * gust, 0.8);
      this.tgt(this.whistleGain.gain, ambLevel * 0.25 * gust * gust * gust, 0.8);
      this.tgt(this.whistleFilter.frequency, 650 + 450 * Math.sin(now * 0.07) * Math.sin(now * 0.031 + 2), 1.0);
      if (this.windPan) this.tgt(this.windPan.pan, 0.6 * Math.sin(now * 0.05), 1.0);

      if (live) {
        if (now >= this.nextCricket) {
          const quiet = now < this.cricketSilenceUntil;
          if (!quiet && Math.random() > danger * 0.8) this.cricket(now + 0.02, playing ? 1 : 0.6);
          this.nextCricket = now + rand(0.25, 1.4);
        }
        if (now >= this.nextEvent) {
          if (Math.random() < 0.55) this.creak(now + 0.05, null, playing ? 1 : 0.6);
          else this.owl(now + 0.05, playing ? 1 : 0.6);
          this.nextEvent = now + rand(10, 28);
        }
      }

      // --- footsteps
      this.tgt(this.footGain.gain, playing ? 1 : 0, 0.08);
      if (playing && live && speed > 0.06) {
        const rate = state.sprinting ? 2.6 + 0.6 * speed : 1.3 + 1.3 * speed; // steps / s
        this.stepPhase += dt * rate;
        if (this.stepPhase >= 1) {
          this.stepPhase -= Math.floor(this.stepPhase);
          this.footstep(now + 0.005, speed, state.sprinting);
        }
      } else {
        this.stepPhase = 0.7; // first step comes quickly when moving again
      }

      // --- heartbeat
      const heart = playing && danger > 0.25 ? (danger - 0.25) / 0.75 : 0;
      this.tgt(this.heartGain.gain, heart > 0 ? 0.35 + 0.65 * heart : 0, 0.25);
      if (heart > 0.01 && live) {
        const bpm = 62 + 98 * heart;
        if (this.nextBeat < now) this.nextBeat = now + 0.02;
        if (now + 0.06 >= this.nextBeat) {
          this.heartbeat(this.nextBeat, 0.5 + 0.5 * heart);
          this.nextBeat += 60 / bpm;
        }
      } else {
        this.nextBeat = 0;
      }

      // --- dread drone + chase layer
      this.tgt(this.droneGain.gain, playing ? 0.04 + 0.16 * danger + (hunt ? 0.05 : 0) : 0.012, 0.8);
      this.tgt(this.droneFilter.frequency, 140 + 900 * danger * danger + (hunt ? 200 : 0), 0.6);
      const chase = playing && hunt;
      this.tgt(this.chaseGain.gain, chase ? 0.09 + 0.1 * danger : 0, chase ? 0.8 : 0.5);
      this.tgt(this.chaseLfo.frequency, 3 + 3.5 * danger, 0.5);
      this.tgt(this.chaseFilter.frequency, 500 + 1500 * danger, 0.4);
      if (chase && live) {
        if (this.nextDrum < now) this.nextDrum = now + 0.05;
        if (now + 0.06 >= this.nextDrum) {
          const pattern = [1, 0, 0.55, 0, 0.8, 0.45, 0, 0.5];
          const acc = pattern[this.drumStep % pattern.length];
          if (acc > 0) this.drum(this.nextDrum, acc);
          this.drumStep++;
          this.nextDrum += 0.22 - 0.05 * danger;
        }
      } else {
        this.nextDrum = 0;
        this.drumStep = 0;
      }

      // --- low-health muffle
      const nyq = Math.min(20000, this.ctx.sampleRate * 0.45);
      const muff = playing && health < 0.35 ? 450 + Math.pow(health / 0.35, 1.6) * 7000 : nyq;
      this.tgt(this.muffle.frequency, muff, 0.3);

      // --- extraction hum fade-out when no longer fed
      if (now - this.lastExtract > 0.2) this.tgt(this.extractGain.gain, 0, 0.12);
    });
  }

  // ---------------------------------------------------------- ambience bits

  private cricket(t: number, level: number): void {
    const shot = new Shot(this.transient);
    const out = this.stereo(shot, rand(-0.9, 0.9), this.amb);
    const g = this.gain(shot, 0, out);
    const vol = rand(0.006, 0.02) * level;
    const pulses = 3 + Math.floor(Math.random() * 3);
    const trills = Math.random() < 0.4 ? 2 : 1;
    let tt = t;
    for (let r = 0; r < trills; r++) {
      for (let p = 0; p < pulses; p++) {
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(vol, tt + 0.004);
        g.gain.linearRampToValueAtTime(vol * 0.7, tt + 0.014);
        g.gain.linearRampToValueAtTime(0, tt + 0.019);
        tt += 0.032;
      }
      tt += 0.12;
    }
    this.osc(shot, 'sine', rand(4200, 4900), t, tt + 0.02, g);
  }

  private creak(t: number, pos: THREE.Vector3 | null, level: number): void {
    const shot = new Shot(this.transient);
    const dur = rand(0.8, 1.6);
    const out = pos ? this.panner(shot, pos, 6, 0.8, this.amb) : this.stereo(shot, rand(-1, 1), this.amb);
    const lp = this.filt(shot, 'lowpass', 2200, 0.7, out);
    const g = this.gain(shot, 0, lp);
    this.send(shot, g, 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07 * level, t + 0.2);
    g.gain.setValueAtTime(0.07 * level, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const bp = this.filt(shot, 'bandpass', rand(450, 850), 7, g);
    const o = this.osc(shot, 'sawtooth', 20, t, t + dur + 0.02, bp); // stick-slip pulse train
    o.frequency.setValueAtTime(rand(16, 24), t);
    o.frequency.linearRampToValueAtTime(rand(35, 55), t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(rand(22, 30), t + dur * 0.7);
    o.frequency.linearRampToValueAtTime(rand(40, 60), t + dur);
  }

  private owl(t: number, level: number): void {
    const shot = new Shot(this.transient);
    const out = this.stereo(shot, rand(-0.8, 0.8), this.amb);
    const lp = this.filt(shot, 'lowpass', 900, 0.7, out);
    this.send(shot, lp, 0.8);
    const base = rand(340, 400);
    const hoots: Array<[number, number]> = [
      [0, 0.35],
      [0.75, 0.16],
      [0.98, 0.16],
      [1.25, 0.5],
    ];
    for (const [off, len] of hoots) {
      const ht = t + off;
      const g = this.gain(shot, 0, lp);
      g.gain.setValueAtTime(0, ht);
      g.gain.linearRampToValueAtTime(0.045 * level, ht + 0.05);
      g.gain.setValueAtTime(0.045 * level, ht + len * 0.6);
      g.gain.linearRampToValueAtTime(0, ht + len);
      const o = this.osc(shot, 'sine', base * 1.06, ht, ht + len + 0.02, g);
      o.frequency.setValueAtTime(base * 1.06, ht);
      o.frequency.exponentialRampToValueAtTime(base, ht + 0.08);
      o.frequency.exponentialRampToValueAtTime(base * 0.95, ht + len);
    }
  }

  private flutter(t: number, pan: number): void {
    const shot = new Shot(this.transient);
    const out = this.stereo(shot, pan, this.amb);
    const bp = this.filt(shot, 'bandpass', rand(1200, 2000), 1.2, out);
    const vca = this.gain(shot, 0.5, bp);
    const g = this.gain(shot, 0, vca);
    this.send(shot, bp, 0.4);
    const dur = rand(0.6, 1.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lfo = this.osc(shot, 'sine', rand(12, 18), t, t + dur, this.gain(shot, 0.5, vca.gain));
    lfo.frequency.linearRampToValueAtTime(rand(7, 10), t + dur);
    this.noise(shot, t, t + dur, g);
  }

  // ----------------------------------------------------------- layer events

  private footstep(t: number, speed: number, sprint: boolean): void {
    const shot = new Shot(this.transient);
    const vol = (0.25 + 0.5 * speed) * (sprint ? 1.2 : 1);
    // leaf crunch: jagged grain envelope on one noise burst
    const hp = this.filt(shot, 'highpass', 700, 0.7, this.footGain);
    const bp = this.filt(shot, 'bandpass', rand(1800, 3200), 0.8, hp);
    const g = this.gain(shot, 0, bp);
    let tt = t;
    const grains = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < grains; i++) {
      const a = vol * rand(0.25, 0.6);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(a, tt + 0.002);
      g.gain.linearRampToValueAtTime(a * 0.15, tt + rand(0.008, 0.022));
      tt += rand(0.012, 0.03);
    }
    g.gain.linearRampToValueAtTime(0, tt + 0.03);
    this.noise(shot, t, tt + 0.05, g);
    // soft ground thump
    const lp = this.filt(shot, 'lowpass', 180, 0.8, this.footGain);
    const tg = this.gain(shot, 0, lp);
    const end = this.env(tg.gain, t, 0.006, vol * 0.9, 0.08);
    this.noise(shot, t, end, tg);
  }

  private heartbeat(t: number, level: number): void {
    const shot = new Shot(this.transient);
    const lp = this.filt(shot, 'lowpass', 160, 0.7, this.heartGain);
    const beat = (bt: number, amp: number, f: number): void => {
      const g = this.gain(shot, 0, lp);
      const end = this.env(g.gain, bt, 0.012, amp, 0.16);
      const o = this.osc(shot, 'sine', f, bt, end, g);
      o.frequency.setValueAtTime(f, bt);
      o.frequency.exponentialRampToValueAtTime(f * 0.65, bt + 0.12);
      // upper body so it reads on small speakers
      const g2 = this.gain(shot, 0, this.heartGain);
      const e2 = this.env(g2.gain, bt, 0.008, amp * 0.18, 0.07);
      this.osc(shot, 'triangle', f * 2, bt, e2, g2);
    };
    beat(t, 0.7 * level, 58);
    beat(t + 0.17, 0.5 * level, 66);
  }

  private drum(t: number, accent: number): void {
    const shot = new Shot(this.transient);
    const g = this.gain(shot, 0, this.chaseGain);
    const end = this.env(g.gain, t, 0.004, 1.6 * accent, 0.35);
    const o = this.osc(shot, 'sine', 85, t, end, g);
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const lp = this.filt(shot, 'lowpass', 700, 0.7, this.chaseGain);
    const ng = this.gain(shot, 0, lp);
    const e2 = this.env(ng.gain, t, 0.002, 0.5 * accent, 0.06);
    this.noise(shot, t, e2, ng);
  }

  // ------------------------------------------------------------- one-shots

  flashlight(on: boolean): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('flash', 0.05)) return;
      const t = this.ctx!.currentTime + 0.005;
      const shot = new Shot(this.transient);
      const f = on ? 3300 : 2300;
      const bp = this.filt(shot, 'bandpass', f, 3, this.sfx);
      const hp = this.filt(shot, 'highpass', 2000, 0.7, bp);
      const g1 = this.gain(shot, 0, hp);
      this.noise(shot, t, this.env(g1.gain, t, 0.001, 0.9, 0.012), g1);
      const pg = this.gain(shot, 0, bp);
      this.osc(shot, 'square', f * 0.5, t, this.env(pg.gain, t, 0.001, 0.12, 0.025), pg);
      // spring / latch return
      const t2 = t + 0.03;
      const bp2 = this.filt(shot, 'bandpass', f * 0.7, 4, this.sfx);
      const g2 = this.gain(shot, 0, bp2);
      this.noise(shot, t2, this.env(g2.gain, t2, 0.001, 0.4, 0.01), g2);
      // plastic body thump
      const bg = this.gain(shot, 0, this.sfx);
      this.osc(shot, 'sine', on ? 190 : 140, t, this.env(bg.gain, t, 0.002, 0.12, 0.035), bg);
    });
  }

  harvestStart(tier: PeachTier): void {
    this.safe(undefined, () => {
      if (!this.ok()) return;
      if (this.harvest) {
        if (this.harvest.tier === tier) return;
        this.harvestStop();
      }
      const ctx = this.ctx!;
      const t = ctx.currentTime + 0.01;
      const end = t + 3600;
      const shot = new Shot(this.transient);
      const out = this.gain(shot, 0, this.sfx);
      out.gain.setValueAtTime(0, t);
      out.gain.setTargetAtTime(0.55, t, 0.08);

      // leaf rustle: noise with irregular AM
      const vca = this.gain(shot, 0.35, out);
      const bp = this.filt(shot, 'bandpass', 2800, 0.7, vca);
      this.noise(shot, t, end, bp);
      for (const [f, d] of [
        [7.3, 0.15],
        [2.9, 0.12],
        [13.1, 0.07],
      ] as Array<[number, number]>) {
        this.osc(shot, 'sine', f * rand(0.9, 1.1), t, end, this.gain(shot, d, vca.gain));
      }
      // twig strain: slow stick-slip creak
      const sv = this.gain(shot, 0.22, out);
      this.osc(shot, 'sine', 0.35, t, end, this.gain(shot, 0.18, sv.gain));
      const sbp = this.filt(shot, 'bandpass', 1150, 8, sv);
      const saw = this.osc(shot, 'sawtooth', 22, t, end, sbp);
      this.osc(shot, 'sine', 0.5, t, end, this.gain(shot, 8, saw.frequency));
      // shimmer for higher tiers
      if (tier > 0) {
        const notes = [1318.5, 1975.5, 2637, 3520].slice(0, tier === 3 ? 4 : tier);
        const sh = this.gain(shot, 0.6, out);
        this.osc(shot, 'sine', 5.5, t, end, this.gain(shot, 0.4, sh.gain));
        for (const n of notes) {
          const lvl = 0.012 * tier;
          this.osc(shot, 'sine', n, t, end, this.gain(shot, lvl, sh));
          this.osc(shot, 'sine', n * 1.004, t, end, this.gain(shot, lvl * 0.7, sh));
        }
        this.send(shot, sh, 0.5);
      }
      this.harvest = { tier, shot, gain: out };
    });
  }

  harvestStop(): void {
    this.safe(undefined, () => {
      const h = this.harvest;
      this.harvest = null;
      if (!h || !this.ctx) return;
      const t = this.ctx.currentTime;
      this.hold(h.gain.gain, t);
      h.gain.gain.setTargetAtTime(0, t, 0.04);
      h.shot.stop(t + 0.3);
    });
  }

  pickup(tier: PeachTier): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('pickup', 0.08)) return;
      const tr = clamp(Math.round(Number(tier) || 0), 0, 3);
      const t = this.ctx!.currentTime + 0.01;
      const shot = new Shot(this.transient);
      // stem snap + leafy pluck
      const nb = this.filt(shot, 'bandpass', 1600, 1, this.sfx);
      const ng = this.gain(shot, 0, nb);
      this.noise(shot, t, this.env(ng.gain, t, 0.001, 0.6, 0.04), ng);
      const pg = this.gain(shot, 0, this.sfx);
      const pe = this.env(pg.gain, t, 0.002, 0.45, 0.09);
      const pop = this.osc(shot, 'sine', 520, t, pe, pg);
      pop.frequency.setValueAtTime(520, t);
      pop.frequency.exponentialRampToValueAtTime(170, t + 0.07);

      // chime
      const bus = this.gain(shot, 1, this.sfx);
      const ct = t + 0.05;
      if (tr === 0) {
        this.bell(shot, 1046.5, ct, 0.6, 0.09, bus);
      } else if (tr === 1) {
        this.bell(shot, 1046.5, ct, 0.8, 0.08, bus);
        this.bell(shot, 1318.5, ct + 0.07, 0.9, 0.08, bus);
        this.send(shot, bus, 0.2);
      } else if (tr === 2) {
        [1046.5, 1318.5, 1568].forEach((f, i) => this.bell(shot, f, ct + i * 0.07, 1.3, 0.075, bus));
        this.send(shot, bus, 0.35);
      } else {
        // rich bell-like shimmer chord
        [523.25, 783.99, 1174.66, 1318.5, 1760, 2349.3].forEach((f, i) =>
          this.bell(shot, f, ct + i * 0.045, 2.6, 0.065, bus),
        );
        const pad = this.gain(shot, 0, bus);
        pad.gain.setValueAtTime(0, ct);
        pad.gain.linearRampToValueAtTime(0.04, ct + 0.4);
        pad.gain.linearRampToValueAtTime(0, ct + 2.8);
        for (const f of [261.63, 392, 523.25]) {
          this.osc(shot, 'triangle', f, ct, ct + 2.9, pad);
          this.osc(shot, 'triangle', f * 1.005, ct, ct + 2.9, pad);
        }
        this.osc(shot, 'sine', 6, ct, ct + 2.9, this.gain(shot, 0.015, pad.gain));
        this.send(shot, bus, 0.6);
      }
    });
  }

  /** Plays the "猴哥" (hóu gē, "monkey bro") call from a world position; returns duration in seconds. */
  callerVoice(position: THREE.Vector3): number {
    return this.safe(CALLER_DURATION, () => {
      if (!this.ok()) return CALLER_DURATION;
      const ctx = this.ctx!;
      const now = ctx.currentTime;
      const since = now - this.callerStart;
      if (since < CALLER_DURATION * 0.6) return Math.max(0.2, CALLER_DURATION - since);
      this.callerStart = now;
      const t0 = now + 0.04;
      const shot = new Shot(this.transient);
      // Everything audible goes through ONE HRTF panner: no dry/stereo bypass, so the
      // ears get an unambiguous "behind me" cue. Source lifted slightly over head height.
      const pos = new THREE.Vector3(position.x, position.y + CALLER_LIFT, position.z);
      // ref 6 / rolloff 0.9: ~0.53 gain at 12 m, ~0.85 at 7 m -> present at the spawn
      // distance and clearly louder as it creeps in.
      const pan = this.panner(shot, pos, 6, 0.9, this.voice);
      // rear head-shadow: a high shelf that deepens while the caller is behind (re-aimed per frame)
      const shelf = this.filt(shot, 'highshelf', 3200, 0.7, pan);
      shelf.gain.value = 0;
      // gentle presence lift so the breath (and the HRTF's >3 kHz cues) cut through the ambience
      const air = this.filt(shot, 'peaking', 5200, 0.8, shelf);
      air.gain.value = 4;
      const out = this.gain(shot, 1, air);
      this.callerRear = { shelf, pos, until: t0 + CALLER_DURATION + 0.3 };
      this.aimCallerRear(this.listenerFwd.x, this.listenerFwd.z);
      // modest, slightly late reverb send: room tail without smearing the direction
      const wet = this.gain(shot, 0, this.reverb);
      wet.gain.setValueAtTime(0, t0);
      wet.gain.linearRampToValueAtTime(0.22, t0 + 0.25);
      wet.gain.linearRampToValueAtTime(0.38, t0 + 1.2);
      out.connect(wet);

      // breathy, coaxing main voice
      this.formantVoice(shot, t0, 1.0, 0.85, 0.5, this.gain(shot, 0.85, out));
      // close whisper double, a hair sharp and ~35 ms late (intimate, slightly unreal)
      this.formantVoice(shot, t0 + 0.035, 1.012, 0.08, 1.0, this.gain(shot, 0.5, out));

      this.speak(position);
      return CALLER_DURATION;
    });
  }

  private formantVoice(shot: Shot, t0: number, pitchMul: number, voiced: number, breath: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const keys = CALLER_KEYS;
    const tLast = keys[keys.length - 1][0];
    const tEnd = t0 + tLast + 0.05;

    // formant bank: F1..F3 keyframed, F4 fixed "air"
    const makeup = this.gain(shot, 6.5, out);
    const input = this.gain(shot, 1);
    const formants: BiquadFilterNode[] = [];
    for (let i = 0; i < FORMANT_BW.length; i++) {
      const f0 = i < 3 ? keys[0][i + 1] : CALLER_F4;
      const lvl = this.gain(shot, FORMANT_LEVEL[i], makeup);
      const f = this.filt(shot, 'bandpass', f0, f0 / FORMANT_BW[i], lvl);
      input.connect(f);
      formants.push(f);
    }

    // breathy glottal source with jittered pitch contour + growing vibrato
    const src = ctx.createOscillator();
    src.setPeriodicWave(this.glottal);
    const vGain = this.gain(shot, 0, input);
    src.connect(vGain);
    const fq = src.frequency;
    const interp = (P: Array<[number, number]>, tt: number): number => {
      if (tt <= P[0][0]) return P[0][1];
      for (let i = 1; i < P.length; i++) {
        if (tt <= P[i][0]) {
          const [ta, fa] = P[i - 1];
          const [tb, fb] = P[i];
          return fa + ((fb - fa) * (tt - ta)) / (tb - ta);
        }
      }
      return P[P.length - 1][1];
    };
    fq.setValueAtTime(interp(CALLER_PITCH, 0) * pitchMul, t0);
    let drift = 0;
    for (let tt = 0.025; tt <= tLast + 0.001; tt += 0.025) {
      drift = drift * 0.7 + (Math.random() - 0.5) * 0.012; // gentle, not gruff
      fq.linearRampToValueAtTime(interp(CALLER_PITCH, tt) * pitchMul * (1 + drift), t0 + tt);
    }
    shot.play(src, t0, tEnd);
    // vibrato: ~5.6 Hz, depth (Hz) automated so it blooms on the held "gē"
    const vib = this.gain(shot, 0, fq);
    for (const [vt, depth] of CALLER_VIBRATO) {
      const hz = depth * interp(CALLER_PITCH, vt) * pitchMul;
      if (vt === 0) vib.gain.setValueAtTime(hz, t0);
      else vib.gain.linearRampToValueAtTime(hz, t0 + vt);
    }
    this.osc(shot, 'sine', 5.6 * rand(0.95, 1.05), t0, tEnd, vib);

    // breath / aspiration noise into formants (high-passed: airy, not hissy-low)
    const amt = Math.max(voiced, breath);
    const bGain = this.gain(shot, 0, input);
    const bHp = this.filt(shot, 'highpass', 900, 0.7, bGain);
    this.noise(shot, t0, tEnd, bHp);

    // keyframed formants and amplitudes
    keys.forEach(([kt, f1, f2, f3, v, asp], idx) => {
      const at = t0 + kt;
      const fs = [f1, f2, f3];
      for (let i = 0; i < 3; i++) {
        const fr = formants[i].frequency;
        const q = formants[i].Q;
        if (idx === 0) {
          fr.setValueAtTime(fs[i], at);
          q.setValueAtTime(fs[i] / FORMANT_BW[i], at);
        } else {
          fr.linearRampToValueAtTime(fs[i], at);
          q.linearRampToValueAtTime(fs[i] / FORMANT_BW[i], at);
        }
      }
      // slight amplitude sway: languid rather than steady
      const wob = v > 0 ? rand(0.94, 1.04) : 1;
      // breath rides on the voicing (breathy phonation) plus the keyed aspiration
      const b = v * breath * 0.55 * wob + asp * amt * 0.8;
      if (idx === 0) {
        vGain.gain.setValueAtTime(v * voiced, at);
        bGain.gain.setValueAtTime(b, at);
      } else {
        vGain.gain.linearRampToValueAtTime(v * voiced * wob, at);
        bGain.gain.linearRampToValueAtTime(b, at);
      }
    });

    // /g/ release: brief, soft voiced burst
    const gT = t0 + 0.64;
    const gBp = this.filt(shot, 'bandpass', 2300, 1.5, out);
    const gG = this.gain(shot, 0, gBp);
    this.noise(shot, gT, this.env(gG.gain, gT, 0.004, 0.1 * amt, 0.02), gG);
  }

  /**
   * Optional SpeechSynthesis double of "猴哥". It cannot be routed into Web Audio (so it
   * can't be HRTF-panned) and plays dead-centre "inside the head", which fights the
   * behind-you cue. So: Chinese *female* voices only (else silent), very quiet, and it
   * always lands after the procedural voice (precedence effect keeps localisation on
   * the panned voice).
   */
  private speak(position: THREE.Vector3): void {
    if (CALLER_TTS_VOLUME <= 0) return;
    try {
      const ss = window.speechSynthesis;
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
      const voices = ss.getVoices();
      if (!voices || voices.length === 0) return;
      const zh = voices.filter((v) => /^(zh|cmn)/i.test(v.lang));
      if (zh.length === 0) return; // never speak it with a non-Chinese voice
      const female =
        /female|女|ting-?ting|mei-?jia|sin-?ji|xiao ?xiao|xiao ?yi|xiao ?han|xiao ?mo|xiao ?rui|xiao ?shuang|xiao ?meng|xiao ?zhen|hui ?hui|yao ?yao|han ?han|li-?mu|yu-?shu|shan-?shan|ya-?ling|google\s*(普通话|國語|粤語)/i;
      const male = /\bmale\b|男|kangkang|yunxi|yunyang|yunjian|yunze|yunfeng/i;
      const fem = zh.filter((v) => female.test(v.name) && !male.test(v.name));
      if (fem.length === 0) return; // no known female zh voice: stay silent rather than a male TTS
      const pick = fem.find((v) => /^zh[-_]cn/i.test(v.lang)) ?? fem[0];
      const u = new SpeechSynthesisUtterance('猴哥');
      u.lang = pick.lang || 'zh-CN';
      u.voice = pick;
      u.rate = 0.62; // drawn out
      u.pitch = 1.25; // light, feminine
      const d = this.listenerPos.distanceTo(position);
      u.volume = CALLER_TTS_VOLUME * clamp(6 / Math.max(6, Number.isFinite(d) ? d : 6), 0.3, 1);
      ss.cancel();
      // start a beat after the panned voice so the ear locks onto that one first
      window.setTimeout(() => {
        try {
          if (this.ok()) ss.speak(u);
        } catch {
          /* ignore */
        }
      }, 120);
    } catch {
      /* speech synthesis unavailable */
    }
  }

  chaserGrowl(position: THREE.Vector3): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('growl', 0.5)) return;
      const t = this.ctx!.currentTime + 0.02;
      const D = 0.85;
      const shot = new Shot(this.transient);
      const pan = this.panner(shot, position, 4, 1, this.sfx);
      const out = this.gain(shot, 0, pan);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.8, t + 0.08);
      out.gain.setValueAtTime(0.75, t + D - 0.25);
      out.gain.linearRampToValueAtTime(0, t + D);
      this.send(shot, out, 0.35);

      const f1 = this.filt(shot, 'bandpass', 420, 2, out);
      const f2 = this.filt(shot, 'bandpass', 1050, 3, this.gain(shot, 0.6, out));
      const ws = this.shaper(shot, f1);
      ws.connect(f2);
      // gravel: fast irregular AM
      const vca = this.gain(shot, 0.5, this.gain(shot, 2.5, ws));
      this.osc(shot, 'sine', rand(22, 26), t, t + D, this.gain(shot, 0.3, vca.gain));
      this.osc(shot, 'sine', rand(29, 34), t, t + D, this.gain(shot, 0.2, vca.gain));
      const contour = (o: OscillatorNode, m: number): void => {
        o.frequency.setValueAtTime(68 * m, t);
        o.frequency.exponentialRampToValueAtTime(86 * m, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(55 * m, t + D);
      };
      contour(this.osc(shot, 'sawtooth', 68, t, t + D, vca), 1);
      contour(this.osc(shot, 'square', 34, t, t + D, this.gain(shot, 0.5, vca)), 0.503);
      // raspy breath
      const lp = this.filt(shot, 'lowpass', 750, 1, this.gain(shot, 0.5, out));
      this.noise(shot, t, t + D, lp);
    });
  }

  chaserScream(position: THREE.Vector3): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('scream', 0.4)) return;
      const t = this.ctx!.currentTime + 0.01;
      const D = 0.72;
      const shot = new Shot(this.transient);
      const pan = this.panner(shot, position, 5, 1, this.sfx);
      const out = this.gain(shot, 0, pan);
      // "EEEK" ... "ak"
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.55, t + 0.02);
      out.gain.setValueAtTime(0.5, t + 0.34);
      out.gain.linearRampToValueAtTime(0, t + 0.42);
      out.gain.setValueAtTime(0, t + 0.47);
      out.gain.linearRampToValueAtTime(0.45, t + 0.49);
      out.gain.linearRampToValueAtTime(0, t + D);
      this.send(shot, out, 0.45);

      const hp = this.filt(shot, 'highpass', 600, 0.7, out);
      const b1 = this.filt(shot, 'bandpass', 2400, 2, hp);
      const b2 = this.filt(shot, 'bandpass', 3600, 3, this.gain(shot, 0.7, hp));
      const ws = this.shaper(shot, b1);
      ws.connect(b2);
      const pre = this.gain(shot, 1.8, ws);
      const vib = this.gain(shot, 120, undefined);
      this.osc(shot, 'sine', 14, t, t + D, vib);
      for (const [type, m, lvl] of [
        ['sawtooth', 1, 0.6],
        ['square', 1.03, 0.3],
      ] as Array<[OscillatorType, number, number]>) {
        const o = this.osc(shot, type, 900 * m, t, t + D, this.gain(shot, lvl, pre));
        vib.connect(o.frequency);
        const f = o.frequency;
        f.setValueAtTime(900 * m, t);
        f.exponentialRampToValueAtTime(1750 * m, t + 0.08);
        f.exponentialRampToValueAtTime(1500 * m, t + 0.3);
        f.exponentialRampToValueAtTime(1100 * m, t + 0.42);
        f.setValueAtTime(1450 * m, t + 0.47);
        f.exponentialRampToValueAtTime(1650 * m, t + 0.52);
        f.exponentialRampToValueAtTime(850 * m, t + D);
      }
      const nh = this.filt(shot, 'highpass', 2500, 0.7, this.gain(shot, 0.25, out));
      this.noise(shot, t, t + D, nh);
    });
  }

  chaserHit(): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('hit', 0.15)) return;
      const t = this.ctx!.currentTime + 0.005;
      const shot = new Shot(this.transient);
      // impact
      const lp = this.filt(shot, 'lowpass', 2500, 0.7, this.sfx);
      const ig = this.gain(shot, 0, lp);
      this.noise(shot, t, this.env(ig.gain, t, 0.001, 0.9, 0.12), ig);
      // low thud
      const tg = this.gain(shot, 0, this.shaper(shot, this.sfx));
      const te = this.env(tg.gain, t, 0.003, 1.2, 0.45);
      const o = this.osc(shot, 'sine', 95, t, te, tg);
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
      // flesh rip: crackly AM noise, sweeping bandpass
      const rt = t + 0.04;
      const bp = this.filt(shot, 'bandpass', 600, 3, this.sfx);
      bp.frequency.setValueAtTime(600, rt);
      bp.frequency.exponentialRampToValueAtTime(3500, rt + 0.3);
      const rg = this.gain(shot, 0, bp);
      rg.gain.setValueAtTime(0, rt);
      rg.gain.linearRampToValueAtTime(0.9, rt + 0.03);
      rg.gain.linearRampToValueAtTime(0, rt + 0.35);
      const am = this.gain(shot, 0.5, rg);
      this.osc(shot, 'sawtooth', 38, rt, rt + 0.36, this.gain(shot, 0.5, am.gain));
      this.noise(shot, rt, rt + 0.36, am);
    });
  }

  summonerHowl(position: THREE.Vector3): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('howl', 2)) return;
      const ctx = this.ctx!;
      const t = ctx.currentTime + 0.05;
      const D = 3.8;
      const shot = new Shot(this.transient);
      const pan = this.panner(shot, position, 15, 0.6, this.sfx);
      const out = this.gain(shot, 0, pan);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.9, t + 0.6);
      out.gain.setValueAtTime(0.9, t + D - 1.1);
      out.gain.linearRampToValueAtTime(0, t + D);
      this.send(shot, out, 1.2);

      // vowel-ish formants "ooo-aaa-ooo" + dark body
      const shaped = this.gain(shot, 1);
      const fA = this.filt(shot, 'bandpass', 300, 4, out);
      const fB = this.filt(shot, 'bandpass', 700, 5, this.gain(shot, 0.6, out));
      const body = this.filt(shot, 'lowpass', 1200, 0.7, this.gain(shot, 0.35, out));
      shaped.connect(fA);
      shaped.connect(fB);
      shaped.connect(body);
      fA.frequency.setValueAtTime(300, t);
      fA.frequency.linearRampToValueAtTime(750, t + 1.4);
      fA.frequency.linearRampToValueAtTime(650, t + 2.4);
      fA.frequency.linearRampToValueAtTime(320, t + D);
      fB.frequency.setValueAtTime(700, t);
      fB.frequency.linearRampToValueAtTime(1150, t + 1.4);
      fB.frequency.linearRampToValueAtTime(650, t + D);
      const ws = this.shaper(shot, shaped);
      const pre = this.gain(shot, 1.5, ws);

      // vibrato in cents, deepening over time
      const vibDepth = this.gain(shot, 5);
      vibDepth.gain.setValueAtTime(5, t);
      vibDepth.gain.linearRampToValueAtTime(45, t + 2.5);
      const vib = this.osc(shot, 'sine', 4.2, t, t + D, vibDepth);
      vib.frequency.linearRampToValueAtTime(5.5, t + D);
      const contour: Array<[number, number]> = [
        [0, 62],
        [0.6, 95],
        [1.4, 150],
        [2.4, 140],
        [3.2, 95],
        [D, 55],
      ];
      const layers: Array<[OscillatorType, number, number]> = [
        ['sawtooth', 1, 0.35],
        ['sawtooth', 1.007, 0.3],
        ['sawtooth', 0.993, 0.3],
        ['sawtooth', 0.5, 0.35],
        ['triangle', 2.01, 0.2],
      ];
      for (const [type, m, lvl] of layers) {
        const o = this.osc(shot, type, contour[0][1] * m, t, t + D, this.gain(shot, lvl, pre));
        vibDepth.connect(o.detune);
        o.frequency.setValueAtTime(contour[0][1] * m, t);
        for (let i = 1; i < contour.length; i++) {
          o.frequency.exponentialRampToValueAtTime(contour[i][1] * m, t + contour[i][0]);
        }
      }
      // breath
      const nb = this.filt(shot, 'bandpass', 500, 0.8, this.gain(shot, 0.25, out));
      this.noise(shot, t, t + D, nb);

      // non-positional sub rumble: the ground itself
      const rum = this.gain(shot, 0, this.sfx);
      rum.gain.setValueAtTime(0, t);
      rum.gain.linearRampToValueAtTime(0.3, t + 1.2);
      rum.gain.linearRampToValueAtTime(0, t + D + 0.8);
      this.osc(shot, 'sine', 32, t, t + D + 0.9, rum);
      this.osc(shot, 'sine', 45, t, t + D + 0.9, this.gain(shot, 0.6, rum));

      // the forest wakes: crickets stop, branches creak, birds scatter
      const now = ctx.currentTime;
      this.cricketSilenceUntil = now + 25;
      for (let i = 0; i < 3; i++) this.creak(t + rand(1.0, 4.5), null, 1.3);
      for (let i = 0; i < 2; i++) this.flutter(t + rand(0.8, 2.5), rand(-1, 1));
    });
  }

  playerHurt(): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('hurt', 0.15)) return;
      const t = this.ctx!.currentTime + 0.005;
      const shot = new Shot(this.transient);
      const tg = this.gain(shot, 0, this.sfx);
      const te = this.env(tg.gain, t, 0.003, 0.7, 0.18);
      const o = this.osc(shot, 'sine', 120, t, te, tg);
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.18);
      // gasp ("hah")
      const gt = t + 0.02;
      const out = this.gain(shot, 0, this.sfx);
      out.gain.setValueAtTime(0, gt);
      out.gain.linearRampToValueAtTime(0.5, gt + 0.03);
      out.gain.exponentialRampToValueAtTime(0.001, gt + 0.28);
      const f1 = this.filt(shot, 'bandpass', 850, 3, out);
      const f2 = this.filt(shot, 'bandpass', 1450, 4, this.gain(shot, 0.7, out));
      const f3 = this.filt(shot, 'bandpass', 2600, 5, this.gain(shot, 0.4, out));
      const src = this.gain(shot, 3, f1);
      src.connect(f2);
      src.connect(f3);
      this.noise(shot, gt, gt + 0.3, src);
    });
  }

  death(cause: 'grabber' | 'caller'): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('death', 1)) return;
      const ctx = this.ctx!;
      const t = ctx.currentTime + 0.01;
      // stings are not registered with stopAll, so a restart right after death won't cut them
      const shot = new Shot(null);
      this.harvestStop();
      if (cause === 'caller') {
        // sudden silence...
        this.duckUntil = t + 4.5;
        for (const g of [this.amb, this.music]) {
          this.hold(g.gain, t);
          g.gain.linearRampToValueAtTime(0, t + 0.03);
          g.gain.setTargetAtTime(1, t + 4.5, 0.8);
        }
        for (const g of [this.heartGain, this.footGain]) {
          this.hold(g.gain, t);
          g.gain.linearRampToValueAtTime(0, t + 0.03);
        }
        // ...then a high dissonant cluster
        const ct = t + 0.7;
        const out = this.gain(shot, 0, this.sting);
        out.gain.setValueAtTime(0, ct);
        out.gain.linearRampToValueAtTime(0.5, ct + 0.04);
        out.gain.setTargetAtTime(0, ct + 0.6, 1.0);
        this.send(shot, out, 0.9);
        const trem = this.gain(shot, 0.8, out);
        this.osc(shot, 'sine', 7, ct, ct + 5, this.gain(shot, 0.2, trem.gain));
        for (const f of [1760, 1864.7, 1975.5, 2093, 2217.5]) {
          this.osc(shot, 'sine', f * rand(0.997, 1.003), ct, ct + 5, this.gain(shot, 0.06, trem));
          this.osc(shot, 'triangle', f * 0.5 * rand(0.995, 1.005), ct, ct + 5, this.gain(shot, 0.025, trem));
        }
        const sub = this.gain(shot, 0, this.sting);
        this.osc(shot, 'sine', 41, ct, this.env(sub.gain, ct, 0.01, 0.5, 2.5), sub);
      } else {
        // violent crash + low boom
        const crash = this.gain(shot, 0, this.sting);
        const ce = this.env(crash.gain, t, 0.002, 0.9, 1.3);
        const bp = this.filt(shot, 'bandpass', 3000, 0.6, crash);
        bp.frequency.setValueAtTime(3000, t);
        bp.frequency.exponentialRampToValueAtTime(300, t + 1.2);
        this.noise(shot, t, ce, this.gain(shot, 2.5, this.shaper(shot, bp)));
        this.send(shot, crash, 0.6);
        const boom = this.gain(shot, 0, this.sting);
        const be = this.env(boom.gain, t, 0.004, 1.1, 2.2);
        const o1 = this.osc(shot, 'sine', 70, t, be, boom);
        o1.frequency.setValueAtTime(70, t);
        o1.frequency.exponentialRampToValueAtTime(24, t + 1.8);
        const o2 = this.osc(shot, 'triangle', 140, t, be, this.gain(shot, 0.3, boom));
        o2.frequency.setValueAtTime(140, t);
        o2.frequency.exponentialRampToValueAtTime(48, t + 1.5);
        this.send(shot, boom, 0.4);
      }
    });
  }

  extractCharge(progress01: number): void {
    this.safe(undefined, () => {
      if (!this.ok()) return;
      const p = clamp(Number.isFinite(progress01) ? progress01 : 0, 0, 1);
      if (p <= 0) {
        this.tgt(this.extractGain.gain, 0, 0.1);
        this.lastExtract = -1;
        return;
      }
      this.lastExtract = this.ctx!.currentTime;
      const base = 110 * Math.pow(2, p * 1.5);
      const mul = [1, 1.5, 2];
      this.extractOscs.forEach((o, i) => this.tgt(o.frequency, base * mul[i], 0.08));
      this.tgt(this.extractFilter.frequency, 500 + 2500 * p, 0.1);
      this.tgt(this.extractLfo.frequency, 3 + 9 * p, 0.1);
      this.tgt(this.extractGain.gain, 0.05 + 0.1 * p, 0.08);
    });
  }

  extractSuccess(): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('extract', 1)) return;
      const t = this.ctx!.currentTime + 0.02;
      this.lastExtract = -1;
      this.tgt(this.extractGain.gain, 0, 0.05);
      const shot = new Shot(null);
      const out = this.gain(shot, 1, this.sting);
      this.send(shot, out, 0.5);
      const lp = this.filt(shot, 'lowpass', 1400, 0.7, out);
      const pad = (freqs: number[], start: number, end: number, peak: number): void => {
        const g = this.gain(shot, 0, lp);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(peak, start + 0.25);
        g.gain.setTargetAtTime(0, end - 0.6, 0.35);
        for (const f of freqs) {
          this.osc(shot, 'sawtooth', f * 0.998, start, end + 1.5, g);
          this.osc(shot, 'sawtooth', f * 1.003, start, end + 1.5, g);
        }
      };
      // Dsus4 resolving to D major (add 9)
      const sus = this.gain(shot, 0, lp);
      sus.gain.setValueAtTime(0, t);
      sus.gain.linearRampToValueAtTime(0.03, t + 0.12);
      sus.gain.linearRampToValueAtTime(0, t + 0.55);
      for (const f of [146.83, 196, 220, 293.66]) this.osc(shot, 'sawtooth', f, t, t + 0.6, sus);
      pad([146.83, 185, 220, 293.66, 329.63, 369.99], t + 0.4, t + 3.8, 0.025);
      const bells = this.gain(shot, 1, out);
      this.bell(shot, 587.33, t + 0.42, 2.5, 0.09, bells);
      this.bell(shot, 880, t + 0.55, 2.2, 0.06, bells);
      this.bell(shot, 1174.66, t + 0.7, 2.0, 0.04, bells);
    });
  }

  uiClick(): void {
    this.safe(undefined, () => {
      if (!this.ok() || !this.gate('ui', 0.03)) return;
      const t = this.ctx!.currentTime + 0.003;
      const shot = new Shot(this.transient);
      const g = this.gain(shot, 0, this.sfx);
      const e = this.env(g.gain, t, 0.001, 0.22, 0.05);
      const o = this.osc(shot, 'sine', 820, t, e, g);
      o.frequency.setValueAtTime(820, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.04);
      const g2 = this.gain(shot, 0, this.sfx);
      this.osc(shot, 'sine', 2150, t, this.env(g2.gain, t, 0.001, 0.06, 0.018), g2);
      const bp = this.filt(shot, 'bandpass', 3000, 2, this.sfx);
      const ng = this.gain(shot, 0, bp);
      this.noise(shot, t, this.env(ng.gain, t, 0.0005, 0.25, 0.006), ng);
    });
  }

  // ------------------------------------------------------------- lifecycle

  stopAll(): void {
    this.safe(undefined, () => {
      if (!this.ctx || !this.built) return;
      const t = this.ctx.currentTime;
      this.harvestStop();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      // fast click-free dip of the transient buses while sources stop
      for (const g of [this.sfx, this.voice]) {
        this.hold(g.gain, t);
        g.gain.linearRampToValueAtTime(0, t + 0.03);
        g.gain.setTargetAtTime(1, t + 0.08, 0.02);
      }
      for (const s of this.transient) {
        try {
          s.stop(t + 0.05);
        } catch {
          /* ignore */
        }
      }
      // reset continuous layers (update() brings them back)
      for (const g of [this.footGain, this.heartGain, this.chaseGain, this.droneGain, this.extractGain]) {
        this.hold(g.gain, t);
        g.gain.setTargetAtTime(0, t, 0.05);
      }
      if (t >= this.duckUntil) {
        for (const g of [this.amb, this.music]) {
          this.hold(g.gain, t);
          g.gain.setTargetAtTime(1, t, 0.1);
        }
      }
      this.hold(this.muffle.frequency, t);
      this.muffle.frequency.setTargetAtTime(Math.min(20000, this.ctx.sampleRate * 0.45), t, 0.1);
      this.lastTargets = new WeakMap();
      this.stepPhase = 0.7;
      this.nextBeat = 0;
      this.nextDrum = 0;
      this.drumStep = 0;
      this.lastExtract = -1;
      this.cricketSilenceUntil = 0;
      this.callerStart = -10;
    });
  }

  dispose(): void {
    this.safe(undefined, () => {
      this.stopAll();
      const ctx = this.ctx;
      this.ctx = null;
      this.built = false;
      this.harvest = null;
      this.transient.clear();
      this.persistent.length = 0;
      this.extractOscs.length = 0;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    });
  }
}
