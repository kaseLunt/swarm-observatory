import { readFileSync } from 'node:fs'
import { describe, expect, test, beforeEach } from 'vitest'
import {
  DEMO_SEED_ID, locateRecordedScalar, tamperEventStream, runTamperDemo,
  assertIntendedCascade, INTENDED_CASCADE,
  TamperDemoError, type DemoPinRow, type DemoSide, type OracleKind,
} from './tamperDemo'
import { ROBUST_F3A } from '../decode/campaignCatalog'
import { FrameTag } from '../decode/frames'
import { DETECTION_MADE, decodeEvent, decodeDetection, detectionMeasSpan } from '../decode/payloads'
import { decodeBundle } from '../decode/decodeBundle'
import { useCampaignStore } from '../state/campaignStore'
import type { RunSummary, RunStatus } from '../decode/campaignVerify'
import type { MarkKey } from './voices'

// ── W6: THE TAMPER MOMENT — the ✗ path, pure-tested over REAL seed-42 bytes ───────────────────────────────
// The demo verifies one certified bundle, flips ONE byte of a RECORDED MEASUREMENT in a clone, and re-verifies.
// These tests pin: pristine → verified (external ✓ pins beside trailer-self ○ rings); the flipped copy → mismatch
// with the EXACT per-pin cascade (event_hash ✗ → result_id ✗, everything untouched still in its earned voice);
// the flip lands in a fixed-width recorded field (a DetectionMade's meas); the CRC-repaired clone STILL passes
// decodeBundle (so the refusal is cryptographic, not structural); the demo REFUSES non-certified input (the source
// gate); and running the demo mutates NO campaign store state. Real vendored bytes — the same file the app fetches.

const SEED42 = ROBUST_F3A.seeds.find(s => s.seed === 42)!
const readSeed42 = (): Uint8Array => new Uint8Array(readFileSync('public/campaigns/robust-f3a/42/bundle.det'))
const expected = { caseId: SEED42.caseId, resultId: SEED42.resultId, sha256: SEED42.sha256 }
const rowOf = (rows: readonly DemoPinRow[], key: string): DemoPinRow => rows.find(r => r.key === key)!

describe('the byte-flip mechanics: one recorded-measurement byte, the frame CRC repaired (F1)', () => {
  test('the flip lands inside the first DetectionMade event’s meas measurement — a fixed-width recorded scalar', () => {
    const bytes = readSeed42()
    const target = locateRecordedScalar(bytes)
    // The located frame is an Event frame carrying a DetectionMade, and we tamper its `meas` measurement.
    expect(bytes[target.frameStart]).toBe(FrameTag.Event)
    expect(target.kind).toBe(DETECTION_MADE)
    expect(target.kindName).toBe('DetectionMade')
    expect(target.fieldName).toBe('meas')
    // The flip is strictly inside the frame payload, before the trailing CRC field (never the trailer/header/CRC).
    expect(target.flipOffset).toBeGreaterThanOrEqual(target.payloadStart)
    expect(target.flipOffset).toBeLessThan(target.crcStart)
  })

  test('tamperEventStream clones (the fetched original is untouched) and changes exactly one content byte + the CRC', () => {
    const bytes = readSeed42()
    const before = bytes.slice() // snapshot to prove the original is not mutated
    const t = tamperEventStream(bytes)
    expect(bytes).toEqual(before) // the fetched original is never mutated — the tamper is on a clone
    expect(t.bytes).not.toBe(bytes)
    // Exactly the flipped content byte + the 4 repaired CRC bytes differ from the original.
    const diff: number[] = []
    for (let i = 0; i < bytes.byteLength; i++) if (bytes[i] !== t.bytes[i]) diff.push(i)
    expect(diff).toContain(t.flippedOffset)
    expect(diff.filter(i => i < t.crcOffset)).toEqual([t.flippedOffset]) // one content byte before the CRC
    expect(diff.every(i => i === t.flippedOffset || (i >= t.crcOffset && i < t.crcOffset + 4))).toBe(true)
  })

  test('F1 — the CRC-repaired clone STILL passes decodeBundle (a VALID content edit → the refusal is CRYPTOGRAPHIC)', () => {
    // The whole point: the tampered clone is a fully-decodable bundle differing only in one recorded measurement,
    // so the mismatch below can ONLY be the recomputed identity, never a structural/format rejection.
    const t = tamperEventStream(readSeed42())
    expect(() => decodeBundle(t.bytes.slice().buffer)).not.toThrow()
  })

  test('PREMISE — a RAW flip (no CRC repair) breaks the frame CRC, so the demo repairs it before re-verifying', () => {
    const bytes = readSeed42()
    const target = locateRecordedScalar(bytes)
    const raw = bytes.slice()
    raw[target.flipOffset]! ^= 0xff // flip a recorded byte, do NOT repair the CRC
    // A naked flip throws at the frame CRC layer — a format-level catch, not the cryptographic recomputation.
    expect(() => decodeBundle(raw.slice().buffer)).toThrow()
    // The demo instead repairs that CRC on its OWN clone, so the clone decodes and the CRYPTOGRAPHIC identity refuses.
    const clone = tamperEventStream(bytes).bytes
    expect(() => decodeBundle(clone.slice().buffer)).not.toThrow()
  })

  test('F1 ONE-SOURCE — detectionMeasSpan (owned by the decoder) agrees with decodeDetection’s layout, not a hand constant', () => {
    // The tamper target's offset is no longer a `8 + 8 + 4` twin living beside the locator: the decoder module owns
    // the span, derived from the SAME reader walk as decodeDetection. Prove the two agree on the layout end-to-end.
    const bytes = readSeed42()
    const target = locateRecordedScalar(bytes)
    const env = decodeEvent(bytes.subarray(target.payloadStart, target.crcStart)) // the SAME DetectionMade the locator targeted
    const det = decodeDetection(env.payload)
    const span = detectionMeasSpan(env.payload)
    const dv = new DataView(env.payload.buffer, env.payload.byteOffset, env.payload.byteLength)
    // The span's offset lands EXACTLY on meas[0], and its length covers exactly the F64 values decodeDetection read.
    expect(dv.getFloat64(span.offset, true)).toBe(det.meas[0])
    expect(span.length).toBe(det.meas.length * 8)
    // The F64 immediately AFTER the span is snr_db — so the span ends precisely where meas ends (no over/undershoot).
    expect(dv.getFloat64(span.offset + span.length, true)).toBe(det.snrDb)
    // …and the locator's absolute flip offset is that decoder-owned span offset carried into the frame's inner tail.
    expect(target.flipOffset).toBe(target.payloadStart + target.payloadLen - env.payload.byteLength + span.offset)
  })

  test('F1 SEMANTIC PROOF — the mutated DetectionMade decodes with meas[0] CHANGED, subject/sensor/shape/snr UNCHANGED', () => {
    // The surgical-edit claim proven at the DECODED level (not from self-reported metadata): re-decode the tampered
    // event and compare field-by-field against the pristine one. Same frame geometry in both (only one content byte
    // + the CRC changed), so we slice the SAME frame span from each.
    const pristine = readSeed42()
    const t = tamperEventStream(pristine)
    const target = locateRecordedScalar(pristine)
    const pDet = decodeDetection(decodeEvent(pristine.subarray(target.payloadStart, target.crcStart)).payload)
    const tDet = decodeDetection(decodeEvent(t.bytes.subarray(target.payloadStart, target.crcStart)).payload)
    expect(tDet.meas[0]).not.toBe(pDet.meas[0])     // the recorded measurement VALUE changed…
    expect(tDet.meas.length).toBe(pDet.meas.length) // …but the vector SHAPE did not (a value edit, not a re-length)
    expect(tDet.subject).toBe(pDet.subject)         // subject UNCHANGED
    expect(tDet.sensor).toBe(pDet.sensor)           // sensor UNCHANGED
    expect(tDet.snrDb).toBe(pDet.snrDb)             // snr UNCHANGED
    // ONLY meas[0] among the measurement values moved — a single recorded scalar, nothing else in the vector.
    for (let i = 1; i < pDet.meas.length; i++) expect(tDet.meas[i]).toBe(pDet.meas[i])
  })
})

describe('the demo verify pair: pristine → the ✓/○ chain; the flip → the per-pin mismatch cascade', () => {
  test('PREMISE — the real vendored seed-42 bytes are the certified bytes (sha256 == the catalog pin)', () => {
    // The demo verifies the SAME file the app fetches; its sha256 is pinned, so pristine MUST verify.
    expect(DEMO_SEED_ID).toBe('42')
    const demo = runTamperDemo(readSeed42(), expected)
    expect(demo.pristine.status).toBe('verified')
  })

  test('F3 — pristine: trailer-self rows wear the ○ self-consistent ring; external pins wear the ✓', () => {
    const demo = runTamperDemo(readSeed42(), expected)
    const mark = (k: string): string => rowOf(demo.pristine.rows, k).mark
    // Externally-pinned matches earn the manifest-grade ✓ (catalog-pin / byte-identity).
    expect(mark('result_id')).toBe('verified')
    expect(mark('case_id')).toBe('verified')
    expect(mark('bundle_sha256')).toBe('verified')
    // Trailer-self matches earn the ○ ring — they reproduce the bundle's OWN sealed value, never external agreement.
    expect(mark('event_hash')).toBe('selfConsistent')
    expect(mark('state_trajectory_hash')).toBe('selfConsistent')
    expect(mark('event_count')).toBe('selfConsistent')
    expect(mark('tick_count')).toBe('selfConsistent')
    // No pin is a mismatch or an unverifiable on the certified side.
    expect(demo.pristine.rows.every(r => r.mark === 'verified' || r.mark === 'selfConsistent')).toBe(true)
    expect(demo.pristine.rows.map(r => r.key)).toEqual(
      ['event_hash', 'result_id', 'bundle_sha256', 'case_id', 'state_trajectory_hash', 'event_count', 'tick_count'])
  })

  test('tampered: status mismatch, and event_hash ✗ CASCADES to result_id ✗ (bundle sha ✗ too)', () => {
    const demo = runTamperDemo(readSeed42(), expected)
    expect(demo.tampered.status).toBe('mismatch')
    // The three that go red — the cascade: content re-hashed (event_hash) → identity preimages it (result_id) →
    // these are not the certified bytes (bundle sha-256).
    expect(rowOf(demo.tampered.rows, 'event_hash').mark).toBe('mismatch')
    expect(rowOf(demo.tampered.rows, 'result_id').mark).toBe('mismatch')
    expect(rowOf(demo.tampered.rows, 'bundle_sha256').mark).toBe('mismatch')
  })

  test('tampered: the untouched fields keep their EARNED voice — the recomputation is SURGICAL, not a blanket refusal', () => {
    const demo = runTamperDemo(readSeed42(), expected)
    // case_id (catalog-pin, untouched) stays ✓; the state trajectory hash and both counts (trailer-self, untouched)
    // stay ○ — only the event-derived chain diverges.
    expect(rowOf(demo.tampered.rows, 'case_id').mark).toBe('verified')
    expect(rowOf(demo.tampered.rows, 'state_trajectory_hash').mark).toBe('selfConsistent')
    expect(rowOf(demo.tampered.rows, 'event_count').mark).toBe('selfConsistent')
    expect(rowOf(demo.tampered.rows, 'tick_count').mark).toBe('selfConsistent')
    // Exactly three ✗ rows, four still-agreeing — the honest, focused picture.
    expect(demo.tampered.rows.filter(r => r.mark === 'mismatch').map(r => r.key).sort())
      .toEqual(['bundle_sha256', 'event_hash', 'result_id'])
  })

  test('each row names its ORACLE (compared-to-what) — byte-identity / trailer-self / catalog-pin', () => {
    const demo = runTamperDemo(readSeed42(), expected)
    expect(rowOf(demo.tampered.rows, 'bundle_sha256').oracle).toBe('byte-identity')
    expect(rowOf(demo.tampered.rows, 'event_hash').oracle).toBe('trailer-self')
    expect(rowOf(demo.tampered.rows, 'result_id').oracle).toBe('catalog-pin')
  })
})

describe('the source gate + fail-closed (F2 — premise-first, never an inverted overclaim)', () => {
  test('SOURCE GATE — runTamperDemo REFUSES non-certified input (already-tampered bytes) with a typed error', () => {
    // A valid but NON-certified clone (one recorded byte changed, CRC repaired) decodes structurally…
    const alreadyTampered = tamperEventStream(readSeed42()).bytes
    expect(() => decodeBundle(alreadyTampered.slice().buffer)).not.toThrow()
    // …but the demo REFUSES it: the tamper is involutive, so running on non-pristine input would let the second
    // flip RESTORE certified content (an inverted overclaim). The source gate throws instead.
    let err: unknown
    try { runTamperDemo(alreadyTampered, expected) } catch (e) { err = e }
    expect(err).toBeInstanceOf(TamperDemoError)
    expect((err as TamperDemoError).code).toBe('source-not-verified')
  })

  test('REGRESSION — an already-flipped input produces NO result (it refuses; it never inverts the columns)', () => {
    // With the old involutive bug this input would have verified the "flipped" column while the "published" column
    // mismatched — the exact inversion. Now it never returns a result at all.
    const alreadyTampered = tamperEventStream(readSeed42()).bytes
    expect(() => runTamperDemo(alreadyTampered, expected)).toThrow(TamperDemoError)
  })

  test('the gate LETS CERTIFIED input through — pristine verifies and the tampered cascade lands', () => {
    const demo = runTamperDemo(readSeed42(), expected)
    expect(demo.pristine.status).toBe('verified')
    expect(demo.tampered.status).toBe('mismatch')
  })
})

describe('the cascade gate is the COMPLETE mark-set — a partial refusal or a broader anomaly is refused (F2)', () => {
  // A tampered DemoSide wearing EXACTLY the intended cascade (INTENDED_CASCADE, status mismatch). Each negative test
  // perturbs ONE thing and expects a typed cascade-anomaly. Oracles mirror analyzeSide; the gate grades on
  // (status, row-set, per-pin mark), so this is the same mark-set the real tampered side must produce.
  const ORACLE: Record<string, OracleKind> = {
    event_hash: 'trailer-self', result_id: 'catalog-pin', bundle_sha256: 'byte-identity', case_id: 'catalog-pin',
    state_trajectory_hash: 'trailer-self', event_count: 'trailer-self', tick_count: 'trailer-self',
  }
  const intendedSide = (
    opts: { marks?: Record<string, MarkKey>; status?: RunStatus; extraRow?: DemoPinRow; dropKey?: string } = {},
  ): DemoSide => {
    let rows: DemoPinRow[] = Object.entries(INTENDED_CASCADE)
      .filter(([key]) => key !== opts.dropKey)
      .map(([key, mark]) => ({ key, label: key, oracle: ORACLE[key] ?? 'trailer-self', mark: opts.marks?.[key] ?? mark }))
    if (opts.extraRow) rows = [...rows, opts.extraRow]
    return { status: opts.status ?? 'mismatch', rows }
  }
  const anomalyCode = (side: DemoSide): unknown => {
    let err: unknown
    try { assertIntendedCascade(side) } catch (e) { err = e }
    return err
  }

  test('the EXACT intended mark-set (mismatch overall, seven pins each in its earned voice) is ACCEPTED', () => {
    expect(() => assertIntendedCascade(intendedSide())).not.toThrow()
    // Sanity: the real tampered side IS this mark-set (so the gate the demo runs and this fixture agree).
    const demo = runTamperDemo(readSeed42(), expected)
    for (const [key, mark] of Object.entries(INTENDED_CASCADE))
      expect(demo.tampered.rows.find(r => r.key === key)?.mark).toBe(mark)
  })

  test('MISSING SHA DIVERGENCE — bundle_sha256 still ✓ (a partial refusal) → cascade-anomaly', () => {
    const err = anomalyCode(intendedSide({ marks: { bundle_sha256: 'verified' } }))
    expect(err).toBeInstanceOf(TamperDemoError)
    expect((err as TamperDemoError).code).toBe('cascade-anomaly')
  })

  test('BROADER ANOMALY — an untouched trailer-self row ALSO diverged (state_trajectory_hash ✗) → cascade-anomaly', () => {
    const err = anomalyCode(intendedSide({ marks: { state_trajectory_hash: 'mismatch' } }))
    expect(err).toBeInstanceOf(TamperDemoError)
    expect((err as TamperDemoError).code).toBe('cascade-anomaly')
  })

  test('UNVERIFIABLE WHERE A RING IS EXPECTED — event_count collapsed to the ? unverifiable → cascade-anomaly', () => {
    const err = anomalyCode(intendedSide({ marks: { event_count: 'unverifiable' } }))
    expect(err).toBeInstanceOf(TamperDemoError)
    expect((err as TamperDemoError).code).toBe('cascade-anomaly')
  })

  test('OVERALL STATUS not mismatch (a verified side that reddened no pins) → cascade-anomaly', () => {
    expect(() => assertIntendedCascade(intendedSide({ status: 'verified' }))).toThrow(TamperDemoError)
  })

  test('AN UNEXPECTED EXTRA ROW (row-set larger than the intended seven) → cascade-anomaly', () => {
    const extra: DemoPinRow = { key: 'phantom', label: 'phantom', oracle: 'trailer-self', mark: 'mismatch' }
    expect(() => assertIntendedCascade(intendedSide({ extraRow: extra }))).toThrow(TamperDemoError)
  })

  test('A MISSING PIN ROW (fewer than the intended seven) → cascade-anomaly', () => {
    expect(() => assertIntendedCascade(intendedSide({ dropKey: 'case_id' }))).toThrow(TamperDemoError)
  })
})

describe('store isolation (the honesty rail): running the demo mutates NO campaign state', () => {
  const HEX = 'a'.repeat(64)
  const verifiedSummary = (id: string, seed: number): RunSummary => ({
    id, seed, status: 'verified', basis: 'campaign-manifest',
    sha256Hex: HEX, sha256ok: true, caseIdHex: HEX, resultIdHex: HEX,
    caseIdOk: true, resultIdOk: true, matchesTrailer: true,
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  })

  beforeEach(() => { useCampaignStore.getState().reset() })

  test('PREMISE-FIRST — a mid-session store (a landed ✓ over 3 seeds) is byte-for-byte unchanged after the demo runs', () => {
    // Seed a session with real evidence: 3 pending, one recomputed ✓. This is the state the demo must not touch.
    useCampaignStore.getState().init(['42', '43', '44'])
    useCampaignStore.getState().record(verifiedSummary('42', 42))
    const before = JSON.stringify(useCampaignStore.getState().rollup)
    const phaseBefore = JSON.stringify(useCampaignStore.getState().phase)
    expect(useCampaignStore.getState().rollup.verified).toBe(1)

    // Run the WHOLE demo — a real verify + a real tamper + a real re-verify.
    const demo = runTamperDemo(readSeed42(), expected)
    expect(demo.tampered.status).toBe('mismatch') // the demo really produced its contradiction…

    // …and the campaign store is byte-for-byte unchanged — the tampered verdict never entered the rollup/census.
    expect(JSON.stringify(useCampaignStore.getState().rollup)).toBe(before)
    expect(JSON.stringify(useCampaignStore.getState().phase)).toBe(phaseBefore)
    expect(useCampaignStore.getState().rollup.verified).toBe(1)     // still 1 — no demo ✓ leaked in
    expect(useCampaignStore.getState().rollup.mismatched).toBe(0)   // and NO demo ✗ leaked into the census
  })
})
