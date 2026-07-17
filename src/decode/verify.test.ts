import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { foldAndVerify } from './verify'
import { FILE_HEADER_LEN, FrameTag } from './frames'
import { crc32c } from '../lib/crc32c'

interface Pins { case_id: string; event_hash: string; state_trajectory_hash: string; result_id: string; event_count: number | string; tick_count: number | string }
const cases: { det: string; pins: Pins }[] = [
  { det: 'f0_seed42.det', pins: readPins('f0_seed42.json') },
  { det: 'e0_seed42.det', pins: readPins('e0_seed42.json') },
  { det: 'f1_seed42.det', pins: readPins('f1_seed42.json') },
]
function readPins(name: string): Pins { return JSON.parse(readFileSync(`contract/fixtures/${name}`, 'utf8')) }

describe.each(cases)('independent re-fold of $det', ({ det, pins }) => {
  const v = foldAndVerify(new Uint8Array(readFileSync(`contract/fixtures/${det}`)))
  test('event_hash matches golden', () => expect(v.eventHashHex).toBe(pins.event_hash))
  test('state_trajectory_hash matches golden', () => expect(v.stateHashHex).toBe(pins.state_trajectory_hash))
  test('result_id matches golden', () => expect(v.resultIdHex).toBe(pins.result_id))
  test('case_id matches golden', () => expect(v.caseIdHex).toBe(pins.case_id))
  test('counts match golden and trailer', () => {
    expect(v.eventCount).toBe(Number(pins.event_count))
    expect(v.tickCount).toBe(Number(pins.tick_count))
    expect(v.matchesTrailer).toBe(true)
  })
  test('every per-field trailer comparison (trailerPins) is exposed and true on a clean fold', () => {
    expect(v.trailerPins).toEqual({ eventHash: true, stateTrajectoryHash: true, eventCount: true, tickCount: true })
    // matchesTrailer is exactly the AND of the four per-field pins — one source, no drift.
    expect(v.matchesTrailer).toBe(
      v.trailerPins.eventHash && v.trailerPins.stateTrajectoryHash && v.trailerPins.eventCount && v.trailerPins.tickCount,
    )
  })
})

// ── PER-FIELD trailer tamper: corrupt ONE stored trailer hash, CRC-fix, fold ───────────────────────
// Flip one byte of a stored trailer HASH (CRC-fixed so the frame decodes) → the recomputed value no longer
// matches that field's stored trailer value, so ONLY that field's trailerPins flips false while its siblings
// stay true. This is the premise the det-only Provenance row and the ceremony event_hash row grade on.
function tamperTrailerField(det: string, payloadOffset: number) {
  const bytes = new Uint8Array(readFileSync(`contract/fixtures/${det}`)).slice()
  let off = FILE_HEADER_LEN
  let trailerStart = -1
  let trailerLen = -1
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (tag === FrameTag.Trailer) { trailerStart = off; trailerLen = len; break }
    off += 5 + len + 4
  }
  bytes[trailerStart + 5 + payloadOffset]! ^= 0x01
  const crcOffset = trailerStart + 5 + trailerLen
  new DataView(bytes.buffer, bytes.byteOffset + crcOffset, 4).setUint32(0, crc32c(bytes.subarray(trailerStart, crcOffset)), true)
  return foldAndVerify(bytes)
}
// trailer payload layout: case_id(32) · event_hash(32) · state_trajectory_hash(32) · counts …
const OFF_EVENT_HASH = 32
const OFF_STATE_HASH = 64

test('tampering ONLY the trailer event_hash flips trailerPins.eventHash, leaves the siblings + matchesTrailer', () => {
  const v = tamperTrailerField('e0_seed42.det', OFF_EVENT_HASH)
  expect(v.trailerPins.eventHash).toBe(false)
  expect(v.trailerPins.stateTrajectoryHash).toBe(true)
  expect(v.trailerPins.eventCount).toBe(true)
  expect(v.trailerPins.tickCount).toBe(true)
  expect(v.matchesTrailer).toBe(false)
})

test('tampering ONLY the trailer state hash flips stateTrajectoryHash, but event_hash reproduced fine', () => {
  const v = tamperTrailerField('e0_seed42.det', OFF_STATE_HASH)
  expect(v.trailerPins.stateTrajectoryHash).toBe(false)
  expect(v.trailerPins.eventHash).toBe(true) // the ceremony event_hash row grades from THIS — stays ✓
  expect(v.matchesTrailer).toBe(false)        // the aggregate (step mark / seal) refuses
})

test('one flipped payload bit is caught before hashing (CRC), never silently verified', () => {
  const bytes = new Uint8Array(readFileSync('contract/fixtures/f0_seed42.det')).slice()
  bytes[30]! ^= 0x01
  expect(() => foldAndVerify(bytes)).toThrow()
})

test('termination_reason tamper changes result_id but not matchesTrailer (manifest layer catches it)', () => {
  const f0Pins = readPins('f0_seed42.json')
  const bytes = new Uint8Array(readFileSync('contract/fixtures/f0_seed42.det')).slice()

  // Locate the trailer frame: tag u8 ++ len u32 LE ++ payload ++ crc32c u32 LE over tag++len++payload.
  // The trailer is always the last frame (§ frame layout in decode/frames.ts).
  let off = FILE_HEADER_LEN
  let trailerStart = -1
  let trailerLen = -1
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (tag === FrameTag.Trailer) { trailerStart = off; trailerLen = len; break }
    off += 5 + len + 4
  }
  expect(trailerStart).toBeGreaterThanOrEqual(0)

  // termination_reason is the last 2 bytes of the trailer payload, u16 LE.
  const terminationOffset = trailerStart + 5 + trailerLen - 2
  const view = new DataView(bytes.buffer, bytes.byteOffset + terminationOffset, 2)
  expect(view.getUint16(0, true)).toBe(2)
  view.setUint16(0, 3, true)

  // Recompute the frame's CRC over tag++len++payload and rewrite the trailing CRC field.
  const crcOffset = trailerStart + 5 + trailerLen
  const newCrc = crc32c(bytes.subarray(trailerStart, crcOffset))
  new DataView(bytes.buffer, bytes.byteOffset + crcOffset, 4).setUint32(0, newCrc, true)

  const v = foldAndVerify(bytes)
  expect(v.resultIdHex).not.toBe(f0Pins.result_id)
  expect(v.matchesTrailer).toBe(true)
  expect(v.terminationReason).toBe(3)
})
