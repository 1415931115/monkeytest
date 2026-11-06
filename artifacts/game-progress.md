# MONKEYBRO — Game Progress

## Intent and constraints
- First-person scavenge-and-extract in a dark flat-peach (pan-tao) orchard. Toggleable flashlight on the camera.
- Linear level. Peaches aged 10 / 100 / 1,000 / 10,000 years; older = rarer and more valuable.
- Randomised extraction points each run.
- Three monster types, increasingly formidable the further from the player they operate:
  1. **Grabber** (close range): pursues the player, on catch drains half of max health (50 HP).
  2. **Caller** (mid range): while the player is scavenging, calls "猴哥" from behind. Turning around to look at it = instant death.
  3. **Howler** (far range): appears when the player harvests a 1,000- or 10,000-year peach and summons every monster on the map into the pursuit.
- No API keys (Tripo / Gemini / ElevenLabs all MISSING) → procedural geometry, canvas textures, Web Audio synthesis, formant-synth voice.
- Bar: the user asked for a playable game in the browser, not explicitly premium. Build the good version; aim for authored visuals.

## Design brief
- **Player promise:** you are a monkey thief creeping through the cursed Immortal Orchard at night, flashlight in hand, stuffing your satchel with immortality peaches and getting out before the orchard's guardians take you.
- **Target feeling:** dread + greed. Every pick is a temptation that makes the night more dangerous.
- **Primary verb:** scavenge (hold E on a peach). **Secondary:** move/sprint, look, toggle light, extract.
- **5–30 s repeat:** scan with the light, spot a peach glow, decide whether to pick it (time exposed), listen for threats, move on.
- **1–5 min change:** deeper zones hold older peaches, faster Grabbers, more Callers; high-value picks trigger the Howler hunt.
- **Lose / learn / restart:** caught twice by a Grabber, or looking at a Caller. Death screen names the cause and the rule. Retry is one click (new random extraction points).
- **Reward / risk:** value banked only on extraction. Light reveals peaches but doubles Grabber detection range; sprint escapes but is loud and limited by stamina; old peaches take longer to pick and summon the hunt.
- **Better player:** manages the light, listens for direction, keeps eyes forward while picking, saves the 1,000/10,000-year peaches for when an extraction point is near.
- **Next decision communicated by:** compass strip with extraction markers + distance, peach glows (colour per tier), interaction prompt with harvest ring, audio cues (growl, call, howl), banner warnings.
- **Non-goals:** combat, crafting, multiple levels, multiplayer.

## Core loop contract
Player **harvests peaches** to **fill the satchel and extract with value** while **Grabbers, Callers and the Howler** create risk; success **banks score (best saved)**, failure **loses the haul and shows the cause, instant retry**.

## Level plan
- Spatial format: one winding orchard trail ~380 m long (−Z), corridor half-width ~11 m, walled by dense trees + fog.
- Zones: I *Outer Orchard* (0–120 m: 10y/100y, 2 Grabbers, 1 Caller), II *Mist Grove* (120–250 m: 100y/1,000y, 3 Grabbers, 1 Caller), III *Heart of the Orchard* (250–380 m: 1,000y/10,000y, 3 faster Grabbers, 1 Caller).
- Start: moonlit clearing with a broken gate. First decision: light on/off. First reward: 10y peaches within 15 m. First threat: Grabber ~45 m in.
- Extraction: 6 candidate shrines (2 per zone). Each run picks 1 from zone I-II pool and 1 from zone II-III pool at random; both shown on compass.
- Landmarks: zone gates (stone paifang arches), lantern posts, a dry pond, giant mother tree at the end.
- Recovery beats: lantern clearings between zones (no Grabber patrol nearby).

## Decisions
- Stack: Vite + TS + three 0.184 (scaffold). Custom capsule-vs-circle collision (no physics engine needed: flat ground, trees as circles, corridor clamp).
- Post: EffectComposer RenderPass + UnrealBloom (eyes, peach halos, lanterns) + OutputPass.
- Audio: Web Audio procedural (worker-owned `src/systems/AudioSystem.ts`).

## Status
- [x] Gameplay core  - [x] World  - [x] Monsters  - [x] HUD/menus  - [x] Audio  - [ ] QA

## User art lock (2026-11-05 11:31 Asia/Shanghai)
- Match comic bible 《偷桃前夜》 / 日月同错 night-orchard look. Full brief: `/workspace/monkeybro/ART_DIRECTION.md`.
- Rename/map: Grabber=紫陌, Caller=青鸾, Howler=金阙 (fairy + monster forms).
- Callout text/voice: 「猴哥——」 only.
- After playable loop lands, do a dedicated visual pass for silhouettes, palette, and fairy→monster tear FX.


## Integration pass (Game.ts rewrite)
- `src/game/Game.ts` rewritten to wire Level/PeachField/Player/Input/Howler/Callers/Grabbers/Hud/Audio/RenderPipeline into one loop.
- Headless (swiftshader) checks passed: title→play, movement, harvest progress, Caller 青鸾点名 death, 2× Grabber 紫陌掠命 death, shrine extraction charge, test-hook states. Screenshots in `artifacts/qa/`.
- QA left open: no real-GPU / pointer-lock / touch playtest; difficulty and flashlight bloom intensity untuned.
- Dev only: `window.__MONKEYBRO__` exposes the Game instance for scripted QA.

## Premium visual upgrade (branch `feat/premium-visuals`, 2026-11-06)
Target: Eastern ink-night comic (`ART_DIRECTION.md`, `VISUAL_QA_ANCHORS.md`). Procedural only (Tripo/Gemini/ElevenLabs keys MISSING).
Baseline defects: near-black ground, muddy tree silhouettes, lantern = yellow blob with no arms, English stat-card HUD.

### Step 1 — World / lighting / materials ✅
- Lighting: hemisphere `#8a7cc8`/`#2d4a3e` @1.15, cool key moon `#b8c6ff` @1.6 aligned with the sky-dome moon, faint warm peach rim; exposure 1.22.
- Fog: ink-purple `#2a1c44`, density 0.020 (high) / 0.024 (low) → near/mid/far orchard layers read.
- Sky: violet horizon haze, moonlit ink-wash cloud bands, layered moon halo, two ink-wash mountain ridges.
- Ground kit: ink-moss floor texture (tileable moss/soil patches, gold + umber leaves, petals); ancient flagstone trail with cracks/lichen; brighter bark/stone/rock/grass.
- Orchard readability: canopy vertex colours baked with moonlit-top / ink-purple-underside gradient; pine-smoke teal leaf palette.
- 「月光碎金」: instanced leaf-dapple decals (moon-blue + peach-gold) along the trail and slanted god-ray cards toward the moon (hunt tints them red).
- Measured (SwiftShader, active-play): entropy 2.59→4.95 bits, edge density 0.065→0.186, contrast 67.7→103.7, dominant colour share 0.577→0.136.
