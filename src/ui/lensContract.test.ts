import { describe, expect, test } from 'vitest'
import {
  voiceFor, voiceGlyph, chipAgreesWithLedger, validateRegistration,
  type LensRegistration, type PixelClass, type ProvenanceTier,
} from './lensContract'
import { makeWitnessInputs } from './agreeSource'

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
    // The design-inherited law: these narrow their claim in words, never a mark that reads as an earned ✓.
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
  // A QUALITY caveat belongs only on a decoded FACT (the drop-anchor precedent), never on a presentational
  // class (encodes no data) nor a recomputed class (it witnesses agreement instead) — validateRegistration guards it.
  test('a quality caveat on a decoded class passes; on a presentational or recomputed class it throws', () => {
    const ok = baseReg({ provenance: [
      { id: 'a', tier: 'decoded', source: 'contract/x.md §1', answer: 'a decoded fact with a caveat', caveat: 'dirty' },
      cls('b', 'scenario-constant', 'contract/x.md §2'), cls('c', 'presentational', null),
    ] })
    expect(validateRegistration(ok)).toBe(ok)
    expect(() => validateRegistration(baseReg({ provenance: [
      cls('a', 'decoded', 'contract/x.md §1'), cls('b', 'scenario-constant', 'contract/x.md §2'),
      { id: 'c', tier: 'presentational', source: null, answer: 'presentational + a caveat', caveat: 'dirty' },
    ] }))).toThrow(/declares a quality caveat/)
    expect(() => validateRegistration(baseReg({ provenance: [
      cls('a', 'decoded', 'contract/x.md §1'), cls('b', 'scenario-constant', 'contract/x.md §2'), cls('c', 'presentational', null),
      { id: 'r', tier: 'recomputed', source: 'contract/x.md §3', answer: 'a recompute + a caveat',
        agree: { basis: 'decoded-consistency', decoded: 'query:los-vs-decoded-components' }, caveat: 'dirty' },
    ] }))).toThrow(/declares a quality caveat/)
  })
})

describe('validateRegistration — the witness gate (a recomputed class must witness HOW it agrees)', () => {
  // A ledger that keeps its decoded + scenario-constant classes (so the chip still agrees) plus one recomputed
  // class whose AgreeSource we vary. PREMISE-FIRST: the old prose-only recomputed declaration (no agree) passed
  // before this gate; now it is refused.
  // `agree` is spread in only when present — exactOptionalPropertyTypes forbids setting it `undefined`, which
  // is exactly the prose-only (no-witness) shape this gate refuses.
  const withRecomputed = (agree?: PixelClass['agree']): LensRegistration => baseReg({
    provenance: [
      cls('a', 'decoded', 'contract/x.md §1'),
      cls('b', 'scenario-constant', 'contract/x.md §2'),
      { id: 'r', tier: 'recomputed', source: 'contract/x.md §3', answer: 'a recompute', ...(agree ? { agree } : {}) },
      cls('c', 'presentational', null),
    ],
  })

  test('a recomputed class with NO AgreeSource throws (the prose-only declaration no longer passes)', () => {
    expect(() => validateRegistration(withRecomputed(undefined))).toThrow(/no AgreeSource/)
  })
  test('a recomputed class WITH a live-inputs AgreeSource passes and returns itself', () => {
    const reg = withRecomputed({ basis: 'live-inputs', inputs: makeWitnessInputs('query:probe-point'), form: 'form:point-in-region' })
    expect(validateRegistration(reg)).toBe(reg)
  })
  test('a recomputed class WITH a decoded-consistency AgreeSource passes (the honest downgrade)', () => {
    const reg = withRecomputed({ basis: 'decoded-consistency', decoded: 'query:los-vs-decoded-components' })
    expect(validateRegistration(reg)).toBe(reg)
  })
  test('a live-inputs arm naming NO input tokens throws (a re-derivation from nothing)', () => {
    // makeWitnessInputs() is permissive on COUNT (an empty witness is constructible); validateRegistration owns
    // the "a live re-derivation must name what it re-derives from" rule and refuses it — one owner of that law.
    expect(() => validateRegistration(withRecomputed({ basis: 'live-inputs', inputs: makeWitnessInputs(), form: 'form:point-in-region' })))
      .toThrow(/naming NO input tokens/)
  })
  test('an AgreeSource on a NON-recomputed class throws (a category error — only a recompute agrees)', () => {
    expect(() => validateRegistration(baseReg({
      provenance: [
        { id: 'd', tier: 'decoded', source: 'contract/x.md §1', answer: 'a',
          agree: { basis: 'live-inputs', inputs: makeWitnessInputs('query:probe-point'), form: 'form:point-in-region' } },
        cls('b', 'scenario-constant', 'contract/x.md §2'),
        cls('c', 'presentational', null),
      ],
    }))).toThrow(/only the recomputed tier/)
  })
})
