import { describe, expect, test } from 'vitest'
import {
  MARKS, VOICE_CLASSES, VOICE_GLYPHS, VERDICT_HUES, noVerdictHuesAreDim,
  markGlyph, requireGlyph, badgeGlyph, badgeMark, basisNote, BASIS_NOTE, VOICE_MARK,
  type MarkKey,
} from './voices'
import type { BadgeState } from './badges'

// ── THE VOICES MODULE — the single source for the seven trust marks (v0.8) ──────────────────────────
// These pin the design ruling as executable law over the MODULE ITSELF: the two-family taxonomy,
// the frozen seven-glyph alphabet (each glyph unique), the attested-token hue fixed to one slate, and the
// ev99 basis convention (a note, never a glyph). The migration + app.css consolidation are pinned separately
// in voicesMigration.test.ts (they belong with the migration commit).

const NO_VERDICT: MarkKey[] = ['withheld', 'unverifiable', 'notYet']
const VERDICT: MarkKey[] = ['verified', 'selfConsistent', 'attested', 'mismatch']

describe('the TWO-FAMILY LAW (the header contract)', () => {
  test('every mark is exactly one family; the four verdict / three no-verdict split is pinned', () => {
    expect(VERDICT.every(k => MARKS[k].family === 'verdict')).toBe(true)
    expect(NO_VERDICT.every(k => MARKS[k].family === 'no-verdict')).toBe(true)
    expect(Object.values(MARKS).filter(m => m.family === 'verdict')).toHaveLength(4)
    expect(Object.values(MARKS).filter(m => m.family === 'no-verdict')).toHaveLength(3)
  })

  test('NO-VERDICT states carry NO verdict hue token — they stay dim (the law, against the data)', () => {
    // The verdict family's hues are the "verdict hues"; a no-verdict state naming one would be a mark that
    // could read as an earned signal when nothing was adjudicated (the folklore-gate lie, §4).
    for (const k of NO_VERDICT) expect(VERDICT_HUES.has(MARKS[k].hue)).toBe(false)
    // Every no-verdict mark rests on a DIM token (never verified/mismatch/pending).
    for (const k of NO_VERDICT) expect(MARKS[k].hue).toBe('textDim')
    // The module's own predicate agrees (this is what the lensRegistry asserts fail-loud at boot).
    expect(noVerdictHuesAreDim()).toBe(true)
  })

  test('VERDICT marks carry an integrity hue (verified/mismatch/pending); ✓✗ keep the shipped pair', () => {
    expect(MARKS.verified.hue).toBe('verified')
    expect(MARKS.mismatch.hue).toBe('mismatch')
    // ○ and • share the no-oracle slate (distinguished by glyph) — both are verdict-family marks.
    expect(MARKS.selfConsistent.hue).toBe('pending')
    expect(MARKS.attested.hue).toBe('pending')
    expect(VERDICT_HUES).toEqual(new Set(['verified', 'mismatch', 'pending']))
  })
})

describe('the frozen SEVEN-glyph alphabet', () => {
  test('every glyph char is UNIQUE across the marks that carry one', () => {
    const glyphs = Object.values(MARKS).flatMap(m => (m.glyph === null ? [] : [m.glyph]))
    expect(glyphs).toEqual(['✓', '○', '•', '✗', '·', '?']) // six carry a DOM glyph, in declaration order
    expect(new Set(glyphs).size).toBe(glyphs.length)       // all distinct (• U+2022 ≠ · U+00B7, etc.)
  })

  test('NOT-YET is a render-state, not a DOM glyph (glyph null) — excluded from the alphabet', () => {
    expect(MARKS.notYet.glyph).toBeNull()
    expect(markGlyph('notYet')).toBeNull()
    expect(() => requireGlyph('notYet')).toThrow(/render-state/)
    // VOICE_GLYPHS is the six-char set the glyph-bearing marks draw.
    expect(VOICE_GLYPHS.size).toBe(6)
  })

  test('every mark id round-trips its own declaration (id === key), and its class is sanctioned', () => {
    for (const [k, m] of Object.entries(MARKS)) {
      expect(m.id).toBe(k)
      expect(VOICE_CLASSES.has(m.cls)).toBe(true)
    }
  })
})

describe('ev99 — the basis NOTE convention (a note, NEVER a glyph)', () => {
  test('the two basis arms render as note text, and mint no new glyph', () => {
    expect(basisNote('live-inputs')).toBe(BASIS_NOTE['live-inputs'])
    expect(basisNote('decoded-consistency')).toBe(BASIS_NOTE['decoded-consistency'])
    // A basis string is prose — it never contains one of the mark glyphs dressed as a distinction.
    for (const note of Object.values(BASIS_NOTE))
      for (const g of VOICE_GLYPHS) expect(note.includes(g)).toBe(false)
  })
})

describe('VOICE_MARK — the exhaustive rendered-voice → mark map', () => {
  test('the three glyph-bearing voices resolve to ✓ ○ •; the four wordless voices map to null', () => {
    expect(VOICE_MARK.sealed).toBe('verified')          // ✓ — decoded-inherited session seal
    expect(VOICE_MARK.unsealed).toBe('selfConsistent')  // ○ — recomputed-but-unsealed self-check
    expect(VOICE_MARK.attested).toBe('attested')        // • — a pinned value on record
    for (const v of ['live-check', 'declared-constant', 'derivation', 'presentational'] as const)
      expect(VOICE_MARK[v], v).toBeNull()               // narrow their claim in words, never a static glyph
  })
  test('every declared mapping resolves through the mark alphabet — no orphan, no glyph-less verdict mark', () => {
    // This is exactly what the lensRegistry boot guard asserts fail-loud: a non-null mapping names a real,
    // glyph-BEARING mark (never notYet, the one glyph-less mark). Adding a Voice without a mapping fails tsc.
    for (const mark of Object.values(VOICE_MARK)) {
      if (mark === null) continue
      expect(MARKS[mark]).toBeDefined()
      expect(markGlyph(mark), mark).not.toBeNull()
    }
  })
})

describe('BadgeState → mark seam (provenance / hangar data tables)', () => {
  test('the four BadgeStates map 1:1 onto the mark alphabet; badgeGlyph is module-sourced', () => {
    const cases: [BadgeState, MarkKey, string][] = [
      ['verified', 'verified', '✓'], ['mismatch', 'mismatch', '✗'],
      ['attested', 'attested', '•'], ['pending', 'selfConsistent', '○'],
    ]
    for (const [b, id, glyph] of cases) {
      expect(badgeMark(b)).toBe(id)
      expect(badgeGlyph(b)).toBe(glyph)
      expect(badgeGlyph(b)).toBe(requireGlyph(id)) // identity: same source, not a parallel literal
    }
  })
})
