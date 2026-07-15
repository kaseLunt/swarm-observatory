import { expect, test } from 'vitest'
import { clampSpeed, DEFAULT_SPEED, isLadderSpeed, shareSpeed, SPEEDS } from './speeds'
import { witnessSpeed } from './transport'

test('clampSpeed snaps a below-range value to the nearest SPEEDS member (-5 → 0.25)', () => {
  expect(clampSpeed(-5)).toBe(0.25)
})
test('clampSpeed defaults non-finite input to 1× (Infinity / NaN → 1)', () => {
  expect(clampSpeed(Infinity)).toBe(1)
  expect(clampSpeed(NaN)).toBe(1)
})

test('isLadderSpeed is exact ladder membership — every notch in, everything else out', () => {
  for (const s of SPEEDS) expect(isLadderSpeed(s)).toBe(true)
  // The witness presentation pace sits BETWEEN notches — the exact off-ladder signal Timeline dims on.
  expect(isLadderSpeed(0.7111)).toBe(false)
  expect(isLadderSpeed(1.3333)).toBe(false)
  expect(isLadderSpeed(2)).toBe(false) // not a member of [0.25, 1, 4, 8]
})

// W2 — the share-link speed guard: a ladder speed rides as-is, a tour's off-ladder witness pace collapses
// to the resting default (which encodeLink then omits), so the URL never carries the presentation artifact.
test('shareSpeed passes a real ladder speed through unchanged', () => {
  for (const s of SPEEDS) expect(shareSpeed(s)).toBe(s)
})
test('shareSpeed collapses an OFF-LADDER value to the resting default — never the witness value', () => {
  expect(shareSpeed(0.7111)).toBe(DEFAULT_SPEED)
  expect(shareSpeed(1.3333)).toBe(DEFAULT_SPEED)
})
test('shareSpeed collapses the ACTUAL shipped-tour witness speeds (e0, f1) to the default', () => {
  // The real presentation rates a tour writes to the store during a play step (transport.ts: e0 ≈ 0.7111,
  // f1 ≈ 1.3333). Both are off-ladder → both collapse, so a copy-link mid-tour can never poison the URL
  // with the witness pace — the W2 leak, closed at its source.
  const e0Witness = witnessSpeed(20, 75) // e0-hero step-2 play span (0 → 20 of 75 ticks)
  const f1Witness = witnessSpeed(32, 64) // an f1 tour play span
  expect(isLadderSpeed(e0Witness)).toBe(false)
  expect(isLadderSpeed(f1Witness)).toBe(false)
  expect(shareSpeed(e0Witness)).toBe(DEFAULT_SPEED)
  expect(shareSpeed(f1Witness)).toBe(DEFAULT_SPEED)
})
test('DEFAULT_SPEED is a real ladder member (the collapse target is itself a valid resting speed)', () => {
  expect(isLadderSpeed(DEFAULT_SPEED)).toBe(true)
  expect(clampSpeed(DEFAULT_SPEED)).toBe(DEFAULT_SPEED)
})
