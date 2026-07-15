import { expect, test } from 'vitest'
import { advancePlayhead, witnessSpeed, WITNESS_RUN_SECONDS } from './transport'
import { SPEEDS } from './speeds'

// ── Rate: witness-normalized (run-normalized) pacing ─────────────────────────────────────────────
// The new base: at 1× the playhead covers a WHOLE run (0 → maxTick) in ~WITNESS_RUN_SECONDS of wall
// time, regardless of tick count or recorded dt. The per-frame delta is speed·maxTick/W ticks, so the
// duration depends only on the run length and the speed multiplier — never on dtUs (pacing is a
// presentation choice; dt stays recorded provenance, exercised only by the manifest/provenance tests).

test('1× plays a full run in ~WITNESS_RUN_SECONDS of wall time', () => {
  // 64-tick run (f1 shape), 60fps for WITNESS_RUN_SECONDS seconds at 1× → arrives at maxTick. The +2
  // frames are fp slop: the per-frame delta is 8/60 ticks, and summing it 480× lands at 63.9999…998
  // (accumulated rounding, ~2e-13 short of 64), completing one frame late. 2 frames ≈ 33ms on an 8s
  // target — well inside "~WITNESS_RUN_SECONDS" — and keeps the done/clamp assertion crisp (repo
  // convention: never assert fp accumulation exactly).
  let s = { tick: 0, fraction: 0, done: false }
  const frames = Math.round(WITNESS_RUN_SECONDS * 60) + 2
  for (let i = 0; i < frames && !s.done; i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, 1, 64)
  expect(s.done).toBe(true)
})
test('rate is run-normalized: half the run takes half the time at 1×', () => {
  let s = { tick: 0, fraction: 0, done: false }
  const frames = Math.round((WITNESS_RUN_SECONDS / 2) * 60)
  for (let i = 0; i < frames; i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, 1, 64)
  expect(s.tick + s.fraction).toBeCloseTo(32, 0)
})

// ── Witness pacing (tour-only): re-derived against the run-normalized base ────────────────────────
// witnessSpeed(span, tickCount, seconds) yields the off-ladder multiplier that makes a `span`-tick
// play step last ~`seconds` of wall time. Fed back through advancePlayhead with maxTick = tickCount
// (exactly how Timeline drives it during a tour — the run's own length is the pacing normalizer), the
// computed speed covers `span` ticks in ~`seconds`. maxTick is the tickCount here (NOT an unbounded
// 1e9): under the new base the rate SCALES with maxTick, so the round-trip must use the real base to
// reproduce the tour's actual pacing; span < tickCount, so the maxTick clamp never interferes.
test('witnessSpeed round-trip: computed speed covers the span in ~seconds under the new base', () => {
  const span = 20, tickCount = 75, seconds = 3
  const speed = witnessSpeed(span, tickCount, seconds)
  let s = { tick: 0, fraction: 0, done: false }
  for (let i = 0; i < Math.round(seconds * 60); i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, speed, tickCount)
  expect(s.tick + s.fraction).toBeCloseTo(span, 1)
})
test('witnessSpeed stays off-ladder for shipped tours', () => {
  expect((SPEEDS as readonly number[]).includes(witnessSpeed(20, 75))).toBe(false)   // e0
  expect((SPEEDS as readonly number[]).includes(witnessSpeed(32, 64))).toBe(false)   // f1 both steps
})

// ── Preserved: clamp / rest / floor semantics (byte-for-byte behavior, dtUs argument removed) ─────

test('clamps at maxTick and rests there (rest-on-final-state)', () => {
  const r = advancePlayhead(74, 0.9, 1000, 8, 75) // maxTick = tickCount
  expect(r).toEqual({ tick: 75, fraction: 0, done: true })
})
test('at rest on maxTick, further advance is a no-op', () => {
  const r = advancePlayhead(75, 0, 16, 1, 75)
  expect(r).toEqual({ tick: 75, fraction: 0, done: true })
})
test('witnessSpeed floors span at 1 (never zero/negative speed)', () => {
  expect(witnessSpeed(0, 75, 3)).toBeGreaterThan(0)
})
test('maxTick 0 guard: a zero-length run does not NaN or hang (Math.max(1, maxTick))', () => {
  const r = advancePlayhead(0, 0, 16, 1, 0)
  expect(Number.isNaN(r.tick)).toBe(false)
  expect(Number.isNaN(r.fraction)).toBe(false)
  expect(r).toEqual({ tick: 0, fraction: 0, done: true })
})
