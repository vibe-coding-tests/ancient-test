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
| `creeps/{flier,bear,treant}.glb` | 3 | `generate_creature_families.mjs` | Carry real gameplay reads (harpies, ursa/hellbear, treant-protector); low-poly originals, would benefit from authored creatures |
| `holdouts/{...}.glb` + `holdouts/replacements/{...}.glb` | 22 | `generate_holdout_signatures.mjs` | The 11 abstract heroes (io, enigma, morphling, bane, ancient-apparition, leshrac, phoenix, naga-siren, medusa, batrider, lone-druid). **Lowest fidelity in the game** — highest upgrade value |
| `weapons/heroes/<id>.glb` | 80 | `generate_hero_weapons.mjs` | One generated weapon per humanoid hero; fine as a floor, low priority |
| `weapons/items/<id>.glb` | 13 | `generate_item_weapons.mjs` | Marquee artifact weapons; generated shapes, see §5 |

Everything else (heroes, creeps, towns, ambient) is CC0/CC-BY art, not custom.

---

## 2. Heroes (122)

Recruit NPCs are not a separate art set: they render the hero they become through
`Unit.renderHeroId`, so every NPC verdict equals its hero verdict.

### 2.1 Humanoid cohorts (80) — KayKit, retexture-only

Four base bodies serve all 80: Knight (17), Mage (30), Barbarian (15), Rogue (18).
Within a cohort the **only** differentiation is palette + the generated hand weapon
— the silhouette is identical. This is the single biggest faithfulness limitation
in the game: every mage shares one robe-and-staff body, every knight one armored
body. Most heroes read fine; the table below flags the members whose silhouette
fights their cohort and are the best reskin/remap targets.

| Cohort | Body | Fits well (sample) | Poor silhouette fit (reskin/remap targets) |
|---|---|---|---|
| knight (17) | armored melee | juggernaut, sven, dragon-knight, wraith-king, mars, omniknight | `timbersaw` (sawblade mech, not a knight), `clockwerk` (mech suit), `faceless-void` (void alien), `pangolier` (reads rogue), `slardar` (fish-man) |
| mage (30) | robed caster | crystal-maiden, lina, lich, invoker, zeus, rubick | `winter-wyvern` (**is a dragon** — see §4), `razor` (faceless lightning elemental), `arc-warden` (energy construct), `outworld-destroyer` (floating astral being) |
| barbarian (15) | brute | pudge, axe, earthshaker, beastmaster, huskar, magnus | `slark` (small slippery naga, not a brute), `alchemist` (rides an ogre — body should be the mount), `undying` (flesh-zombie reads ok but not barbarian) |
| rogue (18) | agile / ranged | sniper, drow-ranger, mirana, phantom-assassin, clinkz, luna | `meepo` (small ratty geomancer), `bloodseeker` (feral, not a ranger) |

> No new mapping fixes the cohort sameness — that needs either more CC0 humanoid
> base variety (so e.g. mechs and elementals get their own silhouette) or authored
> per-hero meshes. Track as the long-pole reskin effort.

### 2.2 Creature-base heroes (31) — shared Quaternius creep GLBs

These reuse a vendored creep GLB as the hero body (`heroBaseUrl` → `/assets/creeps/`).

| Base GLB | Heroes | Verdict |
|---|---|---|
| `spider` | broodmother, weaver, nyx-assassin, sand-king | ✅ broodmother. ◑ weaver/nyx (insectoid), sand-king (scorpion read as spider) |
| `dragonevolved` | jakiro, viper, puck | ◑ jakiro loses its twin head; viper good; puck should read smaller/whimsical |
| `demon` | doom, shadow-demon, shadow-fiend, night-stalker, terrorblade, visage | ✅ doom/shadow-fiend/terrorblade. ◑ night-stalker, visage (gargoyle) |
| `wolf` | lycan | ✅ werewolf |
| `giant` | primal-beast | ◑ humanoid giant for an ape-beast; acceptable |
| `golelingevolved` | tiny, elder-titan, earth-spirit | ✅ tiny. ◑ elder-titan, earth-spirit |
| `goblin` | techies, tinker | ✅ techies (goblin squad), tinker (keen inventor) |
| `velociraptor` | venomancer | ◑ raptor-as-reptile, acceptable |
| `bull` | spirit-breaker, centaur-warrunner | ✅ spirit-breaker. ⚠ centaur-warrunner (bull ≠ horse-torso; wants a real centaur) |
| `crab` (`crabenemy.glb`) | tidehunter | ◑ aquatic read for a kraken/leviathan |
| `bear` | ursa | ✅ |
| `treant` | treant-protector | ✅ |
| `ghost` | spectre | ✅ |
| `fox` | hoodwink | ✅ **live fallback** — the bespoke squirrel (§2.3) was static and is disabled, so hoodwink rides the animated `fox` body. `fox.glb` also backs ambient life |
| `yeti` | tusk | ✅ **live fallback** — the bespoke walrus (§2.3) was static and is disabled, so tusk rides the animated `yeti` body |

### 2.3 Bespoke downloads — Poly Pizza, override the shared base

These mount through `heroAssetEntry` before the creature-base fallback. **Animation is
the gate (ASSET_MAPPING_AUDIT Phase 2): a static body download never ships over an
animated shared base.** Only `snapfire` (animated) is live; the three static downloads
are disabled and their heroes fall back to an animated shared base until an animated
replacement is found.

| Hero | GLB | Read vs original | Status |
|---|---|---|---|
| `snapfire` | velociraptor mount (Quaternius, CC0) | ◑ stands in for her lizard mount Mortimer, not Snapfire herself | ✅ **live** — animated (idle/run/attack/death); the gnome rider is missing |
| `tusk` | walrus (Poly by Google, CC BY) | ✅ tusk is a walrus-man | ✗ **disabled** — static; falls back to the animated `yeti` body |
| `hoodwink` | squirrel (Poly by Google, CC BY) | ✅ hoodwink is a forest squirrel | ✗ **disabled** — static; falls back to the animated `fox` body |
| `gyrocopter` | helicopter (kazuma, CC0) | ◑ vehicle reads, but static (no rotor/pilot) | ✗ **disabled** — static; falls back to the animated `goblin` body |

### 2.4 Holdouts (11) — generated, abstract

io, enigma, morphling, bane, ancient-apparition, leshrac, phoenix, naga-siren,
medusa, batrider, lone-druid. All carry generated signature + replacement GLBs.
These are intentionally abstract (orbs, elementals, no-legs forms), but they are
the **lowest-fidelity models in the game**. Best targets for authored downloads —
especially `phoenix` (bird), `naga-siren` (serpent — could share `serpent.glb`),
`medusa` (gorgon — also serpent-family), and `batrider` (flier — could share
`flier.glb`).

---

## 3. Creeps & summons

Resolved by `creepCreatureUrl(creepId, build)`: specific id wins, else the
silhouette `build` picks an archetype. All 24 creep GLBs are referenced.

### 3.1 Explicit id mappings (`CREATURE_BY_ID`)

| Creep id(s) | GLB | Verdict |
|---|---|---|
| `ghost`, `fell-spirit` | `ghost` | ✅ |
| `alpha-wolf`, `giant-wolf` | `wolf` | ✅ |
| `polar-furbolg` | `yeti` | ◑ furbolg is a bear-man; `bear` now exists and may read closer |
| `frostbitten-golem` | `yeti` | ⚠ it is a **golem** — inconsistent with the other golems below; yeti only chosen for the frost color |
| `granite-golem`, `rock-golem`, `mud-golem` | `golelingevolved` | ✅ |
| `black-dragon` | `dragonevolved` | ✅ |
| `hellbear` | `bear` | ✅ |
| `hill-troll` | `orc` | ⚠ a troll mapped to orc, while `dark-troll` → `tribal` — pick one troll family |
| `kobold`, `kobold-foreman`, `gnoll-assassin`, `vhoul-assassin` | `goblin` | ◑ small humanoids; gnoll (hyena) is a stretch |
| `satyr-banisher`, `satyr-mindstealer` | `demon` | ✅ goat-demons |
| `harpy-stormcrafter`, `harpy-scout` | `flier` | ✅ |
| `wildwing`, `wildwing-ripper`, `enraged-wildkin` | `bear` | ◑ owlbears — bear loses the wings/owl head |
| `ice-shaman`, `ogre-frostmage`, `prowler-shaman`, `prowler-acolyte`, `dark-troll`, `dark-troll-summoner` | `tribal` | ◑ mixed humanoid casters; reasonable catch-all |
| `centaur-courser`, `centaur-conqueror` | `bull` | ⚠ centaurs on a bull body (same issue as centaur-warrunner) |
| `thunderhide`, `ancient-thunderhide` | `bull` | ✅ |
| `elder-jungle-stalker` | `stag` | ⚠ "stalker" implies a predator; `stag` (antlered deer) reads as prey — only consumer of `stag.glb` |
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
| `bird` | `velociraptor` | ⚠ grounded raptor for "bird"; `flier.glb` reads airborne and may fit better |
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
| 8 | **Owlbears lose wings** | `bear` | Needs an owlbear/winged-bear GLB | Download |
| 9 | **Static bespoke bodies disabled** | `tusk`/`hoodwink`/`gyrocopter` static downloads | Keep disabled; ride the animated `yeti`/`fox`/`goblin` bases until an animated download exists | ✅ done |

Items 1–7 and 9 have landed (free table edits / generated families). Only item 8
(owlbear) still needs new art.

---

## 5. Item weapons (13) — all generated

`abyssal-blade`, `battlefury`, `bloodthorn`, `butterfly`, `daedalus`, `desolator`,
`divine-rapier`, `eye-of-skadi`, `mjollnir`, `monkey-king-bar`, `radiance`,
`satanic`, `scythe-of-vyse`. Mapped by `itemWeaponGlbUrl`; override the hero's hand
weapon when equipped, with each item's procedural `appearance.weapon` as the floor.

All 13 are custom generator output. Smoothing them so they read as authored shapes (not
raw primitive assemblies) is **required**, not optional — it is Phase 5 of the
ASSET_MAPPING_AUDIT production plan, part of the production bar. Shape-recognizability
priority (icons are distinct via game-icons.net, the held GLBs are not): `scythe-of-vyse`
(scythe), `mjollnir` (hammer), `eye-of-skadi` (orb), `radiance` (sun) — these have the
most recognizable real-world silhouettes and benefit most from authored meshes.
*Coverage* stays by design: only the marquee artifacts get a 3D GLB; all other items
remain procedural/UI-only unless one reads as a visual miss.

---

## 6. Action backlog

Grouped by effort. Remaps are table edits in `src/engine/assets.ts`; downloads add
a row to `scripts/assets/specs/` and `ASSETS.md`.

**Remap now (free, no new asset) — landed:**
- `winter-wyvern` → `dragonevolved` ✅
- `elder-jungle-stalker` → `wolf` ✅
- unify troll family (`hill-troll` → `tribal`) ✅
- `frostbitten-golem` → `golelingevolved` ✅; ogre family settled (`ogre-bruiser`/
  `ogre-frostmage` → `orcenemy`, `ogre-magi-large` → `orc`) ✅
- `bird` build → `flier` ✅
- Phase 4 cohort offenders: `clockwerk`/`timbersaw` → `goblin`, `death-prophet` → `ghost` ✅
- `fox`/`yeti` cohort entries **kept** as the animated fallback for the disabled static
  `hoodwink`/`tusk` bespokes (see §2.3) — not retired ✅

**Reskin (recolor / retexture pass):**
- Worst within-cohort silhouette fits (§2.1) — interim palette/weapon tuning until
  more base variety exists.

**Generate better (landed) / download (needs new art):**
- Holdouts onto in-repo families ✅: `phoenix`/`batrider` → `flier`, `naga-siren`/
  `medusa` → `serpent`, `lone-druid` → `bear`, `bane`/`leshrac` → `demon`. The four
  truly abstract holdouts (`io`, `enigma`, `morphling`, `ancient-apparition`) stay generated.
- Generated families ✅: centaur body (hero + 2 creeps), gnoll, scorpion (`sand-king`);
  downloaded CC0 skeleton (`vhoul-assassin`).
- Per-hero hero-weapon shapes ✅ (Phase 4 Tier A).
- **Required (Phase 5):** smooth the marquee item weapons to recognizable silhouettes
  (scythe, hammer, orb, sun).
- Still needs new art: owlbear body (wildkin), animated walrus/squirrel/gyrocopter to
  re-enable the disabled bespokes, snapfire rider.
- Long pole: humanoid-cohort silhouette variety (more elementals, dragon-mage, etc.).

**Verification (run after any asset batch):**

```sh
npm run assets:check
npm run typecheck
npm test
npm run build
```
