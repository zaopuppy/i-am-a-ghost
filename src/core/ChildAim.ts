import * as THREE from 'three';
import type { Vec2 } from '../game/MatchEngine';
import { dampAngle } from '../game/VisualFacing';

/** Converts a cursor on the rendered canvas to a direction on the world floor. */
export class ChildAim {
  radians = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly point = new THREE.Vector3();
  private readonly cursor = new THREE.Vector2();

  reset(radians: number): void { this.radians = radians; }

  mouseDirection(
    mouse: { x: number; y: number },
    bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    camera: THREE.Camera,
    position: Vec2,
  ): Vec2 | null {
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const x = (mouse.x - bounds.left) / bounds.width;
    const y = (mouse.y - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    this.cursor.set(x * 2 - 1, 1 - y * 2);
    this.raycaster.setFromCamera(this.cursor, camera);
    if (!this.raycaster.ray.intersectPlane(this.floor, this.point)) return null;
    const direction = { x: this.point.x - position.x, z: this.point.z - position.z };
    return Math.hypot(direction.x, direction.z) < 0.08 ? null : direction;
  }

  advance(direction: Vec2 | null, deltaSeconds: number): number {
    if (direction && Math.hypot(direction.x, direction.z) > 0.001) {
      // About 95% of a turn in 100ms; smooth once, before sending the same heading to authority.
      this.radians = dampAngle(this.radians, Math.atan2(direction.z, direction.x), 30, deltaSeconds);
    }
    return this.radians;
  }
}
