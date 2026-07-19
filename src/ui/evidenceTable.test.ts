import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import {
  EVIDENCE_PROVENANCE, kindLabel, formatF64, formatVec, payloadText,
  buildEvidenceRow, buildEvidenceRows, buildEvidenceRevealClock, revealedEventCount,
  applyView, scopeRows, sortRows, kindCounts, filterActive,
  wholeScopeLabel, revealedScopeLabel, populationLabel,
  type EvRow, type ViewOpts,
} from './evidenceTable'

// Same fixture resolver the messageTrack oracle uses: flat .det for e0/f0/f1, dir bundles for f2a/f3a/f4.
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
const modelFor = (name: string): RunModel => new RunModel(decodeBundle(detFixture(name)), null)
const fieldOf = (r: EvRow, key: string): string | undefined => r.fields.find(f => f.key === key)?.value
const fullOf = (r: EvRow, key: string): string | null | undefined => r.fields.find(f => f.key === key)?.full

const baseOpts = (o: Partial<ViewOpts> = {}): ViewOpts => ({
  revealedOnly: false, playhead: 0, activeKinds: new Set<number>(), text: '', sortKey: 'seq', sortDir: 'asc', ...o,
})

// ── THE ROW MODEL vs the oracles' known values (every field is decoded-real, pinned to the frozen bytes) ────
describe('the row model renders each kind’s true decoded fields', () => {
  test('f4: the ONE MessageDropped row shows msg 14, reason 3 (LOSS), jam_state 0 — the decoded drop, no verdict', () => {
    const model = modelFor('f4_seed42')
    const rows = buildEvidenceRows(model)
    const drops = rows.filter(r => r.kind === 7)
    expect(drops.length).toBe(1)
    const drop = drops[0]!
    expect(drop.kindName).toBe('MessageDropped')
    expect(drop.tick).toBe(30)               // the tk30 fizzle
    expect(fieldOf(drop, 'msg')).toBe('14')
    expect(fieldOf(drop, 'reason')).toBe('3')      // LOSS=3 — a decoded channel outcome
    expect(fieldOf(drop, 'jam_state')).toBe('0')   // zero jam — no contested-channel overclaim
  })

  test('f3a: the tick-39 DetectionMade row decodes subject 0, sensor 5, snr_db 0, meas a 2-vector', () => {
    const model = modelFor('f3a_seed42')
    const rows = buildEvidenceRows(model)
    const dets = rows.filter(r => r.kind === 1 && r.tick === 39)
    expect(dets.length).toBe(1)
    const det = dets[0]!
    expect(det.kindName).toBe('DetectionMade')
    expect(fieldOf(det, 'subject')).toBe('0')
    expect(fieldOf(det, 'sensor')).toBe('5')
    expect(fieldOf(det, 'snr_db')).toBe('0')
    // meas is a decoded VecF64 [79.62…, 2.32…] — the inline is rounded, the full is exact and reachable.
    expect(fieldOf(det, 'meas')).toBe('[79.62, 2.3228]')
    expect(fullOf(det, 'meas')).toBe('[79.62003036013357, 2.3228120280774274]')
  })

  test('f3a: the first TrackUpdated row shows the sigma-relevant cov cells (cov[0]=3.333, off-diagonals 0), full precision reachable', () => {
    const model = modelFor('f3a_seed42')
    const rows = buildEvidenceRows(model)
    const upd = rows.find(r => r.kind === 3)!
    expect(upd.kindName).toBe('TrackUpdated')
    expect(fieldOf(upd, 'track')).toBe('1')
    // cov is the 4×4 row-major position/velocity covariance. cov[0] (position variance) rounds to 3.3333;
    // cov[1] (an off-diagonal) is exactly 0 — the isotropy the belief lens rests on, shown raw here.
    const cov = fieldOf(upd, 'cov')!
    expect(cov.startsWith('[3.3333, 0,')).toBe(true)
    // the full-precision cov is one hover away — never a lossy render without the exact value.
    expect(fullOf(upd, 'cov')!.startsWith('[3.3333333333333304, 0,')).toBe(true)
  })

  test('f4: a MessageDelivered row renders latency_us as a canonical (signed-safe) decimal bigint', () => {
    const model = modelFor('f4_seed42')
    const rows = buildEvidenceRows(model)
    const del = rows.find(r => r.kind === 6)!
    expect(del.kindName).toBe('MessageDelivered')
    expect(fieldOf(del, 'latency_us')).toMatch(/^\d+$/) // a bigint rendered as its exact decimal string
    // snr_db is the run's single constant — the inline is rounded but the exact f64 is reachable.
    expect(fieldOf(del, 'snr_db')).toBe('12.0412')
    expect(fullOf(del, 'snr_db')).toBe('12.041199826559248')
  })

  test('undecoded kinds (the motion substrate) render their inner payload as named raw bytes — never a fabricated field', () => {
    const model = modelFor('f1_seed42') // f1 carries only kinds 288/289 (no typed decoder)
    const rows = buildEvidenceRows(model)
    const stepped = rows.find(r => r.kind === 289)!
    expect(stepped.kindName).toBe('MotionStepped') // the kind COLUMN still names it (registry)
    const raw = stepped.fields.find(f => f.key === 'raw bytes')
    expect(raw).toBeDefined()
    expect(raw!.value).toMatch(/^\d+ B: /) // "N B: <hex>" — honest raw bytes, not a typed field
  })
})

// ── bigint / f64 rendering (canonical strings; full precision reachable) ───────────────────────────────────
describe('value rendering: bigints canonical, f64 rounded-inline with the exact value reachable', () => {
  test('formatF64 rounds non-integers inline but always exposes the exact round-trip value', () => {
    expect(formatF64(12.041199826559248)).toEqual({ value: '12.0412', full: '12.041199826559248' })
    expect(formatF64(0.196)).toEqual({ value: '0.196', full: null })          // already exact at 4dp
    expect(formatF64(79.62003036013357).value).toBe('79.62')
    expect(formatF64(79.62003036013357).full).toBe('79.62003036013357')
  })

  test('integer-valued f64s render whole with no lossy title (nothing to expand)', () => {
    expect(formatF64(256)).toEqual({ value: '256', full: null })
    expect(formatF64(0)).toEqual({ value: '0', full: null })
    expect(formatF64(-5)).toEqual({ value: '-5', full: null })
  })

  test('formatVec renders element-wise, exposing full precision only when an element was rounded', () => {
    expect(formatVec([])).toEqual({ value: '[]', full: null })
    expect(formatVec([1, 2, 3])).toEqual({ value: '[1, 2, 3]', full: null })
    expect(formatVec([1.23456789, 0])).toEqual({ value: '[1.2346, 0]', full: '[1.23456789, 0]' })
  })
})

// ── sort semantics (stable in both directions, over any column) ────────────────────────────────────────────
describe('sort is stable and total over every column', () => {
  const rows = buildEvidenceRows(modelFor('f3a_seed42'))

  test('ascending tick sort keeps equal-tick rows in original (seq) order — stable', () => {
    const sorted = sortRows(rows, 'tick', 'asc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.tick).toBeGreaterThanOrEqual(sorted[i - 1]!.tick)
      if (sorted[i]!.tick === sorted[i - 1]!.tick) expect(sorted[i]!.seq).toBeGreaterThan(sorted[i - 1]!.seq)
    }
  })

  test('descending seq sort strictly decreases; the row set is preserved (a permutation)', () => {
    const sorted = sortRows(rows, 'seq', 'desc')
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.seq).toBeLessThan(sorted[i - 1]!.seq)
    expect(sorted.length).toBe(rows.length)
    expect(new Set(sorted.map(r => r.seq)).size).toBe(rows.length)
  })

  test('kind sort groups kinds while equal-kind rows stay in seq order (stable tiebreak)', () => {
    const sorted = sortRows(rows, 'kind', 'asc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.kind).toBeGreaterThanOrEqual(sorted[i - 1]!.kind)
      if (sorted[i]!.kind === sorted[i - 1]!.kind) expect(sorted[i]!.seq).toBeGreaterThan(sorted[i - 1]!.seq)
    }
  })
})

// ── filter semantics (kind allow-list + free-text over the rendered fields) ────────────────────────────────
describe('filtering: kind allow-list and free-text substring over rendered fields', () => {
  const model = modelFor('f4_seed42')
  const rows = buildEvidenceRows(model)

  test('an empty kind allow-list shows the whole run; {7} narrows to the single MessageDropped row', () => {
    expect(applyView(rows, baseOpts()).length).toBe(rows.length)
    const only7 = applyView(rows, baseOpts({ activeKinds: new Set([7]) }))
    expect(only7.length).toBe(1)
    expect(only7[0]!.kind).toBe(7)
  })

  test('a multi-kind allow-list unions the kinds ({5,7} = 32 sends + 1 drop)', () => {
    const sent = rows.filter(r => r.kind === 5).length
    const both = applyView(rows, baseOpts({ activeKinds: new Set([5, 7]) }))
    expect(both.length).toBe(sent + 1)
    expect(both.every(r => r.kind === 5 || r.kind === 7)).toBe(true)
  })

  test('free-text matches the rendered field strings case-insensitively (a field KEY and a decoded VALUE both hit)', () => {
    expect(applyView(rows, baseOpts({ text: 'jam_state' })).length).toBe(1)        // only MessageDropped carries jam_state
    expect(applyView(rows, baseOpts({ text: 'MESSAGEDROPPED' })).length).toBe(1)   // case-insensitive on the kind name
    expect(applyView(rows, baseOpts({ text: 'no-such-token' })).length).toBe(0)
  })

  test('filterActive tracks whether a kind OR a text filter is narrowing the set', () => {
    expect(filterActive(baseOpts())).toBe(false)
    expect(filterActive(baseOpts({ activeKinds: new Set([7]) }))).toBe(true)
    expect(filterActive(baseOpts({ text: '  x ' }))).toBe(true)
    expect(filterActive(baseOpts({ text: '   ' }))).toBe(false) // whitespace-only is not a filter
  })

  test('kindCounts reports every present kind with its true count, ascending (numeric-keyed — prototype-safe)', () => {
    const counts = kindCounts(rows)
    expect(counts).toEqual([
      { kind: 5, name: 'MessageSent', count: 32 },
      { kind: 6, name: 'MessageDelivered', count: 31 },
      { kind: 7, name: 'MessageDropped', count: 1 },
    ])
  })
})

// ── scope toggle populations (whole-run N vs revealed M, driven by the shared reveal clock) ────────────────
describe('scope: whole-run vs revealed-so-far, the reveal clock and the row set agree', () => {
  const model = modelFor('f3a_seed42')
  const rows = buildEvidenceRows(model)
  const clock = buildEvidenceRevealClock(model)
  const total = model.eventCount

  test('whole-run scope shows every event; the label names the population', () => {
    expect(applyView(rows, baseOpts()).length).toBe(total)
    expect(wholeScopeLabel(total)).toBe(`whole run · ${total} events`)
  })

  test('at a mid playhead the revealed count is a strict prefix, and it equals the count of rows with tick ≤ playhead', () => {
    const playhead = 39
    const revealed = revealedEventCount(clock, playhead)
    const byTick = rows.filter(r => r.tick <= playhead).length
    expect(revealed).toBe(byTick)          // the clock and the naive predicate agree — one source of truth
    expect(revealed).toBeGreaterThan(0)
    expect(revealed).toBeLessThan(total)   // a genuine strict prefix at mid-run
    // the revealed-only view returns exactly the revealed prefix (no kind/text filter)
    expect(applyView(rows, baseOpts({ revealedOnly: true, playhead })).length).toBe(revealed)
    expect(revealedScopeLabel(revealed, total)).toBe(`revealed so far · ${revealed} of ${total}`)
  })

  test('populationLabel names both counts when filtered, and just the scope count when not', () => {
    expect(populationLabel(total, total, false)).toBe(`${total} events`)
    expect(populationLabel(total, 1, true)).toBe(`${total} events · 1 shown`)
    // revealed-only + a kind filter: scopeBase is the revealed population, shown is the filtered subset
    const revealed = revealedEventCount(clock, 39)
    const shown = applyView(rows, baseOpts({ revealedOnly: true, playhead: 39, activeKinds: new Set([3]) })).length
    expect(populationLabel(revealed, shown, true)).toBe(`${revealed} events · ${shown} shown`)
  })
})

// ── the kind chips OBEY the active scope — ONE POPULATION PER VIEW: the chips count the SAME scoped set the
//    row list shows, so a revealed-so-far chip never advertises a kind's future composition through the filter UI
describe('kind chip counts (kindCounts over the scoped rows) obey the active scope', () => {
  const model = modelFor('f4_seed42')
  const rows = buildEvidenceRows(model)

  test('whole-run scope reports the FULL per-kind counts (32 / 31 / 1)', () => {
    expect(scopeRows(rows, false, 0).length).toBe(rows.length) // whole run: every row
    expect(kindCounts(scopeRows(rows, false, 0))).toEqual([
      { kind: 5, name: 'MessageSent', count: 32 },
      { kind: 6, name: 'MessageDelivered', count: 31 },
      { kind: 7, name: 'MessageDropped', count: 1 },
    ])
  })

  test('revealed-so-far at a mid playhead reports ONLY the revealed prefix per-kind counts (the ledger’s 15/14/1 at t30)', () => {
    const scoped = scopeRows(rows, true, 30)
    expect(kindCounts(scoped)).toEqual([
      { kind: 5, name: 'MessageSent', count: 15 },
      { kind: 6, name: 'MessageDelivered', count: 14 },
      { kind: 7, name: 'MessageDropped', count: 1 },
    ])
    // the one-population invariant: EVERY chip count equals the scoped row set's own per-kind count
    for (const c of kindCounts(scoped)) expect(scoped.filter(r => r.kind === c.kind).length).toBe(c.count)
    expect(scoped.length).toBeLessThan(rows.length) // a strict prefix — never the whole-run tally
    // and the scoped chip counts are a strict UNDERCOUNT of the whole-run chips (no future composition leaked)
    expect(kindCounts(scoped).find(c => c.kind === 5)!.count).toBeLessThan(32)
    expect(kindCounts(scoped).find(c => c.kind === 6)!.count).toBeLessThan(31)
  })
})

// ── prototype-hostile safety — ids/values render as literal TEXT, never resolved through an object lookup ────
describe('prototype-hostile inputs render as literal text and never index an object', () => {
  test('kindLabel resolves a real kind and falls back to `kind N` for an unknown one (own-property lookup)', () => {
    expect(kindLabel(7)).toBe('MessageDropped')
    expect(kindLabel(288)).toBe('MotionSegmentStarted')
    expect(kindLabel(999999)).toBe('kind 999999') // not in the registry → the honest fallback, never inherited
  })

  test('a field VALUE of "__proto__" renders literally (payloadText joins own strings — no object indirection)', () => {
    const hostile: EvRow = {
      seq: 0, tick: 0, kind: 5, kindName: 'MessageSent',
      fields: [{ key: 'src', value: '__proto__', full: null }, { key: 'dst', value: 'constructor', full: null }],
      text: '0 0 5 messagesent src __proto__ dst constructor',
    }
    expect(payloadText(hostile.fields)).toBe('src=__proto__  dst=constructor') // literal, not a resolved prototype member
    // the free-text matcher treats "__proto__" as a literal needle — it matches the hostile row and no other.
    expect(applyView([hostile], baseOpts({ text: '__proto__' })).length).toBe(1)
  })

  test('searching "__proto__" over real fixture rows (which never contain it) matches nothing and never throws', () => {
    const rows = buildEvidenceRows(modelFor('f4_seed42'))
    expect(() => applyView(rows, baseOpts({ text: '__proto__' }))).not.toThrow()
    expect(applyView(rows, baseOpts({ text: '__proto__' })).length).toBe(0)
    expect(applyView(rows, baseOpts({ text: 'hasOwnProperty' })).length).toBe(0)
  })
})

// ── provenance copy (the table CLAIMS nothing; it SHOWS — and says so) ─────────────────────────────────────
test('the provenance line names the mechanism: decoded rendering, no more', () => {
  expect(EVIDENCE_PROVENANCE).toBe('every row decoded from the bundle in your browser')
})

// One row is fully self-consistent: text is searchable over its own rendered fields, kindName is a string.
test('buildEvidenceRow is self-consistent: kindName is a string and the searchable text carries the rendered fields', () => {
  const model = modelFor('f4_seed42')
  const row = buildEvidenceRow(model, 0)
  expect(typeof row.kindName).toBe('string')
  expect(row.text.includes(row.kindName.toLowerCase())).toBe(true)
  for (const f of row.fields) expect(row.text.includes(f.value.toLowerCase())).toBe(true)
})
