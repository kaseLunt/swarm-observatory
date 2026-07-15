// Live reduced-motion signal: one MediaQueryList with a change listener keeps `current` fresh,
// so a mid-session OS toggle propagates without remounts. Reading is a module-boolean load —
// frame-path free. SSR/test-safe: no window -> false, wiring deferred to first read.
let current = false
let wired = false
function wire(): void {
  if (wired || typeof window === 'undefined' || !window.matchMedia) return
  wired = true
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  current = mql.matches
  mql.addEventListener?.('change', (e) => { current = e.matches })
}
export function prefersReducedMotion(): boolean {
  wire()
  return current
}
// ── dt-normalized camera easing (v0.5b T1) ────────────────────────────────────────────────────────
// The hand lerps in Scene's frame loop (`t += (target − t) * factor`) used FIXED per-frame factors
// (0.15 focus + trail-frame, 0.05 follow-coast), so convergence SPEED tracked the frame rate — a 30fps
// crawl, a 120fps snap. Derive the factor from a per-second rate instead: factor(dt) = 1 − exp(−rate·dt),
// which composes EXACTLY across frame splits ((1−f) after one dt step === (1−f)² after two dt/2 steps,
// since exp(−r·dt) = exp(−r·dt/2)²) → identical motion at any frame rate. Rates are calibrated so at the
// old 60fps cadence (dt = 1/60) the factor equals the former constant EXACTLY: rate = −ln(1−f₆₀)·60.
// Deriving the rate from the reference constant makes 60fps-equivalence exact by construction.
// Production consumes the rates only through the factor helpers below (same module — no import needed);
// exported additionally for tests (motion.test.ts's 60fps-equivalence and composition pins).
export const FOCUS_EASE_RATE = -Math.log(1 - 0.15) * 60 // ≈9.751 /s ↔ old 0.15 focus + trail-frame factor
export const FOLLOW_EASE_RATE = -Math.log(1 - 0.05) * 60 // ≈3.078 /s ↔ old 0.05 follow-coast factor

// Frame-delta cap: a backgrounded tab pauses rAF, so the first frame after resume carries a HUGE delta
// (seconds→minutes). Uncapped, 1 − exp(−rate·dt) → ~1 and the camera would teleport in one step; the cap
// bounds the worst case to a single ~0.1s ease frame. (Floors at 0 too: r3f delta is ≥0 — this just
// guards a pathological negative.) The exact-composition proof holds below the cap, which is all that runs.
// Both production-consumed in-module (clampDt feeds the factor helpers below); exported additionally for
// tests (motion.test.ts's clamp pins).
export const MAX_FRAME_DT = 0.1
export const clampDt = (dt: number): number => Math.min(MAX_FRAME_DT, Math.max(0, dt))

// Pure exponential-smoothing factor for a per-second `rate` over an UNCLAMPED frame of `dt` seconds. The
// composition identity is a property of this raw form; the factor helpers below feed it clamped dt.
// Production-consumed by the factor helpers (same module); exported additionally for tests (motion.test.ts
// pins the composition identity on this raw form).
export const dtEase = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt)

// One-shot focus cut / trail-frame arrival ease. Reduced motion is an INSTANT CUT (factor 1) via an
// explicit branch — never approximated by a large rate. `dt` is the useFrame frame delta (seconds).
export const focusLerpFactor = (reduced: boolean, dt: number): number =>
  reduced ? 1 : dtEase(FOCUS_EASE_RATE, clampDt(dt))
// Playback auto-follow uses a gentler ease than the one-shot focus cut: the camera should DRIFT with the
// subject during play, not snap to it, so an incidental user orbit is not fought harshly. Reduced motion
// still snaps (factor 1) — same explicit bypass as focusLerpFactor.
export const followLerpFactor = (reduced: boolean, dt: number): number =>
  reduced ? 1 : dtEase(FOLLOW_EASE_RATE, clampDt(dt))

// Scrub-from-finale RE-FIT settle rate (v0.5d ruling 5). The establish-refit ease — the camera move that hands
// back the wide establishing frame when a scrub LEAVES a finale rest (Scene.shouldRefitOnFinaleClear) — shared
// FOCUS_EASE_RATE with the one-shot focus cut and tour arrivals, so it WHIPPED: ~85% of the close-up→wide move
// completed during the ~500ms drag (critic n5: ~47.7→0 u/100ms), reading as a snap, not a camera move. Give the
// refit its OWN gentler rate so the settle decelerates VISIBLY past the drag (a longer exponential tail) without a
// lag-feel. 0.6× FOCUS_EASE_RATE (ruling 5's 0.5–0.7 band) ≈ 5.85/s: the time constant 1/rate is ~1.67× longer, so
// the initial velocity (rate·distance) is ~40% lower and the tail runs ~1.67× longer — calibrated on the browser
// refit-settle timing (v0.5d T1 report). SCOPED to the refit path ONLY: tour-arrival + plain-establish (the play
// rising edge) keep FOCUS_EASE_RATE (their feel passed two release gates). Exported additionally for tests.
export const REFIT_EASE_RATE = FOCUS_EASE_RATE * 0.6

// Scrub-from-finale re-fit ease factor (v0.5d ruling 5): a GENTLER sibling of focusLerpFactor for the establish-
// refit camera move ONLY (chosen at the Scene consume by the request's refit flag). Reduced motion still snaps
// (factor 1) — the SAME explicit bypass as focusLerpFactor, so RM keeps its instant cut.
export const refitLerpFactor = (reduced: boolean, dt: number): number =>
  reduced ? 1 : dtEase(REFIT_EASE_RATE, clampDt(dt))
