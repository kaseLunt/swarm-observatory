// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildCommsStage, commsChipCopy, type CommsSource } from './commsStage'
import { CommsStrip } from './commsStrip'
import { markClass, requireGlyph } from './voices'
import type { MessageSent, MessageDelivered, MessageDropped } from '../decode/payloads'
import type { RunManifest } from '../decode/manifest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
// A RECORDED manifest (dtUs 125000, f4's real tick period) — matching production, where useRun passes the loaded
// manifest. (A manifestless model would fall to the shared assumed clock, ASSUMED_DT_US, blowing up the pulse
// windows; f4 always has a manifest.) The comms path reads only manifestDtUs, so a minimal manifest suffices.
const model = new RunModel(decodeBundle(detFixture('f4_seed42')), { dtUs: 125000 } as unknown as RunManifest)
const data = buildCommsStage(model)

const VERIFIED = requireGlyph('verified')       // ✓ — the manifest-grade check the pairing must NEVER wear
const MISMATCH = requireGlyph('mismatch')       // ✗ — the integrity alarm the drop must NEVER wear
const SELF = requireGlyph('selfConsistent')     // ○ — the decoded-consistency ring the pairing wears
const ATTESTED = requireGlyph('attested')       // • — the quality register's mark the drop wears

describe('CommsStrip — the ledger-by-scrub, the two-voice grammar, and the reveal discipline', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const renderAt = (tick: number) => act(() => root.render(<CommsStrip data={data} tick={tick} />))
  const ledger = () => container.querySelector('.comms-ledger')!.getAttribute('data-comms-ledger')

  // ── THE LEDGER-BY-SCRUB — the tally is the reveal clock's prefix counts (at the ≤ boundary) ──────────────
  test('the ledger is written by the playhead: 0/0/0 before the link, 15/14/1 AT the loss, 32/31/1 at full reveal', () => {
    renderAt(0)
    expect(ledger()).toBe('0/0/0')
    renderAt(29)                        // JUST before the loss — the drop is still ahead
    expect(ledger()).toBe('14/14/0')
    renderAt(30)                        // AT the loss — the ledger ticks 1 lost
    expect(ledger()).toBe('15/14/1')
    renderAt(95)                        // full reveal — the run's final tally
    expect(ledger()).toBe('32/31/1')
  })

  // ── THE TWO SCOPES NAME THEMSELVES — the playhead-scoped ledger ("so far") vs the run-scoped receipt ("whole
  //    run") coexist without contradiction. The tick-0 case is the regression: "0 so far" beside "whole run: 32". ──
  test('at tick 0 the "so far" ledger (0/0/0) and the "whole run" receipt (32 of 32) both label their scope and never contradict', () => {
    renderAt(0)
    const ledgerEl = container.querySelector('.comms-ledger')!
    const pairing = container.querySelector('.comms-pairing')!
    // the ledger is playhead-scoped and SAYS so — 0/0/0 "so far", not a bare "0" that fights the receipt's 32.
    expect(ledgerEl.textContent).toContain('so far')
    expect(ledgerEl.getAttribute('data-comms-ledger')).toBe('0/0/0')
    // the receipt is run-scoped and SAYS so — "whole run: 32 of 32 sends resolved", present already at tick 0.
    expect(pairing.textContent).toContain('whole run')
    expect(pairing.textContent).toContain('32 of 32 sends resolved')
  })

  test('at tick 29 both scopes still label and coexist — "14 so far" beside "whole run: 32"', () => {
    renderAt(29)
    const ledgerEl = container.querySelector('.comms-ledger')!
    const pairing = container.querySelector('.comms-pairing')!
    expect(ledgerEl.textContent).toContain('so far')
    expect(ledgerEl.getAttribute('data-comms-ledger')).toBe('14/14/0') // the playhead tally so far
    expect(pairing.textContent).toContain('whole run')
    expect(pairing.textContent).toContain('32 of 32 sends resolved')   // the run total, unchanged by the playhead
  })

  // ── THE CHIP + THE LEDGER COMPOSED — the App renders BOTH: the chip (commsChipCopy — run-scoped, never scrubs)
  //    beside the ledger (playhead-scoped). Both must self-label so "whole run: 32 sent" never fights "0 so far". ──
  test('the CHIP (run-scoped) and the LEDGER (playhead-scoped) both self-label; the chip is stable across the scrub', () => {
    // the chip the App composes beside the strip — it states the WHOLE-RUN totals + the loss line, and labels its scope.
    const chip = commsChipCopy(data)
    expect(chip).toContain('whole run:')                            // the chip names its scope (was bare totals — a self-contradiction beside the ledger)
    expect(chip).toContain('32 sent · 31 delivered · 1 lost')       // the whole-run totals
    expect(chip).toContain('the one packet that never arrived')     // the loss line, run-scoped
    // TICK 0 — the ledger reads "0/0/0 so far" beside the chip's "whole run: 32 …"; labels reconcile the numbers.
    renderAt(0)
    expect(container.querySelector('.comms-ledger')!.getAttribute('data-comms-ledger')).toBe('0/0/0')
    expect(container.querySelector('.comms-ledger')!.textContent).toContain('so far')
    // TICK 29 — the ledger advances to "14/14/0 so far", but the chip is UNCHANGED (it is run-scoped, not playhead-scoped).
    renderAt(29)
    expect(container.querySelector('.comms-ledger')!.getAttribute('data-comms-ledger')).toBe('14/14/0')
    expect(commsChipCopy(data)).toBe(chip) // the chip did not move with the playhead — no contradiction to reconcile
  })

  // ── THE FLAGGED GAP — the drop obeys the reveal clock (NOT-YET → anchored) and wears the QUALITY register ─────
  test('before t30 the loss is NOT-YET (no drop mark, the not-yet line stands in); at/after t30 the anchor persists', () => {
    renderAt(29)
    expect(container.querySelector('.comms-lane-drop'), 'no drop before its tick').toBeNull()
    expect(container.querySelector('.comms-lane-notyet'), 'the not-yet line stands in').not.toBeNull()
    expect(container.querySelector('.comms-drop'), 'no drop caveat block yet').toBeNull()

    renderAt(30)
    const dropMark = container.querySelector('.comms-lane-drop')
    expect(dropMark, 'the flagged gap appears at the loss tick').not.toBeNull()
    expect(container.querySelector('.comms-lane-notyet'), 'the not-yet line is retired').toBeNull()

    renderAt(64) // scrub PAST — the anchor persists (the viewer can always find the loss again)
    expect(container.querySelector('.comms-lane-drop'), 'the anchor persists after its moment').not.toBeNull()
  })

  // ── THE GRAMMAR PINS (the brand-protecting rulings) ─────────────────────────────────────────────────────────
  test('the pairing wears the ○ self-consistent ring, NEVER the ✓ (decoded-consistency, no external oracle)', () => {
    renderAt(95)
    const pairing = container.querySelector('.comms-pairing')!
    const mark = pairing.querySelector('.comms-mark')!
    expect(mark.textContent).toBe(SELF)                       // ○ — the ring
    expect(mark.className).toContain(markClass('selfConsistent'))
    expect(pairing.textContent).not.toContain(VERIFIED)       // …NEVER the ✓
    expect(mark.className).not.toContain('verified')
    // the ring covers all THREE named readings — the strip names each so the ring is legible, not a bare boolean.
    // the endpoint count is FORMED-only — 31 deliveries supplied endpoints, so "31 of 31 endpoint readings
    // agree", NOT "32" (the drop forms no endpoint comparison — no vacuous agreement). Causation is formed by all 32.
    expect(pairing.textContent).toContain('32 causation edges agree')
    expect(pairing.textContent).toContain('31 of 31 endpoint readings agree')
    expect(pairing.textContent).not.toContain('32 endpoint') // never the vacuous count that folds the drop in
    // the run-scoped receipt names its scope so it sits honestly beside the "so far" ledger.
    expect(pairing.textContent).toContain('whole run')
  })

  test('the DROP wears the QUALITY register (• attested + caveat treatment), NEVER the integrity ✗', () => {
    renderAt(30)
    const dropMark = container.querySelector('.comms-lane-drop')!
    expect(dropMark.textContent).toBe(ATTESTED)               // • — the quality register's mark
    expect(dropMark.className).toContain(markClass('attested'))
    expect(dropMark.className).toContain('caveat')            // the caveat treatment (the quality-register idiom)
    // the drop caveat block also speaks the • + the caveat note, and never the alarm ✗
    const dropBlock = container.querySelector('.comms-drop')!
    expect(dropBlock.querySelector('.comms-mark')!.textContent).toBe(ATTESTED)
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(MISMATCH)
  })

  test('NO new alphabet: the whole strip renders only the sanctioned marks — never a ✓ or a ✗ anywhere', () => {
    for (const t of [0, 15, 30, 64, 95]) {
      renderAt(t)
      const text = container.querySelector('.comms-strip')!.textContent ?? ''
      expect(text, `no ✓ at tick ${t}`).not.toContain(VERIFIED)
      expect(text, `no ✗ at tick ${t}`).not.toContain(MISMATCH)
    }
  })

  // ── THE LATENCY LANE — a mark per REVEALED delivered pair, on the FIXED axis; the drop is the ONE gap ────────
  test('the latency lane seats one mark per revealed delivered pair, and flags the one gap', () => {
    renderAt(30)
    expect(container.querySelectorAll('.comms-lane-mark').length).toBe(14) // 14 delivered by tick 30
    expect(container.querySelectorAll('.comms-lane-drop').length).toBe(1)  // …and the one loss
    renderAt(95)
    expect(container.querySelectorAll('.comms-lane-mark').length).toBe(31) // all 31 delivered at full reveal
    // the axis is labelled FIXED (never auto-fit) so a steady link never renders float noise as fake weather
    expect(container.querySelector('.comms-lane-axis')!.textContent).toContain('fixed 0–400µs')
  })

  test('the SNR is a labelled constant hairline (12.04 dB), never auto-fit weather', () => {
    renderAt(95)
    const snr = container.querySelector('.comms-snr')!
    expect(snr.textContent).toContain('12.04 dB')
    expect(snr.textContent).toContain('constant this run')
  })

  test('honest degeneration: the copy claims sent-vs-arrived only (no receiver belief in the bytes)', () => {
    renderAt(95)
    expect(container.querySelector('.comms-degenerate')!.textContent).toContain('sent-vs-arrived only')
  })
})

// ── an UNSUPPORTED drop shape (a jammed drop) FAILS CLOSED: an honest refusal, never a fabricated loss ──────
// The caveat is derived from the DECODED reason/jam. A jammed drop (reason 1, jam active) is a contested-channel
// outcome the lens does not yet describe (no such certified bundle exists), so the strip refuses rather than
// misreport it as a plain loss — and it NEVER wears a verdict glyph (✓/✗) doing so.
describe('CommsStrip — an unsupported drop shape fails closed', () => {
  // A synthetic source: one send msg 1 @ t2, dropped @ t2 with reason JAMMED(1), jam ACTIVE(1).
  const jammedSource: CommsSource = {
    eventCount: 2, tickCount: 4, ticks: [2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 7),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 9, txPowerW: 256 } : null),
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (s): MessageDropped | null => (s === 1 ? { msg: 1n, reason: 1, snrDb: 9, jamState: 1 } : null),
    parentOf: (s) => (s === 1 ? 0 : null),
    manifestDtUs: () => 125000,
  }
  const jammed = buildCommsStage(jammedSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('the jammed drop renders the REFUSAL (not the • caveat), and never a ✓ or ✗', () => {
    act(() => root.render(<CommsStrip data={jammed} tick={2} />))
    // the drop IS revealed (tick 2), but its shape is unsupported → the refusal, not the quality caveat.
    expect(container.querySelector('.comms-drop-refused'), 'the caveat block refuses honestly').not.toBeNull()
    expect(container.querySelector('.comms-lane-drop-refused'), 'the lane gap refuses too').not.toBeNull()
    const refused = container.querySelector('.comms-drop-refused')!
    expect(refused.textContent).toContain('reason 1')          // names the decoded reason…
    expect(refused.textContent).toContain('jam_state 1')       // …and the decoded jam state
    expect(refused.textContent).toMatch(/refus/i)              // …and refuses to describe it
    // the refused caveat block must NOT wear the • attested mark (it is not a supported loss) — and NEVER a verdict glyph
    expect(refused.textContent).not.toContain(ATTESTED)
    const strip = container.querySelector('.comms-strip')!
    expect(strip.textContent).not.toContain(VERIFIED)
    expect(strip.textContent).not.toContain(MISMATCH)
  })
})

// ── TWO drops (one supported LOSS, one unsupported JAMMED): NO hero, the copy degrades to counts ────────────
describe('CommsStrip — a supported + unsupported two-drop run degrades to counts', () => {
  // sends msg 1 (@t2), msg 2 (@t4); drops: msg 1 LOSS jam-0 (supported @t2), msg 2 JAMMED jam-1 (unsupported @t4).
  const twoDropSource: CommsSource = {
    eventCount: 4, tickCount: 6, ticks: [2, 4, 2, 4],
    entityKeys: () => [],
    kindAt: (s) => (s < 2 ? 5 : 7),
    messageSentAt: (s): MessageSent | null =>
      s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
        : s === 1 ? { msg: 2n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (s): MessageDropped | null =>
      s === 2 ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 }
        : s === 3 ? { msg: 2n, reason: 1, snrDb: 12, jamState: 1 } : null,
    parentOf: (s) => (s === 2 ? 0 : s === 3 ? 1 : null),
    manifestDtUs: () => 125000,
  }
  const twoDrop = buildCommsStage(twoDropSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('both drops render on the lane (one • supported, one ? unsupported); the copy degrades, no hero story', () => {
    act(() => root.render(<CommsStrip data={twoDrop} tick={6} />)) // past both drops
    // the ledger counts both losses
    expect(container.querySelector('.comms-ledger')!.getAttribute('data-comms-ledger')).toBe('2/0/2')
    // the lane shows the supported drop (• caveat) AND the unsupported drop (refusal ?)
    expect(container.querySelectorAll('.comms-lane-drop.attested.caveat').length).toBe(1) // the supported LOSS
    expect(container.querySelectorAll('.comms-lane-drop-refused').length).toBe(1)          // the JAMMED
    // the caveat block DEGRADES to counts — no hero story, no "one lost packet"
    const degraded = container.querySelector('.comms-drop-degraded')
    expect(degraded, 'the block degrades to counts').not.toBeNull()
    expect(degraded!.textContent).toContain('2')
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain('never arrived') // no hero story
    // …and still never a verdict glyph
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(VERIFIED)
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(MISMATCH)
  })
})

// ── DEFINITIVE VISUALS FAIL CLOSED — an inconsistent mapping withholds the ledger/lane/hero, disclosing instead ──
describe('CommsStrip — an inconsistent outcome mapping fails closed to a disclosure', () => {
  // one send msg 1; a drop AND a delivery for it (a conflict) → not consistent.
  const conflictSource: CommsSource = {
    eventCount: 3, tickCount: 6, ticks: [2, 2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : s === 1 ? 7 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null => (s === 2 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
    messageDroppedAt: (s): MessageDropped | null => (s === 1 ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 } : null),
    parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
    manifestDtUs: () => 125000,
  }
  const conflict = buildCommsStage(conflictSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('renders the disclosure (mode inconsistent), withholds the ledger/lane/hero, and the pairing wears the mismatch mark', () => {
    expect(conflict.consistent).toBe(false)
    act(() => root.render(<CommsStrip data={conflict} tick={2} />))
    // the disclosure is present, tagged with its mode, and names the anomaly; no per-message loss claim
    const disc = container.querySelector('.comms-disclosure')
    expect(disc, 'the fail-closed disclosure renders').not.toBeNull()
    expect(disc!.getAttribute('data-comms-mode')).toBe('inconsistent')
    expect(disc!.textContent).toContain('inconsistent')
    expect(disc!.textContent).toContain('anomalous')
    // the definitive visuals are WITHHELD
    expect(container.querySelector('.comms-ledger'), 'the ledger tally is withheld').toBeNull()
    expect(container.querySelector('.comms-lane'), 'the latency lane is withheld').toBeNull()
    expect(container.querySelector('.comms-lane-drop'), 'no drop mark').toBeNull()
    expect(container.textContent).not.toContain('never arrived') // no hero story
    // the pairing receipt wears the mismatch mark (an ACTUAL disagreement — a duplicate outcome) — never the ring, never a ✓
    const pairing = container.querySelector('.comms-pairing')!
    expect(pairing.querySelector('.comms-mark')!.textContent).toBe(MISMATCH)
    expect(pairing.querySelector('.comms-mark')!.className).toContain(markClass('mismatch'))
    // the ✗ is ATTRIBUTABLE to a VISIBLE failing row: the "1 duplicate outcome" count, so the mark never
    // floats beside all-passing checks. The counts denominate over the AUDIT POPULATION (every
    // RESOLVING outcome, incl. the duplicate): the drop + the duplicate delivery give "2 of 2 causation edges", and
    // the DUPLICATE delivery's endpoint reading (1→2, agrees) is RETAINED → "1 of 1 endpoint readings agree" (never
    // discarded before audit — order-independent, pinned separately below).
    expect(pairing.textContent).toContain('2 of 2 causation edges agree')
    expect(pairing.textContent).toContain('1 of 1 endpoint readings agree')
    expect(pairing.textContent).toContain('1 duplicate outcome')
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(VERIFIED)
  })
})

// ── THE AUDIT POPULATION AT THE STRIP — a contradictory DUPLICATE delivery's endpoint reading is COUNTED ─────────
// the receipt's endpoint denominator is the audit population (every resolving outcome), so an accepted
// delivery (1→2, agrees) plus a contradictory duplicate delivery (1→9) reads "1 of 2 endpoint readings agree" — the
// duplicate's formed reading is retained, order-independent, and the ✗ is attributable to "1 duplicate outcome".
describe('CommsStrip — a contradictory duplicate delivery is counted in the endpoint readings (1 of 2)', () => {
  const twoDeliveries = (goodFirst: boolean): CommsSource => ({
    eventCount: 3, tickCount: 6, ticks: [2, 3, 3],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null => {
      if (s === 0) return null
      const good = { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }
      const bad = { msg: 1n, src: 1n, dst: 9n, latencyUs: 200n, snrDb: 12 }
      return s === 1 ? (goodFirst ? good : bad) : (goodFirst ? bad : good)
    },
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
    manifestDtUs: () => 125000,
  })
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('the receipt reads "1 of 2 endpoint readings agree · 1 duplicate outcome", SAME in both arrival orders', () => {
    for (const goodFirst of [true, false]) {
      const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c)
      act(() => r.render(<CommsStrip data={buildCommsStage(twoDeliveries(goodFirst))} tick={3} />))
      const pairing = c.querySelector('.comms-pairing')!
      expect(pairing.querySelector('.comms-mark')!.textContent).toBe(MISMATCH)
      expect(pairing.textContent, `${goodFirst ? 'good-first' : 'bad-first'} counts the duplicate's reading`).toContain('1 of 2 endpoint readings agree')
      expect(pairing.textContent).toContain('1 duplicate outcome') // the ✗ is attributable to this visible row
      // the DISCLOSURE's anomaly aggregate is order-independent — 2 distinct facts (a duplicate + a contradictory
      // endpoint reading), whether the good or the bad delivery arrived first.
      expect(c.querySelector('.comms-disclosure')!.textContent, `${goodFirst ? 'good-first' : 'bad-first'} disclosure`).toContain('2 anomalous')
      act(() => r.unmount()); c.remove()
    }
  })
})

// ── AN ORPHAN OUTCOME IS A VISIBLE FAILING ROW — the ✗ is attributable to it (same-population parity) ──────────
// A delivery for a msg with NO matching send is an orphan. The three named checks pass on the accepted pair, so the
// mismatch must be attributable to the orphan's OWN rendered count — not float beside all-passing checks.
describe('CommsStrip — an orphan outcome renders as its own failing row beside the three checks', () => {
  // send msg 1 (paired by a matching delivery) PLUS a delivery for msg 5 that has NO send (an orphan).
  const orphanSource: CommsSource = {
    eventCount: 3, tickCount: 6, ticks: [2, 2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6), // seq0 send, seq1 + seq2 deliveries
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null =>
      s === 1 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }
        : s === 2 ? { msg: 5n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null, // msg 5 has no send — orphan
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 ? 0 : null), // the msg-1 delivery is caused; the orphan resolves to nothing
    manifestDtUs: () => 125000,
  }
  const orphan = buildCommsStage(orphanSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('the disclosure renders and the pairing names the orphan (the ✗ is attributable to a visible row)', () => {
    expect(orphan.consistent).toBe(false)
    act(() => root.render(<CommsStrip data={orphan} tick={2} />))
    expect(container.querySelector('.comms-disclosure')!.getAttribute('data-comms-mode')).toBe('inconsistent')
    const pairing = container.querySelector('.comms-pairing')!
    expect(pairing.querySelector('.comms-mark')!.textContent).toBe(MISMATCH)
    expect(pairing.textContent).toContain('1 causation edges agree') // the accepted msg-1 pair passes all three checks…
    expect(pairing.textContent).toContain('1 orphan outcome')        // …and the orphan is the VISIBLE failing row
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(VERIFIED)
  })
})

// ── AN ENDPOINT ANOMALY FAILS CLOSED — a causally-matched receipt naming a different dst is a disagreement ──────
// the delivered endpoints are NOT discarded before the consistency check. A send 1→2 with a causally-matched
// receipt claiming 1→9 is a real endpoint disagreement — the strip discloses (mode inconsistent) and withholds the
// definitive visuals, exactly as it does for a duplicate outcome; the pairing wears the mismatch, never the ring.
describe('CommsStrip — a delivered receipt whose endpoints contradict its send fails closed', () => {
  // one send msg 1 (1→2); a causally-MATCHED delivery for msg 1 naming dst 9 — only the endpoint contradicts.
  const endpointSource: CommsSource = {
    eventCount: 2, tickCount: 4, ticks: [2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 9n, latencyUs: 200n, snrDb: 12 } : null),
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 ? 0 : null),
    manifestDtUs: () => 125000,
  }
  const endpointBad = buildCommsStage(endpointSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('renders the inconsistent disclosure, withholds the ledger/lane, and the pairing wears the mismatch mark', () => {
    expect(endpointBad.consistent).toBe(false)
    act(() => root.render(<CommsStrip data={endpointBad} tick={2} />))
    const disc = container.querySelector('.comms-disclosure')
    expect(disc, 'the endpoint disagreement discloses').not.toBeNull()
    expect(disc!.getAttribute('data-comms-mode')).toBe('inconsistent')
    expect(disc!.textContent).toContain('anomalous')
    expect(container.querySelector('.comms-ledger'), 'the ledger tally is withheld').toBeNull()
    expect(container.querySelector('.comms-lane'), 'the latency lane is withheld').toBeNull()
    const pairing = container.querySelector('.comms-pairing')!
    expect(pairing.querySelector('.comms-mark')!.textContent).toBe(MISMATCH)
    // THE MISMATCH IS ATTRIBUTABLE — the three named readings show pairing + causation agreeing while the ENDPOINT
    // reading falls short (0 of 1 FORMED readings — the delivery supplied an endpoint that contradicts), so the
    // single mark points to a specific check, never an unexplained ✗.
    expect(pairing.textContent).toContain('1 causation edges agree')      // causation still agrees…
    expect(pairing.textContent).toContain('0 of 1 endpoint readings agree') // …the one formed endpoint reading fails
    expect(container.querySelector('.comms-strip')!.textContent).not.toContain(VERIFIED)
  })

  // ENDPOINT SYMMETRY at the strip: a SWAPPED (2→1) receipt and a SRC-ONLY disagreement disclose identically and
  // attribute the mismatch to the endpoint reading — the strip does not privilege the dst field.
  test('a swapped (2→1) receipt and a src-only disagreement each disclose + attribute the mismatch to the endpoint reading', () => {
    const mk = (outSrc: bigint, outDst: bigint): CommsSource => ({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: outSrc, dst: outDst, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null),
      manifestDtUs: () => 125000,
    })
    for (const [outSrc, outDst] of [[2n, 1n], [9n, 2n]] as [bigint, bigint][]) {
      const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c)
      act(() => r.render(<CommsStrip data={buildCommsStage(mk(outSrc, outDst))} tick={2} />))
      const disc = c.querySelector('.comms-disclosure')!
      expect(disc.getAttribute('data-comms-mode'), `${outSrc}→${outDst} discloses inconsistent`).toBe('inconsistent')
      const pairing = c.querySelector('.comms-pairing')!
      expect(pairing.querySelector('.comms-mark')!.textContent).toBe(MISMATCH)
      expect(pairing.textContent, `${outSrc}→${outDst} attributes to the endpoint reading`).toContain('0 of 1 endpoint readings agree')
      act(() => r.unmount()); c.remove()
    }
  })
})

// ── VACUOUS COMPARISONS ARE NOT AGREEMENTS — an all-drop run forms ZERO endpoint readings, so it makes no claim ──
// a drop supplies no endpoint, so it forms no endpoint comparison. An all-drop run has zero deliveries → zero
// FORMED endpoint readings → the receipt makes NO endpoint claim ("0 endpoint readings"), never a manufactured
// "N endpoints agree" conjured from zero observations. (The run is still consistent — a drop cannot contradict.)
describe('CommsStrip — an all-drop run forms no endpoint readings (no vacuous agreement)', () => {
  // two sends, two SUPPORTED drops (reason LOSS, jam inactive) — consistent + single link (renderable), zero deliveries.
  const allDropSource: CommsSource = {
    eventCount: 4, tickCount: 8, ticks: [2, 4, 2, 4],
    entityKeys: () => [],
    kindAt: (s) => (s < 2 ? 5 : 7),
    messageSentAt: (s): MessageSent | null =>
      s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
        : s === 1 ? { msg: 2n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (s): MessageDropped | null =>
      s === 2 ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 }
        : s === 3 ? { msg: 2n, reason: 3, snrDb: 12, jamState: 0 } : null,
    parentOf: (s) => (s === 2 ? 0 : s === 3 ? 1 : null),
    manifestDtUs: () => 125000,
  }
  const allDrop = buildCommsStage(allDropSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('the receipt reads "0 endpoint readings" (no claim), never a vacuous "2 endpoints agree"', () => {
    expect(allDrop.consistent).toBe(true) // a drop cannot contradict — allEndpointsOk vacuous-true is unchanged
    expect(allDrop.allEndpointsOk).toBe(true)
    act(() => root.render(<CommsStrip data={allDrop} tick={6} />))
    const pairing = container.querySelector('.comms-pairing')!
    expect(pairing.textContent).toContain('2 causation edges agree') // both drops form causation comparisons…
    expect(pairing.textContent).toContain('0 endpoint readings')     // …but ZERO endpoint comparisons — no claim
    expect(pairing.textContent).not.toContain('endpoint readings agree') // never the "N of N agree" form on zero readings
  })
})

// ── INCOMPLETE IS NOT INCONSISTENT — an unformed pairing wears the no-verdict voice, never the mismatch ──────
describe('CommsStrip — an incomplete mapping shows the no-verdict pairing voice (never a false mismatch)', () => {
  // one send, ZERO outcomes — the pairing check is unformed (no outcome to compare), NOT a disagreement.
  const incompleteSource: CommsSource = {
    eventCount: 1, tickCount: 4, ticks: [2],
    entityKeys: () => [],
    kindAt: () => 5,
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: () => null,
    manifestDtUs: () => 125000,
  }
  const incomplete = buildCommsStage(incompleteSource)
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('the disclosure reads "incomplete", and the pairing wears the no-verdict mark — NO ✗, NO ✓', () => {
    act(() => root.render(<CommsStrip data={incomplete} tick={2} />))
    const disc = container.querySelector('.comms-disclosure')!
    expect(disc.getAttribute('data-comms-mode')).toBe('incomplete')
    expect(disc.textContent).toContain('incomplete')
    // the pairing receipt wears the UNVERIFIABLE no-verdict mark (an unformed check), never the mismatch ✗ and never ✓
    const pairing = container.querySelector('.comms-pairing')!
    expect(pairing.querySelector('.comms-mark')!.textContent).toBe(requireGlyph('unverifiable'))
    // the no-verdict mark is attributable to a VISIBLE row: the unresolved send is named (it is what makes the
    // check unformed), so even the incomplete mark points to a rendered count, not an empty all-passing line.
    expect(pairing.textContent).toContain('1 send unresolved')
    const strip = container.querySelector('.comms-strip')!.textContent!
    expect(strip).not.toContain(MISMATCH) // never a false mismatch on a merely-incomplete mapping…
    expect(strip).not.toContain(VERIFIED) // …and never a ✓
  })
})
