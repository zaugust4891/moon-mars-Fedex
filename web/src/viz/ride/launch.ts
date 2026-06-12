// Lunar launch stage: industrial-scale surface infrastructure rendered during
// the first minutes of the mission. The terrain's recession is driven by the
// REAL ascent profile — altitude is read from the Rust core's selenocentric
// departure series (|r| − R_moon), never animated by script.
//
// Scene convention: 1 unit ≈ 1 m at launch scale; lunar "down" is world −Z
// (the same presentation convention the Mars-orbit nadir uses). Layout is
// propulsion-specific:
//   chemical / NTR / EP-kick — pad, gantry towers, umbilicals, tank farm
//   mass driver              — 4 km rail, pylons, accelerator coils with a
//                              sequenced energy pulse, capacitor yard

import * as THREE from 'three';
import type { LocalView, MissionResult } from '../../engine/types';
import { glowTexture, mulberry, regolithMap } from './textures';
import { cue } from './cues';

const HIDE_ALT_M = 18_000;

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  born: number; // wall seconds
}

export class LaunchStage {
  group = new THREE.Group();
  private coils: THREE.InstancedMesh | null = null;
  private coilColor: THREE.InstancedBufferAttribute | null = null;
  private nCoils = 0;
  private strobes: THREE.Sprite[] = [];
  private flood: THREE.SpotLight[] = [];
  private padGlow: THREE.Sprite | null = null;
  private dust: Burst | null = null;
  private dustFired = false;
  private firedRail = false;
  private kinetic: boolean;

  constructor(scene: THREE.Scene, mr: MissionResult | null) {
    this.kinetic = mr?.launcher != null;
    const rnd = mulberry(31);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2600, 72),
      new THREE.MeshStandardMaterial({ map: regolithMap(), roughness: 1, metalness: 0 }),
    );
    // CircleGeometry faces +Z which is exactly "up" in our convention
    ground.receiveShadow = true;
    this.group.add(ground);

    // scattered boulders
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 1 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 60);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      const r = 70 + rnd() * 2300;
      const a = rnd() * Math.PI * 2;
      const s = 0.6 + rnd() * 3.4;
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, s * 0.35),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
        new THREE.Vector3(s, s, s * 0.7),
      );
      rocks.setMatrixAt(i, m4);
    }
    this.group.add(rocks);

    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.45, metalness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.5, metalness: 0.7 });
    const sg = glowTexture('rgba(255,80,70,1)');

    if (this.kinetic) {
      this.buildRail(dark, steel, mr);
    } else {
      this.buildPad(dark, steel, sg, rnd);
    }

    // distant settlement: habitat domes + tank farm + window lights
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.7, metalness: 0.3 });
    for (const [dx, dy, r] of [
      [430, 260, 26],
      [480, 310, 18],
      [395, 330, 13],
    ] as const) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.rotation.x = Math.PI / 2;
      dome.position.set(dx, dy, 0);
      this.group.add(dome);
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(r * 0.5, 2.2, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
      );
      win.position.set(dx, dy - r + 1, 3.5);
      this.group.add(win);
    }
    for (let i = 0; i < 4; i++) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(6, 22, 6, 12), steel);
      tank.rotation.z = Math.PI / 2;
      tank.position.set(-380 - i * 18, 290, 6.2);
      this.group.add(tank);
    }

    scene.add(this.group);
  }

  private buildPad(
    dark: THREE.Material,
    steel: THREE.Material,
    strobeTex: THREE.Texture,
    rnd: () => number,
  ): void {
    // pad deck + hazard ring
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(24, 27, 4, 24), dark);
    pad.rotation.x = Math.PI / 2;
    pad.position.z = 1.5; // deck top ~3.5; the stack's tail sits in the trench
    this.group.add(pad);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(25.5, 0.5, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x33270a, emissive: 0xffb02e, emissiveIntensity: 1.4 }),
    );
    ring.position.z = 3.4;
    this.group.add(ring);
    // flame trench glow sprite under the craft (lit during ascent burn)
    this.padGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,170,90,1)'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.padGlow.position.z = 3.7;
    this.padGlow.scale.set(36, 36, 1);
    this.group.add(this.padGlow);

    // four lattice gantry towers with red strobes + floodlights
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 36;
      const y = Math.sin(a) * 36;
      const tower = new THREE.Group();
      for (const [ox, oy] of [
        [-2.2, -2.2],
        [2.2, -2.2],
        [-2.2, 2.2],
        [2.2, 2.2],
      ] as const) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 52), steel);
        leg.position.set(ox, oy, 26);
        tower.add(leg);
      }
      for (let z = 0; z < 5; z++) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.5, 0.5), steel);
        brace.position.set(0, 2.2, z * 10);
        tower.add(brace);
        const brace2 = brace.clone();
        brace2.position.y = -2.2;
        tower.add(brace2);
      }
      const strobe = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: strobeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      strobe.scale.set(4, 4, 1);
      strobe.position.set(0, 0, 46);
      tower.add(strobe);
      this.strobes.push(strobe);
      tower.position.set(x, y, 0);
      tower.rotation.z = rnd() * 0.02;
      this.group.add(tower);

      if (i < 2) {
        const sl = new THREE.SpotLight(0xfff1d0, 900, 600, 0.42, 0.5, 1.2);
        sl.position.set(x, y, 46);
        sl.target.position.set(0, 0, 21);
        this.group.add(sl, sl.target);
        this.flood.push(sl);
      }
      // umbilical arm toward the stack
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 26, 1.1), dark);
      arm.position.set(x * 0.55, y * 0.55, 24);
      arm.lookAt(new THREE.Vector3(0, 0, 22));
      this.group.add(arm);
    }
  }

  private buildRail(dark: THREE.Material, steel: THREE.Material, mr: MissionResult | null): void {
    const lenM = Math.min(Math.max((mr?.launcher?.trackLengthM ?? 3000) * 0.5, 1500), 4000);
    // rail bed runs along +Y (the launch/prograde axis at t0)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(7, lenM, 2.2), dark);
    bed.position.set(0, lenM / 2 - 60, 13);
    this.group.add(bed);
    for (const sx of [-1, 1]) {
      const railLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, lenM, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x0c2b36, emissive: 0x27c9f2, emissiveIntensity: 1.1 }),
      );
      railLine.position.set(sx * 2.6, lenM / 2 - 60, 14.4);
      this.group.add(railLine);
    }
    // support pylons
    const pylonGeo = new THREE.BoxGeometry(9, 2.4, 14);
    const pylons = new THREE.InstancedMesh(pylonGeo, steel, 26);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 26; i++) {
      m4.setPosition(0, -40 + i * (lenM / 26), 6);
      pylons.setMatrixAt(i, m4);
    }
    this.group.add(pylons);

    // accelerator coils — instanced tori with per-instance color for the
    // travelling energy pulse
    this.nCoils = 30;
    const coilGeo = new THREE.TorusGeometry(7.4, 0.65, 10, 28);
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x12343f,
      emissive: 0xffffff,
      emissiveIntensity: 1.0,
      roughness: 0.4,
      metalness: 0.6,
    });
    const coils = new THREE.InstancedMesh(coilGeo, coilMat, this.nCoils);
    for (let i = 0; i < this.nCoils; i++) {
      m4.makeRotationX(Math.PI / 2);
      m4.setPosition(0, -30 + i * (lenM / this.nCoils), 21);
      coils.setMatrixAt(i, m4);
    }
    const colors = new Float32Array(this.nCoils * 3).fill(0.05);
    coils.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.coils = coils;
    this.coilColor = coils.instanceColor;
    this.group.add(coils);

    // capacitor yard + radiators
    for (let i = 0; i < 6; i++) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 9), dark);
      cap.position.set(-60 - (i % 3) * 14, 40 + Math.floor(i / 3) * 12, 4.5);
      this.group.add(cap);
    }
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 18),
        new THREE.MeshStandardMaterial({ color: 0x1a100d, emissive: 0x802410, emissiveIntensity: 0.7, side: THREE.DoubleSide }),
      );
      fin.rotation.y = Math.PI / 2;
      fin.position.set(-96, 36 + i * 14, 9);
      this.group.add(fin);
    }
  }

  /** Spawn ballistic regolith spray: no air, 1/6 g — fast, flat, fast-settling. */
  private fireDust(wall: number): void {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const rnd = mulberry(Math.floor(wall * 1000) & 0xffff);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = 14 + rnd() * 70; // m/s, mostly lateral — vacuum sheet spray
      pos[i * 3] = (rnd() - 0.5) * 8;
      pos[i * 3 + 1] = (rnd() - 0.5) * 8;
      pos[i * 3 + 2] = 0.5 + rnd() * 2;
      vel[i * 3] = Math.cos(a) * v;
      vel[i * 3 + 1] = Math.sin(a) * v;
      vel[i * 3 + 2] = 4 + rnd() * 26;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xb9b2a8, size: 0.55, transparent: true, opacity: 0.85 }),
    );
    this.group.add(points);
    this.dust = { points, vel, born: wall };
    cue('launch-ignition');
  }

  /**
   * Per-frame update.
   * @param altM   real altitude above the lunar surface (m), from the
   *               selenocentric departure series
   * @param burnOn whether the ascent burn / rail shot window is active
   * @param tDays  mission clock
   */
  update(altM: number, burnOn: boolean, tDays: number, wall: number, dt: number): boolean {
    const visible = altM < HIDE_ALT_M;
    this.group.visible = visible;
    if (!visible) return false;

    // the whole stage recedes by the REAL altitude (1 unit = 1 m here); the
    // craft origin rides 21 m above the deck plane
    this.group.position.z = -(altM + 21);

    // pad strobes
    this.strobes.forEach((s, i) => {
      s.visible = (wall * 1.4 + i * 0.27) % 1 < 0.1;
    });

    // chemical: flame-trench glow while the ascent burn is on near the ground
    if (this.padGlow) {
      const target = burnOn && altM < 600 ? Math.min(0.62, 0.62 - altM / 1200) : 0;
      const mat = this.padGlow.material as THREE.SpriteMaterial;
      mat.opacity += (target - mat.opacity) * Math.min(dt * 6, 1);
    }

    // mass driver: travelling coil pulse during the launch instant
    if (this.coils && this.coilColor) {
      const charge = tDays < 1e-6 ? 0.4 + 0.3 * Math.sin(wall * 9) : 0;
      const head = Math.min(altM / 30, this.nCoils + 6); // pulse rides the real climb
      for (let i = 0; i < this.nCoils; i++) {
        const d = head - i;
        const hot = d > -1 && d < 4 ? 1.6 - Math.abs(d - 1.5) * 0.4 : charge * (i < 4 ? 1 : 0.25);
        const c = Math.max(hot, 0.05);
        this.coilColor.setXYZ(i, 0.15 * c, 0.85 * c, c);
      }
      this.coilColor.needsUpdate = true;
      if (!this.firedRail && altM > 1) {
        this.firedRail = true;
        cue('rail-fire');
      } else if (tDays < 1e-6) {
        cue('rail-charge');
      }
    }

    // dust burst at first motion
    if (!this.dustFired && (burnOn || this.kinetic) && altM > 0.5 && altM < 400) {
      this.dustFired = true;
      this.fireDust(wall);
    }
    if (this.dust) {
      const age = wall - this.dust.born;
      if (age > 7) {
        this.group.remove(this.dust.points);
        this.dust.points.geometry.dispose();
        (this.dust.points.material as THREE.Material).dispose();
        this.dust = null;
      } else {
        const p = this.dust.points.geometry.attributes.position as THREE.BufferAttribute;
        const v = this.dust.vel;
        for (let i = 0; i < p.count; i++) {
          p.setX(i, p.getX(i) + v[i * 3] * dt);
          p.setY(i, p.getY(i) + v[i * 3 + 1] * dt);
          p.setZ(i, p.getZ(i) + v[i * 3 + 2] * dt);
          v[i * 3 + 2] -= 1.62 * dt * 6; // lunar g (time-compressed for readability)
        }
        p.needsUpdate = true;
        (this.dust.points.material as THREE.PointsMaterial).opacity = Math.max(0.85 * (1 - age / 7), 0);
      }
    }
    return true;
  }

  /** Re-arm one-shot effects after a rewind to the pad. */
  reset(): void {
    this.dustFired = false;
    this.firedRail = false;
    if (this.dust) {
      this.group.remove(this.dust.points);
      this.dust.points.geometry.dispose();
      (this.dust.points.material as THREE.Material).dispose();
      this.dust = null;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      if (mat) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}

/** Real altitude (m) above the body surface from a selenocentric LocalView. */
export function altitudeM(dep: LocalView, tHoursNow: number): number {
  const ts = dep.tHours;
  const pts = dep.craft;
  if (ts.length === 0) return Infinity;
  if (tHoursNow >= ts[ts.length - 1]) return Infinity;
  let lo = 0;
  let hi = ts.length - 1;
  if (tHoursNow <= ts[0]) {
    hi = 1;
  } else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= tHoursNow) lo = mid;
      else hi = mid;
    }
  }
  const f = Math.min(Math.max((tHoursNow - ts[lo]) / (ts[hi] - ts[lo] || 1), 0), 1);
  const x = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f;
  const y = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f;
  return Math.max(Math.hypot(x, y) - dep.rBody, 0) * 1000;
}
