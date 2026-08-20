import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createHouseMaterialKit,
  createWallpaperWallGeometry,
  WALLPAPER_TILE_METERS,
  type WallpaperWallBounds,
} from '../../src/assets/MaterialLibrary';

test('wallpaper retains readable low-frequency contrast after wall tint and emissive fill', () => {
  const materials = createHouseMaterialKit();
  try {
    const contrast = lowFrequencyWallpaperContrast(materials.wall);
    assert.ok(
      contrast >= 0.16,
      `expected at least 0.16 relative low-frequency contrast, received ${contrast.toFixed(3)}`,
    );
  } finally {
    materials.dispose();
  }
});

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

function lowFrequencyWallpaperContrast(material: THREE.MeshStandardMaterial): number {
  assert.ok(material.map instanceof THREE.DataTexture);
  const image = material.map.image as {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  };
  const blockSize = 32;
  const samples: number[] = [];
  for (let blockY = 0; blockY < image.height; blockY += blockSize) {
    for (let blockX = 0; blockX < image.width; blockX += blockSize) {
      let luminance = 0;
      for (let y = blockY; y < blockY + blockSize; y += 1) {
        for (let x = blockX; x < blockX + blockSize; x += 1) {
          const offset = (y * image.width + x) * 4;
          const textureRed = srgbToLinear(image.data[offset] / 255);
          const textureGreen = srgbToLinear(image.data[offset + 1] / 255);
          const textureBlue = srgbToLinear(image.data[offset + 2] / 255);
          const emissiveRed = material.emissiveMap ? textureRed : 1;
          const emissiveGreen = material.emissiveMap ? textureGreen : 1;
          const emissiveBlue = material.emissiveMap ? textureBlue : 1;
          const red = textureRed * material.color.r
            + emissiveRed * material.emissive.r * material.emissiveIntensity;
          const green = textureGreen * material.color.g
            + emissiveGreen * material.emissive.g * material.emissiveIntensity;
          const blue = textureBlue * material.color.b
            + emissiveBlue * material.emissive.b * material.emissiveIntensity;
          luminance += red * 0.2126 + green * 0.7152 + blue * 0.0722;
        }
      }
      samples.push(luminance / (blockSize * blockSize));
    }
  }
  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  return (maximum - minimum) / mean;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}
