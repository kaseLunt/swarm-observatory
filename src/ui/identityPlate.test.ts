import { describe, expect, test } from 'vitest'
import {
  identityPlate, fullPlate, compactPlate, entityCallsign, apparatusCallsign, nounFor,
  ACTOR_GLYPH, GLYPH_FALLBACK, CLASS_NOUN, SENSOR_NOUN, PLATE_LEDGER_ANSWER,
} from './identityPlate'

// Identity is typographic, not chromatic: one plate, four registers. These pin the deterministic per-run
// callsign derivation, the full/compact forms, the sensor-as-apparatus register, and both callsign schemes (so
// the swap is proven), plus the honesty declaration (the plate is presentational paint).

describe('entityCallsign — deterministic, per-run, from the entity key', () => {
  test('NATO scheme: id → phonetic word; past 26 wraps to WORD-2, WORD-3 …', () => {
    expect(entityCallsign('1:0', 'nato')).toBe('ALFA')
    expect(entityCallsign('1:1', 'nato')).toBe('BRAVO')
    expect(entityCallsign('1:25', 'nato')).toBe('ZULU')
    expect(entityCallsign('1:26', 'nato')).toBe('ALFA-2')
    expect(entityCallsign('1:53', 'nato')).toBe('BRAVO-3') // 53 = 26*2 + 1
  })
  test('squadron scheme: the squadron word + a 2-digit index — proven so the swap is one line', () => {
    expect(entityCallsign('1:0', 'squadron')).toBe('VANTA 00')
    expect(entityCallsign('1:7', 'squadron')).toBe('VANTA 07')
    expect(entityCallsign('1:12', 'squadron')).toBe('VANTA 12')
  })
  test('the default scheme is NATO (the safe default that needs no owner decision)', () => {
    expect(entityCallsign('1:0')).toBe('ALFA')
  })
  test('a bare id (no namespace) resolves the same way; a malformed key is register 0', () => {
    expect(entityCallsign('3', 'nato')).toBe('DELTA')
    expect(entityCallsign('nonsense', 'nato')).toBe('ALFA')
  })
})

describe('apparatus callsign — the sensor is named plain (data-true)', () => {
  test('SENSOR <id>', () => {
    expect(apparatusCallsign('0')).toBe('SENSOR 0')
    expect(apparatusCallsign('1:4')).toBe('SENSOR 4')
  })
})

describe('the plate — full + compact forms; the raw key is never out of reach', () => {
  test('full plate: glyph · callsign · class noun · entity key', () => {
    const p = identityPlate('1:0', 'entity')
    expect(p.glyph).toBe('▸')
    expect(p.callsign).toBe('ALFA')
    expect(p.noun).toBe('drone')
    expect(p.key).toBe('1:0') // the data-true identity, always recoverable
    expect(fullPlate(p)).toBe('▸ ALFA — drone 1:0')
    expect(compactPlate(p)).toBe('▸ ALFA')
  })
  test('the sensor is the APPARATUS register — glyph ◎, noun "sensor", never dressed as an agent', () => {
    const p = identityPlate('0', 'apparatus')
    expect(p.register).toBe('apparatus')
    expect(p.glyph).toBe('◎')
    expect(p.noun).toBe(SENSOR_NOUN)
    expect(fullPlate(p)).toBe('◎ SENSOR 0 — sensor 0')
  })
  test('the four registers each carry a distinct, non-colliding glyph', () => {
    // Actor glyphs must not collide with event categories (◆▲●◇✳) or provenance voices (✓•○✗).
    const glyphs = Object.values(ACTOR_GLYPH)
    expect(new Set(glyphs).size).toBe(glyphs.length)
    const forbidden = new Set(['◆', '▲', '●', '◇', '✳', '✓', '•', '○', '✗'])
    for (const g of glyphs) expect(forbidden.has(g)).toBe(false)
    // The two render-risk glyphs (marker ⌖, belief ◌) declare fallbacks (✛, ◯) for the font-stack check.
    expect(GLYPH_FALLBACK.marker).toBe('✛')
    expect(GLYPH_FALLBACK.belief).toBe('◯')
  })
})

describe('nouns retire the old dialects', () => {
  test('entity/marker/belief carry the class noun; apparatus carries the sensor noun', () => {
    expect(nounFor('entity')).toBe(CLASS_NOUN)
    expect(nounFor('marker')).toBe(CLASS_NOUN)
    expect(nounFor('apparatus')).toBe(SENSOR_NOUN)
    expect(CLASS_NOUN).toBe('drone') // the default noun (retires "agent" / "the cone")
  })
})

test('the plate declares itself paint (the honesty ethos applied to charm)', () => {
  expect(PLATE_LEDGER_ANSWER).toMatch(/presentational/)
  expect(PLATE_LEDGER_ANSWER).toMatch(/not in the bundle/)
})
