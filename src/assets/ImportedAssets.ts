import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  CHARACTER_MODELS,
  DEFAULT_GHOST_MODEL,
  DEFAULT_KID_MODEL,
  type CharacterModelId,
  type GhostModelId,
  type KidModelId,
} from './CharacterCatalog';

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
  rightWrist: THREE.Object3D | null;
  rightHand: THREE.Object3D | null;
  rightHandSlot: THREE.Object3D | null;
  leftUpperLeg: THREE.Object3D | null;
  rightUpperLeg: THREE.Object3D | null;
  leftLowerLeg: THREE.Object3D | null;
  rightLowerLeg: THREE.Object3D | null;
}

export interface CharacterAssetInstance {
  kind: CharacterAssetKind;
  modelId: CharacterModelId;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  joints: CharacterJoints;
  captureJointRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>;
  jointRestModelRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>;
  jointRestRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>;
  lookJoints: Pick<CharacterJoints, 'chest' | 'head'>;
}

export type KidAssetInstance = CharacterAssetInstance;

const diagnostics: {
  kid: ImportedAssetMetrics;
  ghost: ImportedAssetMetrics;
  scout: ImportedAssetMetrics;
  wraith: ImportedAssetMetrics;
} = {
  kid: emptyMetrics(503_252),
  ghost: emptyMetrics(445_612),
  scout: emptyMetrics(153_564),
  wraith: emptyMetrics(108_308),
};
const characterPromises: Partial<Record<CharacterModelId, Promise<GLTF>>> = {};

/** Starts network fetch and GLTF parsing before the first match needs character instances. */
export async function preloadCharacterAssets(): Promise<void> {
  await Promise.allSettled([
    loadCharacterAsset('rogue'),
    loadCharacterAsset('specter'),
  ]);
}

export async function createKidAssetInstance(slot: number, doll: boolean, modelId: KidModelId = DEFAULT_KID_MODEL): Promise<KidAssetInstance> {
  return createCharacterAssetInstance('kid', modelId, slot, doll);
}

export async function createGhostAssetInstance(modelId: GhostModelId = DEFAULT_GHOST_MODEL): Promise<CharacterAssetInstance> {
  return createCharacterAssetInstance('ghost', modelId, 0, false);
}

async function createCharacterAssetInstance(
  kind: CharacterAssetKind,
  modelId: CharacterModelId,
  slot: number,
  doll: boolean,
): Promise<CharacterAssetInstance> {
  const gltf = await loadCharacterAsset(modelId);
  const profile = kind === 'ghost'
    ? CHARACTER_MODELS.ghost[modelId as GhostModelId]
    : CHARACTER_MODELS.kid[modelId as KidModelId];
  const scene = cloneSkeleton(gltf.scene) as THREE.Group;
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = profile.height / Math.max(size.y, 0.001);
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
          if (modelId === 'wraith') material.color.lerp(new THREE.Color(0x9aadc6), 0.35);
          else material.color.set(0x9aadc6);
          material.emissive.set(0x1c3558);
          material.emissiveIntensity = 0.95;
          material.roughness = 0.68;
          material.metalness = 0.04;
          material.transparent = true;
          material.opacity = 0.9;
          material.depthWrite = true;
        } else {
          if (modelId === 'scout') material.color.lerp(tint, 0.48);
          else material.color.copy(tint).lerp(new THREE.Color(0xffffff), doll ? 0.24 : 0.36);
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
  oriented.rotation.y = profile.yaw;
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
    chest: findObjectByName(scene, modelJoint(modelId, 'chest')),
    head: findObjectByName(scene, modelJoint(modelId, 'head')),
    leftUpperArm: findObjectByName(scene, modelJoint(modelId, 'upperarml')),
    rightUpperArm: findObjectByName(scene, modelJoint(modelId, 'upperarmr')),
    leftLowerArm: findObjectByName(scene, modelJoint(modelId, 'lowerarml')),
    rightLowerArm: findObjectByName(scene, modelJoint(modelId, 'lowerarmr')),
    rightWrist: findObjectByName(scene, modelJoint(modelId, 'wristr')),
    rightHand: findObjectByName(scene, modelJoint(modelId, 'handr')),
    rightHandSlot: findObjectByName(scene, modelJoint(modelId, 'handslotr')),
    leftUpperLeg: findObjectByName(scene, modelJoint(modelId, 'upperlegl')),
    rightUpperLeg: findObjectByName(scene, modelJoint(modelId, 'upperlegr')),
    leftLowerLeg: findObjectByName(scene, modelJoint(modelId, 'lowerlegl')),
    rightLowerLeg: findObjectByName(scene, modelJoint(modelId, 'lowerlegr')),
  };
  mixer.update(0);
  root.updateMatrixWorld(true);
  const jointRestRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  const jointRestModelRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  const captureJointRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const joint of Object.values(joints)) {
    if (!joint) continue;
    jointRestRotations.set(joint, joint.quaternion.clone());
    jointRestModelRotations.set(joint, joint.getWorldQuaternion(new THREE.Quaternion()));
    captureJointRotations.set(joint, joint.quaternion.clone());
  }
  return {
    kind,
    modelId,
    root,
    mixer,
    actions,
    joints,
    captureJointRotations,
    jointRestModelRotations,
    jointRestRotations,
    lookJoints: { chest: joints.chest, head: joints.head },
  };
}

function findObjectByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  const wanted = name.toLowerCase();
  root.traverse((object) => {
    if (!match && object.name.toLowerCase() === wanted) match = object;
  });
  return match;
}

function modelJoint(modelId: CharacterModelId, standardName: string): string {
  if (modelId === 'rogue' || modelId === 'specter') return standardName;
  const names: Record<string, string> = {
    chest: 'Torso', head: 'Skull',
    upperarml: 'ArmUpperL', upperarmr: 'ArmUpperR',
    lowerarml: 'ArmLowerL', lowerarmr: 'ArmLowerR',
    wristr: 'WristR', handr: 'PalmR', handslotr: 'TorchSocketR',
    upperlegl: 'LegUpperL', upperlegr: 'LegUpperR',
    lowerlegl: 'LegLowerL', lowerlegr: 'LegLowerR',
  };
  return `${modelId === 'scout' ? 'Scout' : 'Wraith'}_${names[standardName] ?? standardName}`;
}

export function importedAssetMetrics(): Readonly<{
  kid: ImportedAssetMetrics;
  ghost: ImportedAssetMetrics;
  scout: ImportedAssetMetrics;
  wraith: ImportedAssetMetrics;
}> {
  return diagnostics;
}

function loadCharacterAsset(modelId: CharacterModelId): Promise<GLTF> {
  let promise = characterPromises[modelId];
  if (!promise) {
    const metricId = modelId === 'rogue' ? 'kid' : modelId === 'specter' ? 'ghost' : modelId;
    const profile = modelId === 'rogue' || modelId === 'scout'
      ? CHARACTER_MODELS.kid[modelId]
      : CHARACTER_MODELS.ghost[modelId];
    const url = `${import.meta.env.BASE_URL}assets/models/${profile.file}`;
    const fileBytes = profile.bytes;
    diagnostics[metricId].status = 'loading';
    promise = new GLTFLoader().loadAsync(url).then((gltf) => {
      diagnostics[metricId] = inspectGltf(gltf, fileBytes);
      return gltf;
    }).catch((error: unknown) => {
      diagnostics[metricId].status = 'failed';
      delete characterPromises[modelId];
      throw error;
    });
    characterPromises[modelId] = promise;
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
