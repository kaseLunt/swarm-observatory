import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildQueryDraws, queryBounds, losComponents } from './queryStage'
import { blockedCorridorBounds, observerCraneFraming, observerPoint, povFraming, CRANE_BACK_K, CRANE_LIFT_K } from './queryScene'

// ── e0 AUTHORED TOUR SHOTS vs. the REAL decoded bundle (v0.8 W7) ─────────────────────────────────────────
// The decode-true anchor test the f2a authored beats were pinned by: every W7 shot's geometry is DERIVED from
// the real e0_seed42 bundle's decoded draws, never eyeballed. This decodes the tracked fixture exactly as
// queryStage.oracle.test.ts does, then pins the three shots' anchors (tk39's blocked corridor, the drawn
// observer's crane, tk74's clean passage) to the actual scene geometry. If the bundle is ever re-cut, these
// re-pin against queryStage.oracle.test.ts's own draw-table constants (which move in lockstep).

const load = (n: string): ArrayBuffer => {
  const b = readFileSync(`contract/fixtures/${n}`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

describe('e0 authored tour shots vs. the frozen bundle (e0_seed42)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model)
  const draws = stage.draws

  // ── SHOT 1 "the first block" (beat 2, 'corridor') ──────────────────────────────────────────────────────
  test('the corridor shot resolves to the FIRST blocked sightline — tk39, the sphere, the death at n=191', () => {
    // The decode-true anchors the corridor box is built from (the draw table pins these too: {seq 39, blocker 1}).
    let firstBlockedSeq = -1
    for (const [seq, c] of [...stage.losComposites].sort((a, b) => a[0] - b[0])) {
      if (c.los.verdict === 'BLOCKED') { firstBlockedSeq = seq; break }
    }
    expect(firstBlockedSeq).toBe(39)
    const c39 = losComponents(39, stage)!
    expect(c39.los.o).toEqual([0, 0, 0])          // Act II sightlines are cast FROM the origin (the eye)
    expect(c39.blockerObject).toBe(1)             // the sphere S is the first occluder in its way
    expect(c39.firstBlocker!.hitPoint).toEqual([191, 0, 0]) // the ray dies on the sphere's near face n=191
  })

  test('blockedCorridorBounds fits the {origin, sphere body, contact} box in three-space (centre + radius pinned)', () => {
    const b = blockedCorridorBounds(stage.losComposites)!
    // Box (three-space, x=n/y=−d/z=e) over origin, contact [191,0,0], sphere AABB [191,±65]±65:
    // x∈[0,321], y∈[−65,65], z∈[−65,65] → centre [160.5,0,0], radius ½·hypot(321,130,130) ≈ 184.96.
    expect(b.center[0]).toBeCloseTo(160.5, 2)
    expect(b.center[1]).toBeCloseTo(0, 2)
    expect(b.center[2]).toBeCloseTo(0, 2)
    expect(b.radius).toBeCloseTo(184.96, 2)
    // It contains BOTH ends of the drama — the eye at the origin and the sphere's far face — so the interposition
    // reads. It is much tighter than the whole-stage core (radius 674): a zoom to the first block, not a wide fit.
    expect(dist([0, 0, 0], b.center)).toBeLessThan(b.radius)          // the eye is in frame
    expect(dist([321, 0, 0], b.center)).toBeLessThanOrEqual(b.radius) // the occluder's far face is in frame
    expect(b.radius).toBeLessThan(queryBounds(draws).core!.radius)
  })

  // ── SHOT 2 "the second observer" (beat 4, 'crane') ─────────────────────────────────────────────────────
  test('the crane stands off the DECODED drawn observer, aimed at the interrogated theatre (POV axis)', () => {
    const o = observerPoint(draws)!
    // The seed-42 drawn observer, read from the act-III argv — the decode-true eye (never a scenario constant).
    expect(o[0]).toBeCloseTo(-601.0688, 3)
    expect(o[1]).toBeCloseTo(-37.7829, 3)
    expect(o[2]).toBe(0)

    const theatre = queryBounds(draws).solidsContacts!
    const f = observerCraneFraming(draws)!
    const eye: [number, number, number] = [o[0], -o[2], o[1]] // three-space eye
    // TARGET is the interrogated-theatre centroid three-flipped — byte-identical to the POV aim (the O key drops
    // the viewer in down THIS axis).
    expect(f.target).toEqual([theatre.center[0], -theatre.center[2], theatre.center[1]])
    expect(f.target[0]).toBe(415.5)
    expect(f.target[1]).toBeCloseTo(0, 9) // −0 (the theatre is planar, d=0) — harmless for lookAt, matches the POV flip
    expect(f.target[2]).toBe(-47.5)
    expect(f.target).toEqual(povFraming(draws)!.target)
    // POSITION is BEHIND the eye (opposite the theatre) at hypot(back, lift) off it, ABOVE the deck by the lift —
    // derived from the DECODED theatre radius × the authored fractions, so it can never rot into a magic absolute.
    const pe: [number, number, number] = [f.position[0] - eye[0], f.position[1] - eye[1], f.position[2] - eye[2]]
    const te: [number, number, number] = [f.target[0] - eye[0], f.target[1] - eye[1], f.target[2] - eye[2]]
    expect(pe[0] * te[0] + pe[1] * te[1] + pe[2] * te[2]).toBeLessThan(0) // behind the eye
    expect(dist(f.position, eye)).toBeCloseTo(Math.hypot(theatre.radius * CRANE_BACK_K, theatre.radius * CRANE_LIFT_K), 3)
    expect(f.position[1]).toBeCloseTo(theatre.radius * CRANE_LIFT_K, 3)
    expect([...f.position, ...f.target].every(Number.isFinite)).toBe(true)
  })

  // ── SHOT 3 "clean passage" (beat 5, 'stage') ───────────────────────────────────────────────────────────
  test('the closing CLEAR sightline is tk74 — its origin is framed by the core bookend, its runaway far end lies OUTSIDE that core', () => {
    // The decode-true tk74 anchors (the draw table pins {seq 74, clear}). The clean passage: the sightline runs
    // from the drawn observer OUT to a far runaway target, so its far end lies OUTSIDE the core theatre the
    // 'stage' bookend frames — so the bookend needn't widen to a 1024u shot to keep that runaway end in view.
    let lastClearSeq = -1
    for (const [seq, c] of [...stage.losComposites].sort((a, b) => b[0] - a[0])) {
      if (c.los.verdict === 'LOS_CLEAR') { lastClearSeq = seq; break }
    }
    expect(lastClearSeq).toBe(74)
    const c74 = losComponents(74, stage)!
    expect(c74.los.o).toEqual(observerPoint(draws)) // cast from the drawn observer's eye
    expect(c74.los.g).toEqual([-1024, 0, 0])        // out to a far runaway target (into empty space)

    const core = queryBounds(draws).core! // the NED core the 'stage' bookend frames (Scene flips it to three)
    expect(dist(c74.los.o, core.center)).toBeLessThan(core.radius)    // the eye (origin) IS in the bookend frame
    expect(dist(c74.los.g, core.center)).toBeGreaterThan(core.radius) // the far end is NOT — it lies outside the framed core
    // The bookend is the whole-stage core theatre (the same vantage load / the tour-start reset frame) — pinned.
    expect(core.center[0]).toBeCloseTo(19.466, 2)
    expect(core.radius).toBeCloseTo(674.406, 2)
  })
})
