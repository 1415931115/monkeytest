import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LOW_SPEC } from '../core/Quality';

/** Render → Bloom → Output(tone map) → Grain/Vignette/status grading.
 *  Low-spec skips the entire post stack (biggest FPS win for look/move stutter). */
export class RenderPipeline {
  readonly composer: EffectComposer | null;
  readonly bloom: UnrealBloomPass | null;
  readonly grade: ShaderPass;
  private width = 0;
  private height = 0;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly low = LOW_SPEC;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.45 },
        uRed: { value: 0 },
        uDark: { value: 0 },
        uDesat: { value: 0 },
        uHunt: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uVignette, uRed, uDark, uDesat, uHunt;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          float ca = uRed * 0.006;
          vec3 col;
          col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(lum), uDesat * 0.75);
          vec2 d = uv - 0.5;
          float r = length(d * vec2(1.25, 1.0));
          float vig = smoothstep(0.85, 0.25, r);
          col *= mix(1.0, vig, uVignette + uDark * 0.5);
          float edge = smoothstep(0.3, 0.85, r);
          col = mix(col, vec3(0.55, 0.02, 0.02), edge * (uRed * 0.85 + uHunt * 0.25));
          col *= 1.0 - uDark * 0.35 * edge;
          float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime * 13.7)) - 0.5;
          col += g * (0.035 + uDark * 0.05);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    if (this.low) {
      this.composer = null;
      this.bloom = null;
      return;
    }

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.4, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
  }

  resize(width: number, height: number, dpr: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (!this.composer) return;
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.bloom?.resolution.set(width * 0.35, height * 0.35);
  }

  render(time: number): void {
    this.grade.uniforms.uTime.value = time;
    if (this.composer) {
      this.composer.render();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.bloom?.dispose();
  }
}

/** Pooled additive particle bursts (pickup sparkles, petals, dust). */
export class BurstVfx {
  readonly points: THREE.Points;
  private readonly cap = 400;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly base: Float32Array;
  private cursor = 0;

  constructor(sprite: THREE.Texture) {
    this.pos = new Float32Array(this.cap * 3).fill(-999);
    this.col = new Float32Array(this.cap * 3);
    this.base = new Float32Array(this.cap * 3);
    this.vel = new Float32Array(this.cap * 3);
    this.life = new Float32Array(this.cap);
    this.maxLife = new Float32Array(this.cap).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({
      size: 0.16,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, color: THREE.Color, count: number, speed: number, rng: () => number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + rng() * 0.8);
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = Math.cos(a) * s * v;
      this.vel[i * 3 + 1] = Math.abs(u) * v + 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * s * v;
      this.base[i * 3] = color.r;
      this.base[i * 3 + 1] = color.g;
      this.base[i * 3 + 2] = color.b;
      this.maxLife[i] = 0.7 + rng() * 0.8;
      this.life[i] = this.maxLife[i];
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= dt * 1.4;
      const drag = Math.exp(-dt * 1.8);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 3] = this.base[i * 3] * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < this.cap; i++) this.pos[i * 3 + 1] = -999;
  }
}
