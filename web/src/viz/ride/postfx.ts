// HDR post pipeline: ACES filmic tone mapping, selective-feeling bloom, fine
// film grain, plus an adaptive quality ladder that degrades cosmetics (never
// simulation) if sustained frame times exceed budget.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class RidePost {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private film: FilmPass;
  private exposureTarget = 1.05;
  private frameAvg = 16;
  private quality = 2; // 2 full, 1 reduced, 0 minimal
  private demoteAt = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private onQuality?: (q: number) => void,
  ) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.85, 0.82);
    this.composer.addPass(this.bloom);
    this.film = new FilmPass(0.14, false);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.max(w >> 1, 1), Math.max(h >> 1, 1));
  }

  /** Exposure adaptation: pull down when looking near the sun. */
  adaptExposure(sunDot: number, dt: number): void {
    const s = THREE.MathUtils.smoothstep(sunDot, 0.55, 0.97);
    this.exposureTarget = THREE.MathUtils.lerp(1.12, 0.68, s);
    this.renderer.toneMappingExposure +=
      (this.exposureTarget - this.renderer.toneMappingExposure) * Math.min(dt * 2.2, 1);
  }

  /**
   * Frame-time governor. Cosmetic-only degradation ladder:
   *   q2 → q1: film grain off, bloom 0.38
   *   q1 → q0: bloom 0.22
   * Never touches geometry the markers/physics depend on; the scene applies
   * additional q-based reductions via onQuality (e.g. hide a star layer).
   */
  govern(frameMs: number, wall: number): void {
    this.frameAvg = this.frameAvg * 0.95 + frameMs * 0.05;
    if (this.frameAvg > 26 && this.quality > 0 && wall > this.demoteAt) {
      this.quality--;
      this.demoteAt = wall + 4; // settle before judging again
      this.film.enabled = this.quality === 2;
      this.bloom.strength = this.quality === 2 ? 0.55 : this.quality === 1 ? 0.38 : 0.22;
      this.onQuality?.(this.quality);
      console.info(`[ride] adaptive quality → ${this.quality} (avg ${this.frameAvg.toFixed(1)} ms)`);
    }
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
