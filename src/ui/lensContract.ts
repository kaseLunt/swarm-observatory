// ── THE LENS CONTRACT — the LAW-4 declaration graduated from comment to typed data ─────────────────────
// The constitution's LAW-4 (§3) requires every lens to declare, before implementation: its question, its
// surface split, its borrowed hue, what it dims, and its honest empty state. Today the query stage files
// that declaration as PROSE (queryStage.ts) — correct, but unqueryable. The registry's reason to exist is
// ask-any-pixel: hover anything → its data authority. That answer cannot be recovered from a comment. So
// the thing a lens REGISTERS is its LAW-4 declaration as a typed const, plus a ledger that classifies every
// pixel-class it paints by HOW IT KNOWS — and the ask-any-pixel answer is then a lookup, not a retrofit.
//
// This module is the TYPES and the pinned tier vocabulary (the standing-rule shape: decided at registry
// design time, BEFORE the second lens builds). f2a files the FIRST conforming citizen against it
// (sensingStage.ts); a later task lifts the query stage's prose declaration into the same shape and adds
// the lookup MECHANISM. There is no mechanism here — this is the contract, not the registry.
//
// NEAR-LEAF (the queryScenario idiom): the type edges (PaletteKey / CategoryKey) are erased under
// verbatimModuleSyntax, and the ONE runtime import is the voices module — itself a zero-runtime-import pure
// data leaf — so the closure stays {lensContract, voices}: two pure leaves, no heavy dependency dragged
// behind the contract. Compile-time hue membership rides the type-only edge (LAW 2); the seven-mark glyphs
// ride the voices leaf so this module never re-mints a voice literal (the single-source law, v0.8).
import type { PaletteKey, CategoryKey } from './theme'
import { requireGlyph, VOICE_MARK, basisNote, type MarkKey } from './voices'
import type { AgreeSource, AgreementResult } from './agreeSource'

// ── The six authority tiers (pinned NOW, per the standing rule) ────────────────────────────────────────
// Every visual element CLASS a lens paints classifies as exactly one of these — how it knows what it draws.
// This vocabulary generalizes the design rulings: `derived-display` is the kind-histogram ruling ("index
// content, never a voice glyph") made a tier; `pinned-bits` is the bearings constraint made a tier;
// `decoded`-inherits-the-seal is the session-earned law made a tier.
export type ProvenanceTier =
  | 'decoded'            // bytes surfaced verbatim from the sealed bundle — inherits the RUN's session seal
  | 'recomputed'        // re-derived in-browser by a pinned form and compared — live ✓/✗ (showMath grammar)
  | 'pinned-bits'       // value on record (vendored-libm KAT bits, manifest claims), not recomputable here — • attested
  | 'scenario-constant' // content-addressed scenario input from a sanctioned excerpt — the honesty-chip voice
  | 'derived-display'   // display-tier arithmetic/aggregation on decoded data — declared derivation, no glyph
  | 'presentational'    // encodes no data (easing, fog, grid, plate typography) — "encodes no data"

// A borrowed hue names an existing token (LAW 2 — the palette does not grow). Compile-time membership: a
// lens whose declaration cannot name its hues as existing tokens is asking for a palette change, which
// routes to the swatch/owner gate, not here. Either a PALETTE key or an event CATEGORY hue.
export type BorrowedHue = PaletteKey | `category:${CategoryKey}`

// ── A pixel-class ledger entry (the ask-any-pixel unit) ────────────────────────────────────────────────
// `source` is a contract/ anchor (file + section) — MANDATORY for every non-presentational tier (the class
// must point at where its authority is written); `null` is legal ONLY for presentational classes (they
// encode no data, so there is nothing to anchor). `answer` is the one-sentence hover reply for the CLASS;
// instance facts (seq, tick, values) are appended by the consuming surface from existing readout machinery
// — the ledger carries the class sentence, never a templating engine.
export interface PixelClass {
  readonly id: string
  readonly tier: ProvenanceTier
  readonly source: string | null
  readonly answer: string
  // A `recomputed` class MUST witness HOW it agrees with the engine: the AgreeSource union,
  // where the basis is the tag (a `live-inputs` re-derivation naming its input tokens + pinned form, or the
  // `decoded-consistency` honest downgrade). MANDATORY on the recomputed tier, FORBIDDEN off it (an
  // AgreeSource on any other tier is a category error) — validateRegistration enforces both. The declared
  // arm's tokens are resolved against the executor's capability at boot (lensRegistry), fail-loud.
  readonly agree?: AgreeSource
}

// ── The registration: a lens's LAW-4 declaration, whole, as data ───────────────────────────────────────
// If a field cannot be filled, the lens cannot register — the type system is the LAW-4 gate ("if it needs a
// new toggle, the design isn't done" made mechanical). `surfaces` name REAL components (the LAW-3 split);
// `mountGate` names the ONE model-layer predicate (mount/chip/rail share it, so they can never drift);
// `tourId` enforces the tour-per-lens standing rule structurally (a stage lens registers its tour or states
// why it has none). Registration data is STATIC and build-time — it is claims-about-mechanism, NEVER
// verification state (a ✓ is session-earned and lives in the store; a registry that could stamp "verified"
// would be the folklore-gate disease at architecture scale).
export interface LensRegistration {
  readonly id: string
  readonly question: { readonly primary: string; readonly adjacent: readonly string[] }
  readonly surfaces: { readonly stage: string; readonly instrument: string }
  readonly borrowedHues: readonly BorrowedHue[]
  readonly dims: string
  readonly emptyState: string
  readonly honestyChip: string
  readonly tourId: string | null
  readonly mountGate: string
  readonly provenance: readonly PixelClass[]
}

// ── tier + seal-state → voice (pinned ONCE here; components compute the live voice at render) ──────────
// The registry never stores a ✓. This pure function is the ONE place the tier vocabulary maps to a rendered
// voice, so no surface re-invents the mapping. A `decoded` class inherits the run's session seal: it earns
// the affirm voice only WHILE the bundle is sealed this session, and reads unsealed (quiet) otherwise —
// unearned states render quiet, never the earned signal (constitution §4). Every other tier's voice is
// seal-independent (a recompute is live per-comparison; attested/constant/derivation/presentational are
// fixed claims), so `sealed` is consulted only for `decoded`.
export type Voice = 'sealed' | 'unsealed' | 'live-check' | 'attested' | 'declared-constant' | 'derivation' | 'presentational'

export function voiceFor(tier: ProvenanceTier, sealedThisSession: boolean): Voice {
  switch (tier) {
    case 'decoded': return sealedThisSession ? 'sealed' : 'unsealed'
    case 'recomputed': return 'live-check'
    case 'pinned-bits': return 'attested'
    case 'scenario-constant': return 'declared-constant'
    case 'derived-display': return 'derivation'
    case 'presentational': return 'presentational'
  }
}

// The glyph a voice may wear (the shipped provenance alphabet ✓ • ○ ✗ — ProvenancePanel owns it). Returns
// null for the voices that MUST NOT wear a glyph (the design-of-record's law): a `declared-constant`,
// `derivation`, or `presentational` class narrows its claim in words (the chip / a note), never a mark that
// would read as an earned ✓. A `live-check` voice resolves to a mark only once a comparison exists, so it
// too returns null here (this function pins the STATIC marks); the LIVE mark is stamped per row by
// `recomputedVerdict` from the class's DECLARED arm (✓ for live-inputs, ○ for decoded-consistency, ✗ on
// disagreement) — that is where agree.basis is HONORED, not discarded.
// Resolved THROUGH the ONE exhaustive Voice→mark map (voices.VOICE_MARK) — never a voice-local literal — so a
// voice's glyph is its mark's own, and the boot guard validates the SAME map this renderer reads.
export function voiceGlyph(voice: Voice): string | null {
  const mark = VOICE_MARK[voice]
  return mark === null ? null : requireGlyph(mark)
}

// ── The `basis` NOTE for a recomputed class — sourced from its AgreeSource ARM TAG ─────
// The note a surface renders beside a live-check mark comes from the DECLARATION's `basis` discriminant, not
// a hand-passed literal — ONE truth. Because `AgreeSource['basis']` IS `Basis` (the type voices.BASIS_NOTE
// keys on), the arm's tag and its rendered note can never drift.
export function agreeBasisNote(agree: AgreeSource): string {
  return basisNote(agree.basis)
}

// ── The recomputed-row VERDICT MARK + basis note, BOTH sourced from the class's DECLARED arm ──────
// The witness union must be WORN, not merely declared. Before this, every recomputed row was stamped by a bare
// boolean → ✓/✗, discarding agree.basis: a decoded-consistency arm would have passed registration and then
// WORN THE CHECK at the presentation layer (the union demoted to prose). This is the production mark resolver
// both real components call, per row, with THAT row's declared arm:
//   • a `live-inputs` agreement earns the manifest-verified ✓ (the external-oracle check);
//   • a `decoded-consistency` agreement earns ONLY the self-consistent ○ (the ring — no external oracle),
//     NEVER the ✓ — that is the whole point of the two-arm union;
//   • a disagreement is the ✗ (mismatch) on EITHER arm.
// `agreed` is the BRANDED per-row outcome (AgreementResult<boolean>) — a plain boolean does not type-check
// here, so the executor's mint is load-bearing all the way to the mark. The basis NOTE (this is
// agreeBasisNote's production caller) rides alongside from the SAME arm tag, so the glyph a row wears and the
// words beside it can never disagree about HOW the row knows.
export interface RecomputedVerdict { readonly mark: MarkKey; readonly note: string }
export function recomputedVerdict(agree: AgreeSource, agreed: AgreementResult<boolean>): RecomputedVerdict {
  const note = agreeBasisNote(agree)
  if (!agreed) return { mark: 'mismatch', note }
  return { mark: agree.basis === 'live-inputs' ? 'verified' : 'selfConsistent', note }
}

// ── Fail-loud registration validation (the queryStage precedent, at the registry tier) ─────────────────
// A registration that violates the tier contract is not a degraded declaration to file best-effort — it is
// a lens claiming an authority it did not write down. Refuse loud at publish (throw), never coerce. These
// checks need no runtime theme (borrowed-hue token membership is a compile-time type PLUS a runtime test
// beside the registration — this module stays a leaf); they enforce the structural invariants: every
// non-presentational class carries a source anchor, no class carries an empty answer, and the honesty chip
// agrees with the ledger (one source of honesty per lens; the chip is its projection, never a second author).
function fail(msg: string): never { throw new Error(`lensContract: ${msg}`) }

// The chip is DERIVED from, and pinned against, the ledger (A5): it names scenario constants iff the ledger
// has scenario-constant classes, and it claims decoded-real iff the ledger has decoded classes. A mismatch
// is a chip that has drifted from what the lens actually paints — a false honesty claim. Whole-word match so
// "decoded" inside a longer token never false-trips; case-insensitive so wording stays owner-tweakable.
export function chipAgreesWithLedger(reg: LensRegistration): boolean {
  const chip = reg.honestyChip.toLowerCase()
  const hasTier = (t: ProvenanceTier): boolean => reg.provenance.some(p => p.tier === t)
  const namesConstants = /scenario[ -]constant/.test(chip)
  const claimsDecoded = /\bdecoded\b/.test(chip)
  if (namesConstants !== hasTier('scenario-constant')) return false
  if (claimsDecoded !== hasTier('decoded')) return false
  return true
}

export function validateRegistration(reg: LensRegistration): LensRegistration {
  if (reg.provenance.length === 0) fail(`${reg.id} registers an empty ledger — a lens must classify every pixel-class it paints`)
  for (const p of reg.provenance) {
    if (p.answer.trim() === '') fail(`${reg.id}: pixel-class '${p.id}' has an empty answer — every class carries its one-sentence ask-any-pixel reply`)
    if (p.tier !== 'presentational' && (p.source === null || p.source.trim() === ''))
      fail(`${reg.id}: pixel-class '${p.id}' (${p.tier}) has no contract/ anchor — mandatory for every non-presentational tier; only presentational classes may omit it`)
    if (p.tier === 'presentational' && p.source !== null)
      fail(`${reg.id}: pixel-class '${p.id}' is presentational yet names a source '${p.source}' — presentational classes encode no data and anchor nothing`)
    // The recomputed tier must WITNESS how it agrees, never self-attest in prose. A recomputed
    // class REQUIRES an AgreeSource (the old prose-only declaration no longer passes); a live-inputs arm must
    // name at least one input token (a re-derivation with no inputs re-derives from nothing). An AgreeSource on
    // any OTHER tier is a category error — only a recompute has an agreement to witness.
    if (p.tier === 'recomputed') {
      if (p.agree === undefined)
        fail(`${reg.id}: pixel-class '${p.id}' is recomputed but declares no AgreeSource — a recomputed class must witness HOW it agrees (a live-inputs re-derivation naming its input tokens + pinned form, or the decoded-consistency downgrade), never prose alone`)
      if (p.agree.basis === 'live-inputs' && p.agree.inputs.length === 0)
        fail(`${reg.id}: pixel-class '${p.id}' declares a live-inputs arm naming NO input tokens — a live re-derivation must name what it re-derives from`)
    } else if (p.agree !== undefined) {
      fail(`${reg.id}: pixel-class '${p.id}' (${p.tier}) declares an AgreeSource — only the recomputed tier witnesses agreement (an AgreeSource off the recomputed tier is a category error)`)
    }
  }
  if (reg.honestyChip.trim() === '') fail(`${reg.id} registers an empty honesty chip`)
  if (!chipAgreesWithLedger(reg)) fail(`${reg.id}: the honesty chip disagrees with the ledger — the chip must name scenario constants iff the ledger has them, and claim decoded-real iff the ledger has decoded classes`)
  return reg
}
