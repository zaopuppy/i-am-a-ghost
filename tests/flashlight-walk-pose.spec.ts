import { expect, test } from '@playwright/test';

test('walking child steadies a lit flashlight and swings it while unlit', async ({ page }) => {
  await page.goto('/?testState=child-playing');

  const result = await page.evaluate(async () => {
    type QuaternionProbe = {
      angleTo(other: QuaternionProbe): number;
      clone(): QuaternionProbe;
    };
    type ActorProbe = {
      currentAnimation: string;
      flashlight: {
        muzzle: {
          quaternion: QuaternionProbe;
          getWorldQuaternion(target: QuaternionProbe): QuaternionProbe;
        };
      } | null;
      imported: unknown | null;
    };
    type ChildFrame = {
      children: Array<{
        playerId: string;
        position: { x: number; z: number };
        facingRadians: number;
        flashlightOn: boolean;
      }>;
    };
    type WorldProbe = {
      actors: Map<string, ActorProbe>;
      sync(frame: unknown, elapsedSeconds: number): void;
      dispose(): void;
    };
    const loadModule = (specifier: string): Promise<Record<string, unknown>> => import(specifier);
    const worldModule = await loadModule('/src/game/GameWorld.ts') as {
      GameWorld: new () => WorldProbe;
    };
    const stateModule = await loadModule('/src/testing/DeterministicStates.ts') as {
      createDeterministicViewerFrame(state: string, seed: number): ChildFrame;
    };

    const sampleWalk = async (flashlightOn: boolean) => {
      const world = new worldModule.GameWorld();
      const frame = structuredClone(
        stateModule.createDeterministicViewerFrame('child-playing', 71),
      );
      const child = frame.children.find((candidate) => candidate.playerId === 'child-1');
      if (!child) throw new Error('Child fixture is missing.');
      child.flashlightOn = flashlightOn;
      child.facingRadians = 0;

      let actor: ActorProbe | undefined;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        world.sync(frame, 0);
        actor = world.actors.get('child:child-1');
        if (actor?.imported && actor.flashlight) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!actor?.imported || !actor.flashlight) {
        world.dispose();
        throw new Error('Imported flashlight actor unavailable.');
      }

      const samples: QuaternionProbe[] = [];
      for (let tick = 1; tick <= 90; tick += 1) {
        child.position.x += 0.03;
        world.sync(frame, tick / 60);
        if (tick <= 20) continue;
        const target = actor.flashlight.muzzle.quaternion.clone();
        samples.push(actor.flashlight.muzzle.getWorldQuaternion(target).clone());
      }

      let directionSpan = 0;
      for (let left = 0; left < samples.length; left += 1) {
        for (let right = left + 1; right < samples.length; right += 1) {
          directionSpan = Math.max(directionSpan, samples[left].angleTo(samples[right]));
        }
      }
      const animation = actor.currentAnimation;
      world.dispose();
      return { animation, directionSpan };
    };

    return {
      lit: await sampleWalk(true),
      unlit: await sampleWalk(false),
    };
  });

  expect(result.lit.animation).toBe('Running_A');
  expect(result.unlit.animation).toBe('Running_A');
  expect(result.lit.directionSpan).toBeLessThan(0.01);
  expect(result.unlit.directionSpan).toBeGreaterThan(0.2);
});
