import * as THREE from 'three';
import { GameInput } from './core/GameInput';
import { Loop } from './core/Loop';
import { createRenderStage } from './core/Renderer';
import { GameWorld } from './game/GameWorld';
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
const objectiveLabel = requireElement<HTMLElement>('#objective-label');
const timerLabel = requireElement<HTMLElement>('#match-timer');
const healthFill = requireElement<HTMLElement>('#ghost-health-fill');
const healthValue = requireElement<HTMLElement>('#ghost-health-value');
const batteryMeter = requireElement<HTMLElement>('#battery-meter');
const batteryFill = requireElement<HTMLElement>('#battery-fill');
const eventBanner = requireElement<HTMLElement>('#event-banner');
const resultOverlay = requireElement<HTMLElement>('#result-overlay');
const resultTitle = requireElement<HTMLElement>('#result-title');
const resultDetail = requireElement<HTMLElement>('#result-detail');
const readyButton = requireElement<HTMLButtonElement>('#ready-next');
const readyCount = requireElement<HTMLElement>('#ready-count');
const createButton = requireElement<HTMLButtonElement>('#create-room');
const joinButton = requireElement<HTMLButtonElement>('#join-room');
const captureMarks = [...document.querySelectorAll<HTMLElement>('.capture-mark')];

const stage = createRenderStage(canvas);
const world = new GameWorld();
const client = new GameClient();
const input = new GameInput(canvas);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerTarget = new THREE.Vector3();
const cameraCenter = new THREE.Vector2();
const nickname = createTemporaryNickname();
let renderFrame = 0;
let lastInputSentAt = 0;
let measuredFps = 0;

const queryRoom = new URLSearchParams(window.location.search).get('room');
if (queryRoom) roomCodeInput.value = normalizeRoomCode(queryRoom);
createButton.addEventListener('click', () => void client.createRoom(nickname));
joinButton.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
});
roomCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});
startButton.addEventListener('click', () => void client.startMatch());
readyButton.addEventListener('click', () => void client.setReady(true));
const unsubscribeClient = client.subscribe(renderClientState);

const loop = new Loop(
  (deltaSeconds, elapsedSeconds, fps) => {
    renderFrame += 1;
    measuredFps = fps;
    const frame = client.latestFrame?.frame ?? null;
    world.sync(frame, elapsedSeconds);
    updateCamera(frame, deltaSeconds);
    updateHud(frame);
    if (frame && client.roomState?.phase === 'playing' && elapsedSeconds - lastInputSentAt >= 1 / 30) {
      lastInputSentAt = elapsedSeconds;
      const movement = input.movement();
      client.sendInput({
        moveX: movement.x,
        moveZ: movement.z,
        facingRadians: calculateFacing(frame),
        action: input.actionHeld(),
      });
    }
    updateDiagnostics(frame);
  },
  () => stage.renderer.render(world.scene, stage.camera),
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
    world.dispose();
    stage.dispose();
    delete window.__THREE_GAME_DIAGNOSTICS__;
    delete window.__THREE_GAME_TEST_HOOKS__;
  });
}

function joinRoom(): void {
  const code = normalizeRoomCode(roomCodeInput.value);
  roomCodeInput.value = code;
  if (code.length === 6) void client.joinRoom(code, nickname);
}

function renderClientState(): void {
  connectionRow.dataset.connected = String(client.connected);
  networkStatus.textContent = client.connected ? '局域网房间服务已连接' : '等待局域网房间服务';
  errorMessage.textContent = client.errorMessage;
  const room = client.roomState;
  const session = client.session;
  const inRoom = Boolean(session && room);
  lobbyActions.hidden = inRoom;
  roomPanel.hidden = !inRoom;
  if (room && session) {
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
    const canStart = room.phase === 'lobby' && session.isHost && room.players.length >= 2;
    startButton.hidden = !session.isHost || room.phase !== 'lobby';
    startButton.disabled = !canStart;
    waitingMessage.hidden = session.isHost || room.phase !== 'lobby';
    const ownPlayer = room.players.find((player) => player.playerId === session.playerId);
    readyButton.disabled = ownPlayer?.ready ?? false;
    readyButton.textContent = ownPlayer?.ready ? '已准备，等待其他人' : '准备下一局';
    readyCount.textContent = `${room.players.filter((player) => player.ready).length} / ${room.players.length} 已准备`;
  }
  const playing = room?.phase === 'playing';
  const ended = room?.phase === 'ended';
  lobbyPanel.hidden = Boolean(playing || ended);
  gameHud.hidden = !playing;
  resultOverlay.hidden = !ended;
  if (client.latestFrame) {
    const frame = client.latestFrame.frame;
    roleLabel.textContent = frame.viewerRole === 'ghost' ? '你是鬼' : '你是小孩';
    objectiveLabel.textContent = frame.viewerRole === 'ghost' ? '抓住孩子三次' : '照亮鬼或撑到天亮';
    if (ended) {
      const won = (frame.viewerRole === 'ghost' && frame.winner === 'ghost') ||
        (frame.viewerRole === 'child' && frame.winner === 'children');
      resultTitle.textContent = won ? '你们赢了' : '这次输了';
      resultDetail.textContent = frame.winner === 'children'
        ? '鬼的力量耗尽，或五分钟已经过去。'
        : '第三次抓取完成，房子归于寂静。';
    }
  }
}

function updateHud(frame: ViewerFrame | null): void {
  if (!frame) return;
  timerLabel.textContent = formatTime(frame.remainingTicks);
  healthValue.textContent = String(Math.ceil(frame.ghostHealth));
  healthFill.style.transform = `scaleX(${Math.max(0, frame.ghostHealth / 100)})`;
  captureMarks.forEach((mark, index) => mark.classList.toggle('filled', index < frame.captureCount));
  batteryMeter.hidden = frame.viewerRole !== 'child';
  if (frame.viewerRole === 'child') {
    batteryFill.style.transform = `scaleX(${frame.ownBattery})`;
    batteryMeter.classList.toggle('low', frame.ownBattery < 0.15);
  }
  if (frame.phase === 'capture-animation') {
    showBanner('被抓到了 · 位置即将重置', 'danger');
  } else if (frame.phase === 'protection') {
    showBanner('保护时间 · 计时暂停', 'safe');
  } else if (frame.viewerRole === 'ghost' && frame.ghost.captureState === 'windup') {
    showBanner('抓取中…', 'danger');
  } else {
    eventBanner.hidden = true;
  }
}

function showBanner(text: string, tone: 'danger' | 'safe'): void {
  eventBanner.textContent = text;
  eventBanner.dataset.tone = tone;
  eventBanner.hidden = false;
}

function updateCamera(frame: ViewerFrame | null, deltaSeconds: number): void {
  const ownPosition = frame ? ownActorPosition(frame) : null;
  const targetX = frame?.viewerRole === 'child' && ownPosition ? ownPosition.x : 0;
  const targetZ = frame?.viewerRole === 'child' && ownPosition ? ownPosition.z : 0;
  const responsiveness = 1 - Math.exp(-deltaSeconds * 10);
  cameraCenter.lerp(new THREE.Vector2(targetX, targetZ), responsiveness);
  stage.setView(cameraCenter.x, cameraCenter.y, frame?.viewerRole === 'child' ? 10.5 : 22.5);
}

function calculateFacing(frame: ViewerFrame): number {
  const ownPosition = ownActorPosition(frame);
  if (!ownPosition) return 0;
  const pointer = input.pointerClient();
  const bounds = canvas.getBoundingClientRect();
  const pointerX = pointer.x || bounds.left + bounds.width / 2;
  const pointerY = pointer.y || bounds.top + bounds.height / 2;
  raycaster.setFromCamera(
    new THREE.Vector2(
      ((pointerX - bounds.left) / bounds.width) * 2 - 1,
      -((pointerY - bounds.top) / bounds.height) * 2 + 1,
    ),
    stage.camera,
  );
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
    cameraMode: frame?.viewerRole === 'child' ? 'follow' : 'whole-house',
    world: world.metrics(),
    renderer: {
      calls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      geometries: stage.renderer.info.memory.geometries,
      textures: stage.renderer.info.memory.textures,
    },
  };
}

function formatTime(ticks: number): string {
  const seconds = Math.max(0, Math.ceil(ticks / 60));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function createTemporaryNickname(): string {
  const adjectives = ['安静', '勇敢', '机灵', '迷路', '警觉', '发光'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}访客${Math.floor(Math.random() * 900 + 100)}`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required DOM element: ${selector}`);
  return element;
}
