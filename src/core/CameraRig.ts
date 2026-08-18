import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RenderStage } from './Renderer';

export type CameraMode = 'follow' | 'whole-house' | 'capture-closeup';

export interface CameraVector {
  x: number;
  y: number;
  z: number;
}

export interface CameraPreset {
  /** Camera position relative to the tracked subject. */
  position: CameraVector;
  /** Look target relative to the tracked subject. */
  target: CameraVector;
  /** Visible world-space height for the orthographic projection. */
  viewHeight: number;
}

export type CameraPresetMap = Record<CameraMode, CameraPreset>;

export interface CameraRigSnapshot {
  mode: CameraMode;
  pointerMode: boolean;
  position: CameraVector;
  target: CameraVector;
  relativePosition: CameraVector;
  relativeTarget: CameraVector;
  viewHeight: number;
  distance: number;
  tiltDegrees: number;
  azimuthDegrees: number;
}

export interface CameraRigUpdate {
  mode: CameraMode;
  captureActive: boolean;
  baseTarget: CameraVector;
  preset: CameraPreset;
  deltaSeconds: number;
  responsiveness: number;
  immediate?: boolean;
  shakeX?: number;
  shakeZ?: number;
}

const TOP_DOWN_TILT_RADIANS = THREE.MathUtils.degToRad(30);

function cameraHeightAtTopDownTilt(horizontalDistance: number, targetHeight = 0): number {
  return roundCameraValue(targetHeight + horizontalDistance / Math.tan(TOP_DOWN_TILT_RADIANS));
}

export const RECOMMENDED_CAMERA_PRESETS: Readonly<CameraPresetMap> = Object.freeze({
  follow: Object.freeze({
    position: Object.freeze({ x: 0, y: cameraHeightAtTopDownTilt(8, 0.65), z: 8 }),
    target: Object.freeze({ x: 0, y: 0.65, z: 0 }),
    viewHeight: 13.2,
  }),
  'whole-house': Object.freeze({
    position: Object.freeze({ x: 0, y: cameraHeightAtTopDownTilt(13.86), z: 13.86 }),
    target: Object.freeze({ x: 0, y: 0, z: 0 }),
    viewHeight: 23.5,
  }),
  'capture-closeup': Object.freeze({
    position: Object.freeze({ x: 0, y: cameraHeightAtTopDownTilt(3.2, 1), z: 3.2 }),
    target: Object.freeze({ x: 0, y: 1, z: 0 }),
    viewHeight: 5.2,
  }),
});

export function cloneCameraPreset(preset: CameraPreset): CameraPreset {
  return {
    position: { ...preset.position },
    target: { ...preset.target },
    viewHeight: preset.viewHeight,
  };
}

export function createRecommendedCameraPresets(): CameraPresetMap {
  return {
    follow: cloneCameraPreset(RECOMMENDED_CAMERA_PRESETS.follow),
    'whole-house': cloneCameraPreset(RECOMMENDED_CAMERA_PRESETS['whole-house']),
    'capture-closeup': cloneCameraPreset(RECOMMENDED_CAMERA_PRESETS['capture-closeup']),
  };
}

export function resolveCameraMode(
  runtimeMode: CameraMode,
  developerPreviewMode: CameraMode | null,
): CameraMode {
  return runtimeMode === 'capture-closeup'
    ? 'capture-closeup'
    : developerPreviewMode ?? runtimeMode;
}

export function cameraPresetFromPose(
  position: CameraVector,
  target: CameraVector,
  baseTarget: CameraVector,
  viewHeight: number,
): CameraPreset {
  return {
    position: {
      x: roundCameraValue(position.x - baseTarget.x),
      y: roundCameraValue(position.y - baseTarget.y),
      z: roundCameraValue(position.z - baseTarget.z),
    },
    target: {
      x: roundCameraValue(target.x - baseTarget.x),
      y: roundCameraValue(target.y - baseTarget.y),
      z: roundCameraValue(target.z - baseTarget.z),
    },
    viewHeight: roundCameraValue(viewHeight),
  };
}

export function formatCameraPreset(
  mode: CameraMode,
  preset: CameraPreset,
  format: 'typescript' | 'json',
): string {
  if (format === 'json') return JSON.stringify({ [mode]: preset }, null, 2);
  return `'${mode}': ${JSON.stringify(preset, null, 2)} satisfies CameraPreset`;
}

export function cameraAngles(position: CameraVector, target: CameraVector): {
  distance: number;
  tiltDegrees: number;
  azimuthDegrees: number;
} {
  const offsetX = position.x - target.x;
  const offsetY = position.y - target.y;
  const offsetZ = position.z - target.z;
  const horizontalDistance = Math.hypot(offsetX, offsetZ);
  return {
    distance: roundCameraValue(Math.hypot(horizontalDistance, offsetY)),
    tiltDegrees: roundCameraValue(THREE.MathUtils.radToDeg(
      Math.atan2(horizontalDistance, Math.max(0.001, Math.abs(offsetY))),
    )),
    azimuthDegrees: roundCameraValue(THREE.MathUtils.radToDeg(Math.atan2(offsetX, offsetZ))),
  };
}

/**
 * Owns the runtime camera transform and the optional DEV-only OrbitControls session.
 * Runtime capture always cancels developer control before applying its preset.
 */
export class CameraRig {
  private readonly baseTarget = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly renderedPosition = new THREE.Vector3();
  private mode: CameraMode = 'whole-house';
  private currentViewHeight = RECOMMENDED_CAMERA_PRESETS['whole-house'].viewHeight;
  private initialized = false;
  private captureActive = false;
  private pointerMode = false;
  private controls: OrbitControls | null = null;
  private controlsChangeHandler: (() => void) | null = null;
  private onPoseChanged: (() => void) | null = null;
  private onPointerModeChanged: ((enabled: boolean) => void) | null = null;

  constructor(private readonly stage: RenderStage) {}

  async installDeveloperControls(
    canvas: HTMLCanvasElement,
    callbacks: {
      poseChanged(): void;
      pointerModeChanged(enabled: boolean): void;
    },
  ): Promise<void> {
    if (this.controls) return;
    const { OrbitControls: OrbitControlsConstructor } = await import(
      'three/addons/controls/OrbitControls.js'
    );
    const controls = new OrbitControlsConstructor(this.stage.camera, canvas);
    controls.enabled = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = false;
    controls.minZoom = 0.45;
    controls.maxZoom = 2.5;
    controls.minPolarAngle = THREE.MathUtils.degToRad(8);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.onPoseChanged = callbacks.poseChanged;
    this.onPointerModeChanged = callbacks.pointerModeChanged;
    this.controlsChangeHandler = () => {
      if (!this.pointerMode) return;
      this.syncPoseFromControls();
      this.onPoseChanged?.();
    };
    controls.addEventListener('change', this.controlsChangeHandler);
    this.controls = controls;
  }

  update(input: CameraRigUpdate): void {
    this.captureActive = input.captureActive;
    if (this.captureActive && this.pointerMode) this.stopDeveloperControl();
    if (this.pointerMode) {
      this.controls?.update();
      return;
    }

    this.mode = input.mode;
    this.baseTarget.set(input.baseTarget.x, input.baseTarget.y, input.baseTarget.z);
    this.desiredPosition.set(
      input.baseTarget.x + input.preset.position.x,
      input.baseTarget.y + input.preset.position.y,
      input.baseTarget.z + input.preset.position.z,
    );
    this.desiredTarget.set(
      input.baseTarget.x + input.preset.target.x,
      input.baseTarget.y + input.preset.target.y,
      input.baseTarget.z + input.preset.target.z,
    );

    const snap = input.immediate || !this.initialized;
    const factor = snap
      ? 1
      : 1 - Math.exp(-Math.max(0, input.deltaSeconds) * Math.max(0.001, input.responsiveness));
    this.currentPosition.lerp(this.desiredPosition, factor);
    this.currentTarget.lerp(this.desiredTarget, factor);
    this.currentViewHeight += (input.preset.viewHeight - this.currentViewHeight) * factor;
    this.initialized = true;

    this.renderedPosition.copy(this.currentPosition);
    this.renderedPosition.x += input.shakeX ?? 0;
    this.renderedPosition.z += input.shakeZ ?? 0;
    this.stage.setCameraPose(this.renderedPosition, this.currentTarget, this.currentViewHeight);
    if (this.controls) this.controls.target.copy(this.currentTarget);
  }

  startDeveloperControl(
    mode: CameraMode,
    baseTarget: CameraVector,
    preset: CameraPreset,
  ): boolean {
    if (!this.controls || this.captureActive) return false;
    this.mode = mode;
    this.baseTarget.set(baseTarget.x, baseTarget.y, baseTarget.z);
    this.currentPosition.set(
      baseTarget.x + preset.position.x,
      baseTarget.y + preset.position.y,
      baseTarget.z + preset.position.z,
    );
    this.currentTarget.set(
      baseTarget.x + preset.target.x,
      baseTarget.y + preset.target.y,
      baseTarget.z + preset.target.z,
    );
    this.currentViewHeight = preset.viewHeight;
    this.stage.camera.zoom = 1;
    this.stage.setCameraPose(this.currentPosition, this.currentTarget, this.currentViewHeight);
    this.controls.target.copy(this.currentTarget);
    this.pointerMode = true;
    this.controls.enabled = true;
    this.controls.update();
    this.onPointerModeChanged?.(true);
    return true;
  }

  stopDeveloperControl(): CameraPreset {
    this.controls?.update();
    this.syncPoseFromControls();
    this.normalizeOrthographicZoom();
    if (this.controls) this.controls.enabled = false;
    if (this.pointerMode) {
      this.pointerMode = false;
      this.onPointerModeChanged?.(false);
    }
    return this.currentPreset();
  }

  currentPreset(): CameraPreset {
    return cameraPresetFromPose(
      this.currentPosition,
      this.currentTarget,
      this.baseTarget,
      this.effectiveViewHeight(),
    );
  }

  snapshot(): CameraRigSnapshot {
    const angles = cameraAngles(this.currentPosition, this.currentTarget);
    const preset = this.currentPreset();
    return {
      mode: this.mode,
      pointerMode: this.pointerMode,
      position: roundedVector(this.currentPosition),
      target: roundedVector(this.currentTarget),
      relativePosition: preset.position,
      relativeTarget: preset.target,
      viewHeight: preset.viewHeight,
      ...angles,
    };
  }

  dispose(): void {
    if (this.controls && this.controlsChangeHandler) {
      this.controls.removeEventListener('change', this.controlsChangeHandler);
    }
    this.controls?.dispose();
    this.controls = null;
    this.controlsChangeHandler = null;
    this.onPoseChanged = null;
    this.onPointerModeChanged = null;
  }

  private syncPoseFromControls(): void {
    if (!this.controls) return;
    this.currentPosition.copy(this.stage.camera.position);
    this.currentTarget.copy(this.controls.target);
  }

  private normalizeOrthographicZoom(): void {
    const effectiveViewHeight = this.effectiveViewHeight();
    this.currentViewHeight = effectiveViewHeight;
    this.stage.camera.zoom = 1;
    this.stage.setCameraPose(this.currentPosition, this.currentTarget, effectiveViewHeight);
    if (this.controls) this.controls.target.copy(this.currentTarget);
  }

  private effectiveViewHeight(): number {
    return this.currentViewHeight / Math.max(0.001, this.stage.camera.zoom);
  }
}

function roundedVector(vector: CameraVector): CameraVector {
  return {
    x: roundCameraValue(vector.x),
    y: roundCameraValue(vector.y),
    z: roundCameraValue(vector.z),
  };
}

function roundCameraValue(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
