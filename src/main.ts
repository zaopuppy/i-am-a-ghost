import * as THREE from 'three';
import { GameAudio } from './audio/GameAudio';
import {
  CameraRig,
  createRecommendedCameraPresets,
  formatCameraPreset,
  orientMovementToCamera,
  type CameraMode,
  type CameraPreset,
  type CameraVector,
} from './core/CameraRig';
import { GameInput } from './core/GameInput';
import { Loop } from './core/Loop';
import { createRenderStage } from './core/Renderer';
import { GameWorld } from './game/GameWorld';
import { compileHouseScene, type CompiledHouseScene } from './game/HouseScene';
import { loadHouseSceneDraft } from './game/HouseSceneDraft';
import type { GameplayTuning } from './game/MatchEngine';
import { createRuntimeTuning } from './game/RuntimeTuning';
import {
  parseScenePlaytestRole,
  SCENE_PLAYTEST_QUERY_PARAM,
  ScenePlaytest,
  type ScenePlaytestRole,
} from './game/ScenePlaytest';
import type { ViewerFrame } from './game/ViewerFrame';
import { GameClient } from './net/GameClient';
import { FramePresenter } from './net/FramePresenter';
import {
  createDeterministicViewerFrame,
  isDeterministicStateName,
  type DeterministicStateName,
} from './testing/DeterministicStates';
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
const batteryLocator = requireElement<HTMLElement>('#battery-locator');
const batteryDistance = requireElement<HTMLElement>('#battery-distance');
const eventBanner = requireElement<HTMLElement>('#event-banner');
const resultOverlay = requireElement<HTMLElement>('#result-overlay');
const resultTitle = requireElement<HTMLElement>('#result-title');
const resultDetail = requireElement<HTMLElement>('#result-detail');
const readyButton = requireElement<HTMLButtonElement>('#ready-next');
const readyCount = requireElement<HTMLElement>('#ready-count');
const createButton = requireElement<HTMLButtonElement>('#create-room');
const joinButton = requireElement<HTMLButtonElement>('#join-room');
const captureMarks = [...document.querySelectorAll<HTMLElement>('.capture-mark')];
const audioButton = requireElement<HTMLButtonElement>('#audio-toggle');
const milestone = requireElement<HTMLElement>('#milestone');
const controlHint = requireElement<HTMLElement>('#control-hint');

const query = new URLSearchParams(window.location.search);
const sceneEditorRequested = import.meta.env.DEV && query.get('sceneEditor') === '1';
const scenePlaytestRole = import.meta.env.DEV
  ? parseScenePlaytestRole(query.get(SCENE_PLAYTEST_QUERY_PARAM))
  : null;
const scenePlaytestHouse = scenePlaytestRole ? loadPlayableHouseDraft() : null;

const stage = createRenderStage(canvas);
const world = new GameWorld(scenePlaytestHouse ?? undefined);
const client = new GameClient();
const presenter = new FramePresenter();
const input = new GameInput();
const audio = new GameAudio();
const batteryScreenPoint = new THREE.Vector3();
const ownScreenPoint = new THREE.Vector3();
const runtimeTuning = createRuntimeTuning();
const scenePlaytest = scenePlaytestRole && scenePlaytestHouse
  ? new ScenePlaytest(scenePlaytestHouse.map, scenePlaytestRole, runtimeTuning)
  : null;
const cameraRig = new CameraRig(stage);
const nickname = createTemporaryNickname();
let renderFrame = 0;
let lastInputSentAt = 0;
let lastFacingRadians = 0;
let measuredFps = 0;
let lastIngestedFrameKey = '';
let lastAudioEvents: typeof client.latestEvents = null;
let lastActionHeld = false;
let lastGhostVisible = false;
let lastGhostBurning = false;
let debugGui: import('lil-gui').GUI | null = null;
let debugGuiHidden = false;
let debugTuningTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedDebugGameplayTuning: GameplayTuning | null = null;
let cameraSnapRequested = false;
let cameraValueControllers: import('lil-gui').Controller[] = [];
let cameraMetricControllers: import('lil-gui').Controller[] = [];
let cameraPointerController: import('lil-gui').Controller | null = null;
let infiniteGhostHealthController: import('lil-gui').Controller | null = null;
let infiniteFlashlightEnergyController: import('lil-gui').Controller | null = null;
let sceneEditor: import('./game/SceneEditor').SceneEditor | null = null;
let scenePlaytestToolbar: HTMLElement | null = null;
const cameraDebugState = createCameraDebugState(runtimeTuning.cameraPresets['whole-house']);
const requestedTestState = query.get('testState');
let deterministicState: DeterministicStateName | null = import.meta.env.DEV
  && isDeterministicStateName(requestedTestState)
  ? requestedTestState
  : null;
let deterministicSeed = 71;
let screenshotPaused = Boolean(deterministicState);
let reducedMotion = false;

const queryRoom = query.get('room');
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
readyButton.addEventListener('click', () => {
  if (scenePlaytest) {
    scenePlaytest.reset();
    return;
  }
  void client.setReady(true);
});
audioButton.addEventListener('click', () => {
  void audio.unlock();
  const muted = audio.toggleMuted();
  audioButton.textContent = muted ? '声音：关' : '声音：开';
});
const unlockAudio = (): void => {
  void audio.unlock();
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
const unsubscribeClient = client.subscribe(renderClientState);

const loop = new Loop(
  (deltaSeconds, elapsedSeconds, fps) => {
    renderFrame += 1;
    measuredFps = fps;
    const envelope = client.latestFrame;
    if (envelope) {
      const key = `${envelope.matchId}:${envelope.frame.tick}`;
      if (key !== lastIngestedFrameKey) {
        presenter.ingest(envelope.matchId, envelope.frame);
        lastIngestedFrameKey = key;
      }
    }
    const cameraPose = cameraRig.snapshot();
    const movement = deterministicState
      ? { x: 0, z: 0 }
      : orientMovementToCamera(input.movement(), cameraPose.position, cameraPose.target);
    const actionHeld = input.actionHeld();
    const frame = deterministicState
      ? createDeterministicViewerFrame(deterministicState, deterministicSeed)
      : scenePlaytest
        ? scenePlaytest.update(
            deltaSeconds,
            movement,
            calculateFacing(movement),
            actionHeld,
          )
        : presenter.present(deltaSeconds, movement, runtimeTuning);
    if (!deterministicState && !scenePlaytest && client.latestEvents && client.latestEvents !== lastAudioEvents) {
      lastAudioEvents = client.latestEvents;
      audio.handleEvents(client.latestEvents.events, frame?.viewerPlayerId);
    }
    if (actionHeld && !lastActionHeld && frame?.viewerRole === 'child') audio.play('flashlight', 0.52);
    lastActionHeld = actionHeld;
    updateGhostAudio(frame);
    const presentationSeconds = deterministicState && (screenshotPaused || reducedMotion)
      ? 2.75
      : elapsedSeconds;
  world.setFlashlightTuning(runtimeTuning.flashlightLength, runtimeTuning.flashlightConeDegrees);
    world.sync(frame, presentationSeconds);
    updateCamera(frame, deltaSeconds, Boolean(deterministicState));
    updateHud(frame);
    if (deterministicState && frame) renderDeterministicState(frame);
    if (scenePlaytest && frame) renderScenePlaytestState(frame);
    if (!deterministicState && !scenePlaytest && frame && client.roomState?.phase === 'playing' && elapsedSeconds - lastInputSentAt >= 1 / 30) {
      lastInputSentAt = elapsedSeconds;
      client.sendInput({
        moveX: movement.x,
        moveZ: movement.z,
        facingRadians: calculateFacing(movement),
        action: frame.viewerRole === 'child' && actionHeld,
      });
    }
    updateDiagnostics(frame);
  },
  () => stage.render(world.scene, world.flashlights()),
);

const resizeObserver = new ResizeObserver(stage.resize);
resizeObserver.observe(canvas);
if (import.meta.env.DEV) {
  const testHooks: NonNullable<typeof window.__THREE_GAME_TEST_HOOKS__> & {
    setCameraPreview(mode: CameraMode | null): void;
    cameraSnapshot(): ReturnType<CameraRig['snapshot']>;
  } = {
    seed: (value: number) => {
      deterministicSeed = Number.isFinite(value) ? Math.trunc(value) : 0;
    },
    setState: (name: string) => {
      if (!isDeterministicStateName(name)) throw new Error(`Unknown deterministic state: ${name}`);
      deterministicState = name;
    },
    setPausedForScreenshot: (paused: boolean) => {
      screenshotPaused = paused;
    },
    setReducedMotion: (enabled: boolean) => {
      reducedMotion = enabled;
      document.documentElement.dataset.reducedMotion = String(enabled);
    },
    hideDebugUi: (hidden: boolean) => {
      setDebugUiHidden(hidden);
    },
    hideOverlay: (hidden: boolean) => {
      lobbyPanel.hidden = hidden;
    },
    setCameraPreview: (mode: CameraMode | null) => {
      if (mode !== null && !isCameraMode(mode)) throw new Error(`Unknown camera mode: ${mode}`);
      cameraSnapRequested = true;
    },
    cameraSnapshot: () => cameraRig.snapshot(),
  };
  window.__THREE_GAME_TEST_HOOKS__ = testHooks;
  if (sceneEditorRequested) void installSceneEditor();
  else if (scenePlaytestRole) installScenePlaytestUi();
  else if (!deterministicState && !scenePlaytestRole) void installDebugGui();
}
loop.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    input.dispose();
    audio.dispose();
    if (debugTuningTimer) clearTimeout(debugTuningTimer);
    debugGui?.destroy();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    client.dispose();
    unsubscribeClient();
    resizeObserver.disconnect();
    cameraRig.dispose();
    sceneEditor?.dispose();
    scenePlaytestToolbar?.remove();
    window.removeEventListener('keydown', handleScenePlaytestKeyDown);
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
  if (deterministicState || sceneEditorRequested || scenePlaytestRole) return;
  connectionRow.dataset.connected = String(client.connected);
  networkStatus.textContent = client.connected ? '局域网房间服务已连接' : '等待局域网房间服务';
  errorMessage.textContent = client.roomState?.notice === 'ghost-disconnected'
    ? '鬼已断线，本局取消并返回大厅。'
    : client.errorMessage;
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
    const ownPlayer = room.players.find((player) => player.playerId === session.playerId);
    const isCurrentHost = ownPlayer?.isHost ?? false;
    const canStart = room.phase === 'lobby' && isCurrentHost && room.players.length >= 2;
    startButton.hidden = !isCurrentHost || room.phase !== 'lobby';
    startButton.disabled = !canStart;
    waitingMessage.hidden = isCurrentHost || room.phase !== 'lobby';
    readyButton.disabled = ownPlayer?.ready ?? false;
    readyButton.textContent = ownPlayer?.ready ? '已准备，等待其他人' : '准备下一局';
    readyCount.textContent = `${room.players.filter((player) => player.ready).length} / ${room.players.length} 已准备`;
    if (
      room.debugGameplayTuning
      && room.debugGameplayTuning !== lastSyncedDebugGameplayTuning
    ) {
      lastSyncedDebugGameplayTuning = room.debugGameplayTuning;
      Object.assign(runtimeTuning, room.debugGameplayTuning);
      debugGui?.controllersRecursive().forEach((controller) => controller.updateDisplay());
      refreshInfiniteResourceToggleLabels();
    }
  } else {
    lastSyncedDebugGameplayTuning = null;
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
    updateControlHint(frame);
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

function renderDeterministicState(frame: ViewerFrame): void {
  lobbyPanel.hidden = true;
  gameHud.hidden = frame.phase === 'ended';
  resultOverlay.hidden = frame.phase !== 'ended';
  roleLabel.textContent = frame.viewerRole === 'ghost' ? '你是鬼' : '你是小孩';
  objectiveLabel.textContent = frame.viewerRole === 'ghost' ? '抓住孩子三次' : '照亮鬼或撑到天亮';
  updateControlHint(frame);
  milestone.textContent = `M6 · ${deterministicState}`;
  if (frame.phase !== 'ended') return;
  const won = (frame.viewerRole === 'ghost' && frame.winner === 'ghost')
    || (frame.viewerRole === 'child' && frame.winner === 'children');
  resultTitle.textContent = won ? '你们赢了' : '这次输了';
  resultDetail.textContent = frame.winner === 'children'
    ? '鬼的力量耗尽，或五分钟已经过去。'
    : '第三次抓取完成，房子归于寂静。';
  readyButton.textContent = '准备下一局';
  readyCount.textContent = '确定性验收状态';
}

function renderScenePlaytestState(frame: ViewerFrame): void {
  lobbyPanel.hidden = true;
  gameHud.hidden = frame.phase === 'ended';
  resultOverlay.hidden = frame.phase !== 'ended';
  roleLabel.textContent = frame.viewerRole === 'ghost' ? '试玩 · 你是鬼' : '试玩 · 你是小孩';
  objectiveLabel.textContent = frame.viewerRole === 'ghost' ? '检查追逐、碰撞与抓捕路线' : '检查移动、手电与躲藏路线';
  updateControlHint(frame);
  milestone.hidden = true;
  if (frame.phase !== 'ended') return;
  const won = (frame.viewerRole === 'ghost' && frame.winner === 'ghost')
    || (frame.viewerRole === 'child' && frame.winner === 'children');
  resultTitle.textContent = won ? '试玩完成' : '试玩结束';
  resultDetail.textContent = '可以重新试玩，或返回编辑器继续调整草稿。';
  readyButton.textContent = '重新试玩';
  readyButton.disabled = false;
  readyCount.textContent = '本地草稿试玩';
}

function updateHud(frame: ViewerFrame | null): void {
  if (!frame) {
    document.documentElement.dataset.captureScare = 'false';
    return;
  }
  timerLabel.textContent = formatTime(frame.remainingTicks);
  healthValue.textContent = String(Math.ceil(frame.ghostHealth));
  healthFill.style.transform = `scaleX(${Math.max(0, frame.ghostHealth / 100)})`;
  captureMarks.forEach((mark, index) => mark.classList.toggle('filled', index < frame.captureCount));
  batteryMeter.hidden = frame.viewerRole !== 'child';
  if (frame.viewerRole === 'child') {
    batteryFill.style.transform = `scaleX(${frame.ownBattery})`;
    batteryMeter.classList.toggle('low', frame.ownBattery < 0.15);
  }
  updateBatteryLocator(frame);
  if (frame.phase === 'capture-animation') {
    const caught = frame.capture?.childPlayerId === frame.viewerPlayerId;
    showBanner(caught ? '你被抓住了' : '鬼抓住了一个孩子', 'danger');
  } else if (frame.phase === 'protection') {
    showBanner('保护时间 · 计时暂停', 'safe');
  } else {
    eventBanner.hidden = true;
  }
  document.documentElement.dataset.captureScare = String(isCaptureCinematicViewer(frame));
}

function updateBatteryLocator(frame: ViewerFrame): void {
  const ownPosition = ownActorPosition(frame);
  let battery = frame.battery ?? null;
  if (ownPosition) {
    for (const candidate of frame.batteries) {
      if (!battery) {
        battery = candidate;
        continue;
      }
      const candidateDistance = Math.hypot(
        candidate.position.x - ownPosition.x,
        candidate.position.z - ownPosition.z,
      );
      const currentDistance = Math.hypot(
        battery.position.x - ownPosition.x,
        battery.position.z - ownPosition.z,
      );
      if (candidateDistance < currentDistance) battery = candidate;
    }
  }
  const visible = frame.viewerRole === 'child'
    && frame.phase !== 'capture-animation'
    && Boolean(battery)
    && Boolean(ownPosition);
  batteryLocator.hidden = !visible;
  if (!visible || frame.viewerRole !== 'child' || !battery || !ownPosition) return;

  stage.camera.updateMatrixWorld();
  batteryScreenPoint.set(battery.position.x, 0, battery.position.z).project(stage.camera);
  ownScreenPoint.set(ownPosition.x, 0, ownPosition.z).project(stage.camera);
  const bounds = canvas.getBoundingClientRect();
  const targetX = bounds.left + (batteryScreenPoint.x + 1) * bounds.width * 0.5;
  const targetY = bounds.top + (1 - batteryScreenPoint.y) * bounds.height * 0.5;
  const sourceX = bounds.left + (ownScreenPoint.x + 1) * bounds.width * 0.5;
  const sourceY = bounds.top + (1 - ownScreenPoint.y) * bounds.height * 0.5;
  const safeArea = {
    left: bounds.left + 96,
    right: bounds.right - 96,
    top: bounds.top + 168,
    bottom: bounds.bottom - 132,
  };
  const onScreen = targetX >= safeArea.left
    && targetX <= safeArea.right
    && targetY >= safeArea.top
    && targetY <= safeArea.bottom;
  const locatorX = clamp(targetX, safeArea.left, safeArea.right);
  const locatorY = clamp(targetY - (onScreen ? 42 : 0), safeArea.top, safeArea.bottom);
  const bearingRadians = Math.atan2(targetY - sourceY, targetX - sourceX);
  const distance = Math.hypot(
    battery.position.x - ownPosition.x,
    battery.position.z - ownPosition.z,
  );
  const distanceText = `${distance < 10 ? distance.toFixed(1) : Math.round(distance)}m`;

  batteryLocator.style.left = `${locatorX}px`;
  batteryLocator.style.top = `${locatorY}px`;
  batteryLocator.style.setProperty('--battery-bearing', `${bearingRadians}rad`);
  batteryLocator.dataset.offscreen = String(!onScreen);
  batteryLocator.dataset.side = locatorX > bounds.left + bounds.width / 2 ? 'right' : 'left';
  batteryLocator.setAttribute('aria-label', `备用电池，距离 ${distanceText}`);
  batteryDistance.textContent = distanceText;
}

function showBanner(text: string, tone: 'danger' | 'safe'): void {
  eventBanner.textContent = text;
  eventBanner.dataset.tone = tone;
  eventBanner.hidden = false;
}

function updateCamera(frame: ViewerFrame | null, deltaSeconds: number, immediate = false): void {
  if (sceneEditor) {
    sceneEditor.updateCamera();
    return;
  }
  const captureActive = Boolean(frame && isCaptureCinematicViewer(frame));
  if (captureActive && cameraRig.snapshot().pointerMode) {
    runtimeTuning.cameraPresets['whole-house'] = cameraRig.stopDeveloperControl();
    syncCameraDebugState(runtimeTuning.cameraPresets['whole-house']);
  }
  const mode: CameraMode = captureActive ? 'capture-closeup' : 'whole-house';
  cameraRig.update({
    mode,
    captureActive,
    baseTarget: captureActive && frame
      ? captureCameraTarget(frame)
      : { x: 0, y: 0, z: 0 },
    preset: runtimeTuning.cameraPresets[mode],
    deltaSeconds,
    responsiveness: captureActive
      ? runtimeTuning.captureCameraResponsiveness
      : runtimeTuning.cameraFollowResponsiveness,
    immediate: immediate || cameraSnapRequested,
  });
  cameraSnapRequested = false;
  refreshCameraMetrics();
}

function captureCameraTarget(frame: ViewerFrame): CameraVector {
  const ghost = frame.ghost;
  const child = frame.capture
    ? frame.children.find((candidate) => candidate.playerId === frame.capture?.childPlayerId)
    : undefined;
  if (!ghost) return { x: 0, y: 1, z: 0 };
  if (!child) return { x: ghost.position.x, y: 1, z: ghost.position.z };
  return {
    x: (ghost.position.x + child.position.x) / 2,
    y: 1,
    z: (ghost.position.z + child.position.z) / 2,
  };
}

function calculateFacing(movement: { x: number; z: number }): number {
  if (Math.hypot(movement.x, movement.z) > 0) {
    lastFacingRadians = Math.atan2(movement.z, movement.x);
  }
  return lastFacingRadians;
}

function ownActorPosition(frame: ViewerFrame): { x: number; z: number } | null {
  if (frame.viewerRole === 'ghost') return frame.ghost.position;
  return frame.children.find((child) => child.playerId === frame.viewerPlayerId)?.position ?? null;
}

function updateGhostAudio(frame: ViewerFrame | null): void {
  const ghost = frame?.ghost;
  const visible = Boolean(ghost);
  const burning = Boolean(ghost?.burning);
  if (visible && burning && !lastGhostVisible && frame?.viewerRole === 'child') {
    audio.playIgnition();
  }
  if (frame?.viewerRole === 'ghost' && burning && !lastGhostBurning) {
    audio.playIgnition();
  }
  audio.setFireLoop(visible && burning, frame?.viewerRole === 'ghost' ? 0.26 : 0.16);
  lastGhostVisible = visible;
  lastGhostBurning = burning;
}

function isCaptureCinematicViewer(frame: ViewerFrame): boolean {
  return Boolean(
    frame.capture
    && frame.ghost
    && (frame.viewerRole === 'ghost' || frame.capture.childPlayerId === frame.viewerPlayerId),
  );
}

function updateControlHint(frame: ViewerFrame): void {
  controlHint.textContent = frame.viewerRole === 'ghost'
    ? frame.ghost.burning
      ? '灼烧中 · 无法抓取 · WASD 或方向键逃离光束'
      : 'WASD 或方向键移动 · 接触孩子自动抓取'
    : 'WASD 或方向键移动并朝向 · 空格手电';
}

async function installDebugGui(): Promise<void> {
  await cameraRig.installDeveloperControls(canvas, {
    poseChanged: handleDeveloperCameraPoseChanged,
    pointerModeChanged: handleCameraPointerModeChanged,
  });
  const { GUI } = await import('lil-gui');
  if (debugGui || deterministicState) return;
  const gui = new GUI({ title: '开发调试 · DEV', width: 310 });
  gui.domElement.dataset.testid = 'debug-panel';
  const cameraFolder = gui.addFolder('镜头');
  cameraPointerController = cameraFolder
    .add({ toggle: () => setCameraPointerMode(!cameraDebugState.pointerMode) }, 'toggle')
    .name('进入鼠标调镜头')

  const positionFolder = cameraFolder.addFolder('相对地图中心的位置');
  const positionX = positionFolder.add(cameraDebugState, 'positionX', -40, 40, 0.05)
    .name('位置 X').onChange(applyCameraDebugPreset);
  const positionY = positionFolder.add(cameraDebugState, 'positionY', 1, 50, 0.05)
    .name('位置 Y').onChange(applyCameraDebugPreset);
  const positionZ = positionFolder.add(cameraDebugState, 'positionZ', -40, 40, 0.05)
    .name('位置 Z').onChange(applyCameraDebugPreset);
  const targetFolder = cameraFolder.addFolder('相对地图中心的朝向点');
  const targetX = targetFolder.add(cameraDebugState, 'targetX', -20, 20, 0.05)
    .name('目标 X').onChange(applyCameraDebugPreset);
  const targetY = targetFolder.add(cameraDebugState, 'targetY', -5, 12, 0.05)
    .name('目标 Y').onChange(applyCameraDebugPreset);
  const targetZ = targetFolder.add(cameraDebugState, 'targetZ', -20, 20, 0.05)
    .name('目标 Z').onChange(applyCameraDebugPreset);
  const viewHeight = cameraFolder.add(cameraDebugState, 'viewHeight', 3, 36, 0.05)
    .name('正交视野高度').onChange(applyCameraDebugPreset);
  const tilt = cameraFolder.add(cameraDebugState, 'tiltDegrees', 0, 90, 0.01).name('倾角°').disable();
  const azimuth = cameraFolder.add(cameraDebugState, 'azimuthDegrees', -180, 180, 0.01).name('方位角°').disable();
  const distance = cameraFolder.add(cameraDebugState, 'distance', 0, 100, 0.01).name('镜头距离').disable();
  cameraFolder.add({ restore: restoreRecommendedCameraPresets }, 'restore').name('恢复推荐值');
  cameraFolder.add({ copy: () => void copySelectedCameraPreset('typescript') }, 'copy').name('复制 TypeScript');
  cameraFolder.add({ copy: () => void copySelectedCameraPreset('json') }, 'copy').name('复制 JSON');
  cameraValueControllers = [
    positionX,
    positionY,
    positionZ,
    targetX,
    targetY,
    targetZ,
    viewHeight,
  ];
  cameraMetricControllers = [tilt, azimuth, distance];
  positionFolder.close();
  targetFolder.close();
  const movementFolder = gui.addFolder('房间移动（房主）');
  movementFolder
    .add(runtimeTuning, 'childMoveSpeed', 1, 8, 0.05)
    .name('小孩速度')
    .onChange(queueDebugGameplayTuning);
  movementFolder
    .add(runtimeTuning, 'ghostMoveSpeed', 1, 8, 0.05)
    .name('鬼速度')
    .onChange(queueDebugGameplayTuning);
  const sensingFolder = gui.addFolder('感应与手电（房主）');
  sensingFolder
    .add(runtimeTuning, 'headlampDetectionRange', 1, 20, 0.1)
    .name('灯感应范围')
    .onChange(queueDebugGameplayTuning);
  sensingFolder
    .add(runtimeTuning, 'flashlightLength', 0.5, 12, 0.1)
    .name('手电距离')
    .onChange(queueDebugGameplayTuning);
  sensingFolder
    .add(runtimeTuning, 'flashlightConeDegrees', 5, 90, 1)
    .name('手电宽度°')
    .onChange(queueDebugGameplayTuning);
  infiniteGhostHealthController = sensingFolder
    .add({ toggle: () => toggleInfiniteResource('infiniteGhostHealth') }, 'toggle')
    .name('鬼生命无限：关');
  infiniteFlashlightEnergyController = sensingFolder
    .add({ toggle: () => toggleInfiniteResource('infiniteFlashlightEnergy') }, 'toggle')
    .name('手电能源无限：关');
  refreshInfiniteResourceToggleLabels();
  movementFolder.close();
  sensingFolder.close();
  debugGui = gui;
  refreshCameraMetrics();
  setDebugUiHidden(debugGuiHidden);
}

async function installSceneEditor(): Promise<void> {
  lobbyPanel.hidden = true;
  gameHud.hidden = true;
  eventBanner.hidden = true;
  audioButton.hidden = true;
  resultOverlay.hidden = true;
  milestone.hidden = true;
  const { SceneEditor } = await import('./game/SceneEditor');
  sceneEditor = new SceneEditor({
    scene: world.scene,
    camera: stage.camera,
    canvas,
    onPlaytest: navigateToScenePlaytest,
  });
  await sceneEditor.ready;
}

function installScenePlaytestUi(): void {
  lobbyPanel.hidden = Boolean(scenePlaytest);
  gameHud.hidden = !scenePlaytest;
  eventBanner.hidden = true;
  resultOverlay.hidden = true;
  milestone.hidden = true;
  document.documentElement.dataset.scenePlaytest = 'true';
  const toolbar = document.createElement('nav');
  toolbar.className = 'scene-playtest-toolbar';
  toolbar.dataset.testid = 'scene-playtest-toolbar';
  const roleLabelText = scenePlaytestRole === 'ghost' ? '鬼' : '小孩';
  toolbar.innerHTML = `
    <span class="scene-playtest-toolbar__label">草稿试玩 · ${escapeHtml(scenePlaytestHouse?.definition.id ?? '草稿不可用')} · ${roleLabelText}</span>
    <button type="button" data-scene-playtest-switch>${scenePlaytestRole === 'ghost' ? '改用小孩' : '改用鬼'}</button>
    <button type="button" data-scene-playtest-return>返回编辑器</button>
  `;
  toolbar.querySelector<HTMLButtonElement>('[data-scene-playtest-switch]')?.addEventListener('click', () => {
    navigateToScenePlaytest(scenePlaytestRole === 'ghost' ? 'child' : 'ghost');
  });
  toolbar.querySelector<HTMLButtonElement>('[data-scene-playtest-return]')?.addEventListener('click', navigateToSceneEditor);
  document.body.append(toolbar);
  scenePlaytestToolbar = toolbar;
  window.addEventListener('keydown', handleScenePlaytestKeyDown);
  if (!scenePlaytest) {
    lobbyActions.hidden = true;
    roomPanel.hidden = true;
    errorMessage.textContent = '没有可试玩的有效草稿，请返回编辑器修正场景问题。';
  }
}

function handleScenePlaytestKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  navigateToSceneEditor();
}

function navigateToScenePlaytest(role: ScenePlaytestRole): void {
  const url = cleanModeUrl();
  url.searchParams.set(SCENE_PLAYTEST_QUERY_PARAM, role);
  window.location.assign(url);
}

function navigateToSceneEditor(): void {
  const url = cleanModeUrl();
  url.searchParams.set('sceneEditor', '1');
  window.location.assign(url);
}

function cleanModeUrl(): URL {
  const url = new URL(window.location.href);
  url.search = '';
  return url;
}

function loadPlayableHouseDraft(): CompiledHouseScene | null {
  const draft = loadHouseSceneDraft();
  if (!draft) return null;
  const compiled = compileHouseScene(draft);
  return compiled.issues.some((issue) => issue.severity === 'error') ? null : compiled;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

function applyCameraDebugPreset(): void {
  runtimeTuning.cameraPresets['whole-house'] = cameraPresetFromDebugState();
  cameraSnapRequested = true;
}

function setCameraPointerMode(enabled: boolean): void {
  if (enabled) {
    const started = cameraRig.startDeveloperControl(
      'whole-house',
      { x: 0, y: 0, z: 0 },
      runtimeTuning.cameraPresets['whole-house'],
    );
    if (!started) handleCameraPointerModeChanged(false);
    return;
  }
  const preset = cameraRig.stopDeveloperControl();
  runtimeTuning.cameraPresets['whole-house'] = preset;
  syncCameraDebugState(preset);
}

function handleDeveloperCameraPoseChanged(): void {
  runtimeTuning.cameraPresets['whole-house'] = cameraRig.currentPreset();
  syncCameraDebugState(runtimeTuning.cameraPresets['whole-house']);
  refreshCameraMetrics();
}

function handleCameraPointerModeChanged(enabled: boolean): void {
  cameraDebugState.pointerMode = enabled;
  cameraPointerController
    ?.name(enabled ? '退出鼠标调镜头' : '进入鼠标调镜头')
    .updateDisplay();
  for (const controller of cameraValueControllers) {
    if (enabled) controller.disable();
    else controller.enable();
  }
}

function restoreRecommendedCameraPresets(): void {
  runtimeTuning.cameraPresets = createRecommendedCameraPresets();
  syncCameraDebugState(runtimeTuning.cameraPresets['whole-house']);
  cameraSnapRequested = true;
}

async function copySelectedCameraPreset(format: 'typescript' | 'json'): Promise<void> {
  const mode: CameraMode = 'whole-house';
  const text = formatCameraPreset(mode, runtimeTuning.cameraPresets[mode], format);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy copy path when clipboard permission is unavailable.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function refreshCameraMetrics(): void {
  if (!debugGui) return;
  const snapshot = cameraRig.snapshot();
  cameraDebugState.tiltDegrees = snapshot.tiltDegrees;
  cameraDebugState.azimuthDegrees = snapshot.azimuthDegrees;
  cameraDebugState.distance = snapshot.distance;
  for (const controller of cameraMetricControllers) controller.updateDisplay();
}

function syncCameraDebugState(preset: CameraPreset): void {
  cameraDebugState.positionX = preset.position.x;
  cameraDebugState.positionY = preset.position.y;
  cameraDebugState.positionZ = preset.position.z;
  cameraDebugState.targetX = preset.target.x;
  cameraDebugState.targetY = preset.target.y;
  cameraDebugState.targetZ = preset.target.z;
  cameraDebugState.viewHeight = preset.viewHeight;
  for (const controller of cameraValueControllers) controller.updateDisplay();
}

function cameraPresetFromDebugState(): CameraPreset {
  return {
    position: {
      x: cameraDebugState.positionX,
      y: cameraDebugState.positionY,
      z: cameraDebugState.positionZ,
    },
    target: {
      x: cameraDebugState.targetX,
      y: cameraDebugState.targetY,
      z: cameraDebugState.targetZ,
    },
    viewHeight: cameraDebugState.viewHeight,
  };
}

function queueDebugGameplayTuning(): void {
  if (!client.session?.isHost) {
    const serverTuning = client.roomState?.debugGameplayTuning;
    if (serverTuning) Object.assign(runtimeTuning, serverTuning);
    debugGui?.controllersRecursive().forEach((controller) => controller.updateDisplay());
    refreshInfiniteResourceToggleLabels();
    return;
  }
  if (debugTuningTimer) clearTimeout(debugTuningTimer);
  debugTuningTimer = setTimeout(() => {
    debugTuningTimer = null;
    void client.setDebugTuning({
      childMoveSpeed: runtimeTuning.childMoveSpeed,
      ghostMoveSpeed: runtimeTuning.ghostMoveSpeed,
      headlampDetectionRange: runtimeTuning.headlampDetectionRange,
      flashlightLength: runtimeTuning.flashlightLength,
      flashlightConeDegrees: runtimeTuning.flashlightConeDegrees,
      infiniteGhostHealth: runtimeTuning.infiniteGhostHealth,
      infiniteFlashlightEnergy: runtimeTuning.infiniteFlashlightEnergy,
    });
  }, 80);
}

function setDebugUiHidden(hidden: boolean): void {
  debugGuiHidden = hidden;
  milestone.hidden = hidden;
  if (debugGui) debugGui.domElement.style.display = hidden ? 'none' : '';
}

function updateDiagnostics(frame: ViewerFrame | null): void {
  const network = client.networkStats();
  const presentation = presenter.stats();
  const camera = cameraRig.snapshot();
  const diagnostics: NonNullable<typeof window.__THREE_GAME_DIAGNOSTICS__> & {
    camera: ReturnType<CameraRig['snapshot']>;
  } = {
    phase: deterministicState || scenePlaytest
      ? (frame?.phase === 'ended' ? 'ended' : 'playing')
      : client.roomState?.phase ?? 'lobby',
    matchPhase: frame?.phase ?? null,
    deterministicState,
    scenePlaytestRole: scenePlaytest?.role ?? null,
    frame: renderFrame,
    fps: measuredFps,
    networkConnected: client.connected,
    roomCode: client.roomState?.roomCode ?? null,
    role: frame?.viewerRole ?? null,
    serverTick: frame?.tick ?? null,
    ackSeq: client.latestFrame?.ackSeq ?? null,
    ownPosition: frame ? ownActorPosition(frame) : null,
    viewerFrame: frame,
    cameraMode: camera.mode,
    cameraViewHeight: camera.viewHeight,
    camera,
    capturedChildPlayerId: frame?.capture?.childPlayerId ?? null,
    tuning: { ...runtimeTuning },
    world: world.metrics(),
    input: { actionHeld: input.actionHeld() },
    network: {
      ...network,
      ...presentation,
    },
    audio: audio.metrics(),
    renderer: {
      calls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      points: stage.renderer.info.render.points,
      lines: stage.renderer.info.render.lines,
      geometries: stage.renderer.info.memory.geometries,
      textures: stage.renderer.info.memory.textures,
    },
  };
  window.__THREE_GAME_DIAGNOSTICS__ = diagnostics;
}

type InfiniteResourceKey = 'infiniteGhostHealth' | 'infiniteFlashlightEnergy';

function toggleInfiniteResource(key: InfiniteResourceKey): void {
  runtimeTuning[key] = !runtimeTuning[key];
  refreshInfiniteResourceToggleLabels();
  queueDebugGameplayTuning();
}

function refreshInfiniteResourceToggleLabels(): void {
  infiniteGhostHealthController?.name(
    `鬼生命无限：${runtimeTuning.infiniteGhostHealth ? '开' : '关'}`,
  );
  infiniteFlashlightEnergyController?.name(
    `手电能源无限：${runtimeTuning.infiniteFlashlightEnergy ? '开' : '关'}`,
  );
}

function formatTime(ticks: number): string {
  const seconds = Math.max(0, Math.ceil(ticks / 60));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isCameraMode(value: string): value is CameraMode {
  return value === 'follow' || value === 'whole-house' || value === 'capture-closeup';
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function createTemporaryNickname(): string {
  const adjectives = ['安静', '勇敢', '机灵', '迷路', '警觉', '发光'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}访客${Math.floor(Math.random() * 900 + 100)}`;
}

interface CameraDebugState {
  pointerMode: boolean;
  positionX: number;
  positionY: number;
  positionZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  viewHeight: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  distance: number;
}

function createCameraDebugState(preset: CameraPreset): CameraDebugState {
  return {
    pointerMode: false,
    positionX: preset.position.x,
    positionY: preset.position.y,
    positionZ: preset.position.z,
    targetX: preset.target.x,
    targetY: preset.target.y,
    targetZ: preset.target.z,
    viewHeight: preset.viewHeight,
    tiltDegrees: 0,
    azimuthDegrees: 0,
    distance: 0,
  };
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required DOM element: ${selector}`);
  return element;
}
