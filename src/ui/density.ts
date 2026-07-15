export function densityBins(ticks: Float64Array, tickCount: number, bins: number): Float32Array {
  const out = new Float32Array(bins)
  if (tickCount === 0) return out
  for (let i = 0; i < ticks.length; i++) {
    const b = Math.min(bins - 1, Math.floor((ticks[i]! / tickCount) * bins))
    out[b]!++
  }
  const max = Math.max(...out)
  if (max > 0) for (let i = 0; i < bins; i++) out[i]! /= max
  return out
}

// PROGRESSIVE DENSITY threshold (constitution §5 "ticks sparse → heat dense"). A lane renders its events
// as individual per-event marks only while each mark commands enough horizontal room to read as its own
// stroke; past that the marks smear into one solid mass, which an alpha-graded heat gradient renders more
// honestly (aggregate-first). The switch is derived, not guessed, from two fixed quantities:
//   MARK_PITCH_PX  = 3    — the tightest centre-to-centre spacing (~1.5px stroke + ~1.5px gap) at which
//                           two adjacent marks still read as two, not one.
//   TIMELINE_BUFFER_W = 1200 — the Timeline canvas's fixed backing-store width (its <canvas width>).
//   MARKS_MAX = floor(1200 / 3) = 400 — the most distinct marks the axis can seat.
// A lane with more events than MARKS_MAX cannot show them all distinctly, so it draws heat; at or under,
// ticks. Today's fixtures sit far below the line (e0: 75, f1: 67 — single-lane), so they render as marks;
// campaign-scale runs cross it and render as heat. Decided per LANE (each row switches on its own count),
// so a dense comms lane can heat while a sparse fact lane in the same run stays marks.
export const MARK_PITCH_PX = 3
export const TIMELINE_BUFFER_W = 1200
export const MARKS_MAX = Math.floor(TIMELINE_BUFFER_W / MARK_PITCH_PX)
export function densityMode(laneEventCount: number): 'ticks' | 'heat' {
  return laneEventCount > MARKS_MAX ? 'heat' : 'ticks'
}
