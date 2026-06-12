// Camera director for Ride mode. Six modes; all of them orbit/attach to the
// craft origin and orient relative to the live prograde frame, so every shot
// stays anchored to the real simulated state.

import * as THREE from 'three';

export type CamMode = 'fpv' | 'chase' | 'cinema' | 'orbit' | 'dock' | 'approach';

export const CAM_MODES: { id: CamMode; label: string }[] = [
  { id: 'fpv', label: 'FPV' },
  { id: 'chase', label: 'CHASE' },
  { id: 'cinema', label: 'CINE' },
  { id: 'orbit', label: 'ORBIT' },
  { id: 'approach', label: 'MARS' },
  { id: 'dock', label: 'DOCK' },
];

interface Shot {
  az: number;
  el: number;
  dist: number;
  fov: number;
  driftAz: number; // rad/s slow dolly
  driftDist: number;
}

const UP = new THREE.Vector3(0, 0, 1);

export interface CamContext {
  fwd: THREE.Vector3; // prograde unit
  burning: boolean;
  marsDir: THREE.Vector3 | null; // unit bearing to Mars (world)
  marsVisibleBig: boolean;
  docking: boolean;
  craftQuat: THREE.Quaternion;
  nose: THREE.Vector3; // world pos of capture ring
  interceptorPos: THREE.Vector3 | null;
}

export class CameraDirector {
  mode: CamMode = 'chase';
  az = 0;
  el = 0.1;
  dist = 46;
  private shot: Shot = { az: 0.8, el: 0.18, dist: 60, fov: 46, driftAz: 0.02, driftDist: -0.6 };
  private shotUntil = 0;
  private baseFov = 58;
  private fovNow = 58;

  /** user input (ignored in cinema; scene switches to orbit on drag there) */
  applyDrag(dx: number, dy: number): void {
    if (this.mode === 'cinema') return;
    this.az -= dx * 0.005;
    this.el = Math.min(1.25, Math.max(-1.25, this.el + dy * 0.005));
  }

  applyZoom(f: number): void {
    if (this.mode === 'cinema') return;
    const max = this.mode === 'orbit' ? 320 : 150;
    this.dist = Math.min(max, Math.max(this.mode === 'fpv' ? 0 : 20, this.dist * f));
  }

  reset(): void {
    this.az = 0;
    this.el = 0.1;
    this.dist = 46;
  }

  setMode(m: CamMode): void {
    if (this.mode === m) return;
    this.mode = m;
    this.shotUntil = 0; // re-roll cinema shot on entry
    if (m === 'chase') this.reset();
    if (m === 'orbit') this.dist = Math.max(this.dist, 60);
  }

  private rollShot(wall: number, c: CamContext): void {
    const r = Math.random;
    const presets: Shot[] = c.burning
      ? [
          { az: Math.PI * (0.82 + r() * 0.2), el: -0.05 + r() * 0.25, dist: 52 + r() * 30, fov: 44, driftAz: 0.015, driftDist: -0.8 }, // tail / plume
          { az: 0.6 + r() * 0.5, el: 0.3, dist: 40, fov: 50, driftAz: -0.02, driftDist: 0.4 },
        ]
      : [
          { az: 0.7 + r() * 0.9, el: 0.05 + r() * 0.35, dist: 55 + r() * 50, fov: 44, driftAz: 0.018, driftDist: -0.7 }, // front quarter
          { az: -1.4 - r() * 0.5, el: 0.5 + r() * 0.3, dist: 70 + r() * 40, fov: 40, driftAz: 0.012, driftDist: -0.5 }, // high side
          { az: Math.PI * (0.94 + r() * 0.12), el: -0.12, dist: 38 + r() * 16, fov: 56, driftAz: 0.008, driftDist: 0.5 }, // tail tracking
          { az: 2.2, el: -0.35, dist: 64, fov: 42, driftAz: -0.02, driftDist: -0.4 }, // low hero
        ];
    this.shot = presets[Math.floor(r() * presets.length)];
    this.shotUntil = wall + 6.5 + r() * 3;
  }

  /**
   * Compute camera position/orientation. Returns the world position the DOM
   * flare/marker projection should use this frame (camera world pos).
   */
  update(
    cam: THREE.PerspectiveCamera,
    c: CamContext,
    wall: number,
    dt: number,
    shake: number,
  ): void {
    const f = c.fwd;
    const r = new THREE.Vector3().crossVectors(f, UP).normalize();

    let az = this.az;
    let el = this.el;
    let dist = this.dist;
    let fovT = this.baseFov;
    let look = new THREE.Vector3().copy(f).multiplyScalar(30);

    switch (this.mode) {
      case 'fpv': {
        // mounted on top of the forward container, looking out along the hull
        // with a slight down-tilt so the nose hardware anchors the frame
        const local = new THREE.Vector3(0, 6.8, 5.6).applyQuaternion(c.craftQuat);
        const lookDir = new THREE.Vector3(0, 1, -0.09).applyQuaternion(c.craftQuat);
        cam.position.copy(local).addScaledVector(r, shakeOff(wall, shake, 0.35)).addScaledVector(UP, shakeOff(wall * 1.3, shake, 0.25));
        cam.up.copy(UP);
        cam.lookAt(local.clone().addScaledVector(lookDir, 60).add(new THREE.Vector3(this.az * -8, 0, this.el * 8)));
        this.fovNow += (72 + shake * 8 - this.fovNow) * Math.min(dt * 5, 1);
        cam.fov = this.fovNow;
        cam.updateProjectionMatrix();
        return;
      }
      case 'cinema': {
        if (wall > this.shotUntil) this.rollShot(wall, c);
        this.shot.az += this.shot.driftAz * dt;
        this.shot.dist = Math.max(30, this.shot.dist + this.shot.driftDist * dt);
        az = this.shot.az;
        el = this.shot.el;
        dist = this.shot.dist;
        fovT = this.shot.fov;
        // rule-of-thirds: bias look target off-axis
        look = new THREE.Vector3().copy(f).multiplyScalar(26).addScaledVector(r, 6).addScaledVector(UP, 3);
        break;
      }
      case 'approach': {
        if (c.marsDir) {
          // frame craft left-third, Mars right-third: camera sits on the
          // anti-Mars side, slightly above, looking past the craft at Mars
          const md = c.marsDir;
          const camPos = new THREE.Vector3()
            .addScaledVector(md, -78)
            .addScaledVector(UP, 26)
            .addScaledVector(r, 34);
          cam.position.copy(camPos).addScaledVector(r, shakeOff(wall, shake, 0.5));
          cam.up.copy(UP);
          cam.lookAt(new THREE.Vector3().addScaledVector(md, 220).addScaledVector(r, -16));
          this.fovNow += (50 - this.fovNow) * Math.min(dt * 4, 1);
          cam.fov = this.fovNow;
          cam.updateProjectionMatrix();
          return;
        }
        break; // no Mars context yet — fall through to chase framing
      }
      case 'dock': {
        if (c.interceptorPos) {
          // perched near the capture ring, watching the interceptor close in
          const pos = c.nose.clone().addScaledVector(r, 9).addScaledVector(UP, 5);
          cam.position.copy(pos);
          cam.up.copy(UP);
          cam.lookAt(c.interceptorPos);
          this.fovNow += (54 - this.fovNow) * Math.min(dt * 4, 1);
          cam.fov = this.fovNow;
          cam.updateProjectionMatrix();
          return;
        }
        break;
      }
      case 'orbit':
      case 'chase':
        break;
    }

    const ce = Math.cos(el);
    const dir = new THREE.Vector3()
      .addScaledVector(f, -ce * Math.cos(az))
      .addScaledVector(r, ce * Math.sin(az))
      .addScaledVector(UP, Math.sin(el));
    const jit = shakeOff(wall, shake, 0.9);
    cam.position.copy(dir.multiplyScalar(dist)).addScaledVector(r, jit).addScaledVector(UP, jit * 0.7);
    cam.up.copy(UP);
    cam.lookAt(look);
    this.fovNow += (fovT + shake * 10 - this.fovNow) * Math.min(dt * 5, 1);
    cam.fov = this.fovNow;
    cam.updateProjectionMatrix();
  }
}

function shakeOff(wall: number, amp: number, k: number): number {
  return (
    amp * k * (Math.sin(wall * 47.3) + Math.sin(wall * 71.7 + 1.4) + Math.sin(wall * 29.1 + 4.0)) * 0.33
  );
}
