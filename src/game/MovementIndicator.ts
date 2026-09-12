import * as THREE from 'three';
import type { Vec2 } from './MatchEngine';
import type { ViewerFrame } from './ViewerFrame';

/** Local movement intent, independent of actor facing and collision response. */
export class MovementIndicator {
  readonly root: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    // A compact open chevron ahead of the feet, pointing along local +X.
    const shape = new THREE.Shape();
    shape.moveTo(0.52, -0.26);
    shape.lineTo(0.86, 0);
    shape.lineTo(0.52, 0.26);
    shape.lineTo(0.43, 0.15);
    shape.lineTo(0.63, 0);
    shape.lineTo(0.43, -0.15);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    this.root = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xffe0a0,
      transparent: true,
      opacity: 0.85,
      // Intent must remain readable when the player pushes into a door or prop.
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    this.root.name = 'local-movement-indicator';
    this.root.renderOrder = 20;
    this.root.visible = false;
  }

  sync(frame: ViewerFrame | null, movement: Vec2): void {
    const position = frame?.viewerRole === 'ghost'
      ? frame.ghost?.position
      : frame?.children.find((child) => child.playerId === frame.viewerPlayerId)?.position;
    this.root.visible = Boolean(
      position && (frame?.phase === 'playing' || frame?.phase === 'protection')
      && Number.isFinite(movement.x) && Number.isFinite(movement.z)
      && Math.hypot(movement.x, movement.z) > 0,
    );
    if (!this.root.visible || !position) return;
    this.root.position.set(position.x, 0.035, position.z);
    this.root.rotation.y = -Math.atan2(movement.z, movement.x);
  }
}
