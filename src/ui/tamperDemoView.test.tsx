// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TamperDemoPanel } from './tamperDemoView'
import { ROBUST_F3A } from '../decode/campaignCatalog'
import { requireGlyph } from './voices'
import { useCampaignStore } from '../state/campaignStore'

// ── THE TAMPER MOMENT renders the side-by-side ✗/✓ (a real client mount, DOM only — no WebGL) ──────────
// Mounts the panel, stubs fetch with the REAL seed-42 bytes, clicks the demo, and asserts the two per-pin chains
// paint: the pristine column in the verified voice with an all-agree chain (✓ external pins beside ○ trailer-self
// rings), the tampered column in the mismatch voice with event_hash ✗ + result_id ✗ (bundle sha-256 ✗ too) and the
// untouched fields still in their earned voice. Also pins the honesty rails (the browser-memory-copy copy, the
// untouched store) and the abort guard (the Wall's synchronous abort stops a late demo fetch from writing state after teardown).

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHECK = requireGlyph('verified') // the ✓, from the ONE source (never a literal in the test either)
const CROSS = requireGlyph('mismatch') // the ✗
const RING = requireGlyph('selfConsistent') // the ○ trailer-self ring
const seed42Bytes = (): ArrayBuffer => new Uint8Array(readFileSync('public/campaigns/robust-f3a/42/bundle.det')).buffer

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(seed42Bytes()) } as Response))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useCampaignStore.getState().reset()
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  useCampaignStore.getState().reset()
})

// Find a per-pin row (li) by its key text within a column, and read its class (verified/self/mismatch/unverifiable).
const rowClass = (col: Element, keyLabel: string): string => {
  const li = [...col.querySelectorAll('.tamper-row')].find(el => el.textContent?.includes(keyLabel))
  return li?.className ?? ''
}

describe('TamperDemoPanel: the tamper moment renders the side-by-side refusal', () => {
  test('idle → click flips one byte → the pristine ✓/○ chain paints beside the tampered ✗ cascade', async () => {
    act(() => { root.render(<TamperDemoPanel cat={ROBUST_F3A} />) })
    // IDLE: only the affordance, in the app's voice.
    expect(container.querySelector('.tamper-cta')?.textContent).toContain('flip one byte')
    expect(container.querySelector('.tamper-result')).toBeNull()

    // CLICK — the demo fetches seed 42, verifies pristine, tampers a clone, re-verifies (all async microtasks).
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.tamper-cta')!.click()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    const cols = container.querySelectorAll('.tamper-col')
    expect(cols).toHaveLength(2)
    const [published, flipped] = cols

    // PRISTINE column: the verified voice; NO mismatch. The chain is 3 external ✓ (result_id/case_id/bundle sha-256)
    // beside 4 trailer-self ○ rings (event_hash/state hash/event_count/tick_count) — the honest picture.
    expect(published!.querySelector('.tamper-verdict')?.className).toContain('verified')
    expect(published!.querySelectorAll('.tamper-row.mismatch')).toHaveLength(0)
    expect(published!.querySelectorAll('.tamper-row.verified')).toHaveLength(3)
    expect(published!.querySelectorAll('.tamper-row.self')).toHaveLength(4)
    // both a check and a ring are actually on screen (sourced from voices).
    expect(published!.textContent).toContain(CHECK)
    expect(published!.textContent).toContain(RING)

    // TAMPERED column: the mismatch voice, and the CASCADE — event_hash ✗ → result_id ✗, bundle sha-256 ✗.
    expect(flipped!.querySelector('.tamper-verdict')?.className).toContain('mismatch')
    expect(rowClass(flipped!, 'event_hash')).toContain('mismatch')
    expect(rowClass(flipped!, 'result_id')).toContain('mismatch')
    expect(rowClass(flipped!, 'bundle sha-256')).toContain('mismatch')
    // …and the untouched fields keep their earned voice — case_id ✓, the state hash ○ (surgical, not a blanket fail).
    expect(rowClass(flipped!, 'case_id')).toContain('verified')
    expect(rowClass(flipped!, 'state_trajectory_hash')).toContain('self')
    expect(flipped!.querySelectorAll('.tamper-row.mismatch')).toHaveLength(3)

    // The actual glyphs are on screen (sourced from voices): both ✓ and ✗ appear in the tampered column.
    expect(flipped!.textContent).toContain(CHECK)
    expect(flipped!.textContent).toContain(CROSS)
  })

  test('the honesty copy is present, and the demo touches NO campaign store state (isolation rail)', async () => {
    // Seed a live session BEFORE the demo — the census the Wall shows above must survive untouched.
    useCampaignStore.getState().init(['42', '43'])
    const before = JSON.stringify(useCampaignStore.getState().phase)

    act(() => { root.render(<TamperDemoPanel cat={ROBUST_F3A} />) })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.tamper-cta')!.click()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    // The honesty note states the browser-memory-copy fact and the untouched-published-bundle fact.
    const note = container.querySelector('.tamper-note')?.textContent ?? ''
    expect(note).toMatch(/copy|cloned/i)
    expect(note).toMatch(/published bundle/i)
    expect(note).toMatch(/untouched/i)

    // ISOLATION: the campaign store phase map is byte-for-byte unchanged — no demo verdict leaked into the census.
    expect(JSON.stringify(useCampaignStore.getState().phase)).toBe(before)
    expect(useCampaignStore.getState().rollup.mismatched).toBe(0)
  })

  test('the Wall’s synchronous abort (shared ref) stops a late demo fetch from writing state after teardown', async () => {
    // A controllable fetch that stays pending until we resolve it — the demo is caught mid-fetch.
    let resolveFetch!: (r: Response) => void
    const pending = new Promise<Response>((res) => { resolveFetch = res })
    vi.stubGlobal('fetch', () => pending)
    const errors: unknown[][] = []
    const origError = console.error
    console.error = (...a: unknown[]) => { errors.push(a) }

    // The shared controller ref the Wall owns; the panel registers its controller here so the Wall's stop can abort it.
    const abortRef: { current: AbortController | null } = { current: null }
    act(() => { root.render(<TamperDemoPanel cat={ROBUST_F3A} abortRef={abortRef} />) })

    // Start the demo — the fetch is now in flight (pending), and the controller is registered in the shared ref.
    act(() => { container.querySelector<HTMLButtonElement>('.tamper-cta')!.click() })
    expect(abortRef.current).not.toBeNull()

    // The Wall closes: its SYNCHRONOUS stop aborts the shared ref while the fetch is still in flight.
    act(() => { abortRef.current!.abort() })

    // The fetch resolves LATE (after teardown). The aborted-signal guard swallows it — no 'done' result, no error.
    await act(async () => {
      resolveFetch({ ok: true, arrayBuffer: () => Promise.resolve(seed42Bytes()) } as Response)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    console.error = origError
    expect(container.querySelector('.tamper-result')).toBeNull() // no state write after teardown
    expect(errors, `no post-teardown console error: ${JSON.stringify(errors)}`).toEqual([])
  })
})
