import type { EventTick } from '../lib/brand'

// ── THE SHARED REVEAL CLOCK ─────────────────────────────────────────────────────────────────────────────
// ONE prefix-count answers "how many of a kind-sequence's events has the playhead revealed?" A kind-sequence
// is the ascending-by-tick tick axis of ONE kind's events — the comms strip's messages, the belief lens's
// track updates, the sensing strip's verdicts. Every consumer shares THIS clock over its own sequence instead
// of growing a private tick→count clock; a different kind-filter/run-lens plugs a different tick array in here
// and nothing else changes.
//
// tick ≤ playhead is REVEALED — the playhead has reached (or sits exactly on) the tick the engine committed
// the event at. A scrub back TRUNCATES the revealed prefix by construction: the count is a pure function of
// the playhead in BOTH directions, so there is no sticky reveal to clear (mirroring the spine reveal clock's
// contract, not its seq==tick code). The playhead rides the EventTick brand (a consumer brands the plain
// store playhead at its own ingestion, via cursor.eventTickOf) — no raw-number laundering at this seam.
//
// COST: the tick array is sorted + frozen ONCE at load; every query is an O(log n) binary search over it with
// ZERO allocation, so a strip that re-asks on every playhead move (frame-rate during play) never touches the
// heap on the hot path — no per-frame filter/map over the sequence.
export interface RevealClock {
  /** the full-reveal count — the whole kind-sequence (what an end-of-run playhead reveals). */
  readonly total: number
  /** how many events have tick ≤ playhead — the revealed prefix length. O(log n), zero allocation. */
  revealedCount(playhead: EventTick): number
  /** the ordinal of the LATEST revealed event (revealedCount − 1), or −1 when nothing is revealed yet.
   *  A consumer indexes its OWN ordered data (same order as the ticks passed to buildRevealClock) with this. */
  latestRevealedIndex(playhead: EventTick): number
}

// Upper bound: the count of ticks ≤ `playhead` in an ascending array. The first index whose tick EXCEEDS the
// playhead equals that count, so `tick === playhead` is included (the ≤ boundary — exactly-at-playhead is
// revealed). Zero allocation; the whole hot path lives here.
function revealedCountIn(ticks: Float64Array, playhead: number): number {
  let lo = 0, hi = ticks.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ticks[mid]! <= playhead) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Build a reveal clock over one kind-sequence's ticks. Each tick is an EventTick-domain value — a
// NON-NEGATIVE SAFE INTEGER — and the sequence must be ASCENDING (the binary-search precondition). BOTH are
// validated ONCE here (load-path) and fail loud rather than silently returning wrong counts. The element check
// runs BEFORE the monotonicity check for a load-bearing reason: Float64Array.from turns a sparse hole /
// undefined into NaN, and every NaN comparison is false — so an ascending-only check would let [1, NaN, 2]
// straight through and revealedCount would then miscount, while a lone [NaN] would reveal nothing forever.
// Rejecting NaN / ±Infinity / fractional / negative up front closes that. The ticks are copied into an owned
// Float64Array so the clock cannot be corrupted by a later mutation of the caller's array and the query stays
// cache-friendly. An empty sequence is well-formed: total 0, revealedCount 0, latestRevealedIndex −1.
export function buildRevealClock(sortedTicks: ArrayLike<number>): RevealClock {
  const ticks = Float64Array.from(sortedTicks)
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!
    if (!Number.isSafeInteger(t) || t < 0) {
      throw new Error(`buildRevealClock: ticks must be non-negative safe integers (index ${i}: ${t})`)
    }
    if (i > 0 && t < ticks[i - 1]!) {
      throw new Error(`buildRevealClock: ticks must be ascending (index ${i}: ${t} < ${ticks[i - 1]})`)
    }
  }
  return {
    total: ticks.length,
    revealedCount: (playhead) => revealedCountIn(ticks, playhead),
    latestRevealedIndex: (playhead) => revealedCountIn(ticks, playhead) - 1,
  }
}
