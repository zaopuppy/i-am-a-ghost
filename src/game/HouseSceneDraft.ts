import {
  cloneHouseScene,
  isHouseSceneDefinition,
  type HouseSceneDefinition,
} from './HouseScene';
import { DEFAULT_HOUSE_SCENE } from './defaultHouseScene';

export const HOUSE_SCENE_DRAFT_STORAGE_KEY = 'i-am-a-ghost:house-scene-draft:v1';

const LEGACY_DEFAULT_ROOM_WIDTH = 9.3;
const LEGACY_DEFAULT_ROOM_DEPTH = 5.8;

export interface HouseSceneDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function serializeHouseScene(scene: HouseSceneDefinition): string {
  return JSON.stringify(scene, null, 2);
}

export function loadHouseSceneDraft(
  storage: HouseSceneDraftStorage = localStorage,
): HouseSceneDefinition | null {
  try {
    const serialized = storage.getItem(HOUSE_SCENE_DRAFT_STORAGE_KEY);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    if (!isHouseSceneDefinition(parsed)) return null;
    const migrated = migrateLegacyDefaultRoomBounds(parsed);
    if (serializeHouseScene(migrated) !== serializeHouseScene(parsed)) {
      storeHouseSceneDraft(migrated, storage);
    }
    return migrated;
  } catch {
    return null;
  }
}

export function storeHouseSceneDraft(
  scene: HouseSceneDefinition,
  storage: HouseSceneDraftStorage = localStorage,
): void {
  try {
    storage.setItem(HOUSE_SCENE_DRAFT_STORAGE_KEY, serializeHouseScene(scene));
  } catch {
    // Private browsing or storage quotas must not prevent editing/export.
  }
}

function migrateLegacyDefaultRoomBounds(source: HouseSceneDefinition): HouseSceneDefinition {
  const migrated = cloneHouseScene(source);
  if (migrated.id !== DEFAULT_HOUSE_SCENE.id) return migrated;
  for (const room of migrated.rooms) {
    const currentDefault = DEFAULT_HOUSE_SCENE.rooms.find((candidate) => candidate.id === room.id);
    if (!currentDefault) continue;
    const legacyCenterX = currentDefault.center.x < 0
      ? -10.5
      : currentDefault.center.x > 0
        ? 10.5
        : 0;
    const isLegacyDefault = approximately(room.width, LEGACY_DEFAULT_ROOM_WIDTH)
      && approximately(room.depth, LEGACY_DEFAULT_ROOM_DEPTH)
      && approximately(room.center.x, legacyCenterX)
      && approximately(room.center.z, currentDefault.center.z);
    if (!isLegacyDefault) continue;
    const deltaX = room.center.x - currentDefault.center.x;
    const deltaZ = room.center.z - currentDefault.center.z;
    for (const placement of migrated.furniture) {
      if (placement.roomId !== room.id) continue;
      placement.offsetX += deltaX;
      placement.offsetZ += deltaZ;
    }
    room.center = { ...currentDefault.center };
    room.width = currentDefault.width;
    room.depth = currentDefault.depth;
  }
  return migrated;
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}
