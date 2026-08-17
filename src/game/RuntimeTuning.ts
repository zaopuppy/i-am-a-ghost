import { DEFAULT_MOVEMENT_TUNING, type MovementTuning } from './MatchEngine';

export interface RuntimeTuning extends MovementTuning {
  childCameraHeight: number;
  ghostCameraHeight: number;
  captureCameraHeight: number;
  cameraFollowResponsiveness: number;
  captureCameraResponsiveness: number;
}

export function createRuntimeTuning(): RuntimeTuning {
  return {
    childMoveSpeed: DEFAULT_MOVEMENT_TUNING.childMoveSpeed,
    ghostMoveSpeed: DEFAULT_MOVEMENT_TUNING.ghostMoveSpeed,
    childCameraHeight: 12.5,
    ghostCameraHeight: 22.5,
    captureCameraHeight: 5.2,
    cameraFollowResponsiveness: 10,
    captureCameraResponsiveness: 22,
  };
}
