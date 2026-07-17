import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Perf } from 'r3f-perf'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RunModel } from '../model/runModel'
import { syncUrl, useViewStore } from '../state/viewStore'
import { focusLerpFactor, followLerpFactor, refitLerpFactor, prefersReducedMotion, FOLLOW_EASE_RATE } from './motion'
import { entityPosition, lerp3, nedToThree } from './placement'
import {
  boundsFromPositions, frameFor, finaleFraming, followPan, isFiniteFraming, revealedMidpointIndex, followBiasCapScale,
  followLead, leadForAspect, shouldTrackWithRing, ringTrackScale, shotFraming, cameraAnchor, heldSubjectPose,
  HEAD_MEDIUM_DISTANCE, DEFAULT_POSITION, DEFAULT_FOV, type Bounds, type Framing, type FrameOpts, type SubjectHold,
} from './camera'
import { PALETTE, hexToThree, BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { identityPlate, compactPlate } from './identityPlate'
import { isTourActive } from '../tour/interrupt'
import { RadialGrid } from './RadialGrid'
import { buildTrail, type Trail } from './trail'
import {
  focusRequest, trailFrameRequest, trailHold, orbitDragging, tourStartFrameRequest,
  requestEstablishFrame, requestRefitFrame, requestFinaleFrame, cancelEstablishFrame, shouldRefitOnFinaleClear,
  shouldEstablishOnMount, shouldArmFollowOnPlay,
} from './frameChannels'
import { CameraRig, loadFraming, STAGE_FRAME_OPTS, SENSING_STAGE_FRAME_OPTS, TARGET_LIFT, FIT_MARGIN } from './cameraRig'
import { ChainLinks } from './chainLinks'
import { QueryStage } from './queryStageView'
import { buildQueryDraws, queryBounds, queryStageApplies } from './queryStage'
import { povFraming, blockedCorridorBounds, observerCraneFraming } from './queryScene'
import { TrajectoryTrail } from './trajectoryTrail'
import { SensingStage, HEAD_R as HEAD_MARKER_R, SENSOR_MARKER_R, lerpHeadPosition } from './sensingStageView'
import { buildSensingStage, sensingStageApplies, sensingSubjectRef, TARGET_FRAME_OFFSET } from './sensingStage'
import { resolveCursorInto, eventTickOf, type FrameCursor } from './cursor'
import { R_MAX, SENSOR_O, OCCLUDER_C, OCCLUDER_R2 } from './sensingScenario'
import type { StateFrame, TransportTick } from '../lib/brand'

// Follow-aim trail bias (a design ruling). The playback follow aimed dead at the live head, so the one-sided
// trail — which lies entirely BEHIND the head — projected off to one side of frame. Bias the
// follow aim off the head toward the midpoint of the REVEALED path by this fraction (aim = lerp(head, mid,
// bias)): the head then sits ~1/3 in from the leading edge and the traveled path balances the frame.
// CALIBRATED on screenshot evidence: the plan floated ≈0.3, but because followPan preserves
// the camera→pivot offset, a bias applied to the ABSOLUTE midpoint of f1's ~250u corridor moves the pivot
// ~0.3·136u ≈ 40u off the head, so the subject RECEDES to a sub-pixel speck in the far corner — the opposite
// of "head prominent, ~1/3 from the leading edge". 0.2 mildly recedes; 0.15 keeps the subject prominent with
// the head ~1/3 from the leading edge and the trail sweeping across to balance. Applies to the FOLLOW aim
// ONLY — focus / trail-frame / establishing aims are untouched. Zero per-frame allocation: a direct
// trail-buffer read + a number-local lerp (house style).
const FOLLOW_TRAIL_BIAS = 0.15
// Absolute cap on the follow-bias aim DISPLACEMENT (a design-ruling fixwave). FOLLOW_TRAIL_BIAS above encodes a
// SCREEN-relative composition goal — "head ~1/3 in from the leading edge" — but it is applied as an UNBOUNDED
// WORLD displacement 0.15·|head−mid| that grows with the revealed corridor: at f1 tick 63 the pull is ~20.9u,
// and a future campaign-scale 1000u+ corridor would push the head fully out of frame. Cap the displacement
// magnitude (via camera.followBiasCapScale) at an absolute world bound so the composition stays screen-honest
// at ANY corridor scale.
//   DERIVATION: the composed follow distance is ~11.4u = |DEFAULT_POSITION − DEFAULT_TARGET|; at fov 50°
// (vertical) on a 16:9 viewport the horizontal half-frame at that distance is 11.4·tan(25°)·(16/9) ≈ 9.4u.
// FOLLOW_BIAS_MAX = 4.5u ≈ 0.4–0.5 of that half-width, which seats the revealed head ~1/4–1/3 in from the
// leading edge — exactly the composition the bias is FOR. The UNCAPPED pull blows past this: ~20.9u at f1
// tick 63 is ~2.2× the half-frame (head well off-screen), and a 1000u+ corridor drives it arbitrarily far.
// Below the cap the displacement is applied verbatim (bit-identical to the uncapped lerp — early run
// untouched). Exported for tests (camera.test.ts pins followBiasCapScale against the real cap value).
export const FOLLOW_BIAS_MAX = 4.5
// Predictive follow-lead fraction (a design ruling). The exponential follow lags an accelerating head by
// ≈v/rate (an observed note: head at ~89-93% frame width at 0.9-1.8s, the SDF label clipping the right edge).
// followLead aims the follow forward along the head velocity by FOLLOW_LEAD·(v/rate), cancelling that
// fraction of the steady-state lag. CALIBRATED on projected-head evidence (f1 1×
// selected play, frame-width fraction xFrac = ndc.x·0.5+0.5): at 0 the head rides OFF-screen (peak xFrac
// 1.27, only 17/91 samples on-screen — the v0.5b behaviour, worse than the observed 0.89-0.93 at this
// speed); 0.6 → peak 0.79; 0.7 → 0.76; 0.8 → peak 0.737 across the WHOLE run (target ≤0.75, the SDF label
// never clipping) with the head never crossing left of centre (min xFrac ~0.5, so the trail stays balanced
// behind it). 0.8 is the top of the design ruling's α≈0.5-0.8 band and the value that puts the whole-run peak under
// target. The v0.5b follow bias + cap are UNCHANGED — the lead is an ADDITIONAL aim offset composing with them.
const FOLLOW_LEAD = 0.8
// Calibration CANVAS aspect for the follow lead (a design ruling; RE-MEASURED for the reserved-inspector
// layout). FOLLOW_LEAD=0.8 was measured on the 1440×810 selected-play scene — and the Inspector + Provenance
// columns FLANK the 3D canvas (app.css grid `inspector(280px) | viewport | panel(320px)` above the 1080px
// drawer breakpoint; since the inspector track is now RESERVED, so the flanking is selection-INVARIANT).
// `state.camera.aspect` (what leadForAspect reads live) is that CANVAS aspect, so CALIB_ASPECT must be the
// canvas aspect at the calibration condition — NOT the 16:9 window — else leadForAspect would compensate at
// the very aspect it was calibrated on and shift the v0.5c lead. MEASURED at 1440×810 ?run=f1&sel=1:0
// (sceneBox, a later re-sweep): canvas 840×687 → 1.223 (was 905×687 → 1.318 under the earlier auto-width
// inspector; the fixed 280px track is what moved it). leadForAspect returns FOLLOW_LEAD EXACTLY at or above
// this aspect (the full-width drawer layout, canvas ~1.47, is wider → unchanged, the wide-aspect PROTECT)
// and MORE lead only on narrower canvases (the flanked-narrow band, canvas ~0.75–0.9 after that change).
const CALIB_ASPECT = 1.223
// Aspect-lead COMPENSATION GAIN (a design ruling; values RE-MEASURED for the reserved-inspector layout).
// leadForAspect raises the effective lead by gain·(aspect deficit) below CALIB_ASPECT. gain = (1−FOLLOW_LEAD)
// = 0.2 would cancel ONLY the residual-lag fraction growth — but the (PROTECT'd, untouchable) v0.5b follow
// bias is the LARGER contributor and its fraction ALSO grows on a narrow canvas, so a residual-lag-only gain
// left the earlier flanked band at ~0.79–0.80 (measured), over the 0.75 ceiling. gain is CALIBRATED on the sweep
// to also offset the bias growth; 0.8 survived the re-calibration unchanged. The six-window re-sweep
// (reserved 280px inspector): the WHOLE flanked-narrow band (windows 1081–1160, canvas
// ~0.78–0.92 aspect after that change) peaks 0.739–0.743, calib (840×687 → 1.223) peaks 0.749, 1280×720 (canvas 1.123)
// 0.749, the full-width drawer (canvas 1.438) 0.711 — every window ≤ the 0.75 ceiling, zero off-screen
// samples. BYTE-UNCHANGED (deficit 0) at calib and at the drawer (WIDER than calib → clamped). 1280×720 is
// COMPENSATED, not byte-unchanged: canvas aspect 1.123 < CALIB_ASPECT, deficit ≈0.082 lifts its lead — and it
// lands at 0.749, under the ceiling. The head stays essentially centred-or-right throughout (min xFrac
// 0.476–0.500), never off-screen. It over-leads (leadEff > 1) on the narrowest band — the lead seats ahead of
// the residual-lag position to counter the bias; the bias still pulls the head rightward, so the head never
// strands left. Paired with the leadEff-proportional lead cap below so the over-lead is not clipped.
const LEAD_ASPECT_GAIN = 0.8
// Absolute cap on the lead displacement (a design ruling). The lead needs its OWN cap distinct from the
// first-frame/teleport guard below: that guard zeroes the lead on a DISCONTINUOUS frame (first sample, or a
// scrub that jumps the head), but a smooth-yet-fast segment produces a large continuous velocity the guard
// lets through — so the cap is the always-on backstop that bounds |lead| in world units.
//   DERIVATION: the composed follow distance is ~11.4u (|DEFAULT_POSITION − DEFAULT_TARGET|); at fov 50°
// on 16:9 the horizontal half-frame there is ~9.4u (the FOLLOW_BIAS_MAX derivation). A lead beyond ~one
// half-frame would over-shoot the head past centre, so 10u (~1.06 half-frames) is generous headroom. VERIFIED
// non-binding during normal play: re-running the f1 1× calibration with the cap raised to 1000 gives an
// IDENTICAL peak xFrac (0.737) — the calibrated lead's magnitude stays under 10u the whole run, so the cap
// clips nothing here (it is purely a backstop). Below it the lead is applied verbatim (followBiasCapScale
// returns exactly 1 → the early run is untouched); a scrub-teleport spike that slips the guard's threshold is
// clamped here to ≤10u — a bounded nudge the gentle follow ease (~5%/frame at 60fps) barely registers, never a launch.
const FOLLOW_LEAD_MAX = 10
// Per-frame head displacement (world units) beyond which the head is treated as TELEPORTED, not travelling
// (a design ruling): a scrub jumps the playhead, so the head can leap the whole corridor between two frames
// (f1: ~250u). Normal selected play advances the head at most ~7-8u/frame (8×, the fastest ladder), so 40u
// (~5× the peak, far below a scrub) cleanly separates a real velocity from a teleport — on a teleport the
// lead is SKIPPED that frame (no direction error, no launch) and the sample re-seeds clean for the next.
const LEAD_TELEPORT_MAX = 40

const scratchMat = new THREE.Matrix4()
const scratchA: [number, number, number] = [0, 0, 0]
const scratchB: [number, number, number] = [0, 0, 0]
const scratchP: [number, number, number] = [0, 0, 0]
// The Entities frame-loop cursor: reused every frame (the load budget — no allocation on the useFrame path). resolveCursorInto
// writes (t0, t1) here; the loop reads them and never mints a fresh object.
const entitiesCursor: FrameCursor = { t0: 0 as StateFrame, t1: 0 as StateFrame }
const EMPTY_SEQS: readonly number[] = []
// Predictive-lead velocity scratch (a design ruling): the previous follow frame's head sample + a validity
// flag, so the follow block can estimate the head velocity (Δhead/dt) with ZERO per-frame allocation.
// `has` is false on the first follow frame, is re-seeded false on every run switch (the Entities dormant-arm
// effect resets it, since this module state outlives the per-run Canvas remount) and on a mid-run pause, so
// no stale sample survives a gap. A per-frame Δ beyond LEAD_TELEPORT_MAX is a scrub teleport → the lead is
// skipped that frame (the sample is still updated, so the NEXT frame is clean).
//   SUPPRESSION PATHS (deliberate non-reset): the follow gate below also closes while an F-focus ease owns the
// pivot, while a trail-frame/establish ease runs, and while the user is orbit-dragging — those suppression arms
// do NOT re-seed `has`, so when the follow resumes it holds a sample from BEFORE the suppression. That stale gap
// Δ is harmless by construction: either it exceeds LEAD_TELEPORT_MAX (40u) and the teleport guard skips the lead
// outright, or it is under it and followLead's own FOLLOW_LEAD_MAX (10u) cap bounds the one-frame aim nudge to
// ≤10u — <0.5u of actual pivot motion once the follow lerp factor applies (measured; imperceptible), and it
// self-corrects on the very next frame (the sample is refreshed unconditionally). The cap is the deliberate
// backstop; re-seeding `has` on every suppression edge would add churn for no visible gain.
const followLeadPrev = { x: 0, y: 0, z: 0, has: false }
const scratchLead: [number, number, number] = [0, 0, 0]

// The directed-camera subject anchor, resolved fresh every frame by camera.heldSubjectPose from the
// TIMELINE (the subject's trail), never accumulated. This is PURE scratch: heldSubjectPose overwrites all four
// fields (or clears `has`) on every read, so nothing crosses frames and nothing crosses runs — no run-switch
// re-seed is needed (the prior traversal-latch's cross-run leak vector is gone). Module scope only to keep the
// frame path allocation-free (the load budget, house style); it is written-then-read within a single frame, never carried.
const subjectPoseScratch: SubjectHold = { has: false, x: 0, y: 0, z: 0 }
// The head's OWN fractional pose, read for the camera anchor across a dropout RECOVERY so the anchor and the
// SensingStage head share ONE pose source at every fraction (see the frame-loop fallback). lerpHeadPosition writes
// this in place (out.set) with zero allocation, so the module scratch keeps the frame path allocation-free (the load budget).
const subjectLerpScratch = new THREE.Vector3()

// Absent-slot park. `keys` is the entity set at the run's FIRST POPULATED tick; under late-spawn
// semantics an entity in that set can be ABSENT at the current tick (before it spawns). Skipping such a slot
// (the old `if (!a) continue`) would leave Three's DEFAULT IDENTITY matrix in the instanced slot — a false
// unit cone at the origin WITH a live (invisible) hit target, since the hit mesh gets its own per-instance
// setMatrixAt (no wholesale buffer copy). Parking the slot with a zero-scale matrix collapses the cone to a
// degenerate point (nothing rasterised, nothing raycastable). Composed ONCE at module load → zero per-frame
// allocation; the absent branch writes it to BOTH the visible and the hit mesh.
const PARKED = new THREE.Matrix4().makeScale(0, 0, 0)

// Selection lensing palette — the source-of-truth object the three THREE.Color lensing tones below
// are derived from (its only consumer is this module; exported as the canonical selection-tint
// values, not for testability — no test imports it).
// InstancedMesh has NO per-instance emissive, so per-instance brightness comes from HDR instance
// colors: SELECTED is the accent scaled >1.0 (pre-bloom it just renders bright; under the bloom
// it glows), NEUTRAL is the accent dimmed to ~0.55, DIMMED is a genuinely recessed panel tone.
export const SELECTION_COLORS = { selected: PALETTE.accent, dimmed: '#141d27', neutral: PALETTE.accent } as const
const SELECTED = new THREE.Color(SELECTION_COLORS.selected).multiplyScalar(2.2)
const DIMMED = new THREE.Color(SELECTION_COLORS.dimmed)
const NEUTRAL = new THREE.Color(SELECTION_COLORS.neutral).multiplyScalar(0.55)
// Hover emissive lift: a hovered, non-selected cone brightens to read as interactive.
// InstancedMesh has no per-instance emissive, so — exactly like SELECTED — the "lift" is an HDR-ish
// instance colour: the accent well above NEUTRAL (×0.55) yet below SELECTED (×2.2). Module scope so the
// hover repaint (event-driven, never per frame) allocates nothing. Derived ONCE at load.
const HOVERED = new THREE.Color(SELECTION_COLORS.neutral).multiplyScalar(1.25)
// Celebrated rest head (a design ruling): at a natural-end rest with NO selection the resting head
// is painted an HDR instance tone ABOVE the bloom 0.4 threshold so it glows — the naive path's subject,
// honoured. accent ×1.75 sits below SELECTED (×2.2) so a selection still out-glows it (selection lensing wins)
// yet well clear of NEUTRAL (×0.55). Reuses the instance-color lever (setColorAt); NO new shader; the pulse
// verdict palette is untouched. Derived ONCE at module scope; the finale repaint rides the event-rate
// paintColors path (a store subscription), never per frame.
const FINALE_HEAD = new THREE.Color(SELECTION_COLORS.neutral).multiplyScalar(1.75)

// Query-pulse colors, derived ONCE at module scope from the palette. The owner-approved swatch (2026-07-09):
// the verdict pair is now its OWN token pair (verdictAffirm / verdictNegate), un-borrowed from the integrity
// green/red — a query returning false no longer flashes the tamper red. The per-frame setHex call site
// references these consts, so resolving the palette hex to a THREE numeric costs zero per frame (module load).
const PULSE_TRUE = hexToThree(PALETTE.verdictAffirm)
const PULSE_FALSE = hexToThree(PALETTE.verdictNegate)

// Resting cone emissive: a self-lit deep-blue floor so an unselected cone reads as a solid
// object against the darkened vignette rather than a flat silhouette. A documented literal (like
// SELECTION_COLORS.dimmed) — it is a material tone, not a palette token consumed anywhere else.
const CONE_EMISSIVE = '#12263a'
// Additive ground-ring under the SELECTED entity: the accent scaled >1.0 so it clears
// Bloom's luminance threshold and glows — this is the deliberate, data-bound source that gives the
// selected cone its halo (visible only while a selection exists; tracked in the frame loop).
const RING_COLOR = new THREE.Color(PALETTE.accent).multiplyScalar(2.4)
// Unselected mid-run tracking-ring SCALE (design rulings — FLOOR + DISTANCE-TRUE). The selRing mesh
// (outer radius 0.92u) reads correctly at the selection/finale CLOSE-UP (~11.4-25u), but the mid-run tracking
// marker rides the head during the ESTABLISHING shot with the camera FIXED while the head travels the corridor —
// browser-measured: the camera→head distance sweeps 242u (tick 1) → 465u (tick 62). A FIXED
// world scale is therefore a shrinking apparent marker: scale-8's on-screen radius fell 7.2px → 3.7px, DYING to
// ~4.4-4.8px in the late climb (ticks 38-46) — exactly where the head is most sub-pixel (an observed note). The design ruling:
// make the scale DISTANCE-PROPORTIONAL — screen-space-constant — via camera.ringTrackScale (scale = K·dist,
// floored + ceiling'd). See its comment for the mechanism; the constants below are the calibration.
//   RING_TRACK_MIN_SCALE = 8 is the FLOOR and the v0.5c value: the "8-at-its-calibration-distance" look, preserved.
//   RING_TRACK_CALIB_DIST = 242u is the NEAR establish distance (f1 tick 1, measured) where scale-8 was the
// accepted v0.5c marker (~7.2px radius). K = MIN/CALIB so at 242u scale === 8 EXACTLY (near look byte-preserved)
// and BEYOND it the world scale grows to HOLD that ~7.2px apparent size — at the far end (465u) scale ≈ 15.4,
// lifting the dying late-climb marker back to the near-look size. At any distance NEARER than 242u the floor
// holds scale at 8 (a close head keeps the calibrated marker, never a sub-scale dot).
//   RING_TRACK_MAX_SCALE = 20 is the CEILING — a marker, not a target. It is NON-BINDING across all of f1 (peak
// need ≈15.4 < 20); it only bites a future campaign-scale corridor (1000u+), where uncapped K·dist would grow the
// ring to a giant reticle. At 20 the outer radius is 18.4u (~7% of f1's 250u corridor) — the v0.5c comment's own
// "reads as a target" onset was ~8%, so 20 stays just inside marker territory as the honest backstop.
// Applied ONLY on the tracking arm; the selection + finale arms reset the mesh scale to 1 (the close-up geometry).
const RING_TRACK_MIN_SCALE = 8
const RING_TRACK_CALIB_DIST = 242
const RING_TRACK_MAX_SCALE = 20
const RING_TRACK_K = RING_TRACK_MIN_SCALE / RING_TRACK_CALIB_DIST
// Ring-scale handoff scratch (a design ruling; SEED amended by a later ruling). At a natural end the ring
// swaps from the wide-establish tracking marker to the finale close-up ring (scale 1) — but the finale CAMERA ease
// takes ~500ms to close in, so an instant scale-1 ring is sub-pixel for that beat: one NAKED-HEAD frame while the
// camera is still wide (an observed note). Instead the finale arm EASES this scratch toward 1 in LOCKSTEP with the finale
// camera ease (same focusLerpFactor time-constant), so the ring stays a visible marker the whole handoff — its
// apparent size (scale/distance) never collapses.
//   SEED FROM THE LIVE TRACKING SCALE (the seed rider): with the distance-true ring the tracking marker is
// scale ~15 at the far natural-end distance, NOT the constant 8. So the tracking arm seeds this scratch with the
// LIVE per-frame ringTrackScale on the last play frame (the frame immediately before the finale arm on the
// natural-end path); the finale ease then starts the shrink from whatever the ring last RENDERED, avoiding a
// visible 15→8 pop on the handoff's first frame. Module scope (house style, mirrors followLeadPrev); the
// selection arm + run-switch effect re-seed it to RING_TRACK_MIN_SCALE (the wide default). ONE real path
// reaches the finale arm WITHOUT a preceding tracking frame: deselecting AT a selected
// natural-end rest — the tick never moves, so finale survives and the ring hands from the selection arm
// straight to the finale arm. That path is covered by the selection arm's reseed (it just ran, so the ease
// starts from the wide default, never a stale value); every OTHER finale entry is play-to-end, whose last
// play frame IS a tracking frame (a scrub always clears finale — see the tracking-arm comment). RM snaps
// (factor 1).
const finaleRingScale = { v: RING_TRACK_MIN_SCALE }

// Trail-frame ease scratch: the framing computed ONCE per request (event-rate — on the
// stamp change) is copied into these preallocated vectors; the per-frame ease reads them only, so the
// frame path stays allocation-free (the load budget).
const trailFramePos = new THREE.Vector3()
const trailFrameTgt = new THREE.Vector3()
// Trail-frame framing opts. Same fov / margin / lift as CameraRig's resting fit, but the oversized
// pull-back CAP is REMOVED (maxDistanceFactor Infinity ⇒ frameFor never falls back to the composed
// default). DEVIATION from the plan's "same opts as CameraRig", and it is load-bearing: with the 2.5×
// cap frameFor returns the DEFAULT composed frame for any trajectory whose fit exceeds ~29u — which is
// EVERY f1 prefix (to:32 radius ≈62, to:64 radius ≈128), so a capped trail frame would ease the camera
// back to the world-origin resting shot and strand the drone off-frame — the exact opposite of the
// directed intent. The cap exists to keep the RESTING (load-time) composition out of an empty void; a
// tour-arrival HOLD is the opposite case — a deliberate wide shot whose whole point is to frame the
// trajectory-so-far with the subject in it — so here we fit the prefix fully.
const TRAIL_FRAME_OPTS = { fov: DEFAULT_FOV, margin: FIT_MARGIN, lift: TARGET_LIFT, maxDistanceFactor: Infinity }
// FINALE close-up pull-back (a design ruling). finaleFraming composes a directed rest shot around the TRUE head;
// FINALE_DISTANCE is how far the camera sits off the head along the composed octant. ~2.2× the composed offset
// length (~11.4u = |DEFAULT_POSITION − DEFAULT_TARGET|): far enough that the resting drone reads as the SUBJECT
// with the hold-lit corridor receding into the 30→400 fog for depth, close enough that it is not a speck (the
// void the corridor-fit would produce). Calibrated on screenshots. Finite-guarded at the consume,
// and RM-snapped through the shared focusLerpFactor ease (factor 1) — no bespoke finale ease.
const FINALE_DISTANCE = 25
const FINALE_FRAMING_OPTS = { lift: TARGET_LIFT, distance: FINALE_DISTANCE }
// AUTHORED tour-camera shot knobs (v0.7). SHOT_OPTS threads the framing constants this file owns into the
// pure camera.shotFraming resolver: `fit` is the uncapped house fit shared by 'conjunction' + 'stage'
// (TRAIL_FRAME_OPTS ≡ STAGE_FRAME_OPTS); `headMedium`/`headClose` are the compose-around-head distances (a
// 'head' 'close' arrive lands finaleFraming's terminal close-up EXACTLY, so f1's terminal beat is byte-identical
// to the natural-end rest). The sensing anchors are the scenario constants converted NED[N,E,D] → three[E,-D,N]
// (the placement.entityPosition convention), used ONLY when hasSensing (the conjunction shots are the sensing
// lens's; on any other run shotFraming returns null → the prefix-fit default). Module scope: zero per-consume
// allocation for the constants (the per-arrive anchors object is the sanctioned event-rate allocation).
const SHOT_OPTS = { fit: TRAIL_FRAME_OPTS, lift: TARGET_LIFT, headMedium: HEAD_MEDIUM_DISTANCE, headClose: FINALE_DISTANCE }
// The sensing anchors use the ONE shared basis-A conversion (placement.nedToThree) — the SAME transform the
// sensing apparatus (sensingStageView) and the flight trail draw through, so the authored conjunction shots
// frame exactly what is rendered. (Formerly a local re-derivation here; unified so the anchors
// and the apparatus can never drift into two bases again.)
const SENSOR_THREE = nedToThree(SENSOR_O)
const OCCLUDER_THREE = { center: nedToThree(OCCLUDER_C), radius: Math.sqrt(OCCLUDER_R2) }
// The POSITIONLESS (e0 query stage) finale "frames the evidence": the solids + the 21 contact points
// (queryBounds' solidsContacts preset), threaded from Scene as finaleStageBounds and fit UNCAPPED
// (STAGE_FRAME_OPTS — the stage lives hundreds of units out, so the capped fit would reject it). This
// REPLACES the former whole-helix spine finale (the query stage replaces ChainSpine as e0's stage).

function Entities({ model, trail, bounds, stageBounds, stageOpts, finaleBounds, observerFraming, corridorBounds, craneFraming, hasSensing, subjectIndex }: { model: RunModel; trail: Trail; bounds: Bounds | null; stageBounds: Bounds | null; stageOpts: FrameOpts; finaleBounds: Bounds | null; observerFraming: Framing | null; corridorBounds: Bounds | null; craneFraming: Framing | null; hasSensing: boolean; subjectIndex: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  // Enlarged invisible hit target (Task v04-7): shares the visible mesh's per-instance matrices (written
  // alongside it in the frame loop) and owns ALL cone interaction — click-to-select + hover-lift.
  const hitRef = useRef<THREE.InstancedMesh>(null)
  // Hovered instance index (or null) — a plain ref: hover is a pointer event, never a frame read, and it
  // must not trigger a render. Consumed by paintColors to lift the hovered, non-selected cone's colour.
  const hoveredRef = useRef<number | null>(null)
  const pulseRef = useRef<THREE.Mesh>(null)
  // ONE SDF label at the selected entity. Its group position is written in the frame loop below from
  // the already-computed selected scratch position (zero new allocation, no new subscription). The
  // TEXT CONTENT (the entity key) is the only thing that needs React: a selection is a click, not a
  // frame event, so a re-render on selectedEntity change is cheap and never touches the frame path.
  const labelRef = useRef<THREE.Group>(null)
  // Additive ground-ring under the selected cone. Positioned + shown/hidden in the frame loop from the
  // same interpolated scratch position the label uses (zero extra allocation, no new subscription).
  const selRingRef = useRef<THREE.Mesh>(null)
  const selected = useViewStore(s => s.selectedEntity)
  const keys = useMemo(() => model.entityKeys(), [model])
  // Authored-shot opts with the stage-fit branch bound to THIS run's stage opts: the 'stage' bookend (f2a b5)
  // frames on `stage` (the RAISED sensing vantage), while 'conjunction'/'head' keep the untouched house `fit`. Memoized
  // on stageOpts (stable per model) so the frame-path shotFraming call reads a stable object — zero per-frame alloc.
  const shotOpts = useMemo(() => ({ ...SHOT_OPTS, stage: stageOpts }), [stageOpts])
  // OrbitControls registers here via makeDefault; may be null on the first frames. `update` is typed
  // alongside `target` (the CameraRig shape) for the tour-start reset's explicit orientation sync.
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  // Seed from the CURRENT stamp so a fresh mount (a run-switch unmounts Entities through the loading
  // screen) consumes the outstanding stamp without acting — an old F press can never replay on the
  // new run's first frame.
  const focusStampRef = useRef(focusRequest.stamp)
  const focusActiveRef = useRef(false)
  // Trail-frame arrival ease (mirrors the focus refs): seed from the CURRENT stamp so a fresh mount
  // (run-switch) consumes any outstanding stamp without acting. `active` is set on a stamp change (the
  // framing is computed then) and cleared on convergence or on an orbit-drag takeover.
  const trailFrameStampRef = useRef(trailFrameRequest.stamp)
  const trailFrameActiveRef = useRef(false)
  // Which ease rate the ACTIVE trail-frame ease uses (a design ruling): true → the gentler refitLerpFactor (a
  // scrub-from-finale re-fit), false → focusLerpFactor (tour-arrival, plain establish, finale). Set at each
  // activation from the request's refit flag (below); read by the shared ease block so the rate is fixed for the
  // ease's whole duration even though the channel may re-arm afterward. Mirrors the trailFramePos scratch pattern.
  const trailFrameGentleRef = useRef(false)
  // Tour-start camera-reset one-shot (a design ruling): seed from the CURRENT stamp so a fresh mount consumes an
  // outstanding reset request without acting (mirrors focus/trail-frame). The consume is an INSTANT cut, so there
  // is no companion "active" ref — one stamp change, one write.
  const tourStartStampRef = useRef(tourStartFrameRequest.stamp)
  // Auto-follow "coast": armed while playing, it keeps easing the pivot toward the subject for a few
  // frames AFTER playback stops so the camera LANDS on the resting subject at end-of-run instead of
  // stranding partway. Playback is witness-normalized (watchable rates, not an instant jump), so this
  // isn't catching up to a collapsed frame — it's finishing the ease onto the subject once the transport
  // rests. Disarms once the pivot has converged (or on a fresh drag).
  const followCoastRef = useRef(false)
  // Reduced-motion is read DIRECTLY in the frame loop via prefersReducedMotion() (v0.4.1): motion.ts
  // now keeps a live module boolean fresh via a matchMedia change listener, so the read is a plain
  // boolean load (no per-frame matchMedia, zero alloc — the load budget) AND a mid-session OS toggle propagates
  // without a remount. This retires the mount-snapshot ref that would have gone stale on a live toggle.

  // Arm the auto-follow coast on the store's rising edge of `playing`. This is a subscription, not a read
  // in the frame loop, so it catches the edge REGARDLESS of playback rate: the subscription fires
  // synchronously on the setPlaying(true) write, so even a play step short enough to flip playing
  // true→false within a single r3f frame (which a frame-loop read could sample straight past) is still
  // caught. The frame loop then eases the pivot and disarms on convergence.
  //
  // DORMANT ARM: only a run with POSITIONED entities may arm the coast. A positionless
  // run (e0 — entityKeys() is empty) has nothing spatial to follow, so arming there would pan an empty
  // stage on play. `positioned` is captured once in the effect closure and recomputed only when the model
  // changes (dep [model]); e0 therefore never arms.
  useEffect(() => {
    const positioned = model.entityKeys().length > 0
    // Re-seed the predictive-lead velocity sample on run switch (a design ruling): followLeadPrev is module
    // scope, so it outlives this per-run Canvas remount — clear it here so the new run's first follow frame
    // never computes a velocity across the old run's head position.
    followLeadPrev.has = false
    // (the subject anchor no longer needs a run-switch clear — heldSubjectPose derives it fresh from THIS
    // run's trail every frame, so a prior run's pose can never leak into the new run's first directed frame.)
    finaleRingScale.v = RING_TRACK_MIN_SCALE // re-seed the ring handoff (module state outlives the per-run Canvas remount)
    // ONE PLAY-EDGE HANDLER shared by the subscription rising-edge arm AND the mount reconciliation (v0.7
    // fixwave). A play moment — a false→true `playing` edge caught by the subscription below, OR an ALREADY-
    // TRUE `playing` at a slow (pre-Entities) mount — does TWO things in order:
    //   1. ARM the auto-follow coast whenever the run is POSITIONED (independent of establish eligibility): a
    //      moving subject must be tracked, selection or not.
    //   2. THEN apply the STRICTER establish eligibility (unselected · tour-free · fittable · mid-run) — the
    //      wide establishing shot, an unselected-only framing.
    // The two are INDEPENDENT, and that is the whole fix: a SELECTED early-play mount (?run=f1&sel=1:0 + ▶
    // landing before Entities mounts) arms follow so the selected vehicle stays framed EVEN THOUGH establish
    // correctly REJECTS (a selection is present). The prior mount reconciliation wired only step 2, so such
    // a mount left follow false and the vehicle flew off-frame until the next pause/resume edge re-armed it.
    // `!s.playing` short-circuits so the common at-rest mount — EVERY run switch (App.selectRun rests
    // playing=false) — is a no-op (never arms, never establishes), exactly as before.
    const onPlayEdge = (s: { playing: boolean; selectedEntity: string | null; tick: number }): void => {
      if (!shouldArmFollowOnPlay(positioned, s.playing)) return
      followCoastRef.current = true // step 1: arm follow for any positioned play (independent of establish)
      // step 2: the establishing shot, ONLY on the stricter eligibility. shouldEstablishOnMount is keyed on the
      // ALREADY-TRUE `playing`, which the rising edge (s.playing true) and the already-playing mount both satisfy
      // — so the SAME predicate is the establish gate for both callers. RE-FIRE on a pause→resume is allowed (the
      // ease reads the LIVE camera → a no-op when nothing moved it, a gentle re-frame if the user orbited away).
      // The tick<tickCount guard excludes a PLAY-AT-REST (finale re-fire) so the finale close-up owns the end.
      if (shouldEstablishOnMount(s, positioned, bounds !== null, isTourActive(), model.tickCount)) requestEstablishFrame()
    }
    // Reconcile a MISSED play edge. A subscription attached HERE at mount cannot catch a `playing`
    // rising edge that fired BEFORE it existed (a slow SwiftShader mount landing after ▶ — the e2e seatEarlySphere
    // note documents it). Replay that edge ONCE, AFTER the stamp refs seeded (render, above) so the consume sees a
    // genuine stamp change. onPlayEdge CANNOT double-fire with the subscription arm (an already-playing mount has
    // no future rising edge). It now arms follow too (not just establish), so a selected early-play mount tracks.
    onPlayEdge(useViewStore.getState())
    return useViewStore.subscribe((s, prev) => {
      // Rising edge of `playing` → the shared play-edge handler: arm follow (+ establish iff eligible).
      if (s.playing && !prev.playing) onPlayEdge(s)
      // A selection landing during an ACTIVE establishing ease cancels it — the user chose the subject, so
      // follow takes over through its own gate (the establish activation deliberately leaves the coast armed,
      // so the now-open follow gate engages the frame after this ease clears). SCOPED to the establish intent
      // inside cancelEstablishFrame: a tour's select actions hit this too but are a no-op there, so a
      // tour-arrival frame (and a finale frame) is never cancelled by a selection.
      if (s.selectedEntity !== prev.selectedEntity) cancelEstablishFrame()
      // FINALE (a design ruling; falling edge AMENDED by a later ruling): the natural-end edge writes the store
      // finale flag inside the Timeline transport batch. React to its edges here — the module-channel + camera
      // side (the store flag itself drives the React consumers: the entity head repaint, the DOM marker —
      // e0's QueryStage, ChainSpine's successor, needs no finale flag: its tick subscription holds the stage).
      //   • rising (false→true): arm the composed close-up + light the journey (requestFinaleFrame). The consume
      //     computes finaleFraming(true head) / the spine-bounds fit and clears coast+focus.
      //   • falling (true→false): STOP the rest display — unlight the journey (the trail's own play-clear does
      //     NOT cover a scrub) and drop any in-flight finale ease. THEN, a design ruling: when the finale was left
      //     by a playhead MOVE, hand back the establishing context (an establish request — framing, NO hold-light)
      //     so a scrub / arrow-key step / deep-link off a finale rest eases back to the wide frame instead of
      //     stranding the viewer at the empty sky where the head was. ALL OTHER finale clears (tour-start,
      //     play-at-rest, run-switch, e0/f0) still never re-frame — the shouldRefitOnFinaleClear gate discriminates
      //     them by store-batch shape (tick moved on the same run + positioned + fittable bounds); see its comment.
      if (s.finale && !prev.finale) requestFinaleFrame()
      else if (!s.finale && prev.finale) {
        trailHold.lit = false
        if (trailFrameRequest.intent === 'finale') trailFrameActiveRef.current = false
        // A design ruling: the scrub-from-finale re-fit gets the gentler settle rate (requestRefitFrame — refit=true),
        // so leaving a finale by a scrub eases back to the wide frame as a directed move, not a whip. Plain establish
        // (the play rising edge, above) keeps the focus rate.
        if (shouldRefitOnFinaleClear(s, prev, positioned, bounds !== null)) requestRefitFrame()
      }
    })
  }, [model, bounds])

  // Lensing colors — repainted on a selection change (store subscription) OR a hover change (pointer
  // handlers), NEVER per frame: selected instance full colour, others dimmed; no selection → all neutral;
  // the hovered non-selected instance is lifted. setColorAt writes into the instance buffer in place
  // (zero allocation — the tones are module-scope THREE.Color constants).
  const paintColors = useCallback(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const { selectedEntity: sel, finale } = useViewStore.getState()
    const hov = hoveredRef.current
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!
      // Selection lensing WINS (SELECTED / DIMMED). With nothing selected, a natural-end finale celebrates the
      // resting head — the SUBJECT cone (subjectIndex; the sensing subject on an f2a-shape run, index 0 otherwise)
      // — with an HDR tone that clears the bloom threshold; otherwise NEUTRAL. (the celebrated head is the
      // entity the evidence concerns, not a hardcoded slot 0.)
      let color = sel !== null ? (k === sel ? SELECTED : DIMMED) : (finale && i === subjectIndex ? FINALE_HEAD : NEUTRAL)
      // Hover lifts an interactive non-selected cone; it never dims the already-glowing selected cone OR the
      // celebrated finale head (both are brighter than HOVERED, so a hover-lift there would read as a dim).
      if (hov === i && k !== sel && !(sel === null && finale && i === subjectIndex)) color = HOVERED
      mesh.setColorAt(i, color)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [keys, subjectIndex])
  useEffect(() => {
    paintColors()
    // Repaint on a selection change OR a finale edge (the head lights/dims as the finale sets/clears) —
    // both are event-rate store subscriptions, never the frame path.
    return useViewStore.subscribe((s, prev) => { if (s.selectedEntity !== prev.selectedEntity || s.finale !== prev.finale) paintColors() })
  }, [paintColors])

  useFrame((state, delta) => {
    const vs = useViewStore.getState()
    const { fraction, selectedEntity, playing, finale } = vs
    // THE TICK-DOMAIN BOUNDARY: the store playhead is a TransportTick (a plain scrub coordinate — viewStore.tick is a bare
    // number by design); brand it EventTick HERE, the ONE ingestion where model semantics begin. Every tick use
    // below (the pausedMidRun gate, the cursor, lerpHeadPosition, eventsByTick) is now typed in the event domain.
    const tick = eventTickOf(vs.tick as TransportTick)
    // pausedMidRun (a design ruling): a playhead paused STRICTLY between the cold open and the natural end — the
    // sanctioned pause-then-click window where the tracking ring must stay visible so the sub-pixel subject is
    // discoverable. Cold rest (tick 0) and the natural-end rest (tick === tickCount, finale-owned) are excluded.
    const pausedMidRun = !playing && tick > 0 && tick < model.tickCount
    // f2a PARITY: for a sensing run the interactive drone — the cone, its enlarged raycast
    // hit target, the SDF label, the ground ring, and the follow/focus camera targets — must ride the SAME
    // evaluated state frame the SensingStage head paints. A tick-k eligibility verdict was decided against
    // frame (k + TARGET_FRAME_OFFSET)'s pose (the excerpt's g = frame k+1), and the head rides that frame;
    // without the offset the paused-tick cone sits one 2-m north step BEHIND it (frame k vs k+1) — two poses
    // of one drone, and the raycast cone hit-tests the stale one. We thread the offset through the SHARED
    // frame map (evaluatedFrame) rather than fork a second pose, so the two stay coincident at every paused
    // tick and the playback lerp shifts by the same constant frame (motion stays continuous — no jump at the
    // play/pause boundary). Non-sensing runs pass offset 0 ⇒ t0 === Math.min(tick, tickCount) byte-for-byte
    // (e0/f1 untouched). The gate is the ONE arbitrated stage predicate sensingStageApplies (threaded as
    // hasSensing), never a second predicate; and model.tickCount === trail.count − 1, matching the head's clamp.
    const poseFrameOffset = hasSensing ? TARGET_FRAME_OFFSET : 0
    // The ONE cursor resolver: (t0, t1) = the evaluated frame and its clamped successor. model.tickCount
    // is the terminal StateFrame index (=== trail.count − 1); brand it StateFrame at this single lastFrame
    // ingestion. Non-sensing runs pass offset 0 ⇒ t0 === Math.min(tick, tickCount), byte-identical to the pre-brand path.
    resolveCursorInto(entitiesCursor, tick, poseFrameOffset, model.tickCount as StateFrame)
    const t0 = entitiesCursor.t0
    const s0 = model.entityStatesAt(entitiesCursor.t0)
    const s1 = model.entityStatesAt(entitiesCursor.t1)
    const mesh = meshRef.current
    if (!mesh) return
    // The invisible hit mesh mirrors the visible cones' transforms so its enlarged raycast target tracks
    // them exactly. A second setMatrixAt per instance — no allocation, and the counts are tiny (f1 = 1).
    const hit = hitRef.current
    const label = labelRef.current
    let labelPlaced = false
    let ringPlaced = false
    // Running swarm centroid accumulated from the SAME interpolated positions the cones render at
    // (zero extra allocation — plain number accumulators). Consumed by the auto-follow block below.
    let cx = 0, cy = 0, cz = 0, count = 0
    // The SUBJECT's own interpolated pose this frame (the i===subjectIndex sample the loop already computes),
    // captured for the directed-camera anchor so a sensing run frames the entity the evidence concerns, not the
    // all-entity centroid. subjectSeen marks whether the subject was present THIS frame; the hold fallback (below) then holds the
    // last-known pose across a frame where the subject is absent so the anchor never falls back to the centroid.
    let sx = 0, sy = 0, sz = 0, subjectSeen = false
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!
      const a = s0.get(k)
      // Absent at this tick (late-spawn entity pre-spawn): park the slot invisibly on BOTH meshes rather
      // than skip it — a skipped slot keeps Three's identity matrix and renders a false unit cone at the
      // origin with a live hit target. Zero-scale PARKED matrix (module scope) → nothing drawn, nothing hit.
      if (!a) { mesh.setMatrixAt(i, PARKED); hit?.setMatrixAt(i, PARKED); continue }
      const b = s1.get(k) ?? a
      entityPosition(scratchA, a, i)
      entityPosition(scratchB, b, i)
      lerp3(scratchP, scratchA, scratchB, fraction)
      cx += scratchP[0]; cy += scratchP[1]; cz += scratchP[2]; count++
      // Capture the SUBJECT cone's interpolated pose (subjectIndex is the sensing subject on an f2a-shape
      // run, index 0 otherwise) so the directed camera can anchor on it. On a sensing run the sensing gate guarantees
      // subjectIndex names a real, resolvable subject; the useSubjectAnchor gate below only trusts it when hasSensing.
      if (i === subjectIndex) { sx = scratchP[0]; sy = scratchP[1]; sz = scratchP[2]; subjectSeen = true }
      scratchMat.makeRotationY(-(a.headingRad))
      scratchMat.setPosition(scratchP[0], scratchP[1], scratchP[2])
      mesh.setMatrixAt(i, scratchMat)
      hit?.setMatrixAt(i, scratchMat)
      // SDF label rides the selected cone: reuse its just-computed interpolated position (scratchP),
      // lift it ~1.2u above the cone tip. Zero allocation — mutates the group's own vector in place.
      // Manual billboarding (in-place quaternion copy) replaces drei's <Billboard>, which registered
      // its OWN useFrame (rotation.clone() every frame, even while the label was invisible).
      // Only runs on the branch where the label is actually placed, so an
      // unselected entity costs nothing at all.
      if (k === selectedEntity) {
        if (label) {
          label.position.set(scratchP[0], scratchP[1] + 1.2, scratchP[2])
          label.quaternion.copy(state.camera.quaternion)
          labelPlaced = true
        }
        // Ground-ring reticle: pin to the deck (y≈0.02, just above the grid plane) under the cone —
        // an accent target pad, not a halo around the cone body. Reuses scratchP (x,z) — zero alloc.
        // Scale 1 INSTANTLY: selection is a user act, not a transition (no ease — a design ruling). Reset the
        // finale handoff scratch to the wide default (RING_TRACK_MIN_SCALE): this seed is LOAD-BEARING for the
        // one finale entry that has no preceding tracking frame — deselecting AT a selected
        // natural-end rest hands the ring from THIS arm straight to the finale arm (no tick move, finale kept),
        // and the ease then shrinks from this wide default. Play-to-end entries re-seed live in the tracking arm.
        const ring = selRingRef.current
        finaleRingScale.v = RING_TRACK_MIN_SCALE
        if (ring) { ring.position.set(scratchP[0], 0.02, scratchP[2]); ring.scale.setScalar(1); ring.visible = true; ringPlaced = true }
      } else if (finale && selectedEntity === null && i === subjectIndex) {
        // FINALE head ring (a design ruling): at a natural-end rest with NO selection, the celebrated
        // head (the SUBJECT cone, subjectIndex — the entity the evidence concerns, index 0 for a non-sensing
        // run) gets the SAME accent ground-ring the selection uses — the selRing lever,
        // its gate extended from selection-only to also cover the finale. NO label (the finale is a rest state,
        // not a selection). Selection lensing WINS: the `k === selectedEntity` branch above takes priority, so
        // this only fires while nothing is selected. The cone's HDR tint is FINALE_HEAD via paintColors.
        // A design ruling — RING-SCALE HANDOFF: ease finaleRingScale from the LIVE distance-true tracking scale
        // (seeded by the tracking arm on the last play frame — the seed rider, ~15 at the far natural-end distance, NOT
        // the constant floor) toward the close-up scale 1, in LOCKSTEP with the finale camera ease (same
        // focusLerpFactor time-constant). The camera takes ~500ms to
        // close in from the wide corridor; an instant scale-1 ring would be sub-pixel for that beat (one naked-head
        // frame). Easing keeps the ring's apparent size (scale/distance) in a visible band the whole way. RM →
        // factor 1 → snaps to 1 (the RM camera also snaps to the close-up, so no naked beat). Converges to 1 at rest.
        const ring = selRingRef.current
        finaleRingScale.v += (1 - finaleRingScale.v) * focusLerpFactor(prefersReducedMotion(), delta)
        if (ring) { ring.position.set(scratchP[0], 0.02, scratchP[2]); ring.scale.setScalar(finaleRingScale.v); ring.visible = true; ringPlaced = true }
      } else if (i === subjectIndex && shouldTrackWithRing(playing, pausedMidRun, selectedEntity !== null, finale, bounds !== null)) {
        // UNSELECTED MID-RUN TRACKING RING (design rulings): the THIRD arm of the ring gate
        // (else-if chain → priority selection > finale > mid-run-tracking). During unselected play (or a mid-run
        // PAUSE — a design ruling, the sanctioned pause-then-click discovery path) of a positioned, fittable run (f1) the
        // establishing shot frames the whole corridor, so the subject is sub-pixel; ride the SAME ground-ring at
        // the live head (the SUBJECT cone, subjectIndex — index 0 for a non-sensing run) as an honest tracking
        // marker — entity position is data. e0 (positionless → the
        // loop never runs) and f0 (null bounds) are excluded by the gate; a scrub off-frame is honest — the marker
        // sits where the entity IS (the +X bulge carries it off the right edge through ticks ~10-44).
        //   DISTANCE-TRUE SCALE (a design ruling): the establishing camera is FIXED while the head travels, so the
        // camera→head distance sweeps 242→465u; a fixed world scale shrinks to sub-pixel in the late climb. Scale
        // the ring PROPORTIONALLY to that distance (ringTrackScale, floored/ceiling'd — see RING_TRACK_* consts)
        // so its apparent size stays constant. Number locals only, zero alloc (the load budget).
        //   Seed the finale handoff scratch every mid-run frame with the LIVE distance-true scale (the seed rider) so the
        // natural-end shrink starts from whatever the ring last rendered (~15 at the far end), not the floor — the
        // tracking arm is the frame immediately before the finale arm on the natural-end path.
        const ring = selRingRef.current
        const camPos = state.camera.position
        const trackDist = Math.hypot(camPos.x - scratchP[0], camPos.y - scratchP[1], camPos.z - scratchP[2])
        const trackScale = ringTrackScale(trackDist, RING_TRACK_K, RING_TRACK_MIN_SCALE, RING_TRACK_MAX_SCALE)
        finaleRingScale.v = trackScale
        if (ring) { ring.position.set(scratchP[0], 0.02, scratchP[2]); ring.scale.setScalar(trackScale); ring.visible = true; ringPlaced = true }
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    // three.js InstancedMesh.raycast computes boundingSphere ONCE (only when it is null) and NEVER
    // refreshes it after setMatrixAt — the sphere freezes at the subject's first-picked position, so once
    // the drone travels away every pick/hover ray early-returns against the stale sphere and misses. Null it
    // beside the matrix flag so the next raycast recomputes at current positions (recompute is O(count),
    // deferred to raycast/event rate; the per-frame cost HERE is only this null assignment — zero allocation).
    // The deferred recompute itself allocates ONE small THREE.Sphere (computeBoundingSphere `new`s it when the
    // field is null) — but that runs off the frame path, at pick/hover EVENT rate, so it is sanctioned and does
    // not dent the frame loop's zero-alloc claim, which is scoped to per-frame work, not event handlers.
    if (hit) { hit.instanceMatrix.needsUpdate = true; hit.boundingSphere = null }
    // Visible only when the selection exists in THIS tick's state (not merely selected — an entity can
    // be selected but not yet spawned at this tick). Placed by the loop above; hidden otherwise.
    if (label) label.visible = labelPlaced
    if (selRingRef.current) selRingRef.current.visible = ringPlaced

    // The directed-camera anchor decision, resolved ONCE post-loop from TIMELINE-DERIVED data (not a
    // traversal latch). INVARIANT: on an admitted SENSING run the finale close-up / authored-shot head / follow
    // aim frame the EVIDENCE SUBJECT, GAPS INCLUDED — never the all-entity centroid. The held anchor at the
    // evaluated frame t0 is the subject's LAST PRESENT pose at frame ≤ t0, read O(1) from the sensing trail's
    // hold-filled buffer (camera.heldSubjectPose — buildTrail already carries each present pose forward across
    // absent ticks, so this is a pure index read; the amortized backward scan was precomputed at load). Because it
    // is PLAYHEAD-INDEXED it is correct BY CONSTRUCTION for reverse scrub (a backward move into a dropout yields the
    // PRE-gap pose the trail/head still render, never a stale future pose), tour jumps, and run switches (each run
    // derives from its OWN trail — no cross-run state to leak). Null before first appearance (t0 < trail.first) ⇒
    // SUPPRESS the directed beat rather than substitute a centroid. Non-sensing short-circuits (heldSubjectPose
    // uncalled, scratch untouched) → useSubjectAnchor false → the centroid path is byte-identical to the prior centroid-only behavior.
    const hasHold = hasSensing && heldSubjectPose(subjectPoseScratch, trail, t0)
    const useSubjectAnchor = hasHold
    const suppressDirected = hasSensing && !hasHold
    // Present THIS frame → keep the loop's LIVE interpolated pose in sx/sy/sz (smooth follow preserved); only
    // across a DROPOUT (subject absent this frame) fall back to the SAME t0→t1 fractional sample the SensingStage
    // head renders. INVARIANT: the camera anchor and the head read ONE pose source at ALL fractions — gaps AND
    // recoveries included. lerpHeadPosition IS that single source: it lerps trail[t0]→trail[t1] by the store
    // fraction on the SAME hold-filled buffer the head uses (Entities' `trail` === SensingStage's `sensingTrail`
    // on a sensing run), and hasHold ⇒ hasSensing, so Scene's t0/t1 are byte-identical to lerpHeadPosition's own
    // f0/f1 (poseFrameOffset === TARGET_FRAME_OFFSET; model.tickCount === trail.count−1). So a fractional dropout
    // RECOVERY — absent at t0, present at t1 — anchors on lerp(trail[t0], trail[t1], fraction), the drone's live
    // mid-motion pose, NOT the stale held trail[t0] the old integer read gave (t0 pose 10, t1 pose 99, fraction
    // .5 → 54.5, not 10, so a big recovery jump no longer strands the head outside the directed frame). buildTrail's
    // hold-fill makes that lerp well-defined across every gap and recovery. heldSubjectPose stays the VALIDITY gate
    // above (hasHold / suppressDirected — the frame<first suppression is unchanged); only the fallback POSE now
    // comes from the shared head lerp instead of the integer-frame scratch heldSubjectPose wrote.
    if (hasHold && !subjectSeen) {
      lerpHeadPosition(subjectLerpScratch, trail, tick, fraction)
      sx = subjectLerpScratch.x; sy = subjectLerpScratch.y; sz = subjectLerpScratch.z
    }

    // Geometry-query pulse for this tick's kind-23 event — the POSITIONED ground-plane RIPPLE at the subject
    // cone (flat rotation-x = -PI/2). If the subject is ABSENT this tick (late-spawn pre-spawn), HIDE rather
    // than ripple at a stale/origin position (the sibling of the absent-slot park).
    //   POSITIONLESS runs (e0) no longer pulse here: the query stage (queryStageView) now WRITES THE WORLD as
    // the run plays — each probe's real geometry is the live cue (the head ray at full voice, its verdict
    // contact), so a floating helix ring would be a disconnected relic (and the very "spasmodic blinking" the
    // stage replaces). The pulse mesh stays for f0/f1; e0 hides it (keys empty → no ground subject).
    const pulse = pulseRef.current
    if (pulse) {
      const seqs = tick < model.tickCount ? model.eventsByTick(tick) : EMPTY_SEQS
      const seq = seqs.length ? seqs[0]! : -1
      const q = seq >= 0 ? model.geometryQueryAt(seq) : null
      if (q && keys.length > 0) {
        let placed = true
        {
          // GROUND PATH (positioned). Cached key (RunModel.subjectOf), not `1:${q.subject}` template-
          // allocated per frame — same VALUE, computed once at construction. `q` non-null implies kind-23,
          // so subjectOf(seq) is non-null in practice — still guarded. Subject absent this tick ⇒ hide.
          const subjectKey = model.subjectOf(seq)
          const st = subjectKey ? s0.get(subjectKey) : undefined
          if (st) {
            const idx = keys.indexOf(subjectKey!)
            entityPosition(scratchP, st, Math.max(idx, 0))
            pulse.position.set(scratchP[0], scratchP[1], scratchP[2])
            pulse.rotation.set(-Math.PI / 2, 0, 0)
          } else placed = false // no stale/origin ripple for an unspawned subject
        }
        if (placed) {
          const r = 0.5 + fraction * 2
          pulse.scale.setScalar(r)
          ;(pulse.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - fraction)
          // HDR-boost the pulse color (>1.0) so an ACTIVE query pulse crosses Bloom's luminance
          // threshold and glows — earned by query state, not decoration. setHex returns the Color, so
          // multiplyScalar chains in place (re-derived from the hex each frame → no runaway accumulation).
          ;(pulse.material as THREE.MeshBasicMaterial).color.setHex(q.resultFlag ? PULSE_TRUE : PULSE_FALSE).multiplyScalar(1.8)
          pulse.visible = true
        } else pulse.visible = false
      } else pulse.visible = false
    }

    // TOUR-START CAMERA RESET (a design ruling, INSTANT cut). useTour.start() bumps tourStartFrameRequest.stamp so
    // step 0's caption opens on the composed LOAD vantage from EVERY entry state (finale rest, mid-run orbit,
    // cold). frameFor(bounds, LOAD_FRAME_OPTS) is the SAME framing CameraRig writes at load (the shared opts), so
    // on a PLAIN tour — camera already at the vantage — the cut writes identical numbers → PIXEL-EQUIVALENT no-op.
    // Runs BEFORE the focus/trail-frame/follow blocks so it is the baseline they compose over: it snaps camera
    // POSITION + pivot to the vantage, then f1's step-0 focus (which only re-aims the pivot) proceeds from there.
    // Disarm the trail-frame ease + the coast so no lingering finale/establish ease drags the camera back off the
    // vantage after the cut; focus is LEFT alone (a tour's step-0 focus must still fire, and it can't be live yet
    // — start() bumps this stamp before dispatching step 0). Finite-guarded exactly like CameraRig's load write.
    // Instant, so no "active" ease ref: one stamp change, one write. The load budget: the framing is computed once per
    // request (event-rate — frameFor allocates a Framing at consume); steady frames are a stamp compare only.
    if (tourStartFrameRequest.stamp !== tourStartStampRef.current) {
      // Consume INSIDE the controls guard (matching the focus block's posture of only acting
      // when it can act completely): if OrbitControls hasn't registered yet this frame, leave the stamp
      // unconsumed so the cut retries next frame instead of being silently dropped.
      if (controls) {
        tourStartStampRef.current = tourStartFrameRequest.stamp
        // A stage run (e0 query core theatre, f2a sensing scope) resets to its uncapped STAGE frame; every
        // other run to the composed load vantage. loadFraming is the SAME helper CameraRig's load write uses,
        // fed the SAME activeStageBounds Scene threads to both — so the cut is byte-identical to the load frame
        // (plain-tour pixel-equivalence), and f2a's tour start now lands on the sensing frame, not plain bounds.
        const f = loadFraming(stageBounds, bounds, stageOpts)
        state.camera.position.set(f.position[0], f.position[1], f.position[2])
        controls.target.set(f.target[0], f.target[1], f.target[2])
        // Mirror the load-time CameraRig write: OrbitControls updates at priority −1,
        // BEFORE this useFrame, so without an explicit update() the cut can render ONE frame with the new
        // position but stale orientation. update() re-derives the orbit from (camera, target) now.
        controls.update()
        trailFrameActiveRef.current = false // no in-flight finale/establish ease may fight the reset
        followCoastRef.current = false
      }
    }

    // Focus easing (frame path, allocation-free): while a focus request is active, lerp the
    // OrbitControls target toward the selected entity's interpolated position at a dt-normalized rate
    // (≈0.15/frame @60fps — see motion.focusLerpFactor; frame-rate-independent).
    // OrbitControls' own damping does the visible camera smoothing; this only moves the pivot.
    // Deactivation: target within ~0.01 units (dist² < 1e-4) OR the selection is gone/absent — a
    // fresh F press re-arms via the stamp bump. Scratch vectors are reused (loop + pulse are done).
    if (focusRequest.stamp !== focusStampRef.current) {
      focusStampRef.current = focusRequest.stamp
      focusActiveRef.current = focusRequest.key !== null
      // FOCUS SUPERSEDES TRAIL-FRAME (camera-owner priority: focus > trail-frame > follow). When a focus
      // request activates, clear any in-flight trail-frame ease outright — otherwise, since the focus block
      // runs FIRST in this loop, the trail-frame block below would drag controls.target back the same frame
      // and the two would fight over the pivot. The follow coast is the lowest priority: it is gated OFF
      // whenever either focus OR trail-frame is active (see the follow gate below).
      // invariant: at most one of focusActiveRef/trailFrameActiveRef is true — each activation clears the other.
      if (focusActiveRef.current) trailFrameActiveRef.current = false
    }
    if (focusActiveRef.current && controls) {
      const fk = focusRequest.key
      const fi = fk === null ? -1 : keys.indexOf(fk)
      const fa = fi >= 0 ? s0.get(fk!) : undefined
      if (fa) {
        const fb = s1.get(fk!) ?? fa
        entityPosition(scratchA, fa, fi)
        entityPosition(scratchB, fb, fi)
        lerp3(scratchP, scratchA, scratchB, fraction)
        const target = controls.target
        // Reduced-motion → factor 1 → the pivot snaps onto the target this frame (an instant cut,
        // not a glide); the dist² check below then deactivates on the same frame. Normal → dt-normalized
        // exponential ease (≈0.15/frame @60fps).
        const f = focusLerpFactor(prefersReducedMotion(), delta)
        target.x += (scratchP[0] - target.x) * f
        target.y += (scratchP[1] - target.y) * f
        target.z += (scratchP[2] - target.z) * f
        const dx = scratchP[0] - target.x, dy = scratchP[1] - target.y, dz = scratchP[2] - target.z
        if (dx * dx + dy * dy + dz * dz < 1e-4) focusActiveRef.current = false
      } else {
        // Selection is null or absent from this tick's state map: stand down AND clear the request
        // key, so a later stamp bump can't re-arm on a stale key (a stale key would silently retarget
        // an old entity). A fresh F press re-snapshots key + bumps the stamp.
        focusActiveRef.current = false
        focusRequest.key = null
      }
    }

    // Trail-frame arrival ease (frame path, allocation-free). A NATURAL tour play-step arrival
    // bumps trailFrameRequest.stamp (useTour.onArrived). On the stamp CHANGE we compute ONCE (event-rate) a
    // framing of the trajectory-SO-FAR — the trail prefix 0..arrivedTick — and copy it into module scratch;
    // then each frame we ease camera.position AND controls.target toward it. OrbitControls
    // re-derives its offset from (camera − target) each update, so writing BOTH is respected and never
    // fought. Consuming the request DISARMS the follow coast — the trail frame is the sole camera
    // owner during its ease. Reduced motion ⇒ factor 1 ⇒ snap (same rule as focus). Inert when
    // trail.count === 0 (e0: no-op, guarded at consume time). Converge (both within 1e-2 dist²)
    // ⇒ stand down. An orbit drag cedes immediately.
    if (trailFrameRequest.stamp !== trailFrameStampRef.current) {
      trailFrameStampRef.current = trailFrameRequest.stamp
      if (trailFrameRequest.cancelled) {
        // STAND-DOWN (mirrors focus's focusRequest.key = null): either a user scrub/speed/click mid-ease
        // cancelled the tour (useTour.stop → cancelTrailFrame), OR a mid-tour RESTART cancelled the prior
        // tour's ease (useTour.start → cancelTrailFrame — a restart routes to start() DIRECTLY, never through
        // stop). Drop the active ease this frame, allocation-free; the camera stays wherever the ease last
        // left it and the user (or the fresh tour's own step 0) takes over.
        trailFrameActiveRef.current = false
      } else if (trailFrameRequest.intent === 'establish') {
        // ESTABLISHING SHOT (a design ruling): frame the WHOLE trajectory — the load-time `bounds` prop, same
        // Infinity-cap fit as TRAIL_FRAME_OPTS — so the unselected run plays out INSIDE the frame over its
        // ~8s. No trail prefix: the whole path is the subject. bounds is null for e0/f0, and the subscription
        // already gates the request on bounds !== null; guard here too so a stray establish request can never
        // ease to frameFor(null)'s composed default (which WOULD move an e0/f0 camera). Same finite guard +
        // scratch copy as tour-arrival.
        //   Unlike a tour arrival this does NOT clear the follow coast: during unselected play the follow gate
        // is closed, so the coast cannot fight the ease — and leaving it armed lets a mid-play selection
        // (which cancels this ease) hand off to follow WITHOUT a re-arm. Focus outranks a frame (focus > frame
        // > follow) and cannot coexist with an unselected establish (focus needs a selection), so focus is
        // left untouched — it is provably inactive here.
        if (bounds !== null) {
          const f = frameFor(bounds, TRAIL_FRAME_OPTS)
          if (isFiniteFraming(f)) {
            trailFramePos.set(f.position[0], f.position[1], f.position[2])
            trailFrameTgt.set(f.target[0], f.target[1], f.target[2])
            trailFrameActiveRef.current = true
            trailFrameGentleRef.current = trailFrameRequest.refit // a design ruling: refit → gentler settle; plain establish → focus rate
          }
        }
      } else if (trailFrameRequest.intent === 'finale') {
        // FINALE (a design ruling). Compose the directed rest shot. Only activate while the finale is STILL set:
        // a scrub in the request→consume gap clears the store flag, and a cleared finale must never activate its
        // OWN close-up frame — the guard makes a stale FINALE request inert. (a design ruling: a
        // playhead-move clear DOES hand back a frame, but that is a SEPARATE establish request fired on the
        // falling edge — never this finale close-up.)
        //   • POSITIONED (f1/f0): a compose-around-head close-up on the TRUE head. The loop's centroid THIS
        //     frame IS the terminal position (tick===tickCount, fraction 0), never the lagging follow pivot
        //     finaleFraming builds the composition from scratch, so BOTH follow entry paths (select-then-
        //     play, establish-entered) converge to the same shot.
        //   • POSITIONLESS (e0): "frame the evidence" — the solids + the 21 contacts (finaleBounds, the
        //     query stage's solidsContacts preset), fit UNCAPPED (the stage lives hundreds of units out).
        // Same finite guard + scratch copy as tour-arrival. On activation, CLEAR coast + focus (copy the
        // tour-arrival branch's two clears, NOT establish's deliberate non-clear): a selected-play natural
        // end leaves the coast active, and the finale must own the camera against an open follow gate.
        if (useViewStore.getState().finale) {
          let f: Framing | null = null
          if (keys.length === 0) {
            if (finaleBounds !== null) f = frameFor(finaleBounds, STAGE_FRAME_OPTS)
          } else if ((count > 0 || useSubjectAnchor) && !suppressDirected) {
            // The finale close-up composes around the SUBJECT's pose on a sensing run (else the centroid).
            // Gate on HELD-ANCHOR validity (useSubjectAnchor), not the current-frame entity count: when the
            // SOLE subject drops out at the natural end (count 0) the held pose is still valid, so the close-up
            // stays anchored on it (cameraAnchor returns [sx,sy,sz] and never divides by count when useSubjectAnchor).
            // suppressDirected (sensing, subject never seen) leaves f null: hold the camera, never a centroid close-up.
            f = finaleFraming(cameraAnchor(cx, cy, cz, count, sx, sy, sz, useSubjectAnchor), FINALE_FRAMING_OPTS)
          }
          if (f !== null && isFiniteFraming(f)) {
            trailFramePos.set(f.position[0], f.position[1], f.position[2])
            trailFrameTgt.set(f.target[0], f.target[1], f.target[2])
            trailFrameActiveRef.current = true
            trailFrameGentleRef.current = false // finale close-up keeps the focus rate (the gentler rate is scoped to the refit path)
            followCoastRef.current = false // the finale owns the camera (as tour-arrival does)
            focusActiveRef.current = false // a fresh directed beat supersedes any lingering focus ease
          }
        }
      } else if (trailFrameRequest.intent === 'pov') {
        // OBSERVER'S EYE: ease to the POV framing — stand at the drawn observer O, look
        // toward the interrogated theatre — REUSING this trail-frame owner (no fourth camera owner; the
        // split guard reserves that). observerFraming is null for f0/f1 (no drawn observer) and for an e0
        // record with no theatre, so the request is INERT there. Clears coast + focus like the finale branch
        // so the POV owns the camera during its ease; an orbit-drag cedes it (the shared ease block below).
        if (observerFraming !== null && isFiniteFraming(observerFraming)) {
          trailFramePos.set(observerFraming.position[0], observerFraming.position[1], observerFraming.position[2])
          trailFrameTgt.set(observerFraming.target[0], observerFraming.target[1], observerFraming.target[2])
          trailFrameActiveRef.current = true
          trailFrameGentleRef.current = false // the POV keeps the focus rate (the refit gentler rate is scoped to establish)
          followCoastRef.current = false
          focusActiveRef.current = false
        }
      } else {
        // TOUR-ARRIVAL (v0.7 — an AUTHORED per-beat arrive, or the trajectory-so-far DEFAULT). Resolve one
        // framing, then activate through the shared trio (this branch is reached only for intent 'tour-arrival',
        // not cancelled/establish/finale/pov).
        //   • AUTHORED (trailFrameRequest.shot !== null): shotFraming resolves the shot GRAMMAR to a Framing from
        //     LIVE scene anchors — the subject's head THIS frame (the loop's interpolated centroid; count 0 →
        //     null), the sensing sensor/occluder scenario constants (only when hasSensing), the stage bounds —
        //     reusing the proven helpers (finaleFraming / frameFor / boundsFromPositions). It returns null when
        //     the shot's inputs are unavailable (a 'conjunction' on a non-sensing run, an absent head), and we
        //     then FALL THROUGH to the default (the design-lead degradation rule).
        //   • DEFAULT (shot === null, or an unresolvable shot): the trajectory-SO-FAR prefix fit, BYTE-IDENTICAL
        //     to the earlier behavior — prefix = arrivedTick+1 vertices (onArrived snapped the tick before
        //     requesting), fit with TRAIL_FRAME_OPTS. Inert on e0 (trail.count === 0 → f stays null → no
        //     activation), unchanged. frameFor's tuple is the sanctioned event-rate allocation, copied at once.
        let f: Framing | null = null
        const shot = trailFrameRequest.shot
        if (shot !== null) {
          // The authored-shot head anchor is the SUBJECT's pose on a sensing run (the conjunction shot is the
          // sensing lens's shot), else the all-entity centroid; null when nothing is on stage this frame.
          // Gate on HELD-ANCHOR validity (useSubjectAnchor), not the current-frame entity count: a sole-subject
          // dropout (count 0, held pose valid) still resolves the head anchor to the held pose (cameraAnchor takes
          // [sx,sy,sz], never dividing by count). suppressDirected (sensing, subject never seen) → null head
          // anchor: the shot goes unresolvable and falls through to the subject-trail default, never a centroid substitute.
          const headAnchor: [number, number, number] | null = ((count > 0 || useSubjectAnchor) && !suppressDirected) ? cameraAnchor(cx, cy, cz, count, sx, sy, sz, useSubjectAnchor) : null
          // Pass the marker VISUAL radii (only meaningful on a sensing run — the conjunction is the sensing
          // lens's shot; a non-sensing run has no sensor, so shotFraming falls through anyway) AND the live canvas
          // aspect (a zero-alloc number read, the SAME (state.camera).aspect leadForAspect uses) so the conjunction
          // fit tightens against the horizontal fov and a narrow flanked layout no longer crops the marker off-frame.
          f = shotFraming(shot, {
            head: headAnchor,
            headRadius: hasSensing ? HEAD_MARKER_R : 0,
            sensor: hasSensing ? SENSOR_THREE : null,
            sensorRadius: hasSensing ? SENSOR_MARKER_R : 0,
            occluder: hasSensing ? OCCLUDER_THREE : null,
            stageBounds,
            corridor: corridorBounds, // e0 SHOT 1 (null on non-query runs → the 'corridor' shot falls through)
            crane: craneFraming,      // e0 SHOT 2 (null on non-query runs → the 'crane' shot falls through)
          }, shotOpts, (state.camera as THREE.PerspectiveCamera).aspect)
        }
        if (f === null && trail.count > 0) {
          const prefix = Math.min(tick, trail.count - 1) + 1
          f = frameFor(boundsFromPositions(trail.positions, prefix), TRAIL_FRAME_OPTS)
        }
        // FINITE-FRAMING GUARD (see camera.isFiniteFraming): a crafted CRC-valid bundle can carry Infinity/NaN
        // positions → non-finite framing. Activating would write NaN to camera/target every frame and wedge the
        // convergence test forever (NaN < threshold === false), stranding follow off. Non-finite OR unresolved
        // (f === null) ⇒ do NOT activate: leave the camera untouched, leave coast/focus state as-is, skip clean.
        if (f !== null && isFiniteFraming(f)) {
          trailFramePos.set(f.position[0], f.position[1], f.position[2])
          trailFrameTgt.set(f.target[0], f.target[1], f.target[2])
          trailFrameActiveRef.current = true
          trailFrameGentleRef.current = false // tour-arrival keeps the focus rate (the gentler rate is scoped to the refit path)
          followCoastRef.current = false // the trail frame supersedes both coast branches
          // invariant: at most one of focusActiveRef/trailFrameActiveRef is true — each activation clears the other.
          focusActiveRef.current = false // a fresh directed beat also supersedes any lingering focus ease
        }
      }
    }
    if (trailFrameActiveRef.current && controls) {
      if (orbitDragging.current) {
        trailFrameActiveRef.current = false // an orbit-drag start cedes the camera immediately
      } else {
        // A design ruling: a scrub-from-finale re-fit eases at the GENTLER refitLerpFactor (set at activation); every
        // other trail-frame ease (tour-arrival, plain establish, finale) keeps focusLerpFactor. RM snaps either way.
        const f = (trailFrameGentleRef.current ? refitLerpFactor : focusLerpFactor)(prefersReducedMotion(), delta)
        const cam = state.camera.position, tgt = controls.target
        cam.x += (trailFramePos.x - cam.x) * f; cam.y += (trailFramePos.y - cam.y) * f; cam.z += (trailFramePos.z - cam.z) * f
        tgt.x += (trailFrameTgt.x - tgt.x) * f; tgt.y += (trailFrameTgt.y - tgt.y) * f; tgt.z += (trailFrameTgt.z - tgt.z) * f
        const cdx = trailFramePos.x - cam.x, cdy = trailFramePos.y - cam.y, cdz = trailFramePos.z - cam.z
        const tdx = trailFrameTgt.x - tgt.x, tdy = trailFrameTgt.y - tgt.y, tdz = trailFrameTgt.z - tgt.z
        if (cdx * cdx + cdy * cdy + cdz * cdz < 1e-2 && tdx * tdx + tdy * tdy + tdz * tdz < 1e-2) trailFrameActiveRef.current = false
      }
    }

    // Playback auto-follow (frame path, allocation-free): drift the OrbitControls pivot toward the live
    // swarm centroid so a moving subject stays framed. Single-entity runs → that entity; multi → the
    // centroid accumulated in the loop above. target.y eases to centroid + TARGET_LIFT so the composed
    // horizon-high framing is preserved as it tracks. Reduced motion snaps (factor 1, same rule as focus).
    //
    // SELECTION/TOUR GATE: the coast only runs when (selectedEntity !== null ||
    // isTourActive()). A manual play with NOTHING selected no longer auto-pans — it holds the composed
    // frame (a small/medium trajectory is framed whole by the publish-time CameraRig fit; an oversized one
    // like f1 rests at the composed default, and the user follows the subject by selecting it). isTourActive
    // is a module-boolean read (frame-path free); selectedEntity comes from the snapshot already read above.
    //
    // GATE-CLOSED EXPIRY (fixwave): the coast's disarm paths all live INSIDE the gated block below, so an
    // UNSELECTED play-to-end would leave the arm set forever — and a later plain click (a selection) would
    // then satisfy the gate and pan the camera with NO play edge, violating the click grammar (camera moves
    // are explicit: F focus, play, or leaving a finale by a playhead move — a design ruling). So when the gate
    // is CLOSED (nothing selected, no tour) AND playback
    // has stopped, expire the arm in the else-branch. Mid-play select-to-follow is preserved: while
    // playing=true the arm persists, so a selection made DURING a play still starts following.
    //
    // Playing arms the coast (only on positioned runs — see the dormant-arm subscription); it keeps easing
    // for a few frames AFTER playback stops so a USER play step lands the camera on the resting subject at
    // end-of-run — playback is witness-normalized (watchable rates), so this is the ease finishing after the
    // transport rests, not a chase after a collapsed frame. TOUR arrivals no longer rely on the coast:
    // the trail-frame ease above owns every tour hold (intermediate AND final beat) and DISARMS the coast on
    // consume, so !trailFrameActiveRef keeps the two from ever both moving the camera. Also gated OFF while
    // a one-shot F-focus ease owns the pivot and while the user is actively orbiting (orbitDragging) — a
    // drag is never fought, and the coast resumes on release. CameraRig sets the INITIAL distance; follow
    // only dollies the rig — the two coexist by construction.
    if (
      followCoastRef.current && (count > 0 || useSubjectAnchor) && controls && !orbitDragging.current && !suppressDirected &&
      !focusActiveRef.current && !trailFrameActiveRef.current && (selectedEntity !== null || isTourActive())
    ) {
      // Gate on (count > 0 || useSubjectAnchor), not entity count alone: when the SOLE subject drops out mid-
      // follow (count 0, held pose valid) the follow keeps tracking the held pose (hx = sx below, never cx/count).
      // !suppressDirected: on a sensing run whose subject has never been seen (a gap at frame 0), the follow
      // holds rather than drift the pivot onto the remaining-entity centroid. Once the subject first appears the
      // held anchor is valid (useSubjectAnchor true) from that frame on, so this only gates the pre-appearance window.
      // A USER pause mid-timeline must NOT re-center. The coast
      // survives playing=false ONLY to LAND the camera when playback reached the run's end (tick ===
      // tickCount) — the end-of-run landing it exists for. A pause before the end (tick <
      // tickCount) is a user pause, so disarm WITHOUT easing rather than drift the pivot onto the
      // subject after they stopped. (Tour holds are handled by the trail frame above, not here.)
      if (!playing && tick < model.tickCount) {
        followCoastRef.current = false
        followLeadPrev.has = false // a user pause ends the continuous velocity track; re-seed on resume
      } else {
        const reduced = prefersReducedMotion()
        // The follow aim rides the SUBJECT's pose on a sensing run (the tinted trail is the subject's, so the
        // aim and the trail bias agree), else the all-entity centroid. Zero-alloc number locals (the load budget): the same
        // useSubjectAnchor decision cameraAnchor applies at the event-rate sites, applied inline for the frame path.
        const hx = useSubjectAnchor ? sx : cx / count, hy = useSubjectAnchor ? sy : cy / count, hz = useSubjectAnchor ? sz : cz / count // live head (single-entity) / swarm centroid / sensing subject
        let tx = hx, ty = hy + TARGET_LIFT, tz = hz
        // FOLLOW-AIM TRAIL BIAS (a design ruling): bias the pivot off the live head toward the midpoint of the
        // REVEALED trail so the one-sided trail balances the frame (head ~1/3 from the leading edge) instead
        // of projecting off to one side. The midpoint is a DIRECT read of the trail buffer at the
        // revealed-midpoint vertex (revealedMidpointIndex ×3) — zero allocation, no per-frame scan. TARGET_LIFT
        // is added to BOTH endpoints so the biased aim keeps the composed lift. Only positioned runs WITH a
        // trail (f1); f0 (no trail, count 0) keeps the head aim. This is the FOLLOW aim only — focus / trail-
        // frame / establishing aims are untouched.
        if (trail.count > 0) {
          const mi = revealedMidpointIndex(tick, trail.count) * 3
          // Displacement toward the revealed-trail midpoint, then CLAMP its magnitude to FOLLOW_BIAS_MAX
          // (fixwave). Below the cap this is byte-identical to the prior three lerps (scale 1 ⇒ dx*1 === dx),
          // so the early-run composition is untouched; past it the pull scales to exactly the cap so a
          // campaign-scale corridor can't shove the head off-frame. TARGET_LIFT is added to the mid endpoint so
          // the biased aim keeps the composed lift (the +TARGET_LIFT cancels out of the y delta, as before).
          const dx = (trail.positions[mi]! - tx) * FOLLOW_TRAIL_BIAS
          const dy = (trail.positions[mi + 1]! + TARGET_LIFT - ty) * FOLLOW_TRAIL_BIAS
          const dz = (trail.positions[mi + 2]! - tz) * FOLLOW_TRAIL_BIAS
          const s = followBiasCapScale(dx, dy, dz, FOLLOW_BIAS_MAX)
          tx += dx * s; ty += dy * s; tz += dz * s
        }
        // PREDICTIVE LEAD (a design ruling): the exponential follow lags the accelerating head by ≈v/rate, riding
        // it toward the leading edge (an observed note). Lead the aim FORWARD along the head's instantaneous velocity
        // (Δhead/dt from the module-scratch previous sample) by leadEff·(v/rate) to cancel that fraction of
        // the lag. Reduced motion SNAPS the follow (factor 1 → no lag), so the lead is disabled there (adding it
        // under a snap would over-shoot the head PAST centre). First frame (no prior sample) and a scrub teleport
        // (Δ beyond LEAD_TELEPORT_MAX) skip the lead — don't launch the aim on a discontinuity. The sample is
        // updated EVERY follow frame so the next frame's velocity is clean. Composes with the bias above (both
        // additive aim offsets); the v0.5b bias + cap are untouched. Zero-alloc: number locals + scratchLead.
        //   ASPECT COMPENSATION (a design ruling): the lead's world offset is a bigger SCREEN fraction on a narrower
        // canvas, so the head clips the leading edge in the flanked-narrow band. leadForAspect scales the effective
        // lead up as the live CANVAS aspect (state.camera.aspect — the panel-narrowed 3D canvas, a zero-alloc number
        // read) drops below CALIB_ASPECT, holding the head's screen fraction constant; at or above CALIB_ASPECT it
        // returns FOLLOW_LEAD EXACTLY (the wide-aspect PROTECT — the v0.5c calibration is byte-preserved).
        if (!reduced && followLeadPrev.has) {
          const ddx = hx - followLeadPrev.x, ddy = hy - followLeadPrev.y, ddz = hz - followLeadPrev.z
          if (ddx * ddx + ddy * ddy + ddz * ddz <= LEAD_TELEPORT_MAX * LEAD_TELEPORT_MAX) {
            const leadEff = leadForAspect(FOLLOW_LEAD, (state.camera as THREE.PerspectiveCamera).aspect, CALIB_ASPECT, LEAD_ASPECT_GAIN)
            // Scale the lead's world cap WITH the elevated lead (a design ruling). FOLLOW_LEAD_MAX=10u was calibrated
            // for the base lead and BINDS once leadForAspect over-leads on a narrow canvas — clipping the very
            // compensation we need (measured: pinned at 10u, the flanked-narrow peak stalls at ~0.76 > 0.75). Scaling
            // the cap by leadEff/FOLLOW_LEAD lifts the backstop in exact proportion to the intended lead, so the aspect
            // compensation is never clipped. At the calibrated aspects leadEff === FOLLOW_LEAD, so leadCap ===
            // FOLLOW_LEAD_MAX EXACTLY — the v0.5c lead + cap are byte-identical there (the wide-aspect PROTECT).
            const leadCap = FOLLOW_LEAD_MAX * (leadEff / FOLLOW_LEAD)
            followLead(scratchLead, ddx, ddy, ddz, delta, FOLLOW_EASE_RATE, leadEff, leadCap)
            tx += scratchLead[0]; ty += scratchLead[1]; tz += scratchLead[2]
          }
        }
        followLeadPrev.x = hx; followLeadPrev.y = hy; followLeadPrev.z = hz; followLeadPrev.has = true
        // Dolly the whole rig (pivot + camera) so the subject keeps a constant apparent size — moving the
        // pivot alone would let OrbitControls keep the camera put and the subject would recede to a speck.
        followPan(controls.target, state.camera.position, tx, ty, tz, followLerpFactor(reduced, delta))
        // Disarm once the pivot has essentially reached the subject AND playback is over — while playing
        // we keep it armed so a live drift never self-cancels between ticks.
        const dx = tx - controls.target.x, dy = ty - controls.target.y, dz = tz - controls.target.z
        if (!playing && dx * dx + dy * dy + dz * dz < 1e-2) followCoastRef.current = false
      }
    } else if (followCoastRef.current && !playing && selectedEntity === null && !isTourActive()) {
      // GATE-CLOSED EXPIRY (see above): armed, stopped, and nothing selected / no tour → the coast can
      // never do useful work but WOULD ambush the next selection with a play-less pan. Disarm it (no alloc).
      followCoastRef.current = false
      followLeadPrev.has = false // and drop the velocity track — the next follow re-seeds cleanly
    }
  })

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, keys.length]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.4, 1.2, 6]} />
        <meshStandardMaterial color="#ffffff" emissive={CONE_EMISSIVE} />
      </instancedMesh>
      {/* Enlarged INVISIBLE hit target (Task v04-7): an instanced cone ~2× the visible one, sharing the
          per-instance matrices (written alongside the visible mesh in the frame loop). It owns ALL cone
          interaction — click to select, hover to lift — so a small cone is easy to hit. colorWrite +
          depthWrite off → it raycasts but paints nothing. ONLY this mesh carries handlers, so the visible
          cone stays out of r3f's interaction raycast and no click/hover ever double-fires. onPointerMove
          (not onPointerOver) keeps the hovered index current even when sliding between instances; repaint
          only fires on an actual index change (hoveredRef guard) — zero churn while hovering one cone. */}
      <instancedMesh
        ref={hitRef}
        args={[undefined, undefined, keys.length]}
        frustumCulled={false}
        onClick={(e) => { e.stopPropagation(); const k = keys[e.instanceId!]; if (k) { useViewStore.getState().select(k, null); syncUrl(true) } }}
        onPointerMove={(e) => { const idx = e.instanceId ?? null; if (hoveredRef.current !== idx) { hoveredRef.current = idx; paintColors() } }}
        onPointerOut={() => { if (hoveredRef.current !== null) { hoveredRef.current = null; paintColors() } }}
      >
        <coneGeometry args={[0.9, 1.8, 6]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </instancedMesh>
      <mesh ref={pulseRef} visible={false} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1, 48]} />
        <meshBasicMaterial transparent depthWrite={false} />
      </mesh>
      {/* Selection ground-ring: additive HDR accent on the deck under the selected cone. depthWrite off +
          additive blend so it reads as emitted light; the HDR color (accent×2.4) is the bloom source that
          makes the selection glow. Placement/visibility driven entirely by the frame loop via selRingRef. */}
      <mesh ref={selRingRef} visible={false} rotation-x={-Math.PI / 2} renderOrder={1}>
        <ringGeometry args={[0.6, 0.92, 64]} />
        <meshBasicMaterial color={RING_COLOR} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* SDF crisp label (drei Text = troika SDF, crisp at any zoom). Billboarding is manual (see the
          frame loop above) — no <Billboard> wrapper, so no hidden per-frame work while unselected.
          Position + orientation + visibility are all driven by the frame loop via labelRef; visible={false}
          here only prevents a first-frame flash at the origin. The stage label spoke the RAW key
          "1:0" while every instrument spoke ▸ ALFA — the one place the two dialects sat in one glance
          unreconciled. Route it through the identity plate's COMPACT form so the stage speaks the same name;
          the raw key stays the data-true handle in the URL. `characters` pre-builds the SDF glyph atlas at
          mount (now the compact-plate alphabet — the ▸ entity chevron, space/hyphen, NATO A–Z and digits for
          the "ALFA-2" wrap) instead of hitching on first selection. */}
      <group ref={labelRef} visible={false}>
        <Text characters="▸ -ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" fontSize={0.5} color={PALETTE.textPrimary} anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor={PALETTE.bgVoid}>
          {selected ? compactPlate(identityPlate(selected, 'entity')) : ''}
        </Text>
      </group>
    </>
  )
}

export function Scene({ model }: { model: RunModel }) {
  // HDR-correct bloom pipeline: the renderer's tone mapping is OFF (NoToneMapping) so the scene renders
  // into the composer's buffer in un-clamped linear HDR (selected cone = accent×2.2, query pulse = ×1.8
  // stay >1.0). ACES is re-applied as the FINAL composer effect (see EffectComposer below) — Bloom then
  // sees the true HDR headroom and the whites still land warm/non-washed. Browser-verified: ACES on the
  // renderer instead clamps every value to ≤1 BEFORE the composer, visibly starving the cone's glow.
  // Unmount cleanup for the module-scoped orbitDragging flag (mirrors the focusRequest module-channel
  // convention: the flag lives outside React, so React has to be told explicitly to reset it). Without
  // this, a scene unmount mid-drag (e.g. a run-switch while the user is actively orbiting) means
  // OrbitControls' onEnd never fires, and the flag would stay true forever — permanently pausing
  // Entities' playback auto-follow for the rest of the module's lifetime.
  //   trailHold.lit rides here too (lifecycle guard): a run switch nulls `model`, which
  // unmounts this Canvas, but it routes through useTour.dispose → finish() — NOT stop() — so
  // cancelTrailFrame never fires and a hold left LIT (natural finale, or a mid-hold switch) would bleed
  // into the next run's fresh trail (its rest-state comet would render fully lit). Clearing it on unmount,
  // exactly as with orbitDragging, keeps the module flag from surviving the run it belongs to.
  useEffect(() => () => { orbitDragging.current = false; trailHold.lit = false }, [])

  // ONE tick-walk at model publish: build the subject trail, then derive the camera-fit
  // bounds FROM that same Float32Array (boundsFromPositions) rather than a second independent walk
  // (trajectoryBounds). On a 65-tick run both walks blew past RunModel's 16-entry LRU decode cache, so the
  // second forced a full re-decode + eviction; sharing the walk halves the load-time decode work. Both are
  // memoised per model, so this never touches the frame path.
  const trail = useMemo(() => buildTrail(model), [model])
  const bounds = useMemo(() => boundsFromPositions(trail.positions, trail.count), [trail])
  // Positionless guard: a run whose subject has NO positioned state (E0 — entityKeys() is empty because it
  // populates no namespace-1 Entity) has nothing spatial in the entity vocabulary, so it renders the QUERY
  // STAGE instead — its kind-23 probes' real geometry. f0/f1 have positioned entities → false → the query
  // stage never mounts and they are wholly unaffected. App mirrors this predicate for the honesty chip.
  const positionless = useMemo(() => model.entityKeys().length === 0, [model])
  // The query-stage model layer (v0.6), built ONCE per positionless model (the sibling of buildTrail) —
  // seq-indexed nullable draws + validated LOS composites. A malformed bundle FAILS LOUD here at publish
  // (queryDraw/validateLosComposite throw), surfaced by the app's existing load-error voice. Null for f0/f1.
  const queryData = useMemo(() => (positionless ? buildQueryDraws(model) : null), [model, positionless])
  // Three nested framing presets from the parsed draws (§2.2). NED → three (x=n, y=−d, z=e) so the camera
  // frames what queryStageView draws (radius is flip/permutation invariant). stageBounds = the CORE THEATRE
  // (the default load/tour vantage — sources + solids + contacts, minus the runaway miss far-ends);
  // finaleBounds = SOLIDS+CONTACTS (the finale "frame the evidence" close-up). Null when there is no query
  // geometry — the honest empty state (the camera then keeps the composed default).
  const stageBounds = useMemo(() => {
    const b = queryData ? queryBounds(queryData.draws).core : null
    return b ? { center: [b.center[0], -b.center[2], b.center[1]] as [number, number, number], radius: b.radius } : null
  }, [queryData])
  const finaleBounds = useMemo(() => {
    const b = queryData ? queryBounds(queryData.draws).solidsContacts : null
    return b ? { center: [b.center[0], -b.center[2], b.center[1]] as [number, number, number], radius: b.radius } : null
  }, [queryData])
  // Observer's Eye POV framing (v0.6): stand at the drawn observer O, look toward the interrogated
  // theatre — computed ONCE per model (three-space, via queryScene.povFraming), eased on the O keypress by
  // the reused trail-frame owner. Null for f0/f1 (no drawn observer) → the preset is a no-op there.
  const observerFraming = useMemo(() => (queryData ? povFraming(queryData.draws) : null), [queryData])
  // e0 AUTHORED TOUR SHOTS (v0.8) — the two decode-true query-stage arrive vantages, computed ONCE per model
  // (the sibling of stageBounds / observerFraming) and threaded into the tour-arrival shotFraming anchors below.
  // e0Corridor (SHOT 1 "the first block") is the three-space Bounds of the first blocked sightline's
  // origin→occluder→contact corridor; e0Crane (SHOT 2 "the second observer") is the directed observer-crane
  // Framing. Null for f0/f1 (no query geometry) → the 'corridor'/'crane' shots fall through there.
  const e0Corridor = useMemo(() => (queryData ? blockedCorridorBounds(queryData.losComposites) : null), [queryData])
  const e0Crane = useMemo(() => (queryData ? observerCraneFraming(queryData.draws) : null), [queryData])
  // THE MOUNT GATE (a design-review ruling — routed through the ONE complete predicate).
  // buildQueryDraws returns a seq-indexed array that is ALL-NULL for a positionless run whose event kinds have no
  // kind-23 probe (f4) — it NEVER returns null — so `positionless && queryData` alone mounted the stage (its
  // origin-anchor octahedron + scenario solids) over a VOID on such runs. The mount now routes through
  // queryStageApplies (positionless AND kind-23 draws — the SAME predicate App's chip and the Inspector rail
  // use, its name pinned as the registration's mountGate), so the stage, its origin anchor (which lives inside
  // the mount), the chip and the rail can never drift on "does the stage apply here". The camera memos above
  // already return null for a no-draw run, so stageBounds/finaleBounds/observerFraming are null here and CameraRig
  // + the tour/finale branches fall back to the composed default vantage. e0 (75 kind-23 draws) mounts; f4 does not.
  const hasQueryContent = useMemo(() => queryStageApplies(model), [model])
  // THE SENSING GAUNTLET (f2a) — a POSITIONED-run lens (the OPPOSITE of the query stage's positionless
  // requirement), gated on the ONE complete predicate sensingStageApplies: POSITIONED (the stage voice is
  // the eligible-tinted trail — a positionless run has no trail to tint, so the apparatus would dress a
  // void) AND kind-22 verdicts present. The positioned conjunct is what ARBITRATES the two stage lenses to
  // at most ONE active stage per scene: a positionless run carrying BOTH kind-22 and kind-23 events mounts
  // only the query stage (its self-contained basis B), never two stages in two bases with activeStageBounds
  // picking one space while finaleBounds/observerFraming sit in the other. Built once per model (the
  // sibling of buildTrail / buildQueryDraws); null-cheap for non-sensing runs. The eligible-tinted trail
  // REPLACES the plain trajectory trail for f2a (the drone's path is now the stage voice), so the two never
  // double-draw. hasSensing is the ONE value the mount + activeStageBounds + the Entities/CameraRig
  // threading + the App honesty chip all share (the single-source lesson) — no consumer re-derives the gate.
  const sensingData = useMemo(() => buildSensingStage(model), [model])
  const hasSensing = useMemo(() => sensingStageApplies(model), [model])
  // Resolve the sensing SUBJECT ONCE: the flight the kind-22 verdicts NAME plus its index in entityKeys().
  // Every sensing-run consumer threads from THIS — the trail Entities tints/follows, its trajectory bounds, and
  // the tracking-ring instance index — so camera + highlight name the entity the evidence concerns, never
  // entityKeys()[0]. null on a non-sensing run (Scene threads the head defaults below: entityKeys()[0]'s
  // trail/bounds, index 0). Built only when hasSensing (the gate guarantees a single subject with a real flight).
  const subjectRef = useMemo(
    () => (hasSensing ? sensingSubjectRef(model.entityKeys(), sensingData.draws) : null),
    [hasSensing, model, sensingData],
  )
  // The eligible-tinted stage tints the SENSING SUBJECT's flight (the entity the kind-22 verdicts NAME),
  // not the scene's first entity. For every certified (single-subject) bundle the subject IS entityKeys()[0], so
  // this is byte-identical to `trail`; on a multi-subject run it binds the tint (and the sensing load-frame
  // below) to the subject subjectRef resolved. Built only when hasSensing — the gate guarantees a single subject
  // with a real flight, so subjectRef is non-null here; the plain `trail` is the non-sensing default.
  const sensingTrail = useMemo(
    () => (hasSensing ? buildTrail(model, subjectRef?.key) : trail),
    [hasSensing, model, subjectRef, trail],
  )
  // The sensing lens's DEFAULT load vantage (the sibling of the query stage's stageBounds): frame the trail
  // UNIONED with the sensor scope (origin, the ±R_max range extent, the occluder) so the cone, the occluder
  // and the flight are all legible on load — a stage you cannot see is not a stage. Points are three-space
  // (trail.positions already are); the sensor extent is added as a few cardinal points. AUTHORED per-beat
  // camera is the authored-camera pass's job; this is only the resting frame. Null for a non-sensing run (the query/trail vantage
  // is unchanged). CameraRig prefers a non-null stageBounds, so this frames f2a on load.
  const sensingStageBounds = useMemo(() => {
    if (!hasSensing) return null
    const n = sensingTrail.count // frame the SENSING SUBJECT's flight, the same trail the stage tints
    // The sensor scope, converted through the SAME shared basis-A transform (placement.nedToThree) the apparatus
    // and the flight draw through, so the load framing encloses exactly what is rendered. This was a flat
    // three-space literal that agreed with the apparatus ONLY by the occluder-on-the-diagonal coincidence the
    // basis bug hid inside (nedToThree([41,41,0]) === [41,0,41], and a full range ring is x↔z symmetric) — now it
    // is provably the one basis. Origin, the ±R_max range extent on both NED axes, and the occluder centre; the
    // resulting point set is byte-identical to the old literal, so the framed bounds do not move.
    const extent = [
      ...nedToThree(SENSOR_O),
      ...nedToThree([R_MAX, 0, 0]), ...nedToThree([-R_MAX, 0, 0]),
      ...nedToThree([0, R_MAX, 0]), ...nedToThree([0, -R_MAX, 0]),
      ...nedToThree(OCCLUDER_C),
    ]
    const pts = new Float32Array(n * 3 + extent.length)
    pts.set(sensingTrail.positions.subarray(0, n * 3))
    pts.set(extent, n * 3)
    return boundsFromPositions(pts, pts.length / 3)
  }, [hasSensing, sensingTrail])

  // ONE stage-bounds value threaded to BOTH the CameraRig load write AND Entities' tour-start reset: the
  // query core theatre for a positionless query run (e0), the sensing scope for f2a, null otherwise. Before
  // this, CameraRig got the sensing bounds but Entities still consumed the query-only stageBounds (null for
  // f2a), so f2a's tour start cut to plain trajectory bounds — away from the sensing frame step 0 was authored
  // around. e0 is byte-identical (hasSensing false ⇒ activeStageBounds === stageBounds, its value unchanged).
  const activeStageBounds = hasSensing ? sensingStageBounds : stageBounds
  // …and the matching STAGE opts, picked by the SAME hasSensing gate so it can never drift from the bounds:
  // the sensing scope frames at the RAISED vantage (SENSING_STAGE_FRAME_OPTS — its ground-plane apparatus self-
  // occludes at the house angle), the query core theatre (e0) keeps STAGE_FRAME_OPTS. Threaded to BOTH the CameraRig
  // load write and Entities (its tour-start reset + the 'stage' bookend shot) so all three agree on where f2a rests.
  const activeStageOpts: FrameOpts = hasSensing ? SENSING_STAGE_FRAME_OPTS : STAGE_FRAME_OPTS
  // Entities consumes the SUBJECT's trail + trajectory bounds on a sensing run (else the head's default),
  // so the establishing frame, the arrival-fit default and the follow-aim bias all track the subject the stage
  // tints; the subject's INSTANCE INDEX (not a hardcoded 0) drives the tracking / finale ring + the head tint.
  // For a single-subject bundle subjectRef.index is 0 and sensingTrail === trail, so entitiesTrail/entitiesBounds
  // are byte-identical to bounds/trail — no real behavior moves; only the latent multi-subject incoherence closes.
  const entitiesTrail = hasSensing ? sensingTrail : trail
  const entitiesBounds = useMemo(
    () => (hasSensing ? boundsFromPositions(sensingTrail.positions, sensingTrail.count) : bounds),
    [hasSensing, sensingTrail, bounds],
  )
  const subjectIndex = subjectRef?.index ?? 0

  return (
    <Canvas
      // far 8000 (was the r3f default): the positionless query stage is framed from its core theatre ~1800u
      // out and spans another ~700u, so the default far plane would CLIP the far half of the stage. f0/f1 are
      // tiny (geometry ≪ 400u) so the extra range costs them nothing — z-precision stays ample where they sit.
      camera={{ position: [DEFAULT_POSITION[0], DEFAULT_POSITION[1], DEFAULT_POSITION[2]], fov: DEFAULT_FOV, far: 8000 }}
      dpr={[1, 2]}
      // alpha:true + NO scene background → the canvas clears transparent, so #viewport's CSS radial
      // vignette (theme.css: --vignette-center → --vignette-edge) shows through BEHIND the scene. The
      // composer/bloom keep working: only the pixels the scene actually draws carry colour; everywhere
      // else stays transparent for the CSS to fill (browser-verified — the halo is intact, no black box).
      gl={{ toneMapping: THREE.NoToneMapping, alpha: true }}
      onPointerMissed={() => { useViewStore.getState().select(null, null); syncUrl(true) }}
      // Shader warmup: the Canvas mounts AFTER the ceremony (model publish), so first-frame shader
      // compilation would otherwise land exactly at the ceremony dissolve — the worst moment to hitch.
      // gl.compile precompiles the materials PRESENT AT MOUNT (grid, spine/trail, entities). SCOPE: the
      // postprocessing composer (Bloom/ToneMapping) compiles its OWN passes on the first composite and is
      // NOT covered here — those still warm on frame 1. gl.compile is synchronous but runs once at create,
      // before the first painted frame, so it front-loads the compile cost rather than adding to it.
      onCreated={({ gl, scene, camera }) => { gl.compile(scene, camera) }}
    >
      {import.meta.env.DEV && <Perf position="bottom-right" />}
      {/* Depth-cued atmosphere: linear fog 30 → 400 world units, coloured to the vignette centre so distant
          cones melt into the backdrop instead of popping against it (distances unchanged from the
          browser-verified far=400 that keeps f1's cone visible across tick 0 → 64; only the colour tracks
          the new vignette). No <color attach="background"> — the CSS vignette is the backdrop now. */}
      <fog attach="fog" args={[PALETTE.vignetteCenter, 30, 400]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 10, 3]} intensity={1.2} />
      <RadialGrid />
      <CameraRig bounds={bounds} stageBounds={activeStageBounds} stageOpts={activeStageOpts} />
      <Entities model={model} trail={entitiesTrail} bounds={entitiesBounds} stageBounds={activeStageBounds} stageOpts={activeStageOpts} finaleBounds={finaleBounds} observerFraming={observerFraming} corridorBounds={e0Corridor} craneFraming={e0Crane} hasSensing={hasSensing} subjectIndex={subjectIndex} />
      <ChainLinks model={model} />
      {/* The QUERY STAGE — mounted ONLY for a positionless run that ACTUALLY HAS kind-23 draws (e0). Replaces
          the presentational spine: the probes write the world in real NED space (rays fade-spent, contacts +
          solids persist), the reveal clock is spineRevealCount, selection re-lenses by causal role. f0/f1
          (positioned) never mount it; a positionless-but-no-query run (f4) is now withheld too (a design ruling),
          so its origin-anchor octahedron + scenario solids never render over a void. */}
      {hasQueryContent && queryData && <QueryStage model={model} data={queryData} />}
      {/* THE SENSING GAUNTLET stage (f2a): sensor apparatus + FOV cone + range ring + occluder Q, and the
          drone's flight as the ELIGIBLE-TINTED TRAIL (the stage voice). It replaces the plain trajectory
          trail for a sensing run — so mount exactly one of the two. hasSensing is the arbitrated
          sensingStageApplies (positioned AND kind-22), so this mount and the query mount above are mutually
          exclusive by construction — never two stages (two bases) in one scene. */}
      {hasSensing && <SensingStage trail={sensingTrail} data={sensingData} />}
      {!hasSensing && <TrajectoryTrail trail={trail} />}
      {/* onStart/onEnd flip orbitDragging so playback auto-follow pauses while the user is dragging the
          camera and resumes on release (never fights a live orbit). */}
      <OrbitControls
        enableDamping
        makeDefault
        onStart={() => { orbitDragging.current = true }}
        onEnd={() => { orbitDragging.current = false }}
      />
      {/* Data-bound glow, then tone map LAST. Only HDR pixels (selected cone accent×2.2, active query
          pulse ×1.8) clear the luminance threshold and bloom — the glow is earned by selection/query
          state, not decoration. ToneMapping (ACES) runs after Bloom so it compresses the bloomed HDR
          image for display; ordering decided by browser evidence. */}
      {/* Declarative composer: r3f disposes these passes when the Canvas unmounts. The Canvas is
          unkeyed but ALWAYS unmounts on a run switch (model -> null gates the whole subtree), so no
          manual dispose is needed. If the Canvas ever persists across runs, add explicit cleanup. */}
      <EffectComposer>
        {/* Retuned for perceptible presence: threshold 0.4 lets the selection ground-ring
            (accent×2.4) and selected cone (accent×2.2) clear it and glow; intensity 1.0 gives a visible
            halo without washing the frame. ACES stays LAST so it compresses the bloomed HDR for display. */}
        <Bloom intensity={1.0} luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD} luminanceSmoothing={0.2} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
