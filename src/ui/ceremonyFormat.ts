import type { RunPhase } from './useRun'
import type { TrustVerdict } from '../decode/verify'
import { markClass, requireGlyph, type MarkKey } from './voices'

// Pure formatting/state helpers for the verification ceremony (spec §6), extracted from Ceremony.tsx
// so the phase→line state table, the short-hex elision, and the outcome-bound tick are unit-testable
// without a React render. Dependency-free (only the RunPhase type) — no DOM, no store, no side effects.

export type LineState = 'pending' | 'active' | 'done'

// Phase ordering the ceremony's three lines are keyed against.
export const ORDER: RunPhase[] = ['idle', 'fetching', 'decoding', 'verifying', 'ready']

// A line is 'active' when the phase it represents is current, 'done' once the phase has passed,
// 'pending' before it. 'fetching' precedes 'decoding', so line 1 reads pending during the fetch.
export function lineState(represents: RunPhase, phase: RunPhase): LineState {
  const cur = ORDER.indexOf(phase)
  const at = ORDER.indexOf(represents)
  if (cur > at) return 'done'
  if (cur === at) return 'active'
  return 'pending'
}

// Per-line-state glyph for the ceremony's step marks. Relocated here (with stepMark) from Ceremony.tsx so
// the mark vocabulary lives in the pure format module beside lineState; Ceremony.tsx imports both. ▪/▸ are
// PHASE glyphs (not trust-voice marks); the `done` ✓ IS the verified voice, so it is sourced from voices.ts.
export const MARK: Record<LineState, string> = { pending: '▪', active: '▸', done: requireGlyph('verified') }

// ── VERDICT-AWARE CEREMONY TICKS (the seal fold, made visible without collapsing its voices) ────────
// The ceremony's two hash rows and its step mark carry the TrustVerdict, so a self-consistent det-only run is
// never shown the manifest-grade green ✓ it did not earn. The ✓ is reserved for 'manifest-verified' (matched
// against an external manifest); 'self-consistent' wears the ○ self-check ring (the ProvenancePanel idiom for
// "recomputed, but no external oracle"); 'mismatch' is ✗.
export interface Tick { glyph: string; cls: string }

// A ceremony tick, sourced from the single voices module — glyph + class from ONE place, never a site literal.
const tick = (id: MarkKey): Tick => ({ glyph: requireGlyph(id), cls: markClass(id) })

// The result_id row + the step mark bind to the whole verdict: ✓ manifest-verified · ○ self-consistent · ✗ mismatch.
export function verdictTick(verdict: TrustVerdict): Tick {
  switch (verdict) {
    case 'manifest-verified': return tick('verified')
    case 'self-consistent': return tick('selfConsistent')
    case 'mismatch': return tick('mismatch')
  }
}

// The event_hash row is the IN-BUNDLE trailer reproduction: ✗ when the bytes did NOT reproduce their trailer;
// otherwise it inherits the run's GRADE — ○ for a self-consistent det-only run (no external oracle even for the
// trailer match), ✓ when a manifest backs it. On a manifest MISMATCH that still reproduced the trailer (e.g. a
// tampered termination_reason: matchesTrailer stays true, result_id breaks) this stays ✓ beside result_id's ✗ —
// the honest picture (the bytes reproduced; the sealed identity did not).
export function trailerTick(verdict: TrustVerdict, matchesTrailer: boolean): Tick {
  if (!matchesTrailer) return tick('mismatch')
  return verdict === 'self-consistent' ? tick('selfConsistent') : tick('verified')
}

// ── PER-PIN CEREMONY GRADING (a NAMED hash row reflects its OWN comparison, never the aggregate) ──────
// trailerTick/verdictTick key on the WHOLE verdict, so when ONLY the manifest's event_hash pin is corrupted
// (bundle clean → matchesTrailer TRUE, verdict 'mismatch') they painted the INVERSE of the truth: event_hash ✓
// beside result_id ✗ — while Provenance reds event_hash and greens result_id. pinTick grades a NAMED row from
// ITS OWN two comparisons so the ceremony and Provenance agree row-for-row:
//   • `trailerReproduced` FALSE → ✗ (THIS row's own in-bundle reproduction failed — the recomputed value did not
//     match the sealed trailer for this field). This is the row's PER-FIELD trailer comparison (trailerPins),
//     NOT the aggregate matchesTrailer — so corrupting only the trailer's state hash reds the state row while the
//     event_hash row (its own reproduction clean) stays ✓, instead of over-refusing both named rows. A field with
//     no in-bundle reproduction (result_id — the trailer stores none) passes `true` here: it cannot self-fail.
//   • pinMatch null (det-only, no manifest) → ○ self-consistent (recomputed, no external oracle);
//   • pinMatch true → ✓ manifest-matched · pinMatch false → ✗ (THIS pin disagrees with the manifest).
// The AGGREGATE verdict still drives the step mark (stepMark) + the seal; only the per-row glyphs move to per-field.
export function pinTick(pinMatch: boolean | null, trailerReproduced: boolean): Tick {
  if (!trailerReproduced) return tick('mismatch')
  if (pinMatch === null) return tick('selfConsistent')
  return pinMatch ? tick('verified') : tick('mismatch')
}

// ── result_id in the CEREMONY — a DERIVATION with an oracle ONLY under a manifest ──────────────────────
// result_id is DERIVED from trailer-SOURCED inputs (case_id + termination_reason) and the trailer stores no
// result_id to check it against, so a det-only run has NO in-bundle oracle for it: a CRC-fixed termination_reason
// changes result_id while every trailerPin stays true. Feeding it through pinTick(pinMatch, true) painted the
// det-only case (pinMatch null) as ○ — an unfalsifiable derivation wearing the self-check ring. So result_id gets
// its OWN tick: a manifest pin present → ✓/✗ against it (its real external oracle); det-only (pinMatch null) → the
// ATTESTED derived voice (•, matching the ProvenancePanel's det-only result_id badge), NEVER the ○ the trailer-
// reproduced hashes legitimately earn.
export function resultIdTick(pinMatch: boolean | null): Tick {
  if (pinMatch === null) return tick('attested')
  return pinMatch ? tick('verified') : tick('mismatch')
}

// Step-level mark carries the VERDICT, not just completion, so the outer mark can never disagree with its rows:
// a done step reads ✓ only for a manifest-verified run, ○ for a self-consistent one, ✗ on mismatch. `verdict`
// is null until it is known — a not-yet-completed step keeps its neutral phase mark.
export function stepMark(confirm: LineState, verdict: TrustVerdict | null): { glyph: string; cls: string } {
  if (confirm !== 'done' || verdict === null) return { glyph: MARK[confirm], cls: confirm }
  // A done step wears the verdict mark's glyph over the phase-`done` class (the compound `done <mark>` keeps
  // the phase class AND the verdict class so the settle animation and the verdict hue both apply).
  switch (verdict) {
    case 'manifest-verified': return { glyph: requireGlyph('verified'), cls: 'done' }
    case 'self-consistent': return { glyph: requireGlyph('selfConsistent'), cls: `done ${markClass('selfConsistent')}` }
    case 'mismatch': return { glyph: requireGlyph('mismatch'), cls: `done ${markClass('mismatch')}` }
  }
}

// Middle-elide a long hex to '8chars…4chars'; leave anything already short (<= 14) untouched.
export const shortHex = (h: string): string => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h)

// The screen-reader "ready" announcement text (App's ReadyAnnouncement live region), verdict-aware so
// assistive tech hears the SAME truth the ceremony shows visually. A mismatch publishes BY DESIGN (the
// schema/dialect gate returns early only for version mismatches; a hash/manifest mismatch is a deliberate
// load-and-show, and every visual surface reads ✗/mismatch), and a self-consistent det-only run carries no
// external oracle — so the announcement carries the verdict itself, never a blanket "verified":
//   manifest-verified: "run … verified and ready — N events, M ticks"
//   self-consistent:   "run … self-consistent, no external manifest — N events, M ticks"
//   mismatch:          "run … loaded — hash mismatch, unverified — N events, M ticks"
// null/undefined models "no verdict yet". This is UNREACHABLE at announce time: useRun publishes model and
// hashes in ONE atomic setState and ReadyAnnouncement only mounts once model is non-null, so the verdict is
// always concrete here — the branch is a defensive default that reads as the pre-verdict prior ("verified").
export function readyAnnouncementText(
  runId: string, eventCount: number, tickCount: number, verdict: TrustVerdict | null | undefined,
): string {
  const tail = `${eventCount} events, ${tickCount} ticks`
  if (verdict === 'mismatch') return `run ${runId} loaded — hash mismatch, unverified — ${tail}`
  if (verdict === 'self-consistent') return `run ${runId} self-consistent, no external manifest — ${tail}`
  return `run ${runId} verified and ready — ${tail}`
}
