import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'
import { spineRevealCount } from './spine'
import { PALETTE, CATEGORY } from './theme'
import {
  SPHERE, BOX, TRIANGLE, type QueryStageData, type QueryDraw, type Vec3, type LosComposite,
} from './queryStage'
import { actOf, lineFadeFactor, solidRevealSeqs, observerPoint, missRayEndpoint, ghostVisible, ACT_III_START } from './queryScene'
import { HORIZON_HOPS, HORIZON_OPTS, causalNeighborhood } from './chain'

// ── The Query Stage (v0.6) — e0 kind-23 geometric replay ────────────────────────────────────────────
// The release's heart, and the LENS CONSTITUTION's first LAW-4 citizen (the declaration is filed in
// queryStage.ts). REPLACES the presentational spine as e0's stage: the probes now WRITE THE WORLD as the
// run plays — each resolved query renders its ACTUAL geometry (points in/out of regions, range/bearing
// rays, occluder rays with their hit points, LOS sightlines with blocker attribution) in real NED space.
// The verdict is SELF-EVIDENT FROM THE GEOMETRY, not colour blinking: a ray STOPS at a solid with a bright
// contact where it hits; a miss sails past; a blocked sightline dies at the occluder that blocked it; a
// CLEAR sightline sails all the way through in the affirm hue — a first-time viewer can SAY WHAT THEY SAW.
//
// ECHO GRAMMAR + §2.4 hairball ruling: fade the LINES (spent rays decay behind the head over a short
// window), persist the CONTACTS + SOLIDS (the 21 hit points collapse to ~13 spots — a small durable
// constellation; the 3 scenario bodies materialise as their first probe touches them). So the accumulated
// rest is the legible sketch of WHERE things were hit, never the 64-line snarl.
//
// REVEAL CLOCK: spineRevealCount(tick) REUSED VERBATIM (seq == tick holds for e0). The head seq is the
// reveal count; draws 0..reveal are written; the head (seq === reveal) is the live probe at full voice.
// Grows forward with the playhead, TRUNCATES on a scrub back (a pure function of tick, both directions) —
// so the write-as-you-play / scrub-back contract holds BY CONSTRUCTION (the shipped e0 reveal mechanism).
//
// SELECTION RE-LENSING (THE AGGREGATION HORIZON): selection is a lens held
// OVER the rest state, not a replacement for it. With an event selected the revealed geometry lenses by causal
// HOP DISTANCE (causalHops, HORIZON_HOPS = 3, the constant chain.ts exports to BOTH this stage and the timeline
// overlay): the selected probe glows accent-HDR (the frame's SOLE line bloom); its ≤3-hop causal neighborhood
// rides the `spine` violet in the HOP_DECAY registers (×1.0 / 0.65 / 0.4 — SYMMETRIC, distance-only and
// direction-blind, retiring the shipped anc ×0.6 / desc ×1.0 asymmetry); and EVERYTHING BEYOND the horizon
// re-enters the exact ambient law the rest state uses (act-tint steel / affirm-CLEAR × fade) × LINE_AMBIENT_YIELD
// 0.3. On e0's degenerate hash chain a selected LOS composite lights its own component neighbourhood — the
// accent subject sightline plus an overlay of its geometrically-DISTINCT component corridors (a coincident
// MISS / firstBlocker corridor yields to the subject, one-segment-one-owner) and nothing else — so the WHY
// voice finally says something specific, and the ≤7-line squint budget holds (§2.3). Deselect returns
// the identical rest BY CONSTRUCTION (the unselected window path is a pure function of the reveal).
//   LENS SPLIT (CONSTRAINT — hue = identity, chroma = hierarchy): only the LINES re-lens to the role violet
// (causation's own surface wears the causality hue). The persistent CONTACTS keep their VERDICT hue — a
// contact's identity IS its verdict (affirm / negate) — and yield only CHROMA under selection (dimmed by
// CONTACT_DIM to the supporting register, ONE dim level regardless of hop, the selected probe's own contact
// popping to accent). The tiebreak BADGES stay the neutral annotation token. So a contact never re-lenses to
// violet: role is the thread's job, verdict is the contact's. Fade suspension SHRINKS from the whole written
// prefix to the horizon neighborhood — beyond it a spent line fades to 0 (black = invisible under additive
// blending), so a standing selection paints ≤6 violet neighbours + one accent subject, never a violet comb.
//   THE NOT-YET GHOST: a selection AHEAD of the frontier (ev > reveal) is not yet written, so the stage
// previews the selected probe alone as a hollow, unbloomed accent OUTLINE of its recorded geometry (line +
// contact per its written form) — never the ×2.2 HDR, never a badge / solid / chain fill, camera unmoved.
// When the playhead reaches it the outline is replaced in place by the written form and earns its bloom (the
// fill-in); ghost and written are mutually exclusive (ghostVisible ⇔ ev > reveal), so no frame draws both.
// Under a ghost the revealed prefix obeys the horizon law above (ambient × yield), so violet IGNITES hop by
// hop only as the playhead closes within HORIZON_HOPS of the ghost — earned-approach choreography at zero cost.
//
// The load budget / PERF — the whole stage rebuilds on a STORE SUBSCRIPTION at tick / selection BOUNDARIES only (NO
// useFrame; the integer tick advances at witness rate, never mid-tick), and the rebuild is engineered to be
// ALLOCATION-FREE in steady state and O(changed), not O(revealed), so it holds at f4 scale (e0's 75 events
// would mask an O(revealed) rebuild; a campaign run will not):
//   • PRECOMPUTE ONCE AT LOAD (buildPrecomp, a useMemo over the published draws): every draw's immutable
//     geometry — instanced line matrices (NED→three baked in), contact matrices + base colours, badge
//     matrices, and the mode-0 MISS endpoint (missRayEndpoint) — is built exactly once per model. The hot
//     path never re-transforms a coordinate or allocates a tuple.
//   • CACHE SELECTION-ROLE MEMBERSHIP on the SELECTION edge, not per tick: the bounded causal HOP MAP
//     (causalHops, ≤7 entries) is rebuilt only when the selected event changes (a ref), never on a plain tick
//     advance under a standing selection.
//   • O(CHANGED) RANGE WRITES: the CONTACTS are static geometry + static unselected colour, so their matrices
//     and base colours are written to the instance buffer ONCE; a plain tick then only bumps `count` (a range
//     of newly-revealed contacts under a live selection, else nothing). The LINES fade behind the head, so an
//     unselected tick rewrites only the ~LINE_FADE_TICKS-wide active window; a SELECTED tick rewrites the same
//     bounded trailing window (the beyond-horizon ambient lines fade; the neighbourhood is fade-exempt) and
//     appends the newly revealed lines. Selection edges (rare, user-driven) recolour the visible prefix.
//     Module-owned scratch throughout; zero steady per-frame allocation, zero per-frame work.
// DEVIATION from the plan's "fade via the trail-SHADER pattern": the fade is stepped at EVENT rate (the same
// head-relative math, computed in the build) rather than a per-frame uHead uniform — on a positionless run
// nothing MOVES within a tick (one event per tick), so a per-frame uniform would smooth a sub-tick gap that
// never renders. Event-rate is the stricter load-budget posture (zero frame-path work) and visually identical at
// witness pace. Materials are fog:false — the stage sits hundreds of units out (core-theatre framing), well
// beyond the scene's 30→400 fog, so fog would erase it; the raw-shader trail opts out the same way.

// NED (north/east/down) → three.js [x=north, y=up=−down, z=east] = [n,−d,e]. The flip lays the near-planar slab
// (d ≈ 0) into the ground (XZ) plane so it reads against the grid, up is up.
//
// BASIS BOUNDARY: this is basis B, and it is DELIBERATELY NOT the app-wide flight basis A
// (placement.nedToThree = [e,−d,n]). That is correct HERE and only here: the query stage (e0) is POSITIONLESS —
// it overlays no decoded flight, no trail, no interactive drone — so nothing drawn on this stage is in basis A
// to conflict with. Its basis is fully SELF-CONTAINED: this t3, the matrix builders below (makeTranslation
// [p[0],−p[2],p[1]]), AND the camera framing (queryScene's observer/finale conversion, the same [c[0],−c[2],c[1]])
// all agree, so what is drawn is what is framed. f2a's basis defect was the opposite — mixing a basis-A flight
// with a basis-B apparatus on ONE stage; f2a is now unified on basis A (sensingStageView imports nedToThree),
// and this basis-B stage must stay unmirrored. Pure index math — no allocation beyond the returned tuple.
const t3 = (v: Vec3): [number, number, number] => [v[0], -v[2], v[1]]

// Module-owned scratch (T0 renderer discipline: each extracted renderer owns its scratch; never shared
// cross-component). Used on the LOAD-TIME precompute (matrix builders) and, on the hot path, only mColor in
// the unselected line-window recolour — never for allocation.
const mA = new THREE.Vector3()
const mB = new THREE.Vector3()
const mMid = new THREE.Vector3()
const mDir = new THREE.Vector3()
const mScale = new THREE.Vector3()
const mQuat = new THREE.Quaternion()
const mUp = new THREE.Vector3(0, 1, 0)
const mColor = new THREE.Color()
// A collapse-to-a-point transform: writing it to an instance hides that instance (zero area, nothing rasterises)
// without touching `count`. Used for the composite-yield: a selected component's parent composite line steps
// aside so the accent corridor is the sole owner. Immutable module constant — never mutated.
const ZERO_MAT = new THREE.Matrix4().makeScale(0, 0, 0)

// Render sizes (world units), calibrated for the core-theatre framing (radius ≈674, camera ≈1800u out):
// a line ~2–3px wide, a contact ~6px, a solid legible. Tuned on screenshots.
const LINE_W = 3.2 // ray/segment/sightline cross-section
const CONTACT_R = 10 // hit-point / region-point marker radius
const BADGE_R = 16 // tiebreak ring radius (a hair proud of the contact)
const MISS_RAY_LEN = 520 // how far a mode-0 MISS ray reaches along its direction (it hits nothing)
const LINE_FADE_TICKS = 6 // spent-ray decay window (§2.4: keep ≤~3–4 active rays; short by design)

// Colour vocabulary — TOKENS ONLY (LAW 2). Derived ONCE at module scope.
//   • STEEL — the ambient probe geometry wears the `query` category hue (matte steel) it owns everywhere.
//   • AFFIRM / NEGATE — the R3 verdict pair (owner-approved), HDR-boosted so a resolved contact clears the
//     bloom 0.4 threshold and glows. affirm = INSIDE / ray-hit / LOS-clear; negate = a sightline BLOCK.
//   • SELECTED — accent HDR, the selection pop (below is untouched by role tones).
//   • ROLE_BY_HOP — the `spine` causality violet in the HOP_DECAY registers (×1.0 / 0.65 / 0.4) for hops 1/2/3;
//     symmetric (distance-only, direction-blind). Retires the flat ROLE_ANC ×0.6 / ROLE_DESC ×1.0 asymmetry.
//   • BADGE — textDim, a quiet annotation ring for tiebreak beats (Inspector's tiebreak vocabulary is text-
//     only, so the badge is a SHAPE cue in a neutral UI token, never a new verdict hue).
//   • MARKER — textPrimary, the two source anchors (origin fan / drawn observer) as neutral "eye" points.
// HDR BOOSTS (exported): the verdict-contact and accent-selected multipliers, factored out of the colour
// derivations below so they are ONE source of truth. Exported so the bloom-threshold tests bind to the
// renderer's ACTUAL boosts — a contact's unsel/dim colours come from CONTACT_HDR, the written selected form
// and the ghost's fill-in target come from SELECTED_HDR — and a change to either is FELT by the pinned
// "does this hue clear the bloom threshold?" luminance assertions instead of drifting silently past them.
export const CONTACT_HDR = 2.0
export const SELECTED_HDR = 2.2
const STEEL = new THREE.Color(CATEGORY.query.hue)
const AFFIRM = new THREE.Color(PALETTE.verdictAffirm)
const AFFIRM_HDR = new THREE.Color(PALETTE.verdictAffirm).multiplyScalar(CONTACT_HDR)
const NEGATE_HDR = new THREE.Color(PALETTE.verdictNegate).multiplyScalar(CONTACT_HDR)
// Exported: the bloom regression pins the RENDERER'S selected colour (not a test-side reconstruction) —
// the selection pop must CLEAR the shared threshold while dimmed contacts sit below it. Both sides bound.
export const SELECTED = new THREE.Color(PALETTE.accent).multiplyScalar(SELECTED_HDR)
// EMPHASIS DECAY — the `spine`-violet multipliers for hops 1/2/3, SYMMETRIC (distance-only,
// direction-blind: the shipped anc ×0.6 / desc ×1.0 asymmetry is RETIRED — direction is already answered by
// the Inspector's ← cause / effect → and by the ribbon's split arcs, so encoding it in the hue's chroma too
// was two hierarchies in one channel, the mud LAW 2 forbids). Three perceptibly distinct registers (ratio
// ≈0.63/step); hop-3 ×0.4 reads as the tail of a wake just above the ambient whispers; hop-1 ×1.0 is
// byte-identical to the retired ROLE_DESC tone (already proven sub-bloom in the shipped build — pinned).
export const HOP_DECAY = [1.0, 0.65, 0.4] as const
// Built ONCE at module scope (three shared THREE.Color constants; setColorAt copies them, so returning a
// shared reference from the colour helper is safe and allocation-free). Indexed by hop − 1 (hop 1 → [0]).
export const ROLE_BY_HOP = HOP_DECAY.map((f) => new THREE.Color(PALETTE.spine).multiplyScalar(f))
// LAW-1's chroma-cede applied to LINES (the CONTACT_DIM philosophy): the ambient window that survives BEYOND
// the horizon under a selection yields to this fraction, so the accent subject is the ONLY line bloom. Pinned:
// the head's CLEAR sightline at affirm ×1.6 (luminance ≈1.14, blooming when unselected) × 0.3 ≈ 0.34 < the
// 0.4 bloom threshold. At REST (no selection) the yield is 1 — the protected rest grammar is untouched.
export const LINE_AMBIENT_YIELD = 0.3
const BADGE = new THREE.Color(PALETTE.textDim)
const MARKER = new THREE.Color(PALETTE.textPrimary)
// Act tint (chroma hierarchy of ONE hue — LAW 2): the three acts' ambient fans wear graded steel so the
// temporally-disjoint origin (acts I/II) and observer (act III) fans never read as one snarl at the rest.
const ACT_TINT = [1.0, 0.82, 0.66] as const

// CONTACT_DIM — the chroma a contact yields under selection (CONSTRAINT: hue = identity, chroma = hierarchy).
// A selected contact keeps its VERDICT hue and drops to this fraction of its HDR base, ceding hierarchy to the
// accent subject while retaining identity — ONE dim level for all contacts (grading it by role would put two
// hierarchies in one hue channel). Set so the dimmed product stays BELOW the bloom's 0.4 luminance threshold on
// BOTH verdict hues, so no supporting contact competes with the subject's glow: affirm's HDR contact
// (verdictAffirm ×2.0 ≈ luminance 1.43) × 0.25 ≈ 0.36 < 0.4; negate is sub-threshold at any dim. (×0.4 left
// affirm at ≈0.57 — above threshold, so it bloomed.)
export const CONTACT_DIM = 0.25

// THE NOT-YET GHOST wears the accent token at ×1.0 (selection's identity — NEVER the ×2.2 HDR) as a hollow
// wireframe at this opacity; the transparent-wireframe form keeps its composited luminance (≈0.15 over the dark
// region beyond the frontier) below the 0.4 bloom threshold, so the ghost never blooms. Its bloom is earned
// only by the fill-in to the written form when the playhead arrives.
export const GHOST_OPACITY = 0.35

// SCENARIO-SOLID shell opacity — the base translucency of each body's wireframe shell, indexed by object id
// (1 sphere · 2 box · 3 triangle). The JSX mirrors these EXACTLY (single source of truth). SHELL_LIFT is the
// one-step lift a selected LOS COMPONENT paints on the ONE solid it interrogated (a screenshot-gated cue):
// its distinguishing content vs its two siblings (same corridor, different occluder). Uniform-only, restored
// on deselect — load-budget-clean, zero tokens.
const SHELL_OPACITY = [0.22, 0.3, 0.2] as const
const SHELL_LIFT = 0.35
// Set a solid's shell alpha: lifted when it is the interrogated object, else its base. Uniform-only write.
function applyShellOpacity(mesh: THREE.Mesh | null, obj: number, liftObj: number): void {
  if (!mesh) return
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.opacity = obj === liftObj ? SHELL_LIFT : SHELL_OPACITY[obj - 1]!
}

// The AMBIENT LINE voice (the rest-state law, and — beyond the horizon under a selection — the beyond-horizon
// law too): additive act-tint steel × head-relative `fade`, or the CLEAR affirm voice ×1.6 × `fade`, all ×
// `yieldK`. The caller supplies `fade` (both sites already have it — the rest path to gate DRAWING a line at
// all, the selection path is full-packed and paints a spent line black rather than dropping it). `yieldK` is 1
// at rest (the protected grammar, byte-identical to the pre-horizon inline math) and LINE_AMBIENT_YIELD when a
// selection pushes a beyond-horizon line back into the ambient law. Writes `out`, returns it — module scratch,
// zero allocation.
export function ambientLineColor(out: THREE.Color, clear: boolean, tint: number, fade: number, yieldK: number): THREE.Color {
  return clear
    ? out.copy(AFFIRM).multiplyScalar(1.6 * fade * yieldK)
    : out.copy(STEEL).multiplyScalar(tint * fade * yieldK)
}

// The LINE voice under a SELECTION (CONSTRAINT: hue = identity, chroma = hierarchy — a LINE grammar only, never
// a contact): the subject (hop 0) wears accent SELECTED — the frame's SOLE line bloom,
// fade-exempt; the ≤ HORIZON_HOPS neighbourhood wears the `spine` violet in the HOP_DECAY registers
// (ROLE_BY_HOP), also fade-exempt; everything BEYOND the horizon re-enters the ambient law × LINE_AMBIENT_YIELD
// (so it fades — a spent beyond-horizon line is black, invisible under AdditiveBlending, rather than a
// persistent violet comb). `hop` is the bounded causalHops map for the selected event (≤7 entries). Under a
// GHOST (ev > reveal) this is the SAME function: revealed ancestors within HORIZON_HOPS ignite in the decay
// registers hop by hop as the head closes on the ghost, the far prefix stays ambient×yield. Module-level (NOT a
// per-tick closure); the lit cases return shared module constants (setColorAt copies), the ambient case writes
// `out`, so the hot path allocates NOTHING.
export function selectedLineColor(out: THREE.Color, l: LineItem, ev: number, hop: ReadonlyMap<number, number>, reveal: number): THREE.Color {
  if (l.seq === ev) return SELECTED
  const h = hop.get(l.seq)                        // 1..HORIZON_HOPS for a neighbour; undefined beyond the horizon
  if (h !== undefined) return ROLE_BY_HOP[h - 1]! // h === 0 ⇔ l.seq === ev (handled above), so h ≥ 1 here
  const fade = lineFadeFactor(reveal, l.seq, LINE_FADE_TICKS)
  if (fade <= 0) return out.setRGB(0, 0, 0)       // spent beyond-horizon line → black (invisible additive)
  return ambientLineColor(out, l.clear, l.tint, fade, LINE_AMBIENT_YIELD)
}

// SELECTED LOS COMPOSITE → its GEOMETRICALLY-DISTINCT component corridors (v0.7). A
// composite's three component RAY_OCCLUDER rows are its nearest-3 ancestors, but their ambient lines are
// SUPPRESSED (playback de-dup), so the composite's own accent sightline — painted SELECTED by the main line
// pass — is the sole owner of the o→subject segment. This overlay draws the components back as NEIGHBOURHOOD
// in the hop-decay registers (ROLE_BY_HOP), but ONLY the ones whose corridor is DISTINCT from that subject
// segment, so an additive instance never STACKS on the subject and washes the selected hue (ONE-SEGMENT-ONE-
// OWNER — the un-suppression ruling's own principle). The naïve "draw all three components" it replaces
// stacked three ROLE_BY_HOP instances on a CLEAR composite's own accent sightline (every MISS corridor is
// byte-identical to the o→g subject — validateLosComposite pins endpoint identity, and CLEAR ⟹ no HIT), so
// the payoff sightline read as violet, not accent.
//   OWNERSHIP RULE (semantic, not a float-matrix compare — the model already flags HIT and names the
//   firstBlocker). A component is drawn iff it is a HIT that is NOT the firstBlocker:
//     • a MISS corridor is the full o→g sightline — byte-identical to a CLEAR subject, and in a BLOCKED
//       composite the redundant "sailed past" ray the subject's block already refutes — so every MISS yields
//       (its evidence IS the subject line; the chip + bounded timeline arcs carry the neighbourhood identity).
//     • the firstBlocker's hit point is exactly where the BLOCKED subject line dies (comp.firstBlocker.hitPoint
//       is that subject endpoint), so its corridor IS the subject — it yields too.
//     • every OTHER HIT terminates at its own occluder (distinct pixels, real additional evidence) → drawn.
//   So a CLEAR composite (all-MISS; e0 51/74) draws ZERO overlay corridors — the accent sightline sails clean,
//   no violet wash — and a BLOCKED composite draws only the distinct HIT corridors the subject's single death
//   point does not already show (e0 70: the triangle blocker beyond the sphere the subject dies at). The
//   selected-COMPONENT voice (selCompLine) is untouched. A byte-identity regression test pins the geometric
//   guarantee separately. WRITTEN composite only (the caller passes `undefined` otherwise → count 0).
//   Allocation-free: writes the mesh directly (no per-tick array), returns the count written.
export function writeCompositeComponentCorridors(
  mesh: THREE.InstancedMesh,
  composite: LosComposite | undefined,
  componentLines: ReadonlyMap<number, THREE.Matrix4>,
  hop: ReadonlyMap<number, number>,
  reveal: number,
): number {
  let n = 0
  if (composite) {
    const blockerSeq = composite.firstBlocker?.seq // the one component whose hit point the SUBJECT line already draws to
    for (const c of composite.components) {
      if (c.seq > reveal) continue                    // only revealed components draw (a written selection)
      // OWNERSHIP BY GEOMETRIC DISTINCTNESS: a MISS corridor is the o→g subject (CLEAR) or the sailed-past ray
      // the block refutes (BLOCKED); the firstBlocker's corridor IS the BLOCKED subject line. Both would stack
      // an additive instance on the subject and wash it — they yield. Only a non-firstBlocker HIT is distinct.
      if (c.verdict !== 'HIT' || c.seq === blockerSeq) continue
      const h = hop.get(c.seq)
      if (h === undefined || h < 1 || h > HORIZON_HOPS) continue // beyond the horizon → stays suppressed
      const mat = componentLines.get(c.seq)
      if (!mat) continue
      mesh.setMatrixAt(n, mat); mesh.setColorAt(n, ROLE_BY_HOP[h - 1]!)
      n++
    }
  }
  mesh.count = n
  if (n > 0) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  return n
}

// ── Load-time precompute (buildPrecomp) — every draw's immutable render data, built ONCE per model ──────
// The frame path consumes these; it never re-derives a coordinate or allocates. NED→three, matrix compose,
// and the mode-0 miss-endpoint math all happen here, off the hot path.

// A drawable line as a static unit-Y box transform (compose baked at load). `clear` selects the LOS_CLEAR
// affirm tone over ambient steel; `tint` is the act grade for the steel case. Colour is applied per tick
// (fade / role); only the MATRIX is immutable.
export interface LineItem { seq: number; mat: THREE.Matrix4; clear: boolean; tint: number }
// A persistent verdict contact: static matrix + static UNSELECTED colour + the DIMMED colour a live selection
// paints it (the verdict hue at CONTACT_DIM chroma — identity kept, hierarchy ceded, below the bloom threshold).
// `selectable` = whether the selected event's own contact pops to accent (the standalone hit / region point
// do; a LOS component's block contact does not — it stays dimmed negate).
interface ContactItem { seq: number; mat: THREE.Matrix4; unsel: THREE.Color; dim: THREE.Color; selectable: boolean }
// A tiebreak badge. `ride` = its visibility rides the line's fade (kind-2 range badge, kind-3 MISS badge with
// no hit point); the rest persist once revealed. Colour is always the neutral BADGE token.
interface BadgeItem { seq: number; mat: THREE.Matrix4; ride: boolean }
interface Precomp {
  lines: LineItem[]; lineSeqs: Int32Array
  contacts: ContactItem[]; contactSeqs: Int32Array
  badges: BadgeItem[]
  // SELECTION UN-SUPPRESSION: each LOS component's OWN corridor ray, seq-keyed, held OUT of the ambient `lines`
  // (the playback de-dup stands — 4 identical corridor lines would be the §2.4 hairball). Consumed only in the
  // interrogation voice: the written-selection mesh and the ghost line. Byte-identical to what each would draw.
  componentLines: Map<number, THREE.Matrix4>
}

// Unit-Y box → the segment a→b (NED inputs): centred on the midpoint, oriented along the direction, scaled to
// length × LINE_W cross-section. Returns null for a degenerate (o == g) segment — no instance. Uses module
// scratch; allocates only the returned Matrix4 (load time).
function lineMatrix(a: Vec3, b: Vec3): THREE.Matrix4 | null {
  mA.set(a[0], -a[2], a[1]); mB.set(b[0], -b[2], b[1])
  mDir.subVectors(mB, mA)
  const len = mDir.length()
  if (len < 1e-6) return null
  mMid.addVectors(mA, mB).multiplyScalar(0.5)
  mDir.multiplyScalar(1 / len)
  mQuat.setFromUnitVectors(mUp, mDir)
  mScale.set(LINE_W, len, LINE_W)
  return new THREE.Matrix4().compose(mMid, mQuat, mScale)
}
function pointMatrix(p: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(p[0], -p[2], p[1])
}
// A tiebreak ring lies flat in the ground plane (a target pad around the beat's contact).
function badgeMatrix(p: Vec3): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
  m.setPosition(p[0], -p[2], p[1])
  return m
}

// One pass over the published draws, in seq order, mirroring the shipped per-kind drawable inventory. The
// instance ORDER within each mesh is seq-ascending, so a reveal is a prefix (contacts/badges) or a prefix
// window (lines) — the property the O(changed) tick updates rely on.
export function buildPrecomp(
  draws: readonly (QueryDraw | null)[],
  componentSeqs: ReadonlySet<number>,
  composites: ReadonlyMap<number, LosComposite>,
): Precomp {
  const lines: LineItem[] = []
  const contacts: ContactItem[] = []
  const badges: BadgeItem[] = []
  const pushLine = (a: Vec3, b: Vec3, clear: boolean, seq: number): void => {
    const mat = lineMatrix(a, b)
    if (mat) lines.push({ seq, mat, clear, tint: ACT_TINT[actOf(seq) - 1]! })
  }
  const pushContact = (p: Vec3, base: THREE.Color, selectable: boolean, seq: number): void => {
    contacts.push({ seq, mat: pointMatrix(p), unsel: base.clone(), dim: base.clone().multiplyScalar(CONTACT_DIM), selectable })
  }
  const pushBadge = (p: Vec3, ride: boolean, seq: number): void => {
    badges.push({ seq, mat: badgeMatrix(p), ride })
  }

  for (let seq = 0; seq < draws.length; seq++) {
    const d = draws[seq]
    if (!d) continue
    switch (d.kind) {
      case 1: { // POINT_IN_REGION — a persistent point marker; verdict = membership. No line.
        pushContact(d.point, d.verdict === 'INSIDE' ? AFFIRM_HDR : NEGATE_HDR, true, seq)
        if (d.tiebreak) pushBadge(d.point, false, seq)
        break
      }
      case 2: { // RANGE_BEARING — a measured steel line (no verdict, no contact). Fades when spent.
        pushLine(d.o, d.g, false, seq)
        if (d.tiebreak) pushBadge(d.g, true, seq) // seq16 zero-range (o == g draws no line); rides the fade window
        break
      }
      case 3: { // RAY_OCCLUDER
        if (componentSeqs.has(seq)) {
          // A LOS component: its ambient LINE is suppressed (the composite's sightline carries the corridor
          // during playback — 4 identical lines are the §2.4 hairball). Its occluder-HIT contact still draws —
          // a BLOCK in the LOS context, so the negate hue — and is now SELECTABLE (the interrogation voice
          // un-suppresses it: a selected component's own contact pops to accent like every other selected
          // contact; the playback suppression was a de-dup, never a "this event has no answer" verdict). Its
          // own corridor ray is built into componentLines below for the interrogation voice (selection / ghost).
          if (d.verdict === 'HIT' && d.hitPoint) pushContact(d.hitPoint, NEGATE_HDR, true, seq)
          if (d.tiebreak && d.hitPoint) pushBadge(d.hitPoint, false, seq)
          break
        }
        // A standalone object-learning ray: the shaft reaches out; a HIT stops at the solid with an affirm
        // contact (persists), a MISS sails MISS_RAY_LEN along its direction (only the shaft fades).
        if (d.verdict === 'HIT' && d.hitPoint) pushContact(d.hitPoint, AFFIRM_HDR, true, seq)
        const end: Vec3 = d.hitPoint
          ? d.hitPoint
          : d.mode === 0
            ? missRayEndpoint(d.o, d.target, MISS_RAY_LEN)
            : d.target
        pushLine(d.o, end, false, seq)
        if (d.tiebreak) pushBadge(d.hitPoint ?? d.o, d.hitPoint !== null ? false : true, seq)
        break
      }
      case 4: { // LOS composite — the run's drawable heartbeat
        const comp = composites.get(seq)
        if (d.verdict === 'LOS_CLEAR') {
          // The payoff beat (tk51 / tk74): a full-length AFFIRM sightline sailing clean through. No contact.
          pushLine(d.o, d.g, true, seq)
        } else {
          // BLOCKED: the sightline dies at the occluder that stopped it (the ember block contacts were drawn
          // by the component rows above).
          pushLine(d.o, comp?.firstBlocker?.hitPoint ?? d.g, false, seq)
          if (d.tiebreak && comp?.firstBlocker?.hitPoint) pushBadge(comp.firstBlocker.hitPoint, false, seq)
        }
        break
      }
    }
  }

  // SELECTION UN-SUPPRESSION — each LOS component's OWN corridor ray, built from the SAME parsed component rows,
  // once per model. o→hitPoint on a HIT (the ray dies at its occluder), o→g on a MISS (the full shared corridor,
  // the
  // composite's sightline endpoint). Held OUT of `lines` (the ambient playback de-dup stands); consumed only
  // by the written-selection mesh and the ghost line, so both draw byte-identical geometry.
  const componentLines = new Map<number, THREE.Matrix4>()
  for (const comp of composites.values()) {
    for (const c of comp.components) {
      const end: Vec3 = c.verdict === 'HIT' && c.hitPoint ? c.hitPoint : comp.los.g
      const mat = lineMatrix(c.o, end)
      if (mat) componentLines.set(c.seq, mat)
    }
  }

  return {
    lines, lineSeqs: Int32Array.from(lines, (l) => l.seq),
    contacts, contactSeqs: Int32Array.from(contacts, (c) => c.seq),
    badges, componentLines,
  }
}

// Count of entries whose seq ≤ reveal, over a seq-ascending array (the revealed-prefix length). Allocation-free.
function prefixCount(seqs: Int32Array, reveal: number): number {
  let lo = 0, hi = seqs.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (seqs[mid]! <= reveal) lo = mid + 1; else hi = mid }
  return lo
}
// First index whose seq ≥ startSeq (the fade window's leading edge). Allocation-free.
function lowerIndex(seqs: Int32Array, startSeq: number): number {
  let lo = 0, hi = seqs.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (seqs[mid]! < startSeq) lo = mid + 1; else hi = mid }
  return lo
}
// Exact index of `seq` in a seq-ascending array, or -1 when absent — the NOT-YET ghost's single-probe lookup
// (the selected event's own line / contact entry, drawn from the SAME precomp the written path reads, so the
// ghost geometry is byte-identical to what the written form will draw when the head arrives). Allocation-free.
export function indexOfSeq(seqs: Int32Array, seq: number): number {
  let lo = 0, hi = seqs.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; const v = seqs[mid]!; if (v === seq) return mid; if (v < seq) lo = mid + 1; else hi = mid }
  return -1
}

// PURE paint-range reducer for the SELECTED line pass (v0.7). Under a standing selection the
// instance buffer already holds colours valid for `prevReveal` over indices [0, prevExtent). Only
// BEYOND-horizon lines are reveal-dependent (ambient × yield × fade, or fade-0 black); the subject + the
// ≤HORIZON_HOPS neighbourhood are fade-EXEMPT (reveal-independent role colours). A line's ambient fade is
// non-zero only for seq in (r − LINE_FADE_TICKS, r]; so a reveal change from `prevReveal` to `newReveal`
// invalidates exactly the lines whose seq lies in the UNION of the pre- and post-jump fade windows —
// (min(prev,new) − LINE_FADE_TICKS, max(prev,new)]. Repainting [from, to) with `from` = that union window's
// lower edge (clamped to the painted extent) and `to` = the revealed prefix length re-establishes correctness
// for ANY reveal delta. THE BUG THIS CLOSES: the shipped `from = min(windowStart, extent)` used only the NEW
// window, so a multi-tick FORWARD jump left the OLD window's lines — which crossed fade→0 during the jump —
// painted at their stale pre-jump ambient×0.3 instead of black; anchoring `from` on min(prev,new) covers that
// old lower edge. O(changed): the range grows only with the jump size + the bounded window, never with the
// revealed prefix (a single-tick advance repaints ≤ LINE_FADE_TICKS + 1 lines). Selection-EDGE recolours
// (a new `ev` → a new hop map → every role colour changes) are the caller's concern (it repaints from 0);
// this reducer governs the SAME-ev tick/scrub path only.
export function linePaintRange(
  lineSeqs: Int32Array, prevReveal: number, newReveal: number, prevExtent: number,
): { from: number; to: number } {
  const unionStart = Math.min(prevReveal, newReveal) - LINE_FADE_TICKS
  const from = Math.min(lowerIndex(lineSeqs, unionStart), prevExtent)
  const to = prefixCount(lineSeqs, newReveal)
  return { from, to }
}

export function QueryStage({ model, data }: { model: RunModel; data: QueryStageData }) {
  const linesRef = useRef<THREE.InstancedMesh>(null)
  const contactsRef = useRef<THREE.InstancedMesh>(null)
  const badgesRef = useRef<THREE.InstancedMesh>(null)
  const ghostLineRef = useRef<THREE.InstancedMesh>(null)     // NOT-YET ghost: the selected probe's line, capacity 1
  const ghostContactRef = useRef<THREE.InstancedMesh>(null)  // NOT-YET ghost: the selected probe's contact, capacity 1
  const selCompLineRef = useRef<THREE.InstancedMesh>(null)   // un-suppression: a selected LOS component's OWN written corridor, capacity 1
  const hopCompLineRef = useRef<THREE.InstancedMesh>(null)   // a selected COMPOSITE's ≤3 component corridors in hop registers, capacity HORIZON_HOPS
  const sphereRef = useRef<THREE.Mesh>(null)
  const boxRef = useRef<THREE.Mesh>(null)
  const triangleRef = useRef<THREE.Mesh>(null)
  const observerRef = useRef<THREE.Mesh>(null)

  const eventCount = model.eventCount
  const draws = data.draws
  const composites = data.losComposites
  // Precomputed ONCE per model (pure, off the frame path): the seqs that are LOS component rows (their lines
  // are suppressed), each solid's first-probed seq (materialise beat), and the drawn observer.
  const componentSeqs = useMemo(() => {
    const s = new Set<number>()
    for (const comp of composites.values()) for (const c of comp.components) s.add(c.seq)
    return s
  }, [composites])
  // componentSeq → its parent composite seq. Lets a selected component's composite line YIELD the corridor
  // (zero-scaled) so the accent ray owns it alone. Built once per model (pure, off the frame path).
  const componentToComposite = useMemo(() => {
    const m = new Map<number, number>()
    for (const comp of composites.values()) for (const c of comp.components) m.set(c.seq, comp.seq)
    return m
  }, [composites])
  const solidReveal = useMemo(() => solidRevealSeqs(draws), [draws])
  const observer = useMemo(() => observerPoint(draws), [draws])
  // The immutable render data — line/contact/badge matrices + base colours + the mode-0 miss endpoints — built
  // once per model alongside the published draws. This is the allocation that the hot path is freed of.
  const precomp = useMemo(() => buildPrecomp(draws, componentSeqs, composites), [draws, componentSeqs, composites])

  // Cross-build state (persists across ticks; reset when the precompute changes, i.e. a new model). Tracks what
  // the instance buffers currently hold so a tick can write only the CHANGED range.
  const rt = useRef({
    geom: null as Precomp | null,               // precompute the static buffers are initialised for
    hop: null as ReadonlyMap<number, number> | null,    // cached bounded causal hop map (causalNeighborhood, HORIZON_OPTS) of `hopEv`
    hopEv: undefined as number | null | undefined,
    conSelEv: null as number | null,            // selection whose colours the contacts currently hold (null = unselected)
    conSelColored: 0,                            // extent of contacts painted for `conSelEv`
    lineMode: 'window' as number | 'window',    // 'window' = unselected fade-window packing; number = role prefix for that ev
    lineSelColored: 0,                           // extent of the role-coloured line prefix
    lineReveal: 0,                               // reveal the selected line buffer was last painted for (the paint-range reducer)
    compYieldIdx: -1,                            // seg instance currently zero-scaled for the composite-yield (-1 = none)
    liftObj: 0,                                  // scenario object whose shell is currently opacity-lifted (0 = none)
  })

  useEffect(() => {
    const build = () => {
      const seg = linesRef.current, con = contactsRef.current, bad = badgesRef.current
      if (!seg || !con || !bad) return
      const { selectedEvent: ev, tick } = useViewStore.getState()
      const reveal = spineRevealCount(tick, eventCount) // head seq (seq == tick for e0; clamps at the last event)
      const selecting = ev !== null
      const ghostOn = ghostVisible(ev, reveal) // selection AHEAD of the frontier → the NOT-YET voice; else written
      const st = rt.current

      // ── (Re)initialise static buffers on a model change: write ALL contact matrices + UNSELECTED colours
      // ONCE. Contact geometry and its unselected hue never change, so a plain tick afterwards only moves the
      // `count`. (instanceColor sizes to instanceMatrix's fixed capacity, so writing here is safe.)
      if (st.geom !== precomp) {
        for (let i = 0; i < precomp.contacts.length; i++) {
          const c = precomp.contacts[i]!
          con.setMatrixAt(i, c.mat); con.setColorAt(i, c.unsel)
        }
        con.instanceMatrix.needsUpdate = true
        if (con.instanceColor) con.instanceColor.needsUpdate = true
        st.geom = precomp
        st.conSelEv = null; st.conSelColored = 0
        st.lineMode = 'window'; st.lineSelColored = 0; st.lineReveal = 0
      }

      // Cache the bounded causal HOP MAP — rebuilt ONLY when the selected event changes, never per tick.
      // (selectedLineColor is a module-level helper — CONSTRAINT: hue = identity, chroma = hierarchy; a LINE
      // grammar, causation's surface wears the causal violet in the HOP_DECAY registers with the selected probe
      // in accent and everything beyond HORIZON_HOPS back in the ambient law. CONTACTS never take a role hue —
      // they keep their VERDICT identity and yield only chroma via CONTACT_DIM; BADGES stay neutral. Passing
      // ev + st.hop keeps the tick path closure-free: no per-tick colour allocation.)
      if (selecting && st.hopEv !== ev) { st.hop = causalNeighborhood(model, ev!, HORIZON_OPTS).hop; st.hopEv = ev }

      // ── CONTACTS — static geometry; per tick only `count`, plus a selection-edge recolour of the visible
      // prefix (rare). Under a standing unselected play the base colours already sit in the buffer → no write.
      const conCount = prefixCount(precomp.contactSeqs, reveal)
      if (selecting) {
        if (st.conSelEv !== ev) {
          for (let i = 0; i < conCount; i++) { const c = precomp.contacts[i]!; con.setColorAt(i, c.selectable && c.seq === ev ? SELECTED : c.dim) }
          st.conSelEv = ev; st.conSelColored = conCount
          if (con.instanceColor) con.instanceColor.needsUpdate = true
        } else if (conCount > st.conSelColored) {
          for (let i = st.conSelColored; i < conCount; i++) { const c = precomp.contacts[i]!; con.setColorAt(i, c.selectable && c.seq === ev ? SELECTED : c.dim) }
          st.conSelColored = conCount
          if (con.instanceColor) con.instanceColor.needsUpdate = true
        }
      } else if (st.conSelEv !== null) {
        // Deselect edge: restore every contact to its unselected verdict colour.
        for (let i = 0; i < precomp.contacts.length; i++) con.setColorAt(i, precomp.contacts[i]!.unsel)
        st.conSelEv = null; st.conSelColored = 0
        if (con.instanceColor) con.instanceColor.needsUpdate = true
      }
      con.count = conCount

      // ── LINES under a SELECTION (§§1.2 / 2 — the aggregation horizon + emphasis decay). FULL-PREFIX PACKING
      // is preserved (instance i == precomp.lines[i]) so the composite-yield's indexOfSeq write is untouched;
      // a spent BEYOND-horizon line paints to fade-0 black (invisible additive) rather than being unpacked.
      // On the SELECTION EDGE (st.lineMode !== ev) repaint the whole revealed prefix per §1.2 (rare, user-driven,
      // O(chain)). On a plain TICK advance rewrite only the trailing ambient window (bounded by LINE_FADE_TICKS
      // — the beyond-horizon lines fade; the ≤HORIZON_HOPS neighbourhood + subject are fade-EXEMPT, painted once
      // and never rewritten) PLUS any newly revealed lines: `from` = min(window start, last painted extent)
      // covers both the fading window and the append in one bounded range, and stays correct across a scrub in
      // EITHER direction. Still O(changed), never O(revealed).
      if (selecting) {
        // The paint range is the PURE reducer over (prevReveal, newReveal, prevExtent). On a SELECTION
        // EDGE (st.lineMode !== ev) the hop map is new so every role colour changes → repaint the whole prefix
        // (from 0). On a plain TICK/SCRUB under the SAME selection the reducer anchors `from` on the UNION of
        // the pre- and post-jump fade windows (min(prev,new) − LINE_FADE_TICKS), so a multi-tick FORWARD jump
        // repaints the OLD window's fade→0 lines to black instead of stranding them at stale ambient×0.3.
        const { from: tickFrom, to: lineCount } = linePaintRange(precomp.lineSeqs, st.lineReveal, reveal, st.lineSelColored)
        const from = st.lineMode !== ev ? 0 : tickFrom
        for (let i = from; i < lineCount; i++) {
          const l = precomp.lines[i]!
          seg.setMatrixAt(i, l.mat); seg.setColorAt(i, selectedLineColor(mColor, l, ev!, st.hop!, reveal))
        }
        st.lineMode = ev; st.lineSelColored = lineCount; st.lineReveal = reveal
        seg.count = lineCount
        seg.instanceMatrix.needsUpdate = true; if (seg.instanceColor) seg.instanceColor.needsUpdate = true
      } else {
        // REST / unselected — the protected grammar: the fade window behind the head, repacked from scratch
        // each tick (old rays have fade 0 and are simply not packed). ambientLineColor at yield 1 is
        // byte-identical to the pre-horizon inline math (× 1 is exact), so deselect returns the identical rest.
        const i0 = lowerIndex(precomp.lineSeqs, reveal - LINE_FADE_TICKS + 1)
        const i1 = prefixCount(precomp.lineSeqs, reveal)
        let n = 0
        for (let i = i0; i < i1; i++) {
          const l = precomp.lines[i]!
          const fade = lineFadeFactor(reveal, l.seq, LINE_FADE_TICKS)
          if (fade <= 0) continue
          seg.setMatrixAt(n, l.mat)
          seg.setColorAt(n, ambientLineColor(mColor, l.clear, l.tint, fade, 1))
          n++
        }
        seg.count = n
        st.lineMode = 'window'; st.lineSelColored = 0
        seg.instanceMatrix.needsUpdate = true; if (seg.instanceColor) seg.instanceColor.needsUpdate = true
      }

      // ── SELECTED LOS COMPONENT — un-suppress the interrogation voice. A component's own corridor
      // ray is held out of the ambient `lines` (a playback de-dup, not a "no answer" verdict); a SELECTION draws
      // it back. WRITTEN (ev ≤ reveal): the component ray pops to the accent voice in its own capacity-1 mesh,
      // and its parent composite's line YIELDS the corridor (zero-scaled — one segment, one owner; additive
      // accent over the violet composite line would wash the selection hue). GHOST (ev > reveal) is drawn by the
      // ghost line below (componentLines fallback). Its HIT contact is handled by the main contacts mesh (now
      // selectable); sibling components stay suppressed. All O(1) — no packing change, no per-frame work.
      const evComp = selecting && componentSeqs.has(ev!)
      const writtenComp = evComp && !ghostOn // ghostOn ⇔ ev > reveal, so !ghostOn under a selection ⇔ ev ≤ reveal (written)
      const scLine = selCompLineRef.current
      if (scLine) {
        const cm = writtenComp ? precomp.componentLines.get(ev!) : undefined
        if (cm) {
          scLine.setMatrixAt(0, cm); scLine.setColorAt(0, SELECTED)
          scLine.instanceMatrix.needsUpdate = true; if (scLine.instanceColor) scLine.instanceColor.needsUpdate = true
          scLine.count = 1
        } else scLine.count = 0
      }
      // ── SELECTED LOS COMPOSITE — draw only its GEOMETRICALLY-DISTINCT component corridors as
      // NEIGHBOURHOOD (ownership by distinctness). The composite's own sightline is the accent subject (the
      // line pass above painted it SELECTED); its three component rows are its nearest-3 ancestors with their
      // ambient lines suppressed. Only the components whose corridor DIFFERS from the subject segment draw
      // here (non-firstBlocker HITs) — a coincident MISS / firstBlocker corridor would stack an additive
      // instance on the subject and wash its hue (one-segment-one-owner). WRITTEN composite only (a ghost
      // previews the outline alone; a selected COMPONENT is the un-suppression case above, mutually exclusive).
      // Deselect / a non-composite / a ghost passes `undefined` → the overlay empties (rest byte-identity holds).
      const hcLine = hopCompLineRef.current
      if (hcLine) {
        const evComposite = selecting && !ghostOn && st.hop && draws[ev!]?.kind === 4 ? composites.get(ev!) : undefined
        if (evComposite) writeCompositeComponentCorridors(hcLine, evComposite, precomp.componentLines, st.hop!, reveal)
        else hcLine.count = 0
      }
      // COMPOSITE-YIELD reconciliation — meaningful only under the SELECTED role-prefix packing (instance i ==
      // precomp.lines[i]); the unselected window packing repacks from scratch, so a stale zero-scale is naturally
      // overwritten/hidden and we just drop the tracking. Idempotent per tick (the zero-scale is re-applied above
      // any packing that touched the instance); O(1).
      if (selecting) {
        let wantYield = -1
        if (writtenComp) {
          const cs = componentToComposite.get(ev!)
          if (cs !== undefined && cs <= reveal) wantYield = indexOfSeq(precomp.lineSeqs, cs)
        }
        if (st.compYieldIdx >= 0 && st.compYieldIdx !== wantYield && st.compYieldIdx < seg.count) {
          seg.setMatrixAt(st.compYieldIdx, precomp.lines[st.compYieldIdx]!.mat); seg.instanceMatrix.needsUpdate = true
        }
        if (wantYield >= 0) { seg.setMatrixAt(wantYield, ZERO_MAT); seg.instanceMatrix.needsUpdate = true }
        st.compYieldIdx = wantYield
      } else st.compYieldIdx = -1

      // TESTED-SOLID CUE (screenshot-gated): a selected component lifts the ONE solid it interrogated (its
      // `object`) one opacity step — the distinguishing content vs its siblings (same corridor, different
      // occluder). Uniform-only, restored on deselect / re-selection. load-budget-clean, zero tokens.
      const evDraw = evComp ? draws[ev!] : null
      const liftObj = evDraw && evDraw.kind === 3 ? evDraw.object : 0
      if (st.liftObj !== liftObj) {
        applyShellOpacity(sphereRef.current, 1, liftObj)
        applyShellOpacity(boxRef.current, 2, liftObj)
        applyShellOpacity(triangleRef.current, 3, liftObj)
        st.liftObj = liftObj
      }

      // ── BADGES — sparse (the tiebreak subset); packed each tick from the precomputed matrices, allocation-
      // free. A `ride` badge shows only while its line is lit (window fade, or any-time under selection).
      let bn = 0
      for (let i = 0; i < precomp.badges.length; i++) {
        const b = precomp.badges[i]!
        if (b.seq > reveal) break // seq-ascending; nothing beyond the head is revealed
        if (b.ride && !selecting && lineFadeFactor(reveal, b.seq, LINE_FADE_TICKS) <= 0) continue
        bad.setMatrixAt(bn, b.mat); bad.setColorAt(bn, BADGE); bn++
      }
      bad.count = bn
      bad.instanceMatrix.needsUpdate = true; if (bad.instanceColor) bad.instanceColor.needsUpdate = true

      // Solids MATERIALISE where touched: each body appears the tick its first probe references it, then
      // persists (the sphere from tk0, the box from its first box query, the triangle from its first).
      if (sphereRef.current) sphereRef.current.visible = reveal >= (solidReveal.get(1) ?? Infinity)
      if (boxRef.current) boxRef.current.visible = reveal >= (solidReveal.get(2) ?? Infinity)
      if (triangleRef.current) triangleRef.current.visible = reveal >= (solidReveal.get(3) ?? Infinity)
      // The drawn observer appears once act III opens (its geometry is revealed).
      if (observerRef.current) observerRef.current.visible = observer !== null && reveal >= ACT_III_START

      // ── THE NOT-YET GHOST — a selection BEYOND the written frontier (ev > reveal) previews the selected
      // probe's REAL recorded geometry as a hollow accent outline: its line and/or contact, looked up in the
      // SAME precomp the written path reads (so the ghost is byte-identical to the form that fills in). Singular
      // (capacity 1); mutually exclusive with the written form (ev > reveal here; ev <= reveal draws it written),
      // so no frame draws both. No badge, no solid materialisation, no chain fill; the camera does not move. An
      // O(1) matrix write on the ghost path — no allocation, no new tick loop, keeps the no-useFrame posture.
      const gLine = ghostLineRef.current
      if (gLine) {
        const li = ghostOn ? indexOfSeq(precomp.lineSeqs, ev!) : -1
        // A ghosted LOS component has no ambient line (suppressed) — fall back to its OWN corridor, so a MISS
        // component's ghost is the hollow corridor (not nothing), byte-identical to its written form.
        const gmat = li >= 0 ? precomp.lines[li]!.mat
          : ghostOn && componentSeqs.has(ev!) ? precomp.componentLines.get(ev!)
          : undefined
        if (gmat) { gLine.setMatrixAt(0, gmat); gLine.instanceMatrix.needsUpdate = true; gLine.count = 1 }
        else gLine.count = 0
      }
      const gCon = ghostContactRef.current
      if (gCon) {
        const ci = ghostOn ? indexOfSeq(precomp.contactSeqs, ev!) : -1
        if (ci >= 0) { gCon.setMatrixAt(0, precomp.contacts[ci]!.mat); gCon.instanceMatrix.needsUpdate = true; gCon.count = 1 }
        else gCon.count = 0
      }
    }
    build()
    // Rebuild on a tick boundary (write-as-you-play / scrub) OR a selection change (re-lens) — event rate,
    // never per frame (an event-rate store subscription; there is no useFrame in this component).
    return useViewStore.subscribe((s, prev) => { if (s.tick !== prev.tick || s.selectedEvent !== prev.selectedEvent) build() })
  }, [model, eventCount, precomp, solidReveal, observer, draws, componentSeqs, componentToComposite, composites])

  // Triangle facet geometry (bounded, double-sided) — three verts in three-space, built once per mount.
  const triGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const [a, b, c] = [t3(TRIANGLE.a), t3(TRIANGLE.b), t3(TRIANGLE.c)]
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3))
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => () => triGeo.dispose(), [triGeo])

  // Box centre + extents (three-space): NED centre (416,−128,0); spans (n64, e64, d128) → three (x64, y128, z64).
  const boxCenter = t3([(BOX.min[0] + BOX.max[0]) / 2, (BOX.min[1] + BOX.max[1]) / 2, (BOX.min[2] + BOX.max[2]) / 2])
  const boxSize: [number, number, number] = [BOX.max[0] - BOX.min[0], BOX.max[2] - BOX.min[2], BOX.max[1] - BOX.min[1]]

  return (
    <group>
      {/* Instanced lines (rays / segments / sightlines / range) — additive glow, fog-immune, no depth write
          so they composite over the scene; instanceColor bakes act-tint + head-relative fade (or the causal
          role under selection). renderOrder above the contacts so the shafts read over the solids. */}
      <instancedMesh ref={linesRef} args={[undefined, undefined, eventCount]} frustumCulled={false} renderOrder={3}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} fog={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      {/* Persistent verdict contacts — the durable constellation (~13 spots). HDR so they bloom; opaque
          (depthWrite) so they read as solid evidence dots sitting on the solids. */}
      <instancedMesh ref={contactsRef} args={[undefined, undefined, eventCount]} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[CONTACT_R, 16, 16]} />
        <meshBasicMaterial toneMapped={false} fog={false} />
      </instancedMesh>
      {/* Tiebreak badges — quiet flat rings ("the boundary decided it") in a neutral annotation token. */}
      <instancedMesh ref={badgesRef} args={[undefined, undefined, eventCount]} frustumCulled={false} renderOrder={4}>
        <torusGeometry args={[BADGE_R, 1.4, 8, 28]} />
        <meshBasicMaterial toneMapped={false} fog={false} transparent depthWrite={false} />
      </instancedMesh>

      {/* THE NOT-YET GHOST — the selected probe rendered BEYOND the written frontier (ev > reveal): a hollow,
          unbloomed accent OUTLINE of its recorded geometry (a line and/or a contact, per its written form).
          Wireframe, normal-blended, depthWrite:false, capacity 1 each; materials compile here at mount alongside
          every other stage material (no mid-session compile). The build writes the transform + count. Accent
          ×1.0 (NEVER the ×2.2 HDR); the transparent-wireframe form keeps it below the bloom threshold — its
          bloom is earned only by the FILL-IN to the written form when the playhead arrives. */}
      <instancedMesh ref={ghostLineRef} args={[undefined, undefined, 1]} frustumCulled={false} renderOrder={3}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={PALETTE.accent} wireframe transparent opacity={GHOST_OPACITY} toneMapped={false} fog={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ghostContactRef} args={[undefined, undefined, 1]} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[CONTACT_R, 16, 12]} />
        <meshBasicMaterial color={PALETTE.accent} wireframe transparent opacity={GHOST_OPACITY} toneMapped={false} fog={false} depthWrite={false} />
      </instancedMesh>

      {/* SELECTED LOS-COMPONENT corridor — a component's OWN ray, drawn WRITTEN at the accent voice
          (its ambient line is suppressed to de-dup the shared corridor; a selection un-suppresses it). Additive
          HDR like the written selected line — instanceColor = SELECTED, set by the build — capacity 1; its parent
          composite's line yields (zero-scaled) so this owns the corridor. A ghost beyond the frontier uses the
          ghost line above instead. */}
      <instancedMesh ref={selCompLineRef} args={[undefined, undefined, 1]} frustumCulled={false} renderOrder={3}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} fog={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>

      {/* SELECTED-COMPOSITE component corridors — a composite's ≤HORIZON_HOPS component probes, drawn back
          as its NEIGHBOURHOOD in the hop-decay `spine` registers (instanceColor = ROLE_BY_HOP, set by the
          build) over the SAME suppressed componentLines geometry the accent component voice uses. Same additive
          line material as the ambient/selected lines; capacity HORIZON_HOPS (a composite has exactly three
          components). Empty (count 0) whenever the selection is not a written composite. */}
      <instancedMesh ref={hopCompLineRef} args={[undefined, undefined, HORIZON_HOPS]} frustumCulled={false} renderOrder={3}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} fog={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>

      {/* Scenario SOLIDS — decoded-real world, occluder/region bodies are scenario constants (honesty chip,
          App). Translucent steel shells, fog-immune, materialised where touched (visibility driven by the
          build above). The triangle is a bounded facet — NEVER a plane. */}
      <mesh ref={sphereRef} position={t3(SPHERE.center)} visible={false} renderOrder={1}>
        <sphereGeometry args={[SPHERE.radius, 28, 20]} />
        <meshBasicMaterial color={CATEGORY.query.hue} wireframe transparent opacity={SHELL_OPACITY[0]} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>
      <mesh ref={boxRef} position={boxCenter} visible={false} renderOrder={1}>
        <boxGeometry args={boxSize} />
        <meshBasicMaterial color={CATEGORY.query.hue} wireframe transparent opacity={SHELL_OPACITY[1]} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>
      <mesh ref={triangleRef} geometry={triGeo} visible={false} renderOrder={1}>
        <meshBasicMaterial color={CATEGORY.query.hue} side={THREE.DoubleSide} transparent opacity={SHELL_OPACITY[2]} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>

      {/* Source anchors — the origin fan source (acts I/II) always present; the drawn observer (act III)
          appears with its geometry. Neutral "eye" markers (textPrimary), never a verdict hue. */}
      <mesh position={[0, 0, 0]} renderOrder={2}>
        <octahedronGeometry args={[11]} />
        <meshBasicMaterial color={MARKER} toneMapped={false} fog={false} wireframe />
      </mesh>
      {observer && (
        <mesh ref={observerRef} position={t3(observer)} visible={false} renderOrder={2}>
          <octahedronGeometry args={[14]} />
          <meshBasicMaterial color={MARKER} toneMapped={false} fog={false} />
        </mesh>
      )}
    </group>
  )
}
