import * as THREE from 'three';
import {
  barkTexture,
  clothTexture,
  glowSprite,
  groundTexture,
  lacquerTexture,
  pathTexture,
  skinTexture,
  sparkleSprite,
  stoneTexture,
} from './ProceduralTextures';

export const TIER_COLORS = ['#f2c7a6', '#ff7aa2', '#ffc94a', '#bff4ff'] as const;

/** Shared material roles. Created once, reused by every factory. */
export class MaterialLibrary {
  readonly groundTex = groundTexture();
  readonly pathTex = pathTexture();
  readonly barkTex = barkTexture();
  readonly stoneTex = stoneTexture();
  readonly lacquerTex = lacquerTexture();
  readonly skinTex = skinTexture();
  readonly clothTex = clothTexture();
  readonly glow = glowSprite();
  readonly sparkle = sparkleSprite();

  readonly ground = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95, metalness: 0 });
  readonly path = new THREE.MeshStandardMaterial({ map: this.pathTex, roughness: 0.92, metalness: 0 });
  readonly bark = new THREE.MeshStandardMaterial({ map: this.barkTex, color: '#a08070', roughness: 0.95 });
  readonly leaves = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  readonly grass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  readonly stone = new THREE.MeshStandardMaterial({ map: this.stoneTex, color: '#8d8c84', roughness: 0.9 });
  readonly rock = new THREE.MeshStandardMaterial({ map: this.stoneTex, color: '#6c6b64', roughness: 0.95, flatShading: true });
  readonly lacquer = new THREE.MeshStandardMaterial({ map: this.lacquerTex, roughness: 0.45, metalness: 0.05 });
  readonly darkWood = new THREE.MeshStandardMaterial({ color: '#2a1d16', roughness: 0.8 });
  readonly roofTile = new THREE.MeshStandardMaterial({ color: '#23302e', roughness: 0.6, metalness: 0.1 });
  readonly gold = new THREE.MeshStandardMaterial({ color: '#b08a3e', roughness: 0.35, metalness: 0.8 });
  readonly lanternLit = new THREE.MeshStandardMaterial({
    color: '#ff5a2a',
    emissive: '#ff4a1a',
    emissiveIntensity: 2.6,
    roughness: 0.6,
  });
  readonly lanternDark = new THREE.MeshStandardMaterial({ color: '#4a1410', roughness: 0.7 });
  /** Real extraction shrine lanterns: cool extract blue. */
  readonly lanternExtract = new THREE.MeshStandardMaterial({
    color: '#7fc8ff',
    emissive: '#4aa8ff',
    emissiveIntensity: 2.8,
    roughness: 0.6,
  });
  /** Bait shrine lanterns: gold / dark-red lure (Howler sigil energy). */
  readonly lanternBait = new THREE.MeshStandardMaterial({
    color: '#e0a03a',
    emissive: '#c8641a',
    emissiveIntensity: 2.4,
    roughness: 0.6,
  });
  readonly stoneLanternGlow = new THREE.MeshStandardMaterial({
    color: '#ffb35a',
    emissive: '#ff9a3a',
    emissiveIntensity: 2.2,
  });

  // Peach flesh per tier (vertex colours supply the blush).
  readonly peach: THREE.MeshStandardMaterial[] = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: '#3a1c12', emissiveIntensity: 0.25 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#ff4f7f', emissiveIntensity: 0.35 }),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.35,
      emissive: '#ffb020',
      emissiveIntensity: 1.1,
    }),
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.2,
      emissive: '#9ff0ff',
      emissiveIntensity: 1.6,
      iridescence: 1,
      iridescenceIOR: 1.6,
      clearcoat: 1,
    }),
  ];
  readonly peachLeaf = new THREE.MeshStandardMaterial({ color: '#3f6b2a', roughness: 0.7, side: THREE.DoubleSide });

  // Monsters
  readonly grabberSkin = new THREE.MeshStandardMaterial({ map: this.skinTex, roughness: 0.75, color: '#d8d2c4' });
  readonly grabberDark = new THREE.MeshStandardMaterial({ color: '#1a1414', roughness: 0.9 });
  readonly grabberEye = new THREE.MeshBasicMaterial({ color: '#ff2a1a', fog: false });
  readonly claw = new THREE.MeshStandardMaterial({ color: '#2b2520', roughness: 0.4, metalness: 0.2 });
  readonly robe = new THREE.MeshStandardMaterial({ map: this.clothTex, roughness: 1, side: THREE.DoubleSide });
  readonly mask = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.5, emissive: '#bdb7aa', emissiveIntensity: 0.06 });
  readonly maskHole = new THREE.MeshBasicMaterial({ color: '#000000' });
  readonly howlerHide = new THREE.MeshStandardMaterial({ color: '#16120f', roughness: 0.95 });
  readonly howlerBone = new THREE.MeshStandardMaterial({ color: '#6d665a', roughness: 0.8 });
  readonly howlerEye = new THREE.MeshBasicMaterial({ color: '#ffd23a', fog: false });

  dispose(): void {
    for (const value of Object.values(this)) {
      if (value instanceof THREE.Material || value instanceof THREE.Texture) value.dispose();
      if (Array.isArray(value)) for (const m of value) if (m instanceof THREE.Material) m.dispose();
    }
  }
}
