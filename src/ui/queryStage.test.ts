import { describe, expect, test } from 'vitest'
import type { GeometryQuery } from '../decode/payloads'
import {
  queryDraw, losComponents, queryBounds, buildQueryDraws, hasQueryDraws, queryStageApplies,
  SPHERE, BOX, TRIANGLE, SCENARIO_OBJECT, QUERY_KIND, QUERY_STAGE_HONESTY, E0_REGISTRATION,
  type QueryDraw, type PointDraw, type RangeBearingDraw, type RayDraw, type SightlineDraw,
} from './queryStage'
import { chipAgreesWithLedger } from './lensContract'
import { PALETTE, CATEGORY } from './theme'

// Pure model-layer tests for the e0 query stage (kind 23). House style: hand-constructed payloads,
// values cross-checked against known scene geometry AND the frozen draw table.
// This file proves the per-kind argv layouts, the hit-point
// arithmetic, and the LOS composition in isolation; queryStage.oracle.test.ts proves the same helpers
// against the REAL decoded bundle. Semantics of record: contract/EXP-E0-kind23-geometry-excerpt.md §1.
//
// ⚠ BINDING CONSTRAINT (constitution-level): bearings are pinned vendored-libm KAT bits. The model layer
// NEVER recomputes a bearing via Math.atan2 or any trig — it surfaces the stored result_scalars[1] bits
// verbatim. The bit-identity test below is the guard.

const q = (over: Partial<GeometryQuery> & Pick<GeometryQuery, 'queryKind' | 'argv' | 'resultFlag'>): GeometryQuery => ({
  subject: 0n, object: 0n, resultScalars: [], tiebreakApplied: false, ...over,
})

describe('queryDraw — POINT_IN_REGION (kind 1)', () => {
  test('sphere inside: point + INSIDE + d2/dist (dist = √d2)', () => {
    const d = queryDraw(q({ queryKind: 1, object: 1n, argv: [256, 32, 0], resultFlag: true, resultScalars: [1024] }), 0) as PointDraw
    expect(d.kind).toBe(1)
    expect(d.object).toBe(1)
    expect(d.point).toEqual([256, 32, 0])
    expect(d.verdict).toBe('INSIDE')
    expect(d.d2).toBe(1024)
    expect(d.dist).toBe(32) // √1024
    expect(d.tiebreak).toBe(false)
  })

  test('sphere on boundary d2==r2 carries the tiebreak flag; verdict still INSIDE (closed set)', () => {
    const d = queryDraw(q({ queryKind: 1, object: 1n, argv: [256, 65, 0], resultFlag: true, resultScalars: [4225], tiebreakApplied: true }), 1) as PointDraw
    expect(d.verdict).toBe('INSIDE')
    expect(d.dist).toBe(65) // √4225, = r
    expect(d.tiebreak).toBe(true)
  })

  test('sphere outside: OUTSIDE verdict, dist still surfaced', () => {
    const d = queryDraw(q({ queryKind: 1, object: 1n, argv: [256, 66, 0], resultFlag: false, resultScalars: [4356] }), 3) as PointDraw
    expect(d.verdict).toBe('OUTSIDE')
    expect(d.dist).toBe(66)
  })

  test('box carries NO scalar (d2/dist null) — key off object id, not scalar length', () => {
    const d = queryDraw(q({ queryKind: 1, object: 2n, argv: [416, -128, 0], resultFlag: true, resultScalars: [] }), 4) as PointDraw
    expect(d.object).toBe(2)
    expect(d.verdict).toBe('INSIDE')
    expect(d.d2).toBeNull()
    expect(d.dist).toBeNull()
  })

  test('box face membership is a closed-set tiebreak (INSIDE + tiebreak)', () => {
    const d = queryDraw(q({ queryKind: 1, object: 2n, argv: [384, -128, 0], resultFlag: true, resultScalars: [], tiebreakApplied: true }), 5) as PointDraw
    expect(d.verdict).toBe('INSIDE')
    expect(d.tiebreak).toBe(true)
  })
})

describe('queryDraw — RANGE_BEARING (kind 2)', () => {
  test('cardinal-north measurement: segment + range + bearing; NO verdict (result_flag carries no meaning)', () => {
    const d = queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 256, 0, 0], resultFlag: true, resultScalars: [256, 0] }), 10) as RangeBearingDraw
    expect(d.kind).toBe(2)
    expect(d.o).toEqual([0, 0, 0])
    expect(d.g).toEqual([256, 0, 0])
    expect(d.rangeM).toBe(256)
    expect(d.bearingRad).toBe(0)
    expect(d.bearingDeg).toBe(0)
    expect('verdict' in d).toBe(false) // RANGE_BEARING is a measurement, not a decision
  })

  test('bearing_deg is a linear scale of the stored radians (not a recompute)', () => {
    const d = queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 192, 144, 0], resultFlag: true, resultScalars: [240, 0.6435011087932844] }), 14) as RangeBearingDraw
    expect(d.rangeM).toBe(240)
    expect(d.bearingDeg).toBeCloseTo(36.87, 2) // 3-4-5 triangle
  })

  test('⚠ BIT-IDENTITY: bearingRad is the stored KAT bits surfaced verbatim — NEVER recomputed via atan2', () => {
    // The observer-phase bearing (seq 57) is a vendored-libm value with a full mantissa. A model that
    // recomputed it through platform Math.atan2 would (may) differ in the low bits; surfacing the stored
    // scalar is bit-exact by construction. `toBe` is Object.is — this fails on any drift.
    const stored = 0.030434459725019226
    const d = queryDraw(q({ queryKind: 2, argv: [-601.0688172251292, -37.78292521222363, 0, 640, 0, -48], resultFlag: true, resultScalars: [1242.5712689927182, stored] }), 57) as RangeBearingDraw
    expect(d.bearingRad).toBe(stored)
  })

  test('zero-range degenerate: range 0, bearing +0, tiebreak set (IEEE special case, semantically arbitrary)', () => {
    const d = queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 0, 0, 0], resultFlag: true, resultScalars: [0, 0], tiebreakApplied: true }), 16) as RangeBearingDraw
    expect(d.rangeM).toBe(0)
    expect(d.bearingRad).toBe(0)
    expect(d.tiebreak).toBe(true)
  })
})

describe('queryDraw — RAY_OCCLUDER (kind 3)', () => {
  test('mode 0 ray HIT: hit point = o + t·dir; metric distance = t·|dir| (unit dir ⇒ t)', () => {
    const d = queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: true, resultScalars: [191] }), 19) as RayDraw
    expect(d.kind).toBe(3)
    expect(d.object).toBe(1)
    expect(d.mode).toBe(0)
    expect(d.o).toEqual([0, 0, 0])
    expect(d.target).toEqual([1, 0, 0]) // direction, not endpoint
    expect(d.verdict).toBe('HIT')
    expect(d.t).toBe(191)
    expect(d.hitPoint).toEqual([191, 0, 0]) // sphere near face 256-65
    expect(d.metricDist).toBe(191)
  })

  test('mode 0 ray HIT with non-unit direction: metric distance = t·|dir|, not t', () => {
    // argv from draw-table seq 28: o(320,-96,0) dir(64,-64,0) t=1 → hit at the box SW corner (384,-160,0)
    const d = queryDraw(q({ queryKind: 3, object: 2n, argv: [0, 320, -96, 0, 64, -64, 0], resultFlag: true, resultScalars: [1], tiebreakApplied: true }), 28) as RayDraw
    expect(d.hitPoint).toEqual([384, -160, 0])
    expect(d.metricDist).toBeCloseTo(Math.hypot(64, 64, 0), 6) // t·|dir| = 1·90.51
  })

  test('mode 0 ray MISS: no t, no hit point, no metric distance', () => {
    const d = queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 66, 0, 1, 0, 0], resultFlag: false, resultScalars: [] }), 18) as RayDraw
    expect(d.verdict).toBe('MISS')
    expect(d.t).toBeNull()
    expect(d.hitPoint).toBeNull()
    expect(d.metricDist).toBeNull()
  })

  test('mode 1 segment HIT: hit point = lerp(o, endpoint, t); t is the [0,1] fraction', () => {
    // draw-table seq 41: o(0,0,0)→endpoint(832,-256,0), t=0.4615… → box west face n=384
    const d = queryDraw(q({ queryKind: 3, object: 2n, argv: [1, 0, 0, 0, 832, -256, 0], resultFlag: true, resultScalars: [0.46153846153846156] }), 41) as RayDraw
    expect(d.mode).toBe(1)
    expect(d.target).toEqual([832, -256, 0]) // endpoint, not direction
    expect(d.hitPoint![0]).toBeCloseTo(384, 6)
    expect(d.hitPoint![1]).toBeCloseTo(-118.154, 3)
    expect(d.metricDist).toBeCloseTo(0.46153846153846156 * Math.hypot(832, 256, 0), 6)
  })

  test('mode 1 segment HIT at endpoint (t=1): hit point == endpoint; metric distance == segment length', () => {
    const d = queryDraw(q({ queryKind: 3, object: 1n, argv: [1, 0, 0, 0, 191, 0, 0], resultFlag: true, resultScalars: [1], tiebreakApplied: true }), 22) as RayDraw
    expect(d.hitPoint).toEqual([191, 0, 0])
    expect(d.metricDist).toBe(191)
  })
})

describe('queryDraw — LOS (kind 4)', () => {
  test('BLOCKED composite: sightline + BLOCKED + the 3 preceding component seqs', () => {
    const d = queryDraw(q({ queryKind: 4, argv: [0, 0, 0, 512, 0, 0], resultFlag: false }), 39) as SightlineDraw
    expect(d.kind).toBe(4)
    expect(d.o).toEqual([0, 0, 0])
    expect(d.g).toEqual([512, 0, 0])
    expect(d.verdict).toBe('BLOCKED')
    expect(d.components).toEqual([36, 37, 38]) // seq-3, seq-2, seq-1
  })

  test('CLEAR composite: LOS_CLEAR verdict', () => {
    const d = queryDraw(q({ queryKind: 4, argv: [0, 0, 0, 0, 512, 0], resultFlag: true }), 51) as SightlineDraw
    expect(d.verdict).toBe('LOS_CLEAR')
    expect(d.components).toEqual([48, 49, 50])
  })

  test('grazing sightline: BLOCKED with the composite tiebreak flag (OR of component flags)', () => {
    const d = queryDraw(q({ queryKind: 4, argv: [0, 65, 0, 512, 65, 0], resultFlag: false, tiebreakApplied: true }), 55) as SightlineDraw
    expect(d.verdict).toBe('BLOCKED')
    expect(d.tiebreak).toBe(true)
  })
})

describe('queryDraw — contract violations fail loud', () => {
  test('an unrecognized query_kind throws rather than drawing a lie', () => {
    expect(() => queryDraw(q({ queryKind: 99, argv: [0, 0, 0], resultFlag: true }), 0)).toThrow(/query_kind/)
  })
})

// Build a real stage from synthetic rows (a QuerySource stub), so composition is exercised through the
// SAME publish-time path the app uses: buildQueryDraws parses AND validates; losComponents only looks up.
const stageOf = (rows: Record<number, GeometryQuery>, eventCount = 40) =>
  buildQueryDraws({ eventCount, geometryQueryAt: (seq: number): GeometryQuery | null => rows[seq] ?? null })
const comp = (object: bigint, o: number[], g: number[], hit: boolean, scalars: number[] = []): GeometryQuery =>
  q({ queryKind: 3, object, argv: [1, ...o, ...g], resultFlag: hit, resultScalars: scalars })

describe('losComponents — per-occluder recovery from the 3 preceding rows (excerpt §1 LOS composition)', () => {
  test('BLOCKED by sphere: components ordered S,B,T; first blocker = S; composite validated AT PUBLISH', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.373046875]),
      37: comp(2n, [0, 0, 0], [512, 0, 0], false),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: q({ queryKind: 4, argv: [0, 0, 0, 512, 0, 0], resultFlag: false }),
    }
    const stage = stageOf(rows)
    expect(stage.losComposites.size).toBe(1) // the composite exists BEFORE any consumer asks for it
    const c = losComponents(39, stage)!
    expect(c.components.map(r => r.object)).toEqual([1, 2, 3]) // S, B, T
    expect(c.los.verdict).toBe('BLOCKED')
    expect(c.blockerObject).toBe(1)
    expect(c.firstBlocker!.hitPoint).toEqual([191, 0, 0])
  })

  test('CLEAR composite: no blocker (firstBlocker null, blockerObject null)', () => {
    const rows = {
      48: comp(1n, [0, 0, 0], [0, 512, 0], false),
      49: comp(2n, [0, 0, 0], [0, 512, 0], false),
      50: comp(3n, [0, 0, 0], [0, 512, 0], false),
      51: q({ queryKind: 4, argv: [0, 0, 0, 0, 512, 0], resultFlag: true }),
    }
    const c = losComponents(51, stageOf(rows, 52))!
    expect(c.firstBlocker).toBeNull()
    expect(c.blockerObject).toBeNull()
  })

  test('double occlusion (S and T both hit): first blocker wins in S,B,T order → S, not T', () => {
    // draw-table seq 67-70: S hit @ tk67, T hit @ tk69 — the badge-worthy "first contact wins" beat.
    const rows = {
      67: comp(1n, [-601, -37, 0], [656, 0, 0], true, [0.6312933565536227]),
      68: comp(2n, [-601, -37, 0], [656, 0, 0], false),
      69: comp(3n, [-601, -37, 0], [656, 0, 0], true, [0.9872719776508986]),
      70: q({ queryKind: 4, argv: [-601, -37, 0, 656, 0, 0], resultFlag: false }),
    }
    const c = losComponents(70, stageOf(rows, 71))!
    expect(c.blockerObject).toBe(1) // S precedes T in occluder order — first contact wins
  })

  test('components come back in S,B,T order even if the preceding rows are positionally shuffled', () => {
    const rows = {
      36: comp(3n, [0, 0, 0], [512, 0, 0], false), // T positionally first
      37: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]), // S in the middle
      38: comp(2n, [0, 0, 0], [512, 0, 0], false), // B last
      39: q({ queryKind: 4, argv: [0, 0, 0, 512, 0, 0], resultFlag: false }),
    }
    const c = losComponents(39, stageOf(rows))!
    expect(c.components.map(r => r.object)).toEqual([1, 2, 3]) // sorted by occluder, not position
    expect(c.blockerObject).toBe(1) // the S row hit
  })

  test('a non-LOS seq has no components (honest null, not a fabricated triplet)', () => {
    const rows = { 5: comp(1n, [0, 0, 0], [1, 0, 0], true, [0.5]) }
    expect(losComponents(5, stageOf(rows))).toBeNull()
  })
})

describe('queryBounds — three framing presets (§2.2), reusing the camera fit formula', () => {
  test('no query geometry ⇒ all presets null (honest empty state — caller keeps the composed default)', () => {
    const b = queryBounds([])
    expect(b.full).toBeNull()
    expect(b.core).toBeNull()
    expect(b.solidsContacts).toBeNull()
    expect(queryBounds([null, null]).full).toBeNull() // a non-query run decodes to all-null draws
  })

  test('a far segment ENDPOINT stretches the full record but is excluded from the core theatre', () => {
    // One mode-1 miss segment shooting far past everything (the "runaway sightline" pattern, §2.1).
    const runaway: RayDraw = {
      kind: 3, seq: 0, object: 1, mode: 1, o: [0, 0, 0], target: [5000, 0, 0],
      verdict: 'MISS', tiebreak: false, t: null, hitPoint: null, metricDist: null,
    }
    const b = queryBounds([runaway])
    // full includes the n=5000 endpoint; core does not → full is strictly larger.
    expect(b.full!.radius).toBeGreaterThan(b.core!.radius)
    expect(b.full!.center[0]).toBeGreaterThan(b.core!.center[0])
  })

  test('solids+contacts frames only the solids and the hit points — not origins/endpoints', () => {
    // A hit far outside the solid cluster must expand solidsContacts; a miss endpoint must not.
    const hit: RayDraw = {
      kind: 3, seq: 0, object: 3, mode: 0, o: [0, 0, 0], target: [1, 0, 0],
      verdict: 'HIT', tiebreak: false, t: 2000, hitPoint: [2000, 0, 0], metricDist: 2000,
    }
    const withHit = queryBounds([hit])
    const solidsOnly = queryBounds([
      { kind: 3, seq: 1, object: 1, mode: 1, o: [0, 0, 0], target: [5000, 0, 0], verdict: 'MISS', tiebreak: false, t: null, hitPoint: null, metricDist: null } as RayDraw,
    ])
    // the hit at n=2000 pushes solidsContacts out; the miss endpoint at n=5000 leaves it at the bare solids box.
    expect(withHit.solidsContacts!.radius).toBeGreaterThan(solidsOnly.solidsContacts!.radius)
  })
})

describe('scenario solids + honesty (excerpt §2) — module constants, not bundle content', () => {
  test('the pinned scene: sphere S, box B, and a TRIANGLE T (never a plane)', () => {
    expect(SPHERE).toEqual({ center: [256, 0, 0], radius: 65, r2: 4225 })
    expect(BOX).toEqual({ min: [384, -160, -64], max: [448, -96, 64] })
    expect(TRIANGLE.a).toEqual([640, -64, -64])
    expect(TRIANGLE.b).toEqual([640, 64, -64])
    expect(TRIANGLE.c).toEqual([640, 0, 64]) // the apex; a facet in plane n=640, NOT an infinite wall
  })

  test('object ids map to the scenario objects; the honesty chip states the presentational truth', () => {
    expect(SCENARIO_OBJECT[1]).toMatch(/sphere/i)
    expect(SCENARIO_OBJECT[2]).toMatch(/box/i)
    expect(SCENARIO_OBJECT[3]).toMatch(/triangle/i)
    expect(QUERY_KIND).toEqual({ POINT_IN_REGION: 1, RANGE_BEARING: 2, RAY_OCCLUDER: 3, LOS: 4 })
    expect(QUERY_STAGE_HONESTY.length).toBeGreaterThan(0) // the chip wording exists (rendered by the query stage)
  })
})

describe('buildQueryDraws — the load-path one-pass over a model (sibling of buildTrail)', () => {
  test('parses every kind-23 event, indexed by seq; a non-query event decodes to null', () => {
    const rows: Record<number, GeometryQuery> = {
      0: q({ queryKind: 1, object: 1n, argv: [256, 32, 0], resultFlag: true, resultScalars: [1024] }),
      1: q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: true, resultScalars: [191] }),
    }
    const model = { eventCount: 3, geometryQueryAt: (seq: number): GeometryQuery | null => rows[seq] ?? null }
    const { draws, losComposites } = buildQueryDraws(model)
    expect(draws).toHaveLength(3)
    expect(draws[0]!.kind).toBe(1)
    expect(draws[1]!.kind).toBe(3)
    expect(draws[2]).toBeNull() // seq 2 is not a geometry query → drawn as nothing
    expect(losComposites.size).toBe(0) // no LOS rows → no composites (and nothing to validate)
  })
})

describe('queryDraw — malformed layouts refuse loud (the contract pins every per-kind layout)', () => {
  test('RAY_OCCLUDER mode must be EXACTLY 0 or 1 — anything else throws, never coerces', () => {
    for (const mode of [2, 0.5, -1, Number.NaN]) {
      expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [mode, 0, 0, 0, 1, 0, 0], resultFlag: false }), 0)).toThrow(/mode/)
    }
  })

  test('argv length is pinned per kind: POINT=3, RANGE=6, RAY=7, LOS=6', () => {
    expect(() => queryDraw(q({ queryKind: 1, object: 1n, argv: [256, 32], resultFlag: true, resultScalars: [1024] }), 0)).toThrow(/argv/)
    expect(() => queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 256, 0], resultFlag: true, resultScalars: [256, 0] }), 10)).toThrow(/argv/)
    expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0], resultFlag: false }), 18)).toThrow(/argv/)
    expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0, 0, 9], resultFlag: false }), 18)).toThrow(/argv/)
    expect(() => queryDraw(q({ queryKind: 4, argv: [0, 0, 0, 512, 0], resultFlag: false }), 39)).toThrow(/argv/)
  })

  test('a RAY hit without its [t] scalar throws; a miss with a stray scalar throws ("[t] on hit, else []")', () => {
    expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: true, resultScalars: [] }), 19)).toThrow(/result_scalars/)
    expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: false, resultScalars: [191] }), 18)).toThrow(/result_scalars/)
  })

  test('POINT scalars are pinned by region: ball [d2], box [] — drift throws either way', () => {
    expect(() => queryDraw(q({ queryKind: 1, object: 1n, argv: [256, 32, 0], resultFlag: true, resultScalars: [] }), 0)).toThrow(/result_scalars/)
    expect(() => queryDraw(q({ queryKind: 1, object: 2n, argv: [416, -128, 0], resultFlag: true, resultScalars: [7] }), 4)).toThrow(/result_scalars/)
  })

  test('RANGE_BEARING scalars must be exactly [range_m, bearing_rad]', () => {
    expect(() => queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 256, 0, 0], resultFlag: true, resultScalars: [256] }), 10)).toThrow(/result_scalars/)
    expect(() => queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 256, 0, 0], resultFlag: true, resultScalars: [256, 0, 9] }), 10)).toThrow(/result_scalars/)
  })

  test('LOS scalars are pinned empty; a composite row must carry object = 0', () => {
    expect(() => queryDraw(q({ queryKind: 4, argv: [0, 0, 0, 512, 0, 0], resultFlag: false, resultScalars: [1] }), 39)).toThrow(/result_scalars/)
    expect(() => queryDraw(q({ queryKind: 4, object: 1n, argv: [0, 0, 0, 512, 0, 0], resultFlag: false }), 39)).toThrow(/object/)
  })

  test('POINT_IN_REGION regions are ONLY the ball(1) and box(2) — the triangle is never a region', () => {
    expect(() => queryDraw(q({ queryKind: 1, object: 3n, argv: [640, 0, 0], resultFlag: true, resultScalars: [] }), 0)).toThrow(/region/)
    expect(() => queryDraw(q({ queryKind: 1, object: 0n, argv: [0, 0, 0], resultFlag: true, resultScalars: [] }), 0)).toThrow(/region/)
  })

  test('RAY_OCCLUDER must name a pinned occluder S(1)|B(2)|T(3)', () => {
    expect(() => queryDraw(q({ queryKind: 3, object: 0n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: false }), 0)).toThrow(/occluder/)
    expect(() => queryDraw(q({ queryKind: 3, object: 4n, argv: [0, 0, 0, 0, 1, 0, 0], resultFlag: false }), 0)).toThrow(/occluder/)
  })

  test('subject is pinned 0 at E0 (opaque sentinel) — a nonzero subject refuses loud, even with a valid layout', () => {
    expect(() => queryDraw(q({ queryKind: 1, subject: 7n, object: 1n, argv: [256, 32, 0], resultFlag: true, resultScalars: [1024] }), 0)).toThrow(/subject/)
    expect(() => queryDraw(q({ queryKind: 4, subject: 1n, argv: [0, 0, 0, 512, 0, 0], resultFlag: false }), 39)).toThrow(/subject/)
  })

  test('non-finite consumed fields throw (NaN coordinate, Infinity t, NaN bearing) — malformed data draws nothing', () => {
    expect(() => queryDraw(q({ queryKind: 1, object: 1n, argv: [Number.NaN, 32, 0], resultFlag: true, resultScalars: [1024] }), 0)).toThrow(/finite/)
    expect(() => queryDraw(q({ queryKind: 3, object: 1n, argv: [1, 0, 0, 0, 191, 0, 0], resultFlag: true, resultScalars: [Number.POSITIVE_INFINITY] }), 22)).toThrow(/finite/)
    expect(() => queryDraw(q({ queryKind: 2, argv: [0, 0, 0, 256, 0, 0], resultFlag: true, resultScalars: [256, Number.NaN] }), 10)).toThrow(/finite/)
  })
})

describe('buildQueryDraws — triplet contract violations refuse loud AT PUBLISH (false evidence never reaches a consumer)', () => {
  // Every violation below fails the buildQueryDraws PUBLISH pass itself — no losComponents call needed.
  // A malformed triplet can therefore never pass publish and lie in wait for interaction time.
  const losQ = (o: number[], g: number[], clear = false, tb = false): GeometryQuery =>
    q({ queryKind: 4, argv: [...o, ...g], resultFlag: clear, tiebreakApplied: tb })

  test('an LOS with no room for its 3 preceding rows (seq < 3) fails the publish', () => {
    const rows = { 1: losQ([0, 0, 0], [512, 0, 0]) }
    expect(() => stageOf(rows)).toThrow(/preceding/)
  })

  test('a missing component row fails the publish', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      // 37 missing
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0]),
    }
    expect(() => stageOf(rows)).toThrow(/component/)
  })

  test('a wrong-kind component (a POINT row inside the triplet) fails the publish', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      37: q({ queryKind: 1, object: 2n, argv: [416, -128, 0], resultFlag: true }),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0]),
    }
    expect(() => stageOf(rows)).toThrow(/RAY_OCCLUDER/)
  })

  test('an infinite-ray (mode 0) component fails the publish — the contract pins SEGMENT components', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      37: q({ queryKind: 3, object: 2n, argv: [0, 0, 0, 0, 512, 0, 0], resultFlag: false }),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0]),
    }
    expect(() => stageOf(rows)).toThrow(/SEGMENT/)
  })

  test('a duplicate occluder object (two S rows, no B) fails the publish — objects 1,2,3 exactly once', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      37: comp(1n, [0, 0, 0], [512, 0, 0], false),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0]),
    }
    expect(() => stageOf(rows)).toThrow(/exactly once/)
  })

  test('a component probing a DIFFERENT segment fails the publish — (o,g) identity is pinned', () => {
    const rows = {
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      37: comp(2n, [0, 0, 0], [999, 0, 0], false), // wrong far endpoint
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0]),
    }
    expect(() => stageOf(rows)).toThrow(/identical/)
  })

  test('a composite verdict that disagrees with its components fails the publish (los_clear = no segment hit)', () => {
    const rows = { // composite claims CLEAR but the S component hit
      36: comp(1n, [0, 0, 0], [512, 0, 0], true, [0.5]),
      37: comp(2n, [0, 0, 0], [512, 0, 0], false),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0], true),
    }
    expect(() => stageOf(rows)).toThrow(/los_clear/)
  })

  test('a composite tiebreak that is not the OR of its component flags fails the publish', () => {
    const tbComp: GeometryQuery = q({ queryKind: 3, object: 1n, argv: [1, 0, 0, 0, 512, 0, 0], resultFlag: true, resultScalars: [0.5], tiebreakApplied: true })
    const rows = {
      36: tbComp, // component tiebreak true…
      37: comp(2n, [0, 0, 0], [512, 0, 0], false),
      38: comp(3n, [0, 0, 0], [512, 0, 0], false),
      39: losQ([0, 0, 0], [512, 0, 0], false, false), // …but the composite says false
    }
    expect(() => stageOf(rows)).toThrow(/OR/)
  })
})

// Type-level sanity: QueryDraw is a discriminated union keyed on `kind` (consumers switch on it).
const _exhaustive = (d: QueryDraw): number => {
  switch (d.kind) {
    case 1: return d.point.length
    case 2: return d.rangeM
    case 3: return d.mode
    case 4: return d.components.length
  }
}
void _exhaustive

// ── E0_REGISTRATION — the query stage lifted from prose to a typed citizen ─────────────────
// The mirror of sensingStage.test.ts's F2A_REGISTRATION block: the asymmetry is closed — e0's LAW-4
// declaration is now queryable data, validated at import, and its ledger's tiers match the recompute surface
// (showMath.ts): the verdicts/range are recomputed, the bearing is pinned-bits, the bodies/origin are
// scenario constants, the drawn observer + probe geometry + ghost are decoded, the all-events tally derives.
describe('E0_REGISTRATION — the query stage as a conforming citizen of the provenance ledger', () => {
  test('it validated at publish (import did not throw) and carries the enumerated ledger', () => {
    expect(E0_REGISTRATION.id).toBe('e0-query')
    // Bind the gate to queryStageApplies' FUNCTION identity (the COMPLETE predicate, not the content
    // half `hasQueryDraws` it used to under-name): a rename OR a dropped conjunct that skipped this registration
    // fails here — the mount/chip/rail share this one model-layer fact and cannot drift.
    expect(E0_REGISTRATION.mountGate).toBe(queryStageApplies.name)
    expect(E0_REGISTRATION.mountGate).not.toBe(hasQueryDraws.name) // the old pin named only the content half
    expect(E0_REGISTRATION.surfaces).toEqual({ stage: 'QueryStage', instrument: 'Inspector' })
    expect(E0_REGISTRATION.provenance.length).toBeGreaterThanOrEqual(12)
  })

  test('every borrowed hue names an EXISTING token (LAW 2 — the palette does not grow)', () => {
    const paletteKeys = new Set(Object.keys(PALETTE))
    const categoryKeys = new Set(Object.keys(CATEGORY))
    for (const h of E0_REGISTRATION.borrowedHues) {
      if (h.startsWith('category:')) expect(categoryKeys.has(h.slice('category:'.length))).toBe(true)
      else expect(paletteKeys.has(h)).toBe(true)
    }
  })

  test('every non-presentational pixel-class carries a contract/ anchor; presentational carries none', () => {
    for (const p of E0_REGISTRATION.provenance) {
      if (p.tier !== 'presentational') {
        expect(p.source).toBeTruthy()
        expect(p.source!).toMatch(/^contract\//)
      } else {
        expect(p.source).toBeNull()
      }
    }
  })

  test('the tier vocabulary matches the recompute surface (bearing pinned; verdicts/range recomputed)', () => {
    const byId = new Map(E0_REGISTRATION.provenance.map(p => [p.id, p]))
    expect(byId.get('bearing-claim')!.tier).toBe('pinned-bits')
    expect(byId.get('region-verdict')!.tier).toBe('recomputed')
    expect(byId.get('occluder-verdict')!.tier).toBe('recomputed')
    expect(byId.get('los-verdict')!.tier).toBe('recomputed')
    expect(byId.get('range-scalar')!.tier).toBe('recomputed')
    expect(byId.get('recompute-tally')!.tier).toBe('derived-display')
    // The observer is per-seed DECODED (excerpt §3), never a scenario constant — the known-easy-to-miss line.
    expect(byId.get('drawn-observer')!.tier).toBe('decoded')
    expect(byId.get('scenario-solid')!.tier).toBe('scenario-constant')
  })

  test('the honesty chip is DERIVED from and agrees with the ledger (one source of honesty)', () => {
    expect(E0_REGISTRATION.honestyChip).toBe(QUERY_STAGE_HONESTY)
    expect(chipAgreesWithLedger(E0_REGISTRATION)).toBe(true)
    expect(QUERY_STAGE_HONESTY).toMatch(/decoded-real/)
    expect(QUERY_STAGE_HONESTY).toMatch(/scenario constants/)
  })

  test('it registers its tour (the tour-per-lens standing rule, structurally)', () => {
    expect(E0_REGISTRATION.tourId).toBe('e0-hero')
  })
})

// ── E0 LEDGER TRUTH (H1 + M4) — the stage paints ONE decoded verdict; the rest it DERIVES or merely DRAWS ─
// The stage's CONTACT verdict is the decoded result_flag bit surfaced verbatim (genuinely decoded). But by the
// six-tier ledger's own definitions the OTHER "stage verdict" paints were mis-tiered as decoded: a HIT endpoint
// is o + t·dir (arithmetic over decoded inputs → derived-display), a MISS shaft's far end is a fixed renderer
// extension (presentational), and blocker attribution SELECTS the first HIT in S,B,T order (a derivation →
// derived-display). These pins hold each class to its honest tier; the Inspector recompute classes are unchanged.
describe('E0_REGISTRATION ledger truth (H1/M4) — decoded contact-verdict vs derived/presentational stage paints', () => {
  const byId = new Map(E0_REGISTRATION.provenance.map(p => [p.id, p]))

  // contact-verdict alone is the genuinely-DECODED stage paint (do NOT weaken it) — the engine's own result_flag.
  test('contact-verdict stays DECODED, names the stage, and claims the decoded bit (never the live recompute)', () => {
    const p = byId.get('contact-verdict')!
    expect(p.tier).toBe('decoded')
    expect(p.answer.toLowerCase()).toContain('stage')
    expect(p.answer).toMatch(/decoded|verbatim/i)
    expect(p.answer).not.toMatch(/re-derived|matched live/i)
  })

  // The re-tiered stage paints: a derivation over decoded inputs is derived-display (sourced); the miss shaft is
  // presentational (encodes no datum). None of them is 'decoded' any longer — that was the M4 finding.
  const DERIVED_STAGE = ['hit-termination', 'blocker-attribution'] as const
  test.each(DERIVED_STAGE)('re-tiered stage paint %s is DERIVED-DISPLAY, sourced, and reads as a derivation', (id) => {
    const p = byId.get(id)
    expect(p, `ledger must carry ${id}`).toBeTruthy()
    expect(p!.tier).toBe('derived-display')
    expect(p!.tier).not.toBe('decoded') // the M4 correction: not a decoded field of its own
    expect(p!.source).toBeTruthy()       // a derivation over decoded data anchors its authority
    expect(p!.source!).toMatch(/^contract\//)
    expect(p!.answer).toMatch(/derived|derivation/i)
  })
  test('miss-extension is PRESENTATIONAL — a renderer extension that anchors nothing (source null, encodes no datum)', () => {
    const p = byId.get('miss-extension')!
    expect(p.tier).toBe('presentational')
    expect(p.source).toBeNull()
    expect(p.answer).toMatch(/frame edge|extension|no datum|no contact/i)
  })

  // The recompute is the INSTRUMENT's independent recheck — scoped to the Inspector so ask-any-pixel is honest.
  const INSTRUMENT_RECOMPUTE = ['region-verdict', 'occluder-verdict', 'los-verdict', 'range-scalar'] as const
  test.each(INSTRUMENT_RECOMPUTE)('recompute class %s is RECOMPUTED and scoped to the Inspector surface', (id) => {
    const p = byId.get(id)!
    expect(p.tier).toBe('recomputed')
    expect(p.answer).toMatch(/Inspector/) // the surface where the recompute actually runs
  })

  test('every re-tiered/decoded stage paint is a real ledger citizen (the re-tier renamed nothing away)', () => {
    for (const id of ['contact-verdict', 'hit-termination', 'miss-extension', 'blocker-attribution', ...INSTRUMENT_RECOMPUTE]) {
      expect(byId.has(id)).toBe(true)
    }
    // The old lumped id is GONE — ray-termination split into hit-termination (derived) + miss-extension (presentational).
    expect(byId.has('ray-termination')).toBe(false)
  })

  test('the honesty chip still agrees with the ledger after the re-tier (contact-verdict keeps decoded present)', () => {
    expect(chipAgreesWithLedger(E0_REGISTRATION)).toBe(true)
  })
})

// ── E0 LEDGER TRUTH — the selection re-lensing is DATA (causation + distance), not presentational ──────
describe('E0_REGISTRATION ledger truth — selection re-lensing is sourced derived-display, not presentational', () => {
  const byId = new Map(E0_REGISTRATION.provenance.map(p => [p.id, p]))

  test('the re-lensing is a SOURCED derived-display class — the hop registers encode causation + distance', () => {
    const p = byId.get('selection-relensing')
    expect(p).toBeTruthy()
    expect(p!.tier).toBe('derived-display')
    expect(p!.source).toBeTruthy()
    expect(p!.source!).toMatch(/^contract\//) // sourced (a derivation over decoded data anchors its authority)
    expect(p!.source!).toMatch(/causation/i)
    expect(p!.answer).toMatch(/hop/i)
    expect(p!.answer).toMatch(/causation|distance/i)
  })

  test('the presentational class NO LONGER claims the re-lensing — it keeps only camera/grid/fog/treatment', () => {
    const pres = byId.get('presentational')!
    expect(pres.tier).toBe('presentational')
    expect(pres.source).toBeNull()
    expect(pres.answer).not.toMatch(/re-lens/i) // the false "encodes no data" claim is gone
    expect(pres.answer).toMatch(/camera|grid|fog|fade|grading/i) // the genuinely presentational treatments remain
  })
})
