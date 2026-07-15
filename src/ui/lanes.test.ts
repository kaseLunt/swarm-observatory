import { describe, expect, test } from 'vitest'
import {
  assignLanes, heatAggregateAt, heatBinAtPx, LABEL_BAND, laneClickSeq, laneHitAtY, laneIndexAtY,
  laneTopFrac, nearestSeqAt,
} from './lanes'
import { GEOMETRY_QUERY_RESOLVED } from '../decode/payloads'

// Kind constants used below (EVENT_KIND_NAMES / categorize.ts): 1+23 query, 8 decision, 2 mutating,
// 20 fact, 5 comms. 0x0120/0x0121 are F1's motion kinds — no §2.3 category → categorize's 'query'
// fallback, but PER-KIND lanes give each its OWN row (the category supplies only the hue).
describe('assignLanes — PER-KIND lane assignment (design spec §5.2; constitution §5)', () => {
  test('single-KIND run collapses to ONE lane (e0 today: every event is kind 23)', () => {
    const lanes = assignLanes([GEOMETRY_QUERY_RESOLVED, GEOMETRY_QUERY_RESOLVED, GEOMETRY_QUERY_RESOLVED])
    expect(lanes).toHaveLength(1)
    expect(lanes[0]!).toEqual({ kind: 23, category: 'query', seqs: [0, 1, 2] })
  })

  test('two kinds in the SAME category fan out to two lanes (rows are kind-keyed, hue is shared)', () => {
    const lanes = assignLanes([1 /*DetectionMade*/, 23 /*GeometryQueryResolved*/, 1])
    expect(lanes).toHaveLength(2)
    expect(lanes[0]!).toEqual({ kind: 1, category: 'query', seqs: [0, 2] }) // ascending kind within the category
    expect(lanes[1]!).toEqual({ kind: 23, category: 'query', seqs: [1] })
  })

  test('cross-category ordering: category rank first (query→decision→mutating→fact→comms), then kind', () => {
    const lanes = assignLanes([5 /*comms*/, 20 /*fact*/, 8 /*decision*/, 23 /*query*/, 2 /*mutating*/])
    expect(lanes.map(l => l.kind)).toEqual([23, 8, 2, 20, 5])
    expect(lanes.map(l => l.category)).toEqual(['query', 'decision', 'mutating', 'fact', 'comms'])
  })

  test('ordering is insertion-independent: a scrambled encounter order yields identical lanes', () => {
    const a = assignLanes([23, 1, 8, 23, 1])
    const b = assignLanes([8, 23, 1, 1, 23])
    expect(a.map(l => [l.kind, l.category])).toEqual(b.map(l => [l.kind, l.category]))
    expect(a.map(l => l.kind)).toEqual([1, 23, 8])
  })

  test('uncategorized kinds get their OWN lane wearing the query fallback hue (f1: 0x0120 vs 0x0121)', () => {
    const lanes = assignLanes([0x0121, 0x0120, 0x0121])
    expect(lanes).toHaveLength(2)
    expect(lanes[0]!).toEqual({ kind: 0x0120, category: 'query', seqs: [1] })
    expect(lanes[1]!).toEqual({ kind: 0x0121, category: 'query', seqs: [0, 2] })
  })

  test('an empty run yields no lanes (draw loop paints nothing)', () => {
    expect(assignLanes([])).toEqual([])
  })
})

describe('lane band geometry — single source for the draw loop AND pointer hit-testing', () => {
  test('laneTopFrac: lane 0 starts at the label band; lanes tile the remainder evenly', () => {
    expect(laneTopFrac(0, 1)).toBe(LABEL_BAND)
    expect(laneTopFrac(0, 2)).toBe(LABEL_BAND)
    expect(laneTopFrac(1, 2)).toBeCloseTo(LABEL_BAND + (1 - LABEL_BAND) / 2)
  })
  test('laneIndexAtY round-trips laneTopFrac: the centre of each lane band resolves to its own index', () => {
    for (const laneCount of [1, 2, 3, 5]) {
      for (let i = 0; i < laneCount; i++) {
        const centre = laneTopFrac(i, laneCount) + (1 - LABEL_BAND) / laneCount / 2
        expect(laneIndexAtY(centre, laneCount)).toBe(i)
      }
    }
  })
  test('laneIndexAtY (pure geometry) clamps the label band to lane 0 and below-canvas to the last lane', () => {
    expect(laneIndexAtY(0, 3)).toBe(0)
    expect(laneIndexAtY(LABEL_BAND / 2, 3)).toBe(0)
    expect(laneIndexAtY(1, 3)).toBe(2)
    expect(laneIndexAtY(1.4, 3)).toBe(2)
  })
})

describe('laneHitAtY — pointer hit policy over the geometry (label band = chapter territory when multi-lane)', () => {
  test('MULTI-lane: a pointer in the label band resolves NO lane — band click selects nothing, band hover falls to the chapter voice', () => {
    expect(laneHitAtY(0, 3)).toBeNull()
    expect(laneHitAtY(LABEL_BAND / 2, 2)).toBeNull()
  })
  test('MULTI-lane: at and below the band boundary the lanes resolve normally', () => {
    expect(laneHitAtY(LABEL_BAND, 3)).toBe(0)   // boundary belongs to lane 0
    expect(laneHitAtY(0.9, 3)).toBe(2)
    expect(laneHitAtY(1.4, 3)).toBe(2)           // below-canvas still clamps to the last lane
  })
  test('SINGLE lane: the band clamps to the one lane — a band click still selects (pre-lane behavior held)', () => {
    for (const y of [0, 0.2, 0.5, 0.99, 1]) expect(laneHitAtY(y, 1)).toBe(0)
  })
})

describe('nearestSeqAt — the ONE lane-scoped resolver hover and click share', () => {
  // Lane fixture: events at ticks [3, 5, 5, 9] with seqs [10, 11, 12, 13] (sorted by tick, seq-stable).
  const ticks = Float64Array.from([3, 5, 5, 9])
  const seqs = [10, 11, 12, 13]

  test('exact tick hit', () => {
    expect(nearestSeqAt(ticks, seqs, 3)).toBe(10)
    expect(nearestSeqAt(ticks, seqs, 9)).toBe(13)
  })
  test('±2 window resolves, preferring the LEFT (earlier) tick at equal distance', () => {
    expect(nearestSeqAt(ticks, seqs, 4)).toBe(10)  // ticks 3 and 5 both d=1 → left (3) wins
    expect(nearestSeqAt(ticks, seqs, 7)).toBe(11)  // ticks 5 and 9 both d=2 → left (5) wins
    expect(nearestSeqAt(ticks, seqs, 11)).toBe(13) // tick 9 at d=2 (right side only)
  })
  test('same-tick events resolve to the LOWEST seq', () => {
    expect(nearestSeqAt(ticks, seqs, 5)).toBe(11)
  })
  test('a barren stretch (nothing within ±2) answers null', () => {
    expect(nearestSeqAt(ticks, seqs, 14)).toBeNull()
    expect(nearestSeqAt(new Float64Array(0), [], 5)).toBeNull() // empty lane
  })
})

describe('heatBinAtPx — the painted bin under the pointer, BIT-EXACT with the draw\'s rounded tiling', () => {
  // Replicates the draw loop's heat tiling VERBATIM (Timeline.tsx heat branch): bin b paints the pixel
  // span [Math.round(b·bw), Math.round((b+1)·bw)). The reference for the equivalence sweeps below.
  const paintedBins = (width: number, binCount: number): number[] => {
    const bw = width / binCount
    const painted = new Array<number>(width).fill(-1)
    for (let b = 0; b < binCount; b++) {
      const x0 = Math.round(b * bw)
      const x1 = Math.round((b + 1) * bw)
      for (let px = x0; px < x1; px++) painted[px] = b
    }
    return painted
  }

  test('divisible case: boundaries at exact multiples (rounding is a no-op)', () => {
    expect(heatBinAtPx(0, 1200, 10)).toBe(0)
    expect(heatBinAtPx(119.9, 1200, 10)).toBe(0)
    expect(heatBinAtPx(120, 1200, 10)).toBe(1)   // painted-bin boundary: left edge belongs to the new bin
    expect(heatBinAtPx(235.2, 1200, 10)).toBe(1) // the wave-2 boundary-strip pin, in pixel space
  })

  test('NON-DIVISOR BOUNDARY PIN (w=1200, binCount=199): the drawn 6px boundary wins over the 6.03px fraction boundary', () => {
    // bw = 1200/199 ≈ 6.0302: the draw paints bin 0 over [0, round(6.0302)) = [0, 6) — so x=6.01 sits on
    // a PAINTED bin-1 pixel. The retired floor-inversion (floor(6.01/6.0302) = 0) reported bin 0 there:
    // a sub-pixel strip at every boundary re-opening the misreport (and wrong sole-event selection).
    expect(heatBinAtPx(6.01, 1200, 199)).toBe(1)
    expect(heatBinAtPx(5.99, 1200, 199)).toBe(0)
  })

  test('EXHAUSTIVE EQUIVALENCE (w=1200 × binCount 199 and 64): every integer px and every ±0.01 boundary offset resolves to the painted bin', () => {
    for (const [width, binCount] of [[1200, 199], [1200, 64]] as const) {
      const painted = paintedBins(width, binCount)
      // The draw's tiling covers every pixel exactly once (the integer-snapped abut invariant)…
      expect(painted.every(b => b >= 0)).toBe(true)
      // …and the hit-test agrees with the paint at every integer pixel…
      for (let px = 0; px < width; px++) {
        if (heatBinAtPx(px, width, binCount) !== painted[px]!) {
          throw new Error(`(${width},${binCount}) px=${px}: hit ${heatBinAtPx(px, width, binCount)} ≠ painted ${painted[px]}`)
        }
      }
      // …and at the sub-pixel strips hugging each painted boundary (the misreport class).
      const bw = width / binCount
      for (let k = 1; k < binCount; k++) {
        const edge = Math.round(k * bw)
        expect(heatBinAtPx(edge - 0.01, width, binCount)).toBe(painted[edge - 1]!)
        expect(heatBinAtPx(edge + 0.01, width, binCount)).toBe(painted[edge]!)
      }
    }
  })

  test('pointer-capture x past either edge clamps to the painted range', () => {
    expect(heatBinAtPx(1200, 1200, 199)).toBe(198)
    expect(heatBinAtPx(1500, 1200, 199)).toBe(198)
    expect(heatBinAtPx(-10, 1200, 199)).toBe(0)
  })
})

describe('heatAggregateAt — honest aggregates for a PAINTED bin (span mapping mirrors densityBins)', () => {
  // tickCount=100, binCount=10 → bin b spans ticks [10b, 10b+9] (final bin also owns tick 100).
  const tickCount = 100, binCount = 10

  test('a bin aggregating several events answers count + tick span (never a single name)', () => {
    const ticks = Float64Array.from([12, 13, 14, 40])
    const agg = heatAggregateAt(ticks, [0, 1, 2, 3], 1, tickCount, binCount) // painted bin 1
    expect(agg).toEqual({ count: 3, startTick: 10, endTick: 19, soleSeq: null })
  })
  test('a bin holding exactly ONE event surfaces its seq (one event is honestly nameable)', () => {
    const agg = heatAggregateAt(Float64Array.from([12, 40]), [7, 8], 4, tickCount, binCount)
    expect(agg).toEqual({ count: 1, startTick: 40, endTick: 49, soleSeq: 8 })
  })
  test('an empty bin answers count 0 (caller falls through to the chapter voice)', () => {
    const agg = heatAggregateAt(Float64Array.from([12]), [0], 7, tickCount, binCount)
    expect(agg.count).toBe(0)
    expect(agg.soleSeq).toBeNull()
  })
  test('the final bin owns the tick === tickCount edge, exactly as densityBins clamps it', () => {
    // tickCount=75, binCount=10: bin 9 spans ceil(67.5)=68 … 75 (not 74 — the clamp edge belongs here).
    const agg = heatAggregateAt(Float64Array.from([70, 75]), [1, 2], 9, 75, 10)
    expect(agg).toEqual({ count: 2, startTick: 68, endTick: 75, soleSeq: null })
  })
})

describe('laneClickSeq — click-selection policy (the click side of hover/click symmetry)', () => {
  const tickCount = 100, binCount = 10, width = 1200 // bw = 120px per bin
  // Heat-lane fixture: bin 1 aggregates 3 events; bin 4 holds exactly one; bin 7 is empty.
  const ticks = Float64Array.from([12, 13, 14, 40])
  const seqs = [0, 1, 2, 3]

  test('heat lane, MULTI-event bin → NO-OP (selecting one arbitrary member would claim precision the hover disclaimed)', () => {
    expect(laneClickSeq('heat', ticks, seqs, 15, 180, width, tickCount, binCount)).toBeNull() // x=180 → bin 1
  })
  test('heat lane, sole-event bin → selects that event (exactly what the hover names)', () => {
    expect(laneClickSeq('heat', ticks, seqs, 45, 540, width, tickCount, binCount)).toBe(3) // x=540 → bin 4
  })
  test('heat lane, empty bin → selects nothing', () => {
    expect(laneClickSeq('heat', ticks, seqs, 75, 900, width, tickCount, binCount)).toBeNull() // x=900 → bin 7
  })
  test('heat lane resolves the PAINTED bin from pixel x, not the rounded tick (boundary strip selects the painted bin)', () => {
    // x=235.2 (bin 1's right strip, multi-event → null). A tick-first resolver would bin round-tick 20
    // into bin 2 — empty here, but with a sole event planted in bin 2 it would WRONGLY select it:
    const planted = Float64Array.from([12, 13, 14, 25])
    expect(laneClickSeq('heat', planted, [0, 1, 2, 9], 20, 235.2, width, tickCount, binCount)).toBeNull()
  })
  test('ticks lane is unchanged: nearest within ±2 (the x pixel is not consulted)', () => {
    expect(laneClickSeq('ticks', ticks, seqs, 41, 1188, width, tickCount, binCount)).toBe(3)
    expect(laneClickSeq('ticks', ticks, seqs, 75, 900, width, tickCount, binCount)).toBeNull()
  })
})
