import { describe, expect, test } from 'vitest'
import {
  MARKS, VOICE_CLASSES, VOICE_GLYPHS, VERDICT_HUES, noVerdictHuesAreDim,
  markGlyph, markClass, requireGlyph, badgeGlyph, badgeMark, basisNote, BASIS_NOTE, VOICE_MARK,
  QUALITY_MARK, CAVEAT_NOTE, caveatNote, CAVEAT_TREATMENT, qualityPresentation,
  type MarkKey, type QualityCaveat,
} from './voices'
import { LENSES } from './lensRegistry' // importing it runs the module-load boot guard (assertVoiceAlphabetSingleSourced)
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

// ── THE QUALITY REGISTER — a THIRD register, distinct BY TREATMENT (no 8th glyph) ────────────────────────
// The register carries provenance-QUALITY facts (a dirty build tree; later the comms link-quality states) — TRUE
// and on record, but a fitness caveat, not an integrity verdict. It reuses the • attested mark + a caveat note +
// a caution treatment, so it mints ZERO glyphs and never borrows a verdict hue. These pin its shape as law: the
// voice is the •, the note/treatment are single-sourced (the ev99 basis shape), and the register is never
// confusable with either integrity family (never green ✓, never alarm ✗, never no-verdict ·).
describe('the QUALITY REGISTER (a third register, no 8th glyph)', () => {
  test('the register voices as the • attested mark — never a verdict ✓/✗, never the no-verdict ·', () => {
    expect(QUALITY_MARK).toBe('attested')
    expect(MARKS[QUALITY_MARK].glyph).toBe('•')
    expect(MARKS[QUALITY_MARK].family).toBe('verdict') // • is a verdict-family mark (a claim on record), slate-hued
    // never-green / never-x / never-dot — the three ways it could be mistaken for another register:
    expect(QUALITY_MARK).not.toBe('verified')   // never the green ✓
    expect(QUALITY_MARK).not.toBe('mismatch')   // never the alarm ✗
    expect(QUALITY_MARK).not.toBe('withheld')   // never the no-verdict ·
  })

  test('NO eighth glyph — the alphabet is unchanged and the register mints no rendered voice', () => {
    // The register is distinct BY TREATMENT: it reuses the frozen • mark, so VOICE_GLYPHS stays the six-char set
    // and the exhaustive rendered-voice map gains no entry (nothing for the boot guard to newly resolve).
    expect(VOICE_GLYPHS.size).toBe(6)
    expect(Object.keys(VOICE_MARK)).not.toContain('quality')
    expect(Object.keys(VOICE_MARK)).not.toContain('caveat')
  })

  test('the caveat NOTE + TREATMENT are single-sourced (a note vocabulary + a class token — the ev99 basis shape)', () => {
    expect(caveatNote('dirty')).toBe(CAVEAT_NOTE.dirty) // accessor identity (single source), NOT the contract check below
    expect(CAVEAT_TREATMENT).toBe('caveat')
    // the caveat note is PROSE — it never smuggles a mark glyph in as a distinction (the basis-note law, mirrored).
    for (const note of Object.values(CAVEAT_NOTE))
      for (const g of VOICE_GLYPHS) expect(note.includes(g)).toBe(false)
  })

  test('the dirty disclosure is the v0.8.1 contract string, character-for-character (the literal IS the contract)', () => {
    // An INDEPENDENT literal — NOT compared to its own backing record (that would pin nothing). This whole
    // sentence is the publication-contract disclosure the dirty row must show; a silent drift (e.g. "at
    // generation" → "at build") fails HERE even though every fragment-match above would still pass.
    const DIRTY_DISCLOSURE = 'manifest self-declares an unclean build tree at generation — a build-hygiene disclosure, not a byte-verification failure (the hashes above are checked independently); a dirty run is non-citable under the publication contract'
    expect(caveatNote('dirty')).toBe(DIRTY_DISCLOSURE)
    expect(CAVEAT_NOTE.dirty).toBe(DIRTY_DISCLOSURE)
  })

  test('the register presentation resolves mark + note + treatment TOGETHER, for EVERY caveat kind (extensibility)', () => {
    // Iterate the caveat kinds GENERICALLY (off the runtime record), so a NEW kind added to CAVEAT_NOTE is
    // automatically covered here — the extensibility claim, proven: a new quality state needs ONLY a CAVEAT_NOTE
    // entry, and its full presentation (the • mark, its note, the shared treatment) resolves with zero new wiring.
    const kinds = Object.keys(CAVEAT_NOTE) as QualityCaveat[]
    expect(kinds.length).toBeGreaterThan(0)
    for (const c of kinds) {
      const q = qualityPresentation(c)
      expect(q.mark, c).toBe(QUALITY_MARK)          // every kind wears the register's ONE voice — the •…
      expect(q.mark, c).toBe('attested')            // …never a verdict ✓/✗ or the no-verdict ·
      expect(q.note, c).toBe(caveatNote(c))         // …its own note text, resolved from the same source…
      expect(q.note, c).toBe(CAVEAT_NOTE[c])
      expect(q.treatment, c).toBe(CAVEAT_TREATMENT) // …and the shared caveat treatment
      // the row CLASS (the glyph's hue-carrier) is that mark's OWN class — the SAME source as the glyph char, so
      // a QUALITY_MARK change would move the glyph and its hue together; it is NEVER re-derived from a BadgeState.
      expect(q.cls, c).toBe(markClass(q.mark))
    }
  })

  test('the boot guard still passes — importing the registry (which runs it at load) does not throw', () => {
    // assertVoiceAlphabetSingleSourced runs at lensRegistry module load; if the register had disturbed the
    // rendered-voice alphabet it would have thrown and this import would have failed the whole file. Reaching a
    // populated registry proves the guard passed, and the module predicate it depends on still holds.
    expect(LENSES.length).toBeGreaterThan(0)
    expect(noVerdictHuesAreDim()).toBe(true)
  })
})
