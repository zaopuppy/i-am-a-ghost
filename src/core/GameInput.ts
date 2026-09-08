import type { Vec2 } from '../game/MatchEngine';

const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
const MOVE_UP = new Set(['KeyW', 'ArrowUp']);
const MOVE_DOWN = new Set(['KeyS', 'ArrowDown']);
const JOYSTICK_DEAD_ZONE = 0.12;

/** Each floating stick owns its captured touch independently. */
class FloatingJoystick {
  pointerId: number | null = null;
  vector: Vec2 = { x: 0, z: 0 };
  private origin: { x: number; y: number } | null = null;

  constructor(private readonly surfaceId: string, private readonly stickId: string) {}

  private get surface(): HTMLElement | null { return document.getElementById(this.surfaceId); }
  private get stick(): HTMLElement | null { return document.getElementById(this.stickId); }
  private get knob(): HTMLElement | null { return this.stick?.querySelector('.touch-joystick__knob') ?? null; }

  start(event: PointerEvent): void {
    const surface = this.surface;
    const stick = this.stick;
    if (this.pointerId !== null || !surface || !stick || !surface.getClientRects().length) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    this.vector = { x: 0, z: 0 };
    const bounds = surface.getBoundingClientRect();
    stick.style.left = `${event.clientX - bounds.left}px`;
    stick.style.top = `${event.clientY - bounds.top}px`;
    stick.style.bottom = 'auto';
    stick.style.transform = 'translate(-50%, -50%)';
    stick.dataset.active = 'true';
    this.drawKnob(0);
    try { surface.setPointerCapture(event.pointerId); } catch {
      // ArkWeb may already own pointer capture.
    }
  }

  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || !this.origin || !this.stick) return;
    event.preventDefault();
    const bounds = this.stick.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.32;
    this.vector = joystickVectorFromDelta(event.clientX - this.origin.x, event.clientY - this.origin.y, radius);
    this.drawKnob(radius);
  }

  end(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.release();
  }

  release(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.origin = null;
    this.vector = { x: 0, z: 0 };
    const surface = this.surface;
    if (pointerId !== null && surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    const stick = this.stick;
    if (stick) {
      stick.dataset.active = 'false';
      for (const property of ['left', 'top', 'bottom', 'transform']) stick.style.removeProperty(property);
    }
    this.drawKnob(0);
  }

  private drawKnob(radius: number): void {
    const knob = this.knob;
    if (knob) knob.style.transform =
      `translate(calc(-50% + ${this.vector.x * radius}px), calc(-50% + ${this.vector.z * radius}px))`;
  }
}

export class GameInput {
  private readonly pressed = new Set<string>();
  private readonly moveStick = new FloatingJoystick('touch-move-area', 'touch-joystick');
  private readonly aimStick = new FloatingJoystick('touch-aim-area', 'touch-action');
  private pointer: { x: number; y: number } | null = null;
  private mouseActionHeld = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerout', this.onPointerOut);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(type, this.onPointerEnd as EventListener);
    }
  }

  movement(): Vec2 {
    return this.moveStick.pointerId !== null ? { ...this.moveStick.vector } : movementFromPressed(this.pressed);
  }

  aimDirection(): Vec2 { return { ...this.aimStick.vector }; }
  mousePosition(): { x: number; y: number } | null { return this.pointer ? { ...this.pointer } : null; }
  actionHeld(): boolean { return this.mouseActionHeld || this.aimStick.pointerId !== null; }

  dispose(): void {
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerout', this.onPointerOut);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      document.removeEventListener(type, this.onPointerEnd as EventListener);
    }
  }

  readonly clear = (): void => {
    this.pressed.clear();
    this.pointer = null;
    this.mouseActionHeld = false;
    this.moveStick.release();
    this.aimStick.release();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    if (isGameKey(event.code)) event.preventDefault();
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!isEditableTarget(event.target) && isGameKey(event.code)) event.preventDefault();
    this.pressed.delete(event.code);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.clear();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('#game-canvas')) return;
    this.mouseActionHeld = true;
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.mouseActionHeld = false;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#touch-move-area')) this.moveStick.start(event);
    else if (target?.closest('#touch-aim-area')) this.aimStick.start(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.moveStick.move(event);
    this.aimStick.move(event);
    if (event.pointerType === 'mouse') {
      if ((event.buttons & 1) === 0) this.mouseActionHeld = false;
      this.pointer = event.target instanceof Element && event.target.closest('#game-canvas')
        ? { x: event.clientX, y: event.clientY } : null;
    }
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.target instanceof Element && event.target.closest('#game-canvas')) {
      this.pointer = null;
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') this.mouseActionHeld = false;
    this.moveStick.end(event);
    this.aimStick.end(event);
  };
}

export function movementFromPressed(pressed: ReadonlySet<string>): Vec2 {
  return {
    x: Number(hasAny(pressed, MOVE_RIGHT)) - Number(hasAny(pressed, MOVE_LEFT)),
    z: Number(hasAny(pressed, MOVE_DOWN)) - Number(hasAny(pressed, MOVE_UP)),
  };
}

export function joystickVectorFromDelta(deltaX: number, deltaY: number, radius: number): Vec2 {
  if (!Number.isFinite(radius) || radius <= 0) return { x: 0, z: 0 };
  const magnitude = Math.hypot(deltaX, deltaY);
  if (magnitude / radius < JOYSTICK_DEAD_ZONE) return { x: 0, z: 0 };
  const scale = magnitude > radius ? radius / magnitude : 1;
  return { x: (deltaX * scale) / radius, z: (deltaY * scale) / radius };
}

function hasAny(pressed: ReadonlySet<string>, codes: ReadonlySet<string>): boolean {
  for (const code of codes) if (pressed.has(code)) return true;
  return false;
}

function isGameKey(code: string): boolean {
  return MOVE_LEFT.has(code) || MOVE_RIGHT.has(code) || MOVE_UP.has(code) || MOVE_DOWN.has(code);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable);
}
