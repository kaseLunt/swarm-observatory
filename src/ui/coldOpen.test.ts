import { describe, expect, test } from 'vitest'
import { probeStorage, shouldArmZeroClick, autoArmMemoryAllows, bareRunDeepLink, bareLinkTourToArm } from './coldOpen'

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

// ── the SHARED tour-dismissal memory gate (both auto-arm surfaces read the same rule) ──────────────
describe('autoArmMemoryAllows — the one memory rule the cold open and the bare deep link share', () => {
  test("'off' vetoes an auto-arm regardless of the marker or storage", () => {
    expect(autoArmMemoryAllows('off', false, true)).toBe(false)
    expect(autoArmMemoryAllows('off', false, false)).toBe(false)
  })
  test("'first-visit' permits only an UNSEEN marker on an AVAILABLE store", () => {
    expect(autoArmMemoryAllows('first-visit', false, true)).toBe(true)   // fresh visit, store works → arm
    expect(autoArmMemoryAllows('first-visit', true, true)).toBe(false)   // marker SEEN → returning visitor, no re-arm
    expect(autoArmMemoryAllows('first-visit', false, false)).toBe(false) // denied store cannot retire the marker → suppress
  })
  test("'always' ignores both the marker and storage", () => {
    expect(autoArmMemoryAllows('always', true, false)).toBe(true)
    expect(autoArmMemoryAllows('always', false, true)).toBe(true)
  })
})

// ── the BARE-link classifier: run-and-nothing-else, every other combination is a shared view ────────
describe('bareRunDeepLink — a run param and NOTHING else is bare; any extra state is a shared view', () => {
  test('a lone run param is bare — the run id is returned', () => {
    expect(bareRunDeepLink('?run=f4')).toBe('f4')
    expect(bareRunDeepLink('run=f4')).toBe('f4')       // a missing leading '?' is tolerated
    expect(bareRunDeepLink('?run=f3a')).toBe('f3a')
  })
  test('the empty query (the bare ROOT) is NOT a bare run link — it names no run', () => {
    expect(bareRunDeepLink('')).toBeNull()
    expect(bareRunDeepLink('?')).toBeNull()
  })
  test('an empty run value is not a run link', () => {
    expect(bareRunDeepLink('?run=')).toBeNull()
  })
  test('ANY additional state param makes it a shared view, never bare — in EITHER order', () => {
    for (const qs of [
      '?run=f4&tick=12', '?tick=12&run=f4',   // a precise tick
      '?run=f4&sel=1:0', '?run=f4&ev=30',      // a selection / an event
      '?run=f4&speed=4',                        // a transport speed
      '?run=f4&capture=30',                     // the capture entry point
      '?run=f4&foo=1',                          // an unknown param is still extra state
    ]) expect(bareRunDeepLink(qs), qs).toBeNull()
  })
  test('a repeated run= is not a clean single-run link', () => {
    expect(bareRunDeepLink('?run=f4&run=e0')).toBeNull()
  })
})

// ── the bare-link ARM decision: names a bare run + a tour EXISTS + the memory permits ───────────────
describe('bareLinkTourToArm — park a bare run tour iff it exists AND the memory permits (admission is the arrival machine\'s)', () => {
  test('a bare run with a tour on a fresh first visit → park that run', () => {
    expect(bareLinkTourToArm('f4', true, 'first-visit', false, true)).toBe('f4')
  })
  test('no bare run (a state-bearing or root load classified to null) → park nothing', () => {
    expect(bareLinkTourToArm(null, false, 'first-visit', false, true)).toBeNull()
  })
  test('a bare run with NO authored tour → park nothing (f0 keeps today\'s behavior)', () => {
    expect(bareLinkTourToArm('f0', false, 'first-visit', false, true)).toBeNull()
  })
  test('a RETURNING visitor (marker seen) is not re-armed by a bare link', () => {
    expect(bareLinkTourToArm('f4', true, 'first-visit', true, true)).toBeNull()
  })
  test('a denied store suppresses the bare-link auto-arm (cannot retire the marker) under first-visit', () => {
    expect(bareLinkTourToArm('f4', true, 'first-visit', false, false)).toBeNull()
  })
  test("scope 'off' vetoes the bare-link auto-arm; 'always' arms every visit", () => {
    expect(bareLinkTourToArm('f4', true, 'off', false, true)).toBeNull()
    expect(bareLinkTourToArm('f4', true, 'always', true, false)).toBe('f4') // marker + storage irrelevant under 'always'
  })
})
