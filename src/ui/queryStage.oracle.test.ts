import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { GEOMETRY_QUERY_RESOLVED } from '../decode/payloads'
import { buildQueryDraws, losComponents, queryBounds, type RayDraw, type RangeBearingDraw } from './queryStage'

// Oracle cross-check: the model layer, run over the REAL decoded e0 bundle, must reproduce the frozen
// design draw table. Expected values below are transcribed from the machine copy
// of the frozen draw table (produced by a design draw-inventory probe,
// itself anchored to contract/EXP-E0-kind23-geometry-excerpt.md, blob d7b98d5c…). That copy is a gitignored,
// untracked artifact, so its load-bearing numbers are pinned here as literals — this test is self-contained and
// decodes the tracked fixture the same way decodeBundle.test.ts does. If the excerpt is ever re-cut, the
// probe regenerates the table and these constants are re-pinned.

const load = (n: string): ArrayBuffer => {
  const b = readFileSync(`contract/fixtures/${n}`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

describe('query stage model layer vs. the frozen draw table (e0_seed42)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model) // parses AND validates every LOS composition at publish
  const draws = stage.draws

  test('decodes 75 kind-23 events, one per tick (seq == tick), all parsed', () => {
    expect(model.eventCount).toBe(75)
    for (let seq = 0; seq < 75; seq++) {
      expect(run.kind[seq]).toBe(GEOMETRY_QUERY_RESOLVED)
      expect(run.tick[seq]).toBe(seq) // seq == tick holds for e0 (the reveal clock relies on it)
      expect(draws[seq]).not.toBeNull()
    }
  })

  test('query-kind histogram matches the contract counts {1:11, 2:9, 3:46, 4:9}', () => {
    const hist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const d of draws) if (d) hist[d.kind] = (hist[d.kind] ?? 0) + 1
    expect(hist).toEqual({ 1: 11, 2: 9, 3: 46, 4: 9 })
  })

  // The 21 hit points (draw-table `hitPoints`) — o+t·dir / lerp(o,endpoint,t), computed from the real argv.
  const HITS: { seq: number; p: [number, number, number] }[] = [
    { seq: 17, p: [256, 65, 0] }, { seq: 19, p: [191, 0, 0] }, { seq: 21, p: [191, 0, 0] },
    { seq: 22, p: [191, 0, 0] }, { seq: 23, p: [416, -160, 0] }, { seq: 24, p: [384, -160, 0] },
    { seq: 26, p: [448, -160, 64] }, { seq: 28, p: [384, -160, 0] }, { seq: 29, p: [640, 0, 0] },
    { seq: 30, p: [640, -32, -64] }, { seq: 31, p: [640, 0, 64] }, { seq: 34, p: [640, 0, 0] },
    { seq: 35, p: [640, 0, 0] }, { seq: 36, p: [191, 0, 0] }, { seq: 41, p: [384, -118.154, 0] },
    { seq: 46, p: [640, 0, 0] }, { seq: 52, p: [256, 65, 0] }, { seq: 59, p: [191.915, -10.865, 0] },
    { seq: 64, p: [384, -125.162, 0] }, { seq: 67, p: [192.51, -13.931, 0] }, { seq: 69, p: [640, -0.481, 0] },
  ]

  test('all 21 hit points reproduce the draw table (13 distinct spots; lattice ones bit-exact)', () => {
    for (const { seq, p } of HITS) {
      const d = draws[seq] as RayDraw
      expect(d.kind).toBe(3)
      expect(d.verdict).toBe('HIT')
      expect(d.hitPoint).not.toBeNull()
      for (let i = 0; i < 3; i++) expect(d.hitPoint![i]).toBeCloseTo(p[i]!, 2)
    }
    // Anchor a handful to KNOWN scene geometry exactly (the probe's own cross-checks): sphere near
    // face n=191, triangle facet n=640, box SW corner.
    expect((draws[19] as RayDraw).hitPoint).toEqual([191, 0, 0])
    expect((draws[29] as RayDraw).hitPoint).toEqual([640, 0, 0])
    expect((draws[28] as RayDraw).hitPoint).toEqual([384, -160, 0])
    expect(draws.filter(d => d?.kind === 3 && d.verdict === 'HIT')).toHaveLength(21)
  })

  // The 9 LOS composites (draw-table `losGroups`) → first blocker in S,B,T order.
  const LOS: { seq: number; clear: boolean; blocker: number | null }[] = [
    { seq: 39, clear: false, blocker: 1 }, { seq: 43, clear: false, blocker: 2 },
    { seq: 47, clear: false, blocker: 3 }, { seq: 51, clear: true, blocker: null },
    { seq: 55, clear: false, blocker: 1 }, { seq: 62, clear: false, blocker: 1 },
    { seq: 66, clear: false, blocker: 2 }, { seq: 70, clear: false, blocker: 1 },
    { seq: 74, clear: true, blocker: null },
  ]

  test('all 9 LOS composites are validated at publish; lookup recovers triplet and first blocker', () => {
    expect(stage.losComposites.size).toBe(9) // every composite composition-checked in the load pass itself
    for (const { seq, clear, blocker } of LOS) {
      const c = losComponents(seq, stage)!
      expect(c.components.map(r => r.object)).toEqual([1, 2, 3]) // S, B, T
      expect(c.los.components).toEqual([seq - 3, seq - 2, seq - 1]) // guaranteed schedule positions
      expect(c.los.verdict).toBe(clear ? 'LOS_CLEAR' : 'BLOCKED')
      expect(c.blockerObject).toBe(blocker)
      if (blocker !== null) expect(c.firstBlocker!.verdict).toBe('HIT')
      else expect(c.firstBlocker).toBeNull()
      // component (o,g) match the composite sightline (identical (o,g) — excerpt §1)
      expect(c.components[0]!.o).toEqual(c.los.o)
      expect(c.components[0]!.target).toEqual(c.los.g)
    }
  })

  test('the 20 tiebreak beats match the draw table exactly (the only registry semantic pair on kind 23)', () => {
    const tb: number[] = []
    draws.forEach((d, seq) => { if (d?.tiebreak) tb.push(seq) })
    expect(tb).toEqual([1, 2, 5, 6, 7, 8, 16, 17, 21, 22, 24, 26, 28, 30, 31, 33, 34, 35, 52, 55])
  })

  test('the three framing presets reproduce the draw table (§2.2): full DECOY, core DEFAULT, solids+contacts', () => {
    const b = queryBounds(draws)
    expect(b.full!.center[0]).toBeCloseTo(128, 1); expect(b.full!.center[1]).toBeCloseTo(128, 1)
    expect(b.full!.radius).toBeCloseTo(1216.053, 1)
    expect(b.core!.center[0]).toBeCloseTo(19.466, 1); expect(b.core!.center[1]).toBeCloseTo(0, 1)
    expect(b.core!.radius).toBeCloseTo(674.406, 1)
    expect(b.solidsContacts!.center[0]).toBeCloseTo(415.5, 1); expect(b.solidsContacts!.center[1]).toBeCloseTo(-47.5, 1)
    expect(b.solidsContacts!.radius).toBeCloseTo(259.387, 1)
    // the core theatre is the DEFAULT because the full record is a decoy: three runaway misses inflate it.
    expect(b.full!.radius).toBeGreaterThan(b.core!.radius)
    expect(b.core!.radius).toBeGreaterThan(b.solidsContacts!.radius)
  })

  test('⚠ BIT-IDENTITY on the real vendored bearings: bearingRad === the stored scalar (never recomputed)', () => {
    for (const seq of [10, 11, 12, 13, 14, 15, 16, 56, 57]) { // every RANGE_BEARING event
      const d = draws[seq] as RangeBearingDraw
      const stored = model.geometryQueryAt(seq)!.resultScalars[1]!
      expect(d.bearingRad).toBe(stored) // Object.is — fails on any low-bit drift from an atan2 recompute
    }
  })

  test('derived display values reproduce the table where it pins them: bearing_deg (all 9) + mode-0 metric distance (all 11)', () => {
    // bearing_deg per draw-table kind-2 rows (a linear ·180/π scale of the stored bits, never a recompute)
    const BEARING_DEG: [number, number][] = [
      [10, 0], [11, 90], [12, 180], [13, -90], [14, 36.87], [15, 45], [16, 0], [56, 2.524], [57, 1.744],
    ]
    for (const [seq, deg] of BEARING_DEG) expect((draws[seq] as RangeBearingDraw).bearingDeg).toBeCloseTo(deg, 2)
    // metricDist per draw-table mode-0 HIT rows (t·|dir| — the table pins metric distance for rays only)
    const METRIC: [number, number][] = [
      [17, 256], [19, 191], [21, 0], [23, 96], [24, 96], [26, 96], [28, 90.51], [29, 640], [30, 640], [31, 640], [34, 0],
    ]
    for (const [seq, m] of METRIC) expect((draws[seq] as RayDraw).metricDist).toBeCloseTo(m, 2)
  })
})
