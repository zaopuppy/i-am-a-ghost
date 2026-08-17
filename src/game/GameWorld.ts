import * as THREE from 'three';
import { DEFAULT_HOUSE_MAP, HOUSE_ROOMS } from './defaultHouse';
import type { HeadlampBand } from './MatchEngine';
import type { ViewerFrame } from './ViewerFrame';

const CHILD_COLORS = [0xf1a65a, 0x72c6c8, 0xd77aa6, 0x9ecb72] as const;
const HEADLAMP_OFF = new THREE.Color(0x3b3025);
const HEADLAMP_ON = new THREE.Color(0xffd36b);

interface ActorVisual {
  root: THREE.Group;
  body: THREE.Object3D;
  lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  headlamp: HeadlampBand;
}

export class GameWorld {
  readonly scene = new THREE.Scene();
  private readonly actors = new Map<string, ActorVisual>();
  private readonly battery = createBattery();

  constructor() {
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x050608, 0.022);
    this.scene.add(new THREE.HemisphereLight(0x66708c, 0x08090b, 0.82));
    const moon = new THREE.DirectionalLight(0x9aa6cb, 1.8);
    moon.position.set(-10, 18, 7);
    this.scene.add(moon);
    this.buildHouse();
    this.battery.root.visible = false;
    this.scene.add(this.battery.root);
  }

  sync(frame: ViewerFrame | null, elapsedSeconds: number): void {
    for (const actor of this.actors.values()) actor.root.visible = false;
    if (!frame) return;

    for (const child of frame.children) {
      const actor = this.actor(`child:${child.playerId}`, 'child', child.slot);
      actor.root.visible = true;
      actor.root.position.set(child.position.x, 0, child.position.z);
      actor.root.rotation.y = -child.facingRadians;
      actor.headlamp = child.headlamp;
      if (actor.beam) actor.beam.visible = child.flashlightOn;
    }
    for (const doll of frame.dolls) {
      const actor = this.actor(`doll:${doll.dollId}`, 'doll', doll.slot);
      actor.root.visible = true;
      actor.root.position.set(doll.position.x, 0, doll.position.z);
      actor.headlamp = doll.headlamp;
    }
    if (frame.ghost) {
      const actor = this.actor('ghost', 'ghost', 0);
      actor.root.visible = true;
      actor.root.position.set(frame.ghost.position.x, 0, frame.ghost.position.z);
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

  metrics(): { actors: number; walls: number; rooms: number; beams: number } {
    return {
      actors: [...this.actors.values()].filter((actor) => actor.root.visible).length,
      walls: DEFAULT_HOUSE_MAP.walls.length + 4,
      rooms: HOUSE_ROOMS.length,
      beams: [...this.actors.values()].filter((actor) => actor.beam?.visible).length,
    };
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }

  private buildHouse(): void {
    const width = DEFAULT_HOUSE_MAP.bounds.maxX - DEFAULT_HOUSE_MAP.bounds.minX;
    const depth = DEFAULT_HOUSE_MAP.bounds.maxZ - DEFAULT_HOUSE_MAP.bounds.minZ;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.98 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    this.scene.add(floor);

    const roomMaterial = new THREE.MeshBasicMaterial({ color: 0x111319, transparent: true, opacity: 0.56 });
    for (const [index, room] of HOUSE_ROOMS.entries()) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(9.3, 5.8), roomMaterial.clone());
      (tile.material as THREE.MeshBasicMaterial).color.offsetHSL(0, 0, index % 2 ? 0.008 : -0.008);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(room.center.x, 0.005, room.center.z);
      this.scene.add(tile);
    }

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x343945,
      emissive: 0x11131a,
      emissiveIntensity: 0.55,
      roughness: 0.78,
    });
    const walls = [
      ...DEFAULT_HOUSE_MAP.walls,
      { id: 'north-boundary', minX: -16.2, maxX: 16.2, minZ: 9.8, maxZ: 10.2 },
      { id: 'south-boundary', minX: -16.2, maxX: 16.2, minZ: -10.2, maxZ: -9.8 },
      { id: 'west-boundary', minX: -16.2, maxX: -15.8, minZ: -10, maxZ: 10 },
      { id: 'east-boundary', minX: 15.8, maxX: 16.2, minZ: -10, maxZ: 10 },
    ];
    for (const wall of walls) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.maxX - wall.minX, 0.72, wall.maxZ - wall.minZ),
        wallMaterial,
      );
      mesh.position.set((wall.minX + wall.maxX) / 2, 0.36, (wall.minZ + wall.maxZ) / 2);
      this.scene.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x81899a, transparent: true, opacity: 0.32 }),
      );
      edges.position.copy(mesh.position);
      this.scene.add(edges);
    }
  }

  private actor(id: string, kind: 'child' | 'ghost' | 'doll', slot: number): ActorVisual {
    const existing = this.actors.get(id);
    if (existing) return existing;
    const visual = createActor(kind, slot);
    this.actors.set(id, visual);
    this.scene.add(visual.root);
    return visual;
  }

  private animateHeadlamps(elapsedSeconds: number): void {
    for (const actor of this.actors.values()) {
      const active = headlampIsLit(actor.headlamp, elapsedSeconds);
      actor.lamp.material.color.copy(active ? HEADLAMP_ON : HEADLAMP_OFF);
      actor.lamp.scale.setScalar(active ? 1.35 : 1);
    }
  }
}

function createActor(kind: 'child' | 'ghost' | 'doll', slot: number): ActorVisual {
  const root = new THREE.Group();
  let body: THREE.Object3D;
  let beam: ActorVisual['beam'] = null;
  if (kind === 'ghost') {
    const ghost = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0xcbd1de, emissive: 0x4e5871, emissiveIntensity: 0.8, roughness: 0.3 }),
    );
    head.position.y = 0.85;
    const robe = new THREE.Mesh(
      new THREE.ConeGeometry(0.58, 1.05, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x8b93a8, emissive: 0x242a3c, emissiveIntensity: 0.7, roughness: 0.62 }),
    );
    robe.position.y = 0.42;
    ghost.add(head, robe);
    body = ghost;
    root.add(ghost);
  } else {
    const color = kind === 'doll' ? 0x655849 : CHILD_COLORS[slot % CHILD_COLORS.length];
    const mesh = new THREE.Mesh(
      kind === 'doll'
        ? new THREE.BoxGeometry(0.62, 0.82, 0.62)
        : new THREE.CapsuleGeometry(0.31, 0.48, 5, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: kind === 'doll' ? 0.08 : 0.24, roughness: 0.68 }),
    );
    mesh.position.y = 0.51;
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
  return { root, body, lamp, beam, headlamp: 'off' };
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

function createBattery(): { root: THREE.Group } {
  const root = new THREE.Group();
  const cell = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.62, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xe5ca65, emissive: 0x81661c, emissiveIntensity: 1.6, roughness: 0.3 }),
  );
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffeb9b }),
  );
  cap.position.y = 0.36;
  root.add(cell, cap);
  return { root };
}

function headlampIsLit(band: HeadlampBand, elapsedSeconds: number): boolean {
  if (band === 'solid') return true;
  if (band === 'fast') return Math.sin(elapsedSeconds * Math.PI * 8) > -0.1;
  if (band === 'slow') return Math.sin(elapsedSeconds * Math.PI * 2.4) > 0.35;
  return false;
}
