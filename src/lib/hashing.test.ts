import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createDeriveHasher, deriveHash, toHex } from './hashing'

const vectors: { all: { name: string; bytes: string; input?: string; key?: string; context?: string }[] } =
  { all: JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8')) }
const v = (name: string) => vectors.all.find(x => x.name === name)!
const un = (h: string) => Uint8Array.from(h.match(/../g)!.map(b => parseInt(b, 16)))

test('derive_key mode matches official BLAKE3 vector', () => {
  const dk = v('blake3_derive_key_len3')
  expect(toHex(deriveHash(dk.context!, un(dk.input!)))).toBe(dk.bytes)
})
test('incremental derive hasher equals one-shot', () => {
  const dk = v('blake3_derive_key_len3')
  const h = createDeriveHasher(dk.context!)
  h.update(un(dk.input!).subarray(0, 1)); h.update(un(dk.input!).subarray(1))
  expect(toHex(h.digest())).toBe(dk.bytes)
})
