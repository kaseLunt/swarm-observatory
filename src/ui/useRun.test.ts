import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { clampSelection } from './useRun'

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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'f0' }]), { status: 200 }))
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
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'f0' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadRunIndex } = await import('./useRun')
    await expect(loadRunIndex()).rejects.toThrow('fetch runs/index.json: 500') // preserves useRun's exact error
    const idx = await loadRunIndex()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(idx[0]!.id).toBe('f0')
  })
})
