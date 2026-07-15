import { queryBounds, type QueryDraw, type Vec3 } from './queryStage'
import type { Framing } from './camera'

// ── Query-stage render helpers (v0.6 T3) ──────────────────────────────────────────────────────────────
// PURE, three-free support math for the query stage renderer (queryStageView.tsx). Kept out of the model
// layer (queryStage.ts) — that layer PARSES payloads into drawables; this decides how the accumulating
// stage READS them: which act a probe belongs to, how a spent ray fades behind the head, when each
// scenario solid first materialises, where the drawn observer stands. Unit-tested (queryScene.test.ts) in
// the house style so the reveal/decay/act math is provable without mounting a Canvas. Zero allocation on
// any hot path is a non-goal here (these run in the event-rate build, never per frame) — but they allocate
// nothing beyond the one returned value regardless.

// The three acts (design draw inventory §3.1; temporally disjoint fan sources). Act I "learn the objects"
// (point/range/ray probes sweep S→B→T), Act II "sightlines from origin" (5 LOS composites), Act III "the
// drawn observer" (establish O, then 4 LOS composites from it). The two source fans — origin (0,0,0) for
// acts I/II, observer O for act III — never fire in the same tick, so an act-graded ambient tone keeps
// the two fans from reading as one snarl at the accumulated rest (§2.4 hairball ruling).
export const ACT_I_END = 35 // last seq of act I (learn the objects)
export const ACT_II_END = 55 // last seq of act II (origin LOS battery)
export const ACT_III_START = 56 // first seq of act III (the drawn observer)

// The act (1|2|3) a probe at `seq` belongs to. Clamped either side (a negative seq → act 1, a seq past the
// record → act 3) so a defensive caller never gets act 0 / 4. Pure.
export function actOf(seq: number): 1 | 2 | 3 {
  if (seq <= ACT_I_END) return 1
  if (seq <= ACT_II_END) return 2
  return 3
}

// Head-relative line decay (§2.4: fade the LINES, persist the contacts + solids). Mirrors the trajectory
// trail's shader math (trail.ts: alpha = clamp(1 − behind/span)) but stepped at EVENT rate, not per frame:
// on a positionless run nothing moves within a tick (seq == tick, one event per tick), so a per-frame uHead
// uniform would smooth a sub-tick gap that never renders. The head ray (seq === head) is full voice (1); a
// ray `span` ticks back has decayed to 0 (gone). A ray AHEAD of the head (seq > head — not yet revealed)
// returns 0 too, though the reveal gate means the caller never asks. `span` ≤ 0 → only the exact head shows
// (every older ray 0). Pure.
export function lineFadeFactor(head: number, seq: number, span: number): number {
  const behind = head - seq
  if (behind < 0) return 0 // not yet revealed
  if (span <= 0) return behind === 0 ? 1 : 0
  const f = 1 - behind / span
  return f < 0 ? 0 : f > 1 ? 1 : f
}

// THE NOT-YET GATE — is the selected probe AHEAD of the written frontier? A selection past the reveal head
// (ev > reveal) has not been written yet, so the stage previews it in the NOT-YET voice (a hollow, unbloomed
// outline of its recorded geometry) instead of the written form. False when nothing is selected, and false the
// instant the head reaches it (ev <= reveal → the written form draws instead; the two are mutually exclusive,
// so no frame draws both — the ghost fills in exactly when the playhead arrives). A pure function of the
// selection and the reveal count, so it holds in BOTH scrub directions by construction: scrub past ⟹ written
// takes over; scrub back before ⟹ it re-ghosts. Pure.
export function ghostVisible(selectedEvent: number | null, reveal: number): boolean {
  return selectedEvent !== null && selectedEvent > reveal
}

// The seq at which each scenario solid (1 sphere, 2 box, 3 triangle) is first PROBED — so the stage can
// "materialise" a body the tick its first probe references it (sphere from tk0, box from its first box
// query, triangle from its first triangle query), a write-as-you-play beat that mirrors the three acts'
// object sweep. Derived from the parsed draws (data-true), NOT hard-coded: scans POINT_IN_REGION (kind 1)
// and RAY_OCCLUDER (kind 3) draws — the two kinds that name a concrete object — for the minimum seq per
// object. RANGE_BEARING (no object) and LOS composites (object 0) are skipped. Objects never probed map to
// Infinity (never materialise). Pure; one Map allocated.
export function solidRevealSeqs(draws: readonly (QueryDraw | null)[]): Map<number, number> {
  const first = new Map<number, number>([[1, Infinity], [2, Infinity], [3, Infinity]])
  for (const d of draws) {
    if (d === null) continue
    if (d.kind === 1 || d.kind === 3) {
      const cur = first.get(d.object)
      if (cur !== undefined && d.seq < cur) first.set(d.object, d.seq)
    }
  }
  return first
}

// The drawn observer's world point — read from DATA, never assumed (design inventory: O lives in each act-III
// event's argv). Returns the `o` (kind 2/3/4) or `point` (kind 1) of the FIRST act-III draw, or null when the
// record has no act-III geometry (honest empty state — the observer marker simply never appears). Pure.
export function observerPoint(draws: readonly (QueryDraw | null)[]): Vec3 | null {
  for (let seq = ACT_III_START; seq < draws.length; seq++) {
    const d = draws[seq]
    if (d == null) continue
    return d.kind === 1 ? d.point : d.o
  }
  return null
}

// ── OBSERVER'S EYE — the POV preset (v0.6 T4b, directive II.6) ──────────────────────────────────────────
// Stand where the seed-drawn observer stands (O, read from the act-III argv — never assumed) and look toward
// the interrogated theatre (the solids + contacts centroid, queryBounds.solidsContacts). BLOCKED sightlines
// eclipse into the occluder; the world is seen from the observer's own vantage. Returned in THREE-space (the
// NED→three flip x=n, y=−d, z=e — the SAME flip the renderer + Scene's stage-bounds use) so the camera
// consume writes it directly. Null when there is no drawn observer OR no interrogated geometry (honest empty
// state — the preset becomes a no-op; f0/f1 have neither). Pure; three-free (just index math); unit-tested.
//   DEVIATION (disclosed): the aim is the tick-INVARIANT theatre centroid, not the live per-tick sightline
// endpoint — a stable §8-clean preset (one framing per model, eased on demand via the reused trail-frame
// owner) over a per-frame tracking aim; the live sightline is already drawn on the stage. frameFor is not
// used here (it composes an OFFSET from a centroid — it cannot stand the camera AT an arbitrary point O);
// only the EASE machinery is reused (directive: "§8-clean by reuse").
export function povFraming(draws: readonly (QueryDraw | null)[]): Framing | null {
  const o = observerPoint(draws)
  const theatre = queryBounds(draws).solidsContacts
  if (o === null || theatre === null) return null
  const c = theatre.center
  return { position: [o[0], -o[2], o[1]], target: [c[0], -c[2], c[1]] }
}

// The far endpoint of a mode-0 MISS ray (excerpt §1: on a mode-0 ray `target` is a DIRECTION, not a point).
// A miss hits nothing, so the drawn shaft reaches a fixed `len` world-units along the NORMALISED direction
// from `o`. The normaliser is Math.hypot over ALL THREE actual components: a direction that lies in a
// coordinate plane — e.g. [1,0,0], a real e0 row whose down component is 0 — still has a legitimate length,
// and substituting a component (the earlier `target[2] || 1`) inflated the denominator and foreshortened the
// ray (~368u instead of `len`). The RESULT is epsilon-guarded, not any single component: a zero-vector
// direction has no orientation to point along, so it collapses to `o` itself (a degenerate no-op) rather than
// dividing by zero into a NaN. Pure; returns one fresh tuple (its output is precomputed once at load, off the
// frame path).
export function missRayEndpoint(o: Vec3, dir: Vec3, len: number): Vec3 {
  const denom = Math.hypot(dir[0], dir[1], dir[2])
  const s = denom > 1e-9 ? len / denom : 0
  return [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s]
}
