# DECISIONS

Dated one-liners for every nontrivial call, per SPEC §0.

- 2026-06-12: Core sim works in raw Dota units (MS 300, ranges 600, etc.); renderer divides by 100 for world units. Dota numbers port verbatim, `tuning.ts` scales globally.
- 2026-06-12: Added two generic composition tools to the effect vocabulary instead of spending exotic slots: `repeat` (count/interval/sub-effects) and target selectors (e.g. `random-enemy-in-radius`, `random-point-in-ring`). Omnislash, Freezing Field, and Chain Frost all compose from primitives; zero exotics spent in Phase 1.
- 2026-06-12: Trigger system generalized: `on-cast`, `on-damage-taken`, `on-attack-land`, `on-kill`, `on-nearby-death`, `on-nearby-enemy-cast` — the spec's listed mechanic flags (Blink lockout, Aftershock, Flesh Heap, Magic Wand) are instances of one generic trigger primitive.
- 2026-06-12: Ability skill points auto-assign on level-up (ult at 6/12/18, basics round-robin via per-hero `skillOrder`). Manual skilling adds UI without Phase-1 value; talents (10/15/20/25) stay manual per spec.
- 2026-06-12: Phase 1 recruitment: non-starter heroes stand at lore spots in Tranquil Vale and join via a Binding Sigil interaction (right-click). The full Find→Trial→Bind chain is Phase 2 scope; this placeholder is replaced then (recruitment framework is not on the P1 checklist; mid-fight hero swap requires a 2nd hero, so some recruitment path must exist in P1).
- 2026-06-12: Power Treads cut from P1 item list in favor of Arcane Boots (tread-switching micro deserves real treatment later; Arcane Boots' mana-battery identity survives intact).
- 2026-06-12: Party wipe in overworld: respawn at town shrine, lose 10% gold (Diablo-style death tax), wild camps the player left reset via normal respawn timers.
- 2026-06-12: Wild creeps leash-reset (return to camp and heal to full) beyond ~1800 units from camp, preventing drag-cheese.
- 2026-06-12: Cleave deals full pre-armor physical to secondary targets (canon-faithful); crits use plain seeded RNG, not pseudo-random distribution (simplest implementation that works).
- 2026-06-12: Attack projectiles always land on arrival (not disjointable) in P1; spell projectiles disjoint on blink/invis/cyclone per canon.
- 2026-06-12: Capture thresholds by tier: small 30%/2.5s, medium 25%/3.0s, large 20%/3.5s, ancient 15%/4.5s — all in tuning.ts.
- 2026-06-12: Entourage creep death: creep returns to storage "fainted" for 90s (tuning), then fieldable again. Keeps death meaningful without dead content.
