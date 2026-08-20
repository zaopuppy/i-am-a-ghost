import * as THREE from 'three';
import { loadFurnitureLibrary, type FurnitureLibrary } from '../assets/EnvironmentAssets';
import {
  createHouseMaterialKit,
  createWallpaperWallGeometry,
  type HouseMaterialKit,
} from '../assets/MaterialLibrary';
import {
  batterySpawnSubjectId,
  cloneHouseScene,
  compileHouseScene,
  createHouseBoundaryWalls,
  FURNITURE_ASSET_IDS,
  FURNITURE_CATALOG,
  GHOST_SPAWN_SUBJECT_ID,
  isHouseSceneDefinition,
  type FurnitureAssetId,
  type FurniturePlacement,
  type HouseRoomDefinition,
  type HouseSceneDefinition,
  type HouseSceneIssue,
} from './HouseScene';
import {
  loadHouseSceneDraft,
  serializeHouseScene,
  storeHouseSceneDraft,
} from './HouseSceneDraft';
import { DEFAULT_HOUSE_SCENE } from './defaultHouseScene';
import {
  SceneEditorCamera,
  type SceneEditorCameraSnapshot,
  type SceneEditorViewportMode,
} from './SceneEditorCamera';

type EditorKind = 'furniture' | 'room' | 'wall' | 'ghost-spawn' | 'battery-spawn';
type IssueFilter = 'all' | 'error' | 'warning' | 'outside-room';

interface EditorSelection {
  kind: EditorKind;
  id: string;
}

export interface SceneEditorOptions {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  canvas: HTMLCanvasElement;
}

export interface SceneEditorSnapshot {
  scene: HouseSceneDefinition;
  selection: EditorSelection | null;
  viewport: SceneEditorCameraSnapshot;
  panelCollapsed: boolean;
  furnitureCount: number;
  movementColliderCount: number;
  errors: number;
  warnings: number;
  issues: readonly HouseSceneIssue[];
}

export class SceneEditor {
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly structureGroup = new THREE.Group();
  private readonly furnitureGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly materials: HouseMaterialKit = createHouseMaterialKit();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly groundPoint = new THREE.Vector3();
  private readonly furnitureRoots = new Map<string, THREE.Group>();
  private readonly hiddenEnvironment: THREE.Object3D[] = [];
  private readonly panel: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly issueList: HTMLElement;
  private readonly status: HTMLElement;
  private readonly roomSelect: HTMLSelectElement;
  private readonly assetSelect: HTMLSelectElement;
  private readonly importInput: HTMLInputElement;
  private readonly cameraControls: SceneEditorCamera;
  private readonly cameraStatus: HTMLOutputElement;
  private readonly issueFilterSelect: HTMLSelectElement;
  private sceneDefinition = cloneHouseScene(DEFAULT_HOUSE_SCENE);
  private library: FurnitureLibrary | null = null;
  private selection: EditorSelection | null = null;
  private issues: readonly HouseSceneIssue[] = [];
  private showColliders = true;
  private showSafetyZones = true;
  private snapSize = 0.1;
  private dragging = false;
  private dragMoved = false;
  private dragOffset = { x: 0, z: 0 };
  private panelCollapsed = false;
  private frameRequest = 0;
  private issueFilter: IssueFilter = 'all';
  private readonly dismissedIssueKeys = new Set<string>();
  private history = [serializeHouseScene(this.sceneDefinition)];
  private historyIndex = 0;

  constructor(private readonly options: SceneEditorOptions) {
    const storedDraft = loadHouseSceneDraft();
    if (storedDraft) {
      this.sceneDefinition = storedDraft;
      this.history = [serializeHouseScene(storedDraft)];
    }
    this.root.name = 'scene-editor-preview';
    this.structureGroup.name = 'scene-editor-structure';
    this.furnitureGroup.name = 'scene-editor-furniture';
    this.overlayGroup.name = 'scene-editor-overlays';
    this.root.add(this.structureGroup, this.furnitureGroup, this.overlayGroup);
    options.scene.add(this.root);
    for (const name of ['house-stage', 'box-walls']) {
      const object = options.scene.getObjectByName(name);
      if (!object) continue;
      object.visible = false;
      this.hiddenEnvironment.push(object);
    }

    this.panel = this.buildPanel();
    this.inspector = requireEditorElement(this.panel, '[data-editor-inspector]');
    this.issueList = requireEditorElement(this.panel, '[data-editor-issues]');
    this.status = requireEditorElement(this.panel, '[data-editor-status]');
    this.roomSelect = requireEditorElement(this.panel, '[data-editor-room]');
    this.assetSelect = requireEditorElement(this.panel, '[data-editor-asset]');
    this.importInput = requireEditorElement(this.panel, '[data-editor-import]');
    this.cameraStatus = requireEditorElement(this.panel, '[data-editor-camera-status]');
    this.issueFilterSelect = requireEditorElement(this.panel, '[data-editor-issue-filter]');
    document.body.append(this.panel);
    document.documentElement.dataset.sceneEditor = 'true';
    document.documentElement.dataset.sceneEditorPanel = 'open';
    this.cameraControls = new SceneEditorCamera(options.camera, options.canvas);
    this.populatePalette();
    this.bindUi();
    this.setViewportMode('edit');
    this.renderPreview();
    this.options.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.options.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.options.canvas.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
    this.installTestHooks();
    this.scheduleFrameHouse();
    this.ready = loadFurnitureLibrary(this.materials).then((library) => {
      this.library = library;
      this.syncFurniture();
      this.renderOverlays();
    });
  }

  snapshot(): SceneEditorSnapshot {
    const compiled = compileHouseScene(this.sceneDefinition);
    return {
      scene: cloneHouseScene(this.sceneDefinition),
      selection: this.selection ? { ...this.selection } : null,
      viewport: this.cameraControls.snapshot(),
      panelCollapsed: this.panelCollapsed,
      furnitureCount: compiled.furniture.length,
      movementColliderCount: compiled.map.movementObstacles?.length ?? 0,
      errors: compiled.issues.filter((issue) => issue.severity === 'error').length,
      warnings: compiled.issues.filter((issue) => issue.severity === 'warning').length,
      issues: compiled.issues.map((issue) => ({ ...issue })),
    };
  }

  updateCamera(): void {
    this.cameraControls.update();
  }

  dispose(): void {
    this.options.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.options.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.options.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.cameraControls.dispose();
    delete this.options.canvas.dataset.editorViewportMode;
    this.panel.remove();
    this.root.removeFromParent();
    disposeGeneratedGroup(this.structureGroup, false);
    disposeGeneratedGroup(this.overlayGroup);
    for (const object of this.hiddenEnvironment) object.visible = true;
    this.materials.dispose();
    document.documentElement.removeAttribute('data-scene-editor');
    document.documentElement.removeAttribute('data-scene-editor-panel');
    delete window.__HOUSE_SCENE_EDITOR__;
  }

  private buildPanel(): HTMLElement {
    const panel = document.createElement('aside');
    panel.className = 'scene-editor';
    panel.dataset.testid = 'scene-editor';
    panel.innerHTML = `
      <header class="scene-editor__header">
        <div class="scene-editor__header-row">
          <div class="scene-editor__title-block">
            <p class="scene-editor__kicker">DEV CARTOGRAPHY / 01</p>
            <h1>房屋制图台</h1>
          </div>
          <button type="button" class="scene-editor__collapse" data-editor-collapse aria-label="收起面板" aria-expanded="true" title="收起面板">‹</button>
        </div>
        <p>拖动画布中的家具、房间、墙体或出生/刷新点。橙色区域必须保持畅通。</p>
      </header>
      <section class="scene-editor__section scene-editor__palette">
        <label>目标房间<select data-editor-room></select></label>
        <label>家具模型<select data-editor-asset></select></label>
        <div class="scene-editor__actions">
          <button type="button" data-editor-add-furniture>放置家具</button>
          <button type="button" data-editor-add-wall>增加墙段</button>
        </div>
      </section>
      <section class="scene-editor__section scene-editor__inspector" data-editor-inspector></section>
      <section class="scene-editor__section scene-editor__view">
        <div class="scene-editor__section-title"><span>视口导航</span><output data-editor-camera-status>编辑对象</output></div>
        <div class="scene-editor__mode">
          <button type="button" data-editor-camera-mode="edit" aria-pressed="true">编辑对象</button>
          <button type="button" data-editor-camera-mode="navigate" aria-pressed="false">漫游地图</button>
          <button type="button" data-editor-frame-house>适配全屋</button>
        </div>
        <p class="scene-editor__camera-help">右键旋转 · 中键平移 · 滚轮缩放；漫游模式下左键也可平移。</p>
        <p class="scene-editor__overlay-legend"><i data-mark="room"></i>房间 <i data-mark="collider"></i>碰撞 <i data-mark="safety"></i>门洞 <i data-mark="ghost"></i>鬼 <i data-mark="battery"></i>电池</p>
        <label><input type="checkbox" data-editor-colliders checked> 显示碰撞脚印</label>
        <label><input type="checkbox" data-editor-safety checked> 显示门洞与出生/刷新点</label>
        <label>网格吸附
          <select data-editor-snap>
            <option value="0.1">0.1m</option>
            <option value="0.25">0.25m</option>
            <option value="0.5">0.5m</option>
            <option value="0">关闭</option>
          </select>
        </label>
      </section>
      <section class="scene-editor__section scene-editor__issues">
        <div class="scene-editor__section-title"><span>当前问题</span><output data-editor-status></output></div>
        <p class="scene-editor__issue-help">不是历史日志：修正摆放后问题会自动消失。点击条目可选择并定位对象。</p>
        <div class="scene-editor__issue-tools">
          <select data-editor-issue-filter aria-label="问题筛选">
            <option value="all">全部问题</option>
            <option value="outside-room">仅家具越界</option>
            <option value="error">仅错误</option>
            <option value="warning">仅警告</option>
          </select>
          <button type="button" data-editor-clear-issues>清除已读</button>
          <button type="button" data-editor-restore-issues>恢复</button>
        </div>
        <ol data-editor-issues></ol>
      </section>
      <footer class="scene-editor__footer">
        <div class="scene-editor__actions scene-editor__actions--quiet">
          <button type="button" data-editor-undo>撤销</button>
          <button type="button" data-editor-redo>重做</button>
          <button type="button" data-editor-delete>删除</button>
          <button type="button" data-editor-reset>复原</button>
        </div>
        <div class="scene-editor__actions">
          <button type="button" data-editor-copy>复制 JSON</button>
          <button type="button" data-editor-download>下载</button>
          <button type="button" data-editor-import-button>导入</button>
          <input type="file" accept="application/json,.json" data-editor-import hidden>
        </div>
        <p class="scene-editor__keys">V 切换编辑/漫游 · F 适配全屋 · Q / E 旋转 15° · R 旋转 90° · Delete 删除 · Ctrl+Z 撤销</p>
      </footer>
    `;
    return panel;
  }

  private populatePalette(): void {
    this.roomSelect.replaceChildren(...this.sceneDefinition.rooms.map((room) => option(room.id, room.name)));
    this.assetSelect.replaceChildren(...FURNITURE_ASSET_IDS.map((id) => option(id, FURNITURE_CATALOG[id].label)));
  }

  private bindUi(): void {
    this.button('[data-editor-collapse]').addEventListener('click', () => this.togglePanel());
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-editor-camera-mode]')) {
      button.addEventListener('click', () => {
        const mode = button.dataset.editorCameraMode;
        if (mode === 'edit' || mode === 'navigate') this.setViewportMode(mode);
      });
    }
    this.button('[data-editor-frame-house]').addEventListener('click', () => this.cameraControls.frameHouse());
    this.issueFilterSelect.addEventListener('change', () => {
      this.issueFilter = this.issueFilterSelect.value as IssueFilter;
      this.renderIssues();
    });
    this.button('[data-editor-clear-issues]').addEventListener('click', () => {
      for (const issue of this.filteredIssues()) this.dismissedIssueKeys.add(issueKey(issue));
      this.renderIssues();
    });
    this.button('[data-editor-restore-issues]').addEventListener('click', () => {
      this.dismissedIssueKeys.clear();
      this.renderIssues();
    });
    this.button('[data-editor-add-furniture]').addEventListener('click', () => this.addFurniture());
    this.button('[data-editor-add-wall]').addEventListener('click', () => this.addWall());
    this.button('[data-editor-delete]').addEventListener('click', () => this.deleteSelection());
    this.button('[data-editor-reset]').addEventListener('click', () => {
      this.sceneDefinition = cloneHouseScene(DEFAULT_HOUSE_SCENE);
      this.selection = null;
      this.populatePalette();
      this.renderPreview();
      this.commitHistory();
    });
    this.button('[data-editor-undo]').addEventListener('click', () => this.undo());
    this.button('[data-editor-redo]').addEventListener('click', () => this.redo());
    this.button('[data-editor-copy]').addEventListener('click', () => void this.copyJson());
    this.button('[data-editor-download]').addEventListener('click', () => this.downloadJson());
    this.button('[data-editor-import-button]').addEventListener('click', () => this.importInput.click());
    this.importInput.addEventListener('change', () => void this.importJson());
    this.checkbox('[data-editor-colliders]').addEventListener('change', (event) => {
      this.showColliders = (event.currentTarget as HTMLInputElement).checked;
      this.renderOverlays();
    });
    this.checkbox('[data-editor-safety]').addEventListener('change', (event) => {
      this.showSafetyZones = (event.currentTarget as HTMLInputElement).checked;
      this.renderOverlays();
    });
    this.select('[data-editor-snap]').addEventListener('change', (event) => {
      this.snapSize = Number((event.currentTarget as HTMLSelectElement).value);
    });
  }

  private renderPreview(): void {
    const compiled = compileHouseScene(this.sceneDefinition);
    this.issues = compiled.issues;
    this.dismissedIssueKeys.clear();
    this.syncStructure();
    this.syncFurniture();
    this.renderOverlays();
    this.renderInspector();
    this.renderIssues();
  }

  private syncStructure(): void {
    disposeGeneratedGroup(this.structureGroup, false);
    for (const room of this.sceneDefinition.rooms) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width, room.depth),
        this.materials.roomFloors[room.family],
      );
      floor.name = `editor-room-${room.id}`;
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(room.center.x, 0.052, room.center.z);
      markSelectable(floor, 'room', room.id);
      this.structureGroup.add(floor);
    }
    for (const wall of [
      ...this.sceneDefinition.walls,
      ...createHouseBoundaryWalls(this.sceneDefinition.bounds),
    ]) {
      const mesh = new THREE.Mesh(
        createWallpaperWallGeometry(wall, 2.8),
        this.materials.wall,
      );
      mesh.name = `editor-wall-${wall.id}`;
      mesh.position.set((wall.minX + wall.maxX) / 2, 1.4, (wall.minZ + wall.maxZ) / 2);
      if (!wall.id.startsWith('boundary:')) markSelectable(mesh, 'wall', wall.id);
      this.structureGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), this.materials.trim);
      edges.position.copy(mesh.position);
      this.structureGroup.add(edges);
    }
  }

  private syncFurniture(): void {
    if (!this.library) return;
    const compiled = compileHouseScene(this.sceneDefinition);
    const activeIds = new Set(compiled.furniture.map((placement) => placement.id));
    for (const [id, root] of this.furnitureRoots) {
      if (activeIds.has(id)) continue;
      root.removeFromParent();
      this.furnitureRoots.delete(id);
    }
    for (const placement of compiled.furniture) {
      const room = compiled.rooms.find((candidate) => candidate.id === placement.roomId);
      if (!room) continue;
      let root = this.furnitureRoots.get(placement.id);
      if (
        !root
        || root.userData.editorAsset !== placement.asset
        || root.userData.editorFamily !== room.family
      ) {
        root?.removeFromParent();
        root = this.library.instantiate(placement.asset, room.family);
        root.userData.editorAsset = placement.asset;
        root.userData.editorFamily = room.family;
        markSelectable(root, 'furniture', placement.id);
        this.furnitureGroup.add(root);
        this.furnitureRoots.set(placement.id, root);
      }
      root.name = `editor-furniture-${placement.id}`;
      root.position.set(placement.position.x, placement.elevation + 0.05, placement.position.z);
      root.rotation.y = placement.yawRadians;
      root.scale.setScalar(placement.scale);
    }
  }

  private renderOverlays(): void {
    disposeGeneratedGroup(this.overlayGroup);
    const compiled = compileHouseScene(this.sceneDefinition);
    const selectedRoomId = this.selection?.kind === 'room'
      ? this.selection.id
      : this.selection?.kind === 'furniture'
        ? this.selectedFurniture()?.roomId
        : undefined;
    for (const room of this.sceneDefinition.rooms) {
      const selected = room.id === selectedRoomId;
      const outline = roomOutline(room, selected);
      outline.name = `editor-room-boundary-${room.id}`;
      this.overlayGroup.add(outline);
    }
    const invalidIds = new Set(compiled.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.subjectId));
    if (this.showColliders) {
      for (const placement of compiled.furniture) {
        if (!placement.collider) continue;
        const selected = this.selection?.kind === 'furniture' && this.selection.id === placement.id;
        const color = invalidIds.has(placement.id) ? 0xeb5d48 : selected ? 0xf4c95d : 0x55c7b0;
        const mesh = footprintMesh(placement.collider, color, selected ? 0.38 : 0.2, 0.09);
        mesh.name = `editor-collider-${placement.id}`;
        this.overlayGroup.add(mesh);
      }
    }
    if (this.showSafetyZones) {
      for (const clearance of compiled.doorClearances) {
        this.overlayGroup.add(footprintMesh(clearance, 0xf29d49, 0.2, 0.075));
      }
      const ghostMarker = spawnPointMarker(
        compiled.map.ghostSpawn,
        'ghost',
        this.selection?.kind === 'ghost-spawn',
      );
      ghostMarker.name = 'editor-ghost-spawn';
      markSelectable(ghostMarker, 'ghost-spawn', GHOST_SPAWN_SUBJECT_ID);
      this.overlayGroup.add(ghostMarker);
      for (const [index, spawn] of compiled.map.childSpawns.entries()) {
        const marker = spawnPointMarker(spawn, 'child', false);
        marker.name = `editor-child-spawn-${index + 1}`;
        this.overlayGroup.add(marker);
      }
      for (const [index, spawn] of compiled.map.batterySpawns.entries()) {
        const id = batterySpawnSubjectId(index);
        const selected = this.selection?.kind === 'battery-spawn' && this.selection.id === id;
        const marker = spawnPointMarker(spawn, 'battery', selected);
        marker.name = `editor-${id}`;
        markSelectable(marker, 'battery-spawn', id);
        this.overlayGroup.add(marker);
      }
    }
    if (this.selection?.kind === 'wall') {
      const wall = this.sceneDefinition.walls.find((candidate) => candidate.id === this.selection?.id);
      if (wall) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(
            wall.maxX - wall.minX + 0.08,
            2.9,
            wall.maxZ - wall.minZ + 0.08,
          )),
          new THREE.LineBasicMaterial({ color: 0xffd276 }),
        );
        outline.position.set((wall.minX + wall.maxX) / 2, 1.45, (wall.minZ + wall.maxZ) / 2);
        this.overlayGroup.add(outline);
      }
    }
  }

  private renderInspector(): void {
    this.button('[data-editor-delete]').disabled = !this.selection
      || this.selection.kind === 'ghost-spawn'
      || this.selection.kind === 'battery-spawn';
    if (!this.selection) {
      this.inspector.innerHTML = `
        <div class="scene-editor__empty">
          <span>尚未选择</span>
          <p>从画布选择家具、房间、墙段、鬼出生点或电池刷新点。拖动即可移动。</p>
        </div>
      `;
      return;
    }
    if (this.selection.kind === 'furniture') this.renderFurnitureInspector();
    if (this.selection.kind === 'room') this.renderRoomInspector();
    if (this.selection.kind === 'wall') this.renderWallInspector();
    if (this.selection.kind === 'ghost-spawn') this.renderGhostSpawnInspector();
    if (this.selection.kind === 'battery-spawn') this.renderBatterySpawnInspector();
  }

  private renderFurnitureInspector(): void {
    const placement = this.selectedFurniture();
    if (!placement) return;
    const room = this.sceneDefinition.rooms.find((candidate) => candidate.id === placement.roomId);
    if (!room) return;
    this.inspector.innerHTML = `
      <div class="scene-editor__section-title"><span>家具</span><code>${escapeHtml(placement.id)}</code></div>
      <div class="scene-editor__grid">
        <label>房间<select data-field="roomId">${this.sceneDefinition.rooms.map((candidate) =>
          optionMarkup(candidate.id, candidate.name, candidate.id === placement.roomId)).join('')}</select></label>
        <label>模型<select data-field="asset">${FURNITURE_ASSET_IDS.map((id) =>
          optionMarkup(id, FURNITURE_CATALOG[id].label, id === placement.asset)).join('')}</select></label>
        ${numberField('世界 X', 'x', room.center.x + placement.offsetX, 0.1)}
        ${numberField('世界 Z', 'z', room.center.z + placement.offsetZ, 0.1)}
        ${numberField('旋转角度', 'yaw', radiansToDegrees(placement.yawRadians ?? 0), 1)}
        ${numberField('缩放', 'scale', placement.scale ?? 1, 0.05, 0.1)}
        ${numberField('离地高度', 'elevation', placement.elevation ?? 0.012, 0.05, 0)}
      </div>
      <div class="scene-editor__actions scene-editor__actions--quiet">
        <button type="button" data-rotate="-15">左转 15°</button>
        <button type="button" data-rotate="15">右转 15°</button>
        <button type="button" data-rotate="90">转 90°</button>
      </div>
    `;
    this.bindInspectorSelect('roomId', (value) => {
      const nextRoom = this.sceneDefinition.rooms.find((candidate) => candidate.id === value);
      const previousRoom = this.sceneDefinition.rooms.find((candidate) => candidate.id === placement.roomId);
      if (!nextRoom || !previousRoom) return;
      const worldX = previousRoom.center.x + placement.offsetX;
      const worldZ = previousRoom.center.z + placement.offsetZ;
      placement.roomId = nextRoom.id;
      placement.offsetX = worldX - nextRoom.center.x;
      placement.offsetZ = worldZ - nextRoom.center.z;
    });
    this.bindInspectorSelect('asset', (value) => {
      if (FURNITURE_ASSET_IDS.includes(value as FurnitureAssetId)) {
        placement.asset = value as FurnitureAssetId;
      }
    });
    this.bindInspectorNumber('x', (value) => { placement.offsetX = value - room.center.x; });
    this.bindInspectorNumber('z', (value) => { placement.offsetZ = value - room.center.z; });
    this.bindInspectorNumber('yaw', (value) => { placement.yawRadians = degreesToRadians(value); });
    this.bindInspectorNumber('scale', (value) => { placement.scale = Math.max(0.1, value); });
    this.bindInspectorNumber('elevation', (value) => { placement.elevation = Math.max(0, value); });
    for (const button of this.inspector.querySelectorAll<HTMLButtonElement>('[data-rotate]')) {
      button.addEventListener('click', () => this.rotateSelection(Number(button.dataset.rotate)));
    }
  }

  private renderRoomInspector(): void {
    const room = this.selectedRoom();
    if (!room) return;
    this.inspector.innerHTML = `
      <div class="scene-editor__section-title"><span>房间</span><code>${escapeHtml(room.id)}</code></div>
      <div class="scene-editor__grid">
        <label>名称<input data-field="name" value="${escapeHtml(room.name)}"></label>
        <label>风格<select data-field="family">
          ${optionMarkup('living', '生活区', room.family === 'living')}
          ${optionMarkup('sleep', '睡眠区', room.family === 'sleep')}
          ${optionMarkup('old', '旧宅区', room.family === 'old')}
        </select></label>
        ${numberField('中心 X', 'x', room.center.x, 0.1)}
        ${numberField('中心 Z', 'z', room.center.z, 0.1)}
        ${numberField('宽度', 'width', room.width, 0.1, 1)}
        ${numberField('深度', 'depth', room.depth, 0.1, 1)}
      </div>
    `;
    const name = this.inspector.querySelector<HTMLInputElement>('[data-field="name"]');
    name?.addEventListener('change', () => this.applyInspectorMutation(() => { room.name = name.value.trim() || room.id; }));
    this.bindInspectorSelect('family', (value) => { room.family = value as HouseRoomDefinition['family']; });
    this.bindInspectorNumber('x', (value) => { room.center.x = value; });
    this.bindInspectorNumber('z', (value) => { room.center.z = value; });
    this.bindInspectorNumber('width', (value) => { room.width = Math.max(1, value); });
    this.bindInspectorNumber('depth', (value) => { room.depth = Math.max(1, value); });
  }

  private renderWallInspector(): void {
    const wall = this.selectedWall();
    if (!wall) return;
    const centerX = (wall.minX + wall.maxX) / 2;
    const centerZ = (wall.minZ + wall.maxZ) / 2;
    this.inspector.innerHTML = `
      <div class="scene-editor__section-title"><span>墙段</span><code>${escapeHtml(wall.id)}</code></div>
      <div class="scene-editor__grid">
        ${numberField('中心 X', 'x', centerX, 0.1)}
        ${numberField('中心 Z', 'z', centerZ, 0.1)}
        ${numberField('宽度', 'width', wall.maxX - wall.minX, 0.1, 0.1)}
        ${numberField('深度', 'depth', wall.maxZ - wall.minZ, 0.1, 0.1)}
      </div>
    `;
    this.bindInspectorNumber('x', (value) => moveWall(wall, value, centerZ));
    this.bindInspectorNumber('z', (value) => moveWall(wall, centerX, value));
    this.bindInspectorNumber('width', (value) => resizeWall(wall, Math.max(0.1, value), wall.maxZ - wall.minZ));
    this.bindInspectorNumber('depth', (value) => resizeWall(wall, wall.maxX - wall.minX, Math.max(0.1, value)));
  }

  private renderGhostSpawnInspector(): void {
    this.renderSpawnInspector(
      '鬼出生点',
      GHOST_SPAWN_SUBJECT_ID,
      this.sceneDefinition.ghostSpawn,
      '紫色鬼脸环；每局开始和重置后，鬼会回到这里。',
    );
  }

  private renderBatterySpawnInspector(): void {
    const index = this.selectedBatterySpawnIndex();
    const spawn = index >= 0 ? this.sceneDefinition.batterySpawns[index] : undefined;
    if (!spawn) return;
    this.renderSpawnInspector(
      `电池刷新点 #${index + 1}`,
      batterySpawnSubjectId(index),
      spawn,
      '黄色电池环；这是随机生成电池时使用的候选位置。',
    );
  }

  private renderSpawnInspector(
    title: string,
    id: string,
    spawn: { x: number; z: number },
    description: string,
  ): void {
    this.inspector.innerHTML = `
      <div class="scene-editor__section-title"><span>${title}</span><code>${escapeHtml(id)}</code></div>
      <div class="scene-editor__grid">
        ${numberField('世界 X', 'x', spawn.x, 0.1)}
        ${numberField('世界 Z', 'z', spawn.z, 0.1)}
      </div>
      <p class="scene-editor__point-note">${description} 可拖动或输入坐标，但不能删除。</p>
    `;
    this.bindInspectorNumber('x', (value) => { spawn.x = value; });
    this.bindInspectorNumber('z', (value) => { spawn.z = value; });
  }

  private renderIssues(): void {
    const errors = this.issues.filter((issue) => issue.severity === 'error').length;
    const warnings = this.issues.length - errors;
    this.status.textContent = errors > 0 ? `${errors} 错误 · ${warnings} 警告` : warnings > 0 ? `${warnings} 条警告` : '可导出';
    this.status.dataset.valid = String(errors === 0);
    const activeKeys = new Set(this.issues.map(issueKey));
    for (const key of this.dismissedIssueKeys) {
      if (!activeKeys.has(key)) this.dismissedIssueKeys.delete(key);
    }
    const filteredIssues = this.filteredIssues();
    const visibleIssues = filteredIssues.filter((issue) => !this.dismissedIssueKeys.has(issueKey(issue)));
    this.issueList.replaceChildren(...visibleIssues.map((issue) => {
      const item = document.createElement('li');
      item.dataset.severity = issue.severity;
      item.dataset.code = issue.code;
      item.dataset.subjectId = issue.subjectId;
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `
        <span class="scene-editor__issue-meta"><b>${issueCodeLabel(issue.code)}</b><code>${escapeHtml(this.issueSubjectLabel(issue))}</code></span>
        <span>${escapeHtml(issue.message)}</span>
      `;
      button.addEventListener('click', () => {
        const kind = this.kindForSubject(issue.subjectId);
        if (!kind) return;
        this.selectObject(kind, issue.subjectId);
        const center = this.selectionCenter();
        if (center) this.cameraControls.focusPoint(center);
      });
      item.append(button);
      return item;
    }));
    if (this.issues.length === 0) {
      const item = document.createElement('li');
      item.className = 'scene-editor__valid';
      item.textContent = '门洞畅通，出生点与电池点全部连通。';
      this.issueList.append(item);
    } else if (visibleIssues.length === 0) {
      const item = document.createElement('li');
      item.className = 'scene-editor__empty-issues';
      item.textContent = filteredIssues.length > 0
        ? `已清除 ${filteredIssues.length} 条已读问题；点击“恢复”可重新显示。`
        : '当前筛选下没有问题。';
      this.issueList.append(item);
    }
    this.button('[data-editor-clear-issues]').disabled = visibleIssues.length === 0;
    this.button('[data-editor-restore-issues]').disabled = this.dismissedIssueKeys.size === 0;
    for (const selector of ['[data-editor-copy]', '[data-editor-download]']) {
      this.button(selector).disabled = errors > 0;
    }
    this.button('[data-editor-undo]').disabled = this.historyIndex <= 0;
    this.button('[data-editor-redo]').disabled = this.historyIndex >= this.history.length - 1;
  }

  private filteredIssues(): readonly HouseSceneIssue[] {
    if (this.issueFilter === 'all') return this.issues;
    if (this.issueFilter === 'outside-room') {
      return this.issues.filter((issue) => issue.code === 'outside-room');
    }
    return this.issues.filter((issue) => issue.severity === this.issueFilter);
  }

  private issueSubjectLabel(issue: HouseSceneIssue): string {
    if (issue.subjectId === GHOST_SPAWN_SUBJECT_ID) return '鬼出生点';
    const batteryIndex = this.sceneDefinition.batterySpawns.findIndex((_, index) =>
      batterySpawnSubjectId(index) === issue.subjectId,
    );
    if (batteryIndex >= 0) return `电池刷新点 #${batteryIndex + 1}`;
    const furniture = this.sceneDefinition.furniture.find((item) => item.id === issue.subjectId);
    if (!furniture) return issue.subjectId;
    return `${FURNITURE_CATALOG[furniture.asset]?.label ?? furniture.asset} · ${furniture.id}`;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.cameraControls.currentMode() === 'navigate') return;
    const hit = this.pick(event);
    if (!hit) {
      this.selectObject(null);
      return;
    }
    this.selectObject(hit.kind, hit.id);
    const point = this.groundIntersection(event);
    const center = this.selectionCenter();
    if (!point || !center) return;
    this.dragging = true;
    this.dragMoved = false;
    this.dragOffset = { x: center.x - point.x, z: center.z - point.z };
    this.options.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging || !this.selection) return;
    const point = this.groundIntersection(event);
    if (!point) return;
    const x = this.snap(point.x + this.dragOffset.x);
    const z = this.snap(point.z + this.dragOffset.z);
    this.moveSelection(x, z);
    this.dragMoved = true;
    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.dragMoved) this.commitHistory();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.setViewportMode(this.cameraControls.currentMode() === 'edit' ? 'navigate' : 'edit');
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.cameraControls.frameHouse();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    if (event.key.toLowerCase() === 'q') this.rotateSelection(-15);
    if (event.key.toLowerCase() === 'e') this.rotateSelection(15);
    if (event.key.toLowerCase() === 'r') this.rotateSelection(90);
  };

  private setViewportMode(mode: SceneEditorViewportMode): void {
    this.cameraControls.setMode(mode);
    this.cameraStatus.textContent = mode === 'edit' ? '编辑对象' : '漫游地图';
    this.options.canvas.dataset.editorViewportMode = mode;
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-editor-camera-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.editorCameraMode === mode));
    }
  }

  private togglePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
    this.panel.dataset.collapsed = String(this.panelCollapsed);
    document.documentElement.dataset.sceneEditorPanel = this.panelCollapsed ? 'collapsed' : 'open';
    const button = this.button('[data-editor-collapse]');
    button.textContent = this.panelCollapsed ? '›' : '‹';
    button.title = this.panelCollapsed ? '展开面板' : '收起面板';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!this.panelCollapsed));
    this.scheduleFrameHouse();
  }

  private scheduleFrameHouse(): void {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = requestAnimationFrame(() => {
        this.frameRequest = 0;
        this.cameraControls.frameHouse();
      });
    });
  }

  private pick(event: PointerEvent): EditorSelection | null {
    this.updateRay(event);
    for (const group of [this.overlayGroup, this.furnitureGroup, this.structureGroup]) {
      const hits = this.raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        let object: THREE.Object3D | null = hit.object;
        while (object && object !== this.root) {
          const kind = object.userData.editorKind as EditorKind | undefined;
          const id = object.userData.editorId as string | undefined;
          if (kind && id) return { kind, id };
          object = object.parent;
        }
      }
    }
    return null;
  }

  private groundIntersection(event: PointerEvent): THREE.Vector3 | null {
    this.updateRay(event);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.groundPoint);
  }

  private updateRay(event: PointerEvent): void {
    const bounds = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.options.camera);
  }

  private selectObject(kind: EditorKind | null, id?: string): void {
    this.selection = kind && id ? { kind, id } : null;
    if (kind === 'room' && id) this.roomSelect.value = id;
    if (kind === 'furniture') {
      const furniture = this.selectedFurniture();
      if (furniture) {
        this.roomSelect.value = furniture.roomId;
        this.assetSelect.value = furniture.asset;
      }
    }
    this.renderInspector();
    this.renderOverlays();
  }

  private moveSelection(x: number, z: number): void {
    if (this.selection?.kind === 'furniture') {
      const placement = this.selectedFurniture();
      if (!placement) return;
      const room = roomAt(this.sceneDefinition.rooms, { x, z })
        ?? this.sceneDefinition.rooms.find((candidate) => candidate.id === placement.roomId);
      if (!room) return;
      placement.roomId = room.id;
      placement.offsetX = x - room.center.x;
      placement.offsetZ = z - room.center.z;
    } else if (this.selection?.kind === 'room') {
      const room = this.selectedRoom();
      if (!room) return;
      room.center = { x, z };
    } else if (this.selection?.kind === 'wall') {
      const wall = this.selectedWall();
      if (!wall) return;
      moveWall(wall, x, z);
    } else if (this.selection?.kind === 'ghost-spawn') {
      this.sceneDefinition.ghostSpawn.x = x;
      this.sceneDefinition.ghostSpawn.z = z;
    } else if (this.selection?.kind === 'battery-spawn') {
      const spawn = this.selectedBatterySpawn();
      if (!spawn) return;
      spawn.x = x;
      spawn.z = z;
    }
    this.renderPreview();
  }

  private rotateSelection(degrees: number): void {
    const placement = this.selectedFurniture();
    if (!placement) return;
    placement.yawRadians = (placement.yawRadians ?? 0) + degreesToRadians(degrees);
    this.renderPreview();
    this.commitHistory();
  }

  private addFurniture(): void {
    const room = this.sceneDefinition.rooms.find((candidate) => candidate.id === this.roomSelect.value)
      ?? this.sceneDefinition.rooms[0];
    const asset = this.assetSelect.value as FurnitureAssetId;
    if (!room || !FURNITURE_ASSET_IDS.includes(asset)) return;
    const id = uniqueId(`${room.id}-${asset}`, this.sceneDefinition.furniture.map((item) => item.id));
    this.sceneDefinition.furniture.push({
      id,
      roomId: room.id,
      asset,
      offsetX: 0,
      offsetZ: 0,
      yawRadians: 0,
      scale: 1,
    });
    this.selection = { kind: 'furniture', id };
    this.renderPreview();
    this.commitHistory();
  }

  private addWall(): void {
    const room = this.sceneDefinition.rooms.find((candidate) => candidate.id === this.roomSelect.value)
      ?? this.sceneDefinition.rooms[0];
    if (!room) return;
    const id = uniqueId('wall-new', this.sceneDefinition.walls.map((wall) => wall.id));
    this.sceneDefinition.walls.push({
      id,
      minX: room.center.x - 1,
      maxX: room.center.x + 1,
      minZ: room.center.z - 0.1,
      maxZ: room.center.z + 0.1,
    });
    this.selection = { kind: 'wall', id };
    this.renderPreview();
    this.commitHistory();
  }

  private deleteSelection(): void {
    if (!this.selection) return;
    if (this.selection.kind === 'furniture') {
      this.sceneDefinition.furniture = this.sceneDefinition.furniture.filter((item) => item.id !== this.selection?.id);
    } else if (this.selection.kind === 'room') {
      const roomId = this.selection.id;
      this.sceneDefinition.rooms = this.sceneDefinition.rooms.filter((room) => room.id !== roomId);
      this.sceneDefinition.furniture = this.sceneDefinition.furniture.filter((item) => item.roomId !== roomId);
    } else if (this.selection.kind === 'wall') {
      this.sceneDefinition.walls = this.sceneDefinition.walls.filter((wall) => wall.id !== this.selection?.id);
    } else {
      return;
    }
    this.selection = null;
    this.populatePalette();
    this.renderPreview();
    this.commitHistory();
  }

  private applyInspectorMutation(mutation: () => void): void {
    mutation();
    this.renderPreview();
    this.commitHistory();
  }

  private bindInspectorNumber(field: string, mutation: (value: number) => void): void {
    const input = this.inspector.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
    input?.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) this.applyInspectorMutation(() => mutation(value));
    });
  }

  private bindInspectorSelect(field: string, mutation: (value: string) => void): void {
    const select = this.inspector.querySelector<HTMLSelectElement>(`[data-field="${field}"]`);
    select?.addEventListener('change', () => this.applyInspectorMutation(() => mutation(select.value)));
  }

  private commitHistory(): void {
    const serialized = serializeHouseScene(this.sceneDefinition);
    if (this.history[this.historyIndex] === serialized) return;
    this.history.splice(this.historyIndex + 1);
    this.history.push(serialized);
    this.historyIndex = this.history.length - 1;
    storeHouseSceneDraft(this.sceneDefinition);
    this.renderIssues();
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.sceneDefinition = JSON.parse(this.history[this.historyIndex]) as HouseSceneDefinition;
    storeHouseSceneDraft(this.sceneDefinition);
    this.selection = null;
    this.populatePalette();
    this.renderPreview();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.sceneDefinition = JSON.parse(this.history[this.historyIndex]) as HouseSceneDefinition;
    storeHouseSceneDraft(this.sceneDefinition);
    this.selection = null;
    this.populatePalette();
    this.renderPreview();
  }

  private async copyJson(): Promise<void> {
    if (this.issues.some((issue) => issue.severity === 'error')) return;
    const text = serializeHouseScene(this.sceneDefinition);
    try {
      await navigator.clipboard.writeText(text);
      this.status.textContent = '已复制到剪贴板';
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  private downloadJson(): void {
    if (this.issues.some((issue) => issue.severity === 'error')) return;
    const blob = new Blob([serializeHouseScene(this.sceneDefinition)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.sceneDefinition.id}.scene.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async importJson(): Promise<void> {
    const file = this.importInput.files?.[0];
    this.importInput.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isHouseSceneDefinition(parsed)) throw new Error('文件不是受支持的房屋场景。');
      this.sceneDefinition = cloneHouseScene(parsed);
      this.selection = null;
      this.history = [serializeHouseScene(this.sceneDefinition)];
      this.historyIndex = 0;
      storeHouseSceneDraft(this.sceneDefinition);
      this.populatePalette();
      this.renderPreview();
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : '导入失败';
      this.status.dataset.valid = 'false';
    }
  }

  private selectionCenter(): { x: number; z: number } | null {
    if (this.selection?.kind === 'furniture') {
      const placement = this.selectedFurniture();
      const room = this.sceneDefinition.rooms.find((candidate) => candidate.id === placement?.roomId);
      return placement && room
        ? { x: room.center.x + placement.offsetX, z: room.center.z + placement.offsetZ }
        : null;
    }
    if (this.selection?.kind === 'room') return this.selectedRoom()?.center ?? null;
    if (this.selection?.kind === 'ghost-spawn') return this.sceneDefinition.ghostSpawn;
    if (this.selection?.kind === 'battery-spawn') return this.selectedBatterySpawn() ?? null;
    const wall = this.selectedWall();
    return wall ? { x: (wall.minX + wall.maxX) / 2, z: (wall.minZ + wall.maxZ) / 2 } : null;
  }

  private selectedFurniture(): FurniturePlacement | undefined {
    return this.selection?.kind === 'furniture'
      ? this.sceneDefinition.furniture.find((item) => item.id === this.selection?.id)
      : undefined;
  }

  private selectedRoom(): HouseRoomDefinition | undefined {
    return this.selection?.kind === 'room'
      ? this.sceneDefinition.rooms.find((room) => room.id === this.selection?.id)
      : undefined;
  }

  private selectedWall(): HouseSceneDefinition['walls'][number] | undefined {
    return this.selection?.kind === 'wall'
      ? this.sceneDefinition.walls.find((wall) => wall.id === this.selection?.id)
      : undefined;
  }

  private selectedBatterySpawnIndex(): number {
    if (this.selection?.kind !== 'battery-spawn') return -1;
    return this.sceneDefinition.batterySpawns.findIndex((_, index) =>
      batterySpawnSubjectId(index) === this.selection?.id,
    );
  }

  private selectedBatterySpawn(): { x: number; z: number } | undefined {
    const index = this.selectedBatterySpawnIndex();
    return index >= 0 ? this.sceneDefinition.batterySpawns[index] : undefined;
  }

  private kindForSubject(id: string): EditorKind | null {
    if (id === GHOST_SPAWN_SUBJECT_ID) return 'ghost-spawn';
    if (this.sceneDefinition.batterySpawns.some((_, index) => batterySpawnSubjectId(index) === id)) {
      return 'battery-spawn';
    }
    if (this.sceneDefinition.furniture.some((item) => item.id === id)) return 'furniture';
    if (this.sceneDefinition.rooms.some((room) => room.id === id)) return 'room';
    if (this.sceneDefinition.walls.some((wall) => wall.id === id)) return 'wall';
    return null;
  }

  private snap(value: number): number {
    return this.snapSize > 0 ? Math.round(value / this.snapSize) * this.snapSize : value;
  }

  private button(selector: string): HTMLButtonElement {
    return requireEditorElement(this.panel, selector);
  }

  private checkbox(selector: string): HTMLInputElement {
    return requireEditorElement(this.panel, selector);
  }

  private select(selector: string): HTMLSelectElement {
    return requireEditorElement(this.panel, selector);
  }

  private installTestHooks(): void {
    window.__HOUSE_SCENE_EDITOR__ = {
      snapshot: () => this.snapshot(),
      select: (kind, id) => this.selectObject(kind, id),
      moveSelected: (x, z) => {
        this.moveSelection(x, z);
        this.commitHistory();
      },
      rotateSelected: (degrees) => this.rotateSelection(degrees),
      addFurniture: (asset, roomId) => {
        this.assetSelect.value = asset;
        this.roomSelect.value = roomId;
        this.addFurniture();
      },
      undo: () => this.undo(),
      exportJson: () => serializeHouseScene(this.sceneDefinition),
      screenPoint: (x, z) => {
        const projected = new THREE.Vector3(x, 0, z).project(this.options.camera);
        const bounds = this.options.canvas.getBoundingClientRect();
        return {
          x: bounds.left + (projected.x + 1) * bounds.width / 2,
          y: bounds.top + (1 - projected.y) * bounds.height / 2,
        };
      },
    };
  }
}

function markSelectable(root: THREE.Object3D, kind: EditorKind, id: string): void {
  root.traverse((object) => {
    object.userData.editorKind = kind;
    object.userData.editorId = id;
  });
}

function spawnPointMarker(
  position: { x: number; z: number },
  kind: 'ghost' | 'child' | 'battery',
  selected: boolean,
): THREE.Group {
  const colors = kind === 'ghost'
    ? { fill: 0xb995e8, edge: 0xe6d5ff }
    : kind === 'battery'
      ? { fill: 0xf4c95d, edge: 0xffe49a }
      : { fill: 0x85cba6, edge: 0xb8efd0 };
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.scale.setScalar(selected ? 1.22 : 1);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(kind === 'child' ? 0.33 : 0.43, 24),
    markerMaterial(colors.fill, selected ? 0.58 : 0.36),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.13;
  disc.renderOrder = 30;
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(kind === 'child' ? 0.42 : 0.5, kind === 'child' ? 0.52 : 0.63, 28),
    markerMaterial(selected ? 0xfff1b8 : colors.edge, selected ? 1 : 0.82),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  ring.renderOrder = 31;
  group.add(ring);

  if (kind === 'ghost') addGhostGlyph(group);
  if (kind === 'battery') addBatteryGlyph(group);
  return group;
}

function addGhostGlyph(group: THREE.Group): void {
  for (const x of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.025, 0.09),
      markerMaterial(0x382745, 0.95),
    );
    eye.position.set(x, 0.16, -0.03);
    eye.renderOrder = 32;
    group.add(eye);
  }
}

function addBatteryGlyph(group: THREE.Group): void {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.035, 0.27),
    markerMaterial(0x3f3214, 0.9),
  );
  body.position.y = 0.16;
  body.renderOrder = 32;
  const terminal = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.04, 0.11),
    markerMaterial(0x3f3214, 0.9),
  );
  terminal.position.set(0.27, 0.16, 0);
  terminal.renderOrder = 32;
  group.add(body, terminal);
}

function markerMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

const ISSUE_CODE_LABELS: Readonly<Record<HouseSceneIssue['code'], string>> = {
  'duplicate-id': 'ID 重复',
  'unknown-room': '房间缺失',
  'unknown-asset': '模型缺失',
  'outside-room': '家具越界',
  'door-blocked': '门洞受阻',
  'spawn-blocked': '出生点受阻',
  'battery-blocked': '电池点受阻',
  'furniture-overlap': '家具重叠',
  'disconnected-map': '通路中断',
};

function issueCodeLabel(code: HouseSceneIssue['code']): string {
  return ISSUE_CODE_LABELS[code];
}

function issueKey(issue: HouseSceneIssue): string {
  return `${issue.severity}:${issue.code}:${issue.subjectId}:${issue.message}`;
}

function roomOutline(room: HouseRoomDefinition, selected: boolean): THREE.LineSegments {
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, 0.06, room.depth)),
    new THREE.LineBasicMaterial({
      color: selected ? 0xffd276 : 0x54aaa3,
      transparent: true,
      opacity: selected ? 0.96 : 0.42,
    }),
  );
  outline.position.set(room.center.x, 0.12, room.center.z);
  return outline;
}

function footprintMesh(
  footprint: { center: { x: number; z: number }; halfWidth: number; halfDepth: number; yawRadians: number },
  color: number,
  opacity: number,
  y: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(footprint.halfWidth * 2, 0.035, footprint.halfDepth * 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  mesh.position.set(footprint.center.x, y, footprint.center.z);
  mesh.rotation.y = footprint.yawRadians;
  return mesh;
}

function disposeGeneratedGroup(group: THREE.Group, disposeMaterials = true): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        if (
          disposeMaterials
          && (object.material instanceof THREE.MeshBasicMaterial || object.material instanceof THREE.LineBasicMaterial)
        ) {
          object.material.dispose();
        }
      }
    });
    child.removeFromParent();
  }
}

function roomAt(rooms: readonly HouseRoomDefinition[], point: { x: number; z: number }): HouseRoomDefinition | undefined {
  return rooms.find((room) =>
    Math.abs(point.x - room.center.x) <= room.width / 2
    && Math.abs(point.z - room.center.z) <= room.depth / 2,
  );
}

function moveWall(wall: HouseSceneDefinition['walls'][number], x: number, z: number): void {
  const halfWidth = (wall.maxX - wall.minX) / 2;
  const halfDepth = (wall.maxZ - wall.minZ) / 2;
  wall.minX = x - halfWidth;
  wall.maxX = x + halfWidth;
  wall.minZ = z - halfDepth;
  wall.maxZ = z + halfDepth;
}

function resizeWall(wall: HouseSceneDefinition['walls'][number], width: number, depth: number): void {
  const x = (wall.minX + wall.maxX) / 2;
  const z = (wall.minZ + wall.maxZ) / 2;
  wall.minX = x - width / 2;
  wall.maxX = x + width / 2;
  wall.minZ = z - depth / 2;
  wall.maxZ = z + depth / 2;
}

function uniqueId(prefix: string, ids: readonly string[]): string {
  const normalized = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const used = new Set(ids);
  if (!used.has(normalized)) return normalized;
  for (let index = 2; ; index += 1) {
    const candidate = `${normalized}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function optionMarkup(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function numberField(label: string, field: string, value: number, step: number, minimum?: number): string {
  return `<label>${label}<input type="number" data-field="${field}" value="${round(value)}" step="${step}"${minimum === undefined ? '' : ` min="${minimum}"`}></label>`;
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
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

function requireEditorElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing scene editor element: ${selector}`);
  return element;
}
