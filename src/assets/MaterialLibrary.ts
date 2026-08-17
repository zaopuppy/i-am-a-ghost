import * as THREE from 'three';

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
});

export interface HouseMaterialKit {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  roomFloorA: THREE.MeshStandardMaterial;
  roomFloorB: THREE.MeshStandardMaterial;
  trim: THREE.LineBasicMaterial;
  ghostBody: THREE.MeshStandardMaterial;
  ghostTrim: THREE.MeshStandardMaterial;
  reward: THREE.MeshStandardMaterial;
  contact: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createHouseMaterialKit(): HouseMaterialKit {
  const wall = new THREE.MeshStandardMaterial({
    color: ART_COLORS.bodyPrimary,
    emissive: 0x30394d,
    emissiveIntensity: 1.05,
    roughness: 0.82,
    metalness: 0.03,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: ART_COLORS.groundContact,
    roughness: 0.98,
  });
  const roomFloorA = new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 0.95 });
  const roomFloorB = new THREE.MeshStandardMaterial({ color: 0x13151b, roughness: 0.92 });
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
    trim,
    ghostBody,
    ghostTrim,
    reward,
    contact,
  ];
  return {
    wall,
    floor,
    roomFloorA,
    roomFloorB,
    trim,
    ghostBody,
    ghostTrim,
    reward,
    contact,
    dispose: () => owned.forEach((material) => material.dispose()),
  };
}
