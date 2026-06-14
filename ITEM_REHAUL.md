# ITEM REHAUL — "LOOT THAT FEELS ALIVE"

A ground-up redesign of how items drop, roll their properties, and improve over time. Companion to `SPEC.md`, `STORY.md`, and `PRESENTATION_SPEC.md`. Same crunch-mode rules: this is direction and priority, not a gate.

This is the v2 direction. v1 proposed a single Grade scalar as the whole story. v2 keeps Grade but makes it one axis among several, and adds the parts that make a looter exciting: random affixes you chase, signature powers that change how you play, sockets, sets, and a loot moment with real ceremony. The three touchstones:

- **Borderlands** for the dopamine of the drop itself: the beam, the sound, the "what does this one *do*."
- **Diablo** for crafting and rolling: affixes, rerolls, imprints, tempering, gems.
- **WoW** for the scaffolding: rarity colors, item level, sockets, set bonuses.

---

## 0. THE PROBLEM IN ONE PARAGRAPH

Right now every dropped item is identical to its crafted or bought version. A Crystalys from a creep kill is the same as a Crystalys from a shop. There are no reasons to keep killing the same camp, no decisions at the Tinker's Bench beyond quality upgrades, and no texture to loot. It either drops or it doesn't, and when it does you already know exactly what you have. The fix is to give each copy of an item its own identity: a set of rolled properties that vary from drop to drop, a few of which are exciting enough to change your build. Then we build an economy of currencies that lets players push that identity upward, with risk and reward calibrated for a single-player game. The goal: every session produces multiple upgrade moments, every item slot feels like it can always get better, and the Tinker's Bench becomes a destination rather than a stop on the way out.

---

## 1. THE FIVE THINGS THAT MAKE AN ITEM

Today an item is its `ItemDef` plus an optional `quality`. Two Daedaluses are the same item. This rehaul gives every dropped copy its own identity across five axes. Each axis answers a different question, and each has its own visual language so the player can read them at a glance.

| Axis | Question it answers | Source | Visual |
|------|--------------------|--------|--------|
| **Tier** | How powerful a class of item is this? | item def (cost-based) | tooltip header label |
| **Rarity** | How rare is this *kind* of item? | item def | the glow color (outer border) |
| **Grade** | How well did *this copy* roll? | rolled on drop | a condition frame + pip count |
| **Affixes** | What bonus properties did it roll? | rolled on drop | the bonus stat lines, blue text |
| **Quality** | What cosmetic prestige does it carry? | drop luck + Forge | particle effect + name flourish |

Two more layers sit on top of an item once it exists: **sockets** (player-filled gem slots) and **set membership** (collect matching pieces for a bonus).

The big change from v1: **affixes are the identity, Grade is the roll quality.** Grade no longer carries the whole experience. It decides how many affix slots an item gets and how high its numbers roll. The affixes decide whether you keep it. A Pristine item with two dull affixes can lose to a Sharp item that rolled lifesteal plus a crit proc on the hero who wants exactly that.

### Why these axes do not collide

v1 painted Grade in the same colors as Rarity, which would have put two meanings on one swatch. v2 keeps them apart:

- **Rarity is the glow.** It uses the existing Dota palette (common grey through arcana). It tells you how special the item *type* is, and it drives loot marks, salvage value, and binding exactly as today.
- **Grade is the condition.** It uses a separate metal ramp (cracked grey for Broken, dull bronze, clean steel, bright steel, silver, mirror-gold for Pristine) shown as a frame treatment plus a row of pips. It reads as craftsmanship, not magic.
- **Affixes are text.** They live in the tooltip body as colored stat lines, like Diablo.
- **Quality is a particle effect** and a small name flourish (Inscribed, Frozen, Unusual), exactly the Dota cosmetic read.

One icon can carry all of them without becoming soup: a colored glow (rarity), a metal frame with pips (grade), a particle (quality), and a tooltip full of affix lines.

---

## 2. ITEM TIERS — FORMALIZING WHAT ALREADY EXISTS

The code has a flat `tier` field (`component` / `basic` / `core`). In practice "core" covers nearly a 4× price range and four meaningfully different power bands. This rehaul makes those bands explicit. The `tier` field on `ItemDef` gains `t1` through `t4`. Existing `core` items get re-tiered on audit. Rarity overrides stay as-is.

### Tier map

| Tier | Label | Cost range | Rarity (typical) | Examples |
|------|-------|-----------|-------------------|---------|
| `consumable` | Consumable | — | common | Tango, Salve, Clarity, Wards, Smoke |
| `component` | Component | 50–3400g | uncommon–mythical | Iron Branch through Sacred Relic |
| `basic` | Basic | 425–2100g | uncommon | Boots variants, Bracer, Yasha/Sange/Kaya, Drum, Medallion |
| `t1` | Tier 1 Core | 1800–2500g | rare | Crystalys, Dragon Lance, Mask of Madness, Blink Dagger, Force Staff, Vanguard, Mekansm, Glimmer Cape, Dagon |
| `t2` | Tier 2 Core | 2500–4800g | mythical | Orchid, Desolator, Eul's, Echo Sabre, Skull Basher, Sange+Yasha/Kaya pairs, Shiva's Guard, Pipe, Crimson Guard, Battlefury |
| `t3` | Tier 3 Core | 4800–6100g | legendary | BKB, Daedalus, MKB, Manta, Mjollnir, Assault Cuirass, Guardian Greaves, Ethereal Blade, Wind Waker, Linkens, Satanic |
| `t4` | Tier 4 Core | 5175–7500g | immortal | Butterfly, Heart of Tarrasque, Scythe of Vyse, Eye of Skadi, Refresher Orb, Octarine Core, Aghanim's Scepter, Abyssal Blade, Bloodthorn, Radiance |
| `special` | Special | — | immortal/arcana | Divine Rapier (raid/special-battle), Aegis (raid), Cheese/Refresher Shard (Roshan) |

**Tier sets the affix ceiling.** A higher-tier item draws affixes from richer pools and supports more sockets. It also sets a soft level requirement (see §3.4) and a grade floor: a T4 item never drops below Standard, a T3 never below Worn. Finding a Heart of Tarrasque is always a meaningful event, even at its lowest legal grade.

---

## 3. GRADE — HOW WELL THIS COPY ROLLED

Grade is the per-copy roll-quality band. It does three jobs: it sets how many affix slots the item rolls, it sets the magnitude percentile of the item's base flat stats and of each affix value, and it nudges the level requirement. It is the ladder a player climbs at the Forge. It is no longer the whole experience, because the affixes that fill those slots are what give the item character.

### 3.1 The six grades

| Grade | Frame | Affix slots | Stat percentile | Signature chance | Socket chance |
|-------|-------|-------------|-----------------|------------------|---------------|
| **Broken** | cracked grey | 0 | 0–22% | — | — |
| **Worn** | dull bronze | 1 | 18–42% | — | — |
| **Standard** | clean steel | 1 | 36–64% | — | — |
| **Sharp** | bright steel | 2 | 58–80% | — | 15% |
| **Refined** | silver | 2 | 74–92% | 8% | 35% |
| **Pristine** | mirror-gold | 3 | 88–100% | 20% | 60% (up to 2) |

Adjacent percentile bands overlap by 4 points so rolls near a boundary feel smooth rather than stepped. The frame colors are deliberately a metal-condition ramp, separate from the rarity glow palette (§1).

### 3.2 How the magnitude roll works

Every flat stat (base and affix alike) has a roll variance of ±20% on its nominal value. Grade picks a slice of that band:

```
statMultiplier = 0.80 + percentile × 0.40
```

At the 0th percentile a stat is ×0.80. At the 100th it is ×1.20. The full Broken-to-Pristine spread is a 1.5× ratio on flat stats for the same item.

**Only flat stats take the magnitude roll:** `damage`, `armor`, `str`, `agi`, `int`, `maxHp`, `maxMana`, `attackSpeed`, `hpRegen`, `manaRegen`, `moveSpeed`. Percentage mods, active effects, proc damage, and auras on the *base item* stay at nominal, so the player can always read what an item's abilities do. Affixes are where the spicier rolls live (§4), and affixes can carry percentage and behavior properties because they are clearly labeled as bonuses on this specific copy.

Items with no base passive stats (Blink Dagger) still roll affix slots and grade by the same rules.

### 3.3 Affix slots scale with grade

The slot count in §3.1 is the heart of why grade matters now. A Broken item is a naked base. A Pristine item carries three rolled affixes plus a one-in-five shot at a signature power. Climbing grade is no longer "the same item, bigger number." It is "the same item, more room to become something." Two players who both grind a slot to Pristine can end up with very different items.

### 3.4 Item level and requirements (softened from v1)

v1 scaled the level requirement by grade, which meant a Pristine drop could sit unusable for ten levels. In a five-hero roster game where the level cap is gated by badges and you swap heroes constantly, that produced dead loot. v2 ties the requirement to **tier only**, so the aspiration ("this is an endgame item") survives without the long dead-stash wait.

| Cost range | ilevel | Level req |
|-----------|--------|-----------|
| 50–500g | 1 | 1 |
| 500–1200g | 4 | 4 |
| 1200–2200g | 7 | 7 |
| 2200–3600g | 11 | 11 |
| 3600–5000g | 15 | 15 |
| 5000–6500g | 18 | 18 |
| 6500g+ | 21 | 21 |

Grade adds at most +2 to this, and only at Refined/Pristine, as a light "you grew into the best version" beat rather than a wall. A found item is usable soon after it drops, which keeps the loop tight.

### 3.5 Grade floors by context

Floors are minimums. A drop can always roll higher. Multiple conditions stack and the highest wins.

**By item tier:** Basic/T1/T2 no floor; T3 Worn; T4 Standard; Special Pristine.

**By difficulty:** Nightmare +1 grade step to all floors; Hell +2.

**By regional mastery (badges):** 3+ badges in a region lifts that region's drops to a Sharp floor; 6+ adds a Refined floor on boss kills; a full 8/8 set gives a Sharp floor on all boss drops and Standard on all raids.

**By source:** Elite creep Sharp; dungeon boss first clear Sharp/Refined/Pristine by difficulty; raid clear Refined; gym speed-clear Refined; raid Hell first clear one guaranteed Pristine.

---

## 4. AFFIXES — THE KEYSTONE

This is the change that turns a number into a piece of loot. Each dropped copy rolls a set of affixes from tiered pools. The affixes decide whether the item is trash, a sidegrade, or a godroll. They are the reason to keep killing a camp: the base item is known, but its affixes are a fresh roll every time.

### 4.1 Affixes are nearly free in this engine

The sim already speaks the vocabulary an affix needs. `ItemDef` carries `passiveMods` (a `StatModMap`), `attackMod` (`AttackModSpec` with crit, proc, cleave, lifesteal), `triggers` (the generic `on-kill` / `on-attack-land` / `on-damage-taken` system), and `aura`. An affix is a rolled fragment of one of those. A "+lifesteal" affix is a `StatModMap`. A "heal on kill" affix is a `TriggerSpec` with an `on-kill` effect. A "cleave" affix is an `AttackModSpec`. We compose affixes from the same primitives abilities already use, so the spicy ones cost data, not new systems.

### 4.2 Affix shape

```typescript
export type AffixKind = 'prefix' | 'suffix' | 'signature';

export interface AffixDef {
  id: string;
  name: string;                 // "of the Bear", "Razor-Edged", "Blooddrinker's"
  kind: AffixKind;
  tier: 1 | 2 | 3 | 4 | 5;      // affix power tier; gated by difficulty/region (§13)
  pools: AffixPoolId[];         // which item families can roll it (weapon-like, armor-like, caster-like, any)
  weight: number;               // roll weight within its pool
  // exactly one payload:
  statRanges?: Partial<Record<keyof StatMods, [number, number]>>;  // rolls a value per stat
  attack?: Partial<AttackModSpec>;
  trigger?: TriggerSpec;
  aura?: AuraSpec;
}

export interface RolledAffix {
  affixId: string;
  roll: number;                 // 0..1 position within the affix's ranges (grade-influenced)
  resolved: StatModMap;         // computed once at drop, cached
}
```

A `statRanges` affix rolls each stat within its band, and grade biases the roll position (a Pristine item rolls its affixes near the top of their ranges). Behavior affixes (`attack` / `trigger` / `aura`) carry fixed-but-labeled effects so their power stays readable.

### 4.3 Affix families and a sample pool

Affixes are filtered by an item's family so a staff does not roll cleave and a sword does not roll spell amp.

| Family | Reads from | Example affixes |
|--------|-----------|-----------------|
| **weapon-like** | items with `damage` / `attackMod` | Razor-Edged (+crit chance), Cleaving (cleave %), Blooddrinker's (lifesteal %), Heavy (+damage), Executioner's (on-kill: heal + move burst) |
| **armor-like** | items with `armor` / `maxHp` | of the Bear (+str/HP), Warded (+magic resist %), Thorned (on-damage-taken: reflect), of Endurance (+hp regen), Stalwart (+status resist %) |
| **caster-like** | items with `int` / `spellAmpPct` / actives | Arcane (+spell amp %), of Insight (+mana regen), Overcharged (active cooldown reduction), of the Mind (+int), Resonant (on-cast: small AoE) |
| **mobility / any** | any item | Swift (+move speed), of the Hawk (+attack range), Vital (+max HP), of Fortune (+a small amount of two random stats) |

The pool is data and grows freely. The point is that two copies of the same base diverge: one Crystalys rolls Razor-Edged + Blooddrinker's (a crit-lifesteal carry weapon), another rolls Heavy + Swift (a raw stat stick). Different heroes want different ones.

### 4.4 How many affixes, and from where

Affix slot count comes from **grade** (§3.1). Which affixes are eligible comes from **difficulty and region** (§13). A drop fills its slots by:

1. Pick prefix/suffix balance (a 2-slot item rolls one of each where possible).
2. Draw from the family pool, filtered to the unlocked affix tiers, weighted by `weight`.
3. Roll each affix's values, biased toward the top of the range by grade percentile.

This is the loop a player learns to read: grade tells you how many lines to expect, the lines themselves are the lottery.

---

## 5. SIGNATURE POWERS — THE ORANGE TEXT

Borderlands legendaries and Diablo uniques are exciting because they change how you play, not just how hard you hit. Two sources of that here.

**Built-in kits.** Most legendary and immortal item defs already carry a defining ability (Radiance's burn aura, Butterfly's flutter, Bloodthorn's silence-on-attack). That is the item's signature and it stays exactly as authored. No re-work needed; the Dota identity *is* the orange text.

**Rolled signatures.** At Refined and Pristine, an item can roll a `signature` affix: a curated, build-defining behavior drawn from a small pool, shown in orange in the tooltip. Examples:

- *Stormcaller's*: every third attack chains lightning to two nearby enemies.
- *Vampiric Surge*: a kill grants 4s of large lifesteal and move speed.
- *Glassbreaker*: attacks shred 2 armor for 4s, stacking.
- *Echoing*: your item active has a 20% chance to not go on cooldown.

Signatures roll at 8% on Refined and 20% on Pristine (§3.1), and only from tiers unlocked by difficulty. A signature is the godroll peak: rare, loud, worth chasing a slot to Pristine for. When one drops, it gets the full ceremony in §12.

---

## 6. SOCKETS AND GEMS

A cheap, beloved horizontal layer. Sockets are empty slots the player fills with gems, freely swappable at the Forge.

- **Sockets** roll on drop by grade (§3.1): Sharp 15%, Refined 35%, Pristine up to 2. Tier raises the cap (T3/T4 items can hold 2–3).
- **Gems** are a light item type with a single focused stat (Ruby +HP, Topaz +damage, Sapphire +mana, Emerald +armor, Diamond +all stats). They drop from creeps and chests and sell cheaply.
- **Gem grades** combine upward: three of one gem fuse into the next grade at the Forge, reusing the existing neutral-enchant pattern (`enchantsInto`). A Flawless Topaz is the payoff for hoarding chips.
- **Slotting is free; pulling costs.** Drop a gem in for nothing, pull it back out for a small Essence fee, so socket choices carry a little weight without being precious.

Sockets give players a way to patch a build hole on an otherwise-great item ("this Daedalus rolled no HP, socket a Ruby") and a reason to care about the small gem drops that would otherwise be noise.

---

## 7. SET BONUSES

A long-term chase that gives loot a collection goal. A handful of themed sets, each 3–4 items, flavored by region or boss. Set membership is a def field; the bonus applies to the hero wearing the pieces.

```typescript
// ItemDef addition
set?: string;            // set id, e.g. 'frostforged'

// new registry
export interface ItemSetDef {
  id: string;
  name: string;
  pieces: string[];                 // item ids
  bonuses: { atPieces: number; mods?: StatModMap; aura?: AuraSpec; trigger?: TriggerSpec }[];
}
```

Example: the **Frostforged** set (Icewrack) gives +6 armor at 2 pieces and an on-attack chill at 3. Bonuses reuse the existing statmod/aura/trigger application path, so a set bonus is the same machinery as an aura item. Sets pair naturally with the themed regional loot pools that already exist, and they give a reason to keep specific drops you would otherwise disenchant.

Set pieces show a set tag in the tooltip and count up live ("Frostforged 2/3") so the chase is visible.

---

## 8. QUALITY — NOW PURELY COSMETIC PRESTIGE

v1 ran Quality (standard through unusual) and Grade as two parallel power ladders, which was confusing: both had six rungs, both had colors, both bumped numbers. v2 resolves this by making **Grade the power axis and Quality the cosmetic prestige axis.** Quality keeps its existing six steps, its particle effects, and the Inscribed per-kill counter, plus a small stat flourish for flavor. It is the Dota cosmetic read: a Frozen item glows, an Unusual one carries a rare particle, an Inscribed one counts your kills.

The Quality Gamble at the Forge stays as a cosmetic chase for players who want a flashy item, separate from the power loop. It no longer competes with the grade and affix systems for the same mental slot. The existing essence/gold quality-upgrade path is unchanged.

---

## 9. DROP RATES — SINGLE-PLAYER GENEROUS

The current rates were tuned for a gated game. This is a single-player action RPG. Something real should drop from almost every large kill, and ancient kills should never feel dry. The question after a fight is which grade and which affixes you got, not whether you got anything.

### 9.1 Creep drop tables (revised)

Slots are independent rolls. Star rating (×1 / ×1.85 / ×3.2) scales HP and damage but not these percentages. Grade rolls against the source floor after the slot fires, then affixes fill the grade's slots.

**Small creeps**
| Slot | Normal | Nightmare | Hell | Pool |
|------|--------|-----------|------|------|
| Consumable / gem chip | 30% | 36% | 42% | All consumables; lesser gems |

**Medium creeps**
| Slot | Normal | Nightmare | Hell | Pool |
|------|--------|-----------|------|------|
| Consumable | 40% | 46% | 52% | All consumables |
| Early component | 25% | 32% | 40% | Iron Branch, Circlet, Gauntlets, Slippers, Mantle, Belt, Band, Robe, Blades of Attack |

**Large creeps**
| Slot | Normal | Nightmare | Hell | Pool |
|------|--------|-----------|------|------|
| Consumable | 35% | 42% | 50% | All consumables |
| Component (any) | 55% | 64% | 74% | Early and mid components |
| Assembled / EG core | 15% | 25% | 35% | T1 assembled; rare T3 endgame core |

**Ancient creeps**
| Slot | Normal | Nightmare | Hell | Pool |
|------|--------|-----------|------|------|
| Mid-high component | 60% | 72% | 84% | Broadsword through Sacred Relic |
| Mythical component | 28% | 38% | 50% | Same deep pool, separate roll |
| Endgame core | 20% | 32% | 46% | T3/T4 assembled (split by EG rarity table) |

### 9.2 Neutral item camps

| Camp | Old rate | New rate |
|------|----------|----------|
| Small | 10% | 16% |
| Medium | 14% | 20% |
| Large | 20% | 28% |
| Ancient | 28% | 38% |

### 9.3 Elite creeps (NEW)

A rare variant of large and ancient camp creeps: gold particle border, 1.2× scale, star-2 stat multipliers. Dangerous enough to register as a fight, rare enough to feel like a find.

| Elite type | Spawn chance | Guaranteed drop | Second slot chance |
|-----------|-------------|----------------|-------------------|
| Elite (large) | 4% of large spawns | Sharp+ assembled | 40% / 55% / 70% |
| Elite (ancient) | 3% of ancient spawns | Refined+ assembled | 55% / 70% / 85% |

### 9.4 Hero drops on kill (NEW)

When an enemy hero dies in a dungeon or overworld encounter, one random item from their equipped loadout falls at grade −1 (minimum Broken), affixes and all. Cap one item per enemy hero per run. This gives a reason to read the enemy team before engaging: a Sharp Battlefury with a Cleaving affix is visible loot you can hunt.

### 9.5 Dungeon rooms, bosses, raids, gym

Unchanged in structure from v1: room chests scale grade with depth; boss first clears guarantee Sharp/Refined/Pristine by difficulty; raids drop multiple Refined+ pieces with an immortal chance; gym badges drop a themed Sharp item, bumped to Refined on speed-clear with a Pristine chance on a perfect run. Bad-luck pity after 8 dry raids stays.

---

## 10. SOURCES BEYOND COMBAT

### 10.1 Roaming merchant — the transparent fallback

A wandering NPC that appears once every two region visits. Offers six items from the current region's pool. The player picks the item and the grade upfront, no gambling, priced at a premium. This sets a gold ceiling on each grade so no one has to grind a specific slot forever.

| Grade | Price multiplier |
|-------|----------------|
| Worn | 1.0× base cost |
| Standard | 1.25× base cost |
| Sharp | 1.6× base cost |
| Refined | 2.2× base cost |

Affixes on merchant items are still random, and Pristine is never sold, so a bought item never fully replaces a found one.

### 10.2 The Gamble Vendor (NEW)

The merchant is the safe path; this is the slot machine. Extending the existing Black Market (the `gamble` drop source already exists in code), a vendor sells a **random item of a chosen slot and tier** for currency, at a random grade and affix roll. You choose "weapon, T3" and pay; you get a surprise. This is the purest dopamine loop in the genre (Diablo's Kadala, Borderlands' Moxxi machines): a fast, repeatable spend with a real chance at a godroll. Prices scale with tier so it stays a sink, and a soft pity guarantees a Sharp+ result every N gambles so a dry streak still moves you forward.

### 10.3 Exploration caches

Hidden caches scattered through region maps, grade tied to region depth. Each holds 1–2 components, gems, or assembled items. Rewards reading the map instead of following the critical path.

---

## 11. THE FORGE — CRAFTING THE ROLL

The Tinker's Bench gains a Forge panel. v1's Forge was three flavors of the same magnitude gamble. v2's Forge is a real crafting bench built around affixes, with one important rule throughout: **no operation ever makes an item worse.** You spend currency and choose to keep a result. Anxiety comes from cost, never from loss. (Diablo's enchanting works this way; v1's "reroll can drop you a whole grade" is gone.)

### 11.1 One currency: Essence

v1 added Embers alongside the existing Essence, two recycle currencies doing the same job. v2 unifies on **Essence**. Disenchanting an item yields Essence; every Forge operation spends Essence and gold. Gold is the abundant, fast currency (gambles lean on gold); Essence is the considered, scarce one (deterministic operations lean on Essence). That split preserves the high-roller / patient / mixed play styles without a second currency to track.

**Disenchant (item → Essence), by grade:**

| Grade | Broken | Worn | Standard | Sharp | Refined | Pristine |
|-------|--------|------|----------|-------|---------|----------|
| Essence | 1 | 3 | 6 | 13 | 24 | 40 |

A signature affix or a high rarity adds a bonus, so recycling something special still feels worth more than vendoring junk.

### 11.2 The operations

| Operation | What it does | Cost | Risk |
|-----------|--------------|------|------|
| **Grade Up** | Add an affix slot and raise the magnitude band one grade | gold + Essence, scaling by grade | none (gold/Essence gamble for the fast path; deterministic Essence path for the patient) |
| **Reroll Affix** | Reroll one chosen affix's identity and value from the pool | gold | none; preview the result, pay again to try, or keep |
| **Reforge** | Reroll all affixes at once | gold + Essence | none; cheaper per-affix than rerolling each, but you give up the ones you liked |
| **Imprint** | Lock one chosen affix so it survives a Reforge | Essence | none; the imprinted affix is guaranteed to reappear |
| **Masterwork** | Push the magnitude percentile of base stats and affixes toward the top of the current grade band | gold + Essence | none; diminishing returns near the cap |
| **Socket / Unsocket** | Add a socket (up to the tier cap) or pull a gem | gold to add, Essence to pull | none |
| **Fuse Gems** | Three same-grade gems into one of the next grade | gold | none |

Two paths to Grade Up coexist, same as v1's instinct: a **fast gamble path** (gold + a little Essence, a success chance, retry on fail) for players who want results now, and a **deterministic path** (a larger flat Essence cost, guaranteed) for players who would rather save and never gamble. Both end at the same place. Sample numbers:

| Grade Up | Gamble: gold + Essence (success) | Deterministic: Essence |
|----------|----------------------------------|------------------------|
| → Worn | 120g + 1 (85%) | 4 |
| → Standard | 280g + 2 (72%) | 10 |
| → Sharp | 550g + 4 (58%) | 22 |
| → Refined | 1100g + 8 (40%) | 42 |
| → Pristine | 2200g + 16 (22%) | 70 |

### 11.3 The three play styles, preserved

**High-roller:** Grade Up on the gamble path, Reroll Affix repeatedly chasing a signature. Burns gold fast, sees results fast.

**Patient:** Disenchant every duplicate, stack Essence, take the deterministic Grade Up path, Imprint the one good affix and Reforge around it. Slower, guaranteed, rewards consistency.

**Mixed:** Gamble grade up to Sharp (cheap, high odds), Essence-grade to Refined, then save the 22% Pristine gamble for one anchor slot. Imprint a found signature and socket a fused gem to finish the piece. The common pattern for a deliberate player.

---

## 12. LOOT FEEL — THE PART THAT SELLS IT

A looter lives or dies on the moment of the drop. v1 spent one line on this ("a grade pill on the loot toast"). It deserves a real pass, because the dopamine is mostly ceremony. The good news: the presentation systems already exist (the reward-streak audio with its semitone climb, the `StingerId` stinger system, the additive-bloom VFX language). This is wiring them to loot.

### 12.1 The beam

Every meaningful drop plants a vertical light pillar in the world, colored by rarity and scaled by grade. A common component is a faint glint. A legendary is a tall colored shaft. A Pristine or signature drop is a thick beam with rising particles and a brief bloom flare. This is the Borderlands orange-beam reflex: you learn to read the floor from across the screen and your eye goes straight to the good one.

### 12.2 The sound

Drop audio escalates with rarity and grade, reusing the reward-streak semitone climb already in the audio layer. A junk drop ticks. A rare chimes higher. A Pristine or signature drop fires a dedicated stinger (a new `StingerId`) plus a short slow-motion micro-pause, the same beat a Diablo unique or a Borderlands legendary gets. The sound is the reward before the player even reads the tooltip.

### 12.3 The comparison

The single most important UX in a looter: is this better than what I have? Every loot toast and tooltip shows a live comparison against the active hero's equipped item in that slot:

- A green ↑ or red ↓ next to each changed stat.
- The affix diff (what this copy adds or loses versus the equipped one).
- A bold "UPGRADE" or "SIDEGRADE" banner when it clearly beats or trades with the current piece.

Without this, generous drops become a reading chore. With it, the player feels the upgrade instantly.

### 12.4 The loot filter (NEW, and required)

Raising drop rates this much creates inventory spam, which kills the feel faster than dry drops do. So generosity ships with filtering:

- **Pickup rules** by tier, rarity, and grade, so trash does not even toast.
- **Auto-disenchant** below a player-set threshold (junk turns straight into Essence on pickup, with a running counter).
- **Salvage All** at the Forge with a grade/rarity filter and a confirmation, plus a per-item "lock" so a keeper is never scrapped.

The filter is what lets the drop rates stay loud. Diablo and Path of Exile live on this; it is part of the rates, not a nice-to-have.

---

## 13. DIFFICULTY AND THE ENDGAME CHASE

Once a slot is Pristine, v1 had nothing left to chase but more Pristines. Affixes fix this: even at max grade, you re-run content to fish for better affix rolls and rarer signatures. Difficulty is the ladder that gates the affix pool, the way Diablo's world tiers and Borderlands' Mayhem levels work.

| Difficulty | Affix tiers unlocked | Max affixes seen | Signature pool |
|-----------|---------------------|------------------|----------------|
| Normal | T1–T2 | grade cap (up to 3) | none |
| Nightmare | T1–T3 | grade cap | minor signatures |
| Hell | T1–T4 | grade cap | full signatures |
| Hell + full badges / raids | T1–T5 | grade cap | the ancient tier (the loudest signatures and ranges) |

Region also flavors the pool: Icewrack rolls frost-leaning affixes, and so on, reusing the themed loot the regions already have. The endgame becomes "run Hell to chase a T5 Stormcaller's roll on my Pristine Daedalus," which is a goal that outlasts grade.

---

## 14. COMPLETE UPGRADE LOOP EXAMPLE

Player is level 18, running Nightmare in Icewrack (3 badges).

1. An ancient creep drops a **Sharp Daedalus** (level req 18, usable now). Two affix slots rolled: *Heavy* (+damage) and *of the Hawk* (+attack range). Decent, not what this hero wants.
2. At the Forge they **Reroll Affix** on *of the Hawk* for gold. It lands on *Blooddrinker's* (+8% lifesteal). Now it is a crit-lifesteal weapon. They keep it.
3. Over two sessions they disenchant duplicates for Essence and take the **deterministic Grade Up** to Refined. The new third affix slot rolls, and the Refined signature check hits 8%: *Glassbreaker* (attacks shred armor). The beam and stinger fire; this is the session's highlight.
4. They **Imprint** Glassbreaker so it is safe, then **Masterwork** to push the damage and lifesteal toward the top of the Refined band.
5. The item rolled one socket. They **Fuse** three Topaz chips into a Flawless Topaz and slot it for raw damage.
6. Later, chasing Pristine, they **Grade Up** on the gamble path (22%). It fails twice, hits on the third. At Pristine the magnitude rolls near max and the imprinted Glassbreaker survives.

Total investment: modest gold, Essence from recycled drops, and a few sessions. Every step was a choice, and the signature drop was a moment.

---

## 15. IMPLEMENTATION

### 15.1 New type surface

```typescript
// types.ts additions

export type ItemTier = 'consumable' | 'component' | 'basic' | 't1' | 't2' | 't3' | 't4' | 'special';
export type ItemGrade = 'broken' | 'worn' | 'standard' | 'sharp' | 'refined' | 'pristine';
export type AffixKind = 'prefix' | 'suffix' | 'signature';
export type AffixPoolId = 'weapon-like' | 'armor-like' | 'caster-like' | 'mobility' | 'any';

export interface AffixDef {
  id: string;
  name: string;
  kind: AffixKind;
  tier: 1 | 2 | 3 | 4 | 5;
  pools: AffixPoolId[];
  weight: number;
  statRanges?: Partial<Record<keyof StatMods, [number, number]>>;
  attack?: Partial<AttackModSpec>;
  trigger?: TriggerSpec;
  aura?: AuraSpec;
}

export interface RolledAffix {
  affixId: string;
  roll: number;             // 0..1 within ranges
  resolved: StatModMap;     // computed at drop, cached
}

export interface InstancedItem {
  itemId: string;
  grade: ItemGrade;
  gradeRoll: number;        // 0..1 base-stat percentile within the grade band
  affixes: RolledAffix[];
  sockets: (string | null)[]; // gem ids, null = empty
  resolvedMods: StatModMap; // base passiveMods + grade + affixes + gems, cached
  quality?: ItemQuality;    // cosmetic, unchanged from today
  inscribedKills?: number;
}

export interface ItemSetDef {
  id: string;
  name: string;
  pieces: string[];
  bonuses: { atPieces: number; mods?: StatModMap; aura?: AuraSpec; trigger?: TriggerSpec }[];
}
```

`ItemDef` gains `set?: string` and an optional `socketCap?: number`.

### 15.2 New files

- **`src/data/grade.ts`**: `GRADE_DEFS` (slots, percentile band, frame color, signature/socket chance), `itemLevel()`, `gradeFloor()`, `gradeBaseStatMods()`, `levelReq()`.
- **`src/data/affixes.ts`**: `AFFIX_DEFS`, `AFFIX_POOLS`, `rollAffixesFor(item, grade, difficulty, region, rng)`, `resolveAffix(affix, roll)`, `affixPoolForItem(def)`.
- **`src/data/gems.ts`**: gem defs, `fuseGems()`, gem stat application.
- **`src/data/sets.ts`**: `ITEM_SET_DEFS`, `activeSetBonuses(equipped)`.
- **`src/data/forge.ts`**: cost tables and the pure operations `attemptGradeUp`, `rerollAffix`, `reforge`, `imprintAffix`, `masterwork`, `socket`/`unsocket`, `disenchant` (returns Essence). All pure given an rng, none can lower an item.
- **`src/systems/loot-filter.ts`**: pickup rules, auto-disenchant threshold, salvage-all with locks.

### 15.3 Existing file changes

- **`src/data/items/index.ts`**: re-tier `core` to `t1`–`t4`/`special`; tag `set` and `socketCap` where relevant.
- **`src/data/creep-drops.ts`**: new generous rates (§9.1); resolution now produces an `InstancedItem` (grade then affixes); add the `elite` tier.
- **`src/data/tuning.ts`**: `gradeRollVariance: 0.20`, `eliteSpawnChance`, `merchantGradeMultiplier`, `merchantRefreshPerVisits`, `gambleVendor` (prices, pity), `affixTiersByDifficulty`, `lootFilterDefaults`, updated `neutralDropPctByTier: { small: 0.16, medium: 0.20, large: 0.28, ancient: 0.38 }`.
- **`src/systems/game.ts`**: `instantiateDrop(itemDef, context): InstancedItem` (grade floor from context, sample grade, roll base percentile, roll affixes, roll sockets, cache `resolvedMods`); set-bonus application on equip; gamble-vendor action; loot-filter hook on pickup.
- **Save/equip path** (`ItemSave`, `ItemState`): carry `grade`, `gradeRoll`, `affixes`, `sockets`; a save migration defaults existing items to Standard grade, no affixes, no sockets (so old saves load as the baseline they already were).
- **`src/ui/hud.ts`**: rarity glow + grade frame/pips (separate visuals, §1); tooltip with affix lines, signature in orange, set counter, sockets; the comparison arrows; the loot beam, escalating sound, and stinger; the loot-filter settings panel.

### 15.4 Phased rollout

**Phase A — Identity on drops.** Add the types. Implement grade, affixes, sockets, and the drop instancer with the new rates. Items start dropping with grades and affixes. Tooltip shows them; comparison arrows in. Forge shows "coming soon." Shops and crafted items stay Standard, affix-free.

**Phase B — Forge and new sources.** Full Forge (Grade Up, Reroll, Reforge, Imprint, Masterwork, Sockets, Fuse, Disenchant) on unified Essence. Elite creeps, hero drops, gamble vendor, merchant, caches. Sets live. Loot filter live.

**Phase C — Feel and balance.** The beam, escalating audio, and signature stinger. Difficulty-gated affix tiers and the T5 endgame pool. Full economy tuning pass from Phase A/B data.

---

## 16. BALANCE GUARDRAILS

**The tier gap beats the grade-and-affix gap.** A loaded Pristine Crystalys never out-scales a plain Daedalus. The ±20% band plus two or three affixes is loud within a tier and quiet across tiers. Any item that breaks this gets its `gradeRollVariance` or affix budget lowered individually.

**Affixes stay readable.** Behavior affixes (procs, triggers, auras) carry fixed labeled effects, not rolled magnitudes, so a player always knows what an affix does. Only flat-stat affixes roll a value, and those values stay inside the ±20% band.

**Signatures stay rare and special.** They roll at 8%/20% on Refined/Pristine only, and the loudest ones gate behind Hell and the T5 pool. A signature is a trophy, the way a Destiny godroll or a Diablo unique is, not a baseline expectation.

**No operation lowers an item.** Every Forge action either improves the item or leaves it untouched; the cost is the risk. This keeps the bench a place of forward progress.

**Special items stay exceptional.** Divine Rapier, Aegis, Refresher Shard, Cheese take no grade, no affixes, no sockets. Their power is categorical, not numerical.

**The filter is part of the rates.** Generous drops only feel good with the loot filter shipping alongside them. Tune them together, never the rates alone.

---

*File: `ITEM_REHAUL.md` — v2 draft. All numbers subject to a tuning pass after Phase A play data.*
