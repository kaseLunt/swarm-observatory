import { describe, expect, test } from 'vitest'
import { densityBins, densityMode, MARKS_MAX } from './density'

test('bins events by tick and normalizes to max 1', () => {
  const ticks = Float64Array.from([0, 0, 0, 5, 9])
  const bins = densityBins(ticks, 10, 5)
  expect(bins.length).toBe(5)
  expect(bins[0]).toBe(1)       // 3 events in ticks 0-1 → max bin
  expect(bins[2]).toBeCloseTo(1 / 3) // 1 event in ticks 4-5
  expect(bins[4]).toBeCloseTo(1 / 3)
})
test('empty run yields zeros', () => {
  expect([...densityBins(new Float64Array(0), 10, 4)]).toEqual([0, 0, 0, 0])
})

describe('densityMode — progressive ticks→heat threshold', () => {
  test('MARKS_MAX is derived from the 1200px buffer at 3px pitch → 400', () => {
    expect(MARKS_MAX).toBe(400)
  })
  test('sparse lanes (today\'s fixtures) render individual marks', () => {
    expect(densityMode(0)).toBe('ticks')   // empty lane
    expect(densityMode(75)).toBe('ticks')  // e0
    expect(densityMode(67)).toBe('ticks')  // f1
  })
  test('the switch is exactly at MARKS_MAX: at-or-under = ticks, over = heat', () => {
    expect(densityMode(MARKS_MAX)).toBe('ticks')     // 400 marks still seat
    expect(densityMode(MARKS_MAX + 1)).toBe('heat')  // 401 would smear → heat
  })
})
