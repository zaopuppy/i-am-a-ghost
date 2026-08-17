import * as THREE from 'three';
import {
  createKidAssetInstance,
  createWallVisuals,
  importedAssetMetrics,
  type KidAssetInstance,
} from '../assets/ImportedAssets';
import { createHouseMaterialKit, type HouseMaterialKit } from '../assets/MaterialLibrary';
import { DEFAULT_HOUSE_MAP, HOUSE_ROOMS } from './defaultHouse';
import type { HeadlampBand, Vec2 } from './MatchEngine';
import type { ViewerFrame } from './ViewerFrame';

const CHILD_COLORS = [0xf0a060, 0xdcb35d, 0xd98265, 0xe2a08d] as const;
const HEADLAMP_OFF = new THREE.Color(0x3b3025);
const HEADLAMP_ON = new THREE.Color(0xffd36b);

interface ActorVisual {
  root: THREE.Group;
  body: THREE.Object3D;
  lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  headlamp: HeadlampBand;
  imported: KidAssetInstance | null;
  currentAnimation: string;
  lastPosition: Vec2 | null;
  lastUpdateSeconds: number;
}

const HOUSE_WALLS = [
  ...DEFAULT_HOUSE_MAP.walls,
  { id: 'north-boundary', minX: -16.2, maxX: 16.2, minZ: 9.8, maxZ: 10.2 },
  { id: 'south-boundary', minX: -16.2, maxX: 16.2, minZ: -10.2, maxZ: -9.8 },
  { id: 'west-boundary', minX: -16.2, maxX: -15.8, minZ: -10, maxZ: 10 },
  { id: 'east-boundary', minX: 15.8, maxX: 16.2, minZ: -10, maxZ: 10 },
] as const;

export class GameWorld {
  readonly scene = new THREE.Scene();
  private readonly actors = new Map<string, ActorVisual>();
  private readonly materials: HouseMaterialKit = createHouseMaterialKit();
  private readonly battery = createBattery(this.materials);
  private readonly fallbackWalls = new THREE.Group();

  constructor() {
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x050608, 0.018);
    this.scene.add(new THREE.HemisphereLight(0x69748e, 0x07080a, 0.72));
    const moon = new THREE.DirectionalLight(0xaeb8d5, 2.1);
    moon.position.set(-10, 18, 7);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -18;
    moon.shadow.camera.right = 18;
    moon.shadow.camera.top = 12;
    moon.shadow.camera.bottom = -12;
    moon.shadow.bias = -0.0012;
    this.scene.add(moon);
    const warmFill = new THREE.DirectionalLight(0x6f5239, 0.52);
    warmFill.position.set(10, 7, -8);
    this.scene.add(warmFill);
    this.buildHouse();
    void this.upgradeWalls();
    this.battery.root.visible = false;
    this.scene.add(this.battery.root);
  }

  sync(frame: ViewerFrame | null, elapsedSeconds: number): void {
    for (const actor of this.actors.values()) actor.root.visible = false;
    if (!frame) return;

    for (const child of frame.children) {
      const actor = this.actor(`child:${child.playerId}`, 'child', child.slot);
      syncActor(actor, child.position, child.facingRadians, child.headlamp, elapsedSeconds, frame.phase, false);
      if (actor.beam) actor.beam.visible = child.flashlightOn && frame.phase === 'playing';
    }
    for (const doll of frame.dolls) {
      const actor = this.actor(`doll:${doll.dollId}`, 'doll', doll.slot);
      syncActor(actor, doll.position, 0, doll.headlamp, elapsedSeconds, frame.phase, true);
    }
    if (frame.ghost) {
      const actor = this.actor('ghost', 'ghost', 0);
      actor.root.visible = true;
      actor.root.position.set(frame.ghost.position.x, Math.sin(elapsedSeconds * 2.1) * 0.035, frame.ghost.position.z);
      actor.root.rotation.y = -frame.ghost.facingRadians;
      const windupPulse = frame.ghost.captureState === 'windup'
        ? 1 + Math.sin(elapsedSeconds * 28) * 0.09
        : 1;
      actor.body.scale.setScalar(windupPulse);
    }

    this.battery.root.visible = Boolean(frame.battery);
    if (frame.battery) {
      this.battery.root.position.set(
        frame.battery.position.x,
        0.42 + Math.sin(elapsedSeconds * 3) * 0.08,
        frame.battery.position.z,
      );
      this.battery.root.rotation.y = elapsedSeconds * 1.4;
    }
    this.animateHeadlamps(elapsedSeconds);
  }

  metrics(): {
    actors: number;
    walls: number;
    rooms: number;
    beams: number;
    visibleObjects: number;
    materials: number;
    animatedActors: number;
    assets: ReturnType<typeof importedAssetMetrics>;
  } {
    let visibleObjects = 0;
    const materials = new Set<THREE.Material>();
    this.scene.traverseVisible((object) => {
      visibleObjects += 1;
      if (!(object instanceof THREE.Mesh)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) materials.add(material);
    });
    return {
      actors: [...this.actors.values()].filter((actor) => actor.root.visible).length,
      walls: HOUSE_WALLS.length,
      rooms: HOUSE_ROOMS.length,
      beams: [...this.actors.values()].filter((actor) => actor.beam?.visible).length,
      visibleObjects,
      materials: materials.size,
      animatedActors: [...this.actors.values()].filter((actor) => actor.root.visible && actor.imported).length,
      assets: importedAssetMetrics(),
    };
  }

  dispose(): void {
    for (const actor of this.actors.values()) {
      actor.imported?.mixer.stopAllAction();
    }
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.materials.dispose();
  }

  private buildHouse(): void {
    const width = DEFAULT_HOUSE_MAP.bounds.maxX - DEFAULT_HOUSE_MAP.bounds.minX;
    const depth = DEFAULT_HOUSE_MAP.bounds.maxZ - DEFAULT_HOUSE_MAP.bounds.minZ;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.materials.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const roomGeometry = new THREE.PlaneGeometry(9.3, 5.8);
    for (const [index, room] of HOUSE_ROOMS.entries()) {
      const tile = new THREE.Mesh(
        roomGeometry,
        index % 2 === 0 ? this.materials.roomFloorA : this.materials.roomFloorB,
      );
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(room.center.x, 0.005, room.center.z);
      tile.receiveShadow = true;
      this.scene.add(tile);
    }

    this.fallbackWalls.name = 'procedural-wall-fallback';
    for (const wall of HOUSE_WALLS) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.maxX - wall.minX, 0.72, wall.maxZ - wall.minZ),
        this.materials.wall,
      );
      mesh.position.set((wall.minX + wall.maxX) / 2, 0.36, (wall.minZ + wall.maxZ) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.fallbackWalls.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), this.materials.trim);
      edges.position.copy(mesh.position);
      this.fallbackWalls.add(edges);
    }
    this.scene.add(this.fallbackWalls);
  }

  private async upgradeWalls(): Promise<void> {
    try {
      const importedWalls = await createWallVisuals(HOUSE_WALLS, this.materials.wall);
      this.scene.add(importedWalls);
      this.scene.remove(this.fallbackWalls);
      this.fallbackWalls.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      });
    } catch {
      this.fallbackWalls.visible = true;
    }
  }

  private actor(id: string, kind: 'child' | 'ghost' | 'doll', slot: number): ActorVisual {
    const existing = this.actors.get(id);
    if (existing) return existing;
    const visual = createActor(kind, slot, this.materials);
    this.actors.set(id, visual);
    this.scene.add(visual.root);
    if (kind !== 'ghost') void this.upgradeActor(visual, kind, slot);
    return visual;
  }

  private async upgradeActor(
    actor: ActorVisual,
    kind: 'child' | 'doll',
    slot: number,
  ): Promise<void> {
    try {
      const imported = await createKidAssetInstance(slot, kind === 'doll');
      actor.root.remove(actor.body);
      actor.body = imported.root;
      actor.imported = imported;
      actor.root.add(imported.root);
      actor.root.remove(actor.lamp);
      actor.lamp.position.set(0, 0, 0);
      imported.headlampSocket.add(actor.lamp);
    } catch {
      actor.imported = null;
    }
  }

  private animateHeadlamps(elapsedSeconds: number): void {
    for (const actor of this.actors.values()) {
      const active = headlampIsLit(actor.headlamp, elapsedSeconds);
      actor.lamp.material.color.copy(active ? HEADLAMP_ON : HEADLAMP_OFF);
      actor.lamp.scale.setScalar(active ? 1.4 : 1);
    }
  }
}

function createActor(
  kind: 'child' | 'ghost' | 'doll',
  slot: number,
  materials: HouseMaterialKit,
): ActorVisual {
  const root = new THREE.Group();
  let body: THREE.Object3D;
  let beam: ActorVisual['beam'] = null;
  if (kind === 'ghost') {
    body = createGhost(materials);
    root.add(body);
  } else {
    const color = kind === 'doll' ? 0x655849 : CHILD_COLORS[slot % CHILD_COLORS.length];
    const mesh = new THREE.Mesh(
      kind === 'doll'
        ? new THREE.BoxGeometry(0.62, 0.82, 0.62)
        : new THREE.CapsuleGeometry(0.31, 0.48, 5, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: kind === 'doll' ? 0.08 : 0.24,
        roughness: 0.72,
      }),
    );
    mesh.position.y = 0.51;
    mesh.castShadow = kind === 'child';
    body = mesh;
    root.add(mesh);
    if (kind === 'child') {
      beam = createBeam();
      beam.visible = false;
      root.add(beam);
    }
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 10, 8),
    new THREE.MeshBasicMaterial({ color: HEADLAMP_OFF }),
  );
  lamp.position.set(0.22, kind === 'ghost' ? 1.05 : 1.06, -0.02);
  lamp.visible = kind !== 'ghost';
  root.add(lamp);
  const markerColor = kind === 'ghost'
    ? 0x93a9df
    : kind === 'doll'
      ? 0x665c50
      : CHILD_COLORS[slot % CHILD_COLORS.length];
  const contact = new THREE.Mesh(
    new THREE.RingGeometry(kind === 'ghost' ? 0.43 : 0.31, kind === 'ghost' ? 0.58 : 0.43, 24),
    new THREE.MeshBasicMaterial({
      color: markerColor,
      transparent: true,
      opacity: kind === 'doll' ? 0.34 : 0.78,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  root.add(contact);
  return {
    root,
    body,
    lamp,
    beam,
    headlamp: 'off',
    imported: null,
    currentAnimation: 'Idle_A',
    lastPosition: null,
    lastUpdateSeconds: 0,
  };
}

function syncActor(
  actor: ActorVisual,
  position: Vec2,
  facingRadians: number,
  headlamp: HeadlampBand,
  elapsedSeconds: number,
  phase: ViewerFrame['phase'],
  doll: boolean,
): void {
  actor.root.visible = true;
  actor.root.position.set(position.x, 0, position.z);
  actor.root.rotation.y = -facingRadians;
  actor.headlamp = headlamp;
  if (actor.imported) {
    const elapsed = actor.lastUpdateSeconds > 0
      ? Math.min(0.08, Math.max(0, elapsedSeconds - actor.lastUpdateSeconds))
      : 0;
    const distance = actor.lastPosition
      ? Math.hypot(position.x - actor.lastPosition.x, position.z - actor.lastPosition.z)
      : 0;
    const nextAnimation = doll
      ? 'Idle_A'
      : phase === 'capture-animation'
        ? 'Hit_A'
        : distance > 0.012
          ? 'Running_A'
          : 'Idle_A';
    if (nextAnimation !== actor.currentAnimation) {
      const previous = actor.imported.actions.get(actor.currentAnimation);
      const next = actor.imported.actions.get(nextAnimation);
      next?.reset().play();
      if (previous && next) next.crossFadeFrom(previous, 0.1, false);
      actor.currentAnimation = nextAnimation;
    }
    actor.imported.mixer.update(doll ? 0 : elapsed);
  }
  actor.lastPosition = { ...position };
  actor.lastUpdateSeconds = elapsedSeconds;
}

function createGhost(materials: HouseMaterialKit): THREE.Group {
  const ghost = new THREE.Group();
  ghost.name = 'procedural-footless-ghost';
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.43, 20, 14), materials.ghostTrim);
  hood.position.y = 0.9;
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.08, 20, 2, true), materials.ghostBody);
  robe.position.y = 0.43;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.065, 7, 20), materials.ghostTrim);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.69;
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xdce8ff });
  const eyeGeometry = new THREE.SphereGeometry(0.055, 9, 6);
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(0.33, 0.94, -0.12);
  const rightEye = leftEye.clone();
  rightEye.position.z = 0.12;
  const wispMaterial = new THREE.MeshBasicMaterial({ color: 0x8793b0, transparent: true, opacity: 0.6 });
  for (const side of [-1, 0, 1]) {
    const wisp = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.36, 7), wispMaterial);
    wisp.position.set(side * 0.35, -0.12 + Math.abs(side) * 0.05, side * 0.08);
    wisp.rotation.z = side * 0.2;
    ghost.add(wisp);
  }
  ghost.add(hood, robe, collar, leftEye, rightEye);
  return ghost;
}

function createBeam(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const length = 2;
  const halfWidth = Math.tan((20 * Math.PI) / 360) * length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.28, 0.25, 0, length, 0.05, -halfWidth, length, 0.05, halfWidth], 3),
  );
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xffdc72,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
}

function createBattery(materials: HouseMaterialKit): { root: THREE.Group } {
  const root = new THREE.Group();
  root.name = 'battery-pickup';
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.28), materials.reward);
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffeb9b }),
  );
  cap.position.y = 0.36;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.025, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xe6c965, transparent: true, opacity: 0.65 }),
  );
  ring.rotation.x = Math.PI / 2;
  root.add(cell, cap, ring);
  return { root };
}

function headlampIsLit(band: HeadlampBand, elapsedSeconds: number): boolean {
  if (band === 'solid') return true;
  if (band === 'fast') return Math.sin(elapsedSeconds * Math.PI * 8) > -0.1;
  if (band === 'slow') return Math.sin(elapsedSeconds * Math.PI * 2.4) > 0.35;
  return false;
}
