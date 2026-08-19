import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { RoomFamily } from '../game/defaultHouse';
import {
  FURNITURE_ASSET_IDS,
  type FurnitureAssetId,
} from '../game/HouseScene';
import type { HouseMaterialKit } from './MaterialLibrary';
import type { ImportedAssetMetrics } from './ImportedAssets';

export interface FurnitureLibrary {
  instantiate(id: FurnitureAssetId, family: RoomFamily): THREE.Group;
}

const FURNITURE_ROOT = `${import.meta.env.BASE_URL}assets/models/kaykit-furniture`;
const FURNITURE_FILE_BYTES = 310_198;
const diagnostics: ImportedAssetMetrics = emptyMetrics(FURNITURE_FILE_BYTES);

export async function loadFurnitureLibrary(materials: HouseMaterialKit): Promise<FurnitureLibrary> {
  diagnostics.status = 'loading';
  const loader = new GLTFLoader();
  try {
    const [texture, entries] = await Promise.all([
      new THREE.TextureLoader().loadAsync(`${FURNITURE_ROOT}/furniturebits_texture.png`),
      Promise.all(FURNITURE_ASSET_IDS.map(async (id) => {
        const gltf = await loader.loadAsync(`${FURNITURE_ROOT}/${id}.gltf`);
        return [id, gltf] as const;
      })),
    ]);
    configureFurnitureTexture(texture, materials);
    const sources = new Map<FurnitureAssetId, GLTF>(entries);
    diagnostics.status = 'ready';
    diagnostics.triangles = entries.reduce((total, [, gltf]) => total + countTriangles(gltf.scene), 0);
    diagnostics.meshes = entries.reduce((total, [, gltf]) => total + countMeshes(gltf.scene), 0);
    diagnostics.materials = Object.keys(materials.furniture).length;
    diagnostics.textures = 1;

    return {
      instantiate(id, family) {
        const source = sources.get(id);
        if (!source) throw new Error(`Furniture asset ${id} was not loaded.`);
        const root = source.scene.clone(true);
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.material = materials.furniture[family];
          object.castShadow = false;
          object.receiveShadow = true;
        });
        return root;
      },
    };
  } catch (error) {
    diagnostics.status = 'failed';
    throw error;
  }
}

export function furnitureAssetMetrics(): Readonly<ImportedAssetMetrics> {
  return diagnostics;
}

function configureFurnitureTexture(texture: THREE.Texture, materials: HouseMaterialKit): void {
  texture.name = 'kaykit-furniture-gradient-atlas';
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  for (const material of Object.values(materials.furniture)) {
    material.map = texture;
    material.needsUpdate = true;
  }
}

function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const count = object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0;
    triangles += count / 3;
  });
  return Math.round(triangles);
}

function countMeshes(root: THREE.Object3D): number {
  let meshes = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes += 1;
  });
  return meshes;
}

function emptyMetrics(fileBytes: number): ImportedAssetMetrics {
  return {
    status: 'not-requested',
    fileBytes,
    triangles: 0,
    meshes: 0,
    materials: 0,
    textures: 0,
    clips: [],
  };
}
