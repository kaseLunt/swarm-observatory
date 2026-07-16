import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  MARKS, VOICE_CLASSES, markClass, requireGlyph, badgeGlyph, type MarkKey,
} from './voices'
import { verdictTick, trailerTick, pinTick, resultIdTick, stepMark } from './ceremonyFormat'
import { thesisVerdict } from './thesis'
import { VOICE_GLYPH, cardVerdict } from './hangar'
import type { BadgeState } from './badges'

// ── SINGLE-SOURCE MIGRATION PINS (v0.8 W1) ──────────────────────────────────────────────────────────────
// The other half of the voices extraction: proof that every migrated production surface now reads its
// glyph + class FROM voices.ts (identity-pinned, not a coincidentally-equal twin literal), and that app.css
// consolidated onto the module's class names — the sensing-strip variant classes retired and the cited
// attested-token drift (three hues across four surfaces) fixed to one canonical slate.

// ── IDENTITY PINS — the migrated surfaces read glyph + class FROM the module (not a twin literal) ────────
describe('migrated surfaces are single-sourced from voices.ts (identity pins)', () => {
  const eq = (id: MarkKey) => ({ glyph: requireGlyph(id), cls: markClass(id) })

  test('ceremony ticks (verdictTick / trailerTick / pinTick / resultIdTick / stepMark)', () => {
    expect(verdictTick('manifest-verified')).toEqual(eq('verified'))
    expect(verdictTick('self-consistent')).toEqual(eq('selfConsistent'))
    expect(verdictTick('mismatch')).toEqual(eq('mismatch'))
    expect(trailerTick('self-consistent', true)).toEqual(eq('selfConsistent'))
    expect(pinTick(null, true)).toEqual(eq('selfConsistent'))
    expect(resultIdTick(null)).toEqual(eq('attested'))   // the det-only derived • — the attested mark
    // stepMark keeps the phase-`done` class alongside the verdict mark class (compound).
    expect(stepMark('done', 'self-consistent')).toEqual({ glyph: requireGlyph('selfConsistent'), cls: `done ${markClass('selfConsistent')}` })
    expect(stepMark('done', 'mismatch')).toEqual({ glyph: requireGlyph('mismatch'), cls: `done ${markClass('mismatch')}` })
  })

  test('thesis verdict headline', () => {
    expect(thesisVerdict('manifest-verified')).toMatchObject(eq('verified'))
    expect(thesisVerdict('self-consistent')).toMatchObject(eq('selfConsistent'))
    expect(thesisVerdict('mismatch')).toMatchObject(eq('mismatch'))
  })

  test('hangar card verdict glyph + VOICE_GLYPH map', () => {
    // A visited full-manifest run seals ✓ (verified); an unvisited run rests attested •; a broken seal ✗.
    expect(VOICE_GLYPH[cardVerdict('f0', 'sealed').state]).toBe(requireGlyph('verified'))
    expect(VOICE_GLYPH[cardVerdict('f0', 'none').state]).toBe(requireGlyph('attested'))
    expect(VOICE_GLYPH[cardVerdict('f0', 'broken').state]).toBe(requireGlyph('mismatch'))
    // The whole map is the module's, per BadgeState (the provenance/hangar data-table glyph seam).
    for (const b of ['verified', 'mismatch', 'attested', 'pending'] as BadgeState[])
      expect(VOICE_GLYPH[b]).toBe(badgeGlyph(b))
  })
})

// ── THE app.css ORPHAN SWEEP + the drift-fix premise (the CSS half of single-source) ────────────────────
// Comments are stripped first: we sweep the RULES, not the prose (several comments legitimately cite old
// selectors as precedent, and citing a retired class is not defining it).
const css = readFileSync('src/ui/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('app.css consolidates onto the module class names (no orphan voice classes)', () => {
  // The verdict-surface wrappers that carry ONLY voice/badge classes (phase-mixed wrappers handled below).
  const PURE_VOICE_WRAPPERS = [
    'ctick', 'showmath-verdict', 'gate-mark', 'hangar-verdict', 'thesis-verdict', 'thesis-chip-verdict',
  ]

  test('every voice class defined in app.css is sanctioned by the module (VOICE_CLASSES)', () => {
    const found = new Set<string>()
    for (const w of PURE_VOICE_WRAPPERS)
      for (const m of css.matchAll(new RegExp(`\\.${w}\\.([a-z-]+)`, 'g'))) found.add(m[1]!)
    // `.provenance tr.<class>` (the badge data table) and `.gate-note .<class>` (the in-fov claim word).
    for (const m of css.matchAll(/\.provenance tr\.([a-z-]+)/g)) found.add(m[1]!)
    for (const m of css.matchAll(/\.gate-note \.([a-z-]+)/g)) found.add(m[1]!)
    // ceremony step marks share the wrapper with the PHASE classes active/done — allow those alongside voices.
    const cstepPhase = new Set(['active', 'done'])
    for (const m of css.matchAll(/\.cstep\.([a-z-]+)/g)) if (!cstepPhase.has(m[1]!)) found.add(m[1]!)

    const orphans = [...found].filter(c => !VOICE_CLASSES.has(c))
    expect(orphans, `orphan voice classes in app.css: ${orphans.join(', ')}`).toEqual([])
    // And the sweep actually saw the canonical marks (guards against a regex that matched nothing).
    expect(found.has('verified') && found.has('attested') && found.has('withheld')).toBe(true)
  })

  test('drift-fix PREMISE — the three retired sensing-strip variant classes are gone from app.css', () => {
    // The sensing gate's three private voice names (one of which, v-claim, additionally CONFLATED the
    // attested • and the withheld · across the two families). No selector defines them any longer.
    for (const dead of ['.v-ok', '.v-bad', '.v-claim']) expect(css.includes(dead)).toBe(false)
    // The showmath-only aliases retired in the same pass.
    expect(/\.showmath-verdict\.(agree|disagree)\b/.test(css)).toBe(false)
  })

  test('the ATTESTED token is unified to --pending across all four surfaces (the cited drift, fixed)', () => {
    // Every attested-flavoured rule resolves to the canonical slate; the old --text-faint / --text-dim
    // attested renderings are gone. Pull the declaration block after each attested selector.
    const attestedDecls = [...css.matchAll(/\.(?:ctick|gate-mark|hangar-verdict)\.attested[^{]*\{[^}]*\}/g)]
      .concat([...css.matchAll(/\.provenance tr\.attested[^{]*\{[^}]*\}/g)])
      .map(m => m[0])
    expect(attestedDecls.length).toBeGreaterThanOrEqual(4) // ceremony, gate, hangar, provenance
    for (const decl of attestedDecls) {
      expect(decl).toContain('var(--pending)')
      expect(decl).not.toContain('var(--text-faint)')
      expect(decl).not.toContain('var(--text-dim)')
    }
  })

  test('the withheld · (no-verdict) stays DIM, split from the attested • (verdict) on the gate strip', () => {
    // The two-family law made visible: the same wrapper carries both, but the no-verdict state never
    // borrows the attested slate. `MARKS` is the source of truth for which hue token each wears.
    expect(MARKS.withheld.hue).toBe('textDim')
    expect(MARKS.attested.hue).toBe('pending')
    expect(/\.gate-mark\.withheld[^{]*\{[^}]*var\(--text-dim\)[^}]*\}/.test(css)).toBe(true)
    expect(/\.gate-mark\.attested[^{]*\{[^}]*var\(--pending\)[^}]*\}/.test(css)).toBe(true)
  })
})

// ── THE SOURCE GLYPH-LITERAL SWEEP (F3 — authorship discipline made a greppable invariant) ──────────────
// The lensRegistry boot guard proves the DECLARED voice→mark map is single-sourced; the app.css sweep above
// proves no orphan voice CLASS survives. Neither can catch a NEW component that hardcodes a verdict glyph as
// UI OUTPUT (the exact drift F4 fixed on the sensing strip's note). This sweep closes that last hole: no
// verdict glyph (✓ ○ • ✗) may appear as a source literal in src/ outside voices.ts (the sanctioned source) —
// with a small, EACH-JUSTIFIED exceptions list. Comments are stripped first (they legitimately cite the marks
// as prose); the no-verdict states · ? are not swept (they double as prose separators / question marks).
describe('no verdict-glyph literal as UI output outside voices.ts (F3 authorship sweep)', () => {
  const VERDICT_GLYPHS = ['✓', '○', '•', '✗']
  // Each exception is a genuine NON-provenance use, justified inline — never a blanket file exemption.
  const SANCTIONED: { file: string; needle: string }[] = [
    // A copy-success affordance checkmark — NOT the verified provenance mark; sourcing it from the provenance
    // alphabet would mislabel it. (Appears in both share surfaces.)
    { file: 'ui/App.tsx', needle: 'link copied ✓' },
    { file: 'ui/ThesisCard.tsx', needle: 'link copied ✓' },
    // The verification-math leaf's runtime closure is PINNED to {sensingMath, sensingScenario} (the
    // no-transcendental scan depends on it), so it must NOT import the voices module; the • here is prose in a
    // gate note naming the claim voice, not a rendered mark this module could single-source.
    { file: 'ui/sensingMath.ts', needle: 'enters as the decoded claim' },
  ]
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
  const relOf = (abs: string): string => abs.replaceAll('\\', '/').replace(/^.*?\/src\//, '').replace(/^src\//, '')

  test('sweeps src/ and finds ZERO unsanctioned verdict-glyph literals (voices.ts is the one source)', () => {
    const violations: string[] = []
    for (const abs of walk('src')) {
      const rel = relOf(abs)
      if (rel === 'ui/voices.ts') continue // the sanctioned single source of the mark alphabet
      const stripped = stripComments(readFileSync(abs, 'utf8'))
      stripped.split('\n').forEach((line, i) => {
        if (!VERDICT_GLYPHS.some(g => line.includes(g))) return
        if (SANCTIONED.some(s => rel === s.file && line.includes(s.needle))) return
        violations.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations, `unsanctioned verdict-glyph literals (source them from voices.ts):\n${violations.join('\n')}`).toEqual([])
  })

  test('the sweep is LOAD-BEARING — it reaches real source files and every sanctioned line still exists', () => {
    // Guard against a walk/strip that silently matched nothing (a vacuous pass). Prove it reaches a real UI
    // file, and that every sanctioned exception STILL matches a live line (a stale exception is dead weight).
    const files = walk('src').map(p => p.replaceAll('\\', '/'))
    expect(files.some(f => f.endsWith('/ui/ProvenancePanel.tsx'))).toBe(true)
    for (const s of SANCTIONED) {
      const abs = files.find(f => f.endsWith('/' + s.file))
      expect(abs, `sanctioned file ${s.file} exists`).toBeDefined()
      expect(readFileSync(abs!, 'utf8'), s.file).toContain(s.needle)
    }
  })
})
