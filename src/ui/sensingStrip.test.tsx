// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildSensingStage, sensingRegister, revealedDraw, type SensingDraw, type SensingStageData } from './sensingStage'
import { SensingStrip, SensingLiveStrip } from './sensingStrip'
import { Inspector } from './Inspector'
import { useViewStore } from '../state/viewStore'
import { markClass, requireGlyph } from './voices'
import { asEventTick } from '../lib/brand'

const VERDICT_MARKS = ['verified', 'selfConsistent', 'attested', 'mismatch'] as const

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// f2a is a dir fixture — the same loader the sensing tests use.
function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const model = new RunModel(decodeBundle(detFixture('f2a_seed42')), null)
const reg = sensingRegister(buildSensingStage(model))

const synthDraw = (tick: number): SensingDraw => ({
  seq: tick, tick, subject: '1:0', sensor: '0',
  inRange: true, inFov: true, losClear: true, eligible: true, tiebreak: false, g: [0, 0, 0],
})

// ── THE LIVE REGISTER FOLLOWS THE PLAYHEAD (pure, over the real f2a verdicts) ──────────────────────────────
// The strip was fed a SELECTED verdict, so it went dark on free playback. revealedDraw makes what-is-shown a
// pure function of the playhead: the verdict the playhead has REACHED, re-derived on every move — so a scrub
// back reduces the register rather than leaving a sticky reveal.
describe('revealedDraw — the live register tracks the playhead over the real f2a sequence', () => {
  test('mid-run: the playhead reveals exactly the verdict at the current tick (the prefix latest)', () => {
    for (const t of [0, 1, 30, 55, 95]) {
      expect(revealedDraw(reg, asEventTick(t))!.tick).toBe(t) // f2a is one verdict per tick 0..95
    }
  })

  test('full reveal: an end-of-run playhead shows the terminal verdict (tick 95, the register\'s last)', () => {
    expect(revealedDraw(reg, asEventTick(model.tickCount))!.tick).toBe(95) // tickCount 96, last verdict tick 95
    expect(revealedDraw(reg, asEventTick(95))).toBe(reg.ordered.at(-1))     // the very object the register holds
  })

  test('scrub-back reduces the register — no sticky reveal (a pure function of the playhead)', () => {
    const forward = revealedDraw(reg, asEventTick(60))!
    expect(forward.tick).toBe(60)
    const back = revealedDraw(reg, asEventTick(30))!
    expect(back.tick).toBe(30)          // scrubbing back to 30 shows the tick-30 verdict…
    expect(back).not.toBe(forward)      // …never the stale tick-60 one the forward pass reached
  })

  test('before the first verdict nothing is revealed — the honest empty, never a fabricated verdict', () => {
    // f2a's first verdict is at tick 0, so build the before-first case from a synthetic sequence starting at 5.
    const synth = sensingRegister({ draws: [synthDraw(5), synthDraw(6)] } as unknown as SensingStageData)
    expect(revealedDraw(synth, asEventTick(4))).toBeNull()
    expect(revealedDraw(synth, asEventTick(5))!.tick).toBe(5)
  })
})

// ── THE STRIP RETROFIT (DOM) — WHAT is drawn is unchanged; only WHEN it appears follows the playhead ───────
describe('SensingLiveStrip — full-reveal identity + the playhead drives the drawn verdict', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const renderToHtml = (node: ReactElement): string => {
    const c = document.createElement('div')
    const r = createRoot(c)
    act(() => r.render(node))
    const html = c.innerHTML
    act(() => r.unmount())
    return html
  }

  test('at full reveal the live strip renders BYTE-IDENTICAL to selecting the terminal verdict (WHAT is unchanged)', () => {
    act(() => root.render(<SensingLiveStrip reg={reg} tick={model.tickCount} />))
    // The prior rendering of that same verdict — the bare SensingStrip fed the terminal draw (the detail path).
    const selectedHtml = renderToHtml(<SensingStrip draw={reg.ordered.at(-1)!} />)
    expect(container.innerHTML).toBe(selectedHtml)
  })

  test('the drawn verdict follows the playhead; a scrub back re-draws the earlier one (live register, no sticky)', () => {
    act(() => root.render(<SensingLiveStrip reg={reg} tick={60} />))
    const at60 = container.innerHTML
    act(() => root.render(<SensingLiveStrip reg={reg} tick={30} />))
    const at30 = container.innerHTML
    expect(at30).not.toBe(at60)                                                 // the drawn content followed the playhead…
    expect(at30).toBe(renderToHtml(<SensingStrip draw={revealedDraw(reg, asEventTick(30))!} />)) // …and matches tick 30, not the sticky tick-60 verdict
  })

  test('before the first verdict the strip shows the dim NOT-YET state — never a blank, never a verdict mark', () => {
    const synth = sensingRegister({ draws: [synthDraw(5), synthDraw(6)] } as unknown as SensingStageData)
    act(() => root.render(<SensingLiveStrip reg={synth} tick={4} />))
    const pending = container.querySelector('.sensing-pending')
    expect(pending, 'a pre-verdict state stands in, not a blank').not.toBeNull()
    expect(container.querySelector('.sensing-strip'), 'no gate table yet').toBeNull()
    // the NOT-YET voice: the dim no-verdict family class, and NONE of the four verdict glyphs
    expect(pending!.className).toContain(markClass('notYet'))
    for (const m of VERDICT_MARKS) expect(pending!.textContent).not.toContain(requireGlyph(m))
    // reaching the first verdict fills the gate table in and retires the pending line
    act(() => root.render(<SensingLiveStrip reg={synth} tick={5} />))
    expect(container.querySelector('.sensing-strip')).not.toBeNull()
    expect(container.querySelector('.sensing-pending')).toBeNull()
  })
})

// ── THE INSPECTOR GATE — the two modes (live vs detail) and the pre-verdict state, driven by the store ─────
// The f2a tour holds a sensing selection (#99, tick 48) while its play beats advance the playhead — so a
// running tour must let the LIVE strip own the aside and track the playhead, never freeze on the held verdict.
// Outside a tour, a user-held selection still pins the detail strip. And a run whose first verdict is at tick 5
// must speak a dim pre-verdict state at ticks 0-4 (and on a scrub back past it), never a blank aside.
describe('Inspector — live strip owns the tour flight; a held selection pins detail; the pre-verdict state speaks', () => {
  let container: HTMLDivElement
  let root: Root
  const resetStore = () => useViewStore.setState({ selectedEntity: null, selectedEvent: null, tick: 0, fraction: 0, playing: false })
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); resetStore() })
  afterEach(() => { act(() => root.unmount()); container.remove(); resetStore() })

  const strips = (): NodeListOf<Element> => container.querySelectorAll('.sensing-strip')
  // The `.sensing-strip` element a bare SensingStrip renders for a draw — the reference for "what a verdict draws".
  const stripOuter = (draw: SensingDraw): string => {
    const c = document.createElement('div')
    const r = createRoot(c)
    act(() => r.render(<SensingStrip draw={draw} />))
    const html = c.querySelector('.sensing-strip')!.outerHTML
    act(() => r.unmount())
    return html
  }
  const draw99 = buildSensingStage(model).draws[99]! // the f2a tour's held selection

  test('the f2a tour selects a kind-22 verdict at tick 48 (#99) — the setup the fix defends', () => {
    expect(draw99).not.toBeNull()
    expect(draw99.tick).toBe(48)
  })

  test('during a tour the live strip OWNS the aside and tracks the playhead; the detail strip is suppressed', () => {
    // The tour holds selection #99 (tick 48) while its play beats advance the playhead to 56/67/82.
    useViewStore.setState({ selectedEntity: '1:0', selectedEvent: 99, tick: 48, fraction: 0, playing: false })
    act(() => root.render(<Inspector model={model} tourActive={true} />))
    expect(container.textContent, 'EventDetail still mounts its detail table').toContain('event #99')
    for (const t of [56, 67, 82]) {
      act(() => useViewStore.getState().setTick(t))
      expect(strips().length, `exactly one strip at tick ${t} — the detail strip is suppressed`).toBe(1)
      const current = revealedDraw(reg, asEventTick(t))!
      expect(current.tick).toBe(t)
      expect(strips()[0]!.outerHTML, `the strip tracks tick ${t}`).toBe(stripOuter(current))
      expect(strips()[0]!.outerHTML, `never the frozen tick-48 selection`).not.toBe(stripOuter(draw99))
    }
  })

  test('OUTSIDE a tour a held sensing verdict pins EventDetail — the strip does NOT track the playhead', () => {
    useViewStore.setState({ selectedEntity: '1:0', selectedEvent: 99, tick: 48, fraction: 0, playing: false })
    act(() => root.render(<Inspector model={model} tourActive={false} />))
    expect(strips().length).toBe(1)
    expect(strips()[0]!.outerHTML).toBe(stripOuter(draw99)) // pinned to #99 (tick 48)
    act(() => useViewStore.getState().setTick(67))          // advance the playhead…
    expect(strips().length).toBe(1)
    expect(strips()[0]!.outerHTML, 'a held selection is the point of selecting — it stays pinned').toBe(stripOuter(draw99))
  })

  // A minimal model whose sensing sequence starts at tick `firstTick` — for the pre-first-verdict aside (no real
  // fixture has a first sensing verdict after tick 0). Positioned (entityKeys non-empty) so queryStageApplies
  // short-circuits; buildSensingStage reads eventCount/ticks/tickCount/eligibilityAt/detectionAt/entityStatesAt.
  const fakeModel = (firstTick: number): RunModel => {
    const elig = { subject: 0, sensor: 0, inRange: true, inFov: true, losClear: true, eligible: true, tiebreakApplied: false }
    return {
      eventCount: 2, tickCount: firstTick + 3, ticks: [firstTick, firstTick + 1],
      entityKeys: () => ['1:0'], kindAt: () => -1,
      eligibilityAt: (seq: number) => (seq === 0 || seq === 1 ? elig : null),
      detectionAt: () => null, entityStatesAt: () => new Map(),
    } as unknown as RunModel
  }

  test('before the first verdict the aside speaks the dim NOT-YET state — never a blank, never the idle rail', () => {
    resetStore() // initial playhead at tick 0, no selection
    act(() => root.render(<Inspector model={fakeModel(5)} />))
    const pending = container.querySelector('.sensing-pending')
    expect(pending, 'the aside is NOT blank — a pre-verdict line stands in').not.toBeNull()
    expect(container.querySelector('.sensing-strip'), 'no gate table before tick 5').toBeNull()
    expect(container.querySelector('.inspector-empty'), 'the idle rail is suppressed on a sensing run').toBeNull()
    expect(pending!.className).toContain(markClass('notYet')) // the dim no-verdict voice…
    for (const m of VERDICT_MARKS) expect(pending!.textContent).not.toContain(requireGlyph(m)) // …never a verdict mark
  })

  test('scrubbed back past the first verdict, the aside returns to the dim NOT-YET state (no sticky strip)', () => {
    useViewStore.setState({ selectedEntity: null, selectedEvent: null, tick: 6, fraction: 0, playing: false })
    act(() => root.render(<Inspector model={fakeModel(5)} />))
    expect(container.querySelector('.sensing-strip'), 'a verdict is revealed at tick 6').not.toBeNull()
    act(() => useViewStore.getState().setTick(3)) // scrub back before the first verdict
    expect(container.querySelector('.sensing-strip'), 'scrub-back retires the strip').toBeNull()
    expect(container.querySelector('.sensing-pending'), 'scrub-back shows the pre-verdict state, not a blank').not.toBeNull()
  })
})
