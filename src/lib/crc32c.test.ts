import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { crc32c } from './crc32c'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const hex = (name: string) => Uint8Array.from(vectors.find(v => v.name === name)!.bytes.match(/../g)!.map(b => parseInt(b, 16)))

test('RFC 3720 check value', () => {
  expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe3069283)
})
test('file_header vector: trailing u32 is CRC of first 20 bytes', () => {
  const h = hex('file_header')
  const stored = new DataView(h.buffer, h.byteOffset).getUint32(20, true)
  expect(crc32c(h.subarray(0, 20))).toBe(stored)
})
for (const name of ['frame_event_example', 'frame_statetick_example', 'frame_trailer_example']) {
  test(`${name}: trailing u32 is CRC of tag++len++payload`, () => {
    const f = hex(name)
    const stored = new DataView(f.buffer, f.byteOffset).getUint32(f.byteLength - 4, true)
    expect(crc32c(f.subarray(0, f.byteLength - 4))).toBe(stored)
  })
}
