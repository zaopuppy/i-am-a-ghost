import * as THREE from 'three';
import { loadFurnitureLibrary, type FurnitureLibrary } from '../assets/EnvironmentAssets';
import { createHouseMaterialKit, type HouseMaterialKit } from '../assets/MaterialLibrary';
import {
  cloneHouseScene,
  compileHouseScene,
  FURNITURE_ASSET_IDS,
  FURNITURE_CATALOG,
  HOUSE_SCENE_VERSION,
  type FurnitureAssetId,
  type FurniturePlacement,
  type HouseRoomDefinition,
  type HouseSceneDefinition,
  type HouseSceneIssue,
} from './HouseScene';
import { DEFAULT_HOUSE_SCENE } from './defaultHouseScene';

type EditorKind = 'furniture' | 'room' | 'wall';
const SCENE_DRAFT_STORAGE_KEY = 'i-am-a-ghost:house-scene-draft:v1';

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
  private history = [serializeScene(this.sceneDefinition)];
  private historyIndex = 0;

  constructor(private readonly options: SceneEditorOptions) {
    const storedDraft = loadStoredDraft();
    if (storedDraft) {
      this.sceneDefinition = storedDraft;
      this.history = [serializeScene(storedDraft)];
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
    document.body.append(this.panel);
    document.documentElement.dataset.sceneEditor = 'true';
    this.populatePalette();
    this.bindUi();
    this.renderPreview();
    this.options.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.options.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.options.canvas.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
    this.installTestHooks();
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
      furnitureCount: compiled.furniture.length,
      movementColliderCount: compiled.map.movementObstacles?.length ?? 0,
      errors: compiled.issues.filter((issue) => issue.severity === 'error').length,
      warnings: compiled.issues.filter((issue) => issue.severity === 'warning').length,
      issues: compiled.issues.map((issue) => ({ ...issue })),
    };
  }

  dispose(): void {
    this.options.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.options.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.options.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.panel.remove();
    this.root.removeFromParent();
    disposeGeneratedGroup(this.structureGroup, false);
    disposeGeneratedGroup(this.overlayGroup);
    for (const object of this.hiddenEnvironment) object.visible = true;
    this.materials.dispose();
    document.documentElement.removeAttribute('data-scene-editor');
    delete window.__HOUSE_SCENE_EDITOR__;
  }

  private buildPanel(): HTMLElement {
    const panel = document.createElement('aside');
    panel.className = 'scene-editor';
    panel.dataset.testid = 'scene-editor';
    panel.innerHTML = `
      <header class="scene-editor__header">
        <p class="scene-editor__kicker">DEV CARTOGRAPHY / 01</p>
        <h1>房屋制图台</h1>
        <p>拖动画布中的家具、房间或墙体。橙色区域必须保持畅通。</p>
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
        <label><input type="checkbox" data-editor-colliders checked> 显示碰撞脚印</label>
        <label><input type="checkbox" data-editor-safety checked> 显示门洞与出生安全区</label>
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
        <div class="scene-editor__section-title"><span>场景校验</span><output data-editor-status></output></div>
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
        <p class="scene-editor__keys">Q / E 旋转 15° · R 旋转 90° · Delete 删除 · Ctrl+Z 撤销</p>
      </footer>
    `;
    return panel;
  }

  private populatePalette(): void {
    this.roomSelect.replaceChildren(...this.sceneDefinition.rooms.map((room) => option(room.id, room.name)));
    this.assetSelect.replaceChildren(...FURNITURE_ASSET_IDS.map((id) => option(id, FURNITURE_CATALOG[id].label)));
  }

  private bindUi(): void {
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
    for (const wall of [...this.sceneDefinition.walls, ...boundaryWalls(this.sceneDefinition)]) {
      const width = wall.maxX - wall.minX;
      const depth = wall.maxZ - wall.minZ;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, 2.8, depth),
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
      const spawnGeometry = new THREE.RingGeometry(0.44, 0.56, 24);
      for (const [index, spawn] of [compiled.map.ghostSpawn, ...compiled.map.childSpawns].entries()) {
        const marker = new THREE.Mesh(
          spawnGeometry,
          new THREE.MeshBasicMaterial({
            color: index === 0 ? 0xb995e8 : 0x85cba6,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
          }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(spawn.x, 0.085, spawn.z);
        this.overlayGroup.add(marker);
      }
    }
    if (this.selection?.kind === 'room') {
      const room = this.sceneDefinition.rooms.find((candidate) => candidate.id === this.selection?.id);
      if (room) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, 0.06, room.depth)),
          new THREE.LineBasicMaterial({ color: 0xffd276 }),
        );
        outline.position.set(room.center.x, 0.12, room.center.z);
        this.overlayGroup.add(outline);
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
    if (!this.selection) {
      this.inspector.innerHTML = `
        <div class="scene-editor__empty">
          <span>尚未选择</span>
          <p>从画布选择家具、房间地面或墙段。拖动即可移动。</p>
        </div>
      `;
      return;
    }
    if (this.selection.kind === 'furniture') this.renderFurnitureInspector();
    if (this.selection.kind === 'room') this.renderRoomInspector();
    if (this.selection.kind === 'wall') this.renderWallInspector();
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

  private renderIssues(): void {
    const errors = this.issues.filter((issue) => issue.severity === 'error').length;
    const warnings = this.issues.length - errors;
    this.status.textContent = errors > 0 ? `${errors} 错误 · ${warnings} 警告` : warnings > 0 ? `${warnings} 条警告` : '可导出';
    this.status.dataset.valid = String(errors === 0);
    const visibleIssues = this.issues.slice(0, 6);
    this.issueList.replaceChildren(...visibleIssues.map((issue) => {
      const item = document.createElement('li');
      item.dataset.severity = issue.severity;
      item.textContent = issue.message;
      item.addEventListener('click', () => {
        const kind = this.kindForSubject(issue.subjectId);
        if (kind) this.selectObject(kind, issue.subjectId);
      });
      return item;
    }));
    if (visibleIssues.length === 0) {
      const item = document.createElement('li');
      item.className = 'scene-editor__valid';
      item.textContent = '门洞畅通，出生点与电池点全部连通。';
      this.issueList.append(item);
    }
    for (const selector of ['[data-editor-copy]', '[data-editor-download]']) {
      this.button(selector).disabled = errors > 0;
    }
    this.button('[data-editor-undo]').disabled = this.historyIndex <= 0;
    this.button('[data-editor-redo]').disabled = this.historyIndex >= this.history.length - 1;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    if (event.key.toLowerCase() === 'q') this.rotateSelection(-15);
    if (event.key.toLowerCase() === 'e') this.rotateSelection(15);
    if (event.key.toLowerCase() === 'r') this.rotateSelection(90);
  };

  private pick(event: PointerEvent): EditorSelection | null {
    this.updateRay(event);
    const hits = this.raycaster.intersectObjects([this.furnitureGroup, this.structureGroup], true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && object !== this.root) {
        const kind = object.userData.editorKind as EditorKind | undefined;
        const id = object.userData.editorId as string | undefined;
        if (kind && id) return { kind, id };
        object = object.parent;
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
    } else {
      this.sceneDefinition.walls = this.sceneDefinition.walls.filter((wall) => wall.id !== this.selection?.id);
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
    const serialized = serializeScene(this.sceneDefinition);
    if (this.history[this.historyIndex] === serialized) return;
    this.history.splice(this.historyIndex + 1);
    this.history.push(serialized);
    this.historyIndex = this.history.length - 1;
    storeDraft(this.sceneDefinition);
    this.renderIssues();
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.sceneDefinition = JSON.parse(this.history[this.historyIndex]) as HouseSceneDefinition;
    storeDraft(this.sceneDefinition);
    this.selection = null;
    this.populatePalette();
    this.renderPreview();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.sceneDefinition = JSON.parse(this.history[this.historyIndex]) as HouseSceneDefinition;
    storeDraft(this.sceneDefinition);
    this.selection = null;
    this.populatePalette();
    this.renderPreview();
  }

  private async copyJson(): Promise<void> {
    if (this.issues.some((issue) => issue.severity === 'error')) return;
    const text = serializeScene(this.sceneDefinition);
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
    const blob = new Blob([serializeScene(this.sceneDefinition)], { type: 'application/json' });
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
      this.history = [serializeScene(this.sceneDefinition)];
      this.historyIndex = 0;
      storeDraft(this.sceneDefinition);
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

  private kindForSubject(id: string): EditorKind | null {
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
      exportJson: () => serializeScene(this.sceneDefinition),
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

function boundaryWalls(scene: HouseSceneDefinition): HouseSceneDefinition['walls'] {
  const { bounds } = scene;
  return [
    { id: 'boundary:north', minX: bounds.minX - 0.2, maxX: bounds.maxX + 0.2, minZ: bounds.maxZ - 0.2, maxZ: bounds.maxZ + 0.2 },
    { id: 'boundary:south', minX: bounds.minX - 0.2, maxX: bounds.maxX + 0.2, minZ: bounds.minZ - 0.2, maxZ: bounds.minZ + 0.2 },
    { id: 'boundary:west', minX: bounds.minX - 0.2, maxX: bounds.minX + 0.2, minZ: bounds.minZ, maxZ: bounds.maxZ },
    { id: 'boundary:east', minX: bounds.maxX - 0.2, maxX: bounds.maxX + 0.2, minZ: bounds.minZ, maxZ: bounds.maxZ },
  ];
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

function serializeScene(scene: HouseSceneDefinition): string {
  return JSON.stringify(scene, null, 2);
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

function isHouseSceneDefinition(value: unknown): value is HouseSceneDefinition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HouseSceneDefinition>;
  return candidate.version === HOUSE_SCENE_VERSION
    && typeof candidate.id === 'string'
    && Array.isArray(candidate.rooms)
    && Array.isArray(candidate.walls)
    && Array.isArray(candidate.furniture)
    && Array.isArray(candidate.childSpawns)
    && candidate.childSpawns.length === 4
    && Array.isArray(candidate.batterySpawns);
}

function loadStoredDraft(): HouseSceneDefinition | null {
  try {
    const serialized = localStorage.getItem(SCENE_DRAFT_STORAGE_KEY);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    return isHouseSceneDefinition(parsed) ? cloneHouseScene(parsed) : null;
  } catch {
    return null;
  }
}

function storeDraft(scene: HouseSceneDefinition): void {
  try {
    localStorage.setItem(SCENE_DRAFT_STORAGE_KEY, serializeScene(scene));
  } catch {
    // Private browsing or storage quotas must not prevent editing/export.
  }
}

function requireEditorElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing scene editor element: ${selector}`);
  return element;
}
