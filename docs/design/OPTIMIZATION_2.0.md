# OPTIMIZATION 2.0 — "ANCIENTS"

The next optimization pass, written for the game as it stands today: a PBR
renderer with a full post-processing stack, authored glTF heroes and creeps,
sampled audio, resonance, dungeons, raids, item sets, and directed cut-scenes.
The original `OPTIMIZATION_SPEC.md` was written when the sim had no spatial
index and the renderer drew flat-shaded primitives. Most of that plan shipped.
The bottleneck has moved, so the strategy moves with it.

This doc is direction, not a gate, on the same crunch-mode footing as `SPEC.md`
§0. It has two companions and supersedes one:

- **Supersedes `OPTIMIZATION_SPEC.md` (1.0).** That pass covered the sim and
  render hot paths and is largely done (see §0). 2.0 is the next frontier.
- **Complements `PERFORMANCE_PLAN.md`.** That doc owns the asset pipeline:
  manifest, delivery, loading, runtime cache. 2.0 references it rather than
  repeating it, and extends it where the two meet (memory, scene lifecycle).
- **Companions:** `GRAPHICS_SPEC.md` (the visual target), `PROGRESS.md`
  (measured results of record), `DECISIONS.md` (calls logged).

---

## 0. WHERE 1.0 LANDED (so 2.0 starts honest)

The first optimization pass and the graphics/asset work that followed it changed
the shape of the problem. What shipped:

| 1.0 item | Status today |
|----------|--------------|
| Spatial broadphase (A.1) | `src/core/spatial.ts`, rebuilt twice per tick in `sim.ts` `tick()` and routed through `unitsInRadius`/`nearest` |
| Squared-distance hot paths (A.2) | done across sim/movement/AI |
| Kill per-tick allocations (A.3) | in-place compaction for projectiles/zones/repeaters |
| O(1) removal (A.4) | swap-and-pop + `byUid` |
| AI cadence + cached selectors (A.5) | think stagger + cluster scans on the grid |
| Share geometry/materials (B.1) | geometry canonicalization + palette material cache |
| Pool VFX (B.2) | projectile pool in `vfx.ts`, 0 steady-state allocation |
| Mesh HP/mana bars (B.3) | replaced per-unit canvases |
| Trim per-frame work (B.4) | projectile sync passes the live array directly |
| Quality tiers (B.5) | `src/engine/performance.ts`, four tiers + adaptive DPR |
| Spike clamp + latency (C) | fixed-step `maxSimTicksPerFrame` guard |
| Perf harness + budget tests (D) | `src/engine/perf-harness.ts`, `src/test/perf-budget.test.ts` |

Recorded result (PROGRESS.md, M9): the headless render-side harness holds 30
units + 200 projectiles at ~2.3 ms/frame average with zero steady-state hot-path
allocation. The sim core is cheap and stays cheap.

What landed on top of 1.0 changed the cost profile:

- **A PBR + post-processing renderer.** `scene.ts` `update()` runs an
  `EffectComposer` (RenderPass → Bloom → color-grade/vignette → Output → SMAA),
  `MeshStandardMaterial` everywhere, `RoomEnvironment` IBL, real shadows, an
  animated shader river, a sky dome, and weather particles.
- **Authored assets.** glTF heroes and creeps mount over the procedural rigs and
  run skeletal animation; 57 committed assets at ~10 MB (manifest); sampled audio
  alongside the procedural layer.
- **More systems per tick.** Resonance reactions, status, item-set auras and
  triggers, and story detectors all read the live sim/event stream now.
- **More and bigger fights.** Summoner armies, illusions, dungeon packs, raid add
  waves, and endless-mode escalation routinely field more than the 30-unit
  scenario the budget was written against.

**The headline:** the binding constraint is now the GPU and the main-thread
render frame, plus memory as the asset set grows. The sim is no longer the thing
to chase. 2.0 profiles the new bottleneck and optimizes there, and uses the
headroom to make the game bigger and sharper.

### 0.1 Principles

- **Determinism stays sacred.** The headless core (`src/core/`) stays headless
  and seed-deterministic. `Sim.hash()` and the at-scale determinism test are the
  contract. This matters more in 2.0 because §C proposes moving the sim to a
  worker; the boundary that makes that safe is the same boundary 1.0 protected.
- **Measure first, now on the GPU.** 1.0 measured CPU with the headless harness.
  2.0 needs GPU and frame-time evidence from the browser. The `?debug` graphics
  HUD already reports frame avg/p95, draw calls, triangles, texture/program
  counts, and DPR/tier. Every 2.0 change cites a before/after from it.
- **Pay for what is on screen, in the fight, and in memory.** 1.0 paid for the
  fight (spatial index). 2.0 adds: pay for what the camera sees (cull, LOD,
  instancing) and what the GPU holds (texture budget, eviction).
- **Headroom is for gameplay.** Every cycle freed buys a bigger battle, a smarter
  AI, or a more continuous world (§E), not just a higher idle framerate.
- **Separate free wins from dials.** Some changes are free: they make the same
  frame cheaper with no visible or felt cost, so we just do them (instancing
  identical units, gating an off-screen mixer, fixing a per-frame string build).
  Others are trade-offs: they buy frames by spending fidelity or fight scale, and
  the right setting is a matter of taste and hardware (post-FX depth, shadow
  resolution, draw distance, summon caps). Free wins land unconditionally. Trade-
  offs land as a quality tier and, where the player would reasonably want control,
  a setting in the options menu (§F). The default tier picks a sensible point; the
  player moves it.

Each item in §A–§E below is tagged **[free]** (objective, no felt cost) or
**[dial]** (a trade-off the player or the tier system should control). The dials
are what §F turns into menu options.

---

## A. RENDER / GPU — THE NEW #1

The render frame now does real work every frame in `scene.ts` `update()`
(line 691): sync unit rigs, sync and update VFX, day/night grade, camera, map
markers, water shader, sky, weather, then the composer renders the whole post
stack. On a busy scene this is where the budget goes.

### A.1 Profile before cutting

Run the `?debug` HUD on the fixed browser smoke route (`PERFORMANCE_PLAN.md`
§2.8) and classify the bottleneck: draw calls (CPU-bound submission), triangles
(geometry), fill rate (post stack and overdraw), or shader/program count
(material variety). The fix is different for each, and the post stack is the most
likely culprit because it is full-screen fill. Capture a Spector.js trace once to
confirm. No render change in §A lands without this classification first.

### A.2 Cut draw calls where units repeat

The renderer mounts one rig per unit. Camps, summon armies, illusions, brewlings,
clones, and raid add waves put many copies of the same silhouette on screen at
once. Terrain props already instance (`terrain.ts`). Extend that thinking to
units:

- Share one loaded glTF source scene per URL and clone per unit (the asset path
  already does this); confirm clones share geometry and materials and do not mint
  per-unit material variants.
- For large identical crowds, evaluate `InstancedMesh` or impostor billboards for
  distant copies, keyed by silhouette + palette. Animation makes full instancing
  awkward (`OPTIMIZATION_SPEC.md` §F still holds), so the realistic win is shared
  skeletons + instanced static far-LOD, not one instanced draw call per body.

### A.3 Tame the post stack by tier

Bloom and AO are fill-rate heavy and scale with resolution, not scene
complexity. The presets already gate AO to ultra and post-FX off at low
(`performance.ts`). Next steps:

- Render bloom at half resolution and upsample; it is a glow, the cost of full-res
  is invisible.
- Collapse the color-grade/vignette `ShaderPass` into the `OutputPass` tonemap
  step so the composer does one less full-screen pass.
- Measure SMAA against off at medium; if the cost outweighs the read on the target
  machine, drop it a tier.

### A.4 Shadow budget

Shadows are a second scene draw. `shadowMapSize` already steps by tier (512 → 4096).
Add: let static props receive shadows without casting them, cull shadow casters to
the camera frustum, and consider baking terrain-prop shadows since they do not
move. The goal is a flat shadow cost as the unit count grows.

### A.5 Adaptive quality 2.0 (close the loop)

`scene.ts` already runs `updateAdaptiveDpr` off a 180-sample frame-time window.
Promote that from a DPR-only knob to a closed feedback controller that steps whole
quality tiers under sustained budget miss: first DPR, then bloom/AO, then shadow
resolution, then SMAA, with hysteresis and a cooldown so it settles instead of
oscillating. A hitch should degrade gracefully and recover, the way the spike
clamp degrades the sim to slow-mo instead of a death spiral.

### A.6 Cull and skip off-screen work

LOD freezes far animation (`lod.ts`), which is good. Add frustum/distance culling
so off-screen unit rigs and VFX skip their per-frame transform and material work
entirely, not just their skeletal pose. The overworld can hold a town plus camps
plus an entourage; most of it is off-camera at any moment.

---

## B. ANIMATION & UNIT VIEWS AT SCALE

Authored creeps and heroes run skeletal animation now. At 30+ animated units this
is real CPU, even when loading and GPU are solved.

### B.1 Gate the mixer, not just the pose

`updateView` already skips `animateRig` for reduced/culled LOD tiers
(`scene.ts:1139`). Extend the same gate to the glTF `AnimationMixer.update` and to
cosmetic wobble, so a far authored creep pays nothing for animation. Reduced units
animate every other frame; culled units freeze. Audit bone counts per asset in the
build report (`PERFORMANCE_PLAN.md` §2.6).

### B.2 Crowd views for armies and illusions

Summoner playstyles and illusion-heavy kits are a 2.0 reality the original budget
did not model. Give large same-type groups a cheaper view: shared skeleton, far
copies as impostors or static-pose instances, full rigs only for the near few.
Tie the count to a `TUNING` ceiling so a Necromancer army has a defined cost.

### B.3 Stop mutating shared materials (correctness + perf)

`updateView` sets `m.transparent`/`m.opacity` on `rig.materials` for invis and
fade (`scene.ts:1150`). With the 1.0 material-sharing cache, those materials may be
shared across units, so a per-unit opacity write can bleed to siblings and force
extra shader state. Audit the share boundary: clone a material only when a unit
needs unique opacity/tint/effect state, and restore the shared instance when the
effect ends. This is both a latent visual bug and a draw-call multiplier.

### B.4 Finish the visual-epoch counter (carried from 1.0 B.4)

`itemVisualKey` still builds a `map().join('|')` string per unit per frame to
detect equipment changes (`scene.ts:1112`). Bump a `visualEpoch` integer on the
unit when items change and compare integers. Small, mechanical, still open.

---

## C. SIMULATION AT 2.0 SCALE

The sim core is cheap per unit, but the tick now does more per pass and runs in
bigger scenes. `tick()` rebuilds the spatial grid twice (`sim.ts:1042`, `1062`),
then runs statuses → refresh + charge regen → think → actions → projectiles →
zones → repeaters → auras → regen, with resonance, status reactions, and item-set
auras layered in. None of this is hot today; the work here is staying ahead of the
roster and fight sizes 2.0 enables.

### C.1 Reuse the spatial rebuild

Two full rebuilds per tick is the safe default (positions change after movement).
Measure whether the post-movement rebuild can be a dirty update of moved units
only, or whether the pre-think rebuild can be skipped when nothing moved last tick.
Keep stable query ordering so the determinism hash never shifts.

### C.2 Budget the new per-tick systems

Resonance reactions, status ticks, and set-bonus auras each scan units. Route
their radius work through the existing grid (the AI clustering already does), give
them think-cadence staggering like the AI, and confirm they are off the per-frame
path entirely when their feature is disabled (resonance can be toggled off).

### C.3 Move the sim to a Web Worker (the big structural win)

The headless core is already walled off from `three` and the DOM. That boundary
makes it the ideal candidate to run on its own thread. Run the 30 Hz sim in a
worker and keep the render thread free for the 60 fps frame and the post stack.
The render side reads interpolated snapshots (it already interpolates positions in
`updateView`). Determinism is preserved because the core does not change; only its
host does. This is the single largest main-thread win available and it directly
serves the GPU-bound reality from §0. Risks live in §H: snapshot transfer cost,
input-to-tick latency, and keeping the worker boundary deterministic.

### C.4 Raise and document the unit ceiling

With §A–§C headroom, set and document a supported unit ceiling for the overworld
and for raids, and add `TUNING` caps for summons and illusions so the worst case
is bounded rather than discovered in a frame drop.

---

## D. ASSETS, MEMORY & SCENE LIFECYCLE

`PERFORMANCE_PLAN.md` owns asset delivery, loading, prewarm, and the runtime
cache. 2.0 adds the pieces that surface once many regions, dungeons, raids, and
cut-scenes ship in one session.

### D.1 A GPU memory ceiling with eviction

Implement the cache lifecycle from `PERFORMANCE_PLAN.md` §2.4: strong cache for
the current scene, small warm cache for likely-next assets, eviction on region
change past a threshold, and real GPU disposal (textures, geometries, materials,
PMREM) with reference counting for cloned source assets. Surface the counters in
the `?debug` HUD (it already shows cache sizes and hits).

### D.2 KTX2 / Basis for textures

Once image decode or GPU upload shows up in a profile, adopt KTX2/Basis for
terrain and model textures to cut decode time and VRAM, with the transcoder kept
local. Until a profile proves it, this stays a note (`PERFORMANCE_PLAN.md` §2.2).

### D.3 Scene-lifecycle leak guard

The game now builds and tears down many scene types: overworld regions, gym
fights, raids, multi-room dungeons, and cut-scene stages. `scene.ts` disposes the
composer (`532`, `614`); the full teardown checklist needs the same rigor for
terrain, water, weather, env maps, transient VFX, unit views, and authored clones.
Guard every async asset `.then` with a scene token so a late load cannot mount
into a disposed scene. Add the region-cycle stress test (`PERFORMANCE_PLAN.md`
§2.7): A → B → A repeatedly, watch object counts and GPU memory stay flat.

### D.4 Code-split the heavy, rarely-first modules

Cut the time-to-first-frame and the main bundle by lazy-loading modules that are
not needed at boot: cinematics/cut-scene DSL, dungeon and raid sessions, seasonal
modes, and heavy `three` addons. The loading screen already covers scene warm-up,
so a lazy import behind it is invisible to the player.

### D.5 Extend prewarm to authored materials and the post stack

`GameScene.prewarm()` compiles the scene before the loading screen fades. Extend
it to authored GLB materials and every post-processing program for the loaded
region so the first interactive frame after region entry has no shader hitch.

---

## E. GAMEPLAY THE HEADROOM UNLOCKS

Performance work is the means; a better-feeling game is the point. Each item below
spends the budget §A–§D frees.

### E.1 Bigger, readable fights

Once units are cheaper to render and the sim runs off-thread, raise the live unit
counts that make the fantasy land: full summoner armies, denser raid add waves,
larger dungeon packs, deeper endless-mode escalation. Pair every raise with the
readability work (clear silhouettes, telegraph decals already exist) so a big
fight stays legible, not just possible.

### E.2 A smarter AI with the freed cycles

The AI 2.0 pass already generalized item usage, mana budgeting, and combo windows,
and routes clustering through the grid. With sim headroom it can think more often
and consider more threats per decision without missing budget, which sharpens gym,
Elite, and raid fights. Spend §C savings on AI quality, not idle margin.

### E.3 A more continuous world

Use the asset cache and prewarm (§D, `PERFORMANCE_PLAN.md` §2.3) to stream the
overworld so region borders feel like travel rather than a loading wall, and so
the camera can see further without a draw-call cliff (gated by §A.2 instancing and
§A.6 culling).

### E.4 Input latency and spike behavior

The fixed-step clamp keeps a hitch from spiraling. With the worker sim (§C.3),
re-verify input-to-action latency: an order issued mid-frame should apply on the
very next tick, and the snapshot interpolation must not make the active hero feel
laggy on sharp turns. Cheap to check, high perceived value.

### E.5 More VFX within budget

The projectile pool and additive glow language make particles cheap to add.
Within the 200-particle budget there is room for richer signature spells and
reaction effects (resonance Vaporize/Freeze reads), now that adding them does not
thrash GC.

### E.6 Performance as fairness

Gym and Elite fights resolve on the fixed-step core, so their outcome is
framerate-independent by construction. Keep it that way: assert in a test that a
macro fight produces the same result regardless of render cadence or worker
timing, so "my framerate dropped and I lost" can never be true.

---

## F. TESTING & MEASUREMENT 2.0

1.0 gave a headless harness, a budget assertion, and at-scale determinism. 2.0
extends coverage to the GPU-bound and memory-bound reality.

### F.1 Automate the browser perf route

Script the fixed smoke route (`PERFORMANCE_PLAN.md` §2.8) in Playwright: new game
→ busy region → 30-unit fight → hold 60 s → read the `?debug` HUD and record p95
frame time, draw calls, and cache stats to `PROGRESS.md`. This is the GPU-side
companion to the headless budget test.

### F.2 Scale the headless harness

Extend `perf-harness.ts` to 60- and 100-unit scenes and assert sub-quadratic
growth (the spatial-index regression guard, raised to 2.0 fight sizes). If §C.3
lands, add a worker round-trip determinism test: the same seed through the worker
host produces the same `Sim.hash()` as the in-process sim.

### F.3 Memory and lifecycle regressions

Add the region-cycle leak test (§D.3) asserting renderer object counts and
approximate GPU texture bytes stay flat across A → B → A. Add an asset-size budget
gate (`PERFORMANCE_PLAN.md` §2.1) that fails when `public/assets/` grows past the
agreed cap without an explicit update.

### F.4 A frame-budget CI signal

Keep the headless budget assertion in the normal suite (fast, deterministic). Run
the browser route and the at-scale harness on a nightly or manual job, not every
PR, to avoid flakiness, and record numbers rather than gating on them.

---

## G. PHASING & ACCEPTANCE

Ordered so each step is independently shippable and measured. The first step is
non-negotiable: 2.0 optimizes the GPU, and we have to see the GPU first.

1. **Profile (A.1, F.1).** Run the browser route with the HUD and a Spector.js
   trace. Classify the real bottleneck (draw calls / fill / shaders / memory) and
   record baselines for 30 and 60 units. Nothing in §A–§B proceeds without this.
2. **Render/GPU pass (A).** Draw-call cuts, post-stack tiering, shadow budget,
   adaptive-quality controller, culling. Re-measure against step 1.
3. **Animation at scale (B).** Gate the mixer under LOD, crowd views, fix shared-
   material mutation, finish the visual-epoch counter.
4. **Sim threading + scale (C).** Spatial-rebuild reuse, budget the new per-tick
   systems, move the sim to a worker, document the unit ceiling. Re-baseline the
   at-scale determinism hash deliberately if anything reorders; log it.
5. **Memory, lifecycle, bundle (D).** Cache eviction + GPU disposal, scene-cycle
   leak guard, code-splitting, extended prewarm.
6. **Spend the headroom (E).** Bigger fights, smarter AI cadence, draw distance,
   latency re-verification, richer VFX, the fairness assertion.
7. **Testing backfill (F).** Browser route automation, scaled harness, memory and
   leak regressions, the CI signal.

**Done when:**

- The browser smoke route holds the target frame time on the target machine at the
  default tier, and the adaptive controller catches the worst case by stepping
  tiers, not just DPR.
- A 60-unit fight (the 2.0 scenario) stays in budget; the scaling probe shows
  sub-quadratic growth.
- The sim runs off the main thread with identical `Sim.hash()` across the worker
  and in-process hosts.
- Region cycling holds renderer object counts and GPU memory flat.
- Bigger summon/raid/dungeon fights run at the documented ceiling and stay
  readable.
- `npm test`, `npm run build`, and the browser smoke stay green; the headless-core
  boundary check is untouched.

---

## H. RISKS & NOTES

- **Determinism across the worker boundary is the new sharp edge.** The core stays
  deterministic, but the host (input timing, snapshot scheduling) must not leak
  nondeterminism into it. Pair §C.3 with the worker round-trip hash test (§F.2)
  and keep all RNG inside the core.
- **Shared-material mutation is a live correctness risk, not only perf** (§B.3).
  The 1.0 material cache and the per-unit opacity writes can collide. Treat the
  fix as a bug fix with a visual regression check, not a nice-to-have.
- **Profile before cutting render cost.** The likely bottleneck is full-screen
  fill (post stack), but "likely" is not "measured." §A.1 gates the rest of §A for
  a reason; the 1.0 mistake to avoid is optimizing the part that was already cheap.
- **Don't re-fight 1.0.** The sim hot paths, spatial index, and VFX pooling are
  done and measured. 2.0 touches the sim only for threading and the new per-tick
  systems, not to re-derive what already holds.
- **Stay inside the asset-pipeline lane.** `PERFORMANCE_PLAN.md` owns delivery,
  loading, and cache mechanics. 2.0 should extend and reference it, not fork a
  second asset plan. Log shared decisions (cache eviction, KTX2, code-split
  boundaries) once, in `DECISIONS.md`.
- **Phase 5+ graphics lookahead.** The instancing, crowd views, quality controller,
  and memory budget here are the foundation a future higher-fidelity asset push
  builds on. Design the pooling and quality knobs with that scale in mind.
