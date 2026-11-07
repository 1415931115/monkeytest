import { expect, test, type Page } from '@playwright/test';

/**
 * Extract v1 (圣地护体 + 假点): real shrine charge → extracted; bait charge → still
 * playing, haul not banked. Drives the DEV-only `window.__MONKEYBRO__` hooks.
 */

type ShrineKind = 'real' | 'bait' | 'dormant';
type DebugState = {
  state: string;
  haul: number;
  best: number;
  health: number;
  extractProgress: number;
  sanctuary: boolean;
  hunt: boolean;
  chargeSite: number | null;
  nearestGrabber: number;
};
type MonkeyBro = {
  listShrines(): { index: number; kind: ShrineKind }[];
  forceSanctuary(index?: number): { index: number; kind: ShrineKind } | null;
  debugState(): DebugState;
  debugGivePeach(tier: number): void;
};

const SEED = 4242;

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate((seed) => {
    localStorage.removeItem('monkeybro.best');
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    void hooks.seed(seed);
    void hooks.setState('playing');
  }, SEED);
}

const mb = (page: Page) => page.evaluate(() => (window as unknown as { __MONKEYBRO__: MonkeyBro }).__MONKEYBRO__.debugState());

test.describe('extract sanctuary v1', () => {
  // Headless GPU frames can run game time well below wall time (dt is clamped to 50 ms).
  test.describe.configure({ timeout: 60_000 });
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'logic test: desktop only');
  });

  test('shrine kinds: 2 real, 2 bait (different zones preferred), 2 dormant; compass shows only real', async ({ page }) => {
    await boot(page);
    const list = await page.evaluate(() => (window as unknown as { __MONKEYBRO__: MonkeyBro }).__MONKEYBRO__.listShrines());
    expect(list.filter((s) => s.kind === 'real')).toHaveLength(2);
    expect(list.filter((s) => s.kind === 'bait')).toHaveLength(2);
    expect(list.filter((s) => s.kind === 'dormant')).toHaveLength(2);
    // let a HUD frame publish the compass
    await page.waitForTimeout(200);
    const markers = await page.locator('.marker.shrine').count();
    expect(markers).toBeLessThanOrEqual(2);
  });

  test('real shrine during a hunt: sanctuary holds, charge → extracted, haul banked', async ({ page }) => {
    await boot(page);
    const forced = await page.evaluate(() => {
      const g = (window as unknown as { __MONKEYBRO__: MonkeyBro }).__MONKEYBRO__;
      g.debugGivePeach(2); // ancient peach: starts the hunt, haul > 0
      return g.forceSanctuary();
    });
    expect(forced?.kind).toBe('real');
    const s0 = await mb(page);
    expect(s0.hunt).toBe(true);
    expect(s0.sanctuary).toBe(true);
    const haul = s0.haul;
    expect(haul).toBeGreaterThan(0);

    let minGrabber = Infinity;
    let sawSanctuary = true;
    await expect
      .poll(
        async () => {
          const s = await mb(page);
          if (s.state === 'playing') {
            minGrabber = Math.min(minGrabber, s.nearestGrabber);
            sawSanctuary &&= s.sanctuary;
          }
          return s.state;
        },
        { timeout: 40_000, intervals: [100] },
      )
      .toBe('extracted');
    const end = await mb(page);
    expect(sawSanctuary).toBe(true);
    expect(end.health).toBe(100); // never grabbed inside the circle
    expect(end.best).toBe(haul); // haul banked
    expect(minGrabber).toBeGreaterThanOrEqual(3.1); // nobody inside the sanctuary radius
    console.log(`[sanctuary] nearest 紫陌 during charge: ${minGrabber.toFixed(2)} m`);
  });

  test('bait shrine: charges, fires 金阙戏弄, no extract, haul not banked, 8 s lockout', async ({ page }) => {
    await boot(page);
    const forced = await page.evaluate(() => {
      const g = (window as unknown as { __MONKEYBRO__: MonkeyBro }).__MONKEYBRO__;
      g.debugGivePeach(1); // haul > 0 without starting a hunt
      const bait = g.listShrines().find((s) => s.kind === 'bait')!;
      return g.forceSanctuary(bait.index);
    });
    expect(forced?.kind).toBe('bait');
    const s0 = await mb(page);
    expect(s0.sanctuary).toBe(false);
    expect(s0.hunt).toBe(false);
    const haul = s0.haul;
    expect(haul).toBeGreaterThan(0);

    let peak = 0;
    await expect
      .poll(
        async () => {
          const s = await mb(page);
          peak = Math.max(peak, s.extractProgress);
          expect(s.state).not.toBe('extracted');
          expect(s.sanctuary).toBe(false);
          return peak > 0.9 && s.extractProgress < 0.1;
        },
        { timeout: 40_000, intervals: [100] },
      )
      .toBe(true);
    await expect(page.locator('#banner-title')).toHaveText(/金阙戏弄|JinQue's Trick/);

    const after = await mb(page);
    expect(after.state).toBe('playing');
    expect(after.haul).toBe(haul); // still in the satchel
    expect(after.best).toBe(0); // nothing banked
    expect(after.hunt).toBe(false); // bait never forces a hunt
    expect(await page.evaluate(() => localStorage.getItem('monkeybro.best'))).toBeNull();

    // Lockout: standing on it for another second does not recharge.
    await page.waitForTimeout(1000);
    const locked = await mb(page);
    expect(locked.extractProgress).toBe(0);
    expect(locked.state).toBe('playing');
  });
});
