import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { clampSelection, isRenderableEntry } from './useRun'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)
const f0 = new RunModel(decodeBundle(load('f0_seed42.det')), null)

// clampSelection is the pure consumer-seam invariant behind useRun's enforceSelectionInvariant:
// parseLink can't validate ev/sel against a model that doesn't exist yet at parse time (C1), so the
// clamp has to happen here, once a model is actually loaded, before it is ever handed to chain code
// (causalChain → childrenOf(seq) spreads undefined for an out-of-range seq and throws).
describe('clampSelection (pure invariant: a deep-linked selection vs a loaded model)', () => {
  test('an out-of-range deep-link event (ev=9999 on E0, eventCount=75) clamps to null and never throws', () => {
    expect(() => clampSelection(e0, null, 9999)).not.toThrow()
    expect(clampSelection(e0, null, 9999)).toEqual({ entity: null, event: null })
  })
  test('an in-range event seq passes through unchanged', () => {
    expect(clampSelection(e0, null, 40)).toEqual({ entity: null, event: 40 })
  })
  test('an entity key this model never decodes (stale from a prior run/deep-link) clamps to null', () => {
    expect(clampSelection(f0, '9:not-real', null)).toEqual({ entity: null, event: null })
  })
  test('an entity key the model DOES decode passes through unchanged', () => {
    expect(clampSelection(f0, '1:0', null)).toEqual({ entity: '1:0', event: null })
  })
})

// loadRunIndex is the single-fetch seam: App (the run switcher) and useRun (entry
// lookup) both needed runs/index.json and each fetched it independently — two network requests for one
// static file on every cold load. The shared memoized loader collapses that to ONE fetch while keeping
// both call sites' behavior. Each test resets the module registry so the module-level cache starts fresh,
// and stubs global fetch — loadRunIndex reads fetch at call time, so the stub is what it sees.
describe('loadRunIndex (App + useRun share ONE runs/index.json fetch)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  test('concurrent callers resolve from a single network fetch', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'f0', kinds: {}, ticks: 2 }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadRunIndex } = await import('./useRun')
    const [a, b] = await Promise.all([loadRunIndex(), loadRunIndex()])
    expect(fetchMock).toHaveBeenCalledTimes(1) // the duplicate fetch is gone
    expect(a).toBe(b)                           // both consumers observe the same cached array
    expect(a[0]!.id).toBe('f0')
  })

  test('a failed load is NOT cached — a later call refetches (useRun keeps its retry-on-switch)', async () => {
    vi.resetModules()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'f0', kinds: {}, ticks: 2 }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadRunIndex } = await import('./useRun')
    await expect(loadRunIndex()).rejects.toThrow('fetch runs/index.json: 500') // preserves useRun's exact error
    const idx = await loadRunIndex()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(idx[0]!.id).toBe('f0')
  })
})

// runs/index.json is UNSIGNED and blindly shaped; the switcher and the Hangar card mount outside the error
// boundary, so a malformed STRUCTURAL field would crash a render or mis-navigate. isRenderableEntry validates
// every field a renderer dereferences (id/kinds/ticks/dtUs/detOnly) and omits an entry failing ANY of them;
// PRESENTATIONAL strings (title, supersedesPlanId) stay fail-soft and never omit a usable entry.
const complete = { id: 'f4', title: 'F4 comms link (seed 42)', base: 'runs/f4', ticks: 96, kinds: { '5': 32 } }
describe('isRenderableEntry (structural fields validate; presentational strings stay fail-soft)', () => {
  test('accepts a fully-shaped entry', () => {
    expect(isRenderableEntry(complete)).toBe(true)
    expect(isRenderableEntry({ id: 'f0', ticks: 2, kinds: {}, dtUs: 1000, detOnly: true })).toBe(true)
  })
  test('a malformed TITLE alone is KEPT (presentational — fail-soft, never omitted)', () => {
    expect(isRenderableEntry({ ...complete, title: { evil: true } })).toBe(true)
    expect(isRenderableEntry({ ...complete, title: undefined })).toBe(true)
  })
  test('omits a non-string / non-trimmed / blank id (object id, object id + object title, padded, empty, whitespace, missing)', () => {
    expect(isRenderableEntry({ ...complete, id: { evil: true }, title: { evil: true } })).toBe(false)
    expect(isRenderableEntry({ ...complete, id: { evil: true } })).toBe(false)
    expect(isRenderableEntry({ ...complete, id: ' f4 ' })).toBe(false) // padded — the load-plan grammar rejects it downstream
    expect(isRenderableEntry({ ...complete, id: '' })).toBe(false)
    expect(isRenderableEntry({ ...complete, id: '   ' })).toBe(false)
    expect(isRenderableEntry({ id: 'f4' })).toBe(false)                 // missing kinds/ticks
    expect(isRenderableEntry(null)).toBe(false)
    expect(isRenderableEntry('f4')).toBe(false)
  })
  test('omits an id the load-plan grammar or prototype denylist rejects (uppercase, path/traversal, prototype-shaped)', () => {
    // "Renderable" means ACTIONABLE, and resolveLoadPlan is the definition — each of these clicks to `unknown run`.
    expect(isRenderableEntry({ ...complete, id: 'F4' })).toBe(false)          // uppercase — outside the lowercase grammar
    expect(isRenderableEntry({ ...complete, id: 'x/../f0' })).toBe(false)     // path traversal
    expect(isRenderableEntry({ ...complete, id: 'runs/f0' })).toBe(false)     // slash — a multi-segment path
    expect(isRenderableEntry({ ...complete, id: 'constructor' })).toBe(false) // prototype denylist (grammar-conforming but denied)
    expect(isRenderableEntry({ ...complete, id: '__proto__' })).toBe(false)   // prototype-shaped
  })
  test('omits a malformed kinds (missing, null, non-object, or a non-number count)', () => {
    expect(isRenderableEntry({ ...complete, kinds: undefined })).toBe(false)
    expect(isRenderableEntry({ ...complete, kinds: null })).toBe(false)
    expect(isRenderableEntry({ ...complete, kinds: 'nope' })).toBe(false)
    expect(isRenderableEntry({ ...complete, kinds: { '5': 'x' } })).toBe(false)
  })
  test('omits a malformed ticks / dtUs / detOnly (structural numerics + the clock boolean)', () => {
    expect(isRenderableEntry({ ...complete, ticks: 'nope' })).toBe(false)
    expect(isRenderableEntry({ ...complete, ticks: undefined })).toBe(false)
    expect(isRenderableEntry({ ...complete, dtUs: 'nope' })).toBe(false) // present but not a number
    expect(isRenderableEntry({ ...complete, detOnly: 'true' })).toBe(false)
  })
})

describe('loadRunIndex omits unrenderable entries (the presented run list is structurally validated)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
  test('a mixed index keeps only the structurally-valid entries (title malformation kept), in order', async () => {
    vi.resetModules()
    const mixed = [
      { id: 'f4', title: 'F4 comms link (seed 42)', ticks: 96, kinds: { '5': 32 } },
      { id: { evil: true }, title: { evil: true } },        // object id + object title
      { id: ' f4 ', title: 'x', ticks: 96, kinds: {} },     // padded id → the grammar rejects it
      { id: 'F4', title: 'x', ticks: 96, kinds: {} },       // uppercase → clicks to `unknown run`
      { id: 'x/../f0', title: 'x', ticks: 96, kinds: {} },  // path traversal → rejected
      { id: 'constructor', title: 'x', ticks: 96, kinds: {} }, // prototype-denied
      { id: 'bad', title: 'x', ticks: 96 },                 // missing kinds → Hangar would crash
      { id: 'f0', title: { evil: true }, ticks: 2, kinds: {} }, // malformed TITLE but otherwise valid → KEPT (renders id)
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(mixed), { status: 200 })))
    const { loadRunIndex } = await import('./useRun')
    const idx = await loadRunIndex()
    expect(idx.map(e => e.id)).toEqual(['f4', 'f0']) // f4 (valid) + f0 (valid structure, malformed title survives)
  })
})
