import * as THREE from 'three';
import { io } from 'socket.io-client';
import { Loop } from './core/Loop';
import { createRenderStage } from './core/Renderer';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const networkStatus = document.querySelector<HTMLElement>('#network-status');
const connectionRow = document.querySelector<HTMLElement>('.connection');
const overlay = document.querySelector<HTMLElement>('.foundation-panel');

if (!canvas || !networkStatus || !connectionRow || !overlay) {
  throw new Error('Foundation DOM is incomplete.');
}

const stage = createRenderStage(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090d);
scene.fog = new THREE.FogExp2(0x08090d, 0.035);

scene.add(new THREE.HemisphereLight(0x8592b8, 0x161318, 1.45));
const keyLight = new THREE.DirectionalLight(0xe8d5a4, 2.7);
keyLight.position.set(-7, 12, 8);
scene.add(keyLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(22, 14),
  new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.95, metalness: 0.04 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(22, 22, 0x3c3b43, 0x22232b);
grid.position.y = 0.012;
scene.add(grid);

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x4b4d56,
  emissive: 0x14151a,
  roughness: 0.72,
});
const wallSegments: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -7, 22, 0.25],
  [0, 7, 22, 0.25],
  [-11, 0, 0.25, 14],
  [11, 0, 0.25, 14],
  [-5.5, -1.8, 0.22, 6.6],
  [-5.5, 5.6, 0.22, 2.8],
  [2.4, -4.2, 0.22, 5.6],
  [2.4, 4.3, 0.22, 5.4],
  [6.7, 1.2, 8.6, 0.22],
];

for (const [x, z, width, depth] of wallSegments) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 0.45, depth), wallMaterial);
  wall.position.set(x, 0.225, z);
  scene.add(wall);
}

const pulseMaterial = new THREE.MeshStandardMaterial({
  color: 0xd8bd72,
  emissive: 0x7d6128,
  emissiveIntensity: 1.4,
  roughness: 0.35,
  metalness: 0.2,
});
const pulse = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.085, 12, 48), pulseMaterial);
pulse.rotation.x = -Math.PI / 2;
pulse.position.set(0, 0.13, 0);
scene.add(pulse);

let frame = 0;
let networkConnected = false;

const updateDiagnostics = (fps: number): void => {
  window.__THREE_GAME_DIAGNOSTICS__ = {
    phase: 'foundation',
    frame,
    fps,
    networkConnected,
    renderer: {
      calls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      geometries: stage.renderer.info.memory.geometries,
      textures: stage.renderer.info.memory.textures,
    },
  };
};

const socket = io({
  transports: ['websocket'],
  reconnectionDelay: 500,
});

socket.on('connect', () => {
  networkConnected = true;
  networkStatus.textContent = '局域网房间服务已连接';
  connectionRow.dataset.connected = 'true';
});

socket.on('disconnect', () => {
  networkConnected = false;
  networkStatus.textContent = '房间服务连接已断开';
  connectionRow.dataset.connected = 'false';
});

socket.on('connect_error', () => {
  networkConnected = false;
  networkStatus.textContent = '等待局域网房间服务';
  connectionRow.dataset.connected = 'false';
});

const loop = new Loop(
  (_deltaSeconds, elapsedSeconds, fps) => {
    frame += 1;
    const pulseScale = 1 + Math.sin(elapsedSeconds * 1.6) * 0.07;
    pulse.scale.setScalar(pulseScale);
    pulseMaterial.emissiveIntensity = 1.25 + Math.sin(elapsedSeconds * 1.6) * 0.35;
    updateDiagnostics(fps);
  },
  () => {
    stage.renderer.render(scene, stage.camera);
  },
);

const resizeObserver = new ResizeObserver(stage.resize);
resizeObserver.observe(canvas);
window.__THREE_GAME_TEST_HOOKS__ = {
  hideOverlay: (hidden: boolean) => {
    overlay.hidden = hidden;
  },
};

loop.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    socket.disconnect();
    resizeObserver.disconnect();
    stage.dispose();
    delete window.__THREE_GAME_DIAGNOSTICS__;
    delete window.__THREE_GAME_TEST_HOOKS__;
  });
}
