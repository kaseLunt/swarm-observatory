// ── THE COMMS EXECUTOR — the pairing self-consistency check for f4 (the ○ arm's live leg) ────────────────────
// The comms lens's ONE recomputed class is the send↔outcome PAIRING: every outcome matched to a send by its
// `msg` id, and INDEPENDENTLY every outcome's causation edge resolved to that same send. Two readings of the
// bytes that agree — DECODED-CONSISTENCY, so it earns the ○ self-consistent ring (no external oracle), NEVER
// the manifest-grade ✓. This module is that check's EXECUTOR: it publishes the capability the boot guard
// resolves the declared arm against, and it MINTS the branded AgreementResult the strip's mark resolver
// demands — a lens cannot fabricate the ○ (the AgreementResult brand carries lib/brand's private symbol, so
// the summary cannot be written as static registration data).
//
// LEAF: TYPES + one capability value + one branded mint. The sole edge (CommsData) is TYPE-ONLY, erased under
// verbatimModuleSyntax — the decoder/model runtime never rides into this surface (the sensingMath discipline).
import type { AgreementResult, AgreeCapability } from './agreeSource'
import type { CommsData } from './commsStage'

// ── The capability THIS executor backs — a decoded-consistency token, no live-inputs forms ──────────────────
// The pairing is a self-consistency check with NO independent re-derivation (there is no external oracle that
// pins the pairing), so this executor backs the `comms:pairing-vs-causation-vs-endpoints` DecodedToken and NO
// forms — a THREE-reading decoded self-check (msg-id pairing · causation edges · delivered src/dst endpoints). A
// declared live-inputs arm naming a comms form would fail the boot guard, honestly: this executor backs none.
export const COMMS_AGREE_CAPABILITY: AgreeCapability = {
  forms: {},
  decoded: ['comms:pairing-vs-causation-vs-endpoints'],
}

// The pairing summary this executor RAN — the three independent readings and whether they all agree.
export interface CommsPairingSummary {
  paired: boolean       // every outcome matched a send by msg id (and no orphan outcome)
  causationOk: boolean  // every outcome's causation edge resolved to its send
  endpointOk: boolean   // every delivered receipt's own src/dst matched its send's endpoints (a drop has none)
  agreed: boolean       // ALL THREE — the ring is earned only when every reading points the same way
}

// THE MINT — this executor evaluated the two decoded readings, so it (and only it) brands the outcome an
// AgreementResult. The strip resolves the verdict THROUGH recomputedVerdict(arm, agreed): an actual disagreement
// wears the mismatch mark, a full agreement the self-consistent ring (decoded-consistency), never a manifest-
// verified check. (This `as AgreementResult` is the ONLY brand mint in this file — the brand-mint sweep
// allowlists it.)
//
// THE ALPHABET RULE (matching the query/sensing precedent for an UNFORMED check — an unformed comparison earns a
// no-verdict voice, never a false mismatch): a merely INCOMPLETE mapping (a send whose outcome is missing, with
// NO actual disagreement) is an unformed comparison → agreed is NULL (no comparison ran). Only an ACTUAL
// disagreement — an orphan/duplicate outcome, a causation edge that conflicts with the msg-id pairing, or a
// delivered receipt whose endpoints contradict its send — is branded false (the mismatch); a full agreement (all
// three readings agree) is branded true (the ring).
export function checkPairing(data: CommsData): { summary: CommsPairingSummary; agreed: AgreementResult<boolean> | null } {
  const anomalies = data.orphanOutcomes.length + data.duplicateOutcomes.length
    + data.pairs.filter(p => !p.causationOk || !p.endpointOk).length
  const agreedBool = data.consistent // the bijection AND causation AND endpoints all agree
  const summary: CommsPairingSummary = { paired: data.allPaired, causationOk: data.allCausationOk, endpointOk: data.allEndpointsOk, agreed: agreedBool }
  if (!agreedBool && anomalies === 0) return { summary, agreed: null } // unformed — incomplete, no disagreement
  return { summary, agreed: agreedBool as AgreementResult<boolean> }
}
