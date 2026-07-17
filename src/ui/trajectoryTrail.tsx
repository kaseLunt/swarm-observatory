import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useViewStore } from '../state/viewStore'
import { trailHold } from './frameChannels'
import { PALETTE, hexToThree } from './theme'
import { TRAIL_HEAD_ALPHA, TRAIL_TAIL_ALPHA, TRAIL_FADE_TICKS, type Trail } from './trail'

// Head-relative trail fade. The precomputed positions never change; alpha is a pure
// function of how many ticks a vertex sits BEHIND the currently-revealed head (uHead - aIndex), written
// once per frame as a uniform beside setDrawRange. This replaces the old per-vertex RGBA ramp that baked
// alpha against the FINAL run length — which rendered the tick-1 head at ~0.07 alpha (a near-invisible
// trail through most of playback). Now the head is bright at any tick and the tail fades over ~FADE ticks.
const TRAIL_VERT = /* glsl */ `
  attribute float aIndex;
  uniform float uHead;
  uniform float uFadeTicks;
  uniform float uHeadAlpha;
  uniform float uTailAlpha;
  varying float vAlpha;
  void main() {
    float behind = uHead - aIndex;               // 0 at the revealed head, grows for older ticks
    float fade = clamp(1.0 - behind / uFadeTicks, 0.0, 1.0);
    vAlpha = mix(uTailAlpha, uHeadAlpha, fade);   // bright head → faint tail, independent of run length
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const TRAIL_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
  }
`

// Fading polyline of the subject's recorded path. The WHOLE path is precomputed once at model
// load (buildTrail, lifted to <Scene> so bounds reuse the same walk) — positions + a per-vertex index —
// and the frame loop only advances drawRange to reveal the traveled portion and points uHead at the head.
// Zero per-frame allocation; drawRange + a uHead write each frame, plus a hold-light uFadeTicks write ONLY
// when the tour-hold state changes: a hold at rest lights the whole revealed path, and any
// playback returns the comet. Renders nothing for runs without a drawable trajectory (e0 has no positioned
// entities; f0 is a static point) — trailHold is inert there (the useFrame early-returns on a null line).
export function TrajectoryTrail({ trail }: { trail: Trail }) {
  // Built imperatively as a THREE.Line and mounted via <primitive>: r3f's <line> intrinsic collides with
  // the DOM/SVG <line> type under the React-19 JSX transform, so an explicit object is the clean path. The
  // geometry + head-relative-fade ShaderMaterial are constructed ONCE per trail (useMemo). The `aIndex`
  // attribute feeds the shader's per-vertex fade; uColor carries the accent (toneMapped is moot for a raw
  // ShaderMaterial — it writes gl_FragColor directly — and the composer's ACES still runs on the frame).
  const line = useMemo(() => {
    const { positions, index, count } = trail
    if (count < 2) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aIndex', new THREE.BufferAttribute(index, 1))
    geo.setDrawRange(0, 0) // start hidden; the frame loop reveals up to the current tick
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uHead: { value: 0 },
        uColor: { value: new THREE.Color(hexToThree(PALETTE.accent)) },
        uFadeTicks: { value: TRAIL_FADE_TICKS },
        uHeadAlpha: { value: TRAIL_HEAD_ALPHA },
        uTailAlpha: { value: TRAIL_TAIL_ALPHA },
      },
    })
    const obj = new THREE.Line(geo, mat)
    obj.frustumCulled = false
    // uFadeTicks is exposed alongside uHead so the frame loop can flip the fade window between the comet
    // (TRAIL_FADE_TICKS) and a fully-lit path (1e9 ⇒ every vertex clamps to the head alpha) on a tour hold.
    return { obj, geo, mat, count, uHead: mat.uniforms.uHead!, uFadeTicks: mat.uniforms.uFadeTicks! }
  }, [trail])
  // <primitive> objects are owned by us, not auto-disposed by r3f — release GPU buffers when the trail
  // changes or the scene unmounts (the Canvas remounts per run switch, so this also covers run changes).
  useEffect(() => () => { line?.geo.dispose(); line?.mat.dispose() }, [line])
  // Last-APPLIED hold-light state. Seeded false to match the memo's initial uFadeTicks
  // (TRAIL_FADE_TICKS = comet), so a resting run writes the uniform ZERO times until a hold actually lights
  // it. Ref (not state) — a fade switch must never trigger a React render, and this rides the frame path.
  const appliedLitRef = useRef(false)
  useFrame(() => {
    if (!line) return
    // Reveal vertices 0..tick (tick+1 of them), clamped to the precomputed count, and aim the head-relative
    // fade at that revealed head index. drawRange + (at most) one uniform write — the path itself never changes.
    const { tick, playing } = useViewStore.getState()
    line.geo.setDrawRange(0, Math.min(tick + 1, line.count))
    line.uHead.value = Math.min(tick, line.count - 1)
    // Rising-edge clear (within the load budget, doubles as the comet-return): any live playback drops the hold-light, so a tour's
    // NEXT play step travels with the comet and a manual play after a lit finale returns the comet. Cheap
    // idempotent boolean write while playing; a no-op read otherwise.
    if (playing) trailHold.lit = false
    // Hold-light fade switch — ONE uniform write ON CHANGE only (within the load budget), ref-guarded. Fully-lit path while a
    // tour hold dwells at rest (lit && !playing); comet otherwise. A steady state writes nothing.
    const lit = trailHold.lit && !playing
    if (lit !== appliedLitRef.current) {
      appliedLitRef.current = lit
      line.uFadeTicks.value = lit ? 1e9 : TRAIL_FADE_TICKS
    }
  })
  if (!line) return null
  return <primitive object={line.obj} />
}
