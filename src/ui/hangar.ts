import type { RunEntry } from './useRun'
import { catalogDetOnly } from '../decode/runCatalog'
import { EVENT_KIND_NAMES } from '../decode/payloads'
import { categoryOf } from './categorize'
import type { BadgeState } from './badges'
import { badgeGlyph } from './voices'
import type { CategoryKey } from './theme'
import { ASSUMED_DT_US } from '../state/transport'

// Pure data layer for the Hangar (T5b) and the sim-clock readout (T5c). No React, no DOM — every
// function here is a total map from run facts to display strings, unit-tested in hangar.test.ts. The
// Hangar component and the Timeline readout consume these; the honesty rules live HERE where a test
// can pin them.

// ── SIM-CLOCK (T5c) ──────────────────────────────────────────────────────────────────────────────
// A run shows a REAL sim clock only when its manifest pins an integration step that DIFFERS from the
// app's playback assumption (ASSUMED_DT_US). Three cases, exactly matching the spec's partition:
//   • f2a/f3a/f4 — manifest dt_us = 125000µs, a genuine timed simulation → REAL clock (mm:ss.s).
//   • e0/f1      — det-only, no manifest, dtUs undefined → assumed voice (a false real-clock claim on
//                  a KAT-tier run is exactly what T5c forbids).
//   • f0         — manifest dt_us = 1000µs, which EQUALS ASSUMED_DT_US: the recorded step and the
//                  playback assumption coincide, so there is no distinct real-time claim to surface;
//                  the run keeps the assumed voice (its 2-tick "0.002s" would be a meaningless clock).
// Keying on ASSUMED_DT_US (not a hardcoded id list) keeps this data-driven and future-proof.
export function hasRealSimClock(dtUs: number | undefined): boolean {
  return dtUs !== undefined && dtUs > 0 && dtUs !== ASSUMED_DT_US
}

// Microseconds → "m:ss.s" (the D4 sim-clock format). Sub-second precision to a tenth; minutes never
// zero-padded, seconds always two integer digits. 12_000_000µs → "0:12.0"; 6_000_000 → "0:06.0".
export function formatSimClock(us: number): string {
  const totalSeconds = us / 1_000_000
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

// The card's real sim duration string, or null when the run keeps the assumed voice (the caller then
// renders the tick-based / assumed label instead of fabricating a clock).
export function realSimDuration(entry: Pick<RunEntry, 'dtUs' | 'ticks'>): string | null {
  return hasRealSimClock(entry.dtUs) ? formatSimClock(entry.ticks * entry.dtUs!) : null
}

// The assumed-clock tooltip (W4). The card's clock line falls to the assumed voice for three run shapes;
// its title must state the TRUE reason, never a borrowed one:
//   • det-only (e0/f1): a KAT-tier run with no recorded dt — playback time is assumed.
//   • f0: a FULL-manifest run whose recorded dt (1000µs) EQUALS the 1× playback step (ASSUMED_DT_US), so
//     there is no distinct sim clock to surface — but it is NOT det-only and it DID record a dt, so the
//     det-only "no recorded dt" wording would be a double false claim. Branch to the honest
//     coincidence wording instead.
//   • any other no-dt run: the honest generic (never a det-only claim we cannot back).
export function assumedClockTitle(entry: Pick<RunEntry, 'detOnly' | 'dtUs'>): string {
  if (entry.detOnly) return 'det-only / KAT-tier run — no recorded dt; playback time is assumed'
  if (entry.dtUs === ASSUMED_DT_US) return `recorded dt ${ASSUMED_DT_US}µs equals the 1× playback step — no distinct sim clock`
  return 'no recorded dt — playback time is assumed'
}

// ── KIND HISTOGRAM (T5b; NAMES in v0.7 T5/R4) ────────────────────────────────────────────────────
// Every kind the published runs carry now resolves to its registry name — incl. F1's motion substrate
// (0x0120 MotionSegmentStarted / 0x0121 MotionStepped), added to EVENT_KIND_NAMES from the spec-3a
// §6.5.2 registry excerpt. A kind still OUTSIDE the registry falls through to its numeric id ("kind N"),
// the same honest fallback the Timeline/Inspector use — never blank, never invented copy.
export function kindLabel(kind: number): string {
  return EVENT_KIND_NAMES[kind] ?? `kind ${kind}`
}

export interface HistogramRow { kind: number; name: string; count: number; category: CategoryKey }

// Declared histogram (index.json object, string kind keys) → display rows, sorted by count DESC then
// kind ASC (the dominant composition first, ties broken deterministically). This is DECLARED metadata
// (D4 Part 6.2) — it wears a category IDENTITY hue, never a provenance voice glyph. proven data-true
// by publication.test.ts against the real decoder.
export function histogramRows(kinds: Record<string, number>): HistogramRow[] {
  return Object.entries(kinds)
    .map(([k, count]) => { const kind = Number(k); return { kind, name: kindLabel(kind), count, category: categoryOf(kind) } })
    .sort((a, b) => (b.count - a.count) || (a.kind - b.kind))
}

// ── VERDICT VOICE (T5b, D4 checkmark economy) ────────────────────────────────────────────────────
// SESSION-EARNED ONLY: a card wears the attested voice (•) until the run has been opened AND its
// ceremony sealed green THIS session (reload ⟹ back to attested — no persisted/build-time ✓). A seal
// later BROKEN (a re-load of the same run failed verification) wears the ALARM voice (✗) — never ✓ and
// never plain attested (closure item 1): D4's "✗ escalates and persists" cuts both ways — a stale green
// over mismatching bytes is a lie, and quietly returning to • would erase witnessed session evidence.
// The verdict text is sourced from the run's OWN identity (det-only vs full-manifest), never from any
// sidecar — the profile-conflation tripwire (D4 Ruling 2): f3a is the CORRECT campaign, never ROBUST.
export type SealStatus = 'none' | 'sealed' | 'broken'
export interface CardVerdict { state: Extract<BadgeState, 'attested' | 'verified' | 'mismatch'>; label: string }
// F1 — the trust GRADE is keyed on the run's TRUSTED identity (catalogDetOnly, the in-bundle catalog pin),
// NEVER on the RunEntry.detOnly field, which is index.json-sourced (unsigned network data). Passing the runId
// (not the entry) closes the hole at the type level: a lying index entry — detOnly:false on a sealed det-only
// run — can no longer make a self-consistent run render the manifest-grade ✓ / "recomputed this session". A
// det-only-grade id (det-only certified run OR any uncertified/unknown id) can only ever earn the self-check.
export function cardVerdict(runId: string, status: SealStatus): CardVerdict {
  const detOnly = catalogDetOnly(runId)
  if (status === 'broken') {
    return { state: 'mismatch', label: detOnly ? 'seal broken · a self-check mismatched this session' : 'seal broken · a re-verification mismatched this session' }
  }
  // A2 — the ✓ (state 'verified') is reserved for a run an EXTERNAL manifest backs. A det-only run sealed
  // this session earned a SELF-check (no external oracle), so it stays in the ATTESTED voice (•) — sharpened
  // only in its LABEL ("self-verified this session…") — never the manifest-grade green it did not earn. A
  // full-manifest run sealed this session recomputed AND matched its manifest, so it wears the ✓.
  if (status === 'sealed') {
    return detOnly
      ? { state: 'attested', label: 'self-verified this session · no external oracle' }
      : { state: 'verified', label: 'recomputed this session' }
  }
  return { state: 'attested', label: detOnly ? 'det-only golden · self-checks on open' : 'certified · on record' }
}

// Voice glyphs — sourced from the single voices module so the Hangar speaks the identical grammar as every
// other surface (no per-surface literal to drift). attested/verified/mismatch are reachable from cardVerdict;
// the full BadgeState map documents intent (pending → the ○ self-check).
export const VOICE_GLYPH: Record<BadgeState, string> = {
  pending: badgeGlyph('pending'), verified: badgeGlyph('verified'),
  mismatch: badgeGlyph('mismatch'), attested: badgeGlyph('attested'),
}

// ── SESSION-SEAL STATE MACHINE (D4 Ruling 1 / NEVER #12; closure item 1) ─────────────────────────
// Session-verified state lives in the store, never localStorage/URL. A seal record names the run AND the
// exact bytes its ✓ vouches for (resultId) — and because the format claims byte-precision, the machine
// must honor it at the edges (production bytes are static per deploy, so these edges are rare — but the
// record's own claim binds):
//   • VERIFIED load, no record        → append a fresh seal (the happy path).
//   • VERIFIED load, same resultId    → no-op, SAME reference (no store churn on the ready re-fire).
//   • VERIFIED load, DIFFERENT result → REPLACE the record: the ✓ must name the bytes it just verified,
//     never the bytes of an earlier load (a stale record would vouch for bytes no longer shown).
//   • MISMATCHED load, sealed run     → BREAK the seal (broken: true, original resultId kept as the name
//     of the bytes the revoked ✓ had vouched for). Rendered in the alarm register (✗ via cardVerdict) —
//     never ✓ (stale green over demonstrably-mismatching bytes) and never plain attested (which would
//     quietly forget a witnessed mismatch).
//   • MISMATCHED load, never sealed   → no record: the card stays attested • (the ruled scope is a seal
//     that has been contradicted; the open run's own ✗ surfaces everywhere already).
//   • BROKEN is SESSION-TERMINAL: a later verified load does NOT heal it (recordSeal no-ops on a broken
//     record). Two byte-identities witnessed for one runId within a session IS the alarm — a subsequent
//     green load must not make the flicker invisible. Reload re-adjudicates (the set is in-memory only).
export interface SealRecord { runId: string; resultId: string; broken: boolean }

export function recordSeal(list: SealRecord[], runId: string, resultId: string): SealRecord[] {
  const i = list.findIndex(s => s.runId === runId)
  if (i < 0) return [...list, { runId, resultId, broken: false }]
  const existing = list[i]!
  if (existing.broken) return list                 // session-terminal: a witnessed break never heals silently
  if (existing.resultId === resultId) return list  // same bytes re-verified — no churn
  const next = [...list]                            // different verified bytes — the ✓ renames to what it saw
  next[i] = { runId, resultId, broken: false }
  return next
}

export function breakSeal(list: SealRecord[], runId: string): SealRecord[] {
  const i = list.findIndex(s => s.runId === runId)
  if (i < 0) return list                            // never sealed → stays attested (ruled scope)
  const existing = list[i]!
  if (existing.broken) return list                  // already broken — no churn
  const next = [...list]
  next[i] = { ...existing, broken: true }
  return next
}

export function sealFor(list: SealRecord[], runId: string): SealRecord | undefined {
  return list.find(s => s.runId === runId)
}

// Render-side identity guard (closure item 1's "hold only while" clause): the verified state holds only
// while the seal's resultId matches the currently-loaded run's resultId WHEN that run is the open one.
// With the reconciliation effect this window is one paint at most (and in practice unreachable — every
// Hangar card action closes the modal before a load completes) — but the render law is self-contained:
// a ✓ is painted only when the record provably names the bytes on stage. A non-open run's seal holds
// (session history is valid while its bytes are not the ones loaded); a broken seal is always broken.
export function effectiveSealStatus(
  seal: SealRecord | undefined, loadedRunId: string | null, loadedResultId: string | null,
): SealStatus {
  if (!seal) return 'none'
  if (seal.broken) return 'broken'
  if (loadedRunId === seal.runId && loadedResultId !== null && loadedResultId !== seal.resultId) return 'none'
  return 'sealed'
}

// THE IDENTITY JOIN (W1 — the one-commit run-switch race, extracted as a primitive). selectRun flips the
// store runId to the destination synchronously, but useRun still holds the PRIOR run's model/hashes for
// the one commit right after the switch; useRun sets loadedRunId ONLY in the same atomic ready-state update
// that publishes model+hashes, so `loadedRunId === runId` is true EXACTLY when the bytes currently resident
// belong to the CURRENT run — the async state joined by IDENTITY CARRIED WITH THE DATA, never by effect
// timing. THREE surfaces gate on this same join (the seal ✓, the break ✗, and the cold-open thesis verdict
// in App), so the discipline lives here as one named primitive rather than three hand-written comparisons.
export function loadIsCurrent(runId: string, loadedRunId: string | null): boolean {
  return loadedRunId === runId
}

// I6 — THE READY-SUBTREE GATE (the identity join generalized to the WHOLE ready tree). loadIsCurrent guarded
// the thesis verdict and the seal, but App gated the REST of the ready tree — the Provenance ✓ rows, the stage
// — on `model` ALONE. During the one-commit run-switch gap `model` is non-null (the PRIOR run's, still resident)
// while the store runId has already flipped, so `Boolean(model)` painted the prior model's verified glyphs +
// stage under the DESTINATION's identity for one commit — the thrice-bitten class, generalized by the audit. The
// whole ready subtree must gate on the SAME witness: a model is present AND it belongs to the current run. ONE
// gate, not a per-widget join; App shows the loading posture during the gap. Generic in the model so this leaf
// stays free of a RunModel import — it keys only on presence (non-null) + the identity join.
export function readyTreeVisible<M>(model: M | null, runId: string, loadedRunId: string | null): boolean {
  return model !== null && loadIsCurrent(runId, loadedRunId)
}

// SEAL DECISION (W1 — the seal-race fix, the cycle's most important honesty repair). A card's ✓ must
// vouch for the CURRENT run's OWN verified bytes, never the bytes still resident from the run we just
// switched away from. A seal effect that keyed on effect TIMING would mint a ✓ for the NEW runId out of
// the OLD run's verification: a false green that no later failure can unseal (there is no unseal path).
// The fix joins by loadIsCurrent (above); matchesTrailer must be a true self-consistency verdict (a ✗
// bundle publishes by design but never seals).
export function shouldSealRun(
  runId: string, loadedRunId: string | null, matchesTrailer: boolean | null | undefined,
): boolean {
  return loadIsCurrent(runId, loadedRunId) && matchesTrailer === true
}

// The mismatch twin (closure item 1) — the SAME identity join, opposite verdict: break a seal only when
// the loaded run ITSELF failed verification. The join matters here for the mirror-image race: right after
// a switch away from a mismatched run, the store runId names the destination while the stale ✗ hashes
// still name the prior run — an identity-blind break would revoke the DESTINATION's seal for the prior
// run's failure. `=== false` (not falsy): only an actual failed verdict breaks, never an absent one.
export function shouldBreakSeal(
  runId: string, loadedRunId: string | null, matchesTrailer: boolean | null | undefined,
): boolean {
  return loadIsCurrent(runId, loadedRunId) && matchesTrailer === false
}

// ── CARD NOTE COPY ───────────────────────────────────────────────────────────────────────────────
// A run's honest one-line "what it is". The f3a note names ONLY the published run's own identity — seed
// 42, a single certified run. The OTHER seed-42 bundle (the 50-seed statistical-acceptance campaign, a
// different case) is NOT mentioned here: attaching that campaign's claim to this card — even in words the
// /robust/i scan couldn't see — is the exact profile-conflation the D4 rider prohibits (controller ruling
// W2: REMOVE the sidecar-campaign sentence entirely). That campaign's story belongs to the v0.7
// Certification Wall, where it can stand as its own VERIFIED artifact with its pins-record excerpt. The
// scans (PROFILE_CONFLATION_RE) pin that this note, the rendered verdicts, and the whole index stay clean.
export const CARD_NOTES: Record<string, string> = {
  f3a: 'seed 42 · published as a single certified run.',
}

// F5 — a card note by run id, an OWN-property lookup (Object.hasOwn). entry.id comes from the UNSIGNED
// runs/index.json, so a plain-object bracket lookup would inherit from Object.prototype: CARD_NOTES['__proto__']
// returns Object.prototype and CARD_NOTES['constructor'] the Object constructor — both TRUTHY non-string values
// that crash the Hangar when rendered as a React child. The Hangar sits OUTSIDE the run-scoped ErrorBoundary, so
// that crash takes the whole app down, not just the run view. hasOwn returns the real note or undefined, never a
// prototype member. (The grammar filter closes '__proto__'/'toString' upstream, but 'constructor'/'prototype'
// conform to it — so the point-of-use guard is the complete fix for the object-lookup crash.)
export function cardNote(id: string): string | undefined {
  return Object.hasOwn(CARD_NOTES, id) ? CARD_NOTES[id] : undefined
}

// The profile-conflation tripwire (D4 rider / W2) — defined in the zero-import leaf profileConflation.ts
// so the e2e suite (tsconfig.node.json, nodenext) can import the SAME binding the unit suites scan with
// (closure item 2: the tripwire must be single-sourced — a literal copy in the smoke spec could drift
// silently). Re-exported here for the app-side consumers (hangar.test.ts, publication.test.ts).
export { PROFILE_CONFLATION_RE } from './profileConflation'
