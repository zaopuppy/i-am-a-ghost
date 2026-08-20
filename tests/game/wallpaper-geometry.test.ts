import assert from 'node:assert/strict';
import test from 'node:test';
import type * as THREE from 'three';
import {
  createWallpaperWallGeometry,
  WALLPAPER_TILE_METERS,
  type WallpaperWallBounds,
} from '../../src/assets/MaterialLibrary';

test('wallpaper UV density stays constant when a wall is resized', () => {
  const shortWall = createWallpaperWallGeometry(bounds(-1, 1), 2.8);
  const longWall = createWallpaperWallGeometry(bounds(-4, 4), 2.8);

  assert.ok(Math.abs(frontFaceUvSpan(shortWall).u - 2 / WALLPAPER_TILE_METERS.width) < 1e-6);
  assert.ok(Math.abs(frontFaceUvSpan(longWall).u - 8 / WALLPAPER_TILE_METERS.width) < 1e-6);
  assert.ok(Math.abs(frontFaceUvSpan(shortWall).v - 2.8 / WALLPAPER_TILE_METERS.height) < 1e-6);
  assert.ok(Math.abs(frontFaceUvSpan(longWall).v - 2.8 / WALLPAPER_TILE_METERS.height) < 1e-6);

  shortWall.dispose();
  longWall.dispose();
});

test('adjacent wall segments share the same world-aligned wallpaper phase', () => {
  const left = createWallpaperWallGeometry(bounds(-4, 0), 2.8);
  const right = createWallpaperWallGeometry(bounds(0, 4), 2.8);

  assert.ok(Math.abs(frontFaceUvSpan(left).maxU - frontFaceUvSpan(right).minU) < 1e-6);

  left.dispose();
  right.dispose();
});

function bounds(minX: number, maxX: number): WallpaperWallBounds {
  return { minX, maxX, minZ: -0.1, maxZ: 0.1 };
}

function frontFaceUvSpan(geometry: THREE.BoxGeometry): {
  u: number;
  v: number;
  minU: number;
  maxU: number;
} {
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  const selected: Array<{ u: number; v: number }> = [];
  for (let index = 0; index < normals.count; index += 1) {
    if (normals.getZ(index) <= 0.5) continue;
    selected.push({ u: uvs.getX(index), v: uvs.getY(index) });
  }
  assert.ok(selected.length > 0);
  const minU = Math.min(...selected.map((point) => point.u));
  const maxU = Math.max(...selected.map((point) => point.u));
  const minV = Math.min(...selected.map((point) => point.v));
  const maxV = Math.max(...selected.map((point) => point.v));
  return { u: maxU - minU, v: maxV - minV, minU, maxU };
}
