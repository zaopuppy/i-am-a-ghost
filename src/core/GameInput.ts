import type { Vec2 } from '../game/MatchEngine';

const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
const MOVE_UP = new Set(['KeyW', 'ArrowUp']);
const MOVE_DOWN = new Set(['KeyS', 'ArrowDown']);

export class GameInput {
  private readonly pressed = new Set<string>();
  private touchMovement: Vec2 = { x: 0, z: 0 };
  private joystickPointerId: number | null = null;
  private actionPointerId: number | null = null;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerdown', this.onTouchPointerDown);
    document.addEventListener('pointermove', this.onTouchPointerMove);
    document.addEventListener('pointerup', this.onTouchPointerEnd);
    document.addEventListener('pointercancel', this.onTouchPointerEnd);
  }

  movement(): Vec2 {
    if (Math.hypot(this.touchMovement.x, this.touchMovement.z) > 0.01) {
      return { ...this.touchMovement };
    }
    return movementFromPressed(this.pressed);
  }

  actionHeld(): boolean {
    return this.pressed.has('Space') || this.actionPointerId !== null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerdown', this.onTouchPointerDown);
    document.removeEventListener('pointermove', this.onTouchPointerMove);
    document.removeEventListener('pointerup', this.onTouchPointerEnd);
    document.removeEventListener('pointercancel', this.onTouchPointerEnd);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    if (isGameKey(event.code)) event.preventDefault();
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    if (isGameKey(event.code)) event.preventDefault();
    this.pressed.delete(event.code);
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.releaseJoystick();
    this.releaseAction();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.clear();
  };

  private readonly onTouchPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#touch-joystick')) {
      this.onJoystickPointerDown(event);
    } else if (target?.closest('#touch-action')) {
      this.onActionPointerDown(event);
    }
  };

  private readonly onTouchPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointerId) this.onJoystickPointerMove(event);
  };

  private readonly onTouchPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointerId) this.onJoystickPointerEnd(event);
    if (event.pointerId === this.actionPointerId) this.onActionPointerEnd(event);
  };

  private readonly onJoystickPointerDown = (event: PointerEvent): void => {
    if (this.joystickPointerId !== null || this.joystick === null) return;
    event.preventDefault();
    this.joystickPointerId = event.pointerId;
    this.joystick.dataset.active = 'true';
    try {
      this.joystick.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be owned by ArkWeb.
    }
    this.updateJoystick(event);
  };

  private readonly onJoystickPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointerId) return;
    event.preventDefault();
    this.updateJoystick(event);
  };

  private readonly onJoystickPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointerId) return;
    event.preventDefault();
    this.releaseJoystick();
  };

  private readonly onActionPointerDown = (event: PointerEvent): void => {
    if (this.actionPointerId !== null || this.actionButton === null) return;
    event.preventDefault();
    this.actionPointerId = event.pointerId;
    this.actionButton.dataset.active = 'true';
    try {
      this.actionButton.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be owned by ArkWeb.
    }
  };

  private readonly onActionPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.actionPointerId) return;
    event.preventDefault();
    this.releaseAction();
  };

  private updateJoystick(event: PointerEvent): void {
    if (this.joystick === null) return;
    const bounds = this.joystick.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.32;
    const rawX = event.clientX - (bounds.left + bounds.width / 2);
    const rawZ = event.clientY - (bounds.top + bounds.height / 2);
    const magnitude = Math.hypot(rawX, rawZ);
    const scale = magnitude > radius ? radius / magnitude : 1;
    const normalizedX = (rawX * scale) / radius;
    const normalizedZ = (rawZ * scale) / radius;
    const deadZone = 0.12;
    this.touchMovement = Math.hypot(normalizedX, normalizedZ) < deadZone
      ? { x: 0, z: 0 }
      : { x: normalizedX, z: normalizedZ };
    if (this.joystickKnob !== null) {
      this.joystickKnob.style.transform =
        `translate(calc(-50% + ${normalizedX * radius}px), calc(-50% + ${normalizedZ * radius}px))`;
    }
  }

  private releaseJoystick(): void {
    this.joystickPointerId = null;
    this.touchMovement = { x: 0, z: 0 };
    if (this.joystick !== null) this.joystick.dataset.active = 'false';
    if (this.joystickKnob !== null) this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private releaseAction(): void {
    this.actionPointerId = null;
    if (this.actionButton !== null) this.actionButton.dataset.active = 'false';
  }

  private get joystick(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#touch-joystick');
  }

  private get joystickKnob(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#touch-joystick-knob');
  }

  private get actionButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('#touch-action');
  }
}

export function movementFromPressed(pressed: ReadonlySet<string>): Vec2 {
  return {
    x: Number(hasAny(pressed, MOVE_RIGHT)) - Number(hasAny(pressed, MOVE_LEFT)),
    z: Number(hasAny(pressed, MOVE_DOWN)) - Number(hasAny(pressed, MOVE_UP)),
  };
}

function hasAny(pressed: ReadonlySet<string>, codes: ReadonlySet<string>): boolean {
  for (const code of codes) {
    if (pressed.has(code)) return true;
  }
  return false;
}

function isGameKey(code: string): boolean {
  return MOVE_LEFT.has(code)
    || MOVE_RIGHT.has(code)
    || MOVE_UP.has(code)
    || MOVE_DOWN.has(code)
    || code === 'Space';
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches('input, select, textarea') || target.isContentEditable);
}
