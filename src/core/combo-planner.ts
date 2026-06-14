import { TUNING } from '../data/tuning';
import { abilityVal } from './values';
import { itemReady } from './items';
import { itemArchetypes } from './item-archetype';
import { dist2, norm, scale, sub, add, v2 } from './math2d';
import { REG } from './registry';
import type { Sim } from './sim';
import type { Unit } from './unit';
import type { AbilityDef, EffectNode, GambitTargetMode, ItemDef, Order, StatusId, Vec2 } from './types';

export interface ComboStep {
  kind: 'cast' | 'item';
  slot: number;
  unitUid?: number;
  role: 'enabler' | 'amplifier' | 'payoff';
  targetMode: GambitTargetMode;
  windowSec: number;
}

export interface ComboPlan {
  steps: ComboStep[];
  targetUid: number;
  score: number;
  nextStep: ComboStep;
}

export interface TeamComboPlan {
  saveHolderUid: number | null;
  initiatorUid: number | null;
  lockdownUid: number | null;
  chains: ComboPlan[];
}

interface ComboCandidate extends ComboStep {
  def: AbilityDef;
  score: number;
  range: number;
  manaCost: number;
  initiationReach: number;
}

interface AbilityComboIntent {
  offensive: boolean;
  hardControl: boolean;
  softControl: boolean;
  amplify: boolean;
  initiation: boolean;
  aoe: boolean;
}

const HARD_DISABLES: ReadonlySet<StatusId> = new Set<StatusId>([
  'stun', 'root', 'hex', 'fear', 'sleep', 'frozen', 'cyclone'
]);
const SOFT_DISABLES: ReadonlySet<StatusId> = new Set<StatusId>([
  'silence', 'slow', 'disarm', 'blind', 'break'
]);

export function planUnitCombo(sim: Sim, u: Unit, focus: Unit): ComboPlan | null {
  if (!validFocus(sim, u, focus)) return null;

  const candidates = comboCandidates(sim, u, focus);
  const payoffs = candidates.filter((c) => c.role === 'payoff');
  if (payoffs.length === 0) return null;

  const plans: ComboPlan[] = [];
  const consider = (plan: ComboPlan) => plans.push(plan);

  if (comboSetupActive(focus)) {
    for (const payoff of payoffs) {
      if (!canReachStep(u, focus, payoff, 0)) continue;
      const plan = buildPlan([payoff], focus.uid, payoff.score);
      if (plan) consider(plan);
    }
  }

  const setupSteps = candidates.filter((c) => c.role === 'enabler' || c.role === 'amplifier');
  for (const setup of setupSteps) {
    for (const payoff of payoffs) {
      if (sameAction(setup, payoff)) continue;
      const reachBonus = setup.role === 'enabler' ? setup.initiationReach : 0;
      if (!canReachStep(u, focus, setup, 0)) continue;
      if (!canReachStep(u, focus, payoff, reachBonus)) continue;
      if (!canPayPlan(u, [setup, payoff])) continue;
      const discounted = payoff.score * TUNING.ai.comboWeight * Math.pow(TUNING.ai.combo.stepDiscount, 1);
      const setupValue = setup.role === 'amplifier' ? setup.score * 0.28 : setup.score * 0.18;
      const plan = buildPlan([setup, payoff], focus.uid, discounted + setupValue);
      if (plan) consider(plan);
    }
  }

  plans.sort((a, b) => b.score - a.score || planTieKey(a).localeCompare(planTieKey(b)));
  const best = plans[0];
  return best && best.score >= TUNING.ai.combo.minScore ? best : null;
}

export function planTeamCombos(sim: Sim, team: number, focus: Unit | null): TeamComboPlan {
  const allies = sim.unitsArr
    .filter((u) => u.alive && u.team === team && u.kind === 'hero')
    .sort((a, b) => a.uid - b.uid);
  const out: TeamComboPlan = {
    saveHolderUid: pickSaveHolder(sim, allies),
    initiatorUid: null,
    lockdownUid: null,
    chains: []
  };
  if (!focus || allies.length === 0) return out;
  if (!focus.alive || focus.team === team || focus.summary.untargetable || focus.summary.magicImmune || !focus.isVisibleTo(team, sim.time)) return out;

  const allSteps = allies.flatMap((u) => comboCandidates(sim, u, focus));
  const initiator = allSteps.find((step) => step.role === 'enabler' && step.initiationReach > 0);
  out.initiatorUid = initiator?.unitUid ?? null;

  const lockdowns = allSteps.filter((step) => step.role === 'enabler' && step.initiationReach <= 0);
  const payoffs = allSteps.filter((step) => step.role === 'payoff');
  const setupActive = comboSetupActive(focus);

  let best: ComboPlan | null = null;
  for (const setup of lockdowns) {
    for (const payoff of payoffs) {
      if (setup.unitUid === payoff.unitUid) continue;
      const setupOwner = sim.unit(setup.unitUid ?? -1);
      const payoffOwner = sim.unit(payoff.unitUid ?? -1);
      if (!setupOwner || !payoffOwner) continue;
      if (!canReachStep(setupOwner, focus, setup, 0)) continue;
      if (!canReachStep(payoffOwner, focus, payoff, 0)) continue;
      if (!canPayPlan(setupOwner, [setup]) || !canPayPlan(payoffOwner, [payoff])) continue;
      const score = payoff.score * TUNING.ai.comboWeight + setup.score * 0.25;
      const nextStep = setupActive ? payoff : setup;
      const plan: ComboPlan = {
        steps: [
          stripCandidate(setup),
          stripCandidate(payoff)
        ],
        targetUid: focus.uid,
        score,
        nextStep: stripCandidate(nextStep)
      };
      if (!best || plan.score > best.score || (plan.score === best.score && planTieKey(plan) < planTieKey(best))) best = plan;
    }
  }

  if (best && best.score >= TUNING.ai.combo.minScore) {
    out.lockdownUid = best.steps.find((step) => step.role === 'enabler')?.unitUid ?? null;
    out.chains.push(best);
  } else {
    out.lockdownUid = lockdowns[0]?.unitUid ?? null;
  }
  return out;
}

export function comboStepMatchesOrder(step: ComboStep, order: Order): boolean {
  if (step.kind === 'cast') return order.kind === 'cast' && order.slot === step.slot;
  return order.kind === 'item' && order.invSlot === step.slot;
}

export function comboPlanContainsOrder(plan: ComboPlan, order: Order): boolean {
  return plan.steps.some((step) => comboStepMatchesOrder(step, order));
}

export function orderForComboStep(sim: Sim, u: Unit, plan: ComboPlan): Order | null {
  const focus = sim.unit(plan.targetUid);
  if (!focus || !validFocus(sim, u, focus)) return null;
  const step = plan.nextStep;
  const def = step.kind === 'cast'
    ? u.abilities[step.slot]?.def
    : REG.items.get(u.items[step.slot]?.defId ?? '')?.active;
  if (!def) return null;
  return orderForDef(u, focus, step, def);
}

function buildPlan(steps: ComboCandidate[], targetUid: number, score: number): ComboPlan | null {
  if (steps.length === 0) return null;
  return {
    steps: steps.map(stripCandidate),
    targetUid,
    score,
    nextStep: stripCandidate(steps[0])
  };
}

function comboCandidates(sim: Sim, u: Unit, focus: Unit): ComboCandidate[] {
  const out: ComboCandidate[] = [];
  for (let slot = 0; slot < u.abilities.length; slot++) {
    const a = u.abilities[slot];
    if (!a || a.level <= 0) continue;
    if (!u.abilityReady(slot, sim.time).ok) continue;
    const role = abilityComboRole(a.def);
    if (!role) continue;
    out.push({
      kind: 'cast',
      slot,
      unitUid: u.uid,
      role,
      targetMode: targetModeForDef(a.def, role),
      windowSec: TUNING.ai.comboWindowSec,
      def: a.def,
      score: abilityComboScore(u, focus, a.def, a.level, role),
      range: castRangeOf(a.def, u, a.level),
      manaCost: u.manaCostOf(slot),
      initiationReach: initiationReachOf(a.def, a.level)
    });
  }

  for (let slot = 0; slot < u.items.length; slot++) {
    const it = u.items[slot];
    if (!it) continue;
    const def = REG.items.get(it.defId);
    if (!def?.active) continue;
    if (!itemReady(it, def, u, sim.time).ok) continue;
    const role = itemComboRole(def);
    if (!role) continue;
    out.push({
      kind: 'item',
      slot,
      unitUid: u.uid,
      role,
      targetMode: targetModeForDef(def.active, role),
      windowSec: TUNING.ai.comboWindowSec,
      def: def.active,
      score: itemComboScore(u, focus, def, role),
      range: castRangeOf(def.active, u, 1),
      manaCost: def.active.manaCost?.[0] ?? 0,
      initiationReach: initiationReachOf(def.active, 1)
    });
  }

  return out.sort((a, b) => b.score - a.score || roleRank(a.role) - roleRank(b.role) || a.kind.localeCompare(b.kind) || a.slot - b.slot);
}

function pickSaveHolder(sim: Sim, allies: Unit[]): number | null {
  let best: Unit | null = null;
  let bestScore = -Infinity;
  for (const u of allies) {
    let hasSave = false;
    for (let slot = 0; slot < u.items.length; slot++) {
      const it = u.items[slot];
      if (!it) continue;
      const def = REG.items.get(it.defId);
      if (!def?.active || !itemReady(it, def, u, sim.time).ok) continue;
      const arch = itemArchetypes(def);
      if (arch.has('save') || arch.has('sustain') || arch.has('cleanse')) hasSave = true;
    }
    for (let slot = 0; slot < u.abilities.length; slot++) {
      const a = u.abilities[slot];
      if (!a || !u.abilityReady(slot, sim.time).ok) continue;
      if (a.def.affects === 'ally') hasSave = true;
    }
    if (!hasSave) continue;
    const score = (u.heroId ? 0.25 : 0) + (u.stats.castRangeBonus / 1000) + (u.mana / Math.max(1, u.stats.maxMana));
    if (score > bestScore || (score === bestScore && (best === null || u.uid < best.uid))) {
      best = u;
      bestScore = score;
    }
  }
  return best?.uid ?? null;
}

function stripCandidate({ kind, slot, unitUid, role, targetMode, windowSec }: ComboCandidate): ComboStep {
  return { kind, slot, unitUid, role, targetMode, windowSec };
}

function abilityComboRole(def: AbilityDef): ComboStep['role'] | null {
  const intent = scanAbility(def);
  if (intent.offensive) return 'payoff';
  if (intent.hardControl || intent.softControl || intent.initiation) return 'enabler';
  if (intent.amplify) return 'amplifier';
  return null;
}

function itemComboRole(def: ItemDef): ComboStep['role'] | null {
  const arch = itemArchetypes(def);
  if (arch.has('nuke')) return 'payoff';
  if (arch.has('amplify')) return 'amplifier';
  if (arch.has('initiation') || arch.has('lockdown')) return 'enabler';
  return null;
}

function abilityComboScore(u: Unit, focus: Unit, def: AbilityDef, level: number, role: ComboStep['role']): number {
  const intent = scanAbility(def);
  const base = targetValue(focus);
  const ult = def.ult ? 0.6 : 0;
  const aoe = intent.aoe ? 0.35 : 0;
  const control = intent.hardControl ? 0.55 : intent.softControl ? 0.28 : 0;
  const reach = initiationReachOf(def, level) > 0 ? 0.25 : 0;
  const roleBonus = role === 'payoff' ? 0.9 : role === 'amplifier' ? 0.55 : 0.45;
  const depth = Math.max(0, (u.ctrl.aiDepth ?? TUNING.ai.bossAiDepth) - TUNING.ai.depthRefAiDepth) * 0.1;
  return base + roleBonus + ult + aoe + control + reach + depth;
}

function itemComboScore(u: Unit, focus: Unit, def: ItemDef, role: ComboStep['role']): number {
  const arch = itemArchetypes(def);
  const base = targetValue(focus);
  const roleBonus = role === 'payoff' ? 0.85 : role === 'amplifier' ? 0.7 : 0.5;
  const initiation = arch.has('initiation') ? 0.35 : 0;
  const lockdown = arch.has('lockdown') ? 0.35 : 0;
  const field = arch.has('field') ? 0.15 : 0;
  const depth = Math.max(0, (u.ctrl.aiDepth ?? TUNING.ai.bossAiDepth) - TUNING.ai.depthRefAiDepth) * 0.1;
  return base + roleBonus + initiation + lockdown + field + depth;
}

function canPayPlan(u: Unit, steps: ComboCandidate[]): boolean {
  const total = steps.reduce((sum, step) => sum + step.manaCost, 0);
  if (total <= 0) return true;
  if (u.mana < total) return false;
  const afterPct = (u.mana - total) / Math.max(1, u.stats.maxMana);
  return afterPct >= Math.max(0, TUNING.ai.manaFloorPct - TUNING.ai.combo.planManaMargin);
}

function canReachStep(u: Unit, focus: Unit, step: ComboCandidate, reachBonus: number): boolean {
  if (step.def.targeting === 'no-target' || step.def.targeting === 'toggle') return true;
  const range = step.range + reachBonus;
  return dist2(u.pos, focus.pos) <= range * range;
}

function validFocus(sim: Sim, u: Unit, focus: Unit): boolean {
  return focus.alive && focus.team !== u.team && !focus.summary.untargetable && !focus.summary.magicImmune && focus.isVisibleTo(u.team, sim.time);
}

function comboSetupActive(focus: Unit): boolean {
  const s = focus.summary;
  if (s.stunned || s.rooted || s.silenced || s.hexed || s.disarmed || s.frozen || s.sleeping || s.cycloned || s.feared !== null || s.taunted !== null) {
    return true;
  }
  return (s.mods.magicResistPct ?? 0) < 0 || (s.mods.damageTakenReductionPct ?? 0) < 0 || (s.mods.armor ?? 0) < 0;
}

function scanAbility(def: AbilityDef): AbilityComboIntent {
  const out = { offensive: false, hardControl: false, softControl: false, amplify: false, initiation: false, aoe: false };
  scanEffects(def.effects, out);
  if (def.channel?.tick) scanEffects(def.channel.tick.effects, out);
  if (def.channel?.onEnd) scanEffects(def.channel.onEnd, out);
  if (def.toggle) scanEffects(def.toggle.effects, out);
  if (def.targeting === 'ground-aoe') out.aoe = true;
  return out;
}

function scanEffects(nodes: EffectNode[] | undefined, out: AbilityComboIntent): void {
  if (!nodes) return;
  for (const n of nodes) {
    switch (n.kind) {
      case 'damage':
      case 'exotic':
        out.offensive = true;
        if ((n as { radius?: unknown }).radius !== undefined) out.aoe = true;
        break;
      case 'status':
        if (HARD_DISABLES.has(n.status)) out.hardControl = true;
        else if (SOFT_DISABLES.has(n.status)) out.softControl = true;
        if (n.params?.mods && modsAmplify(n.params.mods)) out.amplify = true;
        if (n.params?.dotDps !== undefined) out.offensive = true;
        if (n.radius !== undefined) out.aoe = true;
        if (n.params?.periodic) scanEffects(n.params.periodic.effects, out);
        break;
      case 'statmod':
        if (modsAmplify(n.mods)) out.amplify = true;
        break;
      case 'displace':
        if (n.mode === 'blink' && n.target === 'self') out.initiation = true;
        else out.hardControl = true;
        break;
      case 'zone':
        out.aoe = true;
        scanEffects(n.zone.tick?.effects, out);
        scanEffects(n.zone.onEnter?.effects, out);
        break;
      case 'projectile':
        scanEffects(n.proj.onHit, out);
        break;
      case 'repeat':
        scanEffects(n.effects, out);
        break;
      case 'mana':
        if (n.op === 'burn') out.offensive = true;
        break;
      case 'summon':
      case 'heal':
      case 'purge':
      case 'capture-channel':
        break;
    }
  }
}

function targetModeForDef(def: AbilityDef, role: ComboStep['role']): GambitTargetMode {
  if (def.targeting === 'no-target' || def.targeting === 'toggle') return 'self';
  if (role === 'payoff') return 'focus';
  if (def.targeting === 'ground-aoe') return 'most-clustered';
  return 'focus';
}

function orderForDef(u: Unit, focus: Unit, step: ComboStep, def: AbilityDef): Order | null {
  if (def.targeting === 'no-target' || def.targeting === 'toggle') {
    return step.kind === 'cast' ? { kind: 'cast', slot: step.slot } : { kind: 'item', invSlot: step.slot };
  }
  if (def.targeting === 'unit-target') {
    return step.kind === 'cast'
      ? { kind: 'cast', slot: step.slot, uid: focus.uid }
      : { kind: 'item', invSlot: step.slot, uid: focus.uid };
  }
  const point = pointForStep(u, focus, def);
  return step.kind === 'cast'
    ? { kind: 'cast', slot: step.slot, point }
    : { kind: 'item', invSlot: step.slot, point };
}

function pointForStep(u: Unit, focus: Unit, def: AbilityDef): Vec2 {
  if (scanAbility(def).initiation) {
    const away = norm(sub(u.pos, focus.pos));
    const dir = away.x === 0 && away.y === 0 ? v2(u.team === 0 ? -1 : 1, 0) : away;
    return add(focus.pos, scale(dir, Math.max(90, u.radius + focus.radius + 20)));
  }
  return { ...focus.pos };
}

function castRangeOf(def: AbilityDef, u: Unit, level: number): number {
  const base = def.castRange !== undefined ? abilityVal(def, def.castRange, level) : 600;
  if (scanAbility(def).initiation) return Math.max(base, initiationReachOf(def, level));
  return base + u.stats.castRangeBonus;
}

function initiationReachOf(def: AbilityDef, level: number): number {
  let reach = 0;
  const visit = (nodes?: EffectNode[]) => {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.kind === 'displace' && n.mode === 'blink' && n.target === 'self') {
        reach = Math.max(reach, n.distance !== undefined ? abilityVal(def, n.distance, level) : 900);
      } else if (n.kind === 'repeat') visit(n.effects);
    }
  };
  visit(def.effects);
  return reach;
}

function targetValue(o: Unit): number {
  const hpPct = o.hp / Math.max(1, o.stats.maxHp);
  const attackDps = o.stats.damage / Math.max(0.2, o.stats.attackInterval);
  const danger = Math.max(0, Math.min(1, (attackDps + (o.kind === 'hero' ? TUNING.ai.heroBias : 0)) / TUNING.ai.dangerNorm));
  return 0.5 + (1 - hpPct) * 0.8 + danger * 0.6;
}

function modsAmplify(mods: Record<string, unknown> | undefined): boolean {
  if (!mods) return false;
  return negative(mods.magicResistPct) || negative(mods.armor) || negative(mods.damageTakenReductionPct) || negative(mods.hpRegen);
}

function negative(value: unknown): boolean {
  return typeof value === 'number' && value < 0;
}

function sameAction(a: ComboCandidate, b: ComboCandidate): boolean {
  return a.kind === b.kind && a.slot === b.slot;
}

function roleRank(role: ComboStep['role']): number {
  return role === 'enabler' ? 0 : role === 'amplifier' ? 1 : 2;
}

function planTieKey(plan: ComboPlan): string {
  return plan.steps.map((s) => `${roleRank(s.role)}:${s.kind}:${s.slot}`).join('|');
}
