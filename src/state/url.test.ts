import { expect, test } from 'vitest'
import { buildShareUrl, encodeLink, parseLink } from './url'

test('round-trip', () => {
  const s = { run: 'e0', tick: 42, sel: '1:0', ev: 17, speed: 2 }
  expect(parseLink(encodeLink(s))).toEqual(s)
})
test('defaults omitted; malformed ignored', () => {
  expect(encodeLink({ run: 'f0', tick: 0, sel: null, ev: null, speed: 1 })).toBe('run=f0')
  expect(parseLink('run=f0&tick=NaN&ev=-3')).toEqual({ run: 'f0' })
})
test('buildShareUrl joins origin + pathname + encoded state; parses back to the same view', () => {
  // The copy-link share weapon: a full absolute URL that round-trips through the URL grammar. The
  // default-only state collapses to just ?run= (encodeLink omits the defaults) — a clean shareable link.
  expect(buildShareUrl('https://x.dev', '/', { run: 'e0', tick: 0, sel: null, ev: null, speed: 1 }))
    .toBe('https://x.dev/?run=e0')
  const s = { run: 'e0', tick: 37, sel: '1:0', ev: 37, speed: 4 }
  const href = buildShareUrl('https://kaselunt.github.io', '/swarm-observatory/', s)
  expect(href).toBe('https://kaselunt.github.io/swarm-observatory/?run=e0&tick=37&sel=1%3A0&ev=37&speed=4')
  // The tail after '?' round-trips through parseLink — the recipient lands on the exact same view.
  expect(parseLink(href.slice(href.indexOf('?') + 1))).toEqual(s)
})
test('buildShareUrl carries NO verification state — only the view grammar', () => {
  // Structural pin of that rule: the share URL is built solely from LinkState (run/tick/sel/ev/speed).
  // There is no trust/verdict/seal field to leak — a shared link reproduces the VIEW, never a trust claim.
  const url = buildShareUrl('https://x.dev', '/', { run: 'e0', tick: 5, sel: null, ev: null, speed: 1 })
  for (const banned of ['verif', 'seal', 'verdict', 'trust', 'hash', 'matches']) {
    expect(url.toLowerCase()).not.toContain(banned)
  }
})
test('tick/ev floor to integers', () => {
  // tick and ev index discrete arrays — a fractional deep link must not leak a non-integer seq/tick
  // into the store (would break eventAt(n)/setTick assumptions). speed is clamped separately downstream.
  expect(parseLink('tick=1.9')).toEqual({ tick: 1 })
  expect(parseLink('ev=40.5')).toEqual({ ev: 40 })
})
