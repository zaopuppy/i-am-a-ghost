import {
  createRecommendedCameraPresets,
  type CameraPresetMap,
} from '../core/CameraRig';
import { DEFAULT_GAMEPLAY_TUNING, type GameplayTuning } from './MatchEngine';

export interface RuntimeTuning extends GameplayTuning {
  cameraPresets: CameraPresetMap;
  cameraFollowResponsiveness: number;
  captureCameraResponsiveness: number;
}

export function createRuntimeTuning(): RuntimeTuning {
  return {
    ...DEFAULT_GAMEPLAY_TUNING,
    cameraPresets: createRecommendedCameraPresets(),
    cameraFollowResponsiveness: 10,
    captureCameraResponsiveness: 22,
  };
}
