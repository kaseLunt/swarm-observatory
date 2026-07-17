import type { RunManifest } from '../decode/manifest'
import { comparableManifestPins, type TrustVerdict, type VerifyResult } from '../decode/verify'
import { metaBadge, type BadgeState } from './badges'
import { badgeMark, requireGlyph, type MarkKey } from './voices'
import { ASSUMED_DT_US } from '../state/transport'

// Pure row/footer helpers for the ProvenancePanel (spec §Provenance), extracted from ProvenancePanel.tsx so
// the row set and the footer voice are unit-testable WITHOUT a React render — mirroring ceremonyFormat.ts's
// split from Ceremony.tsx (the node-env test suite has no jsdom). No DOM, no store, no side effects.

// a row carries BOTH a BadgeState (`b`, the CSS/back-compat hook the tr class keys on) AND an explicit
// semantic `mark`: the glyph a surface paints comes from `mark`, NOT from re-deriving it off `b` through the
// badge seam. This splits the two things `b: 'pending'` conflated on a det-only run — a trailer-CHECKED-and-
// matched row (a real ○ self-check RAN) vs a NO-CLAIM row (scenario/seed/assumed-dt/registries/commit/dirty:
// nothing recomputed, no manifest to attest). The seam mapped BOTH to ○; the no-claim rows carry `mark: null`
// (an honest no-verdict presentation — glyphless, dim, a note) so a VERDICT glyph never rings an unadjudicated
// row. `mark: null` = render no glyph; a non-null mark names the ONE voices-module mark to paint.
export type ProvRow = { k: string; val: string; b: BadgeState; mark: MarkKey | null; cls?: string; note?: string; title?: string }

// Row → group layout. event_count / tick_count are now COMPARISON rows in the integrity group (they were
// only in the footer count display before), so a manifest that lies about a count reds a VISIBLE row instead of
// silently driving an overall mismatch with a green footer and no red anywhere on the panel.
export const PROV_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'identity', keys: ['scenario', 'seed', 'dt', 'commit'] },
  { label: 'hashes', keys: ['case_id', 'result_id', 'event_hash', 'state_trajectory_hash', 'schema_registry', 'state_registry'] },
  { label: 'integrity', keys: ['event_count', 'tick_count', 'termination_reason', 'dirty'] },
]

// termination_reason int → word (spec-3a §2.6 enum). Unknown ints fall through to the raw number.
const TERM_REASON: Record<number, string> = { 1: 'completed', 2: 'step_limit', 3: 'goal', 4: 'frozen' }
// Det-only voice. A det-only bundle pins no manifest claim, so its recomputed rows carry the SELF-CHECK voice —
// but only the rows that HAVE an in-bundle comparison may claim it — the four rows below recompute an
// in-bundle value AND compare it to the sealed trailer per-field (VerifyResult.trailerPins); on a det-only run
// they grade from THAT comparison — matched = the ○-class self-check note, MISMATCHED = a red row so the failing
// field is findable (before this, a corrupt-event-hash det-only bundle wore 'self-verified · pending' beside an
// aggregate mismatch — the failing field unfindable). The map is prov-key → trailerPins-key.
const SELF_VERIFIED_NOTE = 'self-verified · no external oracle'
// The ✗ is the mismatch mark, sourced from the ONE voices module (never a note-local glyph literal — the
// same single-source law the footer now obeys).
const TRAILER_MISMATCH_NOTE = `recomputed ${requireGlyph('mismatch')} the sealed trailer`
const TRAILER_CHECKED: Record<string, keyof VerifyResult['trailerPins']> = {
  event_hash: 'eventHash', state_trajectory_hash: 'stateTrajectoryHash',
  event_count: 'eventCount', tick_count: 'tickCount',
}
// result_id is genuinely RECOMPUTED (derived from the preimage) but the trailer stores no result_id to compare
// it against, AND it is derived from trailer-SOURCED inputs (case_id + termination_reason) — so on a det-only run
// NOTHING checks it: a CRC-fixed termination_reason changes result_id while every trailerPin stays true. It
// is therefore NOT a self-check — a ○ self-check ring here would be an unfalsifiable derivation wearing the check
// glyph. Det-only, it wears the ATTESTED voice (• derived, no oracle); under a manifest its pinned result_id is
// the real oracle (✓/✗). case_id + termination_reason are trailer-SOURCED inputs, never recomputed against
// anything, so on a det-only run they wear the UNCHECKED attested voice too — values on record from the
// bundle trailer, never a ○ self-check.
const DERIVED_NOTE = 'derived from the sealed inputs · no oracle'
const TRAILER_SOURCED_NOTE = 'trailer value · not recomputed'
const ATTESTED_NOTE = 'manifest claim · not recomputed'
// The dirty=true disclosure note. The dirty row keeps the alarm voice (badge 'mismatch') by deliberate ruling —
// the manifest itself declares the build tree unclean — but the alarm hue alone reads to a cold visitor like a
// byte-verification FAILURE. This note draws BOTH distinctions the hue cannot: (1) dirty=true is the generating
// manifest's own build-hygiene self-declaration, not a recomputed hash that disagreed (the hashes above are
// checked independently); and (2) the contract consequence — a dirty run is NON-CITABLE under the publication contract
// (contract/spec-3a-event-schema.md §4.5: "Citable additionally requires dirty=false ∧ valid evidence metadata";
// spec-3b §7 pins the same, DirtyAttempt). Terse note register; claims only what dirty=true actually is.
const DIRTY_NOTE = 'manifest self-declares an unclean build tree at generation — a build-hygiene disclosure, not a byte-verification failure (the hashes above are checked independently); a dirty run is non-citable under the publication contract'
// a det-only NO-CLAIM row (a metadata field that under a manifest would be an ATTESTED • claim, but a
// det-only bundle pins no manifest): there is no claim to attest and no recompute to check, so it wears the
// honest no-verdict presentation (mark: null → glyphless) and says why. (The assumed-dt row carries its own
// 'assumed' cls + '(assumed)' value, so it is left to speak for itself rather than doubled with this note.)
const NO_CLAIM_NOTE = 'no manifest claim — nothing to adjudicate'
const short = (h: string): string => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h)

// The provenance rows for a model's manifest + recomputed verify result. SINGLE-SOURCED against the trust fold
// (A2 — H2/H3): every manifest pin is badged from comparableManifestPins — THE SAME per-pin comparison
// verdictAgainstManifest reduces to the seal verdict — so a pin this panel paints red is a pin the fold refuses.
export function provenanceRows(manifest: RunManifest | null, verify: VerifyResult): ProvRow[] {
  const m = manifest
  const pins = m ? new Map(comparableManifestPins(verify, m).map(p => [p.key, p])) : null
  const pinBadge = (key: string): BadgeState => (pins ? (pins.get(key)!.match ? 'verified' : 'mismatch') : 'pending')
  // a trailer-checked field (event/state hashes + counts) folds BOTH comparisons where both exist: its
  // MANIFEST pin AND its per-field TRAILER reproduction (verify.trailerPins). Either failing → mismatch. Without
  // this, a full-manifest run whose TRAILER stored event_hash is corrupt (frames + manifest clean → the manifest
  // pin still matches the recomputed value) badged the row ✓ from the manifest pin alone, while matchesTrailer was
  // false and the ceremony's per-field row (pinTick, which already folds the trailer pin) painted ✗ — two surfaces
  // disagreeing on one field. Now the panel folds the same trailer pin the ceremony does, so they agree row-for-
  // row. (Det-only has no manifest pin → 'pending'; its trailer fold is applied in the det-only block below.)
  const foldedBadge = (key: string, trailerPin: boolean): BadgeState =>
    pins ? (pins.get(key)!.match && trailerPin ? 'verified' : 'mismatch') : 'pending'
  const meta: BadgeState = metaBadge(m !== null)
  const detOnly = m === null
  const termWord = TERM_REASON[verify.terminationReason] ?? String(verify.terminationReason)
  // Built WITHOUT `mark` (the b/note passes below mutate these); the semantic mark is threaded in the finalize
  // pass at the end, once every row's BadgeState is settled.
  const rows: Omit<ProvRow, 'mark'>[] = [
    { k: 'scenario', val: m?.scenarioId ?? '(det-only)', b: meta },
    { k: 'seed', val: m?.seed ?? '—', b: meta },
    m
      ? { k: 'dt', val: `${m.dtUs}µs`, b: meta }
      : { k: 'dt', val: `${ASSUMED_DT_US}µs (assumed)`, b: 'pending', cls: 'assumed' },
    { k: 'case_id', val: short(verify.caseIdHex), b: pinBadge('case_id') },
    { k: 'result_id', val: short(verify.resultIdHex), b: pinBadge('result_id') },
    // the trailer-checked rows fold BOTH the manifest pin AND their own trailer reproduction (foldedBadge):
    // a corrupt TRAILER value reds the row even when the manifest pin still matches, so the panel agrees with the
    // ceremony's per-field ✗ instead of greening the row above a red footer.
    { k: 'event_hash', val: short(verify.eventHashHex), b: foldedBadge('event_hash', verify.trailerPins.eventHash) },
    { k: 'state_trajectory_hash', val: short(verify.stateHashHex), b: foldedBadge('state_trajectory_hash', verify.trailerPins.stateTrajectoryHash) },
    // event_count / tick_count are now COMPARISON rows (value = the recomputed count; badge folds pin+trailer):
    // a manifest OR trailer that lies about a count reds ITS OWN row instead of hiding behind a green footer.
    { k: 'event_count', val: String(verify.eventCount), b: foldedBadge('event_count', verify.trailerPins.eventCount) },
    { k: 'tick_count', val: String(verify.tickCount), b: foldedBadge('tick_count', verify.trailerPins.tickCount) },
    { k: 'termination_reason', val: termWord, b: pinBadge('termination_reason'), title: String(verify.terminationReason) },
    { k: 'schema_registry', val: short(m?.schemaRegistryHash ?? ''), b: meta },
    { k: 'state_registry', val: short(m?.stateRegistryHash ?? ''), b: meta },
    { k: 'commit', val: m?.commit ?? '—', b: meta },
    // dirty=false is a manifest self-declaration (nothing recomputes it) → attested, not a green ✓. dirty=true
    // keeps the alarm voice: the manifest itself declares the build tree unclean — and carries DIRTY_NOTE so a
    // cold visitor can tell this build-hygiene disclosure apart from a byte-verification failure. The note is set
    // for the dirty=true row only: the ATTESTED_NOTE pass below fires on 'attested' rows (dirty=true is
    // 'mismatch', so it is left untouched), and the det-only path (m===null) never reaches DIRTY_NOTE — so a
    // det-only dirty row keeps its no-claim note unchanged.
    { k: 'dirty', val: String(m?.dirty ?? '—'), b: m ? (m.dirty ? 'mismatch' : metaBadge(true)) : 'pending', ...(m?.dirty ? { note: DIRTY_NOTE } : {}) },
  ]
  // The attested voice (R2) on every claim-only row — the • says "on record", the note says why it is not a ✓.
  // Runs BEFORE the det-only block so the det-only rows that legitimately BECOME 'attested' below (result_id,
  // case_id, termination_reason — derived / trailer-sourced, no oracle) keep their OWN honest notes rather than
  // this manifest-claim wording. On a full-manifest run only the meta rows are 'attested' here (a det-only run's
  // meta rows are 'pending'), so this stays the manifest-only attested-note pass it always was.
  for (const r of rows) if (r.b === 'attested') r.note = ATTESTED_NOTE
  // The det-only voice, per row-class — det-only has no manifest, so no ✓ green anywhere:
  //   • a trailer-checked recomputed row (event/state hashes + counts) is a GENUINE in-bundle self-check — matched
  //     keeps the ○ self-check (badge stays 'pending') + the honest note, MISMATCHED reds THAT row (badge
  //     'mismatch') so the failing field is findable;
  // • result_id is DERIVED from trailer-sourced inputs with no in-bundle oracle → the ATTESTED voice
  //     (• derived), NEVER the ○ self-check ring an unfalsifiable derivation must not wear;
  //   • case_id + termination_reason are trailer-sourced values, not recomputed → the ATTESTED voice too (• on
  //     record), never a ○ self-check.
  if (detOnly) {
    for (const r of rows) {
      const pinKey = TRAILER_CHECKED[r.k]
      if (pinKey) {
        if (verify.trailerPins[pinKey]) r.note = SELF_VERIFIED_NOTE
        else { r.b = 'mismatch'; r.note = TRAILER_MISMATCH_NOTE }
      } else if (r.k === 'result_id') { r.b = 'attested'; r.note = DERIVED_NOTE }
      else if (r.k === 'case_id' || r.k === 'termination_reason') { r.b = 'attested'; r.note = TRAILER_SOURCED_NOTE }
    }
  }
  // FINALIZE — thread the semantic mark. A det-only row still on the neutral 'pending' badge that is NOT
  // one of the trailer-CHECKED fields is a NO-CLAIM row (scenario/seed/assumed-dt/registries/commit/dirty):
  // nothing recomputed it and there is no manifest to attest, so it gets `mark: null` (glyphless, an honest
  // no-verdict) + the no-claim note — never the ○ self-check the badge seam would otherwise force onto it.
  // Every OTHER row's mark follows its BadgeState through the same seam the hangar data table uses: a trailer-
  // reproduced 'pending' → ○ selfConsistent (the check RAN and matched), 'attested' → •, verified/mismatch → ✓/✗.
  return rows.map(r => {
    const noClaim = detOnly && r.b === 'pending' && !TRAILER_CHECKED[r.k]
    const mark: MarkKey | null = noClaim ? null : badgeMark(r.b) // null = glyphless (nothing to adjudicate here)
    return noClaim && r.note === undefined && r.cls !== 'assumed'
      ? { ...r, mark, note: NO_CLAIM_NOTE }
      : { ...r, mark }
  })
}

// The panel footer voice, derived from the trust VERDICT — NOT bare matchesTrailer. The old footer read
// `matchesTrailer ? 'trailer consistent ✓' : '…✗'`, so a manifest lying only about a count (bundle clean →
// matchesTrailer TRUE, verdict 'mismatch') showed a GREEN footer beside a red count row: the panel could not
// explain the refusal it participates in. The footer now REFUSES on the aggregate mismatch and distinguishes an
// in-bundle reproduction failure (matchesTrailer false) from a manifest that lies about clean bytes.
// the footer speaks the VERDICT'S OWN mark, glyph sourced from the ONE voices module (never a footer-
// local literal, and never the WRONG mark): a self-consistent det-only run showed ○ in the ceremony/thesis but
// a site-local ✓ HERE — the migration missed this seam. Now it switches on TrustVerdict exhaustively:
// manifest-verified → ✓ (trailer consistent, backed by the external manifest); self-consistent → ○, scoped to
// the trailer SELF-check (no external oracle — the manifest-grade green lives on the row badges + the thesis,
// never here); mismatch → ✗. So the footer glyph agrees with every other surface for the same run.
export function provenanceFooter(
  verify: Pick<VerifyResult, 'eventCount' | 'tickCount' | 'matchesTrailer'>, verdict: TrustVerdict,
): string {
  const counts = `${verify.eventCount} events · ${verify.tickCount} ticks`
  switch (verdict) {
    case 'mismatch':
      return verify.matchesTrailer
        ? `${counts} · manifest mismatch ${requireGlyph('mismatch')}`    // ✗ — bundle reproduced its trailer, but a pinned field lies
        : `${counts} · trailer INCONSISTENT ${requireGlyph('mismatch')}` // ✗ — the bytes never reproduced their own trailer
    case 'self-consistent':
      return `${counts} · trailer self-consistent ${requireGlyph('selfConsistent')}` // ○ — reproduced its own trailer; no external oracle
    case 'manifest-verified':
      return `${counts} · trailer consistent ${requireGlyph('verified')}`             // ✓ — trailer consistent, backed by the manifest
  }
}
