import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PALETTE, CATEGORY, hexToThree } from './theme'

const css = readFileSync('src/ui/theme.css', 'utf8')
const cssVar = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!m) throw new Error(`missing --${name} in theme.css`)
  return m[1]!.toLowerCase()
}

describe('theme.ts and theme.css agree (single source of truth)', () => {
  test('palette hexes match the CSS custom properties', () => {
    const pairs: [keyof typeof PALETTE, string][] = [
      ['bgVoid', 'bg-void'], ['bgPanel', 'bg-panel'], ['accent', 'accent'],
      ['timeCursor', 'time-cursor'], ['verified', 'verified'], ['mismatch', 'mismatch'], ['pending', 'pending'],
      // rev-3 R3 swatch tokens (owner-approved 2026-07-09): the verdict pair + causality violet, each with a
      // live --var mirror. Kept in agreement so a future value-only re-swatch can't drift JS from CSS.
      ['verdictAffirm', 'verdict-affirm'], ['verdictNegate', 'verdict-negate'], ['spine', 'spine'],
      ['gridCell', 'grid-cell'], ['gridMajor', 'grid-major'],
      ['vignetteCenter', 'vignette-center'], ['vignetteEdge', 'vignette-edge'],
      // M4: the six formerly-untested tokens. All six have a live --var in theme.css (verified names,
      // Case 1 — no JS-only exclusions were needed), so the palette now has FULL agreement coverage.
      ['bgElevated', 'bg-elevated'], ['border', 'border'], ['borderBright', 'border-bright'],
      ['textPrimary', 'text-primary'], ['textDim', 'text-dim'], ['textFaint', 'text-faint'],
    ]
    for (const [js, cssName] of pairs) expect(PALETTE[js].toLowerCase()).toBe(cssVar(cssName))
  })
  test('category hues match --cat-* variables', () => {
    for (const [key, { hue }] of Object.entries(CATEGORY))
      expect(hue.toLowerCase()).toBe(cssVar(`cat-${key}`))
  })
  test('every category carries a redundant glyph (color-blind safety)', () => {
    for (const c of Object.values(CATEGORY)) expect(c.glyph.length).toBeGreaterThan(0)
  })
  test('hexToThree parses to a THREE-usable number', () => {
    expect(hexToThree('#56b6ff')).toBe(0x56b6ff)
  })
})
