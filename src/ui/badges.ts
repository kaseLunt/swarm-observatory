// Two-voice discipline (a design ruling): 'verified' (the green ✓) is reserved EXCLUSIVELY for
// recomputed-and-matched rows. 'attested' is the second voice — a manifest claim is PRESENT (and the
// gate accepted the manifest) but nothing in the bundle re-derives it, so the row is quieter chrome:
// a claim on record, not an independent verification. 'pending' stays the det-only neutral (no claim
// at all); 'mismatch' stays the alarm voice.
export type BadgeState = 'pending' | 'verified' | 'mismatch' | 'attested'
export function badge(expectedHex: string | null, recomputedHex: string | null): BadgeState {
  // 'verified' requires BOTH a pinned claim AND an in-bundle recomputation that matches it. If either
  // is absent (no recomputation basis, or a det-only run with no manifest claim) the honest state is
  // neutral 'pending' — a recomputation with nothing to compare against must never paint a false green.
  if (expectedHex === null || recomputedHex === null) return 'pending'
  return expectedHex === recomputedHex ? 'verified' : 'mismatch'
}
// Pure-metadata rows (scenario/seed/dt/commit/registries/dirty-false): no in-bundle recomputation
// exists to check them, so with a manifest they are ATTESTED — never 'verified' ("a green check
// certifying commit UNKNOWN" was the design-review finding) — and without one they are neutral 'pending'.
export function metaBadge(hasManifestClaim: boolean): BadgeState {
  return hasManifestClaim ? 'attested' : 'pending'
}
