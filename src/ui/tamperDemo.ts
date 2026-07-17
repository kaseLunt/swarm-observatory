import { crc32c } from '../lib/crc32c'
import { FILE_HEADER_LEN, FrameTag } from '../decode/frames'
import { decodeEvent, decodeDetection, detectionMeasSpan, DETECTION_MADE, EVENT_KIND_NAMES } from '../decode/payloads'
import { decodeBundle } from '../decode/decodeBundle'
import { foldAndVerify, type VerifyResult } from '../decode/verify'
import {
  verifyBundleAgainstExpected, type CampaignExpected, type RunStatus,
} from '../decode/campaignVerify'
import type { MarkKey } from './voices'

// ── THE TAMPER MOMENT — the ✗ path, made demonstrable (v0.8) ─────────────────────────────────────────
// Every shipped bundle verifies GREEN, so a visitor never SEES the refusal machinery work — the most
// retellable ten seconds for a skeptic ("flip one byte, watch it fail") was undemonstrable. This is the pure,
// React-free, worker-free core of a Wall demo that makes it demonstrable HONESTLY: it verifies one certified
// bundle's pristine bytes (→ the real 'verified'), flips ONE byte of a RECORDED MEASUREMENT in a browser-memory
// CLONE, and re-verifies the SAME bytes-minus-that-flip (→ a real 'mismatch', honestly earned by real
// recomputation over really-tampered bytes). It renders the two per-pin chains side by side.
//
// ── THE BYTE WE FLIP, AND WHY IT IS A VALID CONTENT EDIT (the guiding lens, filed in-code) ──────────────────────
//   • The flip must land inside a KNOWN FIXED-WIDTH INNER DATA FIELD — a value the ENGINE RECORDED — so the
//     tampered clone is a fully-VALID bundle that decodes end-to-end (decodeBundle), differing from the
//     certified bytes only in one recorded measurement. That is the point we want to show: a VALID content edit
//     refused CRYPTOGRAPHICALLY (a recomputed identity diverged), not a STRUCTURAL/format rejection.
//     An earlier draft flipped the payload MIDPOINT — which for seed 42's first event lands on the envelope's
//     inner-LENGTH field, making the bytes structurally malformed (decodeBundle → MalformedPayload); only the
//     hash-only fold tolerated them, so the refusal was NOT provably cryptographic. We now decode the envelope
//     PROPERLY (decodeEvent) and target the first DetectionMade event's `meas` — its NED-meter measurement
//     position (spec-3b §11.1) — a fixed-width F64 the engine measured. FAIL LOUD (a typed TamperDemoError) if
//     no such field resolves: never a silent wrong-byte flip.
//   • Every frame carries a CRC32C the decoder VALIDATES (frames.ts), so a raw one-byte flip throws BadCrc BEFORE
//     the fold can recompute anything — a crude format-level catch, not the cryptographic recomputation we want to
//     SHOW. So the demo also repairs that frame's ordinary checksum — the trivial move a real tamperer makes to
//     slip past a cheap integrity code — and the CRYPTOGRAPHIC seal STILL refuses it. This is strictly the
//     stronger story (the seal defeats an adversary who already defeated the checksum), and it is the codebase's
//     own tampered-content-then-repair-CRC idiom (sealFold.test.ts): flip a recorded value, rewrite the frame CRC
//     so the bytes decode, watch the recomputed identity diverge. The verify CORE is unchanged — it refuses.
//
// ── THE TWO GATES THAT KEEP THE STORY HONEST (premise-first, fail-closed) ─────────────────────────────
//   • SOURCE GATE: verify the FETCHED bytes FIRST and REFUSE to run unless they are 'verified'. The tamper is an
//     involution (flip, then flip = identity), so an already-tampered or stale-but-parsable input would let the
//     second flip RESTORE certified content — "as published" would mismatch while "one byte flipped" verified,
//     an inverted overclaim. Gating the source to certified bytes makes the flip ALWAYS produce tampered content.
//   • CASCADE GATE: after tampering, require the COMPLETE intended mark-set — mismatch overall; the three cascade
//     rows red (event_hash ✗ → result_id ✗ → bundle_sha256 ✗); case_id still externally ✓; the three untouched
//     trailer-self rows still ○. Anything MORE or LESS (a partial refusal that left the sha green, or a BROADER
//     anomaly where an untouched row also diverged / a ring collapsed to ?) is a typed anomaly, never rendered.
//
// HONESTY: the demo's tampered verdict never enters the campaignStore/rollup/census (it is scoped to the Wall's
// ephemeral panel state); the copy states plainly that one recorded value of a browser-memory copy changed and
// the published bundle is untouched. This module holds ZERO glyph literals — it names semantic MarkKeys; the view
// sources every glyph from the voices module.

// A typed refusal — the demo FAILS LOUD rather than rendering a wrong-byte flip or an inverted overclaim. The
// view distinguishes these (an honest refusal) from a fetch/IO failure (a load problem) by `instanceof`.
export type TamperDemoErrorCode =
  | 'source-not-verified'  // the fetched bytes did not verify — the demo needs certified input (the source gate)
  | 'no-safe-field'        // no fixed-width recorded scalar field resolved to flip (fail-loud)
  | 'not-structural'       // the CRC-repaired clone did not fully decode — the byte was not pure content
  | 'cascade-anomaly'      // the tamper did not produce the intended event_hash → result_id refusal (fail-closed)
export class TamperDemoError extends Error {
  readonly code: TamperDemoErrorCode
  constructor(code: TamperDemoErrorCode, message: string) {
    super(message)
    this.name = 'TamperDemoError'
    this.code = code
  }
}

// The seed the demo verifies. 42 is the campaign's first pinned seed and the one the verify-all wiring already
// names in its tests; its vendored bytes are byte-identical to the catalog sha256 pin (publication.test.ts gate).
export const DEMO_SEED_ID = '42'

// The resolved tamper target: the frame geometry (to repair the CRC) + the absolute byte offset of the recorded
// scalar we flip + which event/field it names (for the honest copy). Data-driven — decoded from the real bytes,
// never a hand-guessed absolute offset.
export interface RecordedScalarTarget {
  readonly frameStart: number   // offset of the frame header (tag byte)
  readonly payloadStart: number // first payload byte (frameStart + 5)
  readonly payloadLen: number
  readonly crcStart: number     // offset of the frame's trailing CRC32C (payloadStart + payloadLen)
  readonly flipOffset: number   // absolute byte offset to flip — inside a fixed-width recorded scalar (meas F64)
  readonly kind: number         // the event kind (DetectionMade)
  readonly kindName: string     // 'DetectionMade' — for the copy
  readonly fieldName: string    // 'meas' — the recorded measurement field, for the copy
}

// Walk the frames to the FIRST DetectionMade event and resolve a byte inside its `meas` measurement (a recorded
// NED-meter F64). Frame geometry mirrors iterateFrames: header (24) then [tag(1) len(4 LE) payload(len) crc(4)];
// we decode each event ENVELOPE properly (decodeEvent) rather than guessing offsets. Because decodeEvent asserts
// the envelope consumes its whole payload, the inner data is exactly the payload's tail, so its absolute start is
// (payloadStart + payloadLen − inner.byteLength). A DetectionMade inner is `subject:U64, sensor:U64, meas:VecF64,
// snr_db:F64` (payloads.ts decodeDetection): the meas VALUES' offset is NOT hand-computed here — the decoder module
// OWNS it (detectionMeasSpan, derived from the SAME reader walk as decodeDetection), so the tamper target can never
// silently drift onto another inner field if the schema is re-vendored. decodeDetection VALIDATES that structure
// (and meas.length ≥ 1) before we trust the span. FAIL LOUD (typed) if no DetectionMade with a measurement is present.
export function locateRecordedScalar(bytes: Uint8Array): RecordedScalarTarget {
  let off = FILE_HEADER_LEN
  while (off + 5 <= bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    const payloadStart = off + 5
    const crcStart = payloadStart + len
    if (tag === FrameTag.Event) {
      const env = decodeEvent(bytes.subarray(payloadStart, crcStart))
      if (env.kind === DETECTION_MADE) {
        const det = decodeDetection(env.payload) // validates the inner layout end-to-end (throws on malformed)
        if (det.meas.length >= 1) {
          const innerAbs = payloadStart + len - env.payload.byteLength // inner is the payload's tail (remaining===0)
          const meas = detectionMeasSpan(env.payload) // the DECODER MODULE owns the span — one source with decodeDetection
          return {
            frameStart: off, payloadStart, payloadLen: len, crcStart,
            flipOffset: innerAbs + meas.offset, // the first byte of meas[0] — a recorded measurement (decoder-owned span)
            kind: env.kind, kindName: EVENT_KIND_NAMES[env.kind] ?? `kind ${env.kind}`, fieldName: 'meas',
          }
        }
      }
    }
    off = crcStart + 4
  }
  throw new TamperDemoError('no-safe-field', 'no recorded measurement field found to tamper (no DetectionMade with a measurement)')
}

// The tamper, on a CLONE of the fetched bytes (the fetched original is never mutated). Flips ONE byte of a
// recorded measurement (the first DetectionMade's `meas` position) and REPAIRS that frame's CRC32C so the bytes
// still decode (see the header note).
export interface TamperResult {
  readonly bytes: Uint8Array    // the tampered clone
  readonly flippedOffset: number
  readonly crcOffset: number
  readonly kind: number
  readonly kindName: string
  readonly fieldName: string
}

export function tamperEventStream(pristine: Uint8Array): TamperResult {
  const t = locateRecordedScalar(pristine)
  const bytes = pristine.slice() // CLONE — the fetched original is untouched (its own buffer, byteOffset 0)
  bytes[t.flipOffset]! ^= 0xff // flip one recorded-measurement byte (all eight bits — unambiguously "one byte changed")
  // Repair the frame CRC over tag+len+payload so iterateFrames does not reject on the cheap checksum (the trivial
  // adversary move); the cryptographic recomputation downstream is what refuses. crcStart == payloadStart+len.
  const crc = crc32c(bytes.subarray(t.frameStart, t.crcStart))
  new DataView(bytes.buffer, bytes.byteOffset + t.crcStart, 4).setUint32(0, crc, true)
  return { bytes, flippedOffset: t.flipOffset, crcOffset: t.crcStart, kind: t.kind, kindName: t.kindName, fieldName: t.fieldName }
}

// The CRC-repaired clone must STILL fully decode (decodeBundle runs the whole envelope + sanity walk), proving the
// refusal downstream is CRYPTOGRAPHIC (a recomputed identity diverged), not a STRUCTURAL rejection. decodeBundle
// wants an ArrayBuffer; the clone came from slice() so its buffer is exactly its bytes (byteOffset 0, exact len).
function assertStructurallyDecodes(clone: Uint8Array): void {
  // clone came from Uint8Array.prototype.slice() → a plain ArrayBuffer, exact length, byteOffset 0 (never shared).
  try { decodeBundle(clone.buffer as ArrayBuffer) }
  catch (e) {
    throw new TamperDemoError('not-structural',
      `the tampered clone did not fully decode (${e instanceof Error ? e.message : String(e)}) — the flipped byte was not pure recorded content`)
  }
}

// ── THE PER-PIN CHAIN — the sealFold idiom, campaign-native ──────────────────────────────────────────────
// A row's ORACLE names WHERE its authority comes from (an honesty rail — a skeptic asks "compared to what?"):
//   • byte-identity — the pinned bundle sha256 (the campaign catalog / published index);
//   • trailer-self  — the bundle's OWN sealed trailer (foldAndVerify.trailerPins: the recomputed value vs the
//     value the seal stored — the SAME per-field comparison ProvenancePanel renders);
//   • catalog-pin   — the certified per-seed identity (case_id / result_id) pinned in the in-bundle catalog.
export type OracleKind = 'byte-identity' | 'trailer-self' | 'catalog-pin'

// A row's MARK is the (oracle × result) verdict, NOT a flat ✓/✗ (the voices grammar): a match against an EXTERNAL pin
// (catalog-pin / byte-identity) earns the manifest-grade ✓ receipt; a match against the bundle's OWN sealed
// trailer (trailer-self) earns the ○ self-consistent RING — it reproduced a value nothing external backs, so it
// must never wear the ✓ the voices grammar reserves for external agreement. A disagreement is the ✗ mismatch; a
// pin that could not be FORMED (the fold did not run) is the ? unverifiable — never a false ✗.
function rowMark(oracle: OracleKind, formed: boolean, matched: boolean): MarkKey {
  if (!formed) return 'unverifiable'
  if (!matched) return 'mismatch'
  return oracle === 'trailer-self' ? 'selfConsistent' : 'verified'
}

export interface DemoPinRow {
  readonly key: string
  readonly label: string
  readonly oracle: OracleKind
  readonly mark: MarkKey // one of: verified | selfConsistent | mismatch | unverifiable
}

// One verified side: the REAL campaign status (the same verdict verify-all mints per seed) + the per-pin chain.
export interface DemoSide {
  readonly status: RunStatus
  readonly rows: readonly DemoPinRow[]
}

export interface TamperDemoResult {
  readonly pristine: DemoSide
  readonly tampered: DemoSide
  readonly flippedOffset: number      // the absolute byte offset flipped (reported in the honesty copy)
  readonly crcOffset: number
  readonly kind: number
  readonly kindName: string           // 'DetectionMade' — named in the copy
  readonly fieldName: string          // 'meas' — the recorded measurement field, named in the copy
}

// Analyze ONE side's bytes against the catalog pins. Uses verifyBundleAgainstExpected (THE campaign verify core —
// the demo's verdict is byte-identical to verify-all's per-seed verdict) for the status + catalog-pin/byte-identity
// flags, and folds ONCE more for the per-FIELD trailerPins the flat VerifyOutcome does not carry. Two folds on one
// bundle in a one-click demo is immaterial; reusing the real core is what keeps the demo honest.
function analyzeSide(bytes: Uint8Array, expected: CampaignExpected): DemoSide {
  const outcome = verifyBundleAgainstExpected(bytes, expected)
  let fold: VerifyResult | null
  try { fold = foldAndVerify(bytes) } catch { fold = null } // tampered bytes decode (CRC repaired); guard is defensive
  const tp = fold?.trailerPins
  const foldFormed = tp !== undefined
  const row = (key: string, label: string, oracle: OracleKind, formed: boolean, matched: boolean): DemoPinRow =>
    ({ key, label, oracle, mark: rowMark(oracle, formed, matched) })
  // Ordered as a CAUSAL chain: the tamper lands on event_hash, cascades into result_id, then the byte-identity
  // check — the three that go red on the tampered side, adjacent at the top — followed by the untouched fields
  // that prove the recomputation is surgical (it caught exactly the changed field, nothing else). The trailer-self
  // rows wear the ○ ring (they reproduce the bundle's OWN sealed value); the catalog/byte-identity rows the ✓.
  const rows: DemoPinRow[] = [
    row('event_hash', 'event_hash', 'trailer-self', foldFormed, tp?.eventHash ?? false),
    row('result_id', 'result_id', 'catalog-pin', outcome.resultIdHex !== null, outcome.resultIdOk),
    row('bundle_sha256', 'bundle sha-256', 'byte-identity', true, outcome.sha256ok),
    row('case_id', 'case_id', 'catalog-pin', outcome.caseIdHex !== null, outcome.caseIdOk),
    row('state_trajectory_hash', 'state_trajectory_hash', 'trailer-self', foldFormed, tp?.stateTrajectoryHash ?? false),
    row('event_count', 'event_count', 'trailer-self', foldFormed, tp?.eventCount ?? false),
    row('tick_count', 'tick_count', 'trailer-self', foldFormed, tp?.tickCount ?? false),
  ]
  return { status: outcome.status, rows }
}

// The COMPLETE per-pin mark-set a SURGICAL tamper of one recorded measurement MUST produce — nothing more, nothing
// less. The old gate accepted ANY mismatch that merely reddened event_hash + result_id, so a PARTIAL refusal (the
// sha still green) or a BROADER anomaly (an untouched trailer-self row also diverged, or a ring collapsed to the ?
// unverifiable) slipped through fail-closed. This pins EVERY row to its earned voice: the three cascade rows red
// (content re-hashed → identity preimages it → not the certified bytes), case_id still externally ✓, and the three
// untouched trailer-self rows still ○ (the surgical edit touched none of them). Sourced ONCE, so the gate and the
// tests grade the tampered side the same way and cannot drift.
export const INTENDED_CASCADE: Readonly<Record<string, MarkKey>> = {
  event_hash: 'mismatch',            // trailer-self — the tampered content re-hashes to a different event_hash
  result_id: 'mismatch',             // catalog-pin  — event_hash preimages result_id, so the identity diverges
  bundle_sha256: 'mismatch',         // byte-identity — these are simply not the certified bytes
  case_id: 'verified',               // catalog-pin  — untouched; still matches the external pin (surgical)
  state_trajectory_hash: 'selfConsistent', // trailer-self — untouched; reproduces the bundle's own sealed value
  event_count: 'selfConsistent',     // trailer-self — untouched
  tick_count: 'selfConsistent',      // trailer-self — untouched
}

// The tampered side must show EXACTLY the intended cascade (INTENDED_CASCADE) — mismatch overall, every pin in its
// earned voice, the row set exactly these keys (no missing pin, no unexpected extra row). Anything else (a flip that
// did not fully land, a bundle that verified anyway, a broader corruption) is a typed anomaly, never a demo.
export function assertIntendedCascade(side: DemoSide): void {
  const anomaly = (detail: string): never => {
    throw new TamperDemoError('cascade-anomaly', `the tamper did not produce the intended cascade (${detail})`)
  }
  if (side.status !== 'mismatch') anomaly(`overall status is '${side.status}', expected 'mismatch'`)
  const keys = Object.keys(INTENDED_CASCADE)
  if (side.rows.length !== keys.length) anomaly(`${side.rows.length} pin rows, expected exactly ${keys.length}`)
  for (const [key, want] of Object.entries(INTENDED_CASCADE)) {
    const row = side.rows.find(r => r.key === key)
    if (!row) anomaly(`missing pin row '${key}'`)
    else if (row.mark !== want) anomaly(`pin '${key}' is '${row.mark}', expected '${want}'`)
  }
}

// Run the whole demo over one bundle's pristine bytes + its catalog pins: GATE the source (verify pristine and
// refuse non-certified input), tamper a clone, assert the clone STILL structurally decodes (the refusal is
// cryptographic, not structural) BEFORE analyzing it, verify the tampered clone, and require the intended cascade.
// PURE — never touches the campaign store (the isolation rail).
export function runTamperDemo(pristine: Uint8Array, expected: CampaignExpected): TamperDemoResult {
  // SOURCE GATE — the tamper is involutive, so it must only ever run on CERTIFIED bytes. Verify FIRST; refuse
  // otherwise, so the flip always produces tampered content (never restores a stale/pre-tampered input).
  const pristineSide = analyzeSide(pristine, expected)
  if (pristineSide.status !== 'verified')
    throw new TamperDemoError('source-not-verified', 'the fetched bytes did not verify — the demo needs certified input')

  const t = tamperEventStream(pristine)

  // STRUCTURAL PRECONDITION — assert the CRC-repaired clone still passes decodeBundle BEFORE asserting the
  // identity mismatch, so the refusal is provably CRYPTOGRAPHIC (a recomputed identity diverged), not structural.
  assertStructurallyDecodes(t.bytes)

  const tamperedSide = analyzeSide(t.bytes, expected)
  assertIntendedCascade(tamperedSide) // FAIL-CLOSED — only the intended cascade renders

  return {
    pristine: pristineSide,
    tampered: tamperedSide,
    flippedOffset: t.flippedOffset,
    crcOffset: t.crcOffset,
    kind: t.kind,
    kindName: t.kindName,
    fieldName: t.fieldName,
  }
}
