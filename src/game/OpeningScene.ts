import * as THREE from 'three';
import { loadFurnitureLibrary } from '../assets/EnvironmentAssets';
import {
  createGhostAssetInstance,
  createKidAssetInstance,
  type CharacterAssetInstance,
} from '../assets/ImportedAssets';
import { createHouseMaterialKit } from '../assets/MaterialLibrary';

export interface OpeningCameraFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
  viewHeight: number;
}

/** A silent, self-contained prologue; seconds are supplied by the existing render loop. */
export class OpeningScene {
  readonly scene = new THREE.Scene();
  readonly ready: Promise<void>;
  private readonly materials = createHouseMaterialKit();
  private readonly door = new THREE.Group();
  private readonly shadow = new THREE.Group();
  private readonly shadowHead = new THREE.Group();
  private readonly children: CharacterAssetInstance[] = [];
  private ghost: CharacterAssetInstance | null = null;
  private readonly ghostMaterials: THREE.Material[] = [];
  private readonly childMaterials: THREE.Material[] = [];
  private readonly handprints = new THREE.Group();
  private readonly ink = new THREE.MeshBasicMaterial({ color: 0x9b2539, transparent: true, opacity: 0 });
  private readonly lamp = new THREE.PointLight(0xffc486, 14, 8, 2);
  private readonly flashlight = new THREE.SpotLight(0xd3e8ff, 0, 8, 0.24, 0.7, 1.5);
  private readonly flashlightProp = new THREE.Group();
  private readonly handTarget = new THREE.Vector3();
  private readonly jointPosition = new THREE.Vector3();
  private readonly handPosition = new THREE.Vector3();
  private readonly fromDirection = new THREE.Vector3();
  private readonly toDirection = new THREE.Vector3();
  private readonly jointRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly parentInverse = new THREE.Quaternion();
  private readonly identityRotation = new THREE.Quaternion();
  private readonly beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xb7d7ee, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  private readonly beam = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.7, 24, 1, true), this.beamMaterial);
  private readonly beamDirection = new THREE.Vector3();
  private readonly beamAxis = new THREE.Vector3(0, 1, 0);
  private readonly lampShade = new THREE.Group();
  private readonly cameraFrame: OpeningCameraFrame = {
    position: new THREE.Vector3(), target: new THREE.Vector3(), viewHeight: 6,
  };
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private disposed = false;

  constructor() {
    this.scene.name = 'midnight-pact-opening';
    this.scene.background = new THREE.Color(0x06090f);
    this.scene.fog = new THREE.Fog(0x06090f, 13, 25);
    this.scene.add(new THREE.HemisphereLight(0x819bbc, 0x372c28, 1.5));
    const moon = new THREE.DirectionalLight(0xb2cdf7, 2.5);
    moon.position.set(4, 7, 1);
    this.scene.add(moon);
    this.lamp.position.set(0.9, 2.5, 0.2);
    this.scene.add(this.lamp, this.flashlight, this.flashlight.target, this.beam);
    this.buildRoom();
    this.buildContract();
    this.buildShadow();
    this.buildFlashlight();
    this.ready = this.loadActorsAndFurniture();
    this.update(0, 16 / 9);
  }

  update(seconds: number, aspect: number): OpeningCameraFrame {
    const time = Math.max(0, seconds);
    const close = ease(time, 2.05, 2.55);
    const possessed = ease(time, 2.8, 4.1);
    const turn = ease(time, 3.9, 4.8);
    const reveal = ease(time, 5.2, 5.85);
    const recoil = ease(time, 5.75, 6.2);
    const settle = ease(time, 6.2, 8);
    this.door.rotation.y = -1.2 * (1 - close);
    this.ink.opacity = ease(time, 0.9, 1.8) * (0.65 + 0.1 * Math.sin(time * 1.8));
    this.lamp.intensity = 14 - possessed * 9 + Math.sin(time * 2.3) * 0.4;
    this.lampShade.rotation.z = Math.sin(time * 1.6) * (0.015 + close * 0.03);
    this.shadow.visible = time > 2.8;
    this.shadow.scale.set(1 + possessed * 0.24, 0.8 + possessed * 0.42 - settle * 0.2, 1);
    this.shadowHead.rotation.z = -turn * 0.32 + settle * Math.sin(time * 0.7) * 0.035;
    this.shadow.position.x = -1.25 - recoil * 0.18;
    for (let index = 0; index < this.children.length; index += 1) {
      const child = this.children[index];
      for (const [joint, rest] of child.jointRestRotations) joint.quaternion.copy(rest);
      child.mixer.setTime(index === 0 ? Math.min(time, 2.8) : time * 0.55 + index);
      if (index === 0) {
        const reach = ease(time, 0.25, 1.15) * (1 - ease(time, 2.2, 2.85));
        child.root.position.set(-1.6 + reach * 0.28 + possessed * 0.35 - recoil * 0.22, 0, -0.15 - recoil * 0.12);
        child.root.rotation.set(possessed * 0.15, 0.15, possessed * 0.08);
        if (child.joints.head) child.joints.head.rotation.x += possessed * 0.65;
        this.handTarget.set(-0.82, 0.565, 0.02);
        this.reachHand(child, this.handTarget, reach);
        child.root.visible = reveal < 1;
      } else {
        const retreat = ease(time, 3.35, 5.4);
        child.root.position.set(index === 1 ? 1.25 + retreat * 0.45 : 0.2 + retreat * 0.35, 0, index === 1 ? 0.35 + retreat * 0.3 : 1.6 + retreat * 0.5);
        child.root.rotation.y = index === 1 ? Math.PI - retreat * 0.2 : 2.15;
        if (index === 1) {
          this.handTarget.set(child.root.position.x - 0.38, 0.92, child.root.position.z + 0.1);
          this.reachHand(child, this.handTarget, ease(time, 4.6, 5.5));
        }
      }
    }
    for (const material of this.childMaterials) material.opacity = 1 - reveal;
    if (this.ghost) {
      this.ghost.root.visible = reveal > 0;
      this.ghost.root.position.set(-1.25 - recoil * 0.32, 0.07 + Math.sin(time * 1.7) * 0.035, -0.15 - recoil * 0.15);
      this.ghost.root.rotation.set(0, 0.2 - recoil * 0.55, recoil * 0.12);
      this.ghost.mixer.setTime(time * 0.5);
      for (const material of this.ghostMaterials) material.opacity = reveal * 0.88;
    }
    const light = ease(time, 5, 5.4);
    this.flashlight.position.set(1.45, 0.9, 0.7);
    this.flashlight.target.position.set(-1.7, 0.8 + Math.sin(time * 0.8) * 0.1, -1 + ease(time, 5, 5.7) * 0.8);
    const hand = this.children[1]?.joints.rightHand ?? this.children[1]?.joints.rightWrist;
    this.flashlightProp.visible = Boolean(hand);
    if (hand) {
      hand.getWorldPosition(this.flashlightProp.position);
      this.flashlightProp.lookAt(this.flashlight.target.position);
      this.toDirection.subVectors(this.flashlight.target.position, this.flashlightProp.position).normalize();
      this.flashlight.position.copy(this.flashlightProp.position).addScaledVector(this.toDirection, 0.25);
    }
    this.flashlight.intensity = light * 16;
    this.beamMaterial.opacity = light * 0.055;
    this.beamDirection.subVectors(this.flashlight.position, this.flashlight.target.position).normalize();
    this.beam.position.copy(this.flashlight.position).addScaledVector(this.beamDirection, -1.85);
    this.beam.quaternion.setFromUnitVectors(this.beamAxis, this.beamDirection);
    const narrow = aspect < 1;
    const shadowFraming = ease(time, 2.5, 3.6);
    this.cameraFrame.position.set(3.3 - settle * 0.8, 4.1 + settle * 0.8, 7.8 + settle * 0.8);
    this.cameraFrame.target.set(0, narrow ? 0.85 + settle * 0.5 : 0.85 + shadowFraming * 0.35 - settle * 1.15, -0.2);
    this.cameraFrame.viewHeight = Math.max(4.6 + shadowFraming * 1.2 + settle * (narrow ? 0.1 : 1.7), (narrow ? 5.9 : 6.6) / Math.max(0.4, aspect));
    return this.cameraFrame;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.children) child.mixer.stopAllAction();
    this.ghost?.mixer.stopAllAction();
    const materials = new Set<THREE.Material>();
    const skeletons = new Set<THREE.Skeleton>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    for (const material of materials) material.dispose();
    this.materials.furniture.old.map?.dispose();
    this.materials.dispose();
    this.scene.clear();
  }

  private box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    this.ownedGeometries.add(mesh.geometry);
    return mesh;
  }

  private buildRoom(): void {
    this.box(11, 0.12, 9, this.materials.roomFloors.living, 0, -0.08, 0);
    this.box(7.8, 4.6, 0.15, this.materials.wall, 1.1, 2.3, -2.85);
    this.box(0.9, 4.6, 0.15, this.materials.wall, -4.65, 2.3, -2.85);
    this.box(1.85, 1.55, 0.15, this.materials.wall, -3.3, 3.83, -2.85);
    this.box(0.15, 4.6, 5, this.materials.wall, -5.05, 2.3, -0.4);
    this.box(10, 0.16, 0.2, this.materials.doorFrame, 0, 0.15, -2.71);
    this.door.position.set(-4.18, 0, -2.76);
    this.scene.add(this.door);
    this.box(1.7, 3.02, 0.12, this.materials.doorFrame, 0.85, 1.51, 0, this.door);
    const panel = new THREE.MeshStandardMaterial({ color: 0x352a2a, roughness: 0.9 });
    this.box(1.34, 1.2, 0.05, panel, 0.85, 2.15, 0.08, this.door);
    this.box(1.34, 0.9, 0.05, panel, 0.85, 0.85, 0.08, this.door);
    this.box(0.1, 0.1, 0.13, this.materials.reward, 1.48, 1.45, 0.15, this.door);
    const window = new THREE.MeshBasicMaterial({ color: 0x7796b9 });
    this.box(1.6, 2.25, 0.025, window, 3.3, 2.3, -2.74);
    for (const x of [2.42, 3.3, 4.18]) this.box(0.1, 2.45, 0.11, this.materials.doorFrame, x, 2.3, -2.69);
    for (const y of [1.1, 2.3, 3.5]) this.box(1.85, 0.1, 0.11, this.materials.doorFrame, 3.3, y, -2.69);
    this.lampShade.position.set(0.9, 3.7, 0.2);
    this.scene.add(this.lampShade);
    this.box(0.025, 0.6, 0.025, panel, 0, -0.3, 0, this.lampShade);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.22, 16, 1, true), this.materials.doorFrame);
    shade.position.y = -0.7;
    this.lampShade.add(shade);
    this.ownedGeometries.add(shade.geometry);
    this.ownedGeometries.add(this.beam.geometry);
  }

  private buildContract(): void {
    const paper = new THREE.MeshStandardMaterial({ color: 0xcbbb91, roughness: 1, emissive: 0x332612, emissiveIntensity: 0.3 });
    this.box(0.83, 0.012, 0.61, paper, -0.5, 0.52, 0);
    this.handprints.position.set(-0.5, 0.531, 0);
    this.handprints.rotation.x = -Math.PI / 2;
    this.scene.add(this.handprints);
    for (let index = 0; index < 3; index += 1) {
      const palm = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), this.ink);
      palm.scale.y = 1.25;
      palm.position.set((index - 1) * 0.23, -0.015, 0);
      this.handprints.add(palm);
      this.ownedGeometries.add(palm.geometry);
      for (let finger = 0; finger < 5; finger += 1) {
        this.box(0.017, finger === 0 ? 0.06 : 0.095, 0.001, this.ink, palm.position.x + (finger - 2) * 0.023, 0.07 + (finger === 0 ? -0.025 : 0), 0, this.handprints);
      }
    }
  }

  private buildShadow(): void {
    const black = new THREE.MeshBasicMaterial({ color: 0x05050a, transparent: true, opacity: 0.87, depthWrite: false });
    this.shadow.position.set(-1.25, 0.12, -2.75);
    this.scene.add(this.shadow);
    const body = new THREE.Shape();
    body.moveTo(-0.42, 0);
    body.bezierCurveTo(-0.12, 0.7, -0.7, 1.2, -0.32, 1.75);
    body.bezierCurveTo(-0.1, 2, 0.15, 1.95, 0.35, 1.65);
    body.bezierCurveTo(0.6, 1, 0.22, 0.5, 0.48, 0);
    body.lineTo(0.12, 0.15);
    body.lineTo(-0.1, 0);
    body.closePath();
    const silhouette = new THREE.Mesh(new THREE.ShapeGeometry(body), black);
    this.shadow.add(silhouette);
    this.ownedGeometries.add(silhouette.geometry);
    this.shadowHead.position.set(0, 1.72, 0.01);
    this.shadow.add(this.shadowHead);
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), black);
    head.scale.set(1, 1.18, 1);
    this.shadowHead.add(head);
    this.ownedGeometries.add(head.geometry);
    const eye = new THREE.MeshBasicMaterial({ color: 0x9d5766 });
    for (const x of [-0.12, 0.1]) this.box(0.035, 0.075, 0.005, eye, x, 0.03, 0.01, this.shadowHead);
  }

  private buildFlashlight(): void {
    this.flashlightProp.name = 'opening-handheld-flashlight';
    this.scene.add(this.flashlightProp);
    const barrel = new THREE.MeshStandardMaterial({ color: 0x343d4a, metalness: 0.55, roughness: 0.4 });
    const lensMaterial = new THREE.MeshBasicMaterial({ color: 0xc3def3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.23, 12), barrel);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.04;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.065, 0.11, 12), barrel);
    rim.rotation.x = Math.PI / 2;
    rim.position.z = 0.19;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.081, 16), lensMaterial);
    lens.position.z = 0.247;
    this.flashlightProp.add(body, rim, lens);
    for (const mesh of [body, rim, lens]) this.ownedGeometries.add(mesh.geometry);
  }

  private reachHand(actor: CharacterAssetInstance, target: THREE.Vector3, weight: number): void {
    const hand = actor.joints.rightHand ?? actor.joints.rightWrist;
    if (!hand || weight <= 0) return;
    // A small CCD solve keeps the actual model's hand on the paper/torch target,
    // independent of the imported rig's local bone axes and normalized scale.
    for (let iteration = 0; iteration < 5; iteration += 1) {
      for (let index = 0; index < 2; index += 1) {
        const joint = index === 0 ? actor.joints.rightLowerArm : actor.joints.rightUpperArm;
        if (!joint?.parent) continue;
        actor.root.updateWorldMatrix(true, true);
        joint.getWorldPosition(this.jointPosition);
        hand.getWorldPosition(this.handPosition);
        this.fromDirection.subVectors(this.handPosition, this.jointPosition).normalize();
        this.toDirection.subVectors(target, this.jointPosition).normalize();
        this.jointRotation.setFromUnitVectors(this.fromDirection, this.toDirection);
        this.jointRotation.slerp(this.identityRotation, 1 - weight);
        joint.parent.getWorldQuaternion(this.parentRotation);
        this.parentInverse.copy(this.parentRotation).invert();
        this.jointRotation.premultiply(this.parentInverse).multiply(this.parentRotation);
        joint.quaternion.premultiply(this.jointRotation);
      }
    }
    actor.root.updateWorldMatrix(true, true);
  }

  private async loadActorsAndFurniture(): Promise<void> {
    const results = await Promise.allSettled([
      Promise.allSettled([createKidAssetInstance(0, false), createKidAssetInstance(1, false), createKidAssetInstance(2, false), createGhostAssetInstance()]),
      loadFurnitureLibrary(this.materials),
    ]);
    const actorResults = results[0].status === 'fulfilled' ? results[0].value : [];
    const actors = actorResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failed = actorResults.find((result) => result.status === 'rejected');
    if (this.disposed || failed || results[1].status === 'rejected') {
      for (const actor of actors) {
        actor.mixer.stopAllAction();
        const ownedMaterials = new Set<THREE.Material>();
        actor.root.traverse((object) => {
          if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) ownedMaterials.add(material);
        });
        for (const material of ownedMaterials) material.dispose();
      }
      if (this.disposed) {
        this.materials.furniture.old.map?.dispose();
        return;
      }
      throw failed?.status === 'rejected' ? failed.reason : (results[1].status === 'rejected' ? results[1].reason : new Error('Opening assets could not load.'));
    }
    if (results[0].status === 'fulfilled') {
      for (const actor of actors) {
        // Character geometries/textures belong to the shared asset cache. Only the
        // per-instance materials are owned here; disposing the intro must not break a match.
        this.scene.add(actor.root);
      }
      this.children.push(...actors.slice(0, 3));
      this.ghost = actors[3];
      for (const [actor, materials] of [[actors[0], this.childMaterials], [actors[3], this.ghostMaterials]] as const) {
        actor.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            material.transparent = true;
            if (!materials.includes(material)) materials.push(material);
          }
        });
      }
    }
    if (results[1].status === 'fulfilled') {
      const furniture = results[1].value;
      for (const [id, x, z, yaw] of [
        ['table_low', 0, 0, 0],
        ['cabinet_medium_decorated', 1, -2.25, 0],
        ['chair_A_wood', 2.6, 1.2, -0.8],
        ['rug_oval_A', 0, 0.4, 0],
      ] as const) {
        const prop = furniture.instantiate(id, 'old');
        prop.position.set(x, id === 'rug_oval_A' ? -0.02 : 0, z);
        prop.rotation.y = yaw;
        this.scene.add(prop);
        prop.traverse((object) => {
          if (object instanceof THREE.Mesh) this.ownedGeometries.add(object.geometry);
        });
      }
    }
    if (results[0].status === 'rejected') throw results[0].reason;
    this.update(0, 16 / 9);
  }
}

function ease(time: number, start: number, end: number): number {
  const progress = THREE.MathUtils.clamp((time - start) / (end - start), 0, 1);
  return progress * progress * (3 - 2 * progress);
}
