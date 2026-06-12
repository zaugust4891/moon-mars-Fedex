// Three.js mission visualization. Pure rendering: every number displayed here
// was computed in the Rust core; this class only interpolates and draws.
//
// Views:
//   helio     — heliocentric ecliptic plane, 1 unit = 1e6 km
//   departure — selenocentric, 1 unit = 1e3 km
//   arrival   — areocentric,   1 unit = 1e3 km

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Pt, Trajectory } from '../engine/types';

export type ViewMode = 'helio' | 'departure' | 'arrival';

const HELIO_S = 1 / 1e6;
const LOCAL_S = 1 / 1e3;

function interp(ts: number[], pts: Pt[], t: number): Pt {
  if (ts.length === 0) return [0, 0];
  if (t <= ts[0]) return pts[0];
  if (t >= ts[ts.length - 1]) return pts[pts.length - 1];
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return [
    pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f,
    pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f,
  ];
}

function lineFrom(pts: Pt[], scale: number, color: number, opacity = 1): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map((p) => new THREE.Vector3(p[0] * scale, p[1] * scale, 0)),
  );
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new THREE.Line(geo, mat);
}

function circle(r: number, color: number, opacity = 0.5): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function ball(r: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
}

function label(text: string, color = '#9fb4cc'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '28px ui-monospace, monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(28, 7, 1);
  return sprite;
}

export interface SceneOptions {
  showVectors: boolean;
  showWell: boolean;
  showNbody: boolean;
}

export class MissionScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();

  private traj: Trajectory | null = null;
  private view: ViewMode = 'helio';
  private opts: SceneOptions = { showVectors: true, showWell: false, showNbody: false };

  private craft: THREE.Mesh;
  private earthM: THREE.Mesh | null = null;
  private marsM: THREE.Mesh | null = null;
  private moonM: THREE.Mesh | null = null;
  private vArrow: THREE.ArrowHelper;
  private aArrow: THREE.ArrowHelper;
  private well: THREE.Mesh | null = null;
  private burnFlare: THREE.PointLight;
  private raf = 0;
  private disposed = false;

  constructor(private container: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 50_000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.background = new THREE.Color(0x05080f);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sunlight = new THREE.PointLight(0xfff4d6, 2.2, 0, 0);
    this.scene.add(sunlight);
    this.scene.add(this.root);

    // starfield
    const stars = new THREE.BufferGeometry();
    const pos = new Float32Array(3000);
    for (let i = 0; i < 1000; i++) {
      const r = 2000 + Math.random() * 6000;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    stars.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(
      new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x4a5a72, size: 1.6 })),
    );

    this.craft = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 4.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x9ae6ff, emissive: 0x174a5e }),
    );
    this.scene.add(this.craft);
    this.vArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 18, 0x44dd88, 4, 2);
    this.aArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 12, 0xff7755, 3.5, 1.8);
    this.scene.add(this.vArrow, this.aArrow);
    this.burnFlare = new THREE.PointLight(0xffaa33, 0, 60);
    this.scene.add(this.burnFlare);

    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  setOptions(opts: SceneOptions): void {
    this.opts = opts;
    this.rebuild();
  }

  setTrajectory(traj: Trajectory): void {
    this.traj = traj;
    this.rebuild();
  }

  setView(view: ViewMode): void {
    if (this.view !== view) {
      this.view = view;
      // craft cone is sized for the heliocentric scale; shrink it in local views
      this.craft.scale.setScalar(view === 'helio' ? 1 : 0.3);
      this.rebuild();
      this.resetCamera();
    }
  }

  resetCamera(): void {
    const cam = {
      helio: new THREE.Vector3(0, -360, 250),
      departure: new THREE.Vector3(0, -42, 30),
      arrival: new THREE.Vector3(0, -78, 52),
    }[this.view];
    this.camera.position.copy(cam);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
  }

  private clearRoot(): void {
    while (this.root.children.length) {
      const c = this.root.children.pop()!;
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    }
    this.earthM = this.marsM = this.moonM = this.well = null;
  }

  private rebuild(): void {
    this.clearRoot();
    const t = this.traj;
    if (!t) return;

    if (this.view === 'helio') {
      const sun = ball(7, 0xffcc55);
      (sun.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xff9911);
      this.root.add(sun);
      this.root.add(circle(t.aEarthKm * HELIO_S, 0x3b6ea5));
      this.root.add(circle(t.aMarsKm * HELIO_S, 0xa55b3b));
      this.root.add(lineFrom(t.helio.craft, HELIO_S, 0x66e0ff));
      if (this.opts.showNbody && t.nbody) {
        this.root.add(lineFrom(t.nbody.craft, HELIO_S, 0xffa544, 0.8));
      }
      this.earthM = ball(2.4, 0x4d8fe0);
      this.marsM = ball(1.9, 0xd96f4a);
      this.moonM = ball(0.9, 0x9a9a9a);
      this.root.add(this.earthM, this.marsM, this.moonM);
      const ls = label('SUN', '#ffcc66');
      ls.position.set(0, 14, 0);
      this.root.add(ls);
      // burn markers at event positions
      for (const ev of t.events) {
        if (ev.kind === 'jettison') continue;
        const p = interp(t.helio.tDays, t.helio.craft, ev.tDays);
        const mk = new THREE.Mesh(
          new THREE.OctahedronGeometry(2.2),
          new THREE.MeshBasicMaterial({ color: ev.kind === 'kinetic' ? 0xff66ff : 0xffd34d }),
        );
        mk.position.set(p[0] * HELIO_S, p[1] * HELIO_S, 0);
        this.root.add(mk);
      }
      if (this.opts.showWell) this.buildWell();
    } else {
      const v = this.view === 'departure' ? t.departure : t.arrival;
      const body = ball(v.rBody * LOCAL_S, this.view === 'departure' ? 0x9a9a9a : 0xd96f4a);
      this.root.add(body);
      const lb = label(this.view === 'departure' ? 'MOON' : 'MARS');
      lb.position.set(0, v.rBody * LOCAL_S + 6, 0);
      this.root.add(lb);
      if (v.rOrbit) this.root.add(circle(v.rOrbit * LOCAL_S, 0x3b6ea5, 0.7));
      if (v.orbit) this.root.add(lineFrom(v.orbit, LOCAL_S, 0x55cc77, 0.9));
      this.root.add(lineFrom(v.craft, LOCAL_S, 0x66e0ff));
    }
  }

  /// Gravity-well surface: z = -k log10(1 + sum(mu_i / r_i)), sampled on a grid.
  private buildWell(): void {
    const geo = new THREE.PlaneGeometry(620, 620, 110, 110);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a4a6a,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
    });
    this.well = new THREE.Mesh(geo, mat);
    this.well.position.z = -34;
    this.root.add(this.well);
  }

  private updateWell(bodies: { x: number; y: number; mu: number }[]): void {
    if (!this.well) return;
    const pos = (this.well.geometry as THREE.PlaneGeometry).attributes
      .position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      let phi = 0;
      for (const b of bodies) {
        const dx = (x - b.x) / HELIO_S;
        const dy = (y - b.y) / HELIO_S;
        const r = Math.max(Math.sqrt(dx * dx + dy * dy), 5e5);
        phi += b.mu / r;
      }
      pos.setZ(i, -9 * Math.log10(1 + phi * 5e3));
    }
    pos.needsUpdate = true;
  }

  /** Update dynamic objects for mission time tDays (global mission clock). */
  setTime(tDays: number): void {
    const t = this.traj;
    if (!t) return;

    if (this.view === 'helio') {
      const s = HELIO_S;
      const cp = interp(t.helio.tDays, t.helio.craft, tDays);
      const ep = interp(t.helio.tDays, t.helio.earth, tDays);
      const mp = interp(t.helio.tDays, t.helio.mars, tDays);
      const lp = interp(t.helio.tDays, t.helio.moon, tDays);
      this.craft.position.set(cp[0] * s, cp[1] * s, 0);
      this.earthM?.position.set(ep[0] * s, ep[1] * s, 0);
      this.marsM?.position.set(mp[0] * s, mp[1] * s, 0);
      this.moonM?.position.set(lp[0] * s, lp[1] * s, 0);
      this.orient(t.helio.tDays, t.helio.craft, tDays, s, 0.35);
      if (this.well) {
        this.updateWell([
          { x: 0, y: 0, mu: 1.327e11 },
          { x: ep[0] * s, y: ep[1] * s, mu: 3.986e5 * 60 }, // x60 visual emphasis
          { x: mp[0] * s, y: mp[1] * s, mu: 4.283e4 * 60 },
        ]);
      }
    } else if (this.view === 'departure') {
      const v = t.departure;
      const hours = tDays * 24;
      const cp = interp(v.tHours, v.craft, hours);
      this.craft.position.set(cp[0] * LOCAL_S, cp[1] * LOCAL_S, 0);
      this.orient(v.tHours, v.craft, hours, LOCAL_S, 0.02);
    } else {
      const v = t.arrival;
      const tArrStart = t.transitDays - (v.tHours[v.tHours.length - 1] ?? 0) / 24;
      const hours = (tDays - tArrStart) * 24;
      const cp = interp(v.tHours, v.craft, hours);
      this.craft.position.set(cp[0] * LOCAL_S, cp[1] * LOCAL_S, 0);
      this.orient(v.tHours, v.craft, hours, LOCAL_S, 0.02);
    }

    // burn flare + acceleration arrow while a burn is active
    const active = t.events.find(
      (ev) =>
        ev.kind !== 'jettison' &&
        tDays >= ev.tDays &&
        tDays <= ev.tDays + Math.max(ev.durationS / 86400, 0.4),
    );
    this.burnFlare.position.copy(this.craft.position);
    this.burnFlare.intensity = active ? 3.5 : 0;
    this.aArrow.visible = !!active && this.opts.showVectors;
  }

  /** Point craft + velocity arrow along the local direction of travel. */
  private orient(ts: number[], pts: Pt[], tNow: number, scale: number, dt: number): void {
    const p0 = interp(ts, pts, tNow);
    const p1 = interp(ts, pts, tNow + dt);
    const dir = new THREE.Vector3((p1[0] - p0[0]) * scale, (p1[1] - p0[1]) * scale, 0);
    if (dir.lengthSq() < 1e-12) return;
    dir.normalize();
    this.craft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.vArrow.position.copy(this.craft.position);
    this.vArrow.setDirection(dir);
    this.vArrow.visible = this.opts.showVectors;
    this.aArrow.position.copy(this.craft.position);
    this.aArrow.setDirection(dir);
  }

  resize(): void {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearRoot();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
