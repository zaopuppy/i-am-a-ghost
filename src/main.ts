import * as THREE from 'three';
import { GameInput } from './core/GameInput';
import { Loop } from './core/Loop';
import { createRenderStage } from './core/Renderer';
import { DEFAULT_HOUSE_MAP } from './game/defaultHouse';
import type { ViewerFrame } from './game/ViewerFrame';
import { GameClient } from './net/GameClient';
import './styles.css';

const canvas = requireElement<HTMLCanvasElement>('#game-canvas');
const networkStatus = requireElement<HTMLElement>('#network-status');
const connectionRow = requireElement<HTMLElement>('.connection');
const lobbyPanel = requireElement<HTMLElement>('.lobby-panel');
const lobbyActions = requireElement<HTMLElement>('#lobby-actions');
const roomPanel = requireElement<HTMLElement>('#room-panel');
const roomCodeLabel = requireElement<HTMLElement>('#room-code');
const roomCodeInput = requireElement<HTMLInputElement>('#room-code-input');
const roster = requireElement<HTMLUListElement>('#roster');
const startButton = requireElement<HTMLButtonElement>('#start-match');
const waitingMessage = requireElement<HTMLElement>('#waiting-message');
const errorMessage = requireElement<HTMLElement>('#error-message');
const gameHud = requireElement<HTMLElement>('#game-hud');
const roleLabel = requireElement<HTMLElement>('#role-label');
const createButton = requireElement<HTMLButtonElement>('#create-room');
const joinButton = requireElement<HTMLButtonElement>('#join-room');

const stage = createRenderStage(canvas);
const scene = createScene();
const client = new GameClient();
const input = new GameInput(canvas);
const actorMeshes = new Map<string, THREE.Object3D>();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerTarget = new THREE.Vector3();
const nickname = createTemporaryNickname();
let renderFrame = 0;
let lastInputSentAt = 0;
let measuredFps = 0;

const queryRoom = new URLSearchParams(window.location.search).get('room');
if (queryRoom) roomCodeInput.value = normalizeRoomCode(queryRoom);

createButton.addEventListener('click', () => void client.createRoom(nickname));
joinButton.addEventListener('click', () => {
  const code = normalizeRoomCode(roomCodeInput.value);
  roomCodeInput.value = code;
  if (code.length === 6) void client.joinRoom(code, nickname);
});
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
});
roomCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinButton.click();
});
startButton.addEventListener('click', () => void client.startMatch());

const unsubscribeClient = client.subscribe(renderClientState);

const loop = new Loop(
  (_deltaSeconds, elapsedSeconds, fps) => {
    renderFrame += 1;
    measuredFps = fps;
    const frame = client.latestFrame?.frame ?? null;
    syncActors(frame);
    if (frame && client.roomState?.phase === 'playing' && elapsedSeconds - lastInputSentAt >= 1 / 30) {
      lastInputSentAt = elapsedSeconds;
      client.sendInput({
        moveX: input.movement().x,
        moveZ: input.movement().z,
        facingRadians: calculateFacing(frame),
        action: input.actionHeld(),
      });
    }
    updateDiagnostics(frame);
  },
  () => stage.renderer.render(scene, stage.camera),
);

const resizeObserver = new ResizeObserver(stage.resize);
resizeObserver.observe(canvas);
window.__THREE_GAME_TEST_HOOKS__ = {
  hideOverlay: (hidden: boolean) => {
    lobbyPanel.hidden = hidden;
  },
};
loop.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    input.dispose();
    client.dispose();
    unsubscribeClient();
    resizeObserver.disconnect();
    stage.dispose();
    delete window.__THREE_GAME_DIAGNOSTICS__;
    delete window.__THREE_GAME_TEST_HOOKS__;
  });
}

function renderClientState(): void {
  connectionRow.dataset.connected = String(client.connected);
  networkStatus.textContent = client.connected ? '局域网房间服务已连接' : '等待局域网房间服务';
  errorMessage.textContent = client.errorMessage;
  const room = client.roomState;
  const inRoom = Boolean(client.session && room);
  lobbyActions.hidden = inRoom;
  roomPanel.hidden = !inRoom;
  if (room && client.session) {
    roomCodeLabel.textContent = room.roomCode;
    roster.replaceChildren(
      ...room.players.map((player) => {
        const item = document.createElement('li');
        const role = player.role === 'ghost' ? '鬼' : player.role === 'child' ? '小孩' : '等待';
        item.textContent = `${player.nickname}${player.isHost ? ' · 房主' : ''} · ${role}`;
        item.dataset.playerId = player.playerId;
        return item;
      }),
    );
    const canStart = room.phase === 'lobby' && client.session.isHost && room.players.length >= 2;
    startButton.hidden = !client.session.isHost || room.phase !== 'lobby';
    startButton.disabled = !canStart;
    waitingMessage.hidden = client.session.isHost || room.phase !== 'lobby';
  }
  const playing = room?.phase === 'playing';
  lobbyPanel.hidden = playing;
  gameHud.hidden = !playing;
  if (client.latestFrame) {
    roleLabel.textContent = client.latestFrame.frame.viewerRole === 'ghost' ? '你是鬼 · 空格抓取' : '你是小孩 · 按住空格照射';
  }
}

function syncActors(frame: ViewerFrame | null): void {
  for (const mesh of actorMeshes.values()) mesh.visible = false;
  if (!frame) return;
  for (const child of frame.children) {
    const mesh = getActorMesh(`child:${child.playerId}`, 'child');
    mesh.visible = true;
    mesh.position.set(child.position.x, 0.48, child.position.z);
    mesh.rotation.y = -child.facingRadians;
  }
  for (const doll of frame.dolls) {
    const mesh = getActorMesh(`doll:${doll.dollId}`, 'doll');
    mesh.visible = true;
    mesh.position.set(doll.position.x, 0.42, doll.position.z);
  }
  if (frame.ghost) {
    const mesh = getActorMesh('ghost', 'ghost');
    mesh.visible = true;
    mesh.position.set(frame.ghost.position.x, 0.48, frame.ghost.position.z);
    mesh.rotation.y = -frame.ghost.facingRadians;
  }
}

function getActorMesh(id: string, kind: 'child' | 'ghost' | 'doll'): THREE.Object3D {
  const existing = actorMeshes.get(id);
  if (existing) return existing;
  const color = kind === 'ghost' ? 0xc9cedf : kind === 'doll' ? 0x7d6852 : 0xe0aa54;
  const geometry = kind === 'doll' ? new THREE.BoxGeometry(0.62, 0.8, 0.62) : new THREE.CapsuleGeometry(0.32, 0.48, 5, 10);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: kind === 'ghost' ? 0x353c55 : 0x291d0c,
    emissiveIntensity: 0.8,
    roughness: 0.72,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  actorMeshes.set(id, mesh);
  return mesh;
}

function calculateFacing(frame: ViewerFrame): number {
  const ownPosition = ownActorPosition(frame);
  if (!ownPosition) return 0;
  const pointer = input.pointerClient();
  const bounds = canvas.getBoundingClientRect();
  const pointerNdc = new THREE.Vector2(
    ((pointer.x || bounds.left + bounds.width / 2) - bounds.left) / bounds.width * 2 - 1,
    -(((pointer.y || bounds.top + bounds.height / 2) - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, stage.camera);
  if (!raycaster.ray.intersectPlane(groundPlane, pointerTarget)) return 0;
  return Math.atan2(pointerTarget.z - ownPosition.z, pointerTarget.x - ownPosition.x);
}

function ownActorPosition(frame: ViewerFrame): { x: number; z: number } | null {
  if (frame.viewerRole === 'ghost') return frame.ghost.position;
  return frame.children.find((child) => child.playerId === frame.viewerPlayerId)?.position ?? null;
}

function updateDiagnostics(frame: ViewerFrame | null): void {
  window.__THREE_GAME_DIAGNOSTICS__ = {
    phase: client.roomState?.phase ?? 'lobby',
    frame: renderFrame,
    fps: measuredFps,
    networkConnected: client.connected,
    roomCode: client.roomState?.roomCode ?? null,
    role: frame?.viewerRole ?? null,
    serverTick: frame?.tick ?? null,
    ackSeq: client.latestFrame?.ackSeq ?? null,
    ownPosition: frame ? ownActorPosition(frame) : null,
    viewerFrame: frame,
    renderer: {
      calls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      geometries: stage.renderer.info.memory.geometries,
      textures: stage.renderer.info.memory.textures,
    },
  };
}

function createScene(): THREE.Scene {
  const nextScene = new THREE.Scene();
  nextScene.background = new THREE.Color(0x08090d);
  nextScene.fog = new THREE.FogExp2(0x08090d, 0.03);
  nextScene.add(new THREE.HemisphereLight(0x8592b8, 0x161318, 1.45));
  const keyLight = new THREE.DirectionalLight(0xe8d5a4, 2.7);
  keyLight.position.set(-7, 12, 8);
  nextScene.add(keyLight);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(
      DEFAULT_HOUSE_MAP.bounds.maxX - DEFAULT_HOUSE_MAP.bounds.minX,
      DEFAULT_HOUSE_MAP.bounds.maxZ - DEFAULT_HOUSE_MAP.bounds.minZ,
    ),
    new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.95, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  nextScene.add(floor);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4d56, roughness: 0.72 });
  const walls = [
    ...DEFAULT_HOUSE_MAP.walls,
    { id: 'north-boundary', minX: -11, maxX: 11, minZ: 6.8, maxZ: 7 },
    { id: 'south-boundary', minX: -11, maxX: 11, minZ: -7, maxZ: -6.8 },
    { id: 'west-boundary', minX: -11, maxX: -10.8, minZ: -7, maxZ: 7 },
    { id: 'east-boundary', minX: 10.8, maxX: 11, minZ: -7, maxZ: 7 },
  ];
  for (const wall of walls) {
    const width = wall.maxX - wall.minX;
    const depth = wall.maxZ - wall.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth), wallMaterial);
    mesh.position.set((wall.minX + wall.maxX) / 2, 0.25, (wall.minZ + wall.maxZ) / 2);
    nextScene.add(mesh);
  }
  return nextScene;
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function createTemporaryNickname(): string {
  const adjectives = ['安静', '勇敢', '机灵', '迷路', '警觉', '发光'];
  const number = Math.floor(Math.random() * 900 + 100);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}访客${number}`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required DOM element: ${selector}`);
  return element;
}
