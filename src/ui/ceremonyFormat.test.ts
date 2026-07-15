import { describe, expect, test } from 'vitest'
import { lineState, shortHex, verdictTick, trailerTick, pinTick, resultIdTick, readyAnnouncementText, stepMark } from './ceremonyFormat'
import type { RunPhase } from './useRun'

describe('shortHex', () => {
  test('leaves a short string untouched (<= 14 chars, the boundary)', () => {
    expect(shortHex('abcd')).toBe('abcd')
    expect(shortHex('0123456789abcd')).toBe('0123456789abcd') // exactly 14 — not elided
  })
  test('middle-elides a long hex to an 8…4 shape', () => {
    const h = '0123456789abcdef0123456789abcdef' // 32 chars
    expect(shortHex(h)).toBe('01234567…cdef')
    expect(shortHex(h)).toMatch(/^.{8}….{4}$/)
  })
})

describe('lineState — phase → line-state table', () => {
  const cases: Array<[RunPhase, RunPhase, string]> = [
    // line represents 'decoding'
    ['decoding', 'fetching', 'pending'],
    ['decoding', 'decoding', 'active'],
    ['decoding', 'verifying', 'done'],
    ['decoding', 'ready', 'done'],
    // line represents 'verifying'
    ['verifying', 'decoding', 'pending'],
    ['verifying', 'verifying', 'active'],
    ['verifying', 'ready', 'done'],
    // line represents 'ready'
    ['ready', 'verifying', 'pending'],
    ['ready', 'ready', 'active'],
  ]
  test.each(cases)('lineState(%s, %s) === %s', (represents, phase, expected) => {
    expect(lineState(represents, phase)).toBe(expected)
  })
})

describe('verdictTick — result_id/step tick, verdict-aware (A2 — the seal fold, voices not collapsed)', () => {
  test('manifest-verified → the ✓-grade green (matched an external manifest)', () => {
    expect(verdictTick('manifest-verified')).toEqual({ glyph: '✓', cls: 'verified' })
  })
  test('self-consistent → the ○ self-check ring, NEVER the manifest-grade ✓ (no external oracle)', () => {
    expect(verdictTick('self-consistent')).toEqual({ glyph: '○', cls: 'self' })
    expect(verdictTick('self-consistent').glyph).not.toBe('✓')
    expect(verdictTick('self-consistent').cls).not.toBe('verified')
  })
  test('mismatch → ✗ (a pinned hash disagreed)', () => {
    expect(verdictTick('mismatch')).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
})

describe('trailerTick — the event_hash row: in-bundle trailer reproduction, graded by verdict', () => {
  test('reproduced + manifest-verified → ✓ (bytes reproduced AND a manifest backs them)', () => {
    expect(trailerTick('manifest-verified', true)).toEqual({ glyph: '✓', cls: 'verified' })
  })
  test('reproduced + self-consistent → ○ self-check (reproduced its own trailer, no external oracle)', () => {
    expect(trailerTick('self-consistent', true)).toEqual({ glyph: '○', cls: 'self' })
  })
  test('the A2 picture: reproduced trailer but manifest mismatch → event_hash ✓ beside result_id ✗', () => {
    // matchesTrailer stays true (a tampered termination_reason breaks result_id, not the trailer reproduction).
    expect(trailerTick('mismatch', true)).toEqual({ glyph: '✓', cls: 'verified' })
    expect(verdictTick('mismatch')).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
  test('did NOT reproduce the trailer → ✗ regardless of verdict', () => {
    expect(trailerTick('mismatch', false)).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
})

// ── F3/F4: per-pin ceremony grading — a NAMED row reflects its OWN comparisons, never the aggregate ────────
// The second arg is now the row's PER-FIELD trailer reproduction (trailerPins.<field>), not the aggregate
// matchesTrailer (F4): so a row whose own bytes reproduced its trailer value stays ✓ even when a DIFFERENT
// field's trailer comparison fails.
describe('pinTick — a named hash row grades from its own manifest pin + its own trailer reproduction', () => {
  test('pin matches + this field reproduced → ✓ manifest-matched', () => {
    expect(pinTick(true, true)).toEqual({ glyph: '✓', cls: 'verified' })
  })
  test('pin disagrees (this field lies) → ✗, even though this field reproduced its trailer', () => {
    expect(pinTick(false, true)).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
  test('no manifest pin (det-only), this field reproduced → ○ self-check (recomputed, no external oracle)', () => {
    expect(pinTick(null, true)).toEqual({ glyph: '○', cls: 'self' })
  })
  test('THIS field did not reproduce its own trailer value → ✗ regardless of pin', () => {
    expect(pinTick(true, false)).toEqual({ glyph: '✗', cls: 'mismatch' })
    expect(pinTick(null, false)).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
})

// ── F1: result_id's OWN ceremony tick — a DERIVATION, no ○ self-check ring when there is no oracle ───────────
describe('resultIdTick — det-only result_id is attested •, never the ○ the trailer-reproduced hashes earn', () => {
  test('PREMISE: the OLD ceremony fed result_id through pinTick(null, true) → ○ (the unfalsifiable check ring)', () => {
    // pinTick's det-only case is the ○ self-check — correct for a trailer-REPRODUCED hash, but result_id has no
    // in-bundle oracle (the trailer stores none; it is derived from CRC-fixable inputs), so ○ over-claimed a check.
    expect(pinTick(null, true)).toEqual({ glyph: '○', cls: 'self' })
  })
  test('THE FIX: det-only (no manifest pin) → the attested derived • (matches the ProvenancePanel), never ○', () => {
    expect(resultIdTick(null)).toEqual({ glyph: '•', cls: 'attested' })
    expect(resultIdTick(null).glyph).not.toBe('○')
  })
  test('a manifest pin IS result_id\'s external oracle → ✓ when it matches, ✗ when it lies', () => {
    expect(resultIdTick(true)).toEqual({ glyph: '✓', cls: 'verified' })
    expect(resultIdTick(false)).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
})

// ── F4: the ceremony rows grade from their OWN per-field trailer comparison, not the aggregate matchesTrailer ─
describe('F4 — corrupt ONLY the trailer state hash: event_hash row ✓ (its own bytes reproduced), step mark ✗', () => {
  // The premise, at the trailerPins level: the recomputed event hash still reproduced its trailer value (true),
  // the state hash did not (false), so the AGGREGATE matchesTrailer is false. The ceremony builds the event_hash
  // row from its OWN pin + its OWN reproduction (trailerPins.eventHash), so it must NOT inherit the aggregate ✗.
  const trailerPins = { eventHash: true, stateTrajectoryHash: false, eventCount: true, tickCount: true }
  const matchesTrailer = trailerPins.eventHash && trailerPins.stateTrajectoryHash && trailerPins.eventCount && trailerPins.tickCount
  const verdict = 'mismatch' as const // a trailer-inconsistent bundle → mismatch

  test('PREMISE: the aggregate refuses (matchesTrailer false) but event_hash reproduced fine', () => {
    expect(matchesTrailer).toBe(false)
    expect(trailerPins.eventHash).toBe(true)
    expect(trailerPins.stateTrajectoryHash).toBe(false)
  })
  test('THE FIX: the event_hash row grades ✓ from its own reproduction (det-only → ○; here with a clean manifest pin → ✓)', () => {
    // det-only (no manifest pin) reproduced fine → ○ self-check, NOT the aggregate ✗
    expect(pinTick(null, trailerPins.eventHash)).toEqual({ glyph: '○', cls: 'self' })
    // with a clean event_hash manifest pin → ✓, still not the aggregate ✗ (over-refusal closed)
    expect(pinTick(true, trailerPins.eventHash)).toEqual({ glyph: '✓', cls: 'verified' })
  })
  test('the AGGREGATE still drives the step mark (the seal refuses): ✗', () => {
    expect(stepMark('done', verdict)).toEqual({ glyph: '✗', cls: 'done mismatch' })
  })
})

describe('F3 — corrupt ONLY the manifest event_hash: the ceremony rows show the TRUE per-pin picture', () => {
  // Bundle bytes clean → matchesTrailer TRUE; the manifest lies about event_hash ONLY, so its pin disagrees
  // while result_id still matches (result_id does not preimage the manifest's own event_hash field). The
  // aggregate verdict is 'mismatch'. Provenance reds event_hash and greens result_id.
  const matchesTrailer = true
  const pins = [
    { key: 'event_hash', expected: 'f'.repeat(64), actual: 'a'.repeat(64), match: false },
    { key: 'result_id', expected: 'b'.repeat(64), actual: 'b'.repeat(64), match: true },
  ]
  const pinMatch = (key: string): boolean | null => pins.find(p => p.key === key)?.match ?? null

  test('PREMISE: the OLD aggregate grading painted the INVERSE (event_hash ✓ beside result_id ✗)', () => {
    // trailerTick(verdict, matchesTrailer) for the event_hash row and verdictTick(verdict) for result_id — both
    // key on the aggregate 'mismatch', so the event_hash row read ✓ (matchesTrailer true) and result_id read ✗:
    // exactly opposite the per-pin truth Provenance shows.
    expect(trailerTick('mismatch', matchesTrailer)).toEqual({ glyph: '✓', cls: 'verified' }) // WRONG for event_hash
    expect(verdictTick('mismatch')).toEqual({ glyph: '✗', cls: 'mismatch' })                 // WRONG for result_id
  })
  test('THE FIX: pinTick grades each named row from ITS OWN pin → event_hash ✗ beside result_id ✓', () => {
    expect(pinTick(pinMatch('event_hash'), matchesTrailer)).toEqual({ glyph: '✗', cls: 'mismatch' }) // its pin lies
    expect(pinTick(pinMatch('result_id'), matchesTrailer)).toEqual({ glyph: '✓', cls: 'verified' })  // its pin holds
  })
})

describe('stepMark — step-level mark carries the trust verdict (never disagrees with its rows)', () => {
  test('done + mismatch shows the failure (✗/mismatch, never a false green ✓)', () => {
    expect(stepMark('done', 'mismatch')).toEqual({ glyph: '✗', cls: 'done mismatch' })
  })
  test('done + self-consistent shows ○ self-check — never the manifest-grade green', () => {
    expect(stepMark('done', 'self-consistent')).toEqual({ glyph: '○', cls: 'done self' })
    expect(stepMark('done', 'self-consistent').glyph).not.toBe('✓')
  })
  test('done + manifest-verified, done + unknown, pending, active are unchanged', () => {
    expect(stepMark('done', 'manifest-verified')).toEqual({ glyph: '✓', cls: 'done' })
    expect(stepMark('done', null)).toEqual({ glyph: '✓', cls: 'done' })
    // A step that has not COMPLETED keeps its neutral mark even if the (as-yet-inapplicable) verdict
    // is a mismatch — the verdict only lands when the step is done.
    expect(stepMark('pending', 'mismatch')).toEqual({ glyph: '▪', cls: 'pending' })
    expect(stepMark('active', 'mismatch')).toEqual({ glyph: '▸', cls: 'active' })
  })
})

describe('readyAnnouncementText — the AT announcement carries the trust verdict', () => {
  test('manifest-verified → the ceremony-matching "verified and ready" claim', () => {
    expect(readyAnnouncementText('demo-01', 75, 240, 'manifest-verified')).toBe(
      'run demo-01 verified and ready — 75 events, 240 ticks',
    )
  })
  test('self-consistent → the det-only self-check claim (no external manifest), never "verified"', () => {
    expect(readyAnnouncementText('demo-01', 75, 240, 'self-consistent')).toBe(
      'run demo-01 self-consistent, no external manifest — 75 events, 240 ticks',
    )
    expect(readyAnnouncementText('demo-01', 75, 240, 'self-consistent')).not.toContain('verified and ready')
  })
  test('mismatch → asserts the OPPOSITE verdict: loaded, unverified, mismatch', () => {
    // A published-by-design mismatch bundle: every VISUAL surface reads ✗/mismatch, so the AT text must
    // not say "verified". It states the same failure in the app's own vocabulary.
    expect(readyAnnouncementText('demo-01', 75, 240, 'mismatch')).toBe(
      'run demo-01 loaded — hash mismatch, unverified — 75 events, 240 ticks',
    )
    expect(readyAnnouncementText('demo-01', 75, 240, 'mismatch')).not.toContain('verified and ready')
  })
  test('null / undefined (no verdict yet) → unreachable at announce time; defaults to the consistent claim', () => {
    // See useRun publication order: model + hashes publish in ONE atomic setState, and the announcement
    // only mounts once model is non-null — so the verdict is always concrete here. These branches are a
    // defensive default only; if they ever DID fire, "verified" is the pre-verdict prior.
    const consistent = 'run demo-01 verified and ready — 75 events, 240 ticks'
    expect(readyAnnouncementText('demo-01', 75, 240, null)).toBe(consistent)
    expect(readyAnnouncementText('demo-01', 75, 240, undefined)).toBe(consistent)
  })
})
