// ------------------------------------------------------------------
// Overworld level-of-detail (Phase 6 §3.16). Distances are in world
// units (sim units / WORLD_SCALE). Near units get full skeletal
// animation every frame; mid units animate at a reduced cadence; far
// units freeze their pose (no per-bone work) until they come closer.
//
// Pure + framework-free so the renderer (GameScene) and the headless
// perf harness classify identically.
// ------------------------------------------------------------------

export type LodTier = 'full' | 'reduced' | 'culled';
export type CrowdDetail = 'auto' | 'full' | 'balanced' | 'reduced';

export const LOD = {
  /** Within this radius of the camera focus: full animation every frame. */
  fullDist: 16,
  /** Up to this radius: reduced cadence (animate every other frame). */
  reducedDist: 34
} as const;

export function lodForDistance(distWorld: number): LodTier {
  if (distWorld <= LOD.fullDist) return 'full';
  if (distWorld <= LOD.reducedDist) return 'reduced';
  return 'culled';
}

/**
 * Whether a unit at this LOD tier should run its (expensive) skeletal
 * animation this frame. Reduced units animate on even frames only; culled
 * units never animate. `frameParity` is a 0/1 toggle the caller flips per frame.
 */
export function shouldAnimateAtLod(tier: LodTier, frameParity: number): boolean {
  if (tier === 'culled') return false;
  if (tier === 'reduced') return frameParity === 0;
  return true;
}

export function shouldUseCrowdImpostor(opts: {
  tier: LodTier;
  crowdDetail: CrowdDetail;
  fullAnimationBudget: number;
  selected: boolean;
  alive: boolean;
  isHero: boolean;
  isNpc: boolean;
}): boolean {
  if (!opts.alive || opts.selected || opts.isHero || opts.isNpc) return false;
  // Default/auto keeps authored unit views mounted at every visible distance.
  // LOD still throttles animation/shadows, but the unit does not swap from a
  // cone/procedural placeholder into a fuller model as the camera approaches.
  if (opts.crowdDetail === 'full' || opts.crowdDetail === 'auto') return false;
  if (opts.crowdDetail === 'reduced') return true;
  if (opts.tier !== 'full') return true;
  return opts.fullAnimationBudget <= 24;
}
