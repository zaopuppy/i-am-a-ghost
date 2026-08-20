import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameTaskQueue } from '../../src/core/FrameTaskQueue';

test('frame task queue yields before each task and runs tasks serially', async () => {
  const events: string[] = [];
  let frame = 0;
  const queue = new FrameTaskQueue(async () => {
    frame += 1;
    events.push(`frame:${frame}`);
  });

  await Promise.all([
    queue.enqueue(async () => {
      events.push('task:1:start');
      await Promise.resolve();
      events.push('task:1:end');
    }),
    queue.enqueue(() => {
      events.push('task:2');
    }),
  ]);

  assert.deepEqual(events, [
    'frame:1',
    'task:1:start',
    'task:1:end',
    'frame:2',
    'task:2',
  ]);
});

test('frame task queue continues after a failed task', async () => {
  const events: string[] = [];
  const queue = new FrameTaskQueue(async () => undefined);

  await assert.rejects(queue.enqueue(() => {
    throw new Error('expected failure');
  }));
  await queue.enqueue(() => {
    events.push('recovered');
  });

  assert.deepEqual(events, ['recovered']);
});
