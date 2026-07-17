import { describe, expect, test } from 'vitest'
import { chainMetaText, type ChainMeta } from './Inspector'
import { HORIZON_HOPS, HORIZON_OPTS, causalNeighborhood } from './chain'
import type { RunModel } from '../model/runModel'

// The chainmeta declaration (a design consult; v0.8) — the collapsed-ancestry chip, rendered in
// EXISTING chrome (the Inspector's chainmeta span, no new surface). The up/down counts are the horizon-bounded
// neighbourhood's RETAINED members — the SAME set the stage/timeline/links draw, never a whole-chain total (a
// bounded count presented as the total is the exact lie this wave kills). " · nearest N shown" is appended IFF the
// chain extends beyond the horizon on either side, so it never overclaims when the whole chain is already lit; a
// per-hop breadth cut appends " · N dropped" — the count-true summary made honest, never a silent drop.
const meta = (m: Partial<ChainMeta>): ChainMeta =>
  ({ up: 0, down: 0, upBeyond: false, downBeyond: false, truncated: null, ...m })

describe('chainMetaText — the Inspector chainmeta chip (count-true)', () => {
  test('bare counts when the whole chain is within the horizon (never overclaims)', () => {
    expect(chainMetaText(meta({}))).toBe('0 up · 0 down')
    // exactly AT the horizon on both sides but nothing beyond → the whole chain is lit, so no aggregation is claimed.
    expect(chainMetaText(meta({ up: HORIZON_HOPS, down: HORIZON_HOPS })))
      .toBe(`${HORIZON_HOPS} up · ${HORIZON_HOPS} down`)
    expect(chainMetaText(meta({ up: HORIZON_HOPS, down: HORIZON_HOPS }))).not.toContain('nearest')
  })
  test('appends " · nearest N shown" once EITHER side extends beyond the horizon (string exact)', () => {
    // the leaf/root selections: bounded to HORIZON_HOPS retained, and the chain continues past it → aggregation declared.
    expect(chainMetaText(meta({ up: HORIZON_HOPS, down: 0, upBeyond: true })))
      .toBe(`${HORIZON_HOPS} up · 0 down · nearest ${HORIZON_HOPS} shown`)  // post-tour rest frame (up-heavy leaf)
    expect(chainMetaText(meta({ up: 0, down: HORIZON_HOPS, downBeyond: true })))
      .toBe(`0 up · ${HORIZON_HOPS} down · nearest ${HORIZON_HOPS} shown`)  // cold-open ghost click (down-heavy root)
    expect(chainMetaText(meta({ up: HORIZON_HOPS, down: HORIZON_HOPS, upBeyond: true, downBeyond: true })))
      .toContain(`nearest ${HORIZON_HOPS} shown`)
  })
  test('a per-hop breadth cut appends " · N dropped" — the silent drop made honest (never a truncated count as total)', () => {
    expect(chainMetaText(meta({ up: 0, down: HORIZON_HOPS, downBeyond: true, truncated: { hop: 1, dropped: 12 } })))
      .toBe(`0 up · ${HORIZON_HOPS} down · nearest ${HORIZON_HOPS} shown · 12 dropped`)
    // a cut with the depth fully within the horizon still declares the drop.
    expect(chainMetaText(meta({ up: 1, down: 2, truncated: { hop: 2, dropped: 5 } })))
      .toBe('1 up · 2 down · 5 dropped')
  })
})

// INTEGRATED chip test: the wide-leaf-star false horizon. A BREADTH cut is not a DEPTH claim. A root with 65
// leaf children under HORIZON_OPTS (maxPerHop 64) drops one child, but the chain ENDS at hop 1 — no descendant
// horizon is crossed. Before the fix chain.ts forced descendantsBeyond = true on ANY per-hop truncation, so the
// chip read "nearest 3 shown · 1 dropped" — a false horizon claim. End to end (causalNeighborhood → ChainMeta →
// chainMetaText, exactly as EventDetail builds it, probeHorizon on) the chip must disclose the drop WITHOUT
// claiming a horizon it never probed.
describe('chainMetaText × causalNeighborhood — wide-leaf star does not claim a false horizon', () => {
  const ROOT = 500
  const leafStar = (): RunModel => ({
    childrenOf(seq: number): readonly number[] {
      return seq === ROOT ? Array.from({ length: 65 }, (_, i) => 600 + i) : []
    },
    parentOf(seq: number): number | null { return seq >= 600 && seq <= 664 ? ROOT : null },
  } as unknown as RunModel)

  test('65-leaf root → chip says "1 dropped", never "nearest N shown" (the old flag lied)', () => {
    // probeHorizon = true, exactly as the Inspector's EventDetail resolves the chip's neighbourhood.
    const nb = causalNeighborhood(leafStar(), ROOT, HORIZON_OPTS, true)
    const chip: ChainMeta = {
      up: nb.ancestors, down: nb.descendants,
      upBeyond: nb.ancestorsBeyond, downBeyond: nb.descendantsBeyond,
      truncated: nb.summary.truncated,
    }
    // premise (pre-fix): downBeyond === true → "0 up · 64 down · nearest 3 shown · 1 dropped" (a horizon that is not there).
    expect(nb.descendantsBeyond).toBe(false)        // the leaves end the chain at hop 1 — the probe found no depth
    expect(nb.summary.truncated).toEqual({ hop: 1, dropped: 1 })
    const text = chainMetaText(chip)
    expect(text).toBe('0 up · 64 down · 1 dropped')  // the breadth cut disclosed...
    expect(text).not.toContain('nearest')            // ...but NOT as a false horizon claim
  })
})
