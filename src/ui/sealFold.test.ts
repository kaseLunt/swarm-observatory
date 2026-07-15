import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  foldAndVerify, verdictAgainstManifest, comparableManifestPins,
  type VerifyResult, type ManifestPins,
} from '../decode/verify'
import { FILE_HEADER_LEN, FrameTag } from '../decode/frames'
import { crc32c } from '../lib/crc32c'
import { thesisVerdict } from './thesis'
import { shouldSealRun, shouldBreakSeal, cardVerdict } from './hangar'
import { verdictTick, trailerTick, stepMark } from './ceremonyFormat'

// ── A2 — THE SEAL FOLD, as a DISCRIMINATED verdict that keeps its voices SEPARATE ────────────────────────
// The seal fold must distinguish three genuinely-different claims a boolean collapsed:
//   • 'manifest-verified' — matched an external manifest (the only ✓-grade claim);
//   • 'self-consistent'   — a det-only run reproduced its own trailer, no external oracle (attested voice,
//     NEVER the manifest-grade green — a boolean `true` made this indistinguishable from a verified run);
//   • 'mismatch'          — a pinned hash disagreed (refuses thesis/seal).
// And the full-manifest arm must fold EVERY manifest pin comparableManifestPins lists — the SAME per-pin
// comparison ProvenancePanel renders row-by-row — so a manifest that lies about ANY one field (event_hash,
// termination_reason, case_id, …) is refused, not just result_id+case_id. Each test below is premise-first.

const readClean = (det: string): VerifyResult => foldAndVerify(new Uint8Array(readFileSync(`contract/fixtures/${det}`)))

// A manifest-pins oracle built FROM a clean fold — it AGREES with the bundle (→ manifest-verified). Corrupting
// exactly ONE field then isolates "a manifest that lies about that field, bundle bytes clean, matchesTrailer TRUE".
const cleanPins = (v: VerifyResult): ManifestPins => ({
  caseId: v.caseIdHex, resultId: v.resultIdHex, eventHash: v.eventHashHex, stateTrajectoryHash: v.stateHashHex,
  eventCount: v.eventCount, tickCount: v.tickCount, terminationReason: v.terminationReason,
})

// Reconstruct the BUNDLE-level termination_reason tamper of f0 (mirrors verify.test.ts): flip the trailer's
// termination_reason and rewrite the frame CRC so the bytes decode cleanly; the recomputed result_id then differs
// from the manifest's pin, but matchesTrailer (event/state hashes + counts vs the trailer) is untouched.
function tamperedF0Verify(): VerifyResult {
  const bytes = new Uint8Array(readFileSync('contract/fixtures/f0_seed42.det')).slice()
  let off = FILE_HEADER_LEN
  let trailerStart = -1
  let trailerLen = -1
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (tag === FrameTag.Trailer) { trailerStart = off; trailerLen = len; break }
    off += 5 + len + 4
  }
  const terminationOffset = trailerStart + 5 + trailerLen - 2
  new DataView(bytes.buffer, bytes.byteOffset + terminationOffset, 2).setUint16(0, 3, true)
  const crcOffset = trailerStart + 5 + trailerLen
  new DataView(bytes.buffer, bytes.byteOffset + crcOffset, 4).setUint32(0, crc32c(bytes.subarray(trailerStart, crcOffset)), true)
  return foldAndVerify(bytes)
}

describe('verdictAgainstManifest — a discriminated verdict, not a boolean', () => {
  test('a clean full-manifest run → manifest-verified (recomputed pins match the oracle)', () => {
    const v = readClean('f0_seed42.det')
    expect(v.matchesTrailer).toBe(true)
    expect(verdictAgainstManifest(v, cleanPins(v))).toBe('manifest-verified')
  })

  test('det-only (m === null) → self-consistent — NOT the same value as manifest-verified (the collapse fixed)', () => {
    const v = readClean('e0_seed42.det')
    expect(v.matchesTrailer).toBe(true)
    expect(verdictAgainstManifest(v, null)).toBe('self-consistent')
    // The exact H2/H3 point: "matched a manifest" and "no oracle existed" are no longer the same value.
    expect(verdictAgainstManifest(v, null)).not.toBe('manifest-verified')
    // A det-only bundle whose own trailer fails is still a mismatch (nothing external, but not self-consistent).
    expect(verdictAgainstManifest({ ...v, matchesTrailer: false }, null)).toBe('mismatch')
  })
})

// ── PREMISE-FIRST PER PIN: corrupt ONLY one manifest field (bundle clean, matchesTrailer TRUE) ────────────
// For each pin: the OLD result_id+case_id-only fold would have stayed manifest-verified (green) while
// ProvenancePanel painted that row red — green beside red, one field over. The single-sourced fold refuses,
// and the SAME comparableManifestPins the panel renders flags the SAME row (one assertion proves both).
describe('the full-manifest arm folds EVERY comparable pin (green-beside-red, closed per field)', () => {
  const v = readClean('f0_seed42.det')

  const corruptions: { pin: string; lie: (m: ManifestPins) => ManifestPins }[] = [
    { pin: 'event_hash', lie: (m) => ({ ...m, eventHash: 'f'.repeat(64) }) },
    { pin: 'termination_reason', lie: (m) => ({ ...m, terminationReason: m.terminationReason + 1 }) },
    { pin: 'case_id', lie: (m) => ({ ...m, caseId: '0'.repeat(64) }) },
  ]

  test.each(corruptions)('a manifest that lies about $pin → verdict mismatch + the SAME Provenance row flags red', ({ pin, lie }) => {
    const m = lie(cleanPins(v))
    // PREMISE: the bundle is clean — matchesTrailer holds, so a trailer-only or result_id-only fold saw nothing.
    expect(v.matchesTrailer).toBe(true)
    // THE FIX: the fold reduces comparableManifestPins, so this lie is refused.
    expect(verdictAgainstManifest(v, m)).toBe('mismatch')
    // SINGLE-SOURCED: the SAME list ProvenancePanel renders flags the SAME row red — one helper, no drift.
    const row = comparableManifestPins(v, m).find(p => p.key === pin)
    expect(row, `comparableManifestPins must carry a ${pin} row`).toBeTruthy()
    expect(row!.match).toBe(false)
    // …and every OTHER pin still matches (the lie is isolated to one field).
    for (const p of comparableManifestPins(v, m)) if (p.key !== pin) expect(p.match).toBe(true)
  })

  test.each(corruptions)('$pin lie drives NO green through thesis or seal (refused as a mismatch)', ({ lie }) => {
    const verdict = verdictAgainstManifest(v, lie(cleanPins(v)))
    const sealed = verdict !== 'mismatch' // App's seal effect derives this boolean and hands it to the predicates
    expect(thesisVerdict(verdict)).toMatchObject({ glyph: '✗', cls: 'mismatch' }) // no green headline
    expect(shouldSealRun('f0', 'f0', sealed)).toBe(false)                          // mints no seal
    expect(shouldBreakSeal('f0', 'f0', sealed)).toBe(true)                         // breaks a prior seal
    expect(verdictTick(verdict)).toMatchObject({ glyph: '✗' })                     // ceremony result_id ✗
    expect(stepMark('done', verdict)).toMatchObject({ glyph: '✗', cls: 'done mismatch' })
  })
})

describe('the BUNDLE-level termination_reason tamper (matchesTrailer stays TRUE, result_id changes)', () => {
  const v = tamperedF0Verify()
  const m = cleanPins(readClean('f0_seed42.det')) // the ORIGINAL (untampered) pins are the oracle

  test('premise: the tamper leaves event/state hashes + counts intact — a trailer-only fold saw green', () => {
    expect(v.matchesTrailer).toBe(true)
    expect(v.terminationReason).toBe(3) // the tampered value (f0's real value is 2)
  })
  test('the fold refuses the manifest mismatch (result_id folds termination_reason)', () => {
    expect(v.resultIdHex).not.toBe(m.resultId)
    expect(verdictAgainstManifest(v, m)).toBe('mismatch')
  })
  test('CEREMONY A2 picture: event_hash still ✓ (bytes reproduced) beside result_id ✗ (identity broke)', () => {
    const verdict = verdictAgainstManifest(v, m)
    expect(trailerTick(verdict, v.matchesTrailer)).toMatchObject({ glyph: '✓', cls: 'verified' })
    expect(verdictTick(verdict)).toMatchObject({ glyph: '✗', cls: 'mismatch' })
    expect(stepMark('done', verdict)).toMatchObject({ glyph: '✗', cls: 'done mismatch' })
  })
})

// ── THE PRESENTATIONAL SPLIT: a det-only (self-consistent) run NEVER wears the manifest-grade glyph ───────
describe('self-consistent renders in the ATTESTED voice across every trust surface — never the ✓ green', () => {
  const v = readClean('e0_seed42.det')
  const verdict = verdictAgainstManifest(v, null)

  test('the verdict itself is self-consistent (det-only, no external oracle)', () => {
    expect(verdict).toBe('self-consistent')
  })
  test('THESIS: ○ self-consistent, never the manifest-grade ✓ green', () => {
    const t = thesisVerdict(verdict)
    expect(t.glyph).toBe('○')
    expect(t.cls).not.toBe('verified')
  })
  test('CEREMONY: result_id + event_hash + step all ○ self-check — no ✓', () => {
    expect(verdictTick(verdict)).toMatchObject({ glyph: '○', cls: 'self' })
    expect(trailerTick(verdict, v.matchesTrailer)).toMatchObject({ glyph: '○', cls: 'self' })
    expect(stepMark('done', verdict)).toMatchObject({ glyph: '○', cls: 'done self' })
  })
  test('HANGAR SEAL: a sealed det-only card wears the attested voice (•), never state verified (✓)', () => {
    const cv = cardVerdict('e0', 'sealed') // e0 is det-only in the trusted catalog
    expect(cv.state).not.toBe('verified')
    expect(cv.state).toBe('attested')
    expect(cv.label).toMatch(/self-verified this session/i)
    expect(cv.label).toMatch(/no external oracle/i)
  })
  test('a det-only run still SEALS this session (it just renders self-check, not green) — the seal effect fires', () => {
    const sealed = verdict !== 'mismatch'
    expect(shouldSealRun('e0', 'e0', sealed)).toBe(true)
  })
})
