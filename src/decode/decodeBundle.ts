import { FILE_HEADER_LEN, FrameTag, parseFileHeader, type FileHeader } from './frames'
import { DecodeError } from '../lib/bytes'
import { decodeEvent } from './payloads'
import { foldAndVerify, type VerifyResult } from './verify'

export interface DecodedRun {
  header: FileHeader
  seq: Float64Array; tick: Float64Array; kind: Uint16Array; causation: Float64Array
  payloadOff: Uint32Array; payloadLen: Uint32Array
  stateOff: Uint32Array; stateLen: Uint32Array
  det: ArrayBuffer
  verify: VerifyResult
}

export function decodeBundle(det: ArrayBuffer): DecodedRun {
  const bytes = new Uint8Array(det)
  const header = parseFileHeader(bytes)
  const verify = foldAndVerify(bytes) // full CRC + fold pass; throws on malformed input

  const events: { seq: number; tick: number; kind: number; causation: number; off: number; len: number }[] = []
  const states: { off: number; len: number }[] = []
  let off = FILE_HEADER_LEN
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(det, off + 1, 4).getUint32(0, true)
    const pOff = off + 5
    if (tag === FrameTag.Event) {
      const e = decodeEvent(bytes.subarray(pOff, pOff + len))
      events.push({ seq: e.seq, tick: e.tick, kind: e.kind, causation: e.causationId ?? -1, off: pOff, len })
    } else if (tag === FrameTag.StateTick) {
      states.push({ off: pOff, len })
    }
    off = pOff + len + 4
  }
  // Frame offsets/lengths here are re-derived after foldAndVerify has already run the
  // authoritative CRC+fold pass over the same bytes (via iterateFrames) and thrown on any
  // malformed input; this second walk trusts that validation and does not re-check CRCs.

  const n = events.length
  const run: DecodedRun = {
    header, det, verify,
    seq: new Float64Array(n), tick: new Float64Array(n), kind: new Uint16Array(n),
    causation: new Float64Array(n), payloadOff: new Uint32Array(n), payloadLen: new Uint32Array(n),
    stateOff: new Uint32Array(states.length), stateLen: new Uint32Array(states.length),
  }
  // tickCount = state frames - 1 (ticks are 0-indexed; N state frames span ticks 0..N-1). Known
  // now that the walk has counted every StateTick frame. An event's tick indexes into that range,
  // so tick >= tickCount is out of bounds -- reject it at the decode boundary (sibling of the
  // causation guard) rather than let a crafted bundle hand a bogus tick to downstream index math.
  const tickCount = states.length - 1
  events.forEach((e, i) => {
    if (e.seq !== i) throw new DecodeError('MalformedPayload', `seq ${e.seq} at index ${i}`)
    // Causal handles are retained from PAST events only -- a parent must precede its child.
    // Reject cyclic/forward causation here so RunModel.causalChain's unbounded parent walk
    // is provably safe: every step strictly decreases, so it terminates in <= seq steps.
    if (e.causation !== -1 && e.causation >= e.seq)
      throw new DecodeError('MalformedPayload', `causation ${e.causation} not before seq ${e.seq}`)
    if (e.tick >= tickCount)
      throw new DecodeError('MalformedPayload', `event tick ${e.tick} >= tickCount ${tickCount}`)
    run.seq[i] = e.seq; run.tick[i] = e.tick; run.kind[i] = e.kind
    run.causation[i] = e.causation; run.payloadOff[i] = e.off; run.payloadLen[i] = e.len
  })
  states.forEach((s, i) => { run.stateOff[i] = s.off; run.stateLen[i] = s.len })
  return run
}

export const transferablesOf = (r: DecodedRun): ArrayBuffer[] => [
  r.det, r.seq.buffer, r.tick.buffer, r.kind.buffer, r.causation.buffer,
  r.payloadOff.buffer, r.payloadLen.buffer, r.stateOff.buffer, r.stateLen.buffer,
] as ArrayBuffer[]
