import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '../lib/hashing'
import { DecodeError } from '../lib/bytes'
import { foldAndVerify, type VerifyResult } from './verify'

// ── THE CAMPAIGN VERIFY CORE (React-free, worker-safe, PURE) ──────────────────────────────────────────────
// The spine's per-seed verification, factored as ONE pure function so it is unit-testable WITHOUT a worker,
// a network, or a DOM (the "worker core pure-tested" contract). It recomputes a bundle's identity two ways and
// compares BOTH against the campaign catalog's pins:
//   • sha256 over the RAW bundle.det bytes  ⇔ the pinned bundle_det_sha256 (the byte-identity check the campaign
//     manifest indexes — a SHA-256, distinct from the blake3 fold);
//   • foldAndVerify's recomputed case_id/result_id ⇔ the pinned per-seed identities (the same seal fold the
//     single-run ceremony runs), AND the bundle's own trailer self-consistency (matchesTrailer).
// The bytes are read ONCE and never retained — the caller (the worker) discards them after this returns
// (hash-and-discard; no decoded model is ever built — we call foldAndVerify, NOT decodeBundle, so no RunModel /
// typed-array trajectory is materialised, which is the whole point of verify-many-without-useRun×N).

export type RunStatus = 'verified' | 'mismatch' | 'error'

// The verdict BASIS, carried explicitly so a consumer (W5) can never confuse a campaign 'verified' with a
// det-only bundle's self-consistency. 'campaign-manifest' = recomputed-and-matched against the campaign
// catalog's manifest-grade pins (the external oracle), NOT the bundle's own self-derived trailer. This is the
// A2 seal-fold discipline (verify.ts TrustVerdict) applied to a campaign: manifest-grade, never attested-only.
export type VerificationBasis = 'campaign-manifest'

// The pins a seed is verified AGAINST — sourced from the in-bundle campaign catalog (the authority), never from
// the fetched manifest. Exactly the three the catalog pins per seed.
export interface CampaignExpected {
  readonly caseId: string
  readonly resultId: string
  readonly sha256: string
}

export interface VerifyOutcome {
  status: RunStatus
  basis: VerificationBasis
  sha256Hex: string
  sha256ok: boolean
  caseIdHex: string | null   // null iff the bytes did not decode
  resultIdHex: string | null
  caseIdOk: boolean
  resultIdOk: boolean
  matchesTrailer: boolean     // the bundle's own trailer self-consistency (foldAndVerify)
  error?: { code: string; message: string }
}

// DERIVE-DON'T-TRUST — the ONE rule that maps a summary's own EVIDENCE (the recomputed flags + id hexes) to its
// RunStatus. This is the single authority every consumer reuses so none can drift: the core mints a status with
// it (below), the worker-client boundary re-derives it to REFUSE a summary whose wire label contradicts its
// evidence (a mislabelled 'verified'), and the store re-derives it to never GREEN a seed the evidence doesn't
// support. `decoded` is read from the id hexes (both are null iff the fold threw — VerifyResult.caseIdHex is a
// non-null string on success), matching the core's `fold === null` branch exactly.
//   decoded ∧ sha256ok ∧ caseIdOk ∧ resultIdOk ∧ matchesTrailer → 'verified'  (both recomputations matched the pins)
//   ¬decoded ∧ sha256ok                                          → 'error'     (certified bytes that won't fold)
//   otherwise                                                    → 'mismatch'
export function deriveRunStatus(o: Pick<VerifyOutcome,
  'sha256ok' | 'caseIdOk' | 'resultIdOk' | 'matchesTrailer' | 'caseIdHex' | 'resultIdHex'>): RunStatus {
  const decoded = o.caseIdHex !== null && o.resultIdHex !== null
  if (!decoded) return o.sha256ok ? 'error' : 'mismatch'
  return o.sha256ok && o.caseIdOk && o.resultIdOk && o.matchesTrailer ? 'verified' : 'mismatch'
}

// Recompute + compare against the expected pins. PURE and synchronous.
//   verified  ⟺ sha256ok ∧ caseIdOk ∧ resultIdOk ∧ matchesTrailer (recomputed BOTH ways, matched the pins)
//   mismatch  ⟺ decoded, but any check failed  — OR the bytes did not decode AND already fail the sha pin
//               (a tampered byte flips the sha256 and breaks a frame CRC; it is simply NOT the certified bytes)
//   error     ⟺ the bytes did not decode YET their sha256 MATCHES the pin — a genuine inconsistency (certified
//               bytes that won't fold), surfaced honestly rather than silently downgraded to 'mismatch'.
export function verifyBundleAgainstExpected(bytes: Uint8Array, expected: CampaignExpected): VerifyOutcome {
  const sha256Hex = toHex(sha256(bytes))
  const sha256ok = sha256Hex === expected.sha256

  let fold: VerifyResult | null = null
  let error: { code: string; message: string } | undefined
  try {
    fold = foldAndVerify(bytes)
  } catch (e) {
    error = { code: e instanceof DecodeError ? e.code : 'Unknown', message: e instanceof Error ? e.message : String(e) }
  }

  const caseIdHex = fold ? fold.caseIdHex : null
  const resultIdHex = fold ? fold.resultIdHex : null
  const matchesTrailer = fold ? fold.matchesTrailer : false
  const caseIdOk = caseIdHex !== null && caseIdHex === expected.caseId
  const resultIdOk = resultIdHex !== null && resultIdHex === expected.resultId

  // Status is DERIVED from the recomputed flags via the ONE shared rule (deriveRunStatus), so the worker-client
  // validation boundary and the store rollup grade a summary the SAME way the core minted it — never a second,
  // drift-prone copy of the verified/mismatch/error logic.
  const status = deriveRunStatus({ sha256ok, caseIdOk, resultIdOk, matchesTrailer, caseIdHex, resultIdHex })

  const base: VerifyOutcome = {
    status, basis: 'campaign-manifest', sha256Hex, sha256ok,
    caseIdHex, resultIdHex, caseIdOk, resultIdOk, matchesTrailer,
  }
  return error ? { ...base, error } : base
}

// ── THE VERIFY-MANY MESSAGE CONTRACT (worker ⇄ queue) ─────────────────────────────────────────────────────
// A job carries ONLY the ids that name a pinned seed — NEVER a caller-chosen url or expected pins. The worker
// RESOLVES the load URL and the expected pins from the in-bundle catalog (campaignCatalog, the authority) from
// `campaignId` + `seed`; a caller cannot submit its own bytes/pins and mint a false 'verified' (the H1 hole,
// closed at the worker boundary). `id` is the canonical decimal seed id (queue-side event/correlation).
export interface VerifyJob {
  readonly id: string
  readonly seed: number
  readonly campaignId: string
}

export interface RunTimings { fetchMs: number; verifyMs: number; totalMs: number }

// What the worker posts back per seed. Extends the pure outcome with the seed identity + timings. Small and
// flat — it carries NO decoded model (the bytes were discarded in the worker), so a 50-seed campaign holds 50
// of THESE on the main thread, never 50 decoded runs.
export interface RunSummary extends VerifyOutcome {
  id: string
  seed: number
  timings: RunTimings
}

// The single terminal 'error' RunSummary shape for every non-verified outcome that is NOT a byte-level mismatch:
// a worker REFUSAL (unknown campaign/seed — the F1 authority boundary), a fetch/IO failure, or a TRANSPORT fault
// the queue observes (dynamic-import, Worker construction, postMessage, or a crashed worker — F4). status is
// ALWAYS 'error', NEVER 'verified': a refusal or fault can never mint a green. One definition so the worker and
// the queue emit an identical shape (no drift). basis stays 'campaign-manifest' (the only basis this spine has).
export function errorSummary(
  id: string, seed: number, code: string, message: string, timings?: RunTimings,
): RunSummary {
  return {
    id, seed, status: 'error', basis: 'campaign-manifest',
    sha256Hex: '', sha256ok: false, caseIdHex: null, resultIdHex: null, caseIdOk: false, resultIdOk: false,
    matchesTrailer: false, error: { code, message },
    timings: timings ?? { fetchMs: 0, verifyMs: 0, totalMs: 0 },
  }
}
