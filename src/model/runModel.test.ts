import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle, type DecodedRun } from '../decode/decodeBundle'
import type { EntityV2 } from '../decode/payloads'
import { RunModel } from './runModel'
import { buildTrail } from '../ui/trail'
import { asEventTick, asStateFrame } from '../lib/brand'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const f0 = new RunModel(decodeBundle(load('f0_seed42.det')), null)
const f1 = new RunModel(decodeBundle(load('f1_seed42.det')), null)
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)

describe('causal index (F0)', () => {
  test('event 1 parent is 0; event 0 children are [1]', () => {
    expect(f0.parentOf(1)).toBe(0)
    expect(f0.parentOf(0)).toBeNull()
    expect(f0.childrenOf(0)).toEqual([1])
  })
  test('verify and ticks column are exposed', () => {
    expect(f0.verify.matchesTrailer).toBe(true)
    expect(f0.ticks.length).toBe(2)
  })
})
describe('tick index (E0)', () => {
  test('every tick 0..74 has exactly one event', () => {
    for (let t = 0; t < 75; t++) expect(e0.eventsByTick(asEventTick(t))).toHaveLength(1)
  })
  test('an out-of-range tick returns the shared empty instance — no per-call allocation', () => {
    // `?? []` allocated a FRESH empty array on every out-of-range call; `?? EMPTY` returns the module
    // singleton (the same instance eventsForSubject already hands back). Identity across two calls is the
    // observable proof the allocation is gone. Behavior is otherwise unchanged — still an empty, readonly,
    // length-0 result for any tick outside 0..tickCount-1 (mirrors the geometryQueryAt memoization test).
    const oob = asEventTick(e0.tickCount + 5)
    expect(e0.eventsByTick(oob)).toHaveLength(0)
    expect(e0.eventsByTick(oob)).toBe(e0.eventsByTick(oob))
  })
  test('kind-23 payloads decode via geometryQueryAt; F0 fixture events return null', () => {
    expect(e0.geometryQueryAt(0)).not.toBeNull()
    expect(f0.geometryQueryAt(0)).toBeNull()
  })
  test('geometryQueryAt memoizes per seq (same instance back-to-back)', () => {
    expect(e0.geometryQueryAt(3)).toBe(e0.geometryQueryAt(3))
    expect(f0.geometryQueryAt(0)).toBeNull()
  })
  test('kindAt equals eventAt(seq).kind for every event, without re-decoding (review finding)', () => {
    // The pre-decoded kind array must agree with the envelope decode for EVERY event — the whole point of
    // kindAt is to skip decodeEvent while returning the identical kind. E0's 75 events are all kind-23.
    for (let seq = 0; seq < e0.eventCount; seq++) expect(e0.kindAt(seq)).toBe(e0.eventAt(seq).kind)
    for (let seq = 0; seq < f1.eventCount; seq++) expect(f1.kindAt(seq)).toBe(f1.eventAt(seq).kind)
  })
})
describe('lazy state materialization equivalence', () => {
  test('same tick decoded twice (through cache eviction) is deeply equal', () => {
    const first = structuredClone(e0.entityStatesAt(asStateFrame(5)))
    for (let t = 6; t < 30; t++) e0.entityStatesAt(asStateFrame(t)) // force eviction (LRU 16)
    expect(structuredClone(e0.entityStatesAt(asStateFrame(5)))).toEqual(first)
  })
  test('F0 entity value follows the fixture transitions (0 at tick 0)', () => {
    const s0 = f0.entityStatesAt(asStateFrame(0))
    expect([...s0.keys()]).toEqual(['1:0'])
    expect(s0.get('1:0')!.value).toBe(0n)
  })
  test('entityStatesAt returns the cached instance on back-to-back hits', () => {
    expect(e0.entityStatesAt(asStateFrame(0))).toBe(e0.entityStatesAt(asStateFrame(0)))
  })
  test('the state-frame / event-tick brands are non-interchangeable at the RunModel seam', () => {
    // Compile-level pins: entityStatesAt reads the STATE-FRAME domain, eventsByTick the EVENT domain. A bare
    // number (an un-branded raw playhead) cannot index either — the confusion the wave exists to kill is now a
    // type error at this seam. @ts-expect-error fires at typecheck; the runtime call still works (brands erase).
    // @ts-expect-error a raw number is not a StateFrame
    expect(() => e0.entityStatesAt(0)).not.toThrow()
    // @ts-expect-error a StateFrame is not an EventTick (the two axes must not cross)
    expect(e0.eventsByTick(asStateFrame(0))).toHaveLength(1)
  })
})
describe('causal chain (E0: single chain of depth 75)', () => {
  test('from seq 40: ancestors 39..0 nearest-first, descendants 41..74', () => {
    const c = e0.causalChain(40)
    expect(c.ancestors[0]).toBe(39); expect(c.ancestors).toHaveLength(40); expect(c.ancestors.at(-1)).toBe(0)
    expect(c.descendants[0]).toBe(41); expect(c.descendants).toHaveLength(34); expect(c.descendants.at(-1)).toBe(74)
  })
  test('root has no ancestors; leaf has no descendants', () => {
    expect(e0.causalChain(0).ancestors).toHaveLength(0)
    expect(e0.causalChain(74).descendants).toHaveLength(0)
  })
})
describe('firstPopulatedTick / entityKeys subject set (v0.4.1)', () => {
  // entityKeys() is now the namespace-1 key set at the FIRST populated tick, not tick 0.
  test('firstPopulatedTick: f1 populates at tick 0', () => {
    expect(f1.firstPopulatedTick()).toBe(0)
    expect(f1.entityKeys()).toEqual(['1:0'])
  })
  test('firstPopulatedTick: e0 never populates', () => {
    // E0 only ever carries the Engine=9 bookkeeping partition — no namespace-1 Entity at any tick.
    expect(e0.firstPopulatedTick()).toBe(-1)
    expect(e0.entityKeys()).toEqual([])
  })
  test('firstPopulatedTick: a late-spawn run returns k strictly between 0 and tickCount', () => {
    // No shipped fixture spawns its subject LATE (f0/f1 populate at tick 0, e0 never), so the
    // strictly-between case — the one that distinguishes first-populated-tick semantics from a plain
    // tick-0 read — is pinned on a minimal hand-built run. Zero events → the constructor's geometry
    // decode loop never runs; 6 state frames → tickCount 5. entityStatesAt is the decode seam the scan
    // consumes, stubbed so ticks 0-2 are empty and the subject '1:0' spawns at tick 3.
    const run = {
      seq: new Float64Array(0), tick: new Float64Array(0), kind: new Uint16Array(0),
      causation: new Float64Array(0), payloadOff: new Uint32Array(0), payloadLen: new Uint32Array(0),
      stateOff: new Uint32Array(6), stateLen: new Uint32Array(6),
      det: new ArrayBuffer(0), verify: { matchesTrailer: true },
    } as unknown as DecodedRun
    const model = new RunModel(run, null)
    const SPAWN = 3
    const populated: ReadonlyMap<string, EntityV2> = new Map([['1:0', {} as EntityV2]])
    const empty: ReadonlyMap<string, EntityV2> = new Map()
    ;(model as unknown as { entityStatesAt(t: number): ReadonlyMap<string, EntityV2> }).entityStatesAt =
      (t: number) => (t >= SPAWN ? populated : empty)
    expect(model.tickCount).toBe(5)
    const k = model.firstPopulatedTick()
    expect(k).toBe(SPAWN)
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThan(model.tickCount)
    expect(model.entityKeys()).toEqual(['1:0'])
  })
})
describe('subject index (E0: all 75 events are kind-23)', () => {
  test('every event has a subject key and the index covers all 75', () => {
    // Forced tweak (brief used e0.entityKeys()): E0 never populates a namespace-1 Entity
    // record — its only per-tick state is the Engine=9 bookkeeping partition (spec-3a
    // §6.5.4), so entityKeys() is legitimately empty for E0. Derive the key set from
    // subjectOf across all events instead; index self-consistency is what's under test.
    const keys = new Set<string>()
    for (let seq = 0; seq < e0.eventCount; seq++) keys.add(e0.subjectOf(seq)!)
    let total = 0
    for (const k of keys) total += e0.eventsForSubject(k).length
    expect(total).toBe(75)
  })
  test('subjectOf agrees with the index; F0 fixture events have null subject', () => {
    const k = e0.subjectOf(0)!
    expect(e0.eventsForSubject(k)).toContain(0)
    expect(f0.subjectOf(0)).toBeNull()
  })
})
describe('model↔trail tick-axis parity (the drone body and its head never split)', () => {
  // A load-bearing coupling: the Entities pass clamps the drone body to model.tickCount, while the trail —
  // and the sensing head that rides its last revealed vertex — clamps to trail.count − 1. buildTrail lays
  // exactly one vertex per tick over 0..tickCount, so a drawable trail is tickCount + 1 long BY CONSTRUCTION.
  // Pinned against a real bundle so a future mismatched fixture fails loud here, not on-stage as a body
  // severed from its head at the last tick. f1 is the canonical drawable-trajectory run (e0/f0 trails are
  // empty — count 0 — so the parity is asserted where a real flown path actually exists).
  test('f1 (a real flown corridor): model.tickCount === trail.count − 1', () => {
    const trail = buildTrail(f1)
    expect(trail.count).toBeGreaterThan(0)   // a real trajectory — not the empty e0/f0 (count 0) case
    expect(f1.tickCount).toBe(trail.count - 1)
  })
})
