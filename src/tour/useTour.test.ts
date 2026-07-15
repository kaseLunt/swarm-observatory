import { describe, expect, test, vi } from 'vitest'
import { arrived, isForeignWrite, createDriver } from './useTour'
import { useViewStore } from '../state/viewStore'
import { trailFrameRequest, requestTrailFrame, requestEstablishFrame } from '../ui/frameChannels'
import type { Tour, TourShot } from './tourTypes'

// The schedulable CORE of the driver, extracted pure so it is unit-testable in the node-env vitest
// runner (the hook glue itself needs a DOM/store and is covered by Task 5's browser + smoke passes).

describe('arrived — play-step arrival predicate (tick >= to)', () => {
  test('exact boundary is arrival (74 >= 74)', () => {
    expect(arrived(74, 74)).toBe(true)
  })
  test('one tick short is not arrival (73 < 74)', () => {
    expect(arrived(73, 74)).toBe(false)
  })
  test('past the target is still arrival (75 >= 74)', () => {
    expect(arrived(75, 74)).toBe(true)
  })
})

describe('isForeignWrite — phase-aware user-interrupt discriminator', () => {
  const at = (tick: number, playing: boolean, selectedEvent: number | null, selectedEntity: string | null = null) =>
    ({ tick, playing, selectedEvent, selectedEntity })

  test('driving suppresses everything (our own bracketed writes are never foreign)', () => {
    // tick AND selection both change, yet driving=true → not foreign.
    expect(isForeignWrite(true, 'static', null, at(0, false, null), at(5, false, 1))).toBe(false)
    expect(isForeignWrite(true, 'playing', 74, at(0, true, null), at(5, false, 3))).toBe(false)
  })

  test('static + tick change → foreign (unbracketed scrub during a hold)', () => {
    expect(isForeignWrite(false, 'static', null, at(10, false, null), at(11, false, null))).toBe(true)
  })

  test('static + no observable change → not foreign', () => {
    expect(isForeignWrite(false, 'static', null, at(10, false, null), at(10, false, null))).toBe(false)
  })

  test('static + selection change → foreign', () => {
    expect(isForeignWrite(false, 'static', null, at(10, false, null), at(10, false, 7))).toBe(true)
  })

  test('static + entity-only change → foreign (belt: an entity click leaves selectedEvent untouched)', () => {
    // tick + selectedEvent unchanged; only selectedEntity flips (the common entity-click shape,
    // select(k, null)). The transport never writes selectedEntity, so this is a proven interrupt.
    expect(isForeignWrite(false, 'static', null, at(10, false, null, null), at(10, false, null, '1:4'))).toBe(true)
  })

  test('playing + entity-only change → foreign (belt during a play step)', () => {
    // During autoplay the rAF loop advances tick (expected), but an entity click still changes only
    // selectedEntity — caught before the phase branch so a scrub-blind play step still yields control.
    expect(isForeignWrite(false, 'playing', 74, at(10, true, null, null), at(11, true, null, '1:4'))).toBe(true)
  })

  test('playing + tick change → NOT foreign (the transport rAF advances tick every frame, expected)', () => {
    expect(isForeignWrite(false, 'playing', 74, at(10, true, null), at(11, true, null))).toBe(false)
  })

  test('playing + selection change → foreign (user selected during autoplay)', () => {
    expect(isForeignWrite(false, 'playing', 74, at(10, true, null), at(11, true, 5))).toBe(true)
  })

  test('playing + early pause (tick < target) → foreign (user paused before arrival)', () => {
    expect(isForeignWrite(false, 'playing', 74, at(30, true, null), at(30, false, null))).toBe(true)
  })

  test('playing + arrival pause (tick >= target) → NOT foreign (the driver/transport pause AT the target)', () => {
    expect(isForeignWrite(false, 'playing', 74, at(74, true, null), at(74, false, null))).toBe(false)
  })

  test('playing + pause with null target → treated as early pause (foreign)', () => {
    expect(isForeignWrite(false, 'playing', null, at(30, true, null), at(30, false, null))).toBe(true)
  })
})

// ── Tour-start finale clear (v0.5b T3 fix wave) ────────────────────────────────────────────────────
// A tour OWNS the stage: its opening beat must never render over a live natural-end finale's dressing.
// Both authored tours' step 0 happens to carry tick:0 (a scrub → setTick → finale:false), so this was
// safe only BY ACCIDENT; a future tour whose first step lacks a playhead move would open over stale
// finale dressing. start() now clears the finale unconditionally in its opening rest-transport bracket.
// Driven through the REAL createDriver + start() (a plain non-React factory, node-safe deps) so the fix is
// exercised on the actual code path — not a re-asserted store write.
describe('tour start clears a live finale (T3 fix wave)', () => {
  test('finale true → start() a tour whose step 0 has NO playhead move → finale false', () => {
    const driver = createDriver(() => {}, { current: null })
    useViewStore.setState({ finale: true })
    // A caption-only step 0: no tick/play/select/focus → stepActions is empty → NOTHING in the step moves the
    // playhead. The ONLY thing that can clear the finale on this start is the new start() bracket itself — so a
    // pass proves the fix (a fail would mean the opening beat ran over live finale dressing).
    const tour: Tour = { id: 't', runId: 'e0', title: 'T', steps: [{ caption: 'open', holdMs: 0 }] }
    driver.start(tour)
    const finaleAfterStart = useViewStore.getState().finale
    driver.dispose() // ALWAYS clean up (unsubscribe + clear the pending hold timer) before asserting, so a
    //                   failing assertion can't leak the hold timer into a later test (it fires syncUrl→history).
    expect(finaleAfterStart).toBe(false)
  })
})

// ── AUTHORED per-beat camera arrive (v0.7 T4) — driven through the REAL createDriver + start() ─────────────
// The step's `arrive` descriptor rides the EXISTING trail-frame channel on intent 'tour-arrival' (no new camera
// owner). These drive the SYNCHRONOUS fire sites (a static beat; a play beat already at its target) against the
// real driver + store + channel, so the wiring (enterStep captures pendingArrive → the fire site passes it to
// requestTrailFrame) is exercised on the actual code path. onArrived's async fire (a real play arrival) is the
// SAME requestTrailFrame(pendingArrive) call and is browser/smoke-verified. Each test rests the store first
// (module singleton) and disposes before asserting (clean up the subscription + the hold timer).
describe('authored per-beat camera arrive (T4)', () => {
  test('a static beat with an authored arrive fires it through the trail-frame channel (shot ref + tour-arrival intent)', () => {
    useViewStore.setState({ tick: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    const driver = createDriver(() => {}, { current: null })
    const arrive: TourShot = { kind: 'stage' }
    // A scrub+select+arrive static beat: enterStep runs the actions in the bracket, then (play === null) fires
    // the arrive AFTER the bracket (the tick is landed). All synchronous — no rAF needed.
    const tour: Tour = { id: 't', runId: 'f2a', title: 'T', steps: [{ tick: 5, select: { entity: '1:0', event: null }, arrive, caption: 'x', holdMs: 999999 }] }
    driver.start(tour)
    const shot = trailFrameRequest.shot
    const intent = trailFrameRequest.intent
    driver.dispose()
    expect(shot).toBe(arrive)           // the authored descriptor rode the channel by reference (zero-alloc)
    expect(intent).toBe('tour-arrival') // through the existing intent — the shot ⟹ tour-arrival invariant holds
  })

  test('a static beat with NO arrive makes no request of its own (opt-in) — start() supersede stands down, step 0 does not re-request', () => {
    useViewStore.setState({ tick: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    // Seed a PENDING tour-arrival shot (a prior tour's leftover). start()'s W1 supersede stands it down; then an
    // UN-AUTHORED step 0 must NOT re-request — so the channel STAYS a stand-down (cancelled, shot null). A request
    // would flip cancelled→false and set a shot, so this isolates the per-beat opt-in from the tour-start supersede.
    requestTrailFrame({ kind: 'head', distance: 'close' })
    const driver = createDriver(() => {}, { current: null })
    const tour: Tour = { id: 't', runId: 'f2a', title: 'T', steps: [{ tick: 5, select: { entity: '1:0', event: null }, caption: 'x', holdMs: 999999 }] }
    driver.start(tour) // step 0 has no arrive → the driver must make no trail-frame request of its own
    const shot = trailFrameRequest.shot
    const cancelled = trailFrameRequest.cancelled
    driver.dispose()
    expect(shot).toBeNull()      // start() stood the leftover down and step 0 requested nothing → no shot on the channel
    expect(cancelled).toBe(true) // still the supersede, not a fresh request → the un-authored static beat is byte-identical
  })

  test('a play beat already at its target fires the authored arrive on the early-arrived path (opt-in)', () => {
    useViewStore.setState({ tick: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    const driver = createDriver(() => {}, { current: null })
    const arrive: TourShot = { kind: 'head', distance: 'medium' }
    // play → 0 with tick already 0 → arrived(0, 0) → the early-arrived path lands + fires the arrive synchronously
    // (no rAF). Proves a play beat's arrive flows through pendingArrive → requestTrailFrame at that fire site.
    const tour: Tour = { id: 't', runId: 'f1', title: 'T', steps: [{ play: { to: 0, speed: 4 }, arrive, caption: 'x', holdMs: 999999 }] }
    driver.start(tour)
    const shot = trailFrameRequest.shot
    driver.dispose()
    expect(shot).toBe(arrive)
  })

  // W4: the MISSING coverage — a play beat that ACTUALLY CROSSES its target (not already there), firing the arrive
  // on the real async arrival path (onArrived), asserted on the emitted shot + a genuine stamp bump. The prior T4
  // tests only drove the two SYNCHRONOUS fire sites (a static beat; a play already-at-target); this drives the
  // subscription-detected arrival the tour actually runs, by simulating the transport rAF advancing the playhead.
  test('a play beat that CROSSES its target fires the authored arrive on the real arrival path (onArrived) — shot + stamp', () => {
    useViewStore.setState({ tick: 0, fraction: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    // Park the channel on a NON-tour-arrival intent so start()'s W1 supersede (cancelTourArrivalFrame, scoped to
    // 'tour-arrival') is a guaranteed no-op here — this isolates the ARRIVAL bump from the tour-start supersede.
    requestEstablishFrame()
    const driver = createDriver(() => {}, { current: null })
    const arrive: TourShot = { kind: 'conjunction' }
    const tour: Tour = { id: 't', runId: 'f2a', title: 'T', steps: [{ play: { to: 32, speed: 4 }, arrive, caption: 'x', holdMs: 999999 }] }
    const before = trailFrameRequest.stamp
    driver.start(tour) // enters step 0, STARTS the play (phase playing, target 32) — NOT yet arrived
    // BEFORE arrival: the play beat has requested nothing (a play arrive fires only at onArrived); start()'s supersede
    // is inert under the establish intent parked above.
    const midStamp = trailFrameRequest.stamp
    expect(midStamp).toBe(before)         // start() (supersede no-op) + startPlay made no trail-frame request
    expect(trailFrameRequest.shot).not.toBe(arrive)
    // Simulate the transport rAF advancing the playhead to the target → the driver's subscription detects arrival.
    useViewStore.setState({ tick: 32, fraction: 0 })
    const shot = trailFrameRequest.shot
    const intent = trailFrameRequest.intent
    const stamp = trailFrameRequest.stamp
    driver.dispose()
    expect(shot).toBe(arrive)             // the authored descriptor rode the channel AT the real arrival
    expect(intent).toBe('tour-arrival')
    expect(stamp).toBe(before + 1)        // exactly one bump — the arrival request the frame loop consumes
  })
})

// ── W2: step-boundary invalidation of a stale tour-arrival shot — the deferred-consume race ─────────────────
// A tour-arrival shot request writes ONE global channel; under a render suspension the hold timer (a plain
// setTimeout, alive across the suspension) can advance the driver to the NEXT beat before the frame loop consumes
// it — so a resumed frame would apply beat N-1's stale shot against beat N's live anchors and suppress beat N's
// follow. The driver invalidates the prior beat's owner at every step boundary (cancelTourArrivalFrame, i>0). This
// drives the race on the REAL driver + store + channel with fake timers: write a shot, advance the step WITHOUT
// consuming, and assert a deferred consume would see the CANCEL (stand down), not the stale shot.
describe('step-boundary camera invalidation — the deferred-consume race (W2)', () => {
  test('write shot, advance the step without consuming ⟹ the channel holds a CANCEL, not the stale shot', () => {
    vi.useFakeTimers()
    try {
      useViewStore.setState({ tick: 0, fraction: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
      const driver = createDriver(() => {}, { current: null })
      const shot0: TourShot = { kind: 'conjunction' }
      // beat 0 arrives shot0 then holds; beat 1 has NO arrive (a play-follow beat's shape — it requests nothing
      // until its own arrival), so nothing overwrites the channel after the boundary invalidation. This is the
      // suspended-frame-loop shape: beat 0's shot is pending, the hold timer fires, beat 1 begins.
      const tour: Tour = { id: 't', runId: 'f2a', title: 'T', steps: [
        { tick: 5, arrive: shot0, caption: 'b0', holdMs: 100 },
        { tick: 6, caption: 'b1', holdMs: 999999 },
      ] }
      driver.start(tour)
      // beat 0 landed its arrive: the stale shot is pending (the frame loop hasn't run).
      expect(trailFrameRequest.shot).toBe(shot0)
      expect(trailFrameRequest.cancelled).toBe(false)
      const pendingStamp = trailFrameRequest.stamp
      // Advance beat 0's hold → holdElapsed → enterStep(1): the boundary invalidation fires BEFORE beat 1's actions.
      vi.advanceTimersByTime(100)
      const cancelled = trailFrameRequest.cancelled
      const shot = trailFrameRequest.shot
      const stamp = trailFrameRequest.stamp
      driver.dispose()
      expect(cancelled).toBe(true)              // a deferred consume now STANDS DOWN — no stale framing applied
      expect(shot).toBeNull()                   // beat 0's shot was invalidated at the boundary, never applied to beat 1
      expect(stamp).toBeGreaterThan(pendingStamp) // the cancel superseded the unconsumed request (latest stamp wins)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── W1: step-0 arbitration — a fresh replay supersedes a completed tour's pending final shot ────────────────
// A NATURAL completion nulls `tour` WITHOUT cancelling the trail-frame channel (it routes engine 'done' → finish(),
// skipping stop()'s cancelTrailFrame), so the completed tour's FINAL arrival shot survives PENDING on the channel.
// A fresh replay then hits the restart cancel gated on `tour !== null` — now FALSE (completion nulled it) — so
// without the fix nothing stands the stale shot down, and a deferred consume applies it AFTER the tour-start reset:
// the replay opens on the prior close-shot with focus cleared. start()'s UNCONDITIONAL cancelTourArrivalFrame closes
// it. Driven on the REAL driver + store + channel with fake timers: run a one-beat tour to natural completion, prove
// the stale shot survives, then replay from idle and assert the channel holds a CANCEL, not the close-shot.
describe('step-0 arbitration — a fresh replay supersedes a completed tour\'s pending final shot (W1)', () => {
  test('pending final arrival → natural completion → fresh replay ⟹ the channel STANDS the stale shot down (tour-start posture, not the close-shot)', () => {
    vi.useFakeTimers()
    // Natural completion routes through finish(true) → syncUrl(true) → history.replaceState; the node-env test runner
    // has no `history`, so stub a minimal one for the URL write the browser would do (restored in finally).
    vi.stubGlobal('history', { replaceState: () => {} })
    try {
      useViewStore.setState({ tick: 0, fraction: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
      const driver = createDriver(() => {}, { current: null })
      const finalShot: TourShot = { kind: 'head', distance: 'close' }
      // A one-beat tour whose FINAL (only) beat authors a close-up arrive: on completion the beat's requestTrailFrame
      // leaves that shot PENDING (finish() never cancels — the natural-end path skips stop()'s cancelTrailFrame).
      const tour1: Tour = { id: 't1', runId: 'f1', title: 'T', steps: [{ tick: 0, arrive: finalShot, caption: 'end', holdMs: 100 }] }
      driver.start(tour1)
      expect(trailFrameRequest.shot).toBe(finalShot)   // the final arrive is on the channel
      // Advance the hold → holdElapsed → engine 'done' → finish(true): `tour` is nulled, the shot stays PENDING.
      vi.advanceTimersByTime(100)
      expect(trailFrameRequest.shot).toBe(finalShot)   // BUG PRECONDITION: the stale close-shot survives completion
      expect(trailFrameRequest.cancelled).toBe(false)
      const staleStamp = trailFrameRequest.stamp
      // FRESH REPLAY from idle (tour === null after completion → the restart cancel is SKIPPED). A caption-only
      // step 0 makes no trail request of its own, so the channel reflects ONLY start()'s unconditional stand-down.
      const tour2: Tour = { id: 't2', runId: 'f1', title: 'T', steps: [{ caption: 'open', holdMs: 999999 }] }
      driver.start(tour2)
      const cancelled = trailFrameRequest.cancelled
      const shot = trailFrameRequest.shot
      const stamp = trailFrameRequest.stamp
      driver.dispose()
      expect(cancelled).toBe(true)                 // the stale final shot is stood down — the replay opens on the tour-start posture
      expect(shot).toBeNull()                      // never the prior close-shot
      expect(stamp).toBeGreaterThan(staleStamp)    // the cancel superseded the pending request (latest stamp wins)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
