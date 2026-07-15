import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { FrameTag, iterateFrames, parseFileHeader, FILE_HEADER_LEN } from './frames'
import { DecodeError } from '../lib/bytes'
import { crc32c } from '../lib/crc32c'

const det = (name: string) => new Uint8Array(readFileSync(`contract/fixtures/${name}`))
const writeU32LE = (bytes: Uint8Array, off: number, v: number) => new DataView(bytes.buffer, bytes.byteOffset).setUint32(off, v, true)
const readU32LE = (bytes: Uint8Array, off: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(off, true)

describe('golden bundle framing', () => {
  test('F0 header: format 1, events v9, state v4', () => {
    const h = parseFileHeader(det('f0_seed42.det'))
    expect(h).toEqual({ formatVersion: 1, eventSchemaVersion: 9, stateSchemaVersion: 4 })
  })
  test('F0: 6 frames = 3 StateTick + 2 Event + 1 Trailer, trailer last', () => {
    const frames = iterateFrames(det('f0_seed42.det'))
    const tags = frames.map(f => f.tag)
    expect(frames).toHaveLength(6)
    expect(tags.filter(t => t === FrameTag.StateTick)).toHaveLength(3)
    expect(tags.filter(t => t === FrameTag.Event)).toHaveLength(2)
    expect(tags.at(-1)).toBe(FrameTag.Trailer)
  })
  test('E0: 152 frames (76 StateTick + 75 Event + Trailer), 20003 bytes', () => {
    const bytes = det('e0_seed42.det')
    expect(bytes.byteLength).toBe(20003)
    const frames = iterateFrames(bytes)
    expect(frames).toHaveLength(152)
  })
  test('corrupting one payload byte → BadCrc', () => {
    const bytes = det('f0_seed42.det').slice()
    bytes[FILE_HEADER_LEN + 10]! ^= 0xff
    expect(() => iterateFrames(bytes)).toThrow(/BadCrc/) // DecodeError message starts with its code
  })
  test('corrupting magic → BadMagic', () => {
    const bytes = det('f0_seed42.det').slice()
    bytes[0] = 0x58
    expect(() => parseFileHeader(bytes)).toThrow(/BadMagic/)
  })
  test('truncated tail → TruncatedFrame', () => {
    const bytes = det('f0_seed42.det').subarray(0, det('f0_seed42.det').byteLength - 3)
    expect(() => iterateFrames(bytes)).toThrow(DecodeError)
  })
  test('format_version=2 with recomputed header CRC → BadVersion', () => {
    const bytes = det('f0_seed42.det').slice()
    writeU32LE(bytes, 8, 2) // formatVersion field
    writeU32LE(bytes, 20, crc32c(bytes.subarray(0, 20))) // recompute header CRC over the mutated bytes
    expect(() => parseFileHeader(bytes)).toThrow(/BadVersion/)
  })
  test('corrupted header CRC (magic intact) → BadHeaderCrc', () => {
    const bytes = det('f0_seed42.det').slice()
    bytes[20]! ^= 0xff // corrupt stored CRC field directly; magic/version bytes untouched
    expect(() => parseFileHeader(bytes)).toThrow(/BadHeaderCrc/)
  })
  test('first frame tag rewritten to 4 (valid CRC) → UnknownFrameTag', () => {
    const bytes = det('f0_seed42.det').slice()
    const off = FILE_HEADER_LEN
    const len = readU32LE(bytes, off + 1)
    bytes[off] = 4
    const crcOff = off + 5 + len
    writeU32LE(bytes, crcOff, crc32c(bytes.subarray(off, crcOff))) // recompute frame CRC over tag..payload
    expect(() => iterateFrames(bytes)).toThrow(/UnknownFrameTag/)
  })
  test('duplicated trailer frame appended → FrameAfterTrailer', () => {
    const original = det('f0_seed42.det')
    let off = FILE_HEADER_LEN
    let lastOff = off
    while (off < original.byteLength) {
      const len = readU32LE(original, off + 1)
      lastOff = off
      off += 5 + len + 4
    }
    const lastFrame = original.subarray(lastOff, original.byteLength)
    const bytes = new Uint8Array(original.byteLength + lastFrame.byteLength)
    bytes.set(original, 0)
    bytes.set(lastFrame, original.byteLength)
    expect(() => iterateFrames(bytes)).toThrow(/FrameAfterTrailer/)
  })
})
