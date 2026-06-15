import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyItemAppearances, buildUnitRig, mountHeroModel } from '../engine/models';
import { animateRig, newAnimState, startTagIn } from '../engine/animator';
import type { Unit } from '../core/unit';

function attackingUnit(attackRange: number): Unit {
  return {
    uid: 1,
    pos: { x: 0, y: 0 },
    alive: true,
    stats: { attackPoint: 0.4, attackRange },
    windupUntil: 0.2,
    statuses: [],
    summary: { cycloned: false, frozen: false, rooted: false },
    castingUntil: -1,
    castGesture: null,
    channel: null,
    captureCh: null
  } as unknown as Unit;
}

function deadUnit(): Unit {
  return {
    uid: 1,
    pos: { x: 0, y: 0 },
    alive: false,
    stats: { attackPoint: 0.4, attackRange: 150 },
    windupUntil: 0,
    statuses: [],
    summary: { cycloned: false, frozen: false, rooted: false },
    castingUntil: -1,
    castGesture: null,
    channel: null,
    captureCh: null
  } as unknown as Unit;
}

function liveUnit(uid = 1): Unit {
  return {
    uid,
    pos: { x: 0, y: 0 },
    alive: true,
    stats: { attackPoint: 0.4, attackRange: 150 },
    windupUntil: 0,
    statuses: [],
    summary: { cycloned: false, frozen: false, rooted: false },
    castingUntil: -1,
    castGesture: null,
    channel: null,
    captureCh: null
  } as unknown as Unit;
}

function bodyMinY(rig: ReturnType<typeof buildUnitRig>): number {
  rig.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.body).min.y;
}

describe('procedural animator attack styles', () => {
  it('derives attack pose from visible rig weapon and item swaps', () => {
    const sword = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    animateRig(sword, attackingUnit(150), newAnimState(), 0.016, 1, 0);
    expect(Math.abs(sword.body.rotation.y)).toBeGreaterThan(0.1);

    const rifle = buildUnitRig({ build: 'biped', scale: 1, weapon: 'rifle' }, ['#888899', '#666677', '#aaaabb']);
    animateRig(rifle, attackingUnit(650), newAnimState(), 0.016, 1, 0);
    expect(rifle.body.position.x).toBeLessThan(-0.03);
    expect(Math.abs(rifle.body.rotation.y)).toBeLessThan(0.01);

    const hammer = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    applyItemAppearances(hammer, [{ weapon: { kind: 'storm-haft' } }]);
    animateRig(hammer, attackingUnit(150), newAnimState(), 0.016, 1, 0);
    expect(hammer.attackWeapon).toBe('storm-haft');
    expect(Math.abs(hammer.body.rotation.z)).toBeGreaterThan(0.1);
  });
});

describe('death grounding', () => {
  it('keeps procedural death poses above the unit origin', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    animateRig(rig, deadUnit(), newAnimState(), 1, 1, 0);

    expect(bodyMinY(rig)).toBeGreaterThanOrEqual(0.015);
  });

  it('keeps authored death clips with root motion above the unit origin', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    const death = new THREE.AnimationClip('death', 1, [
      new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, -3])
    ]);
    mountHeroModel(rig, model, [death]);

    animateRig(rig, deadUnit(), newAnimState(), 1, 1, 0);

    expect(bodyMinY(rig)).toBeGreaterThanOrEqual(0.015);
  });
});

describe('swap tag-in grounding', () => {
  it('keeps the arrival flourish planted instead of half-sized or over-floated', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const st = newAnimState();
    startTagIn(st, '#66ccff');

    animateRig(rig, liveUnit(), st, 0, 0, 0);

    expect(rig.body.position.y).toBeGreaterThan(0);
    expect(rig.body.position.y).toBeLessThanOrEqual(rig.height * 0.3 + 0.035);
    expect(rig.body.scale.x).toBeGreaterThanOrEqual(0.78);
    expect(rig.body.scale.x).toBeLessThan(1);
  });

  it('clamps the final landing frame above idle bob so feet never dip below the ground line', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const st = newAnimState();
    startTagIn(st, '#66ccff');

    // time=2 gives uid=1 a negative idle bob; the tag-in landing must absorb it.
    animateRig(rig, liveUnit(), st, 0.42, 2, 0);

    expect(st.tagInT).toBe(0);
    expect(rig.body.position.y).toBeGreaterThanOrEqual(0);
    expect(rig.body.scale.x).toBe(1);
  });

  it('stays ground-safe and within scale bounds across the entire arrival sweep', () => {
    // The two cases above sample one frame each; the bug class here (feet punching
    // through the floor, or a pop that reads as "sunk into the ground") happens at
    // intermediate p values. Walk the whole 0→1 sweep and assert the invariant holds
    // every frame: never below ground, never below the start scale, never a wild
    // overshoot, plus the flourish must actually lift the hero at some point.
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const st = newAnimState();
    startTagIn(st, '#66ccff');
    const dur = st.tagInDur;
    const steps = 24;
    let liftedAtLeastOnce = false;

    for (let i = 0; i <= steps; i++) {
      // vary `time` so the idle bob lands at different phases under the flourish
      animateRig(rig, liveUnit(), st, dur / steps, i * 0.13, 0);
      expect(rig.body.position.y, `frame ${i} ground-safe`).toBeGreaterThanOrEqual(0);
      expect(rig.body.scale.x, `frame ${i} min scale`).toBeGreaterThanOrEqual(0.78);
      expect(rig.body.scale.x, `frame ${i} max scale`).toBeLessThanOrEqual(1.05);
      if (rig.body.position.y > 0) liftedAtLeastOnce = true;
    }

    expect(liftedAtLeastOnce, 'the arrival visibly lifts the hero before planting').toBe(true);
    expect(st.tagInT, 'the sweep fully consumes the flourish').toBe(0);
    expect(rig.body.scale.x, 'lands at exactly full size').toBe(1);
  });
});
