import { describe, expect, test } from 'vitest'
import { spineRevealCount } from './spine'

// spineRevealCount (v0.5c, owner amendment): the reveal count at the playhead. e0 fires one event per
// tick (seq == tick), so at tick t events 0..t are revealed; clamped to eventCount-1 (the last event) and
// floored at 0. drawRange-style: grows with the playhead, truncates on a scrub back (a pure function of tick,
// both directions) — the query stage (queryStageView) reuses it verbatim as its write-as-you-play head count.
describe('spineRevealCount (query-stage reveal clock)', () => {
  test('at tick t events 0..t are revealed, for e0 (eventCount 75)', () => {
    expect(spineRevealCount(0, 75)).toBe(0)   // tick 0: only the head event
    expect(spineRevealCount(1, 75)).toBe(1)
    expect(spineRevealCount(37, 75)).toBe(37) // the tour midpoint
    expect(spineRevealCount(74, 75)).toBe(74) // last event → the full record
  })
  test('clamps at the terminal ticks past the last event to the full record (e0 rests at tickCount 75 > seq 74)', () => {
    expect(spineRevealCount(75, 75)).toBe(74) // tick 75 (the natural-end rest) still holds the full record
    expect(spineRevealCount(1000, 75)).toBe(74)
  })
  test('monotonic forward, truncates backward (the reveal follows the tick BOTH directions)', () => {
    expect(spineRevealCount(40, 75)).toBeGreaterThan(spineRevealCount(20, 75)) // grew
    expect(spineRevealCount(20, 75)).toBeLessThan(spineRevealCount(40, 75))    // a scrub back truncates
  })
  test('floors a defensive negative tick to 0 (the store tick is always >= 0)', () => {
    expect(spineRevealCount(-5, 75)).toBe(0)
  })
  test('degenerate event counts collapse to 0 (no negative reveal count)', () => {
    expect(spineRevealCount(10, 1)).toBe(0) // a single-event run
    expect(spineRevealCount(10, 0)).toBe(0)
  })
})
