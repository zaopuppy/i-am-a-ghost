import type { RenderStage } from '../core/Renderer';
import type { OpeningScene } from './OpeningScene';

const SEEN_KEY = 'i-am-a-ghost:opening-seen';
const DURATION = 8;

/** Owns the noninteractive prologue, then waits for an explicit start gesture. */
export class OpeningSequence {
  private scene: OpeningScene | null = null;
  private elapsed = 0;
  private generation = 0;
  private running = false;
  private ready = false;
  private lastFrameAt = 0;
  private manualPlayback = false;
  private readonly overlay = document.querySelector<HTMLElement>('#opening')!;
  private readonly title = document.querySelector<HTMLElement>('#opening-title')!;
  private readonly status = document.querySelector<HTMLElement>('#opening-status')!;
  private readonly skip = document.querySelector<HTMLButtonElement>('#opening-skip')!;
  private readonly start = document.querySelector<HTMLButtonElement>('#opening-start')!;
  private readonly replay = document.querySelector<HTMLButtonElement>('#opening-replay')!;
  private readonly watchAgain = document.querySelector<HTMLButtonElement>('#opening-watch-again')!;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly inertElements = new Map<HTMLElement, boolean>();

  constructor(private readonly onExit: () => void) {
    this.skip.addEventListener('click', this.dismiss);
    this.start.addEventListener('click', this.dismiss);
    this.replay.addEventListener('click', this.replayOpening);
    this.watchAgain.addEventListener('click', this.replayOpening);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.resetClock);
  }

  get active(): boolean { return this.running; }

  static seen(): boolean {
    try { return localStorage.getItem(SEEN_KEY) === 'true'; }
    catch { return false; }
  }

  async play(manual = false): Promise<void> {
    const reuseScene = this.scene !== null && this.ready;
    if (!reuseScene) this.releaseScene();
    const generation = ++this.generation;
    this.running = true;
    this.ready = false;
    this.manualPlayback = manual;
    this.elapsed = !manual && this.motion.matches ? DURATION : 0;
    this.overlay.hidden = false;
    this.title.hidden = true;
    this.status.hidden = false;
    this.skip.hidden = false;
    this.overlay.dataset.state = 'loading';
    delete this.overlay.dataset.beat;
    document.documentElement.dataset.openingActive = 'true';
    for (const child of document.querySelectorAll<HTMLElement>('#app > *')) {
      if (child === this.overlay) continue;
      if (!this.inertElements.has(child)) this.inertElements.set(child, child.inert);
      child.inert = true;
    }
    this.skip.focus({ preventScroll: true });
    if (reuseScene) {
      this.ready = true;
      this.lastFrameAt = performance.now();
      this.status.hidden = true;
      this.overlay.dataset.state = 'playing';
      return;
    }
    try {
      const { OpeningScene } = await import('./OpeningScene');
      if (generation !== this.generation) return;
      const scene = new OpeningScene();
      this.scene = scene;
      await scene.ready;
      if (generation !== this.generation) return;
      this.ready = true;
      this.lastFrameAt = performance.now();
      this.status.hidden = true;
      this.overlay.dataset.state = 'playing';
    } catch {
      // A failed optional cinematic must never prevent entering the game.
      if (generation === this.generation) this.close(false);
    }
  }

  render(stage: RenderStage, aspect: number): boolean {
    if (!this.running) return false;
    if (this.ready && this.scene) {
      const now = performance.now();
      const animate = this.manualPlayback || !this.motion.matches;
      if (!document.hidden && animate) this.elapsed += Math.max(0, now - this.lastFrameAt) / 1000;
      this.lastFrameAt = now;
      if (!animate) this.elapsed = DURATION;
      const pose = this.scene.update(this.elapsed, aspect);
      const beat = this.elapsed < 2 ? 'paper' : this.elapsed < 4 ? 'door'
        : this.elapsed < 6 ? 'shadow' : this.elapsed < DURATION ? 'light' : 'title';
      if (this.overlay.dataset.beat !== beat) this.overlay.dataset.beat = beat;
      stage.setCameraPose(pose.position, pose.target, pose.viewHeight);
      stage.render(this.scene.scene, []);
      if (this.elapsed >= DURATION && this.title.hidden) {
        this.title.hidden = false;
        this.skip.hidden = true;
        this.overlay.dataset.state = 'title';
        if (import.meta.env.DEV) {
          this.overlay.dataset.renderInfo = JSON.stringify({
            calls: stage.renderer.info.render.calls,
            triangles: stage.renderer.info.render.triangles,
            geometries: stage.renderer.info.memory.geometries,
            textures: stage.renderer.info.memory.textures,
          });
        }
        this.start.focus({ preventScroll: true });
        this.markSeen();
      }
    }
    return true;
  }

  close(remember = true): void {
    if (!this.running) return;
    if (remember) this.markSeen();
    this.generation += 1;
    this.running = false;
    this.overlay.hidden = true;
    delete document.documentElement.dataset.openingActive;
    for (const [element, inert] of this.inertElements) element.inert = inert;
    this.inertElements.clear();
    this.releaseScene();
    this.onExit();
  }

  dispose(): void {
    this.close(false);
    this.skip.removeEventListener('click', this.dismiss);
    this.start.removeEventListener('click', this.dismiss);
    this.replay.removeEventListener('click', this.replayOpening);
    this.watchAgain.removeEventListener('click', this.replayOpening);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.resetClock);
  }

  private readonly dismiss = (): void => this.close();
  private readonly resetClock = (): void => { this.lastFrameAt = performance.now(); };
  private readonly replayOpening = (): void => { void this.play(true); };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.running) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = this.title.hidden ? [this.skip] : [this.start, this.watchAgain];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  };

  private markSeen(): void {
    try { localStorage.setItem(SEEN_KEY, 'true'); }
    catch { /* The opening remains usable when storage is unavailable. */ }
  }

  private releaseScene(): void {
    this.scene?.dispose();
    this.scene = null;
    this.ready = false;
  }
}
