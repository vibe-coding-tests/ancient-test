import type { ActiveElement, EffectNode, HeroDef, TagArchetype, TagBoonDef, VfxSpec } from '../core/types';

const TAG_RADIUS = 300;

const LEGACY_SWAP_EFFECTS: EffectNode[] = [
  {
    kind: 'heal',
    amount: 'swapInHealPct',
    target: 'self',
    pctMaxHp: true
  },
  {
    kind: 'status',
    status: 'buff',
    duration: 'tagDuration',
    target: 'self',
    params: {
      tag: 'swap-in-burst',
      mods: { damagePct: 'swapInDamagePct', spellAmpPct: 'swapInDamagePct' }
    }
  }
];

function isActiveElement(element: HeroDef['element']): element is ActiveElement {
  return element !== undefined && element !== 'neutral';
}

function tagVfx(element: ActiveElement | undefined, fallback: string): VfxSpec {
  const colors: Partial<Record<ActiveElement, string>> = {
    pyro: '#ff7043',
    hydro: '#4fc3f7',
    electro: '#ce93d8',
    cryo: '#b3e5fc',
    geo: '#d7b56d',
    dendro: '#7ec850',
    anemo: '#9be7c5'
  };
  return { archetype: 'ground-aoe', color: element ? colors[element] ?? fallback : fallback };
}

function elementalPulse(element: ActiveElement | undefined): EffectNode[] {
  if (!element) return [];
  return [{
    kind: 'damage',
    dtype: 'magical',
    amount: 1,
    target: 'enemies-in-radius',
    radius: TAG_RADIUS
  }];
}

function boon(
  hero: HeroDef,
  archetype: TagArchetype,
  gaugeSec: number,
  text: string,
  effects: EffectNode[],
  opts: { fire?: TagBoonDef['fire']; outEffects?: EffectNode[] } = {}
): TagBoonDef {
  const element = isActiveElement(hero.element) ? hero.element : undefined;
  const prefix = opts.fire === 'tag-out' ? 'TAG-OUT' : opts.fire === 'both' ? 'TAG' : 'TAG-IN';
  const elementText = element ? ` + ${element}` : '';
  return {
    id: `${hero.id}-tag-boon`,
    fire: opts.fire ?? 'tag-in',
    effects: [...effects, ...elementalPulse(element), ...LEGACY_SWAP_EFFECTS],
    outEffects: opts.outEffects,
    gaugeSec,
    archetype,
    element,
    tooltip: `${prefix}: ${text}${elementText} · ${gaugeSec}s`
  };
}

function roleSet(hero: HeroDef): Set<string> {
  return new Set(hero.roles.map((r) => r.toLowerCase()));
}

function earlyRosterOverride(hero: HeroDef): TagBoonDef | null {
  switch (hero.id) {
    case 'axe':
      return boon(hero, 'Gather', 9, 'taunt-pulse nearby foes, self DR 3s', [
        { kind: 'status', status: 'taunt', duration: 0.8, target: 'enemies-in-radius', radius: TAG_RADIUS },
        { kind: 'status', status: 'slow', duration: 2, target: 'enemies-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 35 } },
        { kind: 'statmod', mods: { damageTakenReductionPct: 18 }, duration: 3, target: 'self' }
      ]);
    case 'pudge':
      return boon(hero, 'Gather', 9, 'pull nearby foes and slow them 2s', [
        { kind: 'displace', mode: 'pull', target: 'enemies-in-radius', radius: TAG_RADIUS, speed: 950 },
        { kind: 'status', status: 'slow', duration: 2, target: 'enemies-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 30 } }
      ]);
    case 'earthshaker':
      return boon(hero, 'Lockdown', 10, 'stun nearby foes 1s', [
        { kind: 'status', status: 'stun', duration: 1, target: 'enemies-in-radius', radius: TAG_RADIUS }
      ]);
    case 'crystal-maiden':
      return boon(hero, 'Mend', 12, 'heal allies 12% and frost nearby foes', [
        { kind: 'heal', amount: 12, pctMaxHp: true, target: 'allies-in-radius', radius: TAG_RADIUS },
        { kind: 'status', status: 'slow', duration: 2.5, target: 'enemies-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 35, attackSlowPct: 25 } }
      ]);
    case 'lich':
      return boon(hero, 'Cleanse', 12, 'cleanse self and frost-shield allies 3s', [
        { kind: 'purge', target: 'self' },
        { kind: 'statmod', mods: { armor: 4, magicResistPct: 12 }, duration: 3, target: 'allies-in-radius', radius: TAG_RADIUS }
      ]);
    case 'sniper':
      return boon(hero, 'Onslaught', 6, 'self +10% damage and range 3s', [
        { kind: 'statmod', mods: { damagePct: 10, attackRange: 90 }, duration: 3, target: 'self' }
      ]);
    case 'luna':
      return boon(hero, 'Strike', 7, 'glaive burst nearby foes + self damage 3s', [
        { kind: 'damage', dtype: 'magical', amount: 35, target: 'enemies-in-radius', radius: TAG_RADIUS },
        { kind: 'statmod', mods: { damagePct: 12 }, duration: 3, target: 'self' }
      ]);
    case 'sven':
      return boon(hero, 'Onslaught', 6, 'self +12% damage and mini-stun nearby foes', [
        { kind: 'statmod', mods: { damagePct: 12 }, duration: 3, target: 'self' },
        { kind: 'status', status: 'stun', duration: 0.6, target: 'enemies-in-radius', radius: 220 }
      ]);
    case 'juggernaut':
      return boon(hero, 'Bloodrush', 6, 'self +10% damage and heal 6%', [
        { kind: 'statmod', mods: { damagePct: 10, moveSpeedPct: 8 }, duration: 3, target: 'self' },
        { kind: 'heal', amount: 6, pctMaxHp: true, target: 'self' }
      ]);
    case 'warlock':
      return boon(hero, 'Imprint', 11, 'heal allies; tag-out leaves Fatal Bond field 5s', [
        { kind: 'heal', amount: 9, pctMaxHp: true, target: 'allies-in-radius', radius: TAG_RADIUS }
      ], {
        fire: 'both',
        outEffects: [{
          kind: 'zone',
          at: 'self',
          zone: {
            shape: 'circle',
            radius: 280,
            duration: 5,
            tick: {
              interval: 1,
              affects: 'enemies',
              effects: [{ kind: 'damage', dtype: 'magical', amount: 18, target: 'target' }]
            },
            auraMods: { affects: 'enemies', mods: { damageTakenReductionPct: -8 } }
          }
        }]
      });
    default:
      return null;
  }
}

function generatedBoon(hero: HeroDef): TagBoonDef {
  const roles = roleSet(hero);
  const support = roles.has('support');
  const carry = roles.has('carry');
  const nuker = roles.has('nuker');
  const durable = roles.has('durable');
  const disabler = roles.has('disabler');
  const initiator = roles.has('initiator');
  const pusher = roles.has('pusher');
  const escape = roles.has('escape');

  if (support && (roles.has('healer') || durable || !nuker)) {
    return boon(hero, 'Mend', 12, 'heal nearby allies 10% and grant magic resist 3s', [
      { kind: 'heal', amount: 10, pctMaxHp: true, target: 'allies-in-radius', radius: TAG_RADIUS },
      { kind: 'statmod', mods: { magicResistPct: 12 }, duration: 3, target: 'allies-in-radius', radius: TAG_RADIUS }
    ]);
  }

  if (support) {
    return boon(hero, 'Warcry', 10, 'nearby allies +16% spell damage 3s', [
      { kind: 'statmod', mods: { spellAmpPct: 16 }, duration: 3, target: 'allies-in-radius', radius: TAG_RADIUS }
    ]);
  }

  if (initiator && disabler) {
    return boon(hero, 'Gather', 10, 'pull nearby foes and slow them 2s', [
      { kind: 'displace', mode: 'pull', target: 'enemies-in-radius', radius: TAG_RADIUS, speed: 900 },
      { kind: 'status', status: 'slow', duration: 2, target: 'enemies-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 30 } }
    ]);
  }

  if (disabler) {
    return boon(hero, 'Lockdown', 9, 'root nearby foes 1s', [
      { kind: 'status', status: 'root', duration: 1, target: 'enemies-in-radius', radius: TAG_RADIUS }
    ]);
  }

  if (pusher && !carry) {
    return boon(hero, 'Drop', 10, 'drop a lingering slow field 4s', [{
      kind: 'zone',
      at: 'self',
      zone: {
        shape: 'circle',
        radius: 240,
        duration: 4,
        tick: {
          interval: 1,
          affects: 'enemies',
          effects: [{ kind: 'damage', dtype: 'magical', amount: 1, target: 'target' }]
        },
        auraMods: { affects: 'enemies', mods: { moveSpeedPct: -18 } }
      }
    }], {
      fire: 'both',
      outEffects: [{
        kind: 'zone',
        at: 'self',
        zone: {
          shape: 'circle',
          radius: 240,
          duration: 4,
          tick: {
            interval: 1,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'magical', amount: 1, target: 'target' }]
          },
          auraMods: { affects: 'enemies', mods: { moveSpeedPct: -18 } }
        }
      }]
    });
  }

  if (nuker) {
    return boon(hero, 'Strike', 7, 'burst nearby foes + self spell amp 3s', [
      { kind: 'damage', dtype: 'magical', amount: 45, target: 'enemies-in-radius', radius: TAG_RADIUS },
      { kind: 'statmod', mods: { spellAmpPct: 14 }, duration: 3, target: 'self' }
    ]);
  }

  if (durable) {
    return boon(hero, 'Vanguard', 8, 'self DR and slow nearby foes 2s', [
      { kind: 'statmod', mods: { damageTakenReductionPct: 16 }, duration: 3, target: 'self' },
      { kind: 'status', status: 'slow', duration: 2, target: 'enemies-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 25 } }
    ]);
  }

  if (carry && escape) {
    return boon(hero, 'Bloodrush', 6, 'self heal 5% and move speed 3s', [
      { kind: 'heal', amount: 5, pctMaxHp: true, target: 'self' },
      { kind: 'statmod', mods: { moveSpeedPct: 10, damagePct: 8 }, duration: 3, target: 'self' }
    ]);
  }

  return boon(hero, 'Onslaught', 6, 'self +10% damage 3s and slow nearest foe', [
    { kind: 'statmod', mods: { damagePct: 10 }, duration: 3, target: 'self' },
    { kind: 'status', status: 'slow', duration: 1, target: 'random-enemy-in-radius', radius: TAG_RADIUS, params: { moveSlowPct: 20 } }
  ]);
}

export function tagBoonForHero(hero: HeroDef): TagBoonDef {
  return earlyRosterOverride(hero) ?? generatedBoon(hero);
}

export function withDefaultTagBoon(hero: HeroDef): HeroDef {
  return hero.tagBoon ? hero : { ...hero, tagBoon: tagBoonForHero(hero) };
}

export function tagBoonVfx(hero: HeroDef): VfxSpec {
  return tagVfx(isActiveElement(hero.element) ? hero.element : undefined, hero.palette[2] ?? '#ffffff');
}

// ---------- power budget (§4) ----------
// The inverse-power law: the weaker a hero is on the raw-power axis, the stronger
// its tag-in payoff. We bucket each boon by its archetype (descriptive, not
// mechanical) and sum its authored effect magnitudes into a rough power score so a
// data-lint can prove a carry never quietly ships a support-sized boon.

// §4 power tiers, read from roles the way generatedBoon tiers them. The tier sets
// the band a boon's power score must sit inside, so the inverse-power law (weaker
// raw hero → stronger tag-in) is enforced as content grows.
export type TagBudgetTier = 'hypercarry' | 'striker' | 'frontline' | 'support';

export function tagBudgetTier(hero: HeroDef): TagBudgetTier {
  const roles = roleSet(hero);
  if (roles.has('support')) return 'support';
  if (roles.has('durable') || roles.has('initiator')) return 'frontline';
  if (roles.has('nuker') || roles.has('disabler')) return 'striker';
  return 'hypercarry';
}

// A team-wide effect is worth far more than a selfish one — the scope multiplier is
// where supports out-budget carries even at similar raw magnitudes.
function scopeWeight(target: unknown): number {
  const t = String(target);
  if (t.startsWith('allies')) return 2.6;
  if (t === 'self') return 1;
  if (t === 'enemies-in-radius' || t === 'units-in-radius') return 1.4;
  return 1; // single / random target
}

const CC_WEIGHT: Record<string, number> = {
  stun: 30, hex: 28, fear: 26, sleep: 26, cyclone: 26, frozen: 26,
  root: 22, taunt: 20, silence: 18, slow: 8, disarm: 14, break: 16
};

function numeric(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

// Percent-style mods count at face value; raw-unit mods (range, armor, attack
// speed) are normalized so a big absolute number doesn't masquerade as raw power.
const MOD_WEIGHT: Record<string, number> = {
  damageTakenReductionPct: 1.2,
  armor: 2,
  attackRange: 0.05,
  attackSpeed: 0.4,
  moveSpeedPct: 0.7,
  attackSlowPct: 0.6,
  lifestealPct: 0.8,
  hpRegen: 0.5
};

function modScore(mods: Record<string, unknown>): number {
  let m = 0;
  for (const [k, v] of Object.entries(mods)) m += Math.abs(numeric(v)) * (MOD_WEIGHT[k] ?? 1);
  return m;
}

function effectScore(e: EffectNode): number {
  switch (e.kind) {
    case 'statmod':
      return modScore(e.mods) * scopeWeight(e.target);
    case 'heal': {
      const amt = numeric(e.amount);
      const base = e.pctMaxHp ? amt * 2.2 : amt * 0.05;
      return base * scopeWeight(e.target);
    }
    case 'status': {
      const dur = Math.max(0.5, numeric(e.duration));
      const w = CC_WEIGHT[e.status] ?? 10;
      const slow = numeric(e.params?.moveSlowPct) * 0.3 + numeric(e.params?.attackSlowPct) * 0.2;
      return (w * dur + slow) * scopeWeight(e.target);
    }
    case 'displace':
      return 22 * scopeWeight(e.target);
    case 'damage':
      return numeric(e.amount) * 0.25 * scopeWeight(e.target);
    case 'zone':
      return 18;
    case 'summon':
      return 18;
    case 'purge':
      return 14 * scopeWeight(e.target);
    case 'mana':
      return 8 * scopeWeight(e.target);
    default:
      return 6;
  }
}

export function tagBoonPowerScore(boon: TagBoonDef): number {
  let score = 0;
  for (const e of boon.effects) score += effectScore(e);
  for (const e of boon.outEffects ?? []) score += effectScore(e) * 0.6; // tag-out legacy counts, discounted
  return score;
}

// The portion of a boon that keeps paying off after you swap away: team buffs/heals
// and enemy debuffs/damage persist; a selfish self-buff is wasted the instant you
// tag out. This is why a support rotation out-tempos a carry line (§4) — and the
// quantity the rotation-tempo harness sums.
export function tagBoonTeamValue(boon: TagBoonDef): number {
  let value = 0;
  const accrue = (effects: EffectNode[] | undefined, weight: number) => {
    for (const e of effects ?? []) {
      if (e.kind === 'statmod' && e.target === 'self') continue;
      if (e.kind === 'heal' && e.target === 'self') continue;
      value += effectScore(e) * weight;
    }
  };
  accrue(boon.effects, 1);
  accrue(boon.outEffects, 0.6);
  return value;
}
