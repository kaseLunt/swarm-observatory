import { blake3 } from '@noble/hashes/blake3.js'

export const CTX = {
  EVENT: 'det-event-log/v1',
  STATE: 'det-state-traj/v1',
  RESULT: 'det-result/v1',
} as const

export function createDeriveHasher(ctx: string) {
  const h = blake3.create({ context: new TextEncoder().encode(ctx) })
  return {
    update: (b: Uint8Array) => { h.update(b) },
    digest: () => h.digest(),
  }
}
export const deriveHash = (ctx: string, data: Uint8Array): Uint8Array => {
  const h = createDeriveHasher(ctx)
  h.update(data)
  return h.digest()
}
export const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
