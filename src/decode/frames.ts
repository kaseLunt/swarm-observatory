import { ByteReader, DecodeError } from '../lib/bytes'
import { crc32c } from '../lib/crc32c'

export const FILE_HEADER_LEN = 24
const MAGIC = 'DETBNDL1'
export const FrameTag = { Event: 1, StateTick: 2, Trailer: 3 } as const

export interface FileHeader { formatVersion: number; eventSchemaVersion: number; stateSchemaVersion: number }
export interface RawFrame { tag: number; payload: Uint8Array }

export function parseFileHeader(bytes: Uint8Array): FileHeader {
  if (bytes.byteLength < FILE_HEADER_LEN) throw new DecodeError('TruncatedFrame', 'header')
  const r = new ByteReader(bytes)
  const magic = new TextDecoder().decode(r.bytes(8))
  if (magic !== MAGIC) throw new DecodeError('BadMagic', magic)
  const formatVersion = r.u32()
  const eventSchemaVersion = r.u32()
  const stateSchemaVersion = r.u32()
  const storedCrc = r.u32()
  if (crc32c(bytes.subarray(0, 20)) !== storedCrc) throw new DecodeError('BadHeaderCrc')
  if (formatVersion !== 1) throw new DecodeError('BadVersion', `format ${formatVersion}`)
  return { formatVersion, eventSchemaVersion, stateSchemaVersion }
}

export function iterateFrames(bytes: Uint8Array): RawFrame[] {
  parseFileHeader(bytes)
  const frames: RawFrame[] = []
  let off = FILE_HEADER_LEN
  let sawTrailer = false
  while (off < bytes.byteLength) {
    if (sawTrailer) throw new DecodeError('FrameAfterTrailer')
    if (off + 5 > bytes.byteLength) throw new DecodeError('TruncatedFrame', `frame header at ${off}`)
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (off + 5 + len + 4 > bytes.byteLength) throw new DecodeError('TruncatedFrame', `payload at ${off}`)
    const payload = bytes.subarray(off + 5, off + 5 + len)
    const stored = new DataView(bytes.buffer, bytes.byteOffset + off + 5 + len, 4).getUint32(0, true)
    if (crc32c(bytes.subarray(off, off + 5 + len)) !== stored) throw new DecodeError('BadCrc', `frame at ${off}`)
    if (tag !== FrameTag.Event && tag !== FrameTag.StateTick && tag !== FrameTag.Trailer)
      throw new DecodeError('UnknownFrameTag', `${tag}`)
    if (tag === FrameTag.Trailer) sawTrailer = true
    frames.push({ tag, payload })
    off += 5 + len + 4
  }
  if (!sawTrailer) throw new DecodeError('TruncatedFrame', 'no trailer')
  return frames
}
