import type { TrustVerdict } from '../decode/verify'

// Pure text/state helpers for the ZERO-CLICK THESIS card (v0.6 T6, P2 — the cold-open share surface).
// Dependency-free (no DOM, no store, no React) so the verdict-aware wording is unit-testable without a
// render — mirroring ceremonyFormat.ts's split from Ceremony.tsx.

// VERDICT-AWARE headline (three-voice grammar — never staged). The thesis card's headline is the RUN'S OWN
// trust verdict (A2 — the seal fold), bound exactly as the ceremony ticks and provenance rows are:
//   • manifest-verified → ✓ "verified" (recomputed + matched against the external manifest);
//   • self-consistent   → ○ "self-consistent — no external manifest" — a det-only KAT reproduces its own
//     trailer but pins no external oracle, so it wears the self-check voice, NEVER the manifest-grade green;
//   • mismatch          → ✗ (a pinned hash disagreed — loaded and shown, but the integrity claim failed).
// "verified"/"self-consistent", never "certified" — the tour captions hold the same line.
export interface ThesisVerdict { glyph: string; headline: string; cls: 'verified' | 'mismatch' | 'self' }
export function thesisVerdict(verdict: TrustVerdict): ThesisVerdict {
  switch (verdict) {
    case 'manifest-verified': return { glyph: '✓', headline: 'verified', cls: 'verified' }
    case 'self-consistent': return { glyph: '○', headline: 'self-consistent — no external manifest', cls: 'self' }
    case 'mismatch': return { glyph: '✗', headline: 'hash mismatch — integrity claim failed', cls: 'mismatch' }
  }
}

// WITHHOLD-AWARE verdict (W1 — the most trust-critical surface fails SAFE, never GREEN). null means the
// verdict is WITHHELD: the run-switch identity join failed (the resident hashes belong to a prior run) or
// no hashes exist yet, so App cannot honestly speak a verdict about the run on stage. The card then renders NO
// glyph and NO subline rather than the old `?? true` fail-GREEN default — a fail-safe blank beats painting
// the previous run's ✓ under the new run's name. A concrete verdict routes to the three-voice grammar above.
export function thesisVerdictFor(verdict: TrustVerdict | null): ThesisVerdict | null {
  return verdict === null ? null : thesisVerdict(verdict)
}

// The subline under the verdict: WHAT the verdict means, in one plain honest line (the ceremony-thesis voice
// carried into the app). Bound to the same verdict so a self-consistent run never claims an external check and
// a mismatched bundle never claims a clean re-check.
//   SCOPE (F1 — the ceremony thesis's scoping carried to this surface, matching 8f1429c's wording style): the
// det-only self-check proves ONLY what matchesTrailer folds — the event & state hashes and the frame counts,
// re-derived from the bytes and matched to the bundle's OWN sealed trailer. It deliberately does NOT say "every
// byte": result_id is DERIVED from trailer-SOURCED inputs (case_id, termination_reason) with no in-bundle oracle,
// so "every byte" would over-claim those fields. The manifest voice keeps "every byte re-checked" — under a full
// manifest the pinned cryptographic hashes ARE a real external oracle over the whole recomputed stream.
export function thesisSubline(verdict: TrustVerdict): string {
  switch (verdict) {
    case 'manifest-verified':
      return 'every byte re-checked against its pinned cryptographic hashes — live in your browser, before a single frame rendered'
    case 'self-consistent':
      return 'event & state hashes and frame counts re-derived from the bytes and matched to this bundle’s own sealed trailer — live in your browser; a det-only run pins no external manifest to compare against'
    case 'mismatch':
      return 'loaded and shown, but a pinned hash did not match — its integrity claim failed'
  }
}

// The IN-APP INDEPENDENCE LINE (P2): the README independence claim, distilled to one sentence for the app.
// The load-bearing fact of the whole project — the decoder never saw the engine's source, yet reproduces its
// hashes byte-for-byte. Static (not verdict-bound): it is a claim about how THIS APP was built, always true.
export const INDEPENDENCE_LINE =
  'The decoder was written from the engine’s binary format spec — not its source — and reproduces its cryptographic run hashes byte-for-byte.'

// COLD-OPEN CARD COLLAPSE (v0.7 T5, critic R6). The zero-click card persists over the WHOLE tour today; it
// should collapse to a header verdict chip once the auto-tour leaves its opening establishing beat. The full
// card is the cold-open share moment — authored beside beat 0, the establishing shot — and the tour reaching
// its first PLAYBACK beat (stepIndex >= 1) is the collapse signal. Pure predicate so App's collapse LATCH is
// trivial glue: the latch (once collapsed, it stays collapsed for the session) lives in App state, so an
// interrupt that resets stepIndex to 0 can never re-expand a collapsed chip. The full card itself is a
// once-per-browser first-visit surface (the first cold open persists NUDGE_KEY), so a reload from the collapsed
// state is calm — no card and no chip — and only cleared storage brings the full card back.
export function tourPastFirstBeat(tourActiveForRun: boolean, stepIndex: number): boolean {
  return tourActiveForRun && stepIndex >= 1
}
