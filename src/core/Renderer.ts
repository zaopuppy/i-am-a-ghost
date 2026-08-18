import * as THREE from 'three';

const DEFAULT_VIEW_HEIGHT = 22;
const VOLUME_SAMPLE_COUNT = 28;

const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COPY_FRAGMENT_SHADER = `
  uniform sampler2D uSceneColor;
  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(uSceneColor, vUv);
  }
`;

const VOLUME_FRAGMENT_SHADER = `
  #define VOLUME_SAMPLE_COUNT ${VOLUME_SAMPLE_COUNT}

  uniform sampler2D uSceneDepth;
  uniform sampler2DShadow uShadowDepth;
  uniform mat4 uProjectionInverse;
  uniform mat4 uCameraWorld;
  uniform mat4 uShadowMatrix;
  uniform vec3 uLightOrigin;
  uniform vec3 uLightDirection;
  uniform vec3 uLightColor;
  uniform vec3 uBoundsCenter;
  uniform vec2 uShadowTexelSize;
  uniform float uBoundsRadius;
  uniform float uLightLength;
  uniform float uConeAngle;
  uniform float uDensity;
  uniform float uShadowBias;
  varying vec2 vUv;

  float hash12(vec2 value) {
    vec3 p3 = fract(vec3(value.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 unprojectWorld(vec2 uv, float depth) {
    vec4 viewPosition = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    viewPosition /= max(0.00001, viewPosition.w);
    return (uCameraWorld * viewPosition).xyz;
  }

  float sampleShadow(vec4 shadowPosition) {
    vec3 projected = shadowPosition.xyz / max(0.00001, shadowPosition.w);
    if (
      projected.x < 0.0 || projected.x > 1.0 ||
      projected.y < 0.0 || projected.y > 1.0 ||
      projected.z < 0.0 || projected.z > 1.0
    ) return 0.0;

    vec2 texel = uShadowTexelSize * 0.72;
    float receiverDepth = projected.z - uShadowBias;
    float visibility = 0.0;
    visibility += texture(uShadowDepth, vec3(projected.xy + vec2(-texel.x, -texel.y), receiverDepth));
    visibility += texture(uShadowDepth, vec3(projected.xy + vec2( texel.x, -texel.y), receiverDepth));
    visibility += texture(uShadowDepth, vec3(projected.xy + vec2(-texel.x,  texel.y), receiverDepth));
    visibility += texture(uShadowDepth, vec3(projected.xy + vec2( texel.x,  texel.y), receiverDepth));
    return visibility * 0.25;
  }

  void main() {
    float sceneDepth = texture2D(uSceneDepth, vUv).r;
    vec3 rayStart = unprojectWorld(vUv, 0.0);
    vec3 rayEnd = unprojectWorld(vUv, sceneDepth);
    vec3 rayVector = rayEnd - rayStart;
    float sceneDistance = length(rayVector);
    if (sceneDistance <= 0.0001) discard;
    vec3 rayDirection = rayVector / sceneDistance;

    vec3 sphereOffset = rayStart - uBoundsCenter;
    float sphereProjection = dot(sphereOffset, rayDirection);
    float sphereDiscriminant = sphereProjection * sphereProjection
      - dot(sphereOffset, sphereOffset)
      + uBoundsRadius * uBoundsRadius;
    if (sphereDiscriminant <= 0.0) discard;

    float sphereSpan = sqrt(sphereDiscriminant);
    float intervalStart = max(0.0, -sphereProjection - sphereSpan);
    float intervalEnd = min(sceneDistance, -sphereProjection + sphereSpan);
    if (intervalEnd <= intervalStart) discard;

    float stepLength = (intervalEnd - intervalStart) / float(VOLUME_SAMPLE_COUNT);
    float jitter = hash12(gl_FragCoord.xy);
    float scattering = 0.0;
    float tangent = tan(uConeAngle);
    float phase = 0.78 + 0.22 * max(0.0, dot(-rayDirection, uLightDirection));

    for (int sampleIndex = 0; sampleIndex < VOLUME_SAMPLE_COUNT; sampleIndex += 1) {
      float distanceAlongRay = intervalStart + (float(sampleIndex) + jitter) * stepLength;
      vec3 samplePosition = rayStart + rayDirection * distanceAlongRay;
      vec3 lightOffset = samplePosition - uLightOrigin;
      float axialDistance = dot(lightOffset, uLightDirection);
      if (axialDistance <= 0.0 || axialDistance >= uLightLength) continue;

      float coneRadius = max(0.025, tangent * axialDistance);
      float radialDistance = length(lightOffset - uLightDirection * axialDistance);
      float radialRatio = radialDistance / coneRadius;
      if (radialRatio >= 1.0) continue;

      float axialRatio = axialDistance / uLightLength;
      float radialFade = 1.0 - smoothstep(0.68, 1.0, radialRatio);
      float nearFade = smoothstep(0.0, 0.08, axialRatio);
      float farFade = 1.0 - smoothstep(0.72, 1.0, axialRatio);
      float visibility = sampleShadow(uShadowMatrix * vec4(samplePosition, 1.0));
      scattering += radialFade * nearFade * farFade * visibility * stepLength;
    }

    float energy = scattering * uDensity * phase;
    if (energy <= 0.0001) discard;
    gl_FragColor = vec4(uLightColor * energy, 1.0);
  }
`;

export interface RenderStage {
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
  setCameraPose(position: THREE.Vector3, target: THREE.Vector3, viewHeight: number): void;
  render(scene: THREE.Scene, flashlights: readonly THREE.SpotLight[]): void;
  resize(): void;
  dispose(): void;
}

export function createRenderStage(canvas: HTMLCanvasElement): RenderStage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  sceneTarget.texture.name = 'volumetric-scene-color';
  sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  sceneTarget.depthTexture.name = 'volumetric-scene-depth';
  sceneTarget.depthTexture.format = THREE.DepthFormat;
  sceneTarget.depthTexture.minFilter = THREE.NearestFilter;
  sceneTarget.depthTexture.magFilter = THREE.NearestFilter;

  const copyMaterial = new THREE.ShaderMaterial({
    name: 'volumetric-scene-copy',
    uniforms: {
      uSceneColor: { value: sceneTarget.texture },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: COPY_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const volumeMaterial = new THREE.ShaderMaterial({
    name: 'shadow-mapped-volumetric-flashlight',
    uniforms: {
      uSceneDepth: { value: sceneTarget.depthTexture },
      uShadowDepth: { value: null as THREE.DepthTexture | null },
      uProjectionInverse: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uLightOrigin: { value: new THREE.Vector3() },
      uLightDirection: { value: new THREE.Vector3(1, 0, 0) },
      uLightColor: { value: new THREE.Color(0xffdfa0) },
      uBoundsCenter: { value: new THREE.Vector3() },
      uShadowTexelSize: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uBoundsRadius: { value: 1 },
      uLightLength: { value: 1 },
      uConeAngle: { value: 0.2 },
      uDensity: { value: 0.48 },
      uShadowBias: { value: 0.0012 },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: VOLUME_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
  const lightOrigin = new THREE.Vector3();
  const lightTarget = new THREE.Vector3();
  const lightDirection = new THREE.Vector3();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 160);
  camera.up.set(0, 1, 0);
  camera.position.set(10, 24, 14);
  camera.lookAt(0, 0, 0);
  let currentViewHeight = DEFAULT_VIEW_HEIGHT;

  const updateProjection = (width: number, height: number): void => {
    const aspect = width / height;
    camera.left = (-currentViewHeight * aspect) / 2;
    camera.right = (currentViewHeight * aspect) / 2;
    camera.top = currentViewHeight / 2;
    camera.bottom = -currentViewHeight / 2;
    camera.updateProjectionMatrix();
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    updateProjection(width, height);
    renderer.setSize(width, height, false);
    const pixelRatio = renderer.getPixelRatio();
    sceneTarget.setSize(
      Math.max(1, Math.round(width * pixelRatio)),
      Math.max(1, Math.round(height * pixelRatio)),
    );
  };

  const render = (scene: THREE.Scene, flashlights: readonly THREE.SpotLight[]): void => {
    renderer.info.reset();
    if (flashlights.length === 0) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(sceneTarget);
    renderer.autoClear = true;
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.clear();
    postQuad.material = copyMaterial;
    renderer.render(postScene, postCamera);

    volumeMaterial.uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    volumeMaterial.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    for (const light of flashlights) {
      const shadowMap = light.shadow.map;
      const shadowDepth = shadowMap?.depthTexture;
      if (!shadowMap || !shadowDepth || light.intensity <= 0) continue;

      light.getWorldPosition(lightOrigin);
      light.target.getWorldPosition(lightTarget);
      lightDirection.subVectors(lightTarget, lightOrigin).normalize();
      const length = Math.max(0.01, light.distance);
      const farRadius = Math.tan(light.angle) * length;
      const boundsRadius = Math.hypot(length * 0.5, farRadius);

      volumeMaterial.uniforms.uShadowDepth.value = shadowDepth;
      volumeMaterial.uniforms.uShadowMatrix.value.copy(light.shadow.matrix);
      volumeMaterial.uniforms.uLightOrigin.value.copy(lightOrigin);
      volumeMaterial.uniforms.uLightDirection.value.copy(lightDirection);
      volumeMaterial.uniforms.uLightColor.value.copy(light.color).multiplyScalar(
        THREE.MathUtils.clamp(light.intensity / 48, 0.45, 1.7),
      );
      volumeMaterial.uniforms.uBoundsCenter.value
        .copy(lightOrigin)
        .addScaledVector(lightDirection, length * 0.5);
      volumeMaterial.uniforms.uBoundsRadius.value = boundsRadius;
      volumeMaterial.uniforms.uLightLength.value = length;
      volumeMaterial.uniforms.uConeAngle.value = light.angle;
      volumeMaterial.uniforms.uShadowTexelSize.value.set(1 / shadowMap.width, 1 / shadowMap.height);
      postQuad.material = volumeMaterial;
      renderer.render(postScene, postCamera);
    }
    renderer.autoClear = previousAutoClear;
  };

  resize();

  return {
    renderer,
    camera,
    setCameraPose: (position, target, viewHeight) => {
      const heightChanged = currentViewHeight !== viewHeight;
      currentViewHeight = viewHeight;
      camera.position.copy(position);
      camera.lookAt(target);
      if (heightChanged) {
        updateProjection(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      }
    },
    render,
    resize,
    dispose: () => {
      postQuad.geometry.dispose();
      copyMaterial.dispose();
      volumeMaterial.dispose();
      sceneTarget.dispose();
      renderer.dispose();
    },
  };
}
