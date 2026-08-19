import type { Vec2 } from '../game/MatchEngine';

const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
const MOVE_UP = new Set(['KeyW', 'ArrowUp']);
const MOVE_DOWN = new Set(['KeyS', 'ArrowDown']);

export class GameInput {
  private readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  movement(): Vec2 {
    return movementFromPressed(this.pressed);
  }

  actionHeld(): boolean {
    return this.pressed.has('Space');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
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
  };
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
