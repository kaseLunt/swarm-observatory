import { describe, expect, test } from 'vitest'
import {
  voiceFor, voiceGlyph, chipAgreesWithLedger, validateRegistration,
  type LensRegistration, type PixelClass, type ProvenanceTier,
} from './lensContract'

// The lens contract is the LAW-4 declaration graduated to typed data. These pin the pinned tier vocabulary
// (tier→voice, and which voices MUST NOT wear a glyph), and the fail-loud registration validation (every
// non-presentational class carries a contract anchor; the chip agrees with the ledger).

describe('voiceFor — tier + seal-state → voice (pinned once)', () => {
  test('decoded inherits the session seal; every other tier is seal-independent', () => {
    expect(voiceFor('decoded', true)).toBe('sealed')
    expect(voiceFor('decoded', false)).toBe('unsealed')
    // The others do not consult the seal.
    for (const sealed of [true, false]) {
      expect(voiceFor('recomputed', sealed)).toBe('live-check')
      expect(voiceFor('pinned-bits', sealed)).toBe('attested')
      expect(voiceFor('scenario-constant', sealed)).toBe('declared-constant')
      expect(voiceFor('derived-display', sealed)).toBe('derivation')
      expect(voiceFor('presentational', sealed)).toBe('presentational')
    }
  })
})

describe('voiceGlyph — the static provenance marks; the no-glyph law', () => {
  test('sealed/unsealed/attested wear ✓ ○ •; the derivation/constant/presentational voices wear NONE', () => {
    expect(voiceGlyph('sealed')).toBe('✓')
    expect(voiceGlyph('unsealed')).toBe('○')
    expect(voiceGlyph('attested')).toBe('•')
    // The D4-inherited law: these narrow their claim in words, never a mark that reads as an earned ✓.
    expect(voiceGlyph('declared-constant')).toBeNull()
    expect(voiceGlyph('derivation')).toBeNull()
    expect(voiceGlyph('presentational')).toBeNull()
    // A live-check resolves ✓/✗ only once a comparison exists — this static map returns null.
    expect(voiceGlyph('live-check')).toBeNull()
  })
})

// A minimal valid registration, mutated per case below.
const cls = (id: string, tier: ProvenanceTier, source: string | null, answer = 'an answer sentence'): PixelClass =>
  ({ id, tier, source, answer })
const baseReg = (over: Partial<LensRegistration> = {}): LensRegistration => ({
  id: 'test-lens',
  question: { primary: 'q', adjacent: [] },
  surfaces: { stage: 'S', instrument: 'I' },
  borrowedHues: ['accent'],
  dims: 'd', emptyState: 'e',
  honestyChip: 'geometry is decoded-real — bodies are scenario constants',
  tourId: 't', mountGate: 'g',
  provenance: [
    cls('a', 'decoded', 'contract/x.md §1'),
    cls('b', 'scenario-constant', 'contract/x.md §2'),
    cls('c', 'presentational', null),
  ],
  ...over,
})

describe('chipAgreesWithLedger — one source of honesty, the chip is its projection', () => {
  test('agrees when the chip names constants iff the ledger has them, and claims decoded iff decoded exists', () => {
    expect(chipAgreesWithLedger(baseReg())).toBe(true)
  })
  test('disagrees when the chip claims scenario constants the ledger does not contain', () => {
    const reg = baseReg({ provenance: [cls('a', 'decoded', 'contract/x.md §1'), cls('c', 'presentational', null)] })
    expect(chipAgreesWithLedger(reg)).toBe(false) // chip says "scenario constants" but ledger has none
  })
  test('disagrees when the chip claims decoded-real but the ledger has no decoded class', () => {
    const reg = baseReg({
      honestyChip: 'decoded-real everywhere',
      provenance: [cls('b', 'scenario-constant', 'contract/x.md §2')],
    })
    expect(chipAgreesWithLedger(reg)).toBe(false)
  })
})

describe('validateRegistration — fail loud, never coerce', () => {
  test('a well-formed registration passes and returns itself', () => {
    expect(validateRegistration(baseReg())).toEqual(baseReg())
  })
  test('a non-presentational class with NO contract anchor throws', () => {
    expect(() => validateRegistration(baseReg({
      provenance: [cls('a', 'decoded', null), cls('c', 'presentational', null)],
    }))).toThrow(/no contract\/ anchor/)
  })
  test('a presentational class that names a source throws (it encodes no data)', () => {
    expect(() => validateRegistration(baseReg({
      provenance: [cls('a', 'decoded', 'contract/x.md §1'), cls('c', 'presentational', 'contract/x.md §9')],
    }))).toThrow(/presentational yet names a source/)
  })
  test('an empty answer throws', () => {
    expect(() => validateRegistration(baseReg({
      provenance: [cls('a', 'decoded', 'contract/x.md §1', '  ')],
    }))).toThrow(/empty answer/)
  })
  test('an empty ledger throws', () => {
    expect(() => validateRegistration(baseReg({ provenance: [] }))).toThrow(/empty ledger/)
  })
  test('a chip that disagrees with the ledger throws (no second author of honesty)', () => {
    expect(() => validateRegistration(baseReg({
      honestyChip: 'everything here is decoded-real', // claims decoded, names no constants — but ledger HAS constants
    }))).toThrow(/honesty chip disagrees/)
  })
})
