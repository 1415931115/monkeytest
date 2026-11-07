# 偷桃前夜 · MONKEYBRO — Premium visual pass: final evidence (Step 5)

Branch `feat/premium-visuals` · evidence captured 2026-11-07 (Asia/Shanghai) under SwiftShader · procedural assets only (Tripo / Gemini / ElevenLabs keys missing).

**Build:** `npm run build` (`tsc && vite build`, Vite 8.0.13) passes. Output: JS 735.67 kB (196.65 kB gzip), CSS 18.92 kB, single chunk.

**Scorecard average: 5.9 / 10.** Strongest: lighting, ground/world materials, HUD (7 each). Weakest: mobile layout (4), lantern viewmodel (5), performance budget (5).

---

## 1. What landed

Starting point: PR #9 (already on `main`) shipped the first caged-lantern viewmodel and monkey forearm, the first monster identity marks (三妖漫画态), and the formant-synthesised female 「猴哥」 call. This branch builds on that work.

| Step | Scope | Files |
|---|---|---|
| 1 — World / lighting / materials (commit `20922f4`) | Hemisphere + cool moon key + warm rim lights, exposure 1.22; ink-purple fog layers; violet sky haze, ink-wash clouds, moon halo, mountain ridges; moss floor + cracked flagstone trail; moonlit-top canopy vertex colours; leaf-dapple decals and god-ray cards (red during a hunt) | Level, WorldKit, MaterialLibrary, ProceduralTextures, Renderer |
| 2 — Lantern & monkey-arm viewmodel | Filigree cage lantern: 6 bronze/iron meridians, 4 latitude rings, 12-knot cloud-scroll band, ruby core + flame cone in an amber halo, pagoda lid with finial and 6 upturned tips, lotus foot, 4-link chain into the fist. Fur-mapped right forearm with 6 spiral cloth wraps, frayed tail and ragged indigo sleeve with gold hem; furred hand with 4 curled fingers + thumb and nails. New left guard arm (empty fist, lower-left) that reaches forward while picking. Spotlight warmed to `#ffa05a` and emitted 0.7 m ahead so it no longer blows out the viewmodel. | `Player.ts`, `ProceduralTextures.ts` (`furTexture`, `wrapTexture`) |
| 3 — Monster heroes | 紫陌 (Grabber): lilac-cast pale skin `#c8b4d8`, translucent 藕荷 mist veils from both shoulders + shawl. 青鸾 (Caller): pine-smoke teal robe/hood/sleeves `#4f9a92`; new throat-flute mouth (lip ring, ice-blue throat, 5 gold reeds) that opens and pulses while she calls 「猴哥——」 and gapes in the death pose. 金阙 (Howler): 9 torn ink-purple robe strips with gold hems and seams; gold-ribbed folding fan in the right hand. | `Monsters.ts` |
| 4 — Chinese ink-night HUD/UI + audio polish | All copy in Chinese: `lang="zh-CN"`, title 偷桃前夜, HUD labels (命/力/灯, 十年…万年, 桃值), compass 北/东/南/西, light state 明/熄, all four screens, banners, prompts, death copy, toasts, tier names (十年桃…万年蟠桃), zone names, touch aria-labels, zh-CN number formatting. Ink-night CSS skin: ink-purple/gold/vermillion palette, CJK serif stack, ink-wash panels with a gold rule, chamfered vitals/satchel plates, peach-shaped slots, vermillion seal glyphs, cyan 「猴哥——」 subtitle glow; ≤720 px moves vitals under the zone plate. Audio: lantern toggle re-voiced (chain ticks, cage-lid tap, flame whoosh on / snuff off); new ambient wind-chime and guqin-like pluck; ambient gap 8–22 s. The female 「猴哥」 voice itself is unchanged from PR #9. | `index.html`, `styles.css`, `Hud.ts`, `Game.ts`, `PeachField.ts`, `LevelPath.ts`, `AudioSystem.ts` |
| 5 — Evidence | This file, metrics captures, scorecard | `artifacts/premium/*` |

---

## 2. Measured metrics

### 2.1 Active play: baseline → Step 1 → final
All captures: seed 42, spawn position (x 1.80, z −8), 0 console errors, 0 page errors.

| Metric | Desktop baseline | Desktop Step 1 (`wip1`) | **Desktop final** | Mobile baseline | **Mobile final** |
|---|---|---|---|---|---|
| Colour entropy (bits) | 2.59 | 4.95 | **5.01** | 3.31 | **5.10** |
| Edge density | 0.065 | 0.186 | **0.188** | 0.132 | **0.216** |
| Luminance contrast (p95 − p5) | 67.7 | 103.7 | **103.4** | 60.3 | **77.2** |
| Mean luminance (0–255) | 21.1 | 41.6 | **40.0** | 26.5 | **41.9** |
| p5 / p95 luminance | 0 / 67.7 | 3.2 / 106.9 | **1.7 / 105.1** | 0.1 / 60.5 | **11.5 / 88.7** |
| Dominant colour share | 0.577 | 0.136 | **0.130** | 0.425 | **0.139** |
| Non-background share | 0.423 | 0.864 | **0.870** | 0.575 | **0.861** |
| Colour buckets | 107 | 188 | **232** | 197 | **281** |

### 2.2 Render budget (`renderer.info`, measured at spawn)

| Tier | Calls | Triangles | Geometries | Textures | Verdict |
|---|---|---|---|---|---|
| Desktop limit | 300 | 750,000 | 300 | 60 | |
| Desktop baseline | 210 | 399,032 | 175 | 10 | within |
| Desktop Step 1 | 213 | 399,286 | 177 | 11 | within |
| **Desktop final** | **269** | **403,762** | **213** | **13** | **within** (90% of call budget) |
| Mobile limit | 150 | 300,000 | 200 | 40 | |
| Mobile baseline | 190 | 396,648 | 155 | 10 | over |
| **Mobile final** | **216** | **399,470** | **172** | **13** | **over** (calls +44%, triangles +33%) |

From Step 1 to final, desktop gained +56 draw calls and +36 geometries. That fits the many small, un-merged meshes added in Steps 2–3. Textures rose by 2 (fur and wrap maps). The mobile triangle overage was already present at baseline and comes from the world, not from this pass.

### 2.3 Hero and viewmodel read (`artifacts/premium/hero-metrics.json`, diff threshold 16, noise floor 0)
Coverage = share of frame pixels that change when the subject is present versus absent. Palette classes are advisory hue/saturation/value bins; fog and tone mapping shift colour.

| Subject | State, distance | Coverage, desktop | Coverage, mobile portrait | Palette (desktop) | Mean RGB |
|---|---|---|---|---|---|
| 紫陌 Grabber | chase, 3.2 m | 5.81% | 12.57% | ink-purple 27.1%, lilac 23.4%, gold-red glow 15.7%, fur-brown 12.9% | 133/89/83 |
| 青鸾 Caller | calling, 5.5 m | 2.57% | 7.37% | fur-brown 17.7%, glow 5.4%, ink-purple 2.9%, **teal 0.1%** | 57/39/23 |
| 金阙 Howler | watching, 22 m | 1.09% | 3.26% | **ink-purple 63.4%**, lilac 7.7%, gold 1.6% | 47/38/43 |
| Viewmodel, desktop | — | 9.12% (lantern + right arm 6.38%, guard arm 2.74%) | — | gold 2.0%, ink-purple 5.6% | **26/13/12** |
| Viewmodel, mobile portrait (aspect 0.587) | — | — | 2.89%. Lantern centre at NDC x = **1.395, off-screen**; lantern + right arm only 16 px (0.01%); guard arm clipped at the left edge | — | 45/20/22 |
| Viewmodel, mobile landscape (aspect 2.193) | — | — | 3.6% (lantern + right arm 2.73%) | — | 22/8/10 |
| Lantern toggle, desktop | on vs off | mean luminance **40.6 vs 39.4 (Δ 1.2)**; 3.73% of pixels change | | | |

What the numbers show:
- 紫陌 reads clearly.
- 青鸾's teal robe does not survive the warm lantern and fog lighting: it measures as brown.
- At 22 m, 金阙 is an ink-purple silhouette; its gold accents barely register.
- On desktop the viewmodel is well placed but very dark, so the filigree mostly disappears.
- In portrait the lantern is off-screen.
- Toggling the lantern barely changes the frame.

### 2.4 UI fit audit (same JSON)
"Worst case" forces every transient HUD element on at once: pick prompt, hunt meter, extract bar, banner, subtitle, and the long hint. It is a stress state, not a typical frame.

| Viewport | Title / pause / dead / extracted | Clipped text | Worst-case HUD overlaps |
|---|---|---|---|
| Desktop 1280×720 | all fit, primary button visible | 0 | **0** |
| Mobile portrait 390×664 | all fit, primary button visible | 0 | **10**: vitals × banner 188×54 px, subtitle × hint 164×44, hint × touch-stick 44×86, hint × touch-buttons 45×86, extract × touch controls, … |
| Mobile landscape 750×342 | pause and dead fit; **title (557 px tall) and extracted (372 px) overflow**, so the screen scrolls and the primary button starts off-screen | 0 | **15**: prompt × hint 248×21 px, prompt × subtitle 222×33, banner × touch-buttons 112×46, compass × zone-panel 75×34, … |

### 2.5 Automated regression (`artifacts/premium/qa-logs/playwright-step5.log`)
32 tests: **21 passed, 3 failed, 8 skipped**. All 3 failures are stale English-copy assertions against the new Chinese HUD; no gameplay assertion failed.
- `M2 failed pointer lock shows a click-to-capture hint` expects `/click to capture the mouse/`; the UI now shows `点击画面以锁定视角`.
- `stray touch on a fine pointer yields to the mouse` expects `Hold E / click`; the UI now shows `…长按 E / 鼠标…`.
- `coarse pointer keeps touch controls when a mouse event arrives` expects `Hold the pick control`; the UI now shows `…长按「摘」…`.

The tests were not updated, because the user override skipped game testing for this ship. Follow-up: update the three expected strings in `tests/qa-bugs.spec.ts`.

---

## 3. Visual scorecard (1–10)
Scores come from the JSON metrics above plus a review of the code diffs. The PNGs were **not** re-inspected visually in this pass.

| # | Category | Score | Basis |
|---|---|---|---|
| 1 | Lighting / atmosphere | **7** | Contrast 67.7 → 103.4, mean luminance 21 → 40, layered fog, moon key, god rays. Lantern light is weak (toggle changes luminance by only 1.2). |
| 2 | Ground / world materials | **7** | Entropy 2.59 → 5.01 bits, edge density 0.065 → 0.188, dominant colour 57.7% → 13%. Procedural canvas textures only. |
| 3 | Lantern / viewmodel | **5** | Detailed filigree cage and two arms, 9.1% of the desktop frame. Reads dark (mean RGB 26/13/12, gold 2%). Off-screen in mobile portrait. |
| 4 | Monster heroes (紫陌 / 青鸾 / 金阙) | **6** | 紫陌 reads well (5.8% coverage, lilac + glow 39%). 青鸾's teal identity is lost (teal 0.1%). 金阙 is a purple silhouette at 22 m (gold 1.6%). |
| 5 | HUD / UI, Chinese ink-night | **7** | Complete zh-CN copy and a cohesive ink-wash skin. Desktop: 0 overlaps, 0 clipped text, all panels fit. Relies on system CJK serif fonts (no webfont shipped). |
| 6 | Audio (女声「猴哥」 + SFX) | **6** | Female formant 「猴哥」 call (PR #9), plus new lantern chain/flame SFX, wind-chime and guqin ambience. Fully procedural. **Not measured.** |
| 7 | Contrast / readability | **6** | Desktop contrast 103.4, mobile 77.2. p95 luminance of about 105/255 means highlights are compressed. Night frame mean is about 40/255. |
| 8 | Performance budget | **5** | Desktop within budget (269/300 calls). Mobile over (216/150 calls, 399k/300k triangles). +56 calls since Step 1. 736 kB single JS chunk. No real-GPU frame timing. |
| 9 | Mobile / UI layout | **4** | Lantern off-screen in portrait. Title and extracted screens scroll in landscape. 10 / 15 worst-case HUD overlaps. |
| 10 | Overall polish | **6** | Coherent Eastern ink-night direction across world, UI and audio. The defects above are still open. |
| | **Average** | **5.9** | 59 / 10 |

---

## 4. Evidence paths
- `artifacts/premium/desktop-active-play.png` + `artifacts/premium/desktop-active-play.json`: final desktop capture, 1280×720
- `artifacts/premium/mobile-active-play.png` + `artifacts/premium/mobile-active-play.json`: final mobile capture, 390×664
- `artifacts/premium/hero-metrics.json`: hero, viewmodel, lantern and UI-fit metrics (desktop, mobile portrait, mobile landscape)
- `artifacts/premium/heroes/grabber.png`, `caller.png`, `howler.png`, `title.png`, `paused.png`, `dead.png`, `extracted.png`
- `artifacts/premium/wip/desktop-active-play.png` + `.json`: Step 1 checkpoint
- `artifacts/baseline/desktop-active-play.json/desktop-active-play.png` + `.json`: pre-upgrade desktop (the directory itself is named `.json`)
- `artifacts/baseline/mobile/mobile-active-play.png` + `.json`: pre-upgrade mobile
- `artifacts/premium/qa-logs/playwright-step5.log`: Playwright run
- `artifacts/premium/capture-heroes.mjs`, `artifacts/premium/measure-heroes.mjs`: capture and measurement scripts

## 5. Limitations
- **SwiftShader:** every capture used ANGLE → Vulkan SwiftShader (`softwareRendered: true`), a software GPU. FPS and frame times are not meaningful and are not reported. Draw-call, triangle and texture counts do not depend on the GPU. Bloom and tone mapping may look different on real hardware.
- Captures used the default `low` quality path (no `?quality=high`), which is what GitHub Pages visitors get. That means a drawing buffer of about 0.7× (896×503 for a 1280×720 canvas; 273×464 for 390×664) and no shadows from the lantern spotlight (`castShadow = !LOW_SPEC`).
- Provenance: all metrics JSON post-dates the last source edit (09:44:24). The hero PNGs were captured about 10 s after it. `measure-heroes.mjs` was edited at 11:00, after the recorded run at 10:53, so a re-run may differ slightly.
- Audio was not captured or measured. There was no human or real-device playtest; game testing was skipped by user override.

## 6. Next fixes (not done in this pass)
1. Make the viewmodel aspect-aware: pull the lantern in from the right edge when aspect < 1.
2. Mobile layout: compact title and extracted panels for heights of 360 px or less; give hint, subtitle and banner their own lanes clear of the touch controls.
3. Light the viewmodel (fill light or emissive rim) so the filigree reads, and strengthen the lantern's contribution to the scene.
4. 青鸾: raise robe saturation or add emissive teal trim so her identity survives warm light.
5. Mobile budget: merge static lantern and arm meshes; thin canopy instancing on the mobile tier.
6. Update the three stale English-copy assertions in `tests/qa-bugs.spec.ts`.
