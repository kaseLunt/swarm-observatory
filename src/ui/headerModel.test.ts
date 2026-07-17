import { expect, test } from 'vitest'
import { CONDENSED_MAX, OVERFLOW_MAX, MOBILE_MAX, headerTier, headerLayout, type HeaderTier } from './headerModel'

const ALL_TIERS: HeaderTier[] = ['full', 'condensed', 'overflow', 'mobile']

// ── the width → tier classifier (max-width semantics: a width AT a threshold is already condensed) ──
test('a wide viewport is the full tier', () => {
  expect(headerTier(1280)).toBe('full')
  expect(headerTier(CONDENSED_MAX + 1)).toBe('full') // 1081 — one px past the condense floor
})

test('the condense threshold is inclusive and holds down to the overflow floor', () => {
  expect(headerTier(CONDENSED_MAX)).toBe('condensed')     // 1080 — AT the threshold is already condensed
  expect(headerTier(1000)).toBe('condensed')
  expect(headerTier(OVERFLOW_MAX + 1)).toBe('condensed')  // 961 — one px above the overflow floor
})

test('the overflow threshold is inclusive and holds down to the mobile floor', () => {
  expect(headerTier(OVERFLOW_MAX)).toBe('overflow')       // 960 — AT the threshold is already overflow
  expect(headerTier(720)).toBe('overflow')
  expect(headerTier(MOBILE_MAX + 1)).toBe('overflow')     // 641 — one px above the mobile floor
})

test('the mobile threshold is inclusive and covers the phone widths', () => {
  expect(headerTier(MOBILE_MAX)).toBe('mobile')           // 640 — AT the threshold is already mobile
  expect(headerTier(390)).toBe('mobile')
  expect(headerTier(360)).toBe('mobile')
})

test('the three thresholds are strictly ordered (mobile < overflow < condense)', () => {
  expect(MOBILE_MAX).toBeLessThan(OVERFLOW_MAX)
  expect(OVERFLOW_MAX).toBeLessThan(CONDENSED_MAX)
})

// ── the per-tier layout table — the whole ladder, single-sourced for the header JSX and the smoke ──
test('the full tier keeps every control at full weight (the collapsed verdict chip stays compact)', () => {
  expect(headerLayout('full')).toEqual({
    runSwitcher: 'buttons', chrome: 'labels', wallLabel: 'certification wall', wordmark: 'full',
    chip: 'glyph', panelToggles: 'labels', dense: false,
  })
})

test('the condensed tier collapses the switcher to the picker, sheds low-priority labels to icons, and condenses the chip to its glyph', () => {
  expect(headerLayout('condensed')).toEqual({
    runSwitcher: 'picker', chrome: 'icons', wallLabel: 'wall', wordmark: 'full',
    chip: 'glyph', panelToggles: 'icons', dense: false,
  })
})

test('the overflow tier folds the low-priority chrome away, recedes the wordmark, and sheds the panel-toggle labels to icons', () => {
  expect(headerLayout('overflow')).toEqual({
    runSwitcher: 'picker', chrome: 'overflow', wallLabel: 'wall', wordmark: 'mark',
    chip: 'glyph', panelToggles: 'icons', dense: false,
  })
})

test('the mobile tier folds the panel-toggles into the overflow menu and tightens spacing (the phone floor)', () => {
  expect(headerLayout('mobile')).toEqual({
    runSwitcher: 'picker', chrome: 'overflow', wallLabel: 'wall', wordmark: 'mark',
    chip: 'glyph', panelToggles: 'overflow', dense: true,
  })
})

// ── the ladder's protected-control invariants (the reason the ladder exists) ────────────────────────
test('the run switcher is ALWAYS reachable — buttons or picker, never absent', () => {
  for (const t of ALL_TIERS) {
    const s = headerLayout(t).runSwitcher
    expect(s === 'buttons' || s === 'picker').toBe(true)
  }
})

test('the certification-wall CTA never folds into the overflow — it only condenses its label', () => {
  // wallLabel is a first-class field at every tier (the CTA always renders inline); it is only ever the
  // full or the short label, never omitted — the wall can never disappear into the `⋯` menu.
  for (const t of ALL_TIERS) {
    const l = headerLayout(t).wallLabel
    expect(l === 'certification wall' || l === 'wall').toBe(true)
  }
})

test('only the overflow and mobile tiers fold the low-priority chrome; wider tiers keep it in the row', () => {
  expect(headerLayout('full').chrome).not.toBe('overflow')
  expect(headerLayout('condensed').chrome).not.toBe('overflow')
  expect(headerLayout('overflow').chrome).toBe('overflow')
  expect(headerLayout('mobile').chrome).toBe('overflow')
})

test('the collapsed verdict chip is compact (glyph-only) at EVERY tier — its wide headline never enters the row', () => {
  // Even the full tier's narrow end (1081px) cannot fit the six-button chrome beside a full-headline chip,
  // and the cold-open card already delivered that headline; so the header chip is always the glyph reminder.
  for (const t of ALL_TIERS) {
    expect(headerLayout(t).chip).toBe('glyph')
  }
})

test('the panel-toggles are inline icons above the phone floor and fold into the overflow menu at it; the tighter spacing is mobile-only', () => {
  expect(headerLayout('condensed').panelToggles).toBe('icons') // inline icons (labeled form never rides the row)
  expect(headerLayout('overflow').panelToggles).toBe('icons')  // still inline icons above the phone floor
  expect(headerLayout('mobile').panelToggles).toBe('overflow') // folded into `⋯` at the phone floor
  expect(headerLayout('full').dense).toBe(false)
  expect(headerLayout('condensed').dense).toBe(false)
  expect(headerLayout('overflow').dense).toBe(false)
  expect(headerLayout('mobile').dense).toBe(true)
})
