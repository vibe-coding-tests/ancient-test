# Ancients

Ancients is a browser-based 3D open-world action RPG that crosses three games into one. It takes the heroes, spells, items, and lore of **Dota 2**, the overworld structure of **Pokémon** (explore, capture, gyms, badges, an Elite ladder), and the loot loop of **Diablo 2** (boss runs, drops, builds), then adds **WoW**-style raids and a **Genshin**-style elemental party layer on top. You walk one continent, recruit a roster, farm gear, and fight on two layers: real-time action combat in the world and 5v5 auto-resolved battles at the gyms.

It runs from `npm run dev` with no game engine. Vite, Three.js, and vanilla TypeScript do all the work. Every hero, item, creep, and region is a plain data file read by generic systems, so most new content is data rather than code. Visuals render from procedural models and generated icons by default, with a glTF asset pipeline ready to drop in higher-fidelity hero models when assets are present.

## What's in the game

The current build is large and playable end-to-end. A new game can run all the way through eight badges, four raid clears, the Elite Five draft, and the Champion fight with no blockers.

**Roster and content**

- **122 heroes**, each with four abilities, a talent tree, a facet, original in-character barks, and a recruitment quest. 19 have Aghanim's upgrades wired in.
- **145 items** with real Dota recipes, passives, and actives, plus **15 neutral items** with a dedicated slot and a Tinker's Bench for rerolls and enchants.
- **36 catchable creeps** across small, medium, large, and ancient tiers, with their real Dota abilities.
- **10 regions** on one continent, gated by badges, each with a town, shop, wild spawns, hero echoes, bosses, and a gym.
- **8 gyms**, an **Elite Five** draft ladder, and a **Champion** fight at the Tower of the Ancients.
- **41 bosses and mini-bosses** with Normal / Nightmare / Hell difficulty tiers and themed loot tables.
- **10 raid bosses**, including Roshan's Pit and cross-universe cameo wings that nod to the genres this game descends from.
- **4 dungeons** with multi-room descents, affixes, and an endless escalating mode with daily and weekly seeds.

**Systems**

- A deterministic, renderer-independent combat core that runs at a fixed 30 Hz. The same core drives both combat layers, so a full 5v5 battle can run to completion inside a unit test in milliseconds.
- **Micro combat**: real-time action in the overworld. One active hero, a party of five, hero swap on `1-5`, and the Diablo loop of farming, boss runs, and drops.
- **Macro combat**: 5v5 gym and Elite battles that auto-resolve on the core. You author a per-hero **gambit** rule list before the fight and spend **Captain Calls** to take direct control for a few seconds at the key moment.
- **Capture and merge**: weaken a creep, channel a Binding Totem, and add it to your collection. Three copies merge into a star upgrade, and you can field up to three caught creeps as an AI entourage. Summoner heroes like Chen and Nature's Prophet turn the overworld into a walk-the-map-with-an-army playstyle.
- **Recruitment**: every hero follows a three-beat chain of Find, Trial, and Bind, with 15 trial kinds (honor duels, stealth hunts, combo exams, faction choices, reputation gates, and more). Losing a Bind relocates the hero rather than failing the quest.
- **Hero echoes**: farmable boss-fragments of every hero. Beating echoes advances recruitment, unlocks talent branches and facet swaps, and pays gold and XP bounties, so duplicates always matter.
- **Loot quality**: items roll a quality grade (Standard, Inscribed, Genuine, Frozen, Corrupted, Unusual) and a rarity tint. An Armory holds bound loot per hero with saveable loadouts, a Black Market sells gated recipes and relics, and salvaged gear becomes essence you spend to upgrade quality.
- **Resonance**: a Genshin-style elemental layer, on by default and reversible to vanilla Dota with one setting. Seven elements apply to enemies, react when they overlap (Vaporize, Melt, Freeze, Superconduct, and others), and a party that shares an element gains a team-wide resonance buff. It runs in the overworld and raids while gyms and the Elite Five stay pure Dota.

**Presentation**

- A Three.js overworld with two camera modes: a tilted map view for travel and an angled follow camera for combat and towns. Press `M` to toggle.
- A PBR rendering path with bloom, ambient occlusion, color grading, and tonemapping, plus a day/night cycle, animated water, and per-biome skies. Quality scales across tiers and can be tuned live in settings.
- Hero-specific likeness overlays, item appearance geometry that wears on the model, and attack-animation overrides that read an item's identity on sight.
- A procedural audio layer that synthesizes per-hero attack, cast, and ability sounds keyed off each ability's sound archetype, with stingers for capture, level-up, merges, and badges.
- A minimap, quest journal, and an encounter-gated codex that fills in as you meet heroes, regions, items, creeps, and raids.

The combat core stays headless: it never imports Three.js or touches the DOM. Over 1,300 headless tests cover data linting, combat determinism, capture and merge, saves and migrations, gym and raid simulation, resonance, dungeon generation, loot quality, and a full critical-path playthrough.

Design targets live in `SPEC.md`, current acceptance status in `PROGRESS.md`, and implementation calls in `DECISIONS.md`. The overhaul docs (`LOOT_OVERHAUL.md`, `DUNGEON_OVERHAUL.md`, `GRAPHICS_SPEC.md`, and others) track the work past the original phase plan.

## Requirements

- Node.js 20 or newer
- npm
- A WebGL2-capable desktop browser, targeted at current Chrome

## Setup

```sh
npm install
```

## Run

```sh
npm run dev
```

Open the Vite URL in your browser, start a new game, and choose a starter hero.

## Useful commands

```sh
npm test          # run the vitest suite
npm run build     # typecheck and build the Vite app
npm run typecheck # run TypeScript without emitting
npm run assets:check  # build the asset manifest and check size budgets
```

## Controls

- Right-click ground: move
- Right-click unit: attack or interact
- `Q/W/E/R`: hero abilities
- `D/F`: extra active ability slots, when available
- `Z/X/C/V`: item actives
- `N`: neutral item active
- `1-5`: swap active party hero
- `A` then click: attack-move
- `Shift` while ordering: queue the order
- `S`: stop/hold
- `T`: channel Binding Totem on a weakened creep
- `G`: interact with nearby gates, gyms, and portals
- `B`: shop while in town
- `Y`: Town Services (boss reruns, Tinker's Bench, Armory, gold sinks)
- `Tab`: party, inventory, and caught creep panel
- `J`: quest journal
- `K`: codex
- `M`: toggle map view
- `Esc`: pause, save, and load

Quick-cast is enabled by default.

## 60-second demo

1. Run `npm run dev`, open the local Vite URL, click **New Game**, and pick Juggernaut.
2. In the starter town, press `B`, open **Components**, buy **Blink Dagger**, close the shop, and press `Z` at the cursor to blink.
3. Right-click a recruitable hero to Find, complete their Trial, then win the Bind duel to recruit them.
4. Press `Tab` to set gambit presets, inspect echo progress, and swap facets after an echo unlock.
5. Weaken a kobold below 30% HP, channel the Binding Totem with `T` to capture it, then field it from the party panel.
6. Travel through a gate with `G`, challenge a gym, and confirm that badges, party, inventory, and region all persist through save and load.

## Architecture

```text
src/core/     deterministic combat simulation, stats, statuses, items, capture, AI, progression
src/data/     heroes, items, creeps, regions, raids, dungeons, tuning, and content registration
src/engine/   Three.js scene, camera, procedural models, terrain, animation, VFX, audio, icons
src/systems/  game orchestration, input, debug tools, save/load, overworld and session state
src/ui/       title screen, HUD, panels, and styles
src/test/     vitest suites for core behavior, data, saves, boundaries, and simulations
```

The core rule is that `src/core/` stays headless: it does not import Three.js or touch the DOM. Rendering and UI consume core state, while tests run combat and progression logic without a browser.

Content is data-driven. Adding heroes, items, creeps, or regions mostly means adding definitions under `src/data/`, with generic systems interpreting those definitions.

## Project constraints

- Browser only, single-player only.
- Vite, Three.js, TypeScript, and Vitest, with no game engine.
- Procedural visuals and generated icons stay as the always-available fallback; glTF models replace hero rigs when assets are present.
- Dota mechanical identity is the bar: a Dota player should recognize a hero's kit and an item's purpose on sight, even when numbers are retuned for action-RPG pacing.
- All written content is original and in-character. The game evokes Dota and its cousins without copying their text or assets.
- `npm test` should stay green after content and systems changes.
