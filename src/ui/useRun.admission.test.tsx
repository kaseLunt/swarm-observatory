// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ── THE BARRIER, PROVED AT THE HOOK (round 4) ────────────────────────────────────────────────────────────────
// gateManifest refusing (proved in manifest.test.ts) is only HALF the story: the production guard is the
// `if (!gate.ok) return` in useRun that short-circuits BEFORE stageDecode. Delete that one `return` and an
// incomplete manifest reaches the decoder, mints manifest-verified, publishes hashes/loadedRunId, and App's seal
// effect fires — yet a gateManifest-only test stays green. This drives useRun ITSELF: the fetch/decode seam is
// stubbed, fetchBundle returns the real f0 manifest with run_complete set per test, and we assert whether the
// decoder is reached. The NEGATIVE case (run_complete=false) is the mutation sentinel — it fails the moment the
// return is removed; the POSITIVE case (run_complete=true) reaches the decoder, proving the sentinel is
// non-vacuous (the spy CAN fire, so its absence in the false case is meaningful, not a dead seam).

// A hoisted holder reachable inside the (hoisted) vi.mock factory: the decode spy + the run_complete each test sets.
const hoisted = vi.hoisted(() => ({ decodeSpy: vi.fn(), runComplete: false as boolean }))
// The real f0 manifest with ONLY outputs.run_complete set to the per-test value — built at fetch time (function
// declarations hoist, so this is safe inside the hoisted mock factory; readFileSync resolves by call time).
function manifestJson(): string {
  const j = JSON.parse(readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8'))
  j.outputs.run_complete = hoisted.runComplete
  return JSON.stringify(j)
}
vi.mock('../source/bundleSource', () => ({
  fetchBundle: vi.fn(async () => ({ det: new ArrayBuffer(8), manifestText: manifestJson() })),
  fetchDet: vi.fn(async () => new ArrayBuffer(8)),
  // The decoder: a SPY. Returns a never-settling promise so the CALL is recorded even though decode never
  // completes — we assert only WHETHER the decoder was reached, which is what the gate governs.
  decodeInWorker: (...args: unknown[]) => { hoisted.decodeSpy(...args); return new Promise<never>(() => {}) },
}))

// Import AFTER the mock is registered (vi.mock is hoisted above imports regardless).
import { useRun } from './useRun'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let hookState: ReturnType<typeof useRun>
function Harness({ runId }: { runId: string }) { hookState = useRun(runId); return null }

async function mountAndSettle(runId: string) {
  await act(async () => { root.render(<Harness runId={runId} />) })
  // Flush the effect's async load chain (fetchBundle → parseManifest → gateManifest → the branch).
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => { hoisted.decodeSpy.mockClear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => { root.unmount() }); container.remove() })

describe('useRun — the admission gate governs whether the decoder is reached', () => {
  test('run_complete=FALSE: refused at the hook — decoder NEVER called, model/hashes/loadedRunId all null (the mutation sentinel)', async () => {
    hoisted.runComplete = false
    await mountAndSettle('f0')

    // THE SENTINEL: remove the `if (!gate.ok) return` in useRun and stageDecode runs → this spy fires → FAIL.
    expect(hoisted.decodeSpy).not.toHaveBeenCalled()
    // The refusal is surfaced on the hook state as the run_complete gate…
    expect(hookState.gate?.ok).toBe(false)
    if (hookState.gate && !hookState.gate.ok) {
      expect(hookState.gate.field).toBe('run_complete')
      expect(hookState.gate.headline).toMatch(/not published/)
    }
    // …and NOTHING downstream of stageDecode was ever produced — no verdict, no seal could exist.
    expect(hookState.model).toBeNull()
    expect(hookState.hashes).toBeNull()
    expect(hookState.loadedRunId).toBeNull()
  })

  test('run_complete=TRUE: admitted — the decoder IS reached (the seam is live, so the sentinel above is non-vacuous)', async () => {
    hoisted.runComplete = true
    await mountAndSettle('f0')

    // The valid run passes the gate and stageDecode calls the decoder — proving the spy CAN fire, so its ABSENCE
    // in the false case is a real signal. (decode never completes in the stub, so the model stays unpublished and
    // the ready-state gate is never set — we assert only that admission LET IT THROUGH to the decoder, which the
    // incomplete run must not.)
    expect(hoisted.decodeSpy).toHaveBeenCalledTimes(1)
    expect(hookState.model).toBeNull() // decode hangs in the stub, so nothing published yet — but the decoder WAS reached
  })
})
