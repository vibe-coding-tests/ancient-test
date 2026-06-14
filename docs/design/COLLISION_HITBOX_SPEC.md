# COLLISION AND HITBOX SPEC - TOUCH, BLOCK, HIT, FEEDBACK

The gameplay contact contract for the world. Companion to `OVERWORLD_PLANNING.md` (visual size and real-world meters), `DUNGEON_OVERHAUL.md` (room templates, portals, and dungeon sessions), `COMBAT_OVERHAUL.md` (fight readability), `GRAPHICS_SPEC.md` (renderer contracts), and `VFX_OVERHAUL.md` (telegraphs and impact presentation).

This spec answers a different question than the scale plan. `OVERWORLD_PLANNING.md` says how tall and wide things should read. This doc says what the player and sim can touch: which bodies block movement, which bodies can be targeted, which attack or spell volumes count as a hit, what geometry exists in dungeon rooms, and what feedback fires when contact happens.

The rule stays the same as the rest of the project. The headless deterministic core remains the system of record. Collision, hit tests, targeting, and combat contact are sim-space facts in Dota units. The renderer shows them, explains them, and adds feel, but it never decides who got hit.

---

## 0. WHERE WE ARE

**Status: shipped.** The full rollout in §10 is live and all ten acceptance gates in §9 pass. The contract lives in `src/core/collision.ts` (body resolver, hit helpers, obstacle normalization, segment sweeps), with types in `src/core/types.ts`, authored static bodies in `src/data/world/props.ts` and `src/engine/terrain.ts`, dungeon geometry in `src/data/room-templates.ts`, the debug overlay and cast preview in `src/engine/scene.ts` plus `src/core/cast-preview.ts`, contact labels in `src/ui/hud.ts`, and validation in `src/test/data-lint.test.ts` (collision contract, test 25). Capsule and rect shapes resolve too, so dungeon walls use real capsule geometry rather than circle stand-ins. The section below records the starting point the work built on.

The code already had most of the primitives. What was missing was the contract that ties them together.

**Units have one gameplay body.** Every `Unit` has a `radius` in sim units. Movement separation, attack reach, projectile hits, zone containment, selection rings, and AI spacing all lean on that circle. Heroes spawn with `TUNING.unitRadiusHero`; creeps use tier radii; raid bosses can scale collision through `TUNING.raidBossRadiusScale`.

**Movement collision is circle-based.** `resolveCollisions` separates live units, separates units from `sim.obstacles`, pushes units out of temporary wall zones, and clamps units inside `sim.bounds`. `steerToward` also reads nearby units and obstacles so a unit can slide around blockers.

**Static obstacles exist, but content does not declare them consistently.** `SimOptions.obstacles` supports circle blockers today. The missing piece is data: town buildings, props, dungeon pillars, rocks, doors, and landmarks need an authored `CollisionBody` so the sim knows which visuals are solid.

**Dungeons are bounded rooms.** `DungeonSession` sets `sim.bounds` from `RoomTemplate.size`. Room templates already declare `size`, `connectors`, `spawnAnchors`, and prop hints, but they do not yet declare wall segments, door clearance, solid props, or no-spawn zones.

**Spells and attacks already use hit volumes.** The core has closed vocabularies for `unit-target`, `point-target`, `skillshot`, `ground-aoe`, projectiles, zones, radius selectors, line zones, and attack modifiers. The hit math is spread across `Sim`, `effects`, `combat`, and AI utility code:

- `unitsInRadius` expands the query by part of each target's unit radius.
- Linear projectiles sweep a segment and hit the first valid unit inside `projectile.width / 2 + unit.radius`.
- Homing projectiles hit near the target center and include part of target radius.
- Circle and line zones include part of unit radius.
- Basic attacks are target-locked, with projectile attacks always landing once launched unless the target dies.

**Feedback is event-driven.** The sim emits `damage`, `attack-impact`, `attack-launch`, `projectile-hit`, `zone-spawn`, `aoe-burst`, `status-apply`, and related events. The scene already turns some of these into hit flash, lunge flash, camera shake, projectiles, rings, telegraphs, and impact VFX. The HUD already has world-unit hover cards, action hints, status pips, toasts, and combat readouts.

**The gap, in one line.** The game has circles, lines, zones, events, and VFX. It needs one authored contract that says which object uses which body, which body participates in which test, and which feedback proves the test happened.

---

## 1. PRINCIPLES

1. **The sim owns contact.** Movement blocks, target validity, attack hits, spell hits, status application, and damage application are core facts. Renderer raycasts and mesh bounds can help the player point at things, but they do not decide gameplay outcomes.

2. **One unit can have several bodies.** A hero has a movement body, a target body, a spell-hit body, and a pick body. They usually derive from the same radius, but they serve different jobs. A big boss may have a generous pick body and spell-hit body while keeping movement collision small enough for the room.

3. **Author intent in data, derive the common case.** Most units inherit from `WorldSize.footprintM` and `TUNING.unitRadius*`. Special cases declare only what differs: a serpent has an elongated visual body but a circular movement body; a landmark is visible and targetable but may not block movement; a dungeon pillar blocks movement and projectiles.

4. **Collision is fair before it is realistic.** A collider should match what the player expects from the camera. A visually huge overhang can be non-blocking. A tiny readable weak point can be targetable. Fairness means the player understands why the command succeeded, missed, or stopped.

5. **Dungeon geometry is authored gameplay.** Room walls, doors, pillars, blockers, hazards, spawn areas, and navigation clearance belong in `RoomTemplate` data. A generated dungeon should never place a pack, boss, chest, or exit where the player's body cannot reach it.

6. **Spells describe their real hit volume.** A spell's targeting UI, AI threat estimate, VFX telegraph, and hit test all use the same shape: circle, line, cone, projectile, follow aura, or targeted impact. If a spell hits as a line, the ground should show a line.

7. **Every contact gets feedback.** A landed attack, blocked path, dodged zone, immune hit, spell miss, projectile disjoint, crowd-control application, and collision stop each need a readable response. Feedback can be small, but silence makes the sim feel wrong.

8. **Accessibility is part of readability.** Hit feedback cannot depend only on color, camera shake, or screen flash. Reduced-motion settings still need clear rings, outlines, text, sound, and timing.

---

## 2. COLLISION MODEL

The base structure is small and explicit. It can live beside `WorldSize`, but it is a gameplay contract rather than an art contract.

```ts
// src/core/types.ts (proposed)
export type CollisionLayer =
  | 'unit'
  | 'static'
  | 'wall'
  | 'door'
  | 'hazard'
  | 'trigger'
  | 'loot'
  | 'decor';

export type CollisionShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'capsule'; halfLength: number; radius: number; angle?: number }
  | { kind: 'rect'; width: number; depth: number; angle?: number };

export interface CollisionBody {
  layer: CollisionLayer;
  shape: CollisionShape;
  blocksMovement?: boolean;
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
  targetable?: boolean;
  interactable?: boolean;
  pickPadding?: number;
  feedback?: CollisionFeedbackHint;
}

export interface CollisionFeedbackHint {
  stopSound?: 'stone' | 'wood' | 'metal' | 'flesh' | 'magic';
  impactVfx?: 'spark' | 'dust' | 'shield' | 'blood' | 'immune';
  label?: string;
}
```

The first implementation should support only circle obstacles because `sim.obstacles` already does. The data shape can still name capsules and rectangles so dungeon walls, gates, and wide props have a place to go. Until those shapes land in core, lint should reject authored non-circle gameplay blockers or mark them `visualOnly`.

### Body Types

- **Movement body:** the shape that blocks unit locomotion. Today this is a circle for units and `sim.obstacles`.
- **Target body:** the shape used by unit-target spells and attacks to decide if a clicked or AI-selected unit is valid. Usually the same unit circle plus target padding.
- **Hit body:** the shape used by projectiles, zones, cleaves, and radius selectors. Usually the unit circle, but bosses and long creatures can expand it.
- **Pick body:** the renderer/UI affordance for mouse hover, selection, and command targeting. This may be larger than the hit body so tall or thin models are easy to click.
- **Interaction body:** the radius or shape for chests, NPCs, portals, quest givers, doors, shrines, and loot.

The common case derives all unit bodies from `Unit.radius`. A resolver can make that explicit:

```ts
export interface ResolvedUnitBodies {
  movement: CollisionBody;
  target: CollisionBody;
  hit: CollisionBody;
  pick: CollisionBody;
}
```

---

## 3. UNITS: HEROES, CREEPS, BOSSES, NPCS, SUMMONS

Every sim unit needs body coverage. The spec covers all world actors, including units inside dungeons.

**Heroes and standard creeps.** Movement, target, and hit bodies are all circles derived from `Unit.radius`. Pick body uses the same circle plus a small UI padding so left-clicks feel reliable.

**Large creeps and bosses.** Boss visuals can be larger than their sim radius. The hit body should grow enough that spells and clicks feel fair, while movement can stay smaller if the room needs clearance. This difference must be declared, visible in debug overlay, and checked against `OVERWORLD_PLANNING.md`'s `footprintDecoupled` flag.

**Serpentine, flying, and wide units.** A long serpent or winged creature can use a circular movement body for pathing, a wider hit body for spells, and a pick body that follows the rendered silhouette. The rule is simple: if the player sees a body occupying space, spells should not pass through the middle of it.

**NPCs and quest givers.** NPCs are pickable and interactable. They can be non-blocking in crowded towns if the UX requires it, but that must be an authored choice. Recruit NPCs need a clear interaction radius and a hover card that explains the action.

**Summons and wards.** Summons use unit bodies. Wards can be static, targetable, and blockable or non-blocking by spec. Healing Ward style units should be easy to click and easy to identify as a valid target.

---

## 4. WORLD GEOMETRY

Static world bodies turn visible objects into gameplay objects. The collision contract should be conservative at first.

### Overworld

Town buildings, props, trees, rocks, gates, shrines, portals, chests, and landmarks should declare one of three collision modes:

- **Solid:** blocks movement. Used for buildings, large rocks, pillars, walls, closed gates, and major landmarks.
- **Soft:** does not block movement but can be picked or interacted with. Used for portals, quest markers, chests, shrines, and NPC service points.
- **Decor:** visual only. Used for grass, small clutter, foliage scatter, birds, dust, and tiny props the player should not snag on.

Solid props need enough clearance around town services, roads, portals, and camps. A lint pass should check that authored points are outside solid bodies by `activeHero.radius + clearance`.

### Dungeons

`RoomTemplate` should grow from layout hints into gameplay geometry:

```ts
export interface RoomTemplate {
  // existing fields
  size: Vec2;
  connectors: { side: 'n' | 's' | 'e' | 'w'; at: Vec2 }[];
  spawnAnchors: Vec2[];

  // proposed fields
  walls?: CollisionBody[];
  blockers?: CollisionBody[];
  doors?: DungeonDoorBody[];
  noSpawnZones?: CollisionShape[];
  safeZones?: CollisionShape[];
}

export interface DungeonDoorBody {
  id: string;
  connectorIndex: number;
  body: CollisionBody;
  openBody?: CollisionBody;
  clearHeightM?: number;
  clearWidth: number;
}
```

Room geometry must pass these checks:

- The entrance, exits, reward object, and guardian anchor are reachable by a hero-sized body.
- Every `spawnAnchor` has enough free space for the planned pack size and the largest eligible creep.
- Boss rooms have a boss-safe area, a player-safe entrance area, and enough open ring space for dodge patterns.
- Door widths clear the largest unit expected to route through them, plus separation margin.
- Temporary wall zones cannot permanently seal every exit unless the spell duration is short and the encounter is designed for it.
- Treasure and rest rooms have no hostile spawn anchors inside the safe zone.

---

## 5. ATTACKS AND SPELL HITBOXES

Attacks and spells already use the same closed effect vocabulary. This spec makes each volume explicit so targeting UI, AI, hit tests, and VFX agree.

### Basic Attacks

Melee attacks are target-locked checks. A unit may start windup when the target is in attack range and facing constraints pass. On impact, the sim emits `attack-impact` and `damage` if the attack lands.

Ranged attacks use homing projectiles. Attack projectiles are intentionally non-disjointable today: once fired, they land unless the target dies. That rule should stay explicit because it affects feel and balance.

Attack feedback requirements:

- Launch: weapon trail, lunge flash, bow/gun/cast sound.
- Impact: small hit flash on target, impact VFX at target body, optional damage number or combat readout entry.
- Crit or proc: stronger flash, distinct sound, bounded shake, and a floating label such as `CRIT`, `BASH`, `BURN`, or item proc name.
- Miss, evade, disarm, blind, immune, or invulnerable: a visible `MISS`, `EVADE`, `BLOCKED`, or `IMMUNE` response over the target.

### Unit-Target Spells

Unit-target spells use target validity first, then their effect nodes. Targeting should respect team, untargetable, magic immunity where applicable, cast range, and line-of-sight once vision blockers exist.

Feedback requirements:

- Hovering a valid target while targeting shows an outline or ring and a HUD hint.
- Hovering an invalid target shows a red or muted ring plus a short reason when useful: `Magic immune`, `Out of range`, `Invalid target`.
- Cast start emits cast VFX on the caster and an optional tether or marker on the target.
- On hit, target receives impact VFX, status pips, and combat text if damage, healing, immunity, or crowd control occurs.

### Point-Target And Ground AOE

Point-target spells place a shape in the world. The shape can be instant (`aoe-burst`) or persistent (`zone`).

The targeting preview must use the exact hit volume:

- Circle AOE shows a circle with radius in sim units.
- Line AOE shows width and length.
- Follow zones show a ring attached to the carrier.
- Delayed zones show both danger area and time-to-impact.

Hit math should include part of target radius as it does today. The spec should standardize that expansion rather than leaving each primitive to choose its own value. The default should match the current `zoneContains` and `unitsInRadius` behavior:

```ts
effectiveRadius = authoredRadius + target.hitRadius * 0.5;
```

### Skillshots And Projectiles

Linear projectiles are swept capsules. The current rule is:

```ts
segPointDist(projectileSegment, unit.pos) <= projectile.width / 2 + unit.radius;
```

That should become named policy:

- Projectile `width` is the gameplay width, not just the visual trail width.
- The first valid unit along the swept segment is hit.
- `hitsAllies` controls friendly collision.
- `disjointable` controls whether target-locked projectiles can be dropped.
- Future `blocksProjectiles` bodies can intercept linear projectiles before a unit does.

Feedback requirements:

- Skillshot preview shows line width, endpoint, and blocked segments when projectile blockers exist.
- Projectile hit emits impact VFX at the target hit body, not only at unit center.
- Projectile expire emits a small miss/fade at the final point so a whiff reads as a whiff.
- If a projectile is blocked by a wall or shield, it needs a blocked impact, not silent deletion.

### Cleave, Bounce, Aura, And Repeat Effects

These are hitbox features too:

- Cleave uses a declared radius or arc behind the primary target.
- Bounce uses a search radius around the last hit unit and should show the jump path.
- Auras use follow zones or aura specs and should show edge feedback when selected or inspected.
- Repeat effects such as Omnislash-style retargeting should make each selected hit legible through short streaks, flashes, or target ticks.

---

## 6. TARGETING, PICKING, AND COMMAND UX

The player interacts through the pick body. The sim resolves through target and hit bodies. Both must feel like the same object.

Targeting rules:

- Hovering a unit shows its pick body, team color, and action hint.
- Active ability targeting shows valid targets brighter and invalid targets muted.
- Attack-move and attack-unit modes use distinct cursors or rings.
- Point targeting snaps preview to ground and respects room bounds.
- If the player clicks a solid obstacle while trying to move, the order resolves to the nearest reachable point on the obstacle shell.
- If the player clicks an interactable, the command uses interaction range, not movement collision.

Debug tooling should expose the layers:

- A dev overlay shows movement bodies, hit bodies, pick bodies, obstacles, zone volumes, projectile sweeps, and room bounds.
- Hovering a debug body shows id, layer, shape, radius/width, movement/projectile blocking, targetability, and source data file.
- The overlay works in overworld, dungeon, raid, and gym sims.

---

## 7. FEEDBACK AND UI/UX NICETIES

Contact should always answer the player's question: "what happened, to whom, and why?"

### Landed Hits

When damage, healing, mana burn, or a status lands on a unit:

- The target flashes in the damage/heal/status color.
- A small impact VFX appears at the hit body edge or center.
- The HP/mana bar responds immediately.
- Status pips appear or refresh with a short pulse.
- Combat text or the combat readout reports important outcomes: damage, heal, crit, immune, blocked, resisted, captured, interrupted.

### Misses, Blocks, And Immunity

Misses need feedback too:

- `MISS` for attack miss or blind.
- `EVADE` for evasion.
- `IMMUNE` for magic immunity or invulnerability.
- `BLOCKED` for projectile blocker, shield, or wall impact.
- `OUT OF RANGE` or `NO PATH` for commands that cannot be issued.

These labels should be short, throttle per unit, and avoid spam in big fights. The combat readout can aggregate repeated messages.

### Movement Collision

When movement stops because of collision:

- A brief footstep skid, dust puff, or shoulder-bump animation can play for large blockers.
- The clicked move marker should slide to the reachable shell point if the command resolver adjusts the destination.
- A blocked door or gate should pulse its outline and show its interaction hint.
- Repeated blocked movement should stay quiet after the first cue so pathing does not feel noisy.

### Dungeon Readability

Dungeons need extra feedback because walls and doors define the space:

- Door previews show open, locked, reward, and blocked states.
- Solid room props use subtle ground contact shadows or rim highlights when hovered.
- Boss-safe, no-spawn, and hazard areas can be visible in debug and represented through art in shipped mode.
- When a room exit unlocks, the door changes state with sound, light, minimap marker, and HUD text.

### Accessibility

- Reduced motion turns camera shake into ring pulse, hit flash, and sound.
- Colorblind-safe hit states use labels and shapes as well as color.
- Important cues have both visual and audio forms.
- Damage numbers and combat text can be scaled or disabled independently.

---

## 8. DATA AND FILE HOOKS

Smallest-diff path:

- **`src/core/types.ts`**: add `CollisionLayer`, `CollisionShape`, `CollisionBody`, and optional collision fields on world data types.
- **`src/engine/world-size.ts` or new `src/core/collision.ts`**: add a resolver from `WorldSize`/`Unit.radius` to movement, target, hit, and pick bodies.
- **`src/core/sim.ts`**: promote `obstacles` from anonymous circles to authored static bodies; keep circle support first.
- **`src/core/movement.ts`**: keep circle collision, then add capsule/rect resolution only when data starts using those shapes.
- **`src/core/effects.ts` and `src/core/sim.ts`**: route radius, zone, and projectile tests through shared body helpers.
- **`src/data/room-templates.ts`**: add dungeon walls, blockers, doors, no-spawn zones, and safe zones.
- **`src/data/world/props.ts`**: add overworld prop/building collision mode and body.
- **`src/engine/scene.ts`**: draw debug overlays, target outlines, blocked movement cues, and impact positions from resolved bodies.
- **`src/ui/hud.ts`**: add invalid-target reasons, hit/miss/immune combat labels, and clearer targeting hints.
- **`src/test/data-lint.test.ts`**: validate collision coverage, room reachability, spawn clearance, and spell VFX volume parity.

---

## 9. ACCEPTANCE AND GATES

1. **Every gameplay object resolves contact.** Heroes, creeps, bosses, summons, wards, NPCs, portals, chests, doors, solid props, and dungeon blockers resolve movement/pick/target/interaction bodies as appropriate.

2. **Static collision is declared in data.** No solid building, dungeon prop, portal, chest, or door relies on an untracked renderer-only mesh for gameplay contact.

3. **Dungeon room reachability passes.** For every `RoomTemplate`, a hero-sized body can reach entrance, exits, reward anchors, spawn anchors, and guardian anchors without crossing a solid body.

4. **Spawn clearance passes.** Planned packs and guardians fit at their anchors with clearance for their movement bodies.

5. **Spell volumes match their preview.** Any ability with a circle, line, projectile width, aura radius, or delayed zone renders the same shape it uses for hit tests.

6. **Projectiles have blocker policy.** Linear projectile behavior is explicit for unit hits, ally hits, walls, doors, shields, and expire points.

7. **Boss and large-creature hit bodies are declared.** Any unit whose visual footprint is intentionally decoupled from movement collision has a hit/pick policy and a debug overlay.

8. **Feedback fires for success and failure.** Damage, heal, crit, status, immune, miss, evade, block, projectile expire, blocked movement, target invalid, and room exit unlock each produce a visible or audible cue.

9. **Accessibility holds.** Reduced motion still shows impact, invalid target, and blocked-path feedback. Color is never the only carrier for a critical contact state.

10. **Determinism stays intact.** Collision and hit tests run in the headless sim. Presentation cues consume sim events and do not change outcomes. `boundary.test.ts`, dungeon tests, and combat tests stay green.

---

## 10. ROLLOUT

1. **Name the bodies.** Add types and resolvers for unit movement, target, hit, pick, and interaction bodies. Keep current circle behavior.

2. **Declare static circles.** Move obvious solid props and dungeon blockers into data as circle obstacles. Thread them into `SimOptions.obstacles` for overworld and dungeon sims.

3. **Make dungeons spatial.** Add walls, blockers, doors, no-spawn zones, safe zones, and reachability lint to `RoomTemplate`.

4. **Unify spell hit helpers.** Route radius, zone, projectile, cleave, bounce, and aura checks through named hit-body helpers. Keep current numeric behavior unless a test proves it wrong.

5. **Add targeting and feedback polish.** Target outlines, invalid-target reasons, blocked movement pings, projectile miss/block impacts, status-pip pulses, and accessible combat labels.

6. **Broaden shapes only when needed.** Add capsule/rect collision after circle bodies are stable and a dungeon wall or wide prop truly needs it.

End state: one debug overlay can answer every contact question. Why did the hero stop? Which body did the projectile hit? Why did the spell miss? Can this boss be clicked where it is visibly standing? Can this dungeon room spawn its pack without trapping the player? The sim answers once, and the UI makes the answer readable.
