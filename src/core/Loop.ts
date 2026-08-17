export class Loop {
  private static readonly FRAME_INTERVAL_TOLERANCE_MS = 0.5;
  private frameId = 0;
  private lastAnimationTime = 0;
  private lastRenderedTime = 0;
  private pendingFrameTime = 0;
  private fpsSampleStart = 0;
  private fpsSampleFrames = 0;
  private measuredFps = 0;
  private running = false;
  private readonly frameIntervalMs: number;

  constructor(
    private readonly update: (deltaSeconds: number, elapsedSeconds: number, fps: number) => void,
    private readonly render: () => void,
    private readonly maxFrameRate = 60,
  ) {
    if (!Number.isFinite(maxFrameRate) || maxFrameRate <= 0) {
      throw new RangeError('maxFrameRate must be a positive number.');
    }
    this.frameIntervalMs = 1000 / maxFrameRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = performance.now();
    this.lastAnimationTime = now;
    this.lastRenderedTime = now;
    this.pendingFrameTime = 0;
    this.fpsSampleStart = now;
    this.fpsSampleFrames = 0;
    this.measuredFps = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private readonly tick = (time: number): void => {
    if (!this.running) return;
    const animationDelta = Math.max(0, time - this.lastAnimationTime);
    this.lastAnimationTime = time;
    this.pendingFrameTime += animationDelta;

    if (this.pendingFrameTime + Loop.FRAME_INTERVAL_TOLERANCE_MS < this.frameIntervalMs) {
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }

    this.pendingFrameTime = Math.max(0, this.pendingFrameTime - this.frameIntervalMs);
    const deltaSeconds = Math.min((time - this.lastRenderedTime) / 1000, 0.05);
    this.lastRenderedTime = time;
    this.measureFrameRate(time);
    this.update(deltaSeconds, time / 1000, this.measuredFps);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };

  private measureFrameRate(time: number): void {
    this.fpsSampleFrames += 1;
    const sampleDuration = time - this.fpsSampleStart;
    if (sampleDuration < 500) return;

    const sampledFps = (this.fpsSampleFrames * 1000) / sampleDuration;
    this.measuredFps = Math.min(this.maxFrameRate, Math.round(sampledFps));
    this.fpsSampleStart = time;
    this.fpsSampleFrames = 0;
  }
}
