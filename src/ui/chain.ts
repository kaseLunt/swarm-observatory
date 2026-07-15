import type { RunModel } from '../model/runModel'

// THE AGGREGATION HORIZON (constitution Part I.E / III.7; consult-legibility-miniwave §1). ONE constant, TWO
// surfaces: the causality module owns the causality horizon, and BOTH the stage (queryStageView.tsx) and the
// timeline chain overlay (chainTicks → Timeline.tsx) consume it. A selection lights its ≤ HORIZON_HOPS causal
// neighborhood and NOTHING beyond — aggregation is enforced, not the whole-chain WHY-wash. On a linear chain
// that is ≤ 2·HORIZON_HOPS + 1 = 7 members (the squint budget). Why 3 on e0's degenerate hash chain: a LOS
// composite's three component probes immediately precede it, so N=3 lights exactly a composite's own evidence
// — the only causally meaningful neighborhood this data has; N=4 crosses battery boundaries and re-grows the
// wash, N=2 cuts a composite's evidence. On a non-degenerate graph (C1 cross-entity) N hops is a true
// neighborhood, so this is constitutional enforcement, not an e0 special case.
export const HORIZON_HOPS = 3

// seq → causal HOP distance from `seq` (0 = self), bounded to `maxHop` (entries beyond it are OMITTED — a
// ≤ 2·maxHop + 1 -entry map on a linear chain). BOUNDED TRAVERSAL (v0.7 T3 fix W3): the cost is the size of
// the ≤maxHop NEIGHBORHOOD, never the total chain — a beyond-horizon ancestor is never fetched and a
// beyond-horizon descendant is never enumerated. Ancestors: parent-walk EXACTLY maxHop steps (nearest-first,
// so the d-th parent is hop d). Descendants: BFS over `childrenOf`, expanding a node ONLY while its hop <
// maxHop, so a hop-maxHop node is recorded but its children are never visited (the whole point — a branching
// chain's beyond-horizon subtree is untouched). Cycle safety is guaranteed at the decode boundary
// (decodeBundle rejects cyclic/forward causation), but this walk is defensively self-guarding regardless: the
// hop map doubles as the visited set (a node already mapped is never re-expanded / re-set), so a malformed
// cyclic causation array bounds the work instead of looping forever. The ONE hop primitive that the stage's
// role-by-hop line colouring and the timeline's bounded geometry both read, so the two surfaces can never
// disagree on the neighborhood. Pure; one Map allocated (plus a bounded BFS queue).
export function causalHops(model: RunModel, seq: number, maxHop: number): Map<number, number> {
  const hop = new Map<number, number>([[seq, 0]])
  // Ancestors — parent-walk at most maxHop steps (stops at the root, or on a defensive cycle back into the set).
  let node = seq
  for (let d = 1; d <= maxHop; d++) {
    const par = model.parentOf(node)
    if (par === null || hop.has(par)) break
    hop.set(par, d)
    node = par
  }
  // Descendants — BFS from seq; a node at the horizon (hop === maxHop) is NOT expanded, so beyond-horizon
  // descendants are never enumerated. `hop.has` is the visited guard (children direction is a forest by
  // construction, so this only bites on a defensively-handled cycle).
  const queue: number[] = [seq]
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    const ch = hop.get(cur)!
    if (ch >= maxHop) continue
    for (const c of model.childrenOf(cur)) {
      if (hop.has(c)) continue
      hop.set(c, ch + 1)
      queue.push(c)
    }
  }
  return hop
}

export interface ChainGeometry { ticks: Float64Array; arcs: Float64Array; members: ReadonlySet<number> }

// HORIZON-BOUNDED chain geometry for the 2D timeline overlay (consult §1.4). Members = { hop ≤ HORIZON_HOPS }
// (≤7 on a linear chain); ticks are drawn for members only; an arc is emitted ONLY when BOTH its endpoints are
// members — else the root-most member would drag one dangling arc out to a hop-(HORIZON_HOPS+1) tick — so a
// linear chain draws ≤ 2·HORIZON_HOPS arcs. `members` (a Set, order-independent) is carried so the timeline's
// hover identity can tell whether a hovered event is on the lit ribbon (an arc it belongs to is drawn iff both
// its endpoints are members) without re-walking the causation graph per pointer move. The full-height accent
// SELECTION mark is a separate Timeline concern and is untouched by the horizon.
export function chainTicks(model: RunModel, seq: number): ChainGeometry {
  const hop = causalHops(model, seq, HORIZON_HOPS)
  const members: ReadonlySet<number> = new Set(hop.keys())
  const tickSet = new Set<number>()
  const arcs: number[] = []
  for (const m of members) {
    tickSet.add(model.ticks[m]!)
    const p = model.parentOf(m)
    if (p !== null && members.has(p)) arcs.push(model.ticks[p]!, model.ticks[m]!)
  }
  return {
    ticks: Float64Array.from([...tickSet].sort((a, b) => a - b)),
    arcs: Float64Array.from(arcs),
    members,
  }
}

// ARCS RESERVED FOR SELECTION (constitution LAW 1, the emphasis budget). The timeline's causal overlay —
// the up-bowing arcs and the bright chain marks — exists ONLY for the selected event's chain: with nothing
// selected there is no chain geometry, so the draw loop has nothing to paint and the ribbon stays quiet.
// This is the single structural gate (null selection ⟹ null geometry ⟹ no overlay), extracted so the
// reservation is unit-provable without mounting the canvas rAF loop.
export function activeChain(model: RunModel, selectedEvent: number | null): ChainGeometry | null {
  return selectedEvent === null ? null : chainTicks(model, selectedEvent)
}

// The model-global nearestEventSeq that lived here is retired: the timeline resolves events PER LANE
// (lane-aware hit-testing — with multiple lanes a global nearest could name/select a DIFFERENT lane's
// event at the same tick). Its ±2-window/left-preference semantics live on in lanes.ts nearestSeqAt,
// the one resolver hover identity and click selection share. The full root→leaf `chainMembers` ordering
// helper is also retired with the horizon — the 3D ChainSpine that once consumed it was replaced by the
// query stage (which lenses by hop, above), and the timeline overlay now reads the bounded `causalHops`
// membership directly, so the unbounded ordering has no remaining consumer.
