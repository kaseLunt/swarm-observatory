import type { EntityV2 } from '../decode/payloads'
import type { TourShot } from '../tour/tourTypes'
import type { StateFrame } from '../lib/brand'
import { entityPosition } from './placement'

// ── Camera direction ──────────────────────────────────────────────────────────────────────────────
// Pure geometry for the stage camera: where it rests (composed default), how far it pulls back to frame
// a whole trajectory (fit), and how it drifts to keep a moving subject centred (follow). All three are
// unit-tested here so Scene.tsx only has to wire them to the live camera + OrbitControls. Zero per-frame
// allocation: the frame path calls followStep (in-place); trajectoryBounds runs ONCE at model publish.

// The composed resting frame (Task 1 §1): camera high on the +x/+y/+z octant looking at a point lifted
// ~1u off the deck. Calibrated so a single ground-plane subject reads ~18-22% of frame height with the
// horizon on the upper third. Browser-verified on f0 / f1-tick-0 (both a lone entity at the origin).
export const DEFAULT_POSITION: readonly [number, number, number] = [6, 4.5, 9]
export const DEFAULT_TARGET: readonly [number, number, number] = [0, 1, 0]
export const DEFAULT_FOV = 50

export interface Bounds { center: [number, number, number]; radius: number }

// Structural source: RunModel satisfies this (entityKeys/entityStatesAt/tickCount) without an import
// cycle, and unit tests pass a lightweight stub. entityStatesAt reads the decoded per-STATE-FRAME map — its
// parameter is StateFrame (F2), not a raw number: RunModel.entityStatesAt is branded, and typing the structural
// accessor to match closes the method-bivariance hole that let a raw event tick (the verdict-vs-pose off-by-one)
// flow into this frame-domain consumer. The internal load-path walks brand their integer loop counter at the
// call boundary (`t as StateFrame`).
export interface BoundsSource {
  readonly tickCount: number
  entityKeys(): readonly string[]
  entityStatesAt(frame: StateFrame): ReadonlyMap<string, EntityV2>
}

const scratchPos: [number, number, number] = [0, 0, 0]

// ── F3 — the DIRECTED-CAMERA ANCHOR (finale close-up / authored-shot head / follow aim) ─────────────────────
// The world point the directed camera frames on. On a SENSING run it is the resolved SUBJECT's own interpolated
// pose (useSubject — the entity the kind-22 verdicts concern, captured at i===subjectIndex in Scene's per-entity
// loop); otherwise the all-entity CENTROID (the accumulated position sum ÷ count). Two widely-separated entities
// put the centroid at their midpoint, so a tight finale/tour close-up centred on it can miss the subject entirely;
// anchoring on the subject frames the drone the evidence is ABOUT. Non-sensing (or a frame with the subject
// absent) keeps the centroid, byte-identical to pre-F3. Scene calls this at its two EVENT-RATE sites (finale,
// authored-shot head — where the pre-F3 code already allocated the same `[cx/count, …]` tuple); the per-frame
// follow reads the same `useSubject` boolean into zero-alloc number locals (§8), so no new frame-path allocation.
export function cameraAnchor(
  cx: number, cy: number, cz: number, count: number,
  sx: number, sy: number, sz: number, useSubject: boolean,
): [number, number, number] {
  return useSubject ? [sx, sy, sz] : [cx / count, cy / count, cz / count]
}

// ── F1 — the SUBJECT-POSE HOLD, TIMELINE-DERIVED (a temporary dropout must not yank the directed camera off the
// evidence, and a reverse scrub / tour jump / run switch must never leak a stale pose) ──────────────────────────
// Admission to a sensing run is key membership + a NON-STATIC flight, NOT per-tick presence: the subject can drop
// out of a tick while another entity remains on stage. The pre-fix `useSubjectAnchor = hasSensing && subjectSeen`
// flipped false on such a dropout frame, so cameraAnchor fell back to the ALL-ENTITY centroid — framing the
// remaining entity while the sensing trail/head still held the subject's prior pose. The FIRST fix threaded the
// pose forward with a TRAVERSAL LATCH (a mutate-on-forward-render, no-op-when-absent accumulator), but a latch is
// direction-dependent state: scrubbing BACKWARD into a gap kept the post-gap FUTURE pose (the trail rendered the
// pre-gap pose — camera and evidence disagreed the OTHER way), and a run switch DURING a gap could leak run A's
// pose into run B. This is the PLAYHEAD-INDEXED replacement: the held pose at frame k is simply "the subject's
// last present pose at frame ≤ k", read O(1) from the subject's OWN trail. buildTrail's hold-fill already
// propagates each present pose forward across absent ticks, so trail.positions[k] IS that last-present pose for
// every k ≥ trail.first — the amortized backward scan, precomputed at load. Before first appearance (k < first,
// or an empty trail) there is no present pose ≤ k: return false (has), so the caller SUPPRESSES the directed beat
// rather than substitute a centroid. Because it is a pure function of (trail, frame), reverse scrub, tour jumps
// and run switches are correct BY CONSTRUCTION — no cross-frame state to leak, each run derives from its own
// trail. Mutates `out` in place and returns has — zero allocation, frame-path safe (§8). `TrailView` is the
// structural slice trail.Trail satisfies (positions/first/count); taking it keeps camera.ts free of a trail.ts
// import (trail.ts already depends on camera.ts). RESIDUAL: this resolves the ANCHOR, not the live-follow pose —
// the caller keeps the loop's interpolated pose while the subject is present and only falls back to this held
// (tick-quantized) pose across a dropout, where it equals exactly what the trail/head render.
export interface SubjectHold { has: boolean; x: number; y: number; z: number }
export interface TrailView { positions: Float32Array; first: number; count: number }
// `frame` is a StateFrame (F1, uniform with entityStatesAt): the anchor is looked up at the evaluated frame t0
// the cursor resolved, a value already in the frame domain. Branding it blocks a raw event tick (a plain number)
// from being read as a trail index here — the same laundering the lerpHeadPosition/entityStatesAt brands close.
// The sole production caller passes the cursor's StateFrame t0, so this is a pure pass-through, no runtime change.
export function heldSubjectPose(out: SubjectHold, trail: TrailView, frame: StateFrame): boolean {
  if (trail.count === 0 || trail.first < 0 || frame < trail.first) { out.has = false; return false }
  const k = frame < trail.count ? frame : trail.count - 1 // defensive clamp; callers pass frame ≤ count − 1
  const base = k * 3
  out.has = true; out.x = trail.positions[base]!; out.y = trail.positions[base + 1]!; out.z = trail.positions[base + 2]!
  return true
}

// Axis-aligned bounding box of EVERY entity position across EVERY tick, reduced to a bounding sphere
// {center, radius}. Returns null when there is nothing to fit: no positioned entities (e0), or a single
// static point / zero extent (f0) — the caller then keeps the composed default. Allocation is bounded to
// the one returned object: the per-tick state maps are the model's own cached decode, and positions are
// read into a reused module scratch. Called ONCE at model publish (never on the frame path).
export function trajectoryBounds(source: BoundsSource): Bounds | null {
  const keys = source.entityKeys()
  if (keys.length === 0) return null
  let minx = Infinity, miny = Infinity, minz = Infinity
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
  let seen = false
  for (let t = 0; t <= source.tickCount; t++) {
    // Load-path walk (once at model publish); brand the integer counter at the frame-domain boundary (F2).
    const states = source.entityStatesAt(t as StateFrame)
    for (let i = 0; i < keys.length; i++) {
      const e = states.get(keys[i]!)
      if (!e) continue
      entityPosition(scratchPos, e, i)
      const [x, y, z] = scratchPos
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      if (z < minz) minz = z; if (z > maxz) maxz = z
      seen = true
    }
  }
  if (!seen) return null
  const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz
  const radius = 0.5 * Math.hypot(dx, dy, dz)
  if (radius < 1e-6) return null // degenerate: a single point is not a trajectory to fit
  // norm0 collapses a planar axis's -0 (entityPosition maps y=-D, so D=0 → -0) to +0: a signed-zero
  // coordinate is harmless in math but a footgun for equality-based consumers and reads oddly.
  const norm0 = (v: number): number => (v === 0 ? 0 : v)
  return { center: [norm0((minx + maxx) / 2), norm0((miny + maxy) / 2), norm0((minz + maxz) / 2)], radius }
}

// Derive the same bounding sphere DIRECTLY from a prebuilt trail's interleaved xyz Float32Array (Task
// v04-2 §2). buildTrail already walks every tick once at model publish to lay down its vertices, so the
// camera fit reuses that Float32Array instead of a SECOND independent tick-walk (trajectoryBounds) — the
// two walks each exceeded RunModel's 16-entry LRU decode cache on a 65-tick run, so the second forced a
// full re-decode + eviction. `count` is the vertex count (positions holds count*3 floats; every vertex is
// a real recorded/held position, so the min/max box equals trajectoryBounds' for the same subject).
// Returns null when there is nothing to frame — an empty trail (count 0: e0's no-entity, f0's static
// point) or a zero-extent box — so the caller keeps the composed default. Pure; unit-tested.
//
// PREFIX COUNT: `count` need not be the full vertex count. The trail-frame arrival ease (Scene, Task
// v04.1-2) passes count = arrivedTick + 1 to fit the trajectory-SO-FAR — the box of vertices 0..count-1,
// ignoring any later ones. Positions are per-tick, so a prefix is a plain count, never a subarray copy.
//
// SUBJECT SCOPE: the trail tracks the run's subject (first entity key today), so these bounds frame the
// SUBJECT'S path. That is identical to trajectoryBounds for the single-entity runs shipping today (f0/f1).
// trajectoryBounds (the all-entity computation) is retained + unit-tested for when multi-entity swarms
// land and the fit question (whole-swarm box vs. subject path) is re-decided.
export function boundsFromPositions(positions: Float32Array, count: number): Bounds | null {
  if (count < 1) return null
  let minx = Infinity, miny = Infinity, minz = Infinity
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!
    if (x < minx) minx = x; if (x > maxx) maxx = x
    if (y < miny) miny = y; if (y > maxy) maxy = y
    if (z < minz) minz = z; if (z > maxz) maxz = z
  }
  const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz
  const radius = 0.5 * Math.hypot(dx, dy, dz)
  if (radius < 1e-6) return null
  const norm0 = (v: number): number => (v === 0 ? 0 : v)
  return { center: [norm0((minx + maxx) / 2), norm0((miny + maxy) / 2), norm0((minz + maxz) / 2)], radius }
}

// Distance at which a bounding sphere of radius R just fits inside a camera with the given vertical fov,
// times a padding margin. Uses the VERTICAL fov (the tighter dimension on a wide viewport), so the fit
// is conservative — the sphere is guaranteed on-screen at any ≥1 aspect. margin adds breathing room.
export function fitDistance(radius: number, fovDeg: number, margin: number): number {
  return (radius / Math.sin((fovDeg * Math.PI) / 180 / 2)) * margin
}

// Aspect-aware fit distance (v0.7 T4 fixwave, W3). fitDistance above uses the VERTICAL fov only — conservative
// on a WIDE (aspect ≥ 1) viewport, but on a NARROW (< 1) canvas the HORIZONTAL fov is the tighter constraint, so
// a vertical-only fit lets the sphere's SIDES crop. At the supported ~0.78 flanked layout the f2a conjunction
// head marker's rightmost vertex projected to NDC x ≈ 1.21 (off-screen). This fits the sphere against the
// TIGHTER of the two half-FOVs. aspect = width/height:
//   • undefined / non-finite / ≥ 1 → the vertical fit EXACTLY (byte-identical to fitDistance — the wide-aspect
//     PROTECT, the leadForAspect calibration idiom: at/above the binding aspect the calibrated value stands);
//   • < 1 → max(vertical, horizontal) fit, pulling back far enough that the horizontal extent is in frame too.
// The horizontal half-fov is atan(tan(fov_v/2)·aspect) (the standard perspective relation), narrower than the
// vertical when aspect < 1. Pure; unit-tested. Reuses the app's own live-aspect idiom rather than inventing a
// parallel one (Scene reads state.camera.aspect for leadForAspect already).
export function fitDistanceForAspect(radius: number, fovDeg: number, margin: number, aspect?: number): number {
  const halfV = (fovDeg * Math.PI) / 180 / 2
  const distV = radius / Math.sin(halfV)
  if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return distV * margin
  const halfH = Math.atan(Math.tan(halfV) * aspect) // horizontal half-fov: narrower than vertical when aspect < 1
  const distH = radius / Math.sin(halfH)
  return Math.max(distV, distH) * margin
}

// `elevationDeg` (G6) is an OPTIONAL stage-local vantage elevation for the OVERSIZED-fit regime (the whole-path
// pull-back branch below — the ONLY branch a stage's hundreds-of-units bounds ever reach). When set, frameFor
// holds the composed AZIMUTH (the +E/+N ground heading of DEFAULT_POSITION) but pins the camera's angle above
// the deck to this value, instead of the house ~22.6° (asin(DEFAULT_POSITION.y/|DEFAULT_POSITION|)). Undefined ⇒
// the house direction EXACTLY — byte-identical for every existing caller (only the sensing stage threads it, via
// cameraRig.SENSING_STAGE_FRAME_OPTS, to separate its self-occluding ground-plane apparatus). See frameFor.
export interface FrameOpts { fov: number; margin: number; lift: number; maxDistanceFactor: number; elevationDeg?: number }
export interface Framing { position: [number, number, number]; target: [number, number, number] }

const defaultCopy = (): Framing => ({ position: [...DEFAULT_POSITION] as [number, number, number], target: [...DEFAULT_TARGET] as [number, number, number] })

// Resolve the initial camera framing for a freshly-published model. Three regimes:
//  • bounds null, OR the trajectory already fits what the default distance frames → the composed default
//    (f0/e0, and any small run). The subject sits where the resting composition intends it.
//  • a trajectory that exceeds the default framing but still fits within a sane pull-back cap → FIT it
//    fully: aim at the bounds centre (lifted) and pull back to fitDistance so the whole path is in frame.
//  • an OVERSIZED trajectory whose full fit would exceed the cap (f1's 250u corridor → ~330u pull-back)
//    → a full fit recedes into an empty void (browser-verified: the subject becomes sub-pixel, the very
//    "near-empty void" the critiques condemned). Cap the pull-back and KEEP the composed target: the
//    resting frame stays legible, and playback auto-follow (see followStep) tracks the subject along the
//    path — the whole journey is read through motion + the trajectory trail, not a lonely wide shot.
// `aspect` (v0.7 T4 fixwave, W3) is an OPTIONAL live width/height: when present it tightens the fit against the
// horizontal fov too (fitDistanceForAspect) so a narrow canvas does not crop the sphere's sides. undefined /
// non-finite / ≥ 1 → the vertical-only fit EXACTLY, so every existing caller (the establish / load / tour-start
// framings, all of which omit it) is byte-identical — only the authored conjunction shot threads it.
export function frameFor(bounds: Bounds | null, opts: FrameOpts, aspect?: number): Framing {
  const defaultDist = Math.hypot(DEFAULT_POSITION[0], DEFAULT_POSITION[1], DEFAULT_POSITION[2])
  if (bounds === null) return defaultCopy()
  const fit = fitDistanceForAspect(bounds.radius, opts.fov, opts.margin, aspect)
  // Already fits the composed default distance: reproduce the resting composition AROUND the trajectory's
  // own centre. The pivot aims at the centre (lifted); the camera sits at the centre PLUS the composed
  // offset (DEFAULT_POSITION - DEFAULT_TARGET) so it holds the composed viewing angle at the right
  // distance from the subject. The prior T2 rider re-aimed the pivot at bounds.center but LEFT the camera
  // parked at the world-origin DEFAULT_POSITION — so a compact run at e.g. [100,0,0] was framed from ~94u
  // away (a sub-pixel subject). Offsetting the camera off the centre closes that gap. (No shipping run
  // hits this branch today: f0 is a static point → null; f1's corridor is oversized → default fallback.)
  if (fit <= defaultDist) {
    const target: [number, number, number] = [bounds.center[0], bounds.center[1] + opts.lift, bounds.center[2]]
    const position: [number, number, number] = [
      bounds.center[0] + (DEFAULT_POSITION[0] - DEFAULT_TARGET[0]),
      bounds.center[1] + (DEFAULT_POSITION[1] - DEFAULT_TARGET[1]),
      bounds.center[2] + (DEFAULT_POSITION[2] - DEFAULT_TARGET[2]),
    ]
    return { position, target }
  }
  // Oversized: a trajectory whose full fit would exceed the cap (f1's 250u corridor → ~330u) recedes
  // into a void — the subject becomes sub-pixel, the "near-empty void" the critiques condemned. Fall
  // back to the composed default so the resting subject reads at its intended framing; playback
  // auto-follow (Scene.followPan) then dollies with the subject to convey the whole journey through
  // motion. The whole-path fit below is reserved for trajectories that fit WITHIN the cap.
  if (fit > defaultDist * opts.maxDistanceFactor) return defaultCopy()
  // Unit view direction from the default camera (origin → default position). opts.elevationDeg (G6), when set,
  // RAISES the vantage stage-locally: keep the composed AZIMUTH (the +E/+N ground heading, DEFAULT_POSITION's
  // x/z) but set the elevation above the deck — the direction stays a UNIT vector (cos²+sin²=1), so the fit
  // distance is unchanged and only the angle rises. Undefined ⇒ DEFAULT_POSITION normalized EXACTLY (the ~22.6°
  // house angle), byte-identical for every non-sensing caller. hmag is the ground-plane magnitude carrying the
  // azimuth; the >1e-9 guard keeps a straight-overhead DEFAULT_POSITION (hmag 0) from dividing by zero.
  let dnx = DEFAULT_POSITION[0] / defaultDist, dny = DEFAULT_POSITION[1] / defaultDist, dnz = DEFAULT_POSITION[2] / defaultDist
  if (opts.elevationDeg !== undefined) {
    const hmag = Math.hypot(DEFAULT_POSITION[0], DEFAULT_POSITION[2])
    if (hmag > 1e-9) {
      const el = (opts.elevationDeg * Math.PI) / 180, c = Math.cos(el)
      dnx = (DEFAULT_POSITION[0] / hmag) * c; dny = Math.sin(el); dnz = (DEFAULT_POSITION[2] / hmag) * c
    }
  }
  const target: [number, number, number] = [bounds.center[0], bounds.center[1] + opts.lift, bounds.center[2]]
  const position: [number, number, number] = [target[0] + dnx * fit, target[1] + dny * fit, target[2] + dnz * fit]
  return { position, target }
}

export interface FinaleOpts { lift: number; distance: number }

// Compose-around-head FINALE framing (v0.5b T3, ruling 2). At a NATURAL play-to-end rest the resting subject
// must be the SUBJECT of a directed close-up, not stranded in a fit-the-corridor void: TRAIL_FRAME_OPTS'
// Infinity cap would ease f1's 250u corridor to a ~340u wide shot (drone sub-pixel), and the capped fit falls
// back to the composed default around the trail CENTRE, stranding the head off-frame. So the finale frame is
// built from SCRATCH around the TRUE head (the terminal position — NOT the follow pivot, which trails it via
// the tracking lag + capped bias):
//   • target = head lifted by `lift` (the composed horizon-high aim, shared with frameFor / the resting frame)
//   • camera = head + the composed house-octant DIRECTION (unit DEFAULT_POSITION − DEFAULT_TARGET — the fixed
//     +E/+Up/+N viewing angle the whole stage uses) × `distance`.
// `distance` is calibrated ~2–2.5× the composed offset length (~11.4u) so the resting drone reads as the
// subject while the hold-lit corridor recedes into the 30→400 fog for depth (Scene.FINALE_DISTANCE). The
// offset length is a CONSTANT (no division by a variable), so a finite head yields a finite, non-degenerate
// framing for ANY subject (including f0's static point) — the DEGENERACY GUARD below makes that claim TRUE
// even at an astronomical-yet-finite head. A NaN/Infinity head yields a non-finite framing that the Scene
// consume rejects via isFiniteFraming — exactly like every other framing write. Pure; unit-tested.
export function finaleFraming(head: readonly [number, number, number], opts: FinaleOpts): Framing {
  const ox = DEFAULT_POSITION[0] - DEFAULT_TARGET[0], oy = DEFAULT_POSITION[1] - DEFAULT_TARGET[1], oz = DEFAULT_POSITION[2] - DEFAULT_TARGET[2]
  const len = Math.hypot(ox, oy, oz)
  const dnx = ox / len, dny = oy / len, dnz = oz / len
  const target: [number, number, number] = [head[0], head[1] + opts.lift, head[2]]
  const position: [number, number, number] = [head[0] + dnx * opts.distance, head[1] + dny * opts.distance, head[2] + dnz * opts.distance]
  // DEGENERACY GUARD. The decoder accepts arbitrary f64, so a crafted bundle can carry an
  // astronomical-yet-FINITE head (e.g. [1e300,-1e300,1e300]): head + offset === head in f64 (the ~distance
  // offset is far below the ulp), so position === target — a FINITE framing that isFiniteFraming waves
  // through, but whose zero |position − target| hands OrbitControls/lookAt a zero look direction → NaN. When
  // the composition collapses, return frameFor(null)'s composed default (defaultCopy) so the "finite,
  // non-degenerate for ANY finite head" claim above holds. `=== 0` (not `!(> 0)`) is deliberate: a NaN/Infinity
  // head makes the separation NaN, which is NOT caught here, so it still flows through as the non-finite
  // framing the Scene consume rejects via isFiniteFraming — current behavior, preserved.
  const sx = position[0] - target[0], sy = position[1] - target[1], sz = position[2] - target[2]
  if (sx * sx + sy * sy + sz * sz === 0) return defaultCopy()
  return { position, target }
}

// FINITE-FRAMING GUARD. The decoder accepts arbitrary f64 positions, so a CRC-valid CRAFTED bundle can
// carry Infinity/NaN coordinates → non-finite bounds → frameFor returns a non-finite camera/target. Left
// unguarded that poisons the trail-frame ease TWICE: every frame writes NaN into the rig, AND the
// convergence test can never clear (NaN < threshold === false), so the ease is stuck active forever and
// the follow it gates stays off. True iff all six framing components are finite; the Scene consume skips
// activation when this is false, leaving the camera and coast state untouched. Pure; unit-tested.
export function isFiniteFraming(f: Framing): boolean {
  const p = f.position, t = f.target
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]) &&
    Number.isFinite(t[0]) && Number.isFinite(t[1]) && Number.isFinite(t[2])
}

// ── Authored tour-camera shot resolution (v0.7 T4) ───────────────────────────────────────────────────────
// Compose distance for a 'head' MEDIUM arrive: ~2× the terminal finale close-up distance (Scene.FINALE_DISTANCE
// = 25), so a mid-journey compose-around-head sits back enough that the following play step still has air
// (design consult: "do not go tighter than ~45u — the 8× sprint needs air"). A shared constant so the two
// medium beats (f1 b1 / f2a b4) frame at the same scale.
export const HEAD_MEDIUM_DISTANCE = 50

// Live scene anchors an authored shot resolves against (the DATA half — the descriptor is the GRAMMAR half).
// All three-space. Any may be null: `head` when the subject is absent this tick; `sensor`/`occluder` on a
// non-sensing run (only the sensing lens has them); `stageBounds` when there is no whole-instrument fit.
//   VISUAL EXTENTS (v0.7 T4 fixwave, W3): `headRadius`/`sensorRadius` are the on-screen radii of the drone
// marker (SensingStage HEAD_R) and the sensor apparatus (its octahedron) — the conjunction shot bounds their
// VISUAL size, not just their centre points, so a marker vertex can't crop off-frame. Optional: absent / 0 ⇒
// the pre-fix centre-only box (byte-identical), which is exactly what the non-sensing / non-conjunction paths
// (where no marker is drawn) want. The occluder already carries its own radius (a sphere, bounded the same way).
export interface ShotAnchors {
  head: readonly [number, number, number] | null
  headRadius?: number
  sensor: readonly [number, number, number] | null
  sensorRadius?: number
  occluder: { center: readonly [number, number, number]; radius: number } | null
  stageBounds: Bounds | null
}
// The framing knobs an authored shot composes with, threaded from the caller (they live in cameraRig/Scene; a
// param keeps camera.ts dependency-free and unit-testable). `fit` is the uncapped fit opts shared by 'conjunction'
// and 'stage' (TRAIL_FRAME_OPTS ≡ STAGE_FRAME_OPTS — both {fov, margin, lift, maxDistanceFactor: Infinity}).
export interface ShotOpts {
  fit: FrameOpts
  lift: number        // TARGET_LIFT — the compose-around-head aim lift
  headMedium: number  // HEAD_MEDIUM_DISTANCE — the 'head' 'medium' compose distance
  headClose: number   // FINALE_DISTANCE — the 'head' 'close' (terminal finale) compose distance
  // OPTIONAL stage-fit opts for the 'stage' shot ONLY (G6). The 'stage' bookend must land byte-identically on the
  // load/rest vantage, so on a sensing run it carries the RAISED elevation (SENSING_STAGE_FRAME_OPTS) exactly as the
  // load write does; the 'conjunction' shot (an independently-composed authored beat) keeps `fit`, untouched. Absent
  // ⇒ the 'stage' case falls back to `fit`, byte-identical to the pre-G6 behavior (and to every non-sensing 'stage').
  stage?: FrameOpts
}

// Append a point's axis-aligned ±radius extent (its six octahedral extremes) to `out`, so a marker's VISUAL
// size — not just its centre — enters the conjunction box→sphere fit (W3). radius 0 collapses to six copies of
// the centre → the pre-fix centre-only box, byte-identical (boundsFromPositions reduces min/max, so duplicates
// are inert). A sphere of radius r is the inscribed sphere of this ±r box, so bounding the box bounds the marker.
function pushExtent(out: number[], c: readonly [number, number, number], r: number): void {
  out.push(
    c[0] + r, c[1], c[2], c[0] - r, c[1], c[2],
    c[0], c[1] + r, c[2], c[0], c[1] - r, c[2],
    c[0], c[1], c[2] + r, c[0], c[1], c[2] - r,
  )
}

// Resolve an authored TourShot to a Framing from LIVE scene anchors (v0.7 T4). PURE — the descriptor carries
// grammar (which shot), the anchors carry the run's live geometry (where), so the SAME grammar frames any run
// and no world coordinate is ever hand-authored (it cannot rot on a re-decode). Returns null when the shot's
// inputs are unavailable — a 'conjunction'/anchored shot with no head, a 'conjunction' on a non-sensing run (no
// sensor), a 'stage' with no stageBounds — and the Scene consume then falls through to the trajectory-so-far
// default (the design-lead degradation rule). The finite guard stays at the consume (isFiniteFraming before the
// scratch copy), exactly like every other framing write. Reuses the proven helpers: finaleFraming (compose-
// around-head), frameFor (octant fit), boundsFromPositions (one-pass box→sphere) — no new composition math.
//   `aspect` (v0.7 T4 fixwave, W3) is the live canvas width/height, threaded ONLY into the CONJUNCTION fit so a
// narrow (< 1) canvas pulls back far enough that the relationship shot's markers stay in frame horizontally. It
// is DELIBERATELY not applied to 'stage': the bookend must land byte-identically on the load vantage (loadFraming
// is vertical-only), so an aspect-aware stage fit would break the rest-state parity the f2a bookend asserts.
export function shotFraming(shot: TourShot, a: ShotAnchors, o: ShotOpts, aspect?: number): Framing | null {
  switch (shot.kind) {
    case 'head': {
      if (a.head === null) return null
      const distance = shot.distance === 'medium' ? o.headMedium : o.headClose
      return finaleFraming(a.head, { lift: o.lift, distance })
    }
    case 'stage':
      // The stage bookend frames the whole instrument on the SAME opts the load/rest write uses (o.stage — the raised
      // sensing vantage on f2a, else o.fit), so free-exploration rest and the tour bookend stay pixel-parity by construction.
      return a.stageBounds === null ? null : frameFor(a.stageBounds, o.stage ?? o.fit)
    case 'conjunction': {
      // The sensing-lens relationship shot: fit the sensor + the subject's live head [+ the occluder sphere's
      // extent when the eclipse variant asks], each bounded by its VISUAL extent (W3 — the marker radii), then
      // frame it on the house octant with the aspect-aware fit. Needs BOTH the head and the sensor — a non-
      // sensing run has no sensor, so it falls through (null). boundsFromPositions is the shared box→sphere fit.
      if (a.head === null || a.sensor === null) return null
      const pts: number[] = []
      pushExtent(pts, a.sensor, a.sensorRadius ?? 0) // the sensor apparatus's visual extent (its octahedron)
      pushExtent(pts, a.head, a.headRadius ?? 0)     // the drone marker's visual extent (SensingStage cone)
      if (shot.occluder && a.occluder !== null) pushExtent(pts, a.occluder.center, a.occluder.radius)
      const bounds = boundsFromPositions(new Float32Array(pts), pts.length / 3)
      return bounds === null ? null : frameFor(bounds, o.fit, aspect)
    }
  }
}

export interface Vec3Mut { x: number; y: number; z: number }

// In-place, zero-allocation DOLLY of an orbit rig toward a subject point: it eases the pivot (target) a
// fraction of the way toward the subject AND translates the camera by the SAME delta, so the pivot→camera
// offset is preserved. That distinction is load-bearing — moving the target alone just re-aims the camera
// (OrbitControls keeps the camera put), so a subject that travels far recedes to a sub-pixel speck even
// though it stays centred; panning both keeps the subject a CONSTANT apparent size as the camera flies
// alongside it. Because the offset is unchanged, OrbitControls.update() re-applies its damping to the
// same orbit and never fights the follow. factor 1 snaps (reduced-motion cut); a small factor drifts.
export function followPan(target: Vec3Mut, camera: Vec3Mut, sx: number, sy: number, sz: number, factor: number): void {
  const ox = (sx - target.x) * factor, oy = (sy - target.y) * factor, oz = (sz - target.z) * factor
  target.x += ox; target.y += oy; target.z += oz
  camera.x += ox; camera.y += oy; camera.z += oz
}

// Revealed-trail midpoint VERTEX index for the follow-aim bias (ruling 7, T2). The playback follow aimed
// dead at the live head, so the one-sided trail — which lies entirely BEHIND the head — projected off to
// one side of frame (dossier Q6). The fix biases the pivot off the head toward the midpoint of the path
// REVEALED so far: the revealed head vertex is min(tick, count-1), and its midpoint vertex is floor(head/2).
// Multiply the returned index by 3 for the interleaved-xyz component offset at the call site. Pure (no
// buffer read) so the off-by-one / clamp is unit-tested without a Float32Array; the caller guards count > 0.
// Clamps a (defensive) negative tick to 0 — the store tick is always >= 0, but this keeps the index in range.
export function revealedMidpointIndex(tick: number, count: number): number {
  const head = Math.max(0, Math.min(tick, count - 1))
  return Math.floor(head / 2)
}

// Absolute world-space CAP on the follow-aim bias displacement (T2 fixwave, ruling 7). Companion to
// revealedMidpointIndex: that picks the midpoint vertex the pivot leans toward; this bounds HOW FAR it may
// lean. The bias is a SCREEN-relative composition goal — "head ~1/3 in from the leading edge" — but the Scene
// call site applies it as an UNBOUNDED world displacement d = (mid − head)·bias that GROWS with the revealed
// corridor: at f1 tick 63 |d| ≈ 20.9u (~2.2× the horizontal half-frame at the composed ~11.4u follow
// distance), and a campaign-scale 1000u+ corridor would shove the head clean out of frame. Given the
// displacement components (dx,dy,dz) this returns the factor that clamps |d| to `max` world units:
//   • |d| ≤ max → 1 EXACTLY: the displacement is applied verbatim (dx·1 === dx), so the early-run composition
//     is bit-identical to the uncapped lerp, and a zero-magnitude d divides nothing (the guard);
//   • |d| > max → max/|d|: the scaled displacement has magnitude EXACTLY max.
// One sqrt, number locals only — zero allocation on the frame path. The boundary is INCLUSIVE (|d| == max is
// applied verbatim, no divide). Pure; unit-tested.
export function followBiasCapScale(dx: number, dy: number, dz: number, max: number): number {
  const mag2 = dx * dx + dy * dy + dz * dz
  return mag2 > max * max ? max / Math.sqrt(mag2) : 1
}

// Predictive follow-lead displacement (v0.5c ruling 4). The exponential playback follow (followPan at the
// FOLLOW_EASE_RATE time-constant) is a first-order smoother, so while it tracks an ACCELERATING head it
// settles into a steady-state lag of ≈ v/rate behind the aim (the standard ramp-input lag of a low-pass):
// the pivot — and, since followPan dollies the whole rig, the camera — trail the head, and the head rides
// toward the leading frame edge (critic n4: head at ~89-93% frame width, the label clipping). Cancel most
// of that lag by LEADING the follow aim forward along the head's instantaneous velocity by lead·(v/rate):
// then the pivot's steady state sits at head − (1−lead)·(v/rate), i.e. head-ward by the `lead` fraction.
//   (dx,dy,dz) is the per-FRAME head delta and dt the frame seconds, so v = delta/dt and the lead vector is
// delta·lead/(dt·rate) — one reciprocal, number locals only, written into the caller's `out` scratch (zero
// allocation on the frame path). `lead` ∈ [0,1] is the fraction of the lag cancelled (calibrated on
// screenshots). The magnitude is clamped to `maxLead` world units (via followBiasCapScale) as an always-on
// backstop: a smooth-but-fast segment can't fling the aim, and — with the caller's own first-frame/teleport
// guard — a scrub that teleports the head between frames can't launch it either (the cap bounds any residual
// spike the guard's threshold lets through). dt<=0 or rate<=0 → zero lead (no divide). Pure; unit-tested.
export function followLead(
  out: [number, number, number],
  dx: number, dy: number, dz: number,
  dt: number, rate: number, lead: number, maxLead: number,
): void {
  // FINITE GUARD (finaleFraming precedent, v0.5c endgame). The exported pure surface must never propagate
  // NaN/Infinity into the follow aim, even though the production caller provably cannot feed one: its per-frame
  // Δ is a subtraction of two finite head samples, and the caller's teleport guard (ddx²+ddy²+ddz² <= MAX²) is
  // FALSE on a non-finite Δ, so followLead is never reached with one. A crafted/degenerate input (non-finite
  // Δhead, dt, or rate) returns the zero-lead result — identical shape to the dt<=0 / rate<=0 / lead-0 zero
  // returns below — so a poisoned lead can never reach the rig. Guards the five numeric inputs the math consumes
  // (lead/maxLead are calibration constants). Finite inputs skip this branch, so their behaviour is byte-identical.
  if (
    !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) ||
    !Number.isFinite(dt) || !Number.isFinite(rate)
  ) { out[0] = 0; out[1] = 0; out[2] = 0; return }
  if (dt <= 0 || rate <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return }
  const k = lead / (dt * rate)
  const lx = dx * k, ly = dy * k, lz = dz * k
  const s = followBiasCapScale(lx, ly, lz, maxLead)
  out[0] = lx * s; out[1] = ly * s; out[2] = lz * s
}

// Unselected mid-run tracking-ring gate (v0.5c ruling 5, EXTENDED by v0.5d ruling 3). During unselected play
// of a positioned, fittable run the establishing shot pulls the camera back to frame the whole trajectory, at
// which distance the subject is sub-pixel — the comet tip is the only visible proxy. Show the existing
// ground-ring at the live head as an honest tracking marker (entity position is data, not decoration).
//
//   v0.5d ruling 3 — PAUSE PERSISTENCE. pause-then-click is the sanctioned mid-run selection path, but the
// v0.5c gate hid the ring on pause (playing false), so the subject was clickable yet UNDISCOVERABLE. The gate
// now shows the marker wherever an unselected subject is MID-RUN — playing OR paused: `(playing || pausedMidRun)`.
// The caller computes `pausedMidRun = !playing && 0 < tick < tickCount` (a paused playhead strictly between the
// cold open and the natural end). Cold rest (tick 0 — never-played or scrubbed-to-0) and the natural-end rest
// stay quiet: cold has `pausedMidRun` false (tick 0) AND playing false, and the natural end is owned by the
// finale arm (finale true → this gate false; and at tick === tickCount `pausedMidRun` is false anyway).
//
// This is the MID-RUN arm of the ring gate; the full priority — selection > finale > mid-run-tracking — is
// enforced by the else-if ORDER at the Scene call site (this predicate is the third branch's run-level
// condition). `hasSelection` and `finale` are excluded here too so the predicate reads as a COMPLETE gate
// independent of that order: the selection ring and the finale head ring each own their state, and this arm
// yields to both. boundsNonNull scopes it to runs the establishing shot actually widens (f1); f0 (null bounds)
// keeps the composed default where the lone subject is already legible — no ring. Pure; unit-tested
// EXHAUSTIVELY across the 2^5 input matrix (the per-instance head selector i===0, the pausedMidRun derivation,
// and the ring placement stay at the browser-verified call site).
export function shouldTrackWithRing(
  playing: boolean, pausedMidRun: boolean, hasSelection: boolean, finale: boolean, boundsNonNull: boolean,
): boolean {
  return (playing || pausedMidRun) && !hasSelection && !finale && boundsNonNull
}

// Distance-proportional tracking-ring SCALE (v0.5d ruling 2). The v0.5c tracking marker was a FIXED world
// scale (RING_TRACK_MIN_SCALE=8): legible where it was calibrated, but the establishing camera is fixed while
// the head travels the corridor, so the camera→head distance varies wildly during unselected play — and in
// the late climb (f1 ticks ~38-46) the head is farthest from the camera, where a fixed world scale is most
// sub-pixel and the marker DIED. A ground-ring's apparent (screen) size ∝ worldSize / distance, so to hold a
// CONSTANT screen size the world scale must grow WITH the distance: scale = k · dist. That is the whole fix —
// a screen-space-constant marker that never collapses as the head recedes.
//   CLAMPS (both derived, both browser-calibrated at the Scene call site — see RING_TRACK_* there):
//   • FLOOR (minScale) = the v0.5c "8-at-its-calibration-distance" equivalence: k = minScale / calibDist, so at
//     the calibration distance scale === minScale EXACTLY and at any NEARER distance the floor holds it there —
//     the near/reference look is byte-identical to v0.5c (scale 8), and the distance term only GROWS the ring
//     past the calibration distance, exactly where it was dying. The floor also keeps it from collapsing to a
//     dot when the head passes close to the camera.
//   • CEILING (maxScale) keeps it a MARKER, not a TARGET: an arbitrarily far head (a future campaign-scale
//     corridor) would otherwise grow the ring without bound until it reads as a giant target reticle; the
//     ceiling caps the world scale so it stays a modest fraction of the framed corridor.
// Non-finite / non-positive distance → minScale (the safe wide default — same shape as leadForAspect's guard).
// Pure; number locals only (the Scene caller feeds it a per-frame camera→head distance, zero-alloc). Unit-tested.
export function ringTrackScale(dist: number, k: number, minScale: number, maxScale: number): number {
  if (!Number.isFinite(dist) || dist <= 0) return minScale
  return Math.min(maxScale, Math.max(minScale, k * dist))
}

// Aspect-compensated effective follow-lead (v0.5d ruling 1; re-measured v0.5d T3 — Scene.tsx CALIB_ASPECT is the
// single source). FOLLOW_LEAD (v0.5c) was calibrated at ONE canvas aspect — CALIB_ASPECT, the selected-play CANVAS
// measured at the 1440×810 window (with a selection the Inspector + Provenance panels flank the 3D canvas; since
// bench R1 the reserved 280px|minmax|320px grid makes that canvas 840×687, so the canvas aspect ≈1.223 is well below
// the 16:9 window). The follow aim offset is in WORLD units, but the head's on-screen excursion from centre is a
// FRACTION of the horizontal half-frame, and that half-frame ≈ dist·tan(fov_v/2)·aspect is PROPORTIONAL to the canvas
// aspect. So on a NARROWER canvas the same world offset is a BIGGER screen fraction and the head rides toward the
// clipping edge (T3 six-window re-sweep: 1280×720 → 0.749 and the full-width-drawer layout → 0.711 hold the ≤0.75
// ceiling, and the flanked-narrow band now peaks 0.739–0.743 — every window's peak in the 0.711–0.749 range, all
// ≤0.75). The head's total rightward excursion is TWO world offsets: the follow's residual lag (1−lead)·(v/rate) AND
// the v0.5b follow-bias pull (PROTECT'd — untouchable). BOTH grow as a screen fraction when the aspect shrinks.
//
//   DERIVATION. The exponential follow settles to a steady-state pivot at head − (1−lead)·(v/rate) (see followLead),
// so the head's screen excursion ≈ [ (1−lead)·(v/rate) + bias ] / (2·dist·tan(fov_v/2)·aspect). To HOLD that fraction
// at the calibrated value across aspects, the WORLD numerator must scale WITH the aspect — shrink on a narrower
// canvas. The bias is fixed (PROTECT'd), so the ONLY lever is the lead: it must shed BOTH its own residual-lag
// fraction growth AND the bias's. Writing the numerator target as excursion·(aspect/CALIB_ASPECT) and solving for
// lead gives a form linear in the aspect DEFICIT (1 − min(1, aspect/CALIB_ASPECT)):
//     leadEff = baseLead + gain·(1 − min(1, aspect/CALIB_ASPECT))
// where gain = (1−baseLead) + β and β = bias/(v/rate) is the bias-to-residual-lag ratio at the peak. gain = (1−baseLead)
// cancels ONLY the residual-lag growth (leadEff → 1, capped); the +β term is the EXTRA lead needed to also offset the
// (larger) bias growth — so gain is CALIBRATED on the aspect sweep (like FOLLOW_LEAD itself), not computed from a
// noisy β. The min(1,…) clamp is the wide-aspect PROTECT: AT OR ABOVE the calibration aspect the deficit is 0 and
// leadEff === baseLead EXACTLY (the v0.5c calibration is byte-preserved). BELOW it leadEff RISES (MORE lead → the head
// pulls back toward centre) — the OPPOSITE of the ruling's illustrative `baseLead·min(1, aspect/calibAspect)`, which
// would REDUCE the lead on a narrow canvas (the empirical sweep is monotone: lead 0 → peak 1.27 off-screen, 0.8 →
// 0.737, so a too-high narrow-canvas excursion needs MORE lead, not less). With gain > (1−baseLead) leadEff can exceed
// 1 on a narrow canvas — a deliberate OVER-lead that seats the aim ahead of the residual-lag position to counter the
// bias; the follow-bias still pulls the head rightward, so the head stays on-screen (verified: min xFrac ≈ 0.5). It
// is bounded in practice: the flanked-narrow layout floors at the ≈0.78 drawer-breakpoint canvas (T3 reserved-
// inspector band; below it the canvas goes full-width → deficit 0 → baseLead), and followLead's FOLLOW_LEAD_MAX world
// cap backstops any residual spike. Non-
// finite / non-positive aspect|calib → baseLead (no compensation). Pure; unit-tested. Live canvas aspect is a per-
// frame number read in Scene (zero-alloc).
export function leadForAspect(baseLead: number, aspect: number, calibAspect: number, gain: number): number {
  if (!Number.isFinite(aspect) || !Number.isFinite(calibAspect) || aspect <= 0 || calibAspect <= 0) return baseLead
  return baseLead + gain * (1 - Math.min(1, aspect / calibAspect))
}
