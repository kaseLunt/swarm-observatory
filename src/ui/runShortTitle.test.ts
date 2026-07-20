import { describe, it, expect } from 'vitest'
import { RUN_CATALOG } from '../decode/runCatalog'
import { RUN_SHORT_TITLES, runShortTitle, runTooltip } from './runShortTitle'

// The condensed run picker renders ONE row at its narrowest supported width; an authored short name that
// outgrew that row would reintroduce the very overflow the short name exists to prevent. This is the
// authored length budget — the upper bound of the short-name band the switcher is designed around. Every
// approved name sits well under it (the longest, "Target track", is 12); the pin fails loudly if a future
// re-title ever blows the one-row budget.
const SHORT_TITLE_BUDGET = 16

describe('authored short run names', () => {
  // PRESENCE / DRIFT: the authored short names cover exactly the trusted catalog — every certified run is
  // named, and no short name dangles without a run. Adding a run to the catalog without naming it here
  // fails THIS test, so the switcher can never silently fall back to a bare id in production. (The catalog
  // is itself pinned against the index generator's run list by publication.test.ts, so pinning against the
  // catalog transitively covers the index.)
  it('covers exactly the certified catalog — every run named, no orphans', () => {
    const catalogIds = Object.keys(RUN_CATALOG).sort()
    const shortIds = Object.keys(RUN_SHORT_TITLES).sort()
    expect(shortIds).toEqual(catalogIds)
  })

  // LENGTH BUDGET: every authored short name fits the condensed picker's one-row budget.
  it('every short name fits the one-row picker budget', () => {
    for (const [id, name] of Object.entries(RUN_SHORT_TITLES)) {
      expect(
        name.length,
        `${id} short name "${name}" (${name.length} chars) exceeds the ${SHORT_TITLE_BUDGET}-char one-row picker budget`,
      ).toBeLessThanOrEqual(SHORT_TITLE_BUDGET)
    }
  })

  // THE APPROVED COPY: the exact owner-approved names, pinned verbatim so a stray edit to presentation copy
  // is caught rather than shipped.
  it('pins the approved short names verbatim', () => {
    expect(RUN_SHORT_TITLES).toEqual({
      f0: 'Determinism',
      f1: 'Motion',
      e0: 'Geometry',
      f2a: 'Sensing',
      f3a: 'Target track',
      f4: 'Comms link',
    })
  })
})

describe('runShortTitle fallback', () => {
  it('returns the authored short name for a certified run', () => {
    expect(runShortTitle('f4', 'F4 comms link (seed 42)')).toBe('Comms link')
    expect(runShortTitle('f3a', 'F3a single-target track (seed 42)')).toBe('Target track')
  })

  it('degrades an unknown run to its full title, then to its id', () => {
    expect(runShortTitle('zzz', 'Some Full Title')).toBe('Some Full Title')
    expect(runShortTitle('zzz')).toBe('zzz')
  })

  it('resolves a prototype-shaped id safely — never an inherited member', () => {
    // Object.hasOwn keeps these off the map; each falls through to the title/id fallback like any unknown
    // id, never returning a function (toString), the constructor, or the prototype.
    expect(runShortTitle('__proto__', undefined)).toBe('__proto__')
    expect(runShortTitle('constructor')).toBe('constructor')
    expect(runShortTitle('toString')).toBe('toString')
    expect(runShortTitle('hasOwnProperty', 'x')).toBe('x')
  })

  it('fails soft on a malformed unsigned title — non-string, empty, or whitespace falls to the id', () => {
    // The index is unsigned and blindly cast; a non-string or blank title must never reach a React child.
    // Each is treated as absent so the label falls to the id (never a throw, never an empty control).
    expect(runShortTitle('zzz', { evil: true })).toBe('zzz')
    expect(runShortTitle('zzz', 42)).toBe('zzz')
    expect(runShortTitle('zzz', null)).toBe('zzz')
    expect(runShortTitle('zzz', '')).toBe('zzz')
    expect(runShortTitle('zzz', '   ')).toBe('zzz')
  })

  it('trims a valid unsigned title', () => {
    expect(runShortTitle('zzz', '  Some Full Title  ')).toBe('Some Full Title')
  })
})

describe('runTooltip', () => {
  it('carries the id beside the full title for URL/power users', () => {
    expect(runTooltip('f4', 'F4 comms link (seed 42)')).toBe('f4 · F4 comms link (seed 42)')
  })
  it('falls back to the bare id when a title is missing', () => {
    expect(runTooltip('f4')).toBe('f4')
  })
  it('fails soft on a malformed title — the tooltip degrades to the bare id', () => {
    expect(runTooltip('f4', { evil: true })).toBe('f4')
    expect(runTooltip('f4', '')).toBe('f4')
    expect(runTooltip('f4', '   ')).toBe('f4')
  })
  it('trims the title in the tooltip', () => {
    expect(runTooltip('f4', '  F4 comms link (seed 42)  ')).toBe('f4 · F4 comms link (seed 42)')
  })
})
