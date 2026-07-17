import { queryBounds, SPHERE, BOX, TRIANGLE, type QueryDraw, type Vec3, type LosComposite } from './queryStage'
import { boundsFromPositions, type Bounds, type Framing } from './camera'

// ── Query-stage render helpers (v0.6) ──────────────────────────────────────────────────────────────
// PURE, three-free support math for the query stage renderer (queryStageView.tsx). Kept out of the model
// layer (queryStage.ts) — that layer PARSES payloads into drawables; this decides how the accumulating
// stage READS them: which act a probe belongs to, how a spent ray fades behind the head, when each
// scenario solid first materialises, where the drawn observer stands. Unit-tested (queryScene.test.ts) in
// the house style so the reveal/decay/act math is provable without mounting a Canvas. Zero allocation on
// any hot path is a non-goal here (these run in the event-rate build, never per frame) — but they allocate
// nothing beyond the one returned value regardless.

// The three acts (the design draw inventory; temporally disjoint fan sources). Act I "learn the objects"
// (point/range/ray probes sweep S→B→T), Act II "sightlines from origin" (5 LOS composites), Act III "the
// drawn observer" (establish O, then 4 LOS composites from it). The two source fans — origin (0,0,0) for
// acts I/II, observer O for act III — never fire in the same tick, so an act-graded ambient tone keeps
// the two fans from reading as one snarl at the accumulated rest (the hairball ruling).
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

// Head-relative line decay (fade the LINES, persist the contacts + solids). Mirrors the trajectory
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

// ── OBSERVER'S EYE — the POV preset (v0.6) ──────────────────────────────────────────
// Stand where the seed-drawn observer stands (O, read from the act-III argv — never assumed) and look toward
// the interrogated theatre (the solids + contacts centroid, queryBounds.solidsContacts). BLOCKED sightlines
// eclipse into the occluder; the world is seen from the observer's own vantage. Returned in THREE-space (the
// NED→three flip x=n, y=−d, z=e — the SAME flip the renderer + Scene's stage-bounds use) so the camera
// consume writes it directly. Null when there is no drawn observer OR no interrogated geometry (honest empty
// state — the preset becomes a no-op; f0/f1 have neither). Pure; three-free (just index math); unit-tested.
//   DEVIATION (disclosed): the aim is the tick-INVARIANT theatre centroid, not the live per-tick sightline
// endpoint — a stable load-budget-clean preset (one framing per model, eased on demand via the reused trail-frame
// owner) over a per-frame tracking aim; the live sightline is already drawn on the stage. frameFor is not
// used here (it composes an OFFSET from a centroid — it cannot stand the camera AT an arbitrary point O);
// only the EASE machinery is reused (load-budget-clean by reuse).
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

// ── e0 AUTHORED TOUR SHOTS (v0.8) — decode-true vantages for the query-stage tour ─────────────────────
// Two shots the query-stage tour arrives on, composed from the SAME decoded geometry the stage draws (the v0.7
// discipline: every tour number re-derived from the model, never eyeballed). Both flip NED→three with the self-
// contained basis-B convention (x=n, y=−d, z=e) the renderer + povFraming use, so what is framed is what is
// drawn — never the app-wide flight basis A (this stage is positionless; nothing on it is in basis A). Pure;
// off the frame path (memoized once per model in Scene, the sibling of stageBounds / observerFraming).

// The blocking occluder BODY's three-space extremal points, keyed by the DECODED blocker object id (1 sphere ·
// 2 box · 3 triangle) — mirroring queryStage.seedSolids, but for the ONE occluder a corridor shot must show.
// The id is decoded (firstBlocker.object); the body is the pinned scenario constant. Sphere → its ±radius AABB
// corners; box → its min/max; triangle → its three verts. An unpinned id yields no points (the fit falls to the
// eye + contact alone — an honest degradation, never a throw).
function occluderBodyExtent(object: number): Vec3[] {
  if (object === 1) { const { center: c, radius: r } = SPHERE; return [[c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]] }
  if (object === 2) return [BOX.min, BOX.max]
  if (object === 3) return [TRIANGLE.a, TRIANGLE.b, TRIANGLE.c]
  return []
}

// SHOT 1 "the first block" — the corridor of the FIRST BLOCKED sightline. Fit {the sightline origin (the eye),
// the blocking occluder body, the death contact where the ray dies}, three-space, so the ray dying at the
// occluder is the frame's event with the origin→occluder run in view. The composite (lowest-seq BLOCKED), the
// blocker's occluder object, and the contact are ALL decoded — never eyeballed (e0's first block is tk39, the
// sphere at n=191, but this is derived, not pinned). Returns a three-space Bounds the tour frames with the
// house fit (frameFor), or null when the record carries no blocked sightline (honest empty state → the shot
// falls through to the trajectory-so-far default, like a 'conjunction' on a non-sensing run).
export function blockedCorridorBounds(composites: ReadonlyMap<number, LosComposite>): Bounds | null {
  let best: LosComposite | null = null
  for (const c of composites.values()) {
    if (c.los.verdict === 'BLOCKED' && c.firstBlocker?.hitPoint != null && (best === null || c.seq < best.seq)) best = c
  }
  if (best === null || best.firstBlocker?.hitPoint == null) return null
  const fb = best.firstBlocker
  const pts: number[] = []
  const push = (v: Vec3): void => { pts.push(v[0], -v[2], v[1]) } // NED→three (basis B): x=n, y=−d, z=e
  push(best.los.o)                                       // the eye — the sightline's origin
  push(fb.hitPoint!)                                     // the death contact — where the ray dies
  for (const p of occluderBodyExtent(fb.object)) push(p) // the blocking occluder body — so the interposition reads
  return boundsFromPositions(new Float32Array(pts), pts.length / 3)
}

// SHOT 2 "the second observer" — the crane that STAGES the Observer's-Eye POV. Stand BEHIND and ABOVE the drawn
// observer and aim at the interrogated theatre: the observer marker reads in the foreground (the eye the O key
// will drop the viewer into) with the world it questions ahead (lead room). The look AXIS is povFraming's own
// (observer → theatre centroid), so the post-tour O keypress is a forward dolly down this SAME axis into the
// eye. The eye and the theatre centroid are DECODED (observerPoint + queryBounds.solidsContacts); the pull-back
// and lift are authored FRACTIONS of the theatre radius — scene-scaled, so the crane can never rot on a
// re-decode into a magic absolute. Returns a complete three-space Framing (like povFraming — a directed vantage,
// not a fittable box), or null when there is no drawn observer or theatre (honest empty state).
// Calibrated on browser screenshots (v0.8): back 0.8·R seats the eye at ~15% of frame height (a foreground
// marker, not a speck), and lift 0.15·R drops the observer to the lower third (a 3/4 crane) with the theatre it
// interrogates above/ahead — the eye clearly introduced, its sightlines fanning up into the world it questions.
export const CRANE_BACK_K = 0.8 // pull-back behind the eye, in theatre-radius units
export const CRANE_LIFT_K = 0.15 // crane height above the eye, in theatre-radius units
export function observerCraneFraming(draws: readonly (QueryDraw | null)[]): Framing | null {
  const o = observerPoint(draws)
  const theatre = queryBounds(draws).solidsContacts
  if (o === null || theatre === null) return null
  const eye: [number, number, number] = [o[0], -o[2], o[1]]                                              // three-space eye
  const target: [number, number, number] = [theatre.center[0], -theatre.center[2], theatre.center[1]]   // three-space theatre centroid
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) return null // degenerate: eye coincident with the theatre — no look axis to crane along
  const ux = dx / len, uy = dy / len, uz = dz / len // unit look axis (eye → theatre) — the povFraming direction
  const back = theatre.radius * CRANE_BACK_K
  const lift = theatre.radius * CRANE_LIFT_K
  const position: [number, number, number] = [eye[0] - ux * back, eye[1] - uy * back + lift, eye[2] - uz * back]
  return { position, target }
}
