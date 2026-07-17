// ── Query-stage reveal clock ───────────────────────────────────────────────────────────────────────────
// What remains of the former causal-spine module. The presentational helix layout (spineLayout /
// spineLayoutInto / spinePositions and the SPINE_* helix constants) was retired with ChainSpine when the
// QUERY STAGE (queryStageView.tsx) replaced it as e0's stage — e0 no longer draws a procedural helix, it
// writes the real kind-23 geometry. Only the reveal clock survives, because the query stage reuses it verbatim
// as its write-as-you-play head count.

// The reveal count at playhead `tick` (v0.5c, owner amendment). e0 fires one geometry-query event per
// tick (event seq == tick), so at tick t the run has revealed events 0..t. QueryStage consumes this as its head
// seq: draws 0..reveal are written, the head (seq === reveal) is the live probe. drawRange-style — it grows as
// the playhead advances and TRUNCATES on a scrub back (a pure function of tick, BOTH directions by
// construction, mirroring the trajectory trail's reveal). Clamped to eventCount-1 (the last event) so the
// terminal ticks hold the complete record — e0 rests at tickCount 75, one past its last event (seq 74) — making
// the finale's full-stage render the natural endpoint of the SAME accumulation, not a separate mechanism.
// Floored at 0 (tick 0 → nothing revealed; a defensive negative tick → 0). Pure; unit-tested. eventCount<1
// collapses to 0.
export function spineRevealCount(tick: number, eventCount: number): number {
  return Math.max(0, Math.min(tick, eventCount - 1))
}
