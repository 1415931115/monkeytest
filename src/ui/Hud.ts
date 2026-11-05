import { TIER_COLORS } from '../assets/MaterialLibrary';

export interface CompassMarker {
  x: number;
  z: number;
  kind: 'shrine' | 'threat';
  label: string;
}

type ScreenName = 'title' | 'pause' | 'dead' | 'extracted' | null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const COMPASS_RANGE = Math.PI * 0.62; // half-width of the strip in radians

/** DOM HUD bound to game state; never owns rules. */
export class Hud {
  private readonly hud = $('#hud');
  private readonly healthFill = $('#health-fill');
  private readonly staminaFill = $('#stamina-fill');
  private readonly batteryFill = $('#battery-fill');
  private readonly lightState = $('#light-state');
  private readonly healthMeter = $('.meter-health');
  private readonly staminaMeter = $('.meter-stamina');
  private readonly batteryMeter = $('.meter-battery');
  private readonly counts = [0, 1, 2, 3].map((i) => $(`#count-${i}`));
  private readonly slots = [0, 1, 2, 3].map((i) => $(`.slot[data-tier="${i}"]`));
  private readonly haul = $('#haul-value');
  private readonly reticle = $('#reticle');
  private readonly ring = $('#harvest-progress');
  private readonly prompt = $('#prompt');
  private readonly promptText = $('#prompt-text');
  private readonly promptValue = $('#prompt-value');
  private readonly promptKey = $('#prompt-key');
  private readonly banner = $('#banner');
  private readonly bannerTitle = $('#banner-title');
  private readonly bannerSub = $('#banner-sub');
  private readonly subtitle = $('#subtitle');
  private readonly huntMeter = $('#hunt-meter');
  private readonly huntFill = $('#hunt-fill');
  private readonly hint = $('#hint');
  private readonly extract = $('#extract');
  private readonly extractFill = $('#extract-fill');
  private readonly toastLayer = $('#toast-layer');
  private readonly zoneGlyph = $('#zone-glyph');
  private readonly zoneName = $('#zone-name');
  private readonly objective = $('#objective');
  private readonly flashEl = $('#fx-flash');
  private readonly compassTrack = $('#compass-track');
  private readonly compassMarkers = $('#compass-markers');
  private readonly ticks: { el: HTMLElement; angle: number; label?: HTMLElement }[] = [];
  private markerEls: HTMLElement[] = [];
  private bannerTimer = 0;
  private subtitleTimer = 0;
  private hintTimer = 0;
  private flashAmt = 0;
  private haulShown = 0;
  private haulTarget = 0;
  private last = { h: -1, s: -1, b: -1, light: true };
  readonly screens = {
    title: $('#screen-title'),
    pause: $('#screen-pause'),
    dead: $('#screen-dead'),
    extracted: $('#screen-extracted'),
  };

  constructor() {
    const labels: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let deg = 0; deg < 360; deg += 15) {
      const el = document.createElement('div');
      el.className = `compass-tick${deg % 45 === 0 ? ' major' : ''}`;
      this.compassTrack.appendChild(el);
      let label: HTMLElement | undefined;
      if (labels[deg] || deg % 45 === 0) {
        label = document.createElement('div');
        label.className = 'compass-label';
        label.textContent = labels[deg] ?? '·';
        this.compassTrack.appendChild(label);
      }
      this.ticks.push({ el, angle: (deg * Math.PI) / 180, label });
    }
  }

  setVisible(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  showScreen(name: ScreenName): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }

  setZone(glyph: string, name: string, objective: string): void {
    this.zoneGlyph.textContent = glyph;
    this.zoneName.textContent = name;
    this.objective.textContent = objective;
  }

  setVitals(health01: number, stamina01: number, battery01: number, lightOn: boolean): void {
    const h = Math.round(health01 * 200) / 200;
    const s = Math.round(stamina01 * 100) / 100;
    const b = Math.round(battery01 * 100) / 100;
    if (h !== this.last.h) {
      this.healthFill.style.transform = `scaleX(${h})`;
      this.healthMeter.classList.toggle('low', h <= 0.5);
      this.last.h = h;
    }
    if (s !== this.last.s) {
      this.staminaFill.style.transform = `scaleX(${s})`;
      this.staminaMeter.classList.toggle('low', s < 0.2);
      this.last.s = s;
    }
    if (b !== this.last.b) {
      this.batteryFill.style.transform = `scaleX(${b})`;
      this.batteryMeter.classList.toggle('low', b < 0.18);
      this.last.b = b;
    }
    if (lightOn !== this.last.light) {
      this.lightState.textContent = lightOn ? 'ON' : 'OFF';
      this.lightState.classList.toggle('off', !lightOn);
      this.last.light = lightOn;
    }
  }

  setSatchel(counts: number[], haul: number, instant = false): void {
    counts.forEach((c, i) => (this.counts[i].textContent = String(c)));
    this.haulTarget = haul;
    if (instant) {
      this.haulShown = haul;
      this.haul.textContent = haul.toLocaleString('en-US');
    }
  }

  bumpSlot(tier: number): void {
    const el = this.slots[tier];
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  toast(text: string, tier: number): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.color = TIER_COLORS[tier];
    el.textContent = text;
    this.toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  setPrompt(info: { text: string; value: string; key: string } | null, progress01: number): void {
    this.reticle.classList.toggle('target', !!info);
    this.prompt.classList.toggle('hidden', !info);
    if (info) {
      this.promptText.textContent = info.text;
      this.promptValue.textContent = info.value;
      this.promptKey.textContent = info.key;
    }
    this.ring.style.strokeDashoffset = String(251.3 * (1 - progress01));
  }

  showBanner(title: string, sub: string, kind: 'danger' | 'caller' | 'howl' | 'info', seconds: number): void {
    this.banner.className = kind;
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerTimer = seconds;
  }

  showSubtitle(text: string, seconds: number): void {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  showHint(text: string, seconds = 5): void {
    this.hint.textContent = text;
    this.hint.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  setHunt(frac: number | null): void {
    this.huntMeter.classList.toggle('hidden', frac === null);
    if (frac !== null) this.huntFill.style.transform = `scaleX(${frac})`;
  }

  setExtract(frac: number | null): void {
    this.extract.classList.toggle('hidden', frac === null);
    if (frac !== null) this.extractFill.style.transform = `scaleX(${frac})`;
  }

  flash(color: string, amount: number): void {
    this.flashEl.style.background = color;
    this.flashAmt = Math.max(this.flashAmt, amount);
  }

  updateCompass(yaw: number, px: number, pz: number, markers: CompassMarker[]): void {
    // heading: forward (-sin yaw, -cos yaw); bearing measured clockwise from -Z (north)
    const heading = Math.atan2(-Math.sin(yaw), Math.cos(yaw));
    const place = (el: HTMLElement, angle: number) => {
      let rel = angle - heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const visible = Math.abs(rel) < COMPASS_RANGE;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.left = `${50 + (rel / COMPASS_RANGE) * 50}%`;
      return rel;
    };
    for (const t of this.ticks) {
      place(t.el, t.angle);
      if (t.label) place(t.label, t.angle);
    }
    while (this.markerEls.length < markers.length) {
      const el = document.createElement('div');
      el.className = 'marker';
      this.compassMarkers.appendChild(el);
      this.markerEls.push(el);
    }
    this.markerEls.forEach((el, i) => {
      const m = markers[i];
      if (!m) {
        el.style.display = 'none';
        return;
      }
      const dx = m.x - px;
      const dz = m.z - pz;
      const bearing = Math.atan2(dx, -dz);
      let rel = bearing - heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const clamped = Math.max(-COMPASS_RANGE * 0.96, Math.min(COMPASS_RANGE * 0.96, rel));
      el.style.display = '';
      el.style.left = `${50 + (clamped / COMPASS_RANGE) * 50}%`;
      el.className = `marker ${m.kind}${Math.hypot(dx, dz) < 12 ? ' near' : ''}`;
      el.textContent = m.label;
    });
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.add('hidden');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.add('hidden');
    }
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 2.2);
      this.flashEl.style.opacity = String(this.flashAmt);
    }
    if (this.haulShown !== this.haulTarget) {
      const diff = this.haulTarget - this.haulShown;
      this.haulShown += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
      if (Math.abs(this.haulTarget - this.haulShown) < 1) this.haulShown = this.haulTarget;
      this.haul.textContent = this.haulShown.toLocaleString('en-US');
    }
  }

  clearTransient(): void {
    this.banner.classList.add('hidden');
    this.subtitle.classList.add('hidden');
    this.hint.classList.add('hidden');
    this.bannerTimer = this.subtitleTimer = this.hintTimer = 0;
    this.flashAmt = 0;
    this.flashEl.style.opacity = '0';
    this.setHunt(null);
    this.setExtract(null);
    this.setPrompt(null, 0);
    this.toastLayer.replaceChildren();
  }
}
