// Single authority for the dt assumption on manifests that omit dtUs. Display surfaces
// (ProvenancePanel) label values derived from it as assumed — keep that labeling honest if this value
// ever changes. DISPLAY-ONLY: dt is a recorded provenance fact and no longer participates in playback
// pacing (see advancePlayhead below), so do NOT reuse it as a rate input.
export const ASSUMED_DT_US = 1000

// Wall-clock duration of one FULL run played at 1× — the witness-normalized base. Playback is paced so
// 1× always covers a whole run (0 → maxTick) in ~WITNESS_RUN_SECONDS regardless of how many ticks the
// run has or what dt it recorded; the ladder scales it (4× → ~2s, 0.25× → ~32s). dtUs is deliberately
// absent from the rate — pacing is a presentation choice; dt is recorded provenance (ProvenancePanel).
export const WITNESS_RUN_SECONDS = 8

export function advancePlayhead(tick: number, fraction: number, dtMs: number, speed: number, maxTick: number) {
  // Run-normalized rate: speed · maxTick / WITNESS_RUN_SECONDS ticks per wall second, so a full run
  // (maxTick ticks) at 1× takes WITNESS_RUN_SECONDS. maxTick sits in the NUMERATOR here, so it can never
  // divide, NaN, or hang; correctness rests entirely on the `ticks >= maxTick → rest at maxTick, done`
  // clamp below — a zero-length run (maxTick 0) makes the delta 0, so the very first call clamps and rests
  // at once. Math.max(1, maxTick) is thus NOT load-bearing here; it's defensive symmetry with witnessSpeed,
  // where Math.max(1, tickCount) guards a REAL division (tickCount in the denominator) and IS load-bearing.
  const ticks = tick + fraction + (dtMs / 1000) * speed * (Math.max(1, maxTick) / WITNESS_RUN_SECONDS)
  if (ticks >= maxTick) return { tick: maxTick, fraction: 0, done: true }
  return { tick: Math.floor(ticks), fraction: ticks - Math.floor(ticks), done: false }
}

// Tour-only PRESENTATION pacing. Under the witness-normalized base (advancePlayhead) a tour play step
// covers only a SPAN of the run, so at the user's ladder speed it would last (span/tickCount)·
// WITNESS_RUN_SECONDS/speed seconds — uneven step to step (f1 step ≈4s, e0 step ≈2s at 1×). witnessSpeed
// re-normalizes each step to ~`seconds` of wall time regardless of its span-fraction: solve
//   seconds = span / (speed · tickCount / WITNESS_RUN_SECONDS)   ⇒   speed = span·WITNESS_RUN_SECONDS / (seconds·tickCount).
// The driver applies this to its OWN bracketed play step via store.setState (NOT setSpeed, which snaps
// to the user ladder [0.25,1,4,8]) so the presentation rate can sit BETWEEN notches and read as
// off-ladder; the user's ladder speed is restored on every exit path. USER playback is untouched — the
// tour was always scripted pacing, so normalizing its own scripted play step to be witnessable is honest.
//
// WITNESS_SECONDS (the wall time a tour play-step FLIGHT is normalized to, ~3s — the post-arrival dwell is
// holdMs, a separate knob) is distinct from WITNESS_RUN_SECONDS (the per-RUN 1× duration, ~8s): a single
// play step's flight is normalized to the former; a whole 1× run runs for the latter.
// KNOWN COSMETIC (accepted): a FUTURE tour whose witnessSpeed happens to equal a ladder member would
// light that button during its step (Timeline's off-ladder dimming keys on exact membership). Shipped
// tours don't — e0 → 0.7111, f1 → 1.3333, both off-ladder.
export const WITNESS_SECONDS = 3
export function witnessSpeed(span: number, tickCount: number, seconds: number = WITNESS_SECONDS): number {
  return (Math.max(1, span) * WITNESS_RUN_SECONDS) / (seconds * Math.max(1, tickCount))
}
