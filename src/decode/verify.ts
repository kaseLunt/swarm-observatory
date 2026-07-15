import { CTX, createDeriveHasher, deriveHash, toHex } from '../lib/hashing'
import { DecodeError } from '../lib/bytes'
import { FrameTag, iterateFrames } from './frames'
import { decodeTrailer, type Trailer } from './payloads'
import type { RunManifest } from './manifest'

// F2 — the PER-FIELD trailer comparisons matchesTrailer aggregates, surfaced so a consumer can grade a SINGLE
// field from its OWN in-bundle reproduction instead of the aggregate: a det-only bundle whose stored event_hash
// is corrupt reds the event_hash ROW (not a blanket, field-less refusal), and the ceremony's event_hash row
// stays ✓ when only the state hash's trailer-stored value is off. These are exactly the four fields foldAndVerify
// recomputes AND compares to the trailer. case_id + termination_reason are trailer-SOURCED inputs to result_id
// (never recomputed against anything), and the trailer stores no result_id, so none of those three carries a
// comparison here — the manifest is their only oracle (comparableManifestPins), det-only leaves them unchecked.
export interface TrailerPins { eventHash: boolean; stateTrajectoryHash: boolean; eventCount: boolean; tickCount: boolean }

export interface VerifyResult {
  eventHashHex: string; stateHashHex: string; resultIdHex: string; caseIdHex: string
  eventCount: number; tickCount: number; terminationReason: number; matchesTrailer: boolean
  trailerPins: TrailerPins
}

const TAG = (t: number) => Uint8Array.of(t)

export function foldAndVerify(bytes: Uint8Array): VerifyResult {
  const E = createDeriveHasher(CTX.EVENT)
  const S = createDeriveHasher(CTX.STATE)
  let eventCount = 0
  let stateFrames = 0
  let trailer: Trailer | null = null
  for (const f of iterateFrames(bytes)) {
    if (f.tag === FrameTag.Event) { E.update(TAG(1)); E.update(f.payload); eventCount++ }
    else if (f.tag === FrameTag.StateTick) { S.update(TAG(2)); S.update(f.payload); stateFrames++ }
    else trailer = decodeTrailer(f.payload)
  }
  if (!trailer) throw new DecodeError('TruncatedFrame', 'no trailer')
  const tickCount = stateFrames - 1 // State[0] initial + one per tick (§3.3)
  const eventHash = E.digest()
  const stateHash = S.digest()

  const pre = new Uint8Array(1 + 32 * 3 + 8 + 8 + 2)
  const dv = new DataView(pre.buffer)
  pre[0] = FrameTag.Trailer
  pre.set(trailer.caseId, 1); pre.set(eventHash, 33); pre.set(stateHash, 65)
  dv.setBigUint64(97, BigInt(eventCount), true)
  dv.setBigUint64(105, BigInt(tickCount), true)
  dv.setUint16(113, trailer.terminationReason, true)
  const resultId = deriveHash(CTX.RESULT, pre)

  // Scope: self-consistency of what is independently recomputable in-bundle: event/state
  // hashes + counts. termination_reason and case_id are trailer-sourced inputs to result_id
  // and are NOT verified here -- the manifest's pinned result_id is the authority that
  // catches their tamper (compared at the UI badge layer). F2: keep the four comparisons as
  // NAMED per-field booleans (trailerPins) and aggregate them into matchesTrailer, so a single
  // failing field is findable at the UI without re-deriving the comparison a second way.
  const trailerPins = {
    eventHash: toHex(eventHash) === toHex(trailer.eventHash),
    stateTrajectoryHash: toHex(stateHash) === toHex(trailer.stateTrajectoryHash),
    eventCount: eventCount === trailer.eventCount,
    tickCount: tickCount === trailer.tickCount,
  }
  const matchesTrailer =
    trailerPins.eventHash && trailerPins.stateTrajectoryHash && trailerPins.eventCount && trailerPins.tickCount

  return {
    eventHashHex: toHex(eventHash), stateHashHex: toHex(stateHash), resultIdHex: toHex(resultId),
    caseIdHex: toHex(trailer.caseId), eventCount, tickCount,
    terminationReason: trailer.terminationReason, matchesTrailer, trailerPins,
  }
}

// ── THE TRUST VERDICT — the seal fold (A2), as a DISCRIMINATED verdict ───────────────────────────────────
// The seal fold must separate three genuinely-different claims that a boolean silently collapses:
//   • 'manifest-verified' — an EXTERNAL manifest exists AND every pin it shares with the recomputed bundle
//     agrees. This is the only ✓-grade claim (recomputed-and-matched against an external oracle).
//   • 'self-consistent'   — no manifest exists (a det-only KAT). The bundle reproduces its OWN trailer, but
//     nothing external backs it, so its result_id/case_id are self-derived with no authority to compare
//     against. Honest, but NEVER the manifest-grade green — the attested voice, scoped to "trailer self-
//     consistency". A boolean `true` here made a det-only run indistinguishable from an externally-verified
//     one (the exact collapse this type exists to prevent).
//   • 'mismatch'          — the bundle failed its own trailer (matchesTrailer false) OR a manifest pin
//     disagrees. Refuses thesis/seal (as before).
//
// SINGLE-SOURCED PINS (comparableManifestPins): matchesTrailer verifies only what is recomputable in-bundle
// (event/state hashes + counts vs the TRAILER); it does NOT compare the MANIFEST's pins. A manifest whose
// event_hash was corrupted (bundle bytes clean → matchesTrailer TRUE) would slip past a result_id+case_id-only
// fold while ProvenancePanel painted that row red — green beside red, surviving one field over. So the fold
// reduces the SAME per-pin comparison list ProvenancePanel renders row-by-row: one list, two consumers, no
// second list to drift. Every manifest pin independently comparable to the recomputed result is folded — the
// event/state hashes, the counts, termination_reason, result_id and case_id — so any pin the panel flags red is
// a pin the fold refuses (folding result_id alone would miss a manifest that lies about a field result_id does
// not preimage, e.g. its own event_hash or counts).
export type TrustVerdict = 'manifest-verified' | 'self-consistent' | 'mismatch'

// The manifest pins that are independently comparable to the recomputed bundle result. THE ONE list — the
// trust fold reduces it and ProvenancePanel renders each entry as a row badge, so they cannot disagree.
export type ManifestPins = Pick<RunManifest,
  'caseId' | 'resultId' | 'eventHash' | 'stateTrajectoryHash' | 'eventCount' | 'tickCount' | 'terminationReason'>
export interface ManifestPinComparison { key: string; expected: string; actual: string; match: boolean }
export function comparableManifestPins(v: VerifyResult, m: ManifestPins): ManifestPinComparison[] {
  const pins: [string, string, string][] = [
    ['case_id', m.caseId, v.caseIdHex],
    ['result_id', m.resultId, v.resultIdHex],
    ['event_hash', m.eventHash, v.eventHashHex],
    ['state_trajectory_hash', m.stateTrajectoryHash, v.stateHashHex],
    ['event_count', String(m.eventCount), String(v.eventCount)],
    ['tick_count', String(m.tickCount), String(v.tickCount)],
    ['termination_reason', String(m.terminationReason), String(v.terminationReason)],
  ]
  return pins.map(([key, expected, actual]) => ({ key, expected, actual, match: expected === actual }))
}

export function verdictAgainstManifest(v: VerifyResult, m: ManifestPins | null): TrustVerdict {
  if (!v.matchesTrailer) return 'mismatch'
  if (m === null) return 'self-consistent'
  return comparableManifestPins(v, m).every(p => p.match) ? 'manifest-verified' : 'mismatch'
}
