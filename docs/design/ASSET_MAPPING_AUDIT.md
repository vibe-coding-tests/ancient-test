# Asset Mapping Audit: GLB consistency + faithfulness pass

Companion to `ASSET_GAPS.md` (which closed the *coverage* gaps) and the `ASSETS.md`
ledger (which records license + provenance). This doc does the next pass the closed
audit didn't: it judges every shipped GLB mapping on three axes, then turns the findings
into a **phased production-readiness plan** (Section 8) — what to remap, reskin, download,
and gate so the asset layer reaches a consistent, shippable bar.

Sections 1–5 are the audit (state + findings). Section 6 is the flat action list.
**Section 8 is the plan**: sequenced phases, a consolidated download list, and a
definition of done. Read 8 if you want the roadmap; read 1–6 for the why.

## Current implementation snapshot (2026-06-14)

The code has moved past several early audit findings:

- **No static body GLB ships.** `assets:check` enforces idle + locomotion clips on
  body GLBs. `tusk`, `hoodwink`, and `gyrocopter` now use generated animated
  bespoke bodies; `snapfire` uses a generated lizard mount with a rider.
- **Zero-download remaps are landed.** Former animal-shaped holdouts now ride
  animated families (`flier`, `serpent`, `bear`, `demon`). Only `io`, `enigma`,
  `morphling`, and `ancient-apparition` remain procedural holdouts.
- **Species gaps are mostly closed with generated or downloaded art.** `sand-king`
  uses `scorpion`, centaurs use `centaur`, `gnoll-assassin` uses `gnoll`,
  `vhoul-assassin` uses the downloaded CC0 `skeleton`, and wildkin use `owlbear`.
- **Hero silhouette variety advanced.** `clockwerk`/`timbersaw` moved to `goblin`,
  `death-prophet` moved to `ghost`, `arc-warden`/`outworld-destroyer`/`razor`
  moved to `energy`, and `pudge`/`undying` moved to `abomination`.
- **Cohort sameness closed.** Each of the 65 shared-body cohort heroes now wears a
  distinct additive silhouette kit (head/back/shoulder/jaw/aura/accent) + per-hero
  proportions over the polished KayKit base (`heroSilhouetteKit` +
  `applyAuthoredSilhouette`), lint-pinned for per-cohort uniqueness (§2.1).
- **Phase 5 item-weapon polish landed.** The 13 marquee item GLBs now use tapered
  blades, ellipsoid cores/gems, higher-segment round parts, and stronger per-item
  silhouettes.
- **Cleanup landed.** The old KayKit body/weapon files and `heroes.json` spec
  entries for heroes moved off humanoid cohorts were removed, so rebuilds do not
  reintroduce unused bodies. The 14 orphaned holdout GLBs for heroes since moved to
  creature bases were deleted and `generate_holdout_signatures.mjs` trimmed, so
  `holdouts/**` holds exactly the 4 abstract holdouts (8 files).

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

The manifest's `source` field now records broad machine-readable provenance for every
shipped file. `ASSETS.md` remains the detailed human ledger for license and attribution.

| Class | What it means | Files |
|---|---|---|
| **CUSTOM-GEN** | Generated in-repo by our scripts. Lowest fidelity, first to upgrade. | `creeps/{flier,bear,treant,scorpion,centaur,gnoll,owlbear,energy,abomination,fishman}.glb`; `heroes/{gyrocopter,hoodwink,snapfire,tusk}.glb`; 8 `holdouts/**` for the 4 abstract holdouts; 65 `weapons/heroes/*`; 13 `weapons/items/*`; the procedural icon/portrait glyphs in `icons.ts` |
| **RETEX** | CC0 KayKit base, our tri-tone palette retexture. Faithful in archetype, generic in silhouette. | 65 `heroes/*.glb` (remaining knight/mage/barbarian/rogue cohorts) |
| **DL-CC0** | Downloaded CC0, processed in-repo. | 20 vendored Quaternius `creeps/*`; `creeps/{serpent,skeleton}.glb`; all `props/**` |
| **DL-CCBY** | Downloaded CC-BY, attributed in `CREDITS.md`. | 191 `ui/items/<id>.svg`, 56 `ui/items/tokens/*.svg`, and 23 `ui/status/*.svg` (game-icons.net) |

Items are not one asset — they're a three-layer stack with mixed provenance, covered
in Section 5: 3D held GLBs (CUSTOM-GEN), 2D icon sprites (DL-CCBY), and a procedural
glyph floor (CUSTOM-GEN).

**The "look for better" set is the CUSTOM-GEN class.** Priority order is Section 6.

### 1.1 Animation coverage (the gating axis)

Because the game relies on motion, clip coverage is judged before silhouette. Status
of every body GLB family:

| GLB family | Clips | Status |
|---|---|---|
| `heroes/*` (65 KayKit RETEX) | idle/run/attack/cast(/channel)/death | ✓ animated |
| Quaternius `creeps/*` (20 DL-CC0) | per-pack walk/idle/attack | ✓ animated |
| `creeps/{flier,bear,treant,scorpion,centaur,gnoll,owlbear,energy,abomination,fishman}` (CUSTOM-GEN) | idle/run/attack/cast/death | ✓ animated |
| `creeps/{serpent,skeleton}` (DL-CC0) | idle/run/attack(/death) | ✓ animated |
| `heroes/{gyrocopter,hoodwink,snapfire,tusk}` (CUSTOM-GEN bespoke bodies) | idle/run/attack/cast/death | ✓ animated |
| `holdouts/replacements/*` (4 CUSTOM-GEN) | idle/run/attack/cast/channel/death | ✓ animated |
| `holdouts/*` signature kits (4 CUSTOM-GEN) | additive, no body locomotion | △ fallback only |
| `weapons/**` (78 CUSTOM-GEN: 65 hero defaults + 13 item signatures) | n/a (held props) | ✓ acceptable static |

The old static `tusk`/`hoodwink`/`gyrocopter` downloads are retired. Generated animated
bespoke bodies now satisfy the body-animation gate.

---

## 2. Heroes

### 2.1 Humanoid cohorts (RETEX) — silhouette-differentiated per hero

65 of 122 heroes share **four** KayKit bodies, recolored per hero:

| Base | Count | Heroes |
|---|---|---|
| `knight` | 13 | juggernaut, sven, abaddon, dragon-knight, chaos-knight, legion-commander, omniknight, dawnbreaker, kunkka, mars, wraith-king, chen, faceless-void |
| `mage` | 23 | crystal-maiden, lich, lina, zeus, witch-doctor, invoker, lion, rubick, pugna, disruptor, grimstroke, keeper-of-the-light, shadow-shaman, silencer, skywrath-mage, warlock, dark-seer, dark-willow, enchantress, queen-of-pain, storm-spirit, vengeful-spirit, dazzle |
| `barbarian` | 12 | earthshaker, lifestealer, ogre-magi, bristleback, troll-warlord, axe, magnus, brewmaster, huskar, beastmaster, underlord, bloodseeker |
| `rogue` | 17 | sniper, mirana, drow-ranger, windranger, phantom-assassin, riki, bounty-hunter, anti-mage, templar-assassin, clinkz, void-spirit, ember-spirit, marci, phantom-lancer, monkey-king, luna, pangolier |

Cohort-mates **no longer read identically.** On top of the recolor + per-hero weapon,
each cohort hero now resolves a structured **silhouette kit** —
`heroSilhouetteKit(heroId)` in `engine/models.ts` projects the hero's likeness
`features` onto six slots (head / back / shoulder / jaw / aura / accent), and
`applyAuthoredSilhouette` builds those primitives over the shared body together with
per-hero proportions. A crown knight, a winged-helm paladin, a hooded archer, and a
skull-faced mage all diverge in silhouette, not just color. The combination is unique:
`model-cache.test.ts` lints that within every shared-body cohort no two heroes resolve
to the same kit + proportions, and that every cohort hero resolves a non-empty kit, so
"two heroes render as the same coloured body" is now a test failure rather than a
known compromise. The polished KayKit base is kept as the body (a clean authored mesh
beats a crude generated humanoid); the kit is additive, headless, and ships no assets.

Worst offenders (heroes whose Dota silhouette is strongly non-humanoid): **Phase 6
closed the long-tail.** The only heroes still on a humanoid base are genuinely
bipedal-humanoid, where a polished KayKit body beats a crude generated one:

- `faceless-void` stays on `knight` — a bipedal alien reads acceptably as armored
  melee, and no shipped creature base is a closer silhouette (documented compromise).
- `pangolier` moved `knight → rogue` — a rapier swashbuckler reads as a rogue.
- `bloodseeker` moved `rogue → barbarian` — a feral melee brute, not a ranger.

Everything strongly non-humanoid now rides an animated creature/generated base:

- Mage cohort: `necrophos` → `ghost` (floating reaper), `natures-prophet` → `treant`
  (forest avatar). `winter-wyvern`, `death-prophet`, `outworld-destroyer`,
  `arc-warden`, `razor` were already moved.
- Barbarian cohort: `alchemist` → `abomination` (the brute body reads as his ogre
  mount), `slark` → the new generated `fishman` family. `pudge`/`undying` already on
  `abomination`.
- Knight cohort: `slardar` → `fishman`. `clockwerk`/`timbersaw` already on `goblin`.
- New generated `fishman` family (`creeps/fishman.glb`): bipedal fish-man with finned
  forearms, jutting jaw, dorsal crest, side-set eyes — serves `slardar` + `slark`.

### 2.2 Creature-base heroes — faithfulness is good, a few stretch

These reuse vendored Quaternius creeps (DL-CC0) as shared bodies via `heroBaseUrl`.

| Base GLB | Heroes | Read | Verdict |
|---|---|---|---|
| `spider` | broodmother, weaver, nyx-assassin | arachnid/bug | ✓ |
| `dragonevolved` | jakiro, viper, puck | dragon | all ✓ |
| `demon` | doom, shadow-demon, shadow-fiend, night-stalker, terrorblade, visage | demon/winged-fiend | all ✓ (visage = gargoyle, close) |
| `wolf` | lycan | werewolf | ✓ |
| `giant` | primal-beast | huge brute beast | ✓ (the old stale "Sea leviathan / crab base" comment above this mapping was removed — Phase 0) |
| `golelingevolved` | tiny, elder-titan, earth-spirit | rock/earth elemental | all ✓ |
| `goblin` | techies, gyrocopter fallback, tinker, clockwerk, timbersaw | goblin/keen tinkerer/mech | ✓; gyrocopter now has a generated bespoke body |
| `velociraptor` | venomancer, snapfire fallback | reptile/lizard | venomancer ✓; snapfire now has a generated lizard-mount + rider body |
| `bull` | spirit-breaker | horned charger | ✓ |
| `centaur` | centaur-warrunner | horse-torso centaur | ✓ |
| `energy` | arc-warden, outworld-destroyer, razor | energy construct | ✓ |
| `abomination` | pudge, undying | bloated undead/brute | ✓ |
| `crab` (`crabenemy.glb`) | tidehunter | aquatic crustacean | leviathan/fish-man → crab is a fair aquatic stand-in |
| `bear` (CUSTOM-GEN) | ursa | bear | ✓ |
| `treant` (CUSTOM-GEN) | treant-protector | walking tree | ✓ |
| `ghost` | spectre | spectral | ✓ |

### 2.3 Bespoke hero downloads (DL) — preferred over shared base

These four mount through `heroAssetEntry` *before* the shared base, because the shared
stand-in read too generic. The old static downloads are retired; all four live entries
are generated animated bodies:

| Hero | GLB | Source | Silhouette | Animation |
|---|---|---|---|---|
| `tusk` | generated walrus-man | us | walrus-man ✓ | ✓ animated |
| `hoodwink` | generated squirrel archer | us | squirrel ✓ | ✓ animated |
| `gyrocopter` | generated gyro + pilot | us | gyro ✓ | ✓ animated |
| `snapfire` | generated lizard mount + rider | us | mount + rider ✓ | ✓ animated |

These close the static-body regression while keeping the optional-assets fallback.

### 2.4 Holdouts (CUSTOM-GEN) — reduced to the abstract set

4 heroes ship generated abstract art (`holdouts/<id>.glb` signature +
`holdouts/replacements/<id>.glb` animated). These stay generated because their source
forms are abstract.

| Holdout | Source form | Procedural defensible? | Better-asset opportunity |
|---|---|---|---|
| `io` | wisp / orb of energy | **Yes** — genuinely abstract | keep generated |
| `enigma` | void / eldritch mass | **Yes** | keep generated |
| `morphling` | living water | **Yes** | keep generated |
| `ancient-apparition` | floating ice spirit | **Yes** | keep generated |
| `leshrac` | tormented horned mage | moved | `demon` base |
| `phoenix` | fire bird | moved | `flier.glb` |
| `batrider` | rider on a flying bat | moved | `flier.glb` |
| `naga-siren` | serpent-woman | moved | `serpent.glb` |
| `medusa` | gorgon (snake body) | moved | `serpent.glb` |
| `lone-druid` | druid + spirit bear | moved | `bear.glb` |
| `bane` | nightmare fiend | moved | `demon` base |

`naga-siren`, `medusa`, `lone-druid`, `phoenix`, `batrider`, `leshrac`, and `bane`
have moved off generated holdouts onto animated bases.

---

## 3. Creeps

Every creep has an explicit `CREATURE_BY_ID` mapping, so `CREATURE_BY_BUILD` only ever
catches **summoned minions** (build `biped` → `goblin`) and any future unmapped creep.

### 3.1 Resolved creep → GLB table

| Creep | Maps to | Family read | Faithful? |
|---|---|---|---|
| kobold, kobold-foreman | `goblin` | small humanoid | ⚠ kobolds are ratty miners; passable |
| hill-troll | `tribal` | troll/caster family | ✓ |
| vhoul-assassin | `skeleton` | undead | ✓ downloaded CC0 skeleton |
| gnoll-assassin | `gnoll` | hyena-folk | ✓ generated gnoll |
| satyr-banisher, satyr-mindstealer | `demon` | horned fiend | ✓ |
| prowler-shaman, prowler-acolyte | `demon` | horned fiend | ✓ landed — matches the satyr family (3.2-A) |
| hellbear | `bear` | bear | ✓ |
| wildwing, wildwing-ripper, enraged-wildkin | `owlbear` | owlbear | ✓ generated winged bear |
| polar-furbolg | `bear` | bear-folk | ✓ |
| harpy-stormcrafter, harpy-scout | `flier` | winged | ✓ |
| granite-golem, rock-golem, mud-golem | `golelingevolved` | rock golem | ✓ |
| frostbitten-golem | `golelingevolved` | frost golem | ✓ |
| ghost, fell-spirit | `ghost` | spectre | ✓ |
| alpha-wolf, giant-wolf | `wolf` | wolf | ✓ |
| ice-shaman, dark-troll, dark-troll-summoner | `tribal` | shaman/voodoo | ✓ |
| ogre-frostmage | `orcenemy` | ogre/orc caster | ✓ |
| centaur-courser, centaur-conqueror | `centaur` | horse-torso centaur | ✓ |
| thunderhide, ancient-thunderhide | `bull` | horned beast | ✓ |
| ogre-bruiser | `orcenemy` | orc brute | ✓ (deliberately split from `orc`) |
| ogre-magi-large | `orc` | orc brute | ✓ |
| black-dragon | `dragonevolved` | dragon | ✓ |
| elder-jungle-stalker | `wolf` | predator | ✓ |
| *(any summon minion)* | `goblin` (via build) | small humanoid | ⚠ all summons read as goblins (3.3) |

### 3.2 Family-consistency flags

**A. Satyr family is unified — landed.** All four satyrs share `demon`:
`satyr-banisher`, `satyr-mindstealer`, and (since the fix) `prowler-shaman` +
`prowler-acolyte`, which were on `tribal`. Prowlers *are* satyrs in WC3/Dota, so they
now read as the same horned-fiend family.

**B. Ogre family settled on orc variants — landed.** `ogre-bruiser` → `orcenemy`,
`ogre-magi-large` → `orc`, and `ogre-frostmage` → `orcenemy` (moved off the outlier
`tribal`). The orc/orcenemy split is the intended "not all identical orc" choice; all
three now read as the ogre/orc family rather than splitting a caster off to `tribal`.

**C. Troll family is unified.** `hill-troll`, `dark-troll`, and `dark-troll-summoner`
all resolve to `tribal`.

**D. `frostbitten-golem` → `golelingevolved` is landed.** It now shares the golem
family with granite/rock/mud.

**E. `polar-furbolg` → `bear` is landed.** Furbolgs now share the bear family.

### 3.3 Summon minions all read as goblins

The two named summoners now have explicit family rows — landed:
`dark-troll-summoner-minion` → `tribal` and `prowler-shaman-minion` → `demon`, so their
adds read as the summoner's family rather than a generic goblin. Only the generic
`creep()` summon path (minions with `silhouette.build: 'biped'` and an id not in
`CREATURE_BY_ID`) still falls through to `CREATURE_BY_BUILD.biped → goblin`, which is
the intended small-humanoid floor for unnamed summons.

### 3.4 Faithfulness flags (creeps)

- `vhoul-assassin` → `skeleton`: landed with downloaded CC0 skeleton.
- `gnoll-assassin` → `gnoll`: landed with generated gnoll.
- `centaur-courser` / `centaur-conqueror` → `centaur`: landed with generated centaur.

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
| **3D held GLB** | signature weapon mounted on the hero's hand socket when equipped | 13 | CUSTOM-GEN (tapered blades, ellipsoid cores/gems, round parts) | rides the hero rig — static mesh is fine | `weapons/items/*.glb`, `itemWeaponGlbUrl` + `attachSignatureItemWeapon` |
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
- **Faithfulness:** good for the marquee tier — the Phase 5 pass gives the key items
  clearer authored silhouettes (sun-blade = radiance, hex-scythe = scythe-of-vyse,
  frost-orb scepter = eye-of-skadi, storm hammer = mjollnir).
- **Coverage:** only 13 of ~150 items have a 3D model. This is **by design** (ASSET_GAPS
  P3: most items stay procedural/UI). But several weapon-core artifacts that *would*
  read well as held models have none — candidates if the tier ever expands:
  `crystalys`, `diffusal-blade`, `maelstrom`, `silver-edge`, `echo-sabre`, `nullifier`,
  `skull-basher`, `ethereal-blade`, `dagon`, `meteor-hammer`, `heavens-halberd`.

Upgrade status: **Phase 5 landed and closed.** The marquee 13-weapon set is the
shipping target; broader item coverage is intentionally out of scope by design
(ASSET_GAPS P3 — most items stay procedural/UI), not a backlog. The candidate list
above is a note for *if* the tier ever expands, not pending work.

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

### 5.4 Hero default weapons (65, CUSTOM-GEN)

`weapons/heroes/*.glb` — generated default hand weapons for the remaining humanoid
KayKit cohorts, one per hero. Motion-correct (ride the hero rig). They remain the main
per-hero identity signal within a shared-body cohort.

---

## 6. Prioritized actions

### A0. Fix the static body GLBs (animation regression) — landed

`tusk`, `hoodwink`, and `gyrocopter` now ship generated animated bespoke bodies with
idle/run/attack/cast/death. The old static downloads are retired, and `assets:check`
now fails body GLBs that lack idle + locomotion clips.

### A. Remap holdouts onto existing better assets (no download needed)

Highest value, zero new assets. These have landed:

| Hero | From | To | Asset exists? |
|---|---|---|---|
| `naga-siren` | generated holdout | `serpent.glb` | ✓ landed |
| `medusa` | generated holdout | `serpent.glb` | ✓ landed |
| `lone-druid` | generated holdout | `bear.glb` | ✓ landed |
| `phoenix` | generated holdout | `flier.glb` | ✓ landed |
| `batrider` | generated holdout | `flier.glb` | ✓ landed |
| `bane` | generated holdout | `demon.glb` | ✓ landed |
| `leshrac` | generated holdout | `demon.glb` | ✓ landed |

All five targets (`serpent`, `bear`, `flier`) are animated, so this is animation-safe —
it swaps generated abstract art for a faithful *and* animated body.

`io`, `enigma`, `morphling`, and `ancient-apparition` stay generated because they are
genuinely abstract.

### B. Fix creep family consistency (mapping-only edits in `CREATURE_BY_ID`) — landed

1. `prowler-shaman`, `prowler-acolyte`: `tribal` → `demon`.
2. `frostbitten-golem`: `yeti` → `golelingevolved`.
3. `polar-furbolg`: `yeti` → `bear`.
4. `ogre-frostmage`: `tribal` → `orcenemy`.
5. `wildwing`/wildkin: `bear` → `owlbear`.

### C. Fix the stale code comment — landed

The `src/engine/assets.ts` comment above `giant: ['primal-beast']` used to reference a
"Sea leviathan" / crab base (which describes `tidehunter`, not `primal-beast`). It was
removed in Phase 0; the line now reads "giant is the closest shipped base."

### D. Download targets (any CC / permissive, incl. NC/SA) for the worst faithfulness gaps

**Every candidate must ship idle + a locomotion clip; reject static meshes.**

| Need | For | Note |
|---|---|---|
| animated walrus | `tusk` | landed as generated body |
| animated squirrel/rodent | `hoodwink` | landed as generated body |
| animated gyro/helicopter | `gyrocopter` | landed as generated body |
| scorpion (animated) | `sand-king` | landed as generated body |
| centaur (animated) | centaur-courser/conqueror, centaur-warrunner | landed as generated body |
| gnoll / hyena-beast (animated) | `gnoll-assassin` | landed as generated body |
| skeletal/undead rogue (animated) | `vhoul-assassin` | landed as downloaded CC0 skeleton |
| owlbear / winged bear (animated) | wildkin/wildwing | landed as generated body |

### E. Replace generated creature families with better downloads (optional)

`creeps/{flier,bear,treant}.glb` are serviceable generated originals. If a better CC0
winged creature, bear, or treant turns up, swap it in — they back several creeps and
heroes, so the upgrade propagates widely.

### F. Item + hero weapons (CUSTOM-GEN) — part of the bar (Phase 5 required)

- 13 item weapon GLBs: **done**. Phase 5 polish added tapered blades, ellipsoid
  gems/cores, higher-segment round parts, and stronger silhouettes for the marquee
  artifacts.
- Hero default weapons: **done** (Phase 4 Tier A). Every humanoid-cohort hero carries a
  per-hero signature weapon shape (`STYLE_BY_HERO` + per-style geometry), so cohort-mates
  diverge by weapon silhouette + palette. Keep it covered by tests.
- 2D item icon sprites (game-icons.net): no action except keep the **CC-BY attribution**
  shipped in `ASSETS.md` + `CREDITS.md`. Don't strip it.
- Procedural glyph/portrait floor: leave as-is; it's the empty-assets boot floor.

---

## 7. Tooling note: manifest now records machine-readable provenance — landed

`public/assets/manifest.json` populates a `source` for **every** file via
`build_assets.mjs` (`inferredSource`), so the manifest can now answer "which GLBs are
custom?" on its own — no entry is `null`. Generated families read `"generated in-repo:
<generator>"`, vendored creeps `"Quaternius creature pack — CC0"`, the KayKit cohorts
`"KayKit Adventurers … retexture by us — CC0"`, and the game-icons item/status sprites
`"game-icons.net … — CC BY 3.0"`. `ASSETS.md` remains the human-readable ledger, but
this audit (DoD #5) can now be regenerated from the manifest instead of by hand.

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

### Phase 0 — Guardrails (landed)

The bar is locked so fixes cannot regress.

- `assets:check` validates body animation: any GLB under `heroes/`, `creeps/`, or
  `holdouts/replacements/` must expose idle + locomotion clips (held weapons exempt).
- `data-lint.test.ts` and `model-cache.test.ts` pin the family remaps and disabled
  static-body replacement behavior.
- `manifest.json` `source` is populated by `build_assets.mjs`.
- The stale `primal-beast` comment was removed.
- **Exit:** gates green; the lints fail loudly if a later phase breaks the bar.

### Phase 1 — Zero-download consistency wins (landed)

All targets already shipped and animated; these were pure `assets.ts` edits.

- Remapped animal-shaped holdouts onto animated families: `naga-siren`,`medusa`→`serpent`;
  `lone-druid`→`bear`; `phoenix`,`batrider`→`flier`; `bane`,`leshrac`→`demon`.
- Creep family fixes landed: prowlers→`demon`; `frostbitten-golem`→`golelingevolved`;
  `polar-furbolg`→`bear`; `ogre-frostmage`→`orcenemy`.
- Summoned minions now have sensible family rows for dark-troll and prowler summons.
- **Exit:** family lint passes; holdout set is down to the 4 truly abstract heroes.

### Phase 2 — Kill the static-body regressions (landed)

`tusk`, `hoodwink`, and `gyrocopter` now ship generated animated bespoke bodies.
`assets:check` passes with zero static body exemptions.

### Phase 3 — Faithfulness downloads (close the species gaps)

Replace the "closest available" stand-ins with faithful, animated creatures.

- Landed with generated bodies: scorpion (`sand-king`), centaur (centaur creeps +
  `centaur-warrunner`), gnoll/hyena (`gnoll-assassin`), and owlbear/wildkin.
- Landed with downloaded CC0 art: skeleton (`vhoul-assassin`).
- **Exit:** every original Phase 3 species gap is either faithful or explicitly
  justified in code.

### Phase 4 — Hero silhouette identity (largest effort) — landed

The 65 same-body cohort heroes (Section 2.1) were the biggest remaining unfaithfulness.
Rather than ship 65 crude full bodies, this phase makes each hero diverge in silhouette
on top of the polished shared base.

- **Tier A (cheap, high value) — landed:** the generated hero weapon set (Section 5.4)
  now carries a per-hero signature shape (`STYLE_BY_HERO` + per-style geometry in
  `generate_hero_weapons.mjs`), so cohort-mates diverge by weapon silhouette + palette,
  not palette alone. Pinned by tests.
- **Tier B (mapping edits, animated bases) — landed for the clearest reads:** the worst
  non-humanoid cohort offenders now ride animated creature/generated bodies —
  `winter-wyvern`→`dragonevolved`, `clockwerk`/`timbersaw`→`goblin`,
  `death-prophet`→`ghost`, `arc-warden`/`outworld-destroyer`/`razor`→`energy`, and
  `pudge`/`undying`→`abomination`.
- **Tier C (silhouette kits) — landed:** every cohort hero now resolves a distinct
  additive silhouette kit (head / back / shoulder / jaw / aura / accent) + per-hero
  proportions over the shared body (`heroSilhouetteKit` + `applyAuthoredSilhouette` in
  `engine/models.ts`), so cohort-mates diverge in body read, not just weapon + color.
  Per-cohort uniqueness and non-empty coverage are pinned by `model-cache.test.ts`.
- **Exit:** no hero whose Dota silhouette is strongly non-humanoid is stuck on a plain
  humanoid base, and no two heroes in a shared-body cohort render as the same body.

### Phase 5 — Item + weapon polish (landed)

The held layer has to read as authored too, so this is part of the production bar.
Phase 5 now covers both item-weapon polish and the hero side.

- The generated item-weapon generator now gives the marquee artifacts recognizable
  silhouettes called out in §5.1 (scythe, hammer, orb, sun).
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

| Need | For | Phase | Status |
|---|---|---|---|
| animated walrus | `tusk` | 2 | generated body landed |
| animated squirrel/rodent | `hoodwink` | 2 | generated body landed |
| animated gyrocopter/helicopter | `gyrocopter` | 2 | generated body landed |
| animated scorpion | `sand-king` | 3 | generated body landed |
| animated centaur | centaur creeps, `centaur-warrunner` | 3 | generated body landed |
| animated gnoll/hyena | `gnoll-assassin` | 3 | generated body landed |
| animated skeletal/undead rogue | `vhoul-assassin` | 3 | downloaded CC0 skeleton landed |
| animated owlbear / winged bear | wildkin/wildwing | 3 | generated body landed |
| animated creature bodies for Tier-B heroes | §2.1 offenders | 4 | generated/shared bases landed for the worst offenders |
| animated fish-man | `slardar`, `slark` | 6 | generated `fishman` family landed |
| brute body for the ogre-mount hero | `alchemist` | 6 | shares the generated `abomination` body |

### Sequencing summary

| Phase | Work | Downloads | Effort | Status |
|---|---|---|---|---|
| 0 | guardrails + lints + comment | none | S | landed |
| 1 | holdout remaps + creep family fixes | none | S | landed |
| 2 | fix 3 static bodies | none | M | landed with generated bodies |
| 3 | faithfulness species bodies | 1 download + generated bodies | M | landed |
| 4 | hero identity (weapons + worst offenders + silhouette kits) | generated/shared bodies | L | landed |
| 5 | item/weapon polish (required) | none | M | landed |
| 6 | long-tail hero identity | generated `fishman` + shared/remap | M | landed |
| 7 | per-hero silhouette kits + creature-mesh vetting | none | M | landed |

Run the gates after every asset batch: `npm run assets:check && npm run typecheck &&
npm test && npm run build`. Phases 0–7 are landed for the required production bar.

**Phase 6 (long-tail hero identity) — landed.** Every strongly non-humanoid hero now
rides an animated creature/generated base: `natures-prophet → treant`,
`necrophos → ghost`, `meepo → goblin`, `alchemist → abomination` (brute body reads as
his ogre mount), and `slardar` + `slark` → the new generated `fishman` family. The
three heroes still on a humanoid base are genuinely bipedal — `faceless-void` (knight,
documented), `pangolier` (moved to rogue), `bloodseeker` (moved to barbarian) — where a
polished KayKit body is more faithful than a crude generated one.

**Phase 7 (silhouette kits + creature-mesh vetting) — landed.** The shared-body cohort
sameness is closed: each cohort hero now wears a distinct additive silhouette kit (§2.1)
over the shared base, lint-pinned for per-cohort uniqueness. The orphaned holdout GLBs
were removed — `generate_holdout_signatures.mjs` and `holdouts/**` now hold exactly the
4 genuinely abstract holdouts (io, enigma, morphling, ancient-apparition), 8 files.

Creature-mesh upgrades were **attempted and vetted, not deferred**: the Poly Pizza /
Quaternius CC0 catalog was searched for animated replacements of the generated families
(`bear`, `scorpion`, `treant`, `gnoll`, `owlbear`, `centaur`, `fishman`, etc.). The
matching meshes are **static** (no idle/locomotion clips) and CC-BY, which the mandatory
animation gate rejects as a regression; the few animated CC0 finds (e.g. a Quaternius
yeti / flier) are not faithful wins for these species. The generated families are
therefore the **confirmed production art**, not interim stand-ins — there is no open
download backlog. Re-run the vetting only if a new animated CC0 creature for one of
these species appears.
