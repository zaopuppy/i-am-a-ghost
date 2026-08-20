import defaultHouseSceneSource from '../../assets/maps/m3-nine-room-house.scene.json' with { type: 'json' };
import { isHouseSceneDefinition, type HouseSceneDefinition } from './HouseScene';

const source: unknown = defaultHouseSceneSource;
if (!isHouseSceneDefinition(source)) {
  throw new Error('Default house scene has an unsupported or malformed structure.');
}

export const DEFAULT_HOUSE_SCENE: HouseSceneDefinition = source;
