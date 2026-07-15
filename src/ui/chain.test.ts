import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { activeChain, causalHops, chainTicks, HORIZON_HOPS } from './chain'
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
