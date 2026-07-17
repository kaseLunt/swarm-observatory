import { expect, test } from 'vitest'
import { probeStorage, shouldArmZeroClick } from './coldOpen'

// A minimal in-memory Storage stand-in (the node-env runner has no localStorage). `throwing` models a
// denied/private-mode store where every access throws — the denied-store case.
function memStore(): Storage & { size(): number } {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    key: (i) => Array.from(map.keys())[i] ?? null,
    size: () => map.size,
  }
}
const throwingStore = (): Storage => ({
  length: 0,
  clear() { throw new Error('storage denied') },
  getItem() { throw new Error('storage denied') },
  setItem() { throw new Error('storage denied') },
  removeItem() { throw new Error('storage denied') },
  key() { throw new Error('storage denied') },
})

// ── storage-availability probe (read+write, no persisted key) ─────────────────────────────────────
test('probeStorage is TRUE for a working store', () => {
  expect(probeStorage(memStore())).toBe(true)
})
test('probeStorage is FALSE when the store THROWS (private mode / disabled)', () => {
  expect(probeStorage(throwingStore())).toBe(false)
})
test('probeStorage is FALSE when there is no store at all (undefined)', () => {
  expect(probeStorage(undefined)).toBe(false)
})
test('probeStorage leaves NO persisted key behind (the probe key is removed)', () => {
  const store = memStore()
  expect(probeStorage(store)).toBe(true)
  expect(store.size()).toBe(0) // nothing lingers in the store's schema
})
test('probeStorage is FALSE for a write-succeeds/READ-THROWS store — the probe must READ-VERIFY', () => {
  // A store that accepts writes but cannot be read would seed nudgeSeen=false while classifying as usable —
  // re-arming the zero-click on every visit, the exact degradation the probe exists to stop.
  const base = memStore()
  const readThrows: Storage = { ...base, getItem() { throw new Error('read denied') } }
  expect(probeStorage(readThrows)).toBe(false)
})
test('probeStorage is FALSE (not a crash) when the localStorage GETTER itself throws — private-mode reality', () => {
  // Some privacy modes throw on ACCESSING globalThis.localStorage; the store must be resolved inside the
  // try so the caller's render degrades instead of crashing.
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: storage access denied') },
  })
  try {
    expect(probeStorage()).toBe(false)
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
    else delete (globalThis as Record<string, unknown>).localStorage
  }
})

// ── the arming decision: shouldArmZeroClick pins every branch ─────────────────────────────────────
test('arms on a first-visit cold open with a tour, unseen marker, and an available store', () => {
  expect(shouldArmZeroClick('first-visit', true, true, false, true)).toBe(true)
})
test('a first-visit cold open with a DENIED store is SUPPRESSED (never auto-play every visit)', () => {
  // The bug: a throwing store reads as nudgeSeen=false, so without this guard EVERY bare load would arm.
  expect(shouldArmZeroClick('first-visit', true, true, false, false)).toBe(false)
})
test('a first-visit cold open whose marker is already SEEN is suppressed (returning visit is calm)', () => {
  expect(shouldArmZeroClick('first-visit', true, true, true, true)).toBe(false)
})
test('a DEEP LINK (not a cold open) never arms, regardless of scope', () => {
  expect(shouldArmZeroClick('first-visit', false, true, false, true)).toBe(false)
  expect(shouldArmZeroClick('always', false, true, false, true)).toBe(false)
})
test('a run with NO authored tour never arms', () => {
  expect(shouldArmZeroClick('first-visit', true, false, false, true)).toBe(false)
})
test("scope 'off' vetoes the zero-click open entirely", () => {
  expect(shouldArmZeroClick('off', true, true, false, true)).toBe(false)
})
test("scope 'always' ignores BOTH the nudge marker and storage availability (auto-play every cold open)", () => {
  expect(shouldArmZeroClick('always', true, true, true, true)).toBe(true)   // seen marker ignored
  expect(shouldArmZeroClick('always', true, true, false, false)).toBe(true) // storage denial irrelevant
})
