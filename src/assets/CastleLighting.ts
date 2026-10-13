import * as THREE from 'three';

/** Two fixed, shadow-free practicals establish room focal points. */
export function createCastleCandleLighting(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'castle-practical-lights';
  const chapel = new THREE.PointLight(0xffbf72, 18, 5.5, 2);
  chapel.name = 'chapel-votive-pool';
  chapel.position.set(0, 1.8, -10.3);
  const banquet = new THREE.PointLight(0xffce91, 10, 6, 2);
  banquet.name = 'banquet-candle-pool';
  banquet.position.set(-3.5, 1.9, 1);
  root.add(chapel, banquet);
  return root;
}

/**
 * A tiny reflection panorama for the castle's brass, pewter and glazed pottery.
 * Three.js prefilters scene environments once into a cached PMREM on first use;
 * disposing this source also releases that cached GPU target. It is not a sky
 * background or an additional dynamic light.
 */
export function createCastleReflectionEnvironment(): THREE.DataTexture {
  const width = 128;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const elevation = Math.sin(((y + 0.5) / height - 0.5) * Math.PI);
    const sky = Math.max(0, elevation);
    for (let x = 0; x < width; x += 1) {
      const azimuth = (x + 0.5) / width * Math.PI * 2;
      // Broad, soft practical reflections: small, warm windows below moonlight.
      const warmWindow = Math.exp(
        -Math.pow(Math.sin((azimuth - 0.7) / 2) / 0.15, 2)
        -Math.pow((elevation - 0.15) / 0.22, 2),
      );
      const moonWindow = Math.exp(
        -Math.pow(Math.sin((azimuth - 3.9) / 2) / 0.20, 2)
        -Math.pow((elevation - 0.45) / 0.32, 2),
      );
      const floor = Math.max(0, -elevation);
      const channels = [
        0.075 + sky * 0.15 - floor * 0.05 + warmWindow * 0.65 + moonWindow * 0.15,
        0.075 + sky * 0.21 - floor * 0.05 + warmWindow * 0.39 + moonWindow * 0.23,
        0.095 + sky * 0.32 - floor * 0.07 + warmWindow * 0.18 + moonWindow * 0.38,
      ];
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(THREE.MathUtils.clamp(channels[channel], 0, 1) * 255);
      }
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'castle-moon-and-candle-reflections';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
