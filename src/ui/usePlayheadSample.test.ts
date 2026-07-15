import { expect, test } from 'vitest'
import { shouldSampleImmediately } from './usePlayheadSample'

// The hook wiring (subscribe + setInterval) needs a DOM/renderHook harness this repo does not carry
// (v0.1 convention: React hooks without a DOM test lib are out of unit scope). We instead extract and
// cover the one decision that governs the panel's feel: WHEN a store change bypasses the interval
// throttle. Everything else (interval cadence, unsubscribe) is typecheck- and browser-verified.

test('paused: every store change samples immediately (scrub/select must feel instant)', () => {
  expect(shouldSampleImmediately(false, false)).toBe(true)
})
test('pause→play edge samples immediately (transport toggle is not throttled)', () => {
  expect(shouldSampleImmediately(true, false)).toBe(true)
})
test('play→pause edge samples immediately (rest on the final scrubbed tick at once)', () => {
  expect(shouldSampleImmediately(false, true)).toBe(true)
})
test('playing steadily: per-change sampling is suppressed so the interval alone throttles', () => {
  expect(shouldSampleImmediately(true, true)).toBe(false)
})
