import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from './decodeBundle'
import { decodeEvent } from './payloads'
import { FILE_HEADER_LEN, FrameTag } from './frames'
import { crc32c } from '../lib/crc32c'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('decodeBundle columns (E0)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  test('75 events, 76 state frames, verified', () => {
    expect(run.seq.length).toBe(75)
    expect(run.stateOff.length).toBe(76)
    expect(run.verify.matchesTrailer).toBe(true)
  })
  test('columns agree with a direct payload decode (spot check seq 10)', () => {
    const span = new Uint8Array(run.det).subarray(run.payloadOff[10]!, run.payloadOff[10]! + run.payloadLen[10]!)
    const e = decodeEvent(span)
    expect(e.seq).toBe(run.seq[10]); expect(e.tick).toBe(run.tick[10]); expect(e.kind).toBe(run.kind[10])
  })
  test('seq column is 0..74 in order; causation -1 encodes None', () => {
    expect(run.seq[0]).toBe(0); expect(run.seq[74]).toBe(74)
    expect([...run.causation].every(c => c === -1 || (c >= 0 && Number.isInteger(c)))).toBe(true)
  })
})

describe('decodeBundle causation ordering guard', () => {
  test('rejects non-monotonic causation (self-parent) at the decode boundary', () => {
    const det = load('f0_seed42.det')
    const bytes = new Uint8Array(det)
    const view = new DataView(bytes.buffer)

    // Walk frames from the header to find the SECOND Event frame (tag 1). F0's layout is
    // StateTick(0), Event(seq 0), StateTick(1), Event(seq 1), StateTick(2), Trailer -- so
    // this is the seq-1 event, whose causation currently points at seq 0 (its true parent).
    let off = FILE_HEADER_LEN
    let eventFrameOff = -1
    let eventFrameLen = -1
    let eventFramesSeen = 0
    while (off < bytes.byteLength) {
      const tag = bytes[off]!
      const len = view.getUint32(off + 1, true)
      if (tag === FrameTag.Event) {
        eventFramesSeen++
        if (eventFramesSeen === 2) { eventFrameOff = off; eventFrameLen = len; break }
      }
      off += 5 + len + 4
    }
    expect(eventFrameOff).toBeGreaterThan(-1)

    // Payload layout (payloads.ts decodeEvent): seq u64(8) ++ tick u64(8) ++ kind u16(2)
    // ++ causation Option<u64> = tag u8(1) ++ u64(8). Overwrite the causation u64 (currently
    // 0, i.e. Some(0)) to 1 -- the event's own seq -- making it a self-parent (forward/cyclic
    // causation: causationId >= seq).
    const payloadOff = eventFrameOff + 5
    const causationValueOff = payloadOff + 8 + 8 + 2 + 1
    expect(view.getBigUint64(causationValueOff, true)).toBe(0n) // sanity: was Some(0)
    view.setBigUint64(causationValueOff, 1n, true) // tamper: self-parent

    // Recompute this frame's CRC over [frameOff, frameOff+5+len) and rewrite it LE right
    // after the payload -- the bundle is CRC/hash-valid again (foldAndVerify recomputes over
    // the tampered bytes and simply reports matchesTrailer=false; it does not throw).
    const crcOff = eventFrameOff + 5 + eventFrameLen
    const recomputed = crc32c(bytes.subarray(eventFrameOff, crcOff))
    view.setUint32(crcOff, recomputed, true)

    expect(() => decodeBundle(bytes.buffer)).toThrow(/causation/)
  })
})

describe('decodeBundle tick-range guard', () => {
  test('rejects an event tick >= tickCount at the decode boundary', () => {
    const det = load('f0_seed42.det')
    const bytes = new Uint8Array(det)
    const view = new DataView(bytes.buffer)

    // Find the FIRST Event frame (tag 1). F0's layout is StateTick(0), Event(seq 0), StateTick(1),
    // Event(seq 1), StateTick(2), Trailer -- 3 state frames, so tickCount = stateFrames - 1 = 2 and
    // every legitimate event tick is < 2. seq 0's true tick is 0.
    let off = FILE_HEADER_LEN
    let eventFrameOff = -1
    let eventFrameLen = -1
    while (off < bytes.byteLength) {
      const tag = bytes[off]!
      const len = view.getUint32(off + 1, true)
      if (tag === FrameTag.Event) { eventFrameOff = off; eventFrameLen = len; break }
      off += 5 + len + 4
    }
    expect(eventFrameOff).toBeGreaterThan(-1)

    // Payload layout (payloads.ts decodeEvent): seq u64(8) ++ tick u64(8) ++ ... -- so the tick
    // field sits at payloadOff + 8. Overwrite it with a huge (but still safe-integer) value well
    // past tickCount; 0xffffffff < Number.MAX_SAFE_INTEGER so safeU64 accepts it and the value
    // reaches the tick-range guard rather than tripping the safe-integer check first.
    const payloadOff = eventFrameOff + 5
    const tickValueOff = payloadOff + 8
    expect(view.getBigUint64(tickValueOff, true)).toBe(0n) // sanity: seq-0's tick was 0
    view.setBigUint64(tickValueOff, 0xffffffffn, true)     // tamper: tick far out of range

    // Recompute this frame's CRC so foldAndVerify passes its per-frame CRC check (it only reports
    // matchesTrailer=false; it does not throw) and the walk reaches the tick-range guard.
    const crcOff = eventFrameOff + 5 + eventFrameLen
    const recomputed = crc32c(bytes.subarray(eventFrameOff, crcOff))
    view.setUint32(crcOff, recomputed, true)

    expect(() => decodeBundle(bytes.buffer)).toThrow(/tick/)
  })
})
