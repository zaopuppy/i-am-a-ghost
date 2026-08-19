import type { MatchMap, Vec2 } from './MatchEngine';
import {
  circleIntersectsAxisAlignedRect,
  circleIntersectsOrientedRect,
  orientedRectBounds,
  orientedRectsOverlap,
  type AxisAlignedRect,
  type OrientedRect,
} from './CollisionGeometry';

export const HOUSE_SCENE_VERSION = 1 as const;
export const HOUSE_SCENE_PLAYER_RADIUS = 0.45;
const DOOR_CLEARANCE_DEPTH = 1.25;
const CONNECTIVITY_GRID_SIZE = 0.4;
const ROOM_BOUNDS_EPSILON = 1e-6;

export const FURNITURE_ASSET_IDS = [
  'armchair_pillows',
  'bed_double_A',
  'bed_single_A',
  'cabinet_medium_decorated',
  'chair_A_wood',
  'couch_pillows',
  'lamp_standing',
  'lamp_table',
  'pictureframe_standing_A',
  'rug_oval_A',
  'rug_rectangle_A',
  'rug_rectangle_stripes_A',
  'shelf_B_large_decorated',
  'table_low',
  'table_medium',
  'table_medium_long',
  'table_small',
] as const;

export type FurnitureAssetId = typeof FURNITURE_ASSET_IDS[number];
export type RoomFamily = 'living' | 'sleep' | 'old';

export interface FurnitureAssetDefinition {
  id: FurnitureAssetId;
  label: string;
  modelSize: { width: number; height: number; depth: number };
  collider: { width: number; depth: number } | null;
}

export const FURNITURE_CATALOG: Readonly<Record<FurnitureAssetId, FurnitureAssetDefinition>> = {
  armchair_pillows: furniture('armchair_pillows', '软垫扶手椅', 1.8, 1.224, 1.6, 1.55, 1.35),
  bed_double_A: furniture('bed_double_A', '双人床', 3.1, 1, 3, 2.8, 2.7),
  bed_single_A: furniture('bed_single_A', '单人床', 1.6, 1, 3, 1.4, 2.7),
  cabinet_medium_decorated: furniture(
    'cabinet_medium_decorated',
    '装饰柜',
    2.042,
    1.827,
    1.002,
    1.8,
    0.82,
  ),
  chair_A_wood: furniture('chair_A_wood', '木椅', 0.75, 1.258, 0.845, 0.62, 0.7),
  couch_pillows: furniture('couch_pillows', '软垫沙发', 3, 1.224, 1.6, 2.72, 1.32),
  lamp_standing: furniture('lamp_standing', '落地灯', 1, 2.52, 1, null),
  lamp_table: furniture('lamp_table', '台灯', 1, 1.022, 1, null),
  pictureframe_standing_A: furniture('pictureframe_standing_A', '立式画框', 0.5, 0.619, 0.379, null),
  rug_oval_A: furniture('rug_oval_A', '椭圆地毯', 3, 0.1, 2, null),
  rug_rectangle_A: furniture('rug_rectangle_A', '矩形地毯', 3, 0.1, 2, null),
  rug_rectangle_stripes_A: furniture('rug_rectangle_stripes_A', '条纹地毯', 3, 0.1, 2, null),
  shelf_B_large_decorated: furniture(
    'shelf_B_large_decorated',
    '装饰矮书架',
    2,
    0.818,
    0.5,
    1.82,
    0.42,
  ),
  table_low: furniture('table_low', '矮桌', 2.4, 0.5, 1.5, 2.1, 1.22),
  table_medium: furniture('table_medium', '方桌', 2, 1, 2, 1.72, 1.72),
  table_medium_long: furniture('table_medium_long', '长桌', 3, 1, 2, 2.68, 1.68),
  table_small: furniture('table_small', '小桌', 1, 1, 1, 0.82, 0.82),
};

export interface HouseRoomDefinition {
  id: string;
  name: string;
  family: RoomFamily;
  center: Vec2;
  width: number;
  depth: number;
}

export interface FurniturePlacement {
  id: string;
  roomId: string;
  asset: FurnitureAssetId;
  offsetX: number;
  offsetZ: number;
  yawRadians?: number;
  scale?: number;
  elevation?: number;
}

export interface HouseSceneDefinition {
  version: typeof HOUSE_SCENE_VERSION;
  id: string;
  bounds: MatchMap['bounds'];
  walls: AxisAlignedRect[];
  rooms: HouseRoomDefinition[];
  furniture: FurniturePlacement[];
  ghostSpawn: Vec2;
  childSpawns: [Vec2, Vec2, Vec2, Vec2];
  batterySpawns: Vec2[];
}

export interface HouseOpening extends AxisAlignedRect {
  axis: 'x' | 'z';
}

export interface ResolvedFurniturePlacement extends FurniturePlacement {
  position: Vec2;
  yawRadians: number;
  scale: number;
  elevation: number;
  collider: OrientedRect | null;
}

export interface HouseSceneIssue {
  severity: 'error' | 'warning';
  code:
    | 'duplicate-id'
    | 'unknown-room'
    | 'unknown-asset'
    | 'outside-room'
    | 'door-blocked'
    | 'spawn-blocked'
    | 'battery-blocked'
    | 'furniture-overlap'
    | 'disconnected-map';
  subjectId: string;
  message: string;
}

export interface CompiledHouseScene {
  definition: HouseSceneDefinition;
  map: MatchMap;
  rooms: readonly HouseRoomDefinition[];
  openings: readonly HouseOpening[];
  furniture: readonly ResolvedFurniturePlacement[];
  doorClearances: readonly OrientedRect[];
  issues: readonly HouseSceneIssue[];
}

export function compileHouseScene(source: HouseSceneDefinition): CompiledHouseScene {
  const definition = cloneHouseScene(source);
  const issues: HouseSceneIssue[] = [];
  const roomsById = new Map(definition.rooms.map((room) => [room.id, room]));
  collectDuplicateIds(definition, issues);
  const furniture = definition.furniture.flatMap((placement): ResolvedFurniturePlacement[] => {
    const room = roomsById.get(placement.roomId);
    if (!room) {
      issues.push(issue('error', 'unknown-room', placement.id, `家具 ${placement.id} 指向不存在的房间。`));
      return [];
    }
    const asset = FURNITURE_CATALOG[placement.asset];
    if (!asset) {
      issues.push(issue('error', 'unknown-asset', placement.id, `家具 ${placement.id} 使用了未知模型。`));
      return [];
    }
    const scale = placement.scale ?? 1;
    const yawRadians = normalizeYaw(placement.yawRadians ?? 0);
    const position = {
      x: room.center.x + placement.offsetX,
      z: room.center.z + placement.offsetZ,
    };
    const collider = asset.collider
      ? {
          id: `furniture:${placement.id}`,
          center: position,
          halfWidth: asset.collider.width * scale * 0.5,
          halfDepth: asset.collider.depth * scale * 0.5,
          yawRadians,
        }
      : null;
    return [{
      ...placement,
      position,
      yawRadians,
      scale,
      elevation: placement.elevation ?? 0.012,
      collider,
    }];
  });
  const openings = deriveHouseOpenings(definition.walls);
  const doorClearances = openings.map(doorClearanceForOpening);
  validatePlacements(definition, furniture, roomsById, doorClearances, issues);
  const movementObstacles = furniture.flatMap((placement) => placement.collider ? [placement.collider] : []);
  const map: MatchMap = {
    id: definition.id,
    bounds: { ...definition.bounds },
    walls: definition.walls.map((wall) => ({ ...wall })),
    movementObstacles,
    ghostSpawn: { ...definition.ghostSpawn },
    childSpawns: [
      { ...definition.childSpawns[0] },
      { ...definition.childSpawns[1] },
      { ...definition.childSpawns[2] },
      { ...definition.childSpawns[3] },
    ],
    batterySpawns: definition.batterySpawns.map((spawn) => ({ ...spawn })),
  };
  if (!allProtectedPointsConnected(map)) {
    issues.push(issue('error', 'disconnected-map', definition.id, '出生点或电池点之间不存在可通行路径。'));
  }
  return {
    definition,
    map,
    rooms: definition.rooms,
    openings,
    furniture,
    doorClearances,
    issues,
  };
}

export function cloneHouseScene(source: HouseSceneDefinition): HouseSceneDefinition {
  return structuredClone(source);
}

export function deriveHouseOpenings(
  walls: readonly AxisAlignedRect[],
  gapMin = 0.9,
  gapMax = 2.6,
): HouseOpening[] {
  const vertical = new Map<string, AxisAlignedRect[]>();
  const horizontal = new Map<string, AxisAlignedRect[]>();
  for (const wall of walls) {
    const width = wall.maxX - wall.minX;
    const depth = wall.maxZ - wall.minZ;
    const groups = width <= depth ? vertical : horizontal;
    const key = ((width <= depth
      ? wall.minX + wall.maxX
      : wall.minZ + wall.maxZ) / 2).toFixed(1);
    const group = groups.get(key) ?? [];
    group.push(wall);
    groups.set(key, group);
  }

  const openings: HouseOpening[] = [];
  for (const [key, group] of vertical) {
    const ordered = [...group].sort((left, right) => left.minZ - right.minZ);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index].maxZ;
      const end = ordered[index + 1].minZ;
      const gap = end - start;
      if (gap < gapMin || gap > gapMax) continue;
      openings.push({
        id: `opening-x-${key}-${start.toFixed(1)}`,
        axis: 'x',
        minX: Math.min(ordered[index].minX, ordered[index + 1].minX),
        maxX: Math.max(ordered[index].maxX, ordered[index + 1].maxX),
        minZ: start,
        maxZ: end,
      });
    }
  }
  for (const [key, group] of horizontal) {
    const ordered = [...group].sort((left, right) => left.minX - right.minX);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index].maxX;
      const end = ordered[index + 1].minX;
      const gap = end - start;
      if (gap < gapMin || gap > gapMax) continue;
      openings.push({
        id: `opening-z-${key}-${start.toFixed(1)}`,
        axis: 'z',
        minX: start,
        maxX: end,
        minZ: Math.min(ordered[index].minZ, ordered[index + 1].minZ),
        maxZ: Math.max(ordered[index].maxZ, ordered[index + 1].maxZ),
      });
    }
  }
  return openings;
}

function furniture(
  id: FurnitureAssetId,
  label: string,
  width: number,
  height: number,
  depth: number,
  colliderWidth: number | null,
  colliderDepth?: number,
): FurnitureAssetDefinition {
  return {
    id,
    label,
    modelSize: { width, height, depth },
    collider: colliderWidth === null || colliderDepth === undefined
      ? null
      : { width: colliderWidth, depth: colliderDepth },
  };
}

function validatePlacements(
  definition: HouseSceneDefinition,
  furniture: readonly ResolvedFurniturePlacement[],
  roomsById: ReadonlyMap<string, HouseRoomDefinition>,
  doorClearances: readonly OrientedRect[],
  issues: HouseSceneIssue[],
): void {
  for (const placement of furniture) {
    if (!placement.collider) continue;
    const room = roomsById.get(placement.roomId);
    if (!room) continue;
    const bounds = orientedRectBounds(placement.collider);
    if (
      bounds.minX < room.center.x - room.width / 2 - ROOM_BOUNDS_EPSILON
      || bounds.maxX > room.center.x + room.width / 2 + ROOM_BOUNDS_EPSILON
      || bounds.minZ < room.center.z - room.depth / 2 - ROOM_BOUNDS_EPSILON
      || bounds.maxZ > room.center.z + room.depth / 2 + ROOM_BOUNDS_EPSILON
    ) {
      issues.push(issue('error', 'outside-room', placement.id, `家具 ${placement.id} 超出了所属房间。`));
    }
    if (doorClearances.some((clearance) => orientedRectsOverlap(placement.collider!, clearance))) {
      issues.push(issue('error', 'door-blocked', placement.id, `家具 ${placement.id} 侵入门洞安全区。`));
    }
    const spawn = [definition.ghostSpawn, ...definition.childSpawns].find((point) =>
      circleIntersectsOrientedRect(point, HOUSE_SCENE_PLAYER_RADIUS * 1.5, placement.collider!),
    );
    if (spawn) {
      issues.push(issue('error', 'spawn-blocked', placement.id, `家具 ${placement.id} 阻挡了角色出生点。`));
    }
    const battery = definition.batterySpawns.find((point) =>
      circleIntersectsOrientedRect(point, HOUSE_SCENE_PLAYER_RADIUS, placement.collider!),
    );
    if (battery) {
      issues.push(issue('error', 'battery-blocked', placement.id, `家具 ${placement.id} 覆盖了电池刷新点。`));
    }
  }
  for (let leftIndex = 0; leftIndex < furniture.length; leftIndex += 1) {
    const left = furniture[leftIndex];
    if (!left.collider) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < furniture.length; rightIndex += 1) {
      const right = furniture[rightIndex];
      if (!right.collider || left.roomId !== right.roomId) continue;
      if (!orientedRectsOverlap(left.collider, right.collider)) continue;
      issues.push(issue(
        'warning',
        'furniture-overlap',
        left.id,
        `家具 ${left.id} 与 ${right.id} 的碰撞脚印重叠。`,
      ));
    }
  }
}

function collectDuplicateIds(definition: HouseSceneDefinition, issues: HouseSceneIssue[]): void {
  for (const [kind, entries] of [
    ['墙', definition.walls],
    ['房间', definition.rooms],
    ['家具', definition.furniture],
  ] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id)) {
        issues.push(issue('error', 'duplicate-id', entry.id, `${kind} ID ${entry.id} 重复。`));
      }
      seen.add(entry.id);
    }
  }
}

function doorClearanceForOpening(opening: HouseOpening): OrientedRect {
  const width = opening.maxX - opening.minX;
  const depth = opening.maxZ - opening.minZ;
  return {
    id: `clearance:${opening.id}`,
    center: {
      x: (opening.minX + opening.maxX) / 2,
      z: (opening.minZ + opening.maxZ) / 2,
    },
    halfWidth: opening.axis === 'x' ? DOOR_CLEARANCE_DEPTH : width / 2,
    halfDepth: opening.axis === 'x' ? depth / 2 : DOOR_CLEARANCE_DEPTH,
    yawRadians: 0,
  };
}

function allProtectedPointsConnected(map: MatchMap): boolean {
  const protectedPoints = [map.ghostSpawn, ...map.childSpawns, ...map.batterySpawns];
  const columns = Math.floor((map.bounds.maxX - map.bounds.minX) / CONNECTIVITY_GRID_SIZE) + 1;
  const rows = Math.floor((map.bounds.maxZ - map.bounds.minZ) / CONNECTIVITY_GRID_SIZE) + 1;
  const open = new Uint8Array(columns * rows);
  const indexFor = (column: number, row: number): number => row * columns + column;
  const positionFor = (column: number, row: number): Vec2 => ({
    x: map.bounds.minX + column * CONNECTIVITY_GRID_SIZE,
    z: map.bounds.minZ + row * CONNECTIVITY_GRID_SIZE,
  });
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (positionIsOpen(positionFor(column, row), map)) open[indexFor(column, row)] = 1;
    }
  }
  const pointCell = (point: Vec2): number | null => {
    const originColumn = Math.round((point.x - map.bounds.minX) / CONNECTIVITY_GRID_SIZE);
    const originRow = Math.round((point.z - map.bounds.minZ) / CONNECTIVITY_GRID_SIZE);
    for (let radius = 0; radius <= 3; radius += 1) {
      for (let row = originRow - radius; row <= originRow + radius; row += 1) {
        for (let column = originColumn - radius; column <= originColumn + radius; column += 1) {
          if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
          const index = indexFor(column, row);
          if (open[index]) return index;
        }
      }
    }
    return null;
  };
  const targetCells = protectedPoints.map(pointCell);
  const first = targetCells[0];
  if (first === null || targetCells.some((cell) => cell === null)) return false;
  const visited = new Uint8Array(open.length);
  const queue = new Int32Array(open.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = first;
  visited[first] = 1;
  while (head < tail) {
    const index = queue[head++];
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [nextColumn, nextRow] of [
      [column - 1, row],
      [column + 1, row],
      [column, row - 1],
      [column, row + 1],
    ]) {
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
      const next = indexFor(nextColumn, nextRow);
      if (!open[next] || visited[next]) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  return targetCells.every((cell) => cell !== null && visited[cell] === 1);
}

function positionIsOpen(position: Vec2, map: MatchMap): boolean {
  const radius = HOUSE_SCENE_PLAYER_RADIUS;
  if (
    position.x - radius < map.bounds.minX
    || position.x + radius > map.bounds.maxX
    || position.z - radius < map.bounds.minZ
    || position.z + radius > map.bounds.maxZ
  ) return false;
  if (map.walls.some((wall) => circleIntersectsAxisAlignedRect(position, radius, wall))) return false;
  return !(map.movementObstacles ?? []).some((obstacle) =>
    circleIntersectsOrientedRect(position, radius, obstacle),
  );
}

function normalizeYaw(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function issue(
  severity: HouseSceneIssue['severity'],
  code: HouseSceneIssue['code'],
  subjectId: string,
  message: string,
): HouseSceneIssue {
  return { severity, code, subjectId, message };
}
