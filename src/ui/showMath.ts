// VALUE imports come ONLY from queryScenario (a zero-import module) — that keeps this module's runtime
// closure exactly {showMath.ts, queryScenario.ts}, the set the no-transcendental scan covers (the
// SCAN-COVERAGE pin in the test file checks both halves). queryStage is a TYPE-ONLY edge, erased at
// runtime (verbatimModuleSyntax): its runtime closure includes ./camera's sanctioned framing trig, which
// must never ride into the verification surface.
import { SPHERE, BOX, TRIANGLE, QUERY_KIND, type Vec3 } from './queryScenario'
import type { QueryDraw, LosComposite } from './queryStage'
// TYPE-ONLY (erased under verbatimModuleSyntax — the runtime closure stays {showMath, queryScenario}, the
// no-transcendental scan unaffected). Only the AgreeSource witness types + the branded outcome ride in.
import type { AgreementResult, AgreeCapability } from './agreeSource'

// ── SHOW THE MATH — the verdict-recompute layer (v0.6) ─────────────────────────────────────────────
// A PURE, three-free module that re-derives each kind-23 verdict IN THE BROWSER from the decoded numbers,
// using the PINNED decision forms (contract/EXP-E0-decision-forms-excerpt.md — operand order is normative,
// doctrine §1.6). It then hands the Inspector a card: the pinned form with the decoded numbers substituted,
// and the engine-verdict-vs-ours agreement. The app already re-derives the HASHES on load; this re-derives
// the DECISIONS. Display-tier only (spec §11): a disagreement is surfaced in the mismatch voice, never hidden.
//
// ⚠ CONSTITUTION-LEVEL BINDING (decision-forms excerpt, lines 11–12 + 22–28): a bearing is an `atan2` value
// from the vendored pure-Rust libm with pinned KAT vectors. This module NEVER recomputes a bearing — no
// Math.atan2, no sin/cos/tan, ANYWHERE (a source-scan test pins that). A bearing is surfaced as the STORED
// bits (RangeBearingDraw.bearingRad/bearingDeg, themselves the verbatim result_scalars[1] and a linear
// rad→deg scale of it) in the CLAIM voice with its note — never the recomputed-and-matched ✓. Pure arithmetic
// on decoded data is fine: sub/dot/cross, IEEE-exact `sqrt` and `/` (reported scalars only), boolean logic.
//
// TWO-VOICE PROVENANCE GRAMMAR (a design ruling, extended): the ✓ (verified voice) is EXCLUSIVELY for what is
// genuinely recomputed-and-matched in-browser — the verdict (kinds 1/3/4) or the range scalar (kind 2). A
// disagreement wears the ✗ (mismatch voice). The displayed pinned bits (the bearing) wear the quieter claim
// voice — a value on record, not an independent recomputation — mirroring the provenance panel's `attested`.

// ── pure vector arithmetic (pinned operand order, doctrine §1.6) ────────────────────────────────────────
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
// dot: ((p.n*q.n) + (p.e*q.e)) + (p.d*q.d) — the pinned left-to-right f64 accumulation.
const dot = (p: Vec3, q: Vec3): number => ((p[0] * q[0]) + (p[1] * q[1])) + (p[2] * q[2])
// cross: ((p.e*q.d − p.d*q.e), (p.d*q.n − p.n*q.d), (p.n*q.e − p.e*q.n)).
const cross = (p: Vec3, q: Vec3): Vec3 => [
  (p[1] * q[2]) - (p[2] * q[1]),
  (p[2] * q[0]) - (p[0] * q[2]),
  (p[0] * q[1]) - (p[1] * q[0]),
]

// ── the recomputed decisions (each returns the boolean verdict + the tie-break + the pinned intermediates) ─

export interface BallRecompute { inside: boolean; tiebreak: boolean; d2: number }
// Point-in-ball: dl = p − c; d2 = dot(dl,dl); inside = d2 <= r2; tb = inside && (d2 == r2).
export function recomputeBall(p: Vec3): BallRecompute {
  const dl = sub(p, SPHERE.center)
  const d2 = dot(dl, dl)
  const inside = d2 <= SPHERE.r2
  return { inside, tiebreak: inside && d2 === SPHERE.r2, d2 }
}

export interface BoxRecompute { inside: boolean; tiebreak: boolean }
// Point-in-box: inside = min ≤ p ≤ max on every axis; tb = inside && p on any face.
export function recomputeBox(p: Vec3): BoxRecompute {
  const { min, max } = BOX
  const inside = (min[0] <= p[0]) && (p[0] <= max[0]) && (min[1] <= p[1]) && (p[1] <= max[1]) && (min[2] <= p[2]) && (p[2] <= max[2])
  const onFace = (p[0] === min[0]) || (p[0] === max[0]) || (p[1] === min[1]) || (p[1] === max[1]) || (p[2] === min[2]) || (p[2] === max[2])
  return { inside, tiebreak: inside && onFace }
}

// The ray/segment direction the pinned forms consume: mode 0 (ray) → w is the direction; mode 1 (segment)
// → dir = w − o. (`target` is the decoded w in both cases.)
const rayDir = (o: Vec3, target: Vec3, segment: boolean): Vec3 => (segment ? sub(target, o) : target)

export interface RayHit { hit: boolean; tiebreak: boolean }

// Ray/segment vs sphere (origin o, dir/endpoint w): oc = o − c; a = dot(dir,dir); b = dot(oc,dir);
// c = dot(oc,oc) − r2; disc = b² − a·c; segment-only f1 = (a + 2b) + c. Division/sqrt-free DECISION.
export function recomputeRaySphere(o: Vec3, target: Vec3, segment: boolean): RayHit {
  const dir = rayDir(o, target, segment)
  const oc = sub(o, SPHERE.center)
  const a = dot(dir, dir)
  const b = dot(oc, dir)
  const c = dot(oc, oc) - SPHERE.r2
  const disc = (b * b) - (a * c)
  if (segment) {
    const f1 = (a + (2.0 * b)) + c
    const hit = (c <= 0.0) || (f1 <= 0.0) || ((disc >= 0.0) && (0.0 <= (-b)) && ((-b) <= a))
    return { hit, tiebreak: hit && ((disc === 0.0) || (c === 0.0) || (f1 === 0.0)) }
  }
  const hit = (c <= 0.0) || ((disc >= 0.0) && ((-b) >= 0.0))
  return { hit, tiebreak: hit && ((disc === 0.0) || (c === 0.0)) }
}

// Ray/segment vs AABB (pinned slab form): per axis in order n,e,d — a zero-direction axis MISSES if the
// origin is outside the slab (and grazes a face → tb); else clamp [tmin,tmax] by the axis' pinned IEEE
// divisions. HIT ⇔ tmin ≤ tmax; tb = hit && (a face graze || tmin == tmax); the divisions are EXACT for
// e0's axis-parallel directions (divisor ±1 or a power of two), so this reproduces the engine bit-for-bit.
export function recomputeRayBox(o: Vec3, target: Vec3, segment: boolean): RayHit {
  const dir = rayDir(o, target, segment)
  const { min, max } = BOX
  let tmin = 0.0
  let tmax = segment ? 1.0 : Infinity
  let tbAxis = false
  for (let ax = 0; ax < 3; ax++) {
    const d = dir[ax]!, oa = o[ax]!, mn = min[ax]!, mx = max[ax]!
    if (d === 0.0) {
      if ((oa < mn) || (oa > mx)) return { hit: false, tiebreak: false }
      if ((oa === mn) || (oa === mx)) tbAxis = true
    } else {
      const t1 = (mn - oa) / d
      const t2 = (mx - oa) / d
      const lo = t1 <= t2 ? t1 : t2
      const hi = t1 <= t2 ? t2 : t1
      if (lo > tmin) tmin = lo
      if (hi < tmax) tmax = hi
    }
  }
  const hit = tmin <= tmax
  return { hit, tiebreak: hit && (tbAxis || (tmin === tmax)) }
}

// Ray/segment vs triangle (division-free two-sided Möller–Trumbore): e1 = B−A; e2 = C−A; h = dir×e2;
// det = dot(e1,h); s = o−A. det == 0 ⇒ declared MISS (tb iff the ray lies IN the plane). Else the sided
// barycentric test on EXACT products (division only appears in the reported t, never the decision).
export function recomputeRayTriangle(o: Vec3, target: Vec3, segment: boolean): RayHit {
  const dir = rayDir(o, target, segment)
  const e1 = sub(TRIANGLE.b, TRIANGLE.a)
  const e2 = sub(TRIANGLE.c, TRIANGLE.a)
  const h = cross(dir, e2)
  const det = dot(e1, h)
  const s = sub(o, TRIANGLE.a)
  if (det === 0.0) return { hit: false, tiebreak: dot(s, cross(e1, e2)) === 0.0 }
  const q = cross(s, e1)
  const u = dot(s, h)
  const v = dot(dir, q)
  const t = dot(e2, q)
  let hit: boolean
  if (det > 0.0) {
    hit = (u >= 0.0) && (v >= 0.0) && ((u + v) <= det) && (0.0 <= t) && (segment ? (t <= det) : true)
  } else {
    hit = (u <= 0.0) && (v <= 0.0) && ((u + v) >= det) && (t <= 0.0) && (segment ? (det <= t) : true)
  }
  const tb = hit && ((u === 0.0) || (v === 0.0) || ((u + v) === det) || (t === 0.0) || (segment && t === det))
  return { hit, tiebreak: tb }
}

// Dispatch a RayDraw to its occluder's pinned predicate (object 1 sphere / 2 box / 3 triangle).
export function recomputeRay(d: QueryDraw & { kind: 3 }): RayHit {
  const segment = d.mode === 1
  if (d.object === 1) return recomputeRaySphere(d.o, d.target, segment)
  if (d.object === 2) return recomputeRayBox(d.o, d.target, segment)
  return recomputeRayTriangle(d.o, d.target, segment)
}

// The ray's contact point + metric reach, RECOMPUTED here from the raw (o, target) + the stored hit
// parameter t — the honest recompute the card SHOWS, NOT an echo of the model layer's derived d.hitPoint /
// d.metricDist. hit = o + t·dir; reach = t·|dir| (dir = target on a ray, w−o on a segment — rayDir). Pure
// arithmetic on decoded numbers (t is the engine's reported reach parameter); the model derives the SAME
// from the SAME inputs, so this agrees with it silently while owning its own provenance. null when t is
// absent (an engine MISS carries no t — so a disagreement where OURS hits shows the verdict, not a reach).
export function rayContact(d: QueryDraw & { kind: 3 }): { hitPoint: Vec3; reach: number } | null {
  if (d.t === null) return null
  const dir = rayDir(d.o, d.target, d.mode === 1)
  const hitPoint: Vec3 = [d.o[0] + d.t * dir[0], d.o[1] + d.t * dir[1], d.o[2] + d.t * dir[2]]
  const reach = d.t * Math.hypot(dir[0], dir[1], dir[2])
  return { hitPoint, reach }
}

// LOS composition (the GENERAL rule): los_clear = !(any occluder segment-HITs the corridor). Recomputed
// from the THREE component rays' OWN geometry (not their stored verdicts) — the honest composition check.
export function recomputeLos(composite: LosComposite): boolean {
  return !composite.components.some(c => recomputeRay(c).hit)
}

// Range (kind 2): range_m = sqrt(dot(g−o, g−o)) — the pinned reported scalar, purely recomputable (no
// transcendental). The BEARING is NOT here: it is an atan2 value, surfaced as pinned bits, never recomputed.
export function recomputeRange(o: Vec3, g: Vec3): number {
  const dl = sub(g, o)
  return Math.sqrt(dot(dl, dl))
}

// ── The AgreeSource capability THIS executor's recomputes actually back (PER-FORM) ──────────────────────
// Tokens are DATA naming existing legs of this module — a LOOKUP TABLE the boot guard resolves against, never
// an evaluator. Each FORM maps to the EXACT input tuple its leg consumes (one truth per form, not two
// flat sets): point-in-region re-derives from `query:probe-point`; ray-occluder from `query:ray-geometry`;
// los-composition from the `query:component-segments`; range-scalar from `query:range-endpoints`. Each
// comparand (the engine's own verdict / stored range_m) is a ComparandToken — un-nameable as an input, so no
// e0 recompute can echo the engine's bit against itself. No decoded-consistency check lives here, so `decoded`
// is empty. The boot guard set-compares a declared arm's inputs against ITS form's tuple: a mismatched pairing
// (the Cartesian counterexample) fails loud, where the old independent-membership check waved it through.
export const SHOWMATH_AGREE_CAPABILITY: AgreeCapability = {
  forms: {
    'form:point-in-region': ['query:probe-point'],
    'form:ray-occluder': ['query:ray-geometry'],
    'form:los-composition': ['query:component-segments'],
    'form:range-scalar': ['query:range-endpoints'],
  },
  decoded: [],
}

// ── aggregate: recompute EVERY event's checkable quantity and count the agreements (the "all 75" payoff) ─
// Kinds 1/3/4 recompute the boolean VERDICT vs the engine's; kind 2 has no verdict (result_flag is constant
// true — carries no meaning), so its checkable recomputation is the RANGE scalar (matched to the stored
// range_m). Every event therefore contributes ONE genuinely-recomputed-and-matched check → an honest N/75.
export interface RecomputeSummary { total: number; agreed: number; disagreements: number[] }
export function recomputeAll(
  draws: readonly (QueryDraw | null)[],
  composites: ReadonlyMap<number, LosComposite>,
): AgreementResult<RecomputeSummary> {
  let total = 0, agreed = 0
  const disagreements: number[] = []
  for (const d of draws) {
    if (d === null) continue
    total++
    let ok: boolean
    switch (d.kind) {
      case QUERY_KIND.POINT_IN_REGION: {
        const ours = d.object === 1 ? recomputeBall(d.point).inside : recomputeBox(d.point).inside
        ok = ours === (d.verdict === 'INSIDE')
        break
      }
      case QUERY_KIND.RANGE_BEARING:
        ok = rangeMatches(recomputeRange(d.o, d.g), d.rangeM)
        break
      case QUERY_KIND.RAY_OCCLUDER:
        ok = recomputeRay(d).hit === (d.verdict === 'HIT')
        break
      case QUERY_KIND.LOS: {
        const comp = composites.get(d.seq)
        ok = comp !== undefined && recomputeLos(comp) === (d.verdict === 'LOS_CLEAR')
        break
      }
    }
    if (ok) agreed++
    else disagreements.push(d.seq)
  }
  // THE MINT — this executor actually RAN the live comparison, so it (and only it) brands the outcome an
  // AgreementResult. A lens cannot fabricate this: the brand carries lib/brand's private symbol, so the
  // summary cannot be written as static registration data (an object literal is a type error). Phantom brand,
  // zero runtime cost — the same recompute, re-declared.
  const summary: RecomputeSummary = { total, agreed, disagreements }
  return summary as AgreementResult<RecomputeSummary>
}

// THE PER-ROW MINT — this executor RAN the comparison, so it (and only it) brands each row's agreement,
// not just the aggregate above. `agrees` is the sanctioned boolean mint: the brand rides MathCard.agree to the
// Inspector's mark resolver, which DEMANDS it — so a plain boolean can never enter a verdict mark, and this
// mint cannot be deleted without breaking the type flow. Phantom brand, zero runtime cost. (The `as
// AgreementResult` here + the summary mint above are the ONLY two in this file; the sweep allowlists it.)
const agrees = (matched: boolean): AgreementResult<boolean> => matched as AgreementResult<boolean>

// Range agreement: EXACT equality — no tolerance. The recompute forms are operand-order-faithful to the
// engine (the pinned left-to-right f64 dot + IEEE sqrt — decision-forms excerpt, doctrine §1.6), so JS f64
// reproduces the stored range_m BIT-FOR-BIT and the all-75 oracle passes at exact. Object.is (not `Math.abs
// <= eps`) so a genuinely divergent scalar can NEVER be painted a false match: an operand-order infidelity
// would fail loud here (INS-002 stays surfaceable), a real discovery to report — never tolerated away.
export function rangeMatches(ours: number, engine: number): boolean {
  return Object.is(ours, engine)
}

// ── the Inspector card (the substituted form + the agreement) ───────────────────────────────────────────

export interface MathLine { label: string; value: string }
export interface MathCard {
  form: string          // the pinned decision form (name + the inequality it decides)
  lines: MathLine[]     // the decoded numbers substituted into that form
  verdict: string       // OUR recomputed conclusion (INSIDE/HIT/CLEAR/…, or the recomputed range)
  engine: string        // the engine's conclusion (from result_flag) — for the mismatch voice on disagreement
  agree: AgreementResult<boolean> | null // recomputed-and-matched (BRANDED): the executor MINTS this per
                        // row, so the Inspector's mark resolver DEMANDS the brand; a plain boolean cannot flow
                        // into a verdict mark, and deleting the mint is a COMPILE error. → ✓/✗. NULL = NO
                        // comparison ran (a missing LOS composite): UNBRANDABLE, so a no-comparison state
                        // can never mint a false ✗ — the type forces the unverifiable '?' path first.
  claims: MathLine[]    // display-only rows (the pinned bearing bits) — the CLAIM voice, NEVER a ✓
  claimNote?: string
  unverifiable?: boolean // we could NOT recompute (e.g. a LOS row with no composite) → the neutral '?' voice
                         // and the DISPLAY driver; agree is null (no comparison ran), not an engine mismatch —
                         // never a ✓, and no brandable false to be misread as a ✗.
}

// Compact number formatting: exact integers (the lattice fixtures) read bare; others get 4 decimals trimmed.
export function num(v: number): string {
  if (Object.is(v, -0)) return '0'
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(4)))
}
const vec = (v: Vec3): string => `(${num(v[0])}, ${num(v[1])}, ${num(v[2])})`

// Build the Inspector card for one query. `composite` is required only for a kind-4 LOS row (its 3 component
// rays); pass the validated composite from the publish-time store (losComponents). Pure.
export function showMath(d: QueryDraw, composite: LosComposite | null): MathCard {
  switch (d.kind) {
    case QUERY_KIND.POINT_IN_REGION: {
      if (d.object === 1) {
        const r = recomputeBall(d.point)
        const verdict = (r.inside ? 'INSIDE' : 'OUTSIDE') + (r.tiebreak ? ' · boundary' : '')
        return {
          form: 'point in ball · d² ≤ r²',
          lines: [
            { label: 'p', value: vec(d.point) }, { label: 'c', value: vec(SPHERE.center) },
            { label: 'd²', value: num(r.d2) }, { label: 'r²', value: num(SPHERE.r2) },
          ],
          verdict, engine: d.verdict, agree: agrees(r.inside === (d.verdict === 'INSIDE')), claims: [],
        }
      }
      const r = recomputeBox(d.point)
      const verdict = (r.inside ? 'INSIDE' : 'OUTSIDE') + (r.tiebreak ? ' · face' : '')
      return {
        form: 'point in box · min ≤ p ≤ max (all axes)',
        lines: [
          { label: 'p', value: vec(d.point) },
          { label: 'min', value: vec(BOX.min) }, { label: 'max', value: vec(BOX.max) },
        ],
        verdict, engine: d.verdict, agree: agrees(r.inside === (d.verdict === 'INSIDE')), claims: [],
      }
    }
    case QUERY_KIND.RANGE_BEARING: {
      const ours = recomputeRange(d.o, d.g)
      return {
        form: 'range · √(dot(g−o, g−o))',
        lines: [
          { label: 'o', value: vec(d.o) }, { label: 'g', value: vec(d.g) },
          { label: 'range', value: `${num(ours)} m` },
        ],
        verdict: `${num(ours)} m`, engine: `${num(d.rangeM)} m`,
        agree: agrees(rangeMatches(ours, d.rangeM)),
        // The bearing is an atan2 value — a pinned vendored-libm KAT bit, DISPLAYED, never recomputed here.
        claims: [{ label: 'bearing', value: `${num(d.bearingRad)} rad · ${num(d.bearingDeg)}°` }],
        claimNote: 'pinned vendored-libm bits — displayed, not recomputed',
      }
    }
    case QUERY_KIND.RAY_OCCLUDER: {
      const r = recomputeRay(d)
      const verdict = (r.hit ? 'HIT' : 'MISS') + (r.tiebreak ? ' · tiebreak' : '')
      const kindName = d.object === 1 ? 'sphere' : d.object === 2 ? 'AABB (slab)' : 'triangle (Möller–Trumbore)'
      const lines: MathLine[] = [
        { label: 'mode', value: d.mode === 0 ? 'ray (w = dir)' : 'segment (w = endpoint)' },
        { label: 'o', value: vec(d.o) }, { label: d.mode === 0 ? 'dir' : 'w', value: vec(d.target) },
      ]
      // The metric reach is RECOMPUTED here from raw (o, target) + the stored t (rayContact — t·|dir| ray /
      // t·|w−o| segment), NOT echoed from the model layer's d.hitPoint/d.metricDist. Shown on a hit (t exists).
      const contact = r.hit ? rayContact(d) : null
      if (contact) {
        lines.push({ label: 'hit', value: vec(contact.hitPoint) })
        lines.push({ label: 'dist = t·|dir|', value: `${num(contact.reach)} m` })
      }
      return {
        form: `ray ∩ ${kindName}`, lines, verdict, engine: d.verdict,
        agree: agrees(r.hit === (d.verdict === 'HIT')), claims: [],
      }
    }
    case QUERY_KIND.LOS: {
      const form = 'line of sight · clear = ¬(any occluder segment-hits)'
      const sightline: MathLine = { label: 'sightline', value: `${vec(d.o)} → ${vec(d.g)}` }
      // A LOS verdict is checkable ONLY from its 3 component rays' OWN geometry. With NO composite there is
      // nothing to recompute, so NO comparison runs — and an unbrandable state cannot mint an AgreementResult:
      // agree is NULL, never a branded false. That IS the brand's contract — it PROVES a comparison
      // occurred — so a missing composite cannot manufacture a brandable false that a consumer (recomputedVerdict)
      // would read as a ✗ MISMATCH where the honest state is UNVERIFIABLE. unverifiable:true stays the display
      // driver, and this also forecloses the old tautology (derive `clear` FROM the engine's verdict, then "agree"
      // with it → a false green). In production the publish-time triplet validation guarantees the composite
      // (losComponents never returns null for a real kind-4 draw), so this is the honest answer to a
      // should-never-happen — but a false ✗/✓ must not be REPRESENTABLE, reachable or not.
      if (!composite) {
        return {
          form, lines: [sightline],
          verdict: 'unverifiable — composite missing', engine: d.verdict,
          agree: null, unverifiable: true, claims: [],
        }
      }
      // EVERY assertion the card makes about this sightline derives from ONE recomputed source — the per-
      // component recomputeRay hits below feed the verdict, the blocker suffix, AND the row labels, so the
      // card can never contradict itself in the drift case this surface exists to expose. The engine-derived
      // composite.firstBlocker/blockerObject (queryStage) are deliberately NOT consulted: a recomputed-HIT
      // vs engine-MISS component must render BLOCKED · <occ> over a row that says hit (never over rows all
      // reading "clear"), and an engine-false-HIT must render plain CLEAR (never "CLEAR · S").
      const hits = composite.components.map(c => recomputeRay(c).hit)
      const blockerIdx = hits.indexOf(true) // first RECOMPUTED blocker in S,B,T order (components come sorted)
      const clear = blockerIdx === -1 // ≡ recomputeLos(composite) — the same pure predicate, single-sourced
      const verdict = clear ? 'CLEAR' : `BLOCKED · ${occ(composite.components[blockerIdx]!.object)}`
      const lines: MathLine[] = [sightline]
      composite.components.forEach((c, i) => {
        if (!hits[i]) { lines.push({ label: occ(c.object), value: 'clear' }); return }
        // rayContact supplies COORDINATES only (it leans on the engine's stored t): a recomputed hit whose
        // engine row disagrees (an engine-MISS carries no t) still SAYS hit — the row label never borrows
        // the engine's answer, only its contact coordinates when they exist.
        const contact = rayContact(c)
        lines.push({ label: occ(c.object), value: contact ? `HIT @ ${vec(contact.hitPoint)}` : 'hit (no contact point)' })
      })
      return {
        form, lines, verdict, engine: d.verdict,
        agree: agrees(clear === (d.verdict === 'LOS_CLEAR')), claims: [],
      }
    }
  }
}

const occ = (object: number | null): string => object === 1 ? 'S' : object === 2 ? 'B' : object === 3 ? 'T' : '—'
