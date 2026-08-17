import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const KID_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-adventurers/Rogue_Kid.glb`;
const WALL_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-medieval/wall_straight.glb`;
const KID_HEIGHT = 1.5;
const CHILD_TINTS = [0xf0a060, 0xdcb35d, 0xd98265, 0xe2a08d] as const;
const REQUIRED_CLIPS = ['Idle_A', 'Running_A', 'Hit_A'] as const;

export type AssetLoadStatus = 'not-requested' | 'loading' | 'ready' | 'failed';

export interface ImportedAssetMetrics {
  status: AssetLoadStatus;
  fileBytes: number;
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  clips: string[];
}

export interface KidAssetInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  headlampSocket: THREE.Group;
}

const diagnostics: { kid: ImportedAssetMetrics; wall: ImportedAssetMetrics } = {
  kid: emptyMetrics(503_252),
  wall: emptyMetrics(28_752),
};
let kidPromise: Promise<GLTF> | null = null;
let wallPromise: Promise<GLTF> | null = null;

export async function createKidAssetInstance(slot: number, doll: boolean): Promise<KidAssetInstance> {
  const gltf = await loadKidAsset();
  const scene = cloneSkeleton(gltf.scene) as THREE.Group;
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = KID_HEIGHT / Math.max(size.y, 0.001);
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  scene.rotation.y = Math.PI / 2;

  const tint = new THREE.Color(CHILD_TINTS[slot % CHILD_TINTS.length]);
  if (doll) tint.lerp(new THREE.Color(0x62594d), 0.7);
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = !doll;
    object.receiveShadow = true;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = sourceMaterials.map((source) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.copy(tint).lerp(new THREE.Color(0xffffff), doll ? 0.12 : 0.32);
        material.roughness = doll ? 0.94 : 0.78;
        material.metalness = 0;
      }
      return material;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
  });

  const root = new THREE.Group();
  root.name = doll ? 'kaykit-sensing-doll' : 'kaykit-rogue-child';
  root.add(scene);
  const head = findNode(scene, 'head') ?? scene;
  const headlampSocket = new THREE.Group();
  headlampSocket.name = 'headlamp-socket';
  headlampSocket.position.set(0, head === scene ? 1.42 : 0.13, 0.12);
  head.add(headlampSocket);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const name of REQUIRED_CLIPS) {
    const clip = gltf.animations.find((candidate) => candidate.name === name);
    if (!clip) throw new Error(`Rogue Kid is missing required animation ${name}.`);
    const action = mixer.clipAction(clip);
    action.setLoop(
      name === 'Hit_A' ? THREE.LoopOnce : THREE.LoopRepeat,
      name === 'Hit_A' ? 1 : Number.POSITIVE_INFINITY,
    );
    action.clampWhenFinished = name === 'Hit_A';
    actions.set(name, action);
  }
  actions.get('Idle_A')?.play();
  return { root, mixer, actions, headlampSocket };
}

export async function createWallVisuals(
  walls: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>,
  material: THREE.Material,
): Promise<THREE.Group> {
  const gltf = await loadWallAsset();
  const sourceBounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const group = new THREE.Group();
  group.name = 'kaykit-wall-visuals';
  for (const wall of walls) {
    const width = wall.maxX - wall.minX;
    const depth = wall.maxZ - wall.minZ;
    const visual = gltf.scene.clone(true);
    visual.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = material;
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    if (width >= depth) {
      visual.scale.set(width / sourceSize.x, 0.72 / sourceSize.y, depth / sourceSize.z);
    } else {
      visual.rotation.y = Math.PI / 2;
      visual.scale.set(depth / sourceSize.x, 0.72 / sourceSize.y, width / sourceSize.z);
    }
    visual.position.set((wall.minX + wall.maxX) / 2, 0, (wall.minZ + wall.maxZ) / 2);
    group.add(visual);
  }
  return group;
}

export function importedAssetMetrics(): Readonly<{ kid: ImportedAssetMetrics; wall: ImportedAssetMetrics }> {
  return diagnostics;
}

function loadKidAsset(): Promise<GLTF> {
  if (!kidPromise) {
    diagnostics.kid.status = 'loading';
    kidPromise = new GLTFLoader().loadAsync(KID_URL).then((gltf) => {
      diagnostics.kid = inspectGltf(gltf, 503_252);
      return gltf;
    }).catch((error: unknown) => {
      diagnostics.kid.status = 'failed';
      throw error;
    });
  }
  return kidPromise;
}

function loadWallAsset(): Promise<GLTF> {
  if (!wallPromise) {
    diagnostics.wall.status = 'loading';
    wallPromise = new GLTFLoader().loadAsync(WALL_URL).then((gltf) => {
      diagnostics.wall = inspectGltf(gltf, 28_752);
      return gltf;
    }).catch((error: unknown) => {
      diagnostics.wall.status = 'failed';
      throw error;
    });
  }
  return wallPromise;
}

function inspectGltf(gltf: GLTF, fileBytes: number): ImportedAssetMetrics {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const count = object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0;
    triangles += count / 3;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  return {
    status: 'ready',
    fileBytes,
    triangles: Math.round(triangles),
    meshes,
    materials: materials.size,
    textures: textures.size,
    clips: gltf.animations.map((clip) => clip.name),
  };
}

function emptyMetrics(fileBytes: number): ImportedAssetMetrics {
  return { status: 'not-requested', fileBytes, triangles: 0, meshes: 0, materials: 0, textures: 0, clips: [] };
}

function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name.toLowerCase() === name) found = object;
  });
  return found;
}
