import type { CategoryKey } from './theme'
import { categoryOf } from './categorize'

// Category presentation order (theme.ts CATEGORY's declared order). Lanes are keyed by KIND (below);
// this ranking only decides how kind-lanes GROUP vertically — all of a category's kinds sit together,
// query block first, comms block last — so hue blocks read as contiguous bands, stable across runs.
const CATEGORY_ORDER: readonly CategoryKey[] = ['query', 'decision', 'mutating', 'fact', 'comms']
const CATEGORY_RANK = new Map<CategoryKey, number>(CATEGORY_ORDER.map((c, i) => [c, i]))

export interface Lane { kind: number; category: CategoryKey; seqs: number[] }

// PER-KIND lanes (design spec §5.2; constitution §5 instrument citizenship): one row per distinct event
// KIND, so rows mean something at kind granularity. The category supplies ONLY the lane's hue/glyph
// metadata (hue = identity does not grow — kinds within a category share the hue and are distinguished
// by ROW position + hover naming). Ordering is deterministic and insertion-independent: category rank
// first (so same-hue lanes sit adjacent), then ascending kind id within the category. PROGRESSIVE
// STRUCTURE — only kinds actually present get a lane, so a single-kind run (e0 today) collapses to ONE
// lane with no empty striping, and a multi-kind run fans out one row per kind. Pure over the per-event
// kind array; seqs stay in ascending event order (the input scan order).
export function assignLanes(kinds: ArrayLike<number>): Lane[] {
  const byKind = new Map<number, number[]>()
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]!
    const arr = byKind.get(k)
    if (arr) arr.push(i)
    else byKind.set(k, [i])
  }
  return [...byKind.entries()]
    .map(([kind, seqs]) => ({ kind, category: categoryOf(kind), seqs }))
    .sort((a, b) => (CATEGORY_RANK.get(a.category)! - CATEGORY_RANK.get(b.category)!) || (a.kind - b.kind))
}

// ── Lane band geometry — the SINGLE SOURCE both the canvas draw loop and the pointer hit-testing use.
// The top LABEL_BAND fraction of the canvas is reserved for chapter labels; the remainder divides evenly
// into the lanes. Everything is in the height-FRACTION domain (multiply by the live canvas height for
// pixels — scalar arithmetic, nothing allocated on the frame path).
export const LABEL_BAND = 0.3
export const laneHeightFrac = (laneCount: number): number => (1 - LABEL_BAND) / laneCount
export const laneTopFrac = (i: number, laneCount: number): number => LABEL_BAND + i * laneHeightFrac(laneCount)
// Geometric inverse of laneTopFrac: which lane band a y-fraction falls in, clamped at both ends. This is
// pure GEOMETRY (no hit policy) — pointer code goes through laneHitAtY below, which layers the label-band
// policy on top. Requires laneCount >= 1 (callers guard the empty-run case).
export function laneIndexAtY(yFrac: number, laneCount: number): number {
  const i = Math.floor((yFrac - LABEL_BAND) / laneHeightFrac(laneCount))
  return Math.max(0, Math.min(laneCount - 1, i))
}

// Pointer hit POLICY over the geometry above — what hover identity and click selection both use. In a
// MULTI-lane ribbon the chapter-label band is chapter territory: no lane draws marks there, so a pointer
// in the band resolves to NO lane (null) — hover falls through to the chapter voice and a click selects
// nothing (clamping to lane 0 would select an event whose mark is not under the cursor). With a SINGLE
// lane the band clamps to that lane — the whole ribbon is one row (the full-height overlay marks pass
// through the band), behavior-identical to the pre-lane timeline. Below-canvas clamps to the last lane
// in both shapes (marks are drawn to the bottom edge).
export function laneHitAtY(yFrac: number, laneCount: number): number | null {
  if (laneCount > 1 && yFrac < LABEL_BAND) return null
  return laneIndexAtY(yFrac, laneCount)
}

// ── Lane-scoped nearest-event resolver — the ONE resolver hover identity and click selection share
// (symmetry: what a hover names is what a click selects). Same semantics the retired model-global
// nearestEventSeq had, restricted to one lane's events: exact tick first, then distance 1, then 2, with
// the LEFT (earlier) tick preferred at equal distance; among same-tick events the lowest seq wins.
// `ticks` must be sorted ascending with `seqs` parallel (Timeline's laneData memo builds exactly that);
// binary search per candidate tick, so DOM-event-rate cheap even at campaign lane sizes.
export function nearestSeqAt(
  ticks: ArrayLike<number>, seqs: ArrayLike<number>, tick: number, window = 2,
): number | null {
  const at = (t: number): number | null => {
    let lo = 0, hi = ticks.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid]! < t) lo = mid + 1; else hi = mid }
    return lo < ticks.length && ticks[lo] === t ? seqs[lo]! : null
  }
  for (let d = 0; d <= window; d++) {
    for (const t of d === 0 ? [tick] : [tick - d, tick + d]) {
      if (t < 0) continue
      const s = at(t)
      if (s !== null) return s
    }
  }
  return null
}

// ── Heat-bin X geometry — the SINGLE SOURCE for "which painted bin is under the pointer", BIT-EXACT
// with the draw. The draw tiles bin b over the backing-store pixel span
// [Math.round(b·bw), Math.round((b+1)·bw)) with bw = width/binCount — integer-snapped boundaries are
// correct rendering (crisp seam-free columns), so the HIT-TEST adapts to the draw, never the reverse.
// A plain floor over the x-fraction is NOT equivalent when width is not divisible by binCount (e.g.
// 1200/199: first painted boundary = round(6.03…) = 6px, floor-boundary at 6.03px — x=6.01 would report
// bin 0 while the pixel under the cursor is painted bin 1). So: seed a candidate from the un-rounded
// inverse, then settle it against the SAME Math.round(b·bw) boundary expression the draw computes —
// identical operations on identical operands give identical float64s, hence bit-exact inversion at
// every x. The while loops move at most one step for any bw ≥ 1 (rounding shifts a boundary ≤ 0.5px)
// and are clamp-guarded for pointer-capture x past either edge. x is in BACKING-STORE pixels (callers
// scale CSS x by canvasWidth/rectWidth). NEVER derive the bin from a rounded nearest TICK either:
// tickAtX boundaries sit at half-tick offsets — the same misreport class from the other direction.
export function heatBinAtPx(x: number, width: number, binCount: number): number {
  const bw = width / binCount
  let b = Math.max(0, Math.min(binCount - 1, Math.floor(x / bw)))
  while (b > 0 && x < Math.round(b * bw)) b--
  while (b < binCount - 1 && x >= Math.round((b + 1) * bw)) b++
  return b
}

// ── Heat-mode aggregate for a PAINTED BIN (from heatBinAtPx above). When a lane renders as alpha-graded
// heat, one bin can aggregate many events — naming a single event there would be false specificity, so
// the hover answers for the WHOLE bin. The bin's tick span mirrors densityBins' mapping exactly (bin =
// floor(tick/tickCount × binCount), clamped; the final bin additionally owns the tick === tickCount edge
// that densityBins clamps into it), so the answer describes precisely the pixels the draw painted.
// count===1 surfaces that event's seq (soleSeq) — one event is honestly nameable; count===0 lets the
// caller fall through to the chapter voice.
export function heatAggregateAt(
  ticks: ArrayLike<number>, seqs: ArrayLike<number>,
  bin: number, tickCount: number, binCount: number,
): { count: number; startTick: number; endTick: number; soleSeq: number | null } {
  const startTick = Math.ceil((bin * tickCount) / binCount)
  const endTick = bin === binCount - 1 ? tickCount : Math.ceil(((bin + 1) * tickCount) / binCount) - 1
  const lower = (t: number): number => {
    let lo = 0, hi = ticks.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid]! < t) lo = mid + 1; else hi = mid }
    return lo
  }
  const i0 = lower(startTick)
  const count = lower(endTick + 1) - i0
  return { count, startTick, endTick, soleSeq: count === 1 ? seqs[i0]! : null }
}

// ── Click-selection policy for a lane — the click side of the hover/click symmetry, pure so both honest
// postures are unit-pinned. A ticks-mode lane selects its nearest event (±2 window). A heat-mode lane
// resolves the PAINTED bin under the click x (backing-store pixels + width, per heatBinAtPx): a
// sole-event bin selects that event (exactly what the hover names); a multi-event bin is a NO-OP —
// selecting one arbitrary member would claim precision the hover just disclaimed with its "N events"
// aggregate (an aggregate-selection affordance is future work, tracked on the roadmap); an empty bin
// selects nothing.
export function laneClickSeq(
  mode: 'ticks' | 'heat',
  ticks: ArrayLike<number>, seqs: ArrayLike<number>,
  tick: number, x: number, width: number, tickCount: number, binCount: number,
): number | null {
  if (mode === 'ticks') return nearestSeqAt(ticks, seqs, tick)
  return heatAggregateAt(ticks, seqs, heatBinAtPx(x, width, binCount), tickCount, binCount).soleSeq
}
