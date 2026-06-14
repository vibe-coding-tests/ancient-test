# INTERACTION VERIFICATION — proving every effect does what it says

A plan to check that every skill, spell, and item effect in the game behaves the way its data declares. Companion to `SPEC.md` (§2 ability vocabulary, §6 micro combat, §7 cross-interactions), `COLLISION_HITBOX_SPEC.md` (the contact contract: who can be hit, by which body or volume, with what feedback), `GAMEPLAY_OVERHAUL.md` (Resonance/elements), `SWAP_COMBAT_OVERHAUL.md` (tag-in boons: `EffectNode`s fired by a swap, the Tag Gauge, combo chains, off-field persistence), `ITEM_REHAUL.md` (affixes, grades), `PRESENTATION_SPEC.md` (windup/telegraph contract), `VFX_ASSETS.md` (asset-backed presentation with procedural fallbacks), and `ASSETS.md` (provenance and manifest policy).

This plan checks *what an effect does once contact has been resolved*. `COLLISION_HITBOX_SPEC.md` checks *how contact is resolved*: unit body derivation, obstacle bodies, target validity, projectile policy, and the feedback that proves contact. Both plans use the same sim, the same `SimEvent` bus, and the shared helpers in `src/core/collision.ts`, so the tests should import the same math the game uses. §8 spells out the overlap.

The game is data-driven. Heroes, items, and creeps declare `EffectNode` compositions in `src/data/`; generic interpreters in `src/core/` execute them; the renderer in `src/engine/` listens to the `SimEvent` bus. Asset loaders add GLBs, VFX textures, icons, and sampled audio on top of a procedural floor, but they do not decide gameplay outcomes. So "does this spell work?" splits into three questions that can each be answered headlessly:

1. **Is it well-formed?** The data parses, every `ValueRef` resolves, every cross-reference exists. (static)
2. **Does it run?** Casting it steps the sim without throwing, at every level. (smoke)
3. **Does it do what it claims?** A ground-aoe nuke damages enemies in the radius and nobody outside it; a root stops movement but not attacks; Blink moves the caster. (behavioral)

The first two are largely covered today. The bulk of the new work is the third: a behavioral matrix keyed off the effect vocabulary, so that adding a spell forces you to assert what it actually does.

---

## 1. What counts as an interaction

Every castable thing (`AbilityDef`) is a list of `EffectNode`s plus optional `channel`, `toggle`, `passiveMods`, `aura`, `triggers`, and `attackMod`. The closed effect vocabulary (`src/core/types.ts`) is the spine of this plan. Each kind has a definition of "working as designed":

| Effect kind | Working-as-designed means | Observable signal |
|---|---|---|
| `damage` | victims in scope lose HP per the resolved amount; armor/magic-resist/amp applied; out-of-scope units untouched | `hp` delta, `damage` event (`amount`, `dtype`, `crit`) |
| `heal` | allies in scope gain HP, capped at max; `pctMaxHp` scales with max HP | `hp` delta, `heal` event |
| `mana` (`burn`/`restore`) | target mana moves by the resolved amount, floored at 0 | `mana` delta |
| `status` | the right `StatusId` lands for the right duration; debuffs respect status resist; DoT ticks; periodic nested effects fire | `summary` flags, `status-apply`/`status-expire` events, `hp` ticks |
| `displace` (`knockback`/`pull`/`forced`/`blink`) | caster or target moves the declared distance/direction | `pos` delta, `blink` event |
| `zone` | a circle/line persists for `duration`; ticks hit the right team; `wall` blocks pathing; `onEnter` fires in its window; `auraMods` apply inside | `sim.zones`, `zone-spawn`/`zone-expire`, periodic damage |
| `summon` | the unit spawns on the caster's team with its declared abilities and lifespan | `sim.units`, `summon` event |
| `statmod` | declared mods apply for the duration, then revert | `summary.mods`, expiry |
| `projectile` | a projectile travels at the declared speed; linear ones can miss or be blocked; homing ones hit; `onHit` effects run only on impact | `projectile-spawn`/`projectile-hit`/`projectile-expire`/`projectile-block` |
| `repeat` | the inner effects run `count` times at `interval` | repeated child events |
| `capture-channel` / `purge` | capture starts/completes; purge strips buffs | `capture-*` events, status removal |
| `exotic` | the registered handler runs its bespoke logic | per-exotic assertion |

Plus the non-`EffectNode` mechanics that ride on abilities and items:

- **Channels** — hold for `duration`, tick, run `onEnd`, and break on silence/stun/death.
- **Toggles** — on/off, drain mana/HP per second while on.
- **Auras** — apply mods to allies/enemies in radius (or globally) and drop when out of range.
- **Triggers** — on-attack / on-damage-taken / on-kill procs from items and affixes.
- **Attack modifiers** — crit, cleave, lifesteal, bash, mana break, on-hit elements.
- **Elemental reactions** (Resonance mode) — element-on-hit gauges and the `REACTION_TABLE` multipliers.
- **Tag-in boons** (`SWAP_COMBAT_OVERHAUL.md`) — a `TagBoonDef.effects` list fired by a hero swap rather than an ability cast, gated by the per-hero **Tag Gauge**, optionally with a separate `outEffects` on swap-out, amplified by the **combo chain** window and `tagBoonAmpPct`, and (under Resonance) relying on **off-field persistence** of the benched hero's zones/summons. Because the boon resolves through the *same* `EffectNode` engine, its per-kind behavior is covered by §3.2; what is *new* and needs its own cells is the **trigger and gating**, not the effect math.
- **Cross-interactions** — magic-immune (BKB) rejection, silence breaking channels, purge vs buffs, status resist stacking, displace vs root.
- **Presentation** — every cast resolves an `anim` gesture and a `sound`, and emits the `SimEvent`s the renderer needs.

The deliverable is one assertion (or a small set) for every cell in this list that appears in the content.

---

## 2. Current coverage — what already holds

Several test layers exist and should stay the foundation. Be honest about what each proves.

| Layer | File | Proves | Limit |
|---|---|---|---|
| **Static / data-lint** | `src/test/data-lint.test.ts` | Every ability/item/creep parses; every `ValueRef` key exists; `dtype`/`StatusId`/`VfxArchetype`/`AnimGesture`/`SoundArchetype` are in vocabulary; exotic ids are registered; per-level arrays cover max level; anim+sound present on every castable | Says nothing about runtime behavior. A spell can lint clean and do nothing. |
| **Smoke** | `src/test/kit-smoke.test.ts` | Every hero ability (L1/15/30) and every item active casts and steps 0.35–0.4s without throwing | Only checks "no exception." A damage spell that heals the enemy passes. |
| **Behavioral (sampled)** | `src/test/hero-kits.test.ts` | Mechanical identity for hand-picked kits: Pudge hook drag + miss, Fissure wall + double stun, Enchant Totem one-swing, Frostbite root-not-disarm, Freezing Field channel, etc. | Curated, not systematic. Most of the ~400 abilities and ~80 item actives have no behavioral assertion. |
| **Collision contract** | `src/test/movement.test.ts`, `src/test/dungeon.test.ts`, collision rows in `src/test/data-lint.test.ts` | `resolveUnitBodies`, footprint-decoupled hit/pick bodies, shared radius/line/projectile helpers, movement-blocked and projectile-block events, dungeon collision zones, and spell-volume-to-VFX parity | Proves contact math and collision data coverage. It does not prove that a contacted target receives the right effect. |
| **Elements** | `src/test/phase5-resonance.test.ts` | Reaction multipliers via `applyDamage` | Scoped to Resonance. |
| **Presentation / assets** | `src/test/animator.test.ts`, `vfx-cache.test.ts`, `model-cache.test.ts`, `audio.test.ts`, `asset-world-sizes.test.ts`, `describe.test.ts`, `assets:check` | Procedural poses, VFX pooling, asset loader/cache behavior, sampled-audio fallback, world-size-to-asset parity, auto-descriptions, and manifest/provenance checks | Renderer and asset pipeline coverage. It does not prove that a cast emits the right gameplay event sequence. |
| **Scaling** | `src/test/combat-scaling.test.ts`, `macro-sim.test.ts` | TTK bands, 5v5/5v1 resolution | Aggregate balance, not per-effect correctness. |

Collision and asset coverage are now real foundations, not only design notes. The remaining gap is the behavioral layer: it is sampled, not a matrix. A spell can pass lint, smoke, collision, and asset checks while doing the wrong thing after contact.

---

## 3. The verification matrix — the core deliverable

The goal is a generated, content-keyed matrix so coverage can be measured and gaps are loud. Build it in three parts.

### 3.1 Effect-kind coverage census (new test, cheap, high value)

Walk every ability, item active, and `tagBoon` effect list (reuse the `collectAbilities` / effect-walker already in `data-lint.test.ts`, extended to visit `HeroDef.tagBoon`) and bucket them by the effect kinds and mechanics they use. Emit a coverage report and assert a floor, the same way the world-size matrix logs `red boxes: 0`.

This gives one table that says, for example, "142 abilities use `damage`, 60 use `status:stun`, 18 use `zone`, 9 use `summon`, 4 use `exotic`." It is the denominator for everything below, and it catches a new effect kind landing with no behavioral test attached.

Output: `src/test/interaction-matrix.test.ts` that prints the census and fails if a registered effect kind has zero behavioral coverage (cross-referenced against a tagged registry from §3.2).

### 3.2 Per-effect-kind behavioral harness (new, the bulk of the work)

A table-driven harness that spawns a standard arena and asserts the observable signal for each effect kind. One reusable arena helper (copy the `arena()` pattern from `hero-kits.test.ts` with `events.captureAll = true`), then a parametrized case per kind:

```ts
// shape only — lives in src/test/interactions/<kind>.test.ts
const sim = arena();
const caster = sim.spawnHero(REG.hero(heroId), { team: 0, pos: A, level: 20, ctrl: { kind: 'player' } });
const enemy  = sim.spawnHero(REG.hero('axe'), { team: 1, pos: B, level: 20, ctrl: { kind: 'none' } });
caster.mana = 99999;
const before = snapshot(enemy);
sim.order(caster.uid, { kind: 'cast', slot, ...castArgs });
sim.run(t);
// assert the signal for THIS kind, plus a negative control
expect(enemy.hp).toBeLessThan(before.hp);                 // damage landed
expect(bystander.hp).toBe(bystander.stats.maxHp);          // out of radius untouched
expect(eventsOfType('damage', enemy.uid).length).toBeGreaterThan(0);
```

Cover each kind with at least: one **positive** case (it does the thing) and one **negative control** (it does *not* affect what it shouldn't — wrong team, out of radius, after expiry). Negative controls are what separate this from smoke, and they double as the **hitbox boundary tests** `COLLISION_HITBOX_SPEC.md` §5 asks for: a unit just inside the effective radius is hit, a unit just outside is not. Use the standardized expansion from that spec (`effectiveRadius = authoredRadius + target.hitRadius * 0.5`) when placing the boundary units, so both specs assert the same number. Suggested files:

- `interactions/damage.test.ts` — scope + dtype + armor/magic-resist/amp applied; bystander just outside `effectiveRadius` untouched; bystander just inside is hit.
- `interactions/status.test.ts` — each `StatusId` produces the right `summary` flag (stun→disabled, root→cannotMove-not-cannotAttack, silence→cannotCast-only, hex→disabled+slow, disarm→cannotAttack-only, etc.); duration expires; status resist shortens debuffs; DoT ticks HP.
- `interactions/zone.test.ts` — persists for duration, ticks the right team, `wall` blocks a walker, `onEnter` fires once in window, expires.
- `interactions/displace.test.ts` — blink/knockback/pull/forced each move the right unit the right distance; blink emits `blink`.
- `interactions/projectile.test.ts` — assert the named policies from `COLLISION_HITBOX_SPEC.md` §5: linear sweep hits the first valid unit within `width/2 + unit.hitRadius`, aim-wide misses and emits `projectile-expire`, `hitsAllies` gates friendly collision, projectile-blocking obstacle bodies intercept before units and emit `projectile-block`, `disjointable` lets a homing projectile be dropped, `onHit` runs on impact.
- `interactions/heal-mana.test.ts` — heal caps at max, `pctMaxHp` scales, mana burn floors at 0.
- `interactions/summon.test.ts` — unit appears on caster team, expires at lifespan.
- `interactions/channel-toggle.test.ts` — channel holds/ticks/onEnd; toggle drains resource while on.
- `interactions/aura-trigger.test.ts` — aura applies in range and drops out of range; on-attack/on-kill triggers fire.
- `interactions/tag-in.test.ts` — the swap *trigger* (the effects themselves are proven by the kind files above). Positive: swapping to a gauge-ready hero fires its `tagBoon.effects` and the observable signal lands (a Lockdown tag stuns, a Mend tag heals nearby allies, a Strike tag damages); the gauge then re-arms (`tagGaugeReadyAt` advances). Negative controls: swapping with the gauge **down** repositions but fires **nothing** (no `damage`/`heal`/`status` event); swapping fully **out of combat** wastes nothing; a `fire:'tag-out'`/`outEffects` boon fires on swap-**out**, not swap-in. Chain: a 2nd/3rd tag inside the chain window is amplified by the declared step and decays after it expires. Budget: a data-lint that each `tagBoon`'s summed effect magnitude sits inside its §4 power tier (no carry ships a support-sized boon).

### 3.3 Cross-interaction matrix (new, the subtle bugs live here)

These are the SPEC §7 interactions that break in combination. Table-driven, calling `applyStatus` + `execEffects` directly where convenient:

| A | B | Expected |
|---|---|---|
| BKB (magic-immune) on victim | magical `damage` / `status` debuff | blocked; `immune-block` event; physical still lands; `piercesImmunity` abilities still land |
| silence on a channeler | active channel | channel breaks; downstream stun lapses (the existing Pudge case — generalize it) |
| purge | buff statuses / positive statmods | stripped; debuffs untouched |
| status resist | two stacked debuffs | durations scaled, not the wrong one |
| displace (blink/force) | rooted caster | root blocks move but allows blink/force per design |
| Linken's / Lotus | single-target spell | absorbed / reflected once |
| Refresher | recently-cast ability | cooldown reset |
| BKB (magic-immune) on victim | tag-in `status` debuff (a Lockdown/Gather boon) | blocked exactly as the same effect from an ability would be; `immune-block` event; a tag-in physical/displace still lands |
| Tag Gauge not ready | swap | swap succeeds (reposition), boon does **not** fire — the gating lives outside the effect resolver |
| off-field persistence (Resonance) | swap-out of a hero with a live zone/summon | the zone/summon keeps ticking on the bench; a Soak left behind still seeds a reaction when a Strike hero tags in |
| Resonance **off** | a Soak tag / off-field reliance | Soak degrades to a small self buff; the swap removes-on-swap as today; plain (non-elemental) effect-chaining still composes |

Output: `src/test/interactions/cross.test.ts` (the tag-in trigger/gating rows may live in `interactions/tag-in.test.ts` alongside its positive cases).

---

## 4. Presentation contract (anim / vfx / sound)

Behavior is the sim; feel is the event bus. Verify the contract between them headlessly (no renderer needed) by reading `sim.events.history`:

- **Cast emits the right event shape.** Every cast produces a `cast` event carrying the `vfx` spec, a resolved `sound`, and `target`/`point`. `gestureForAbility` and `soundForAbility` already resolve a valid gesture/sound for every ability (asserted in `data-lint`); add the runtime half — that casting actually *emits* them.
- **Effect → event mapping holds.** An `enemies-in-radius` damage/status emits `aoe-burst`; a `projectile` effect emits `projectile-spawn` then `projectile-hit`/`-expire`; a `zone` emits `zone-spawn`/`zone-expire`; a `summon` emits `summon`; a status emits `status-apply`/`status-expire`. Assert these sequences per kind in §3.2 (the events are free once `captureAll` is on).
- **Failure feedback fires too.** `COLLISION_HITBOX_SPEC.md` §7 requires a readable cue for misses, blocks, and immunity. The events already exist on the bus — assert them: a magic-immune victim hit by a magical spell emits `immune-block` (not `damage`); an attack against evasion/blind emits `miss`; a `piercesImmunity` spell still emits `damage` through BKB. These are the negative half of the cross-interaction matrix (§3.3) viewed through the event stream.
- **Projectile blockers use the same event path.** A linear projectile stopped by a projectile-blocking obstacle emits `projectile-block` with obstacle id, impact position, and collision feedback. The interaction test should assert the effect did not run after the block, while the collision test owns the obstacle math.
- **Assets remain an enhancement.** A cast event carries abstract `vfx`, `sound`, impact, and feedback data. `VFX_ASSETS.md` owns the GLB, atlas, icon, UI frame, and sampled-audio pipeline; this plan asserts that missing assets do not change the event contract and that asset-backed renderers receive enough data to show the cue.
- **Renderer-side stays where it is.** `animator.test.ts` and `vfx-cache.test.ts` keep covering procedural poses and geometry pooling. This plan adds the contract that the sim feeds them the right events, not new rendering tests.

The full windup/telegraph readability contract stays in `PRESENTATION_SPEC.md`; this plan only proves the events fire.

---

## 5. Phased rollout

Land it in slices, each green before the next, each cheap to run.

| Slice | Deliverable | Gate |
|---|---|---|
| **V0 — census** | `interaction-matrix.test.ts`: walk all content, bucket by effect kind + mechanic, print the table, fail on an uncovered registered kind | Coverage denominator exists; CI prints it |
| **V1 — per-kind harness** | `src/test/interactions/*.test.ts` for the 12 effect kinds + channel/toggle/aura/trigger, each with a positive case and a negative control | Every effect kind in the vocabulary has at least one behavioral + one negative assertion |
| **V2 — cross-interactions** | `interactions/cross.test.ts` covering the SPEC §7 table | The known combination bugs are guarded |
| **V3 — presentation contract** | event-sequence assertions folded into V1 files | cast→event mapping proven for every kind |
| **V4 — per-signature sweep** | extend the `hero-kits.test.ts` pattern so each hero's *ultimate* (the highest-stakes, most bespoke effect) has one identity assertion | Every ult is behaviorally pinned; remaining basics covered by kind-harness sampling |
| **V5 — tag-in & swap-combo** | `interactions/tag-in.test.ts`: the trigger/gating cells (gauge-gated fire, swap-out boons, chain amp, off-field persistence under Resonance) + the §4 budget data-lint; census buckets `tagBoon` effects | Every hero with a `tagBoon` has its trigger proven; no carry ships a support-sized boon; the swap fires the right effects only when the gauge is ready |

V0+V1 deliver most of the value: they turn "it didn't throw" into "it did the thing, and didn't do the wrong thing." V4 is the long tail and can fill in over time, ult-first because ults carry the bespoke `exotic` and multi-effect logic. V5 lands alongside `SWAP_COMBAT_OVERHAUL` S2–S3 (when the effects and chain ship) — its per-kind behavior rides V1's harness, so V5 is only the new trigger/gating/budget cells.

---

## 6. How to run and what passing means

- **Runner:** Vitest, already wired. New files live under `src/test/interactions/` and run with the suite.
- **Commands:** `npm test` (full), `npx vitest run src/test/interactions` (just this matrix), `npm run typecheck`.
- **CI gate:** these join the existing `npm run test:full` chain (`test` → `build` → `assets:check` → `e2e`). The census (V0) prints its table on every run, like the world-size matrix logs `red boxes: 0`.
- **Pass criteria:** (1) data-lint green — all well-formed; (2) kit-smoke green — all run; (3) every effect kind in the vocabulary has a positive behavioral assertion and a negative control; (4) the cross-interaction table is green; (5) every ability emits the events its effects imply; (6) collision helpers and data gates stay green; (7) asset checks keep the manifest, provenance, and fallback contracts green; (8) the census reports zero uncovered registered effect kinds.

Determinism makes this tractable: the core is seeded and runs at 30 Hz with no `three`/DOM, so a spell's full effect resolves in milliseconds and assertions are exact, not flaky.

---

## 7. Keeping it honest as content grows

The matrix only helps if a new spell can't slip past it. Two guards:

1. **The census fails closed.** When someone adds an effect kind (or an `exotic` id, or a `StatusId`) that no behavioral test exercises, V0 fails with the uncovered kind named. New vocabulary forces a new assertion. The census also walks `tagBoon.effects`/`outEffects` (not just `AbilityDef`s), so a tag-in introducing an uncovered effect kind fails closed the same way a new ability would, and a hero shipping with no `tagBoon` is reported.
2. **Tag the harness against the registry.** The per-kind harness declares which kinds/statuses it covers; the census cross-checks that set against what the content actually uses. Drift in either direction is a red test, not a silent gap.

This mirrors how `data-lint` already grows with the content — it walks every entry rather than naming them — so the verification layer scales the same way the game does.

---

## 8. Cross-check with COLLISION_HITBOX_SPEC

The two specs touch the same sim from opposite ends. Drawing the line keeps them from duplicating work or contradicting each other.

### Who owns what

| Question | Owner |
|---|---|
| Did the spell land, and on which units? | `COLLISION_HITBOX_SPEC.md` (hit volumes, target validity, projectile sweep) |
| Once it landed, did it do the declared thing? | this plan (effect behavior) |
| What feedback proves contact happened? | shared — collision spec defines the cue catalog, this plan asserts the events fire |
| Determinism, sim-owns-truth, headless tests | shared principle, identical in both |

Both rest on the same foundation: the headless deterministic core owns contact and effect, the renderer only shows it. Neither spec adds a renderer test that decides an outcome.

### Where the collision spec sharpens this plan

Three places where it supplies a number or policy this plan should adopt rather than invent:

1. **The hit-radius formula.** Boundary placement in §3.2 uses `effectiveRadius = authoredRadius + target.hitRadius * 0.5` (collision spec §5). One number, asserted from both sides.
2. **Projectile policy names.** `interactions/projectile.test.ts` asserts the named behaviors (`disjointable`, `hitsAllies`, first-valid-unit sweep, expire-on-whiff) instead of a vague "linear can miss."
3. **The failure-feedback catalog.** Collision spec §7 enumerates MISS / EVADE / IMMUNE / BLOCKED. This plan maps each to its event (`miss`, `immune-block`) and asserts it in §4 and §3.3.

### Where this plan covers the collision spec's gates

`COLLISION_HITBOX_SPEC.md` §9 lists acceptance gates. The behavioral matrix is how two of them get proven headlessly:

- **Gate 5 (spell volumes match their preview):** partly static. Extend `data-lint` to check that an ability's hit shape agrees with its VFX archetype (a `skillshot`/line effect carries a line/`beam`/`projectile` vfx, a `ground-aoe` carries a `ground-aoe`/`dome`/`vortex` vfx). The behavioral half — that the volume the preview draws is the volume that hits — falls out of the §3.2 boundary tests.
- **Gate 8 (feedback fires for success and failure):** the §4 event-contract assertions are the headless proof that the sim emits the cues; the renderer turning them into flashes/labels stays a presentation concern.

### Current implementation boundary

The collision spec has moved from proposal to partial implementation. The core now has `CollisionBody`/`CollisionShape`, `resolveUnitBodies`, movement/target/hit/pick body derivation, footprint-decoupled boss hit and pick bodies, named radius/line/projectile helpers, authored room collision bodies, movement-block feedback, and projectile-blocking obstacles that can stop linear projectiles before a unit hit.

The behavioral matrix should test the shipped contract:

- Radius, line, zone, cleave, and projectile tests use `unitHitRadius` or `unitTargetRadius` through the shared helpers, not local copies of the old `unit.radius` math.
- Linear projectile tests include both unit-hit and obstacle-block cases. The block case proves that `onHit` effects do not run after `projectile-block`.
- Movement collision can resolve authored `circle`, `capsule`, and `rect` obstacle bodies in core. Authored content and debug overlays may still be circle-heavy, so tests should pin the helper behavior first and add content-specific cases as those bodies appear in data.
- Asset-backed visuals stay downstream. A GLB, status icon, VFX atlas, sampled sound, or UI frame can make feedback clearer, but the sim event remains the thing this matrix asserts.

When a new `CollisionShape`, hit policy, or feedback event lands, it should bring a collision test and, when it affects an effect resolving or failing, a matching interaction case. The census (§3.1) is the tripwire: new contact vocabulary with no behavioral coverage fails closed.

### Shared helpers to keep aligned

Both specs want a single set of hit-body helpers. Collision spec §8 routes radius, zone, projectile, and cleave checks through named helpers; this plan's §3.2 asserts through them. That layer now lives in `src/core/collision.ts`. Both test suites should import it. If the matrix and the collision tests ever compute the effective radius differently, the tests should fail until they return to the shared helper.
