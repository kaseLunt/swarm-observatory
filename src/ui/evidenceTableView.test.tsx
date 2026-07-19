// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EvidenceTable } from './evidenceTableView'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'

// THE VIEW, rendered for real (react-dom/client in jsdom — the GateScreen/ProvenancePanel idiom). The pure
// row/sort/filter/scope model is exhaustively pinned in evidenceTable.test.ts; THIS proves the visible
// carriers reach the DOM: the provenance line, the two scope labels, the kind chips, the rows, and that a
// row click routes through the ONE select path (onSelect).
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function detFixture(name: string): ArrayBuffer {
  try {
    const b = readFileSync(`contract/fixtures/${name}.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } catch {
    const base = `contract/fixtures/${name}`
    const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
    const b = readFileSync(`${base}/${dir}/bundle.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
}
const model = new RunModel(decodeBundle(detFixture('f4_seed42')), null) // 64 events: 32 sent / 31 delivered / 1 dropped
const dropSeq = (() => { for (let i = 0; i < model.eventCount; i++) if (model.kindAt(i) === 7) return i; return -1 })()

let container: HTMLDivElement
let root: Root
let picked: number | null
let closed: boolean

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  picked = null
  closed = false
  useViewStore.setState({ tick: 0, selectedEvent: null })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(
    <EvidenceTable open model={model} onSelect={(s) => { picked = s }} onClose={() => { closed = true }} />,
  ))
}
const rowsInDom = () => container.querySelectorAll('tbody tr.evidence-row')
const countText = () => container.querySelector('[data-evidence-count]')?.textContent ?? ''
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click() })

test('renders the provenance line, both scope labels, the kind chips, and every event as a row', () => {
  render()
  expect(container.querySelector('.evidence-panel')?.getAttribute('role')).toBe('dialog')
  expect(container.querySelector('.evidence-provenance')?.textContent).toBe('every row decoded from the bundle in your browser')
  // both scope options are LABELED with their populations (the honesty rule: every count names its scope)
  const scope = container.querySelector('.evidence-scope')!
  expect(scope.textContent).toContain('whole run · 64 events')
  expect(scope.textContent).toContain('revealed so far · 0 of 64') // playhead at tick 0
  // kind chips name each kind and its true count
  const chips = [...container.querySelectorAll('.evidence-kind-chip')].map(c => c.textContent)
  expect(chips).toEqual(['MessageSent · 32', 'MessageDelivered · 31', 'MessageDropped · 1'])
  // every event is a row (whole-run default); the count readout names the population
  expect(rowsInDom().length).toBe(64)
  expect(countText()).toBe('64 events')
})

test('the drop row shows its decoded fields (msg 14, reason 3, jam_state 0)', () => {
  render()
  const row = container.querySelector(`tr[data-seq="${dropSeq}"]`)!
  expect(row.querySelector('.evidence-kind')?.textContent).toContain('MessageDropped')
  const payload = row.querySelector('.evidence-payload')!.textContent ?? ''
  expect(payload).toContain('msg=14')
  expect(payload).toContain('reason=3')
  expect(payload).toContain('jam_state=0')
})

test('clicking a row routes through the ONE select path (onSelect fires with the row’s seq)', () => {
  render()
  click(container.querySelector(`tr[data-seq="${dropSeq}"]`))
  expect(picked).toBe(dropSeq)
})

test('the kind chip filter narrows to the selected kind, and the readout names both populations', () => {
  render()
  click(container.querySelector('.evidence-kind-chip[data-kind="7"]'))
  expect(rowsInDom().length).toBe(1)
  expect(rowsInDom()[0]!.getAttribute('data-seq')).toBe(String(dropSeq))
  expect(countText()).toBe('64 events · 1 shown') // filter state visible
})

test('the revealed-so-far scope toggle relabels and truncates to the playhead prefix', () => {
  useViewStore.setState({ tick: 30 }) // just at the loss
  render()
  const revealedExpected = model.tickCount // placeholder overwritten below
  // compute the true revealed prefix from the model's own event ticks (tick ≤ 30)
  let byTick = 0
  for (let i = 0; i < model.eventCount; i++) if (model.ticks[i]! <= 30) byTick++
  expect(revealedExpected).toBeGreaterThan(0) // sanity that the model loaded
  // click the revealed-so-far scope option
  const revealedBtn = [...container.querySelectorAll('.evidence-scope-btn')].find(b => b.textContent?.startsWith('revealed so far'))!
  expect(revealedBtn.textContent).toBe(`revealed so far · ${byTick} of 64`)
  click(revealedBtn)
  expect(rowsInDom().length).toBe(byTick)         // only the revealed prefix
  expect(countText()).toBe(`${byTick} events`)    // scope base is the revealed population
})

test('the close affordance calls onClose', () => {
  render()
  click(container.querySelector('.evidence-close'))
  expect(closed).toBe(true)
})

const chipTexts = () => [...container.querySelectorAll('.evidence-kind-chip')].map(c => c.textContent)

test('the kind chips OBEY the active scope — revealed-so-far shows only the revealed per-kind counts (no spoiler)', () => {
  useViewStore.setState({ tick: 30 })
  render()
  // whole-run default: the full tally
  expect(chipTexts()).toEqual(['MessageSent · 32', 'MessageDelivered · 31', 'MessageDropped · 1'])
  // toggle to revealed-so-far → the chips report ONLY the revealed prefix (the comms ledger's 15/14/1 at t30),
  // never the final 32/31/1 — the filter UI must not disclose future event composition
  const revealedBtn = [...container.querySelectorAll('.evidence-scope-btn')].find(b => b.textContent?.startsWith('revealed so far'))!
  click(revealedBtn)
  expect(chipTexts()).toEqual(['MessageSent · 15', 'MessageDelivered · 14', 'MessageDropped · 1'])
})

test('a lossy field is a keyboard- and touch-operable disclosure: activating it reveals the exact value in accessible DOM', () => {
  render()
  // the drop row's snr_db is rounded inline (12.0412) — the ONE lossy field on that row, so it is a <button>
  const row = container.querySelector(`tr[data-seq="${dropSeq}"]`)!
  const btn = row.querySelector('.evidence-field-btn') as HTMLButtonElement
  expect(btn).toBeTruthy()
  expect(btn.tagName).toBe('BUTTON')            // a native button — keyboard + touch operable
  expect(btn.textContent).toContain('snr_db=12.0412')
  expect(btn.getAttribute('aria-expanded')).toBe('false')
  expect(row.querySelector('.evidence-field-full')).toBeNull() // exact value not yet in the DOM
  // it is focusable, and activating it puts the EXACT value into accessible DOM (a real span, not only a title)
  btn.focus()
  expect(document.activeElement).toBe(btn)
  click(btn)
  expect(btn.getAttribute('aria-expanded')).toBe('true')
  expect(row.querySelector('.evidence-field-full')?.textContent).toContain('12.041199826559248')
  // and it does NOT select the row (stopPropagation) — inspecting the value is not navigating
  expect(picked).toBeNull()
})
