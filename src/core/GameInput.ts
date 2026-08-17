import type { Vec2 } from '../game/MatchEngine';

export class GameInput {
  private readonly pressed = new Set<string>();
  private pointer = { x: 0, y: 0 };
  private action = false;
  private actionPressQueued = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerleave', this.onPointerLeave);
  }

  movement(): Vec2 {
    return {
      x: Number(this.pressed.has('KeyF')) - Number(this.pressed.has('KeyS')),
      z: Number(this.pressed.has('KeyD')) - Number(this.pressed.has('KeyE')),
    };
  }

  pointerClient(): Readonly<{ x: number; y: number }> {
    return this.pointer;
  }

  actionHeld(): boolean {
    return this.action;
  }

  consumeActionPress(): boolean {
    const queued = this.actionPressQueued;
    this.actionPressQueued = false;
    return queued;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isGameKey(event.code)) event.preventDefault();
    this.pressed.add(event.code);
    if (event.code === 'Space') {
      if (!event.repeat && !this.action) this.actionPressQueued = true;
      this.action = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isGameKey(event.code)) event.preventDefault();
    this.pressed.delete(event.code);
    if (event.code === 'Space') this.action = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerLeave = (): void => {
    this.action = false;
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.action = false;
    this.actionPressQueued = false;
  };
}

function isGameKey(code: string): boolean {
  return code === 'KeyE' || code === 'KeyS' || code === 'KeyD' || code === 'KeyF' || code === 'Space';
}
