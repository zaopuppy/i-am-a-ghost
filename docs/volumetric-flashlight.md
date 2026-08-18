# Shadow-Mapped Volumetric Flashlight

## Status

Implemented as the rendering contract for the flashlight pass.

## Goal

The flashlight must behave as a three-dimensional cone of participating light:

- Walls and door frames split the beam spatially instead of shortening the whole cone.
- The lit half of a doorway may stop on the wall while the open half continues into the next room.
- The same shadow map drives both surface illumination and visible air scattering.
- A hidden ghost must never become observable through a shadow, depth sample, or render diagnostic.

This is a visual system. Authoritative hit detection remains the existing deterministic 2D wall test in `MatchEngine`.

## Pipeline

### 1. Authoritative visible scene

`GameWorld.sync()` applies viewer projection first. Objects absent from the viewer frame are hidden before rendering. The depth/color pass therefore contains only information the viewer is allowed to see.

### 2. Flashlight shadow maps

Every active flashlight owns a real `THREE.SpotLight` with a 512 x 512 shadow map. A dedicated flashlight-occluder layer contains wall meshes only:

- Procedural fallback walls enable the occluder layer.
- Imported replacement walls enable the same layer when loaded.
- Characters, dolls, pickups, meters, and VFX do not enter this layer.

The spotlight shadow camera renders only this layer. This prevents self-shadowing at the child's hand and makes hidden-character privacy structural rather than dependent on timing.

### 3. Scene color and depth

When at least one flashlight is active, the main scene renders to a full-resolution color target with a depth texture. With no active flashlight, rendering stays on the direct path and pays no post-process cost.

The orthographic camera depth is reconstructed with the inverse projection and camera-world matrices. Each screen pixel produces a world-space ray from its near-plane point to the nearest visible scene surface.

### 4. Per-light volume integration

Each active flashlight adds one fullscreen pass. The shader:

1. Intersects the camera ray with a sphere bounding the spotlight cone.
2. Marches 28 jittered samples only through that bounded interval.
3. Rejects samples outside the finite cone.
4. Samples the spotlight depth map with a four-tap PCF comparison.
5. Integrates axial fade, radial edge fade, and a mild forward-scattering phase term.
6. Additively composites the result over scene color.

Because every sample has its own shadow lookup, one side of a beam can be occluded while adjacent samples continue through a doorway.

## Surface lighting

The same `SpotLight` remains in the Three.js scene, so standard materials receive flashlight illumination and wall shadows. The volumetric pass adds scattering only; it does not fake the wall hit with an opaque decal or truncate geometry.

## Privacy invariants

- Viewer projection runs before all render passes.
- Main scene depth contains only currently visible objects.
- Flashlight shadow cameras see the wall-only occluder layer.
- Ghost meshes never enter flashlight shadow maps, whether visible or hidden.
- Rendering does not feed data back into simulation or network state.

## Performance budget

Target: desktop/laptop browser, capped at DPR 2.

| Cost | Budget |
| --- | --- |
| Active flashlight shadow maps | Up to 4 at 512 x 512 |
| Shadow casters | Static wall meshes only |
| Main scene offscreen passes | 1 only while a flashlight is active |
| Composite passes | 1 color copy + 1 per active flashlight |
| Ray-march samples | 28 per light/pixel inside the bounding sphere |
| Persistent render targets | 1 color target + 1 depth texture |

The maximum case is intentionally expensive: four wall-only shadow passes, one scene pass, one copy, and four volume passes. The wall-only caster set limits vertex/draw cost; sphere-bounded marching limits fragment work. If profiling shows a sustained regression, degrade in this order:

1. Lower shadow maps from 512 to 256.
2. Lower ray-march samples from 28 to 20.
3. Render the color/depth target at 0.75 resolution.
4. Disable volume for secondary flashlights while preserving shadowed surface lights.

## Resource lifecycle

- Render target, depth texture, fullscreen geometry, and post materials are owned and disposed by `RenderStage`.
- Spotlight shadow maps are disposed with their `GameWorld` beam owners.
- Resize updates the orthographic projection, renderer drawing buffer, and offscreen target together.

## Acceptance criteria

- A doorway produces a split beam: wall-side samples stop while opening-side samples continue.
- Flashlight surface light does not illuminate through a wall.
- The visible cone direction follows child aim and does not point into the child's face.
- Child-hidden frames contain no ghost object, depth, or flashlight shadow-caster contribution.
- Zero active flashlights use the direct render path.
- One to four active flashlights compile and render without console errors.
- Production build, rule tests, browser interaction tests, and deterministic visual snapshots pass.

