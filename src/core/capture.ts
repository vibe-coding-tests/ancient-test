import { TUNING } from '../data/tuning';
import type { CreepInstanceSave, CreepTier } from './types';

// ------------------------------------------------------------
// Capture eligibility + the auto-chess merge (3 copies -> star).
// Deterministic: no catch RNG anywhere (SPEC §5).
// ------------------------------------------------------------

export function captureThreshold(tier: CreepTier): { hpPct: number; channelSec: number } {
  return TUNING.capture[tier];
}

export function canStartCapture(tier: CreepTier, hp: number, maxHp: number): boolean {
  return hp / maxHp <= captureThreshold(tier).hpPct;
}

let creepSeq = 1;
export function newCreepInstanceId(): string {
  return `c${Date.now().toString(36)}-${creepSeq++}`;
}

/**
 * Merge rule: 3 identical (creepId, star) -> one (star+1), capped at 3 stars.
 * Returns the new list plus a log of merges performed. Cascades (3x 2-star from
 * merges can immediately form a 3-star).
 */
export function mergeCreeps(list: CreepInstanceSave[]): { list: CreepInstanceSave[]; merges: { creepId: string; toStar: 2 | 3 }[] } {
  const out = list.map((c) => ({ ...c }));
  const merges: { creepId: string; toStar: 2 | 3 }[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map<string, CreepInstanceSave[]>();
    for (const c of out) {
      if (c.star >= 3) continue;
      const key = `${c.creepId}:${c.star}`;
      const g = groups.get(key) ?? [];
      g.push(c);
      groups.set(key, g);
    }
    for (const [, g] of groups) {
      if (g.length >= 3) {
        // consume the three oldest (stable order), keep the first as the upgrade
        const [keep, a, b] = g;
        keep.star = (keep.star + 1) as 2 | 3;
        keep.faintedFor = undefined;
        const removeIds = new Set([a.uid, b.uid]);
        for (let i = out.length - 1; i >= 0; i--) {
          if (removeIds.has(out[i].uid)) out.splice(i, 1);
        }
        merges.push({ creepId: keep.creepId, toStar: keep.star as 2 | 3 });
        changed = true;
        break; // re-group after each merge for clean cascades
      }
    }
  }
  return { list: out, merges };
}

/** Validate a fielded-entourage selection: ≤3 creeps, ≤1 ancient, none fainted. */
export function validateEntourage(
  selection: string[],
  storage: CreepInstanceSave[],
  tierOf: (creepId: string) => CreepTier
): { ok: boolean; reason?: string } {
  if (selection.length > TUNING.entourageMax) return { ok: false, reason: `max ${TUNING.entourageMax} fielded` };
  const seen = new Set<string>();
  let ancients = 0;
  for (const uid of selection) {
    if (seen.has(uid)) return { ok: false, reason: 'duplicate selection' };
    seen.add(uid);
    const inst = storage.find((c) => c.uid === uid);
    if (!inst) return { ok: false, reason: 'not in storage' };
    if (inst.faintedFor && inst.faintedFor > 0) return { ok: false, reason: `${inst.creepId} is fainted` };
    if (tierOf(inst.creepId) === 'ancient') ancients++;
  }
  if (ancients > TUNING.entourageAncientMax) return { ok: false, reason: `max ${TUNING.entourageAncientMax} ancient` };
  return { ok: true };
}
