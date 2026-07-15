import { describe, expect, test } from 'vitest'
import { tickAtX } from './Timeline'

// Pure pixel→tick mapping extracted from Timeline's pointer handlers (the component glue that reads a
// live DOMRect is covered by the smoke pass). The load-bearing property is the UPPER clamp: a drag past
// the right edge must rest ON the final tick, never beyond it (setTick only clamps the lower bound).

describe('tickAtX — clamped pixel→tick mapping (rect at left=0, width=100, tickCount=75)', () => {
  const rectLeft = 0, rectWidth = 100, tickCount = 75

  test('left edge → tick 0', () => {
    expect(tickAtX(0, rectLeft, rectWidth, tickCount)).toBe(0)
  })
  test('right edge → the final tick (tickCount)', () => {
    expect(tickAtX(100, rectLeft, rectWidth, tickCount)).toBe(75)
  })
  test('midpoint → rounded interior tick', () => {
    expect(tickAtX(50, rectLeft, rectWidth, tickCount)).toBe(38) // round(0.5 * 75) = 38
  })
  test('drag PAST the right edge clamps to the final tick (the bug: no rest beyond tickCount)', () => {
    expect(tickAtX(140, rectLeft, rectWidth, tickCount)).toBe(75)
  })
  test('a non-zero rect origin is honored (offset subtracted before scaling)', () => {
    // rect starting at left=200, width=100: clientX=250 is the midpoint.
    expect(tickAtX(250, 200, 100, tickCount)).toBe(38)
    // Past the right edge (clientX beyond 300) still clamps to tickCount.
    expect(tickAtX(500, 200, 100, tickCount)).toBe(75)
  })
})
