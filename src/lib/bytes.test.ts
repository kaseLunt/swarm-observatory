import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ByteReader, DecodeError } from './bytes'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const hex = (name: string) => {
  const v = vectors.find(v => v.name === name)
  if (!v) throw new Error(`missing vector ${name}`)
  return Uint8Array.from(v.bytes.match(/../g)!.map(b => parseInt(b, 16)))
}

describe('ByteReader against f0_primitives vectors', () => {
  test('scalars', () => {
    expect(new ByteReader(hex('u8_max')).u8()).toBe(0xff)
    expect(new ByteReader(hex('u16_max')).u16()).toBe(0xffff)
    expect(new ByteReader(hex('u32_max')).u32()).toBe(0xffffffff)
    expect(new ByteReader(hex('u64_max')).u64()).toBe(0xffffffffffffffffn)
    expect(new ByteReader(hex('f64_1p5')).f64()).toBe(1.5)
    expect(new ByteReader(hex('f64_pos_zero')).f64()).toBe(0)
  })
  test('utf8 length-prefixed', () => {
    expect(new ByteReader(hex('utf8_f0')).utf8()).toBe('f0')
    expect(new ByteReader(hex('utf8_empty')).utf8()).toBe('')
  })
  test('option', () => {
    const r0 = new ByteReader(hex('option_none'))
    expect(r0.option(() => r0.u64())).toBeNull()
    const r1 = new ByteReader(hex('option_some_u64_7'))
    expect(r1.option(() => r1.u64())).toBe(7n)
  })
  test('enum tag is u16 LE', () => {
    expect(new ByteReader(hex('enum_eventkind_f0fixture_u16')).u16()).toBe(0xf000)
  })
  test('out-of-bounds throws MalformedPayload', () => {
    const r = new ByteReader(new Uint8Array([1]))
    expect(() => r.u32()).toThrowError(DecodeError)
  })
  test('safeU64 rejects > 2^53', () => {
    expect(() => new ByteReader(hex('u64_max')).safeU64()).toThrow()
  })
  test('vecF64 validates declared count against remaining bytes before allocating', () => {
    const r = new ByteReader(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    expect(() => r.vecF64()).toThrowError(/4294967295/)
  })
})
