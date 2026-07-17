import { describe, expect, test, vi } from 'vitest'
import { useViewStore, syncUrl, __resetSyncUrl } from './viewStore'

// The store's setSpeed clamps to the nearest SPEEDS member. The rest of the store is browser glue
// (URL sync, r3f wiring) exercised in the smoke/browser passes; only the clamp is unit-tested here.
test('setSpeed clamps a below-range value to the nearest SPEEDS member (0 → 0.25)', () => {
  useViewStore.getState().setSpeed(0)
  expect(useViewStore.getState().speed).toBe(0.25)
})
test('setSpeed clamps an above-range value to the nearest SPEEDS member (999 → 8)', () => {
  useViewStore.getState().setSpeed(999)
  expect(useViewStore.getState().speed).toBe(8)
})
test('setSpeed keeps an exact SPEEDS member unchanged (4 → 4)', () => {
  useViewStore.getState().setSpeed(4)
  expect(useViewStore.getState().speed).toBe(4)
})
test('applyLink clamps an out-of-range speed to the nearest SPEEDS member (999 → 8)', () => {
  useViewStore.getState().applyLink({ speed: 999 })
  expect(useViewStore.getState().speed).toBe(8)
})

// Trailing-edge URL flush. syncUrl throttles unforced writes to one per 500ms; without a trailing
// flush the LAST write of a rapid unforced burst is silently dropped, leaving the URL stale. These
// run in NODE env (no browser globals) so history/location/performance are stubbed; performance.now
// is aliased to Date.now so it advances with the fake-timer clock. __resetSyncUrl() at the top of
// each keeps the module-level lastSync/pendingTimer from leaking across tests (order-independence).
test('trailing flush writes the latest state after a dropped throttled call', () => {
  vi.useFakeTimers()
  const replaceState = vi.fn()
  vi.stubGlobal('history', { replaceState })
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('performance', { now: () => Date.now() })
  __resetSyncUrl()
  useViewStore.setState({ runId: 'f0', tick: 1, playing: false }); syncUrl(true) // forced write lands
  useViewStore.setState({ tick: 5 }); syncUrl()                                  // throttled → trailing flush scheduled
  expect(replaceState).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(600)
  expect(replaceState).toHaveBeenCalledTimes(2)
  expect(replaceState.mock.lastCall![2]).toContain('tick=5')                     // latest state, not the dropped one
  vi.unstubAllGlobals(); vi.useRealTimers()
})

test('a forced write cancels a pending trailing flush (exactly two writes, not three)', () => {
  vi.useFakeTimers()
  const replaceState = vi.fn()
  vi.stubGlobal('history', { replaceState })
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('performance', { now: () => Date.now() })
  __resetSyncUrl()
  useViewStore.setState({ runId: 'f0', tick: 1, playing: false }); syncUrl(true) // write 1 (forced)
  useViewStore.setState({ tick: 5 }); syncUrl()                                  // throttled → flush scheduled
  useViewStore.setState({ tick: 9 }); syncUrl(true)                              // write 2 (forced) cancels the flush
  expect(replaceState).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(600)
  expect(replaceState).toHaveBeenCalledTimes(2)                                  // flush cancelled → no third write
  expect(replaceState.mock.lastCall![2]).toContain('tick=9')
  vi.unstubAllGlobals(); vi.useRealTimers()
})

// FINALE flag grammar. The finale is ephemeral display state — true only at a NATURAL play-to-end
// rest (the Timeline transport batch writes it; simulated here by a raw setState({finale:true}), which is
// EXACTLY the natural-end edge's write). It is cleared by any playhead MOVE and by a run-switch; it survives a
// selection / speed tap / pause. This is the full clearing / non-clearing grammar matrix, plus the
// play-at-rest re-fire (Space at rest clears then the natural-end edge re-sets → net kept) and the run-switch
// clear (a finale must never bleed into the next run). The natural-end edge itself and the module-flag
// non-clearers (orbit drag, help overlay — neither calls a store action) are browser-verified.
describe('finale flag grammar', () => {
  // The natural-end edge's write, verbatim (Timeline sets finale inside its transport batch).
  const naturalEnd = () => useViewStore.setState({ finale: true })

  test('a scrub (setTick) clears the finale', () => {
    naturalEnd()
    useViewStore.getState().setTick(5)
    expect(useViewStore.getState().finale).toBe(false)
  })

  test('an arrow-key step (also setTick) clears the finale', () => {
    naturalEnd()
    useViewStore.getState().setTick(3)
    expect(useViewStore.getState().finale).toBe(false)
  })

  test('a step at natural rest (setTick to the SAME tick, fraction 0) KEEPS the finale — zero motion is not a MOVE', () => {
    // ArrowRight at the end rail: App clamps the step target to tickCount, so setTick receives the tick the
    // playhead already rests on. The move-guard (final wave) keeps the finale — only a MOVE clears.
    useViewStore.setState({ tick: 42, fraction: 0 })
    naturalEnd()
    useViewStore.getState().setTick(42)
    expect(useViewStore.getState().finale).toBe(true)
    expect(useViewStore.getState().tick).toBe(42)
    expect(useViewStore.getState().fraction).toBe(0)
  })

  test('setTick to the SAME tick from mid-fraction (fraction > 0) CLEARS the finale — landing on the tick boundary IS a move', () => {
    useViewStore.setState({ tick: 42, fraction: 0.5 })
    naturalEnd()
    useViewStore.getState().setTick(42)
    expect(useViewStore.getState().finale).toBe(false)
    expect(useViewStore.getState().fraction).toBe(0)
  })

  test('starting play (setPlaying(true)) clears the finale', () => {
    naturalEnd()
    useViewStore.getState().setPlaying(true)
    expect(useViewStore.getState().finale).toBe(false)
  })

  test('a selection (select) does NOT clear the finale — selection re-lenses over the lit rest', () => {
    naturalEnd()
    useViewStore.getState().select('1:0', 5)
    expect(useViewStore.getState().finale).toBe(true)
  })

  test('a speed tap (setSpeed) does NOT clear the finale', () => {
    naturalEnd()
    useViewStore.getState().setSpeed(4)
    expect(useViewStore.getState().finale).toBe(true)
  })

  test('pausing (setPlaying(false)) does NOT clear the finale (it only ever rests true)', () => {
    naturalEnd()
    useViewStore.getState().setPlaying(false)
    expect(useViewStore.getState().finale).toBe(true)
  })

  test('a deep-link (applyLink) never FIRES the finale — even a link straight to tick=maxTick (accepted asymmetry)', () => {
    useViewStore.setState({ finale: false })
    useViewStore.getState().applyLink({ tick: 999 })
    expect(useViewStore.getState().finale).toBe(false)
  })

  test('applyLink CLEARS a live finale (playhead-move hardening) — a history replay never lands over stale finale dressing', () => {
    // applyLink moves the playhead (l.tick), and a playhead move clears the finale (the clear grammar, same as
    // setTick). Safe today (mount-only, finale already false), latent once history nav replays a link over a
    // stale finale rest. finale is never serialized, so applyLink only ever CLEARS it, never SETS it.
    naturalEnd()
    useViewStore.getState().applyLink({ tick: 3 })
    expect(useViewStore.getState().finale).toBe(false)
  })

  test('play-at-rest KEEPS the finale (r1): setPlaying(true) clears it, the natural-end edge re-fires and re-sets it', () => {
    // Space at rest → setPlaying(true) clears the finale; then the Timeline natural-end edge RE-FIRES
    // (advancePlayhead no-ops at the clamp, a.done && s.playing true again for one frame) and re-sets it.
    // The set is idempotent and wins because it lands AFTER the clear. Net: the finale is kept.
    naturalEnd()
    useViewStore.getState().setPlaying(true)
    expect(useViewStore.getState().finale).toBe(false)          // cleared on the play rising edge
    useViewStore.setState({ playing: false })                   // transport clamps playing false at maxTick
    naturalEnd()                                                // the natural-end gate re-sets it
    expect(useViewStore.getState().finale).toBe(true)           // net: play-at-rest keeps the finale
  })

  test('run-switch clears the finale (App.selectRun resets it in the same atomic batch — never bleeds into the next run)', () => {
    naturalEnd()
    // selectRun's atomic reset, verbatim (with finale:false — the invariant-before-publish clear).
    useViewStore.setState({ runId: 'f0', tick: 0, fraction: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    expect(useViewStore.getState().finale).toBe(false)
  })
})

// SESSION-SEAL (the checkmark economy). recordSeal records a run whose ceremony
// sealed green this session — the run id AND the resultId its ✓ vouches for; breakSeal flags a seal a
// later mismatched re-load contradicted (the Hangar then voices that card in the alarm ✗ register). The
// pure state machine is unit-tested in hangar.test.ts (recordSeal/breakSeal); here we pin the store
// wiring: it starts empty (no persisted/build-time ✓), accumulates, replaces on different verified
// bytes, breaks on contradiction, and no-ops (reference-stable) on repeats.
describe('session-seal', () => {
  test('sealedRuns starts empty — no run is verified before a ceremony runs this session', () => {
    useViewStore.setState({ sealedRuns: [] })
    expect(useViewStore.getState().sealedRuns).toEqual([])
  })
  test('recordSeal records a sealed run (id + resultId), and a second run accumulates', () => {
    useViewStore.setState({ sealedRuns: [] })
    useViewStore.getState().recordSeal('e0', 'res-e0')
    expect(useViewStore.getState().sealedRuns).toEqual([{ runId: 'e0', resultId: 'res-e0', broken: false }])
    useViewStore.getState().recordSeal('f0', 'res-f0')
    expect(useViewStore.getState().sealedRuns).toEqual([
      { runId: 'e0', resultId: 'res-e0', broken: false }, { runId: 'f0', resultId: 'res-f0', broken: false },
    ])
  })
  test('re-sealing the same run+bytes is a no-op — the array reference is unchanged (no churn / re-render)', () => {
    useViewStore.setState({ sealedRuns: [{ runId: 'e0', resultId: 'res-e0', broken: false }] })
    const before = useViewStore.getState().sealedRuns
    useViewStore.getState().recordSeal('e0', 'res-e0')
    expect(useViewStore.getState().sealedRuns).toBe(before)
  })
  test('a later verified load with DIFFERENT bytes replaces the record through the store (item 1a)', () => {
    useViewStore.setState({ sealedRuns: [{ runId: 'e0', resultId: 'res-A', broken: false }] })
    useViewStore.getState().recordSeal('e0', 'res-B')
    expect(useViewStore.getState().sealedRuns).toEqual([{ runId: 'e0', resultId: 'res-B', broken: false }])
  })
  test('breakSeal flags a contradicted seal through the store (item 1b); breaking unsealed is a stable no-op', () => {
    useViewStore.setState({ sealedRuns: [{ runId: 'e0', resultId: 'res-A', broken: false }] })
    useViewStore.getState().breakSeal('e0')
    expect(useViewStore.getState().sealedRuns).toEqual([{ runId: 'e0', resultId: 'res-A', broken: true }])
    const before = useViewStore.getState().sealedRuns
    useViewStore.getState().breakSeal('f0') // never sealed → no record, no churn
    expect(useViewStore.getState().sealedRuns).toBe(before)
  })
})
