import * as THREE from 'three';
import { MaterialLibrary, TIER_COLORS } from '../assets/MaterialLibrary';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { LOW_SPEC } from '../core/Quality';
import { Caller, Grabber, Howler, type MonsterContext } from '../entities/Monsters';
import { PeachField, TIER_HARVEST_TIME, TIER_NAMES, TIER_VALUE, type Peach } from '../entities/PeachField';
import { Player, PLAYER } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { BurstVfx, RenderPipeline } from '../systems/RenderPipeline';
import { Hud, type CompassMarker } from '../ui/Hud';
import { createSeededRandom } from '../utils/random';
import { Level, pathPoint } from './Level';
import { ZONE_GLYPHS, ZONE_NAMES, zoneAt } from './LevelPath';

type GameState = 'title' | 'playing' | 'paused' | 'dead' | 'extracted';
type DeathCause = 'grabber' | 'caller';

const MAX_DPR = LOW_SPEC ? 0.7 : 1.25;
const HARVEST_REACH = 3.0;
const EXTRACT_TIME = 3.6;
const EXTRACT_RADIUS = 3.1;
const HUNT_DURATION = 45;
const GRABBER_HIT = 50;
const BEST_KEY = 'monkeybro.best';
const FOG_NORMAL = new THREE.Color('#1a0f2e');
const FOG_HUNT = new THREE.Color('#3a0f1c');
/** Shrine candidate indices by zone pool (Level places 2 per zone: 0,1 | 2,3 | 4,5). */
const POOL_I_II = [0, 1, 2, 3];
const POOL_II_III = [2, 3, 4, 5];
/** Grabber layout: [zone t-range] per grabber. Zone I → 2, II → 3, III → 3 (faster). */
const GRABBER_PLAN: { zone: number; t0: number; t1: number }[] = [
  { zone: 0, t0: 48, t1: 80 },
  { zone: 0, t0: 85, t1: 120 },
  { zone: 1, t0: 132, t1: 165 },
  { zone: 1, t0: 170, t1: 205 },
  { zone: 1, t0: 210, t1: 250 },
  { zone: 2, t0: 262, t1: 300 },
  { zone: 2, t0: 305, t1: 340 },
  { zone: 2, t0: 345, t1: 375 },
];

const DEATH_COPY: Record<DeathCause, { glyph: string; title: string; reason: string }> = {
  grabber: {
    glyph: '紫陌',
    title: '紫陌掠命',
    reason: 'Zi Mo caught you twice. Her grip tears away half your life — light flinches her, shadows hide you.',
  },
  caller: {
    glyph: '青鸾',
    title: '青鸾点名',
    reason: 'Qing Luan called “猴哥——” from behind. You turned and looked. Never answer her while you pick.',
  },
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 120);
  private readonly mats = new MaterialLibrary();
  private readonly level: Level;
  private readonly peachField: PeachField;
  private readonly player: Player;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly pipeline: RenderPipeline;
  private readonly burst: BurstVfx;
  private readonly input: Input;
  private readonly grabbers: Grabber[] = [];
  private readonly callers: Caller[] = [];
  private readonly howler: Howler;
  private readonly fog = new THREE.FogExp2('#1a0f2e', 0.026);
  private readonly loop = new Loop(
    (dt, elapsed) => this.update(dt, elapsed),
    () => this.render(),
  );
  private readonly cleanup: (() => void)[] = [];

  // Route ALL gameplay randomness through this.rng (never Math.random) so the
  // seed() test hook keeps screenshot baselines and bot playtests deterministic.
  private seedValue = 1;
  private rng = createSeededRandom(1);

  private state: GameState = 'title';
  private frame = 0;
  private elapsed = 0;
  private runTime = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;

  // run state
  private readonly satchel = [0, 0, 0, 0];
  private haul = 0;
  private activeShrines: number[] = [];
  private hunt = false;
  private huntTimer = 0;
  private harvestTarget: Peach | null = null;
  private harvestProgress = 0;
  private harvestTime = 0;
  private harvesting = false;
  private extractProgress = 0;
  private damage = 0;
  private deadDelay = 0;
  private lastZone = -1;
  private bestScore = 0;
  /** Set when pointer-lock loss itself paused the game, so that same Escape does not resume. */
  private suppressEscapeResume = false;
  private lockRequestId = 0;

  // scratch
  private readonly flat = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly mctx: MonsterContext;
  private readonly spawnTmp = new THREE.Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas, { antialias: !LOW_SPEC, shadows: !LOW_SPEC });
    if (LOW_SPEC) this.camera.far = 70;
    this.renderer.setClearColor('#1a0f2e');
    this.scene.background = new THREE.Color('#1a0f2e');
    this.scene.fog = this.fog;
    this.scene.add(this.camera);

    // Moonlit night: cold hemisphere fill + a faint directional moon (no shadow cost).
    const hemi = new THREE.HemisphereLight('#5a4a90', '#1c1428', 0.55);
    const moon = new THREE.DirectionalLight('#8fa4ff', 0.5);
    moon.position.set(-18, 40, -30);
    this.scene.add(hemi, moon);

    this.level = new Level(this.mats);
    this.scene.add(this.level.root);
    this.peachField = new PeachField(this.mats);
    this.scene.add(this.peachField.root);
    this.player = new Player(this.camera, this.scene);
    this.burst = new BurstVfx(this.mats.sparkle);
    this.scene.add(this.burst.points);

    this.howler = new Howler(this.mats);
    this.scene.add(this.howler.root);
    for (let z = 0; z < 3; z++) {
      const c = new Caller(this.mats, z);
      this.callers.push(c);
      this.scene.add(c.root);
    }
    for (const plan of GRABBER_PLAN) {
      const g = new Grabber(this.mats, pathPoint((plan.t0 + plan.t1) / 2, 0), this.grabbers.length);
      this.grabbers.push(g);
      this.scene.add(g.root);
    }

    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.input = new Input(canvas, this.el('#touch-stick'), this.el('#touch-knob'), {
      light: this.el('#touch-light'),
      harvest: this.el('#touch-harvest'),
      sprint: this.el('#touch-sprint'),
      look: this.el('#touch-look'),
    });
    this.input.modeChanged = () => this.onInputModeChanged();

    this.mctx = {
      playerPos: this.player.position,
      eye: this.player.eye,
      forward: this.player.forward,
      lightOn: true,
      sprinting: false,
      moving: false,
      harvesting: false,
      hunt: false,
      colliders: this.level.colliders,
      audio: this.audio,
      rng: () => this.rng(),
    };

    try {
      this.bestScore = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.bestScore = 0;
    }

    this.bindUi();
    this.prepareRun(1);
    this.setState('title');
    this.updateBestLine();
    this.fitRenderer();
    this.installTestHooks();
    if (import.meta.env.DEV) (window as unknown as { __MONKEYBRO__?: Game }).__MONKEYBRO__ = this;
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    for (const c of this.cleanup) c();
    this.input.dispose();
    this.audio.dispose();
    this.pipeline.dispose();
    this.peachField.dispose();
    this.level.dispose();
    this.mats.dispose();
    this.renderer.dispose();
    delete window.__THREE_GAME_TEST_HOOKS__;
    delete window.__THREE_GAME_DIAGNOSTICS__;
  }

  // ------------------------------------------------------------------ UI

  private el<T extends HTMLElement = HTMLElement>(sel: string): T {
    const e = document.querySelector<T>(sel);
    if (!e) throw new Error(`Missing element ${sel}`);
    return e;
  }

  private on<K extends keyof HTMLElementEventMap>(sel: string, type: K, fn: () => void): void {
    const e = this.el(sel);
    const handler = () => fn();
    e.addEventListener(type, handler);
    this.cleanup.push(() => e.removeEventListener(type, handler));
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanup.push(() => target.removeEventListener(type, fn));
  }

  private bindUi(): void {
    this.on('#start-button', 'click', () => {
      void this.audio.unlock();
      this.audio.uiClick();
      this.startRun();
    });
    this.on('#resume-button', 'click', () => {
      this.audio.uiClick();
      this.resume();
    });
    this.on('#mute-button', 'click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.el('#mute-button').textContent = this.audio.muted ? 'Sound: Off' : 'Sound: On';
      this.audio.uiClick();
    });
    for (const id of ['#restart-button', '#retry-button', '#again-button']) {
      this.on(id, 'click', () => {
        void this.audio.unlock();
        this.audio.uiClick();
        this.startRun();
      });
    }
    this.on('#touch-pause', 'click', () => this.pause());

    this.listen(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) {
        this.hud.setLockPrompt(false);
        return;
      }
      // Lock loss while playing pauses. State is set before releaseLock(), so a
      // pause that we initiated does not land here and cannot swallow the next Esc.
      if (this.state === 'playing' && !this.input.touchMode) {
        this.pause();
        this.suppressEscapeResume = true;
        window.setTimeout(() => {
          this.suppressEscapeResume = false;
        }, 500);
      }
      this.hud.setLockPrompt(false);
    });
    this.listen(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      if (ev.code !== 'Escape' && ev.code !== 'KeyP') return;
      if (this.state === 'paused' && ev.code === 'Escape' && this.suppressEscapeResume) {
        this.suppressEscapeResume = false;
        return;
      }
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    this.listen(this.canvas, 'click', () => {
      if (this.state === 'playing' && !this.input.touchMode && document.pointerLockElement !== this.canvas) this.requestLock();
    });
    this.listen(window, 'blur', () => {
      if (this.state === 'playing') this.pause();
    });
    this.listen(window, 'resize', () => this.fitRenderer());
  }

  private needsMouseLock(): boolean {
    return this.state === 'playing' && !this.input.touchMode && document.pointerLockElement !== this.canvas;
  }

  private requestLock(): void {
    if (this.input.touchMode) {
      this.hud.setLockPrompt(false);
      return;
    }
    const id = ++this.lockRequestId;
    let settled = false;
    const showIfNeeded = () => {
      if (settled || id !== this.lockRequestId) return;
      settled = true;
      this.hud.setLockPrompt(this.needsMouseLock());
    };
    try {
      // Do NOT use unadjustedMovement: on high-DPI Windows mice it makes look spin wildly.
      const pending = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (pending && typeof pending.then === 'function') {
        void pending.then(
          () => {
            settled = true;
            this.hud.setLockPrompt(false);
          },
          () => showIfNeeded(),
        );
      }
    } catch {
      showIfNeeded();
    }
    window.setTimeout(() => {
      if (id !== this.lockRequestId || settled) return;
      if (document.pointerLockElement === this.canvas) {
        this.hud.setLockPrompt(false);
        return;
      }
      if (this.needsMouseLock()) this.hud.setLockPrompt(true);
    }, 400);
  }

  private releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private updateBestLine(): void {
    this.el('#best-line').textContent = this.bestScore > 0 ? `Best haul: ${this.bestScore.toLocaleString('en-US')}` : '';
  }

  // --------------------------------------------------------------- states

  private setState(s: GameState): void {
    this.state = s;
    document.body.dataset.state = s;
    this.hud.setVisible(s === 'playing' || s === 'paused');
    const touchEl = this.el('#touch-controls');
    const showTouch = s === 'playing';
    touchEl.classList.toggle('active', showTouch);
    touchEl.setAttribute('aria-hidden', showTouch && (this.input?.touchMode ?? false) ? 'false' : 'true');
    document.body.classList.toggle('touch', this.input?.touchMode ?? false);
    if (s !== 'playing' || this.input?.touchMode) this.hud.setLockPrompt(false);
    this.hud.showScreen(s === 'title' ? 'title' : s === 'paused' ? 'pause' : s === 'dead' ? (this.deadDelay <= 0 ? 'dead' : null) : s === 'extracted' ? 'extracted' : null);
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.audio.harvestStop();
    this.endHarvest();
    // Mark paused before releasing the lock so the lock-loss handler does not
    // treat this Escape as a fresh pause and then resume on the same keydown.
    this.setState('paused');
    this.releaseLock();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    // The Escape that dropped pointer lock must not swallow a later press
    // after the player has already resumed with P.
    this.suppressEscapeResume = false;
    this.setState('playing');
    if (!this.input.touchMode) this.requestLock();
  }

  /** Keep the touch chrome and the pointer-lock path in step with Input. */
  private onInputModeChanged(): void {
    const touch = this.input.touchMode;
    document.body.classList.toggle('touch', touch);
    const playing = this.state === 'playing';
    this.el('#touch-controls').setAttribute('aria-hidden', playing && touch ? 'false' : 'true');
    if (touch) {
      this.hud.setLockPrompt(false);
      return;
    }
    if (playing) this.requestLock();
  }

  private harvestHint(): string {
    const pick = this.input.touchMode
      ? 'Hold the pick control on a glowing peach'
      : 'Hold E / click on a glowing peach to pick';
    return `Light on · ${pick} · If something calls “猴哥——” while you pick, never turn around.`;
  }

  /** Reset the world for a fresh night. Does not change the visible state. */
  private prepareRun(seed: number): void {
    this.seedValue = seed;
    this.rng = createSeededRandom(seed);
    const rng = this.rng;

    const gate = pathPoint(8, 0);
    this.player.reset(gate, 0);
    this.player.yaw = this.pathHeading(8);
    this.player.syncCamera(0, 0);

    this.peachField.reset(this.level.peachSpots, rng);

    const a = POOL_I_II[Math.floor(rng() * POOL_I_II.length)];
    let b = POOL_II_III[Math.floor(rng() * POOL_II_III.length)];
    if (b === a) b = POOL_II_III[(POOL_II_III.indexOf(b) + 1) % POOL_II_III.length];
    this.activeShrines = [a, b];
    this.level.setActiveShrines(this.activeShrines);

    this.grabbers.forEach((g, i) => {
      const plan = GRABBER_PLAN[i];
      const t = plan.t0 + rng() * (plan.t1 - plan.t0);
      g.respawn(pathPoint(t, (rng() - 0.5) * 12, this.spawnTmp));
    });
    for (const c of this.callers) c.reset();
    this.howler.reset();
    this.burst.clear();

    this.satchel.fill(0);
    this.haul = 0;
    this.hunt = false;
    this.huntTimer = 0;
    this.harvestTarget = null;
    this.harvestProgress = 0;
    this.harvesting = false;
    this.extractProgress = 0;
    this.damage = 0;
    this.deadDelay = 0;
    this.runTime = 0;
    this.lastZone = -1;
    this.fog.color.copy(FOG_NORMAL);
    this.fog.density = 0.026;
    (this.scene.background as THREE.Color).copy(FOG_NORMAL);
    this.hud.clearTransient();
    this.hud.setSatchel(this.satchel, 0, true);
    this.input.consumeLook();
    this.input.consumeLightToggle();
    this.huntVis = 0;
    this.darkAmt = 0;
    this.danger = 0;
    const u = this.pipeline.grade.uniforms;
    u.uRed.value = u.uDark.value = u.uDesat.value = u.uHunt.value = 0;
    this.audio.harvestStop();
    this.audio.extractCharge(0);
  }

  private pathHeading(t: number): number {
    const p0 = pathPoint(t, 0);
    const p1 = pathPoint(t + 4, 0);
    // forward is (-sin yaw, -cos yaw)
    return Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
  }

  startRun(seed?: number): void {
    const s = seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0) + 1;
    this.prepareRun(s);
    this.hud.showScreen(null);
    this.setState('playing');
    this.hud.setVisible(true);
    this.hud.setVitals(1, 1, 1, true);
    this.hud.showHint(this.harvestHint(), 9);
    this.hud.showBanner('偷桃前夜', 'Find a lit shrine to escape — your haul only counts if you get out.', 'info', 4);
    if (!this.input.touchMode) this.requestLock();
  }

  private die(cause: DeathCause): void {
    if (this.state !== 'playing') return;
    this.player.frozen = true;
    this.player.rooted = true;
    this.endHarvest();
    this.audio.death(cause);
    this.audio.extractCharge(0);
    this.releaseLock();
    this.damage = 1;
    this.hud.flash(cause === 'caller' ? '#e9f3ff' : '#8a0610', 0.9);
    if (cause === 'caller') {
      const c = this.callers.find((k) => k.state === 'calling') ?? this.callers[0];
      c.lunge(this.player.eye, this.player.forward);
    }
    const lost = this.haul;
    const copy = DEATH_COPY[cause];
    this.el('#dead-glyph').textContent = copy.glyph;
    this.el('#dead-title').textContent = copy.title;
    this.el('#dead-reason').textContent = copy.reason;
    this.el('#dead-lost').textContent = lost > 0 ? `Haul lost: ${lost.toLocaleString('en-US')}` : 'You carried nothing out.';
    this.deadDelay = cause === 'caller' ? 1.1 : 1.5;
    this.setState('dead');
  }

  private extract(): void {
    if (this.state !== 'playing') return;
    const newBest = this.haul > this.bestScore;
    if (newBest) {
      this.bestScore = this.haul;
      try {
        localStorage.setItem(BEST_KEY, String(this.bestScore));
      } catch {
        /* storage unavailable */
      }
    }
    this.audio.extractSuccess();
    this.audio.harvestStop();
    this.releaseLock();
    const rows = this.el('#result-rows');
    rows.replaceChildren();
    for (let t = 0; t < 4; t++) {
      if (this.satchel[t] === 0) continue;
      const row = document.createElement('div');
      row.className = 'result-row';
      row.style.color = TIER_COLORS[t];
      row.textContent = `${TIER_NAMES[t]} × ${this.satchel[t]} = ${(this.satchel[t] * TIER_VALUE[t]).toLocaleString('en-US')}`;
      rows.appendChild(row);
    }
    if (this.haul === 0) rows.textContent = 'You escaped empty-handed.';
    this.el('#result-total').textContent = this.haul.toLocaleString('en-US');
    this.el('#result-best').textContent = newBest ? 'New best haul!' : `Best haul: ${this.bestScore.toLocaleString('en-US')}`;
    this.updateBestLine();
    this.hud.clearTransient();
    this.player.frozen = true;
    this.setState('extracted');
  }

  // ----------------------------------------------------------------- loop

  private update(dt: number, elapsed: number): void {
    this.elapsed = elapsed;
    this.frame++;
    if (!this.pausedForScreenshot) {
      switch (this.state) {
        case 'playing':
          this.updatePlaying(dt, elapsed);
          break;
        case 'title':
          this.updateTitle(elapsed);
          break;
        case 'dead':
          this.updateDead(dt, elapsed);
          break;
        case 'extracted':
        case 'paused':
          break;
      }
      this.level.update(elapsed, this.camera.position, this.hunt ? 1 : 0);
      this.peachField.update(dt, this.reducedMotion ? 0 : elapsed);
      this.burst.update(dt);
    }
    this.hud.tick(dt);
    this.updateAudio(dt);
    this.publishDiagnostics();
  }

  private updateTitle(elapsed: number): void {
    // slow idle look around the moonlit gate
    const base = this.pathHeading(8);
    this.player.yaw = base + (this.reducedMotion ? 0 : Math.sin(elapsed * 0.18) * 0.35);
    this.player.pitch = -0.04;
    this.player.syncCamera(this.reducedMotion ? 0 : elapsed, 0);
  }

  private updateDead(dt: number, elapsed: number): void {
    this.player.syncCamera(elapsed, 0);
    this.damage = Math.max(0.5, this.damage - dt * 0.2);
    if (this.deadDelay > 0) {
      this.deadDelay -= dt;
      if (this.deadDelay <= 0) this.hud.showScreen('dead');
    }
    // monsters keep moving a little so the freeze-frame feels alive
    this.fillContext(false);
    for (const g of this.grabbers) g.animate(dt, elapsed, this.mctx);
  }

  private fillContext(harvesting: boolean): void {
    const c = this.mctx;
    c.lightOn = this.player.lightOn;
    c.sprinting = this.player.sprinting;
    c.moving = Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.6;
    c.harvesting = harvesting;
    c.hunt = this.hunt;
  }

  private updatePlaying(dt: number, elapsed: number): void {
    const p = this.player;
    this.runTime += dt;

    this.input.poll();
    const lightToggle = this.input.consumeLightToggle();
    document.body.classList.toggle('touch', this.input.touchMode);

    // ---- harvest targeting (uses last frame's camera orientation; look is applied in update)
    const toggled = p.update(dt, elapsed, this.input, this.level.colliders, lightToggle);
    if (toggled) this.audio.flashlight(p.lightOn);

    const target = this.peachField.findTarget(p.eye, p.forward, HARVEST_REACH, this.level.colliders);
    const wantsHarvest = this.input.harvest && !p.sprinting;
    if (wantsHarvest && target) {
      if (this.harvestTarget !== target) {
        this.harvestTarget = target;
        this.harvestProgress = 0;
        this.harvestTime = TIER_HARVEST_TIME[target.tier];
      }
      if (!this.harvesting) {
        this.harvesting = true;
        this.audio.harvestStart(target.tier);
      }
      p.rooted = true;
      this.harvestProgress += dt / this.harvestTime;
      if (this.harvestProgress >= 1) this.completeHarvest(target);
    } else {
      if (this.harvesting) this.audio.harvestStop();
      this.harvesting = false;
      p.rooted = false;
      this.harvestProgress = Math.max(0, this.harvestProgress - dt * 2.5);
      if (this.harvestProgress === 0) this.harvestTarget = null;
    }

    this.fillContext(this.harvesting);
    const ctx = this.mctx;

    // ---- Callers
    const zone = zoneAt(-p.position.z);
    this.syncFlat();
    for (const c of this.callers) {
      if (this.harvesting && c.zone === zone && this.runTime > 12 && this.callers.every((k) => k.state !== 'calling') && c.canCall()) {
        c.beginCall(ctx, this.flat);
      }
      const ev = c.update(dt, elapsed, ctx, this.hunt);
      if (ev === 'voice') {
        // The call is always the Chinese 「猴哥——」, never romanised.
        this.hud.showSubtitle('猴哥——', 2.2);
        this.hud.showBanner('青鸾点名', 'Do NOT turn around.', 'caller', 2.6);
      }
      if (c.armed && this.state === 'playing' && this.isLookingAt(c)) {
        this.die('caller');
        return;
      }
    }

    // ---- Grabbers
    let danger = 0;
    let grabbedThisFrame = false;
    for (const g of this.grabbers) {
      const bonus = g.zone === 2 ? 0.8 : 0;
      const caught = g.update(dt, ctx, bonus, this.grabbers);
      g.animate(dt, elapsed, ctx);
      if (g.state === 'chase') {
        const d = Math.hypot(g.position.x - p.position.x, g.position.z - p.position.z);
        danger = Math.max(danger, 1 - THREE.MathUtils.clamp(d / 28, 0, 1));
      }
      // One source of grab damage per frame. Overlapping grabbers still retreat,
      // but a stack cannot spend GRABBER_HIT twice before the player can react.
      if (caught && !grabbedThisFrame) {
        grabbedThisFrame = true;
        this.onGrabbed(g);
        if (this.state !== 'playing') return;
      }
    }
    if (this.input.touchMode) this.hud.setLockPrompt(false);
    this.danger = danger;

    // ---- Howler / hunt
    if (this.howler.update(dt, elapsed, ctx)) this.audio.summonerHowl(this.howler.root.position);
    if (this.hunt) {
      this.huntTimer -= dt;
      if (this.huntTimer <= 0) {
        this.hunt = false;
        this.howler.dismiss();
        this.hud.setHunt(null);
        this.hud.showBanner('金阙退去', 'The orchard exhales. For now.', 'info', 2.5);
      } else this.hud.setHunt(this.huntTimer / HUNT_DURATION);
    }
    const huntTarget = this.hunt ? 1 : 0;
    this.huntVis += (huntTarget - this.huntVis) * Math.min(1, dt * 2);
    this.fog.color.copy(FOG_NORMAL).lerp(FOG_HUNT, this.huntVis);
    this.fog.density = 0.026 + this.huntVis * 0.006;
    (this.scene.background as THREE.Color).copy(this.fog.color);

    // ---- Extraction
    let nearShrine = false;
    for (const s of this.level.shrines) {
      if (!s.active) continue;
      if (Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) < EXTRACT_RADIUS) nearShrine = true;
    }
    if (nearShrine && !this.harvesting) this.extractProgress = Math.min(1, this.extractProgress + dt / EXTRACT_TIME);
    else this.extractProgress = Math.max(0, this.extractProgress - dt * 0.8);
    this.audio.extractCharge(this.extractProgress);
    this.hud.setExtract(this.extractProgress > 0.001 ? this.extractProgress : null);
    if (this.extractProgress >= 1) {
      this.extract();
      return;
    }

    // ---- Damage feel
    this.damage = Math.max(0, this.damage - dt * 0.9);
    const low = p.health <= PLAYER.healthMax * 0.5;

    // ---- HUD
    this.hud.setVitals(p.health / PLAYER.healthMax, p.stamina / PLAYER.staminaMax, p.battery / PLAYER.batteryMax, p.lightOn);
    this.hud.setSatchel(this.satchel, this.haul);
    if (zone !== this.lastZone) {
      const first = this.lastZone < 0;
      this.lastZone = zone;
      this.hud.setZone(ZONE_GLYPHS[zone], ZONE_NAMES[zone], 'Pick peaches · Escape through a lit shrine');
      if (!first) this.hud.showBanner(ZONE_GLYPHS[zone], ZONE_NAMES[zone], 'info', 2.8);
    }
    if (this.harvesting && target) {
      this.hud.setPrompt(null, 0);
      this.hud.setPrompt({ text: `Picking ${TIER_NAMES[target.tier]}…`, value: `+${TIER_VALUE[target.tier].toLocaleString('en-US')}`, key: this.input.touchMode ? 'HOLD' : 'E' }, this.harvestProgress);
    } else if (target) {
      this.hud.setPrompt({ text: `Hold to pick ${TIER_NAMES[target.tier]}`, value: `+${TIER_VALUE[target.tier].toLocaleString('en-US')}`, key: this.input.touchMode ? 'HOLD' : 'E' }, 0);
    } else {
      this.hud.setPrompt(null, 0);
    }
    if (low && Math.floor(elapsed * 2) % 6 === 0) this.damage = Math.max(this.damage, 0.12);

    const markers: CompassMarker[] = [];
    for (const s of this.level.shrines) if (s.active) markers.push({ x: s.position.x, z: s.position.z, kind: 'shrine', label: '归' });
    this.hud.updateCompass(p.yaw, p.position.x, p.position.z, markers);

    // ---- Pipeline grade
    const calling = this.callers.some((c) => c.state === 'calling');
    this.darkAmt += ((calling ? 1 : 0) - this.darkAmt) * Math.min(1, dt * 3);
    const u = this.pipeline.grade.uniforms;
    u.uRed.value = Math.max(this.damage, low ? 0.12 : 0);
    u.uDark.value = this.darkAmt;
    u.uDesat.value = low ? 0.35 : 0;
    u.uHunt.value = this.huntVis * (0.6 + 0.4 * Math.sin(elapsed * 4));
  }

  private danger = 0;
  private huntVis = 0;
  private darkAmt = 0;

  private syncFlat(): void {
    this.player.flatForward(this.flat);
  }

  private isLookingAt(c: Caller): boolean {
    const p = this.player;
    this.tmp.set(c.position.x - p.eye.x, 0, c.position.z - p.eye.z);
    const d = this.tmp.length();
    if (d < 0.01) return true;
    this.tmp.divideScalar(d);
    // horizontal alignment with the view direction (ignores pitch so looking up/down at her still counts)
    this.flat.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    return this.tmp.dot(this.flat) > Math.cos(THREE.MathUtils.degToRad(38));
  }

  private endHarvest(): void {
    this.harvesting = false;
    this.harvestTarget = null;
    this.harvestProgress = 0;
    this.player.rooted = false;
  }

  private completeHarvest(peach: Peach): void {
    this.peachField.collect(peach);
    this.audio.harvestStop();
    this.audio.pickup(peach.tier);
    this.satchel[peach.tier]++;
    this.haul += TIER_VALUE[peach.tier];
    this.hud.bumpSlot(peach.tier);
    this.hud.toast(`${TIER_NAMES[peach.tier]}  +${TIER_VALUE[peach.tier].toLocaleString('en-US')}`, peach.tier);
    this.burst.emit(peach.position, new THREE.Color(TIER_COLORS[peach.tier]), 14 + peach.tier * 10, 1.4, this.rng);
    this.endHarvest();

    if (peach.tier >= 2) {
      // Ancient peach: the Howler wakes and the whole orchard hunts.
      const fresh = !this.hunt;
      this.hunt = true;
      this.huntTimer = HUNT_DURATION;
      if (this.howler.state === 'dormant' || this.howler.state === 'leaving') {
        this.fillContext(false);
        this.howler.appear(this.mctx);
      }
      if (fresh) {
        this.hud.showBanner('金阙合围', 'An ancient peach — the orchard hunts you. Reach a shrine!', 'howl', 4);
        this.hud.flash('#ffcf4a', 0.5);
      }
    }
  }

  private onGrabbed(g: Grabber): void {
    const p = this.player;
    p.health = Math.max(0, p.health - GRABBER_HIT);
    p.knockback(g.position, 7);
    p.addShake(0.9);
    this.damage = 1;
    this.endHarvest();
    this.audio.harvestStop();
    this.audio.chaserHit();
    this.audio.playerHurt();
    this.hud.flash('#a00a14', 0.7);
    this.hud.showBanner('紫陌掠命', p.health > 0 ? 'Half your life torn away.' : 'Nothing left.', 'danger', 2.2);
    if (p.health <= 0) this.die('grabber');
  }

  private updateAudio(dt: number): void {
    const p = this.player;
    const speed01 = Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / PLAYER.sprintSpeed);
    this.audio.setListener(this.camera.position, p.forward);
    this.audio.update(dt, {
      moveSpeed01: this.state === 'playing' ? speed01 : 0,
      sprinting: this.state === 'playing' && p.sprinting,
      danger01: this.state === 'playing' ? this.danger : 0,
      hunt: this.hunt && this.state === 'playing',
      health01: p.health / PLAYER.healthMax,
      playing: this.state === 'playing',
    });
  }

  private fitRenderer(): void {
    resizeRenderer(this.renderer, this.camera, MAX_DPR);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.pipeline.resize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), dpr);
  }

  private render(): void {
    this.fitRenderer();
    this.pipeline.render(this.elapsed);
  }

  // ---------------------------------------------------- tests/diagnostics

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.haul,
      targetScore: 10000,
      complete: this.state === 'extracted',
      player: {
        position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
        speed: Math.hypot(this.player.velocity.x, this.player.velocity.z),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
      },
      setState: (name) => {
        switch (name) {
          case 'title':
            this.prepareRun(this.seedValue);
            this.setState('title');
            break;
          case 'active-play':
          case 'playing':
            this.startRunNoLock(this.seedValue);
            break;
          case 'paused':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.pause();
            break;
          case 'dead':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.deadDelay = 0;
            this.die('grabber');
            this.deadDelay = 0;
            this.hud.showScreen('dead');
            break;
          case 'extracted':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.extract();
            break;
          default:
            throw new Error(`Unknown state: ${name}`);
        }
        return { state: name };
      },
      setPausedForScreenshot: (paused) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => undefined,
    };
  }

  private startRunNoLock(seed: number): void {
    this.prepareRun(seed);
    this.hud.showScreen(null);
    this.setState('playing');
    this.hud.setVisible(true);
  }
}
