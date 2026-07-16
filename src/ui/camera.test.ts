import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import type { EntityV2 } from '../decode/payloads'
import {
  trajectoryBounds, boundsFromPositions, fitDistance, fitDistanceForAspect, frameFor, finaleFraming, followPan, isFiniteFraming,
  revealedMidpointIndex, followBiasCapScale, followLead, shouldTrackWithRing, ringTrackScale, leadForAspect,
  shotFraming, cameraAnchor, heldSubjectPose, HEAD_MEDIUM_DISTANCE,
  DEFAULT_POSITION, DEFAULT_TARGET, DEFAULT_FOV,
  type Bounds, type BoundsSource, type Framing, type ShotAnchors, type ShotOpts, type SubjectHold, type TrailView,
} from './camera'
import {
  requestTrailFrame, cancelTrailFrame, cancelTourArrivalFrame, requestEstablishFrame, requestRefitFrame, cancelEstablishFrame, requestFinaleFrame,
  requestTourStartFrame, trailFrameRequest, tourStartFrameRequest, trailHold, shouldRefitOnFinaleClear,
  shouldEstablishOnMount, shouldArmFollowOnPlay,
} from './frameChannels'
import { FOLLOW_BIAS_MAX } from './Scene'
// W3: the marker sizing comes from the RENDERER, not a local literal — the crop test moves if production sizing moves.
import { HEAD_R, SENSOR_MARKER_R, HEAD_CONE_H, lerpHeadPosition } from './sensingStageView'
import { asEventTick, asStateFrame } from '../lib/brand'

const ent = (pos: number[]): EntityV2 => ({ value: 0n, alive: true, pos, vel: [], headingRad: 0, speedMps: 0, turnRateRadps: 0, fuel: 0, setpoint: [] })

// ── F3 — the directed-camera anchor: SUBJECT pose on a sensing run, centroid otherwise ─────────────────────
describe('cameraAnchor — a sensing run frames the SUBJECT; non-sensing keeps the centroid byte-identical', () => {
  // Two widely-separated entities: a non-subject at x=0 and the subject at x=200. The loop accumulates the
  // centroid SUM (cx=200 over count=2 → midpoint x=100) and captures the subject's own pose (sx=200).
  const CX = 200, COUNT = 2, SX = 200 // non-subject x=0 + subject x=200 → sum 200, count 2, subject 200
  test('sensing (useSubject true): the anchor names the SUBJECT pose (200), not the midpoint centroid (100)', () => {
    expect(cameraAnchor(CX, 0, 0, COUNT, SX, 0, 0, true)).toEqual([200, 0, 0])
  })
  test('a finale close-up centred on the centroid (100) would MISS the subject (200) — the defect the anchor fixes', () => {
    // The pre-F3 centroid anchor: for these two entities it sits 100 units off the subject — a tight close-up
    // (the finale/tour grammar) frames empty space between the two, not the drone the evidence concerns.
    expect(cameraAnchor(CX, 0, 0, COUNT, SX, 0, 0, false)).toEqual([100, 0, 0]) // centroid = midpoint
    expect(cameraAnchor(CX, 0, 0, COUNT, SX, 0, 0, false)[0]).not.toBe(SX)      // …and it is NOT the subject
  })
  test('NON-SENSING is byte-identical to the pre-F3 centroid (cx/count, cy/count, cz/count)', () => {
    // The exact prior expression, pinned: useSubject false ⇒ the centroid division, untouched.
    expect(cameraAnchor(30, 60, 90, 3, 999, 999, 999, false)).toEqual([10, 20, 30])
  })
})

// ── F1 — the directed camera HOLDS the subject pose across a dropout, PLAYHEAD-INDEXED (correct under reverse
// scrub / tour jump / run switch, not just forward play) ──────────────────────────────────────────────────────
// A multi-entity sensing run: the SUBJECT and one other entity. Admission is key membership + a non-static flight,
// NOT per-tick presence, so the subject can drop out of a tick while the other entity remains. heldSubjectPose is
// a PURE function of (trail, frame): the held anchor at frame k is the subject's last present pose at frame ≤ k,
// which buildTrail's hold-fill has already baked into trail.positions[k] for every k ≥ trail.first. This SUPERSEDES
// the earlier traversal-latch `advanceSubjectHold` (a forward-only accumulator that kept the FUTURE pose on a
// backward scrub and could leak a prior run's pose across a switch) — the tests below pin the same held-through-
// dropout property AND the reverse-scrub / run-switch correctness the latch could not provide.
describe('heldSubjectPose — the sensing camera anchors on the EVIDENCE subject through a dropout (F1)', () => {
  const out = (): SubjectHold => ({ has: false, x: 0, y: 0, z: 0 })
  // Build the structural trail slice heldSubjectPose reads. `positions` is interleaved xyz already hold-filled the
  // way buildTrail lays it (an absent-after-spawn frame holds the previous vertex); `first` is the first present frame.
  const trailView = (positions: number[], first: number): TrailView =>
    ({ positions: new Float32Array(positions), first, count: positions.length / 3 })
  const DROPOUT_CX = 0, DROPOUT_COUNT = 1 // the dropout frame's loop sees ONLY the remaining entity at x=0, count 1

  test('PREMISE: the pre-fix per-frame flag (useSubjectAnchor = hasSensing && subjectSeen) fell back to the REMAINING entity', () => {
    // A dropout frame (subjectSeen false) made useSubjectAnchor false → cameraAnchor uses the centroid, which with
    // the subject gone is the remaining entity at x=0 — a DIFFERENT entity than the evidence (x=200). The hold fixes this.
    const subjectSeen = false // hasSensing true on this run; the dropout frame's flag
    const oldUseSubjectAnchor = subjectSeen
    expect(cameraAnchor(DROPOUT_CX, 0, 0, DROPOUT_COUNT, 0, 0, 0, oldUseSubjectAnchor)).toEqual([0, 0, 0])
  })

  test('present at frame 0, ABSENT (held) at frame 1 → the hold anchors on the last-present pose through the dropout', () => {
    // frame 0 present at x=200; frame 1 the subject dropped out, so buildTrail HELD the previous vertex (x=200).
    const trail = trailView([200, 0, 0, /* held */ 200, 0, 0], 0)
    const h = out()
    expect(heldSubjectPose(h, trail, asStateFrame(0))).toBe(true)
    expect(h).toEqual({ has: true, x: 200, y: 0, z: 0 })
    expect(heldSubjectPose(h, trail, asStateFrame(1))).toBe(true)        // the dropout frame…
    expect(h).toEqual({ has: true, x: 200, y: 0, z: 0 })   // …still anchored on the held pose, NOT the remaining centroid
    const useSubjectAnchor = h.has // hasSensing true on this run
    expect(cameraAnchor(DROPOUT_CX, 0, 0, DROPOUT_COUNT, h.x, h.y, h.z, useSubjectAnchor)).toEqual([200, 0, 0])
  })

  test('F1 REVERSE SCRUB into a dropout gap holds the PRE-gap pose (the premise-first inversion of the old latch)', () => {
    // frame 0 present x=10, frame 1 a dropout gap (buildTrail held x=10), frame 2 present x=99. The OLD traversal
    // latch, driven forward 0→1→2, ended at x=99 and NO-OPPED on the absent frame 1 — so a later BACKWARD scrub to
    // frame 1 kept the FUTURE x=99 while the trail/head rendered the held x=10 (camera and evidence disagreed). The
    // playhead-indexed lookup has no direction: heldSubjectPose(frame 1) is x=10, matching exactly what the trail renders.
    const trail = trailView([10, 0, 0, /* held */ 10, 0, 0, 99, 0, 0], 0)
    const h = out()
    heldSubjectPose(h, trail, asStateFrame(2))                      // "forward play" landed on the post-gap pose…
    expect(h.x).toBe(99)
    expect(heldSubjectPose(h, trail, asStateFrame(1))).toBe(true)   // …now scrub BACKWARD into the gap
    expect(h.x).toBe(10)                              // the PRE-gap pose — == trail.positions[1], what the trail draws
    expect(h.x).toBe(trail.positions[3])              // bound to the very buffer vertex the head renders at frame 1
  })

  test('F1 RUN SWITCH into a gap inherits nothing — each run derives from its OWN trail', () => {
    // Switching mid-gap must not leak run A's pose. heldSubjectPose is a pure function of the trail passed, so run B's
    // lookup can only ever return run B's data. Here run B's subject has not appeared yet at frame 0 (first = 1): the
    // lookup returns false (suppress) — no inheritance from any prior run's pose is even representable.
    const runA = trailView([777, 0, 0, 777, 0, 0], 0) // a prior run whose subject sat at x=777
    const runB = trailView([0, 0, 0, /* first present */ 5, 0, 0], 1)
    const h = out()
    heldSubjectPose(h, runA, asStateFrame(1))                        // run A left the scratch at x=777…
    expect(h.x).toBe(777)
    expect(heldSubjectPose(h, runB, asStateFrame(0))).toBe(false)    // …run B at a pre-appearance frame: suppress, NOT run A's 777
    expect(h.has).toBe(false)
    expect(heldSubjectPose(h, runB, asStateFrame(1))).toBe(true)     // run B's own subject, once it appears
    expect(h.x).toBe(5)
  })

  test('a subject NEVER seen at frame ≤ k (a gap before first appearance, or an empty trail) SUPPRESSES the beat', () => {
    const h = out()
    // first = 2: frames 0 and 1 precede the subject's first appearance — no present pose ≤ k, so no anchor.
    const preSpawn = trailView([0, 0, 0, 0, 0, 0, 42, 0, 0], 2)
    expect(heldSubjectPose(h, preSpawn, asStateFrame(0))).toBe(false)
    expect(heldSubjectPose(h, preSpawn, asStateFrame(1))).toBe(false)
    const suppressDirected = !h.has // hasSensing true on this run
    expect(suppressDirected).toBe(true)               // the finale/head/follow suppress rather than aim at a remaining entity
    expect(heldSubjectPose(h, preSpawn, asStateFrame(2))).toBe(true) // …then the anchor lights up at first appearance
    expect(h.x).toBe(42)
    // An empty trail (count 0 / first −1 — a static or positionless subject) also suppresses.
    expect(heldSubjectPose(h, trailView([], -1), asStateFrame(0))).toBe(false)
  })

  test('the frame index is clamped to the last vertex — a terminal-frame query never reads past the buffer', () => {
    const trail = trailView([1, 0, 0, 2, 0, 0], 0)
    const h = out()
    expect(heldSubjectPose(h, trail, asStateFrame(5))).toBe(true) // beyond count−1 → clamps to the last vertex
    expect(h.x).toBe(2)
  })

  // ── F1 FRACTIONAL DROPOUT RECOVERY — the camera anchor rides the SAME t0→t1 head lerp, not the integer held pose ──
  // heldSubjectPose stays the VALIDITY gate (its `has` still decides useSubjectAnchor / suppressDirected), but on a
  // dropout the anchor POSE no longer reads the integer held trail[t0]; Scene falls back to lerpHeadPosition(trail,
  // tick, fraction) — the EXACT sample the SensingStage head renders on the SAME buffer (Entities' trail === the
  // head's sensingTrail; Scene's t0/t1 === lerpHeadPosition's own f0/f1 because poseFrameOffset === TARGET_FRAME_OFFSET
  // and model.tickCount === trail.count−1). So a fractional RECOVERY (absent at t0, PRESENT at t1) anchors on the
  // drone's live mid-motion pose. Trail here satisfies BOTH TrailView (heldSubjectPose) and Trail (lerpHeadPosition).
  const trail4 = (positions: number[], first: number): TrailView & { index: Float32Array } =>
    ({ positions: new Float32Array(positions), index: new Float32Array(positions.length / 3), first, count: positions.length / 3 })

  test('a dropout RECOVERY anchors on the head lerp (54.5), NOT the integer held pose (10) the old path used', () => {
    // frame0 present x=10; frame1 ABSENT → buildTrail held x=10; frame2 present (recovery) x=99; frame3 present x=99.
    // tick 0 → head f0 = evaluatedFrame(0, TARGET_FRAME_OFFSET=1, last=3) = 1 (the held gap frame), f1 = 2 (recovery).
    const trail = trail4([10, 0, 0, /* held */ 10, 0, 0, /* recovery */ 99, 0, 0, 99, 0, 0], 0)
    // PREMISE-FIRST: the OLD anchor was the integer held pose at t0=1 — heldSubjectPose reads exactly trail[1] = 10.
    const h = out()
    expect(heldSubjectPose(h, trail, asStateFrame(1))).toBe(true)
    expect(h.x).toBe(10)                                  // the stale pre-gap pose the old integer fallback anchored on
    // THE FIX: the anchor now uses the head's fractional sample — mid-fraction it spans the gap→recovery jump.
    const v = new THREE.Vector3()
    lerpHeadPosition(v, trail, asEventTick(0), 0.5)
    expect(v.x).toBe(54.5)                                // lerp(10, 99, .5) — the drone's live mid-motion pose
    expect(v.x).not.toBe(h.x)                             // …and it is NOT the integer held pose (the defect)
    // cameraAnchor consumes it verbatim under useSubject (h.has) — never the remaining-entity centroid (cx/count).
    expect(cameraAnchor(0, 0, 0, 1, v.x, v.y, v.z, h.has)).toEqual([54.5, 0, 0])
  })

  test('LATE-SPAWN crossing: pre-first-appearance SUPPRESSES (the head lerp is never consulted); the gate opens at first', () => {
    // first = 1: frame0 precedes the subject's appearance. At t0=0 heldSubjectPose is false → suppressDirected, so
    // the fallback (hasHold && !subjectSeen) is UNREACHABLE and lerpHeadPosition is never read across the boundary;
    // the fractional anchor is scoped to frames the subject has already appeared in (t0 ≥ first). At t0=1 it opens.
    const trail = trail4([0, 0, 0, /* first present */ 5, 0, 0, 40, 0, 0], 1)
    const h = out()
    expect(heldSubjectPose(h, trail, asStateFrame(0))).toBe(false)      // pre-spawn: no valid hold → suppress, no anchor read
    expect(!h.has).toBe(true)                             // suppressDirected (hasSensing true on this run)
    expect(heldSubjectPose(h, trail, asStateFrame(1))).toBe(true)       // …the gate opens at first appearance
    const v = new THREE.Vector3()
    lerpHeadPosition(v, trail, asEventTick(0), 0.5)                    // tick 0 → f0=1, f1=2 → lerp(5, 40, .5) = 22.5, well-defined
    expect(v.x).toBe(22.5)
  })

  // NON-SENSING byte-identity is now a CALLER property: Scene short-circuits `hasSensing && heldSubjectPose(...)`,
  // so on a non-sensing run heldSubjectPose is never called and the centroid path is untouched. The cameraAnchor
  // describe block above pins that centroid path (useSubject false ⇒ cx/count, byte-identical).
})

// Build a stub that satisfies BoundsSource structurally (RunModel satisfies it too).
// Each tick maps entity-key → NED pos; entityPosition converts NED[N,E,D] → three[E,-D,N].
function stub(keys: string[], perTick: Record<string, number[]>[]): BoundsSource {
  return {
    tickCount: perTick.length - 1,
    entityKeys: () => keys,
    entityStatesAt: (t: number) => {
      const m = new Map<string, EntityV2>()
      const frame = perTick[t] ?? {}
      for (const k of keys) if (frame[k]) m.set(k, ent(frame[k]!))
      return m
    },
  }
}

// F2 — entityStatesAt reads the STATE-FRAME domain. RunModel's accessor is branded StateFrame; typing the
// structural BoundsSource accessor to match closes the method-bivariance hole that let a raw number — or a raw
// EVENT tick (the historical verdict-vs-pose off-by-one) — index this frame-domain map. Both @ts-expect-error
// directives fire at typecheck; the runtime calls still return a Map (brands erase), so the pin locks the domain.
describe('BoundsSource.entityStatesAt — the frame-domain seam rejects raw ticks (F2)', () => {
  const src: BoundsSource = stub(['1:0'], [{ '1:0': [0, 0, 0] }, { '1:0': [1, 0, 0] }])
  test('a bare number cannot index the state-frame accessor', () => {
    // @ts-expect-error a raw number is not a StateFrame
    expect(src.entityStatesAt(0)).toBeInstanceOf(Map)
  })
  test('an EventTick cannot index the state-frame accessor (the substitution the historical bug made)', () => {
    // @ts-expect-error an EventTick is not a StateFrame
    expect(src.entityStatesAt(asEventTick(0))).toBeInstanceOf(Map)
  })
})

describe('trajectoryBounds', () => {
  test('single entity travelling along N (three z): center + radius from the swept box', () => {
    // NED N goes 0 → 100 (three z 0 → 100); E,D constant 0. Box is a 100-long z segment.
    const m = stub(['1:0'], [
      { '1:0': [0, 0, 0] }, { '1:0': [50, 0, 0] }, { '1:0': [100, 0, 0] },
    ])
    const b = trajectoryBounds(m)!
    expect(b).not.toBeNull()
    expect(b.center).toEqual([0, 0, 50]) // three: x=E=0, y=-D=0, z=N midpoint 50
    expect(b.radius).toBeCloseTo(50) // half the 100-long diagonal
  })

  test('two entities spread on E and N → box across both axes', () => {
    const m = stub(['1:0', '1:1'], [
      { '1:0': [0, 0, 0], '1:1': [0, 40, 0] },      // 1:1 at E=40 → three x=40
      { '1:0': [30, 0, 0], '1:1': [30, 40, 0] },    // both advance N=30 → three z=30
    ])
    const b = trajectoryBounds(m)!
    // three x in [0,40], y 0, z in [0,30] → center [20,0,15], radius = 0.5*sqrt(40²+30²)=25
    expect(b.center).toEqual([20, 0, 15])
    expect(b.radius).toBeCloseTo(25)
  })

  test('no positioned entities (e0-like) → null', () => {
    expect(trajectoryBounds(stub([], [{}, {}]))).toBeNull()
  })

  test('zero-extent static point (f0-like) → null (a single point is not a trajectory to fit)', () => {
    const m = stub(['1:0'], [{ '1:0': [0, 0, 0] }, { '1:0': [0, 0, 0] }])
    expect(trajectoryBounds(m)).toBeNull()
  })
})

describe('boundsFromPositions (one-pass fit reuses the trail buffer)', () => {
  test('sphere from an interleaved xyz Float32Array matches the swept box', () => {
    // three-space vertices (0,0,0) → (0,0,100): a 100-long z segment (same box the N-travel trail lays down).
    const positions = new Float32Array([0, 0, 0, 0, 0, 50, 0, 0, 100])
    const b = boundsFromPositions(positions, 3)!
    expect(b).not.toBeNull()
    expect(b.center).toEqual([0, 0, 50])
    expect(b.radius).toBeCloseTo(50)
  })

  test('box across x and z axes → center + radius from both extents', () => {
    // x in [0,40], y 0, z in [0,30] → center [20,0,15], radius 0.5*sqrt(40²+30²)=25.
    const positions = new Float32Array([0, 0, 0, 40, 0, 0, 0, 0, 30, 40, 0, 30])
    const b = boundsFromPositions(positions, 4)!
    expect(b.center).toEqual([20, 0, 15])
    expect(b.radius).toBeCloseTo(25)
  })

  test('empty trail (count 0: e0/f0) → null (nothing to frame → caller keeps the default)', () => {
    expect(boundsFromPositions(new Float32Array(0), 0)).toBeNull()
  })

  test('single point / zero extent → null (not a trajectory to fit)', () => {
    expect(boundsFromPositions(new Float32Array([7, 0, -3]), 1)).toBeNull()
  })

  test('over a prefix count ignores later points (the trail-frame consumes a 0..arrivedTick prefix)', () => {
    // The trail-frame arrival framing (Scene, Task v04.1-2) fits the trajectory-SO-FAR: it passes a prefix
    // count = arrivedTick + 1, so vertices beyond it must not widen the box. This pins that contract.
    const p = new Float32Array([0, 0, 0, 10, 0, 0, 1000, 0, 0])
    const partial = boundsFromPositions(p, 2)!
    expect(partial.center[0]).toBeCloseTo(5)
    const full = boundsFromPositions(p, 3)!
    expect(full.center[0]).toBeCloseTo(500)
  })

  test('agrees with trajectoryBounds on the same subject path (single-entity runs)', () => {
    // buildTrail and trajectoryBounds must frame the SAME box for a single-entity run — this pins the
    // one-pass refactor's equivalence for the runs shipping today.
    const m = stub(['1:0'], [{ '1:0': [0, 0, 0] }, { '1:0': [50, 0, 0] }, { '1:0': [100, 0, 0] }])
    const viaSource = trajectoryBounds(m)!
    // The trail lays down three-space vertices [0,0,0],[0,0,50],[0,0,100] for that NED N-travel.
    const viaTrail = boundsFromPositions(new Float32Array([0, 0, 0, 0, 0, 50, 0, 0, 100]), 3)!
    expect(viaTrail.center).toEqual(viaSource.center)
    expect(viaTrail.radius).toBeCloseTo(viaSource.radius)
  })
})

describe('fitDistance', () => {
  test('distance to fit a sphere of radius R in a vertical fov (with margin)', () => {
    // d = R / sin(fov/2) * margin
    const R = 100, fov = 50, margin = 1.1
    const expected = (R / Math.sin((fov * Math.PI) / 180 / 2)) * margin
    expect(fitDistance(R, fov, margin)).toBeCloseTo(expected)
  })
  test('larger radius → strictly larger distance', () => {
    expect(fitDistance(200, 50, 1.1)).toBeGreaterThan(fitDistance(100, 50, 1.1))
  })
})

describe('frameFor', () => {
  const opts = { fov: DEFAULT_FOV, margin: 1.15, lift: 1, maxDistanceFactor: 3 }
  const defaultDist = Math.hypot(...DEFAULT_POSITION)

  const parallelToDefault = (off: number[]): number => {
    // magnitude of off × default direction (0 when parallel)
    const d = DEFAULT_POSITION
    const cx = d[1] * off[2]! - d[2] * off[1]!
    const cy = d[2] * off[0]! - d[0] * off[2]!
    const cz = d[0] * off[1]! - d[1] * off[0]!
    return Math.hypot(cx, cy, cz)
  }

  test('null bounds → the composed default (f0/e0)', () => {
    const f = frameFor(null, opts)
    expect(f.position).toEqual(DEFAULT_POSITION)
    expect(f.target).toEqual(DEFAULT_TARGET)
  })

  // Composed camera offset off the bounds centre for the small-fit branch: DEFAULT_POSITION - DEFAULT_TARGET.
  const OFFSET: [number, number, number] = [DEFAULT_POSITION[0] - DEFAULT_TARGET[0], DEFAULT_POSITION[1] - DEFAULT_TARGET[1], DEFAULT_POSITION[2] - DEFAULT_TARGET[2]] // [6, 3.5, 9]

  test('origin-centred small run that already fits → compose around the centre (aim [0,1,0], camera at the offset)', () => {
    // radius 3 is well inside what the default distance frames → no pull-back; the composed camera sits at
    // centre + OFFSET = [6,3.5,9] and aims at the centre lifted = [0,1,0].
    const f = frameFor({ center: [0, 0, 0], radius: 3 }, opts)
    expect(f.position).toEqual([OFFSET[0], OFFSET[1], OFFSET[2]]) // [6, 3.5, 9]
    expect(f.target).toEqual([0, 1, 0])
  })

  test('OFF-ORIGIN small run that already fits → camera offset off the bounds centre, aim at the centre (T2 rider completion)', () => {
    // radius 3 still fits the default distance (no pull-back), but the content sits at [2,0,-3]; the camera
    // must sit the composed offset off THAT centre (not the world origin) and look at it — else the subject
    // is either parked off to one side or rendered from far away as a sub-pixel speck.
    const f = frameFor({ center: [2, 0, -3], radius: 3 }, opts)
    expect(f.position).toEqual([2 + OFFSET[0], 0 + OFFSET[1], -3 + OFFSET[2]]) // [8, 3.5, 6]
    expect(f.target).toEqual([2, 1, -3])
  })

  test('compact run far off origin frames from up close, not ~94u away (the bug this fix closes)', () => {
    // center [100,0,0] r=3: camera = centre + OFFSET = [106,3.5,9], aim = centre lifted = [100,1,0]. The
    // camera→subject distance is the composed ~11u, NOT ~94u (the old branch left it at DEFAULT_POSITION,
    // ~94u from the subject). z = centre.z(0) + OFFSET.z(9) = 9 — the camera hugs the subject at [100,·,0].
    const f = frameFor({ center: [100, 0, 0], radius: 3 }, opts)
    expect(f.position).toEqual([106, 3.5, 9])
    expect(f.target).toEqual([100, 1, 0])
    const d = Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2])
    expect(d).toBeCloseTo(Math.hypot(OFFSET[0], OFFSET[1] - 1, OFFSET[2])) // ~11u — a sane distance, not ~94u
    expect(d).toBeLessThan(20)
  })

  test('medium bounds within the cap → framed fully: target over the bounds centre, pulled back to fit', () => {
    const center: [number, number, number] = [2, 0, -6]
    const radius = 8 // fit ≈ 21.8, below the cap (defaultDist*3 ≈ 35) → full-journey framing
    const f = frameFor({ center, radius }, opts)
    expect(f.target).toEqual([2, 1, -6])
    const d = Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2])
    expect(d).toBeGreaterThan(defaultDist)
    expect(d).toBeCloseTo(fitDistance(radius, opts.fov, opts.margin))
    const off = [f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]]
    expect(parallelToDefault(off)).toBeCloseTo(0)
  })

  test('oversized bounds beyond the cap (f1 corridor) → composed default (no void; follow tracks instead)', () => {
    const radius = 128 // fit ≈ 340, far past the cap → a full fit would be a void, so fall back to default
    const f = frameFor({ center: [-6, 0, -125], radius }, opts)
    expect(f.position).toEqual(DEFAULT_POSITION)
    expect(f.target).toEqual(DEFAULT_TARGET)
  })

  test('a NaN-radius bounds yields a NON-finite framing (WHY the CameraRig + trail-frame finite guards exist)', () => {
    // A crafted CRC-valid bundle can drive an f64 coordinate ~1e300 to Infinity on the Float32Array write in
    // buildTrail → a NaN bounds radius. frameFor's fit comparisons (fit <= defaultDist, fit > cap) are BOTH
    // false on a NaN fit, so it falls through to the whole-path branch and multiplies the NaN fit into the
    // camera position → a non-finite framing. This pins the existing frameFor behavior the consumer finite
    // guards (CameraRig's load-time write, the trail-frame arrival ease) exist to catch.
    const f = frameFor({ center: [0, 0, 0], radius: NaN }, opts)
    expect(isFiniteFraming(f)).toBe(false)
  })

  // G6 — the OPTIONAL stage-local elevation override (the sensing stage's raised resting vantage). Only the
  // OVERSIZED-fit branch reads it (the ONLY branch a stage's hundreds-of-units bounds reach); a f2a-shaped bounds
  // with an uncapped fit exercises it. The whole rest of the surface omits elevationDeg → byte-identical.
  const STAGE_OPTS = { ...opts, maxDistanceFactor: Infinity } // uncapped, like STAGE_FRAME_OPTS
  const elevationOf = (f: Framing): number => {
    const dy = f.position[1] - f.target[1]
    const d = Math.hypot(f.position[0] - f.target[0], dy, f.position[2] - f.target[2])
    return (Math.asin(dy / d) * 180) / Math.PI
  }
  const stageish: Bounds = { center: [24, 0, 40], radius: 90 } // f2a-shaped: oversized → the fit branch

  test('elevationDeg RAISES the fit vantage to the requested angle, preserving the house azimuth (G6 sensing vantage)', () => {
    const raised = frameFor(stageish, { ...STAGE_OPTS, elevationDeg: 35 })
    expect(elevationOf(raised)).toBeCloseTo(35)
    // azimuth (the ground-plane E/N heading) still matches DEFAULT_POSITION's +E/+N octant — only the pitch changed
    const off: [number, number, number] = [raised.position[0] - raised.target[0], raised.position[1] - raised.target[1], raised.position[2] - raised.target[2]]
    expect(Math.atan2(off[2], off[0])).toBeCloseTo(Math.atan2(DEFAULT_POSITION[2], DEFAULT_POSITION[0]))
    // the fit DISTANCE is unchanged (the direction stays a unit vector — only the angle rotates)
    const houseOff = frameFor(stageish, STAGE_OPTS).position
    const dRaised = Math.hypot(off[0], off[1], off[2])
    const dHouse = Math.hypot(houseOff[0] - raised.target[0], houseOff[1] - raised.target[1], houseOff[2] - raised.target[2])
    expect(dRaised).toBeCloseTo(dHouse)
  })

  test('the un-overridden fit vantage is the ~22.6° house angle (the shallow angle G6 raises FROM)', () => {
    // Pins the baseline the WHY comment cites: asin(DEFAULT_POSITION.y / |DEFAULT_POSITION|) ≈ 22.588°.
    expect(elevationOf(frameFor(stageish, STAGE_OPTS))).toBeCloseTo(22.588, 2)
  })

  test('omitting elevationDeg leaves the fit offset PARALLEL to DEFAULT_POSITION — the house octant, every non-sensing caller untouched', () => {
    // exactOptionalPropertyTypes forbids an explicit `elevationDeg: undefined`, so the field is absent-or-number by
    // construction; this proves the absent path is still the house direction (parallelToDefault ≈ 0 ⇒ same octant),
    // the byte-identity the raise must not disturb. The raised frame (above) is deliberately NOT parallel.
    const house = frameFor(stageish, STAGE_OPTS)
    const off = [house.position[0] - house.target[0], house.position[1] - house.target[1], house.position[2] - house.target[2]]
    expect(parallelToDefault(off)).toBeCloseTo(0)
    expect(parallelToDefault([
      frameFor(stageish, { ...STAGE_OPTS, elevationDeg: 35 }).position[0] - house.target[0],
      frameFor(stageish, { ...STAGE_OPTS, elevationDeg: 35 }).position[1] - house.target[1],
      frameFor(stageish, { ...STAGE_OPTS, elevationDeg: 35 }).position[2] - house.target[2],
    ])).toBeGreaterThan(1) // the raised offset is a DIFFERENT direction (not the house octant)
  })
})

// finaleFraming (v0.5b T3, ruling 2): the compose-around-head close-up for the natural-end rest. TRAIL_FRAME_OPTS'
// Infinity cap would ease f1's 250u corridor to a ~340u wide shot (drone sub-pixel), and the capped fit strands
// the drone off the composed default. finaleFraming instead builds a directed shot from scratch around the TRUE
// head: target = head lifted; camera = head + the composed house-octant DIRECTION × distance. Pure; finite-guarded
// at the Scene consume exactly like frameFor (a NaN head must skip activation, never wedge the ease).
describe('finaleFraming (compose-around-head finale close-up, T3)', () => {
  const OFF: [number, number, number] = [DEFAULT_POSITION[0] - DEFAULT_TARGET[0], DEFAULT_POSITION[1] - DEFAULT_TARGET[1], DEFAULT_POSITION[2] - DEFAULT_TARGET[2]]
  const OFFLEN = Math.hypot(...OFF)

  test('aims at the head lifted; camera sits distance units off the head along the composed octant', () => {
    const f = finaleFraming([0, 0, 0], { lift: 1, distance: 25 })
    expect(f.target).toEqual([0, 1, 0]) // head + lift
    // camera lies on the composed +E/+Up/+N octant, exactly `distance` from the head
    expect(f.position[0]).toBeCloseTo((OFF[0] / OFFLEN) * 25)
    expect(f.position[1]).toBeCloseTo((OFF[1] / OFFLEN) * 25)
    expect(f.position[2]).toBeCloseTo((OFF[2] / OFFLEN) * 25)
    expect(Math.hypot(f.position[0], f.position[1], f.position[2])).toBeCloseTo(25)
  })

  test('the camera→head offset is PARALLEL to the composed default offset (same viewing angle)', () => {
    const f = finaleFraming([10, 2, -40], { lift: 1, distance: 25 })
    const d: [number, number, number] = [f.position[0] - 10, f.position[1] - 2, f.position[2] + 40]
    // cross(d, OFF) === 0 ⇒ parallel
    const cx = d[1] * OFF[2] - d[2] * OFF[1]
    const cy = d[2] * OFF[0] - d[0] * OFF[2]
    const cz = d[0] * OFF[1] - d[1] * OFF[0]
    expect(Math.hypot(cx, cy, cz)).toBeCloseTo(0)
  })

  test('translates with the head (an off-origin terminal drone is the subject, not the world origin)', () => {
    const f = finaleFraming([100, 5, -30], { lift: 1, distance: 25 })
    expect(f.target).toEqual([100, 6, -30])
    expect(Math.hypot(f.position[0] - 100, f.position[1] - 5, f.position[2] + 30)).toBeCloseTo(25)
  })

  test('distance scales the pull-back linearly (2× the distance is twice as far from the head)', () => {
    const near = finaleFraming([0, 0, 0], { lift: 1, distance: 11.4 })
    const far = finaleFraming([0, 0, 0], { lift: 1, distance: 22.8 })
    expect(Math.hypot(...far.position) / Math.hypot(...near.position)).toBeCloseTo(2)
  })

  test('a static point (f0) yields a finite, non-degenerate framing — |camera − head| === distance, no NaN', () => {
    const f = finaleFraming([7, 0, -3], { lift: 1, distance: 25 })
    expect(isFiniteFraming(f)).toBe(true)
    expect(Math.hypot(f.position[0] - 7, f.position[1] - 0, f.position[2] + 3)).toBeCloseTo(25)
  })

  test('a NaN head → a non-finite framing (the finite guard at the Scene consume skips activation)', () => {
    expect(isFiniteFraming(finaleFraming([NaN, 0, 0], { lift: 1, distance: 25 }))).toBe(false)
    expect(isFiniteFraming(finaleFraming([0, Infinity, 0], { lift: 1, distance: 25 }))).toBe(false)
  })

  // DEGENERACY GUARD. The decoder accepts arbitrary f64, so a CRC-valid crafted bundle can carry an
  // astronomical-yet-FINITE head. At [1e300,-1e300,1e300] the composed offset (~25u) is far below the ulp, so
  // head + offset === head in f64 → position === target: a FINITE framing (isFiniteFraming waves it through)
  // whose |position − target| = 0 hands OrbitControls/lookAt a zero look direction → NaN downstream. The guard
  // detects the collapse and returns frameFor(null)'s composed default so the "finite, non-degenerate for ANY
  // finite head" claim holds. Same crafted-f64 vector class that motivated isFiniteFraming in v0.4.1.
  test('an astronomical-yet-finite head collapses in f64 (position === head) → returns frameFor(null) composed default, not a zero-direction framing', () => {
    const f = finaleFraming([1e300, -1e300, 1e300], { lift: 1, distance: 25 })
    // opts are irrelevant to frameFor(null) (it short-circuits before using them) — this is the composed default.
    expect(f).toEqual(frameFor(null, { fov: DEFAULT_FOV, margin: 1.15, lift: 1, maxDistanceFactor: 2.5 }))
    expect(f).toEqual({ position: [...DEFAULT_POSITION], target: [...DEFAULT_TARGET] })
    expect(isFiniteFraming(f)).toBe(true)
    // non-degenerate: a real (non-zero) look direction
    expect(Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2])).toBeGreaterThan(0)
  })

  test('a normal (ordinary-magnitude) head is UNCHANGED by the collapse guard — exact composed values (f1-terminal class)', () => {
    // f1's terminal-head class: a finite, ordinary-magnitude subject. The guard branch must NOT be taken —
    // the output is bit-for-bit the pre-guard compose-around-head formula.
    const head: [number, number, number] = [-34.65, 0, -250.6]
    const f = finaleFraming(head, { lift: 1, distance: 25 })
    expect(f.target).toEqual([-34.65, 1, -250.6]) // head lifted, exact
    expect(f.position[0]).toBeCloseTo(head[0] + (OFF[0] / OFFLEN) * 25, 10)
    expect(f.position[1]).toBeCloseTo(head[1] + (OFF[1] / OFFLEN) * 25, 10)
    expect(f.position[2]).toBeCloseTo(head[2] + (OFF[2] / OFFLEN) * 25, 10)
    expect(Math.hypot(f.position[0] - head[0], f.position[1] - head[1], f.position[2] - head[2])).toBeCloseTo(25)
  })

  test('an Infinity/NaN head is NOT swallowed by the collapse guard — it stays non-finite for the Scene consume to reject', () => {
    // The guard uses `separation === 0` (a FINITE collapse), NOT `!(separation > 0)`: an Infinity/NaN head makes
    // the separation NaN, so the guard is not taken and the framing stays non-finite — isFiniteFraming rejects it
    // at the consume exactly as before, rather than being silently swapped for the finite composed default.
    expect(isFiniteFraming(finaleFraming([Infinity, Infinity, Infinity], { lift: 1, distance: 25 }))).toBe(false)
    expect(isFiniteFraming(finaleFraming([NaN, NaN, NaN], { lift: 1, distance: 25 }))).toBe(false)
  })
})

describe('followPan (in-place dolly, zero-alloc)', () => {
  test('eases the pivot toward the subject AND translates the camera by the SAME delta', () => {
    const target = { x: 0, y: 0, z: 0 }
    const camera = { x: 6, y: 4.5, z: 9 } // pivot→camera offset = [6,4.5,9]
    followPan(target, camera, 10, 20, 30, 0.05)
    // pivot eases 5% toward the subject
    expect(target.x).toBeCloseTo(0.5); expect(target.y).toBeCloseTo(1); expect(target.z).toBeCloseTo(1.5)
    // camera moved by the identical delta → offset preserved (constant apparent size)
    expect(camera.x).toBeCloseTo(6.5); expect(camera.y).toBeCloseTo(5.5); expect(camera.z).toBeCloseTo(10.5)
    expect(camera.x - target.x).toBeCloseTo(6); expect(camera.y - target.y).toBeCloseTo(4.5); expect(camera.z - target.z).toBeCloseTo(9)
  })
  test('preserves the offset across a large pan (subject stays a constant distance from the camera)', () => {
    const target = { x: 0, y: 1, z: 0 }
    const camera = { x: 3, y: 3.75, z: 6.75 }
    const off0 = Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z)
    for (let i = 0; i < 400; i++) followPan(target, camera, -34.65, 0, -250.6, 0.05) // f1's terminal drone
    // pivot converges onto the subject; the camera→pivot distance is unchanged (NOT ballooning to 250+)
    expect(target.x).toBeCloseTo(-34.65, 1); expect(target.z).toBeCloseTo(-250.6, 1)
    const off1 = Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z)
    expect(off1).toBeCloseTo(off0)
  })
  test('factor 1 snaps the pivot onto the subject and dollies the camera by the full delta', () => {
    const target = { x: 5, y: 5, z: 5 }
    const camera = { x: 11, y: 9.5, z: 14 }
    followPan(target, camera, -3, 7, 11, 1)
    expect(target).toEqual({ x: -3, y: 7, z: 11 })
    expect(camera.x - target.x).toBeCloseTo(6); expect(camera.y - target.y).toBeCloseTo(4.5); expect(camera.z - target.z).toBeCloseTo(9)
  })
})

// Trail-frame one-shot channel (Scene.tsx, Task v04.1-2). Same source-signaled shape as `focusRequest`:
// a bare module object read by stamp compare in the frame loop. useTour.onArrived bumps it on a natural
// play-step arrival; the frame loop compares the stamp and eases to the trajectory-so-far framing.
// Mirrors src/tour/interrupt.test.ts' channel-level coverage (the frame-side consume is browser-verified).
describe('trail-frame request channel', () => {
  test('requestTrailFrame bumps the stamp monotonically', () => {
    const before = trailFrameRequest.stamp
    requestTrailFrame()
    expect(trailFrameRequest.stamp).toBe(before + 1)
    requestTrailFrame()
    expect(trailFrameRequest.stamp).toBe(before + 2)
  })

  // Cancel is the interrupt stand-down (mirrors focus's focusRequest.key = null): useTour.stop() calls it so
  // Scene clears the active arrival ease within one frame. At the channel level it raises `cancelled` and
  // bumps the stamp (so the frame loop CONSUMES it); a fresh request lowers the flag again to re-arm.
  test('cancelTrailFrame raises the stand-down flag and bumps the stamp; a request re-arms it', () => {
    requestTrailFrame() // arm: cancelled lowered
    expect(trailFrameRequest.cancelled).toBe(false)
    const before = trailFrameRequest.stamp
    cancelTrailFrame()
    expect(trailFrameRequest.cancelled).toBe(true)     // stand-down signalled
    expect(trailFrameRequest.stamp).toBe(before + 1)   // monotonic bump → the frame loop consumes it
    requestTrailFrame()
    expect(trailFrameRequest.cancelled).toBe(false)    // a later arrival re-arms cleanly
    expect(trailFrameRequest.stamp).toBe(before + 2)
  })

  // Hold-light (Task v0.5a-2): the SAME two writers that arm/disarm the arrival camera ease also flip the
  // trail hold-light. A natural arrival (requestTrailFrame) lights the whole revealed journey; an interrupt
  // (cancelTrailFrame) returns the comet. The frame-side switch (uFadeTicks) is browser-verified — this pins
  // the channel-level transition beside the stamp tests above.
  test('requestTrailFrame lights the hold; cancelTrailFrame clears it', () => {
    cancelTrailFrame()
    expect(trailHold.lit).toBe(false)
    requestTrailFrame()
    expect(trailHold.lit).toBe(true)   // natural arrival → behold the (fully-lit) journey
    cancelTrailFrame()
    expect(trailHold.lit).toBe(false)  // interrupt → the comet returns
  })
})

// Frame-request INTENT scoping (T2, ruling 4). A request now carries an explicit intent so the establishing
// shot can frame WITHOUT lighting the hold, and so a selection can cancel an ACTIVE establish ease while a
// tour's own select actions can NEVER cancel a tour-arrival frame. These pin the pure channel surface; the
// frame-side consume (which framing each intent computes) is browser-verified. Each test sets its own
// starting state (module-scope channel object persists across tests), so they are order-independent.
describe('frame-request intent scoping (T2)', () => {
  test('requestTrailFrame carries the tour-arrival intent and lights the hold (tour semantics, unchanged)', () => {
    requestEstablishFrame() // move the intent off tour-arrival first so the assertion is meaningful
    requestTrailFrame()
    expect(trailFrameRequest.intent).toBe('tour-arrival')
    expect(trailHold.lit).toBe(true)
  })

  test('requestEstablishFrame carries the establish intent, bumps the stamp, and does NOT light the hold', () => {
    cancelTrailFrame() // hold cleared; intent unchanged
    expect(trailHold.lit).toBe(false)
    const before = trailFrameRequest.stamp
    requestEstablishFrame()
    expect(trailFrameRequest.intent).toBe('establish')
    expect(trailFrameRequest.stamp).toBe(before + 1) // monotonic bump → the frame loop consumes it
    expect(trailFrameRequest.cancelled).toBe(false)  // a fresh request lowers any prior stand-down
    expect(trailFrameRequest.refit).toBe(false)      // plain establish keeps the FOCUS rate (v0.5d ruling 5)
    expect(trailHold.lit).toBe(false)                // establishing must not light the journey at play start
  })

  // v0.5d ruling 5: the scrub-from-finale re-fit rides the SAME 'establish' intent (so cancelEstablishFrame stays
  // byte-identical) but flags refit=true so the consume eases it at the gentler rate. requestEstablishFrame RESETS
  // the flag so a later plain establish can never inherit a stale refit rate.
  test('requestRefitFrame carries the establish intent with refit=true, bumps the stamp, and does NOT light the hold', () => {
    cancelTrailFrame()
    const before = trailFrameRequest.stamp
    requestRefitFrame()
    expect(trailFrameRequest.intent).toBe('establish') // same intent → cancelEstablishFrame (guarded to establish) still cancels it
    expect(trailFrameRequest.refit).toBe(true)         // the gentler-settle discriminator
    expect(trailFrameRequest.stamp).toBe(before + 1)
    expect(trailFrameRequest.cancelled).toBe(false)
    expect(trailHold.lit).toBe(false)                  // the re-fit is a framing move, not a lit rest
  })

  test('requestEstablishFrame RESETS refit → a plain establish after a re-fit uses the focus rate again', () => {
    requestRefitFrame()
    expect(trailFrameRequest.refit).toBe(true)
    requestEstablishFrame()
    expect(trailFrameRequest.refit).toBe(false) // no stale gentle-rate leaks into the next plain establish
  })

  test('cancelEstablishFrame stands down a RE-FIT ease too (same establish intent → a selection cancels it; T2 semantics intact)', () => {
    requestRefitFrame() // intent 'establish', refit true
    const before = trailFrameRequest.stamp
    cancelEstablishFrame()
    expect(trailFrameRequest.cancelled).toBe(true)   // guarded to 'establish' → fires for the refit variant too
    expect(trailFrameRequest.stamp).toBe(before + 1) // the consume sees the stand-down; follow takes over on the selection
  })

  test('cancelEstablishFrame stands down an ESTABLISH ease (raises cancelled + bumps the stamp)', () => {
    requestEstablishFrame()
    const before = trailFrameRequest.stamp
    cancelEstablishFrame()
    expect(trailFrameRequest.cancelled).toBe(true)
    expect(trailFrameRequest.stamp).toBe(before + 1) // the frame loop consumes the stand-down next frame
  })

  test('cancelEstablishFrame is a NO-OP against a tour-arrival frame (a select never cancels a tour arrival)', () => {
    requestTrailFrame() // intent = tour-arrival, cancelled = false, lit = true
    const before = trailFrameRequest.stamp
    cancelEstablishFrame() // a tour's select action fires this too — it must NOT touch the tour-arrival frame
    expect(trailFrameRequest.cancelled).toBe(false) // tour-arrival frame survives
    expect(trailFrameRequest.stamp).toBe(before)     // no stamp bump → the consume never sees a stand-down
    expect(trailHold.lit).toBe(true)                 // and the hold-light is untouched
  })

  test('requestEstablishFrame leaves the tour hold-light exactly as it found it (lighting-agnostic)', () => {
    requestTrailFrame()               // lit = true
    requestEstablishFrame()
    expect(trailHold.lit).toBe(true)  // establish does not touch the hold-light
    cancelTrailFrame()                // lit = false
    requestEstablishFrame()
    expect(trailHold.lit).toBe(false)
  })
})

// ── Authored tour-camera shot resolution (v0.7 T4) — the shot grammar → framing, from live anchors ──────────
// The design consult (miniwave §4.2 → T4) ruled per-beat authored arrives; these pin that each shot KIND
// resolves to the right proven composition from live scene data, and degrades to null (→ the prefix-fit default)
// when its inputs are unavailable. Structural assertions (=== the helper the grammar maps to), never brittle
// hand-typed coordinates — the whole point of the grammar is that the coords are derived, not authored.
describe('shotFraming (authored tour-camera shot resolution, T4)', () => {
  // FINALE_DISTANCE (Scene) = 25; the fit opts mirror TRAIL_FRAME_OPTS ≡ STAGE_FRAME_OPTS (uncapped house fit).
  const OPTS: ShotOpts = { fit: { fov: DEFAULT_FOV, margin: 1.15, lift: 1, maxDistanceFactor: Infinity }, lift: 1, headMedium: HEAD_MEDIUM_DISTANCE, headClose: 25 }
  const head: [number, number, number] = [48, 0, 22]          // f2a drone at tick 48 (three-space)
  const sensor: [number, number, number] = [0, 0, 0]          // sensor O
  const occluder = { center: [41, 0, 41] as [number, number, number], radius: Math.sqrt(41) }
  const stageBounds = { center: [24, 0, 40] as [number, number, number], radius: 90 }
  const corridor = { center: [160, 1, 0] as [number, number, number], radius: 185 } // e0 SHOT 1 (a three-space box→sphere)
  const crane: Framing = { position: [-860, 130, -35], target: [415, 0, -47] }       // e0 SHOT 2 (a directed vantage)
  const full: ShotAnchors = { head, sensor, occluder, stageBounds, corridor, crane }

  test("'head' medium composes around the head at the medium distance (= finaleFraming, medium)", () => {
    const f = shotFraming({ kind: 'head', distance: 'medium' }, full, OPTS)!
    expect(f).toEqual(finaleFraming(head, { lift: 1, distance: HEAD_MEDIUM_DISTANCE }))
    expect(HEAD_MEDIUM_DISTANCE).toBe(50) // ~2× the finale close-up — the following play step keeps air
  })

  test("'head' close composes around the head at the finale distance (= the natural-end finale close-up framing)", () => {
    const f = shotFraming({ kind: 'head', distance: 'close' }, full, OPTS)!
    // Byte-identical to the natural-end rest close-up: finaleFraming(head, {lift, distance: FINALE_DISTANCE}).
    // f1 b2's terminal arrive lands here — the front door ends on the app's best frame, not the 340u void.
    expect(f).toEqual(finaleFraming(head, { lift: 1, distance: 25 }))
  })

  test("'head' with an absent head → null (falls through to the prefix-fit default)", () => {
    expect(shotFraming({ kind: 'head', distance: 'medium' }, { ...full, head: null }, OPTS)).toBeNull()
  })

  test("'stage' frames the whole-instrument stage bounds (= frameFor over stageBounds, uncapped fit)", () => {
    const f = shotFraming({ kind: 'stage' }, full, OPTS)!
    expect(f).toEqual(frameFor(stageBounds, OPTS.fit)) // the load / bookend vantage (f2a b5)
  })

  test("'stage' with no stageBounds → null", () => {
    expect(shotFraming({ kind: 'stage' }, { ...full, stageBounds: null }, OPTS)).toBeNull()
  })

  test("'stage' with a raised stage opts (G6 sensing bookend) frames on o.stage — bookend parity with the load/rest vantage, DISTINCT from o.fit", () => {
    // f2a b5 threads SENSING_STAGE_FRAME_OPTS as o.stage: the bookend must land byte-identically on the load/rest write
    // (loadFraming → frameFor(stageBounds, SENSING_STAGE_FRAME_OPTS)), and must NOT track the un-raised house `fit` the
    // conjunction shots keep. This is what preserves the tour-camera.spec bookend parity when the resting vantage rises.
    const raisedStage = { ...OPTS.fit, elevationDeg: 35 }
    const f = shotFraming({ kind: 'stage' }, full, { ...OPTS, stage: raisedStage })!
    expect(f).toEqual(frameFor(stageBounds, raisedStage))   // === the load/rest write → pixel-parity bookend
    expect(f).not.toEqual(frameFor(stageBounds, OPTS.fit))  // NOT the house fit → the conjunction/head shots stay untouched
  })

  test("'conjunction' fits the sensor + head (= frameFor over their box→sphere)", () => {
    const f = shotFraming({ kind: 'conjunction' }, full, OPTS)!
    const bounds = boundsFromPositions(new Float32Array([...sensor, ...head]), 2)!
    expect(f).toEqual(frameFor(bounds, OPTS.fit))
    // Sanity on scale: sensor+drone at ~72u along the octant — the design-lead conjunction distance (~70-75u).
    const dist = Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2])
    expect(dist).toBeGreaterThan(65)
    expect(dist).toBeLessThan(80)
  })

  test("'conjunction' with occluder widens the fit to include the occluder sphere (the eclipse, f2a b3)", () => {
    const bare = shotFraming({ kind: 'conjunction' }, full, OPTS)!
    const eclipse = shotFraming({ kind: 'conjunction', occluder: true }, full, OPTS)!
    // The occluder at [41,0,41]±√41 sits outside the sensor→head box, so its extent grows the fit sphere →
    // a wider pull-back. (The eclipse frames Q interposed on the sightline, per the design ruling.)
    const bareDist = Math.hypot(bare.position[0] - bare.target[0], bare.position[1] - bare.target[1], bare.position[2] - bare.target[2])
    const eclDist = Math.hypot(eclipse.position[0] - eclipse.target[0], eclipse.position[1] - eclipse.target[1], eclipse.position[2] - eclipse.target[2])
    expect(eclDist).toBeGreaterThan(bareDist)
  })

  test("'conjunction' on a non-sensing run (no sensor) → null (falls through to the prefix-fit default)", () => {
    expect(shotFraming({ kind: 'conjunction' }, { ...full, sensor: null }, OPTS)).toBeNull()
    expect(shotFraming({ kind: 'conjunction' }, { ...full, head: null }, OPTS)).toBeNull()
  })

  test("'conjunction' occluder variant with no occluder anchor falls back to the bare sensor+head fit (no throw)", () => {
    const f = shotFraming({ kind: 'conjunction', occluder: true }, { ...full, occluder: null }, OPTS)!
    expect(f).toEqual(shotFraming({ kind: 'conjunction' }, full, OPTS)) // occluder absent → same as the bare conjunction
  })

  test("'corridor' (e0 SHOT 1) frames the corridor bounds (= frameFor over a.corridor, the aspect-aware house fit)", () => {
    const f = shotFraming({ kind: 'corridor' }, full, OPTS)!
    expect(f).toEqual(frameFor(corridor, OPTS.fit)) // no aspect → the vertical-only fit, like the conjunction default
    // Aspect-aware, like the conjunction relationship shot (NOT the bookend-parity 'stage'): a narrow canvas pulls back.
    const narrow = shotFraming({ kind: 'corridor' }, full, OPTS, 0.7)!
    expect(narrow).toEqual(frameFor(corridor, OPTS.fit, 0.7))
    expect(shotFraming({ kind: 'corridor' }, full, OPTS, 1.6)).toEqual(f) // aspect ≥ 1 → the vertical fit exactly
  })

  test("'corridor' with no corridor bounds (a non-query run) → null (falls through to the prefix-fit default)", () => {
    expect(shotFraming({ kind: 'corridor' }, { ...full, corridor: null }, OPTS)).toBeNull()
    expect(shotFraming({ kind: 'corridor' }, { head, sensor, occluder, stageBounds }, OPTS)).toBeNull() // field absent
  })

  test("'crane' (e0 SHOT 2) returns the directed observer-crane framing verbatim (a preset vantage, like the POV)", () => {
    expect(shotFraming({ kind: 'crane' }, full, OPTS)).toEqual(crane) // composed decode-true in queryScene; returned as-is
  })

  test("'crane' with no crane framing (a non-query run) → null (falls through to the prefix-fit default)", () => {
    expect(shotFraming({ kind: 'crane' }, { ...full, crane: null }, OPTS)).toBeNull()
    expect(shotFraming({ kind: 'crane' }, { head, sensor, occluder, stageBounds }, OPTS)).toBeNull() // field absent
  })

  test('every resolved shot is a finite framing (the consume still guards, but the resolver never emits NaN for finite anchors)', () => {
    for (const shot of [{ kind: 'head', distance: 'medium' }, { kind: 'head', distance: 'close' }, { kind: 'stage' }, { kind: 'conjunction' }, { kind: 'conjunction', occluder: true }, { kind: 'corridor' }, { kind: 'crane' }] as const) {
      const f = shotFraming(shot, full, OPTS)
      expect(f).not.toBeNull()
      expect(isFiniteFraming(f!)).toBe(true)
    }
  })
})

// ── I-1: mount-time missed-rising-edge establish race (v0.5d T3 debt → v0.7 T4 rider; TDD deterministic repro) ──
// THE BUG. The establishing shot's ONLY caller was the rising-edge arm inside the store subscription that
// Entities registers at MOUNT (Scene.tsx). A subscription attached at mount cannot catch a `playing` rising
// edge that fired BEFORE it existed — so a run that mounts ALREADY playing-and-eligible (a slow SwiftShader
// mount that lands after ▶, documented in e2e/smoke.spec.ts seatEarlySphere) never requested an establish, and
// the camera stranded on the composed load vantage while the subject flew off-frame. The corrected diagnosis
// (progress.md v0.5d T3): it is a MISSED EDGE, not a swallowed stamp — "stop the mount-seed consuming" would fix
// nothing, because nothing ever REQUESTED. The remedy is a mount-time already-playing-and-eligible DECISION that
// fires requestEstablishFrame after the ref seed. That decision is this pure predicate; the Scene mount-effect is
// its thin caller (the arming path is browser/smoke-verified — no render harness in this repo).
describe('mount-time establish race (I-1): shouldEstablishOnMount', () => {
  // The eligible mount snapshot the bug leaves un-established: a positioned, fittable, tour-free, unselected run
  // that is ALREADY playing at mount, mid-run (tick < tickCount). This is the exact case the rising-edge arm
  // handles for a fast mount and the pre-fix mount left silent.
  const eligible = { playing: true, selectedEntity: null, tick: 0 }
  const positioned = true, boundsNonNull = true, tourActive = false, tickCount = 64

  test('the eligible already-playing mount is detected (true) — the establishing shot the missed edge dropped', () => {
    expect(shouldEstablishOnMount(eligible, positioned, boundsNonNull, tourActive, tickCount)).toBe(true)
  })

  // DETERMINISTIC REPRO of the missed edge, at the channel the Scene consume reads. A fresh mount SEEDS its
  // stamp ref at the current channel stamp (Scene.tsx trailFrameStampRef); with NO rising edge and NO mount
  // decision, nothing bumps the stamp, so the consume sees stamp === seed and never eases — the camera stays
  // on the load vantage (the bug). Routing the SAME eligible snapshot through the mount decision fires
  // requestEstablishFrame, which bumps the stamp with intent 'establish' and no hold-light → the consume now
  // acts. This pins that the fix restores exactly the establishing shot the rising-edge arm would have armed.
  test('routing the eligible mount through the decision bumps the establish stamp the missed edge never did', () => {
    cancelTrailFrame() // known starting state; intent off establish, hold cleared
    const seed = trailFrameRequest.stamp // the mount-seed ref captures this
    // No rising edge, no mount decision → the pre-fix world: the stamp never moves, nothing to consume.
    expect(trailFrameRequest.stamp).toBe(seed)
    // The mount decision on the eligible snapshot → establish requested (the fix).
    if (shouldEstablishOnMount(eligible, positioned, boundsNonNull, tourActive, tickCount)) requestEstablishFrame()
    expect(trailFrameRequest.stamp).toBe(seed + 1)      // the consume now sees a genuine stamp CHANGE
    expect(trailFrameRequest.intent).toBe('establish')  // the whole-trajectory establishing shot
    expect(trailHold.lit).toBe(false)                   // establish never lights the journey at play start
  })

  // GATES — each must return false so the mount decision never fires a SPURIOUS establish. These mirror the
  // rising-edge arm's exclusions one-for-one (Scene.tsx line ~341), keyed on the already-true `playing`.
  test('at rest → false (the common mount, AND every run-switch: selectRun rests playing=false, so a remount never re-establishes)', () => {
    expect(shouldEstablishOnMount({ ...eligible, playing: false }, positioned, boundsNonNull, tourActive, tickCount)).toBe(false)
  })
  test('a selection present → false (a selected mount follows its subject; the establish is unselected-only)', () => {
    expect(shouldEstablishOnMount({ ...eligible, selectedEntity: '1:0' }, positioned, boundsNonNull, tourActive, tickCount)).toBe(false)
  })
  test('a tour active → false (a tour owns the camera; the cold-open autoplay mount never steals an establish)', () => {
    expect(shouldEstablishOnMount(eligible, positioned, boundsNonNull, true, tickCount)).toBe(false)
  })
  test('positionless (e0) → false (nothing spatial to frame; the arm is dormant there too)', () => {
    expect(shouldEstablishOnMount(eligible, false, boundsNonNull, tourActive, tickCount)).toBe(false)
  })
  test('null bounds (f0 static point / unfittable) → false (the consume guards bounds too; guard here as well)', () => {
    expect(shouldEstablishOnMount(eligible, positioned, false, tourActive, tickCount)).toBe(false)
  })
  test('at the natural end (tick === tickCount) → false (the finale owns that rest; no wide-then-close lurch)', () => {
    expect(shouldEstablishOnMount({ ...eligible, tick: tickCount }, positioned, boundsNonNull, tourActive, tickCount)).toBe(false)
  })
  test('mid-run (0 < tick < tickCount) still qualifies — a resume-into-mount frames the whole path', () => {
    expect(shouldEstablishOnMount({ ...eligible, tick: 30 }, positioned, boundsNonNull, tourActive, tickCount)).toBe(true)
  })
})

// INVARIANT refit ⟹ intent==='establish'. Only the establish writers touch refit (requestRefitFrame sets it
// true, requestEstablishFrame resets it false); the NON-establish writers (requestTrailFrame → tour-arrival,
// requestFinaleFrame → finale) must ALSO reset refit=false so a prior refit request can never leave refit=true
// latched under a non-establish intent. Latent today (the consume reads refit only in the establish branch)
// but the invariant is load-bearing for future readers — pin both fuzz sequences.
describe('refit invariant: only an establish intent may carry refit=true', () => {
  test('refit → tour-arrival clears refit (requestTrailFrame resets it)', () => {
    requestRefitFrame()
    expect(trailFrameRequest.refit).toBe(true)
    requestTrailFrame()
    expect(trailFrameRequest.intent).toBe('tour-arrival')
    expect(trailFrameRequest.refit).toBe(false) // invariant restored: non-establish ⇒ refit false
  })
  test('refit → finale clears refit (requestFinaleFrame resets it)', () => {
    requestRefitFrame()
    expect(trailFrameRequest.refit).toBe(true)
    requestFinaleFrame()
    expect(trailFrameRequest.intent).toBe('finale')
    expect(trailFrameRequest.refit).toBe(false) // invariant restored: non-establish ⇒ refit false
  })
  test('the surviving refit=true state is ONLY reachable under the establish intent', () => {
    // Sweep every writer; refit is true iff the last writer was requestRefitFrame (intent establish).
    requestTrailFrame();    expect(trailFrameRequest.refit).toBe(false)
    requestRefitFrame();    expect(trailFrameRequest.refit && trailFrameRequest.intent === 'establish').toBe(true)
    requestEstablishFrame();expect(trailFrameRequest.refit).toBe(false)
    requestRefitFrame();    expect(trailFrameRequest.intent).toBe('establish')
    requestFinaleFrame();   expect(trailFrameRequest.refit).toBe(false)
  })
})

// INVARIANT shot ⟹ intent==='tour-arrival' (v0.7 T4). The authored per-beat camera descriptor rides the
// 'tour-arrival' intent as a PARAMETER (the refit precedent: cancel-scope determines intent identity; variation
// within a scope is a parameter). Only requestTrailFrame sets shot, and always to intent 'tour-arrival'; every
// NON-tour writer resets shot=null so a stale authored shot can never be read under establish/finale/pov — which
// is what lets Scene's cancelEstablishFrame guard and the finale/pov branches stay byte-identical. Pin both the
// set and the reset across every writer.
describe('shot invariant: only a tour-arrival intent may carry an authored shot (T4)', () => {
  const SHOT = { kind: 'stage' } as const
  test('requestTrailFrame(shot) carries the shot under intent tour-arrival', () => {
    requestTrailFrame(SHOT)
    expect(trailFrameRequest.intent).toBe('tour-arrival')
    expect(trailFrameRequest.shot).toBe(SHOT) // a reference to the tour-data literal (zero-alloc)
  })
  test('requestTrailFrame() with no arg is the byte-identical null (today) path', () => {
    requestTrailFrame(SHOT)
    requestTrailFrame()
    expect(trailFrameRequest.shot).toBeNull()
    expect(trailFrameRequest.intent).toBe('tour-arrival')
  })
  test('every non-tour writer RESETS shot to null (establish/refit/finale/cancel)', () => {
    requestTrailFrame(SHOT); expect(trailFrameRequest.shot).toBe(SHOT)
    requestEstablishFrame(); expect(trailFrameRequest.shot).toBeNull()
    requestTrailFrame(SHOT); requestRefitFrame(); expect(trailFrameRequest.shot).toBeNull()
    requestTrailFrame(SHOT); requestFinaleFrame(); expect(trailFrameRequest.shot).toBeNull()
    requestTrailFrame(SHOT); cancelTrailFrame(); expect(trailFrameRequest.shot).toBeNull()
  })
  test('a surviving non-null shot is ONLY reachable under the tour-arrival intent', () => {
    // Sweep every writer; shot is non-null iff the last writer was requestTrailFrame(shot).
    requestTrailFrame(SHOT);   expect(trailFrameRequest.shot !== null && trailFrameRequest.intent === 'tour-arrival').toBe(true)
    requestEstablishFrame();   expect(trailFrameRequest.shot).toBeNull()
    requestTrailFrame(SHOT);   requestFinaleFrame(); expect(trailFrameRequest.shot).toBeNull()
    requestTrailFrame(SHOT);   requestRefitFrame();  expect(trailFrameRequest.shot).toBeNull()
  })
})

// Tour-start camera-reset channel (v0.5d ruling 6). useTour.start() bumps this one-shot stamp so the Scene frame
// loop cuts the camera to the composed LOAD vantage before step 0's caption. Bare stamp channel (focusRequest
// house shape); the frame-side instant cut (frameFor(bounds, LOAD_FRAME_OPTS), pixel-equivalent on a plain tour)
// is browser-verified. This pins the pure channel surface.
describe('tour-start frame-reset channel (v0.5d ruling 6)', () => {
  test('requestTourStartFrame bumps the stamp monotonically', () => {
    const before = tourStartFrameRequest.stamp
    requestTourStartFrame()
    expect(tourStartFrameRequest.stamp).toBe(before + 1)
    requestTourStartFrame()
    expect(tourStartFrameRequest.stamp).toBe(before + 2)
  })
})

// Finale frame-request scoping (v0.5b T3, ruling 2/5). The natural-end edge sets the store finale flag; the
// Scene subscription arms the composed close-up via requestFinaleFrame on the finale rising edge. Unlike
// establish it LIGHTS the hold (the reusable half of the tour machinery — the journey stays lit at rest), and
// its intent is a THIRD class on the enum so cancelEstablishFrame (guarded to 'establish') can NEVER cancel it
// (r2). These pin the pure channel surface; the frame-side consume (finaleFraming for a positioned run / the
// spine-bounds fit for e0, coast+focus clears) is browser-verified.
describe('finale frame-request scoping (T3)', () => {
  test('requestFinaleFrame carries the finale intent, bumps the stamp, and LIGHTS the hold (journey lit at rest)', () => {
    cancelTrailFrame() // hold cleared; move the intent off finale
    const before = trailFrameRequest.stamp
    requestFinaleFrame()
    expect(trailFrameRequest.intent).toBe('finale')
    expect(trailFrameRequest.stamp).toBe(before + 1)
    expect(trailFrameRequest.cancelled).toBe(false)
    expect(trailHold.lit).toBe(true) // ruling 2: the reusable half — the journey stays lit at the finale rest
  })

  test('cancelEstablishFrame is a NO-OP against a finale frame (a scrub-cleared finale never cancels via the establish path; r2)', () => {
    requestFinaleFrame() // intent = finale
    const before = trailFrameRequest.stamp
    cancelEstablishFrame() // guarded to 'establish' → must not touch a finale frame
    expect(trailFrameRequest.cancelled).toBe(false)
    expect(trailFrameRequest.stamp).toBe(before)
    expect(trailFrameRequest.intent).toBe('finale')
  })

  test('a later finale stamp supersedes a pending establish (both can be live in one unselected run — last stamp wins)', () => {
    requestEstablishFrame()
    const est = trailFrameRequest.stamp
    requestFinaleFrame()
    expect(trailFrameRequest.stamp).toBe(est + 1) // newer stamp → the consume frames the finale, not establish
    expect(trailFrameRequest.intent).toBe('finale')
  })

  test('requestFinaleFrame is idempotent: a re-request (play-at-rest r1 re-fire) bumps the stamp and keeps the hold lit', () => {
    // A play-at-rest re-fire (r1) re-requests the finale; the writer is idempotent (cancelled stays false, the
    // hold re-lights). Pin that a re-request bumps the stamp and keeps the hold lit.
    requestFinaleFrame()
    const before = trailFrameRequest.stamp
    requestFinaleFrame()
    expect(trailFrameRequest.stamp).toBe(before + 1)
    expect(trailHold.lit).toBe(true)
  })
})

// Scrub-from-finale context re-fit gate (v0.5c ruling 3 — a RULED AMENDMENT of the v0.5b "clearing the finale
// never re-frames" line). At an f1 finale rest a scrub cleared the dressing correctly but stranded the camera at
// the empty sky where the head was (the "void"); ruling 3 reverses the old line NARROWLY — leaving a finale by a
// PLAYHEAD MOVE now hands back the wide establishing frame (an establish request — framing, NO lit). The falling-
// edge effect lives inside a Scene subscription a unit test can't cheaply mount, so the gate is extracted as a
// pure predicate (shouldRefitOnFinaleClear) and the effect is a thin caller; TDD it exhaustively here across the
// store-batch matrix, plus the channel-observable outcome (a scrub fires an establish request; every other clear
// fires nothing). Store-batch CAUSALITY is the detector (verified by the controller): setTick/applyLink write
// {tick, finale:false} atomically; tour-start's bracket (useTour.ts:341) and play-at-rest (setPlaying(true)) clear
// finale WITHOUT moving the tick; selectRun (App.tsx:93) moves the tick but changes runId in the same batch. The
// gate is NOT isTourActive(): start() clears finale at useTour.ts:341 BEFORE registerTourInterrupt at :347, so it
// is provably false at that edge — the tick-move gate is the race-free detector.
describe('shouldRefitOnFinaleClear (scrub-from-finale re-fit gate, v0.5c ruling 3 amendment)', () => {
  const st = (finale: boolean, tick: number, runId = 'f1') => ({ finale, tick, runId })

  // ---- the pure predicate, exhaustively across the store-batch matrix ----
  test('scrub-from-finale (finale true→false, tick MOVED, same run, positioned + fittable bounds) → TRUE — the void gesture', () => {
    expect(shouldRefitOnFinaleClear(st(false, 60), st(true, 64), true, true)).toBe(true)
  })
  test('tour-start bracket (finale true→false, tick UNCHANGED) → FALSE — start() clears finale without moving the tick', () => {
    // useTour.ts:341 writes { finale: false } with the tick untouched; the tick-move gate — not isTourActive() —
    // rejects it (start() clears finale at :341 BEFORE registerTourInterrupt at :347, so isTourActive() is false here).
    expect(shouldRefitOnFinaleClear(st(false, 64), st(true, 64), true, true)).toBe(false)
  })
  test('play-at-rest clear (finale true→false via setPlaying(true), tick UNCHANGED) → FALSE — the r1 re-fire re-owns the rest', () => {
    expect(shouldRefitOnFinaleClear(st(false, 64), st(true, 64), true, true)).toBe(false)
  })
  test('run-switch batch (finale true→false, tick moved AND runId changed together) → FALSE — selectRun is not a scrub', () => {
    expect(shouldRefitOnFinaleClear(st(false, 0, 'e0'), st(true, 64, 'f1'), true, true)).toBe(false)
  })
  test('ordinary scrub with the finale ALREADY false (prev.finale false) → FALSE — an ordinary scrub NEVER re-frames', () => {
    expect(shouldRefitOnFinaleClear(st(false, 30), st(false, 64), true, true)).toBe(false)
  })
  test('e0-shape (positionless → !positioned) leaving a finale by a scrub → FALSE — e0 keeps stay-put', () => {
    expect(shouldRefitOnFinaleClear(st(false, 40, 'e0'), st(true, 74, 'e0'), false, false)).toBe(false)
  })
  test('f0-shape (positioned but null bounds — the static point) → FALSE — f0 keeps stay-put', () => {
    expect(shouldRefitOnFinaleClear(st(false, 0, 'f0'), st(true, 2, 'f0'), true, false)).toBe(false)
  })
  test('a rising finale edge (false→true) is never a re-fit — the predicate fires only on the FALLING edge', () => {
    expect(shouldRefitOnFinaleClear(st(true, 64), st(false, 60), true, true)).toBe(false)
  })

  // ---- the channel-observable outcome: the effect is a thin caller — fire a RE-FIT establish request IFF the gate
  // holds (v0.5d ruling 5: the scrub-from-finale path uses requestRefitFrame — the gentler-settle establish) ----
  const refit = (
    s: ReturnType<typeof st>, prev: ReturnType<typeof st>, positioned: boolean, boundsNonNull: boolean,
  ): void => { if (shouldRefitOnFinaleClear(s, prev, positioned, boundsNonNull)) requestRefitFrame() }

  test('scrub-from-finale fires a RE-FIT establish request: stamp bumps + intent establish + refit=true (wide frame, gentle settle)', () => {
    requestFinaleFrame() // seat the pre-scrub channel: at a finale rest the intent is 'finale'
    const before = trailFrameRequest.stamp
    refit(st(false, 60), st(true, 64), true, true)
    expect(trailFrameRequest.stamp).toBe(before + 1)   // monotonic bump → the frame loop consumes it, easing off the close-up
    expect(trailFrameRequest.intent).toBe('establish') // establish = whole-trajectory framing, NOT the finale close-up (and it does not light the journey)
    expect(trailFrameRequest.refit).toBe(true)         // v0.5d ruling 5: the re-fit gets the gentler settle rate
  })
  test('every NON-scrub finale clear fires NOTHING: tour-start / play-at-rest / run-switch / e0 / f0 / ordinary-scrub leave the channel untouched', () => {
    requestFinaleFrame()
    const before = trailFrameRequest.stamp
    refit(st(false, 64), st(true, 64), true, true)            // tour-start + play-at-rest: tick unchanged
    refit(st(false, 0, 'e0'), st(true, 64, 'f1'), true, true) // run-switch: runId changed in the same batch
    refit(st(false, 40, 'e0'), st(true, 74, 'e0'), false, false) // e0: positionless
    refit(st(false, 0, 'f0'), st(true, 2, 'f0'), true, false)    // f0: null bounds
    refit(st(false, 30), st(false, 64), true, true)          // ordinary scrub, finale already false
    expect(trailFrameRequest.stamp).toBe(before)             // no establish request from any of them
    expect(trailFrameRequest.intent).toBe('finale')          // intent untouched (still the finale we seated)
  })
})

// Revealed-trail midpoint index (T2, ruling 7): the pure index math behind the follow-aim trail bias. The
// follow pivot is biased off the live head toward the midpoint of the REVEALED path so the one-sided trail
// balances the frame. This pins the off-by-one / clamp without needing a Float32Array; the buffer read +
// bias lerp at the Scene call site are browser-verified.
describe('revealedMidpointIndex (follow-aim trail bias, T2)', () => {
  test('midpoint vertex is floor(min(tick, count-1) / 2)', () => {
    expect(revealedMidpointIndex(64, 65)).toBe(32) // f1 at rest: head 64 → mid 32
    expect(revealedMidpointIndex(40, 65)).toBe(20) // mid-run: head 40 → mid 20
    expect(revealedMidpointIndex(1, 65)).toBe(0)   // head 1 → mid 0 (floor)
    expect(revealedMidpointIndex(0, 65)).toBe(0)   // head 0 → mid 0
  })
  test('clamps a tick past the last vertex to the final revealed head', () => {
    expect(revealedMidpointIndex(1000, 65)).toBe(32) // head clamps to 64 → mid 32
  })
  test('degenerate small counts stay in range', () => {
    expect(revealedMidpointIndex(5, 1)).toBe(0) // single vertex: head 0 → mid 0
    expect(revealedMidpointIndex(1, 2)).toBe(0) // head 1 → mid 0
    expect(revealedMidpointIndex(2, 3)).toBe(1) // head 2 → mid 1
  })
  test('floors a negative tick to 0 (defensive; the store tick is always >= 0)', () => {
    expect(revealedMidpointIndex(-5, 65)).toBe(0)
  })
})

// Follow-aim displacement CAP (T2 fixwave, camera.followBiasCapScale). FOLLOW_TRAIL_BIAS encodes a
// SCREEN-relative composition goal ("head ~1/3 in from the leading edge") but the Scene call site applies it
// as an UNBOUNDED world displacement d = (mid − head)·bias that GROWS with the revealed corridor — at f1 tick
// 63 |d| ≈ 20.9u (~2.2× the horizontal half-frame) and a campaign-scale 1000u+ corridor would shove the head
// clean out of frame. followBiasCapScale returns the factor that clamps |d| to FOLLOW_BIAS_MAX world units;
// below the cap it returns EXACTLY 1 so the early-run composition is applied verbatim (bit-identical to the
// uncapped lerp). Pure, so the cap is pinned here without mounting Scene; the buffer read + the three biased
// += at the Scene call site are browser-verified.
describe('followBiasCapScale (follow-aim displacement cap, T2 fixwave)', () => {
  const BIAS = 0.15 // mirrors Scene.FOLLOW_TRAIL_BIAS — the fraction the pivot leans off the head toward mid
  // Reconstruct the Scene call site's displacement d = (mid − head)·BIAS from a head/mid pair.
  const disp = (h: readonly [number, number, number], m: readonly [number, number, number]): [number, number, number] =>
    [(m[0] - h[0]) * BIAS, (m[1] - h[1]) * BIAS, (m[2] - h[2]) * BIAS]

  test('caps the displacement magnitude at FOLLOW_BIAS_MAX across adversarial head/mid pairs', () => {
    const thr = FOLLOW_BIAS_MAX / BIAS // the |head − mid| at which |d| == FOLLOW_BIAS_MAX exactly
    const pairs: Array<[[number, number, number], [number, number, number]]> = [
      [[0, 0, 0], [0, 0, 0]],                            // |head − mid| = 0 → zero displacement (guarded, no divide)
      [[0, 0, 0], [1e-6, 0, 0]],                         // tiny
      [[0, 0, 0], [thr, 0, 0]],                          // ≈ exactly at the threshold (|d| ≈ FOLLOW_BIAS_MAX)
      [[0, 1, 0], [10 * thr, 1, 0]],                     // 10× the threshold
      [[0, 0, 0], [0, 0, 1000 * thr]],                   // 1000× — the campaign-scale corridor (head would fly off-frame)
      [[5, -3, 7], [-6.2 * thr, 4.1 * thr, -8.9 * thr]], // arbitrary large 3-D pull
    ]
    for (const [head, midp] of pairs) {
      const [dx, dy, dz] = disp(head, midp)
      const s = followBiasCapScale(dx, dy, dz, FOLLOW_BIAS_MAX)
      expect(Math.hypot(dx * s, dy * s, dz * s)).toBeLessThanOrEqual(FOLLOW_BIAS_MAX + 1e-9)
    }
  })

  test('below the cap the displacement is applied VERBATIM — capped aim == the uncapped lerp, no drift', () => {
    // Every pair here has |d| < FOLLOW_BIAS_MAX, so the capping branch must be inert (scale exactly 1).
    const pairs: Array<[[number, number, number], [number, number, number]]> = [
      [[0, 0, 0], [10, 0, 0]],    // |d| = 1.5
      [[1, 2, 3], [5, 6, 7]],     // |d| ≈ 1.04
      [[0, 0, 0], [0, 29, 0]],    // |d| ≈ 4.35 — just under the 4.5 cap
      [[-4, 8, -2], [-4, 8, -2]], // coincident head/mid → zero displacement
    ]
    for (const [head, midp] of pairs) {
      const d = disp(head, midp)
      const s = followBiasCapScale(d[0], d[1], d[2], FOLLOW_BIAS_MAX)
      expect(s).toBe(1) // exact: below the cap the scale is the literal 1, never max/|d|
      for (let k = 0; k < 3; k++) {
        // the composed aim head + d·s is bit-identical to the plain lerp head + (mid − head)·BIAS
        expect(head[k]! + d[k]! * s).toBe(head[k]! + d[k]!)
        expect(head[k]! + d[k]! * s).toBe(head[k]! + (midp[k]! - head[k]!) * BIAS)
      }
    }
  })

  test('a displacement exactly at the cap is applied verbatim (inclusive boundary, no needless divide)', () => {
    // |d| == FOLLOW_BIAS_MAX exactly: the strict `> max` branch is NOT taken, so the scale is exactly 1.
    expect(followBiasCapScale(FOLLOW_BIAS_MAX, 0, 0, FOLLOW_BIAS_MAX)).toBe(1)
  })

  test('an over-cap displacement is scaled to EXACTLY the cap magnitude', () => {
    const s = followBiasCapScale(100, 0, 0, FOLLOW_BIAS_MAX) // far over the cap
    expect(Math.hypot(100 * s, 0, 0)).toBeCloseTo(FOLLOW_BIAS_MAX, 12)
  })

  test('a zero-magnitude displacement returns a finite scale 1 (guarded — never divides by zero)', () => {
    const s = followBiasCapScale(0, 0, 0, FOLLOW_BIAS_MAX)
    expect(s).toBe(1)
    expect(Number.isFinite(s)).toBe(true)
  })
})

// FINITE-FRAMING GUARD (camera.isFiniteFraming). A crafted CRC-valid bundle can carry Infinity/NaN positions
// → non-finite bounds → a non-finite framing; the Scene consume must NOT activate the ease on one (it would
// write NaN to the rig every frame and wedge the convergence test forever). True iff all 6 components finite.
describe('isFiniteFraming', () => {
  test('a fully finite framing → true', () => {
    expect(isFiniteFraming({ position: [6, 4.5, 9], target: [0, 1, 0] })).toBe(true)
  })

  // Every one of the six framing components (position[0..2], target[0..2]) is load-bearing: a single
  // poisoned slot — Infinity OR NaN, as a crafted CRC-valid bundle can produce — must fail the guard so
  // the Scene consume (and CameraRig's load-time guard) skips the non-finite framing. Loop all six slots
  // × both poisons: the exhaustive per-slot pin that a partial 2-of-6 spot check would leave gapped.
  const poison: Array<[string, (bad: number) => Framing]> = [
    ['position[0]', (b) => ({ position: [b, 4.5, 9], target: [0, 1, 0] })],
    ['position[1]', (b) => ({ position: [6, b, 9], target: [0, 1, 0] })],
    ['position[2]', (b) => ({ position: [6, 4.5, b], target: [0, 1, 0] })],
    ['target[0]', (b) => ({ position: [6, 4.5, 9], target: [b, 1, 0] })],
    ['target[1]', (b) => ({ position: [6, 4.5, 9], target: [0, b, 0] })],
    ['target[2]', (b) => ({ position: [6, 4.5, 9], target: [0, 1, b] })],
  ]
  for (const [slot, make] of poison) {
    for (const [label, bad] of [['Infinity', Infinity], ['NaN', NaN]] as const) {
      test(`a single ${label} in ${slot} → false`, () => {
        expect(isFiniteFraming(make(bad))).toBe(false)
      })
    }
  }
})

// Predictive follow lead (v0.5c ruling 4). The exponential follow lags an accelerating head by ≈ v/rate;
// leading the aim forward along the head velocity by lead·(v/rate) cancels the `lead` fraction of that lag.
// The lead vector is delta·lead/(dt·rate) (v = delta/dt), clamped to maxLead world units as the always-on
// backstop against a velocity spike (the caller's first-frame/teleport guard handles the discontinuity
// itself). Pure — pinned here without mounting Scene; the frame-loop wiring + calibration are browser-verified.
describe('followLead (predictive follow-lead displacement, v0.5c ruling 4)', () => {
  const out: [number, number, number] = [0, 0, 0]

  test('lead vector is delta·lead/(dt·rate), parallel to the head velocity', () => {
    // dt=0.5, rate=2, lead=0.5 → k = 0.5/(0.5·2) = 0.5, so delta (2,4,6) → lead (1,2,3). maxLead huge → no cap.
    followLead(out, 2, 4, 6, 0.5, 2, 0.5, 1e9)
    expect(out[0]).toBeCloseTo(1); expect(out[1]).toBeCloseTo(2); expect(out[2]).toBeCloseTo(3)
    // parallel to (2,4,6): cross product zero
    const cx = out[1]! * 6 - out[2]! * 4, cy = out[2]! * 2 - out[0]! * 6, cz = out[0]! * 4 - out[1]! * 2
    expect(Math.hypot(cx, cy, cz)).toBeCloseTo(0)
  })

  test('scales with velocity: doubling the per-frame delta doubles the lead (below the cap)', () => {
    followLead(out, 1, 0, 0, 1 / 60, 9.751, 0.6, 1e9)
    const one = out[0]!
    followLead(out, 2, 0, 0, 1 / 60, 9.751, 0.6, 1e9)
    expect(out[0]! / one).toBeCloseTo(2)
  })

  test('lead 0 → no lead (the follow is the unmodified v0.5b ease)', () => {
    // magnitude 0 — a lead·delta of ±0 is an inert addend at the caller (tx += ±0 === tx); ignore the sign of zero.
    followLead(out, 100, -50, 25, 1 / 60, 3.078, 0, 1e9)
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBe(0)
  })

  test('dt <= 0 → zero lead (a stalled/degenerate frame never divides)', () => {
    followLead(out, 5, 5, 5, 0, 3.078, 0.7, 1e9)
    expect(out).toEqual([0, 0, 0])
    followLead(out, 5, 5, 5, -0.016, 3.078, 0.7, 1e9)
    expect(out).toEqual([0, 0, 0])
  })

  test('rate <= 0 → zero lead (guards a pathological rate)', () => {
    followLead(out, 5, 5, 5, 1 / 60, 0, 0.7, 1e9)
    expect(out).toEqual([0, 0, 0])
  })

  test('clamps the lead magnitude to maxLead (a velocity spike cannot launch the aim)', () => {
    // A scrub-scale per-frame delta (250u in one frame): uncapped the lead would be enormous; the cap bounds it.
    followLead(out, 250, 0, 0, 1 / 60, 3.078, 0.7, 12)
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBeCloseTo(12)
    // still along the velocity direction (+x)
    expect(out[0]!).toBeGreaterThan(0); expect(out[1]).toBe(0); expect(out[2]).toBe(0)
  })

  test('below the cap the lead is applied verbatim (bit-identical to the uncapped displacement)', () => {
    // k = 0.6/((1/60)·9.751) ≈ 3.692; delta 0.5u/frame → lead ≈ 1.85u, well under a 12u cap.
    followLead(out, 0.5, 0, 0, 1 / 60, 9.751, 0.6, 12)
    const k = 0.6 / ((1 / 60) * 9.751)
    expect(out[0]!).toBeCloseTo(0.5 * k)
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBeLessThan(12) // confirms the cap branch was NOT taken
  })

  test('a zero-velocity frame yields zero lead (a stationary head is not led)', () => {
    followLead(out, 0, 0, 0, 1 / 60, 3.078, 0.7, 12)
    expect(out).toEqual([0, 0, 0])
  })

  // Finite guard (finaleFraming precedent): a non-finite Δhead / dt / rate must return the zero-lead result,
  // never propagate NaN/Infinity into the follow aim. The production caller can't feed one (its teleport-guard
  // squared comparison is false on a non-finite Δ), but the exported pure surface is hardened regardless. Each
  // case dirties `out` with a sentinel first, so the assertion proves the guard actively WROTE zero.
  test('non-finite inputs → exact zero lead (NaN-x, Inf-x, -Inf-z, NaN-all)', () => {
    const dirty = (): void => { out[0] = 9; out[1] = 9; out[2] = 9 }
    dirty(); followLead(out, NaN, 1, 1, 1 / 60, 3.078, 0.7, 12); expect(out).toEqual([0, 0, 0])
    dirty(); followLead(out, Infinity, 1, 1, 1 / 60, 3.078, 0.7, 12); expect(out).toEqual([0, 0, 0])
    dirty(); followLead(out, 1, 1, -Infinity, 1 / 60, 3.078, 0.7, 12); expect(out).toEqual([0, 0, 0])
    dirty(); followLead(out, NaN, NaN, NaN, NaN, NaN, 0.7, 12); expect(out).toEqual([0, 0, 0])
  })
})

// Unselected mid-run tracking-ring gate (v0.5c ruling 5, EXTENDED by v0.5d ruling 3). Show the ground-ring at
// the live head while an unselected, positioned, fittable run is MID-RUN — playing OR paused. The v0.5c gate hid
// it on pause, so the pause-then-click discovery path (the sanctioned mid-run selection route) left the sub-pixel
// subject clickable yet UNDISCOVERABLE; ruling 3 adds the paused arm via a fifth input, pausedMidRun (the caller
// computes it as !playing && 0 < tick < tickCount). Priority selection > finale > mid-run-tracking is enforced by
// the else-if ORDER at the Scene call site; this predicate excludes selection AND finale so it reads as a complete
// gate. The signature GREW (4 → 5 booleans), so the truth table is now 2^5 — tested EXHAUSTIVELY below.
describe('shouldTrackWithRing (unselected mid-run tracking-ring gate, v0.5c ruling 5 + v0.5d ruling 3)', () => {
  // args order: (playing, pausedMidRun, hasSelection, finale, boundsNonNull)
  test('unselected play of a positioned fittable run → true (the tracking marker rides the head)', () => {
    expect(shouldTrackWithRing(true, false, false, false, true)).toBe(true)
  })

  // CONSCIOUS FLIP (v0.5d ruling 3 — the one sanctioned test amendment of this cycle). v0.5c pinned "paused →
  // false (the ring hides on pause)". Ruling 3 REVERSES that for a MID-RUN pause: pause-then-click is the
  // sanctioned discovery path, so a paused-mid-run subject must keep its marker. The v0.5c line survives only for
  // the rests ruling 3 keeps quiet — cold (tick 0) and the natural end (both have pausedMidRun false).
  test('MID-RUN pause → true (v0.5d ruling 3: pause-then-click is sanctioned — the marker must stay discoverable)', () => {
    expect(shouldTrackWithRing(false, true, false, false, true)).toBe(true)
  })
  test('cold / natural-end rest (paused, but pausedMidRun false) → false (v0.5c "hides on pause" survives here)', () => {
    // tick 0 or tick === tickCount ⇒ the caller passes pausedMidRun false ⇒ the ring stays quiet (finale owns the end).
    expect(shouldTrackWithRing(false, false, false, false, true)).toBe(false)
  })

  test('a selection exists → false (the selection ring wins; priority selection > mid-run-tracking)', () => {
    expect(shouldTrackWithRing(true, false, true, false, true)).toBe(false)
    expect(shouldTrackWithRing(false, true, true, false, true)).toBe(false) // even paused-mid-run yields to a selection
  })
  test('finale active → false (the finale head ring owns the rest; priority finale > mid-run-tracking)', () => {
    expect(shouldTrackWithRing(true, false, false, true, true)).toBe(false)
    expect(shouldTrackWithRing(false, true, false, true, true)).toBe(false) // finale beats a stale paused-mid-run too
  })
  test('null bounds (f0 static point / e0 positionless) → false (no wide establish, subject already legible)', () => {
    expect(shouldTrackWithRing(true, false, false, false, false)).toBe(false)
    expect(shouldTrackWithRing(false, true, false, false, false)).toBe(false)
  })

  // EXHAUSTIVE 2^5 truth table: the predicate is (playing || pausedMidRun) && !hasSelection && !finale && bounds.
  // Enumerate all 32 input combinations (including the logically-impossible playing && pausedMidRun row — the
  // pure function does not know that invariant, and asserting it there proves the OR is honest) and pin each.
  test('exhaustive 2^5 truth table matches (playing || pausedMidRun) && !hasSelection && !finale && boundsNonNull', () => {
    for (let bits = 0; bits < 32; bits++) {
      const playing = !!(bits & 1), pausedMidRun = !!(bits & 2), hasSelection = !!(bits & 4)
      const finale = !!(bits & 8), boundsNonNull = !!(bits & 16)
      const expected = (playing || pausedMidRun) && !hasSelection && !finale && boundsNonNull
      expect(shouldTrackWithRing(playing, pausedMidRun, hasSelection, finale, boundsNonNull)).toBe(expected)
    }
  })
})

// Distance-proportional tracking-ring SCALE (v0.5d ruling 2). scale = clamp(k·dist, minScale, maxScale) — a
// screen-space-constant marker: as the fixed establish camera lets the head recede, the world scale grows to
// hold the apparent size, so the marker never dies in the late climb. The floor is the v0.5c "8-at-its-
// calibration-distance" look (byte-preserved near the calibration distance); the ceiling keeps it a marker.
describe('ringTrackScale (distance-true tracking-ring scale, v0.5d ruling 2)', () => {
  const MIN = 8, MAX = 20, CALIB = 242
  const K = MIN / CALIB // ≈0.0331 — at CALIB the scale is exactly MIN

  test('at the calibration distance → exactly minScale (the v0.5c look is byte-preserved)', () => {
    expect(ringTrackScale(CALIB, K, MIN, MAX)).toBeCloseTo(MIN, 12)
  })
  test('NEARER than calibration → floored at minScale (a close head keeps the calibrated marker, never a dot)', () => {
    expect(ringTrackScale(CALIB * 0.5, K, MIN, MAX)).toBe(MIN)
    expect(ringTrackScale(11.7, K, MIN, MAX)).toBe(MIN) // f1 tick 0 pre-establish distance
    expect(ringTrackScale(0.0001, K, MIN, MAX)).toBe(MIN)
  })
  test('FARTHER than calibration → grows linearly with distance (screen-space-constant), below the ceiling', () => {
    // The late-climb window: f1 ticks 38-46 sit ~357-387u. Scale grows past MIN so the apparent size holds.
    expect(ringTrackScale(357, K, MIN, MAX)).toBeCloseTo(K * 357, 12)
    expect(ringTrackScale(357, K, MIN, MAX)).toBeGreaterThan(MIN)
    expect(ringTrackScale(465, K, MIN, MAX)).toBeCloseTo(K * 465, 12) // f1 far end ≈15.4, still < 20
    expect(ringTrackScale(465, K, MIN, MAX)).toBeLessThan(MAX)
  })
  test('monotone non-decreasing in distance (a farther head never yields a smaller ring)', () => {
    const ds = [10, 100, 242, 300, 357, 400, 465, 600, 2000]
    for (let i = 1; i < ds.length; i++) {
      expect(ringTrackScale(ds[i]!, K, MIN, MAX)).toBeGreaterThanOrEqual(ringTrackScale(ds[i - 1]!, K, MIN, MAX))
    }
  })
  test('CEILING caps a campaign-scale distance so the marker never becomes a giant target', () => {
    expect(ringTrackScale(100000, K, MIN, MAX)).toBe(MAX) // 1000u+ corridor: uncapped it would balloon
    expect(ringTrackScale(MAX / K, K, MIN, MAX)).toBeCloseTo(MAX, 9) // exactly at the ceiling distance
    expect(ringTrackScale(MAX / K + 1000, K, MIN, MAX)).toBe(MAX)
  })
  test('non-finite / non-positive distance → minScale (the safe wide default; no NaN into the mesh scale)', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -5]) expect(ringTrackScale(bad, K, MIN, MAX)).toBe(MIN)
  })
})

// Aspect-compensated follow-lead (v0.5d ruling 1). FOLLOW_LEAD was calibrated at ONE canvas aspect; on a narrower
// canvas the world-unit residual lag AND the (PROTECT'd) follow bias are each a bigger screen fraction, so the head
// rides toward the clipping edge. leadForAspect holds the head's screen fraction constant across aspects by raising
// the effective lead in proportion to the aspect DEFICIT: leadEff = baseLead + gain·(1 − min(1, aspect/calibAspect)).
// At or above the calibration aspect it returns baseLead EXACTLY (the v0.5c calibration is byte-preserved — the wide-
// aspect PROTECT); on a narrower canvas it returns MORE lead. gain=(1−baseLead) cancels only the residual lag; a
// larger (calibrated) gain also offsets the bias growth and can OVER-lead (leadEff > 1) on a narrow canvas.
describe('leadForAspect (aspect-compensated follow-lead, v0.5d ruling 1)', () => {
  const CALIB = 1.318 // an illustrative calibration aspect; the production CALIB_ASPECT is a Scene constant
  const BASE = 0.8 // mirrors Scene.FOLLOW_LEAD
  const GAIN = 0.9 // mirrors Scene.LEAD_ASPECT_GAIN order of magnitude (calibrated on the aspect sweep)

  test('at the calibration aspect → baseLead EXACTLY (deficit 0; v0.5c calibration byte-preserved)', () => {
    expect(leadForAspect(BASE, CALIB, CALIB, GAIN)).toBe(BASE)
  })

  test('WIDER than calibration → baseLead EXACTLY (clamp: never reduces lead on a wide canvas — wide PROTECT)', () => {
    // The min(1,…) caps the ratio at 1 for any aspect ≥ calib, so the deficit is 0 and the lead is the calibrated value.
    expect(leadForAspect(BASE, CALIB * 1.5, CALIB, GAIN)).toBe(BASE)
    expect(leadForAspect(BASE, 3.2, CALIB, GAIN)).toBe(BASE) // an ultra-wide viewport is unchanged
    expect(leadForAspect(BASE, CALIB * 1.5, CALIB, 0.2)).toBe(BASE) // any gain: wide is untouched
  })

  test('NARROWER than calibration → MORE lead than baseLead (pulls the head back toward centre)', () => {
    expect(leadForAspect(BASE, CALIB * 0.9, CALIB, GAIN)).toBeGreaterThan(BASE)
    expect(leadForAspect(BASE, CALIB * 0.6, CALIB, GAIN)).toBeGreaterThan(BASE)
  })

  test('a calibrated gain > (1−baseLead) OVER-leads on a narrow canvas (leadEff > 1 — offsets the bias growth)', () => {
    // Pure residual-lag cancellation (gain = 1−baseLead = 0.2) never reaches 1; the calibrated gain (~0.9) does, and
    // deliberately exceeds it on the narrow band to counter the follow-bias fraction growth the lead alone must absorb.
    const narrow = CALIB * 0.72 // ≈ the flanked-narrow band
    expect(leadForAspect(BASE, narrow, CALIB, 1 - BASE)).toBeLessThan(1) // residual-lag-only form stays < 1
    expect(leadForAspect(BASE, narrow, CALIB, GAIN)).toBeGreaterThan(1) // the calibrated gain over-leads
  })

  test('exact form: leadEff = baseLead + gain·(1 − min(1, aspect/calibAspect))', () => {
    for (const a of [CALIB, CALIB * 0.9, CALIB * 0.72, CALIB * 0.5, 1.0]) {
      expect(leadForAspect(BASE, a, CALIB, GAIN)).toBeCloseTo(BASE + GAIN * (1 - Math.min(1, a / CALIB)), 12)
    }
  })

  test('monotone: a narrower canvas yields at least as much lead as a wider one', () => {
    const aspects = [CALIB * 1.2, CALIB, CALIB * 0.9, CALIB * 0.7, CALIB * 0.5, CALIB * 0.2]
    for (let i = 1; i < aspects.length; i++) {
      expect(leadForAspect(BASE, aspects[i]!, CALIB, GAIN)).toBeGreaterThanOrEqual(leadForAspect(BASE, aspects[i - 1]!, CALIB, GAIN))
    }
  })

  test('gain 0 → no compensation at ANY aspect (leadEff === baseLead everywhere; a degenerate control)', () => {
    for (const a of [CALIB * 2, CALIB, CALIB * 0.5, 0.3]) expect(leadForAspect(BASE, a, CALIB, 0)).toBe(BASE)
  })

  test('non-finite / non-positive aspect or calib → baseLead (no compensation; the calibrated value stands)', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(leadForAspect(BASE, bad, CALIB, GAIN)).toBe(BASE) // bad live aspect
      expect(leadForAspect(BASE, CALIB, bad, GAIN)).toBe(BASE) // bad calibration constant
    }
  })
})

// ── W3: aspect-aware conjunction fit (v0.7 T4 fixwave) ──────────────────────────────────────────────────────
// shotFraming's 'conjunction' bounded only the sensor/head CENTRE points and frameFor fit VERTICAL-fov-only, so at
// the supported ~0.78 flanked aspect the drone marker's rightmost vertex projected to NDC x ≈ 1.21 (off-screen).
// The fix (a) bounds each marker's VISUAL extent (its ±radius box) and (b) fits against the tighter of the
// horizontal/vertical fov. These pin the fit MATH (the pure fitDistanceForAspect) and PROVE the marker stays in
// frame at 0.78 by projecting its worst-case vertex through a real THREE.PerspectiveCamera (pure matrix math, no WebGL).
describe('fitDistanceForAspect (aspect-aware fit distance, W3)', () => {
  const R = 40, FOV = 50, MARGIN = 1.15

  test('undefined / aspect ≥ 1 → the vertical-only fit EXACTLY (byte-identical to fitDistance — the wide PROTECT)', () => {
    expect(fitDistanceForAspect(R, FOV, MARGIN)).toBeCloseTo(fitDistance(R, FOV, MARGIN), 12)
    expect(fitDistanceForAspect(R, FOV, MARGIN, 1)).toBeCloseTo(fitDistance(R, FOV, MARGIN), 12)
    expect(fitDistanceForAspect(R, FOV, MARGIN, 1.6)).toBeCloseTo(fitDistance(R, FOV, MARGIN), 12)
  })
  test('aspect < 1 → strictly farther (the horizontal fov is the tighter constraint), monotone as it narrows', () => {
    expect(fitDistanceForAspect(R, FOV, MARGIN, 0.78)).toBeGreaterThan(fitDistance(R, FOV, MARGIN))
    expect(fitDistanceForAspect(R, FOV, MARGIN, 0.6)).toBeGreaterThan(fitDistanceForAspect(R, FOV, MARGIN, 0.78))
  })
  test('exact horizontal relation at aspect < 1: R / sin(atan(tan(fov_v/2)·aspect)) · margin', () => {
    const aspect = 0.78
    const halfV = (FOV * Math.PI) / 180 / 2
    const halfH = Math.atan(Math.tan(halfV) * aspect)
    expect(fitDistanceForAspect(R, FOV, MARGIN, aspect)).toBeCloseTo((R / Math.sin(halfH)) * MARGIN, 9)
  })
  test('non-finite / non-positive aspect → the vertical fit (safe default, no NaN into the pull-back)', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -0.5]) {
      expect(fitDistanceForAspect(R, FOV, MARGIN, bad)).toBeCloseTo(fitDistance(R, FOV, MARGIN), 12)
    }
  })
})

describe('shotFraming conjunction — the marker stays in frame at a narrow aspect (W3)', () => {
  const OPTS: ShotOpts = { fit: { fov: DEFAULT_FOV, margin: 1.15, lift: 1, maxDistanceFactor: Infinity }, lift: 1, headMedium: HEAD_MEDIUM_DISTANCE, headClose: 25 }
  // The marker VISUAL extents, imported from the renderer (W3 closure — no local 7/9/derivation drift-twin): HEAD_R
  // is the drone-marker cone base radius, SENSOR_MARKER_R the sensor octahedron radius. The cone is height HEAD_CONE_H
  // with the apex up (ConeGeometry is y-centred), so its base rim — the widest horizontal ring, the "rightmost
  // vertex" the finding measures — sits at y − HEAD_CONE_H/2. All three move if the renderer's marker sizing moves.
  const SENSOR_R = SENSOR_MARKER_R, BASE_DY = -HEAD_CONE_H / 2
  // f2a's FIRST conjunction beat (b1, tick 48), three-space (entityPosition maps NED[n,e,d] → [e,-d,n]): sensor at
  // O, drone at east 48, north 22. This SOUTH-of-the-cone approach is where the pre-fix crop is worst (the drone
  // sits toward the frame's right edge before it enters the northward FOV) — the beat Sol measured (~1.2 NDC).
  const head: [number, number, number] = [48, 0, 22]
  const sensor: [number, number, number] = [0, 0, 0]
  const ASPECT = 0.78 // the supported flanked layout
  const anchors: ShotAnchors = { head, headRadius: HEAD_R, sensor, sensorRadius: SENSOR_R, occluder: null, stageBounds: null }

  // A THREE.PerspectiveCamera placed at the framing (pure matrix math — no WebGL). Returns [cam, worldRight].
  const cameraAt = (f: Framing, aspect: number): { cam: THREE.PerspectiveCamera; right: THREE.Vector3 } => {
    const cam = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.1, 8000)
    cam.position.set(f.position[0], f.position[1], f.position[2])
    cam.up.set(0, 1, 0)
    cam.lookAt(f.target[0], f.target[1], f.target[2])
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize()
    return { cam, right }
  }
  // The marker's worst-case HORIZONTAL screen vertex: the max |ndc.x| over the base-rim extremes (±HEAD_R along
  // the world axes) AND the camera-right extreme, all in the cone's base plane (y + BASE_DY). This is the true
  // "rightmost vertex of the head marker" projected to NDC.
  const markerNdcMaxX = (f: Framing, aspect: number): number => {
    const { cam, right } = cameraAt(f, aspect)
    const offs: [number, number, number][] = [
      [HEAD_R, 0, 0], [-HEAD_R, 0, 0], [0, 0, HEAD_R], [0, 0, -HEAD_R],
      [right.x * HEAD_R, right.y * HEAD_R, right.z * HEAD_R],
    ]
    let mx = 0
    for (const o of offs) {
      const x = new THREE.Vector3(head[0] + o[0], head[1] + o[1] + BASE_DY, head[2] + o[2]).project(cam).x
      if (Math.abs(x) > Math.abs(mx)) mx = x
    }
    return mx
  }

  test('PRE-FIX (centre-only bounds, vertical-only fit) CROPS the marker off-frame at aspect 0.78 (NDC |x| > 1)', () => {
    // The pre-fix conjunction: sensor+head CENTRE points, frameFor vertical-only, displayed at 0.78.
    const preBounds = boundsFromPositions(new Float32Array([...sensor, ...head]), 2)!
    const preFix = frameFor(preBounds, OPTS.fit) // no aspect, no marker radii
    expect(Math.abs(markerNdcMaxX(preFix, ASPECT))).toBeGreaterThan(1) // Sol's ≈1.2 — the marker rim off-frame
  })

  test('POST-FIX (marker extents + aspect-aware fit) keeps the marker inside NDC |x| ≤ 1 with margin at aspect 0.78', () => {
    const postFix = shotFraming({ kind: 'conjunction' }, anchors, OPTS, ASPECT)!
    const ndcX = markerNdcMaxX(postFix, ASPECT)
    expect(Math.abs(ndcX)).toBeLessThan(0.9) // comfortably in frame (≈0.53 here) — the crop is closed with margin
    // and strictly better than the cropped pre-fix vertex — the before/after in one assertion
    const preBounds = boundsFromPositions(new Float32Array([...sensor, ...head]), 2)!
    expect(Math.abs(ndcX)).toBeLessThan(Math.abs(markerNdcMaxX(frameFor(preBounds, OPTS.fit), ASPECT)))
  })

  test('the aspect-aware conjunction pulls the camera FARTHER than the vertical-only fit (that is what un-crops it)', () => {
    const withAspect = shotFraming({ kind: 'conjunction' }, anchors, OPTS, ASPECT)!
    const vertical = shotFraming({ kind: 'conjunction' }, anchors, OPTS)! // no aspect → vertical-only
    const d = (f: Framing) => Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2])
    expect(d(withAspect)).toBeGreaterThan(d(vertical))
  })

  test('at a WIDE aspect (≥ 1) the conjunction fit is byte-identical to the vertical-only fit (the wide PROTECT)', () => {
    expect(shotFraming({ kind: 'conjunction' }, anchors, OPTS, 1.6)).toEqual(shotFraming({ kind: 'conjunction' }, anchors, OPTS))
  })

  test('marker radii 0 (a non-sensing / centre-only anchor) reproduce the pre-fix centre bounds exactly (opt-in)', () => {
    // The Scene passes radii only on a sensing run; radii 0 must collapse to the centre-only box byte-for-byte so
    // every existing conjunction test (which omits the radii) is unchanged.
    const centreOnly: ShotAnchors = { head, sensor, occluder: null, stageBounds: null } // no radii → 0
    const bounds = boundsFromPositions(new Float32Array([...sensor, ...head]), 2)!
    expect(shotFraming({ kind: 'conjunction' }, centreOnly, OPTS)).toEqual(frameFor(bounds, OPTS.fit))
  })
})

// ── W1: the follow-arm half of a play edge (v0.7 T4 fixwave) ────────────────────────────────────────────────
// The mount reconciliation (I-1) wired ONLY the establish half of a play edge; a SELECTED early-play mount thus
// armed nothing (shouldEstablishOnMount rejects a selection) and lost the vehicle until a pause/resume edge. The
// fix splits out the follow-arm decision (positioned && playing), INDEPENDENT of establish eligibility, and shares
// one onPlayEdge handler between the subscription arm and the mount reconciliation. These pin the pure predicate;
// the ref-arming Scene wiring is browser/smoke-verified (no render harness in this repo — the I-1 precedent).
describe('shouldArmFollowOnPlay (the follow-arm gate, W1)', () => {
  test('a positioned play moment arms follow (true)', () => {
    expect(shouldArmFollowOnPlay(true, true)).toBe(true)
  })
  test('at rest → false — EVERY run switch mounts playing=false, so a remount never arms', () => {
    expect(shouldArmFollowOnPlay(true, false)).toBe(false)
  })
  test('positionless (e0) → false (nothing spatial to follow — the coast is dormant there)', () => {
    expect(shouldArmFollowOnPlay(false, true)).toBe(false)
  })
  // THE W1 HEADLINE: a selected early-play mount arms follow (positioned && playing) EVEN THOUGH establish
  // correctly REJECTS it (a selection is present). The two halves of the play edge are INDEPENDENT — that is
  // exactly the independence the fix restores (before it, the mount wired only establish → follow stayed false).
  test('a SELECTED early-play mount arms follow WHILE establish rejects — the independence W1 restores', () => {
    const selectedMount = { playing: true, selectedEntity: '1:0', tick: 0 }
    expect(shouldArmFollowOnPlay(true, selectedMount.playing)).toBe(true)             // follow ARMS
    expect(shouldEstablishOnMount(selectedMount, true, true, false, 64)).toBe(false)  // establish REJECTS (selection)
  })
  test('an UNSELECTED early-play mount arms follow AND establishes (both halves fire)', () => {
    const unselMount = { playing: true, selectedEntity: null, tick: 0 }
    expect(shouldArmFollowOnPlay(true, unselMount.playing)).toBe(true)               // follow arms
    expect(shouldEstablishOnMount(unselMount, true, true, false, 64)).toBe(true)     // AND establishes
  })
})

// ── W2: step-boundary invalidation of a stale tour-arrival shot (v0.7 T4 fixwave) ───────────────────────────
// A tour-arrival shot request writes ONE global channel; under a render suspension the hold timer can advance the
// driver to the next beat before the frame loop consumes it, so a resumed frame would apply the STALE shot against
// the new beat's live anchors and suppress its follow. cancelTourArrivalFrame (fired by the driver at each step
// boundary, i>0) invalidates the prior beat's owner. These pin the pure channel writer; the driver-integration
// race is driven end-to-end in useTour.test.ts.
describe('cancelTourArrivalFrame (step-boundary stand-down, W2)', () => {
  test('stands down a tour-arrival shot: raises cancelled, clears shot, bumps the stamp (a deferred consume sees the CANCEL, not the stale shot)', () => {
    requestTrailFrame({ kind: 'conjunction' }) // a live tour-arrival shot (intent tour-arrival, cancelled false)
    expect(trailFrameRequest.shot).not.toBeNull()
    const before = trailFrameRequest.stamp
    cancelTourArrivalFrame()
    expect(trailFrameRequest.cancelled).toBe(true)        // the consume's cancelled-branch stands down the ease
    expect(trailFrameRequest.shot).toBeNull()             // the stale authored shot is dropped
    expect(trailFrameRequest.stamp).toBe(before + 1)      // supersedes an unconsumed pending request
    expect(trailFrameRequest.intent).toBe('tour-arrival') // intent is the tour's, unchanged
  })
  test('does NOT touch the hold-light (unlike cancelTrailFrame) — the next action owns the light', () => {
    requestTrailFrame({ kind: 'stage' }) // lit = true
    cancelTourArrivalFrame()
    expect(trailHold.lit).toBe(true) // untouched
  })
  test('scoped to intent tour-arrival: a NO-OP under establish/finale (a boundary with no prior arrival request)', () => {
    requestEstablishFrame() // intent establish (a pre-tour leftover the tour-start reset already handled)
    let before = trailFrameRequest.stamp
    cancelTourArrivalFrame()
    expect(trailFrameRequest.stamp).toBe(before)   // no-op — nothing tour-arrival to invalidate
    expect(trailFrameRequest.cancelled).toBe(false)
    requestFinaleFrame() // intent finale
    before = trailFrameRequest.stamp
    cancelTourArrivalFrame()
    expect(trailFrameRequest.stamp).toBe(before)   // no-op under finale too
    expect(trailFrameRequest.intent).toBe('finale')
  })
})
