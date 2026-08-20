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
  groundContact: 0x171a21,
  decalDark: 0x111319,
  decalLight: 0x777f90,
  livingFloor: 0x6d4c32,
  sleepFloor: 0x46546f,
  oldFloor: 0x46533d,
  doorFrame: 0x6d5a42,
  threshold: 0x8a7348,
  windowGlow: 0x7d8aa8,
});

export const WALLPAPER_TILE_METERS = Object.freeze({ width: 1.2, height: 1.4 });

export interface WallpaperWallBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface HouseMaterialKit {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  roomFloorA: THREE.MeshStandardMaterial;
  roomFloorB: THREE.MeshStandardMaterial;
  roomFloors: Record<RoomFamily, THREE.MeshStandardMaterial>;
  floorTrim: THREE.LineBasicMaterial;
  trim: THREE.LineBasicMaterial;
  doorFrame: THREE.MeshStandardMaterial;
  threshold: THREE.MeshBasicMaterial;
  windowGlow: THREE.MeshBasicMaterial;
  furniture: Record<RoomFamily, THREE.MeshStandardMaterial>;
  ghostBody: THREE.MeshStandardMaterial;
  ghostTrim: THREE.MeshStandardMaterial;
  reward: THREE.MeshStandardMaterial;
  contact: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createHouseMaterialKit(): HouseMaterialKit {
  const wallPattern = createWallpaperTexture();
  const floorPattern = createFloorPatternTexture();
  const wall = new THREE.MeshStandardMaterial({
    color: ART_COLORS.bodyPrimary,
    map: wallPattern,
    emissive: 0x30394d,
    emissiveIntensity: 0.86,
    roughness: 0.92,
    metalness: 0,
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
    emissive: 0x21160d,
    emissiveIntensity: 0.16,
    roughness: 0.9,
  });
  const sleepFloor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.sleepFloor,
    emissive: 0x111727,
    emissiveIntensity: 0.15,
    roughness: 0.94,
  });
  const oldFloor = new THREE.MeshStandardMaterial({
    map: floorPattern,
    color: ART_COLORS.oldFloor,
    emissive: 0x11190e,
    emissiveIntensity: 0.14,
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
  const livingFurniture = new THREE.MeshStandardMaterial({
    color: 0xffdfc0,
    roughness: 0.78,
    emissive: 0x21140a,
    emissiveIntensity: 0.16,
  });
  const sleepFurniture = new THREE.MeshStandardMaterial({
    color: 0xd6dcff,
    roughness: 0.82,
    emissive: 0x111526,
    emissiveIntensity: 0.14,
  });
  const oldFurniture = new THREE.MeshStandardMaterial({
    color: 0xc7d0b0,
    roughness: 0.88,
    emissive: 0x10160b,
    emissiveIntensity: 0.12,
  });
  const trim = new THREE.LineBasicMaterial({ color: ART_COLORS.trim, transparent: true, opacity: 0.34 });
  const floorTrim = new THREE.LineBasicMaterial({
    color: 0xa89476,
    transparent: true,
    opacity: 0.28,
  });
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
    livingFurniture,
    sleepFurniture,
    oldFurniture,
    floorTrim,
    trim,
    ghostBody,
    ghostTrim,
    reward,
    contact,
  ];
  const textures: THREE.Texture[] = [wallPattern, floorPattern];
  wallPattern.wrapS = THREE.RepeatWrapping;
  wallPattern.wrapT = THREE.RepeatWrapping;
  wallPattern.repeat.set(1, 1);
  wallPattern.magFilter = THREE.LinearFilter;
  wallPattern.minFilter = THREE.LinearMipmapLinearFilter;
  wallPattern.generateMipmaps = true;
  wallPattern.anisotropy = 4;
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
    floorTrim,
    trim,
    doorFrame,
    threshold,
    windowGlow,
    furniture: { living: livingFurniture, sleep: sleepFurniture, old: oldFurniture },
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

export function createWallpaperWallGeometry(
  bounds: WallpaperWallBounds,
  height: number,
): THREE.BoxGeometry {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    const worldX = positions.getX(index) + centerX;
    const worldY = positions.getY(index) + height / 2;
    const worldZ = positions.getZ(index) + centerZ;
    const normalX = Math.abs(normals.getX(index));
    const normalZ = Math.abs(normals.getZ(index));
    if (normalX > 0.5) {
      uvs.setXY(index, worldZ / WALLPAPER_TILE_METERS.width, worldY / WALLPAPER_TILE_METERS.height);
    } else if (normalZ > 0.5) {
      uvs.setXY(index, worldX / WALLPAPER_TILE_METERS.width, worldY / WALLPAPER_TILE_METERS.height);
    } else {
      uvs.setXY(index, worldX / WALLPAPER_TILE_METERS.width, worldZ / WALLPAPER_TILE_METERS.width);
    }
  }
  uvs.needsUpdate = true;
  return geometry;
}

function createWallpaperTexture(): THREE.DataTexture {
  const width = 256;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const cellX = ((x + 32) % 64) - 32;
      const cellY = ((y + 32) % 64) - 32;
      const seamDistance = Math.min(x % 64, 64 - (x % 64));
      const stripe = Math.cos(x * Math.PI * 2 / 64) * 4;
      const grain = Math.sin((x * 17 + y * 23) * Math.PI * 2 / 256) * 2.2
        + Math.cos((x * 7 - y * 19) * Math.PI * 2 / 256) * 1.6;
      const vineCenter = 13 + Math.sin(y * Math.PI * 2 / 64) * 3.2;
      const vine = Math.abs(Math.abs(cellX) - vineCenter) < 1.35;
      const diamond = Math.abs(cellX) / 7 + Math.abs(cellY) / 11 < 1;
      const leaf = (
        ((Math.abs(cellX) - 8) / 4.5) ** 2
        + ((Math.abs(cellY) - 13) / 7) ** 2
      ) < 1;
      const ornament = vine || diamond || leaf;
      const seamShade = seamDistance < 1.5 ? -13 : 0;
      const ornamentLift = ornament ? 13 : 0;
      const age = Math.sin(x * Math.PI * 2 / 256) * Math.cos(y * Math.PI * 2 / 128) * 3;
      const base = 151 + stripe + grain + seamShade + ornamentLift + age;
      const warmth = ornament ? 4 : 0;
      const r = base + warmth;
      const g = base + 1;
      const b = base + 5 - warmth;
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
      const noise = (pseudoNoise(x * 5.21, y * 7.13) - 0.5) * 18;
      const seam = (x % 48 < 2 || y % 42 < 2) ? 1 : 0;
      const base = seam ? 76 : 124;
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
