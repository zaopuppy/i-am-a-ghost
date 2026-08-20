import { expect, test } from '@playwright/test';

test('capture pose keeps frantic limbs restrained and follows authoritative progress', async ({ page }) => {
  await page.goto('/?testState=capture');
  await page.waitForFunction(
    () => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.kid.status === 'ready'
      && window.__THREE_GAME_DIAGNOSTICS__?.world.assets.ghost.status === 'ready'
      && window.__THREE_GAME_DIAGNOSTICS__?.world.pendingAssetUpgrades === 0,
  );

  const result = await page.evaluate(async () => {
    type QuaternionProbe = {
      angleTo(other: QuaternionProbe): number;
      clone(): QuaternionProbe;
    };
    type JointProbe = { quaternion: QuaternionProbe };
    type ActorProbe = {
      imported: {
        captureJointRotations: Map<JointProbe, QuaternionProbe>;
        joints: Record<string, JointProbe | null> & {
          head: JointProbe | null;
        };
      } | null;
      root: { position: { x: number; z: number } };
    };
    type CaptureFrame = {
      capture: { ticksRemaining: number; durationTicks: number } | null;
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
      createDeterministicViewerFrame(state: string, seed: number): CaptureFrame;
    };

    const frameAtTick = (elapsedTicks: number) => {
      const frame = structuredClone(stateModule.createDeterministicViewerFrame('capture', 71));
      if (!frame.capture) throw new Error('Capture fixture is missing capture timing.');
      frame.capture.ticksRemaining = frame.capture.durationTicks - elapsedTicks;
      return frame;
    };
    const readyWorld = async () => {
      const world = new worldModule.GameWorld();
      const frame = frameAtTick(0);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        world.sync(frame, 0);
        const actor = world.actors.get('child:child-1');
        if (actor?.imported?.joints.head) return { world, actor };
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      world.dispose();
      throw new Error('Timed out while waiting for the imported child actor.');
    };
    const jointRotations = (actor: ActorProbe) => new Map(
      Object.entries(actor.imported?.joints ?? {})
        .filter((entry): entry is [string, JointProbe] => Boolean(entry[1]))
        .map(([name, joint]) => [name, joint.quaternion.clone()]),
    );
    const jointBaseRotation = (actor: ActorProbe, name: string) => {
      const joint = actor.imported?.joints[name];
      return joint ? actor.imported?.captureJointRotations.get(joint) : undefined;
    };
    const angularSpan = (samples: readonly QuaternionProbe[]) => {
      let span = 0;
      for (let left = 0; left < samples.length; left += 1) {
        for (let right = left + 1; right < samples.length; right += 1) {
          span = Math.max(span, samples[left].angleTo(samples[right]));
        }
      }
      return span;
    };

    document.documentElement.dataset.reducedMotion = 'false';
    const live = await readyWorld();
    const sampledJointNames = [...jointRotations(live.actor).keys()];
    const initialHead = live.actor.imported?.joints.head?.quaternion.clone();
    const durationTicks = frameAtTick(0).capture?.durationTicks ?? 0;
    const debugFrame = stateModule.createDeterministicViewerFrame('capture', 71);
    const debugElapsedTicks = debugFrame.capture
      ? debugFrame.capture.durationTicks - debugFrame.capture.ticksRemaining
      : 0;
    let liveAtDebug: Map<string, QuaternionProbe> | null = null;
    const armJoints = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];
    const legJoints = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
    const struggleRotations = new Map<string, QuaternionProbe[]>(
      [...armJoints, ...legJoints].map((name) => [name, []]),
    );
    const previousLateRotations = new Map<string, QuaternionProbe>();
    let lateLimbTravel = 0;
    let maximumLateHeadTurn = 0;
    let minimumWingExtension = Number.POSITIVE_INFINITY;
    let maximumRestraintDistance = 0;
    let minimumRestraintDistance = Number.POSITIVE_INFINITY;
    for (let elapsedTicks = 1; elapsedTicks <= durationTicks; elapsedTicks += 1) {
      live.world.sync(frameAtTick(elapsedTicks), elapsedTicks / 60);
      const head = live.actor.imported?.joints.head?.quaternion;
      if (!head || !initialHead) throw new Error('Imported child head joint disappeared.');
      if (elapsedTicks === debugElapsedTicks) liveAtDebug = jointRotations(live.actor);
      const rotations = jointRotations(live.actor);
      if (elapsedTicks >= durationTicks * 0.2 && elapsedTicks <= durationTicks * 0.55) {
        for (const name of [...armJoints, ...legJoints]) {
          const current = rotations.get(name);
          if (current) struggleRotations.get(name)?.push(current);
          if (!current || (name !== 'leftUpperArm' && name !== 'rightUpperArm')) continue;
          const base = jointBaseRotation(live.actor, name);
          if (base) minimumWingExtension = Math.min(
            minimumWingExtension,
            current.angleTo(base),
          );
        }
      }
      if (elapsedTicks >= durationTicks - 12) {
        maximumLateHeadTurn = Math.max(maximumLateHeadTurn, head.angleTo(initialHead));
        for (const name of [...armJoints, ...legJoints]) {
          const current = rotations.get(name);
          const previous = previousLateRotations.get(name);
          if (current && previous) lateLimbTravel += current.angleTo(previous);
          if (current) previousLateRotations.set(name, current);
        }
      }
      const ghost = live.world.actors.get('ghost');
      if (ghost && elapsedTicks >= durationTicks * 0.2) {
        const restraintDistance = Math.hypot(
          live.actor.root.position.x - ghost.root.position.x,
          live.actor.root.position.z - ghost.root.position.z,
        );
        maximumRestraintDistance = Math.max(maximumRestraintDistance, restraintDistance);
        minimumRestraintDistance = Math.min(minimumRestraintDistance, restraintDistance);
      }
    }

    const direct = await readyWorld();
    direct.world.sync(debugFrame, debugElapsedTicks / 60);
    if (!liveAtDebug) throw new Error('Capture joint samples are unavailable.');
    let progressMismatch = 0;
    for (const [name, directRotation] of jointRotations(direct.actor)) {
      const liveRotation = liveAtDebug.get(name);
      if (liveRotation) {
        const mismatch = directRotation.angleTo(liveRotation);
        progressMismatch = Math.max(progressMismatch, mismatch);
      }
    }

    live.world.dispose();
    direct.world.dispose();
    return {
      minimumHipKickRange: Math.min(
        angularSpan(struggleRotations.get('leftUpperLeg') ?? []),
        angularSpan(struggleRotations.get('rightUpperLeg') ?? []),
      ),
      minimumKneeKickRange: Math.min(
        angularSpan(struggleRotations.get('leftLowerLeg') ?? []),
        angularSpan(struggleRotations.get('rightLowerLeg') ?? []),
      ),
      minimumWingExtension,
      minimumWingFlapRange: Math.min(
        angularSpan(struggleRotations.get('leftUpperArm') ?? []),
        angularSpan(struggleRotations.get('rightUpperArm') ?? []),
      ),
      lateLimbTravel,
      maximumLateHeadTurn,
      progressMismatch,
      restraintDrift: maximumRestraintDistance - minimumRestraintDistance,
      sampledJointNames,
    };
  });

  expect(result.sampledJointNames).toEqual([
    'chest',
    'head',
    'leftUpperArm',
    'rightUpperArm',
    'leftLowerArm',
    'rightLowerArm',
    'rightWrist',
    'rightHandSlot',
    'leftUpperLeg',
    'rightUpperLeg',
    'leftLowerLeg',
    'rightLowerLeg',
  ]);
  expect.soft(result.minimumWingExtension).toBeGreaterThan(0.6);
  expect.soft(result.minimumWingFlapRange).toBeGreaterThan(0.65);
  expect.soft(result.minimumHipKickRange).toBeGreaterThan(1.75);
  expect.soft(result.minimumKneeKickRange).toBeGreaterThan(0.9);
  expect.soft(result.lateLimbTravel).toBeGreaterThan(1.8);
  expect.soft(result.restraintDrift).toBeLessThan(0.001);
  expect.soft(result.progressMismatch).toBeLessThan(Math.PI / 36);
  expect(result.maximumLateHeadTurn).toBeLessThan(Math.PI / 2);
});
