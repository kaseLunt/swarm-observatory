import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { iterateFrames, FrameTag } from './frames'
import { decodeEvent, decodeStateTick, decodeEntityV2, decodeTrailer, decodeGeometryQuery, GEOMETRY_QUERY_RESOLVED } from './payloads'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const vecPayload = (name: string) => {
  const f = Uint8Array.from(vectors.find(v => v.name === name)!.bytes.match(/../g)!.map(b => parseInt(b, 16)))
  return f.subarray(5, f.byteLength - 4) // strip tag+len and crc
}
const det = (name: string) => new Uint8Array(readFileSync(`contract/fixtures/${name}`))

describe('primitives frame vectors', () => {
  test('event example: seq 0, tick 0, kind F0_FIXTURE, no causation, 22-byte payload', () => {
    const e = decodeEvent(vecPayload('frame_event_example'))
    expect(e.seq).toBe(0); expect(e.tick).toBe(0); expect(e.kind).toBe(0xf000)
    expect(e.causationId).toBeNull(); expect(e.payload.byteLength).toBe(22)
  })
  test('statetick example: tick 0, entities (1,0) 53B and (9,0) 98B', () => {
    const s = decodeStateTick(vecPayload('frame_statetick_example'))
    expect(s.tickIndex).toBe(0)
    expect(s.entities.map(e => [e.namespaceTag, e.fieldBytes.byteLength])).toEqual([[1, 53], [9, 98]])
    const ent = decodeEntityV2(s.entities[0]!.fieldBytes)
    expect(ent.alive).toBe(true); expect(ent.pos).toEqual([]); expect(ent.fuel).toBe(0)
  })
  test('trailer example: STEP_LIMIT', () => {
    const t = decodeTrailer(vecPayload('frame_trailer_example'))
    expect(t.terminationReason).toBe(2)
    expect(t.caseId.byteLength).toBe(32)
  })
})

describe('golden F0 events', () => {
  test('seq 1 has causation Some(0) — the causal edge exists', () => {
    const events = iterateFrames(det('f0_seed42.det')).filter(f => f.tag === FrameTag.Event).map(f => decodeEvent(f.payload))
    expect(events.map(e => [e.seq, e.tick, e.causationId])).toEqual([[0, 0, null], [1, 1, 0]])
  })
})

describe('golden E0 geometry queries', () => {
  test('all 75 events are kind 23 and their payloads decode fully', () => {
    const frames = iterateFrames(det('e0_seed42.det')).filter(f => f.tag === FrameTag.Event)
    expect(frames).toHaveLength(75)
    for (const f of frames) {
      const e = decodeEvent(f.payload)
      expect(e.kind).toBe(GEOMETRY_QUERY_RESOLVED)
      const q = decodeGeometryQuery(e.payload)
      expect([1, 2, 3, 4]).toContain(q.queryKind)
      expect(typeof q.resultFlag).toBe('boolean')
    }
  })
})
