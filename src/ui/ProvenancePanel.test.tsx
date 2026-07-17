// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProvenancePanel } from './ProvenancePanel'
import * as voices from './voices' // namespace import so a spy on qualityPresentation reaches the panel's binding
import { CAVEAT_TREATMENT, caveatNote, markClass, qualityPresentation, requireGlyph } from './voices'
import type { RunModel } from '../model/runModel'
import type { VerifyResult } from '../decode/verify'
import type { RunManifest } from '../decode/manifest'

// THE QUALITY REGISTER, rendered for real (react-dom/client in jsdom — the GateScreen.test idiom). The pure row
// helpers are unit-tested in provenanceFormat.test.ts; THIS proves the two VISIBLE carriers the register depends
// on actually reach the DOM: the class interpolation in ProvenancePanel (the treatment resolved off r.caveat) AND
// the disclosure text. Delete the interpolation or misspell the CSS hook and provenanceFormat stays green while the
// dirty row becomes visually indistinguishable from a plain attested note — so it must be proven at the render.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A clean fold + a manifest that AGREES with it (→ manifest-verified). dirty is a meta self-declaration, not a
// comparable pin, so flipping it does not change the verdict — it only moves the dirty row's voice.
const verify: VerifyResult = {
  eventHashHex: 'a'.repeat(64), stateHashHex: 'b'.repeat(64), resultIdHex: 'c'.repeat(64), caseIdHex: 'd'.repeat(64),
  eventCount: 212, tickCount: 96, terminationReason: 1, matchesTrailer: true,
  trailerPins: { eventHash: true, stateTrajectoryHash: true, eventCount: true, tickCount: true },
}
const manifest = (dirty: boolean): RunManifest => ({
  eventSchemaVersion: 1, stateSchemaVersion: 1,
  schemaRegistryHash: 'e'.repeat(64), stateRegistryHash: 'f'.repeat(64),
  scenarioId: 'demo', seed: '42', dtUs: 125000,
  eventHash: verify.eventHashHex, stateTrajectoryHash: verify.stateHashHex, resultId: verify.resultIdHex,
  eventCount: verify.eventCount, tickCount: verify.tickCount, runComplete: true, terminationReason: verify.terminationReason,
  simTimeStartUs: '0', simTimeEndUs: '12000000',
  caseId: verify.caseIdHex, attemptId: 'att', commit: 'abc1234', dirty, createdAt: '2026-01-01',
})
const modelFor = (m: RunManifest | null): RunModel => ({ manifest: m, verify } as unknown as RunModel)

// The exact v0.8.1 disclosure the dirty row must display — an INDEPENDENT literal (the render-boundary contract).
const DIRTY_DISCLOSURE = 'manifest self-declares an unclean build tree at generation — a build-hygiene disclosure, not a byte-verification failure (the hashes above are checked independently); a dirty run is non-citable under the publication contract'

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => { root.unmount() }); container.remove() })
const render = (m: RunManifest | null) => act(() => { root.render(<ProvenancePanel model={modelFor(m)} open />) })
const dirtyRow = () => container.querySelector('tr[data-prov-key="dirty"]')!

describe('ProvenancePanel — the dirty row renders the quality register (visible carriers proven at the render)', () => {
  test('dirty=true: the row wears the • attested glyph + the caveat note (prov-note AND caveat classes) + the exact text; never the alarm ✗', () => {
    render(manifest(true))
    const row = dirtyRow()
    // the tr keeps the attested CSS hook (slate •), NEVER the mismatch alarm class it used to wear.
    expect(row.classList.contains('attested')).toBe(true)
    expect(row.classList.contains('mismatch')).toBe(false)
    // the glyph cell paints the • (attested), not the ✗ and not an empty cell.
    expect(row.querySelector('.prov-glyph')!.textContent).toBe('•')
    // THE VISIBLE TREATMENT: the note span carries BOTH prov-note AND the caveat treatment class (the render's
    // class interpolation, resolved off the row's semantic caveat field) — this is the assertion a deleted
    // interpolation would fail while provenanceFormat stayed green.
    const note = row.querySelector('.prov-note')!
    expect(note.classList.contains('prov-note')).toBe(true)
    expect(note.classList.contains('caveat')).toBe(true)
    // …and the disclosure text reaches the DOM verbatim (the render-boundary contract).
    expect(note.textContent).toBe(DIRTY_DISCLOSURE)
  })

  test('dirty=false: a plain attested note — prov-note WITHOUT the caveat class, the manifest-claim text', () => {
    render(manifest(false))
    const row = dirtyRow()
    expect(row.classList.contains('attested')).toBe(true)
    expect(row.querySelector('.prov-glyph')!.textContent).toBe('•')
    const note = row.querySelector('.prov-note')!
    expect(note.classList.contains('prov-note')).toBe(true)
    expect(note.classList.contains('caveat')).toBe(false) // NOT a caveat — dirty=false is a plain attested claim
    expect(note.textContent).toBe('manifest claim · not recomputed')
  })

  test('det-only (no manifest): the dirty row is glyphless with the no-claim note — no caveat treatment', () => {
    render(null)
    const row = dirtyRow()
    expect(row.querySelector('.prov-glyph')!.textContent).toBe('') // mark:null → empty glyph cell
    const note = row.querySelector('.prov-note')!
    expect(note.classList.contains('caveat')).toBe(false)
    expect(note.textContent).toMatch(/no manifest claim/)
  })

  test('the WHOLE rendered voice is driven from qualityPresentation: the glyph char AND the row class both follow ITS mark', () => {
    render(manifest(true))
    const row = dirtyRow()
    const q = qualityPresentation('dirty') // read the expected voice FROM the register — never hardcoded 'attested'
    // every rendered axis agrees with the register's ONE mark: the glyph CHAR it shows, and the row CLASS the CSS
    // paints the glyph's hue through. Both are that mark's own (requireGlyph / markClass), so a QUALITY_MARK change
    // would move them together — the row class is NOT re-derived from a BadgeState.
    expect(row.querySelector('.prov-glyph')!.textContent).toBe(requireGlyph(q.mark))
    expect(row.className).toBe(q.cls)
    expect(q.cls).toBe(markClass(q.mark)) // the class IS that mark's class — the SAME source as the glyph
  })

  test('MUTATION: a different register mark moves the glyph AND the row class TOGETHER — a badge-class split cannot survive', () => {
    // Force the register to the ✗ mark and prove the WHOLE rendered voice follows it. A panel that sourced the row
    // class from the badge (still 'attested') while the glyph followed the mark would paint an attested-SLATE ✗ —
    // the precise split this fix closes. Both axes must track the mutated mark; neither may fall back to the badge.
    const spy = vi.spyOn(voices, 'qualityPresentation').mockReturnValue({
      mark: 'mismatch', cls: markClass('mismatch'), note: caveatNote('dirty'), treatment: CAVEAT_TREATMENT,
    })
    try {
      render(manifest(true))
      const row = dirtyRow()
      expect(row.querySelector('.prov-glyph')!.textContent).toBe(requireGlyph('mismatch')) // ✗ — glyph follows the mutated mark
      expect(row.className).toBe(markClass('mismatch'))  // 'mismatch' — the row class follows it too…
      expect(row.className).not.toBe('attested')          // …never the badge's 'attested' (a split would surface HERE)
    } finally {
      spy.mockRestore()
    }
  })
})
