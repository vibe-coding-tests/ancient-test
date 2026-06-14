# Asset Remap & Reskin Spec

A working audit of every GLB we map to a unit — heroes, recruit NPCs, creeps,
summons, ambient life, and item weapons. It exists so we can act on three things:

1. **Remap** — point an id at a better-fitting GLB we already ship (free, just a
   table edit in `src/engine/assets.ts`).
2. **Reskin** — recolor or retexture an existing base for a closer read.
3. **Download / generate** — replace a weak or fully custom stand-in with a better
   GLB under any Creative Commons or permissive license — CC0, CC-BY, or (this being a
   non-commercial project) NonCommercial/ShareAlike too (DECISIONS 2026-06-14); avoid
   only NoDerivatives — or a better generator pass.

Companion docs: `ASSETS.md` (license ledger), `ASSET_GAPS.md` (the closed coverage
audit), `VFX_ASSETS.md` (art direction). The runtime contract is unchanged: assets
are optional, every unit has a procedural floor, and the game must still boot with
`public/assets/` empty.

Source of truth for mappings: `src/engine/assets.ts`
(`HERO_COHORTS`, `CREATURE_BY_ID`, `CREATURE_BY_BUILD`, `CREATURE_BASE_FILE`,
`BESPOKE_HERO_MODEL_ASSETS`, `ITEM_WEAPON_GLB`).

---

## 1. Provenance legend

Every shipped model is one of four kinds. The "custom" column is what the user
asked us to flag — the assets we authored ourselves and could upgrade with a
better download or generator.

| Tag | Meaning | Custom? | Upgrade path |
|---|---|---|---|
| **KayKit** | CC0 KayKit Adventurers base, retextured to a hero palette | Partly — base is CC0, retexture is ours | More base variety, or per-hero meshes |
| **Quaternius** | CC0 Quaternius creature/prop, used as-is | No | Swap for a closer CC0 creature |
| **Download** | Other CC / permissive GLB (CC0, CC-BY, or NC/SA — DECISIONS 2026-06-14), processed in-repo (Poly Pizza, OpenGameArt, etc.) | No | Find a closer-reading download |
| **Generated** | Authored in-repo by a `scripts/assets/*.mjs` generator | **Yes** | Better generator pass, or replace with a download |

### Custom (generated) inventory — the "look for better" list

These are the GLBs we made ourselves. They are the first candidates for a better
download because a generated mesh tends to read more abstract than authored art.

| Files | Count | Generator | Why it's a candidate |
|---|---|---|---|
| `creeps/{flier,bear,treant,scorpion,centaur,gnoll,owlbear,energy,abomination,fishman}.glb` | 10 | `generate_creature_families.mjs` | Animated creature/body families for missing species and cohort fixes (`fishman` added Phase 6 for `slardar`/`slark`); still candidates for authored downloads later |
| `heroes/{gyrocopter,hoodwink,snapfire,tusk}.glb` | 4 | `generate_creature_families.mjs` | Animated generated bespoke bodies that replaced static/generic stand-ins |
| `holdouts/{...}.glb` + `holdouts/replacements/{...}.glb` | 8 | `generate_holdout_signatures.mjs` | The four truly abstract heroes (`io`, `enigma`, `morphling`, `ancient-apparition`) keep generated signature + replacement GLBs |
| `weapons/heroes/<id>.glb` | 65 | `generate_hero_weapons.mjs` | One generated weapon per remaining humanoid KayKit hero; fine as a floor |
| `weapons/items/<id>.glb` | 13 | `generate_item_weapons.mjs` | Marquee artifact weapons; Phase 5 silhouette polish landed, see §5 |

Everything else (heroes, creeps, towns, ambient) is CC0/CC-BY art, not custom.

---

## 2. Heroes (122)

Recruit NPCs are not a separate art set: they render the hero they become through
`Unit.renderHeroId`, so every NPC verdict equals its hero verdict.

### 2.1 Humanoid cohorts (65) — KayKit, retexture-only

Four base bodies serve the remaining 65 humanoid-cohort heroes: Knight (13), Mage
(23), Barbarian (12), Rogue (17). The clearest non-humanoid misses have moved to
animated creature/generated bases.
Within a cohort, differentiation is palette + the generated hand weapon **+ a per-hero
additive silhouette kit** (`heroSilhouetteKit` + `applyAuthoredSilhouette` in
`engine/models.ts`): each hero projects its likeness `features` onto six overlay slots
(head / back / shoulder / jaw / aura / accent) built over the shared base, plus per-hero
proportions. So a crown knight, a winged-helm paladin, a hooded archer, and a
skull-faced mage diverge in silhouette, not just color. `model-cache.test.ts` pins that
no two heroes in a shared-body cohort resolve to the same kit + proportions and that
every cohort hero resolves a non-empty kit. The base mesh stays KayKit (a polished
authored body beats a crude generated humanoid); the kit is additive and headless. The
table below records the members whose *base* fought their cohort and were remapped.

| Cohort | Body | Fits well (sample) | Poor silhouette fit (reskin/remap targets) |
|---|---|---|---|
| knight (13) | armored melee | juggernaut, sven, dragon-knight, wraith-king, mars, omniknight | `faceless-void` (bipedal alien — documented compromise; no closer base). `slardar` → `fishman`, `pangolier` → rogue (Phase 6) |
| mage (23) | robed caster | crystal-maiden, lina, lich, invoker, zeus, rubick | none remaining. `necrophos` → `ghost`, `natures-prophet` → `treant` (Phase 6) |
| barbarian (12) | brute | axe, earthshaker, beastmaster, huskar, magnus, bloodseeker | none remaining. `slark` → `fishman`, `alchemist` → `abomination` brute body (Phase 6); `bloodseeker` pulled in from rogue |
| rogue (17) | agile / ranged | sniper, drow-ranger, mirana, phantom-assassin, clinkz, luna, pangolier | none remaining. `meepo` → `goblin` (Phase 6); `pangolier` pulled in from knight |

> Cohort sameness is closed by the additive silhouette-kit system above, not by new
> base meshes: keeping the polished KayKit body and layering a distinct per-hero kit +
> proportions gives each hero its own read without shipping 65 crude generated bodies.
> Strongly non-humanoid heroes still remap onto animated creature/generated bases.

### 2.2 Creature-base heroes (53 base assignments) — shared creep GLBs

These reuse a vendored, downloaded, or generated creep GLB as the hero body
(`heroBaseUrl` → `/assets/creeps/`). Bespoke heroes still keep these rows as animated
fallbacks behind their generated full-body overrides.

| Base GLB | Heroes | Verdict |
|---|---|---|
| `spider` | broodmother, weaver, nyx-assassin | ✅ broodmother. ◑ weaver/nyx as insectoid stand-ins |
| `scorpion` | sand-king | ✅ generated scorpion restores pincers + arched stinger |
| `dragonevolved` | jakiro, viper, puck, winter-wyvern | ◑ jakiro loses its twin head; viper and winter-wyvern read well; puck stays stylized |
| `demon` | doom, shadow-demon, shadow-fiend, night-stalker, terrorblade, visage, bane, leshrac | ✅ horned/fiendish family; visage remains a gargoyle-like stretch |
| `wolf` | lycan | ✅ werewolf |
| `giant` | primal-beast | ◑ humanoid giant for an ape-beast; acceptable |
| `golelingevolved` | tiny, elder-titan, earth-spirit | ✅ tiny. ◑ elder-titan, earth-spirit |
| `goblin` | techies, gyrocopter fallback, tinker, clockwerk, timbersaw, meepo | ✅ small tinkerer/ratty humanoid family; gyrocopter has a live generated bespoke body |
| `velociraptor` | venomancer, snapfire fallback | ◑ raptor-as-reptile, acceptable; snapfire has a generated mount+rider body |
| `bull` | spirit-breaker | ✅ horned charger |
| `centaur` | centaur-warrunner | ✅ generated horse-torso centaur body |
| `energy` | arc-warden, outworld-destroyer, razor | ✅ generated animated energy construct |
| `abomination` | pudge, undying, alchemist | ✅ generated bloated/brute body; alchemist reads through his ogre mount |
| `fishman` | slardar, slark | ✅ generated bipedal fish-man family |
| `crab` (`crabenemy.glb`) | tidehunter | ◑ aquatic read for a kraken/leviathan |
| `bear` | ursa, lone-druid | ✅ bear family |
| `flier` | phoenix, batrider | ✅ animated winged body |
| `serpent` | naga-siren, medusa | ✅ animated snake/serpent body |
| `treant` | treant-protector, natures-prophet | ✅ walking tree / forest-avatar family |
| `ghost` | spectre, death-prophet, necrophos | ✅ spectral and floating reaper family |
| `fox` | hoodwink fallback | ✅ animated fallback if the generated bespoke squirrel fails; `fox.glb` also backs ambient life |
| `yeti` | tusk fallback | ✅ animated fallback if the generated bespoke walrus fails |

### 2.3 Bespoke generated/downloaded bodies — override the shared base

These mount through `heroAssetEntry` before the creature-base fallback. **Animation is
the gate (ASSET_MAPPING_AUDIT Phase 2): a static body never ships over an animated
base.** The static tusk/hoodwink/gyrocopter downloads are retired; generated animated
bodies are live.

| Hero | GLB | Read vs original | Status |
|---|---|---|---|
| `snapfire` | generated lizard mount + rider | ◑ Mortimer + rider read, still stylized | ✅ live — idle/run/attack/cast/death |
| `tusk` | generated walrus-man | ✅ tusk is a walrus-man | ✅ live — idle/run/attack/cast/death |
| `hoodwink` | generated squirrel archer | ✅ hoodwink is a forest squirrel | ✅ live — idle/run/attack/cast/death |
| `gyrocopter` | generated gyro vehicle + pilot | ✅ vehicle/pilot/rotor read | ✅ live — idle/run/attack/cast/death |

### 2.4 Holdouts (4) — generated, abstract

`io`, `enigma`, `morphling`, and `ancient-apparition` stay generated because their
source forms are genuinely abstract. Former holdouts now ride better animated bases:
`phoenix`/`batrider` → `flier`, `naga-siren`/`medusa` → `serpent`,
`lone-druid` → `bear`, and `bane`/`leshrac` → `demon`.

---

## 3. Creeps & summons

Resolved by `creepCreatureUrl(creepId, build)`: specific id wins, else the
silhouette `build` picks an archetype. The current manifest ships 32 creep GLBs;
combat mappings use the families below, while ambient and fallback files stay
available for scenery or hero fallback.

### 3.1 Explicit id mappings (`CREATURE_BY_ID`)

| Creep id(s) | GLB | Verdict |
|---|---|---|
| `ghost`, `fell-spirit` | `ghost` | ✅ |
| `alpha-wolf`, `giant-wolf` | `wolf` | ✅ |
| `polar-furbolg` | `bear` | ✅ furbolg is bear-folk |
| `frostbitten-golem` | `golelingevolved` | ✅ matches the golem family |
| `granite-golem`, `rock-golem`, `mud-golem` | `golelingevolved` | ✅ |
| `black-dragon` | `dragonevolved` | ✅ |
| `hellbear` | `bear` | ✅ |
| `hill-troll` | `tribal` | ✅ matches the troll family |
| `kobold`, `kobold-foreman` | `goblin` | ◑ small humanoids; passable |
| `gnoll-assassin` | `gnoll` | ✅ generated hyena-folk body |
| `vhoul-assassin` | `skeleton` | ✅ downloaded CC0 undead body |
| `satyr-banisher`, `satyr-mindstealer` | `demon` | ✅ goat-demons |
| `harpy-stormcrafter`, `harpy-scout` | `flier` | ✅ |
| `wildwing`, `wildwing-ripper`, `enraged-wildkin` | `owlbear` | ✅ generated winged bear body |
| `ice-shaman`, `dark-troll`, `dark-troll-summoner` | `tribal` | ✅ shared troll/caster read |
| `ogre-frostmage` | `orcenemy` | ✅ ogre family settled on orc variants |
| `prowler-shaman`, `prowler-acolyte` | `demon` | ✅ matches satyr family |
| `centaur-courser`, `centaur-conqueror` | `centaur` | ✅ generated horse-torso centaur body |
| `thunderhide`, `ancient-thunderhide` | `bull` | ✅ |
| `elder-jungle-stalker` | `wolf` | ✅ predator read |
| `ogre-bruiser` | `orcenemy` | ◑ second orc variant, deliberate de-dupe |
| `ogre-magi-large` | `orc` | ◑ third "ogre" family (with tribal/orcenemy) — spread thin |
| `shadow-shaman-serpent-ward`, `phase3-serpent-ward`, `phase3-naga-image` | `serpent` | ✅ |

### 3.2 Build fallbacks (`CREATURE_BY_BUILD`)

| Build | GLB | Verdict |
|---|---|---|
| `biped` | `goblin` | ◑ generic small humanoid |
| `brute` | `orc` | ✅ |
| `golem` | `golelingevolved` | ✅ |
| `quad` | `wolf` | ✅ |
| `bird` | `flier` | ✅ airborne fallback |
| `blob` | `glubevolved` | ✅ |

---

## 4. Wrong-family & inconsistency callouts (prioritized)

| # | Issue | Current | Proposed | Cost |
|---|---|---|---|---|
| 1 | **winter-wyvern is a dragon in the mage cohort** | `mage` retexture | `dragonevolved` base (shipped) | ✅ done |
| 2 | **elder-jungle-stalker: predator name, prey body** | `stag` | `wolf` (predator read) | ✅ done |
| 3 | **Troll family split** | `hill-troll`→`orc`, `dark-troll`→`tribal` | both → `tribal` | ✅ done |
| 4 | **frostbitten-golem not a golem read** | `yeti` | `golelingevolved` (consistency) | ✅ done |
| 5 | **Ogre family split three ways** | `orc` / `orcenemy` / `tribal` | `orcenemy` (bruiser+frostmage), `orc` (magi-large) | ✅ done |
| 6 | **bird build is grounded** | `velociraptor` | `flier` for airborne creeps | ✅ done |
| 7 | **Centaurs on a bull body** | `bull` (×3 incl. hero) | generated `centaur` family (horse torso) | ✅ done |
| 8 | **Owlbears lose wings** | `bear` | generated `owlbear` family | ✅ done |
| 9 | **Static bespoke bodies disabled** | static `tusk`/`hoodwink`/`gyrocopter` downloads | generated animated bespoke bodies | ✅ done |

Items 1–9 have landed.

---

## 5. Item weapons (13) — all generated

`abyssal-blade`, `battlefury`, `bloodthorn`, `butterfly`, `daedalus`, `desolator`,
`divine-rapier`, `eye-of-skadi`, `mjollnir`, `monkey-king-bar`, `radiance`,
`satanic`, `scythe-of-vyse`. Mapped by `itemWeaponGlbUrl`; override the hero's hand
weapon when equipped, with each item's procedural `appearance.weapon` as the floor.

All 13 are custom generator output. Phase 5 polish has landed: the generator now uses
tapered blade prisms, ellipsoid cores/gems, higher-segment round parts, and stronger
per-item silhouettes. The important reads are covered: `scythe-of-vyse` is a hooked
scythe, `mjollnir` is a storm hammer, `eye-of-skadi` is an orb scepter, and `radiance`
is a sun blade.
*Coverage* stays by design: only the marquee artifacts get a 3D GLB; all other items
remain procedural/UI-only unless one reads as a visual miss.

---

## 6. Action log (all landed)

Grouped by effort; every item below is landed. Remaps are table edits in
`src/engine/assets.ts`; downloads add a row to `scripts/assets/specs/` and `ASSETS.md`.

**Remap now (free, no new asset) — landed:**
- `winter-wyvern` → `dragonevolved` ✅
- `elder-jungle-stalker` → `wolf` ✅
- unify troll family (`hill-troll` → `tribal`) ✅
- `frostbitten-golem` → `golelingevolved` ✅; ogre family settled (`ogre-bruiser`/
  `ogre-frostmage` → `orcenemy`, `ogre-magi-large` → `orc`) ✅
- `bird` build → `flier` ✅
- Phase 4 cohort offenders: `clockwerk`/`timbersaw` → `goblin`, `death-prophet` → `ghost` ✅
- Phase 5 cohort offenders: `arc-warden`/`outworld-destroyer`/`razor` → `energy`,
  `pudge`/`undying` → `abomination` ✅
- Phase 6 long-tail offenders: `natures-prophet` → `treant`, `necrophos` → `ghost`,
  `meepo` → `goblin`, `alchemist` → `abomination` (ogre-mount brute body),
  `slardar`/`slark` → generated `fishman` family ✅
- Phase 6 within-humanoid fits: `pangolier` knight → rogue (swashbuckler),
  `bloodseeker` rogue → barbarian (feral brute) ✅
- `fox`/`yeti` cohort entries **kept** as the animated fallback behind the generated
  `hoodwink`/`tusk` bespokes (see §2.3) ✅

**Reskin / silhouette differentiation — landed:**
- Within-cohort silhouette fits (§2.1) are closed by the additive per-hero silhouette
  kit + proportions over the shared base (`heroSilhouetteKit` + `applyAuthoredSilhouette`),
  lint-pinned for per-cohort uniqueness — not interim tuning.

**Generate better — landed (downloads attempted + vetted, see below):**
- Holdouts onto in-repo families ✅: `phoenix`/`batrider` → `flier`, `naga-siren`/
  `medusa` → `serpent`, `lone-druid` → `bear`, `bane`/`leshrac` → `demon`. The four
  truly abstract holdouts (`io`, `enigma`, `morphling`, `ancient-apparition`) stay generated.
- Generated families ✅: centaur body (hero + 2 creeps), gnoll, scorpion (`sand-king`);
  downloaded CC0 skeleton (`vhoul-assassin`).
- Per-hero hero-weapon shapes ✅ (Phase 4 Tier A).
- **Required (Phase 5):** marquee item weapons polished to recognizable silhouettes ✅
- Former new-art blockers landed as generated animated bodies: owlbear, walrus,
  squirrel, gyrocopter, and Snapfire rider ✅
- Long-tail hero identity closed (Phase 6, see above). The only heroes still on a
  humanoid base are genuinely bipedal — `faceless-void` (knight, documented),
  `pangolier` (rogue), `bloodseeker` (barbarian) — where a polished KayKit body beats
  a crude generated one.
- Cohort sameness closed by silhouette kits (see Reskin section above).
- Holdout cleanup landed: the 14 orphaned GLBs for heroes since moved to creature bases
  were deleted and `generate_holdout_signatures.mjs` trimmed, so `holdouts/**` holds the
  4 abstract holdouts only (8 files).
- External creature-mesh upgrades **attempted and vetted, not deferred**: the Poly Pizza /
  Quaternius CC0 catalog was searched for animated replacements of the generated families
  (`bear`, `scorpion`, `treant`, `gnoll`, `owlbear`, `centaur`, `fishman`, …). The
  matching meshes are static and CC-BY — rejected by the mandatory animation gate as a
  regression — and the animated CC0 finds aren't faithful wins for these species. The
  generated families are therefore the **confirmed production art**, not stand-ins; there
  is no open download backlog. Revisit only if a new animated CC0 creature for one of
  these species appears.

**Verification (run after any asset batch):**

```sh
npm run assets:check
npm run typecheck
npm test
npm run build
```
