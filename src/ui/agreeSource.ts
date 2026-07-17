// ── THE AGREESOURCE WITNESS UNION — the anti-echo carry folded into the TYPE (v0.8) ─────────
// The lens registry's `recomputed` tier lets a lens claim, in PROSE, that a recomputation agrees with the
// engine. Nothing at the type level separates a LIVE re-derivation (decoded inputs → recompute → compare
// against the engine bit) from an ECHO (the engine's bit compared against ITSELF, laundered through a
// sentence). v0.7 fixed one echo instance behaviourally (the eligible conjunction now ANDs LIVE legs);
// this wave makes the CLASS unrepresentable. A recomputed class must WITNESS how it agrees — and the witness
// is a closed two-arm union where the BASIS IS THE TAG, with the comparand's token type EXCLUDED from the
// input tokens so comparing-with-yourself cannot COMPILE.
//
// LEAF: this module is TYPES + closed token vocabularies + two brands + ONE runtime constructor
// (makeWitnessInputs) — still zero runtime IMPORTS (the sole edge, `Brand`, is type-only, erased under
// verbatimModuleSyntax). The executor capability VALUES live with the executors (showMath / sensingMath); the
// boot guard (lensRegistry) resolves declared arms against them.
import type { Brand } from '../lib/brand'

// ── Tokens are DATA, not strings-with-hope ──────────────────────────────────────────────────────────────
// InputToken — the legal re-derivation inputs a `live-inputs` arm may name (a decoded pose/point/geometry, a
// LIVE-recomputed leg, or a DECODED claim leg). THE ECHO EXCLUSION AT THE TYPE LEVEL: no engine verdict bit
// (ComparandToken, below) is a member — a lens that names the comparand it checks AGAINST as an input asks to
// compare the engine's bit with itself, and that cannot compile.
export type InputToken =
  // f2a sensing (sensingMath's live legs)
  | 'sensing:pose'            // the decoded target pose g the in_range / los_clear legs re-derive from
  | 'sensing:in-range-live'   // the LIVE-recomputed in_range leg (feeds the eligible conjunction)
  | 'sensing:los-clear-live'  // the LIVE-recomputed los_clear leg (feeds the eligible conjunction)
  | 'sensing:in-fov-claim'    // the DECODED in_fov claim leg — a claim-voice input (a pinned vendored-libm angle,
                              //   no bearing in the bundle to recompute), never a live leg, never the engine's eligible bit
  // e0 query (showMath's recomputeAll)
  | 'query:probe-point'       // the decoded region probe point
  | 'query:ray-geometry'      // the decoded ray/segment origin + target
  | 'query:component-segments'// the decoded LOS component-ray geometry
  | 'query:range-endpoints'   // the decoded o, g the range scalar re-derives from

// FormToken — the pinned decision form a `live-inputs` arm recomputes under (operand order normative
// doctrine). A form NAMES an existing executor leg; it is not an interpreter instruction.
export type FormToken =
  | 'form:in-range' | 'form:los-clear' | 'form:eligible-conjunction'
  | 'form:point-in-region' | 'form:ray-occluder' | 'form:los-composition' | 'form:range-scalar'

// ComparandToken — the engine verdict bit a recompute compares AGAINST. Kept as a DISTINCT, exported
// vocabulary (never a member of InputToken) so the exclusion is documented AND mechanized: the echo
// counterexample (an AgreeSource naming one of these as an input) is a compile error, pinned in the tests.
export type ComparandToken =
  | 'engine:in-range' | 'engine:los-clear' | 'engine:eligible'
  | 'engine:region-verdict' | 'engine:occluder-verdict' | 'engine:los-verdict' | 'engine:range-scalar'

// DecodedToken — the in-bundle self-consistency comparand for the HONEST DOWNGRADE arm: a check with NO
// independent re-derivation, only decoded bits cross-checked against each other (the ring-class ○ voice,
// "no external oracle"). Never the manifest-grade claim. No currently-registered class uses this arm (all
// migrate to `live-inputs`); the vocabulary exists so the downgrade is expressible and honestly labelled.
export type DecodedToken =
  | 'sensing:eligibility-vs-decoded-legs'  // decoded eligible vs the AND of its own decoded component bits (the OLD echo, made honest as a self-check)
  | 'query:los-vs-decoded-components'      // decoded los_clear vs its decoded component verdicts

// ── WitnessInputs — an OPAQUE, INVARIANT input collection minted ONLY by makeWitnessInputs ─
// A `readonly InputToken[]` is not safe as a declaration field: TypeScript arrays are COVARIANT, so a mutable
// `InputToken[]` assigns to a wider `(InputToken | ComparandToken)[]` alias, `engine:eligible` is pushed
// through that alias, and the contaminated value would then satisfy a `readonly InputToken[]` field with ZERO
// diagnostics — the comparand rides in and the compile-time echo exclusion is bypassed. WitnessInputs closes
// that: it is a BRANDED collection whose sole producer, makeWitnessInputs, COPIES its arguments (severing any
// caller alias), FREEZES the copy (no post-construction push), and runtime-VALIDATES every token against the
// closed InputToken vocabulary (a comparand is refused as a VALUE, not merely by the type). The brand blocks
// structural substitution at compile time (a plain array is not a WitnessInputs); the value-validation blocks
// a covariance-smuggled comparand at runtime. A declaration's `inputs` field is WitnessInputs, so a live arm's
// inputs can ONLY come from the constructor — the alias-contamination path no longer type-checks OR runs.
export type WitnessInputs = Brand<readonly InputToken[], 'WitnessInputs'>

// The closed InputToken vocabulary as RUNTIME data. A `Record<InputToken, true>` forces EVERY member present at
// compile time (a new InputToken with no entry fails tsc), so this validator can never silently fall behind the
// type it guards. ComparandToken is deliberately absent — that IS the echo exclusion, now enforced at value time.
const INPUT_TOKENS: Record<InputToken, true> = {
  'sensing:pose': true,
  'sensing:in-range-live': true,
  'sensing:los-clear-live': true,
  'sensing:in-fov-claim': true,
  'query:probe-point': true,
  'query:ray-geometry': true,
  'query:component-segments': true,
  'query:range-endpoints': true,
}
const isInputToken = (t: string): t is InputToken => Object.prototype.hasOwnProperty.call(INPUT_TOKENS, t)

// The SANCTIONED constructor — the ONLY producer of a WitnessInputs. Copies (severs the caller's array so a
// later push cannot reach the frozen result), validates each token against the closed vocabulary (a comparand
// smuggled past the compiler via array covariance is refused HERE, at construction), then freezes and brands.
// Permissive on COUNT (an empty witness is legal to construct; validateRegistration rejects an empty live arm —
// one owner of that rule), strict on VOCABULARY (the echo exclusion). Declarations call this; nothing else can.
export function makeWitnessInputs(...tokens: InputToken[]): WitnessInputs {
  const copy: InputToken[] = []
  for (const t of tokens) {
    if (!isInputToken(t))
      throw new Error(`makeWitnessInputs: '${String(t)}' is not a legal witness InputToken — the closed vocabulary refuses it (the comparand/echo exclusion, enforced at VALUE construction, not merely at the type)`)
    copy.push(t)
  }
  return Object.freeze(copy) as unknown as WitnessInputs
}

// ── The two-arm witness union — the BASIS IS THE TAG ────────────────────────────────────────────────────
// `live-inputs`: names the INPUT tokens it re-derives from (as a WitnessInputs — minted, copied, frozen and
//   validated, so a comparand cannot ride in via array covariance) and the pinned FORM. The comparand (the
//   engine bit it checks against) is IMPLICIT and un-nameable here — the echo cannot compile OR construct. A
//   genuine re-derivation may mix LIVE legs with a DECODED claim leg (the eligible conjunction: two live legs +
//   the in_fov claim); what makes it non-echo is that the comparand is not among the inputs.
// `decoded-consistency`: the honest downgrade — an in-bundle self-consistency check, never manifest-grade.
export type AgreeSource =
  | { readonly basis: 'live-inputs'; readonly inputs: WitnessInputs; readonly form: FormToken }
  | { readonly basis: 'decoded-consistency'; readonly decoded: DecodedToken }

// The `basis` DISCRIMINANT is the single source of the Basis vocabulary — voices.BASIS_NOTE keys on THIS
// type, so the note a surface renders comes from the arm's TAG, never a second author (ev99's convention;
// this module owns the union the tag lives on). One truth: `AgreeSource['basis']` IS `Basis`.
export type Basis = AgreeSource['basis']

// ── The executor's capability table — PER-FORM witness tuples (no Cartesian pairing) ───────
// An executor publishes, PER FormToken, the EXACT input set that form's live leg consumes — ONE truth per
// form, not two independent flat sets. The old {inputs[], forms[]} shape let the boot guard check input
// membership and form membership INDEPENDENTLY, so inputs `['sensing:in-fov-claim']` paired with form
// `'form:in-range'` passed even though in_range re-derives from `sensing:pose` and never consumes in_fov —
// the Cartesian hole. Here each form maps to its required tuple, and the boot guard compares a declared arm's
// (form + inputs) against THAT form's tuple as a set: extra, missing, or swapped inputs all fail loud.
//   PARTIAL by design: an executor lists only the forms it backs; a declared form absent from this map is a
// form the executor does not back (still fail-loud). The tuple values are plain `readonly InputToken[]`,
// authored as literals in the executor (safe from the covariance path — no per-lens author touches them); the
// DECLARED arm's inputs are the branded WitnessInputs, and the guard set-compares the two. Values live with
// the executors (showMath / sensingMath); the TYPE lives here.
export interface AgreeCapability {
  readonly forms: Readonly<Partial<Record<FormToken, readonly InputToken[]>>>
  readonly decoded: readonly DecodedToken[]
}

// ── The branded agreement outcome — minted ONLY by the executor that runs the live comparison ───────────
// showMath.recomputeAll / sensingMath.recomputeAllSensing return this; a lens CANNOT fabricate agreement,
// because an AgreementResult cannot be written as static data — an object literal is missing the un-nameable
// brand symbol (lib/brand's private `unique symbol`), so constructing one outside the executor is a type
// error (pinned in the tests). The runtime value IS the summary; the brand is phantom (zero runtime cost),
// so this wave RESTRUCTURES the declaration without touching the recompute math.
export type AgreementResult<T> = Brand<T, 'AgreementResult'>
