// ── THE VOICES MODULE — the single source for the seven trust marks (v0.8 W1) ──────────────────────────
// The design bench ruled the trust-voice system AT CEILING and FROZEN at SEVEN marks. Before v0.8 those
// seven were minted as loose literals across every surface (ceremony ticks, provenance rows, the thesis
// card, the hangar, show-the-math, the sensing gate strip, the lens ledger) — and the attested `•` had
// already DRIFTED to three different hue tokens across four surfaces. This module is the extraction: the
// seven marks as ONE typed const map in the theme.ts CATEGORY idiom, so every production site reads its
// glyph + class HERE and no site re-invents (or re-drifts) a voice. The palette does not grow (LAW 2): a
// mark NAMES an existing PALETTE token, never a value.
//
// ── THE TWO-FAMILY LAW (the module's header contract, ruled 2026-07-15) ─────────────────────────────────
//   FAMILY 1 — VERDICT marks (✓ ○ • ✗): an adjudication was reached, so the mark MAY carry an integrity
//     hue (the green/red pair, or the slate a no-oracle self-check/attestation earns). These are the marks
//     that can read as an EARNED signal.
//   FAMILY 2 — NO-VERDICT states (· ? NOT-YET): NO adjudication was reached — the check was withheld, could
//     not be formed, or names a fact the playhead has not written yet. These STAY DIM and NEVER borrow a
//     verdict hue: a mark that could be mistaken for an earned ✓ when nothing was actually verified is the
//     exact folklore-gate lie the constitution forbids (§4). Enforced by `noVerdictHuesAreDim` below and a
//     unit test that asserts the two hue sets are disjoint.
//
// ── ev99 — THE `basis` NOTE CONVENTION (a NOTE-level distinction, NEVER a new glyph) ───────────────────
// ev99 asked whether a mark reached by LIVE decoded inputs should read differently from one reached by
// DECODED self-consistency. Ruling: that distinction is a NOTE, not a glyph. The seven-mark alphabet is
// frozen; a voice may carry a `basis` annotation (see `Basis` / `basisNote`) rendered as note TEXT beside
// the mark, but it never mints an eighth glyph. (W3's witness-union closes the two-arm `basis` tag; W1 only
// files the convention so the note vocabulary is single-sourced when it lands.)
import type { PaletteKey } from './theme'
import type { BadgeState } from './badges'
import type { Voice } from './lensContract'
import type { Basis } from './agreeSource'

// The two families (see the header LAW).
export type VoiceFamily = 'verdict' | 'no-verdict'

// The seven marks, by SEMANTIC id (never by the surface-local state that reaches them — a BadgeState, a
// TrustVerdict, and a GateVoice all resolve to one of these seven).
export type MarkId =
  | 'verified'        // ✓ manifest-verified — recomputed in-browser AND matched an external manifest pin
  | 'selfConsistent'  // ○ self-consistent  — a det-only self-check reproduced its own sealed trailer; no external oracle
  | 'attested'        // • attested         — a claim is on record but nothing here re-derives it (a value, not a verification)
  | 'mismatch'        // ✗ mismatch         — a pinned value disagreed (loaded and shown; the integrity claim failed)
  | 'withheld'        // · withheld         — the check could not be FORMED this instance (no decoded pose/inputs this tick)
  | 'unverifiable'    // ? unverifiable     — the recompute is IMPOSSIBLE (a missing basis), never an engine disagreement — never a false ✗
  | 'notYet'          // NOT-YET            — a future-fact ghost: real recorded flight ahead of the playhead, rendered HOLLOW (never blooming)

// A mark's whole declaration. `glyph` is the DOM character a surface renders; it is `null` for `notYet`,
// which is a RENDER TREATMENT (a dim, unbloomed outline in the 3D stage), not a text glyph — so it prints
// nothing in the DOM and is excluded from the glyph-uniqueness sweep. `hue` NAMES a PALETTE token (LAW 2):
// for a verdict mark it is the integrity hue it carries; for a no-verdict state it is the DIM token that
// keeps it quiet (the two-family law makes this a real constraint, not a comment).
export interface Mark {
  readonly id: MarkId
  readonly glyph: string | null
  readonly cls: string
  readonly family: VoiceFamily
  readonly name: string
  readonly hue: PaletteKey
}

// ── THE SEVEN MARKS (the single source — CATEGORY idiom: one typed const map) ────────────────────────────
// Canonical hue decisions (v0.8 W1):
//   • verified → `verified` (green) · mismatch → `mismatch` (red): the shipped integrity pair, unchanged.
//   • selfConsistent → `pending` (slate): the no-external-oracle self-check ring, unchanged.
//   • attested → `pending` (slate): THE DRIFT FIX. The `•` wore three tokens across four surfaces
//     (ProvenancePanel `pending`, ceremony/hangar `textFaint`, sensing gate `textDim`). The ProvenancePanel
//     is the most load-bearing integrity surface — every other surface's comments describe themselves as
//     "mirroring the panel's •" — so its `pending` is canonical and the other three converge to it.
//   • withheld / unverifiable / notYet → `textDim`: the no-verdict family stays dim (never a verdict hue).
export const MARKS = {
  verified:       { id: 'verified',       glyph: '✓',  cls: 'verified',     family: 'verdict',    name: 'manifest-verified',        hue: 'verified' },
  selfConsistent: { id: 'selfConsistent', glyph: '○',  cls: 'self',         family: 'verdict',    name: 'self-consistent',          hue: 'pending' },
  attested:       { id: 'attested',       glyph: '•',  cls: 'attested',     family: 'verdict',    name: 'attested / on record',     hue: 'pending' },
  mismatch:       { id: 'mismatch',       glyph: '✗',  cls: 'mismatch',     family: 'verdict',    name: 'mismatch',                 hue: 'mismatch' },
  withheld:       { id: 'withheld',       glyph: '·',  cls: 'withheld',     family: 'no-verdict', name: 'withheld',                 hue: 'textDim' },
  unverifiable:   { id: 'unverifiable',   glyph: '?',  cls: 'unverifiable', family: 'no-verdict', name: 'unverifiable',             hue: 'textDim' },
  notYet:         { id: 'notYet',         glyph: null, cls: 'not-yet',      family: 'no-verdict', name: 'not-yet (future-fact)',    hue: 'textDim' },
} as const satisfies Record<MarkId, Mark>

export type MarkKey = keyof typeof MARKS

// ── Narrow accessors (a surface reads glyph + class HERE; it never re-mints a literal) ──────────────────
// markClass is generic so it returns the LITERAL class string ('verified' | 'self' | …), not a widened
// `string` — a consumer whose field is a narrow class union (e.g. ThesisVerdict.cls) keeps its type.
export const markGlyph = (id: MarkKey): string | null => MARKS[id].glyph
export const markClass = <K extends MarkKey>(id: K): (typeof MARKS)[K]['cls'] => MARKS[id].cls
// Sites that render a mark KNOWN to carry a glyph (every mark except notYet) — a non-null glyph, so the
// consumer needs no `!` at the call site and a future null slips out here, loudly, instead of printing "".
export function requireGlyph(id: MarkKey): string {
  const g = MARKS[id].glyph
  if (g === null) throw new Error(`voices: mark '${id}' has no DOM glyph (it is a render-state)`)
  return g
}

// ── BadgeState → mark (the Hangar data-table seam) ──────────────────────────────────────────────────────
// The hangar cards carry a BadgeState (badges.ts), the data-layer enum. It maps onto the mark alphabet 1:1,
// so the hangar sources its GLYPH here (single-sourced) while keeping BadgeState as its CSS hook. `pending`
// is the ○ self-check; the others share the mark's own name.
//   F1 — this seam maps EVERY 'pending' to the ○ self-check, which is correct wherever 'pending' means "a
// self-check ran and matched" (the hangar's only use). It is NOT the disambiguator for the ProvenancePanel:
// there a det-only 'pending' splits into a trailer-CHECKED ○ vs a NO-CLAIM row that adjudicated nothing, so
// provenanceFormat threads an explicit per-row `mark` (null = glyphless) rather than routing its glyph
// through this seam — a verdict mark must never be forced onto an unadjudicated row.
const BADGE_MARK: Record<BadgeState, MarkKey> = {
  verified: 'verified', mismatch: 'mismatch', attested: 'attested', pending: 'selfConsistent',
}
export const badgeMark = (b: BadgeState): MarkKey => BADGE_MARK[b]
export const badgeGlyph = (b: BadgeState): string => requireGlyph(BADGE_MARK[b])

// ── The sanctioned voice-class + voice-glyph sets (the fail-loud / orphan-sweep basis) ──────────────────
// VOICE_CLASSES is the closed set of class tokens a voice mark may wear; the app.css orphan-sweep test
// asserts every voice-class selector in the stylesheet is a member (no drift variant survives). The
// ProvenancePanel + Hangar also hook CSS on the BadgeState name `pending` (the ○ mark's data-table alias),
// so it is sanctioned alongside the seven mark classes.
export const VOICE_CLASSES: ReadonlySet<string> = new Set<string>([
  ...Object.values(MARKS).map(m => m.cls),
  'pending', // BadgeState CSS hook for the ○ self-check on the provenance/hangar data tables
])
export const VOICE_GLYPHS: ReadonlySet<string> = new Set<string>(
  Object.values(MARKS).flatMap(m => (m.glyph === null ? [] : [m.glyph])),
)

// The PALETTE tokens the VERDICT family carries — the two-family law's "verdict hues". The no-verdict
// family must never name one of these (asserted in voices.test.ts and re-checkable at a glance here).
export const VERDICT_HUES: ReadonlySet<PaletteKey> = new Set<PaletteKey>(
  Object.values(MARKS).filter(m => m.family === 'verdict').map(m => m.hue),
)
// A dim no-verdict token names none of the verdict hues (the law, as a predicate the registry can assert).
export const noVerdictHuesAreDim = (): boolean =>
  Object.values(MARKS).filter(m => m.family === 'no-verdict').every(m => !VERDICT_HUES.has(m.hue))

// ── THE RENDERED VOICE → mark (the lens-contract seam, EXHAUSTIVE & single-sourced) ─────────────────────
// A pixel-class's rendered VOICE (lensContract.voiceFor(tier, seal)) resolves to exactly one mark — or to
// NO mark (a voice that narrows its claim in WORDS, never a glyph that could read as an earned ✓). This is
// THE ONE Voice→mark map. `satisfies Record<Voice, MarkKey | null>` makes it EXHAUSTIVE at compile time:
// adding a Voice with no mapping fails tsc — the guarantee the hand-maintained RESOLVABLE_VOICES array in
// lensRegistry could not give (it could silently OMIT a voice, or PASS a semantically-wrong glyph that was
// merely a member of the alphabet). voiceGlyph resolves THROUGH this map and the boot guard validates it,
// so renderer + guard share ONE semantic source, not two lists that can drift. `Voice` is imported type-only
// (erased under verbatimModuleSyntax), so voices.ts stays a zero-runtime-import leaf even though the contract
// that owns `Voice` imports this module.
export const VOICE_MARK = {
  sealed: 'verified',          // ✓ — the run's session seal, decoded-inherited
  unsealed: 'selfConsistent',  // ○ — recomputed-but-unsealed self-check ring
  attested: 'attested',        // • — a pinned value on record, no in-browser oracle
  'live-check': null,          // ✓/✗ only once a comparison exists — the recompute surface stamps it, not a static mark
  'declared-constant': null,   // a scenario constant narrows its claim in the chip — no glyph (D4)
  derivation: null,            // a declared derivation — no glyph (D4)
  presentational: null,        // encodes no data — no glyph
} as const satisfies Record<Voice, MarkKey | null>

// ── ev99 — the `basis` note vocabulary (note text, NEVER a glyph) ───────────────────────────────────────
// A verdict reached from LIVE decoded inputs vs one reached from DECODED self-consistency is a NOTE-level
// distinction. These strings render beside a mark as a `.prov-note` / `.gate-note`-style sub-line; the glyph
// is unchanged. `Basis` is now the AgreeSource union's discriminant (W3's witness-union OWNS the two arm
// tags); this module keys its note vocabulary on that ONE type, so the arm's tag and the note it renders can
// never drift. Re-exported so `Basis` stays nameable from voices for any existing importer (type-only, erased).
export type { Basis }
export const BASIS_NOTE: Record<Basis, string> = {
  'live-inputs': 'recomputed from live decoded inputs',
  'decoded-consistency': 'checked for decoded self-consistency — no external oracle',
}
export const basisNote = (b: Basis): string => BASIS_NOTE[b]
