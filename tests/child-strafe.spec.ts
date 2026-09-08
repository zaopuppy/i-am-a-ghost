import { expect, test } from '@playwright/test';

for (const direction of [-1, 1]) {
  test(`side-stepping ${direction < 0 ? 'left' : 'right'} plants alternating feet while keeping the torso facing the light`, async ({ page }) => {
    await page.goto('/?testState=child-playing');
    await expect(page.getByTestId('role-label')).toContainText('小孩', { timeout: 20_000 });
    const { steps: samples, captureHipError } = await page.evaluate(async (direction) => {
      const load = (path: string) => import(path);
      const THREE = await load('/node_modules/three/build/three.module.js');
      const { GameWorld } = await load('/src/game/GameWorld.ts');
      const { createDeterministicViewerFrame } = await load('/src/testing/DeterministicStates.ts');
      const world = new GameWorld();
      const frame = createDeterministicViewerFrame('child-playing', 71);
      const child = frame.children.find((candidate: { playerId: string }) => candidate.playerId === 'child-1');
      child.facingRadians = 0;
      child.flashlightOn = true;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        world.sync(frame, 0);
        if (world.actors.get('child:child-1')?.strafeAnimation) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const actor = world.actors.get('child:child-1');
      if (!actor?.strafeAnimation) throw new Error('Strafe rig did not load.');
      const left = actor.imported.joints.leftLowerLeg.children[0];
      const right = actor.imported.joints.rightLowerLeg.children[0];
      const hips = actor.imported.joints.leftUpperLeg.parent;
      const restHipsInverse = hips.getWorldQuaternion(new THREE.Quaternion()).invert();
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1280, 640);
      renderer.setPixelRatio(1);
      renderer.setScissorTest(true);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#202a36');
      scene.add(new THREE.HemisphereLight(0xffffff, 0x687080, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 7, 5);
      scene.add(light, actor.root);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#596471' }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      scene.add(floor);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      const probe = new THREE.Vector3();
      const output: Array<{ rootZ: number; leftZ: number; rightZ: number; leftY: number; rightY: number; facing: number; hipRadians: number }> = [];
      let panel = 0;
      for (let tick = 1; tick <= 100; tick += 1) {
        child.position.z += direction * 0.025;
        world.sync(frame, tick / 60);
        const leftPosition = left.getWorldPosition(probe).clone();
        const rightPosition = right.getWorldPosition(probe).clone();
        const hipRotation = hips.getWorldQuaternion(new THREE.Quaternion()).multiply(restHipsInverse);
        const hipForward = new THREE.Vector3(1, 0, 0).applyQuaternion(hipRotation);
        if (tick > 30) output.push({
          rootZ: child.position.z,
          leftZ: leftPosition.z,
          rightZ: rightPosition.z,
          leftY: leftPosition.y,
          rightY: rightPosition.y,
          facing: -actor.bodyPivot.rotation.y,
          hipRadians: Math.atan2(hipForward.z, hipForward.x),
        });
        if ([42, 45, 48, 51, 54, 57, 60, 63].includes(tick)) {
          const column = panel % 4;
          const row = Math.floor(panel / 4);
          renderer.setViewport(column * 320, (1 - row) * 320, 320, 320);
          renderer.setScissor(column * 320, (1 - row) * 320, 320, 320);
          camera.position.set(child.position.x + 3, 1.8, child.position.z + 2.5);
          camera.lookAt(child.position.x, 0.7, child.position.z);
          renderer.render(scene, camera);
          panel += 1;
        }
      }
      document.body.replaceChildren(renderer.domElement);
      document.body.style.margin = '0';
      const baseHipRotation = actor.strafeAnimation.baseHipsRotation.clone();
      frame.phase = 'capture-animation';
      frame.capture = { childPlayerId: child.playerId, ticksRemaining: 180, durationTicks: 210 };
      world.sync(frame, 101 / 60);
      return { steps: output, captureHipError: hips.quaternion.angleTo(baseHipRotation) };
    }, direction);
    expect(captureHipError).toBeLessThan(0.001);
    for (const sample of samples) {
      expect(sample.facing).toBeCloseTo(0, 5);
      expect(sample.hipRadians).toBeCloseTo(direction * Math.PI / 4, 2);
    }
    const plantedLeft = samples.slice(1).filter((sample, index) => Math.abs(sample.leftZ - samples[index].leftZ) < 0.008);
    const plantedRight = samples.slice(1).filter((sample, index) => Math.abs(sample.rightZ - samples[index].rightZ) < 0.008);
    expect(plantedLeft.length).toBeGreaterThan(15);
    expect(plantedRight.length).toBeGreaterThan(15);
    expect(Math.max(...samples.map((sample) => sample.leftY)) - Math.min(...samples.map((sample) => sample.leftY))).toBeGreaterThan(0.06);
    expect(Math.max(...samples.map((sample) => sample.rightY)) - Math.min(...samples.map((sample) => sample.rightY))).toBeGreaterThan(0.06);
    await page.screenshot({ path: `test-results/child-strafe-${direction < 0 ? 'left' : 'right'}.png` });
  });
}
