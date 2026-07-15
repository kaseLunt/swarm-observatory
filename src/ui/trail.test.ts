import { describe, expect, test } from 'vitest'
import type { EntityV2 } from '../decode/payloads'
import type { BoundsSource } from './camera'
import { buildTrail } from './trail'

const ent = (pos: number[]): EntityV2 => ({ value: 0n, alive: true, pos, vel: [], headingRad: 0, speedMps: 0, turnRateRadps: 0, fuel: 0, setpoint: [] })

// perTick: entity-key → NED pos. entityPosition converts NED[N,E,D] → three[E,-D,N].
function stub(keys: string[], perTick: Record<string, number[]>[]): BoundsSource {
  return {
    tickCount: perTick.length - 1,
    entityKeys: () => keys,
    entityStatesAt: (t: number) => {
      const m = new Map<string, EntityV2>()
      const frame = perTick[t] ?? {}
      for (const k of keys) if (frame[k]) m.set(k, ent(frame[k]!))
      return m
    },
  }
}

describe('buildTrail', () => {
  test('single moving subject → one vertex per tick, positions in three-space', () => {
    // NED N 0→100 over 3 ticks → three z 0→100; E,D = 0.
    const t = buildTrail(stub(['1:0'], [
      { '1:0': [0, 0, 0] }, { '1:0': [50, 0, 0] }, { '1:0': [100, 0, 0] },
    ]))
    expect(t.count).toBe(3)
    expect(t.positions.length).toBe(9)
    expect([t.positions[0], t.positions[1], t.positions[2]]).toEqual([0, 0, 0])
    expect([t.positions[6], t.positions[7], t.positions[8]]).toEqual([0, 0, 100]) // three z = N
  })

  test('emits a per-vertex index attribute (i for vertex i) for the head-relative shader fade', () => {
    // The precomputed RGBA ramp is gone (fade is now head-relative, in the shader). The builder instead
    // supplies vertex indices the vertex shader differences against the live uHead uniform.
    const t = buildTrail(stub(['1:0'], [
      { '1:0': [0, 0, 0] }, { '1:0': [50, 0, 0] }, { '1:0': [100, 0, 0] },
    ]))
    expect(t.index.length).toBe(t.count)
    expect([...t.index]).toEqual([0, 1, 2])
  })

  test('no positioned entities (e0-like) → empty, count 0', () => {
    expect(buildTrail(stub([], [{}, {}])).count).toBe(0)
  })

  test('static single point (f0-like) → empty, count 0 (not a trajectory)', () => {
    const t = buildTrail(stub(['1:0'], [{ '1:0': [0, 0, 0] }, { '1:0': [0, 0, 0] }]))
    expect(t.count).toBe(0)
  })

  test('late-appearing subject: entityKeys reflects first populated tick, trail backfills pre-spawn', () => {
    // NEW contract: entityKeys() returns the keys at the run's FIRST POPULATED tick. Here the subject
    // ('1:0') is absent for ticks 0-2 and spawns (moving) from tick 3 onward. The stub mirrors that:
    // entityKeys is ['1:0'] (what the real model would return at the first populated tick), and
    // entityStatesAt is empty before tick 3. tickCount 5 → 6 vertices; ticks 0-2 backfill from tick 3.
    //
    // Spawn at a NON-ORIGIN NED position so the backfill is actually witnessed: an origin spawn +
    // single-component assertion is vacuous — Float32Array zero-init satisfies it even with NO backfill.
    // NED[N,E,D] [10,20,30] → three[E,-D,N] = [20,-30,10] (entityPosition; cf. the offset run below).
    const t = buildTrail(stub(['1:0'], [
      {}, {}, {}, { '1:0': [10, 20, 30] }, { '1:0': [60, 20, 30] }, { '1:0': [110, 20, 30] },
    ]))
    expect(t.count).toBe(6)
    // ALL THREE components of the backfilled tick-0 vertex must equal the spawn (tick-3) three-position —
    // not merely x, and not the zero vector a missing backfill would leave.
    const spawn: [number, number, number] = [20, -30, 10]
    expect([t.positions[0], t.positions[1], t.positions[2]]).toEqual(spawn)
    expect([t.positions[9], t.positions[10], t.positions[11]]).toEqual(spawn)
  })

  test('subject absent for early ticks holds the first known position (no snap-to-origin)', () => {
    // subject spawns at tick 1 far from origin; tick-0 vertex must hold tick-1's position, not [0,0,0].
    const t = buildTrail(stub(['1:0'], [
      {}, { '1:0': [0, 0, 0] }, { '1:0': [100, 0, 0] },
    ]))
    expect(t.count).toBe(3)
    // tick 0 held tick-1's (0,0,0) here; assert it did NOT invent a stray non-origin point and that the
    // travelled extent still triggers a trail. (Held-position correctness is exercised by the offset run.)
    const t2 = buildTrail(stub(['1:0'], [
      {}, { '1:0': [0, 40, 0] }, { '1:0': [0, 40, 0] }, { '1:0': [30, 40, 0] },
    ]))
    // tick 0 (absent) holds tick-1's three-position [E=40, 0, N=0] rather than the origin.
    expect([t2.positions[0], t2.positions[1], t2.positions[2]]).toEqual([40, 0, 0])
  })

  // `first` — the frame of the subject's FIRST PRESENT tick (F1). camera.heldSubjectPose reads it to know where
  // the hold-filled buffer stops being a real presence and starts being a pre-spawn back-fill: frames < first
  // have no present pose ≤ k, so the directed camera suppresses rather than anchors on the fabricated back-fill.
  test('first = the subject\'s first-present frame (0 when present from tick 0)', () => {
    const t = buildTrail(stub(['1:0'], [
      { '1:0': [0, 0, 0] }, { '1:0': [50, 0, 0] }, { '1:0': [100, 0, 0] },
    ]))
    expect(t.first).toBe(0)
  })

  test('first tracks a late spawn — the back-filled pre-spawn frames precede it', () => {
    // Subject absent ticks 0-2, spawns (moving) from tick 3: first === 3, and frames 0-2 are back-filled (not present).
    const t = buildTrail(stub(['1:0'], [
      {}, {}, {}, { '1:0': [10, 20, 30] }, { '1:0': [60, 20, 30] }, { '1:0': [110, 20, 30] },
    ]))
    expect(t.first).toBe(3)
  })

  test('an empty trail (no flight / static point) reports first = −1, in lockstep with count 0', () => {
    expect(buildTrail(stub([], [{}, {}])).first).toBe(-1)                                        // e0-like: no entities
    expect(buildTrail(stub(['1:0'], [{ '1:0': [0, 0, 0] }, { '1:0': [0, 0, 0] }])).first).toBe(-1) // f0-like: static point
  })
})
