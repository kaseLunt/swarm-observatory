// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Hangar } from './hangarView'
import { isRenderableEntry, type RunEntry } from './useRun'

// The Hangar mounts OUTSIDE the app's error boundary and renders each run's FULL title from the unsigned
// index. A malformed (object-shaped) title must not reach a React child — it would throw ("Objects are not
// valid as a React child") and blank the app the moment the library opens. This renders the card path for
// real (react-dom/client in jsdom — the GateScreen/wallView idiom) and pins the fail-soft: a corrupt title
// degrades to the run id and the card still renders.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => { root.unmount() }); container.remove() })

const noop = () => {}
const renderHangar = (runs: RunEntry[]) => act(() => {
  root.render(
    <Hangar
      open
      runs={runs}
      currentRunId="f4"
      sealedRuns={[]}
      loadedRunId={null}
      loadedResultId={null}
      onClose={noop}
      onOpenRun={noop}
      onOpenTour={noop}
      onOpenWall={noop}
    />,
  )
})

describe('Hangar — a malformed unsigned title cannot blank the library', () => {
  test('an object-shaped title renders as the run id, not a crash', () => {
    // A corrupt index entry: title is an object (blindly cast on load). The card must render, falling back
    // to the id — never throwing, never coercing the object into the plate.
    const bad = { id: 'zzz', title: { evil: true }, base: 'runs/zzz', ticks: 2, kinds: {} } as unknown as RunEntry
    renderHangar([bad])
    const card = container.querySelector('.hangar-card[data-run="zzz"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector('h3')!.textContent).toBe('zzz')     // the id fallback
    expect(container.textContent).not.toContain('[object Object]') // no coerced object on the surface
  })

  test('a valid title renders in full on the plate (unchanged)', () => {
    const ok = { id: 'f4', title: 'F4 comms link (seed 42)', base: 'runs/f4', ticks: 2, kinds: {} } as RunEntry
    renderHangar([ok])
    expect(container.querySelector('.hangar-card[data-run="f4"] h3')!.textContent).toBe('F4 comms link (seed 42)')
  })

  test('structurally-malformed entries are filtered upstream; the Hangar renders only the survivors, and a malformed title alone is KEPT (renders the id)', () => {
    // The presented run list is structurally validated at its source (loadRunIndex → isRenderableEntry); the
    // Hangar consumes the survivors. Object ids, a missing kinds (would crash Object.entries), malformed
    // numerics, and ids the load-plan grammar rejects (an uppercase `F4` clicks to `unknown run`) are OMITTED;
    // a malformed TITLE is presentational and KEPT (fails soft to the id).
    const mixed: unknown[] = [
      { id: 'f4', title: 'F4 comms link (seed 42)', base: 'runs/f4', ticks: 2, kinds: {} }, // valid
      { id: { evil: true }, title: { evil: true } },                                        // object id → omit
      { id: 'nokinds', title: 'x', ticks: 2 },                                              // missing kinds → omit
      { id: 'badticks', title: 'x', ticks: {}, kinds: {} },                                 // malformed ticks → omit
      { id: '  f0  ', title: 'x', ticks: 2, kinds: {} },                                    // padded id → omit
      { id: 'F4', title: 'x', base: 'runs/f4', ticks: 2, kinds: {} },                       // uppercase → grammar rejects → omit
      { id: 'f0', title: { evil: true }, base: 'runs/f0', ticks: 2, kinds: {} },            // malformed title → KEEP, render id
    ]
    renderHangar(mixed.filter(isRenderableEntry))
    expect(container.querySelectorAll('.hangar-card').length).toBe(2)                       // f4 + f0 only
    expect(container.querySelector('.hangar-card[data-run="f4"] h3')!.textContent).toBe('F4 comms link (seed 42)')
    expect(container.querySelector('.hangar-card[data-run="f0"] h3')!.textContent).toBe('f0') // malformed title → id fallback
    expect(container.textContent).not.toContain('[object Object]')
  })
})
