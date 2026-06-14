import type { EffectNode, ItemDef, StatusId, TargetSel } from './types';

export type ItemArchetype =
  | 'initiation'
  | 'immunity'
  | 'lockdown'
  | 'amplify'
  | 'nuke'
  | 'save'
  | 'sustain'
  | 'escape'
  | 'field'
  | 'cleanse';

const HARD_DISABLES: ReadonlySet<StatusId> = new Set<StatusId>([
  'stun', 'root', 'hex', 'fear', 'sleep', 'frozen', 'cyclone'
]);
const SOFT_DISABLES: ReadonlySet<StatusId> = new Set<StatusId>([
  'silence', 'slow', 'disarm', 'blind', 'break'
]);

const ITEM_OVERRIDES: Readonly<Record<string, readonly ItemArchetype[]>> = {
  'blink-dagger': ['initiation', 'escape'],
  'boots-of-travel': ['initiation', 'escape'],
  'black-king-bar': ['immunity', 'cleanse'],
  'force-staff': ['save', 'escape'],
  'glimmer-cape': ['save', 'escape'],
  'mekansm': ['sustain', 'field'],
  'guardian-greaves': ['sustain', 'cleanse', 'field'],
  'pipe-of-insight': ['sustain', 'field'],
  'crimson-guard': ['sustain', 'field'],
  'drum-of-endurance': ['initiation', 'sustain', 'field'],
  'phase-boots': ['initiation', 'escape'],
  'hood-of-defiance': ['immunity'],
  'eternal-shroud': ['immunity', 'sustain'],
  'aeon-disk': ['immunity', 'escape'],
  'ghost-scepter': ['save', 'escape'],
  'lotus-orb': ['save', 'cleanse', 'immunity'],
  'linkens-sphere': ['save', 'immunity'],
  'manta-style': ['cleanse', 'escape'],
  'wind-waker': ['save', 'escape', 'lockdown'],
  'solar-crest': ['save', 'amplify'],
  'medallion-of-courage': ['amplify'],
  'veil-of-discord': ['amplify', 'field'],
  'ethereal-blade': ['amplify', 'nuke', 'lockdown'],
  'orchid-malevolence': ['lockdown', 'amplify'],
  bloodthorn: ['lockdown', 'amplify'],
  nullifier: ['lockdown', 'cleanse'],
  'diffusal-blade': ['lockdown', 'cleanse'],
  'scythe-of-vyse': ['lockdown'],
  'euls-scepter': ['lockdown', 'escape'],
  'rod-of-atos': ['lockdown'],
  gleipnir: ['lockdown', 'nuke', 'field'],
  'meteor-hammer': ['lockdown', 'nuke', 'field'],
  'heavens-halberd': ['lockdown'],
  'abyssal-blade': ['lockdown', 'nuke'],
  'shivas-guard': ['field', 'nuke', 'lockdown'],
  dagon: ['nuke'],
  'hand-of-midas': ['nuke'],
  'urn-of-shadows': ['nuke'],
  'spirit-vessel': ['nuke', 'amplify'],
  'magic-stick': ['sustain'],
  'magic-wand': ['sustain'],
  'holy-locket': ['save', 'sustain'],
  cheese: ['sustain'],
  bloodstone: ['sustain'],
  'soul-ring': ['sustain'],
  satanic: ['sustain', 'immunity'],
  'mask-of-madness': ['initiation', 'sustain'],
  mjollnir: ['save', 'field'],
  'silver-edge': ['initiation', 'escape'],
  refresher: ['amplify'],
  'refresher-orb': ['amplify'],
  'dust-of-appearance': ['cleanse', 'lockdown'],
  'observer-ward': ['field'],
  'sentry-ward': ['field', 'cleanse'],
  'smoke-of-deceit': ['initiation', 'escape'],
  'helm-of-the-dominator': ['field'],
  'helm-of-the-overlord': ['field']
};

const CACHE = new Map<string, readonly ItemArchetype[]>();

export function itemArchetypes(def: ItemDef): Set<ItemArchetype> {
  const cached = CACHE.get(def.id);
  if (cached) return new Set(cached);
  const out = deriveItemArchetypes(def);
  const ordered = [...out].sort();
  CACHE.set(def.id, ordered);
  return new Set(ordered);
}

function deriveItemArchetypes(def: ItemDef): Set<ItemArchetype> {
  const out = new Set<ItemArchetype>();
  addMany(out, ITEM_OVERRIDES[def.id]);

  if (def.aura) out.add('field');
  if (def.attackMod?.procStatus) {
    const { status, params } = def.attackMod.procStatus;
    if (HARD_DISABLES.has(status) || SOFT_DISABLES.has(status)) out.add('lockdown');
    if (modsAmplify(params?.mods) || params?.dotDps !== undefined) out.add('amplify');
  }
  if (def.attackMod?.procDamage !== undefined || def.attackMod?.manaBurnPerHit !== undefined) out.add('nuke');
  if (def.passiveMods?.spellAmpPct || def.passiveMods?.reactionAmpPct) out.add('amplify');
  if (def.passiveMods?.lifestealPct || def.passiveMods?.hpRegenPctMax || def.passiveMods?.hpRegen) out.add('sustain');

  const active = def.active;
  if (active) {
    scan(active.effects, out);
    if (active.channel?.tick) scan(active.channel.tick.effects, out);
    if (active.channel?.onEnd) scan(active.channel.onEnd, out);
    if (active.toggle) scan(active.toggle.effects, out);
    if (active.targeting === 'ground-aoe') out.add('field');
    if (active.affects === 'ally') out.add('save');
  }

  return out;
}

function scan(nodes: EffectNode[] | undefined, out: Set<ItemArchetype>): void {
  if (!nodes) return;
  for (const n of nodes) {
    switch (n.kind) {
      case 'damage':
        if (isEnemyTarget(n.target)) out.add('nuke');
        break;
      case 'heal':
        if (isAllyishTarget(n.target)) out.add(n.target === 'self' ? 'sustain' : 'save');
        else out.add('sustain');
        break;
      case 'mana':
        if (n.op === 'restore') out.add(isAllyishTarget(n.target) && n.target !== 'self' ? 'save' : 'sustain');
        else if (isEnemyTarget(n.target)) out.add('nuke');
        break;
      case 'status':
        scanStatus(n, out);
        break;
      case 'displace':
        if (n.mode === 'blink') {
          if (n.target === 'self') {
            out.add('initiation');
            out.add('escape');
          } else {
            out.add('lockdown');
          }
        } else if (isAllyishTarget(n.target)) {
          out.add('save');
          out.add('escape');
        } else if (isEnemyTarget(n.target)) {
          out.add('lockdown');
        }
        break;
      case 'zone':
        out.add('field');
        scan(n.zone.tick?.effects, out);
        scan(n.zone.onEnter?.effects, out);
        if (n.zone.auraMods?.mods && modsAmplify(n.zone.auraMods.mods)) out.add('amplify');
        break;
      case 'summon':
        out.add('field');
        break;
      case 'statmod':
        scanMods(n.target, n.mods, out);
        break;
      case 'projectile':
        scan(n.proj.onHit, out);
        break;
      case 'repeat':
        scan(n.effects, out);
        break;
      case 'purge':
        out.add('cleanse');
        if (isEnemyTarget(n.target)) out.add('lockdown');
        else if (isAllyishTarget(n.target)) out.add('save');
        break;
      case 'exotic':
        out.add(n.id.includes('refresh') ? 'amplify' : 'field');
        break;
      case 'capture-channel':
        out.add('lockdown');
        break;
    }
  }
}

function scanStatus(n: Extract<EffectNode, { kind: 'status' }>, out: Set<ItemArchetype>): void {
  if (n.status === 'magic-immune') {
    out.add('immunity');
    if (isAllyishTarget(n.target)) out.add('save');
  }
  if (n.status === 'invis') {
    out.add(isAllyishTarget(n.target) && n.target !== 'self' ? 'save' : 'escape');
  }
  if (n.params?.basicDispelOnApply) out.add('cleanse');

  if (isEnemyTarget(n.target) && (HARD_DISABLES.has(n.status) || SOFT_DISABLES.has(n.status))) out.add('lockdown');
  if (isAllyishTarget(n.target) && n.status === 'buff') out.add(n.target === 'self' ? 'sustain' : 'save');
  if (n.params?.periodic) scan(n.params.periodic.effects, out);
  if (n.params?.dotDps !== undefined && isEnemyTarget(n.target)) out.add('nuke');
  if (n.params?.mods) scanMods(n.target, n.params.mods, out);
}

function scanMods(target: TargetSel, mods: Record<string, unknown>, out: Set<ItemArchetype>): void {
  if (modsAmplify(mods)) out.add('amplify');
  if (isEnemyTarget(target)) return;
  if (mods.magicResistPct !== undefined || mods.statusResistPct !== undefined || mods.damageTakenReductionPct !== undefined || mods.armor !== undefined) out.add('immunity');
  if (mods.moveSpeedPct !== undefined) out.add('escape');
  if (mods.lifestealPct !== undefined || mods.hpRegen !== undefined || mods.hpRegenPctMax !== undefined || mods.manaRegen !== undefined) out.add('sustain');
  if (isAllyishTarget(target) && target !== 'self') out.add('save');
}

function modsAmplify(mods: Record<string, unknown> | undefined): boolean {
  if (!mods) return false;
  return negative(mods.magicResistPct) || negative(mods.armor) || negative(mods.damageTakenReductionPct) || negative(mods.hpRegen);
}

function negative(value: unknown): boolean {
  return typeof value === 'number' && value < 0;
}

function isEnemyTarget(target: TargetSel): boolean {
  return target === 'target' || target === 'enemies-in-radius' || target === 'random-enemy-in-radius';
}

function isAllyishTarget(target: TargetSel): boolean {
  return target === 'self' || target === 'allies-in-radius' || target === 'lowest-hp-ally-in-radius' || target === 'units-in-radius';
}

function addMany(out: Set<ItemArchetype>, values: readonly ItemArchetype[] | undefined): void {
  if (!values) return;
  for (const value of values) out.add(value);
}
