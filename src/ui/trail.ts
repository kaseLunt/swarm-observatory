import { entityPosition } from './placement'
import type { BoundsSource } from './camera'
import type { StateFrame } from '../lib/brand'

// ── Trajectory trail ────────────────────────────────────────────────────────────────────────────────
// Precompute the subject's WHOLE recorded path ONCE at model load (Task 2 §3). It's recorded data — the
// entire path is known up front — so there is no ring buffer to grow: we lay down one vertex per tick and
// let the frame loop reveal the traveled portion via drawRange (a single integer write per frame, zero
// allocation). Vertex i corresponds to tick i (positions are held for ticks where the subject is absent,
// keeping drawRange = tick+1 exactly tick-aligned).
//
// FADE (Task v04-2 §1) is HEAD-RELATIVE and lives in the trail's shader (see Scene.TrajectoryTrail), NOT a
// precomputed per-vertex ramp. The old ramp baked alpha against the FINAL run length, so at tick 1 of 64
// the freshly-revealed head rendered at ~0.07 alpha — a near-invisible trail through most of playback. The
// shader instead fades from a bright head over ~N ticks behind the CURRENT revealed index (a `uHead`
// uniform written once per frame beside setDrawRange). This module therefore emits a per-vertex `index`
// attribute (i for vertex i) — computed once here — that the vertex shader differences against uHead.
//
// SUBJECT RULE (v0.4.1): the trail subject is entityKeys()[0] — the first namespace-1 entity
// present at the run's FIRST POPULATED tick, in decode order. Deterministic from bundle bytes.
// (entityKeys() no longer reads tick 0 specifically: a subject that spawns at tick k>0 still defines
// the subject here, so the trail backfills its pre-spawn ticks instead of rendering nothing.)
// Single-subject is a deliberate presentation choice for current single-agent content; per-entity
// trails are content-gated future work (campaign bundles).

// Below this bbox-diagonal extent the "path" is a static point (f0) — not a trajectory to draw. Exported so the
// sensing-stage gate (sensingStage.sensingStageApplies) tests the SAME emptiness bar against the sensing subject
// (M7): a positioned-but-static subject yields an empty trail buffer, so the stage must be withheld there.
export const MIN_EXTENT = 1e-2

// Head-relative fade tuning (consumed by the trail shader's uniforms in Scene.tsx). The head is bright;
// alpha decays to TAIL over FADE_TICKS ticks behind the revealed head, then holds at a faint TAIL so an
// old tail stays perceptible without competing with the head. Kept here so trail tuning lives in one place.
export const TRAIL_HEAD_ALPHA = 0.9
export const TRAIL_TAIL_ALPHA = 0.06
export const TRAIL_FADE_TICKS = 24

// `first` is the frame index of the subject's FIRST PRESENT tick (−1 for an empty trail). It is the ONE fact
// the hold-filled `positions` buffer cannot carry on its own: the buffer back-fills pre-spawn ticks with the
// first known position, so positions[k] for k < first is a fabricated hold, not a real presence. camera.heldSubjectPose
// reads `first` to return NULL before first appearance (suppress the directed beat) while treating every k ≥ first
// as the subject's last-present pose (the hold-fill IS the amortized backward scan, precomputed here at load).
export interface Trail { positions: Float32Array; index: Float32Array; count: number; first: number }

const scratch: [number, number, number] = [0, 0, 0]
// Collapse signed zero (entityPosition maps y=-D, so D=0 → -0) to +0 — harmless in rendering but a
// footgun for equality-based consumers and tests (mirrors camera.ts trajectoryBounds).
const norm0 = (v: number): number => (v === 0 ? 0 : v)

// Build the trail buffers for `source`. Returns count 0 (empty buffers) when there is no drawable
// trajectory: no positioned entities (e0), or a static single point (f0). `positions` is interleaved xyz
// (count*3 floats); `index` carries the vertex index i for vertex i (count floats) for the shader fade.
//
// SUBJECT (M7): defaults to entityKeys()[0] (the SUBJECT RULE above — single-subject content today). A caller
// MAY pin a specific subject: the sensing stage tints the entity the kind-22 verdicts NAME, which need not be
// entityKeys()[0] on a multi-entity run. A subjectKey absent from every frame back-fills to empty (first < 0 →
// the honest positionless shape), so the gate that builds a subject's trail also detects "the subject has no
// flight". For the single-subject certified bundles subjectKey === keys[0], so this is byte-identical.
export function buildTrail(source: BoundsSource, subjectKey?: string): Trail {
  const keys = source.entityKeys()
  const n = source.tickCount + 1
  const empty: Trail = { positions: new Float32Array(0), index: new Float32Array(0), count: 0, first: -1 }
  if (keys.length === 0 || n < 2) return empty
  const subject = subjectKey ?? keys[0]!

  const positions = new Float32Array(n * 3)
  let first = -1
  let minx = Infinity, miny = Infinity, minz = Infinity
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
  for (let t = 0; t < n; t++) {
    // Load-path walk (once at model publish); brand the integer counter at the frame-domain boundary (F2).
    const e = source.entityStatesAt(t as StateFrame).get(subject)
    if (e) {
      entityPosition(scratch, e, 0)
      if (first < 0) first = t
      if (scratch[0] < minx) minx = scratch[0]; if (scratch[0] > maxx) maxx = scratch[0]
      if (scratch[1] < miny) miny = scratch[1]; if (scratch[1] > maxy) maxy = scratch[1]
      if (scratch[2] < minz) minz = scratch[2]; if (scratch[2] > maxz) maxz = scratch[2]
      positions[t * 3] = norm0(scratch[0]); positions[t * 3 + 1] = norm0(scratch[1]); positions[t * 3 + 2] = norm0(scratch[2])
    } else if (t > 0) {
      // Absent AFTER spawn: hold the previous vertex (a degenerate, invisible zero-length segment) so
      // vertex i stays aligned to tick i rather than snapping the line back to the origin.
      positions[t * 3] = positions[(t - 1) * 3]!; positions[t * 3 + 1] = positions[(t - 1) * 3 + 1]!; positions[t * 3 + 2] = positions[(t - 1) * 3 + 2]!
    }
    // (Absent pre-spawn ticks stay [0,0,0] here and are back-filled from the first position below.)
  }
  if (first < 0) return empty
  // Back-fill pre-spawn ticks with the FIRST known position so the trail's head starts at the spawn point
  // instead of drawing a spurious segment from the world origin.
  for (let t = 0; t < first; t++) {
    positions[t * 3] = positions[first * 3]!; positions[t * 3 + 1] = positions[first * 3 + 1]!; positions[t * 3 + 2] = positions[first * 3 + 2]!
  }
  const extent = Math.hypot(maxx - minx, maxy - miny, maxz - minz)
  if (extent < MIN_EXTENT) return empty

  // Per-vertex index (i for vertex i), precomputed once. The vertex shader computes `uHead - index` (ticks
  // behind the revealed head) to drive the head-relative alpha fade — no per-frame per-vertex work.
  const index = new Float32Array(n)
  for (let i = 0; i < n; i++) index[i] = i
  return { positions, index, count: n, first }
}
