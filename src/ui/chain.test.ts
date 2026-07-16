import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  activeChain, causalHops, causalNeighborhood, chainTicks, HORIZON_HOPS, HORIZON_OPTS, type NeighborhoodOpts,
} from './chain'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)

// THE AGGREGATION HORIZON (consult-legibility-miniwave §1). e0 is one degenerate linear hash chain of 75
// (parent = seq−1, tick == seq), so a hop is a seq distance: selecting a mid-chain event lights exactly the
// { seq−3 .. seq+3 } neighborhood — its own evidence — and nothing beyond. These pins replace the pre-horizon
// full-chain expectations (74 arcs / 75 members), which the horizon deliberately retires.
describe('causalHops (E0: linear chain of 75) — the ≤ maxHop neighborhood', () => {
  test('a mid-chain seq maps its own ±HORIZON_HOPS neighborhood with exact hop distances', () => {
    const hop = causalHops(e0, 40, HORIZON_HOPS)
    expect(hop.size).toBe(2 * HORIZON_HOPS + 1) // 7 on a linear chain: self + 3 up + 3 down
    expect(hop.get(40)).toBe(0)                  // the subject
    expect(hop.get(39)).toBe(1); expect(hop.get(38)).toBe(2); expect(hop.get(37)).toBe(3) // ancestors nearest-first
    expect(hop.get(41)).toBe(1); expect(hop.get(42)).toBe(2); expect(hop.get(43)).toBe(3) // descendants in BFS order
    expect(hop.has(36)).toBe(false)              // hop 4 — beyond the horizon, omitted
    expect(hop.has(44)).toBe(false)
  })
  test('near the chain root the ancestor side is short (no negative / phantom seqs)', () => {
    const hop = causalHops(e0, 0, HORIZON_HOPS) // the root: zero ancestors, 3 descendants
    expect(hop.get(0)).toBe(0)
    expect(hop.get(1)).toBe(1); expect(hop.get(2)).toBe(2); expect(hop.get(3)).toBe(3)
    expect(hop.has(-1)).toBe(false)
    expect(hop.size).toBe(HORIZON_HOPS + 1) // self + 3 down
    const hop1 = causalHops(e0, 1, HORIZON_HOPS)
    expect(hop1.get(0)).toBe(1) // one ancestor only
    expect(hop1.size).toBe(HORIZON_HOPS + 2) // self + 1 up + 3 down
  })
  test('maxHop is honored — a smaller horizon lights a smaller neighborhood', () => {
    const hop = causalHops(e0, 40, 1)
    expect([...hop.keys()].sort((a, b) => a - b)).toEqual([39, 40, 41]) // self + 1 up + 1 down
  })
})

// ── W3: BOUNDED TRAVERSAL — the neighborhood cost, never the whole chain ──────────────────────────────
// causalHops was rewritten to parent-walk exactly maxHop steps and BFS children only while hop < maxHop
// (the old body materialised model.causalChain — the FULL transitive closure — then filtered). Two pins:
// (1) identical OUTPUT to the old derivation across ALL 75 e0 selections (a pure refactor of the result);
// (2) a branching tree proves a beyond-horizon subtree is NEVER ENUMERATED (childrenOf / parentOf are not
// called on nodes past the horizon), so the cost is decoupled from total chain size.
describe('causalHops — bounded traversal (W3)', () => {
  // The pre-W3 derivation, kept verbatim as the reference oracle: full causalChain, then the maxHop filter.
  const oldCausalHops = (model: RunModel, seq: number, maxHop: number): Map<number, number> => {
    const { ancestors, descendants } = model.causalChain(seq)
    const hop = new Map<number, number>([[seq, 0]])
    for (let i = 0; i < ancestors.length && i < maxHop; i++) hop.set(ancestors[i]!, i + 1)
    for (const d of descendants) {
      const p = model.parentOf(d)
      const ph = p !== null ? hop.get(p) : undefined
      if (ph !== undefined && ph < maxHop) hop.set(d, ph + 1)
    }
    return hop
  }
  const asEntries = (m: Map<number, number>): [number, number][] => [...m.entries()].sort((a, b) => a[0] - b[0])

  test('identical output to the old derivation across ALL 75 e0 selections (a pure result refactor)', () => {
    for (let seq = 0; seq < e0.eventCount; seq++) {
      for (const maxHop of [1, 2, HORIZON_HOPS, 5]) {
        expect(asEntries(causalHops(e0, seq, maxHop)), `seq ${seq} maxHop ${maxHop}`)
          .toEqual(asEntries(oldCausalHops(e0, seq, maxHop)))
      }
    }
  })

  // A branching tree (each node has 2 children) deeper than the horizon, with parentOf/childrenOf INSTRUMENTED
  // to record every node they are asked about. Beyond-horizon descendants (hop > maxHop) must never be
  // enumerated — the whole point of the bound — and beyond-horizon ancestors must never be fetched.
  const children = new Map<number, number[]>([
    [0, [1, 2]], [1, [3, 4]], [2, [5, 6]],
    [3, [7, 8]], [4, [9, 10]], [5, [11, 12]], [6, [13, 14]],
  ])
  const parent = new Map<number, number>()
  for (const [p, cs] of children) for (const c of cs) parent.set(c, p)
  const mockModel = (visitedChildrenOf: number[], visitedParentOf: number[]): RunModel => ({
    childrenOf(seq: number): readonly number[] { visitedChildrenOf.push(seq); return children.get(seq) ?? [] },
    parentOf(seq: number): number | null { visitedParentOf.push(seq); return parent.get(seq) ?? null },
  } as unknown as RunModel)

  test('descendant BFS never enumerates a beyond-horizon subtree (childrenOf stops at the horizon)', () => {
    const seenCh: number[] = [], seenPar: number[] = []
    const hop = causalHops(mockModel(seenCh, seenPar), 0, 2)
    // hop-≤2 neighborhood only: self + 2 children + 4 grandchildren.
    expect([...hop.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`))
      .toEqual(['0:0', '1:1', '2:1', '3:2', '4:2', '5:2', '6:2'])
    for (const beyond of [7, 8, 9, 10, 11, 12, 13, 14]) expect(hop.has(beyond)).toBe(false)
    // childrenOf was called ONLY on the nodes strictly inside the horizon (hop < maxHop) — never on the
    // hop-2 boundary nodes (3..6) and never on the beyond-horizon leaves — so the subtree was never walked.
    expect([...new Set(seenCh)].sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  test('parent-walk fetches at most maxHop ancestors — a beyond-horizon ancestor is never queried', () => {
    const seenCh: number[] = [], seenPar: number[] = []
    // node 11: parent chain 11 → 5 → 2 → 0. With maxHop 2 the walk maps 5(hop1), 2(hop2) and STOPS — it must
    // never call parentOf(2) (which would fetch the hop-3 ancestor 0).
    const hop = causalHops(mockModel(seenCh, seenPar), 11, 2)
    expect([...hop.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`)).toEqual(['2:2', '5:1', '11:0'])
    expect(hop.has(0)).toBe(false)                       // the hop-3 ancestor is beyond the horizon
    expect([...new Set(seenPar)].sort((a, b) => a - b)).toEqual([5, 11]) // parentOf(2) was never called → 0 never fetched
  })
})

describe('chainTicks — horizon-bounded overlay geometry (members only; arcs need BOTH endpoints)', () => {
  test('E0 seq 40: ticks + members are the 7-event neighborhood, not the whole 75', () => {
    const c = chainTicks(e0, 40)
    expect(c.members.size).toBe(2 * HORIZON_HOPS + 1) // 7
    expect(c.members.has(40)).toBe(true)   // the subject is a member
    expect(c.members.has(37)).toBe(true)   // the hop-3 boundary is in
    expect(c.members.has(36)).toBe(false)  // hop 4 is out — the wash is bounded
    // ticks drawn for members only (e0: tick == seq), sorted ascending.
    expect([...c.ticks]).toEqual([37, 38, 39, 40, 41, 42, 43])
  })
  test('arcs ≤ 2·HORIZON_HOPS and EVERY arc endpoint is a member (no dangling arc to a hop-4 tick)', () => {
    const c = chainTicks(e0, 40)
    expect(c.arcs.length / 2).toBeLessThanOrEqual(2 * HORIZON_HOPS) // ≤ 6 edges on a linear chain
    expect(c.arcs.length / 2).toBe(6)                                // exactly 6 here (interior selection)
    const tickToSeq = (t: number) => t // e0: tick == seq
    for (let i = 0; i + 1 < c.arcs.length; i += 2) {
      expect(c.members.has(tickToSeq(c.arcs[i]!))).toBe(true)     // parent endpoint is a member
      expect(c.members.has(tickToSeq(c.arcs[i + 1]!))).toBe(true) // child endpoint is a member
    }
  })
  test('a selection at the root drops the ancestor-side arcs (fewer members, fewer arcs)', () => {
    const c = chainTicks(e0, 0)
    expect(c.members.size).toBe(HORIZON_HOPS + 1) // self + 3 down
    expect(c.arcs.length / 2).toBe(3)             // 0→1, 1→2, 2→3 only
  })
})

// ARCS RESERVED FOR SELECTION (LAW 1): the single gate is activeChain — null selection yields null geometry,
// so the draw loop paints no arcs. Pinned so the reservation can't silently regress into an always-on overlay.
describe('activeChain — the selection gate', () => {
  test('null selection ⟹ null geometry ⟹ no overlay; a real selection lights a bounded chain', () => {
    expect(activeChain(e0, null)).toBeNull()
    const c = activeChain(e0, 40)
    expect(c).not.toBeNull()
    expect(c!.arcs.length).toBeGreaterThan(0)                       // a real selection DOES light arcs
    expect(c!.members.size).toBeLessThanOrEqual(2 * HORIZON_HOPS + 1) // but bounded to the neighborhood
  })
})

// ══ v0.8 W2 — THE CausalNeighborhood API (the honesty-tier ruling) ═══════════════════════════════════════════
// ONE bounded traversal, a COUNT-TRUE summary, a PINNED truncation order, and the two-surface disagreement class
// dead by construction. These pins guard the four properties the wave rests on.

describe('causalNeighborhood — the count-true bounded traversal (E0)', () => {
  test('E0 seq 40: retained up/down + a clean (untruncated) summary; total === members', () => {
    const nb = causalNeighborhood(e0, 40, HORIZON_OPTS, true)
    expect(nb.ancestors).toBe(HORIZON_HOPS)                 // 39, 38, 37
    expect(nb.descendants).toBe(HORIZON_HOPS)               // 41, 42, 43
    expect(nb.members.size).toBe(2 * HORIZON_HOPS + 1)      // 7
    expect(nb.ancestorsBeyond).toBe(true)                   // 36 exists past the ancestor horizon
    expect(nb.descendantsBeyond).toBe(true)                 // 44 exists past the descendant horizon
    expect(nb.summary.truncated).toBeNull()                 // a linear chain never trips maxPerHop
    expect(nb.summary.total).toBe(nb.members.size)          // nothing dropped ⇒ total === retained
    expect(nb.summary.byHop).toEqual([1, 2, 2, 2])          // self; {39,41}; {38,42}; {37,43}
  })
  test('root/leaf: the short side reports beyond=false (no overclaim), long side beyond=true', () => {
    const root = causalNeighborhood(e0, 0, HORIZON_OPTS, true)
    expect(root.ancestors).toBe(0); expect(root.ancestorsBeyond).toBe(false) // no ancestors, nothing hidden
    expect(root.descendants).toBe(HORIZON_HOPS); expect(root.descendantsBeyond).toBe(true)
    const leaf = causalNeighborhood(e0, 74, HORIZON_OPTS, true)
    expect(leaf.descendants).toBe(0); expect(leaf.descendantsBeyond).toBe(false)
    expect(leaf.ancestors).toBe(HORIZON_HOPS); expect(leaf.ancestorsBeyond).toBe(true)
  })
  test('probeHorizon defaults OFF — the geometry/link consumers never pay the boundary peek', () => {
    const nb = causalNeighborhood(e0, 40, HORIZON_OPTS)
    expect(nb.ancestorsBeyond).toBe(false)                  // unprobed ⇒ conservative false (never claims hidden)
    expect(nb.descendantsBeyond).toBe(false)
    expect(nb.members.size).toBe(2 * HORIZON_HOPS + 1)      // members are identical whether or not we probe
  })
})

// PINNED TRUNCATION ORDER — a synthetic node with more children than maxPerHop. The survivors must be the
// SMALLEST-seq maxPerHop (premise-first), and — the point of pinning — INDEPENDENT of childrenOf enumeration order:
// feed the same candidates shuffled and the identical members survive.
describe('causalNeighborhood — pinned truncation order (smallest seq survives, order-independent)', () => {
  // A star: seq 100 has 10 children (200..209); each child is a leaf. childrenOf returns them in a caller-supplied
  // order so we can prove the survivor set does not depend on it.
  const star = (childOrder: number[]): RunModel => ({
    childrenOf(seq: number): readonly number[] { return seq === 100 ? childOrder : [] },
    parentOf(seq: number): number | null { return seq >= 200 && seq <= 209 ? 100 : null },
  } as unknown as RunModel)
  const opts: NeighborhoodOpts = { maxHop: HORIZON_HOPS, maxPerHop: 4 }
  const ascending = [200, 201, 202, 203, 204, 205, 206, 207, 208, 209]
  const shuffled = [207, 202, 209, 200, 205, 203, 208, 201, 206, 204]

  test('survivors are the smallest maxPerHop seqs regardless of input order', () => {
    const survivors = (order: number[]) =>
      [...causalNeighborhood(star(order), 100, opts).members].filter(s => s !== 100).sort((a, b) => a - b)
    // premise-first: the 4 smallest (200..203) survive; 204..209 are dropped.
    expect(survivors(ascending)).toEqual([200, 201, 202, 203])
    expect(survivors(shuffled)).toEqual([200, 201, 202, 203]) // byte-identical to the ascending feed
  })
  test('count-true summary: total === rendered + dropped, and the cut hop is named', () => {
    const nb = causalNeighborhood(star(shuffled), 100, opts)
    expect(nb.summary.truncated).toEqual({ hop: 1, dropped: 6 })   // 10 candidates − 4 kept
    expect(nb.members.size).toBe(5)                                // self + 4 retained
    expect(nb.summary.total).toBe(nb.members.size + nb.summary.truncated!.dropped) // 5 + 6 === 11 (self + 10)
    expect(nb.summary.total).toBe(11)
    // F3 (superseded pin): a BREADTH cut is NOT a depth claim. This call is unprobed (probeHorizon defaults off)
    // and the star's children are leaves — the chain ENDS at hop 1 — so descendantsBeyond is false. The old pin
    // asserted `true` ("a cut always means more below"), conflating the per-hop drop with a horizon overrun; the
    // dropped members are disclosed by summary.truncated, never by a false beyond-horizon flag.
    expect(nb.descendantsBeyond).toBe(false)
  })
})

// F2 — COMBINED PER-HOP CAP. The ancestor and the descendants at the SAME distance share ONE maxPerHop budget, so
// the cap bounds byHop[d] (the RETAINED members at that hop), not each side independently. Before the fix the
// ancestor was inserted unconditionally and the descendants then took another full maxPerHop, so one parent + four
// children under maxPerHop 4 rendered byHop[1] = 5 (the public cap violated) with truncated = null (the drop
// misstated). The pinned smallest-seq rule PROMISES the parent (smallest seq by the decode law) + the three
// smallest children; the combined cap delivers exactly that, with the fifth member a COUNTED drop.
describe('causalNeighborhood — combined per-hop cap (ancestor + descendants share maxPerHop) [F2]', () => {
  // subject 10: parent 5 (an ancestor at hop 1) and four children 20..23 (descendants at hop 1); all else leaves.
  const model = (): RunModel => ({
    childrenOf(seq: number): readonly number[] { return seq === 10 ? [20, 21, 22, 23] : [] },
    parentOf(seq: number): number | null { return seq === 10 ? 5 : null },
  } as unknown as RunModel)
  const opts: NeighborhoodOpts = { maxHop: HORIZON_HOPS, maxPerHop: 4 }

  test('parent + 4 children under maxPerHop 4 → byHop[1] = 4, one dropped, parent survives (was 5 / null)', () => {
    const nb = causalNeighborhood(model(), 10, opts)
    // premise (pre-fix): byHop[1] === 5 (1 ancestor + 4 descendants, cap ignored) and truncated === null.
    expect(nb.summary.byHop[1]).toBe(4)                          // the COMBINED cap holds — never 5
    expect(nb.summary.truncated).toEqual({ hop: 1, dropped: 1 }) // the fifth member is COUNTED, not silently dropped
    expect(nb.ancestors).toBe(1)                                 // the parent survives as smallest-seq — no exemption
    expect(nb.descendants).toBe(3)                               // the three smallest children fill the remaining slots
    expect(nb.members.has(5)).toBe(true)                         // the parent (smallest seq at hop 1) is in
    expect([...nb.members].filter(s => s >= 20).sort((a, b) => a - b)).toEqual([20, 21, 22]) // 3 smallest children
    expect(nb.members.has(23)).toBe(false)                       // the largest-seq child is the dropped one
    expect(nb.summary.total).toBe(nb.members.size + 1)           // count-true: 5 retained + 1 dropped === 6
  })
})

// F1 — BOUNDED SELECTION at high fan-out. The per-hop cap must bound the WORK, not just the result: a node with N
// children retains O(maxPerHop) scratch (an ascending survivor buffer) and NEVER sorts the whole overflow. The
// probe feeds children as a COUNTING iterable with no .length / index / .sort, in DESCENDING order — so the test
// proves (a) the traversal consumes the fan-out as a pure stream (it cannot materialise or sort the input), (b) the
// smallest-seq maxPerHop survive regardless of feed order, count-true, and (c) an identical repeat call is memoised
// (single traversal per selection), the property the three unprobed HORIZON_OPTS surfaces rely on.
describe('causalNeighborhood — bounded selection + memo at high fan-out [F1]', () => {
  const FAN = 10_000
  const SUBJECT = 500
  // children 1000..(1000+FAN-1), all > SUBJECT (forward-only), fed DESCENDING — worst case for a naive "first-k".
  const descChildren = Array.from({ length: FAN }, (_, i) => 1000 + (FAN - 1 - i))
  // A counting iterable: NO .length, NO index, NO .sort. If the traversal tried to materialise/sort the fan-out it
  // would read undefined or throw; iterating is the only way through, and every pull bumps `enumerated`.
  const counting = (arr: number[], probe: { enumerated: number }): Iterable<number> => ({
    [Symbol.iterator]() {
      let i = 0
      return { next: () => (i < arr.length ? (probe.enumerated++, { value: arr[i++]!, done: false }) : { value: 0, done: true }) }
    },
  })
  const model = (probe: { enumerated: number }): RunModel => ({
    childrenOf(seq: number): readonly number[] {
      return (seq === SUBJECT ? counting(descChildren, probe) : []) as unknown as readonly number[]
    },
    parentOf(): number | null { return null },
  } as unknown as RunModel)
  const opts: NeighborhoodOpts = { maxHop: HORIZON_HOPS, maxPerHop: 64 }

  test('10k children → the 64 smallest survive, count-true drop, single-pass streaming enumeration', () => {
    const probe = { enumerated: 0 }
    const nb = causalNeighborhood(model(probe), SUBJECT, opts)
    // The bounded survivor set: self + the 64 SMALLEST seqs (1000..1063), independent of the descending feed.
    expect(nb.members.size).toBe(65)
    expect([...nb.members].filter(s => s !== SUBJECT).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 64 }, (_, i) => 1000 + i))
    expect(nb.summary.byHop).toEqual([1, 64, 0, 0])              // retained scratch never exceeded the 64 budget
    expect(nb.summary.truncated).toEqual({ hop: 1, dropped: FAN - 64 })
    expect(nb.summary.total).toBe(FAN + 1)                       // count-true: every candidate was counted
    expect(probe.enumerated).toBe(FAN)                           // single pass — each child pulled exactly once
  })

  test('single traversal per selection — an identical repeat call is served from the memo, not re-walked', () => {
    const probe = { enumerated: 0 }
    const m = model(probe)
    causalNeighborhood(m, SUBJECT, opts)                         // first call computes, enumerates FAN children
    causalNeighborhood(m, SUBJECT, opts)                         // identical (model, seq, opts, unprobed): memo HIT
    // A re-walk would make enumerated 2·FAN. The three unprobed HORIZON_OPTS surfaces (ChainLinks, chainTicks,
    // the query stage hop map) issue exactly this identical call, so they share the ONE cached traversal.
    expect(probe.enumerated).toBe(FAN)
  })
})

// THE TWO-SURFACE AGREEMENT PIN — the whole point of the wave. What the 3D links iterate (causalNeighborhood
// members) and what the timeline overlay draws (chainTicks members) are the SAME set for every selection, because
// both resolve through the ONE HORIZON_OPTS call. The old regime (ChainLinks on unbounded causalChain, the overlay
// on the bounded walk) could disagree; that class is now dead by construction.
describe('two-surface agreement — links members === horizon members (disagreement class dead)', () => {
  test('across ALL 75 e0 selections, chainTicks members === causalNeighborhood(HORIZON_OPTS) members', () => {
    for (let seq = 0; seq < e0.eventCount; seq++) {
      const linkMembers = [...causalNeighborhood(e0, seq, HORIZON_OPTS).members].sort((a, b) => a - b)
      const horizonMembers = [...chainTicks(e0, seq).members].sort((a, b) => a - b)
      expect(linkMembers, `seq ${seq}`).toEqual(horizonMembers)
    }
  })
})

// MIGRATION GUARD (v0.8 W2) — the render plane must NOT reach for the unbounded RunModel.causalChain; it uses
// causalNeighborhood. A cheap source-string assertion: no render-plane file may contain the call `.causalChain(`.
// (The W3 oracle in THIS test file and runModel.test.ts keep the full chain — export-tier, not the render plane.)
describe('render-plane migration guard — no causalChain in the pixel path', () => {
  const RENDER_PLANE = [
    'src/ui/chain.ts', 'src/ui/chainLinks.tsx', 'src/ui/Inspector.tsx',
    'src/ui/Timeline.tsx', 'src/ui/queryStageView.tsx', 'src/ui/Scene.tsx',
  ]
  test.each(RENDER_PLANE)('%s does not call causalChain (uses the bounded neighbourhood)', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).not.toContain('causalChain(')
  })
})
