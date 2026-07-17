// CameraRig + the load/rest framing knobs (extracted MOVE-ONLY from Scene.tsx — v0.6).
// OWNERSHIP CALL: TARGET_LIFT / FIT_MARGIN / FIT_MAX_FACTOR / LOAD_FRAME_OPTS
// are genuinely shared — Scene's trail-frame/finale opts and follow aim compose from the same knobs, and
// Entities' tour-start reset consume frames with LOAD_FRAME_OPTS — so they live HERE, in the file that owns
// the load vantage they describe, and Scene imports them. The alternative (stay in Scene, re-export) would
// hand the fresh split a Scene↔cameraRig import cycle; this direction keeps the dependency one-way.
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type * as THREE from 'three'
import { frameFor, isFiniteFraming, DEFAULT_FOV, type Bounds, type Framing, type FrameOpts } from './camera'

// Compositional lift shared by the resting target, the fit target, and the follow ease: the pivot sits
// ~1u above the subject/deck so the horizon rides the upper third and the subject reads ~18-22% of frame
// height (see camera.ts DEFAULT_TARGET). One knob keeps rest, fit and follow visually consistent.
export const TARGET_LIFT = 1
// Fit padding: pull the camera slightly further than a hairline sphere fit so a long trajectory has
// breathing room at both ends rather than kissing the frame edge.
export const FIT_MARGIN = 1.15
// Largest fit pull-back (× the default distance) we'll use to frame a whole trajectory at load. A medium
// trajectory within this cap is framed end-to-end; an OVERSIZED one (f1's 250u corridor → a ~330u
// sphere-fit that recedes into the "near-empty void" the critiques condemned, browser-verified) instead
// falls back to the composed default framing and lets playback auto-follow dolly with the subject to
// convey the journey through motion. 2.5× is generous headroom for a real multi-entity swarm bbox.
export const FIT_MAX_FACTOR = 2.5

// CameraRig LOAD framing opts (a design ruling). The composed default framing a fresh model loads to: the FULL
// FIT_MAX_FACTOR cap (unlike TRAIL_FRAME_OPTS' Infinity), so an oversized corridor (f1) falls back to the composed
// default and a small run is fit fully — exactly the vantage every tour's step 0 was authored against. Shared by
// BOTH CameraRig (the load-time write) and the tour-start reset consume so the reset is BYTE-IDENTICAL to the load
// frame — the guarantee behind the plain-tour pixel-equivalence (a reset already at the vantage writes the same
// numbers). DRY: one source of truth for "where the stage rests".
export const LOAD_FRAME_OPTS = { fov: DEFAULT_FOV, margin: FIT_MARGIN, lift: TARGET_LIFT, maxDistanceFactor: FIT_MAX_FACTOR }

// STAGE framing opts (v0.6 — the query stage). The positionless query stage lives in real NED space
// (core theatre radius ≈674, hundreds of units across), so its whole-stage fit UNCAPS the pull-back
// (maxDistanceFactor Infinity — the TRAIL_FRAME_OPTS posture): FIT_MAX_FACTOR would reject the fit and fall
// back to the tiny composed origin default, framing the stage as a distant speck. Shared by CameraRig's
// load write and Entities' tour-start reset + finale so every e0 stage framing agrees. f0/f1 never use it.
export const STAGE_FRAME_OPTS = { fov: DEFAULT_FOV, margin: FIT_MARGIN, lift: TARGET_LIFT, maxDistanceFactor: Infinity }

// SENSING stage RESTING vantage elevation, stage-local. The house octant rests ~22.6° above the deck
// (asin(DEFAULT_POSITION.y / |DEFAULT_POSITION|) — the +E/+N azimuth carrying the [6,4.5,9] heading). At that
// SHALLOW angle the sensing plan geometry SELF-OCCLUDES: the FOV wedge, the range ring and the occluder sphere
// overlap ambiguously on the ground plane (browser-verified at tick ~56, the crossing INTO the cone). Raising the
// vantage to ~35° separates the three ground-plane elements so the drone-to-cone-edge relationship reads as a fact.
// SENSING-LOCAL by construction: only the sensing stage's load/rest frame — and its resting-DERIVED tour bookend
// (f2a), which returns to this exact vantage — thread it. The query stage (e0), f0/f1, the authored
// conjunction/head shots and follow-cam all keep STAGE_FRAME_OPTS (no elevationDeg) → byte-identical (frameFor).
export const SENSING_REST_ELEVATION_DEG = 35
// The sensing stage's frame opts: the shared uncapped STAGE fit, RAISED to the sensing elevation (frameFor reads
// elevationDeg to pin the vantage angle while holding the house azimuth). Every non-sensing stage frame keeps
// STAGE_FRAME_OPTS and is untouched.
export const SENSING_STAGE_FRAME_OPTS: FrameOpts = { ...STAGE_FRAME_OPTS, elevationDeg: SENSING_REST_ELEVATION_DEG }

// The shared LOAD / tour-start framing DECISION (v0.7 — the single source of truth behind the plain-tour
// pixel-equivalence). A non-null stageBounds frames the STAGE uncapped (STAGE_FRAME_OPTS) — the query core
// theatre (e0) or the sensing scope (f2a), each hundreds of units across; otherwise the capped composed load
// vantage over the trail bounds (LOAD_FRAME_OPTS). Finite-guarded: a poisoned bundle whose bounds overflow to
// NaN/Infinity falls back to the bounds-free composed default so the camera still loads to a legible shot.
// Called by BOTH CameraRig (the load-time write) and Entities' tour-start reset (Scene) with the SAME
// activeStageBounds, so step 0 opens on byte-identically the frame the load rests at — the fix behind an earlier tour-start regression:
// before this, the tour-start reset consumed the QUERY stageBounds only (null for f2a), cutting f2a's tour
// start to plain trajectory bounds, away from the sensing frame the load and step 0 were authored around.
// `stageOpts` is the opts for the STAGE branch — the query core theatre (e0) keeps STAGE_FRAME_OPTS (the
// default); the sensing scope (f2a) threads SENSING_STAGE_FRAME_OPTS so its load/rest vantage sits at the raised
// elevation. Scene picks it (hasSensing ? SENSING : STAGE) and passes the SAME value to both call sites (the load
// write here and the tour-start reset), so step 0 still opens byte-identically on the load frame. The non-stage
// (null stageBounds → LOAD_FRAME_OPTS) and finite-guard fallbacks are unchanged: only the stage branch reads stageOpts.
export function loadFraming(stageBounds: Bounds | null, bounds: Bounds | null, stageOpts: FrameOpts = STAGE_FRAME_OPTS): Framing {
  let f = stageBounds != null ? frameFor(stageBounds, stageOpts) : frameFor(bounds, LOAD_FRAME_OPTS)
  if (!isFiniteFraming(f)) f = frameFor(null, LOAD_FRAME_OPTS)
  return f
}

// Applies the initial camera framing for a freshly-published model ONCE (and again if OrbitControls
// registers after this component first renders). Motion runs whose trajectory exceeds the default
// framing (f1's 250u corridor) are pulled back to fit the WHOLE journey (frameFor → fit); f0/e0 keep the
// composed default. Runs inside <Canvas> so it can reach the live camera + controls via useThree. The
// bounds arrive as a prop — derived ONCE per model in <Scene> from the trail's Float32Array (one shared
// tick-walk), never on the frame path. Returns no scene node.
export function CameraRig({ bounds, stageBounds, stageOpts = STAGE_FRAME_OPTS }: { bounds: Bounds | null; stageBounds?: Bounds | null; stageOpts?: FrameOpts }) {
  const camera = useThree(s => s.camera)
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    // FINITE-FRAMING GUARD at load (mirrors the trail-frame ease's isFiniteFraming guard). A crafted
    // CRC-valid bundle can carry an f64 coordinate ~1e300 that overflows to Infinity on the Float32Array
    // write in buildTrail → a NaN bounds radius → frameFor's fit comparisons both fail → a NaN framing.
    // Written straight to camera.position/controls.target that wedges the camera at load. So if the framing
    // is non-finite, fall back to the composed default (frameFor(null, …) — a bounds-free resting frame) so
    // a poisoned bundle still loads to a legible shot. (camera.test.ts pins frameFor's NaN-radius behavior.)
    // loadFraming is the module-shared "where the stage rests" (a design ruling, extracted in v0.7) — the
    // tour-start reset calls the SAME helper so the reset lands BYTE-IDENTICALLY on this load vantage (plain-
    // tour pixel-equivalence). A non-null stageBounds frames the stage UNCAPPED (the query core theatre e0, or
    // the sensing scope f2a); every other run keeps the capped load vantage. Scene threads the SAME
    // activeStageBounds here and into Entities' tour-start reset.
    const f = loadFraming(stageBounds ?? null, bounds, stageOpts)
    const { position, target } = f
    camera.position.set(position[0], position[1], position[2])
    if (controls) {
      // OrbitControls owns the pivot: set its target and let update() reposition the camera on the new
      // orbit. Auto-follow may later drift this same target during playback (they share the vector).
      controls.target.set(target[0], target[1], target[2])
      controls.update()
    } else {
      // First frames before OrbitControls' makeDefault registers: aim manually so the ceremony→ready
      // hand-off never flashes an unframed origin. The controls-present effect re-run then takes over.
      camera.lookAt(target[0], target[1], target[2])
    }
  }, [bounds, stageBounds, stageOpts, camera, controls])
  return null
}
