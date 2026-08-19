import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type SceneEditorViewportMode = 'edit' | 'navigate';

export interface SceneEditorCameraSnapshot {
  mode: SceneEditorViewportMode;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  zoom: number;
}

const HOUSE_HALF_WIDTH = 16.3;
const HOUSE_HALF_DEPTH = 10.3;
const FRAME_PADDING = 1.08;
const DISABLED_MOUSE_ACTION = -1 as THREE.MOUSE;

/** Owns viewport navigation without leaking editor input rules into the game camera rig. */
export class SceneEditorCamera {
  private readonly controls: OrbitControls;
  private mode: SceneEditorViewportMode = 'edit';

  constructor(
    private readonly camera: THREE.OrthographicCamera,
    canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.panSpeed = 0.9;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;
    this.controls.minZoom = 0.45;
    this.controls.maxZoom = 4;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(12);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(75);
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.target.set(0, 0, 0);
    this.setMode('edit');
  }

  update(): void {
    this.controls.update();
  }

  setMode(mode: SceneEditorViewportMode): void {
    this.mode = mode;
    this.controls.mouseButtons.LEFT = mode === 'navigate'
      ? THREE.MOUSE.PAN
      : DISABLED_MOUSE_ACTION;
  }

  currentMode(): SceneEditorViewportMode {
    return this.mode;
  }

  frameHouse(): void {
    const dampingEnabled = this.flushDamping();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 24, 13.86);
    this.camera.zoom = 1;
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const corners = [
      new THREE.Vector3(-HOUSE_HALF_WIDTH, 0, -HOUSE_HALF_DEPTH),
      new THREE.Vector3(-HOUSE_HALF_WIDTH, 0, HOUSE_HALF_DEPTH),
      new THREE.Vector3(HOUSE_HALF_WIDTH, 0, -HOUSE_HALF_DEPTH),
      new THREE.Vector3(HOUSE_HALF_WIDTH, 0, HOUSE_HALF_DEPTH),
    ];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      corner.applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
    const availableWidth = this.camera.right - this.camera.left;
    const availableHeight = this.camera.top - this.camera.bottom;
    const requiredWidth = Math.max(0.001, maxX - minX) * FRAME_PADDING;
    const requiredHeight = Math.max(0.001, maxY - minY) * FRAME_PADDING;
    this.camera.zoom = THREE.MathUtils.clamp(
      Math.min(availableWidth / requiredWidth, availableHeight / requiredHeight),
      this.controls.minZoom,
      this.controls.maxZoom,
    );
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = dampingEnabled;
  }

  focusPoint(point: { x: number; z: number }): void {
    const dampingEnabled = this.flushDamping();
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(point.x, 0, point.z);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.zoom = Math.max(this.camera.zoom, 1.35);
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = dampingEnabled;
  }

  snapshot(): SceneEditorCameraSnapshot {
    return {
      mode: this.mode,
      position: vectorSnapshot(this.camera.position),
      target: vectorSnapshot(this.controls.target),
      zoom: round(this.camera.zoom),
    };
  }

  dispose(): void {
    this.controls.dispose();
  }

  private flushDamping(): boolean {
    const dampingEnabled = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    return dampingEnabled;
  }
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
