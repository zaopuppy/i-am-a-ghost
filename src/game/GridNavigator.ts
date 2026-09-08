import { mapPositionIsOpen, mapSegmentIsOpen } from './MapCollision';
import { MATCH_RULES, type MatchMap, type Vec2 } from './MatchEngine';

// Keep paths away from exact collision tangencies: rounding while moving can put
// an actor on the blocked side of a mathematically traversable doorway edge.
const PATH_CLEARANCE = 0.02;

export class GridNavigator {
  private readonly nodes: Vec2[] = [];
  private readonly neighbors: number[][] = [];
  private readonly routes = new Map<string, { target: Vec2; nodes: number[] }>();

  constructor(private readonly map: MatchMap) {
    const spacing = 0.8;
    const grid = new Map<string, number>();
    let zIndex = 0;
    for (let z = map.bounds.minZ + 0.55; z <= map.bounds.maxZ - 0.55; z += spacing, zIndex += 1) {
      let xIndex = 0;
      for (let x = map.bounds.minX + 0.55; x <= map.bounds.maxX - 0.55; x += spacing, xIndex += 1) {
        const point = { x, z };
        if (!pointIsOpen(point, map)) continue;
        grid.set(`${xIndex}:${zIndex}`, this.nodes.length);
        this.nodes.push(point);
        this.neighbors.push([]);
      }
    }
    for (const [key, nodeIndex] of grid) {
      const [xIndex, currentZIndex] = key.split(':').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const neighbor = grid.get(`${xIndex + dx}:${currentZIndex + dz}`);
        if (neighbor === undefined) continue;
        if (this.hasLineOfSight(this.nodes[nodeIndex], this.nodes[neighbor])) {
          this.neighbors[nodeIndex].push(neighbor);
        }
      }
    }
  }

  hasLineOfSight(from: Vec2, to: Vec2): boolean {
    return mapSegmentIsOpen(
      this.map,
      from,
      to,
      MATCH_RULES.playerRadius + PATH_CLEARANCE,
      MATCH_RULES.mapCollisionRadius + PATH_CLEARANCE,
    );
  }

  moveToward(id: string, from: Vec2, to: Vec2, _tick: number): Vec2 {
    if (this.hasLineOfSight(from, to)) {
      const offset = { x: to.x - from.x, z: to.z - from.z };
      const distance = Math.hypot(offset.x, offset.z);
      if (distance < 0.025) return { x: 0, z: 0 };
      const divisor = Math.max(distance, 0.35);
      return { x: offset.x / divisor, z: offset.z / divisor };
    }
    const existing = this.routes.get(id);
    if (!existing || distanceBetween(existing.target, to) > 0.4 || existing.nodes.length === 0
      || !this.hasLineOfSight(from, this.nodes[existing.nodes[0]])) {
      const startNode = this.nearestNode(from);
      const targetNode = this.nearestNode(to);
      if (startNode < 0 || targetNode < 0) return { x: 0, z: 0 };
      this.routes.set(id, { target: { ...to }, nodes: this.findRoute(startNode, targetNode) });
    }
    const route = this.routes.get(id);
    if (!route) return { x: 0, z: 0 };
    // Replanning starts at the nearest grid node, which may be behind the actor.
    // Walk directly to the next reachable waypoint instead of stepping back onto it.
    while (route.nodes.length > 1 && this.hasLineOfSight(from, this.nodes[route.nodes[1]])) route.nodes.shift();
    const waypoint = this.nodes[route.nodes[0]];
    return normalized({ x: waypoint.x - from.x, z: waypoint.z - from.z });
  }

  private nearestNode(position: Vec2): number {
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.nodes.length; index += 1) {
      const distance = distanceBetween(position, this.nodes[index]);
      if (distance < nearestDistance && mapSegmentIsOpen(
        this.map, position, this.nodes[index], MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius,
      )) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    return nearest;
  }

  private findRoute(start: number, target: number): number[] {
    if (start === target) return [target];
    const previous = new Int32Array(this.nodes.length).fill(-1);
    const visited = new Uint8Array(this.nodes.length);
    const queue = new Int32Array(this.nodes.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      for (const neighbor of this.neighbors[current]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        previous[neighbor] = current;
        if (neighbor === target) {
          head = tail;
          break;
        }
        queue[tail++] = neighbor;
      }
    }
    if (!visited[target]) return [start];
    const route = [target];
    for (let current = target; current !== start;) {
      current = previous[current];
      route.push(current);
    }
    route.reverse();
    return route;
  }
}

function pointIsOpen(point: Vec2, map: MatchMap): boolean {
  return mapPositionIsOpen(map, point, MATCH_RULES.playerRadius + PATH_CLEARANCE, MATCH_RULES.mapCollisionRadius + PATH_CLEARANCE);
}

function distanceBetween(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function normalized(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.z);
  return length < 0.001 ? { x: 0, z: 0 } : { x: vector.x / length, z: vector.z / length };
}
