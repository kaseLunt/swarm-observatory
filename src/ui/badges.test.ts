import { expect, test } from 'vitest'
import { badge, metaBadge } from './badges'

test('states', () => {
  expect(badge('aa', null)).toBe('pending')
  expect(badge('aa', 'aa')).toBe('verified')
  expect(badge('aa', 'bb')).toBe('mismatch')
  // claims-absent (no expected hex, e.g. a det-only run) is NEUTRAL, not verified — a recomputation
  // with nothing to compare against must not paint a false green.
  expect(badge(null, 'aa')).toBe('pending')
})

test('metaBadge: manifest-present-but-not-recomputed is ATTESTED, never verified (v0.5d bench R2)', () => {
  // Two-voice discipline: ✓/'verified' is reserved EXCLUSIVELY for recomputed-and-matched rows.
  // A pure-metadata row (scenario/seed/commit/registries/dirty-false) has no in-bundle recomputation —
  // its manifest claim is honestly ATTESTED (present, gate-accepted, but not independently re-derived);
  // a green check must never certify e.g. commit UNKNOWN. Det-only (no manifest) stays neutral pending.
  expect(metaBadge(true)).toBe('attested')
  expect(metaBadge(false)).toBe('pending')
  expect(metaBadge(true)).not.toBe('verified')
})
