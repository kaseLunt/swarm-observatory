// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GateScreen } from './GateScreen'
import type { GateResult } from '../decode/manifest'

// The refusal surface, rendered for real (react-dom/client in jsdom — the wallView.test idiom). A manifest that
// fails admission renders ONLY this screen (no verdict, no seal), so the headline it shows must be the honest
// reason. These pin the two refusal families end-to-end at the render: an incomplete run shows its own
// not-published headline; a headline-less (schema/dialect) refusal falls back to the legacy dialect wording.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => { root.unmount() }); container.remove() })
const render = (gate: Extract<GateResult, { ok: false }>) => act(() => { root.render(<GateScreen gate={gate} />) })

describe('GateScreen — the manifest-refusal surface renders the honest reason', () => {
  test('an incomplete run (run_complete=false) renders its custom not-published headline + the offending field', () => {
    render({ ok: false, field: 'run_complete', expected: 'true', actual: 'false', headline: 'this run is not published — its manifest declares the run incomplete' })
    expect(container.querySelector('h1')!.textContent).toBe('this run is not published — its manifest declares the run incomplete')
    expect(container.querySelector('h1')!.textContent).not.toMatch(/newer dialect/) // never the wrong reason
    expect(container.textContent).toContain('run_complete')
    expect(container.textContent).toContain('expected')
    expect(container.querySelector('.screen.gate')).not.toBeNull()
  })
  test('a headline-less refusal (a schema/registry dialect gate) FALLS BACK to the legacy dialect wording', () => {
    render({ ok: false, field: 'state_registry_hash', expected: 'aa…', actual: 'ff…' })
    expect(container.querySelector('h1')!.textContent).toBe('this bundle speaks a newer dialect')
    expect(container.textContent).toContain('state_registry_hash')
  })
})
