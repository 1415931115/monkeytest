// Captures menus + monster hero close-ups via dev hooks. Usage: node artifacts/premium/capture-heroes.mjs [url]
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://127.0.0.1:5188/monkeytest/';
const out = 'artifacts/premium/heroes';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
const H = (fn, arg) => page.evaluate(fn, arg);
await H(() => { window.__THREE_GAME_TEST_HOOKS__.seed(42); window.__THREE_GAME_TEST_HOOKS__.setState('title'); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/title.png` });
for (const st of ['paused', 'dead', 'extracted']) {
  await H((s) => window.__THREE_GAME_TEST_HOOKS__.setState(s), st);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${st}.png` });
}
// monster close-ups: pose each in front of the frozen player
const poses = { grabber: 3.2, caller: 5.5, howler: 22 };
for (const [kind, dist] of Object.entries(poses)) {
  await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
  await page.waitForTimeout(300);
  await H(({ kind, dist }) => {
    const g = window.__MONKEYBRO__;
    g.player.frozen = true;
    const p = g.player.position; const yaw = g.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const m = kind === 'grabber' ? g.grabbers[0] : kind === 'caller' ? g.callers[0] : g.howler;
    for (const o of [...g.grabbers, ...g.callers]) o.root.visible = false;
    g.howler.root.visible = false;
    m.root.visible = true;
    m.root.position.set(p.x + fx * dist, 0, p.z + fz * dist);
    m.root.rotation.y = Math.atan2(-fx, -fz);
    if (kind === 'caller') { m.state = 'calling'; m.visibleAmt = 1; m.callDelay = 0; m.window = 4; m.timer = 1; }
    if (kind === 'howler') { m.state = 'watching'; m.root.position.y = 0; }
    if (kind === 'grabber') { m.arms?.forEach((a) => (a.upper.rotation.x = -1.1)); }
    window.__pose = { m, x: m.root.position.x, z: m.root.position.z, ry: m.root.rotation.y, kind };
    const hold = () => { const q = window.__pose; if (!q) return; q.m.root.visible = true; q.m.root.position.x = q.x; q.m.root.position.z = q.z; q.m.root.rotation.y = q.ry; if (q.kind !== 'caller') q.m.root.position.y = 0; requestAnimationFrame(hold); };
    hold();
  }, { kind, dist });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${kind}.png` });
  await H(() => { window.__pose = null; });
}
await browser.close();
console.log('ok');
