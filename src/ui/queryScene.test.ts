import { describe, expect, test } from 'vitest'
import { actOf, lineFadeFactor, solidRevealSeqs, observerPoint, missRayEndpoint, ghostVisible, povFraming, ACT_I_END, ACT_II_END, ACT_III_START } from './queryScene'
import { queryBounds, type QueryDraw } from './queryStage'

// Pure render-helper tests for the query stage (v0.6 T3). House style: hand-built draws + boundary probes.
// The act boundaries mirror the design draw inventory §3.1; the fade mirrors trail.ts's shader math.

describe('actOf — the three acts (draw inventory §3.1)', () => {
  test('act I is seq 0..35 (learn the objects)', () => {
    expect(actOf(0)).toBe(1)
    expect(actOf(ACT_I_END)).toBe(1) // 35, last of act I
  })
  test('act II is seq 36..55 (origin LOS battery)', () => {
    expect(actOf(ACT_I_END + 1)).toBe(2) // 36, first LOS composite territory
    expect(actOf(ACT_II_END)).toBe(2) // 55, the grazing-tangent LOS
  })
  test('act III is seq 56..74 (the drawn observer)', () => {
    expect(actOf(ACT_III_START)).toBe(3) // 56, first observer establishing
    expect(actOf(74)).toBe(3) // the closing CLEAR
  })
  test('clamps either side (defensive: no act 0 or 4)', () => {
    expect(actOf(-5)).toBe(1)
    expect(actOf(9999)).toBe(3)
  })
})

describe('lineFadeFactor — head-relative decay (mirrors the trail shader)', () => {
  test('the head ray is full voice', () => {
    expect(lineFadeFactor(40, 40, 6)).toBe(1)
  })
  test('a ray span ticks back has decayed to zero (gone)', () => {
    expect(lineFadeFactor(40, 34, 6)).toBe(0) // exactly span behind
    expect(lineFadeFactor(40, 30, 6)).toBe(0) // beyond the window
  })
  test('linear ramp between the head and the window edge', () => {
    expect(lineFadeFactor(40, 37, 6)).toBeCloseTo(0.5, 6) // 3 behind of 6 → 0.5
    expect(lineFadeFactor(40, 38, 6)).toBeCloseTo(2 / 3, 6)
  })
  test('a not-yet-revealed ray (ahead of the head) is zero', () => {
    expect(lineFadeFactor(40, 41, 6)).toBe(0)
  })
  test('span <= 0 shows only the exact head', () => {
    expect(lineFadeFactor(40, 40, 0)).toBe(1)
    expect(lineFadeFactor(40, 39, 0)).toBe(0)
  })
})

// Minimal hand-built draws (only the fields the helpers read): kind + seq + object (+ o/point for observer).
const pt = (seq: number, object: number): QueryDraw =>
  ({ kind: 1, seq, object, point: [seq, 0, 0], verdict: 'INSIDE', tiebreak: false, d2: null, dist: null })
const ray = (seq: number, object: number): QueryDraw =>
  ({ kind: 3, seq, object, mode: 0, o: [0, 0, 0], target: [1, 0, 0], verdict: 'MISS', tiebreak: false, t: null, hitPoint: null, metricDist: null })

describe('solidRevealSeqs — when each body first materialises (data-true)', () => {
  test('minimum seq per object across kind-1 + kind-3 draws; kind-2/4 ignored', () => {
    const draws: (QueryDraw | null)[] = [
      pt(0, 1), // sphere first at 0
      null,
      pt(4, 2), // box first at 4
      ray(6, 2), // later box ref does not lower the min
      ray(29, 3), // triangle first at 29
      ray(31, 1), // later sphere ref does not lower the min
    ]
    const first = solidRevealSeqs(draws)
    expect(first.get(1)).toBe(0)
    expect(first.get(2)).toBe(4)
    expect(first.get(3)).toBe(29)
  })
  test('an unprobed object maps to Infinity (never materialises)', () => {
    const first = solidRevealSeqs([pt(0, 1)])
    expect(first.get(1)).toBe(0)
    expect(first.get(2)).toBe(Infinity)
    expect(first.get(3)).toBe(Infinity)
  })
})

describe('observerPoint — read from data, never assumed', () => {
  test('returns the first act-III draw origin', () => {
    const draws: (QueryDraw | null)[] = new Array(ACT_III_START).fill(null)
    draws[ACT_III_START] = {
      kind: 2, seq: ACT_III_START, o: [-601, -37, 0], g: [256, 0, 0],
      rangeM: 857.9, bearingRad: 0.044, bearingDeg: 2.52, tiebreak: false,
    }
    expect(observerPoint(draws)).toEqual([-601, -37, 0])
  })
  test('null when the record has no act-III geometry (honest empty state)', () => {
    expect(observerPoint([pt(0, 1), pt(1, 1)])).toBeNull()
  })
})

describe('ghostVisible — the NOT-YET gate (selection ahead of the written frontier)', () => {
  test('selected AHEAD of the frontier ⟹ ghost', () => {
    expect(ghostVisible(40, 10)).toBe(true)
    expect(ghostVisible(1, 0)).toBe(true) // the taught cold-open: tick 0, a timeline click ahead of the head
  })
  test('selected AT or BEHIND the frontier (already written) ⟹ no ghost', () => {
    expect(ghostVisible(10, 40)).toBe(false) // well behind the head
    expect(ghostVisible(40, 40)).toBe(false) // exact boundary seq == reveal → the written form draws, not the ghost
    expect(ghostVisible(39, 40)).toBe(false)
  })
  test('deselected ⟹ no ghost (nothing to preview)', () => {
    expect(ghostVisible(null, 0)).toBe(false)
    expect(ghostVisible(null, 40)).toBe(false)
  })
  test('fill-in transition: the ghost is on iff the head has not reached ev, and NEVER coincides with the written form', () => {
    const ev = 30
    for (let reveal = 0; reveal <= 74; reveal++) {
      const ghost = ghostVisible(ev, reveal)
      const written = ev <= reveal // the written form draws ev exactly when it is within the revealed prefix
      expect(ghost).toBe(reveal < ev)       // ghost iff the head is still short of ev
      expect(ghost && written).toBe(false)  // the two are mutually exclusive — no frame draws both
    }
    expect(ghostVisible(ev, ev - 1)).toBe(true)  // one tick before arrival: ghost held
    expect(ghostVisible(ev, ev)).toBe(false)     // arrival: the written form takes over in place (bloom ignites here)
  })
  test('scrub back below ev re-ghosts (a pure function of the reveal count — both directions)', () => {
    const ev = 50
    expect(ghostVisible(ev, 50)).toBe(false) // written
    expect(ghostVisible(ev, 49)).toBe(true)  // scrubbed back one tick → re-ghost
    expect(ghostVisible(ev, 0)).toBe(true)   // scrubbed to the start → ghost
  })
})

describe('povFraming — the Observer\'s Eye preset (T4b)', () => {
  // An act-III observer draw (O read from data), enough to give queryBounds a theatre (the solids seed it).
  const withObserver = (): (QueryDraw | null)[] => {
    const draws: (QueryDraw | null)[] = new Array(ACT_III_START).fill(null)
    draws[ACT_III_START] = {
      kind: 2, seq: ACT_III_START, o: [-601, -37, 0], g: [256, 0, 0],
      rangeM: 857.9, bearingRad: 0.044, bearingDeg: 2.52, tiebreak: false,
    }
    return draws
  }
  test('stands at O (three-flip x=n, y=−d, z=e) and aims at the theatre centroid', () => {
    const draws = withObserver()
    const f = povFraming(draws)!
    const o = observerPoint(draws)!
    const c = queryBounds(draws).solidsContacts!.center
    // Position IS the observer, three-flipped: n→x, −d→y, e→z (the same flip the renderer + stage bounds use).
    expect(f.position[0]).toBe(o[0])   // n stays x (−601)
    expect(f.position[2]).toBe(o[1])   // e → z (−37)
    // Target IS the interrogated theatre centroid, three-flipped — and it is NOT the observer (a real look direction).
    expect(f.target).toEqual([c[0], -c[2], c[1]])
    expect(f.position).not.toEqual(f.target)
    expect([...f.position, ...f.target].every(Number.isFinite)).toBe(true)
  })
  test('null when there is no drawn observer (honest empty state → the preset is a no-op on f0/f1)', () => {
    // No act-III geometry at all: observerPoint is null, so the POV cannot be composed.
    const noObs: (QueryDraw | null)[] = [
      { kind: 1, seq: 0, object: 1, point: [256, 0, 0], verdict: 'INSIDE', tiebreak: false, d2: 0, dist: 0 },
    ]
    expect(povFraming(noObs)).toBeNull()
    expect(povFraming([])).toBeNull() // empty record → null both ways
  })
})

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

describe('missRayEndpoint — mode-0 miss shaft reaches exactly len along the true direction', () => {
  const LEN = 520
  test('an axis-plane direction with down == 0 ([1,0,0], a real e0 row) reaches EXACTLY len — not the ~368u the component-guard bug foreshortened it to', () => {
    const end = missRayEndpoint([0, 0, 0], [1, 0, 0], LEN)
    expect(end).toEqual([520, 0, 0])
    expect(dist(end, [0, 0, 0])).toBeCloseTo(LEN, 6)
    // The old `Math.hypot(x, y, target[2] || 1)` denominator would have been √2, giving ~367.7u — pin that it does NOT.
    expect(dist(end, [0, 0, 0])).not.toBeCloseTo(LEN / Math.SQRT2, 1)
  })
  test('respects a non-origin start: the endpoint is len from o, not from the world origin', () => {
    const o: [number, number, number] = [10, 20, 30]
    const end = missRayEndpoint(o, [1, 0, 0], LEN)
    expect(end).toEqual([530, 20, 30])
    expect(dist(end, o)).toBeCloseTo(LEN, 6)
  })
  test('normalises a genuine 3-D direction (len-7 vector) so the shaft is exactly len regardless of magnitude', () => {
    const end = missRayEndpoint([0, 0, 0], [2, 3, 6], LEN) // |dir| = 7
    expect(dist(end, [0, 0, 0])).toBeCloseTo(LEN, 6)
    expect(end[0]).toBeCloseTo((2 / 7) * LEN, 6)
  })
  test('a direction along the down axis alone ([0,0,3]) still normalises to exactly len', () => {
    const end = missRayEndpoint([0, 0, 0], [0, 0, 3], LEN)
    expect(dist(end, [0, 0, 0])).toBeCloseTo(LEN, 6)
    expect(end).toEqual([0, 0, LEN])
  })
  test('zero-vector direction is result-guarded: collapses to o, no division-by-zero NaN', () => {
    const o: [number, number, number] = [5, 6, 7]
    const end = missRayEndpoint(o, [0, 0, 0], LEN)
    expect(end).toEqual(o)
    expect(end.every((v) => Number.isFinite(v))).toBe(true)
  })
})
