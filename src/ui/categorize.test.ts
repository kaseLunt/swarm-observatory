import { describe, expect, test } from 'vitest'
import { categoryOf } from './categorize'

describe('categoryOf maps EventKind → semantic category (spec-3a §2.3)', () => {
  test('query/observation family', () => {
    expect(categoryOf(23)).toBe('query')   // GeometryQueryResolved (E0)
    expect(categoryOf(1)).toBe('query')    // DetectionMade
    expect(categoryOf(24)).toBe('query')   // AllocationStateUpdated (C2a)
  })
  test('decision/intent family', () => {
    for (const k of [8, 9, 11, 12, 13, 14, 15]) expect(categoryOf(k)).toBe('decision')
  })
  test('resolver-mutating family', () => {
    for (const k of [2, 3, 4, 10, 17, 18, 19]) expect(categoryOf(k)).toBe('mutating')
    expect(categoryOf(0xf000)).toBe('mutating') // F0 fixture: mutates Entity(0).value (§2.6 keystone predicate)
  })
  test('comms family (message kinds)', () => {
    for (const k of [5, 6, 7]) expect(categoryOf(k)).toBe('comms')
  })
  test('resolver-fact family', () => {
    for (const k of [20, 21]) expect(categoryOf(k)).toBe('fact')
  })
  test('unknown kind falls back to query (never throws)', () => {
    // CONSCIOUS DEFAULT: the f1 experiment-block motion kinds (0x0120/0x0121) have no §2.3 row;
    // 'query' hue+glyph is the neutral fallback until a motion category is designed. Documented, not accidental.
    expect(categoryOf(0x0120)).toBe('query')
  })
})
