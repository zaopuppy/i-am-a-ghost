import * as THREE from 'three';
import {
  createGhostAssetInstance,
  createKidAssetInstance,
  createWallVisuals,
  importedAssetMetrics,
  type CharacterAssetInstance,
} from '../assets/ImportedAssets';
import { createHouseMaterialKit, type HouseMaterialKit } from '../assets/MaterialLibrary';
import { DEFAULT_HOUSE_MAP, HOUSE_ROOMS } from './defaultHouse';
import { clippedFlashlightLength } from './FlashlightVisual';
import { DEFAULT_GAMEPLAY_TUNING, MATCH_RULES, type HeadlampBand, type Vec2 } from './MatchEngine';
import {
  advanceChildBodyFacing,
  advanceChildLookFacing,
  advanceGhostBodyFacing,
  calculateLookOffsets,
  createVisualFacingState,
  movementFacing,
  type VisualFacingState,
} from './VisualFacing';
import type { ViewerFrame } from './ViewerFrame';

const CHILD_COLORS = [0xf0a060, 0xdcb35d, 0xd98265, 0xe2a08d] as const;
const HEADLAMP_OFF = new THREE.Color(0x3b3025);
const HEADLAMP_ON = new THREE.Color(0xffd36b);
const HEADLAMP_CAPTURE = new THREE.Color(0xd9e7ff);
const HEADLAMP_HEIGHT = 1.5;
const FLASHLIGHT_ORIGIN_HEIGHT = 1.02;
const FLASHLIGHT_ORIGIN_FORWARD = 0.28;
const FLASHLIGHT_BEAM_INTENSITY = 1.15;
const FLASHLIGHT_BEAM_OPACITY = 0.34;
const FLASHLIGHT_WALL_GAP = 0.06;
const WALL_HEIGHT = 2.2;
const HEADLAMP_SPIN_RADIANS_PER_SECOND = {
  off: 0,
  slow: 1.2,
  fast: 2.8,
  solid: 4.4,
} as const;
const LOOK_UP_AXIS = new THREE.Vector3(0, 1, 0);
const LOOK_ROTATION = new THREE.Quaternion();

interface ActorVisual {
  kind: 'child' | 'ghost' | 'doll';
  root: THREE.Group;
  bodyPivot: THREE.Group;
  aimPivot: THREE.Group;
  body: THREE.Object3D;
  lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  lampHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  lampLight: THREE.PointLight;
  beam: BeamVisual | null;
  headlamp: HeadlampBand;
  imported: CharacterAssetInstance | null;
  currentAnimation: string;
  captureProgress: number | null;
  lastPosition: Vec2 | null;
  lastUpdateSeconds: number;
  facing: VisualFacingState;
  ghostRig: GhostRig | null;
  lampSpin: number;
  statusMeter: WorldMeter | null;
}

interface BeamVisual {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  light: THREE.SpotLight;
  length: number;
  coneDegrees: number;
}

interface WorldMeter {
  root: THREE.Group;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  lastPercent: number;
  lastColor: number;
}

interface GhostRig {
  fallbackVisual: THREE.Group;
  importedMount: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  captureAura: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  captureVeil: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  captureLight: THREE.PointLight;
  burnAura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  burnLight: THREE.PointLight;
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
  private readonly batteries = [createBattery(this.materials), createBattery(this.materials)];
  private readonly fallbackWalls = new THREE.Group();
  private flashlightLength = DEFAULT_GAMEPLAY_TUNING.flashlightLength;
  private flashlightConeDegrees = DEFAULT_GAMEPLAY_TUNING.flashlightConeDegrees;
  private pendingAssetUpgrades = 0;

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
    for (const battery of this.batteries) {
      battery.root.visible = false;
      this.scene.add(battery.root);
    }
  }

  sync(frame: ViewerFrame | null, elapsedSeconds: number): void {
    for (const actor of this.actors.values()) {
      actor.root.visible = false;
      actor.captureProgress = null;
    }
    if (!frame) return;

    for (const child of frame.children) {
      const actor = this.actor(`child:${child.playerId}`, 'child', child.slot);
      syncActor(
        actor,
        child.position,
        child.facingRadians,
        child.headlamp,
        elapsedSeconds,
        frame.phase,
        false,
        frame.capture?.childPlayerId === child.playerId,
      );
      updateWorldMeter(
        actor.statusMeter,
        child.batteryCharge,
        batteryMeterColor(child.batteryCharge),
      );
      if (actor.statusMeter) actor.statusMeter.root.visible = frame.phase === 'playing';
      if (actor.beam) {
        const visible = child.flashlightOn && frame.phase === 'playing';
        actor.beam.group.visible = visible;
        actor.beam.light.intensity = visible ? FLASHLIGHT_BEAM_INTENSITY : 0;
        actor.beam.mesh.material.uniforms.uOpacity.value = visible ? FLASHLIGHT_BEAM_OPACITY : 0;
        if (visible) {
          const directionX = Math.cos(child.facingRadians);
          const directionZ = Math.sin(child.facingRadians);
          const clippedLength = clippedFlashlightLength(
            {
              x: child.position.x + directionX * FLASHLIGHT_ORIGIN_FORWARD,
              z: child.position.z + directionZ * FLASHLIGHT_ORIGIN_FORWARD,
            },
            child.facingRadians,
            actor.beam.length,
            actor.beam.coneDegrees,
            HOUSE_WALLS,
          );
          updateVisibleBeamLength(
            actor.beam,
            clippedLength < actor.beam.length
              ? Math.max(0.04, clippedLength - FLASHLIGHT_WALL_GAP)
              : actor.beam.length,
          );
        }
      }
    }
    for (const doll of frame.dolls) {
      const actor = this.actor(`doll:${doll.dollId}`, 'doll', doll.slot);
      syncActor(actor, doll.position, 0, doll.headlamp, elapsedSeconds, frame.phase, true, false);
    }
    if (frame.ghost) {
      const actor = this.actor('ghost', 'ghost', 0);
      syncGhostActor(
        actor,
        frame.ghost.position,
        frame.ghost.facingRadians,
        frame.ghost.burning,
        elapsedSeconds,
      );
      actor.body.scale.setScalar(1);
      updateWorldMeter(
        actor.statusMeter,
        frame.ghostHealth / MATCH_RULES.ghostMaxHealth,
        0xd96f5f,
      );
      if (actor.statusMeter) actor.statusMeter.root.visible = frame.phase === 'playing';
      if (actor.ghostRig) poseGhostRig(actor.ghostRig, 0, 0, elapsedSeconds);
    }
    if (frame.capture && frame.ghost) this.applyCapturePresentation(frame);

    for (let index = 0; index < this.batteries.length; index += 1) {
      const visual = this.batteries[index];
      const battery = frame.batteries[index];
      visual.root.visible = Boolean(battery);
      if (!battery) continue;
      visual.root.position.set(
        battery.position.x,
        0.42 + Math.sin(elapsedSeconds * 3) * 0.08,
        battery.position.z,
      );
      visual.root.rotation.y = elapsedSeconds * 1.4 + index * Math.PI;
    }
    this.animateHeadlamps(elapsedSeconds);
  }

  setFlashlightTuning(length: number, coneDegrees: number): void {
    if (length === this.flashlightLength && coneDegrees === this.flashlightConeDegrees) return;
    this.flashlightLength = length;
    this.flashlightConeDegrees = coneDegrees;
    for (const actor of this.actors.values()) {
      if (!actor.beam) continue;
      updateBeamShape(actor.beam, length, coneDegrees);
    }
  }

  metrics(): {
    actors: number;
    walls: number;
    rooms: number;
    beams: number;
    visibleObjects: number;
    materials: number;
    animatedActors: number;
    pendingAssetUpgrades: number;
    assets: ReturnType<typeof importedAssetMetrics>;
  } {
    let visibleObjects = 0;
    const materials = new Set<THREE.Material>();
    this.scene.traverseVisible((object) => {
      visibleObjects += 1;
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) materials.add(material);
    });
    return {
      actors: [...this.actors.values()].filter((actor) => actor.root.visible).length,
      walls: HOUSE_WALLS.length,
      rooms: HOUSE_ROOMS.length,
      beams: [...this.actors.values()].filter((actor) => actor.beam?.group.visible).length,
      visibleObjects,
      materials: materials.size,
      animatedActors: [...this.actors.values()].filter((actor) => actor.root.visible && actor.imported).length,
      pendingAssetUpgrades: this.pendingAssetUpgrades,
      assets: importedAssetMetrics(),
    };
  }

  dispose(): void {
    for (const actor of this.actors.values()) {
      actor.imported?.mixer.stopAllAction();
    }
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Sprite) object.material.map?.dispose();
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
        new THREE.BoxGeometry(wall.maxX - wall.minX, WALL_HEIGHT, wall.maxZ - wall.minZ),
        this.materials.wall,
      );
      mesh.position.set((wall.minX + wall.maxX) / 2, WALL_HEIGHT / 2, (wall.minZ + wall.maxZ) / 2);
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
    this.pendingAssetUpgrades += 1;
    try {
      const importedWalls = await createWallVisuals(HOUSE_WALLS, this.materials.wall, WALL_HEIGHT);
      this.scene.add(importedWalls);
      this.scene.remove(this.fallbackWalls);
      this.fallbackWalls.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      });
    } catch {
      this.fallbackWalls.visible = true;
    } finally {
      this.pendingAssetUpgrades -= 1;
    }
  }

  private actor(id: string, kind: 'child' | 'ghost' | 'doll', slot: number): ActorVisual {
    const existing = this.actors.get(id);
    if (existing) return existing;
    const visual = createActor(
      kind,
      slot,
      this.materials,
      this.flashlightLength,
      this.flashlightConeDegrees,
    );
    this.actors.set(id, visual);
    this.scene.add(visual.root);
    void this.upgradeActor(visual, kind, slot);
    return visual;
  }

  private async upgradeActor(
    actor: ActorVisual,
    kind: 'child' | 'ghost' | 'doll',
    slot: number,
  ): Promise<void> {
    this.pendingAssetUpgrades += 1;
    try {
      const imported = kind === 'ghost'
        ? await createGhostAssetInstance()
        : await createKidAssetInstance(slot, kind === 'doll');
      actor.imported = imported;
      actor.currentAnimation = 'Idle_A';
      if (kind === 'ghost' && actor.ghostRig) {
        actor.ghostRig.fallbackVisual.visible = false;
        actor.ghostRig.leftShoulder.visible = false;
        actor.ghostRig.rightShoulder.visible = false;
        actor.ghostRig.importedMount.add(imported.root);
      } else {
        actor.bodyPivot.remove(actor.body);
        actor.body = imported.root;
        actor.bodyPivot.add(imported.root);
      }
    } catch {
      actor.imported = null;
    } finally {
      this.pendingAssetUpgrades -= 1;
    }
  }

  private animateHeadlamps(elapsedSeconds: number): void {
    for (const actor of this.actors.values()) {
      if (actor.captureProgress !== null) {
        const progress = actor.captureProgress;
        const impact = 1 - smoothstep(clamp01(progress / 0.12));
        const captureSeconds = progress * 2.6;
        const reducedMotion = reducedMotionEnabled();
        const failingFlicker = reducedMotion
          ? 0
          : Math.max(0, Math.sin(captureSeconds * Math.PI * 7.2) - 0.72)
            * (1 - smoothstep(clamp01((progress - 0.1) / 0.5)));
        const strength = Math.min(1, impact * 1.4 + failingFlicker * 1.8);
        actor.lamp.material.color.copy(HEADLAMP_OFF).lerp(HEADLAMP_CAPTURE, strength);
        actor.lamp.scale.setScalar(1 + strength * 1.25);
        actor.lampHalo.visible = strength > 0.04;
        actor.lampHalo.scale.setScalar(0.88 + strength * 1.4);
        actor.lampHalo.material.opacity = strength * 0.88;
        actor.lampLight.color.copy(HEADLAMP_CAPTURE);
        actor.lampLight.intensity = strength * 2.5;
        continue;
      }
      const active = headlampIsLit(actor.headlamp, elapsedSeconds);
      actor.lamp.material.color.copy(active ? HEADLAMP_ON : HEADLAMP_OFF);
      actor.lamp.scale.setScalar(active ? 1.65 : 1);
      actor.lampHalo.visible = active;
      actor.lampHalo.scale.setScalar(active ? 1 + Math.sin(elapsedSeconds * 12) * 0.08 : 1);
      actor.lampHalo.material.opacity = 0.82;
      actor.lampLight.color.copy(HEADLAMP_ON);
      actor.lampLight.intensity = active ? 1.4 : 0;
    }
  }

  private applyCapturePresentation(frame: ViewerFrame): void {
    const capture = frame.capture;
    if (!capture || !frame.ghost) return;
    const ghost = this.actors.get('ghost');
    const child = this.actors.get(`child:${capture.childPlayerId}`);
    if (!ghost?.ghostRig || !child) return;

    const target = frame.children.find((candidate) => candidate.playerId === capture.childPlayerId);
    if (!target) return;
    const facing = Math.atan2(
      target.position.z - frame.ghost.position.z,
      target.position.x - frame.ghost.position.x,
    );
    const progress = clamp01(1 - capture.ticksRemaining / Math.max(1, capture.durationTicks));
    const captureSeconds = progress * capture.durationTicks / 60;
    const reducedMotion = reducedMotionEnabled();
    const motionScale = reducedMotion ? 0.28 : 1;
    const impact = 1 - smoothstep(clamp01(progress / 0.12));
    const seized = smoothstep(clamp01((progress - 0.07) / 0.13));
    const finish = smoothstep(clamp01((progress - 0.78) / 0.22));
    const struggle = seized * (1 - finish * 0.86);
    const grip = smoothstep(clamp01(progress / 0.18));
    const thrash = Math.sin(captureSeconds * 19.5);
    const counterThrash = Math.sin(captureSeconds * 15.7 + 1.2);
    const forwardX = Math.cos(facing);
    const forwardZ = Math.sin(facing);

    ghost.facing.bodyRadians = facing;
    ghost.facing.initialized = true;
    ghost.bodyPivot.rotation.y = -facing;
    const holdDistance = 0.7 - grip * 0.13;
    child.root.position.set(
      frame.ghost.position.x + forwardX * holdDistance,
      0.055 + grip * 0.045 + struggle * thrash * 0.024 * motionScale,
      frame.ghost.position.z + forwardZ * holdDistance,
    );
    child.facing.bodyRadians = facing;
    child.facing.lookRadians = facing;
    child.facing.initialized = true;
    child.bodyPivot.rotation.y = -facing;
    child.bodyPivot.rotation.x = -impact * 0.24 + struggle * counterThrash * 0.075 * motionScale + finish * 0.13;
    child.bodyPivot.rotation.z = struggle * thrash * 0.085 * motionScale;
    child.aimPivot.rotation.y = -facing;
    child.captureProgress = progress;
    playActorAnimation(ghost, 'Idle_A', 0.06);
    if (child.imported) poseCapturedChild(child.imported, impact, struggle, finish, captureSeconds, motionScale);
    if (ghost.imported) poseImportedGhostCapture(ghost.imported, grip, finish, captureSeconds, motionScale);
    poseGhostRig(ghost.ghostRig, grip, progress, captureSeconds, motionScale);
  }
}

function createActor(
  kind: 'child' | 'ghost' | 'doll',
  slot: number,
  materials: HouseMaterialKit,
  flashlightLength: number,
  flashlightConeDegrees: number,
): ActorVisual {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.name = `${kind}-body-facing`;
  const aimPivot = new THREE.Group();
  aimPivot.name = `${kind}-aim-facing`;
  root.add(bodyPivot, aimPivot);
  let body: THREE.Object3D;
  let beam: ActorVisual['beam'] = null;
  let ghostRig: GhostRig | null = null;
  if (kind === 'ghost') {
    const ghost = createGhost(materials);
    body = ghost.root;
    ghostRig = ghost.rig;
    bodyPivot.add(body);
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
    bodyPivot.add(mesh);
    if (kind === 'child') {
      beam = createBeam(flashlightLength, flashlightConeDegrees);
      beam.group.position.set(FLASHLIGHT_ORIGIN_FORWARD, FLASHLIGHT_ORIGIN_HEIGHT, 0);
      beam.group.visible = false;
      aimPivot.add(beam.group);
    }
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 9),
    new THREE.MeshBasicMaterial({ color: HEADLAMP_OFF }),
  );
  lamp.position.set(0, HEADLAMP_HEIGHT, 0);
  lamp.visible = kind !== 'ghost';
  root.add(lamp);
  const lampHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.17, 0.31, 24),
    new THREE.MeshBasicMaterial({
      color: HEADLAMP_ON,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  lampHalo.rotation.x = -Math.PI / 2;
  lampHalo.position.set(0, HEADLAMP_HEIGHT + 0.015, 0);
  lampHalo.visible = false;
  root.add(lampHalo);
  const lampLight = new THREE.PointLight(HEADLAMP_ON, 0, 2.8, 2);
  lampLight.position.set(0, HEADLAMP_HEIGHT, 0);
  lampLight.visible = kind !== 'ghost';
  root.add(lampLight);
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
      opacity: kind === 'doll' ? 0.62 : 0.78,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  root.add(contact);
  const statusMeter = kind === 'doll' ? null : createWorldMeter(kind);
  if (statusMeter) root.add(statusMeter.root);
  return {
    kind,
    root,
    bodyPivot,
    aimPivot,
    body,
    lamp,
    lampHalo,
    lampLight,
    beam,
    headlamp: 'off',
    imported: null,
    currentAnimation: 'Idle_A',
    captureProgress: null,
    lastPosition: null,
    lastUpdateSeconds: 0,
    lampSpin: 0,
    facing: createVisualFacingState(),
    ghostRig,
    statusMeter,
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
  captured: boolean,
): void {
  actor.root.visible = true;
  actor.root.position.set(position.x, 0, position.z);
  actor.aimPivot.rotation.y = -facingRadians;
  actor.headlamp = headlamp;
  if (actor.kind !== 'ghost') {
    updateHeadlampSpin(actor, elapsedSeconds);
  }
  const elapsed = actorDeltaSeconds(actor, elapsedSeconds);
  const lookFacingRadians = advanceChildLookFacing(actor.facing, facingRadians, elapsed);
  if (doll) {
    actor.facing.bodyRadians = 0;
    actor.facing.initialized = true;
  } else if (!captured && phase !== 'capture-animation') {
    advanceChildBodyFacing(
      actor.facing,
      facingRadians,
      movementFacing(actor.lastPosition, position),
      elapsed,
    );
  } else if (!actor.facing.initialized) {
    advanceChildBodyFacing(actor.facing, facingRadians, null, 0);
  }
  actor.bodyPivot.rotation.y = -actor.facing.bodyRadians;
  actor.bodyPivot.rotation.x = 0;
  actor.bodyPivot.rotation.z = 0;
  if (actor.imported) {
    const distance = actor.lastPosition
      ? Math.hypot(position.x - actor.lastPosition.x, position.z - actor.lastPosition.z)
      : 0;
    const nextAnimation = doll
      ? 'Idle_A'
      : captured
        ? 'Hit_A'
        : distance > 0.012
          ? 'Running_A'
          : 'Idle_A';
    playActorAnimation(actor, nextAnimation);
    actor.imported.mixer.update(doll ? 0 : elapsed);
    if (!doll && nextAnimation !== 'Hit_A') {
      applyLookPose(actor.imported, actor.facing.bodyRadians, lookFacingRadians);
    }
  }
  if (actor.lastPosition) {
    actor.lastPosition.x = position.x;
    actor.lastPosition.z = position.z;
  } else {
  actor.lastPosition = { ...position };
  }
  actor.lastUpdateSeconds = elapsedSeconds;
}

function updateHeadlampSpin(actor: ActorVisual, elapsedSeconds: number): void {
  const elapsed = actor.lastUpdateSeconds > 0
    ? Math.min(0.08, Math.max(0, elapsedSeconds - actor.lastUpdateSeconds))
    : 0;
  const spinSpeed = HEADLAMP_SPIN_RADIANS_PER_SECOND[actor.headlamp];
  if (spinSpeed <= 0) {
    actor.lampSpin = 0;
    actor.lamp.rotation.y = 0;
    actor.lampHalo.rotation.z = 0;
    return;
  }
  actor.lampSpin += spinSpeed * elapsed;
  if (actor.lampSpin >= Math.PI * 2) actor.lampSpin -= Math.PI * 2;
  actor.lamp.rotation.y = actor.lampSpin;
  actor.lampHalo.rotation.z = -actor.lampSpin;
}

function syncGhostActor(
  actor: ActorVisual,
  position: Vec2,
  facingRadians: number,
  burning: boolean,
  elapsedSeconds: number,
): void {
  actor.root.visible = true;
  actor.root.position.set(position.x, Math.sin(elapsedSeconds * 2.1) * 0.035, position.z);
  const elapsed = actorDeltaSeconds(actor, elapsedSeconds);
  advanceGhostBodyFacing(actor.facing, facingRadians, elapsed);
  actor.bodyPivot.rotation.y = -actor.facing.bodyRadians;
  const distance = actor.lastPosition
    ? Math.hypot(position.x - actor.lastPosition.x, position.z - actor.lastPosition.z)
    : 0;
  playActorAnimation(actor, burning ? 'Hit_A' : distance > 0.012 ? 'Running_A' : 'Idle_A');
  actor.imported?.mixer.update(elapsed);
  if (actor.ghostRig) applyGhostBurnPresentation(actor.ghostRig, burning, elapsedSeconds);
  if (actor.lastPosition) {
    actor.lastPosition.x = position.x;
    actor.lastPosition.z = position.z;
  } else {
    actor.lastPosition = { ...position };
  }
  actor.lastUpdateSeconds = elapsedSeconds;
}

function playActorAnimation(actor: ActorVisual, nextAnimation: string, fadeSeconds = 0.1): void {
  if (!actor.imported || nextAnimation === actor.currentAnimation) return;
  const previous = actor.imported.actions.get(actor.currentAnimation);
  const next = actor.imported.actions.get(nextAnimation);
  if (!next) return;
  const oneShot = nextAnimation === 'Hit_A';
  next.clampWhenFinished = oneShot;
  next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
  next.reset().play();
  if (previous) next.crossFadeFrom(previous, fadeSeconds, false);
  actor.currentAnimation = nextAnimation;
}

function actorDeltaSeconds(actor: ActorVisual, elapsedSeconds: number): number {
  return actor.lastUpdateSeconds > 0
    ? Math.min(0.08, Math.max(0, elapsedSeconds - actor.lastUpdateSeconds))
    : 0;
}

function applyLookPose(
  imported: CharacterAssetInstance,
  bodyRadians: number,
  aimRadians: number,
): void {
  const look = calculateLookOffsets(bodyRadians, aimRadians);
  applyJointYaw(imported.lookJoints.chest, -look.chestRadians);
  applyJointYaw(imported.lookJoints.head, -look.headRadians);
}

function applyJointYaw(joint: THREE.Object3D | null, radians: number): void {
  if (!joint) return;
  LOOK_ROTATION.setFromAxisAngle(LOOK_UP_AXIS, radians);
  joint.quaternion.premultiply(LOOK_ROTATION);
}

function poseCapturedChild(
  imported: CharacterAssetInstance,
  impact: number,
  struggle: number,
  finish: number,
  captureSeconds: number,
  motionScale: number,
): void {
  const thrash = Math.sin(captureSeconds * 19.5) * struggle * motionScale;
  const counter = Math.sin(captureSeconds * 14.2 + 1.1) * struggle * motionScale;
  const kick = Math.sin(captureSeconds * 23.4 + 0.55) * struggle * motionScale;
  applyJointRotation(imported.joints.chest, -impact * 0.2 + finish * 0.2, thrash * 0.26, counter * 0.12);
  applyJointRotation(imported.joints.head, impact * 0.18 + finish * 0.32, -thrash * 0.48, counter * 0.22);
  applyJointRotation(imported.joints.leftUpperArm, counter * 0.62, -thrash * 0.22, -struggle * 0.36);
  applyJointRotation(imported.joints.rightUpperArm, -counter * 0.62, thrash * 0.22, struggle * 0.36);
  applyJointRotation(imported.joints.leftLowerArm, -struggle * 0.42, 0, thrash * 0.28);
  applyJointRotation(imported.joints.rightLowerArm, -struggle * 0.42, 0, -thrash * 0.28);
  applyJointRotation(imported.joints.leftUpperLeg, kick * 0.48, 0, -counter * 0.12);
  applyJointRotation(imported.joints.rightUpperLeg, -kick * 0.48, 0, counter * 0.12);
  applyJointRotation(imported.joints.leftLowerLeg, Math.max(0, -kick) * 0.42, 0, 0);
  applyJointRotation(imported.joints.rightLowerLeg, Math.max(0, kick) * 0.42, 0, 0);
}

function poseImportedGhostCapture(
  imported: CharacterAssetInstance,
  grip: number,
  finish: number,
  captureSeconds: number,
  motionScale: number,
): void {
  const tightening = grip * (0.86 + finish * 0.14);
  const breath = Math.sin(captureSeconds * 6.4) * 0.035 * motionScale * (1 - finish);
  applyJointRotation(imported.joints.chest, 0.08 * tightening, breath, -0.06 * tightening);
  applyJointRotation(imported.joints.head, 0.08 * tightening + finish * 0.2, 0.04 * tightening, -0.24 * tightening);
  applyJointRotation(imported.joints.leftUpperArm, 0.58 * tightening, 0.08, -0.42 * tightening);
  applyJointRotation(imported.joints.rightUpperArm, -0.58 * tightening, -0.08, 0.42 * tightening);
  applyJointRotation(imported.joints.leftLowerArm, 0.5 * tightening, 0, -0.24 * tightening);
  applyJointRotation(imported.joints.rightLowerArm, -0.5 * tightening, 0, 0.24 * tightening);
}

function applyJointRotation(
  joint: THREE.Object3D | null,
  xRadians: number,
  yRadians: number,
  zRadians: number,
): void {
  if (!joint) return;
  joint.rotateX(xRadians);
  joint.rotateY(yRadians);
  joint.rotateZ(zRadians);
}

function createGhost(materials: HouseMaterialKit): { root: THREE.Group; rig: GhostRig } {
  const ghost = new THREE.Group();
  ghost.name = 'hybrid-spectral-ghost';
  const fallbackVisual = new THREE.Group();
  fallbackVisual.name = 'procedural-footless-ghost-fallback';
  const importedMount = new THREE.Group();
  importedMount.name = 'kaykit-ghost-mount';
  importedMount.position.y = 0.025;
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
  const leftArm = createGhostArm(materials, -1);
  const rightArm = createGhostArm(materials, 1);
  const captureAura = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.72, 32),
    new THREE.MeshBasicMaterial({
      color: 0xc7d5ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  captureAura.rotation.x = -Math.PI / 2;
  captureAura.position.y = 0.035;
  const captureVeil = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0x03040a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  captureVeil.position.set(0.24, 0.82, 0);
  captureVeil.scale.set(1.35, 1.25, 1.05);
  captureVeil.visible = false;
  const captureLight = new THREE.PointLight(0xaebfff, 0, 3.2, 2);
  captureLight.position.set(0.4, 0.9, 0);
  const burnAura = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  burnAura.position.y = 0.5;
  burnAura.scale.y = 1.16;
  burnAura.visible = false;
  const burnLight = new THREE.PointLight(0xff5a18, 0, 4.2, 2);
  burnLight.position.y = 0.72;
  fallbackVisual.add(leftArm.shoulder, rightArm.shoulder, hood, robe, collar, leftEye, rightEye);
  ghost.add(fallbackVisual, importedMount, captureAura, captureVeil, captureLight, burnAura, burnLight);
  return {
    root: ghost,
    rig: {
      fallbackVisual,
      importedMount,
      leftShoulder: leftArm.shoulder,
      rightShoulder: rightArm.shoulder,
      leftElbow: leftArm.elbow,
      rightElbow: rightArm.elbow,
      captureAura,
      captureVeil,
      captureLight,
      burnAura,
      burnLight,
    },
  };
}

function createGhostArm(
  materials: HouseMaterialKit,
  side: -1 | 1,
): { shoulder: THREE.Group; elbow: THREE.Group } {
  const shoulder = new THREE.Group();
  shoulder.position.set(0.05, 0.73, side * 0.44);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.28, 4, 8), materials.ghostTrim);
  upper.position.y = -0.22;
  upper.castShadow = true;
  const elbow = new THREE.Group();
  elbow.position.y = -0.44;
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), materials.ghostTrim);
  forearm.position.y = -0.19;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 7), materials.ghostTrim);
  hand.scale.set(1.25, 0.8, 1);
  hand.position.y = -0.4;
  elbow.add(forearm, hand);
  shoulder.add(upper, elbow);
  return { shoulder, elbow };
}

function poseGhostRig(
  rig: GhostRig,
  grip: number,
  progress: number,
  animationSeconds: number,
  motionScale = 1,
): void {
  const impact = 1 - smoothstep(clamp01(progress / 0.12));
  const finish = smoothstep(clamp01((progress - 0.78) / 0.22));
  const pulse = 1 + Math.sin(animationSeconds * 12) * 0.04 * motionScale * (1 - finish);
  const armGrip = grip * (1 + finish * 0.12);
  rig.leftShoulder.rotation.set(0.46 * armGrip, 0, 1.36 * armGrip - 0.08);
  rig.rightShoulder.rotation.set(-0.46 * armGrip, 0, 1.36 * armGrip + 0.08);
  rig.leftElbow.rotation.set(0.72 * armGrip, 0, 0.56 * armGrip);
  rig.rightElbow.rotation.set(-0.72 * armGrip, 0, 0.56 * armGrip);
  rig.captureAura.visible = grip > 0.01;
  rig.captureAura.scale.setScalar((0.9 + impact * 1.8 + grip * 1.05 - finish * 0.48) * pulse);
  rig.captureAura.material.opacity = grip * (0.14 + impact * 0.62 + (1 - finish) * 0.2);
  rig.captureVeil.visible = grip > 0.04;
  rig.captureVeil.material.opacity = grip * (0.025 + finish * 0.13);
  rig.captureVeil.scale.set(
    1.35 - finish * 0.14,
    1.25 - finish * 0.1,
    1.05 - finish * 0.08,
  );
  rig.captureLight.intensity = grip * (1.15 + impact * 3.8 + (1 - finish) * 0.35 * pulse);
}

function applyGhostBurnPresentation(rig: GhostRig, burning: boolean, elapsedSeconds: number): void {
  rig.burnAura.visible = burning;
  rig.burnAura.material.opacity = burning ? 0.16 + Math.sin(elapsedSeconds * 18) * 0.055 : 0;
  const pulse = 1 + Math.sin(elapsedSeconds * 13) * 0.07;
  rig.burnAura.scale.set(pulse, 1.16 * pulse, pulse);
  rig.burnLight.intensity = burning ? 2.1 + Math.sin(elapsedSeconds * 21) * 0.45 : 0;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function reducedMotionEnabled(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true') {
    return true;
  }
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createWorldMeter(kind: 'child' | 'ghost'): WorldMeter {
  const root = new THREE.Group();
  root.name = `${kind}-status-meter`;
  root.position.y = kind === 'ghost' ? 2.05 : 1.82;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 20;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('World meter requires a 2D canvas context.');
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${kind}-status-meter-texture`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.NearestFilter;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.name = `${kind}-status-meter-sprite`;
  sprite.scale.set(1.08, 0.17, 1);
  sprite.renderOrder = 40;
  root.add(sprite);

  const meter: WorldMeter = {
    root,
    context,
    texture,
    lastPercent: -1,
    lastColor: -1,
  };
  updateWorldMeter(meter, 1, kind === 'ghost' ? 0xd96f5f : 0xe6c965);
  return meter;
}

function updateWorldMeter(meter: WorldMeter | null, value: number, color: number): void {
  if (!meter) return;
  const ratio = clamp01(value);
  const percent = Math.round(ratio * 100);
  if (meter.lastPercent === percent && meter.lastColor === color) return;

  const { context } = meter;
  context.clearRect(0, 0, 128, 20);
  context.fillStyle = 'rgba(199, 208, 223, 0.82)';
  context.fillRect(0, 2, 128, 16);
  context.fillStyle = 'rgba(7, 9, 13, 0.96)';
  context.fillRect(2, 4, 124, 12);
  const fillWidth = Math.round(120 * ratio);
  if (fillWidth > 0) {
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.fillRect(4, 6, fillWidth, 8);
    context.fillStyle = 'rgba(255, 255, 255, 0.24)';
    context.fillRect(4, 6, fillWidth, 2);
  }
  meter.texture.needsUpdate = true;
  meter.lastPercent = percent;
  meter.lastColor = color;
}

function batteryMeterColor(charge: number): number {
  if (charge < MATCH_RULES.batteryDoubleSpawnThreshold) return 0xd96f5f;
  if (charge < MATCH_RULES.batterySpawnThreshold) return 0xe6a65b;
  return 0xe6c965;
}

function createBeam(length: number, coneDegrees: number): BeamVisual {
  const mesh = new THREE.Mesh(
    createBeamGeometry(length, coneDegrees),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffde96) },
        uOpacity: { value: 0.26 },
      },
      vertexShader: `
        varying vec2 vBeamUv;

        void main() {
          vBeamUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vBeamUv;

        void main() {
          float distanceRatio = 1.0 - vBeamUv.y;
          float nearFade = smoothstep(0.0, 0.06, distanceRatio);
          float distanceFade = 1.0 - smoothstep(0.5, 1.0, distanceRatio);
          float density = nearFade * distanceFade * (0.5 + 0.5 * distanceFade);
          gl_FragColor = vec4(uColor, uOpacity * density);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const light = new THREE.SpotLight(
    0xffe4a0,
    1.1,
    length,
    Math.max(0.03, THREE.MathUtils.degToRad(coneDegrees * 0.45)),
    0.7,
    1.3,
  );
  light.castShadow = false;
  light.position.set(0, 0, 0);
  light.target.position.set(length, 0, 0);
  const group = new THREE.Group();
  group.add(mesh, light, light.target);
  return { group, mesh, light, length, coneDegrees };
}

function createBeamGeometry(length: number, coneDegrees: number): THREE.CylinderGeometry {
  const halfWidth = Math.tan((coneDegrees * Math.PI) / 360) * length;
  const startRadius = Math.max(0.025, halfWidth * 0.08);
  const coneGeometry = new THREE.CylinderGeometry(Math.max(halfWidth, 0.09), startRadius, length, 20, 1, true);
  coneGeometry.rotateZ(-Math.PI / 2);
  coneGeometry.translate(length / 2, 0, 0);
  return coneGeometry;
}

function updateVisibleBeamLength(beam: BeamVisual, visibleLength: number): void {
  const clampedLength = Math.max(0.04, Math.min(beam.length, visibleLength));
  beam.mesh.scale.setScalar(clampedLength / beam.length);
  beam.light.distance = clampedLength;
  beam.light.target.position.x = clampedLength;
  beam.light.target.updateMatrixWorld();
}

function updateBeamShape(beam: BeamVisual, length: number, coneDegrees: number): void {
  beam.length = length;
  beam.coneDegrees = coneDegrees;
  beam.mesh.geometry.dispose();
  beam.mesh.geometry = createBeamGeometry(length, coneDegrees);
  beam.mesh.scale.setScalar(1);
  beam.light.distance = length;
  beam.light.angle = Math.max(0.03, THREE.MathUtils.degToRad(coneDegrees * 0.45));
  beam.light.target.position.set(length, 0, 0);
  beam.light.target.updateMatrixWorld();
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
  if (band === 'fast') return (elapsedSeconds * 2.8) % 1 < 0.48;
  if (band === 'slow') return (elapsedSeconds * 1.05) % 1 < 0.38;
  return false;
}
