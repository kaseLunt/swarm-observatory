import type { CategoryKey } from './theme'

// EventKind → semantic category (spec-3a §2.3). The comms kinds (5/6/7) overlap the mutating band
// but resolve to 'comms'. 0xf000 (F0 fixture) is 'mutating', not 'query': per spec-3a §2.6, F0 is
// itself a mutating outcome whose keystone predicate binds Entity(0).value in State[t]→State[t+1] —
// same resolver-mutating semantics as the rest of that row, not an observation.
// Anything with no §2.3 row falls back to 'query' — a benign, documented default. Only two cases
// land here: F1's experiment-block motion kinds (0x0120/0x0121, no category designed yet) and the
// deprecated kind 16 (AuthorizationGranted, excluded from the registry — spec-impossible, can never
// appear in a decodable bundle, so this arm is unreachable for it in practice).
const MAP: Record<number, CategoryKey> = {
  1: 'query', 22: 'query', 23: 'query', 24: 'query',
  8: 'decision', 9: 'decision', 11: 'decision', 12: 'decision', 13: 'decision', 14: 'decision', 15: 'decision',
  2: 'mutating', 3: 'mutating', 4: 'mutating', 10: 'mutating', 17: 'mutating', 18: 'mutating', 19: 'mutating', 0xf000: 'mutating',
  5: 'comms', 6: 'comms', 7: 'comms',
  20: 'fact', 21: 'fact',
}
export function categoryOf(kind: number): CategoryKey { return MAP[kind] ?? 'query' }
