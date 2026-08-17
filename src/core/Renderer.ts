import * as THREE from 'three';

const VIEW_HEIGHT = 18;

export interface RenderStage {
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
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
  camera.position.set(13, 17, 13);
  camera.lookAt(0, 0, 0);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const aspect = width / height;
    camera.left = (-VIEW_HEIGHT * aspect) / 2;
    camera.right = (VIEW_HEIGHT * aspect) / 2;
    camera.top = VIEW_HEIGHT / 2;
    camera.bottom = -VIEW_HEIGHT / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  resize();

  return {
    renderer,
    camera,
    resize,
    dispose: () => renderer.dispose(),
  };
}
