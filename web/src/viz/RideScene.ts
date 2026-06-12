// Ride mode v2: cinematic chase/POV renderer locked to the cargo stack.
//
// Honesty contract unchanged from v1 — every position, bearing, apparent
// size, burn window, mass and altitude is interpolated from the Rust core's
// outputs. The upgrades here are presentation: HDR post pipeline, real lit
// planet spheres with true terminators, launch-site infrastructure that
// recedes by the real ascent altitude, an event-anchored rendezvous
// sequence, and a multi-mode camera director. Starfield, glows, grain and
// shake remain cosmetic and are labeled as such where they occur.

import * as THREE from 'three';
import type { MissionResult, Trajectory } from '../engine/types';
import {
  activeEventAt,
  interp,
  isDecelEvent,
  velocityVecKms,
  fmtDistKm,
  R_EARTH_KM,
  R_MARS_KM,
  R_MOON_KM,
  R_SUN_KM,
} from './rideMath';
import { CelestialBody, SPHERE_DIST } from './ride/bodies';
import { RidePost } from './ride/postfx';
import { buildCraft, buildInterceptor, disposeObject, type CraftRig, type InterceptorRig } from './ride/craft';
import { LaunchStage, altitudeM } from './ride/launch';
import { CameraDirector, type CamMode } from './ride/cameras';
import {
  earthMap,
  marsMap,
  moonMap,
  milkyWayPoints,
  nebulaTexture,
  smudgeTexture,
  starField,
  streakTexture,
  sunCoreTexture,
} from './ride/textures';
import { cue } from './ride/cues';

const UP = new THREE.Vector3(0, 0, 1);

// ---------- DOM target markers ----------

interface Marker {
  root: HTMLDivElement;
  box: HTMLDivElement;
  arrow: HTMLDivElement;
  dist: HTMLSpanElement;
}

function makeMarker(parent: HTMLElement, name: string, color: string, cross = false): Marker {
  const root = document.createElement('div');
  root.className = 'ride-marker';
  const box = document.createElement('div');
  box.className = cross ? 'rm-cross' : 'rm-box';
  box.style.borderColor = color;
  if (cross) {
    box.textContent = '✛';
    box.style.color = color;
  }
  const arrow = document.createElement('div');
  arrow.className = 'rm-arrow';
  arrow.textContent = '▲';
  arrow.style.color = color;
  const label = document.createElement('div');
  label.className = 'rm-name';
  label.style.color = color;
  label.textContent = name;
  const dist = document.createElement('span');
  dist.className = 'rm-dist';
  label.appendChild(dist);
  root.append(box, arrow, label);
  parent.appendChild(root);
  return { root, box, arrow, dist };
}

export class RideScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private post: RidePost;
  private markersEl: HTMLDivElement;
  private flareEl: HTMLDivElement;
  private flares: HTMLDivElement[] = [];

  private traj: Trajectory | null = null;
  private mission: MissionResult | null = null;
  private craft: CraftRig;
  private interceptor: InterceptorRig;
  private launch: LaunchStage | null = null;
  private bodies: Record<'sun' | 'earth' | 'moon' | 'mars', CelestialBody>;
  private sunStreak: THREE.Sprite;
  private sunLight: THREE.DirectionalLight;
  private markers: Record<'earth' | 'moon' | 'mars', Marker>;
  private progradeMarker: Marker;
  private twinkle: THREE.PointsMaterial[] = [];
  private dimmable: THREE.Object3D[] = [];
  private starLayer1: THREE.Points;
  private arrivalGroup = new THREE.Group();
  private velArrow: THREE.ArrowHelper;

  private director = new CameraDirector();
  onModeChange?: (m: CamMode) => void;

  private tNow = 0;
  private fwd = new THREE.Vector3(0, 1, 0);
  private shakeAmp = 0;
  private wasBurning = false;
  private wasDecel = false;
  private dockCued = false;
  private arriveCued = false;
  private raf = 0;
  private frame = 0;
  private disposed = false;
  private dragging = false;
  private lastWall = performance.now();
  private pmremRT: THREE.WebGLRenderTarget | null = null;

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    if (this.director.mode === 'cinema') {
      this.director.setMode('orbit');
      this.onModeChange?.('orbit');
    }
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private onUp = () => (this.dragging = false);
  private onMove = (e: PointerEvent) => {
    if (this.dragging) this.director.applyDrag(e.movementX, e.movementY);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.director.applyZoom(1 + e.deltaY * 0.001);
  };
  private onDbl = () => this.director.reset();

  constructor(private container: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.markersEl = document.createElement('div');
    this.markersEl.className = 'ride-markers';
    container.appendChild(this.markersEl);
    this.flareEl = document.createElement('div');
    this.flareEl.className = 'ride-flares';
    container.appendChild(this.flareEl);
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = i === 5 ? 'rf-streak' : 'rf-ghost';
      this.flareEl.appendChild(d);
      this.flares.push(d);
    }

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 20000);
    this.scene.background = new THREE.Color(0x010309);
    this.scene.add(new THREE.AmbientLight(0xb8c6e0, 0.14));
    this.sunLight = new THREE.DirectionalLight(0xfff2d9, 2.7);
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = this.sunLight.shadow.camera.bottom = -160;
    this.sunLight.shadow.camera.right = this.sunLight.shadow.camera.top = 160;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 1400;
    this.scene.add(this.sunLight);

    // subtle image-based lighting so PBR hulls pick up specular interest
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const key = new THREE.Mesh(
      new THREE.SphereGeometry(3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff4dd }),
    );
    key.position.set(18, 4, 8);
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x16243d }),
    );
    fill.position.set(-16, -6, -10);
    envScene.add(key, fill);
    this.pmremRT = pmrem.fromScene(envScene, 0.06);
    this.scene.environment = this.pmremRT.texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // deep sky: three star strata + galactic band + faint nebulae + galaxies
    this.starLayer1 = starField(5200, 5200, 7800, 1.3, 0xc8d4e8, 0.5);
    const s2 = starField(1600, 5200, 7800, 2.1, 0xe8eefb, 0.75);
    const s3 = starField(220, 5200, 7800, 3.0, 0xfff4e0, 0.95);
    this.twinkle.push(this.starLayer1.material as THREE.PointsMaterial, s2.material as THREE.PointsMaterial);
    const mw = milkyWayPoints();
    this.scene.add(this.starLayer1, s2, s3, mw);
    for (const [seed, hueA, hueB, sc, px, py, pz] of [
      [3, 195, 350, 2400, 0.45, 0.75, 0.3],
      [9, 165, 280, 2000, -0.7, 0.3, 0.55],
      [27, 20, 200, 2600, 0.2, -0.6, -0.5],
    ] as const) {
      const neb = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: nebulaTexture(seed, hueA, hueB),
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      neb.position.set(px, py, pz).normalize();
      neb.position.multiplyScalar(7400);
      neb.scale.set(sc, sc, 1);
      this.scene.add(neb);
      this.dimmable.push(neb);
    }
    for (let i = 0; i < 5; i++) {
      const gal = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smudgeTexture(190 + i * 35),
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      );
      const a = i * 2.39996;
      gal.position.set(Math.cos(a), Math.sin(a), Math.sin(i * 1.7) * 0.8).normalize().multiplyScalar(7600);
      gal.scale.set(26 + i * 9, 12 + i * 4, 1);
      gal.material.rotation = i * 0.9;
      this.scene.add(gal);
      this.dimmable.push(gal);
    }

    // celestial bodies
    this.bodies = {
      sun: new CelestialBody(this.scene, {
        rKm: R_SUN_KM,
        disc: ['#fffdf2', '#ffe9a8', '#ff9d2e'],
        glowColor: 'rgba(255,200,90,1)',
        glowScale: 7,
        map: null,
        rotHours: 0,
      }),
      earth: new CelestialBody(this.scene, {
        rKm: R_EARTH_KM,
        disc: ['#dff1ff', '#4d8fe0', '#0a1f4d'],
        glowColor: 'rgba(110,170,255,1)',
        glowScale: 2.6,
        map: earthMap(),
        rotHours: 23.934,
        atmosphere: { color: 0x6ab7ff, scale: 1.045, power: 3.4, intensity: 0.9 },
      }),
      moon: new CelestialBody(this.scene, {
        rKm: R_MOON_KM,
        disc: ['#f2f2f0', '#9a9a9a', '#2e2e30'],
        glowColor: 'rgba(200,205,215,1)',
        glowScale: 2.2,
        map: moonMap(),
        rotHours: 655.7,
      }),
      mars: new CelestialBody(this.scene, {
        rKm: R_MARS_KM,
        disc: ['#ffd2a8', '#d96f4a', '#511504'],
        glowColor: 'rgba(255,140,80,1)',
        glowScale: 2.6,
        map: marsMap(),
        rotHours: 24.6597,
        atmosphere: { color: 0xe8a26b, scale: 1.03, power: 3.8, intensity: 0.7 },
      }),
    };
    (this.bodies.sun.sprite.material as THREE.SpriteMaterial).map = sunCoreTexture();
    this.sunStreak = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: streakTexture(),
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sunStreak.renderOrder = 3;
    this.scene.add(this.sunStreak);

    this.markers = {
      earth: makeMarker(this.markersEl, 'EARTH ', '#7fb8ff'),
      moon: makeMarker(this.markersEl, 'MOON ', '#cfd6df'),
      mars: makeMarker(this.markersEl, 'MARS ', '#ff9a66'),
    };
    this.progradeMarker = makeMarker(this.markersEl, 'PROGRADE', '#7dde9a', true);

    this.craft = buildCraft(null, false);
    this.scene.add(this.craft.group);
    this.interceptor = buildInterceptor();
    this.scene.add(this.interceptor.group);
    this.scene.add(this.arrivalGroup);
    this.velArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 26, 0x44ddaa, 5, 2.4);
    this.velArrow.visible = false;
    this.scene.add(this.velArrow);

    this.post = new RidePost(this.renderer, this.scene, this.camera, (q) => {
      // cosmetic-only degradation ladder beyond the post passes
      for (const d of this.dimmable) d.visible = q >= 2;
      this.starLayer1.visible = q >= 1;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('dblclick', this.onDbl);

    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.update();
      this.post.render();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------- public API ----------

  setTrajectory(traj: Trajectory): void {
    this.traj = traj;
    this.rebuildCraft();
    this.rebuildArrival();
    this.resetLaunch();
    this.dockCued = this.arriveCued = false;
  }

  setMission(mr: MissionResult | null): void {
    this.mission = mr;
    this.rebuildCraft();
    this.resetLaunch();
  }

  setTime(tDays: number): void {
    if (tDays < 1e-4 && this.tNow > 0.5) {
      // rewound to the pad: re-arm one-shot cinematics
      this.launch?.reset();
      this.dockCued = this.arriveCued = false;
    }
    this.tNow = tDays;
  }

  setCamMode(m: CamMode): void {
    this.director.setMode(m);
  }

  private rebuildCraft(): void {
    this.scene.remove(this.craft.group);
    disposeObject(this.craft.group);
    this.craft = buildCraft(this.mission, this.traj?.lowThrust ?? false);
    this.craft.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(this.craft.group);
  }

  private resetLaunch(): void {
    if (this.launch) {
      this.launch.dispose(this.scene);
      this.launch = null;
    }
  }

  /** Real areocentric arrival geometry: inbound hyperbola + target orbit. */
  private rebuildArrival(): void {
    while (this.arrivalGroup.children.length) {
      const c = this.arrivalGroup.children.pop()!;
      disposeObject(c);
    }
    const t = this.traj;
    if (!t) return;
    const mk = (pts: [number, number][], color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints(
        pts.map((p) => new THREE.Vector3(p[0], p[1], 0)),
      );
      return new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
    };
    // hyperbola leg = points before periapsis pass (first 120 samples by
    // construction in trajectory.rs); the rest is the target orbit
    this.arrivalGroup.add(mk(t.arrival.craft.slice(0, 120), 0x57dcff, 0.75));
    if (t.arrival.orbit) this.arrivalGroup.add(mk(t.arrival.orbit, 0x52e09a, 0.8));
    const peri = new THREE.Mesh(
      new THREE.OctahedronGeometry(140),
      new THREE.MeshBasicMaterial({ color: 0xffd34d }),
    );
    const rp = t.arrival.rPeri ?? t.arrival.rBody;
    peri.position.set(rp, 0, 0);
    this.arrivalGroup.add(peri);
    this.arrivalGroup.visible = false;
  }

  // ---------- per-frame ----------

  private update(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastWall) / 1000, 0.1);
    this.lastWall = now;
    const wall = now / 1000;
    this.frame++;

    this.twinkle.forEach((m, i) => {
      m.opacity = (i === 0 ? 0.5 : 0.75) + 0.05 * Math.sin(wall * 1.6 + i * 2.4);
    });

    const t = this.traj;
    if (!t) {
      this.post.govern(dt * 1000, wall);
      return;
    }
    const tD = this.tNow;
    const h = t.helio;

    const cp = interp(h.tDays, h.craft, tD);
    const vel = velocityVecKms(h.tDays, h.craft, tD);
    const speed = Math.hypot(vel[0], vel[1]);
    if (speed > 1e-6) this.fwd.set(vel[0] / speed, vel[1] / speed, 0);

    // ----- burn state, cues, shake from real acceleration -----
    const ev = activeEventAt(t.events, tD);
    const burning = !!ev && ev.kind !== 'kinetic' && ev.durationS > 0;
    const isSpiral = ev?.kind === 'spiral';
    const decel = !!ev && isDecelEvent(ev);
    if (burning !== this.wasBurning) {
      cue(burning ? 'burn-start' : 'burn-end', ev ? { name: ev.name } : undefined);
      this.wasBurning = burning;
    }
    if (decel && !this.wasDecel) cue('flip-maneuver');
    this.wasDecel = decel;

    let shakeTarget = 0;
    if (burning && ev) {
      // amplitude from the burn's real mean acceleration (Δv / duration)
      const accel = (ev.dvKms * 1000) / Math.max(ev.durationS, 1);
      shakeTarget = isSpiral ? 0.05 : Math.min(Math.max(Math.log10(1 + accel) * 0.4, 0.15), 0.9);
    }
    const kineticShot = this.mission?.launcher != null && !t.lowThrust && tD < 2e-4 && tD > 0;
    if (kineticShot) shakeTarget = 1.1; // thousands of g on the rail — brief, violent
    this.shakeAmp += (shakeTarget - this.shakeAmp) * Math.min(dt * 3, 1);
    this.updatePlume(burning, isSpiral, wall);

    // ----- launch stage: real-altitude-driven surface recession -----
    const kinetic = this.mission?.launcher != null;
    let launchVisible = false;
    let altM = Infinity;
    if (tD < 0.25) {
      altM = altitudeM(t.departure, tD * 24);
      if (altM < 18_000) {
        if (!this.launch && this.mission) {
          this.launch = new LaunchStage(this.scene, this.mission);
          const v0 = velocityVecKms(h.tDays, h.craft, 0);
          const s0 = Math.hypot(v0[0], v0[1]) || 1;
          this.launch.group.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(v0[0] / s0, v0[1] / s0, 0),
          );
        }
        const ascentBurn = !!ev && tD < 0.1;
        launchVisible = this.launch?.update(altM, ascentBurn, tD, wall, dt) ?? false;
      } else if (this.launch) {
        this.launch.group.visible = false;
      }
    } else if (this.launch) {
      this.launch.group.visible = false;
    }
    this.sunLight.castShadow = launchVisible;

    // visual attitude: vertical liftoff pitching onto the prograde rail for
    // rocket ascents (the core's ascent arc is schematic; mass drivers fly
    // horizontally along the track from the first frame)
    const fVis = new THREE.Vector3().copy(this.fwd);
    if (!kinetic && altM < 12_000) {
      const s = Math.min(Math.max(altM / 12_000, 0.03), 1);
      fVis.multiplyScalar(s).addScaledVector(UP, 1 - s).normalize();
    }

    const facing = decel ? fVis.clone().negate() : fVis;
    const targetQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), facing);
    this.craft.group.quaternion.slerp(targetQ, Math.min(dt * 3.5, 1));

    this.craft.strobes.forEach((s, i) => {
      s.visible = (wall * 1.1 + i * 0.33) % 1 < 0.08;
    });

    // ----- celestial bodies along true bearings -----
    const ep = interp(h.tDays, h.earth, tD);
    const mp = interp(h.tDays, h.mars, tD);
    const lp = interp(h.tDays, h.moon, tD);
    const dEarth = Math.hypot(ep[0] - cp[0], ep[1] - cp[1]);
    const dMars = Math.hypot(mp[0] - cp[0], mp[1] - cp[1]);
    const dMoon = Math.hypot(lp[0] - cp[0], lp[1] - cp[1]);
    const inOrbit = dMars < 5e4 && (t.lowThrust ? tD > t.transitDays * 0.5 : tD >= t.tofDays);
    if (inOrbit && !this.arriveCued) {
      this.arriveCued = true;
      cue('arrival');
    }

    const rSun = Math.hypot(cp[0], cp[1]);
    const sunDir = new THREE.Vector3(-cp[0] / rSun, -cp[1] / rSun, 0);
    this.bodies.sun.place(sunDir, rSun, tD);
    if (dEarth < 25_000) this.bodies.earth.hide();
    else this.bodies.earth.place(new THREE.Vector3((ep[0] - cp[0]) / dEarth, (ep[1] - cp[1]) / dEarth, 0), dEarth, tD);
    if (dMoon < 25_000) this.bodies.moon.hide();
    else this.bodies.moon.place(new THREE.Vector3((lp[0] - cp[0]) / dMoon, (lp[1] - cp[1]) / dMoon, 0), dMoon, tD);
    if (inOrbit) {
      const rOrbitKm = t.arrival.rPeri ?? t.arrival.rBody + 500;
      const nadir = new THREE.Vector3(this.fwd.x * 0.643, this.fwd.y * 0.643, -0.766).normalize();
      this.bodies.mars.place(nadir, rOrbitKm, tD);
    } else {
      this.bodies.mars.place(new THREE.Vector3((mp[0] - cp[0]) / dMars, (mp[1] - cp[1]) / dMars, 0), dMars, tD);
    }

    // sun visuals + true-direction lighting
    this.sunStreak.position.copy(this.bodies.sun.world);
    const sunSize = this.bodies.sun.sprite.scale.x;
    this.sunStreak.scale.set(sunSize * 10, sunSize * 0.2, 1);
    this.sunLight.position.copy(sunDir).multiplyScalar(700);

    // ----- arrival trajectory overlay (real areocentric geometry) -----
    const mars = this.bodies.mars;
    const showOverlay = mars.mesh?.visible === true && (dMars < 6e6 || inOrbit);
    this.arrivalGroup.visible = showOverlay;
    if (showOverlay && mars.mesh) {
      const k = mars.mesh.scale.x / R_MARS_KM; // scene units per km at Mars
      this.arrivalGroup.position.copy(mars.mesh.position);
      this.arrivalGroup.scale.setScalar(k);
      // rotate so the inbound asymptote opposes our true approach bearing
      const first = t.arrival.craft[0];
      const a0 = Math.atan2(first[1], first[0]);
      const approach = Math.atan2(cp[1] - mp[1], cp[0] - mp[0]);
      this.arrivalGroup.rotation.z = approach - a0;
    }
    this.velArrow.visible = dMars < 8e6 && !inOrbit;
    if (this.velArrow.visible) {
      this.velArrow.position.set(0, 0, 0);
      this.velArrow.setDirection(this.fwd);
      this.velArrow.setLength(16 + Math.min(speed, 40) * 0.5, 4.5, 2);
    }

    // ----- interceptor rendezvous (anchored to the real event schedule) -----
    this.updateInterceptor(t, tD, inOrbit, wall, dt);

    // ----- camera -----
    // near the ground the camera frames from the horizontal prograde side
    // (a vertical fwd would park the chase rig underground in the trench)
    const camF = !kinetic && altM < 2500 ? this.fwd : fVis;
    this.director.update(
      this.camera,
      {
        fwd: camF,
        burning,
        marsDir: mars.hidden ? null : mars.markerWorld().clone().normalize(),
        marsVisibleBig: mars.mesh?.visible === true,
        docking: this.interceptor.group.visible,
        craftQuat: this.craft.group.quaternion,
        nose: this.craft.noseLocal.clone().applyQuaternion(this.craft.group.quaternion),
        interceptorPos: this.interceptor.group.visible ? this.interceptor.group.position : null,
      },
      wall,
      dt,
      this.shakeAmp,
    );

    // ----- exposure adaptation + DOM lens flare -----
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const sunDot = camDir.dot(sunDir);
    this.post.adaptExposure(Math.max(sunDot, 0), dt);
    this.updateFlares(sunDot);

    // ----- DOM markers -----
    this.updateBodyMarker(this.markers.earth, this.bodies.earth, null);
    this.updateBodyMarker(this.markers.moon, this.bodies.moon, null);
    this.updateBodyMarker(this.markers.mars, this.bodies.mars, inOrbit ? 'IN ORBIT' : null);
    // the prograde marker stays on the TRUE velocity bearing, not the visual attitude
    this.projectMarker(this.progradeMarker, this.fwd.clone().multiplyScalar(SPHERE_DIST), 26, true);

    this.post.govern(dt * 1000, wall);
  }

  private updatePlume(on: boolean, spiral: boolean, wall: number): void {
    const color = spiral ? 0x57dcff : 0xffb04d;
    for (let i = 0; i < this.craft.plume.length; i++) {
      const p = this.craft.plume[i];
      p.visible = on;
      if (!on) continue;
      const mat = p.material as THREE.SpriteMaterial;
      mat.color.setHex(color);
      const flick = spiral
        ? 0.96 + 0.04 * Math.sin(wall * 31 + i)
        : 0.82 + 0.18 * Math.sin(wall * 53 + i * 2.1) * Math.random();
      p.scale.set((p.userData.baseX as number) * flick, p.userData.baseY as number, 1);
      mat.opacity = (0.85 - i * 0.22) * flick;
    }
    this.craft.plumeLight.color.setHex(color);
    this.craft.plumeLight.intensity = on ? (spiral ? 1.4 : 6.5) * (0.8 + 0.2 * Math.sin(wall * 60)) : 0;
  }

  private updateInterceptor(t: Trajectory, tD: number, inOrbit: boolean, wall: number, dt: number): void {
    const rig = this.interceptor;
    const moiT = t.tofDays;
    const rdv = t.events.find((e) => /rendezvous/i.test(e.name));
    const rdvStart = rdv?.tDays ?? moiT + 2;
    const rdvEnd = rdvStart + Math.max((rdv?.durationS ?? 0) / 86400, 0.25);
    const active = inOrbit && tD > moiT + 0.15;
    rig.group.visible = active;
    if (!active) return;

    let dist: number;
    let lateral = 0;
    if (tD >= rdvEnd) {
      dist = 9.6; // grapples over the capture ring
      if (!this.dockCued) {
        this.dockCued = true;
        cue('dock-contact');
        cue('capture-complete');
      }
    } else if (tD >= rdvStart) {
      const u = (tD - rdvStart) / (rdvEnd - rdvStart);
      dist = 30 - 20 * u; // final approach during the real trim burn
      lateral = Math.sin(u * Math.PI) * 1.2;
    } else {
      const u = Math.min(Math.max((tD - (moiT + 0.15)) / (rdvStart - (moiT + 0.15)), 0), 1);
      dist = 2600 * Math.pow(1 - u, 2.2) + 30;
      lateral = (1 - u) * 60;
    }
    const q = this.craft.group.quaternion;
    const offset = new THREE.Vector3(lateral * 0.4, this.craft.noseLocal.y + dist, lateral).applyQuaternion(q);
    rig.group.position.copy(offset);
    rig.group.quaternion.copy(q);
    if (tD < rdvEnd) rig.group.rotateY(Math.sin(wall * 0.21) * 0.18);
    rig.strobes.forEach((s, i) => {
      s.visible = (wall * 1.3 + i * 0.4) % 1 < 0.09;
    });
    const puffing = tD >= rdvStart && tD < rdvEnd;
    rig.rcsPuffs.forEach((p, i) => {
      p.visible = puffing && (wall * 2.1 + i * 0.7) % 1 < 0.22;
      (p.material as THREE.SpriteMaterial).opacity = 0.5 + 0.4 * Math.sin(wall * 40 + i);
    });
    void dt;
  }

  private updateFlares(sunDot: number): void {
    const w = this.container.clientWidth;
    const hgt = this.container.clientHeight;
    const v = this.bodies.sun.world.clone().project(this.camera);
    const on = sunDot > 0.25 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    this.flareEl.style.opacity = on ? String(Math.min((sunDot - 0.25) * 1.6, 1) * 0.85) : '0';
    if (!on) return;
    const sx = ((v.x + 1) / 2) * w;
    const sy = ((1 - v.y) / 2) * hgt;
    const cx = w / 2;
    const cy = hgt / 2;
    const ks = [1, 0.55, 0.25, -0.18, -0.45];
    for (let i = 0; i < 5; i++) {
      const k = ks[i];
      const x = cx + (sx - cx) * k;
      const y = cy + (sy - cy) * k;
      const d = this.flares[i];
      const size = i === 0 ? 90 : 18 + i * 14;
      d.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
      d.style.width = d.style.height = `${size}px`;
    }
    const st = this.flares[5];
    st.style.transform = `translate(${(sx - 260).toFixed(1)}px, ${(sy - 2).toFixed(1)}px)`;
  }

  private updateBodyMarker(m: Marker, b: CelestialBody, override: string | null): void {
    if (b.hidden) {
      m.root.style.display = 'none';
      return;
    }
    if (this.frame % 8 === 0) {
      m.dist.textContent = override ?? fmtDistKm(b.distKm);
    }
    const px = Math.max(
      (b.angR / ((this.camera.fov * Math.PI) / 180)) * this.container.clientHeight * 2,
      30,
    );
    this.projectMarker(m, b.markerWorld(), px);
  }

  private projectMarker(m: Marker, world: THREE.Vector3, sizePx: number, hideBehind = false): void {
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const behind = camDir.dot(world.clone().sub(this.camera.position)) < 0;
    if (behind && hideBehind) {
      m.root.style.display = 'none';
      return;
    }
    m.root.style.display = '';
    const v = world.clone().project(this.camera);
    let nx = v.x;
    let ny = v.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const mX = 0.92;
    const mY = 0.85;
    const off = behind || Math.abs(nx) > mX || Math.abs(ny) > mY;
    if (off) {
      const s = Math.max(Math.abs(nx) / mX, Math.abs(ny) / mY, 1e-6);
      nx /= s;
      ny /= s;
    }
    const w = this.container.clientWidth;
    const hgt = this.container.clientHeight;
    const px = ((nx + 1) / 2) * w;
    const py = ((1 - ny) / 2) * hgt;
    m.root.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    const sz = off ? 20 : Math.min(sizePx, hgt * 0.85);
    m.box.style.width = m.box.style.height = `${sz.toFixed(0)}px`;
    if (off) {
      const ang = (Math.atan2(py - hgt / 2, px - w / 2) * 180) / Math.PI + 90;
      m.arrow.style.display = '';
      m.arrow.style.transform = `translate(-50%, -50%) rotate(${ang.toFixed(0)}deg) translateY(-${sz / 2 + 12}px)`;
    } else {
      m.arrow.style.display = 'none';
    }
  }

  resize(): void {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onDown);
    dom.removeEventListener('pointerup', this.onUp);
    dom.removeEventListener('pointermove', this.onMove);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('dblclick', this.onDbl);
    this.resetLaunch();
    disposeObject(this.scene);
    this.pmremRT?.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.container.removeChild(dom);
    this.markersEl.remove();
    this.flareEl.remove();
  }
}

export type { CamMode } from './ride/cameras';
