import type { AbilityDef, AghanimDef } from '../../core/types';

// Shared Aghanim payload builder for the seeded (templated) hero cohorts.
// It derives a *real* ability upgrade from each hero's resolved abilities, so it
// works for both the generated kits and the hand-authored ones (which use custom
// ability ids). Stats stay on the augment's flat fallback (game.ts); the payload's
// job here is the ability change itself (ITEM_REHAUL §8.2).

const PRIMARY_VALUE_KEYS = ['damage', 'dps', 'heal', 'bonus', 'attackSpeed', 'stun', 'duration'];

function primaryValueKey(ability: AbilityDef | undefined): string | undefined {
  if (!ability?.values) return undefined;
  for (const key of PRIMARY_VALUE_KEYS) if (ability.values[key]) return key;
  const keys = Object.keys(ability.values);
  return keys.length > 0 ? keys[0] : undefined;
}

export function buildSeedAghanim(name: string, abilities: AbilityDef[]): AghanimDef {
  const ult = abilities.find((a) => a.ult);
  const basic = abilities.find((a) => !a.ult && a.values && Object.keys(a.values).length > 0);
  const ultKey = primaryValueKey(ult);
  const basicKey = primaryValueKey(basic);
  return {
    name: `${name}'s Scepter`,
    description: `Empowers ${ult?.name ?? 'the ultimate'} and tunes up ${basic?.name ?? 'a core skill'}.`,
    implemented: true,
    scepter: {
      abilityValueOverrides: ult && ultKey ? [{ abilityId: ult.id, valueKey: ultKey, mode: 'mul', amount: 1.35 }] : [],
      cooldownAdds: ult ? [{ abilityId: ult.id, amount: -8 }] : []
    },
    shard: {
      abilityValueOverrides: basic && basicKey ? [{ abilityId: basic.id, valueKey: basicKey, mode: 'mul', amount: 1.3 }] : [],
      cooldownAdds: basic ? [{ abilityId: basic.id, amount: -1.5 }] : []
    }
  };
}
