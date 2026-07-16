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

// PER-HOP BREADTH CAP for the render plane (v0.8 W2). maxHop bounds DEPTH; maxPerHop bounds the fan-out at any
// single hop, so a pathologically wide graph can never enumerate — or render — an unbounded set of neighbours.
// On e0 (a linear hash chain, exactly 1 member per hop) it never bites, so it is invisible for shipped content;
// it exists so the ChainLinks buffer and the stage/timeline overlays have a HARD, DECLARED bound instead of the
// old silent 256-link drop. 64 is far above any realistic cross-entity fan-out yet keeps the worst-case member
// count (1 + maxHop·(1 + maxPerHop)) small enough to preallocate.
export const HORIZON_MAX_PER_HOP = 64

export interface NeighborhoodOpts {
  /** DEPTH bound: hops ≤ maxHop from the subject (0 = self). Members beyond are never fetched. */
  maxHop: number
  /** BREADTH bound: at most maxPerHop members are RETAINED per hop; the rest are dropped by the pinned rule. */
  maxPerHop: number
}

// THE ONE render-plane neighborhood opts. EVERY pixel surface — ChainLinks (3D), chainTicks (timeline overlay),
// the queryStageView role colouring, and the Inspector chainmeta chip — resolves through causalNeighborhood with
// THIS object, so all four draw the SAME member set for a given selection (the two-surface disagreement class is
// dead by construction: same seq + same opts ⇒ same members). Change the horizon in ONE place.
export const HORIZON_OPTS: NeighborhoodOpts = { maxHop: HORIZON_HOPS, maxPerHop: HORIZON_MAX_PER_HOP }

// COUNT-TRUE summary of a bounded traversal — the truth about what the bound cut, never a silent drop.
// INVARIANT: total === members.size + (truncated?.dropped ?? 0). `total` counts every member ENUMERATED within
// maxHop (retained + dropped); a dropped member's own subtree is never enumerated (that is the whole point of the
// bound), so `total` is the honest size of the maxHop neighbourhood as discovered, not a whole-chain count.
export interface NeighborhoodSummary {
  total: number                                        // retained + dropped (members enumerated within maxHop)
  byHop: readonly number[]                             // RETAINED member count per hop, index 0..maxHop (both directions)
  truncated: { hop: number; dropped: number } | null  // shallowest hop cut by maxPerHop + TOTAL members dropped; null = clean
}

// THE bounded causal neighbourhood of a selection: the ONE traversal every render surface shares. Members are the
// ≤ maxHop, ≤ maxPerHop-per-hop set around `seq`; `hop` maps each member to its hop distance (0 = self). The
// directional retained counts + horizon-probe flags feed the chainmeta chip; the summary feeds honesty (the chip
// declares any per-hop cut). See causalNeighborhood for the traversal + truncation contract.
export interface CausalNeighborhood {
  hop: ReadonlyMap<number, number>   // member seq → hop distance (0 = self)
  members: ReadonlySet<number>       // = hop keys; order-independent membership (arc/link both-endpoint tests)
  ancestors: number                  // RETAINED ancestor members (the chip's "up" count)
  descendants: number                // RETAINED descendant members (the chip's "down" count)
  ancestorsBeyond: boolean           // the chain continues PAST the ancestor horizon (only set when probeHorizon)
  descendantsBeyond: boolean         // the chain continues PAST the descendant horizon (only set when probeHorizon)
  summary: NeighborhoodSummary
}

// PINNED TRUNCATION ORDER (v0.8 W2, the honesty-tier ruling). When a hop has more than its maxPerHop budget of
// candidate members, the survivors are the maxPerHop with the SMALLEST seq (ascending), and the rest are dropped.
// WHY seq-ascending: causation in a decoded bundle is forward-only (decodeBundle rejects a child whose seq ≤ its
// parent), so seq is the event's monotonic creation index and ascending seq is a data-INTRINSIC total order — the
// survivor set is therefore a pure function of member identity, never of childrenOf() enumeration order (feed the
// same candidates shuffled and the same members survive). Keeping the smallest seqs keeps the earliest, most
// causally-upstream members of the hop (premise-first). The drop is COUNTED into the summary, never silent.
//
// COMBINED PER-HOP CAP (v0.8 W2 F2): the ancestor and descendant sides SHARE one maxPerHop budget at each hop —
// the cap bounds byHop[d] (the RETAINED members at distance d), not each side independently. The single ancestor
// at hop d (parent-walk, at most one) has a smaller seq than the subject, hence than every hop-d descendant, so
// under the pinned rule it survives NATURALLY and simply consumes one of the hop's slots; the descendants compete
// for the remainder. So one parent + four children under maxPerHop 4 retains the parent + the three smallest
// children (byHop[1] = 4, one dropped), never the pre-fix five. Directional counts and the dropped total are read
// AFTER this combined selection.
//
// BOUNDED SELECTION (v0.8 W2 F1): the survivors are chosen WITHOUT materialising or sorting the whole fan-out. A
// node with N children still costs O(N) to ENUMERATE (every candidate must be counted for the count-true summary)
// but only O(maxPerHop) SCRATCH and NO O(N log N) sort — an ascending survivor buffer of length ≤ budget keeps the
// winners as candidates stream past, and an overflow candidate is only counted, never retained. childrenOf
// enumerates ascending by seq (RunModel builds children[c] by pushing child indices in increasing i), so each
// source is an ordered stream; this is the k-way-merge reality, not a max-heap fallback. A wide bundle can no
// longer freeze the click path with an O(N) scratch Set + array and a full sort.
//
// BOUNDED TRAVERSAL (v0.7 T3 fix W3, preserved): the cost is the size of the ≤maxHop neighbourhood, never the total
// chain. Ancestors: single-parent walk EXACTLY maxHop steps (the d-th parent is hop d). Descendants: BFS level by
// level, expanding a level's survivors only while depth < maxHop, so a hop-maxHop node is recorded but its children
// are never visited. `hop.has` doubles as the visited guard, so a malformed cyclic causation array bounds the work
// instead of looping (decodeBundle already rejects cycles, and children[] holds no duplicates by construction —
// each event has ONE causation parent — so this guard, not a per-level Set, is all the dedup the traversal needs).
// probeHorizon = one extra O(boundary) peek per side to set the *Beyond flags for the chip; it is OFF by default
// (the geometry/link consumers never pay it) and never enumerates a beyond-horizon SUBTREE.
//
// MEMOISED (v0.8 W2 F1): the four render surfaces each resolve the SAME (model, seq, opts, probeHorizon)
// neighbourhood once per selection — three of them (ChainLinks, the timeline overlay via chainTicks, and the query
// stage hop map) issue the IDENTICAL HORIZON_OPTS/unprobed call, the Inspector chip the probed one. A model-keyed
// LRU (WeakMap → freed when the run is swapped out) collapses those repeats to ONE traversal per distinct key; the
// result is deeply readonly (ReadonlyMap/ReadonlySet) and every consumer treats it so, so one shared instance is
// safe. Selection-rate, never per-frame: the consumers already recompute only on selectedEvent change (useEffect /
// ref-guard / React.memo), so there is nothing to invalidate here and no per-frame key to churn.
export function causalNeighborhood(
  model: RunModel,
  seq: number,
  opts: NeighborhoodOpts,
  probeHorizon = false,
): CausalNeighborhood {
  const key = `${seq}|${opts.maxHop}|${opts.maxPerHop}|${probeHorizon ? 1 : 0}`
  let perModel = NB_MEMO.get(model)
  if (perModel) {
    const hit = perModel.get(key)
    if (hit) { perModel.delete(key); perModel.set(key, hit); return hit } // LRU touch — most-recent to the tail
  } else {
    perModel = new Map()
    NB_MEMO.set(model, perModel)
  }
  const result = computeNeighborhood(model, seq, opts, probeHorizon)
  perModel.set(key, result)
  if (perModel.size > NB_MEMO_CAP) perModel.delete(perModel.keys().next().value!) // evict least-recent
  return result
}

// Model-keyed memo store (see MEMOISED above). WeakMap so a swapped-out run's cache is GC'd with the model; a small
// LRU per model caps a session's click history. Keyed by (seq, maxHop, maxPerHop, probeHorizon) VALUES so a fresh
// opts object carrying the same numbers still hits (and probeHorizon is in the key — the probed and unprobed calls
// return different *Beyond flags and must not share a slot).
const NB_MEMO = new WeakMap<RunModel, Map<string, CausalNeighborhood>>()
const NB_MEMO_CAP = 32

// Insert x into the ascending buffer, keeping it sorted (linear scan from the tail — for the ordered-stream common
// case x lands at or near the end, O(1) amortised; worst case O(buffer) ≤ O(maxPerHop)). Only the BOUNDED path
// calls this; the unbounded (causalHops) path pushes in enumeration order and never sorts.
function insertAscending(buf: number[], x: number): void {
  let i = buf.length
  while (i > 0 && buf[i - 1]! > x) i--
  buf.splice(i, 0, x)
}

function computeNeighborhood(
  model: RunModel,
  seq: number,
  opts: NeighborhoodOpts,
  probeHorizon: boolean,
): CausalNeighborhood {
  const { maxHop, maxPerHop } = opts
  const hop = new Map<number, number>([[seq, 0]])
  const byHop = new Array<number>(maxHop + 1).fill(0)
  byHop[0] = 1
  let total = 1
  let dropped = 0
  let truncHop = -1

  // ── Ancestors — parent-walk at most maxHop steps (stops at the root, or defensively on a cycle). One member
  //    per hop; it consumes hop d's first budget slot (COMBINED PER-HOP CAP) but can never be dropped — its seq
  //    is the smallest at its hop.
  let ancestors = 0
  let node = seq
  for (let d = 1; d <= maxHop; d++) {
    const par = model.parentOf(node)
    if (par === null || hop.has(par)) break
    hop.set(par, d); byHop[d]! += 1; total++; ancestors++
    node = par
  }
  // Horizon probe (ancestor side): if the walk filled ALL maxHop ancestor hops, is there one more above? One
  // parentOf() call — bounded, and it is the ONLY read past the horizon (it fetches nothing it maps).
  let ancestorsBeyond = false
  if (probeHorizon && maxHop > 0 && ancestors === maxHop) {
    ancestorsBeyond = model.parentOf(node) !== null
  }

  // ── Descendants — BFS level by level. Each level shares hop d's maxPerHop budget with the ancestor (F2) and
  //    selects the smallest-seq survivors with O(maxPerHop) scratch (F1). Each level's candidates are the not-yet-
  //    seen children of the previous level's SURVIVORS.
  let descendants = 0
  let frontier: number[] = [seq]
  for (let d = 1; d <= maxHop; d++) {
    const budget = maxPerHop - (d <= ancestors ? 1 : 0)   // the ancestor at hop d (if any) already holds one slot
    const unbounded = !Number.isFinite(budget)
    let candCount = 0
    const survivors: number[] = []                        // ascending; length ≤ budget — the retained-scratch bound
    for (const cur of frontier) {
      for (const c of model.childrenOf(cur)) {
        if (hop.has(c)) continue                          // back-edge / already-mapped guard (children[] is dup-free)
        candCount++
        if (unbounded) {
          survivors.push(c)                               // causalHops export path: keep all, order irrelevant, no sort
        } else if (survivors.length < budget) {
          insertAscending(survivors, c)
        } else if (budget > 0 && c < survivors[budget - 1]!) {
          insertAscending(survivors, c)
          survivors.length = budget                       // evict the current max (last, since ascending)
        }
        // else: budget full and c ≥ its max → dropped; counted only, never retained
      }
    }
    if (candCount === 0) { frontier = []; break }
    total += candCount
    const dropAtHop = candCount - survivors.length
    if (dropAtHop > 0) { dropped += dropAtHop; if (truncHop < 0) truncHop = d }
    for (const c of survivors) { hop.set(c, d); byHop[d]! += 1; descendants++ }
    frontier = survivors
  }

  // Horizon probe (descendant side) — DEPTH continuation ONLY (F3). A maxHop-boundary SURVIVOR having a child means
  // the chain extends past the descendant horizon. A breadth cut (truncHop) is a SEPARATE fact the summary already
  // declares as `dropped`; it must NOT be read as a horizon claim (a wide but SHALLOW fan-out ends AT its hop, and
  // the depth of a dropped branch is UNKNOWN — never enumerated). Set only under an explicit probe; unprobed the
  // flag stays a conservative false (never claims hidden depth), so the geometry/link consumers pay nothing.
  let descendantsBeyond = false
  if (probeHorizon) {
    for (const cur of frontier) {
      if (model.childrenOf(cur).length > 0) { descendantsBeyond = true; break }
    }
  }

  return {
    hop,
    members: new Set(hop.keys()),
    ancestors,
    descendants,
    ancestorsBeyond,
    descendantsBeyond,
    summary: { total, byHop, truncated: truncHop >= 0 ? { hop: truncHop, dropped } : null },
  }
}

// seq → causal HOP distance from `seq` (0 = self), bounded to `maxHop`. A THIN VIEW over causalNeighborhood with
// no per-hop cap (maxPerHop = ∞) and no horizon probe — so it is byte-identical to the pre-W2 bounded walk and the
// ONE traversal is shared, never re-implemented. Retained as the stage/tool accessor that needs only the hop map.
export function causalHops(model: RunModel, seq: number, maxHop: number): Map<number, number> {
  return new Map(causalNeighborhood(model, seq, { maxHop, maxPerHop: Number.POSITIVE_INFINITY }).hop)
}

export interface ChainGeometry { ticks: Float64Array; arcs: Float64Array; members: ReadonlySet<number> }

// HORIZON-BOUNDED chain geometry for the 2D timeline overlay (consult §1.4). Members = the HORIZON_OPTS
// neighbourhood — the SAME call ChainLinks and the stage route through, so the timeline lights and the 3D links
// can never disagree. Ticks are drawn for members only; an arc is emitted ONLY when BOTH its endpoints are members
// (else the root-most member would drag one dangling arc out to a beyond-horizon tick), so a linear chain draws
// ≤ 2·HORIZON_HOPS arcs. `members` (a Set, order-independent) is carried so the timeline's hover identity can tell
// whether a hovered event is on the lit ribbon without re-walking the causation graph per pointer move.
export function chainTicks(model: RunModel, seq: number): ChainGeometry {
  const { members } = causalNeighborhood(model, seq, HORIZON_OPTS)
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
// query stage (which lenses by hop, above), and the timeline overlay now reads the bounded neighbourhood
// membership directly, so the unbounded ordering has no remaining consumer.
