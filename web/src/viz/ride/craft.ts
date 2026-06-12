// High-detail vehicles: the cargo stack (parametric on propulsion class and
// commanded cargo mass) and the Mars-orbit interceptor. Pure presentation —
// geometry detail only; nothing here affects simulation state.

import * as THREE from 'three';
import type { MissionResult } from '../../engine/types';
import { foilMaps, glowTexture, panelMaps, solarCellMap } from './textures';

export interface CraftRig {
  group: THREE.Group;
  plume: THREE.Sprite[];
  plumeLight: THREE.PointLight;
  strobes: THREE.Sprite[];
  /** capture ring world anchor (local +Y nose) for dock cam / interceptor */
  noseLocal: THREE.Vector3;
}

function addSprite(tex: THREE.Texture, scale: number, color?: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  s.scale.set(scale, scale, 1);
  if (color != null) (s.material as THREE.SpriteMaterial).color = new THREE.Color(color);
  return s;
}

/** Octagonal truss segment built from instanced struts. */
function truss(len: number, radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const strut = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);
  const longerons = 8;
  const bays = Math.max(2, Math.round(len / 3));
  const count = longerons + bays * longerons; // longerons + diagonals
  const inst = new THREE.InstancedMesh(strut, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let idx = 0;
  // longerons
  for (let i = 0; i < longerons; i++) {
    const a = (i / longerons) * Math.PI * 2;
    m.compose(
      new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius),
      q.identity(),
      new THREE.Vector3(1, len, 1),
    );
    inst.setMatrixAt(idx++, m);
  }
  // diagonals per bay
  const bayH = len / bays;
  for (let b = 0; b < bays; b++) {
    for (let i = 0; i < longerons; i++) {
      const a0 = (i / longerons) * Math.PI * 2;
      const a1 = ((i + 1) / longerons) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a0) * radius, -len / 2 + b * bayH, Math.sin(a0) * radius);
      const p1 = new THREE.Vector3(Math.cos(a1) * radius, -len / 2 + (b + 1) * bayH, Math.sin(a1) * radius);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const dir = p1.clone().sub(p0);
      q.setFromUnitVectors(up, dir.clone().normalize());
      m.compose(mid, q, new THREE.Vector3(1, dir.length(), 1));
      inst.setMatrixAt(idx++, m);
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  return g;
}

function dish(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const d = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 10, 0, Math.PI * 2, 0, 0.9), mat);
  d.rotation.x = -Math.PI / 2;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), mat);
  boom.position.y = -1.2;
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.0, 6), mat);
  feed.position.y = 0.7;
  g.add(d, boom, feed);
  return g;
}

function rcsQuad(dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), dark);
  g.add(block);
  for (const [rx, rz] of [
    [0, 0],
    [Math.PI / 2, 0],
    [-Math.PI / 2, 0],
    [0, Math.PI / 2],
  ] as const) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.4, 8, 1, true), dark);
    n.rotation.set(rx, 0, rz);
    n.translateY(0.5);
    g.add(n);
  }
  return g;
}

export function buildCraft(mr: MissionResult | null, lowThrust: boolean): CraftRig {
  const g = new THREE.Group();
  const panels = panelMaps(3);
  const foil = foilMaps(5);
  const hullMat = new THREE.MeshStandardMaterial({
    map: panels.map,
    roughnessMap: panels.roughnessMap,
    roughness: 0.62,
    metalness: 0.55,
  });
  const foilMat = new THREE.MeshStandardMaterial({
    map: foil.map,
    bumpMap: foil.bumpMap,
    bumpScale: 0.6,
    roughness: 0.32,
    metalness: 0.85,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.42, metalness: 0.78 });
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x7c8896, roughness: 0.55, metalness: 0.6 });

  // central truss spine (+Y forward), 30 long
  g.add(truss(30, 1.35, trussMat));

  // forward section: capture/docking ring + sensors
  const nose = new THREE.Group();
  nose.position.y = 15.6;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.28, 12, 32), darkMat);
  ring.rotation.x = Math.PI / 2;
  const ringGlow = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.07, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0x10343f,
      emissive: 0x2ee6a8,
      emissiveIntensity: 1.6,
      roughness: 0.5,
    }),
  );
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.y = 0.18;
  const avionics = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 2.4, 12), foilMat);
  avionics.position.y = -1.6;
  const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), darkMat);
  sensor.position.set(1.3, -0.6, 0.8);
  const antenna = dish(darkMat);
  antenna.scale.setScalar(0.8);
  antenna.position.set(-1.7, -1.8, 0.6);
  antenna.rotation.z = 0.7;
  nose.add(ring, ringGlow, avionics, sensor, antenna);
  g.add(nose);

  // cargo containers clustered around the spine, count tracks commanded mass
  const cargoKg = mr?.cargoKg ?? 45359;
  const n = Math.min(10, Math.max(4, 3 + Math.round(cargoKg / 15000)));
  const boxGeo = new THREE.BoxGeometry(4.0, 4.5, 4.0, 2, 2, 2);
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.4 });
  for (let i = 0; i < n; i++) {
    const box = new THREE.Mesh(boxGeo, hullMat);
    const ang = (i % 4) * (Math.PI / 2) + Math.floor(i / 4) * (Math.PI / 4);
    box.position.set(Math.cos(ang) * 3.4, 10 - Math.floor(i / 2) * 5.4, Math.sin(ang) * 3.4);
    box.rotation.y = ang;
    box.add(new THREE.LineSegments(edgeGeo, edgeMat));
    // attachment clamps to the spine
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.7), darkMat);
    clamp.position.set(-Math.cos(ang) * 2.6, 0, -Math.sin(ang) * 2.6);
    clamp.rotation.y = ang;
    box.add(clamp);
    g.add(box);
  }

  // MLI-wrapped tankage between cargo and engine
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(2.5, 5.5, 8, 18), foilMat);
  tank.position.y = -8.5;
  g.add(tank);

  // radiators (emissive when hot — scene flickers intensity during burns)
  const radMat = new THREE.MeshStandardMaterial({
    color: 0x191210,
    emissive: 0x6b1a07,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  for (const sx of [-1, 1]) {
    const rad = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.4, 4, 1), radMat);
    rad.position.set(sx * 7.2, -6, 0);
    rad.rotation.y = Math.PI / 2;
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), trussMat);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(sx * 2.6, -6, 0);
    g.add(rad, boom);
  }

  // RCS quads at four corners of the cargo bay
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const q = rcsQuad(darkMat);
    q.position.set(sx * 5.6, 12.6, sz * 5.6 * 0.001 + sz * 0.9);
    g.add(q);
  }

  // propulsion section
  const plume: THREE.Sprite[] = [];
  const glowTex = glowTexture('rgba(255,196,120,1)');
  const isKinetic = mr?.launcher != null && !lowThrust;
  if (lowThrust) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const thr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.8, 12), darkMat);
      thr.position.set(Math.cos(a) * 1.9, -14.2, Math.sin(a) * 1.9);
      const grid = new THREE.Mesh(
        new THREE.CircleGeometry(0.52, 12),
        new THREE.MeshStandardMaterial({ color: 0x06222e, emissive: 0x19c8ff, emissiveIntensity: 0.4 }),
      );
      grid.rotation.x = Math.PI / 2;
      grid.position.set(Math.cos(a) * 1.9, -15.15, Math.sin(a) * 1.9);
      g.add(thr, grid);
    }
  } else {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 2.0, 16), hullMat);
    skirt.position.y = -13.0;
    g.add(skirt);
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, isKinetic ? 1.2 : 2.4, isKinetic ? 2.0 : 4.2, 18, 3, true),
      new THREE.MeshStandardMaterial({
        color: 0x2c3038,
        roughness: 0.3,
        metalness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    nozzle.position.y = isKinetic ? -14.8 : -16.0;
    g.add(nozzle);
  }
  const plumeLen = lowThrust ? 11 : isKinetic ? 9 : 30;
  const plumeW = lowThrust ? 3.6 : isKinetic ? 3.4 : 10;
  for (let i = 0; i < 3; i++) {
    const p = addSprite(glowTex, 1);
    p.position.set(0, -16.5 - (i + 0.5) * (plumeLen / 3.2), 0);
    const baseX = plumeW * (1 - i * 0.18);
    const baseY = plumeLen / 1.7;
    p.scale.set(baseX, baseY, 1);
    p.userData.baseX = baseX;
    p.userData.baseY = baseY;
    p.visible = false;
    plume.push(p);
    g.add(p);
  }
  const plumeLight = new THREE.PointLight(0xffaa44, 0, 170);
  plumeLight.position.set(0, -19, 0);
  g.add(plumeLight);

  // nav strobes
  const strobes: THREE.Sprite[] = [];
  const sg = glowTexture('rgba(255,255,255,1)');
  const sR = addSprite(sg, 1.5, 0xff5050);
  sR.position.set(0, 15.8, 0);
  const sW = addSprite(sg, 1.2, 0xffffff);
  sW.position.set(0, -15.2, 0);
  const sG = addSprite(sg, 1.0, 0x44ff88);
  sG.position.set(7.2, -6, 0);
  strobes.push(sR, sW, sG);
  g.add(sR, sW, sG);

  return { group: g, plume, plumeLight, strobes, noseLocal: new THREE.Vector3(0, 17.5, 0) };
}

// ---------- interceptor ----------

export interface InterceptorRig {
  group: THREE.Group;
  strobes: THREE.Sprite[];
  rcsPuffs: THREE.Sprite[];
}

export function buildInterceptor(): InterceptorRig {
  const g = new THREE.Group();
  const panels = panelMaps(21, '#94a0ad');
  const hull = new THREE.MeshStandardMaterial({
    map: panels.map,
    roughnessMap: panels.roughnessMap,
    roughness: 0.5,
    metalness: 0.6,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.4, metalness: 0.8 });
  const cells = new THREE.MeshStandardMaterial({
    map: solarCellMap(),
    roughness: 0.35,
    metalness: 0.4,
    side: THREE.DoubleSide,
  });

  // service module, -Y points at the cargo (its "nose" faces the target)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 5.4, 14), hull);
  g.add(body);
  const props = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.5, 1.6, 14), dark);
  props.position.y = 3.4;
  g.add(props);

  // solar wings
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.4, 3, 1), cells);
    wing.position.set(sx * 5.7, 0.6, 0);
    wing.rotation.y = Math.PI / 2;
    const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), dark);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(sx * 1.95, 0.6, 0);
    g.add(wing, yoke);
  }

  // grapple arms reaching toward -Y (the cargo capture ring)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const arm = new THREE.Group();
    const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), dark);
    seg1.position.y = -1.2;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), dark);
    joint.position.y = -2.4;
    const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 8), dark);
    seg2.position.y = -3.2;
    seg2.rotation.x = 0.55;
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), dark);
    claw.position.set(0, -4.0, 0.55);
    claw.rotation.x = 0.9;
    arm.add(seg1, joint, seg2, claw);
    arm.position.set(Math.cos(a) * 1.2, -2.6, Math.sin(a) * 1.2);
    arm.rotation.y = -a;
    arm.rotation.z = Math.cos(a) * 0.12;
    g.add(arm);
  }

  // docking light cluster + dish
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 0.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x202326, emissive: 0xfff2cc, emissiveIntensity: 2.4 }),
  );
  lamp.position.set(0.9, -2.8, -0.7);
  const ant = dish(dark);
  ant.scale.setScalar(0.7);
  ant.position.set(-1.3, 2.2, 0.9);
  ant.rotation.x = -0.5;
  g.add(lamp, ant);

  // RCS quads + puff sprites for approach choreography
  const rcsPuffs: THREE.Sprite[] = [];
  const puffTex = glowTexture('rgba(220,235,255,1)');
  for (const [sx, sy] of [
    [1, 2.2],
    [-1, 2.2],
    [1, -2.2],
    [-1, -2.2],
  ] as const) {
    const q = rcsQuad(dark);
    q.scale.setScalar(0.7);
    q.position.set(sx * 1.75, sy, 0);
    g.add(q);
    const puff = addSprite(puffTex, 0.9);
    puff.position.set(sx * 2.3, sy, 0);
    puff.visible = false;
    rcsPuffs.push(puff);
    g.add(puff);
  }

  const strobes: THREE.Sprite[] = [];
  const sg = glowTexture('rgba(255,255,255,1)');
  const s1 = addSprite(sg, 1.1, 0xff5050);
  s1.position.set(0, 4.4, 0);
  const s2 = addSprite(sg, 0.9, 0x55aaff);
  s2.position.set(-5.7 - 3.75, 0.6, 0);
  const s3 = addSprite(sg, 0.9, 0x55aaff);
  s3.position.set(5.7 + 3.75, 0.6, 0);
  strobes.push(s1, s2, s3);
  g.add(s1, s2, s3);

  g.visible = false;
  return { group: g, strobes, rcsPuffs };
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as
      | (THREE.Material & { map?: THREE.Texture | null; bumpMap?: THREE.Texture | null; roughnessMap?: THREE.Texture | null })
      | undefined;
    if (mat) {
      mat.map?.dispose();
      mat.bumpMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.dispose();
    }
  });
}
