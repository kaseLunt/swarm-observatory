import { expect, test, describe, afterEach } from 'vitest'
import {
  captureFrameDtMs, engageCapture, disengageCapture, isCapturing, frameDeltaMs, captureSpeed,
  parseCaptureFps, captureClockOf, DEFAULT_CAPTURE_FPS, MIN_CAPTURE_FPS, MAX_CAPTURE_FPS,
  MAX_CAPTURE_FRAMES,
} from './captureClock'
import { advancePlayhead, WITNESS_RUN_SECONDS, ASSUMED_DT_US } from './transport'
import { SPEEDS } from './speeds'

// The capture clock (rung 2). A fixed-dt playback clock engaged ONLY during capture: recorded frames
// step the playhead by a FIXED per-frame delta rather than the wall-clock frame time, so the captured
// playhead TIMELINE is bit-stable and reproducible on any machine (the same class of fix as the CI
// wall-clock saga). The claim is deliberately the playhead, not the pixel — visual easing (camera moves,
// finale ring scale, predictive lead) rides Scene's real renderer deltas until the rung-3 visual delta
// seam (docs/capture.md § Rung 3). The pure derivation (captureFrameDtMs) is the heart; the module
// channel (engage/frameDeltaMs) is the opt-in seam the live draw loop reads — byte-identical to the
// wall-clock path when disengaged (§8).

// Every test disengages so the module singleton never leaks capture mode into a later test (or, if a
// test file ever runs in the same process as a live-path test, into that).
afterEach(() => disengageCapture())

// ── captureFrameDtMs: the fixed per-frame delta, run-clock-aware ───────────────────────────────────
describe('captureFrameDtMs: fixed per-frame wall-delta (ms) fed to advancePlayhead', () => {
  test('assumed tier (no dtUs) → 1000/fps: identical cadence to a perfectly-paced live 1× frame', () => {
    // The witness-normalized live path advances by (dtMs/1000)·speed·(maxTick/W). A capture that feeds
    // exactly 1000/fps reproduces the live app running on a machine that paces perfectly at `fps` — the
    // honest meaning of "the assumed tier keeps its tick cadence".
    expect(captureFrameDtMs({ tickCount: 75 }, 30)).toBe(1000 / 30)
    expect(captureFrameDtMs({ tickCount: 75 }, 60)).toBe(1000 / 60)
  })

  test('f0 tier (dtUs === ASSUMED_DT_US) keeps the assumed cadence — no fabricated real clock', () => {
    // f0 pins dt_us = 1000µs, which EQUALS the app's playback assumption: hasRealSimClock is false, so the
    // capture must NOT invent a real-time cadence (its 2-tick "0.002s" would be meaningless). Same rule as
    // the Hangar sim-clock partition, keyed on ASSUMED_DT_US, not an id list.
    expect(ASSUMED_DT_US).toBe(1000)
    expect(captureFrameDtMs({ tickCount: 2, dtUs: ASSUMED_DT_US }, 30)).toBe(1000 / 30)
  })

  test('real-clock tier (dtUs=125000) derives the delta from the run’s TRUE sim duration', () => {
    // f2a/f3a/f4: dt_us = 125000µs → real sim duration = tickCount·dtUs = 96·0.125s = 12s. The capture
    // spans that real duration instead of the witness-normalized WITNESS_RUN_SECONDS, so the fixed delta
    // scales by W / realSeconds. This is the ONLY tier that consults dt_us.
    const realSeconds = (96 * 125000) / 1e6 // 12
    expect(captureFrameDtMs({ tickCount: 96, dtUs: 125000 }, 30))
      .toBe((1000 / 30) * (WITNESS_RUN_SECONDS / realSeconds))
  })

  test('real-clock run captured at fps spans exactly its real sim duration (round-trip through advancePlayhead)', () => {
    // Feed the derived fixed delta through the SAME advancePlayhead the live path uses; at `fps` frames per
    // captured second the run of tickCount·dtUs seconds must complete in ~realSeconds·fps frames.
    const tickCount = 96, dtUs = 125000, fps = 30
    const realSeconds = (tickCount * dtUs) / 1e6 // 12
    const dtMs = captureFrameDtMs({ tickCount, dtUs }, fps)
    let s = { tick: 0, fraction: 0, done: false }
    let frames = 0
    const budget = Math.round(realSeconds * fps) + 4 // +fp slop, mirrors transport.test.ts convention
    while (!s.done && frames < budget) { s = advancePlayhead(s.tick, s.fraction, dtMs, 1, tickCount); frames++ }
    expect(s.done).toBe(true)
    expect(frames).toBeGreaterThanOrEqual(Math.round(realSeconds * fps) - 1)
    expect(frames).toBeLessThanOrEqual(budget)
  })

  test('assumed run captured at fps spans WITNESS_RUN_SECONDS (identical to the live 1× duration)', () => {
    const tickCount = 75, fps = 60
    const dtMs = captureFrameDtMs({ tickCount }, fps)
    let s = { tick: 0, fraction: 0, done: false }
    let frames = 0
    const budget = Math.round(WITNESS_RUN_SECONDS * fps) + 4
    while (!s.done && frames < budget) { s = advancePlayhead(s.tick, s.fraction, dtMs, 1, tickCount); frames++ }
    expect(s.done).toBe(true)
    expect(frames).toBeGreaterThanOrEqual(Math.round(WITNESS_RUN_SECONDS * fps) - 1)
  })

  test('returns a finite positive delta for every tier at a normal capture fps', () => {
    for (const clock of [{ tickCount: 75 }, { tickCount: 2, dtUs: 1000 }, { tickCount: 96, dtUs: 125000 }]) {
      const d = captureFrameDtMs(clock, DEFAULT_CAPTURE_FPS)
      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThan(0)
    }
  })

  test('degenerate real-clock run (tickCount 0) never divides by zero — falls back to the witness cadence', () => {
    // hasRealSimClock true but a zero-length run would make realSeconds 0; the guard keeps the delta finite.
    const d = captureFrameDtMs({ tickCount: 0, dtUs: 125000 }, 30)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBe(1000 / 30)
  })
})

// ── The module channel: the opt-in seam the live draw loop reads ───────────────────────────────────
describe('capture channel: engaged only during capture, byte-identical live path when off (§8)', () => {
  test('disengaged by default: isCapturing false and frameDeltaMs is the identity on the wall delta', () => {
    expect(isCapturing()).toBe(false)
    // The §8 guarantee, executable: the live draw loop passes frameDeltaMs(now-last); when not capturing
    // that MUST equal now-last exactly, for any value the wall clock produces (incl. odd/jittery deltas).
    for (const wall of [16.7, 0, 33.3333, 250, 1000 / 60, -0]) expect(frameDeltaMs(wall)).toBe(wall)
  })

  test('engaged: frameDeltaMs ignores the wall delta and returns the fixed capture delta', () => {
    engageCapture({ tickCount: 75 }, 30)
    expect(isCapturing()).toBe(true)
    const fixed = captureFrameDtMs({ tickCount: 75 }, 30)
    for (const wall of [16.7, 0, 999, 5]) expect(frameDeltaMs(wall)).toBe(fixed)
  })

  test('disengage restores the live wall-clock path exactly', () => {
    engageCapture({ tickCount: 96, dtUs: 125000 }, 30)
    expect(isCapturing()).toBe(true)
    disengageCapture()
    expect(isCapturing()).toBe(false)
    expect(frameDeltaMs(16.7)).toBe(16.7)
  })
})

// ── parseCaptureFps: the query-param entry point (never rides a shared URL; absent → live path) ─────
describe('parseCaptureFps: the ?capture= entry point', () => {
  test('absent → null (a bare/normal/shared load never engages capture)', () => {
    expect(parseCaptureFps('')).toBeNull()
    expect(parseCaptureFps('run=e0&tick=37&ev=37')).toBeNull()
  })
  test('?capture=<n> → n fps', () => {
    expect(parseCaptureFps('run=e0&capture=30')).toBe(30)
    expect(parseCaptureFps('capture=24')).toBe(24)
  })
  test('bare ?capture → the default capture fps', () => {
    expect(parseCaptureFps('run=e0&capture')).toBe(DEFAULT_CAPTURE_FPS)
    expect(parseCaptureFps('capture=')).toBe(DEFAULT_CAPTURE_FPS)
  })
  test('malformed fps → null (never a NaN/zero/negative frame delta)', () => {
    expect(parseCaptureFps('capture=abc')).toBeNull()
    expect(parseCaptureFps('capture=0')).toBeNull()
    expect(parseCaptureFps('capture=-5')).toBeNull()
  })
  test('a leading ? is tolerated (callers may pass location.search verbatim)', () => {
    expect(parseCaptureFps('?capture=30')).toBe(30)
  })

  // ?capture= is a PUBLIC URL entry point — a pasted pathological value must never break a
  // visitor's playback. Finite-positive alone admits 5e-324 (subnormal → derived dtMs = Infinity → the
  // first frame clamps to end) and 1e308 (→ near-zero delta stall); the band [MIN, MAX] rejects them.
  test('pathological fps values are rejected (subnormal, huge, Infinity, NaN)', () => {
    expect(parseCaptureFps('capture=5e-324')).toBeNull()  // smallest subnormal: finite, >0, dtMs would be Infinity
    expect(parseCaptureFps('capture=1e308')).toBeNull()   // near-DBL_MAX: dtMs would be a ~1e-305 stall
    expect(parseCaptureFps('capture=Infinity')).toBeNull()
    expect(parseCaptureFps('capture=NaN')).toBeNull()
  })
  test('the band is inclusive at both edges and rejects just outside them', () => {
    expect(parseCaptureFps(`capture=${MIN_CAPTURE_FPS}`)).toBe(MIN_CAPTURE_FPS)
    expect(parseCaptureFps(`capture=${MAX_CAPTURE_FPS}`)).toBe(MAX_CAPTURE_FPS)
    expect(parseCaptureFps('capture=0.5')).toBeNull()
    expect(parseCaptureFps('capture=241')).toBeNull()
  })
  test('fractional rates inside the band stay legal (29.97 NTSC)', () => {
    expect(parseCaptureFps('capture=29.97')).toBe(29.97)
  })
  test('every in-band fps derives a finite positive dtMs on every published tier (the output check)', () => {
    // The band's reason to exist, asserted on the OUTPUT: for all boundary fps × real run shapes, the
    // derived per-frame delta is a usable number — never Infinity, never a denormal-scale stall.
    for (const fps of [MIN_CAPTURE_FPS, 24, 29.97, 30, 60, MAX_CAPTURE_FPS]) {
      for (const clock of [{ tickCount: 75 }, { tickCount: 2, dtUs: 1000 }, { tickCount: 96, dtUs: 125000 }]) {
        const d = captureFrameDtMs(clock, fps)
        expect(Number.isFinite(d)).toBe(true)
        expect(d).toBeGreaterThan(1e-3)   // far above underflow/stall territory
        expect(d).toBeLessThanOrEqual(1000) // and at most one second per frame
      }
    }
  })
})

// ── engageCapture output validation (the derived-dtMs half) ────────────────────────────────────
describe('engageCapture validates the DERIVED dtMs, not just the fps input', () => {
  test('refuses to arm when the run clock makes the derived delta degenerate — stays on the live path', () => {
    // A pathological clock, not fps: tickCount·dtUs overflows realSeconds to Infinity → dtMs 0. The input
    // gate can't see this (fps 30 is fine); the output gate must. Refusal = disengaged = live wall clock.
    engageCapture({ tickCount: Number.MAX_VALUE, dtUs: 125000 }, 30)
    expect(isCapturing()).toBe(false)
    expect(frameDeltaMs(16.7)).toBe(16.7)
  })
  test('a refused engage also CLEARS a previously-armed session (never leaves a stale delta)', () => {
    engageCapture({ tickCount: 75 }, 30)
    expect(isCapturing()).toBe(true)
    engageCapture({ tickCount: Number.MAX_VALUE, dtUs: 125000 }, 30)
    expect(isCapturing()).toBe(false)
  })
  test('arms normally for every published tier at the default fps', () => {
    for (const clock of [{ tickCount: 75 }, { tickCount: 2, dtUs: 1000 }, { tickCount: 96, dtUs: 125000 }]) {
      engageCapture(clock, DEFAULT_CAPTURE_FPS)
      expect(isCapturing()).toBe(true)
      disengageCapture()
    }
  })
})

// ── engageCapture validates the DOWNSTREAM tick increment ───────────────────
// A finite positive dtMs is necessary but not sufficient: in-band fps × extreme MANIFEST clock facts
// (captureClockOf trusts manifest.dtUs — a malformed/future manifest reaches engage) can derive deltas
// whose PLAYBACK still degenerates. The gate therefore validates the per-frame tick increment that
// advancePlayhead will actually take: finite, ≥ tickCount/MAX_CAPTURE_FRAMES (completes within the
// one-hour-at-ceiling-fps frame budget — no stall), and < tickCount (no first-frame snap to the end).
describe('engageCapture refuses degenerate DOWNSTREAM playback (in-band fps, pathological manifest facts)', () => {
  test('finite-stall facts refuse: {tickCount:1, dtUs:1e308} @240fps — dtMs 3.3e-301 is finite but ~4e-305 ticks/frame', () => {
    // Sanity-check the premise first: the OLD gate (finite, positive dtMs) would have armed this.
    const dtMs = captureFrameDtMs({ tickCount: 1, dtUs: 1e308 }, 240)
    expect(Number.isFinite(dtMs)).toBe(true)
    expect(dtMs).toBeGreaterThan(0)
    engageCapture({ tickCount: 1, dtUs: 1e308 }, 240)
    expect(isCapturing()).toBe(false)         // refused: the increment is ~300 orders below the budget floor
    expect(frameDeltaMs(16.7)).toBe(16.7)     // live path in charge
  })
  test('finite-overflow facts refuse: {tickCount:2e7, dtUs:1e-308} @240fps — the increment overflows / snaps done on frame 1', () => {
    const dtMs = captureFrameDtMs({ tickCount: 2e7, dtUs: 1e-308 }, 240)
    expect(Number.isFinite(dtMs)).toBe(true)  // the OLD gate would have armed this too
    engageCapture({ tickCount: 2e7, dtUs: 1e-308 }, 240)
    expect(isCapturing()).toBe(false)
  })
  test('first-frame snap refuses at plausible scale: a 1ms sim (tickCount 10, dtUs 100) fits inside one 30fps frame', () => {
    // Not astronomical — a manifest could plausibly carry a microsecond-scale dt. The whole 1ms run
    // completes within a single captured frame (increment ≥ tickCount), which is not a capture.
    engageCapture({ tickCount: 10, dtUs: 100 }, 30)
    expect(isCapturing()).toBe(false)
  })
  test('budget boundary: 30 sim-minutes at 240fps arms (432k frames); 2 sim-hours refuses (1.73M frames)', () => {
    // frames-to-complete = realSeconds·fps; the budget is MAX_CAPTURE_FRAMES = 864 000 (one hour at the
    // 240fps ceiling). Both sides are tested with 2× margin rather than at exact equality — the gate
    // compares fp-derived increments, so the boundary itself sits inside an ulp, not on a clean integer.
    expect(MAX_CAPTURE_FRAMES).toBe(864000)
    engageCapture({ tickCount: 28800, dtUs: 62500 }, 240)   // realSeconds = 1800 → 432 000 frames ≤ budget
    expect(isCapturing()).toBe(true)
    disengageCapture()
    engageCapture({ tickCount: 28800, dtUs: 250000 }, 240)  // realSeconds = 7200 → 1 728 000 frames > budget
    expect(isCapturing()).toBe(false)
  })
  test('a zero-length run refuses to arm — nothing to capture (increment ≥ tickCount = 0 on the first frame)', () => {
    engageCapture({ tickCount: 0 }, 30)
    expect(isCapturing()).toBe(false)
  })
  test('a refusal on downstream grounds still CLEARS a previously-armed session', () => {
    engageCapture({ tickCount: 75 }, 30)
    expect(isCapturing()).toBe(true)
    engageCapture({ tickCount: 1, dtUs: 1e308 }, 240)
    expect(isCapturing()).toBe(false)
  })
})

// ── captureSpeed: the SPEED half of the seam (option (a), structural) ────────
// The fixed clock OWNS capture pacing: the fps already encodes the rate, so the store speed must never
// multiply the capture delta (double-spent rate control). captureSpeed pins the effective transport
// speed to 1 while engaged and is the identity otherwise — the downstream guard's 1× baseline is
// authoritative BY CONSTRUCTION, and mid-session speed writes are display-only (deterministic survival;
// the capture-ending-interrupt alternative was rejected — see the function's doc and docs/capture.md).
describe('captureSpeed: capture pacing is speed-independent (the fps alone encodes rate)', () => {
  test('disengaged: the identity on the store speed — ladder and off-ladder alike (§8)', () => {
    for (const sp of [...SPEEDS, 0.7111, 1.3333]) expect(captureSpeed(sp)).toBe(sp)
  })
  test('engaged: returns 1 regardless of the store speed', () => {
    engageCapture({ tickCount: 75 }, 30)
    for (const sp of [...SPEEDS, 0.7111, 1.3333]) expect(captureSpeed(sp)).toBe(1)
  })
  test('REGRESSION ?run=f0&speed=8&capture=1: arms and does NOT first-frame-snap', () => {
    // f0's shape: tickCount 2, manifest dt_us 1000 (= the assumption → assumed cadence). fps 1 → dtMs
    // 1000; the guard validates 0.25 ticks/frame at 1× and arms.
    engageCapture({ tickCount: 2, dtUs: 1000 }, 1)
    expect(isCapturing()).toBe(true)
    // The round-3 finding, asserted as the premise: with the RAW store speed 8 multiplying the fixed
    // delta, the very first captured frame covers (1000/1000)·8·(2/8) = 2 ticks ≥ maxTick 2 → done on
    // frame 1 — violating the exact refusal the downstream guard claims to make.
    expect(advancePlayhead(0, 0, frameDeltaMs(999), 8, 2).done).toBe(true)
    // The fix: the transport line passes captureSpeed(s.speed), pinning the rate to 1 while engaged —
    // the capture completes on exactly the 1×-validated schedule (2 ticks at 0.25/frame = 8 frames).
    let s = { tick: 0, fraction: 0, done: false }
    let frames = 0
    while (!s.done && frames < 20) { s = advancePlayhead(s.tick, s.fraction, frameDeltaMs(999), captureSpeed(8), 2); frames++ }
    expect(s.done).toBe(true)
    expect(frames).toBe(8)
  })
  test('full ladder × published shapes × in-band fps: the captured timeline is bit-identical at every store speed', () => {
    for (const clock of [{ tickCount: 75 }, { tickCount: 2, dtUs: 1000 }, { tickCount: 96, dtUs: 125000 }]) {
      for (const fps of [MIN_CAPTURE_FPS, 30, MAX_CAPTURE_FPS]) {
        const seqAt = (storeSpeed: number): string => {
          engageCapture(clock, fps)
          expect(isCapturing()).toBe(true)
          let s = { tick: 0, fraction: 0, done: false }
          const out: string[] = []
          for (let i = 0; i < MAX_CAPTURE_FRAMES && !s.done; i++) {
            s = advancePlayhead(s.tick, s.fraction, frameDeltaMs(16.7), captureSpeed(storeSpeed), clock.tickCount)
            out.push(`${s.tick}:${s.fraction}`)
          }
          expect(s.done).toBe(true) // completes within the budget the guard validated
          disengageCapture()
          return out.join('|')
        }
        const base = seqAt(1)
        expect(base.split('|').length).toBeGreaterThan(1) // never a first-frame snap, at any shape × fps
        for (const sp of SPEEDS) expect(seqAt(sp)).toBe(base)
      }
    }
  })
  test('mid-session speed write: a store write mid-capture never reaches the captured timeline (deterministic survival)', () => {
    const run = (speedOf: (i: number) => number): string => {
      engageCapture({ tickCount: 75 }, 30)
      let s = { tick: 0, fraction: 0, done: false }
      const out: string[] = []
      for (let i = 0; i < 2000 && !s.done; i++) {
        s = advancePlayhead(s.tick, s.fraction, frameDeltaMs(16.7), captureSpeed(speedOf(i)), 75)
        out.push(`${s.tick}:${s.fraction}`)
      }
      disengageCapture()
      return out.join('|')
    }
    // A user 8× keystroke landing at frame 50, and a tour writing its off-ladder witnessSpeed (0.7111,
    // e0's) at frame 120: the store updates — display-only during capture — but the captured playhead is
    // unmoved, bit-identical to a constant-1× session. This is the "survive deterministically" ruling.
    const constant = run(() => 1)
    expect(run(i => (i < 50 ? 1 : 8))).toBe(constant)
    expect(run(i => (i < 120 ? 1 : 0.7111))).toBe(constant)
  })
})

// ── captureClockOf: the tier comes from the MODEL's manifest, never the runs/index ───
describe('captureClockOf: authoritative clock facts from the loaded model alone', () => {
  test('a manifest-bearing model (f2a shape) yields the manifest dt_us — real-clock tier', () => {
    const clock = captureClockOf({ tickCount: 96, manifest: { dtUs: 125000 } })
    expect(clock).toEqual({ tickCount: 96, dtUs: 125000 })
  })
  test('a det-only model (manifest null) yields dtUs undefined — assumed tier', () => {
    expect(captureClockOf({ tickCount: 75, manifest: null })).toEqual({ tickCount: 75, dtUs: undefined })
  })
  test('REGRESSION: a real-clock run arms with the correct real-clock delta with NO run list anywhere', () => {
    // The bug this pins closed: the arming path previously read dtUs from App's independently-fetched
    // runs/index state — if that fetch failed or lagged while the load succeeded, f2a/f3a/f4 silently
    // armed as assumed-tier (wrong duration). captureClockOf's input is the model shape alone; arming
    // through it CANNOT consult an index (empty, stale, or otherwise), and the armed delta must be the
    // real-clock derivation, not the assumed 1000/fps.
    engageCapture(captureClockOf({ tickCount: 96, manifest: { dtUs: 125000 } }), 30)
    expect(isCapturing()).toBe(true)
    expect(frameDeltaMs(999)).toBe(captureFrameDtMs({ tickCount: 96, dtUs: 125000 }, 30))
    expect(frameDeltaMs(999)).not.toBe(1000 / 30) // NOT the assumed cadence — the tier arrived intact
  })
})

// ── DETERMINISM PROOF: the rung’s deliverable, scoped to the playhead TIMELINE ─────────────────────
// Simulate the draw loop's playhead advancement over N frames and serialize the exact (tick, fraction)
// at every frame. This sequence is the timeline the renderer draws FROM, and the capture clock's claim
// ends here (narrowed in review, round 2): static/hold frames are pure functions of playhead + verified
// model and are therefore stable everywhere; visual EASING (camera focus/trail/follow, finale ring
// scale, predictive lead) runs on Scene's real renderer deltas until rung 3 routes a capture-aware
// visual delta — that boundary (and the WebGL/encoder one) is documented in docs/capture.md. A capture
// clock makes this sequence a pure function of the frame index; the wall clock does not.
//
// The proof runs TWO GENUINELY FRESH SESSIONS, exercising the module's real
// lifecycle — clean state asserted → engage → frameDeltaMs called PER FRAME through the seam (exactly as
// Timeline drives it) → disengage → identity asserted — twice. Extracting one dt and replaying a pure
// closure would only prove function purity; this shape fails if module state leaks across sessions, if
// engage/disengage mismanage the singleton, or if a per-frame wall value ever bleeds into the delta.

// One full capture session through the REAL seam — both halves, exactly as Timeline drives them:
// frameDeltaMs(wall) for the delta and captureSpeed(storeSpeed) for the rate (round 3: pinned to 1 while
// engaged, so the passed store speed is inert during capture). `wallOf(i)` supplies that frame's
// wall-clock delta — the value the draw loop would compute as `now - last` — which frameDeltaMs must
// wholly ignore while engaged. Asserts clean module state on entry and the restored disengaged identity
// on exit.
function captureSession(
  clock: Parameters<typeof engageCapture>[0], fps: number, maxTick: number,
  wallOf: (i: number) => number, storeSpeed = 1, frames = 2000,
): string {
  expect(isCapturing()).toBe(false)           // fresh session — fails if a previous session leaked
  engageCapture(clock, fps)
  expect(isCapturing()).toBe(true)
  let s = { tick: 0, fraction: 0, done: false }
  const out: string[] = []
  for (let i = 0; i < frames && !s.done; i++) {
    s = advancePlayhead(s.tick, s.fraction, frameDeltaMs(wallOf(i)), captureSpeed(storeSpeed), maxTick)
    out.push(`${s.tick}:${s.fraction}`)
  }
  disengageCapture()
  expect(isCapturing()).toBe(false)           // clean exit…
  expect(frameDeltaMs(16.7)).toBe(16.7)       // …with the disengaged wall-clock identity restored
  return out.join('|')
}

// A seeded LCG jitter stream modeling real render timing (60fps ±8% vsync/machine wobble) — the wall
// deltas the OLD path would have consumed. Seeded, so each stream is reproducible but two different
// seeds give two DIFFERENT machines' timing.
function jitterStream(seed: number): (i: number) => number {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (1000 / 60) * (0.92 + (s / 0x7fffffff) * 0.16) }
}

// A tiny stable hash (FNV-1a, 32-bit) so the proof is stated as "two runs, equal digests" — no crypto
// dependency needed for a bit-identity assertion.
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

describe('determinism: same input → same playhead timeline (the rung’s deliverable)', () => {
  test('two fresh capture sessions on two different "machines" produce a bit-identical playhead sequence', () => {
    // Session A and session B each run the full engage → per-frame frameDeltaMs → disengage lifecycle
    // from clean module state, and each is fed a DIFFERENT wall-jitter stream (two machines' timing).
    // Identical sequences therefore prove BOTH claims at once: no module state carries across sessions,
    // and the per-frame wall delta never reaches the playhead while capture is engaged.
    const runA = captureSession({ tickCount: 75 }, 30, 75, jitterStream(1))
    const runB = captureSession({ tickCount: 75 }, 30, 75, jitterStream(0x5eed))
    expect(fnv1a(runA)).toBe(fnv1a(runB))
    expect(runA).toBe(runB)
  })

  test('the fixed-dt sequence differs from a wall-clock-jittered one — the flake the rung removes is real', () => {
    // OLD behavior: dtMs = now - last, straight from the wall. Drive the SAME session helper with capture
    // NEVER engaged (frameDeltaMs is then the identity, so the jitter reaches the playhead — the pre-rung
    // path exactly). Its sequence diverges from the captured one: before this rung, "the same capture"
    // was NOT frame-stable across machines.
    const captured = captureSession({ tickCount: 75 }, 60, 75, jitterStream(1))
    const wall = (() => {
      const jit = jitterStream(1)
      let s = { tick: 0, fraction: 0, done: false }
      const out: string[] = []
      for (let i = 0; i < 2000 && !s.done; i++) {
        s = advancePlayhead(s.tick, s.fraction, frameDeltaMs(jit(i)), 1, 75) // disengaged → identity → wall clock
        out.push(`${s.tick}:${s.fraction}`)
      }
      return out.join('|')
    })()
    expect(fnv1a(captured)).not.toBe(fnv1a(wall))
  })

  test('determinism holds on the real-clock tier with a non-1× store speed passed (inert during capture)', () => {
    // Two fresh f2a-shaped sessions, different jitter streams, and BOTH with the store at the 4× ladder
    // notch — which captureSpeed neutralizes while engaged (round 3), so the sequences are identical to
    // each other AND to a 1× session: the store speed is provably inert inside a full session lifecycle.
    const runA = captureSession({ tickCount: 96, dtUs: 125000 }, 30, 96, jitterStream(7), 4)
    const runB = captureSession({ tickCount: 96, dtUs: 125000 }, 30, 96, jitterStream(11), 4)
    expect(fnv1a(runA)).toBe(fnv1a(runB))
    expect(runA).toBe(runB)
    expect(captureSession({ tickCount: 96, dtUs: 125000 }, 30, 96, jitterStream(13), 1)).toBe(runA)
  })
})
