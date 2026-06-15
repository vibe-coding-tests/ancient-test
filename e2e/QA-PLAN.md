# Playwright QA Plan — ANCIENTS

A full test plan for the browser game, from bootup through every major feature. It maps what to test, how to test it, and which run mode to use for each case.

ANCIENTS is a Three.js + TypeScript action RPG built with Vite. Game logic runs in a deterministic headless sim at 30 Hz, and a DOM HUD overlays the WebGL canvas. That split shapes the whole plan: most behavior is testable without WebGL through the in-page harness, and only visuals need the real renderer.

## How tests run

Three modes, picked per case:

- **Headless logic** (`?test=1&render=headless`): no WebGL, sim runs at full speed, time is stepped synchronously. Use for anything you can assert as state. This is the default and the bulk of the plan.
- **Headless HUD** (`?test=1&render=headless&hud=1`): no WebGL, but the real HUD and input handlers are mounted. Use for DOM and control tests that need stable UI coverage without loading 3D assets.
- **WebGL visual** (`?test=1`, real renderer): boots the Three.js scene. Use only for rendering, screenshots, and "does it draw without crashing" checks.

Three entry points drive the game:

- `?test=1` auto-boots past the title screen straight into a fresh seeded game. Optional params: `hero`, `region`, `seed`, `render=headless`, `hud=1`.
- `window.__test` — the QA control surface (`src/systems/test-harness.ts`): boot, step time, read state, apply cheats.
- `window.__game` — the live `Game` instance, the escape hatch for assertions the snapshot does not cover.

Existing helpers live in `e2e/helpers.ts`: `boot`, `state`, `fastForward`, `waitForPlayableUi`, `skipActiveCinematic`, `attachScreenshot`, `watchPageErrors`, `expectNoPageErrors`.

### Rules of the road

- Prefer `fastForward(seconds)` over `page.waitForTimeout`. Real-time waits are flaky; stepped time is deterministic.
- Pass a fixed `seed` to any test that depends on world layout or loot.
- Assert on `__test.state()` or `__game` first; fall back to DOM only when the DOM is the thing under test.
- Run `watchPageErrors` / `expectNoPageErrors` in every spec. A clean console is itself a test.
- There are no `data-testid` attributes. Selectors are stable element IDs and `[data-*]` content hooks, listed at the end.

### Priorities

- **P0** — boot, core loop, save/load, no-crash. If these fail the build is dead.
- **P1** — major features players touch every session: combat, shop, progression, dungeons.
- **P2** — deeper systems: raids, forge, recruitment, settings.
- **P3** — edge cases, visual polish, broad coverage sweeps.

---

## Suite 1 — Bootup and startup

The first thing any player sees, and the first thing to break.

### 1.1 Title screen (P0, WebGL)

The title screen only appears on a normal boot, not under `?test=1`. To reach it, navigate to `/` with no test param.

- Title screen renders: `#title-screen` visible, `#new-game` present.
- **New Game** opens the starter picker; the three starter cards show `[data-pick="juggernaut"]`, `[data-pick="crystal-maiden"]`, `[data-pick="sniper"]`.
- **Back** (`#back-title`) returns to the title.
- Continue slots `[data-load="0|1|2|auto"]` appear only when a matching save exists in `localStorage`.
- Picking a starter shows the loading screen, then drops into gameplay.

### 1.2 Loading screen (P1, WebGL)

- `#loading-screen` appears during asset preload with `.loading-label` and `.loading-progress`.
- It hides (`.hide` class, `display: none`) once the scene is built. `waitForPlayableUi` covers this.

### 1.3 Harness boot (P0, headless)

- `boot(page, { render: headless })` resolves and `__test.ready()` returns true.
- `__test.state()` returns a populated snapshot: `ready: true`, a region id, a non-empty `party`.
- Boot into each of the 10 regions by id and confirm `regionId` matches and the party spawns. Regions: `tranquil-vale`, `nightsilver-woods`, `icewrack`, `devarshi-desert`, `shadeshore`, `vile-reaches`, `quoidge`, `hidden-wood`, `mount-joerlak`, `mad-moon-crater`.
- Boot each of the 3 starters via `?hero=` and confirm the right hero is active.
- No console or page errors across every boot.

### 1.4 WebGL canvas (P0, WebGL)

- `#game-canvas` exists and has a non-zero backing size after boot.
- The canvas resizes with the viewport.
- A real-renderer boot produces no WebGL or shader errors in the console.

### 1.5 Prologue cinematic (P1, both)

A fresh save in Tranquil Vale plays the prologue (`prologue-moon-breaks`).

- `#cinematic-layer` is visible and `__game.cinematic.active` is true on first boot there.
- Cinematic controls work: click / Space / Enter advance, Tab fast-forwards, Esc holds to skip. `[data-cinematic="next|ff|skip"]` are present.
- `skipActiveCinematic` clears it; `__game.cinematic.active` goes false and the HUD becomes playable.
- Region arrival cutscenes play on first entry to a region.
- `e2e/story.spec.ts` covers the player-input path for the prologue overlay; `src/test/data-lint.test.ts` covers catalogue reachability so registered cut-scenes cannot drift out of runtime use.

---

## Suite 2 — HUD and UI shell

The DOM overlay that frames everything. Build it from `src/ui/hud.ts`.

### 2.1 Top bar (P1, both)

- `#top-bar` shows region name (`.region`), day/night dial, gold, stamina, exploration %, and resin.
- Gold display tracks `__test.addGold(n)`.
- Journal and Codex buttons exist (`[data-open="journal"]`, `[data-open="codex"]`).

### 2.2 Party column and hero panel (P1, both)

- `#party-col` shows one frame per party member, with `[data-swap="0".."4"]`.
- The active hero's frame carries `.active`.
- `#hero-panel` shows the active hero portrait, HP/mana/XP bars, ability slots, item slots, and `#talent-open`.
- Fielded creeps appear as entourage frames.

### 2.3 Minimap (P2, WebGL)

- `#minimap` is a 160×160 canvas that renders without error.
- It draws camps, gates, gyms, the town, and the player marker (smoke check that the canvas is non-blank).

### 2.4 Toasts, floaters, hints (P2, both)

- `#toast-col` shows toasts; killing an enemy or picking up loot produces one.
- `#floater-layer` shows damage numbers during combat.
- `#hud-hint` shows context hints near recruitable heroes, capturable creeps, gyms, gates, and shops.

### 2.5 Modals open and close (P1, both)

For each modal, open it, confirm `#modal-root` loses `.hidden` and `.modal-card` renders, then close it with `#modal-close` and with Esc. Modals:

| Modal | Open with | Notes |
|---|---|---|
| Party | Tab | Roster, echoes, gambits, creep storage |
| Shop | B (in town) | Buy/sell tabs |
| Menu | Esc | Save/load, settings, quit |
| Talents | level-up or `#talent-open` | Talent picks |
| Journal | J or `[data-open="journal"]` | Quests, factions, badges |
| Codex | K or `[data-open="codex"]` | Lore/Heroes/Atlas/Cinematics |
| Services | Y (in town) | Boss reruns, forge, armory, black market |
| Dungeon entry | interact at a portal | Tier and modifier picks |

Opening one modal should not leave another open. Esc inside a modal closes it rather than reopening the menu.

---

## Suite 3 — Controls

The control layer in `src/systems/input.ts` (`InputController`). This is the layer that turns real keyboard and mouse events into game orders, and **nothing else in this plan exercises it** — every other suite calls `__game.orderMove()` and friends directly, which bypasses input entirely. Control bugs (wrong mapping, a modal eating keystrokes, quickcast firing when it should arm targeting, shift-queue dropped, a key still working mid-cinematic) only surface when tests drive the actual DOM events.

### Testing principle

Drive controls the way a player does, then assert the resulting game state:

- **Dispatch real events**, never call the `__game` order method under test. Use `page.keyboard.press('q')`, `page.mouse.click(x, y, { button: 'right' })`, `page.mouse.wheel`, and `dispatchEvent` for `blur`. The canvas listens on `window` for keys and on `#game-canvas` for mouse, so focus the page first.
- **Assert via `__game` / `__test.state()`** afterward: the order issued, the targeting state, the active index, the camera mode, the toggle that opened.
- **Spy on orders** where the end-state is ambiguous: before the event, wrap the method (e.g. `__game.orderMove`) to record its arguments, dispatch, then read what was captured. This proves the *binding*, not just that movement eventually happened.

### Pointer determinism caveat

Right/left-click behavior depends on `scene.pick()` resolving `hoverUid` / `hoverGround` from screen coordinates. In **headless** mode the pick does not project world coordinates, so pointer-targeted cases need one of:

- **WebGL boot** with a known camera, computing screen coords for a known world point, or
- **seeding hover** directly (`__game.input.hoverGround = {x,y}` / `hoverUid = n`) right before dispatching the click.

Keyboard controls that don't depend on hover (swap, stop, dash, menu toggles, sprint, save, camera toggle) are fully testable in **headless**. Split the suite on that line.

### 3.1 Keyboard mapping — hover-independent (P1, headless)

Press each key and assert the bound action fired. Spy on the target method or read state.

| Key | Expected |
|---|---|
| 1–5 | `trySwap(n-1)`; `state().activeIdx` changes |
| S | `orderStop` issued |
| Space (overworld) | `tryDash` issued |
| M | `scene.toggleCameraMode()`; camera mode flips |
| Tab | party modal toggles |
| B (in town) | shop toggles |
| G (at a service NPC) | that town service opens (diegetic; no global services key) |
| J / K | journal / codex toggle |
| N | `useNeutralActive` issued |
| F5 | `saveToSlot(0)`; `ancients.save.1` written |
| Esc (no targeting) | menu toggles |

### 3.2 Keyboard mapping — pointer-dependent (P1, WebGL or seeded hover)

| Key | Setup | Expected |
|---|---|---|
| Q/W/E/R/D/F, no-target/toggle | controlled unit | casts immediately |
| Q…F, point/skillshot, quickcast on | hover ground set | fires at cursor (`fireAbilityQuick`) |
| Q…F, targeted, quickcast off | — | arms `targeting={ability,slot}`; no cast yet |
| Z/X/C/V (within `activeItemSlots`) | quickcast on | `useItem(slot)` at cursor |
| Z/X/C/V, quickcast off | — | arms `targeting={item,slot}` |
| A | controlled unit | `attackMovePending=true`; hint toast shown |
| T | hovered/selected capturable | `tryCapture(uid)` |
| G | near interactable | `tryInteract` |

### 3.3 Mouse mapping (P1, WebGL or seeded hover)

| Action | Setup | Expected |
|---|---|---|
| RMB on ground | hover ground | `orderMove(point)` |
| RMB on hostile | hover hostile uid, has driver | `orderAttack(uid)` |
| RMB on NPC hero | hover npc | `tryRecruit(uid)` |
| RMB on team-0 unit in live gym | `liveGym` active | `selectLiveGymUnit(uid)` |
| RMB held (>150ms) | hover ground | move order repeats each ~150ms via `update()` |
| LMB, targeting armed | pending cast | `fire()` resolves the cast; targeting clears |
| LMB, attack-move pending on enemy | hover hostile | `orderAttack` |
| LMB, attack-move pending on ground | hover ground | `orderAttackMove(point)` |
| LMB on unit, idle | hover uid | selects unit (`scene.selectedUid`), control stays on hero |
| Wheel up/down | no modal | `scene.zoomBy`, clamped to min/max |
| Right-click | canvas | browser context menu suppressed |

### 3.4 Modifiers (P2, both)

- **Shift + order** queues it: shift-RMB / shift-ability sets `queued=true` on the issued order.
- **Alt** held → `setSprintHeld(true)` on keydown, `false` on keyup; move speed rises while held.
- Sprint released on window **blur** (Suite 3.7).

### 3.5 Input capture and gating (P1, both)

- **Modal open** (`uiModalOpen`): gameplay keys are swallowed — only Tab and B pass through to toggle their modals. Confirm e.g. Q, S, Space do nothing while a modal is up.
- **Cinematic active**: LMB and Space/Enter call `cinematicAdvance`; Tab holds fast-forward (release stops it); Esc holds to request skip (release cancels). Gameplay bindings do not fire mid-cinematic.
- **Esc precedence**: with targeting armed, Esc cancels targeting and does *not* open the menu; a second Esc opens the menu.
- **Live-mode guards**: in `liveGym` / `liveRaid`, T, G, B, Y, N are no-ops; A without a controlled unit shows the "spend a Captain Call" message; Space issues a Captain Call instead of dashing.

### 3.6 Movement and camera behavior (P1, headless)

With orders issued through the input layer where possible:

- Move order advances the unit over `fastForward`; facing updates with direction.
- `orderStop` halts it; velocity ~0 next step.
- Attack-move advances and engages hostiles en route.
- Dash consumes stamina and is blocked on cooldown / no stamina.
- M cycles map-view ↔ follow.

### 3.7 Focus loss (P2, both)

- Dispatching `blur` on the window clears `rmbHeld` and calls `setSprintHeld(false)`: no runaway movement and no stuck sprint after the tab loses focus mid-drag.

---

## Suite 4 — Heroes, abilities, progression

### 4.1 Starter spawn (P0, headless)

- Each starter boots with the expected level, full HP/mana, and a working ability set.
- `state().party[0].heroId` matches the requested hero.

### 4.2 XP and leveling (P1, headless)

- `__test.addXp(n)` raises the active hero's level when the threshold is crossed.
- Stats scale with level (maxHp, maxMana grow).
- Crossing a level that grants a talent auto-opens the talent modal.

### 4.3 Ability casts (P1, headless)

- `castAbility(slot)` on a hero with mana fires the ability, deducts mana, and starts its cooldown.
- A targeted ability without quick-cast arms targeting mode; LMB confirms, Esc cancels.
- Quick-cast (default on) fires at the cursor with no confirm.
- Cooldowns block recasts until elapsed (`fastForward` past the cooldown re-enables it).

### 4.4 Talents and facets (P2, headless)

- Talent picks apply through `#talent-open`.
- Hero echoes accrue from kills and unlock talents/facets per the party modal.

### 4.5 Hero swap (P1, headless)

- Keys 1–5 swap the active hero; `state().activeIdx` updates.
- Swap mechanics (cooldown, on-swap heal) behave per design.
- Party frame `[data-swap]` clicks swap too.

---

## Suite 5 — Combat

### 5.1 Basic attacks (P1, headless)

- `orderAttack(target)` damages a hostile until it dies.
- `clearHostiles()` returns a count and `inCombat()` goes false afterward.
- Kills grant gold and XP; `state().gold` rises.

### 5.2 Death and revive (P1, headless)

- A hero reaching 0 HP is `alive: false`.
- If the active hero dies, control and saving behave per the death rules (saving is blocked).
- `healParty()` restores HP and mana for living heroes.

### 5.3 Statuses (P2, headless)

- Stun, root, and slow apply and expire; assert via `__game` unit status state.
- Resonance (elemental reactions) is always on in the overworld and changes combat output; macro sims run with it off.

### 5.4 Items in combat (P2, headless)

- `useItem(slot)` triggers an active item, applies its effect, and starts its cooldown.
- Neutral item active (N) fires.

---

## Suite 6 — Shop and economy

### 6.1 Shop access (P1, headless)

- B opens the shop only in town; `canShop()` / `inTown()` gate it.
- Shop is blocked outside town and during combat.

### 6.2 Buy and sell (P1, headless)

- Buying boots (`[data-buy]`) deducts gold, adds the item, and raises the hero's move speed.
- Selling (`[data-sell]`) removes the item and refunds gold.
- Gold can't go negative; buying with insufficient gold fails cleanly.

### 6.3 Gated stock (P2, headless)

- Items gated behind progression do not appear in the shop until unlocked. Boot fresh and confirm a known gated item is absent.

---

## Suite 7 — Capture and entourage

### 7.1 Capture eligibility (P1, headless)

- A capturable creep above the HP threshold can't be bound; `tryCapture` fails.
- Damaging it below the tier threshold makes it eligible.
- `#capture-bar` shows the binding channel ("Binding...") and hides when done.

### 7.2 Capture completion (P2, headless)

- A successful bind adds the creep; `state().caught` increments.
- Fielding a creep (`[data-field]` in the party modal) puts it in the entourage, capped at 3.
- Merging three of a kind produces a starred creep.

---

## Suite 8 — Dungeons

The live multi-room session in `src/systems/dungeon-session.ts`. The four dungeons: `frost-hollow`, `severed-dark`, `worldstone-vault`, `ember-caldera`.

### 8.1 Entry and gating (P1, headless)

- Starting a dungeon requires being in the right region; the entry is gated otherwise.
- `__game.startDungeon(id, tier)` enters; `state().dungeon` populates with id, tier, room index, room type, and depth.
- The dungeon-entry modal offers tier, modifiers, and Open/Endless/Daily (`[data-dungeon-*]`).

### 8.2 Full clear (P1, headless)

- Clear room by room: kill hostiles, confirm `exitsUnlocked` flips true, advance, repeat to the guardian.
- Beating the guardian sets `dungeon.done` and awards loot; `state().stash` grows.
- Exiting returns to the overworld with `state().dungeon` null.

### 8.3 Endless and daily (P2, headless)

- Endless mode keeps generating rooms past the normal depth.
- Daily mode uses a date-derived seed; the same day yields the same layout.

---

## Suite 9 — Gyms, bosses, raids

### 9.1 Gym challenge (P1, headless)

- `challengeGym` opens the prefight modal with Fight Live / Auto-Resolve (`[data-pf]`).
- Auto-resolve runs a best-of-3 and reports a result.
- A live gym (`startLiveGym`) runs gambit-driven 5v5; Captain Calls (`[data-livegym="call"]`, Space) grant timed direct control; `#live-gym-bar` shows the score.
- Winning a gym awards a badge; `state().badges` increments.

### 9.2 Boss fights (P2, headless)

- `runBossFight` resolves a boss across Normal / Nightmare / Hell tiers.
- Boss reruns appear in Services (`Y`), selectable via `[data-boss="id:tier"]`.

### 9.3 Raids (P2, headless)

- `runRaid` / `startLiveRaid` runs a raid; the driver is chosen with 1–5.
- Roshan-style raids grant the Aegis on a win.

### 9.4 Elite and Champion (P3, headless)

- The Elite Five draft gauntlet (`runEliteMatch`) chains matches.
- `runChampion` runs the Tower fight.

---

## Suite 10 — Progression gates and travel

### 10.1 Badge gates (P1, headless)

- A region gate blocks travel without the required badge.
- `tryTravel` / `tryInteract` at a gate succeeds once the badge is owned.

### 10.2 Recruitment chain (P2, headless)

- Approaching a recruitable hero shows the recruit hint.
- The flow runs Find → Trial → Bind: trial choices appear in `#trial-choice` (`[data-choice]`), and a bind duel follows.
- A successful recruit raises `state().recruited`.

### 10.3 Exploration and town (P2, headless)

- Exploration % rises as the player covers ground.
- Entering town flips `inTown()` true and enables the shop; town services are reached by interacting with their NPCs.

---

## Suite 11 — Save and load

### 11.1 Manual slots (P0, headless)

- Saving to a slot writes `ancients.save.1|2|3` in `localStorage`.
- Reloading the page and loading that slot restores region, gold, party, badges, and caught creeps.
- F5 quick-saves to slot 0.

### 11.2 Autosave (P1, headless)

- Autosave writes `ancients.save.auto` on its triggers (town entry, badge win, and the like).

### 11.3 Save gating (P1, headless)

- Saving is blocked in combat and when the active hero is dead; `canSave()` reflects this.

### 11.4 Export and import (P2, headless)

- Export produces JSON from the menu; import (`#title-import` / menu import) loads it back.
- Importing a save from version 6 round-trips; an older version migrates cleanly.
- Malformed JSON is rejected without crashing.

---

## Suite 12 — Settings

Open via Esc → Menu.

### 12.1 Toggles take effect (P2, headless)

- Quick-cast (`#opt-quickcast`) on/off changes whether targeted abilities need a confirm click.
- Reduced motion and photosensitive options apply.

### 12.2 Graphics quality (P3, WebGL)

- Quality (`#opt-quality`: auto/low/medium/high/ultra) switches without crashing the renderer.
- Exposure and color grade adjust the scene.

### 12.3 Audio (P3, both)

- Master/SFX/voice/stinger sliders and mute apply.
- Audio unlocks on the first `pointerdown`.

---

## Suite 13 — Journal, Codex, meta UI

### 13.1 Journal (P2, both)

- J opens the Quest Journal: recruitment, conquest, factions, badges, titles sections render.
- Completed milestones show as done.

### 13.2 Codex (P2, both)

- K opens the Compendium with Lore / Heroes / Atlas / Cinematics tabs (`[data-ctab]`).
- Tab switching works; locked entries stay gated until unlocked.
- The cinematic gallery lists played cutscenes.

### 13.3 Services menu (P2, headless)

- Y in town opens Services: boss reruns, Tinker's Bench, Armory, Black Market, loadouts.

---

## Suite 14 — Forge, armory, black market

### 14.1 Loot and stash (P2, headless)

- Loot drops carry quality grades and land in the armory stash; `state().stash` tracks count.
- The loot filter (`src/systems/loot-filter.ts`) auto-disenchants below the configured grade/rarity.

### 14.2 Forge (P2, headless)

- Forge operations run via Services: grade up, reforge, sockets, gems, masterwork. Each changes the item and spends the right currency.

### 14.3 Black market (P3, headless)

- Recipe/relic wheels and the gamble vendor spend loot marks and return an item.

---

## Suite 15 — Time, world state

### 15.1 Day/night (P1, headless)

- `fastForward` advances `dayTime`; `isNight()` flips on the right cycle.
- Biome music and lighting follow the cycle (WebGL for visuals).

### 15.2 Stamina and resin (P2, headless)

- Stamina drains on dash/sprint and regenerates over time.
- Resin (moonflow pacing) gates the actions it's meant to.

---

## Suite 16 — Visual regression

Real renderer, screenshot per scene, compared against a baseline. Tag `@visual`. Use a fixed seed and `skipActiveCinematic` for stable frames.

- Prologue cinematic frame.
- HUD in the overworld (Tranquil Vale, day).
- Shop modal open.
- Journal and Codex modals.
- A dungeon room.
- One screenshot per region for biome coverage (P3).
- Day vs night in the same region.

Attach each with `attachScreenshot`. Existing baselines live under `test-results/e2e-screenshots/`.

---

## Suite 17 — Stability sweeps

### 17.1 No errors per region (P0, WebGL)

- Boot each of the 10 regions with the real renderer, fast-forward a few seconds, and assert `expectNoPageErrors`.

### 17.2 Headless coverage matrix (P1, headless)

- Cross every starter with every region: boot, fast-forward, snapshot, assert no errors. 30 fast cases.

### 17.3 Long-run soak (P3, headless)

- Boot, fast-forward several in-game minutes, and confirm no errors, no NaN stats, and a stable party.

### 17.4 Rapid modal toggling (P2, both)

- Open and close every modal in sequence, repeatedly, and confirm `#modal-root` ends hidden with no stuck input grab.

---

## Selector and API reference

No `data-testid` exists. Use these.

### Stable element IDs

```
#app  #game-canvas  #ui-root
#title-screen  #new-game  #back-title  #title-import
#loading-screen
#top-bar  #party-col  #hero-panel  #minimap  #toast-col
#floater-layer  #capture-bar  #hud-hint  #trial-choice  #live-gym-bar
#cinematic-layer  #modal-root  #modal-close
#talent-open  #debug-panel
#opt-quickcast  #opt-quality
```

### Data-attribute hooks

```
[data-pick]                  starter cards
[data-load]                  continue / load slots
[data-save]                  menu save slots
[data-swap]                  party hero swap
[data-field]                 field/unfield creep
[data-buy] [data-sell] [data-tab]   shop
[data-choice]                trial choices
[data-cinematic="next|ff|skip"]     cinematic controls
[data-livegym="call"]        gym Captain Call
[data-pf="live|auto|cancel"] gym prefight
[data-dungeon-*]             dungeon entry
[data-boss="id:tier"]        boss reruns
[data-open="journal|codex"]  top-bar buttons
[data-ctab]                  codex tabs
```

### State classes

```
#modal-root.hidden           modal closed
#cinematic-layer.hidden      cinematic done
#capture-bar.hidden          not capturing
.party-frame.active          active hero
#top-bar .region             region name (playable signal)
```

### In-page APIs

```js
// Control surface (test-harness.ts)
__test.ready()
__test.startNewGame({ hero, region, seed, gold, headless })
__test.start(save, { headless })
__test.load(save)
__test.fastForward(seconds)   // step the sim, no real-time wait
__test.step(stepMs)
__test.addGold(n)
__test.addXp(n, partyIdx)
__test.healParty()
__test.clearHostiles()        // returns count
__test.teleportActive(x, y)
__test.state()                // JSON snapshot for assertions

// state() snapshot fields
{ ready, mode, regionId, regionName, gold, playtime, dayTime, isNight,
  inTown, inCombat, activeIdx, party[], recruited, badges, caught, stash,
  dungeon }

// Live Game escape hatch
__game.orderMove / orderAttack / orderAttackMove / orderStop
__game.castAbility / useItem / tryDash / tryCapture / trySwap / tryInteract / tryTravel
__game.challengeGym / startLiveGym / runBossFight / runRaid / startLiveRaid
__game.startDungeon(id, tier) / runEliteMatch / runChampion
__game.canShop() / inTown() / inCombat() / canSave() / isNight()
__game.cinematic.active / cinematicSkip()
__game.liveGym / liveRaid / liveDungeon
__game.gold / party / badges / caught / recruited / inventoryStash
```

### Helpers (`e2e/helpers.ts`)

```
boot(page, { hero, region, seed, webgl })
state(page)
fastForward(page, seconds)
waitForPlayableUi(page)
skipActiveCinematic(page)
attachScreenshot(page, testInfo, name)
watchPageErrors(page) / expectNoPageErrors(errors)
```

---

## Suite 18 — Pressure / invariants (independent)

The browser-side counterpart to the headless `src/test/pressure/*` suites, in `e2e/pressure.spec.ts`. These do not re-walk one scripted flow; they assert **properties that must hold across many states**, driven through the player-facing surface (the `?test` harness + DOM), not the internals they guard. The reusable `partyInvariants` / `expectPartyWellFormed` helpers in `e2e/helpers.ts` are the read-side state-corruption check — the browser analog of headless `checkSimInvariants`.

### 18.1 Combat state-corruption sweep (P1, headless)

- Across a spread of (starter, region) pairs: boot, spawn a wild pack, and step the fight in slices, asserting `expectPartyWellFormed` after **every** slice — finite, in-bounds HP/mana, sane derived stats, real positions, and alive⇒HP>0 — so a transient corruption is caught at the tick it happens.
- No page errors across the whole sweep.

### 18.2 Long soak (P3, headless)

- Fast-forward several in-game minutes in checkpoints; the party stays well-formed at every checkpoint, the roster size is stable, gold stays finite and non-negative, and the console stays clean.

### 18.3 Modal state machine (P2, headless HUD)

- Cycle every modal opener (Tab/B/J/K/Y/Esc) three times; whatever opens must close back to `#modal-root.hidden` via `#modal-close`, and the run ends with no modal up, the sim unpaused, and the party well-formed. Catches leaked input grabs, double-opens, and stuck-pause teardown bugs. (Note: `Esc` has modal-specific semantics — on some panels it reopens the menu rather than just closing — so the universal close affordance is the stable lever.)

### 18.4 Save-gating truthfulness (P1, headless)

- `canSave()` is allowed when idle, blocked in combat (with a combat reason), and blocked when the active hero is down (with a distinct down reason) — driven by real spawn/attack/kill, not by poking the flags.

---

## Coverage gaps worth adding first

The current specs cover boot, heroes, items, mechanics, dungeons, story, visual smoke, the input layer (controls-ui), save/load round-trip, and the Suite 18 pressure invariants. The highest-value remaining additions, roughly in order:

1. Per-region no-error sweep with the **real renderer** (Suite 17.1) — Suite 18.1 covers the headless sweep, but WebGL boot per region is still uncovered beyond the single boot smoke.
2. Shop buy/sell economy beyond the existing boots case (Suite 6) — gated stock, insufficient-gold failure, sell refunds.
3. Settings toggles actually changing behavior beyond quickcast/resonance (Suite 12) — reduced motion, photosensitive, audio.
4. Gym prefight and live/auto fight depth (Suite 9.1) — Captain Calls, best-of-3 reporting.
5. Recruitment and capture full chains (Suites 7, 10.2) — Find → Trial → Bind, merge-to-starred.
6. Controls still uncovered in Suite 3: pointer-dependent casts (3.2/3.3) and modifier/queue behavior (3.4), which need WebGL or seeded hover.
