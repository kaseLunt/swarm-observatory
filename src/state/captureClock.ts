import { WITNESS_RUN_SECONDS } from './transport'
import { hasRealSimClock } from '../ui/hangar'

// ── CAPTURE CLOCK (rung 2): the fixed-dt playback clock ────────────────────────────────────────────
// A capture's playhead must be stable and reproducible on any machine — the same class of fix as the CI
// wall-clock saga: the live app paces playback by the real per-frame wall delta (Timeline's draw loop
// feeds advancePlayhead `now - last`), which varies with render timing, tab throttling, and GPU speed.
// Fed to a capture, that variance makes "the same capture" produce different frames on different runs.
//
// This module replaces the wall delta with a FIXED per-frame delta during capture, and ONLY during
// capture. It reuses advancePlayhead unchanged (the captured playback IS the real playback, just clocked
// deterministically) and adds exactly one seam to the live loop's transport line — two halves,
// frameDeltaMs (the delta) and captureSpeed (the rate multiplier, pinned to 1 while engaged so the fps
// alone encodes capture pacing) — each of which is the IDENTITY whenever capture is not engaged, so the
// live path is byte-identical. Capture is opt-in via the ?capture= entry point (parseCaptureFps),
// which a shared/normal load never carries (encodeLink never emits it — capture is not a view fact,
// like verification state it never rides a URL).
//
// SCOPE — narrowed in review (the broader wording was an overclaim): this module owns the
// playhead TIMELINE — the (tick, fraction) at every captured frame — and THAT is what is bit-stable
// across machines (proven in captureClock.test.ts). Visual EASING is not clocked here: Scene.tsx's
// useFrame consumers (focus/trail/follow camera easing, finale ring scale, predictive lead) run on REAL
// renderer deltas even while capture is engaged. Static/hold frames are playhead-derived and stable
// everywhere; motion frames under eased camera work are reproducible in practice on the same machine,
// and their cross-machine bit-stability needs the rung-3 visual delta seam (docs/capture.md § Rung 3).
//
// The state→ui import (hasRealSimClock) mirrors viewStore's existing import of recordSeal/breakSeal from
// ui/hangar: the sim-clock tier partition has ONE owner (hangar, keyed on ASSUMED_DT_US), and the capture
// clock must not re-spell it and risk drift.

/** The run-clock facts the fixed delta is derived from: the model's tickCount and the manifest's dt_us
 *  (absent for the det-only / assumed tier). */
export interface CaptureClock {
  tickCount: number
  // `| undefined` (not a bare optional) is deliberate under exactOptionalPropertyTypes: the det-only tier
  // genuinely resolves dt_us to `undefined` (captureClockOf on a manifest-null model), and a caller must be
  // able to pass it through explicitly — hasRealSimClock(undefined) is false, so the assumed cadence is taken.
  dtUs?: number | undefined
}

/** The capture fps a bare `?capture` engages (a round GIF/video rate; the flip hero regenerates at this). */
export const DEFAULT_CAPTURE_FPS = 30

// The practical capture-rate band. ?capture= is a PUBLIC URL entry point, so the fps must be constrained
// to values a capture could actually mean — an unconstrained finite-positive check admits pathological
// numbers whose DERIVED delta breaks playback (?capture=5e-324 → dtMs=Infinity → the first frame clamps
// to end; ?capture=1e308 → a near-zero delta stall). Bounds chosen from real capture rates:
//   • floor 1 fps — anything slower is not a motion capture (GIF/video and the hero-capture spec live in
//     24–60), and it caps the assumed-tier delta at ≤ 1000ms/frame;
//   • ceiling 240 fps — the highest common HFR display/capture rate, flooring the assumed-tier delta at
//     ~4.17ms/frame. Together they keep the derivation orders of magnitude away from overflow/underflow.
// Fractional rates inside the band (29.97 NTSC) stay legal. engageCapture additionally validates the
// DERIVED dtMs (the output, not just this input) before arming — see below.
export const MIN_CAPTURE_FPS = 1
export const MAX_CAPTURE_FPS = 240

// The frame budget an armed capture must complete within, validated at the 1× baseline: one hour of
// footage at the band ceiling (3600 s · MAX_CAPTURE_FPS = 864 000 frames). Why an hour: every artifact
// this pipeline exists for is seconds-to-minutes (the hero capture ≈6 s, tour clips ≈60 s, a full real-clock
// run 12 s) — a clock that cannot finish inside an hour of ceiling-rate frames is a stall, not a capture.
// The bound is deliberately loose: it accepts every published run shape by ~3 orders of magnitude while
// rejecting the pathological sub-epsilon increments (~4e-305 ticks/frame) by ~300.
export const MAX_CAPTURE_FRAMES = 3600 * MAX_CAPTURE_FPS

/**
 * The fixed per-frame wall-clock delta (ms) to feed advancePlayhead every captured frame.
 *
 * advancePlayhead is witness-normalized: at 1× a whole run covers WITNESS_RUN_SECONDS of wall time when
 * fed dtMs = 1000/fps (one real frame). To make the captured run span a chosen `targetSeconds` instead,
 * the fixed delta scales by WITNESS_RUN_SECONDS / targetSeconds.
 *
 *  - Real-clock tier (manifest dt_us differs from the app assumption — f2a/f3a/f4): targetSeconds is the
 *    run's TRUE sim duration (tickCount · dtUs), so the capture honors the recorded dt. This is the only
 *    tier that consults dt_us.
 *  - Assumed tier (det-only e0/f1, or f0 whose dt_us equals the assumption): targetSeconds is
 *    WITNESS_RUN_SECONDS, so the capture reproduces the live 1× cadence exactly — the assumed tier keeps
 *    its tick cadence, and the delta reduces to 1000/fps.
 */
export function captureFrameDtMs(clock: CaptureClock, fps: number): number {
  const realSeconds = hasRealSimClock(clock.dtUs) ? (clock.tickCount * clock.dtUs!) / 1e6 : 0
  // A real-clock run with a degenerate zero length would make realSeconds 0; fall back to the witness
  // cadence rather than divide by zero (defensive — real-clock runs have tickCount ≥ 1 in practice).
  const targetSeconds = realSeconds > 0 ? realSeconds : WITNESS_RUN_SECONDS
  return (1000 / fps) * (WITNESS_RUN_SECONDS / targetSeconds)
}

// ── The engaged session (module singleton — the opt-in channel) ────────────────────────────────────
// Mirrors the tour-interrupt module channel: a single mutable ref the live loop reads with a cheap
// null-check. null ⇒ not capturing ⇒ frameDeltaMs is the identity ⇒ the live path is byte-identical.
let session: { dtMs: number } | null = null

/** Engage capture: from now on frameDeltaMs returns the fixed delta for `clock` at `fps`, ignoring the
 *  wall clock. Called by the capture entry point once the model (hence tickCount) is ready.
 * DOWNSTREAM-VALIDATED: a finite positive dtMs is not enough — an in-band fps with extreme
 *  MANIFEST clock facts (captureClockOf trusts manifest.dtUs, and a malformed/future manifest reaches
 *  this) can still derive a delta whose PLAYBACK degenerates: {tickCount:1, dtUs:1e308} yields dtMs
 *  3.3e-301 (finite, positive) but a ~4e-305 ticks/frame stall; {tickCount:2e7, dtUs:1e-308} yields dtMs
 *  1.7e308 whose tick increment overflows and snaps `done` on frame 1. So validate what advancePlayhead
 *  will actually DO with the delta — the per-frame tick increment, mirrored from its exact rate term at
 * the 1× capture baseline. The baseline is AUTHORITATIVE, not approximate: captureSpeed pins
 *  the effective transport speed to 1 for the whole session, so the validated increment IS the played
 *  increment — a ?speed=8 deep link or a mid-capture speed write cannot scale the delta past this
 *  guard. Refuse unless the increment is
 *    • finite,
 *    • ≥ tickCount / MAX_CAPTURE_FRAMES — the capture completes within the frame budget (no stall),
 *    • < tickCount — the first frame must not clamp to the end (advancePlayhead rests at
 *      ticks >= maxTick; this also refuses a zero-length run, which has nothing to capture).
 *  A refusal clears any prior session and leaves the live wall-clock path in charge, as before. */
export function engageCapture(clock: CaptureClock, fps: number): void {
  const dtMs = captureFrameDtMs(clock, fps)
  // Exactly advancePlayhead's per-frame rate term — (dtMs/1000) · speed · (max(1, maxTick) / W) — at the
  // pinned capture speed (1: captureSpeed neutralizes the store speed on the transport line while engaged).
  const ticksPerFrame = (dtMs / 1000) * (Math.max(1, clock.tickCount) / WITNESS_RUN_SECONDS)
  const ok = Number.isFinite(dtMs) && dtMs > 0
    && Number.isFinite(ticksPerFrame)
    && ticksPerFrame >= clock.tickCount / MAX_CAPTURE_FRAMES
    && ticksPerFrame < clock.tickCount
  session = ok ? { dtMs } : null
}

/** The authoritative CaptureClock for a loaded run: tickCount from the model, dt_us from the model's OWN
 *  manifest — the value parsed and verified WITH the loaded bytes. Deliberately typed on the model shape
 *  (manifest | null) and NOT on the runs/index RunEntry: the index is a separately-fetched display
 *  convenience that can fail/lag/go stale independently of the load, and a capture that derived its tier
 *  from it could silently arm a real-clock run (f2a/f3a/f4) as assumed-tier — wrong duration. det-only
 *  runs (manifest null) resolve dtUs to undefined → the assumed cadence, same partition as everywhere. */
export function captureClockOf(run: { tickCount: number; manifest: { dtUs: number } | null }): CaptureClock {
  return { tickCount: run.tickCount, dtUs: run.manifest?.dtUs }
}

/** Disengage capture: restore the live wall-clock path. Idempotent. */
export function disengageCapture(): void {
  session = null
}

/** Whether a capture session is engaged (never true in a normal/shared load). */
export function isCapturing(): boolean {
  return session !== null
}

/**
 * The DELTA half of the capture seam on the live draw loop: `advancePlayhead(...,
 * frameDeltaMs(now - last), captureSpeed(s.speed), ...)`. Returns the wall delta UNCHANGED when not
 * capturing (the byte-identical live path); returns the fixed per-frame capture delta when engaged.
 */
export function frameDeltaMs(wallDeltaMs: number): number {
  return session === null ? wallDeltaMs : session.dtMs
}

/**
 * The SPEED half of the capture seam. The fixed clock OWNS capture pacing: the fps already
 * encodes the capture rate, so letting the store speed multiply the capture delta would double-spend
 * rate control — a ?run=f0&speed=8&capture=1 deep link would arm past the downstream guard (validated
 * at 1×) and then snap the 2-tick run done on the first captured frame at 8×. Returns the store speed
 * UNCHANGED when not capturing (the identity); returns 1 while engaged, making captured playback
 * speed-INDEPENDENT by construction.
 *
 * Mid-session speed writes (a user keystroke, a tour's internal witnessSpeed) therefore update the
 * store — display-only during capture — but never reach the captured playhead, which stays a pure
 * function of the frame index: the capture SURVIVES them deterministically. The alternative (treating
 * a write as a capture-ending interrupt) was rejected — it would make the artifact depend on whether
 * and when a write landed, a new source of nondeterminism; and tour capture, where witnessSpeed writes
 * are routine, is rung-3 scope regardless (tour dwells ride wall-clock timers). See docs/capture.md.
 */
export function captureSpeed(storeSpeed: number): number {
  return session === null ? storeSpeed : 1
}

/**
 * Parse the ?capture= entry point from a query string (location.search, with or without a leading '?').
 *  - absent                → null  (a bare/normal/shared load never engages capture — the live path is untouched)
 *  - `?capture`            → DEFAULT_CAPTURE_FPS
 *  - `?capture=<n>`        → n, iff MIN_CAPTURE_FPS ≤ n ≤ MAX_CAPTURE_FPS (see the band rationale above)
 *  - malformed/out-of-band → null  (a pasted pathological link — ?capture=5e-324, 1e308, Infinity, NaN,
 *                            0, negative — must fall back to the live path, never break playback)
 */
export function parseCaptureFps(search: string): number | null {
  const p = new URLSearchParams(search.replace(/^\?/, ''))
  if (!p.has('capture')) return null
  const raw = p.get('capture')
  if (raw === null || raw === '') return DEFAULT_CAPTURE_FPS
  const fps = Number(raw)
  return Number.isFinite(fps) && fps >= MIN_CAPTURE_FPS && fps <= MAX_CAPTURE_FPS ? fps : null
}
