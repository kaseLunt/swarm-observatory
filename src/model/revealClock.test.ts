import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { buildRevealClock } from './revealClock'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from './runModel'
import { ELIGIBILITY_EVALUATED } from '../decode/payloads'
import { asEventTick } from '../lib/brand'

// f2a is a dir fixture (one attempt dir holding bundle.det) — the same loader the sensing tests use.
function detFixture(name: string): ArrayBuffer {
  try {
    const b = readFileSync(`contract/fixtures/${name}.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } catch {
    const base = `contract/fixtures/${name}`
    const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
    const b = readFileSync(`${base}/${dir}/bundle.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
}
const modelFor = (name: string): RunModel => new RunModel(decodeBundle(detFixture(name)), null)

// ── DECODE-TRUE ORACLE: the O(log n) prefix-count vs a brute-force reference over the REAL f2a bytes ───────
// The reveal clock's whole job is "how many of this kind-sequence's events has the playhead revealed?" — a
// binary search. Pin its correctness against the definition itself (a linear filter) over the sensing
// kind-sequence derived straight from the frozen bundle, at every playhead across the run and past both ends.
describe('reveal clock — O(log n) prefix-count vs brute force over the real decoded f2a kind-22 sequence', () => {
  const model = modelFor('f2a_seed42')
  // The kind-22 tick axis, decoded from the bundle: the tick each EligibilityEvaluated event was committed at.
  const ticks: number[] = []
  for (let seq = 0; seq < model.eventCount; seq++) {
    if (model.kindAt(seq) === ELIGIBILITY_EVALUATED) ticks.push(model.ticks[seq]!)
  }
  ticks.sort((a, b) => a - b)
  const clock = buildRevealClock(ticks)
  const brute = (playhead: number): number => ticks.filter(t => t <= playhead).length

  test('f2a carries 96 kind-22 verdicts across ticks 0..95 — the sequence under test', () => {
    expect(ticks.length).toBe(96)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(95)
    expect(clock.total).toBe(96)
  })

  test('revealedCount === the brute-force count at every playhead 0..100 (across the run and past both ends)', () => {
    for (let playhead = 0; playhead <= 100; playhead++) {
      expect(clock.revealedCount(asEventTick(playhead)), `playhead ${playhead}`).toBe(brute(playhead))
    }
  })

  test('latestRevealedIndex === revealedCount − 1 at every playhead (the current verdict ordinal)', () => {
    for (let playhead = 0; playhead <= 100; playhead++) {
      expect(clock.latestRevealedIndex(asEventTick(playhead))).toBe(brute(playhead) - 1)
    }
  })
})

// ── THE ≤ BOUNDARY, EMPTIES, AND THE ALL-BEFORE / ALL-AFTER EDGES (the classic off-by-one lives here) ─────
describe('reveal clock — the ≤ boundary, empty sequence, and the all-before / all-after edges', () => {
  test('exactly-at-playhead is REVEALED (tick ≤ playhead, not <) — the off-by-one pin', () => {
    const clock = buildRevealClock([10, 20, 30])
    expect(clock.revealedCount(asEventTick(19))).toBe(1)          // tick 20 not yet reached
    expect(clock.revealedCount(asEventTick(20))).toBe(2)          // AT tick 20 → the tick-20 event IS revealed
    expect(clock.latestRevealedIndex(asEventTick(20))).toBe(1)    // …and it is the current one
    expect(clock.revealedCount(asEventTick(21))).toBe(2)
  })

  test('empty sequence: total 0, nothing ever revealed (latestRevealedIndex −1)', () => {
    const clock = buildRevealClock([])
    expect(clock.total).toBe(0)
    expect(clock.revealedCount(asEventTick(0))).toBe(0)
    expect(clock.revealedCount(asEventTick(999))).toBe(0)
    expect(clock.latestRevealedIndex(asEventTick(999))).toBe(-1)
  })

  test('all-after: a playhead before the first tick reveals nothing', () => {
    const clock = buildRevealClock([5, 6, 7])
    expect(clock.revealedCount(asEventTick(0))).toBe(0)
    expect(clock.revealedCount(asEventTick(4))).toBe(0)
    expect(clock.latestRevealedIndex(asEventTick(4))).toBe(-1)
  })

  test('all-before: a playhead past the last tick reveals the whole sequence', () => {
    const clock = buildRevealClock([5, 6, 7])
    expect(clock.revealedCount(asEventTick(7))).toBe(3)           // AT the last tick → all revealed (≤)
    expect(clock.revealedCount(asEventTick(1000))).toBe(3)
    expect(clock.latestRevealedIndex(asEventTick(1000))).toBe(2)
  })

  test('mid-run counts + ties: duplicate ticks all cross the boundary together', () => {
    const clock = buildRevealClock([10, 20, 20, 30])
    expect(clock.revealedCount(asEventTick(19))).toBe(1)
    expect(clock.revealedCount(asEventTick(20))).toBe(3)          // both tick-20 events revealed at 20
    expect(clock.revealedCount(asEventTick(29))).toBe(3)
    expect(clock.revealedCount(asEventTick(30))).toBe(4)
  })

  test('a non-ascending sequence fails loud at build (protects the binary-search precondition)', () => {
    expect(() => buildRevealClock([3, 1, 2])).toThrow(/ascending/)
  })
})

// ── POISONED TICKS ARE REJECTED AT BUILD, never silently miscounted ───────────────────────────────────────
// Float64Array.from turns a sparse hole / undefined into NaN, and every NaN comparison is false — so an
// ascending-only check would let [1, NaN, 2] straight through (revealedCount(2) would then return 1, not 2)
// and a lone [NaN] would reveal nothing forever. Every element is validated as a non-negative safe integer
// (the EventTick domain) BEFORE the monotonicity check, so a poisoned sequence fails loud at load.
describe('reveal clock — poisoned ticks are rejected at build', () => {
  const BAD = /non-negative safe integers/
  test('NaN throws (a NaN comparison is false — it must not slip past the ascending check)', () => {
    expect(() => buildRevealClock([1, NaN, 2])).toThrow(BAD)
    expect(() => buildRevealClock([NaN])).toThrow(BAD)
  })
  test('a sparse hole / undefined (→ NaN via Float64Array.from) throws', () => {
    expect(() => buildRevealClock([1, undefined as unknown as number, 2])).toThrow(BAD)
    const sparse: number[] = [0]
    sparse[2] = 3 // index 1 is a real hole → NaN on copy
    expect(() => buildRevealClock(sparse)).toThrow(BAD)
  })
  test('Infinity and -Infinity throw (not finite integers)', () => {
    expect(() => buildRevealClock([1, Infinity])).toThrow(BAD)
    expect(() => buildRevealClock([-Infinity, 1])).toThrow(BAD)
  })
  test('a fractional tick throws (ticks are integers)', () => {
    expect(() => buildRevealClock([1, 1.5, 2])).toThrow(BAD)
  })
  test('a negative tick throws (ticks are non-negative — the EventTick domain)', () => {
    expect(() => buildRevealClock([-1, 0, 1])).toThrow(BAD)
  })
})
