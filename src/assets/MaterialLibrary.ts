import * as THREE from 'three';
import type { RoomFamily } from '../game/defaultHouse';

export const ART_COLORS = Object.freeze({
  bodyPrimary: 0x586477,
  bodySecondary: 0x171a21,
  trim: 0xb6c2d6,
  hazard: 0xd96f5f,
  reward: 0xe6c965,
  shieldBoost: 0x83d5ad,
  emissiveSignal: 0xffd36b,
  groundContact: 0x090a0d,
  decalDark: 0x111319,
  decalLight: 0x777f90,
  livingFloor: 0x1c1610,
  sleepFloor: 0x14161c,
  oldFloor: 0x121410,
  doorFrame: 0x6d5a42,
  threshold: 0x8a7348,
  windowGlow: 0x7d8aa8,
});

export interface HouseMaterialKit {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  roomFloorA: THREE.MeshStandardMaterial;
  roomFloorB: THREE.MeshStandardMaterial;
  roomFloors: Record<RoomFamily, THREE.MeshStandardMaterial>;
  trim: THREE.LineBasicMaterial;
  doorFrame: THREE.MeshStandardMaterial;
  threshold: THREE.MeshBasicMaterial;
  windowGlow: THREE.MeshBasicMaterial;
  dressing: Record<RoomFamily, THREE.MeshStandardMaterial>;
  ghostBody: THREE.MeshStandardMaterial;
  ghostTrim: THREE.MeshStandardMaterial;
  reward: THREE.MeshStandardMaterial;
  contact: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createHouseMaterialKit(): HouseMaterialKit {
  const wallPattern = createWallPatternTexture();
  const floorPattern = createFloorPatternTexture();
  const wall = new THREE.MeshStandardMaterial({
    color: ART_COLORS.bodyPrimary,
    map: wallPattern,
    emissive: 0x30394d,
    emissiveIntensity: 1.05,
    roughness: 0.82,
    metalness: 0.03,
  });
  const floor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.groundContact,
    roughness: 0.98,
  });
  const roomFloorA = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: 0x101319,
    roughness: 0.95,
  });
  const roomFloorB = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: 0x13151b,
    roughness: 0.92,
  });
  const livingFloor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.livingFloor,
    roughness: 0.9,
  });
  const sleepFloor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.sleepFloor,
    roughness: 0.94,
  });
  const oldFloor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.oldFloor,
    roughness: 0.96,
  });
  const doorFrame = new THREE.MeshStandardMaterial({
    color: ART_COLORS.doorFrame,
    roughness: 0.84,
    metalness: 0.04,
    emissive: 0x1a140c,
    emissiveIntensity: 0.35,
  });
  const threshold = new THREE.MeshBasicMaterial({
    color: ART_COLORS.threshold,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  const windowGlow = new THREE.MeshBasicMaterial({
    color: ART_COLORS.windowGlow,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const livingDressing = new THREE.MeshStandardMaterial({
    color: 0x4a3a28,
    roughness: 0.78,
    emissive: 0x1c140c,
    emissiveIntensity: 0.28,
  });
  const sleepDressing = new THREE.MeshStandardMaterial({
    color: 0x3a3440,
    roughness: 0.82,
    emissive: 0x121018,
    emissiveIntensity: 0.22,
  });
  const oldDressing = new THREE.MeshStandardMaterial({
    color: 0x2c3228,
    roughness: 0.88,
    emissive: 0x0c100c,
    emissiveIntensity: 0.18,
  });
  const trim = new THREE.LineBasicMaterial({ color: ART_COLORS.trim, transparent: true, opacity: 0.68 });
  const ghostBody = new THREE.MeshStandardMaterial({
    color: 0x9ba5bd,
    emissive: 0x30384d,
    emissiveIntensity: 0.82,
    roughness: 0.46,
    metalness: 0.05,
  });
  const ghostTrim = new THREE.MeshStandardMaterial({
    color: 0xcbd3e3,
    emissive: 0x596783,
    emissiveIntensity: 0.72,
    roughness: 0.28,
  });
  const reward = new THREE.MeshStandardMaterial({
    color: ART_COLORS.reward,
    emissive: 0x81661c,
    emissiveIntensity: 1.55,
    roughness: 0.28,
    metalness: 0.14,
  });
  const contact = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const owned: THREE.Material[] = [
    wall,
    floor,
    roomFloorA,
    roomFloorB,
    livingFloor,
    sleepFloor,
    oldFloor,
    doorFrame,
    threshold,
    windowGlow,
    livingDressing,
    sleepDressing,
    oldDressing,
    trim,
    ghostBody,
    ghostTrim,
    reward,
    contact,
  ];
  const textures: THREE.Texture[] = [wallPattern, floorPattern];
  wallPattern.wrapS = THREE.RepeatWrapping;
  wallPattern.wrapT = THREE.RepeatWrapping;
  wallPattern.repeat.set(8, 4);
  floorPattern.wrapS = THREE.RepeatWrapping;
  floorPattern.wrapT = THREE.RepeatWrapping;
  floorPattern.repeat.set(14, 16);
  floorPattern.colorSpace = THREE.SRGBColorSpace;
  wallPattern.colorSpace = THREE.SRGBColorSpace;
  return {
    wall,
    floor,
    roomFloorA,
    roomFloorB,
    roomFloors: { living: livingFloor, sleep: sleepFloor, old: oldFloor },
    trim,
    doorFrame,
    threshold,
    windowGlow,
    dressing: { living: livingDressing, sleep: sleepDressing, old: oldDressing },
    ghostBody,
    ghostTrim,
    reward,
    contact,
    dispose: () => {
      owned.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}

function createWallPatternTexture(): THREE.DataTexture {
  const width = 256;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const offset = (Math.floor(y / 32) % 2) * 7;
      const localX = (x + offset) % 32;
      const localY = y % 20;
      const mortar = localX < 3 || localX > 27 || localY < 3 || localY > 16;
      const noise = (pseudoNoise(x * 12.7, y * 8.3) - 0.5) * 6;
      const isCrack = ((x * 11 + y * 7) % 127) < 2;
      let r: number;
      let g: number;
      let b: number;
      if (mortar) {
        r = 64;
        g = 72;
        b = 84;
      } else {
        r = 95 + noise;
        g = 102 + noise;
        b = 116 + noise;
      }
      if (isCrack) {
        r = Math.max(0, r - 22);
        g = Math.max(0, g - 15);
        b = Math.max(0, b - 15);
      }
      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
      data[i + 3] = 255;
    }
  }
  return createDataTexture(width, height, data);
}

function createFloorPatternTexture(): THREE.DataTexture {
  const width = 256;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const noise = (pseudoNoise(x * 5.21, y * 7.13) - 0.5) * 14;
      const seam = (x % 48 < 2 || y % 42 < 2) ? 1 : 0;
      const base = 31 + seam * 18;
      data[i] = clampByte(base + noise);
      data[i + 1] = clampByte(base + noise * 0.7);
      data[i + 2] = clampByte(base + noise * 0.5);
      data[i + 3] = 255;
    }
  }
  return createDataTexture(width, height, data);
}

function createDataTexture(width: number, height: number, data: Uint8ClampedArray): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function pseudoNoise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
