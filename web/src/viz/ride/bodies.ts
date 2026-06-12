// Celestial bodies for Ride mode. Each body lives on a celestial sphere along
// its TRUE bearing from the craft; apparent size is asin(R/d) from the live
// sim distance — never scripted. Two LOD levels:
//   far  — bloom-friendly sprite point with glow
//   near — real textured sphere lit by the true sun direction, which yields a
//          physically correct terminator, phases and crescents, plus a
//          fresnel atmosphere shell for Mars/Earth.

import * as THREE from 'three';
import { discTexture, glowTexture } from './textures';

export const SPHERE_DIST = 4200; // bearing-sphere radius, scene units
const MESH_DIST = 3400; // lit spheres sit slightly inside the sprite shell
const LOD_ANG = 0.0042; // rad — switch sprite→mesh near ~0.5° apparent size
const MAX_ANG = 0.9; // rad clamp so an in-orbit body fills the frame, not the scene
const MIN_SPRITE = 7;

export interface BodySpec {
  rKm: number;
  /** disc gradient for far sprite */
  disc: [string, string, string];
  glowColor: string;
  glowScale: number;
  /** equirect texture for the near sphere (null = sprite only, e.g. Sun) */
  map: THREE.Texture | null;
  /** sidereal rotation period in hours (visual spin; 0 = none) */
  rotHours: number;
  atmosphere?: { color: number; scale: number; power: number; intensity: number };
}

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ATMO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vView)), uPower);
    gl_FragColor = vec4(uColor, rim * uIntensity);
  }
`;

export class CelestialBody {
  sprite: THREE.Sprite;
  glow: THREE.Sprite;
  mesh: THREE.Mesh | null = null;
  atmo: THREE.Mesh | null = null;
  world = new THREE.Vector3(); // marker anchor (on the bearing sphere)
  angR = 0;
  distKm = Infinity;
  hidden = false;

  constructor(scene: THREE.Scene, private spec: BodySpec) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: discTexture(...spec.disc),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.sprite.renderOrder = 2;
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(spec.glowColor),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.renderOrder = 1;
    scene.add(this.glow, this.sprite);

    if (spec.map) {
      this.mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 56, 40),
        new THREE.MeshStandardMaterial({ map: spec.map, roughness: 0.94, metalness: 0 }),
      );
      this.mesh.rotation.x = Math.PI / 2; // poles toward ecliptic north
      this.mesh.visible = false;
      scene.add(this.mesh);
      if (spec.atmosphere) {
        const a = spec.atmosphere;
        this.atmo = new THREE.Mesh(
          new THREE.SphereGeometry(a.scale, 48, 32),
          new THREE.ShaderMaterial({
            vertexShader: ATMO_VERT,
            fragmentShader: ATMO_FRAG,
            uniforms: {
              uColor: { value: new THREE.Color(a.color) },
              uPower: { value: a.power },
              uIntensity: { value: a.intensity },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
          }),
        );
        this.atmo.visible = false;
        scene.add(this.atmo);
      }
    }
  }

  hide(): void {
    this.hidden = true;
    this.sprite.visible = this.glow.visible = false;
    if (this.mesh) this.mesh.visible = false;
    if (this.atmo) this.atmo.visible = false;
  }

  /**
   * Place along unit bearing `dir` at true distance `distKm`; `tDays` drives
   * the real rotation rate of the surface texture.
   */
  place(dir: THREE.Vector3, distKm: number, tDays: number): void {
    this.hidden = false;
    this.distKm = distKm;
    this.angR = Math.asin(Math.min(this.spec.rKm / Math.max(distKm, this.spec.rKm), 1));
    this.world.copy(dir).multiplyScalar(SPHERE_DIST);

    const useMesh = this.mesh != null && this.angR > LOD_ANG;
    if (useMesh && this.mesh) {
      this.sprite.visible = false;
      this.mesh.visible = true;
      // radius = D·sin(θ) subtends exactly the true apparent angle θ
      const radius = MESH_DIST * Math.sin(Math.min(this.angR, MAX_ANG));
      this.mesh.position.copy(dir).multiplyScalar(MESH_DIST);
      this.mesh.scale.setScalar(Math.max(radius, 1e-3));
      if (this.spec.rotHours > 0) {
        this.mesh.rotation.y = ((tDays * 24) / this.spec.rotHours) * Math.PI * 2;
      }
      if (this.atmo) {
        this.atmo.visible = true;
        this.atmo.position.copy(this.mesh.position);
        this.atmo.scale.setScalar(Math.max(radius, 1e-3));
      }
      // soften the halo as the disc resolves
      this.glow.visible = true;
      this.glow.position.copy(this.mesh.position);
      const gs = radius * 2 * this.spec.glowScale * 0.7;
      this.glow.scale.set(gs, gs, 1);
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.18;
    } else {
      if (this.mesh) this.mesh.visible = false;
      if (this.atmo) this.atmo.visible = false;
      this.sprite.visible = true;
      this.glow.visible = true;
      const size = Math.max(
        2 * SPHERE_DIST * Math.tan(Math.min(this.angR, 0.5)),
        this.spec.map ? MIN_SPRITE : 0,
      );
      this.sprite.position.copy(this.world);
      this.sprite.scale.set(size, size, 1);
      this.glow.position.copy(this.world);
      this.glow.scale.set(size * this.spec.glowScale, size * this.spec.glowScale, 1);
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.55;
    }
  }

  /** Screen-space helper: approximate sprite/mesh anchor for DOM markers. */
  markerWorld(): THREE.Vector3 {
    return this.mesh?.visible ? this.mesh.position : this.world;
  }
}
