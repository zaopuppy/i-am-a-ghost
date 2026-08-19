import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const KID_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-adventurers/Rogue_Kid.glb`;
const GHOST_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-adventurers/Ghost.glb`;
const KID_HEIGHT = 1.5;
const GHOST_HEIGHT = 1.72;
const CHILD_TINTS = [0xf0a060, 0xdcb35d, 0xd98265, 0xe2a08d] as const;
const REQUIRED_CLIPS = ['Idle_A', 'Running_A', 'Hit_A'] as const;
type CharacterAssetKind = 'kid' | 'ghost';

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

export interface CharacterJoints {
  chest: THREE.Object3D | null;
  head: THREE.Object3D | null;
  leftUpperArm: THREE.Object3D | null;
  rightUpperArm: THREE.Object3D | null;
  leftLowerArm: THREE.Object3D | null;
  rightLowerArm: THREE.Object3D | null;
  leftUpperLeg: THREE.Object3D | null;
  rightUpperLeg: THREE.Object3D | null;
  leftLowerLeg: THREE.Object3D | null;
  rightLowerLeg: THREE.Object3D | null;
}

export interface CharacterAssetInstance {
  kind: CharacterAssetKind;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  joints: CharacterJoints;
  captureJointRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>;
  jointRestRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>;
  lookJoints: Pick<CharacterJoints, 'chest' | 'head'>;
}

export type KidAssetInstance = CharacterAssetInstance;

const diagnostics: {
  kid: ImportedAssetMetrics;
  ghost: ImportedAssetMetrics;
} = {
  kid: emptyMetrics(503_252),
  ghost: emptyMetrics(445_612),
};
const characterPromises: Partial<Record<CharacterAssetKind, Promise<GLTF>>> = {};

export async function createKidAssetInstance(slot: number, doll: boolean): Promise<KidAssetInstance> {
  return createCharacterAssetInstance('kid', slot, doll);
}

export async function createGhostAssetInstance(): Promise<CharacterAssetInstance> {
  return createCharacterAssetInstance('ghost', 0, false);
}

async function createCharacterAssetInstance(
  kind: CharacterAssetKind,
  slot: number,
  doll: boolean,
): Promise<CharacterAssetInstance> {
  const gltf = await loadCharacterAsset(kind);
  const scene = cloneSkeleton(gltf.scene) as THREE.Group;
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = (kind === 'ghost' ? GHOST_HEIGHT : KID_HEIGHT) / Math.max(size.y, 0.001);
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

  const tint = new THREE.Color(CHILD_TINTS[slot % CHILD_TINTS.length]);
  if (doll) tint.lerp(new THREE.Color(0x9b8064), 0.42);
  const materialClones = new Map<THREE.Material, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = kind === 'kid' && !doll;
    object.receiveShadow = true;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = sourceMaterials.map((source) => {
      const existing = materialClones.get(source);
      if (existing) return existing;
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        if (kind === 'ghost') {
          material.color.set(0x9aadc6);
          material.emissive.set(0x1c3558);
          material.emissiveIntensity = 0.95;
          material.roughness = 0.68;
          material.metalness = 0.04;
          material.transparent = true;
          material.opacity = 0.9;
          material.depthWrite = true;
        } else {
          material.color.copy(tint).lerp(new THREE.Color(0xffffff), doll ? 0.24 : 0.36);
          material.emissive.copy(tint);
          material.emissiveIntensity = doll ? 0.46 : 0.3;
          material.roughness = doll ? 0.94 : 0.78;
          material.metalness = 0;
        }
      }
      materialClones.set(source, material);
      return material;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
  });

  const oriented = new THREE.Group();
  oriented.name = `${kind}-normalized-model`;
  oriented.rotation.y = Math.PI / 2;
  oriented.add(scene);
  const root = new THREE.Group();
  root.name = kind === 'ghost'
    ? 'kaykit-spectral-ghost'
    : doll
      ? 'kaykit-sensing-doll'
      : 'kaykit-rogue-child';
  root.add(oriented);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const name of REQUIRED_CLIPS) {
    const clip = gltf.animations.find((candidate) => candidate.name === name);
    if (!clip) throw new Error(`${kind} asset is missing required animation ${name}.`);
    const action = mixer.clipAction(clip);
    action.setLoop(
      name === 'Hit_A' ? THREE.LoopOnce : THREE.LoopRepeat,
      name === 'Hit_A' ? 1 : Number.POSITIVE_INFINITY,
    );
    action.clampWhenFinished = name === 'Hit_A';
    actions.set(name, action);
  }
  actions.get('Idle_A')?.play();
  const joints: CharacterJoints = {
    chest: findObjectByName(scene, 'chest'),
    head: findObjectByName(scene, 'head'),
    leftUpperArm: findObjectByName(scene, 'upperarml'),
    rightUpperArm: findObjectByName(scene, 'upperarmr'),
    leftLowerArm: findObjectByName(scene, 'lowerarml'),
    rightLowerArm: findObjectByName(scene, 'lowerarmr'),
    leftUpperLeg: findObjectByName(scene, 'upperlegl'),
    rightUpperLeg: findObjectByName(scene, 'upperlegr'),
    leftLowerLeg: findObjectByName(scene, 'lowerlegl'),
    rightLowerLeg: findObjectByName(scene, 'lowerlegr'),
  };
  const jointRestRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const joint of Object.values(joints)) {
    if (joint) jointRestRotations.set(joint, joint.quaternion.clone());
  }
  mixer.update(0);
  const captureJointRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const joint of Object.values(joints)) {
    if (joint) captureJointRotations.set(joint, joint.quaternion.clone());
  }
  return {
    kind,
    root,
    mixer,
    actions,
    joints,
    captureJointRotations,
    jointRestRotations,
    lookJoints: { chest: joints.chest, head: joints.head },
  };
}

function findObjectByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.name.toLowerCase() === name) match = object;
  });
  return match;
}

export function importedAssetMetrics(): Readonly<{
  kid: ImportedAssetMetrics;
  ghost: ImportedAssetMetrics;
}> {
  return diagnostics;
}

function loadCharacterAsset(kind: CharacterAssetKind): Promise<GLTF> {
  let promise = characterPromises[kind];
  if (!promise) {
    const url = kind === 'ghost' ? GHOST_URL : KID_URL;
    const fileBytes = kind === 'ghost' ? 445_612 : 503_252;
    diagnostics[kind].status = 'loading';
    promise = new GLTFLoader().loadAsync(url).then((gltf) => {
      diagnostics[kind] = inspectGltf(gltf, fileBytes);
      return gltf;
    }).catch((error: unknown) => {
      diagnostics[kind].status = 'failed';
      throw error;
    });
    characterPromises[kind] = promise;
  }
  return promise;
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
