# OPTIMIZATION SPEC: "ANCIENTS"

Companion to `SPEC.md`. This document targets two things the main spec leaves as "optimize when it actually matters" (§0): runtime performance (sim + render) and the test suite that protects it. Everything here keeps the headless-core boundary (§1.1) and the data-driven contract (§1.2) intact. Nothing here changes hero or item *feel*; it changes how fast we compute it and how cheaply we prove it correct.

Treat this like the phases in `SPEC.md`: a prioritized map, not a gate. Ship the high-value items first, measure, then decide whether the rest earns its keep.

---

## 0. BASELINE (measured today)

- `npm test`: 641 tests across 13 files, ~4.3s wall (transform + import dominate; tests run ~8s of CPU in parallel).
- Sim runs at a fixed 30 Hz tick; render interpolates (`Game.update`, `src/systems/game.ts:1400`).
- Budget from `SPEC.md` §0 and `src/engine/performance.ts`: 60 fps with 30 active units and ~200 live projectiles/particles.
- No performance test exists. The 60 fps budget is a constant, not an assertion. Nothing fails when a change makes the tick 3x slower.
- Engine code (`src/engine/*`, ~2.6k lines of Three.js) has zero test coverage; the suite runs in the `node` environment and never constructs a renderer.

The single most important gap: we have a written performance budget and no test that holds us to it. The single most important runtime cost: every unit recomputes its full stat block every tick, whether anything changed or not.

---

## 1. SIM CORE PERFORMANCE

The sim is the part that must stay cheap, because raids and summoner armies (the Diablo-necromancer fantasy in §5) push unit counts well past the 30 the budget assumes. The whole core is currently written with linear scans and no spatial structure. That is fine at 30 units and quietly quadratic at 80.

### 1.1 Stat recompute is the hot path (P0)

`Sim.tick()` calls `u.refresh(now)` for every alive unit, every tick (`src/core/sim.ts:875`). `refresh` runs `computeStats` → `summarize(statuses)` + `aggregateMods()` + `deriveStats()`. `aggregateMods` (`src/core/unit.ts:211`) walks every ability, all six item slots (with a `REG.items.get` map lookup each), and every status, building throwaway objects each call.

At 30 units that is 30 full recomputes per tick, 900/second. Most of those recomputes produce the identical result, because a unit's stats only change when its statuses, items, level, or external mods change.

**Change:** make stats dirty-flagged. Set `statsDirty = true` on add/remove status, level-up, item change, and external-mod change; recompute lazily in `refresh` only when dirty. Auras and zone buffs re-stamp short statuses every ~0.5-0.7s (`updateAuras`, `src/core/sim.ts:748`), so a unit standing in an aura still recomputes a few times per second, not 30. Idle and traveling units (the common overworld case) drop to near zero.

Expected win: the per-tick `refresh` loop goes from "always O(units × (abilities + items + statuses))" to "only when something changed." This is the highest-leverage change in the file.

**Watch:** the aura/zone re-stamp path calls `addStatus` with `refresh: true`. Make sure re-stamping an *identical* buff (same tag, same mods, only `until` bumped) does **not** mark dirty, or the flag never settles. Compare mods on the existing-status fast path in `addStatus` (`src/core/unit.ts:267`).

### 1.2 Spatial hash for neighbor queries (P0)

Every "who is near me" question is a full array scan today:

- `unitsInRadius` (`src/core/sim.ts:148`) - used by gambits, repeaters, `enemies-within`.
- `nearestEnemy` / `nearestEnemyOf` / `pickFocus` (`src/core/controllers.ts`).
- `resolveCollisions` (`src/core/movement.ts:66`) - two passes over all units, per moving unit.
- `steerToward` local avoidance (`src/core/movement.ts:24`).
- linear projectile sweep (`src/core/sim.ts:457`) - all units per linear projectile per tick.
- aura application (`src/core/sim.ts:779`).
- `most-clustered` gambit target (`src/core/controllers.ts:294`) - for each enemy, `unitsInRadius` over all units. This one is already O(n²) by itself.

**Change:** add a uniform spatial hash grid keyed on the sim bounds, rebuilt once per tick after movement integrates (or incrementally on position write). Cell size ~= the largest common query radius (aggro/avoidance, a few hundred sim units). Replace the scans above with grid cell walks. Keep `unitsArr` as the iteration source of truth; the grid is an index.

Determinism must hold: iterate grid cells and within-cell members in a fixed order (by uid), so query results are seed-stable. The macro-sim hash test (`src/test/macro-sim.test.ts`) is the guardrail; it must stay green with identical hashes.

Expected win: neighbor queries go from O(n) to roughly O(local density). At 30 units the constant-factor win is modest; at 80+ (raids, summoner armies) it is the difference between smooth and not.

### 1.3 Cheaper distance and removal (P1)

- **Squared distance for comparisons.** `dist` uses `Math.hypot` (a sqrt) and is called thousands of times per tick purely for `<` comparisons. Add `dist2(a,b)` and compare against `r*r` in every "within radius / nearest" check. Keep `dist` for the cases that need the actual length (steering steps, pull stop distance). `math2d` is the place; the call sites are listed in §1.2.
- **`removeUnit` is O(n).** It does `findIndex` + `splice` (`src/core/sim.ts:142`). On a wipe or add-wave clear that is O(n²) over the batch. Switch to swap-remove (swap with last, pop) since iteration order is not load-bearing for correctness, or mark-dead-and-compact once per tick. If you keep ordering for determinism, compact in a single pass at end of tick instead of mid-tick splices.

### 1.4 Trigger and aura dispatch (P2)

`runTriggers` (`src/core/sim.ts:308`) and the on-nearby-death scan in `killUnit` (`src/core/sim.ts:848`) walk all units × all abilities × all triggers. These fire on discrete events, not every tick, so they matter less. Two cheap wins: pre-index units that actually carry an `on-nearby-death`/`on-nearby-enemy-cast` trigger (most do not), and use the §1.2 grid for the radius check before the inner loop.

---

## 2. RENDER PERFORMANCE

The renderer holds the 60 fps budget. Today it allocates generously and shares almost nothing.

### 2.1 Geometry and material caching in the model builder (P0)

`buildUnitRig` (`src/engine/models.ts:37`) constructs fresh `BoxGeometry`/`CylinderGeometry`/`SphereGeometry` and three `MeshLambertMaterial` per unit, every spawn. A camp of creeps that share a silhouette each builds its own copies. This is draw-call count, GPU memory, and GC pressure that nothing reclaims well.

**Change:** cache geometries by `(kind, params)` in a module-level map and reuse them across rigs (geometry is safe to share; never mutate it). Share materials by palette color where the unit does not need per-instance material state. Keep per-instance materials only where the code actually mutates them per unit (invis fade opacity at `src/engine/scene.ts:317`, death fade). For those, clone lazily on first mutation.

### 2.2 Instancing for repeated units and markers (P1)

Wild camps spawn identical creeps; props are "instanced primitives scattered from region data" per `SPEC.md` §3 but the model path builds them as individual meshes. Map markers (`createMapMarkers`, `src/engine/scene.ts:154`) are one mesh each.

**Change:** use `THREE.InstancedMesh` for same-silhouette creep bodies and for static props/markers. Animation complicates instancing for heroes, so scope this to creeps and statics first, where it pays the most for the least risk.

### 2.3 VFX pooling (P1)

`VfxManager` allocates a new geometry + material per effect: `burst` builds a `RingGeometry`, a `BufferGeometry`, a `Points`, and two materials every call (`src/engine/vfx.ts:197`); zones and beams likewise. At 200 live particles this is constant allocation and disposal churn.

**Change:** pool by archetype. Keep a small free list of ring/burst/beam objects, reset and reuse on spawn, return on expiry instead of `group.remove` + drop. Share the static geometries (one ring geo, one spark geo) across all bursts; only transform and material color vary. The `transientVfxCap` (220, `src/engine/performance.ts`) already bounds the count; pooling makes that bound cheap.

### 2.4 HP bars (P2)

Each unit owns a `96x20` canvas, a `CanvasTexture`, and a `Sprite` (`src/engine/scene.ts:244`), redrawn on HP change. The redraw is already change-gated (`redrawHpBar`, `src/engine/scene.ts:380`), which is good. The remaining cost is one texture per unit. Options, cheapest first: keep as-is (it is gated and fine at 30), or move to a single instanced bar shader driven by a per-instance fill attribute if unit counts climb.

### 2.5 Renderer settings knobs (P2)

`shadowMapSize` is 2048 with `PCFSoftShadowMap` (`src/engine/scene.ts:91`, `:101`). Expose shadow resolution, pixel-ratio cap, and shadow on/off in settings so the budget can be held on weaker GPUs. `clampedPixelRatio` already caps DPR at 2; wire it to a setting. Add frustum-cull awareness for off-screen units (skip rig animation updates when not visible) in `syncUnits`.

---

## 3. GAMEPLAY / AI OPTIMIZATION

This is about keeping the *decisions* cheap without dulling the feel rules in `SPEC.md` §6/§7.

- **AI cadence is already staggered** by `(tickCount + uid) % cadence` (`src/core/controllers.ts:25`), so not every unit thinks every tick. Keep this. It is the right pattern.
- **Cache focus targets.** `pickFocus` and `most-clustered` rescan every think. Once §1.2 lands, route them through the grid. Additionally, hold a focus for a few ticks unless it dies or leaves range, so a 5v5 is not re-scoring targets constantly.
- **Large-army scaling (summoners).** The §5 summoner playstyle ("walk the map with an army") and add-wave raids are the realistic stress case, not the 30-unit gym. Once the grid and dirty-stats land, add a soft cap or LOD on AI think frequency that scales with live unit count, so a 60-summon screen degrades think rate gracefully instead of dropping frames.
- **Order churn.** Controllers reassign `u.order` every think even when the order is unchanged, which re-enters `Sim.order` cancel logic paths. Cheap guard: skip the assignment when the new order is structurally equal to the current one.

---

## 4. TESTING

The core is deterministic and headless, which makes it the cheapest thing in games to test well. We under-use that. Three gaps matter: no perf guardrail, no engine coverage, no overworld determinism check.

### 4.1 Performance regression harness (P0)

Add `src/test/performance.test.ts` that turns the `PERFORMANCE_BUDGET` constant into assertions:

- **Tick-cost budget.** Build a headless sim with 30 heroes + summons + live projectiles, warm it, then time N ticks. Assert mean tick time stays under a budget derived from 60 fps (a 30 Hz sim has ~33ms per tick of headroom; assert the sim portion stays well under, e.g. < 4ms mean on CI with generous slack like the existing 5s macro guard). Use `Sim.run` and `performance.now()` as `macro-sim.test.ts` already does.
- **Scaling check.** Tick the sim at 20, 40, and 80 units; assert per-unit cost does not grow worse than near-linearly (e.g. 80-unit per-tick time < 3x the 20-unit time). This is the test that catches an accidental O(n²) regression, which is exactly the class of bug §1 is removing. It will fail today against a quadratic baseline; set the bound to the post-optimization target and let it drive the work.
- Keep bounds loose enough to survive CI noise but tight enough to catch a 2x regression. The goal is a tripwire, not a microbenchmark.

### 4.2 Overworld / save determinism (P1)

`macro-sim.test.ts` proves macro and raid sims are deterministic. The overworld `Game` loop (`src/systems/game.ts`) has no equivalent. Add a test that:

- Drives a scripted overworld sequence (spawn, fight a camp, capture, swap, level) from a fixed seed twice and asserts identical end-state (`Sim.hash()` plus gold/xp/roster).
- Round-trips a `GameSave` through `buildSave` → `migrateSave` → reconstruct and asserts the rebuilt state matches, including ability-cooldown flooring and flesh stacks. `save.test.ts` covers validation; this covers fidelity.

The blocker: `Game` constructs a `GameScene` (Three.js) and `ProceduralAudio` in its constructor. To test the orchestration headless, extract the renderer and audio behind a thin interface that the test can stub, or split the pure orchestration (party, swap, rewards, camps, save) from the presentation wiring. This refactor also pays off in §4.3.

### 4.3 Engine pure-logic coverage (P1)

The renderer is untested because it needs WebGL. Most of the *logic* in the engine is pure and does not. Extract and test:

- Day/night palette blending and `isNight` boundary (`updateDayNight`, `src/engine/scene.ts:416`).
- Camera framing math (back/up interpolation by mode blend and zoom, `updateCamera:464`).
- World-scale conversions and the height-sampled placement math.
- `clampedPixelRatio` (`src/engine/performance.ts`) - trivial, already pure, add the test.
- VFX archetype selection and the `attackVisual` switch (which builder fires for which kind), separated from the Three.js construction.

For the parts that genuinely need a GL context, add an optional `jsdom` + `@vitest/browser` or headless-gl lane that runs a single smoke test (construct a `GameScene`, run one frame, assert no throw). Keep it out of the default `node` lane so the fast suite stays fast.

### 4.4 Sim correctness tests that protect the optimizations (P1)

The §1 changes are behavior-preserving by intent, so lock the behavior down first:

- **Spatial-query equivalence.** Before swapping in the grid, add tests that assert `unitsInRadius` and `nearestEnemy` return the same set/choice as a brute-force reference for randomized unit layouts and seeds. Then the grid must match the reference. This is the safety net for §1.2.
- **Dirty-stat equivalence.** Assert that a unit's `stats` after a dirty-flagged recompute equals an always-recompute baseline across a scripted sequence of buffs, items, levels, and aura entry/exit. Safety net for §1.1.

### 4.5 Suite hygiene (P2)

- **Coverage.** Add `vitest run --coverage` (v8 provider) and a CI threshold on `src/core/` and `src/systems/` (the logic that matters). Do not gate on `src/engine/` until §4.3 lands.
- **Pool config.** Import + transform dominate the 4.3s wall (the test bodies are 8s of parallel CPU). Confirm `vitest` is using the `threads`/`forks` pool and not re-importing the full data registry per file unnecessarily; `registerAllContent()` in many `beforeAll`s suggests a shared setup file could cut repeated registration.
- **Boundary widening.** `boundary.test.ts` checks `core` and `data`. Add a check that the new perf-sensitive core paths do not regress the no-`Math.random` / no-`three` rules, and that any new spatial-index module stays in `core` and import-clean.

---

## 5. PHASING & ACCEPTANCE

Each step ships independently and is measurable. Order is by value-to-risk.

**Step 1 - Guardrails first.** Land §4.1 (perf harness) and §4.4 (equivalence tests) against the *current* baseline. They define the target and catch regressions before the optimization work starts. Done when: perf test runs in CI, scaling test exists (it may fail at the quadratic baseline; record the baseline numbers in `DECISIONS.md`).

**Step 2 - Sim core.** §1.1 dirty stats, then §1.2 spatial grid, then §1.3 distance/removal. Done when: macro-sim hashes are byte-identical to today, equivalence tests pass, the scaling test passes its post-optimization bound, and the 80-unit per-tick time is within 3x of the 20-unit time.

**Step 3 - Render.** §2.1 caching, §2.3 VFX pooling, §2.2 instancing. Done when: spawning a full camp creates shared geometry (assert via a renderer smoke test or a draw-call/geometry count), and a 200-particle burst scene allocates from the pool (no per-frame geometry construction).

**Step 4 - Engine testability + AI.** §4.2/§4.3 refactor and tests, §3 focus caching and large-army LOD. Done when: the overworld determinism test runs headless, engine pure-logic has coverage, and a 60-unit summoner scene holds frame rate via think-rate LOD.

**Step 5 - Hygiene.** §4.5 coverage and pool config.

---

## 6. DECISIONS TO LOG (when implemented)

Per `SPEC.md` §0, jot these in `DECISIONS.md` as they land:

- Spatial-grid cell size and the iteration order chosen to preserve determinism.
- Dirty-flag triggers (the exact set of mutations that mark stats dirty) and the aura re-stamp equality rule.
- Perf-test budgets and the CI slack multiplier (so a flaky-CI bump is a deliberate, reviewed change).
- Whether the `Game` orchestration/presentation split happened, and where the seam is.
- Any settings-exposed render knobs (shadow res, DPR, shadow toggle) and their defaults.
