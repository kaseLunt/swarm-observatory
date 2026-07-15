import { describe, expect, test } from 'vitest'
import { chainMetaText } from './Inspector'
import { HORIZON_HOPS } from './chain'

// The chainmeta declaration (consult-legibility-miniwave §1.3) — the collapsed-ancestry chip, rendered in
// EXISTING chrome (the Inspector's chainmeta span, no new surface). The up/down counts are always data-true;
// " · nearest N shown" is appended IFF the chain extends beyond the horizon on either side, so it never
// overclaims aggregation when the whole chain is already lit.
describe('chainMetaText — the Inspector chainmeta chip (consult §1.3)', () => {
  test('bare counts while the whole chain is within the horizon (never overclaims)', () => {
    expect(chainMetaText(0, 0)).toBe('0 up · 0 down')
    // exactly AT the horizon on both sides → the whole chain is lit, so no aggregation is claimed.
    expect(chainMetaText(HORIZON_HOPS, HORIZON_HOPS)).toBe(`${HORIZON_HOPS} up · ${HORIZON_HOPS} down`)
    expect(chainMetaText(HORIZON_HOPS, HORIZON_HOPS)).not.toContain('nearest')
  })
  test('appends " · nearest N shown" once EITHER side exceeds the horizon (the aggregation declaration, string exact)', () => {
    expect(chainMetaText(74, 0)).toBe('74 up · 0 down · nearest 3 shown')  // the post-tour rest frame, byte-exact
    expect(chainMetaText(0, 74)).toBe('0 up · 74 down · nearest 3 shown')  // the cold-open ghost click (down-heavy)
    expect(chainMetaText(HORIZON_HOPS + 1, 0)).toContain(`nearest ${HORIZON_HOPS} shown`) // 4 up trips it (the boundary)
    expect(chainMetaText(0, HORIZON_HOPS + 1)).toContain(`nearest ${HORIZON_HOPS} shown`) // 4 down trips it too
  })
})
