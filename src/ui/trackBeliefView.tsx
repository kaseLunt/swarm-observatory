import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useViewStore } from '../state/viewStore'
import { CATEGORY, PALETTE, hexToThree, BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { eventTickOf } from './cursor'
import { nedToThree } from './placement'
import type { TransportTick } from '../lib/brand'
import { sampleValid, type TrackBeliefData } from './trackBelief'
import type { PosEllipse } from './covEllipse'

// ── THE BELIEF STAGE — f3a's stage voice: the tracker's shrinking DISC AND its actual error ──────────────────
// The instrument voice is the 1σ + error readout (the strip); THIS is the drama on the 3D stage (LAW 3): a single 1σ
// contour RING at the decoded track mean (the tracker's ESTIMATE), at TRUE world scale (metres), that follows the
// playhead — tightening as the reveal clock advances and widening on a scrub back — PLUS a quiet LINE from that ring
// centre to the decoded STATE-TRUTH pose (the drone the scene already renders): the belief-vs-reality GAP, the
// tracker's actual error, made visible. Both endpoints are decoded (the estimate mean; the state pose), so the line is
// honest data, not a rendering artifact. The A3 seam is resolved DELIBERATELY in the model: the truth pose is read at
// state frame t (offset 0, via resolveCursor / the branded accessor — the SAME frame Scene renders the drone at), so
// the visible gap equals the strip's stated error. On f3a the disc shrinks to 0.44 m while the line grows to ~2.43 m —
// the truth leaves the disc, the tracker overconfident.
//
// THE FRAME-PATH LAW — the disc + the gap-line are STEP FUNCTIONS of the reveal clock, not continuous functions of wall
// time. Per frame the loop does an O(log n) reveal-clock lookup and, ONLY when the current sample's ordinal CHANGES
// (tick-change rate, near-per-tick on f3a), writes the ring's transform (one position + scale + rotation) and the
// line's two endpoints (six float writes into the preallocated buffer) — ZERO allocation. The ellipse geometry is
// precomputed at model publish (covEllipse, per sample); the ONE unit-ring geometry is never rebuilt. The two mistakes
// the arch consult names (rebuild-per-frame, recompute-the-ellipse-per-frame) are both avoided. W6's per-frame delta is
// ONE ring + ONE line — far lighter than the comms pulse pool — so single meshes with ref writes (the sensing head
// idiom) are the right-sized surface, NOT an instanced pool + shader (that earns its keep only at N>1 tracks — the
// deferred multi-track path; the model layer already produces per-sample geometry, so only these become instanced then).

// The disc colour — the MUTATING category token (track kinds 2/3/4 ARE the mutating category; theme + categorize),
// scaled DOWN so the contour sits BELOW the bloom threshold: the disc is quiet, so the tightening + the growing error
// read without a second emphasis competing with the run's real drama. Derived once at module scope (no per-frame resolve).
export const DISC_COLOR = new THREE.Color(hexToThree(CATEGORY.mutating.hue)).multiplyScalar(0.6)
// The gap-line colour — a dim, sub-bloom slate (the quiet-chrome token) so the error line reads as an annotation
// BETWEEN the two data marks (the ring and the drone), never a third bright emphasis. Presentational line weight.
export const GAP_COLOR = new THREE.Color(hexToThree(PALETTE.textDim)).multiplyScalar(0.7)

// The number of segments on the unit ring — enough to read as a smooth circle at any scale. Presentational.
const RING_SEGMENTS = 72

// ── THE RING TRANSFORM — a PURE derivation of the ring's world placement from a sample (testable without GLSL) ──
// The ring is a UNIT circle in the horizontal x–z plane (y = up = −down = 0, the plane the target flies in). Its
// CENTRE is the decoded mean through the ONE shared basis (placement.nedToThree: NED[n,e,d] → three[e,−d,n]); its
// RADIUS is the 1σ eigen-semi-axis. For an isotropic DISC (f3a) the scale is uniform (semiMajor on both in-plane axes,
// no orientation). For an anisotropic ellipse (future bundles) the two in-plane axes take the two semi-axes and the
// ring rotates about Y by the major-axis orientation — a best-effort presentational orientation, never exercised by a
// certified bundle today (the covEllipse MATH is what is pinned; this 3D orientation is deferred with the multi-track path).
export interface RingTransform {
  readonly pos: readonly [number, number, number]
  readonly scaleX: number
  readonly scaleZ: number
  readonly rotYRad: number
}
export function ringTransform(ellipse: PosEllipse, meanN: number, meanE: number): RingTransform {
  const pos = nedToThree([meanN, meanE, 0]) // [meanE, 0, meanN] — the mean on the deck plane
  if (ellipse.isDisc) return { pos, scaleX: ellipse.semiMajor, scaleZ: ellipse.semiMajor, rotYRad: 0 }
  return { pos, scaleX: ellipse.semiMajor, scaleZ: ellipse.semiMinor, rotYRad: ellipse.angleRad }
}

// The luminance a Bloom-threshold test binds (the disc + gap-line must be sub-bloom — the quiet-mark discipline). Rec.709.
const REC709 = [0.2126729, 0.7151522, 0.0721750] as const
export const discLuminance = (c: THREE.Color = DISC_COLOR): number => REC709[0] * c.r + REC709[1] * c.g + REC709[2] * c.b
export const DISC_IS_SUB_BLOOM = discLuminance() < BLOOM_LUMINANCE_THRESHOLD
export const GAP_IS_SUB_BLOOM = discLuminance(GAP_COLOR) < BLOOM_LUMINANCE_THRESHOLD

// Build the unit ring geometry ONCE: a circle of radius 1 in the x–z plane, drawn as a LineLoop (a 1σ CONTOUR —
// the line weight is presentational; only its RADIUS + CENTRE are data). Scaled/positioned per tick-change below.
function buildRingGeometry(): THREE.BufferGeometry {
  const pts = new Float32Array(RING_SEGMENTS * 3)
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const th = (i / RING_SEGMENTS) * Math.PI * 2
    pts[i * 3] = Math.cos(th)     // x — east axis
    pts[i * 3 + 1] = 0            // y — deck plane
    pts[i * 3 + 2] = Math.sin(th) // z — north axis
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  return g
}

export function TrackBeliefStage({ data }: { data: TrackBeliefData }) {
  // Force a write on the first frame (an ordinal no real reveal can equal), then update ONLY on ordinal change.
  const lastIdxRef = useRef<number>(-2)
  const ring = useMemo(() => {
    const geo = buildRingGeometry()
    const mat = new THREE.LineBasicMaterial({ color: DISC_COLOR, toneMapped: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false })
    const loop = new THREE.LineLoop(geo, mat)
    loop.renderOrder = 3
    loop.frustumCulled = false // the disc rides the tracked entity; never cull it
    loop.visible = false       // born hidden — NOT-YET until the first update is revealed
    return { loop, geo, mat }
  }, [])
  // The belief→reality GAP line — a 2-vertex line (ring centre → true pose), its endpoints written on tick-change into
  // a preallocated 6-float buffer (zero per-frame allocation). Hidden when the reality half is unavailable.
  const gap = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const mat = new THREE.LineBasicMaterial({ color: GAP_COLOR, toneMapped: false, fog: false, transparent: true, opacity: 0.55, depthWrite: false })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 2
    line.frustumCulled = false
    line.visible = false
    return { line, geo, mat }
  }, [])
  // <primitive> objects are ours, not auto-disposed by r3f — release the GPU buffers on unmount / model change.
  useEffect(() => () => { ring.geo.dispose(); ring.mat.dispose() }, [ring])
  useEffect(() => () => { gap.geo.dispose(); gap.mat.dispose() }, [gap])
  // Re-seed the tick-change gate whenever the model (data) changes, so a run switch always writes on the next frame.
  useEffect(() => { lastIdxRef.current = -2 }, [data])

  // THE PER-FRAME WRITE — a reveal-clock lookup (O(log n)) + transform/endpoint writes ONLY on ordinal change (tick-
  // change rate). The disc + line are step functions of the INTEGER tick (a sample is current for its whole tick), so
  // the fractional playhead does not move them — this reads the store's integer `tick`, branded EventTick at ingestion.
  useFrame(() => {
    if (!data.renderable) { ring.loop.visible = false; gap.line.visible = false; return } // fail closed as one
    const playhead = eventTickOf(useViewStore.getState().tick as TransportTick)
    const i = data.clock.latestRevealedIndex(playhead)
    if (i === lastIdxRef.current) return // unchanged current sample — nothing to write (tick-change rate)
    lastIdxRef.current = i
    if (i < 0) { ring.loop.visible = false; gap.line.visible = false; return } // NOT-YET — before the first update's tick
    const s = data.samples[i]!
    if (!sampleValid(s)) { ring.loop.visible = false; gap.line.visible = false; return } // defensive
    const t = ringTransform(s.ellipse!, s.meanN, s.meanE)
    ring.loop.position.set(t.pos[0], t.pos[1], t.pos[2])
    ring.loop.scale.set(t.scaleX, 1, t.scaleZ)
    ring.loop.rotation.y = t.rotYRad
    ring.loop.visible = true
    // THE GAP LINE — from the estimate (ring centre) to the decoded truth pose, iff this sample has a decoded truth.
    // Endpoints inlined through the shared basis (nedToThree([n,e,0]) = [e,0,n]) so no allocation is made on the write.
    if (s.truthN !== null && s.truthE !== null) {
      const attr = gap.geo.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      arr[0] = t.pos[0]; arr[1] = t.pos[1]; arr[2] = t.pos[2] // the estimate (ring centre)
      arr[3] = s.truthE; arr[4] = 0; arr[5] = s.truthN        // the truth (the drone's decoded state pose)
      attr.needsUpdate = true
      gap.line.visible = true
    } else {
      gap.line.visible = false // no reality half on this sample — withhold the line rather than fabricate a truth
    }
  })

  return (
    <group>
      <primitive object={gap.line} />
      <primitive object={ring.loop} />
    </group>
  )
}
