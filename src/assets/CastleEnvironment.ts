import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FLASHLIGHT_OCCLUDER_LAYER, LIGHTNING_OCCLUDER_LAYER } from '../game/RenderLayers';

export const CASTLE_SCENE_ID = 'midnight-castle';
const CASTLE_DIRECTORY = `${import.meta.env.BASE_URL}assets/models/midnight-castle/`;

export interface CastleAssetMetrics {
  status: 'loading' | 'ready' | 'failed' | 'disposed';
  fileBytes: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  error: string | null;
}

/** Owns one uncached GLB instance so switching maps cannot dispose another world's assets. */
export class CastleEnvironment {
  readonly root = new THREE.Group();
  readonly diagnostics: CastleAssetMetrics = {
    status: 'loading', fileBytes: 0, meshes: 0, triangles: 0,
    materials: 0, textures: 0, error: null,
  };
  private disposed = false;
  private readonly request = new AbortController();

  async load(): Promise<void> {
    try {
      const response = await fetch(`${CASTLE_DIRECTORY}midnight-castle.glb`, { signal: this.request.signal });
      if (!response.ok) throw new Error(`Castle GLB request failed: HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      this.diagnostics.fileBytes = bytes.byteLength;
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, CASTLE_DIRECTORY);
      if (this.disposed) {
        disposeCastleObjects(gltf.scene);
        return;
      }
      this.root.add(gltf.scene);
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      let walls = 0;
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        this.diagnostics.meshes += 1;
        this.diagnostics.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3;
        object.receiveShadow = true;
        const boundary = object.name.startsWith('boundary-');
        object.castShadow = object.name.startsWith('wall-') || boundary;
        if (object.castShadow) {
          walls += 1;
          object.layers.enable(FLASHLIGHT_OCCLUDER_LAYER);
          if (!boundary) object.layers.enable(LIGHTNING_OCCLUDER_LAYER);
        }
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      if (!this.diagnostics.meshes || !walls) throw new Error('Castle GLB must contain meshes and wall-* occluders.');
      this.diagnostics.materials = materials.size;
      this.diagnostics.textures = textures.size;
      this.diagnostics.triangles = Math.round(this.diagnostics.triangles);
      this.diagnostics.status = 'ready';
    } catch (error) {
      if (this.disposed) return;
      disposeCastleObjects(this.root);
      this.root.clear();
      this.diagnostics.status = 'failed';
      this.diagnostics.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.request.abort();
    this.root.removeFromParent();
    disposeCastleObjects(this.root);
    this.root.clear();
    this.diagnostics.status = 'disposed';
  }
}

function disposeCastleObjects(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
