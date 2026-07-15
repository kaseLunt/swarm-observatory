import type { RunModel } from '../model/runModel'

const MOTION_SEGMENT_STARTED = 0x0120

// Extracted as a pure function so the lead-in branch (exercised only when a run's first
// MotionSegmentStarted is NOT at tick 0) has a direct unit test -- no fixture in
// contract/fixtures currently starts mid-lead-in, so this is the only coverage for that path.
// Exported for tests: unit-tested directly in chapters.test.ts.
export function chapterLabel(prelude: boolean, index: number): string {
  return prelude ? (index === 0 ? 'lead-in' : `segment ${index}`) : `segment ${index + 1}`
}

// Defensive normalization: the upstream decoder does NOT enforce tick monotonicity and
// duplicate segment ticks are representable, so segment starts must be sorted+deduped before
// they become chapter boundaries -- otherwise degenerate input produces zero-width ([0,0)) or
// negative-width ([8,3), end before start) chapters. Pure; returns a NEW array, never mutating
// the caller's.
// Exported for tests: unit-tested directly in chapters.test.ts.
export function normalizeStarts(starts: number[]): number[] {
  return [...new Set(starts)].sort((a, b) => a - b)
}

// O(eventCount) envelope decodes per call — call once per model and cache in the consumer.
export function deriveChapters(model: RunModel): Array<{ startTick: number; endTick: number; label: string }> {
  const starts: number[] = []
  for (let seq = 0; seq < model.eventCount; seq++) {
    if (model.eventAt(seq).kind === MOTION_SEGMENT_STARTED) starts.push(model.ticks[seq]!)
  }
  if (starts.length === 0) return [{ startTick: 0, endTick: model.tickCount, label: 'run' }]
  // Normalize FIRST, then decide prelude from the true minimum boundary. A real segment already at
  // tick 0 yields prelude=false with no synthetic leading 0 to collapse (deletes the old
  // unshift-then-dedup subtlety and the doubly-degenerate label residual it left when raw starts[0]
  // was nonzero but a real segment sat at 0). A genuine mid-lead-in first segment (min > 0) gets an
  // honest 'lead-in' span prepended.
  const normalized = normalizeStarts(starts)
  const prelude = normalized[0] !== 0
  const boundaries = prelude ? [0, ...normalized] : normalized
  return boundaries.map((s, i) => ({
    startTick: s,
    endTick: i + 1 < boundaries.length ? boundaries[i + 1]! : model.tickCount,
    label: chapterLabel(prelude, i),
  }))
}

// The chapter containing a tick — the hover-identity lookup for the timeline's chapter bands (a first-
// time viewer hovering empty ribbon between events reads "which segment am I in"). Chapters are contiguous
// from tick 0, so the first band whose endTick exceeds the tick owns it; the final band's endTick ===
// tickCount, so a hover at the extreme right edge (tick === tickCount, clamped by tickAtX) falls through
// to the last chapter rather than answering nothing. Returns null only for an empty chapter list. Pure.
export function chapterAt(
  chapters: Array<{ startTick: number; endTick: number; label: string }>,
  tick: number,
): { startTick: number; endTick: number; label: string } | null {
  for (const c of chapters) if (tick < c.endTick) return c
  return chapters.length ? chapters[chapters.length - 1]! : null
}

// Pure tick-span → pixel-band geometry. x = startTick/tickCount * width; the end is computed with
// the SAME expression a following band uses for its own x (endTick/tickCount * width) and w is
// derived from that shared end, not from the span independently. Chapters are contiguous (chapter
// i's endTick === chapter i+1's startTick), so deriving w independently as
// (endTick-startTick)/tickCount*width could round to a different float64 than the next band's x —
// a ULP-scale gap or overlap that shows up as a visible seam under the alternating tint. Computing
// x and w from the two textually-identical boundary expressions guarantees bands[i].x + bands[i].w
// === bands[i+1].x exactly. The Timeline calls this once per model with width=1 to get
// fraction-domain bands, then multiplies by the live canvas width inside the rAF draw loop
// (arithmetic only — zero per-frame allocation). tickCount is floored at 1 to match the draw loop's
// divide-by-zero guard for a degenerate 0-tick run.
export function chapterBands(
  chapters: Array<{ startTick: number; endTick: number; label: string }>,
  tickCount: number,
  width: number,
): Array<{ x: number; w: number; label: string }> {
  const tc = Math.max(1, tickCount)
  return chapters.map(c => {
    const x = (c.startTick / tc) * width
    const end = (c.endTick / tc) * width
    return { x, w: end - x, label: c.label }
  })
}
