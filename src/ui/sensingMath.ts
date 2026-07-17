// VALUE imports come ONLY from sensingScenario (a zero-import module) — that keeps this module's runtime
// closure exactly {sensingMath.ts, sensingScenario.ts}, the set the no-transcendental scan covers (the
// SCAN-COVERAGE pin in the test file checks both halves). sensingStage is a TYPE-ONLY edge, erased at
// runtime (verbatimModuleSyntax): its runtime closure includes the decoder/model, which must never ride
// into the verification surface.
import { SENSOR_O, R2MAX, OCCLUDER_C, OCCLUDER_R2, FOV_HALF_RAD, type Vec3 } from './sensingScenario'
import type { SensingDraw } from './sensingStage'
// TYPE-ONLY (erased under verbatimModuleSyntax — the runtime closure stays {sensingMath, sensingScenario},
// the no-transcendental scan unaffected). Only the AgreeSource witness types + the branded outcome ride in.
import type { AgreementResult, AgreeCapability, InputToken } from './agreeSource'

// ── SHOW THE MATH (sensing) — the verdict-recompute layer for f2a ─────────────────────────
// A PURE, three-free module that re-derives each recomputable kind-22 gate IN THE BROWSER from the decoded
// numbers, using the PINNED decision forms (contract/EXP-F2a-scene-and-sensing-excerpt.md — operand order
// is normative, doctrine §1.6). The app already re-derives the HASHES on load; this re-derives the sensing
// DECISIONS. Display-tier only: a disagreement is surfaced in the mismatch voice, never hidden.
//
// ⚠ THE VOICE SPLIT (this lens's defining honesty). Three of the four gates are RECOMPUTABLE and wear the
// live ✓/✗ (showMath grammar): in_range (d² ≤ r²max), los_clear (sensor→target segment vs occluder Q), and
// the eligible conjunction (the AND of the three decoded components, checked against the engine's eligible
// bit). in_fov is NOT recomputable here: its threshold is a vendored-libm atan2 angle, and unlike e0's
// kind-23 the kind-22 payload stores NO bearing scalar to even display — so there are no bits to surface,
// only the decoded boolean and the pinned form, shown in the CLAIM voice. This module therefore contains NO
// trig: no atan2/sin/cos/tan ANYWHERE (a source-scan test pins it), and it never invents a bearing to fake
// an in_fov recompute. The FOV threshold rides in only as FOV_HALF_RAD (a pinned display value), never a
// decision input.

// ── pure vector arithmetic (pinned operand order, doctrine §1.6 — transcribed from E0/showMath) ──────────
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const dot = (p: Vec3, q: Vec3): number => ((p[0] * q[0]) + (p[1] * q[1])) + (p[2] * q[2])

// ── in_range (E0's point-in-ball form, instantiated for the sensor ball (O, r²max)) ─────────────────────
// dl = g − O; d² = dot(dl,dl); in_range = d² ≤ r²max; tb = in_range && (d² == r²max). sqrt-free (E0's
// certified region convention — the range scalar is neither computed nor compared).
export interface RangeRecompute { inRange: boolean; tiebreak: boolean; d2: number }
export function recomputeInRange(g: Vec3): RangeRecompute {
  const dl = sub(g, SENSOR_O)
  const d2 = dot(dl, dl)
  const inRange = d2 <= R2MAX
  return { inRange, tiebreak: inRange && d2 === R2MAX, d2 }
}

// ── los_clear (E0's ray/segment-vs-sphere form, instantiated for the sightline O→g vs occluder Q) ────────
// dir = g − O; oc = O − C; a = dot(dir,dir); b = dot(oc,dir); c = dot(oc,oc) − r²; disc = b² − a·c;
// f1 = (a + 2b) + c (the segment endpoint form). HIT ⇔ an endpoint is inside (c ≤ 0 | f1 ≤ 0) OR the
// closest approach lies on the segment with a real crossing (disc ≥ 0 && 0 ≤ −b && −b ≤ a). los_clear =
// ¬HIT. Division/sqrt-free DECISION (E0's certified segment-sphere predicate, operand order preserved).
export interface LosRecompute { losClear: boolean; hit: boolean; tiebreak: boolean }
export function recomputeLosClear(g: Vec3): LosRecompute {
  const dir = sub(g, SENSOR_O)
  const oc = sub(SENSOR_O, OCCLUDER_C)
  const a = dot(dir, dir)
  const b = dot(oc, dir)
  const c = dot(oc, oc) - OCCLUDER_R2
  const disc = (b * b) - (a * c)
  const f1 = (a + (2.0 * b)) + c
  const hit = (c <= 0.0) || (f1 <= 0.0) || ((disc >= 0.0) && (0.0 <= (-b)) && ((-b) <= a))
  return { losClear: !hit, hit, tiebreak: hit && ((disc === 0.0) || (c === 0.0) || (f1 === 0.0)) }
}

// ── eligible conjunction (F2a's composition — a pure three-way AND) ──────────────────────────────────────
// eligible = in_range && in_fov && los_clear. The CALLERS decide which legs are LIVE: sensingGates and
// recomputeAllSensing feed the LIVE-recomputed in_range and los_clear (re-derived from the decoded pose) and
// the DECODED in_fov claim (the one leg no bundle bit can independently recompute — a pinned vendored-libm
// angle), then check the composite against the engine's eligible bit. Feeding the LIVE legs (not the engine's
// own recorded component bits) is what makes this a genuine re-derivation rather than a self-consistency echo:
// an engine that lied about in_range/los_clear AND covered it by flipping eligible to stay internally
// consistent is caught here, where an echo of its own bits would only ever have agreed with itself.
export function recomputeEligible(inRange: boolean, inFov: boolean, losClear: boolean): boolean {
  return inRange && inFov && losClear
}

// ── The AgreeSource capability THIS executor's live legs actually back ───────────────────
// Tokens are DATA naming existing legs of this module — a LOOKUP TABLE the boot guard resolves against, never
// an evaluator. The eligible conjunction's inputs are exported as ONE constant so the f2a flagship
// registration and this executor cannot drift on what the LIVE conjunction really consumes: the two LIVE legs
// (in_range, los_clear — re-derived from the decoded pose) AND the in_fov leg carried as the DECODED CLAIM
// (a pinned vendored-libm angle, no bearing in the bundle to recompute). The comparand — the engine's
// eligible bit — is deliberately absent (it is a ComparandToken, un-nameable as an input: the echo exclusion).
export const ELIGIBLE_CONJUNCTION_INPUTS: readonly InputToken[] =
  ['sensing:in-range-live', 'sensing:los-clear-live', 'sensing:in-fov-claim']

// The PER-FORM witness tuples sensingMath's live legs back (one truth per form). form:in-range and
// form:los-clear each re-derive from `sensing:pose`; form:eligible-conjunction consumes exactly the three
// ELIGIBLE_CONJUNCTION_INPUTS — and its tuple IS that same exported constant (reference identity), so the
// flagship registration and this executor cannot drift on what the LIVE conjunction really consumes: the boot
// guard set-compares the declared arm against THIS tuple. No decoded-consistency check lives here, so `decoded`
// is empty (a declared decoded-consistency arm would fail the boot guard, honestly: this executor backs none).
export const SENSING_AGREE_CAPABILITY: AgreeCapability = {
  forms: {
    'form:in-range': ['sensing:pose'],
    'form:los-clear': ['sensing:pose'],
    'form:eligible-conjunction': ELIGIBLE_CONJUNCTION_INPUTS,
  },
  decoded: [],
}

// THE PER-ROW MINT — mirrors showMath's. This executor RAN the comparison, so `agrees` brands each gate's
// live agreement; the brand rides GateLine.agree to the SensingStrip's mark resolver, which DEMANDS it, so a
// plain boolean can never enter a verdict mark and the mint cannot be deleted without a compile error. Phantom
// brand, zero cost. (This `as AgreementResult` + the summary mint below are the ONLY two in this file — the brand-mint
// sweep allowlists it.)
const agrees = (matched: boolean): AgreementResult<boolean> => matched as AgreementResult<boolean>

// ── The four-gate view for the strip / Inspector (the voice split, as data) ─────────────────────────────
export type GateVoice = 'recompute' | 'claim'
export type GateId = 'in_range' | 'in_fov' | 'los_clear' | 'eligible'
export interface GateLine {
  id: GateId
  label: string            // small-caps at the consumer
  decoded: boolean         // the decoded gate bit (the lane) — always shown
  voice: GateVoice         // 'recompute' → live ✓/✗ ; 'claim' → pinned, never a ✓
  agree: AgreementResult<boolean> | null // recompute-vs-engine agreement, BRANDED per row (the executor
                           // mints it; the strip's mark resolver demands the brand). null for the claim voice
                           // or a poseless draw (no comparison was formed — nothing to brand).
  form: string             // the pinned decision form (verbatim-ish, doctrine §1.6)
  note?: string            // claim-voice note
}

// Build the four gate lines for one sensing verdict. in_range / los_clear recompute from the decoded pose g
// (null g → agree:null, the honest "cannot recompute geometry" — never a fabricated position); in_fov is
// always the claim voice; eligible is the conjunction consistency check (recomputable from decoded bits
// alone, so it never needs g).
export function sensingGates(d: SensingDraw): GateLine[] {
  const range = d.g ? recomputeInRange(d.g) : null
  const los = d.g ? recomputeLosClear(d.g) : null
  // The eligible conjunction goes LIVE on two of its three legs: it ANDs the LIVE-recomputed in_range and
  // los_clear (from the decoded pose g) with the DECODED in_fov claim, then checks that composite against the
  // engine's eligible bit. A genuine re-derivation, not an echo of the engine's own component bits. Poseless
  // (g null) → the two live legs are unavailable, so the check declines (agree null) — never a decoded-only
  // echo dressed as a live ✓, and never a fabricated pose.
  const eligibleOurs = range && los ? recomputeEligible(range.inRange, d.inFov, los.losClear) : null
  return [
    {
      id: 'in_range', label: 'in range', decoded: d.inRange, voice: 'recompute',
      agree: range ? agrees(range.inRange === d.inRange) : null,
      form: 'in_range = d² ≤ r²max',
    },
    {
      id: 'in_fov', label: 'in fov', decoded: d.inFov, voice: 'claim', agree: null,
      form: 'in_fov = |wrap(bearing − ψs)| ≤ half_fov',
      note: 'pinned vendored-libm angle — kind-22 stores no bearing to recompute; claim voice, never a live check',
    },
    {
      id: 'los_clear', label: 'los clear', decoded: d.losClear, voice: 'recompute',
      agree: los ? agrees(los.losClear === d.losClear) : null,
      form: 'los_clear = ¬(sensor→target segment hits occluder Q)',
    },
    {
      id: 'eligible', label: 'eligible', decoded: d.eligible, voice: 'recompute',
      agree: eligibleOurs === null ? null : agrees(eligibleOurs === d.eligible),
      form: 'eligible = in_range ∧ in_fov ∧ los_clear',
      note: 'conjunction recomputed live on in_range and los_clear (from the decoded pose); in_fov enters as the decoded claim (•), never a live leg',
    },
  ]
}

// The pinned FOV half-angle, formatted for the claim-voice readout (a value on record, DISPLAYED — never a
// decision input). Degrees derived by a display-tier linear scale of the pinned radians (no transcendental).
export function fovClaim(): { rad: number; deg: number } {
  return { rad: FOV_HALF_RAD, deg: (FOV_HALF_RAD * 180) / Math.PI }
}

// ── aggregate oracle: recompute EVERY event's checkable gates and count agreements (the "all 96" payoff) ─
// in_range and los_clear recompute the boolean vs the engine's (when a pose exists); the eligible conjunction
// checks the engine's eligible bit against the AND of the LIVE-recomputed in_range and los_clear with the
// decoded in_fov claim — the same genuine (not echo) re-derivation the strip shows. in_fov is NOT counted on
// its own (claim voice — no independent recompute exists). A poseful event contributes three checks; a
// poseless event contributes none (no pose ⇒ no live legs ⇒ the conjunction cannot be formed either).
export interface SensingRecomputeSummary {
  total: number
  poseless: number
  inRangeAgreed: number
  losClearAgreed: number
  conjunctionAgreed: number
  disagreements: number[]
}
export function recomputeAllSensing(draws: readonly (SensingDraw | null)[]): AgreementResult<SensingRecomputeSummary> {
  let total = 0, poseless = 0, inRangeAgreed = 0, losClearAgreed = 0, conjunctionAgreed = 0
  const disagreements: number[] = []
  for (const d of draws) {
    if (d === null) continue
    total++
    let ok = true
    if (d.g === null) {
      // No pose → the two geometry legs are unavailable, so the LIVE conjunction cannot be formed either.
      // Count the event as poseless and decline all three checks rather than fall back to a decoded-only echo.
      poseless++
    } else {
      const liveInRange = recomputeInRange(d.g).inRange
      const liveLosClear = recomputeLosClear(d.g).losClear
      if (liveInRange === d.inRange) inRangeAgreed++; else ok = false
      if (liveLosClear === d.losClear) losClearAgreed++; else ok = false
      // The conjunction goes LIVE on in_range + los_clear and takes in_fov as the decoded claim — an engine
      // that lied about a geometry leg AND flipped eligible to match is caught here even though its own
      // recorded component bits are self-consistent (which a decoded-only echo would have waved through).
      if (recomputeEligible(liveInRange, d.inFov, liveLosClear) === d.eligible) conjunctionAgreed++; else ok = false
    }
    if (!ok) disagreements.push(d.seq)
  }
  // THE MINT — this executor actually RAN the live comparison, so it (and only it) brands the outcome an
  // AgreementResult. A lens cannot fabricate this: the brand carries lib/brand's private symbol, so the
  // summary cannot be written as static registration data (an object literal is a type error). Phantom brand,
  // zero runtime cost — the same recompute, re-declared.
  const summary: SensingRecomputeSummary = { total, poseless, inRangeAgreed, losClearAgreed, conjunctionAgreed, disagreements }
  return summary as AgreementResult<SensingRecomputeSummary>
}
