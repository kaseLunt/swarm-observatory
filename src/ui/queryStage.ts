import type { GeometryQuery } from '../decode/payloads'
import { boundsFromPositions, type Bounds } from './camera'
import { QUERY_KIND, SPHERE, BOX, TRIANGLE, type Vec3 } from './queryScenario'
import { validateRegistration, type LensRegistration, type PixelClass } from './lensContract'
import { makeWitnessInputs } from './agreeSource'

// ── The Query Stage — e0 kind-23 model layer ─────────────────────────────────────────────
//
// A PURE, load-path model layer that turns each decoded GeometryQueryResolved (core kind 23) payload into
// a drawable primitive. The decoder already returns the payload (RunModel.geometryQueryAt); until now its
// `argv` was 100% dark. This module lights it — nothing here touches the decoder or the frame path.
// Semantics of record: contract/EXP-E0-kind23-geometry-excerpt.md §1 (per-kind argv/result layouts),
// §2 (the pinned scene), §3 (the drawn observer), §4 (FRAME/TIEBREAK). Every number is proven against the
// frozen design draw table in queryStage.oracle.test.ts.
//
// ⚠ BINDING CONSTRAINT (constitution-level, decision-forms excerpt): bearings in the bundle are pinned
// vendored-libm KAT bits. This layer NEVER recomputes a bearing via platform Math.atan2 (or any trig) — it
// surfaces the stored result_scalars[1] bits verbatim (see queryDraw kind 2). Pure arithmetic on decoded
// data (√d², o+t·dir, lerp, |dir|, rad→deg scale) is fine; recomputing a stored transcendental is not.
//
// The load budget: this is a LOAD-PATH layer (buildQueryDraws is the one-pass sibling of buildTrail,
// run ONCE at model publish). Its allocations happen at publish time; the frame path reveals
// precomputed buffers. Zero STEADY per-frame allocation is preserved by never calling these per frame.
//
// ── LAW-4 DECLARATION (the constitution's first compliant citizen; §3 LAW 4) ─────────
// A lens must declare, before implementation, its question / surface / borrowed hue / what it dims /
// honest empty state. This is that declaration, filed in-code as the constitution requires:
//
//   • QUESTION (§1): primarily Q1 "Where/when is it?" — the stage places every probe in real NED space
//     (points, rays, segments, sightlines, contacts). Q2-adjacent "Why did it happen?" via the tiebreak
//     beats (the boundary decided it) and the LOS composition (which occluder blocked); Q5-adjacent
//     "Can I trust this pixel?" via the honesty chip below.
//   • SURFACE (LAW 3, drama vs. density): DRAMA on the 3D stage — the accumulating geometry (rays fade
//     spent, contacts + solids persist). DENSITY in the instruments — the timeline lanes summarize
//     the same events; the Inspector gains a parsed argv row (the interpreted point / range·bearing /
//     hit point). This module is the DATA layer feeding both; it renders nothing.
//   • BORROWED HUE (LAW 2, palette does not grow): none introduced. Verdicts reuse the existing verdict
//     pair (theme `verified` / `mismatch`) exactly as the pulse already colours a query's verdict; the
//     ambient probe geometry wears the `query` category hue (theme.ts CATEGORY.query — matte steel) it
//     already owns everywhere; tiebreak reuses the Inspector's existing tiebreak vocabulary. (If the
//     swatch lands at the owner gate, the verdict pair becomes a token-VALUE swap — still no new
//     colour here.) This model layer sets NO colour; it only names the hues the renderer borrows.
//   • WHAT IT DIMS (LAW 1, emphasis budget): the stage keeps one probe at full voice — the current tick's
//     ray — while spent rays decay and only contacts + solids persist (the reveal clock). On selection the
//     causal chain re-lenses: the selected probe's geometry lights, the rest dim (the shipped dimming
//     machinery). The lens never adds a glow; it reallocates the existing budget.
//   • HONEST EMPTY STATE: a run with no kind-23 events decodes to all-null draws → the stage draws
//     nothing and queryBounds returns null presets (caller keeps the composed default framing). Region
//     bodies (sphere/box/triangle) are NOT in any payload — they are SCENARIO constants (excerpt §2,
//     spec-3b:932); the honesty chip (QUERY_STAGE_HONESTY) states exactly that, narrowing the spine's
//     "layout is presentational" to "geometry is decoded-real; occluder & region bodies are scenario
//     constants". A POINT_IN_REGION whose region we cannot draw from data still draws its point + verdict
//     honestly; the solid body comes only from the labelled constant.

// Vec3 + the query sub-kinds + the pinned scenario geometry (SPHERE/BOX/TRIANGLE, excerpt §2) live in
// queryScenario.ts — a deliberately ZERO-IMPORT module — so the verification surface (showMath.ts) can
// consume them without pulling THIS module's runtime import of ./camera (sanctioned framing trig) into
// its value-import closure (see the SCAN-COVERAGE pin in showMath.test.ts). Re-exported VERBATIM here so
// every existing consumer keeps its import path; the normative excerpt commentary moved with the values.
export { QUERY_KIND, SPHERE, BOX, TRIANGLE } from './queryScenario'
export type { Vec3 } from './queryScenario'

// object id → the scenario object it names (excerpt §1: 0 none/composite, 1 sphere, 2 box, 3 triangle).
export const SCENARIO_OBJECT: Record<number, string> = { 0: 'none/composite', 1: 'S(sphere)', 2: 'B(box)', 3: 'T(triangle)' }

// The honesty chip wording (LAW-4 empty-state declaration made visible). renders it wherever the stage
// draws scenario bodies — the presentational-truth pattern the spine chip established, narrowed here.
export const QUERY_STAGE_HONESTY = 'geometry is decoded-real — occluder & region bodies are scenario constants'

// ── The drawable, per kind (a discriminated union keyed on the query sub-kind) ─────────────────────────

export interface PointDraw {
  kind: 1
  seq: number
  object: number // region tested: 1 sphere S, 2 box B
  point: Vec3
  verdict: 'INSIDE' | 'OUTSIDE'
  tiebreak: boolean
  d2: number | null // squared distance to centre — sphere (object 1) only; box carries no scalar
  dist: number | null // √d2 (sphere only)
}

export interface RangeBearingDraw {
  kind: 2
  seq: number
  o: Vec3
  g: Vec3
  rangeM: number
  bearingRad: number // STORED KAT bits, surfaced verbatim — never recomputed via atan2 (binding constraint)
  bearingDeg: number // bearingRad · 180/π — a linear scale of the stored bits, not a transcendental recompute
  tiebreak: boolean
  // NO verdict: RANGE_BEARING's result_flag is constant `true` (excerpt §5) → it carries no meaning. This
  // is a measurement, not a decision — the absence of the field encodes that.
}

export interface RayDraw {
  kind: 3
  seq: number
  object: number // occluder: 1 sphere, 2 box, 3 triangle
  mode: 0 | 1 // 0 = infinite ray (target is a DIRECTION); 1 = segment (target is the ENDPOINT)
  o: Vec3
  target: Vec3 // direction (mode 0) or endpoint (mode 1)
  verdict: 'HIT' | 'MISS'
  tiebreak: boolean
  t: number | null // hit parameter: |dir| units (mode 0) or [0,1] fraction (mode 1); null on miss / no scalar
  hitPoint: Vec3 | null // o + t·dir (mode 0) | lerp(o, endpoint, t) (mode 1); null on miss
  metricDist: number | null // metric distance origin→hit (t·|dir| | t·|endpoint−o|); null on miss
}

export interface SightlineDraw {
  kind: 4
  seq: number
  o: Vec3
  g: Vec3
  verdict: 'BLOCKED' | 'LOS_CLEAR'
  tiebreak: boolean // composite tiebreak = OR of the 3 component flags (excerpt §1)
  components: [number, number, number] // the 3 preceding component seqs [seq-3, seq-2, seq-1]
}

export type QueryDraw = PointDraw | RangeBearingDraw | RayDraw | SightlineDraw

// HAS-QUERY-CONTENT — does this run have any drawable kind-23 probe? buildQueryDraws returns a seq-indexed
// array that is all-null for a run with no geometry queries (it NEVER returns null), so `positionless` alone
// cannot tell e0 (75 kind-23 draws) apart from a positionless run whose event kinds have no stage lens
// (f2a/f3a/f4 — kind-23 count 0). This is the CONTENT half of the stage's applicability gate; queryStageApplies
// (below) pairs it with the positionless conjunct into the ONE complete predicate the stage MOUNT, its origin
// anchor (which lives inside the mount), the honesty chip and the Inspector rail all route through — so no site
// under-describes the gate or drifts. It is ALSO queryBounds' own d3 seed-guard (below): one definition
// of "the stage has something to draw". Pure; O(draws) with an early exit.
export const hasQueryDraws = (draws: readonly (QueryDraw | null)[]): boolean => draws.some(d => d !== null)

// Signed-zero normaliser: computed points can produce -0 (e.g. 0 + t·0), harmless in math but a footgun for
// equality-based consumers and odd to read. Collapse to +0 (the same choice camera.trajectoryBounds makes).
const n0 = (v: number): number => (v === 0 ? 0 : v)
// ── Fail-loud validation ───────────────────────────────────────────────────────────────────────────────
// This layer's job is to refuse false evidence. The excerpt §1 pins every per-kind layout (argv length,
// scalar shape, the mode domain, the composite triplet), so a payload that drifts from the pinned layout
// is not "best-effort drawable" — it is evidence this layer cannot vouch for. Refuse loud (throw), never
// coerce into plausible geometry. Every check runs in the one load-path pass (the load budget: zero frame-path cost).
function fail(msg: string): never { throw new Error(`queryStage: ${msg}`) }

const finite = (v: number | undefined, what: string, seq: number): number => {
  if (v === undefined || !Number.isFinite(v)) fail(`${what} is ${String(v)} at seq ${seq} — coordinates and scalars are finite F64s by contract; refusing to draw a malformed field`)
  return v
}
const expectArgv = (a: number[], want: number, kindName: string, seq: number): void => {
  if (a.length !== want) fail(`${kindName} argv carries ${a.length} elements at seq ${seq} — the contract pins exactly ${want}; refusing to guess a layout`)
}
const expectScalars = (s: number[], want: number, what: string, seq: number): void => {
  if (s.length !== want) fail(`${what} carries ${s.length} result_scalars at seq ${seq} — the contract pins exactly ${want}; refusing a drifted payload`)
}
const v3 = (a: number[], i: number, what: string, seq: number): Vec3 =>
  [finite(a[i], `${what}.n`, seq), finite(a[i + 1], `${what}.e`, seq), finite(a[i + 2], `${what}.d`, seq)]

// Parse one decoded kind-23 payload into its drawable primitive. Pure; depends only on the payload + seq.
// VALIDATES the pinned layout before constructing anything (excerpt §1/§2): argv length per kind, scalar
// shape per kind/verdict ("[t] on hit, else []" — both directions), mode EXACTLY 0 or 1, object domains
// (regions are ONLY ball/box; occluders ONLY S/B/T — the pinned scene has no others), finite consumed
// fields. Any drift throws — a contract violation must fail loud, not draw a lie. Two deliberate
// non-checks: RANGE_BEARING's result_flag is pinned constant `true` but the excerpt says to carry NO
// meaning from it (so validating it would carry meaning); t's numeric DOMAIN (ray t≥0, segment t∈[0,1])
// is the producer's pinned clamping semantics, not re-validated here (shape + finiteness are).
export function queryDraw(q: GeometryQuery, seq: number): QueryDraw {
  // subject is pinned `= 0` at E0 (excerpt §1: "subject = 0 at E0 (opaque sentinel)") — the pin is the
  // VALUE; "opaque" means it names no agent, not that drift is tolerable. A nonzero subject is a drifted
  // payload, not a different subject to render. (Contrast kind-2 result_flag, where the excerpt itself
  // says to carry no meaning — subject carries the opposite instruction: a pinned constant.)
  if (q.subject !== 0n) fail(`kind-23 subject is ${q.subject} at seq ${seq} — the contract pins subject = 0 at E0 (opaque sentinel); refusing a drifted payload`)
  const a = q.argv
  const object = Number(q.object)
  const tiebreak = q.tiebreakApplied
  switch (q.queryKind) {
    case QUERY_KIND.POINT_IN_REGION: {
      expectArgv(a, 3, 'POINT_IN_REGION', seq)
      if (object !== 1 && object !== 2) fail(`POINT_IN_REGION names object ${object} at seq ${seq} — the pinned regions are ONLY the closed ball S(1) and closed box B(2); the triangle is an occluder facet, never a region`)
      expectScalars(q.resultScalars, object === 1 ? 1 : 0, `POINT_IN_REGION(${SCENARIO_OBJECT[object]})`, seq) // ball [d2] · box [] — pinned
      const d2 = object === 1 ? finite(q.resultScalars[0], 'd2', seq) : null
      const dist = d2 === null ? null : Math.sqrt(d2)
      if (dist !== null && !Number.isFinite(dist)) fail(`d2 ${d2} at seq ${seq} has no real distance — refusing to fabricate one`)
      return {
        kind: 1, seq, object, point: v3(a, 0, 'point', seq),
        verdict: q.resultFlag ? 'INSIDE' : 'OUTSIDE', tiebreak,
        d2, dist,
      }
    }
    case QUERY_KIND.RANGE_BEARING: {
      expectArgv(a, 6, 'RANGE_BEARING', seq)
      expectScalars(q.resultScalars, 2, 'RANGE_BEARING', seq) // [range_m, bearing_rad] — pinned
      const rangeM = finite(q.resultScalars[0], 'range_m', seq)
      const bearingRad = finite(q.resultScalars[1], 'bearing_rad', seq) // the STORED bits — surfaced, never recomputed via atan2
      return {
        kind: 2, seq, o: v3(a, 0, 'o', seq), g: v3(a, 3, 'g', seq),
        rangeM, bearingRad, bearingDeg: (bearingRad * 180) / Math.PI, tiebreak,
      }
    }
    case QUERY_KIND.RAY_OCCLUDER: {
      expectArgv(a, 7, 'RAY_OCCLUDER', seq)
      if (a[0] !== 0 && a[0] !== 1) fail(`RAY_OCCLUDER mode ${String(a[0])} at seq ${seq} — the contract pins mode 0.0 = ray (w = direction) | 1.0 = segment (w = endpoint), nothing else; refusing to coerce`)
      const mode = a[0] as 0 | 1
      if (object !== 1 && object !== 2 && object !== 3) fail(`RAY_OCCLUDER names object ${object} at seq ${seq} — the pinned occluder set is exactly S(1), B(2), T(3); refusing an unpinned occluder`)
      const hit = q.resultFlag
      expectScalars(q.resultScalars, hit ? 1 : 0, `RAY_OCCLUDER ${hit ? 'HIT' : 'MISS'}`, seq) // "[t] on hit, else []" — pinned both directions
      const o = v3(a, 1, 'o', seq), target = v3(a, 4, mode === 0 ? 'dir' : 'endpoint', seq)
      const t = hit ? finite(q.resultScalars[0], 't', seq) : null
      let hitPoint: Vec3 | null = null
      let metricDist: number | null = null
      if (t !== null) {
        if (mode === 0) {
          // infinite ray: hit = o + t·dir; metric distance = t·|dir| (t is in |dir| units)
          hitPoint = [n0(o[0] + t * target[0]), n0(o[1] + t * target[1]), n0(o[2] + t * target[2])]
          metricDist = t * Math.hypot(target[0], target[1], target[2])
        } else {
          // segment: hit = lerp(o, endpoint, t); t is the [0,1] fraction; metric distance = t·|endpoint−o|
          const dx = target[0] - o[0], dy = target[1] - o[1], dz = target[2] - o[2]
          hitPoint = [n0(o[0] + t * dx), n0(o[1] + t * dy), n0(o[2] + t * dz)]
          metricDist = t * Math.hypot(dx, dy, dz)
        }
      }
      return { kind: 3, seq, object, mode, o, target, verdict: hit ? 'HIT' : 'MISS', tiebreak, t, hitPoint, metricDist }
    }
    case QUERY_KIND.LOS: {
      // Composition (excerpt §1): los_clear = !(any occluder segment-hits (o,g)); the 3 component
      // RAY_OCCLUDER rows are the preceding seq-3..seq-1. Composite rows carry object = 0 — pinned.
      expectArgv(a, 6, 'LOS', seq)
      expectScalars(q.resultScalars, 0, 'LOS', seq) // scalars pinned empty on the composite
      if (object !== 0) fail(`LOS composite carries object ${object} at seq ${seq} — the contract pins object = 0 on composite rows; refusing`)
      return {
        kind: 4, seq, o: v3(a, 0, 'o', seq), g: v3(a, 3, 'g', seq),
        verdict: q.resultFlag ? 'LOS_CLEAR' : 'BLOCKED', tiebreak,
        components: [seq - 3, seq - 2, seq - 1],
      }
    }
    default:
      fail(`unrecognised query_kind ${q.queryKind} at seq ${seq} — the contract pins kinds 1..4; refusing to draw a lie`)
  }
}

// The minimal shape queryDraw's producers need — RunModel satisfies it structurally (no import cycle).
export interface QuerySource {
  readonly eventCount: number
  geometryQueryAt(seq: number): GeometryQuery | null
}

// Everything the stage consumes, built and VALIDATED in one publish-time pass: the per-seq draws plus
// every LOS composite already composition-checked. Consumers never validate and never see a throw after
// publish — a malformed bundle fails at load, not at interaction time.
export interface QueryStageData {
  draws: (QueryDraw | null)[] // indexed by seq (seq==tick for e0); null = not a geometry query
  losComposites: ReadonlyMap<number, LosComposite> // seq → its validated composite (every kind-4 row)
}

// One-pass build of a whole model, indexed by seq (the reveal clock is seq==tick for e0). A non-kind-23
// event decodes to null → the stage draws nothing there (honest empty state). Load-path only: the sibling
// of buildTrail, run ONCE at model publish, never per frame.
//
// ALL validation lives HERE, in the publish pass — per-row layout checks inside queryDraw, and the LOS
// triplet contract for EVERY composite row immediately after. A malformed triplet therefore fails the
// publish loud; it can never lie in wait for the first losComponents call at interaction time (which
// would move throw-risk toward the frame path — the opposite of the load budget's shape).
export function buildQueryDraws(source: QuerySource): QueryStageData {
  const draws: (QueryDraw | null)[] = new Array(source.eventCount).fill(null)
  for (let seq = 0; seq < source.eventCount; seq++) {
    const q = source.geometryQueryAt(seq)
    if (q !== null) draws[seq] = queryDraw(q, seq)
  }
  const losComposites = new Map<number, LosComposite>()
  for (let seq = 0; seq < draws.length; seq++) {
    const d = draws[seq]
    if (d && d.kind === 4) losComposites.set(seq, validateLosComposite(d, draws))
  }
  return { draws, losComposites }
}

// ── THE COMPLETE APPLICABILITY PREDICATE (the mount gate made whole) ────────────────────────────────
// The query stage applies to a run iff it is POSITIONLESS (no entity flight to overlay — e0's shape) AND it
// actually has kind-23 draws. The registration named `hasQueryDraws` alone as its mountGate, but that is only
// HALF the real gate: a positioned run is never even offered the stage, and hasQueryDraws is the SECOND
// conjunct. The registration's identity pin caught a RENAME of that half, but not this MISSING conjunct — so
// the declared gate under-described the real one. This is the ONE predicate the stage MOUNT
// (Scene), the honesty chip (App) and the Inspector's empty-stage rail all route through, so the three sites can
// never drift on "does the query stage apply here"; its NAME is what the registration now registers as
// mountGate, and the identity is pinned. The `&&` short-circuit preserves the existing discipline: buildQueryDraws
// runs ONLY for a positionless run, never on a positioned run's load path.
export interface StageSource extends QuerySource {
  entityKeys(): readonly string[]
}
export function queryStageApplies(model: StageSource): boolean {
  return model.entityKeys().length === 0 && hasQueryDraws(buildQueryDraws(model).draws)
}

// ── LOS composition — recover per-occluder contacts from the 3 preceding rows (excerpt §1) ─────────────

export interface LosComposite {
  seq: number
  los: SightlineDraw
  components: RayDraw[] // the 3 component rays, ordered by occluder S,B,T (object 1,2,3) — NOT by position
  firstBlocker: RayDraw | null // the first occluder that HITs, in S,B,T order (no short-circuit); null if clear
  blockerObject: number | null // 1 | 2 | 3, or null when clear
}

const sameV3 = (x: Vec3, y: Vec3): boolean => x[0] === y[0] && x[1] === y[1] && x[2] === y[2]

// THE TRIPLET CONTRACT IS VALIDATED AT PUBLISH, NOT ASSUMED (excerpt §1 LOS composition + §5). The
// contract pins: the 3 PRECEDING rows are the composite's components (so seq ≥ 3 is entailed); each is
// a RAY_OCCLUDER SEGMENT query (argv [1.0, o…, g…]) with (o,g) IDENTICAL to the composite's argv;
// objects are 1,2,3 (exactly once each); los_clear = !(any component segment hit); composite
// tiebreak_applied = OR of the three component flags. A partial or drifted triplet is not a degraded
// answer to render best-effort — it is false evidence, so every violated clause throws. Components come
// back sorted by occluder S,B,T (not schedule position); the first blocker is resolved in that order
// (the excerpt's occluder order, no short-circuit). Called ONLY from buildQueryDraws' publish pass —
// it reads the already-parsed draws, so nothing is decoded twice and nothing throws after publish.
function validateLosComposite(los: SightlineDraw, draws: readonly (QueryDraw | null)[]): LosComposite {
  const seq = los.seq
  if (seq < 3) fail(`LOS composite at seq ${seq} has no room for its 3 preceding component rows — the contract pins the triplet at seq-3..seq-1; refusing partial evidence`)
  const components: RayDraw[] = []
  for (const cs of los.components) {
    const c = draws[cs]
    if (!c) fail(`LOS composite ${seq}: component row ${cs} is missing / not a geometry query — the contract pins the 3 preceding rows as its RAY_OCCLUDER components`)
    if (c.kind !== 3) fail(`LOS composite ${seq}: component row ${cs} is query_kind ${c.kind} — the contract pins RAY_OCCLUDER components`)
    if (c.mode !== 1) fail(`LOS composite ${seq}: component ${cs} is an infinite ray (mode 0) — the contract pins SEGMENT components (argv [1.0, o…, g…])`)
    if (!sameV3(c.o, los.o) || !sameV3(c.target, los.g)) fail(`LOS composite ${seq}: component ${cs} probes a different segment — the contract pins components with (o,g) identical to the composite argv`)
    components.push(c)
  }
  components.sort((x, y) => x.object - y.object) // occluder order S(1), B(2), T(3)
  if (components[0]!.object !== 1 || components[1]!.object !== 2 || components[2]!.object !== 3)
    fail(`LOS composite ${seq}: component objects [${components.map(c => c.object).join(',')}] — the contract pins objects 1,2,3 exactly once (S,B,T)`)
  const firstBlocker = components.find(c => c.verdict === 'HIT') ?? null
  if ((los.verdict === 'LOS_CLEAR') === (firstBlocker !== null))
    fail(`LOS composite ${seq}: verdict ${los.verdict} disagrees with its components — the contract pins los_clear = !(any occluder segment hit); refusing inconsistent evidence`)
  const tbOr = components.some(c => c.tiebreak)
  if (los.tiebreak !== tbOr)
    fail(`LOS composite ${seq}: composite tiebreak ${los.tiebreak} vs component OR ${tbOr} — the contract pins composite tiebreak_applied = OR of the three component flags`)
  return { seq, los, components, firstBlocker, blockerObject: firstBlocker ? firstBlocker.object : null }
}

// Interaction-time lookup into the publish-time-validated composite store: zero validation, zero throw,
// zero allocation after publish (the load budget — throw-risk lives at load, never near the frame path). Returns null
// for a non-LOS seq — the honest answer for a row that has no composite, not a malformation.
export function losComponents(seq: number, stage: QueryStageData): LosComposite | null {
  return stage.losComposites.get(seq) ?? null
}

// ── Framing presets (§2.2) — three nested bounding spheres for frameFor ────────────────────────────────

export interface QueryBoundsPresets {
  full: Bounds | null // the whole record incl. the 3 runaway miss-sightlines (a DECOY: mostly empty space)
  core: Bounds | null // the interrogated theatre: sources + solids + contacts, minus runaway far ends (DEFAULT)
  solidsContacts: Bounds | null // just the solids + the 21 hit points — a "zoom to the evidence" shot
}

const pushPt = (arr: number[], p: Vec3): void => { arr.push(p[0], p[1], p[2]) }
// Seed an accumulator with the scenario solids' extent (sphere AABB corners + box + triangle verts), the
// same seed the design draw-table probe uses so the framing radii match the draw table byte-for-byte (mod Float32).
const seedSolids = (arr: number[]): void => {
  const { center: c, radius: r } = SPHERE
  arr.push(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r)
  pushPt(arr, BOX.min); pushPt(arr, BOX.max)
  pushPt(arr, TRIANGLE.a); pushPt(arr, TRIANGLE.b); pushPt(arr, TRIANGLE.c)
}
const finish = (pts: number[]): Bounds | null => boundsFromPositions(Float32Array.from(pts), pts.length / 3)

// Compute the three presets from precomputed draws (pure; reuses the camera fit's 0.5·hypot(spans) radius
// via boundsFromPositions so a query framing and a trajectory framing are the same kind of sphere). With no
// query geometry every preset is null — the honest empty state (caller keeps the composed default). The
// point-set rules mirror the design probe exactly: origins/points/measured endpoints + hits + solids feed
// FULL and CORE; runaway far ends (mode-1 segment endpoints, sightline targets) feed FULL only; the solids
// and the 21 hit points feed SOLIDS+CONTACTS.
export function queryBounds(draws: readonly (QueryDraw | null)[]): QueryBoundsPresets {
  if (!hasQueryDraws(draws)) return { full: null, core: null, solidsContacts: null }
  const full: number[] = [], core: number[] = [], contacts: number[] = []
  seedSolids(full); seedSolids(core); seedSolids(contacts)
  for (const d of draws) {
    if (d === null) continue
    switch (d.kind) {
      case 1:
        pushPt(full, d.point); pushPt(core, d.point)
        break
      case 2:
        pushPt(full, d.o); pushPt(core, d.o); pushPt(full, d.g); pushPt(core, d.g)
        break
      case 3:
        pushPt(full, d.o); pushPt(core, d.o)
        if (d.hitPoint) { pushPt(full, d.hitPoint); pushPt(core, d.hitPoint); pushPt(contacts, d.hitPoint) }
        // a mode-1 segment's far endpoint is drawn but runs to the frame edge — FULL only, never core.
        // a mode-0 ray's `target` is a direction, not a point — it is never a bound.
        if (d.mode === 1) pushPt(full, d.target)
        break
      case 4:
        pushPt(full, d.o); pushPt(core, d.o); pushPt(full, d.g) // the sightline far end is a runaway → FULL only
        break
    }
  }
  return { full: finish(full), core: finish(core), solidsContacts: finish(contacts) }
}

// ── THE LAW-4 DECLARATION, AS DATA — e0 is lifted from prose to a typed citizen ────────────
// The query stage filed its LAW-4 declaration as the PROSE block at the top of this module (v0.6, the
// constitution's first citizen — but predating lensContract, it was never queryable). This graduates that
// same declaration to a typed const (lensContract.LensRegistration), closing the asymmetry with f2a: the
// question / surface split / borrowed hues (LAW 2) / what it dims / honest empty state / the honesty chip /
// the tour / the ONE mount gate / and the six-tier provenance ledger classifying every pixel-class the stage
// paints by HOW IT KNOWS. The ledger derives from the prose above + the honesty chip's own claim + the
// recompute surface (showMath.ts: which classes are live-checked vs decoded vs pinned-bits). No wording moves
// — QUERY_STAGE_HONESTY stays the rendered chip and is passed straight in as the registration's projection.
// The lensRegistry aggregates this beside F2A_REGISTRATION and validates both at load (fail-loud).
const GEO = 'contract/EXP-E0-kind23-geometry-excerpt.md'
const FORMS = 'contract/EXP-E0-decision-forms-excerpt.md'
// The causal edges the selection re-lensing derives its hop distance from: each event carries a
// causation_id in the Spec 3a §3.6 envelope; §11.1 pins that envelope for the E0-baseline adoption.
const CAUSATION = 'contract/spec-3b-evidence-layer.md §11.1 (event envelope causation_id — Spec 3a §3.6)'

const E0_LEDGER: readonly PixelClass[] = [
  { id: 'probe-geometry', tier: 'decoded', source: `${GEO} §1 (per-kind argv layouts — points, ray/segment origins & endpoints, sightline endpoints)`,
    answer: 'every ray, segment, sightline and probe point the stage draws is decoded-real — the kind-23 argv geometry in NED meters' },
  // ── THE STAGE's OWN VERDICT PAINT (decoded, not recomputed) ─────────────────────────────────────────
  // The 3D STAGE colours its CONTACT verdict from the DECODED result_flag bit (it inherits the run's session
  // seal); it does NOT run the in-browser recompute — that lives in the Inspector (the recomputed classes
  // below). f2a made exactly this split (its decoded eligible-tint beside the Inspector's recomputed legs).
  { id: 'contact-verdict', tier: 'decoded', source: `${GEO} §1 (result_flag per kind — INSIDE/OUTSIDE · HIT/MISS · BLOCKED/CLEAR)`,
    answer: 'on the stage, a probe\'s contact hue is its DECODED verdict bit surfaced verbatim — a point\'s INSIDE/OUTSIDE, a ray or segment\'s HIT vs MISS, a sightline\'s BLOCKED vs CLEAR — the engine\'s own result_flag, not the Inspector\'s live recompute' },
  // ── WHAT THE STAGE DERIVES vs. WHAT IT MERELY DRAWS (tiered by HOW IT KNOWS, not lumped as "decoded") ──
  // A HIT endpoint is o + t·dir: arithmetic over the DECODED hit parameter + §1 layout → derived-display (sourced
  // to decoded inputs, no decoded coordinate on record). A MISS shaft carries no hit point, so its far end is a
  // fixed renderer-authored extension → presentational (encodes no datum). Blocker attribution SELECTS the first
  // HIT in the fixed S,B,T order over the decoded component verdicts → derived-display (a derivation, not a
  // decoded field). Only contact-verdict above is genuinely decoded; these three are honestly re-tiered.
  { id: 'hit-termination', tier: 'derived-display', source: `${GEO} §1 (hit parameter t · §1 ray/segment layout)`,
    answer: 'where a ray or segment terminates on the stage is the point o + t·dir DERIVED from the decoded hit parameter t and the §1 probe geometry — a derivation over decoded inputs, not a coordinate on record' },
  { id: 'miss-extension', tier: 'presentational', source: null,
    answer: 'a MISS ray carries no hit point, so its shaft is drawn running past the scene to the frame edge — a fixed renderer-authored extension that encodes no datum, only "no contact here"' },
  { id: 'blocker-attribution', tier: 'derived-display', source: `${GEO} §1 (LOS composition — the 3 component RAY_OCCLUDER rows, S/B/T)`,
    answer: 'which occluder a BLOCKED sightline attributes its block to is DERIVED by selecting the first HIT among its three decoded component-ray verdicts in the fixed S,B,T order — a derivation over decoded verdicts, not a decoded field of its own' },
  // ── THE INSPECTOR's INDEPENDENT RECOMPUTE (recomputed — the ShowMath surface) ────────────────────────────
  // The recompute lives in the INSTRUMENT (Inspector/ShowMath): each verdict is re-derived in-browser by a pinned
  // form and matched ✓/✗ against the engine bit. The STAGE paints the decoded verdict (above); THIS is the
  // instrument's independent recheck of it. Scoped to the Inspector so ask-any-pixel returns the surface's true
  // authority — a live check where the recompute actually runs, a decoded bit where the stage actually paints.
  { id: 'region-verdict', tier: 'recomputed', source: `${FORMS} (point-in-ball d² ≤ r² · point-in-box min ≤ p ≤ max)`,
    answer: 'in the Inspector, a region point\'s INSIDE/OUTSIDE is re-derived in-browser (point-in-ball d² ≤ r², or the box slab test) and matched live against the engine bit',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('query:probe-point'), form: 'form:point-in-region' } },
  { id: 'occluder-verdict', tier: 'recomputed', source: `${FORMS} (ray/segment ∩ sphere · AABB slab · triangle Möller–Trumbore)`,
    answer: 'in the Inspector, a ray or segment HIT/MISS is re-derived in-browser against the named occluder and matched live against the engine bit',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('query:ray-geometry'), form: 'form:ray-occluder' } },
  { id: 'los-verdict', tier: 'recomputed', source: `${GEO} §1 (LOS composition — the 3 component segments) · ${FORMS} (los_clear = ¬any component segment-hit)`,
    answer: 'in the Inspector, a sightline\'s CLEAR/BLOCKED is re-derived as ¬(any of its three component segments hits) from the components\' own geometry, and matched live against the engine bit',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('query:component-segments'), form: 'form:los-composition' } },
  { id: 'range-scalar', tier: 'recomputed', source: `${FORMS} (range_m = √(dot(g−o, g−o)), pinned left-to-right f64 dot)`,
    answer: 'in the Inspector, the range readout is re-derived in-browser as √(dot(g−o, g−o)) and matched bit-exact against the stored range_m',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('query:range-endpoints'), form: 'form:range-scalar' } },
  { id: 'bearing-claim', tier: 'pinned-bits', source: `${FORMS} (bearing = atan2 via the vendored pure-Rust libm, pinned KAT bits)`,
    answer: 'the bearing is shown in the claim voice — an atan2 value from the vendored libm with pinned KAT bits, surfaced verbatim and never recomputed here' },
  { id: 'tiebreak-badge', tier: 'decoded', source: `${GEO} §4 (tiebreak_applied — the one registry semantic pair on kind 23; D-017 closed boundaries)`,
    answer: 'a tiebreak ring marks a beat the engine flagged as decided exactly at a boundary (the decoded tiebreak_applied bit)' },
  { id: 'recompute-tally', tier: 'derived-display', source: `${FORMS} (the pinned decision forms the tally counts)`,
    answer: 'the all-events agreement footer is a display-tier count of the per-event recompute matches — a derivation over the live checks, itself no decoded datum' },
  // the selection re-lensing is NOT presentational: the hop registers encode causation AND distance (data).
  // It is a derivation over the decoded causation edges, so it is sourced derived-display, not "encodes no data".
  { id: 'selection-relensing', tier: 'derived-display', source: `${CAUSATION} (the causal edges the hop distance derives from)`,
    answer: 'the selection re-lensing colours each probe by its causal HOP distance from the selected event — the ≤3-hop neighbourhood lit, everything beyond the horizon dimmed — a derivation over the decoded causation edges (it encodes causation and distance), never a presentational treatment' },
  { id: 'scenario-solid', tier: 'scenario-constant', source: `${GEO} §2 (pinned scene — sphere S, box B, triangle T)`,
    answer: 'the sphere, box and triangle bodies are scenario constants — declared, not decoded (no payload carries them)' },
  { id: 'source-anchor', tier: 'scenario-constant', source: `${GEO} §3 (default observer (0,0,0))`,
    answer: 'the acts I/II origin-fan eye marks the pinned default observer at the coordinate origin — a declared scenario constant' },
  { id: 'drawn-observer', tier: 'decoded', source: `${GEO} §3 (per-seed drawn observer, read from each event's argv — never assumed constant)`,
    answer: 'the act-III observer marker stands at the per-seed drawn observer read from the event argv — decoded-real, never a scenario constant' },
  { id: 'not-yet-ghost', tier: 'decoded', source: `${GEO} §1 (the recorded argv geometry the ghost previews)`,
    answer: 'a probe beyond the playhead is the real recorded geometry rendered in the NOT-YET voice (hollow, never blooming), filling in when the playhead writes it (constitution §4)' },
  { id: 'presentational', tier: 'presentational', source: null,
    answer: 'camera moves, spent-ray fades, act-tint grading, the grid and the fog encode no data' },
]

export const E0_REGISTRATION: LensRegistration = validateRegistration({
  id: 'e0-query',
  question: {
    primary: 'Where/when is it? (Q1 — every probe placed in real NED space: points, rays, segments, sightlines, contacts)',
    adjacent: ['Q2 why did it happen (the tiebreak beats + which occluder blocked)', 'Q5 can I trust this pixel (the two-voice recompute + the ledger)'],
  },
  surfaces: { stage: 'QueryStage', instrument: 'Inspector' },
  // LAW 2 — borrowed token NAMES only (compile-time membership via BorrowedHue): the verdict contacts reuse
  // the verdict pair; the Inspector's recompute marks reuse the integrity ✓/✗ pair; selection is accent;
  // the causal-horizon neighbourhood wears the spine violet; ambient probe geometry wears the query category
  // steel; tiebreak rings wear textDim; the source-anchor / observer markers wear textPrimary.
  borrowedHues: ['verdictAffirm', 'verdictNegate', 'verified', 'mismatch', 'accent', 'spine', 'textDim', 'textPrimary', 'category:query'],
  dims: 'one probe at full voice — the live tick\'s ray; spent rays decay behind the head while contacts and solids persist; on selection the causal chain re-lenses (the ≤3-hop neighbourhood lights, everything beyond the horizon dims) — the lens reallocates the existing budget, never adds a glow',
  emptyState: 'a run with no kind-23 events decodes to all-null draws → the stage draws nothing and wears no chip; a positionless run whose kinds carry no query draws (f4) mounts no stage either (the shared queryStageApplies gate: positionless AND kind-23 draws), never phantom furniture or a false constants claim',
  honestyChip: QUERY_STAGE_HONESTY,
  tourId: 'e0-hero',
  mountGate: queryStageApplies.name,
  provenance: E0_LEDGER,
})
