import { describe, expect, test, vi } from 'vitest'
import {
  prefersReducedMotion, focusLerpFactor, followLerpFactor, refitLerpFactor,
  dtEase, clampDt, FOCUS_EASE_RATE, FOLLOW_EASE_RATE, REFIT_EASE_RATE, MAX_FRAME_DT,
} from './motion'

const DT60 = 1 / 60

describe('reduced-motion honoring', () => {
  test('prefersReducedMotion false when matchMedia absent (node)', () => {
    expect(prefersReducedMotion()).toBe(false) // jsdom/node: no matchMedia → safe default
  })
  test('focusLerpFactor is instant (1) under reduced motion, eased (~0.15 @60fps) otherwise', () => {
    expect(focusLerpFactor(true, DT60)).toBe(1)
    expect(focusLerpFactor(false, DT60)).toBeCloseTo(0.15)
  })
  test('followLerpFactor snaps (1) under reduced motion, drifts (~0.05 @60fps) otherwise', () => {
    expect(followLerpFactor(true, DT60)).toBe(1)
    expect(followLerpFactor(false, DT60)).toBeCloseTo(0.05)
  })
  test('refitLerpFactor snaps (1) under reduced motion, eases GENTLER than focus otherwise', () => {
    expect(refitLerpFactor(true, DT60)).toBe(1)
    const refit = refitLerpFactor(false, DT60), focus = focusLerpFactor(false, DT60)
    expect(refit).toBeCloseTo(dtEase(REFIT_EASE_RATE, DT60))
    expect(refit).toBeLessThan(focus) // gentler per-frame factor → a longer, visibly-decelerating settle
  })
})

// Scrub-from-finale re-fit rate (v0.5d): a dedicated GENTLER settle rate for the establish-refit
// camera move so it reads as a directed move, not a whip. Derived from FOCUS_EASE_RATE, in 's 0.5–0.7 band.
describe('re-fit settle rate (v0.5d)', () => {
  test('REFIT_EASE_RATE is 0.6× FOCUS_EASE_RATE and lands inside the ruled 0.5–0.7 band', () => {
    expect(REFIT_EASE_RATE).toBeCloseTo(FOCUS_EASE_RATE * 0.6, 12)
    expect(REFIT_EASE_RATE).toBeGreaterThanOrEqual(FOCUS_EASE_RATE * 0.5)
    expect(REFIT_EASE_RATE).toBeLessThanOrEqual(FOCUS_EASE_RATE * 0.7)
  })
  test('a gentler rate stretches the settle: the residual after any wall-clock time is LARGER than focus', () => {
    // Same exponential form, smaller rate → exp(−rate·T) is larger → more of the move remains, i.e. a longer tail.
    for (const T of [0.1, 0.3, 0.5]) {
      expect(Math.exp(-REFIT_EASE_RATE * T)).toBeGreaterThan(Math.exp(-FOCUS_EASE_RATE * T))
    }
  })
  test('refit ease composes exactly across a frame split (frame-rate independence preserved)', () => {
    for (const dt of [DT60, 1 / 30, 1 / 144]) {
      const one = 1 - dtEase(REFIT_EASE_RATE, dt)
      const half = 1 - dtEase(REFIT_EASE_RATE, dt / 2)
      expect(Math.abs(one - half * half)).toBeLessThan(1e-12)
    }
  })
})

// dt-normalized camera easing (v0.5b): the per-frame lerp factor is derived from a per-second rate
// via factor(dt) = 1 − exp(−rate·dt), making convergence frame-rate-independent. These tests are the
// proof: (a) 60fps-equivalence to the old constants, (b) exact composition across a frame split (the
// frame-rate-independence property), (c) reduced-motion snap, (d) dt=0 and the delta clamp boundary.
describe('dt-normalized easing (v0.5b)', () => {
  // (a) The calibrated rates reproduce the former per-frame constants EXACTLY at dt = 1/60, so this is a
  // behavior-preserving refactor at the old 60fps cadence. Tolerance 1e-9 (brief).
  test('60fps-equivalent: factor at dt=1/60 equals the old constant within 1e-9', () => {
    expect(Math.abs(dtEase(FOCUS_EASE_RATE, DT60) - 0.15)).toBeLessThan(1e-9)
    expect(Math.abs(dtEase(FOLLOW_EASE_RATE, DT60) - 0.05)).toBeLessThan(1e-9)
  })

  // (b) STEP-COMPOSITION PROPERTY — the frame-rate-independence PROOF. The residual (1−f) after one dt
  // step must equal the residual after two dt/2 steps: (1−f(dt)) === (1−f(dt/2))². True for the
  // exponential form because exp(−r·dt) = exp(−r·dt/2)². Holds for any rate and any dt below the cap.
  test('exponential ease composes exactly across a frame split ((1−f)² identity)', () => {
    for (const rate of [FOCUS_EASE_RATE, FOLLOW_EASE_RATE, 1, 20]) {
      for (const dt of [DT60, 1 / 30, 1 / 144, 0.05]) {
        const oneStepResidual = 1 - dtEase(rate, dt)
        const halfResidual = 1 - dtEase(rate, dt / 2)
        expect(Math.abs(oneStepResidual - halfResidual * halfResidual)).toBeLessThan(1e-12)
      }
    }
  })

  // (b cont.) TIME-DOMAIN ACCUMULATION — the composition identity above generalizes to any partition of
  // [0, T], but this asserts the release claim DIRECTLY: clients at 30, 60, and 144fps land on the same
  // residual after the same wall-clock time, and that residual is the analytic exp(−rate·T). Steps stay
  // below MAX_FRAME_DT, the regime real clients run in.
  test('N-step accumulation matches exp(−rate·T) at 30/60/144fps (time-domain equivalence)', () => {
    const T = 0.5 // seconds; 0.5·{30,60,144} are all whole step counts
    for (const rate of [FOCUS_EASE_RATE, FOLLOW_EASE_RATE]) {
      const expected = Math.exp(-rate * T)
      for (const fps of [30, 60, 144]) {
        const dt = 1 / fps
        const steps = Math.round(T * fps)
        let residual = 1 // fraction of the gap remaining, as the lerp `t += (p−t)·f` leaves (1−f) each frame
        for (let i = 0; i < steps; i++) residual *= 1 - dtEase(rate, dt)
        expect(Math.abs(residual - expected)).toBeLessThan(1e-12)
      }
    }
  })

  // (c) REDUCED MOTION returns EXACTLY 1 (an instant cut) for any dt — an explicit bypass, never a large
  // rate approximating 1.
  test('reduced motion returns exactly 1 for every dt (explicit bypass, not an approximation)', () => {
    for (const dt of [0, DT60, 0.05, 1, 1000]) {
      expect(focusLerpFactor(true, dt)).toBe(1)
      expect(followLerpFactor(true, dt)).toBe(1)
    }
  })

  // (d) dt=0 → factor 0 (no movement on a zero-length frame).
  test('dt=0 yields factor 0 (no movement)', () => {
    expect(dtEase(FOCUS_EASE_RATE, 0)).toBe(0)
    expect(dtEase(FOLLOW_EASE_RATE, 0)).toBe(0)
    expect(focusLerpFactor(false, 0)).toBe(0)
    expect(followLerpFactor(false, 0)).toBe(0)
  })

  // (d cont.) Delta clamp: a background-tab resume delivers a giant dt; the clamp caps it at MAX_FRAME_DT
  // so the camera eases at most one ~0.1s step instead of teleporting, and floors a pathological negative.
  test('delta clamp caps a giant (background-tab-resume) dt at MAX_FRAME_DT and floors negatives', () => {
    expect(clampDt(1000)).toBe(MAX_FRAME_DT)
    expect(clampDt(MAX_FRAME_DT)).toBe(MAX_FRAME_DT)
    expect(clampDt(DT60)).toBe(DT60)
    expect(clampDt(0)).toBe(0)
    expect(clampDt(-5)).toBe(0)
    const huge = focusLerpFactor(false, 1000)
    expect(huge).toBe(dtEase(FOCUS_EASE_RATE, MAX_FRAME_DT)) // clamped, not raw
    expect(huge).toBeLessThan(1) // never a full teleport
  })
})

// Live reduced-motion signal (v0.4.1): the module holds a `current` boolean kept fresh by a
// matchMedia change listener, so a mid-session OS toggle propagates without a remount. Module state
// forces vi.resetModules() + a dynamic import per test so each starts from a clean, unwired module.
describe('live reduced-motion signal', () => {
  test('no window: false, never throws', async () => {
    vi.resetModules()
    const { prefersReducedMotion } = await import('./motion')
    expect(prefersReducedMotion()).toBe(false)
  })

  test('live change propagates', async () => {
    vi.resetModules()
    let listener: ((e: { matches: boolean }) => void) | undefined
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false, addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listener = cb } }),
    })
    const { prefersReducedMotion } = await import('./motion')
    expect(prefersReducedMotion()).toBe(false)
    listener!({ matches: true })
    expect(prefersReducedMotion()).toBe(true)
    vi.unstubAllGlobals()
  })
})
