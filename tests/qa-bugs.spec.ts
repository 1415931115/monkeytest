import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __MONKEYBRO__?: { loop?: { stop?: () => void } } }).__MONKEYBRO__;
    return !!g && (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 2;
  });
  await page.evaluate(() => {
    (window as unknown as { __MONKEYBRO__: { loop: { stop: () => void } } }).__MONKEYBRO__.loop.stop();
  });
}

test('B1 coarse or touch devices show controls before any stick press', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'coarse pointer project');
  await boot(page);
  const early = await page.evaluate(() => {
    const G = (window as unknown as { __MONKEYBRO__: { input: { touchMode: boolean } } }).__MONKEYBRO__;
    return {
      touchMode: G.input.touchMode,
      coarse: matchMedia('(pointer: coarse)').matches,
      body: document.body.className,
    };
  });
  expect(early.coarse).toBe(true);
  expect(early.touchMode).toBe(true);
  expect(early.body).toContain('touch');

  await page.click('#start-button');
  await page.waitForFunction(() => document.body.dataset.state === 'playing');
  await expect(page.locator('#touch-stick')).toBeVisible();
  await expect(page.locator('#touch-harvest')).toBeVisible();
  const display = await page.evaluate(() => getComputedStyle(document.querySelector('#touch-controls')!).display);
  expect(display).toBe('block');
});

test('B1 hasTouch landscape viewport is playable without a prior hidden-control press', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: false,
    baseURL: 'http://127.0.0.1:5188',
  });
  const page = await context.newPage();
  await boot(page);
  await page.tap('#start-button');
  await page.waitForFunction(() => document.body.dataset.state === 'playing');
  const after = await page.evaluate(() => {
    const G = (window as unknown as { __MONKEYBRO__: { input: { touchMode: boolean }; state: string } }).__MONKEYBRO__;
    return {
      touchMode: G.input.touchMode,
      state: G.state,
      body: document.body.className,
      display: getComputedStyle(document.querySelector('#touch-controls')!).display,
      coarse: matchMedia('(pointer: coarse)').matches,
    };
  });
  expect(after.state).toBe('playing');
  expect(after.touchMode).toBe(true);
  expect(after.body).toContain('touch');
  expect(after.display).toBe('block');
  await context.close();
});

test('B1 desktop mouse path does not force touch controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop project');
  await boot(page);
  const early = await page.evaluate(() => {
    const G = (window as unknown as { __MONKEYBRO__: { input: { touchMode: boolean } } }).__MONKEYBRO__;
    return { touchMode: G.input.touchMode, coarse: matchMedia('(pointer: coarse)').matches };
  });
  expect(early.coarse).toBe(false);
  expect(early.touchMode).toBe(false);
  await page.click('#start-button');
  await page.waitForFunction(() => document.body.dataset.state === 'playing');
  const display = await page.evaluate(() => getComputedStyle(document.querySelector('#touch-controls')!).display);
  expect(display).toBe('none');
});

test('C1 every spawned peach is harvestable with a level gaze', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  const report = await page.evaluate(() => {
    const G = (window as unknown as {
      __MONKEYBRO__: {
        prepareRun: (seed: number) => void;
        peachField: { peaches: { tier: number; position: { x: number; y: number; z: number } }[]; findTarget: (eye: unknown, fwd: unknown, reach: number) => unknown };
        player: { eye: { constructor: new (x: number, y: number, z: number) => unknown } };
      };
    }).__MONKEYBRO__;
    const Vec = G.player.eye.constructor;
    let unreachable = 0;
    let total = 0;
    const byTier = [0, 0, 0, 0];
    let seedsWithAncient = 0;
    for (let seed = 1; seed <= 30; seed++) {
      G.prepareRun(seed);
      const peaches = G.peachField.peaches;
      let ancient = false;
      for (const p of peaches) {
        total++;
        let ok = false;
        for (let h = 0.2; h <= 3.0 && !ok; h += 0.05) {
          const eye = new Vec(p.position.x, 1.62, p.position.z + h);
          const fwd = new Vec(0, 0, -1);
          if (G.peachField.findTarget(eye, fwd, 3.0) === p) ok = true;
        }
        if (!ok) {
          unreachable++;
          byTier[p.tier]++;
          if (p.tier >= 2) ancient = true;
        }
      }
      if (ancient) seedsWithAncient++;
    }
    return { unreachable, total, byTier, seedsWithAncient };
  });
  expect(report.unreachable).toBe(0);
  expect(report.total).toBeGreaterThan(1000);
  expect(report.seedsWithAncient).toBe(0);
});

test('M3 Qingluan cannot kill before the call warning', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => {
    const G = (window as unknown as {
      __MONKEYBRO__: {
        prepareRun: (seed: number) => void;
        setState: (s: string) => void;
        state: string;
        runTime: number;
        grabbers: { position: { set: (x: number, y: number, z: number) => void } }[];
        callers: { state: string; timer: number; armed: boolean; callDelay: number; position: { x: number; z: number } }[];
        peachField: { peaches: { tier: number; position: { x: number; y: number; z: number } }[] };
        player: { position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void }; yaw: number };
        input: { setKey: (code: string, down: boolean) => void };
        update: (dt: number, elapsed: number) => void;
      };
    }).__MONKEYBRO__;
    G.prepareRun(1);
    G.setState('playing');
    G.grabbers.forEach((g) => g.position.set(60, 0, -300));
    G.runTime = 13;
    const peach = G.peachField.peaches.filter((p) => p.position.z > -120 && p.tier <= 1 && p.position.y < 1.8)[0];
    G.player.position.set(peach.position.x, 0, peach.position.z + 1.5);
    G.player.yaw = 0;
    G.input.setKey('Mouse0', true);
    let turned = false;
    let armedWhileSilent = false;
    let diedBeforeWarning = false;
    let sawWarning = false;
    let elapsed = 0;
    for (let i = 0; i < 400 && G.state === 'playing'; i++) {
      elapsed += 1 / 60;
      G.update(1 / 60, elapsed);
      const caller = G.callers.find((c) => c.state === 'calling');
      const sub = document.querySelector('#subtitle');
      const subHidden = !sub || sub.classList.contains('hidden');
      const subText = sub?.textContent ?? '';
      if (caller?.armed && (subHidden || !subText.includes('猴哥'))) armedWhileSilent = true;
      if (!subHidden && subText.includes('猴哥')) sawWarning = true;
      if (caller && caller.timer > 0.5 && caller.timer < 0.55 && !turned) {
        turned = true;
        G.player.yaw = Math.atan2(-(caller.position.x - G.player.position.x), -(caller.position.z - G.player.position.z));
      }
      if (G.state !== 'playing' && !sawWarning) diedBeforeWarning = true;
    }
    return {
      state: G.state,
      turned,
      armedWhileSilent,
      diedBeforeWarning,
      sawWarning,
      deadTitle: document.querySelector('#dead-title')?.textContent ?? '',
    };
  });
  expect(report.turned).toBe(true);
  expect(report.armedWhileSilent).toBe(false);
  expect(report.diedBeforeWarning).toBe(false);
  expect(report.sawWarning).toBe(true);
});

test('M1 Escape and P both toggle pause', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => {
    const G = (window as unknown as {
      __MONKEYBRO__: { input: { touchMode: boolean }; setState: (s: string) => void; state: string };
    }).__MONKEYBRO__;
    G.input.touchMode = false;
    G.setState('playing');
    const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    key('KeyP');
    const pausedByP = G.state;
    key('KeyP');
    const resumedByP = G.state;
    key('Escape');
    const pausedByEsc = G.state;
    key('Escape');
    const resumedByEsc = G.state;
    G.setState('playing');
    document.dispatchEvent(new Event('pointerlockchange'));
    const pausedByLockLoss = G.state;
    key('Escape');
    const stillPaused = G.state;
    key('KeyP');
    const resumedByPAfterEsc = G.state;
    return { pausedByP, resumedByP, pausedByEsc, resumedByEsc, pausedByLockLoss, stillPaused, resumedByPAfterEsc };
  });
  expect(report).toEqual({
    pausedByP: 'paused',
    resumedByP: 'playing',
    pausedByEsc: 'paused',
    resumedByEsc: 'playing',
    pausedByLockLoss: 'paused',
    stillPaused: 'paused',
    resumedByPAfterEsc: 'playing',
  });
});

test('M2 failed pointer lock shows a click-to-capture hint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'touch mode does not request pointer lock');
  await boot(page);
  await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas') as HTMLCanvasElement;
    canvas.requestPointerLock = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.click('#start-button');
  await expect(page.locator('#lock-hint')).toBeVisible();
  await expect(page.locator('#lock-hint')).toContainText(/click to capture the mouse/i);

  const hiddenAfterLock = await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas');
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
    return document.querySelector('#lock-hint')!.classList.contains('hidden');
  });
  expect(hiddenAfterLock).toBe(true);
});

test('M4 grabbers separate and cannot double-hit in one frame', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  const report = await page.evaluate(() => {
    const G = (window as unknown as {
      __MONKEYBRO__: {
        prepareRun: (seed: number) => void;
        setState: (s: string) => void;
        state: string;
        hunt: boolean;
        huntTimer: number;
        player: { position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void }; health: number; yaw: number };
        grabbers: { position: { x: number; z: number; set: (x: number, y: number, z: number) => void }; state: string }[];
        update: (dt: number, elapsed: number) => void;
      };
    }).__MONKEYBRO__;

    G.prepareRun(1);
    G.setState('playing');
    const px = G.player.position.x;
    const pz = G.player.position.z;
    const lone = G.grabbers[0];
    lone.state = 'chase';
    lone.position.set(px, 0, pz + 0.8);
    for (let i = 1; i < G.grabbers.length; i++) G.grabbers[i].position.set(80, 0, -300);
    const beforeLone = G.player.health;
    G.update(1 / 60, 1);
    const afterLone = G.player.health;

    G.prepareRun(3);
    G.setState('playing');
    G.player.position.set(0, 0, -260);
    G.player.yaw = 0;
    G.player.health = 100;
    G.hunt = true;
    G.huntTimer = 9999;
    G.grabbers.forEach((g) => {
      g.state = 'chase';
      g.position.set(0, 0, -259.2);
    });
    G.update(1 / 60, 2);
    const afterStack = G.player.health;
    const alive = G.state;

    G.prepareRun(3);
    G.setState('playing');
    G.grabbers.forEach((g) => g.position.set(80, 0, -3000));
    G.player.position.set(0, 0, -260);
    G.player.yaw = 0;
    G.hunt = true;
    G.huntTimer = 9999;
    let elapsed = 3;
    let minSep = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      elapsed += 1 / 60;
      G.update(1 / 60, elapsed);
      if (G.state !== 'playing') break;
    }
    const gs = G.grabbers;
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const d = Math.hypot(gs[i].position.x - gs[j].position.x, gs[i].position.z - gs[j].position.z);
        if (d < minSep) minSep = d;
      }
    }
    const unique = new Set(gs.map((g) => `${g.position.x | 0},${g.position.z | 0}`)).size;
    return { beforeLone, afterLone, afterStack, alive, minSep, unique, n: gs.length };
  });

  expect(report.afterLone).toBe(report.beforeLone - 50);
  expect(report.alive).toBe('playing');
  expect(report.afterStack).toBeGreaterThanOrEqual(50);
  expect(report.beforeLone - report.afterLone).toBe(50);
  expect(report.minSep).toBeGreaterThan(2.4);
  expect(report.unique).toBeGreaterThan(1);
});
