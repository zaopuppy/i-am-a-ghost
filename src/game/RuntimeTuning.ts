import { DEFAULT_GAMEPLAY_TUNING, type GameplayTuning } from './MatchEngine';

export interface RuntimeTuning extends GameplayTuning {
  childCameraHeight: number;
  ghostCameraHeight: number;
  captureCameraHeight: number;
  cameraFollowResponsiveness: number;
  captureCameraResponsiveness: number;
}

export function createRuntimeTuning(): RuntimeTuning {
  return {
    ...DEFAULT_GAMEPLAY_TUNING,
    childCameraHeight: 12.5,
    ghostCameraHeight: 22.5,
    captureCameraHeight: 5.2,
    cameraFollowResponsiveness: 10,
    captureCameraResponsiveness: 22,
  };
}
