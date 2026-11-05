# Art direction — match the comic bible 《偷桃前夜》

User request mid-build: monkey, monsters, and orchard must follow the comic / 日月同错-inspired look from the prequel storyboard, not generic horror blobs.

## Style
- Eastern fantasy, dense ink + saturated night: base ink-purple / pine-smoke black; light = gold peach glow, lantern vermillion, extract blue.
- Strong light/shadow; toggleable lantern is a narrative switch (on = long knife-shadows; off = eyes + peach glow only).
- Palette anchors: `#1a0f2e`, `#c9a227`, `#6b2d5c`, `#2d4a3e` plus lantern `#ff5a2a` / peach gold.

## Player (猴儿) — first person, but any visible arms / death / menu silhouette
- Anthropomorphic short fur, pointed ears, amber eyes.
- Worn night-runner short outfit + arm wraps; waist lantern with gold-red core.
- Greedy, twitchy; lantern toggle + peach-guarding pose matter.

## Monsters = the three fairies (NOT generic demons)
Map existing AI 1:1 to cast:

1. **Grabber → 紫陌 (ZiMo)** close
   - Fairy: lotus-pink sheer gauze, peach forehead mark, sweet smile, gets too close.
   - Monster: jaw split, palm vertical pupil, gauze → mist hands; drain = palm-to-chest life siphon (gold-red filaments).
   - Voice: sweet / sticky; lines vibe「别怕呀，姐姐带你找甜的。」「疼一下就好。」

2. **Caller → 青鸾 (QingLuan)** mid
   - Fairy: teal feather shawl, narrow-sleeve hunt dress, crooked teasing smile; often on branch / in mist.
   - Monster: elongated neck, bird pupils, voice-box flute grotesque.
   - Call phrase MUST be Chinese **「猴哥——」** (never monkeybro). Looking back = death.
   - Voice: playful / cruel tease.

3. **Howler → 金阙 (JinQue)** far / hunt trigger
   - Fairy: gold-thread heavy robes, simple phoenix crown, cold sparse speech; high perch.
   - Monster: cracked crown, gold sigils half-face, summon array behind back; finger-flick summons sisters.
   - Voice: arrogant / command「聚。」「高枝上的，不该碰。」

## World motifs from comic
- Linear dark pan-tao orchard; moonlight cut into gold shards by leaves.
- Stone paifang zone gates, dying lantern posts, mist, optional dry pond + mother tree.
- Extract shrine glow = cool blue; fake-bait energy can read gold/sigil when Howler triggers.
- When high-value peach triggers hunt: brief fairy→monster tear (beauty cracking into yaoguai), not instant gore.

## Implementation notes
- Keep procedural Three.js meshes; prefer stylized low-poly / ink-edge silhouettes over realistic anatomy.
- Emissive accents on eyes, peach tiers, lantern, ZiMo siphon, QingLuan call mist, JinQue gold array.
- HUD / death cause copy in Chinese where player-facing: 紫陌掠命 / 青鸾点名 / 金阙合围.
- Re-read this file before final monster/world polish pass.
