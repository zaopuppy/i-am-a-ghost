import * as THREE from 'three';

const DEFAULT_VIEW_HEIGHT = 22;

export interface RenderStage {
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
  setView(centerX: number, centerZ: number, viewHeight: number): void;
  resize(): void;
  dispose(): void;
}

export function createRenderStage(canvas: HTMLCanvasElement): RenderStage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 24, 0.01);
  camera.lookAt(0, 0, 0);
  let currentViewHeight = DEFAULT_VIEW_HEIGHT;

  const updateProjection = (width: number, height: number): void => {
    const aspect = width / height;
    camera.left = (-currentViewHeight * aspect) / 2;
    camera.right = (currentViewHeight * aspect) / 2;
    camera.top = currentViewHeight / 2;
    camera.bottom = -currentViewHeight / 2;
    camera.updateProjectionMatrix();
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    updateProjection(width, height);
    renderer.setSize(width, height, false);
  };

  resize();

  return {
    renderer,
    camera,
    setView: (centerX, centerZ, viewHeight) => {
      const heightChanged = currentViewHeight !== viewHeight;
      currentViewHeight = viewHeight;
      camera.position.set(centerX, 24, centerZ + 0.01);
      camera.lookAt(centerX, 0, centerZ);
      if (heightChanged) {
        updateProjection(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      }
    },
    resize,
    dispose: () => renderer.dispose(),
  };
}
