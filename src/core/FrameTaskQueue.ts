export type FrameYield = () => Promise<void>;

/** Runs expensive presentation tasks serially with a browser frame between each task. */
export class FrameTaskQueue {
  private tail = Promise.resolve();

  constructor(private readonly yieldFrame: FrameYield = yieldToAnimationFrame) {}

  enqueue<Result>(task: () => Promise<Result> | Result): Promise<Result> {
    const pending = this.tail.then(async () => {
      await this.yieldFrame();
      return task();
    });
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function yieldToAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
