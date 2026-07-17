export type DecodeErrorCode =
  | 'BadMagic' | 'BadVersion' | 'BadHeaderCrc' | 'TruncatedFrame' | 'BadCrc'
  | 'UnknownFrameTag' | 'FrameAfterTrailer' | 'InvalidOptionTag' | 'InvalidBool'
  | 'InvalidUtf8' | 'MalformedPayload'

export class DecodeError extends Error {
  readonly code: DecodeErrorCode
  constructor(code: DecodeErrorCode, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'DecodeError'
    this.code = code
  }
}

export class ByteReader {
  private buf: Uint8Array
  private view: DataView
  off = 0
  constructor(buf: Uint8Array) {
    this.buf = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  private need(n: number) {
    if (this.off + n > this.buf.byteLength) throw new DecodeError('MalformedPayload', `need ${n} bytes at offset ${this.off}`)
  }
  u8(): number { this.need(1); return this.view.getUint8(this.off++) }
  u16(): number { this.need(2); const v = this.view.getUint16(this.off, true); this.off += 2; return v }
  u32(): number { this.need(4); const v = this.view.getUint32(this.off, true); this.off += 4; return v }
  u64(): bigint { this.need(8); const v = this.view.getBigUint64(this.off, true); this.off += 8; return v }
  i64(): bigint { this.need(8); const v = this.view.getBigInt64(this.off, true); this.off += 8; return v }
  f64(): number { this.need(8); const v = this.view.getFloat64(this.off, true); this.off += 8; return v }
  bytes(n: number): Uint8Array { this.need(n); const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v }
  utf8(): string {
    const len = this.u32()
    const raw = this.bytes(len)
    try { return new TextDecoder('utf-8', { fatal: true }).decode(raw) }
    catch { throw new DecodeError('InvalidUtf8') }
  }
  bool(): boolean {
    const b = this.u8()
    if (b > 1) throw new DecodeError('InvalidBool', `${b}`)
    return b === 1
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8()
    if (tag === 0) return null
    if (tag === 1) return read()
    throw new DecodeError('InvalidOptionTag', `${tag}`)
  }
  vecF64(): number[] {
    const n = this.u32()
    const needed = n * 8
    if (needed > this.remaining()) throw new DecodeError('MalformedPayload', `vecF64 count ${n} needs ${needed} bytes but only ${this.remaining()} remain`)
    const out = new Array<number>(n)
    for (let i = 0; i < n; i++) out[i] = this.f64()
    return out
  }
  safeU64(): number {
    const v = this.u64()
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new DecodeError('MalformedPayload', `u64 ${v} exceeds safe integer`)
    return Number(v)
  }
  remaining(): number { return this.buf.byteLength - this.off }
}
