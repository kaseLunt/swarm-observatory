// HOVER IDENTIFICATION (constitution §5 / ask-any-pixel's first citizen). Every timeline mark answers on
// hover with its identity. The timeline is canvas-drawn, so there are no DOM marks to attach titles to;
// the Timeline instead resolves "what is under the cursor" — lane from y, tick from x, then the LANE's
// nearest event (or, for a heat-mode lane, its bin aggregate) — and hands the resolved target here to
// build the single quiet line it writes to the canvas's native `title` (the run-switcher's R5 tooltip
// mechanism, made dynamic). Kept pure and injected (no RunModel, no kind-name table) so the identity
// string is unit-tested exhaustively.
//
// The mark voices, most-specific first:
//   • event tick    → `event #37 · GeometryQueryResolved · tick 37`
//   • causal arc    → appended when the event is a member of the lit chain: `· causal arc #36 → #37`
//   • heat aggregate → a heat-mode bin holding >1 event answers for the WHOLE bin (naming one event
//     would be false specificity): `12 events · ticks 120–139 · segment 2`
//   • chapter band  → when the pointed lane has nothing under the cursor (a gap):
//     `chapter: segment 2 · ticks 24–48`
// A degenerate run with none of these still answers with the bare tick — the pixel is never mute.
// Callers set at most ONE of event/aggregate (a lane is either ticks- or heat-mode); event wins if both.
import { identityPlate, compactPlate } from './identityPlate'

export interface HoverTarget {
  tick: number
  // `subject` (optional) is the namespace-1 entity the event is ABOUT — named with its compact identity
  // plate (G19). Optional so callers/tests that don't resolve a subject are unaffected.
  event: { seq: number; kind: number; tick: number; parentSeq: number | null; subject?: string | null } | null
  aggregate: { count: number; startTick: number; endTick: number } | null
  chapter: { label: string; startTick: number; endTick: number } | null
}

export function hoverIdentity(t: HoverTarget, kindName: (kind: number) => string): string {
  if (t.event) {
    // The subject clause consumes the identity plate: "event #37 · … · tick 37 · ▸ ALFA" (G19). The raw seq
    // stays the data-true handle; the callsign is a presentational label (never serialized).
    const subj = t.event.subject ? ` · ${compactPlate(identityPlate(t.event.subject, 'entity'))}` : ''
    const base = `event #${t.event.seq} · ${kindName(t.event.kind)} · tick ${t.event.tick}${subj}`
    // parentSeq is non-null only when the event belongs to the currently-lit chain (arcs reserved for
    // selection), so the causal-arc voice appears exactly when an arc is actually drawn under the mark.
    return t.event.parentSeq !== null
      ? `${base} · causal arc #${t.event.parentSeq} → #${t.event.seq}`
      : base
  }
  if (t.aggregate) {
    const base = `${t.aggregate.count} events · ticks ${t.aggregate.startTick}–${t.aggregate.endTick}`
    return t.chapter ? `${base} · ${t.chapter.label}` : base
  }
  if (t.chapter) return `chapter: ${t.chapter.label} · ticks ${t.chapter.startTick}–${t.chapter.endTick}`
  return `tick ${t.tick}`
}
