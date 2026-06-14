# Asset Mapping Audit: GLB consistency + faithfulness pass

Companion to `ASSET_GAPS.md` (which closed the *coverage* gaps) and the `ASSETS.md`
ledger (which records license + provenance). This doc does the next pass the closed
audit didn't: it judges every shipped GLB mapping on three axes, then turns the findings
into a **phased production-readiness plan** (Section 8) — what to remap, reskin, download,
and gate so the asset layer reaches a consistent, shippable bar.

Sections 1–5 are the audit (state + findings). Section 6 is the flat action list.
**Section 8 is the plan**: sequenced phases, a consolidated download list, and a
definition of done. Read 8 if you want the roadmap; read 1–6 for the why.

- **Animation** — does the GLB ship the clips the rig drives
  (`idle`/`run`/`attack`[/`cast`/`death`])? This game leans on motion + vfx, so a
  static body is a defect even when the silhouette is perfect. A static download that
  *replaces an animated base* is a regression, not an upgrade.
- **Thematic consistency** — do creatures in the same lore family read as the same
  family? (e.g. all satyrs, all ogres, all golems.)
- **Faithfulness to the original** — does the model read as the Dota/WC3 source unit
  it stands in for? (e.g. a centaur should read as horse-torso, not a bull.)

**Hard requirement for any remap or download: it must be animated.** Idle + a
locomotion clip is the floor; idle/run/attack/cast/death is the target. A better-looking
static mesh does not ship over an animated one.

Scope: heroes (`src/engine/assets.ts` `HERO_COHORTS` / `HERO_BASE`), creeps
(`CREATURE_BY_ID` / `CREATURE_BY_BUILD` → `creepCreatureUrl`), creature-base heroes,
holdouts, summons, ambient critters, signature item/hero weapons, and the **item
visual stack** (3D held GLBs, 2D icon sprites, procedural glyphs — Section 5). Mappings
live in `src/engine/assets.ts` and `scripts/assets/generate_item_icons.mjs`; provenance
lives in `ASSETS.md`.

The standing rules still apply: any Creative Commons or permissive license, including
NonCommercial/ShareAlike (DECISIONS 2026-06-14) — never Valve or Blizzard files, and no
NoDerivatives (the build retextures/retrims/recolors); every asset is optional at
runtime; the build must boot with `public/assets/` empty.

---

## 1. Provenance legend (which GLBs are "custom")

The manifest's `source` field is **not** a reliable "custom vs downloaded" signal —
the vendored Quaternius creeps and our generated families both record `source: null`.
Provenance below is read from the `ASSETS.md` ledger, which is authoritative.

| Class | What it means | Files |
|---|---|---|
| **CUSTOM-GEN** | Generated in-repo by our scripts. Lowest fidelity, first to upgrade. | `creeps/{flier,bear,treant}.glb`; all 22 `holdouts/**`; 80 `weapons/heroes/*`; 13 `weapons/items/*`; the procedural icon/portrait glyphs in `icons.ts` |
| **RETEX** | CC0 KayKit base, our tri-tone palette retexture. Faithful in archetype, generic in silhouette. | 80 `heroes/*.glb` (knight/mage/barbarian/rogue cohorts) |
| **DL-CC0** | Downloaded CC0, processed in-repo. | 20 vendored Quaternius `creeps/*`; `creeps/serpent.glb`; `heroes/{snapfire,gyrocopter}.glb`; all `props/**` |
| **DL-CCBY** | Downloaded CC-BY, attributed in `CREDITS.md`. | `heroes/{tusk,hoodwink}.glb`; 191 `ui/items/<id>.svg` + 56 `ui/items/tokens/*.svg` (game-icons.net) |

Items are not one asset — they're a three-layer stack with mixed provenance, covered
in Section 5: 3D held GLBs (CUSTOM-GEN), 2D icon sprites (DL-CCBY), and a procedural
glyph floor (CUSTOM-GEN).

**The "look for better" set is the CUSTOM-GEN class.** Priority order is Section 6.

### 1.1 Animation coverage (the gating axis)

Because the game relies on motion, clip coverage is judged before silhouette. Status
of every body GLB family:

| GLB family | Clips | Status |
|---|---|---|
| `heroes/*` (80 KayKit RETEX) | idle/run/attack/cast(/channel)/death | ✓ animated |
| Quaternius `creeps/*` (20 DL-CC0) | per-pack walk/idle/attack | ✓ animated |
| `creeps/{flier,bear,treant}` (CUSTOM-GEN) | idle/run/attack/cast/death | ✓ animated |
| `creeps/serpent` (DL-CC0) | idle/run/attack | ✓ animated |
| `heroes/snapfire` (DL-CC0 velociraptor) | idle/run/attack/death | ✓ animated |
| `holdouts/replacements/*` (11 CUSTOM-GEN) | idle/run/attack/cast/channel/death | ✓ animated |
| **`heroes/tusk`** (DL-CCBY walrus) | none | ✗ **STATIC — regression** |
| **`heroes/hoodwink`** (DL-CCBY squirrel) | none | ✗ **STATIC — regression** |
| **`heroes/gyrocopter`** (DL-CC0 helicopter) | none | ✗ **STATIC** |
| `holdouts/*` signature kits (11 CUSTOM-GEN) | additive, no body locomotion | △ fallback only |
| `weapons/**` (93 CUSTOM-GEN) | n/a (held props) | ✓ acceptable static |

The three static **body** GLBs are the priority animation defect: `tusk` and `hoodwink`
each replaced an *animated* shared creature base (`yeti`, `fox`) with a static mesh, so
they look better in a screenshot and worse in motion. See Section 6-A0.

---

## 2. Heroes

### 2.1 Humanoid cohorts (RETEX) — systemic low faithfulness, by design

80 of 122 heroes share **four** KayKit bodies, recolored per hero:

| Base | Count | Heroes |
|---|---|---|
| `knight` | 17 | juggernaut, sven, abaddon, dragon-knight, chaos-knight, legion-commander, omniknight, dawnbreaker, kunkka, mars, wraith-king, chen, clockwerk, timbersaw, slardar, faceless-void, pangolier |
| `mage` | 30 | crystal-maiden, lich, lina, zeus, witch-doctor, invoker, lion, rubick, pugna, necrophos, death-prophet, disruptor, grimstroke, keeper-of-the-light, shadow-shaman, silencer, skywrath-mage, outworld-destroyer, warlock, dark-seer, dark-willow, enchantress, natures-prophet, queen-of-pain, storm-spirit, vengeful-spirit, dazzle, arc-warden, razor, winter-wyvern |
| `barbarian` | 15 | pudge, earthshaker, lifestealer, undying, ogre-magi, bristleback, troll-warlord, axe, magnus, brewmaster, alchemist, huskar, beastmaster, slark, underlord |
| `rogue` | 18 | sniper, mirana, drow-ranger, windranger, phantom-assassin, riki, bounty-hunter, anti-mage, templar-assassin, clinkz, meepo, void-spirit, ember-spirit, marci, phantom-lancer, monkey-king, luna, bloodseeker |

This is the single biggest unfaithfulness in the project: within a cohort every hero
shares one silhouette and differs only by palette + a generated weapon. It is a
deliberate budget call, not a bug. Per-hero silhouette identity comes (when it comes)
from the held-weapon GLB and palette, never the body.

Worst offenders (heroes whose Dota silhouette is strongly non-humanoid yet sit on a
humanoid base — candidates for a future creature/bespoke remap):

- `mage`-cohort but non-humanoid in source: `winter-wyvern` (dragon), `death-prophet`
  (spectral), `necrophos` (floating reaper), `outworld-destroyer` (energy being),
  `natures-prophet` (treant-ish), `razor` (energy being).
- `barbarian`-cohort but beast/large in source: `pudge` (bloated flesh golem),
  `undying` (zombie/tombstone), `bristleback` (boar-man), `magnus` (mammoth-man),
  `beastmaster` (could ride/summon), `huskar` (fine).
- `knight`-cohort but non-knightly: `clockwerk` (mech goblin → see `goblin` family),
  `timbersaw` (mech), `faceless-void` (alien), `pangolier` (pangolin-man).

These are not wired wrong; they're the heroes most worth a bespoke download later.

### 2.2 Creature-base heroes — faithfulness is good, a few stretch

These reuse vendored Quaternius creeps (DL-CC0) as shared bodies via `heroBaseUrl`.

| Base GLB | Heroes | Read | Verdict |
|---|---|---|---|
| `spider` | broodmother, weaver, nyx-assassin, sand-king | arachnid/bug | broodmother ✓; nyx/weaver (beetle/bug) ✓; **sand-king is a scorpion** — spider is closest available but a scorpion GLB would be more faithful |
| `dragonevolved` | jakiro, viper, puck | dragon | all ✓ |
| `demon` | doom, shadow-demon, shadow-fiend, night-stalker, terrorblade, visage | demon/winged-fiend | all ✓ (visage = gargoyle, close) |
| `wolf` | lycan | werewolf | ✓ |
| `giant` | primal-beast | huge brute beast | ✓ — **but the code comment above this line ("Sea leviathan reads more aquatic on the crab base…") is stale/misplaced**; it describes tidehunter, not primal-beast. Fix the comment. |
| `golelingevolved` | tiny, elder-titan, earth-spirit | rock/earth elemental | all ✓ |
| `goblin` | techies, gyrocopter, tinker | goblin/keen tinkerer | ✓ (gyrocopter now overridden by bespoke helicopter, see 2.3) |
| `velociraptor` | venomancer, snapfire | reptile/lizard | venomancer ✓; snapfire now overridden by bespoke velociraptor mount |
| `bull` | spirit-breaker, centaur-warrunner | horned charger | spirit-breaker ✓; **centaur-warrunner loses the humanoid torso** (no centaur GLB) |
| `crab` (`crabenemy.glb`) | tidehunter | aquatic crustacean | leviathan/fish-man → crab is a fair aquatic stand-in |
| `bear` (CUSTOM-GEN) | ursa | bear | ✓ |
| `treant` (CUSTOM-GEN) | treant-protector | walking tree | ✓ |
| `ghost` | spectre | spectral | ✓ |

### 2.3 Bespoke hero downloads (DL) — preferred over shared base

These four mount through `heroAssetEntry` *before* the shared base, because the shared
stand-in read too generic. But silhouette was the only axis weighed — three of the
four are **static**, which trades motion for a better still:

| Hero | GLB | Source | Silhouette | Animation |
|---|---|---|---|---|
| `tusk` | walrus | Poly by Google, CC-BY | walrus-man ✓ (better than `yeti`) | ✗ **static — was animated on `yeti`** |
| `hoodwink` | squirrel | Poly by Google, CC-BY | squirrel ✓ (better than `fox`) | ✗ **static — was animated on `fox`** |
| `gyrocopter` | helicopter | kazuma, CC0 | gyro ✓ | ✗ **static** |
| `snapfire` | velociraptor | Quaternius, CC0 | lizard mount ✓ | ✓ animated (the model to copy) |

`snapfire` is the template: a download that wins on silhouette *and* keeps clips. The
other three need either an animated replacement or, if none exists, a decision to fall
back to the animated shared base rather than ship a static body (Section 6-A0).

### 2.4 Holdouts (CUSTOM-GEN) — the biggest upgrade opportunity

11 heroes ship generated abstract art (`holdouts/<id>.glb` signature +
`holdouts/replacements/<id>.glb` animated). These are the lowest-fidelity hero assets.

| Holdout | Source form | Procedural defensible? | Better-asset opportunity |
|---|---|---|---|
| `io` | wisp / orb of energy | **Yes** — genuinely abstract | keep generated |
| `enigma` | void / eldritch mass | **Yes** | keep generated |
| `morphling` | living water | **Yes** | keep generated |
| `ancient-apparition` | floating ice spirit | **Yes** | keep generated |
| `leshrac` | tormented horned mage | partial | could move to `demon` base |
| `phoenix` | fire bird | **No** | reuse `flier.glb` (recolor fire) |
| `batrider` | rider on a flying bat | **No** | reuse `flier.glb` |
| `naga-siren` | serpent-woman | **No** | reuse `serpent.glb` |
| `medusa` | gorgon (snake body) | **No** | reuse `serpent.glb` |
| `lone-druid` | druid + spirit bear | **No** | reuse `bear.glb` |
| `bane` | nightmare fiend | partial | could move to `demon` base |

`naga-siren`, `medusa`, `lone-druid`, `phoenix`, `batrider`, `leshrac`, `bane` already
have a *better in-repo asset* available — they're abstract generated only because they
predate those families being added. See Section 6 action A.

---

## 3. Creeps

Every creep has an explicit `CREATURE_BY_ID` mapping, so `CREATURE_BY_BUILD` only ever
catches **summoned minions** (build `biped` → `goblin`) and any future unmapped creep.

### 3.1 Resolved creep → GLB table

| Creep | Maps to | Family read | Faithful? |
|---|---|---|---|
| kobold, kobold-foreman | `goblin` | small humanoid | ⚠ kobolds are ratty miners; passable |
| hill-troll | `orc` | brute | ⚠ trolls usually read tribal (see 3.2-C) |
| vhoul-assassin | `goblin` | small green humanoid | ✗ **vhoul are desert undead/skeletal** — misread |
| gnoll-assassin | `goblin` | small humanoid | ✗ **gnolls are hyena-folk** — misread (no gnoll asset) |
| satyr-banisher, satyr-mindstealer | `demon` | horned fiend | ✓ |
| prowler-shaman, prowler-acolyte | `tribal` | shaman | ✗ **prowlers are satyrs** — should match the satyrs above (3.2-A) |
| hellbear | `bear` | bear | ✓ |
| wildwing, wildwing-ripper, enraged-wildkin | `bear` | owlbear | ✓ |
| polar-furbolg | `yeti` | white furry beast | ⚠ furbolgs are bear-folk; `yeti` chosen for frost read (3.2-E) |
| harpy-stormcrafter, harpy-scout | `flier` | winged | ✓ |
| granite-golem, rock-golem, mud-golem | `golelingevolved` | rock golem | ✓ |
| frostbitten-golem | `yeti` | white furry beast | ✗ **named a golem, mapped to a beast** (3.2-D) |
| ghost, fell-spirit | `ghost` | spectre | ✓ |
| alpha-wolf, giant-wolf | `wolf` | wolf | ✓ |
| ice-shaman, dark-troll, dark-troll-summoner, ogre-frostmage | `tribal` | shaman/voodoo | ⚠ mixed (ogre + troll on one family, see 3.2-B/C) |
| centaur-courser, centaur-conqueror | `bull` | horned quadruped | ⚠ **centaurs lose the humanoid torso** (no centaur asset) |
| thunderhide, ancient-thunderhide | `bull` | horned beast | ✓ |
| ogre-bruiser | `orcenemy` | orc brute | ✓ (deliberately split from `orc`) |
| ogre-magi-large | `orc` | orc brute | ✓ |
| black-dragon | `dragonevolved` | dragon | ✓ |
| elder-jungle-stalker | `stag` | antlered beast | ✓ |
| *(any summon minion)* | `goblin` (via build) | small humanoid | ⚠ all summons read as goblins (3.3) |

### 3.2 Family-consistency flags

**A. Satyr family is split.** `satyr-banisher` + `satyr-mindstealer` → `demon`, but
`prowler-shaman` + `prowler-acolyte` → `tribal`. Prowlers *are* satyrs in WC3/Dota.
Pick one family for all four. Recommend `demon` for all (the banisher/mindstealer read
is the stronger one), or split by role only if intentional.

**B. Ogre family is split three ways.** `ogre-bruiser` → `orcenemy`,
`ogre-magi-large` → `orc`, `ogre-frostmage` → `tribal`. The orc/orcenemy split is the
intended "not all identical orc" choice and is fine. The `ogre-frostmage` → `tribal`
is the outlier; it's defensible as a caster read but breaks the ogre silhouette. Note
or move to an orc-family body with a caster palette.

**C. Troll family is split.** `hill-troll` → `orc`; `dark-troll(+summoner)` → `tribal`.
Two different troll reads. Minor; document the intent (hill = bulky brute, dark = caster).

**D. `frostbitten-golem` → `yeti` is the clearest mismatch.** It's named a *golem* and
shares the golem role with granite/rock/mud (all on `golelingevolved`), but renders as
a furry yeti. Recommend `golelingevolved` with a frost-blue palette for family unity.

**E. `polar-furbolg` → `yeti`.** Furbolgs are bear-folk; `hellbear`/wildkin are on
`bear`. `yeti` was chosen for the white/frost read. Defensible but inconsistent — could
move to `bear` with a frost palette to unify the bear family.

### 3.3 Summon minions all read as goblins

Summon abilities (`dark-troll-summoner`, `prowler-shaman`, and the generic `creep()`
summon path) spawn minions with `silhouette.build: 'biped'` and an id like
`<id>-minion` that isn't in `CREATURE_BY_ID`, so they fall through to
`CREATURE_BY_BUILD.biped → goblin`. Every summoned add renders as a goblin regardless
of summoner. Acceptable for now; if it reads wrong, add per-summon `CREATURE_BY_ID`
rows (e.g. dark-troll skeletons → `ghost`/undead, prowler → `demon`).

### 3.4 Faithfulness flags (creeps)

- `vhoul-assassin` → `goblin`: vhoul are desert undead. A skeletal/rogue or `demon`
  read would be more faithful; no exact asset exists.
- `gnoll-assassin` → `goblin`: gnolls are hyena-folk; no gnoll GLB. Closest current
  options are weak. Download candidate.
- `centaur-courser` / `centaur-conqueror` → `bull`: no centaur GLB, so the
  horse-torso humanoid is lost. Download candidate.

---

## 4. Summons + ambient

| Use | GLB | Provenance | Verdict |
|---|---|---|---|
| `shadow-shaman-serpent-ward`, `phase3-serpent-ward`, `phase3-naga-image` | `serpent` | DL-CC0 | ✓ animated snake, faithful |
| ambient `alpaca`, `fox`, `frog` | DL-CC0 | town decoration, non-sim | ✓ |

No issues. Note `serpent.glb` is exactly the asset `naga-siren`/`medusa` should reuse
(Section 2.4 / 6-A).

---

## 5. Items — a three-layer visual stack

Items don't have "an item GLB" the way a hero has a body. They render through three
layers, each with different provenance, fidelity, and upgrade priority. Lookup order
for the HUD icon is per-item sprite → token sprite → procedural glyph (`icons.ts`
`itemSilhouette`); the 3D layer is separate and only fires for equipped held weapons.

| Layer | What it is | Count | Provenance | Animation | Where |
|---|---|---|---|---|---|
| **3D held GLB** | signature weapon mounted on the hero's hand socket when equipped | 13 | CUSTOM-GEN (script-assembled box/cone/cylinder primitives) | rides the hero rig — static mesh is fine | `weapons/items/*.glb`, `itemWeaponGlbUrl` + `attachSignatureItemWeapon` |
| **2D icon sprite** | per-item silhouette filled + tinted into the gem-slot HUD | 191 + 56 tokens | DL-CCBY (game-icons.net, single-path SVGs) | n/a (static UI) | `ui/items/*.svg`, baked to `item-glyphs.generated.ts` |
| **Procedural glyph** | hand-drawn canvas glyph floor when no sprite / no `Path2D` | ~40 tokens | CUSTOM-GEN | n/a | `icons.ts` `ITEM_GLYPHS` / `GLYPHS` |

Also relevant: each `ItemDef` carries a procedural `appearance.weapon` that is the held
fallback when no 3D GLB exists (most items), and `heroPortrait` is a separate
procedural-canvas silhouette for the pick/codex/HUD bust.

### 5.1 3D held weapon GLBs (13, CUSTOM-GEN)

daedalus, radiance, battlefury, divine-rapier, butterfly, scythe-of-vyse, eye-of-skadi,
monkey-king-bar, abyssal-blade, mjollnir, satanic, bloodthorn, desolator.

- **Animation:** not a problem here. These attach to the hand socket and inherit the
  hero's attack/idle motion, so a static mesh is correct (unlike a body GLB).
- **Thematic consistency:** ✓ all read as artifact-tier weapons/scepters with an
  emissive accent material; palette per item.
- **Faithfulness:** fair — they're recognizable by silhouette (sun-blade = radiance,
  hex-scythe = scythe-of-vyse, frost-orb scepter = eye-of-skadi) but they are blocky
  primitive assemblies, the lowest-fidelity 3D in the project after the holdout blobs.
- **Coverage:** only 13 of ~150 items have a 3D model. This is **by design** (ASSET_GAPS
  P3: most items stay procedural/UI). But several weapon-core artifacts that *would*
  read well as held models have none — candidates if the tier ever expands:
  `crystalys`, `diffusal-blade`, `maelstrom`, `silver-edge`, `echo-sabre`, `nullifier`,
  `skull-basher`, `ethereal-blade`, `dagon`, `meteor-hammer`, `heavens-halberd`.

Upgrade priority: **moderate, and part of the bar** (Phase 5 is required, not optional).
They're motion-correct so urgency is lower than a static body, but "production-ready"
means they read as authored silhouettes, not raw primitive assemblies — batch-upgrade the
generator to smoother shapes (bevels/lathe instead of raw boxes) and give the marquee
artifacts recognizable shapes. Replace an individual one sooner if it looks wrong.

### 5.2 2D icon sprites (191 + 56, DL-CCBY)

- **Provenance:** game-icons.net (Lorc, Delapouite & contributors), CC BY 3.0 —
  **attribution is required and load-bearing**, recorded in `ASSETS.md` + `CREDITS.md`.
  Not custom; downloaded via the `@iconify-json/game-icons` data package.
- **Consistency:** ✓ strong — one source pack, single-path 512² silhouettes, uniform
  style, tinted per tier. Every item gets its own override so the bag reads distinctly.
- **Minor flag:** families that legitimately look alike collapse to one silhouette —
  e.g. `circlet`, `band-of-elvenskin`, `ring-of-regen`, `soul-ring`, `perseverance` all
  map to the `ring` icon. Acceptable (rings are rings); only revisit if a shared-icon
  pair needs to be told apart at a glance.
- **Upgrade priority:** **none** by default. The set is faithful and consistent. The
  only action item is keeping the CC-BY attribution shipped.

### 5.3 Procedural glyph + portrait floor (CUSTOM-GEN)

`ITEM_GLYPHS` / `GLYPHS` in `icons.ts` and `heroPortrait` are the hand-drawn canvas
floor that keeps the HUD readable with `public/assets/` empty. They are custom but
intentionally crude — the boot floor, not a shipping target. Leave as-is.

### 5.4 Hero default weapons (80, CUSTOM-GEN)

`weapons/heroes/*.glb` — generated default hand weapons for the humanoid cohorts, one
per hero. Motion-correct (ride the hero rig). They're the main per-hero identity signal
*within* a shared-body cohort (Section 2.1), so they matter more than item weapons but
are still low fidelity. Upgrade priority: **low–medium** — a better generated weapon set
(or per-hero signature shapes) is the cheapest way to differentiate the 80 same-body
heroes without new body GLBs.

---

## 6. Prioritized actions

### A0. Fix the static body GLBs (animation regression) — do first

`tusk`, `hoodwink`, `gyrocopter` ship static and the game relies on motion. For each,
pick one:

1. **Best:** find an animated CC0/CC-BY replacement with idle + locomotion (walrus,
   squirrel, gyrocopter/helicopter with rotor spin) and reprocess through
   `asset-gaps-polypizza.json` with `keepClips`/`renameClips` like `snapfire`.
2. **Fallback:** if no animated download exists, drop the bespoke entry and let the
   hero fall back to its animated shared base (`tusk`→`yeti`, `hoodwink`→`fox`). A
   moving generic body beats a frozen specific one.
3. **Last resort:** add a procedural idle bob/rotor-spin in `mountHeroModel` so even a
   static mesh isn't fully frozen.

Make "ships idle + a locomotion clip" a gate in `assets:check` so a static body GLB
can't land again.

### A. Remap holdouts onto existing better assets (no download needed)

Highest value, zero new assets. Move these off generated abstract holdout art onto
in-repo creature bodies, recolored:

| Hero | From | To | Asset exists? |
|---|---|---|---|
| `naga-siren` | generated holdout | `serpent.glb` | ✓ shipped |
| `medusa` | generated holdout | `serpent.glb` | ✓ shipped |
| `lone-druid` | generated holdout | `bear.glb` | ✓ shipped |
| `phoenix` | generated holdout | `flier.glb` | ✓ shipped |
| `batrider` | generated holdout | `flier.glb` | ✓ shipped |

All five targets (`serpent`, `bear`, `flier`) are animated, so this is animation-safe —
it swaps generated abstract art for a faithful *and* animated body.

Implementation: add these to a creature cohort in `HERO_COHORTS` (or a holdout→base
override) instead of `PROCEDURAL_HOLDOUTS`, and drop them from the holdout sets. Keep
`io`, `enigma`, `morphling`, `ancient-apparition` generated (genuinely abstract).
`leshrac`, `bane` could optionally move to `demon`.

### B. Fix creep family consistency (mapping-only edits in `CREATURE_BY_ID`)

1. `prowler-shaman`, `prowler-acolyte`: `tribal` → `demon` (match the satyrs).
2. `frostbitten-golem`: `yeti` → `golelingevolved` (match the golems; frost palette).
3. Optional: `polar-furbolg`: `yeti` → `bear` (unify bear family, frost palette).
4. Optional: `ogre-frostmage`: `tribal` → `orc`/`orcenemy` (unify ogre family).

### C. Fix the stale code comment

`src/engine/assets.ts` line above `giant: ['primal-beast']` references a "Sea
leviathan" / crab base — that describes `tidehunter`, not `primal-beast`. Correct or
remove it.

### D. Download targets (any CC / permissive, incl. NC/SA) for the worst faithfulness gaps

**Every candidate must ship idle + a locomotion clip; reject static meshes.**

| Need | For | Note |
|---|---|---|
| animated walrus | `tusk` | replace the static walrus (A0) |
| animated squirrel/rodent | `hoodwink` | replace the static squirrel (A0) |
| animated gyro/helicopter | `gyrocopter` | replace the static helicopter (A0) |
| scorpion (animated) | `sand-king` | better than `spider` |
| centaur (animated) | centaur-courser/conqueror, centaur-warrunner | no current centaur asset |
| gnoll / hyena-beast (animated) | `gnoll-assassin` | currently goblin |
| skeletal/undead rogue (animated) | `vhoul-assassin` | currently goblin |

### E. Replace generated creature families with better downloads (optional)

`creeps/{flier,bear,treant}.glb` are serviceable generated originals. If a better CC0
winged creature, bear, or treant turns up, swap it in — they back several creeps and
heroes, so the upgrade propagates widely.

### F. Item + hero weapons (CUSTOM-GEN) — part of the bar (Phase 5 required)

- 13 item weapon GLBs: motion-correct (hand-socket) but raw primitive assemblies;
  Phase 5 (required) batch-smooths the generator and gives the marquee artifacts
  recognizable silhouettes. Replace individually sooner if one looks wrong.
- Hero default weapons: **done** (Phase 4 Tier A). Every humanoid-cohort hero carries a
  per-hero signature weapon shape (`STYLE_BY_HERO` + per-style geometry), so cohort-mates
  diverge by weapon silhouette + palette. Keep it covered by tests.
- 2D item icon sprites (game-icons.net): no action except keep the **CC-BY attribution**
  shipped in `ASSETS.md` + `CREDITS.md`. Don't strip it.
- Procedural glyph/portrait floor: leave as-is; it's the empty-assets boot floor.

---

## 7. Tooling note: manifest can't tell custom from downloaded

`public/assets/manifest.json` records `source: null` for **both** the vendored
Quaternius creeps and our generated families, so it can't answer "which GLBs are
custom?" on its own. `ASSETS.md` is the source of truth. Consider populating `source`
for the generated families (e.g. `"generated in-repo"`) and the vendored creeps (e.g.
`"Quaternius CC0"`) in `build_assets.mjs` so this audit can be regenerated from the
manifest instead of by hand.

---

## 8. Production-readiness plan

The goal: an asset layer that reads as one consistent, intentional game — every lore
family resolves to a single creature family, no static bodies, no abstract blob where a
real creature exists, and a clear (documented) reason for every remaining stand-in. The
plan is ordered by value-per-effort: mapping-only fixes first, downloads second, the
big systemic hero-identity work last.

### Definition of done

Production-ready means all of these hold and are enforced by `assets:check` + tests:

1. **No static body GLBs.** Every hero/creep/creature body ships idle + a locomotion
   clip, or falls back to an animated base. (Held weapons are exempt — they ride the rig.)
2. **One family per lore group.** All satyrs share a family, all ogres, all golems, all
   trolls, all bears. Any deliberate exception is commented at the mapping site.
3. **No abstract blob where a real creature exists.** A holdout stays generated only if
   its source unit is genuinely formless (`io`, `enigma`, `morphling`, `ancient-apparition`).
4. **Every stand-in is intentional.** Each cross-species mapping (e.g. centaur→bull) is
   either fixed with a faithful asset or carries a comment explaining the compromise.
5. **Provenance is machine-readable.** `manifest.json` `source` distinguishes generated
   / Quaternius-CC0 / KayKit-CC0 / Poly-Pizza / game-icons, so this audit regenerates.
6. **Attribution intact.** CC-BY credits (game-icons, tusk/hoodwink) shipped in
   `ASSETS.md` + `CREDITS.md`.
7. **Held weapons read as authored.** The marquee item GLBs and the per-hero weapon set
   carry recognizable silhouettes, not raw primitive blocks (Phase 4 Tier A + Phase 5).
8. **Gates green.** `npm run assets:check && npm run typecheck && npm test && npm run build`.

### Phase 0 — Guardrails (no art; do first)

Lock the bar before changing anything, so fixes can't regress.

- Add an **animation gate** to `assets:check`: any GLB under `heroes/`, `creeps/`,
  `holdouts/replacements/` must expose ≥1 locomotion/idle clip (held weapons exempt).
- Add a **family-consistency lint** in `data-lint.test.ts`: assert the lore groups in
  §3.2 each resolve to a single family (with an allowlist for documented exceptions).
- Populate `manifest.json` `source` in `build_assets.mjs` (Section 7).
- Fix the stale `primal-beast` comment (Section 6-C).
- **Exit:** gates green; the lints fail loudly if any later phase breaks #1 or #2.

### Phase 1 — Zero-download consistency wins (mapping edits only)

All targets already shipped and animated; pure `assets.ts` edits.

- Remap 5 holdouts onto animated families (Section 6-A): `naga-siren`,`medusa`→`serpent`;
  `lone-druid`→`bear`; `phoenix`,`batrider`→`flier`. Drop them from `PROCEDURAL_HOLDOUTS`.
- Creep family fixes (Section 6-B): prowlers→`demon`; `frostbitten-golem`→`golelingevolved`
  (frost palette); `polar-furbolg`→`bear` (frost palette); `ogre-frostmage`→`orcenemy`.
- Give summoned minions a sensible family instead of the goblin fallback (Section 3.3):
  add `*-minion` `CREATURE_BY_ID` rows for the dark-troll and prowler summons.
- **Exit:** §3.2 family lint passes with no exceptions; holdout set down to the 4 truly
  abstract heroes (+ optional `leshrac`/`bane`). Visual QA the remapped heroes/creeps.

### Phase 2 — Kill the static-body regressions (targeted downloads)

The three static bodies are the only hard *animation* defects.

- For `tusk` / `hoodwink` / `gyrocopter`: source an **animated** CC0/CC-BY replacement
  (Section 6-A0 step 1) and process it through `asset-gaps-polypizza.json` with
  `keepClips`/`renameClips` like `snapfire`.
- If no animated asset is found for one, **revert it to its animated shared base**
  (`tusk`→`yeti`, `hoodwink`→`fox`, `gyrocopter`→`goblin`) rather than ship static.
- **Exit:** zero static bodies; animation gate (Phase 0) passes with no exemptions.

### Phase 3 — Faithfulness downloads (close the species gaps)

Replace the "closest available" stand-ins with faithful, animated creatures.

- Download animated, recolor-friendly CC0/CC-BY creatures for the Section 6-D needs:
  scorpion (`sand-king`), centaur (centaur creeps + `centaur-warrunner`), gnoll/hyena
  (`gnoll-assassin`), undead/skeletal rogue (`vhoul-assassin`).
- Wire each via `CREATURE_BY_ID` (creeps) or a creature cohort (`sand-king`).
- For anything not found, leave the current mapping and **add a comment** documenting
  the compromise (satisfies done-criterion #4 without blocking).
- **Exit:** every species gap is either faithful or explicitly justified in code.

### Phase 4 — Hero silhouette identity (largest effort, do last)

The 80 same-body cohort heroes (Section 2.1) are the biggest remaining unfaithfulness.
Full per-hero bodies are out of scope; this phase de-risks the *worst* reads only.

- **Tier A (cheap, high value) — landed:** the generated hero weapon set (Section 5.4)
  now carries a per-hero signature shape (`STYLE_BY_HERO` + per-style geometry in
  `generate_hero_weapons.mjs`), so cohort-mates diverge by weapon silhouette + palette,
  not palette alone. Pinned by tests.
- **Tier B (mapping edits, animated bases) — landed for the clearest reads:** the worst
  non-humanoid cohort offenders now ride animated creature bodies — `winter-wyvern`→
  `dragonevolved`, `clockwerk`/`timbersaw`→`goblin` (mech), `death-prophet`→`ghost`
  (banshee). Remaining offenders (`pudge`/`undying`→a brute/zombie body, the energy
  elementals) need a download and stay on their cohort body for now.
- **Tier C (backlog):** bespoke per-hero downloads for marquee heroes, opportunistically.
- **Exit:** no hero whose Dota silhouette is strongly non-humanoid is stuck on a plain
  humanoid base; the rest are accepted cohort stand-ins by design.

### Phase 5 — Item + weapon polish (required)

The held layer has to read as authored too, so this is part of the production bar, not
gravy. (Phase 4 Tier A already landed per-hero weapon-shape divergence; this phase closes
the item-weapon side and keeps the hero side covered.)

- Smooth the generated item-weapon generator (bevels/lathe vs raw boxes) and give the
  marquee artifacts the recognizable silhouettes called out in §5.1 (scythe, hammer,
  orb, sun); add GLBs for the weapon-cores listed there as the tier expands.
- Keep the per-hero weapon-shape divergence (Phase 4 Tier A) covered by tests so a
  regression to one shared shape can't land.
- Leave the game-icons sprite set and procedural floor as-is (keep CC-BY attribution).
- **Exit:** no item or hero weapon ships as a raw primitive block where a recognizable
  silhouette is achievable; gates green.

### Consolidated download list

Source preference: Quaternius / Poly Pizza / KayKit (CC0) first, then any CC-BY, then
NonCommercial/ShareAlike (CC-BY-NC / CC-BY-SA / CC-BY-NC-SA) with attribution
(DECISIONS 2026-06-14). Avoid only NoDerivatives. **Animation is mandatory for every
body** (idle + locomotion); reject static meshes. Process through `tmp/asset_src/` → a
spec under `scripts/assets/specs/` → `build_assets.mjs`, then add an `ASSETS.md` row.

| Need | For | Phase | If not found |
|---|---|---|---|
| animated walrus | `tusk` | 2 | revert to `yeti` base |
| animated squirrel/rodent | `hoodwink` | 2 | revert to `fox` base |
| animated gyrocopter/helicopter | `gyrocopter` | 2 | revert to `goblin` base + rotor spin |
| animated scorpion | `sand-king` | 3 | keep `spider`, comment |
| animated centaur | centaur creeps, `centaur-warrunner` | 3 | keep `bull`, comment |
| animated gnoll/hyena | `gnoll-assassin` | 3 | keep `goblin`, comment |
| animated skeletal/undead rogue | `vhoul-assassin` | 3 | keep `goblin`, comment |
| animated creature bodies for Tier-B heroes | §2.1 offenders | 4 | keep cohort body |

### Sequencing summary

| Phase | Work | Downloads | Effort | Impact |
|---|---|---|---|---|
| 0 | guardrails + lints + comment | none | S | prevents regressions |
| 1 | holdout remaps + creep family fixes | none | S | high — consistency |
| 2 | fix 3 static bodies | 0–3 | M | high — animation |
| 3 | faithfulness species downloads | 0–4 | M | medium |
| 4 | hero identity (weapons + worst offenders) | a few | L | medium–high |
| 5 | item/weapon polish (required) | a few | M | medium |

Run the gates after every phase: `npm run assets:check && npm run typecheck && npm test
&& npm run build`. Phases 0–4 and the hero-weapon side of Phase 5 are landed; the
item-weapon polish (Phase 5) and the download-gated faithfulness/identity tail remain.
