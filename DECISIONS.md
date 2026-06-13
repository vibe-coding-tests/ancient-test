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
- 2026-06-12: Phase 1 starts with a 2600g Dawnshade stipend (`TUNING.startingGold`) so the acceptance demo can buy Blink immediately; long-term economy balance is Phase 2+.
- 2026-06-12: Added a tutorial kobold camp and moved Pudge near Dawnshade so capture, companion fielding, recruitment, and 1-5 swap are reachable in the first minute.
- 2026-06-12: Save imports and slot loads now validate version, region/hero/creep references, party bounds, and core shape before starting a game.
- 2026-06-12: Map mode uses procedural in-world markers for town, shrine, camps, and recruitable heroes as the Phase 1 far-readability layer instead of a separate minimap UI.
- 2026-06-12: Added Luna, Sven, and Axe as data-only heroes with no exotic slots; placed them in Tranquil Vale temporarily so the one-region build can recruit/test them before their lore regions exist.
- 2026-06-12: Added spell amplification and status resistance to the stat vocabulary for Kaya/Sange identity instead of treating those items as cosmetic stat sticks.
- 2026-06-12: Increased procedural model tessellation and switched unit materials to smooth Lambert shading; preserves asset-free stylization while reducing placeholder-low-poly jaggedness.
- 2026-06-12: Combat feel pass keeps one shared core: faster AI cadence, role-based macro formations, taunt as forced attacks, and a damage-threat boss controller for 5v1 raids.
