import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE, hexToThree } from './theme'

// Two-tier world-dressing grid with a radial brightness fade (Task 2 §1). ENGINEERING CHOICE: a single
// ground plane carrying a custom ShaderMaterial — ONE draw call, and ALL of the grid (minor cells, every-
// 5th majors, and the concentric fade) lives in the fragment shader with static uniforms, so there is
// ZERO per-frame work (no useFrame here at all). This is why a shader plane wins over "two gridHelpers +
// a radial-alpha overlay": that path is ≥2 line-segment draw calls and still needs per-vertex alpha the
// gridHelper can't express, whereas the shader gives per-pixel line AA (fwidth) and a true circular fade
// for free. The fade is brightest under the scene centre (the resting subject sits at the origin) and
// dies smoothly before the geometric edge — echoing the favicon's concentric range rings.
//
// Fog is deliberately NOT wired into this material: the radial alpha already dissolves the grid into the
// backdrop at the horizon, so the fog chunks (which a raw ShaderMaterial does not inherit) are unneeded.

// Plane half-extent. Generous enough to lie under f1's ~250u corridor so a moving subject (which the
// follow-cam tracks) never flies over pure void; the fade (below) reaches 0 well inside this, so the
// geometric edge is never a visible line.
const GRID_HALF = 320
// Radial fade (world units from origin): full brightness within FADE_INNER, gone by FADE_OUTER. A gentle
// ramp keeps the range-ring pad BRIGHTEST under the origin (where the resting subject sits — the fade at
// the centre is always 1, so the hero frame is unaffected by how far the ramp reaches) while still
// carrying visibly-lit grid out along f1's motion corridor (~0.7 at the mid-point, faint at the far end)
// so the trajectory reads against structure, not void. FADE_OUTER < GRID_HALF → alpha hits 0 before the
// plane edge (no hard cutoff line).
const FADE_INNER = 6
const FADE_OUTER = 260

const VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vXZ = wp.xz;               // true world XZ, independent of the plane's flat rotation
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vXZ;
  uniform vec3 uCell;
  uniform vec3 uMajor;
  uniform float uFadeInner;
  uniform float uFadeOuter;

  // Anti-aliased line coverage at a given spacing: distance to the nearest gridline in pixels (via
  // fwidth screen-space derivatives), clamped to a 1px-wide line. Standard "pristine grid" technique.
  float lineFactor(vec2 coord, float spacing) {
    vec2 c = coord / spacing;
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    float cell = lineFactor(vXZ, 1.0);
    float major = lineFactor(vXZ, 5.0);
    vec3 col = mix(uCell, uMajor, major);   // major lines ride brighter; between them, cell tone
    float line = max(cell, major);
    float radial = 1.0 - smoothstep(uFadeInner, uFadeOuter, length(vXZ));
    float a = line * radial;
    if (a <= 0.0) discard;
    gl_FragColor = vec4(col, a);
  }
`

export function RadialGrid() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uCell: { value: new THREE.Color(hexToThree(PALETTE.gridCell)) },
      uMajor: { value: new THREE.Color(hexToThree(PALETTE.gridMajor)) },
      uFadeInner: { value: FADE_INNER },
      uFadeOuter: { value: FADE_OUTER },
    },
  }), [])
  // The ShaderMaterial is created imperatively and mounted via <primitive>, so r3f does NOT auto-dispose
  // it on unmount (unlike the JSX <planeGeometry> intrinsic, which r3f owns and releases). Release its GPU
  // program/uniforms explicitly when the grid unmounts, e.g. a run switch remounting the Canvas (§5).
  useEffect(() => () => material.dispose(), [material])
  return (
    // renderOrder -1 so the transparent grid composits before the (opaque, depth-writing) cones and the
    // trail; depthWrite:false keeps it from occluding anything above the deck.
    <mesh rotation-x={-Math.PI / 2} renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[GRID_HALF * 2, GRID_HALF * 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
