import * as THREE from 'three';
import type { SimEvent, VfxSpec } from '../core/types';
import { WORLD_SCALE } from './scale';

// ------------------------------------------------------------------
// Procedural VFX (SPEC §3): ~12 archetypes parameterized by color,
// scale, and duration. Sim events drive everything; no per-spell art.
// ------------------------------------------------------------------

interface Transient {
  obj: THREE.Object3D;
  until: number;
  update?: (t: number, lifeT: number) => void; // lifeT 0..1
}

export class VfxManager {
  group = new THREE.Group();
  private transients: Transient[] = [];
  private projectiles = new Map<number, { obj: THREE.Object3D; trail?: THREE.Object3D }>();
  private zones = new Map<number, Transient>();
  private time = 0;

  constructor(private heightAt: (x: number, y: number) => number) {}

  private w(x: number, y: number, lift = 0): THREE.Vector3 {
    return new THREE.Vector3(x / WORLD_SCALE, this.heightAt(x, y) + lift, y / WORLD_SCALE);
  }

  handleEvent(ev: SimEvent, unitPos: (uid: number) => { x: number; y: number; h: number } | null): void {
    switch (ev.t) {
      case 'projectile-spawn': {
        const obj = this.makeProjectile(ev.vfx);
        const p = this.w(ev.from.x, ev.from.y, 1.2);
        obj.position.copy(p);
        this.group.add(obj);
        this.projectiles.set(ev.pid, { obj });
        break;
      }
      case 'projectile-hit':
      case 'projectile-expire': {
        const entry = this.projectiles.get(ev.pid);
        if (entry) {
          this.group.remove(entry.obj);
          this.projectiles.delete(ev.pid);
          if (ev.t === 'projectile-hit') this.burst(ev.pos.x, ev.pos.y, '#ffffff', 0.6, 0.25);
        }
        break;
      }
      case 'zone-spawn': {
        this.spawnZone(ev);
        break;
      }
      case 'zone-expire': {
        const z = this.zones.get(ev.zid);
        if (z) {
          this.group.remove(z.obj);
          this.zones.delete(ev.zid);
        }
        break;
      }
      case 'aoe-burst': {
        this.burst(ev.pos.x, ev.pos.y, ev.vfx.color, (ev.radius / WORLD_SCALE) * 0.9, 0.45, ev.vfx.color2);
        break;
      }
      case 'blink': {
        this.blinkMark(ev.from.x, ev.from.y);
        this.blinkMark(ev.to.x, ev.to.y);
        break;
      }
      case 'cast': {
        const up = unitPos(ev.uid);
        if (up) this.castFlash(up.x, up.y, ev.vfx);
        break;
      }
      case 'capture-start': {
        const a = unitPos(ev.uid);
        const b = unitPos(ev.target);
        if (a && b) this.bindingBeam(a, b, ev.duration);
        break;
      }
      case 'capture-complete': {
        const p = unitPos(ev.target);
        if (p) this.burst(p.x, p.y, '#7adfc4', 2.2, 0.8, '#ffffff');
        break;
      }
      case 'summon': {
        this.burst(ev.pos.x, ev.pos.y, '#b7ffd9', 1.2, 0.5);
        break;
      }
      case 'death': {
        const p = unitPos(ev.uid);
        if (p) this.burst(p.x, p.y, '#3a3a44', 1.0, 0.6);
        break;
      }
      case 'levelup': {
        const p = unitPos(ev.uid);
        if (p) this.pillar(p.x, p.y, '#ffe27d', 1.2);
        break;
      }
      default:
        break;
    }
  }

  /** Track in-flight projectile positions from the sim each frame. */
  syncProjectiles(list: { pid: number; pos: { x: number; y: number } }[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.pid);
      const entry = this.projectiles.get(p.pid);
      if (entry) {
        const v = this.w(p.pos.x, p.pos.y, 1.2);
        entry.obj.position.lerp(v, 0.6);
        entry.obj.rotation.y += 0.2;
      }
    }
    for (const [pid, entry] of this.projectiles) {
      if (!seen.has(pid)) {
        this.group.remove(entry.obj);
        this.projectiles.delete(pid);
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.transients = this.transients.filter((tr) => {
      if (t >= tr.until) {
        this.group.remove(tr.obj);
        return false;
      }
      return true;
    });
    for (const tr of this.transients) {
      tr.update?.(t, 1 - (tr.until - t) / ((tr as Transient & { dur?: number }).dur ?? 1));
    }
    for (const [, z] of this.zones) z.update?.(t, 0);
  }

  private push(obj: THREE.Object3D, durSec: number, update?: Transient['update']): void {
    this.group.add(obj);
    const tr: Transient & { dur: number } = { obj, until: this.time + durSec, update, dur: durSec };
    this.transients.push(tr);
  }

  // ---------- archetype builders ----------

  private makeProjectile(vfx: VfxSpec): THREE.Object3D {
    const g = new THREE.Group();
    const scale = vfx.scale ?? 1;
    if (vfx.archetype === 'hook') {
      const hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.35 * scale, 0.1 * scale, 5, 8, Math.PI * 1.5),
        new THREE.MeshBasicMaterial({ color: vfx.color })
      );
      g.add(hook);
    } else {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.28 * scale, 6, 5),
        new THREE.MeshBasicMaterial({ color: vfx.color })
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.42 * scale, 6, 5),
        new THREE.MeshBasicMaterial({ color: vfx.color2 ?? vfx.color, transparent: true, opacity: 0.35 })
      );
      g.add(core, halo);
    }
    return g;
  }

  private burst(x: number, y: number, color: string, radiusW: number, dur: number, color2?: string): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 1, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(this.w(x, y, 0.15));
    const mat = ring.material as THREE.MeshBasicMaterial;
    this.push(ring, dur, (_t, lifeT) => {
      const s = 0.2 + lifeT * radiusW;
      ring.scale.set(s, s, 1);
      mat.opacity = 0.85 * (1 - lifeT);
    });
    // sparks
    const n = 14;
    const positions = new Float32Array(n * 3);
    const pts = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: color2 ?? color, size: 0.22, transparent: true, opacity: 0.9 })
    );
    pts.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const base = this.w(x, y, 0.4);
    pts.position.copy(base);
    const dirs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      dirs.push(Math.cos(a), 0.6 + (i % 3) * 0.3, Math.sin(a));
    }
    const pmat = pts.material as THREE.PointsMaterial;
    this.push(pts, dur, (_t, lifeT) => {
      for (let i = 0; i < n; i++) {
        positions[i * 3] = dirs[i * 3] * lifeT * radiusW * 0.9;
        positions[i * 3 + 1] = dirs[i * 3 + 1] * lifeT * 1.6 - lifeT * lifeT * 2.2;
        positions[i * 3 + 2] = dirs[i * 3 + 2] * lifeT * radiusW * 0.9;
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pmat.opacity = 0.9 * (1 - lifeT);
    });
  }

  private blinkMark(x: number, y: number): void {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.3, 3.2, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: '#7adfff', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    pillar.position.copy(this.w(x, y, 1.6));
    const mat = pillar.material as THREE.MeshBasicMaterial;
    this.push(pillar, 0.4, (_t, lifeT) => {
      pillar.scale.y = 1 - lifeT * 0.7;
      pillar.rotation.y += 0.3;
      mat.opacity = 0.7 * (1 - lifeT);
    });
  }

  private pillar(x: number, y: number, color: string, dur: number): void {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.copy(this.w(x, y, 2.5));
    const mat = beam.material as THREE.MeshBasicMaterial;
    this.push(beam, dur, (_t, lifeT) => {
      beam.rotation.y += 0.1;
      mat.opacity = 0.5 * (1 - lifeT);
      beam.scale.setScalar(1 + lifeT * 0.3);
    });
  }

  private castFlash(x: number, y: number, vfx: VfxSpec): void {
    if (vfx.archetype === 'global-mark') {
      this.pillar(x, y, vfx.color, 0.6);
      return;
    }
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: vfx.color, transparent: true, opacity: 0.7 })
    );
    flash.position.copy(this.w(x, y, 1.6));
    const mat = flash.material as THREE.MeshBasicMaterial;
    this.push(flash, 0.3, (_t, lifeT) => {
      flash.scale.setScalar(1 + lifeT * 1.6);
      mat.opacity = 0.7 * (1 - lifeT);
    });
  }

  private bindingBeam(a: { x: number; y: number; h: number }, b: { x: number; y: number; h: number }, dur: number): void {
    const from = this.w(a.x, a.y, 1.4);
    const to = this.w(b.x, b.y, 1.0);
    const len = from.distanceTo(to);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, len, 5, 1, true),
      new THREE.MeshBasicMaterial({ color: '#7adfc4', transparent: true, opacity: 0.8, depthWrite: false })
    );
    beam.position.copy(from.clone().add(to).multiplyScalar(0.5));
    beam.lookAt(to);
    beam.rotateX(Math.PI / 2);
    const mat = beam.material as THREE.MeshBasicMaterial;
    this.push(beam, dur, (t) => {
      mat.opacity = 0.5 + Math.sin(t * 12) * 0.3;
    });
    // swirling ring on target
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.06, 5, 16),
      new THREE.MeshBasicMaterial({ color: '#b7ffd9', transparent: true, opacity: 0.8, depthWrite: false })
    );
    ring.position.copy(to);
    ring.rotation.x = Math.PI / 2;
    this.push(ring, dur, (t) => {
      ring.rotation.z = t * 4;
      ring.position.y = to.y + 0.4 + Math.sin(t * 6) * 0.2;
    });
  }

  private spawnZone(ev: Extract<SimEvent, { t: 'zone-spawn' }>): void {
    const spec = ev.spec;
    const color = ev.vfx.color;
    const color2 = ev.vfx.color2 ?? '#ffffff';
    const g = new THREE.Group();

    if (spec.shape === 'line') {
      // wall of jagged spikes (Fissure) or glowing line
      const lenW = spec.length / WORLD_SCALE;
      const n = Math.max(3, Math.floor(lenW / 0.9));
      for (let i = 0; i < n; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.34 + ((i * 13) % 5) * 0.05, 1.1 + ((i * 7) % 4) * 0.3, 5),
          new THREE.MeshLambertMaterial({ color: spec.wall ? color : color2, flatShading: true })
        );
        const t = (i + 0.5) / n - 0.5;
        spike.position.set(t * lenW, 0.4, ((i * 11) % 3 - 1) * 0.15);
        spike.rotation.z = ((i * 17) % 7 - 3) * 0.06;
        g.add(spike);
      }
      g.position.copy(this.w(ev.pos.x, ev.pos.y, 0));
      g.rotation.y = -spec.angle;
    } else {
      const rW = spec.radius / WORLD_SCALE;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(rW, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.12;
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(rW * 0.93, rW, 28),
        new THREE.MeshBasicMaterial({ color: color2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.14;
      g.add(disc, rim);
      if (ev.vfx.archetype === 'storm') {
        // slow swirling shards over the area
        for (let i = 0; i < 8; i++) {
          const shard = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.22),
            new THREE.MeshBasicMaterial({ color: color2, transparent: true, opacity: 0.8 })
          );
          shard.userData.orbit = { r: rW * (0.3 + (i % 4) * 0.18), a: (i / 8) * Math.PI * 2, h: 0.6 + (i % 3) * 0.5 };
          g.add(shard);
        }
      }
      g.position.copy(this.w(ev.pos.x, ev.pos.y, 0));
    }

    this.group.add(g);
    const tr: Transient = {
      obj: g,
      until: Infinity,
      update: (t) => {
        for (const child of g.children) {
          const orbit = child.userData.orbit as { r: number; a: number; h: number } | undefined;
          if (orbit) {
            child.position.set(Math.cos(orbit.a + t * 2.2) * orbit.r, orbit.h + Math.sin(t * 3 + orbit.a) * 0.2, Math.sin(orbit.a + t * 2.2) * orbit.r);
            child.rotation.x = t * 3;
          }
        }
      }
    };
    this.zones.set(ev.zid, tr);
    if (spec.followUid !== undefined) g.userData.followUid = spec.followUid;
  }

  /** Zones that follow a unit (Blade Fury, Freezing Field). */
  syncZoneFollow(unitPos: (uid: number) => { x: number; y: number; h: number } | null): void {
    for (const [, z] of this.zones) {
      const fid = z.obj.userData.followUid as number | undefined;
      if (fid === undefined) continue;
      const p = unitPos(fid);
      if (p) z.obj.position.copy(this.w(p.x, p.y, 0));
    }
  }
}
