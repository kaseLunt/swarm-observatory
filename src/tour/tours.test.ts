import { describe, expect, test } from 'vitest'
import { TOURS, hasTour, tourTitle } from './tours'
import { LENSES } from '../ui/lensRegistry'
import type { TourShot, TourStep } from './tourTypes'

// ── e0 tour byte-identity pin (v0.8) ──────────────────────────────────────────────────────────────────
// This wave authored THREE camera arrives (beats 2/4/5) and touched NOTHING else: the reading windows (every
// caption + holdMs) and the un-authored beats (0/1/3) must survive verbatim — the f2a authored-arrive
// precedent ("captions/holds UNCHANGED, so the reading windows survive"). This pins that contract: the exact
// caption strings, the exact holdMs, the play/select/tick actions, and that ONLY beats 2/4/5 carry an arrive.
// A single-char caption edit or a moved hold fails here; so does an arrive added to a protected beat.

const e0 = TOURS.e0!

// The reading windows, verbatim. If a caption is re-worded the string OR its paired holdMs must change here in
// lockstep — this is the wall against a silent edit to the protected reading windows.
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

  test('every caption + holdMs is verbatim (the reading windows survive unchanged)', () => {
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
    // The three authored beats carry exactly the authored shots.
    expect(e0.steps[2]!.arrive).toEqual({ kind: 'corridor' })
    expect(e0.steps[4]!.arrive).toEqual({ kind: 'crane' })
    expect(e0.steps[5]!.arrive).toEqual({ kind: 'stage' })
  })

  // The COMPLETE per-step pin — toStrictEqual, NOT toMatchObject (subset). Any EXTRA or MISSING field fails: a
  // stray tick on a play beat, or an entity added beside an event-only select, no longer slips through. Composed
  // from the actions + the CAPTIONS fixture so each caption string lives in exactly one place.
  const E0_ACTIONS = [
    { tick: 0, select: { entity: null, event: null } },
    { play: { to: 20, speed: 4 } },
    { play: { to: 43, speed: 4 } },
    { select: { event: 39 } },
    { play: { to: 74, speed: 8 } },
    { tick: 74, select: { event: 74 } },
  ]
  const EXPECTED_E0_STEPS = CAPTIONS.map(([caption, holdMs, arrive], i) => ({ ...E0_ACTIONS[i]!, caption, holdMs, ...(arrive ? { arrive } : {}) }))
  test('every step is EXACTLY pinned — action, caption, holdMs, arrive; NO extra or missing field (toStrictEqual)', () => {
    expect(e0.steps).toStrictEqual(EXPECTED_E0_STEPS)
  })
})

// ── f2a tour byte-identity pin (v0.8.1) ──────────────────────────────────────────────────────────────────
// An f2a caption byte-pin was assumed to exist but did not — only e0's did (the pacing invariant checks the
// RATE, not the bytes; the browser test matches fragments). This closes the gap in the e0 pin's exact idiom:
// every caption string, every holdMs, every playhead/selection action, and every authored arrive pinned as an
// exact tuple. A single-char caption edit, a moved hold, a changed action, or a drifted arrive fails HERE — so
// silent drift is now impossible for BOTH shipped tours.
const f2a = TOURS.f2a!
const F2A_CAPTIONS: readonly [string, number, TourShot | undefined][] = [
  ['A single drone in real recorded flight, watched by a fixed sensor at the origin. Its field-of-view cone, range ring and the occluder sphere are scenario constants; the flight itself is decoded-real.', 9900, undefined],
  ['In range, and line of sight is clear — but the drone is still OUTSIDE the field-of-view cone, so the sensor does not admit it. In range and LOS clear are recomputed live; in FOV is the claim voice — a pinned angle, no bearing in the bundle to recompute.', 12700, { kind: 'conjunction' }],
  ['Watch it cross INTO the cone at the exact 3-4-5 edge — tick 55, a boundary the engine flags as a tie. The trail flips green and the sensor makes its first detection.', 8600, { kind: 'conjunction' }],
  ['Then the occluder cuts the line of sight: in range and in view, but blocked — so eligibility drops back to ember for a stretch.', 7000, { kind: 'conjunction', occluder: true }],
  ['The sightline clears and the drone is admitted again — right up to the exact max-range edge at tick 82, another boundary tie.', 6800, { kind: 'head', distance: 'medium' }],
  ['Ninety-six sensing verdicts. In range, LOS clear and eligibility are recomputed live in your browser and match the engine byte for byte; in FOV is shown honestly in the claim voice. Every view is a shareable URL.', 11400, { kind: 'stage' }],
]

describe('f2a tour — exact caption / hold / action / arrive byte-pin (parity with the e0 pin)', () => {
  test('six beats, identity unchanged', () => {
    expect(f2a.id).toBe('f2a-sensing')
    expect(f2a.runId).toBe('f2a')
    expect(f2a.title).toBe('What the sensor admits') // F2A_TOUR_TITLE — the owner's one-line swap point, pinned
    expect(f2a.steps).toHaveLength(6)
  })
  test('every caption + holdMs is verbatim (the reading windows are byte-frozen)', () => {
    f2a.steps.forEach((step, i) => {
      const [caption, holdMs] = F2A_CAPTIONS[i]!
      expect(step.caption).toBe(caption)
      expect(step.holdMs).toBe(holdMs)
    })
  })
  test('every authored arrive is pinned exactly (beat 0 un-authored; beats 1–5 carry their exact shot)', () => {
    f2a.steps.forEach((step, i) => {
      expect(step.arrive).toEqual(F2A_CAPTIONS[i]![2])
    })
    expect(f2a.steps[0]!.arrive).toBeUndefined()
    expect(f2a.steps[3]!.arrive).toEqual({ kind: 'conjunction', occluder: true }) // the occluder flag is load-bearing
    expect(f2a.steps[4]!.arrive).toEqual({ kind: 'head', distance: 'medium' })
    expect(f2a.steps[5]!.arrive).toEqual({ kind: 'stage' })
  })
  // The COMPLETE per-step pin — toStrictEqual, NOT toMatchObject (subset). Any EXTRA or MISSING field fails: an
  // entity added beside step 1's event-only select, or a stray tick on a play beat, no longer slips through.
  // Composed from the actions + F2A_CAPTIONS so each caption string lives in exactly one place.
  const F2A_ACTIONS = [
    { tick: 0, select: { entity: '1:0', event: null } },
    { tick: 48, select: { event: 99 } },
    { play: { to: 56, speed: 3 } },
    { play: { to: 67, speed: 4 } },
    { play: { to: 82, speed: 4 } },
    { tick: 95, select: { event: 211 } },
  ]
  const EXPECTED_F2A_STEPS = F2A_CAPTIONS.map(([caption, holdMs, arrive], i) => ({ ...F2A_ACTIONS[i]!, caption, holdMs, ...(arrive ? { arrive } : {}) }))
  test('every step is EXACTLY pinned — action, caption, holdMs, arrive; NO extra or missing field (toStrictEqual)', () => {
    expect(f2a.steps).toStrictEqual(EXPECTED_F2A_STEPS)
  })
})

// ── f4 comms tour byte-identity pin (the one lost packet) ─────────────────────────────────────────────────
// The same exact-tuple idiom as e0/f2a: every caption string, every holdMs, every playhead action, and every
// authored arrive pinned. A single-char caption edit, a moved hold, a changed play target, or a drifted arrive
// fails HERE. Load-bearing shape: beat 0 opens on the pre-framed stage (NO arrive); every later beat re-asserts
// the stage shot (authored stillness); the loss beat plays across tick 30 and RESTS AT tick 31 (never a paused
// tick 30 — that would freeze the launch frame, worst under reduced motion). NOTE: a play beat's `speed` is
// frozen here as step IDENTITY (anti-drift), NOT as pacing — the driver witness-normalizes every play span, so
// `speed` sets no flight rate; the one behavioral fact is the play TARGET, checked on its own below.
const f4 = TOURS.f4!
const F4_CAPTIONS: readonly [string, number, TourShot | undefined][] = [
  ['A real recorded link between two endpoints, and 32 messages sent across the whole run. Every timing and outcome is decoded; the endpoints are staged, not placed by position.', 8700, undefined],
  ['The pulses cross and the ledger climbs — sent and delivered rising together, nothing lost so far. The link keeps a steady beat.', 6400, { kind: 'stage' }],
  ['14 sent, 14 delivered, not one lost — so far. The next message launches at tick 30. Watch it.', 4700, { kind: 'stage' }],
  ['At tick 30 the fifteenth message — marked msg 14 — is sent, and never arrives. It fizzles at mid-span; the ledger splits to 1 lost so far, and the loss keeps a permanent mark: t30 · LOSS.', 9400, { kind: 'stage' }],
  ['The link resumes and every later message arrives — the lost count holds at 1. The whole run: 32 sent, 31 delivered, and the 1 that never arrived, still there to point at.', 8600, { kind: 'stage' }],
  ['Across the whole run, two readings agree — 32 causation edges and 31 delivered receipts — both point at the same lost packet. The check is self-consistent, not an outside seal: msg 14 — the fifteenth sent — never arrived, a channel loss, not a byte-mismatch. This run and tick can be shared by URL.', 15000, { kind: 'stage' }],
]

describe('f4 tour — exact caption / hold / action / arrive byte-pin (the loss beat rests at tick 31)', () => {
  test('six beats, identity unchanged', () => {
    expect(f4.id).toBe('f4-comms')
    expect(f4.runId).toBe('f4')
    expect(f4.title).toBe('The one lost packet')
    expect(f4.steps).toHaveLength(6)
  })
  test('every caption + holdMs is verbatim (the reading windows are byte-frozen)', () => {
    f4.steps.forEach((step, i) => {
      const [caption, holdMs] = F4_CAPTIONS[i]!
      expect(step.caption).toBe(caption)
      expect(step.holdMs).toBe(holdMs)
    })
  })
  test('the camera is authored stillness — beat 0 pre-framed (no arrive); every later beat re-asserts the stage shot', () => {
    f4.steps.forEach((step, i) => {
      expect(step.arrive).toEqual(F4_CAPTIONS[i]![2])
    })
    expect(f4.steps[0]!.arrive).toBeUndefined() // beat 0 opens on the composed stage the tour-start reset frames
    for (const i of [1, 2, 3, 4, 5]) expect(f4.steps[i]!.arrive).toEqual({ kind: 'stage' })
  })
  test('THE LOSS BEAT plays across tick 30 and rests AT tick 31 — never a paused tick 30, never a fractional tick', () => {
    const loss = f4.steps[3]!
    // The REST TARGET is the one behavioral fact: play through to tick 31 (inside the afterglow window (30, 34)),
    // NOT a paused tick 30 (which would freeze the launch frame, worst under reduced motion). `speed` is authored
    // intent only (witness-normalized), so it is NOT asserted here as pacing — only the target and its integrality.
    expect(loss.play?.to).toBe(31)
    expect(loss.tick).toBeUndefined()               // NOT a paused scrub (a paused tick 30 freezes the launch frame)
    expect(Number.isInteger(loss.play!.to)).toBe(true) // the target is an integer — no fractional-tick hazard
  })
  // The COMPLETE per-step pin — toStrictEqual, NOT toMatchObject: any EXTRA or MISSING field fails. Composed from
  // the actions + F4_CAPTIONS so each caption string lives in exactly one place.
  const F4_ACTIONS = [
    { tick: 0, select: { entity: null, event: null } },
    { play: { to: 20, speed: 4 } },
    { play: { to: 29, speed: 2 } },
    { play: { to: 31, speed: 1 } },
    { play: { to: 95, speed: 4 } },
    { tick: 95 },
  ]
  const EXPECTED_F4_STEPS = F4_CAPTIONS.map(([caption, holdMs, arrive], i) => ({ ...F4_ACTIONS[i]!, caption, holdMs, ...(arrive ? { arrive } : {}) }))
  test('every step is EXACTLY pinned — action, caption, holdMs, arrive; NO extra or missing field (toStrictEqual)', () => {
    expect(f4.steps).toStrictEqual(EXPECTED_F4_STEPS)
  })
})

// ── TOUR-POINTER DRIFT — every registered lens agrees with the authored tours ─────────────────────────────
// A lens registration's tourId is the DERIVED pointer at the authored TOURS registry: "a tour exists for this
// run" is stored ONCE (in TOURS), and the registration must not carry a second, drifting copy of that fact. The
// pin is generic over the registry, so a newly-authored tour that flips its lens's tourId — or forgets to — is
// caught by the SAME test: for every registered lens, HAVING a tourId is EXACTLY having an authored tour for the
// run it draws, and the pointer resolves to that run's tour. (A lens id is `<run>-<lens>`, so the run it draws is
// the id's prefix.) This covers the sibling belief lens the moment its tour lands, with no test change.
const runOf = (lensId: string): string => lensId.slice(0, lensId.indexOf('-'))

describe('tour-pointer drift — a lens declares a tourId iff its run has an authored tour, and they agree', () => {
  test.each(LENSES.map(l => [l.id, l] as const))('%s: tourId is set exactly when its run has a tour, and points at it', (_id, lens) => {
    const runId = runOf(lens.id)
    expect(lens.tourId !== null).toBe(hasTour(runId)) // the biconditional — no dangling pointer, no unlit handoff
    if (lens.tourId !== null) {
      expect(TOURS[runId]!.id).toBe(lens.tourId)            // the pointer resolves to THIS run's authored tour…
      expect(tourTitle(runId)).toBe(TOURS[runId]!.title)   // …and the title the Hangar handoff reads agrees
    }
  })
})

// ── caption pacing — the house ship gate, as a class-retiring invariant (v0.8) ────────────────────────────
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
