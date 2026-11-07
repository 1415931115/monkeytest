// Screenshot-free evidence for hero / viewmodel / UI checks.
// A/B pixel diff: render the same frozen frame with and without a subject, and report where
// the subject lands on screen. Also audits every UI state for overflow, clipping and overlap.
// Usage: node artifacts/premium/measure-heroes.mjs [url] [outJson]
import { writeFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';
import { PNG } from 'pngjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/monkeytest/';
const out = process.argv[3] ?? 'artifacts/premium/hero-metrics.json';
const THRESHOLD = 16; // per-channel 0-255 delta that counts as "this subject changed the pixel"

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'mobile-portrait': { ...devices['iPhone 13'], userAgent: undefined },
  'mobile-landscape': { ...devices['iPhone 13 landscape'], userAgent: undefined },
};

// Hue/sat/value classes for the anchor palette. Fog and tone mapping shift colour, so these are advisory.
const CLASSES = {
  lilac: (h, s, v) => h >= 255 && h <= 335 && s >= 0.08 && v >= 0.25,
  goldRedGlow: (h, s, v) => (h <= 45 || h >= 345) && s >= 0.55 && v >= 0.6,
  gold: (h, s, v) => h >= 30 && h <= 62 && s >= 0.35 && v >= 0.45,
  teal: (h, s, v) => h >= 150 && h <= 200 && s >= 0.15 && v >= 0.2,
  ice: (h, s, v) => h >= 180 && h <= 225 && s >= 0.2 && v >= 0.6,
  inkPurple: (h, s, v) => h >= 240 && h <= 310 && v < 0.35,
  furBrown: (h, s, v) => h >= 12 && h <= 42 && s >= 0.2 && s <= 0.75 && v >= 0.2 && v <= 0.85,
};

function hsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

const round = (v, d = 4) => Number(v.toFixed(d));

function diff(withBuf, withoutBuf) {
  const a = PNG.sync.read(withBuf);
  const b = PNG.sync.read(withoutBuf);
  const { width: w, height: h } = a;
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let sx = 0;
  let sy = 0;
  const sum = [0, 0, 0];
  const classes = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
  const buckets = new Map();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = a.data[i];
      const g = a.data[i + 1];
      const bl = a.data[i + 2];
      if (Math.max(Math.abs(r - b.data[i]), Math.abs(g - b.data[i + 1]), Math.abs(bl - b.data[i + 2])) <= THRESHOLD) continue;
      count += 1;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sum[0] += r;
      sum[1] += g;
      sum[2] += bl;
      const [hh, ss, vv] = hsv(r, g, bl);
      for (const [name, test] of Object.entries(CLASSES)) if (test(hh, ss, vv)) classes[name] += 1;
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (bl >> 5);
      const bucket = buckets.get(key) ?? [0, 0, 0, 0];
      bucket[0] += r;
      bucket[1] += g;
      bucket[2] += bl;
      bucket[3] += 1;
      buckets.set(key, bucket);
    }
  }
  if (!count) return { coverage: 0, pixels: 0 };
  return {
    coverage: round(count / (w * h)),
    pixels: count,
    bboxNorm: [round(minX / w, 3), round(minY / h, 3), round((maxX + 1) / w, 3), round((maxY + 1) / h, 3)],
    centroidNorm: [round(sx / count / w, 3), round(sy / count / h, 3)],
    meanRgb: sum.map((v) => Math.round(v / count)),
    topColors: [...buckets.values()].sort((p, q) => q[3] - p[3]).slice(0, 5).map(([br, bg, bb, n]) => {
      const hex = [br, bg, bb].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      return `#${hex} ${round(n / count, 3)}`;
    }),
    palette: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, round(v / count, 3)])),
  };
}

const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
const shot = async (page) => { await frames(page); return page.screenshot({ scale: 'css' }); };

async function boot(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__ && !!window.__MONKEYBRO__);
  await page.addStyleTag({ content: '#banner,#hint,#toast-layer,#subtitle,#lock-hint{visibility:hidden!important}*{animation:none!important;transition:none!important}' });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.seed(42));
  return { page, errors };
}

const startPlay = async (page) => {
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks.setPausedForScreenshot(false);
    hooks.setState('active-play');
  });
  await page.waitForTimeout(700);
};

async function measureViewmodel(page) {
  await startPlay(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  const projection = await page.evaluate(() => {
    const g = window.__MONKEYBRO__;
    const p = g.player;
    const ndc = (o) => {
      const v = o.getWorldPosition(p.position.clone()).project(g.camera);
      return [Number(v.x.toFixed(3)), Number(v.y.toFixed(3))];
    };
    return { lanternCentreNdc: ndc(p.handPivot), guardArmNdc: ndc(p.guardArm), aspect: Number(g.camera.aspect.toFixed(3)), fov: g.camera.fov };
  });
  const base = await shot(page);
  const noise = diff(base, await shot(page));
  const toggle = (name, visible) => page.evaluate(({ name, visible }) => { window.__MONKEYBRO__.player[name].visible = visible; }, { name, visible });
  const measure = async (name) => {
    await toggle(name, false);
    const without = await shot(page);
    await toggle(name, true);
    return diff(base, without);
  };
  return {
    ...projection,
    noiseFloorCoverage: noise.coverage,
    whole: await measure('viewmodel'),
    lanternAndRightArm: await measure('handPivot'),
    guardArm: await measure('guardArm'),
  };
}

async function measureLantern(page) {
  const capture = async (on) => {
    await startPlay(page);
    await page.evaluate((v) => { window.__MONKEYBRO__.player.lightOn = v; window.__MONKEYBRO__.player.frozen = true; }, on);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    return shot(page);
  };
  const lit = await capture(true);
  const dark = await capture(false);
  const lum = (buf) => {
    const p = PNG.sync.read(buf);
    let s = 0;
    for (let i = 0; i < p.data.length; i += 4) s += 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
    return round(s / (p.data.length / 4), 1);
  };
  return { meanLuminanceOn: lum(lit), meanLuminanceOff: lum(dark), changed: diff(lit, dark) };
}

// Same poses as capture-heroes.mjs, so the numbers describe those PNGs.
async function measureHero(page, kind, dist, lanternOff = false) {
  await startPlay(page);
  await page.evaluate(({ kind, dist, lanternOff }) => {
    const g = window.__MONKEYBRO__;
    g.player.frozen = true;
    if (lanternOff) g.player.lightOn = false;
    const p = g.player.position;
    const yaw = g.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const m = kind === 'grabber' ? g.grabbers[0] : kind === 'caller' ? g.callers[0] : g.howler;
    for (const o of [...g.grabbers, ...g.callers]) o.root.visible = false;
    g.howler.root.visible = false;
    m.root.visible = true;
    m.root.position.set(p.x + fx * dist, 0, p.z + fz * dist);
    m.root.rotation.y = Math.atan2(-fx, -fz);
    if (kind === 'caller') { m.state = 'calling'; m.visibleAmt = 1; m.callDelay = 0; m.window = 4; m.timer = 1; }
    if (kind === 'howler') m.state = 'watching';
    if (kind === 'grabber') m.arms?.forEach((a) => (a.upper.rotation.x = -1.1));
    window.__pose = { m, x: m.root.position.x, z: m.root.position.z, ry: m.root.rotation.y, kind };
    const hold = () => {
      const q = window.__pose;
      if (!q) return;
      q.m.root.visible = true;
      q.m.root.position.x = q.x;
      q.m.root.position.z = q.z;
      q.m.root.rotation.y = q.ry;
      if (q.kind !== 'caller') q.m.root.position.y = 0;
      requestAnimationFrame(hold);
    };
    hold();
  }, { kind, dist, lanternOff });
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => {
    const q = window.__pose;
    const g = window.__MONKEYBRO__;
    window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);
    window.__pose = null;
    return { gameState: g.debugState().state, monsterState: q.m.state, health: g.debugState().health };
  });
  const present = await shot(page);
  const noise = diff(present, await shot(page));
  let sigil;
  if (kind === 'howler') {
    const setSigil = (visible) => page.evaluate((v) => { window.__MONKEYBRO__.howler.root.getObjectByName('howlerSigil').visible = v; }, visible);
    await setSigil(false);
    sigil = diff(present, await shot(page));
    await setSigil(true);
  }
  await page.evaluate((kind) => {
    const g = window.__MONKEYBRO__;
    const m = kind === 'grabber' ? g.grabbers[0] : kind === 'caller' ? g.callers[0] : g.howler;
    m.root.visible = false;
  }, kind);
  const absent = await shot(page);
  return { distanceM: dist, lanternOff, ...state, noiseFloorCoverage: noise.coverage, ...diff(present, absent), ...(sigil ? { sigil } : {}) };
}

// Audits one UI state: panel fit, reachable primary button, clipped text, HUD overlaps.
function auditDom() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const shown = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01 && r.width > 0 && r.height > 0;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
  };
  const report = { viewport: [W, H], panel: null, clippedText: [], offscreen: [], overlaps: [] };
  const screen = [...document.querySelectorAll('.screen')].find((el) => shown(el));
  if (screen) {
    const panel = screen.querySelector('.panel');
    const button = screen.querySelector('.btn.primary');
    const pr = panel.getBoundingClientRect();
    const br = button?.getBoundingClientRect();
    report.panel = {
      id: screen.id,
      rect: rectOf(panel),
      fitsViewport: pr.top >= 0 && pr.left >= 0 && pr.bottom <= H && pr.right <= W,
      panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
      screenScrolls: screen.scrollHeight > screen.clientHeight + 1,
      screenOverflowY: getComputedStyle(screen).overflowY,
      primaryButtonInViewport: br ? br.top >= 0 && br.bottom <= H : null,
    };
  }
  const root = screen ?? document.querySelector('#hud');
  for (const el of root.querySelectorAll('*')) {
    if (!shown(el) || !el.textContent.trim() || el.children.length) continue;
    const s = getComputedStyle(el);
    const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.textOverflow === 'ellipsis';
    if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      report.clippedText.push(`${el.id || el.className || el.tagName}: ${el.textContent.trim().slice(0, 24)}`);
    }
  }
  if (!screen) {
    const ids = ['compass', 'zone-panel', 'vitals', 'satchel', 'reticle', 'prompt', 'banner', 'subtitle', 'hunt-meter', 'hint', 'extract', 'touch-stick', 'touch-buttons', 'touch-pause'];
    const boxes = ids.map((id) => document.getElementById(id)).filter((el) => el && shown(el)).map((el) => ({ id: el.id, ...rectOf(el) }));
    report.hudRects = boxes;
    for (const box of boxes) {
      if (box.l < 0 || box.t < 0 || box.r > W || box.b > H) report.offscreen.push(box.id);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 1 && oy > 1) report.overlaps.push(`${a.id} x ${b.id} (${ox}x${oy}px)`);
      }
    }
  }
  return report;
}

async function auditUi(context) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__ && !!window.__MONKEYBRO__);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.seed(42));
  const states = {};
  for (const state of ['title', 'paused', 'dead', 'extracted']) {
    await page.evaluate((s) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      hooks.setPausedForScreenshot(false);
      if (s === 'paused' || s === 'dead' || s === 'extracted') hooks.setState('active-play');
      hooks.setState(s);
    }, state);
    await page.waitForTimeout(350);
    states[state] = await page.evaluate(auditDom);
  }
  // Worst-case HUD: every transient element up at once, with long live copy.
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks.setState('active-play');
    hooks.setPausedForScreenshot(true);
  });
  await page.evaluate(() => {
    const hud = window.__MONKEYBRO__.hud;
    hud.setPrompt({ text: '长按摘万年蟠桃', value: '+10,000', key: '按住' }, 0.5);
    hud.setHunt(0.6);
    hud.setExtract(0.4);
    hud.showBanner('青鸾点名', '别回头。', 'caller', 30);
    hud.showSubtitle('猴哥——', 30);
    hud.showHint('灯已点亮 · 对准发光的桃子长按「摘」 · 摘桃时若有人唤「猴哥——」，千万别回头。', 30);
  });
  await page.waitForTimeout(350);
  states['hud-worst-case'] = await page.evaluate(auditDom);
  await page.close();
  return states;
}

const browser = await chromium.launch({ channel: 'chromium' });
const report = { url, threshold: THRESHOLD, measuredAt: new Date().toISOString(), renderer: null, profiles: {} };
try {
  for (const [name, options] of Object.entries(PROFILES)) {
    const context = await browser.newContext(options);
    const { page, errors } = await boot(context);
    report.renderer ??= await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    const entry = { viewmodel: await measureViewmodel(page) };
    if (name !== 'mobile-landscape') {
      entry.heroes = {};
      for (const [kind, dist] of [['grabber', 3.2], ['caller', 5.5], ['howler', 22]]) entry.heroes[kind] = await measureHero(page, kind, dist);
      // Real encounter ranges: the Caller materialises 10.5-13 m away, the Howler keeps ~36 m+.
      entry.heroes['caller@11m'] = await measureHero(page, 'caller', 11);
      entry.heroes['caller@11m-lantern-off'] = await measureHero(page, 'caller', 11, true);
      entry.heroes['howler@36m'] = await measureHero(page, 'howler', 36);
    }
    if (name === 'desktop') entry.lanternToggle = await measureLantern(page);
    entry.ui = await auditUi(context);
    entry.pageErrors = errors;
    report.profiles[name] = entry;
    await context.close();
    console.log(`measured ${name}`);
  }
} finally {
  await browser.close();
}
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${out}`);
