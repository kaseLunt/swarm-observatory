import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PROV_GROUPS, provenanceFooter, provenanceRows } from './provenanceFormat'
import { badgeMark, caveatNote, QUALITY_MARK } from './voices'
import { pinTick } from './ceremonyFormat'
import { comparableManifestPins, foldAndVerify, verdictAgainstManifest, type VerifyResult } from '../decode/verify'
import { FILE_HEADER_LEN, FrameTag } from '../decode/frames'
import { crc32c } from '../lib/crc32c'
import type { RunManifest } from '../decode/manifest'

// the ProvenancePanel must render a VISIBLE comparison row for every comparable pin (counts included) and
// its footer must speak the aggregate VERDICT, not bare matchesTrailer: a manifest that lies only about a count
// yields an overall mismatch, and before this fix the panel showed ZERO red rows and a green "trailer consistent
// ✓" footer — it could not explain the refusal it participates in.

// A clean fold result; the clean manifest below AGREES with it (→ manifest-verified). Corrupting exactly one
// field then isolates "a manifest that lies about that field, bundle clean, matchesTrailer TRUE".
const verify: VerifyResult = {
  eventHashHex: 'a'.repeat(64), stateHashHex: 'b'.repeat(64), resultIdHex: 'c'.repeat(64), caseIdHex: 'd'.repeat(64),
  eventCount: 212, tickCount: 96, terminationReason: 1, matchesTrailer: true,
  trailerPins: { eventHash: true, stateTrajectoryHash: true, eventCount: true, tickCount: true },
}
const cleanManifest = (): RunManifest => ({
  eventSchemaVersion: 1, stateSchemaVersion: 1,
  schemaRegistryHash: 'e'.repeat(64), stateRegistryHash: 'f'.repeat(64),
  scenarioId: 'demo', seed: '42', dtUs: 125000,
  eventHash: verify.eventHashHex, stateTrajectoryHash: verify.stateHashHex, resultId: verify.resultIdHex,
  eventCount: verify.eventCount, tickCount: verify.tickCount, runComplete: true, terminationReason: verify.terminationReason,
  simTimeStartUs: '0', simTimeEndUs: '12000000',
  caseId: verify.caseIdHex, attemptId: 'att', commit: 'abc1234', dirty: false, createdAt: '2026-01-01',
})
const rowFor = (m: RunManifest | null, key: string) => provenanceRows(m, verify).find(r => r.k === key)!

describe('provenanceRows — the counts are now VISIBLE comparison rows', () => {
  test('event_count and tick_count are rendered rows in the integrity group', () => {
    expect(PROV_GROUPS.find(g => g.label === 'integrity')!.keys).toEqual(
      expect.arrayContaining(['event_count', 'tick_count']),
    )
    const keys = provenanceRows(cleanManifest(), verify).map(r => r.k)
    expect(keys).toContain('event_count')
    expect(keys).toContain('tick_count')
  })
  test('a clean manifest greens every count row (its value is the recomputed count)', () => {
    expect(rowFor(cleanManifest(), 'event_count')).toMatchObject({ val: '212', b: 'verified' })
    expect(rowFor(cleanManifest(), 'tick_count')).toMatchObject({ val: '96', b: 'verified' })
  })
  test('a manifest that lies ONLY about event_count reds ITS row — the visible red the fix adds', () => {
    const lying = { ...cleanManifest(), eventCount: verify.eventCount + 1 }
    expect(rowFor(lying, 'event_count').b).toBe('mismatch')
    // …and every OTHER pin row still greens (the lie is isolated to one field, no collateral red).
    for (const k of ['case_id', 'result_id', 'event_hash', 'state_trajectory_hash', 'tick_count', 'termination_reason'])
      expect(rowFor(lying, k).b, k).toBe('verified')
  })
  test('a det-only run (no manifest) shows the recomputed-and-trailer-checked rows self-verified, not neutral-unknown', () => {
    for (const k of ['event_hash', 'state_trajectory_hash', 'event_count', 'tick_count']) {
      const r = rowFor(null, k)
      expect(r.b, k).toBe('pending')
      expect(r.note, k).toMatch(/self-verified/)
    }
  })
  test('det-only case_id + termination_reason + result_id wear the ATTESTED voice (•), never a ○ self-check', () => {
    // case_id + termination_reason are trailer-SOURCED (read from the trailer, never recomputed); result_id is
    // DERIVED from those trailer-sourced inputs with NO in-bundle oracle. None is a self-check — a ○ ring here
    // would be an unfalsifiable derivation wearing the check glyph. All three render '•' (badge 'attested'),
    // never the ○ (badge 'pending') the genuinely trailer-reproduced hash rows earn.
    for (const k of ['case_id', 'termination_reason']) {
      const r = rowFor(null, k)
      expect(r.b, k).toBe('attested')             // • not ○ — no check glyph on a trailer-sourced value
      expect(r.note, k).not.toMatch(/self-verified/)
      expect(r.note, k).toMatch(/not recomputed/)  // 'trailer value · not recomputed'
    }
    const rid = rowFor(null, 'result_id')
    expect(rid.b).toBe('attested')                 // • not ○ — an unfalsifiable derivation must not wear the ring
    expect(rid.note).not.toMatch(/self-verified/)
    expect(rid.note).toMatch(/derived from the sealed inputs/) // the honest DERIVED voice
    expect(rid.note).toMatch(/no oracle/)
  })
})

// ── the per-row SEMANTIC MARK splits the det-only 'pending' seam (a verdict ring never lands unadjudicated) ──
// The BadgeState seam maps EVERY 'pending' to the ○ self-check. On a det-only run that collapses two different
// things: a trailer-CHECKED-and-matched row (a self-check genuinely RAN) vs a NO-CLAIM row (scenario/seed/dt/
// registries/commit/dirty — nothing recomputed, no manifest to attest). Threading an explicit `mark` per row
// keeps the ○ where it was earned and gives the no-claim rows `mark: null` (glyphless), so the module's own
// two-family law is not violated through its own seam.
describe('provenanceRows — the threaded per-row mark', () => {
  const NO_CLAIM = ['scenario', 'seed', 'dt', 'schema_registry', 'state_registry', 'commit', 'dirty']
  const TRAILER_CHECKED = ['event_hash', 'state_trajectory_hash', 'event_count', 'tick_count']

  test('PREMISE: the badge seam would ring every det-only no-claim row ○ (an unadjudicated verdict glyph)', () => {
    for (const k of NO_CLAIM) {
      const r = rowFor(null, k)
      expect(r.b, k).toBe('pending')                    // still the neutral CSS/back-compat hook…
      expect(badgeMark(r.b), k).toBe('selfConsistent')  // …which the seam maps to ○ — the latent collapse the fix undoes
    }
  })
  test('THE FIX: a det-only no-claim row carries mark=null (glyphless — no verdict ring on an unadjudicated row)', () => {
    for (const k of NO_CLAIM) expect(rowFor(null, k).mark, k).toBeNull()
    // …and it says WHY (except the assumed-dt row, which already speaks through its own 'assumed' cls + value).
    for (const k of ['scenario', 'seed', 'schema_registry', 'state_registry', 'commit', 'dirty'])
      expect(rowFor(null, k).note, k).toMatch(/no manifest claim/)
    expect(rowFor(null, 'dt').cls).toBe('assumed')
    expect(rowFor(null, 'dt').note).toBeUndefined()
  })
  test('a det-only trailer-CHECKED-and-matched row keeps the ○ self-check it earned (mark selfConsistent)', () => {
    for (const k of TRAILER_CHECKED) {
      const r = rowFor(null, k)
      expect(r.b, k).toBe('pending')
      expect(r.mark, k).toBe('selfConsistent') // the check RAN and matched — the ring is earned here
    }
  })
  test('a det-only trailer-sourced / derived row wears the attested • (mark attested), never a ○', () => {
    for (const k of ['case_id', 'termination_reason', 'result_id']) expect(rowFor(null, k).mark, k).toBe('attested')
  })
  test('a full-manifest run threads the manifest voice unchanged: meta rows • attested, recomputed pins ✓', () => {
    expect(rowFor(cleanManifest(), 'scenario').mark).toBe('attested') // a manifest CLAIM on record (•), not glyphless
    expect(rowFor(cleanManifest(), 'commit').mark).toBe('attested')
    expect(rowFor(cleanManifest(), 'event_hash').mark).toBe('verified')
    expect(rowFor(cleanManifest(), 'case_id').mark).toBe('verified')
  })
})

// ── The dirty row wears the QUALITY REGISTER — a build-hygiene disclosure, not a byte verdict ────────────────
// SANCTIONED SEMANTICS CHANGE: dirty=true used to render in the alarm voice (badge 'mismatch', the ✗), which read
// to a cold visitor like a byte-verification failure. It now joins the third register — the • attested mark + a
// caveat note + the caveat treatment — because a self-declared unclean build tree is a QUALITY fact (true, on
// record, a fitness caveat), never an integrity refusal. The alarm ✗ is reserved for a pinned value that
// DISAGREED. The caveat note text is unchanged (it was already correct); only the mark/badge/treatment moved.
// dirty=false and the absent-manifest (det-only) paths are untouched.
describe('provenanceRows — the dirty row wears the quality register: build-hygiene disclosure, not a byte verdict', () => {
  test('dirty=true wears the • attested mark + the caveat note + the caveat treatment — never the alarm ✗, never green', () => {
    const r = rowFor({ ...cleanManifest(), dirty: true }, 'dirty')
    expect(r.val).toBe('true')
    // THE MIGRATION: off the alarm badge, onto the quality register's • attested voice.
    expect(r.b).toBe('attested')          // the on-record voice — NOT the alarm 'mismatch' it used to wear
    expect(r.mark).toBe('attested')       // the threaded glyph is the • (attested), the register's ONE voice
    expect(r.mark).toBe(QUALITY_MARK)     // …and it IS the register's declared voice (single-sourced), not a coincidence
    // never-green / never-x: the register must never be confusable with EITHER integrity family.
    expect(r.b).not.toBe('verified')      // never the green ✓
    expect(r.mark).not.toBe('verified')
    expect(r.b).not.toBe('mismatch')      // never the alarm ✗
    expect(r.mark).not.toBe('mismatch')
    // DISTINCT BY TREATMENT: the row carries the SEMANTIC caveat field, off which the render resolves the
    // treatment class + this note + the • mark TOGETHER — so the row is legibly a caveat, not a plain attested
    // metadata row (commit/scenario carry no caveat field, so no treatment).
    expect(r.caveat).toBe('dirty')
    // The note is single-sourced from the register and states plainly what dirty=true is (text unchanged).
    expect(r.note).toBe(caveatNote('dirty'))
    expect(r.note).toMatch(/self-declares/)
    expect(r.note).toMatch(/build-hygiene/)
    expect(r.note).toMatch(/not a byte-verification failure/)
    // …and the CONTRACT consequence: a dirty run is non-citable under the publication contract.
    expect(r.note).toMatch(/non-citable/)
    expect(r.note).toMatch(/publication contract/)
  })
  test('dirty=false does NOT wear the caveat — it keeps its plain attested state, note, and no treatment', () => {
    const r = rowFor(cleanManifest(), 'dirty') // cleanManifest() is dirty:false
    expect(r.val).toBe('false')
    expect(r.b).toBe('attested')                            // the on-record voice, unchanged
    expect(r.note).toBe('manifest claim · not recomputed')  // the attested note, never the dirty caveat
    expect(r.note).not.toMatch(/build-hygiene/)
    expect(r.caveat).toBeUndefined()                         // no caveat field — dirty=false is not a quality caveat
  })
  test('a det-only run (absent manifest) is unchanged — the dirty row keeps its no-claim note, no caveat', () => {
    const r = rowFor(null, 'dirty')
    expect(r.b).toBe('pending')
    expect(r.mark).toBeNull()
    expect(r.note).toMatch(/no manifest claim/) // the no-claim note, exactly as before
    expect(r.note).not.toMatch(/build-hygiene/)
    expect(r.caveat).toBeUndefined()            // no manifest → no quality caveat to disclose
  })
  test('INTEGRITY STAYS INTEGRITY: a real MISMATCH row keeps the alarm ✗ while the dirty row wears the quality •', () => {
    // A dirty=true manifest that ALSO lies about event_hash: the event_hash row reds (a genuine byte-integrity
    // REFUSAL) in the SAME table where the dirty row shows its caveat. The two registers must not be confusable —
    // the mismatch row wears the ✗ family, the dirty row the • quality register, side by side.
    const rows = provenanceRows({ ...cleanManifest(), dirty: true, eventHash: 'f'.repeat(64) }, verify)
    const dirty = rows.find(r => r.k === 'dirty')!
    const eventHash = rows.find(r => r.k === 'event_hash')!
    // the integrity family keeps the alarm ✗ (a pinned value disagreed) — the register did NOT bleed onto it.
    expect(eventHash.b).toBe('mismatch')
    expect(eventHash.mark).toBe('mismatch')
    expect(eventHash.caveat).toBeUndefined()                // an integrity refusal is not a quality caveat
    // the dirty row stays the quality • + caveat EVEN beside a real red — it never borrows the alarm.
    expect(dirty.b).toBe('attested')
    expect(dirty.mark).toBe('attested')
    expect(dirty.caveat).toBe('dirty')
    // the note claims the PROCESS ("are checked independently"), true whether a check passed or failed — never a
    // "the hashes above VERIFY" outcome-claim that would contradict the red event_hash row it sits beside.
    expect(dirty.note).toMatch(/are checked independently/)
    expect(dirty.note).not.toMatch(/verify independently/)
  })
})

// ── FULL-MANIFEST, ONLY the TRAILER value corrupt: the row folds pin+trailer, agreeing with the ceremony ──
// A full-manifest run whose TRAILER stored event_hash is corrupt (frames clean → the recomputed hash still matches
// the MANIFEST pin; the bundle just failed to reproduce its OWN trailer → trailerPins.eventHash false,
// matchesTrailer false). Before the panel badged event_hash ✓ from the manifest pin ALONE while the ceremony's
// per-field pinTick painted ✗ — two surfaces disagreeing on one field. foldedBadge folds BOTH comparisons, so the
// panel now reds the row exactly where the ceremony does.
describe('provenanceRows — full-manifest, ONLY the trailer event hash corrupt: panel/ceremony agree', () => {
  const trailerCorrupt: VerifyResult = {
    ...verify, matchesTrailer: false, trailerPins: { ...verify.trailerPins, eventHash: false },
  }
  const rowB = (k: string) => provenanceRows(cleanManifest(), trailerCorrupt).find(r => r.k === k)!.b
  // The ceremony grades the event_hash row from its manifest pin AND its per-field trailer reproduction (pinTick).
  const eventPinMatch = comparableManifestPins(trailerCorrupt, cleanManifest()).find(p => p.key === 'event_hash')!.match

  test('PREMISE: the MANIFEST pin still matches the recomputed value; only the trailer reproduction failed', () => {
    expect(eventPinMatch).toBe(true)                    // recomputed === manifest.eventHash (frames + manifest clean)
    expect(trailerCorrupt.trailerPins.eventHash).toBe(false)
    expect(trailerCorrupt.matchesTrailer).toBe(false)
  })
  test('THE FIX: the panel event_hash row is ✗ (folds the failed trailer pin), not a manifest-pin-only ✓', () => {
    expect(rowB('event_hash')).toBe('mismatch')
    // the tamper is isolated: the other trailer-checked rows (clean trailer + clean manifest) stay verified…
    for (const k of ['state_trajectory_hash', 'event_count', 'tick_count']) expect(rowB(k), k).toBe('verified')
    // …and the non-trailer-checked pins (manifest clean) stay verified too.
    for (const k of ['case_id', 'result_id', 'termination_reason']) expect(rowB(k), k).toBe('verified')
  })
  test('CEREMONY AGREEMENT: the ceremony paints the SAME event_hash ✗ (pinTick folds the same trailer pin)', () => {
    expect(pinTick(eventPinMatch, trailerCorrupt.trailerPins.eventHash)).toEqual({ glyph: '✗', cls: 'mismatch' })
  })
  test('the footer refuses on the aggregate (in-bundle reproduction failed): trailer INCONSISTENT ✗', () => {
    expect(provenanceFooter(trailerCorrupt, verdictAgainstManifest(trailerCorrupt, cleanManifest()))).toContain('trailer INCONSISTENT ✗')
  })
})

// ── PREMISE-FIRST: a det-only bundle whose STORED event hash mismatches its trailer reds THAT row ───────
// Corrupt ONLY the trailer's stored event_hash (32 bytes at trailer-payload offset 32; CRC-fixed so the frame
// decodes cleanly), then fold. The recomputed event_hash (from the clean event frames) no longer matches the
// tampered trailer value → trailerPins.eventHash false → matchesTrailer false. Before the event_hash row
// still wore 'self-verified · pending' beside an aggregate mismatch and the failing field was UNFINDABLE; now it
// reds THAT row while its siblings keep their honest self-check notes. Mirrors the sealFold/verify tamper idiom.
function tamperedDetVerify(det: string, trailerPayloadOffset: number): VerifyResult {
  const bytes = new Uint8Array(readFileSync(`contract/fixtures/${det}`)).slice()
  let off = FILE_HEADER_LEN
  let trailerStart = -1
  let trailerLen = -1
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (tag === FrameTag.Trailer) { trailerStart = off; trailerLen = len; break }
    off += 5 + len + 4
  }
  // Flip one byte of the trailer's stored value at the given payload offset (5 = tag+len header).
  bytes[trailerStart + 5 + trailerPayloadOffset]! ^= 0x01
  const crcOffset = trailerStart + 5 + trailerLen
  new DataView(bytes.buffer, bytes.byteOffset + crcOffset, 4).setUint32(0, crc32c(bytes.subarray(trailerStart, crcOffset)), true)
  return foldAndVerify(bytes)
}

describe('provenanceRows — det-only, ONLY the stored event hash tampered', () => {
  const EVENT_HASH_OFFSET = 32 // trailer payload: case_id(32) then event_hash(32)
  const v = tamperedDetVerify('e0_seed42.det', EVENT_HASH_OFFSET)
  const detRow = (k: string) => provenanceRows(null, v).find(r => r.k === k)!

  test('PREMISE: the recomputed event_hash no longer matches the tampered trailer → per-field + aggregate mismatch', () => {
    expect(v.trailerPins.eventHash).toBe(false)
    expect(v.trailerPins.stateTrajectoryHash).toBe(true) // the state hash was untouched
    expect(v.matchesTrailer).toBe(false)
  })
  test('THE FIX: the event_hash row is RED (findable), no longer a false self-verified ○', () => {
    expect(detRow('event_hash').b).toBe('mismatch')
    expect(detRow('event_hash').mark).toBe('mismatch') // the threaded mark reds too — ✗, not the ○ self-check
    expect(detRow('event_hash').note).not.toMatch(/self-verified/)
  })
  test('the sibling recomputed rows keep their honest self-check notes (the tamper is isolated to one field)', () => {
    for (const k of ['state_trajectory_hash', 'event_count', 'tick_count']) {
      expect(detRow(k).b, k).toBe('pending')
      expect(detRow(k).note, k).toMatch(/self-verified/)
    }
  })
  test('the footer refuses on the aggregate: trailer INCONSISTENT ✗ (the bytes never reproduced their own trailer)', () => {
    expect(provenanceFooter(v, verdictAgainstManifest(v, null))).toContain('trailer INCONSISTENT ✗')
  })
})

describe('provenanceFooter — the voice is the aggregate VERDICT, not bare matchesTrailer', () => {
  test('PREMISE: the OLD footer (matchesTrailer only) read GREEN on a count-lie (matchesTrailer stays TRUE)', () => {
    const oldFooter = (v: VerifyResult) => `trailer ${v.matchesTrailer ? 'consistent ✓' : 'INCONSISTENT ✗'}`
    expect(verify.matchesTrailer).toBe(true)
    expect(oldFooter(verify)).toBe('trailer consistent ✓') // the green footer beside a red count row
  })
  test('THE FIX: a count-only manifest lie → verdict mismatch → the footer REFUSES (✗), never "consistent ✓"', () => {
    const lying = { ...cleanManifest(), eventCount: verify.eventCount + 1 }
    const verdict = verdictAgainstManifest(verify, lying)
    expect(verdict).toBe('mismatch')
    const footer = provenanceFooter(verify, verdict)
    expect(footer).toContain('✗')
    expect(footer).toContain('manifest mismatch')
    expect(footer).not.toContain('consistent ✓')
  })
  test('an in-bundle reproduction failure (matchesTrailer false) reads the trailer refusal, not a manifest one', () => {
    expect(provenanceFooter({ ...verify, matchesTrailer: false }, 'mismatch')).toContain('trailer INCONSISTENT ✗')
  })
  test('the footer speaks the verdict’s OWN mark — manifest-verified ✓, self-consistent ○ (superseding ✓-for-both)', () => {
    // manifest-verified keeps the trailer-consistent ✓ — the trailer IS consistent AND an external manifest backs it.
    expect(provenanceFooter(verify, verdictAgainstManifest(verify, cleanManifest()))).toBe('212 events · 96 ticks · trailer consistent ✓')
    // SUPERSEDE (the finding's own point): a det-only self-consistent run showed ○ in the ceremony/thesis but a
    // site-local ✓ here — the migration missed this seam. It now reads the ○ self-check, scoped to the trailer.
    expect(provenanceFooter(verify, 'self-consistent')).toBe('212 events · 96 ticks · trailer self-consistent ○')
  })
})
