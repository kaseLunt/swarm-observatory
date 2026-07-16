import { describe, expect, test } from 'vitest'
import { TOURS } from './tours'
import type { TourShot, TourStep } from './tourTypes'

// ── e0 tour byte-identity pin (v0.8 W7) ──────────────────────────────────────────────────────────────────
// W7 authored THREE camera arrives (beats 2/4/5) and touched NOTHING else: the §5 reading windows (every
// caption + holdMs) and the un-authored beats (0/1/3) must survive verbatim — the f2a authored-arrive
// precedent ("captions/holds UNCHANGED, so the §5 windows survive"). This pins that contract: the exact
// caption strings, the exact holdMs, the play/select/tick actions, and that ONLY beats 2/4/5 carry an arrive.
// A single-char caption edit or a moved hold fails here; so does an arrive added to a protected beat.

const e0 = TOURS.e0!

// The reading windows, verbatim. If a caption is re-worded the string OR its paired holdMs must change here in
// lockstep — this is the wall against a silent edit to the protected §5 windows.
const CAPTIONS: readonly [string, number, TourShot | undefined][] = [
  ['A real run bundle — 75 geometry queries, replayed as the geometry they resolved. Its event and state hashes recomputed and matched its own seal, on load.', 7700, undefined],
  ['Playback is exact replay — every tick is the authoritative recorded state, never simulation. Act I writes the world: points land inside or outside the sphere and box, and rays reach out and STOP where they strike a solid.', 11100, undefined],
  ['Act II — sightlines from the origin. A line of sight reaches for a far target and dies at the first solid in its way: at tick 39 the sphere blocks it, and the sightline stops dead at the contact where it hit.', 10400, { kind: 'corridor' }],
  ['Select any query to check the math. This blocked sightline’s verdict is recomputed live in your browser from the decoded numbers — the engine’s answer and ours agree, on all 75.', 8900, undefined],
  ['Act III — a second observer, drawn per-seed at n=−601, interrogates the same world from a new vantage. After the tour, press O to stand at its eye and look down the sightline.', 8800, { kind: 'crane' }],
  ['The closing beat — a clear line of sight sails clean through empty space. One run, 75 queries, self-checked on load. Explore freely: every view is a shareable URL.', 8400, { kind: 'stage' }],
]

describe('e0 tour — the authored arrives ride on top of byte-untouched captions/holds', () => {
  test('six beats, identity unchanged', () => {
    expect(e0.id).toBe('e0-hero')
    expect(e0.runId).toBe('e0')
    expect(e0.title).toBe('The query stage')
    expect(e0.steps).toHaveLength(6)
  })

  test('every caption + holdMs is verbatim (the §5 reading windows survive W7 unchanged)', () => {
    e0.steps.forEach((step, i) => {
      const [caption, holdMs] = CAPTIONS[i]!
      expect(step.caption).toBe(caption)
      expect(step.holdMs).toBe(holdMs)
    })
  })

  test('ONLY beats 2/4/5 gained an arrive — beats 0/1/3 are still un-authored (no camera move)', () => {
    e0.steps.forEach((step, i) => {
      expect(step.arrive).toEqual(CAPTIONS[i]![2])
    })
    // The three protected beats declare NO arrive (their frames are owned by the tour-start reset / the inspector).
    expect(e0.steps[0]!.arrive).toBeUndefined()
    expect(e0.steps[1]!.arrive).toBeUndefined()
    expect(e0.steps[3]!.arrive).toBeUndefined()
    // The three authored beats carry exactly the W7 shots.
    expect(e0.steps[2]!.arrive).toEqual({ kind: 'corridor' })
    expect(e0.steps[4]!.arrive).toEqual({ kind: 'crane' })
    expect(e0.steps[5]!.arrive).toEqual({ kind: 'stage' })
  })

  test('the playhead + selection actions of every beat are unchanged', () => {
    expect(e0.steps[0]).toMatchObject({ tick: 0, select: { entity: null, event: null } })
    expect(e0.steps[1]).toMatchObject({ play: { to: 20, speed: 4 } })
    expect(e0.steps[2]).toMatchObject({ play: { to: 43, speed: 4 } })
    expect(e0.steps[3]).toMatchObject({ select: { event: 39 } })
    expect(e0.steps[4]).toMatchObject({ play: { to: 74, speed: 8 } })
    expect(e0.steps[5]).toMatchObject({ tick: 74, select: { event: 74 } })
  })
})

// ── caption pacing — the house ship gate, as a class-retiring invariant (v0.8 W7) ────────────────────────────
// The rule CAPS reading DEMAND at 20 characters/second — equivalently, it grants at least 50 ms of dwell per
// character: caption.length / (holdMs/1000) ≤ 20. And the hold must be a finite, POSITIVE dwell in the first
// place: TourStep requires BOTH caption and holdMs (tourTypes.ts), so a captioned step with a missing / negative /
// zero / NaN / Infinity hold is not a skip case — it is a HARD failure (a zero/negative hold flashes-and-vanishes,
// and a raw negative flows straight into useTour's setTimeout). Only a finite positive hold earns a rate check.
const MAX_CHARS_PER_SEC = 20

// The pacing predicate as a PURE helper: returns a human-readable problem description, or null when the step's
// caption pacing is sound. Used by the per-step generated invariant below AND unit-tested directly against the
// invalid-hold regression cases (negative / zero / NaN / Infinity / over-rate).
function captionPacingProblem(step: TourStep): string | null {
  const { caption, holdMs } = step
  if (!Number.isFinite(holdMs) || holdMs <= 0) {
    return `holdMs must be a finite, positive dwell, got ${holdMs}`
  }
  const rate = caption.length / (holdMs / 1000)
  if (rate > MAX_CHARS_PER_SEC) {
    return `reads at ${rate.toFixed(3)} ch/s (> ${MAX_CHARS_PER_SEC}); raise holdMs or shorten the caption`
  }
  return null
}

// Parameterized over EVERY tour and EVERY step (all steps are captioned — caption is required), so a future tour
// that overruns the reading budget OR carries an invalid hold fails HERE at author time rather than shipping —
// retiring the violation class, not just the two beats that tripped it.
describe('caption pacing — every step caps reading demand at 20 ch/s with a finite positive hold (every tour)', () => {
  for (const [runId, tour] of Object.entries(TOURS)) {
    tour.steps.forEach((step, i) => {
      test(`${runId} step ${i} — legal caption pacing`, () => {
        const problem = captionPacingProblem(step)
        expect(problem, problem === null ? undefined : `${runId} step ${i}: ${problem}`).toBeNull()
      })
    })
  }
})

// Direct regression tests on the predicate — the review demanded every invalid hold be flagged, not silently
// skipped or rate-checked into a false pass.
describe('captionPacingProblem — flags every invalid hold, passes only finite-positive sound ones', () => {
  const mk = (caption: string, holdMs: number): TourStep => ({ caption, holdMs })
  test('a comfortably-paced caption is sound (null)', () => {
    expect(captionPacingProblem(mk('short enough for its dwell', 5000))).toBeNull()
  })
  test('the ≤ 20 ch/s boundary is INCLUSIVE — 198ch @ 9900ms and 208ch @ 10400ms are IEEE-exact 20.000, sound', () => {
    expect(captionPacingProblem(mk('x'.repeat(198), 9900))).toBeNull()
    expect(captionPacingProblem(mk('x'.repeat(208), 10400))).toBeNull()
  })
  test('an over-rate caption (> 20 ch/s) is flagged, and the message carries the computed rate', () => {
    const p = captionPacingProblem(mk('x'.repeat(198), 9800)) // 20.204 ch/s
    expect(p).not.toBeNull()
    expect(p).toMatch(/20\.204 ch\/s/)
  })
  test('a NEGATIVE hold is flagged (the −9900 mutation the review caught: rate −20 would falsely pass ≤ 20)', () => {
    const p = captionPacingProblem(mk('anything', -9900))
    expect(p).not.toBeNull()
    expect(p).toMatch(/finite, positive/)
  })
  test('a ZERO hold is flagged (a caption with no dwell flashes and vanishes)', () => {
    expect(captionPacingProblem(mk('anything', 0))).not.toBeNull()
  })
  test('a NaN hold is flagged (never a real dwell)', () => {
    expect(captionPacingProblem(mk('anything', Number.NaN))).not.toBeNull()
  })
  test('an INFINITY hold is flagged (rate collapses to 0, which would falsely pass without the finiteness guard)', () => {
    expect(captionPacingProblem(mk('anything', Number.POSITIVE_INFINITY))).not.toBeNull()
  })
})
