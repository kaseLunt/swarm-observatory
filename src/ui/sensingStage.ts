import { SENSOR_O, R2MAX, OCCLUDER_C, OCCLUDER_R2, type Vec3 } from './sensingScenario'
import {
  validateRegistration, type LensRegistration, type PixelClass,
} from './lensContract'
import { PLATE_LEDGER_ANSWER } from './identityPlate'
import { ELIGIBLE_CONJUNCTION_INPUTS } from './sensingMath'
import { makeWitnessInputs } from './agreeSource'
import { MIN_EXTENT } from './trail'
import type { Eligibility, Detection } from '../decode/payloads'
import type { EventTick, StateFrame } from '../lib/brand'
import { buildRevealClock, type RevealClock } from '../model/revealClock'

// ── The Sensing Gauntlet — f2a kind-22 model layer ────────────────────────────────────────
// A PURE, load-path model layer that turns each decoded EligibilityEvaluated (core kind 22) payload into a
// drawable sensing verdict, and attaches the decoded target pose the engine evaluated it against. The
// decoder returns the payload (RunModel.eligibilityAt); this module lights it. Nothing here touches the
// decoder or the frame path. Semantics of record: contract/EXP-F2a-scene-and-sensing-excerpt.md (sensor
// pose / FOV cone / max range / occluder Q + the eligibility decision forms); the kind-22 payload layout is
// spec-3b §11.1 (subject, sensor, in_range, in_fov, los_clear, eligible, tiebreak_applied — all Bool).
//
// Load budget: this is a LOAD-PATH layer (buildSensingStage is the one-pass sibling of buildQueryDraws / buildTrail,
// run ONCE at model publish). Its allocations happen at publish time; the frame path reveals precomputed
// data. It files the LAW-4 declaration as DATA (F2A_REGISTRATION below), against the lensContract types —
// the FIRST conforming citizen of the provenance ledger. There is NO registry mechanism here (lookup/index
// is a later task); f2a just files the shape.

// ── The decoded sensing verdict, per kind-22 event ─────────────────────────────────────────────────────
// The four gate booleans are decoded verbatim. `g` is the decoded target pose the engine evaluated this
// tick against — the state frame the tick committed (excerpt: g = frame k+1's Entity.pos); null if the
// subject is absent from that frame (honest empty, never a fabricated position). The recompute surface
// (sensingMath) re-derives in_range / los_clear from `g` + the scenario constants and checks the conjunction.
export interface SensingDraw {
  seq: number
  tick: number
  subject: string   // "1:<id>" — the decoded namespace-1 entity key the verdict is ABOUT
  sensor: string    // "<id>" — the decoded sensor id (kind-22 sensor:U64); an APPARATUS, never an agent
  inRange: boolean
  inFov: boolean
  losClear: boolean
  eligible: boolean
  tiebreak: boolean
  g: Vec3 | null
}

// The target pose the tick-k eligibility was evaluated against is state frame (k + TARGET_FRAME_OFFSET)'s
// pos (excerpt: g = frame k+1, "the frame the tick-k step commits"). Named so the empirical oracle (all-96
// recompute-and-match, sensingMath.test.ts) pins it — a wrong offset fails there loud, not silently.
export const TARGET_FRAME_OFFSET = 1

// The state frame a transport tick paints, under a frame offset, clamped to the last vertex (lastFrame =
// the terminal state-frame index). THE ONE tick→frame map: the sensing head (sensingStageView) and the
// INTERACTIVE drone — cone / hit target / label / ring / follow+focus camera targets (Scene.Entities) —
// both call this, so the paused-tick interactive pose is byte-identical to the sensing head it must
// coincide with. A tick-k verdict is evaluated against frame k+offset (offset = TARGET_FRAME_OFFSET); the
// cone must ride THAT frame, not the pose one 2-m step behind it. Non-sensing callers pass offset 0 → the
// frame IS the tick (byte-identical to the prior Math.min(tick, tickCount)). tick ≥ 0 and offset ≥ 0, so
// the lower clamp is defensive — kept to match the sensing head's exact prior form.
export const evaluatedFrame = (tick: number, offset: number, lastFrame: number): number =>
  Math.max(0, Math.min(tick + offset, lastFrame))

// A decoded detection mark — the kind-1 measurement position (NED meters) + its signal-to-noise. Decoded
// real; rendered as a persistent contact on the stage.
export interface DetectionMark { seq: number; tick: number; pos: Vec3; snrDb: number }

// The minimal shape buildSensingStage needs — RunModel satisfies it structurally (no import cycle). entityStatesAt
// reads the STATE-FRAME domain: its parameter is StateFrame, matching RunModel's branded accessor, so a raw
// event tick — the exact historical verdict-vs-pose off-by-one — can no longer be substituted through this
// structural seam (method bivariance would have let it). The one-pass build brands its derived frame index
// (`frameTick as StateFrame`) at the call boundary below.
export interface SensingSource {
  readonly eventCount: number
  readonly tickCount: number
  readonly ticks: ArrayLike<number>
  kindAt(seq: number): number
  eligibilityAt(seq: number): Eligibility | null
  detectionAt(seq: number): Detection | null
  entityStatesAt(frame: StateFrame): ReadonlyMap<string, { pos: number[] }>
}

// Everything the stage + strip consume, built in one publish-time pass: the per-seq draws, a tick-indexed
// view (kind-22 is one-per-tick on this scene, so the strip and the Inspector read O(1) by tick), a
// FRAME-indexed view (the eligible-tinted trail + head index by the EVALUATED state frame, see byFrame),
// and the decoded detection marks.
export interface SensingStageData {
  draws: (SensingDraw | null)[]  // indexed by seq; null = not a kind-22 event
  byTick: (SensingDraw | null)[] // indexed by tick; null = no sensing verdict that tick
  // Indexed by STATE FRAME (0..tickCount). byFrame[f] = the verdict the engine EVALUATED against frame f's
  // pose (= byTick[f − TARGET_FRAME_OFFSET]; frame 0 holds no verdict, so byFrame[0] is null). The eligible-
  // tinted trail and the live head index BY FRAME so a decoded eligibility bit paints the EXACT pose it was
  // computed from — trail vertex f is state frame f's pose (buildTrail), and byFrame[f] is that pose's verdict.
  // Without this the tint lands one 2-m step BEHIND the pose it describes (the tick-k verdict's g is frame k+1).
  byFrame: (SensingDraw | null)[]
  detections: DetectionMark[]
}

function toVec3(pos: number[]): Vec3 | null {
  if (pos.length < 3) return null
  const [n, e, d] = [pos[0]!, pos[1]!, pos[2]!]
  if (!Number.isFinite(n) || !Number.isFinite(e) || !Number.isFinite(d)) return null
  return [n, e, d]
}

// One-pass build of the whole sensing model. A non-kind-22 event decodes to null → no verdict there (honest
// empty state). Load-path only. The target pose is looked up from the committed state frame; a subject
// absent from that frame yields g=null (the recompute surface then declines to recompute geometry for it,
// never fabricates a position).
export function buildSensingStage(source: SensingSource): SensingStageData {
  const draws: (SensingDraw | null)[] = new Array(source.eventCount).fill(null)
  const maxTick = source.ticks.length
  const byTick: (SensingDraw | null)[] = new Array(maxTick).fill(null)
  // Frame-indexed (0..tickCount inclusive) — trail.count is tickCount+1, so this aligns 1:1 with trail vertices.
  const byFrame: (SensingDraw | null)[] = new Array(source.tickCount + 1).fill(null)
  const detections: DetectionMark[] = []
  for (let seq = 0; seq < source.eventCount; seq++) {
    const det = source.detectionAt(seq)
    if (det !== null) {
      const pos = toVec3(det.meas)
      if (pos) detections.push({ seq, tick: source.ticks[seq]!, pos, snrDb: det.snrDb })
    }
    const e = source.eligibilityAt(seq)
    if (e === null) continue
    const tick = source.ticks[seq]!
    const subject = `1:${e.subject}`
    // g = the state frame the tick committed (excerpt: frame k+1). Clamp to the last frame so the terminal
    // tick never indexes past the trajectory (state frames are 0..tickCount inclusive).
    const frameTick = Math.min(tick + TARGET_FRAME_OFFSET, source.tickCount)
    // frameTick is a non-negative integer by construction (ticks + integer offset, clamped) — brand it at this
    // frame-domain boundary (load-path).
    const frame = source.entityStatesAt(frameTick as StateFrame)
    const st = frame.get(subject)
    const g = st ? toVec3(st.pos) : null
    const draw: SensingDraw = {
      seq, tick, subject, sensor: `${e.sensor}`,
      inRange: e.inRange, inFov: e.inFov, losClear: e.losClear, eligible: e.eligible, tiebreak: e.tiebreakApplied,
      g,
    }
    draws[seq] = draw
    if (tick >= 0 && tick < maxTick) byTick[tick] = draw
    // Index the verdict by the frame it was EVALUATED against (the same frameTick g was read from), so the
    // eligible tint lands on the exact pose the sensor decided about — not the pose one step behind it.
    if (frameTick >= 0 && frameTick < byFrame.length) byFrame[frameTick] = draw
  }
  return { draws, byTick, byFrame, detections }
}

// HAS-SENSING-EVENTS — the CONTENT half of the stage's applicability gate: does this run have any drawable
// kind-22 verdict? The four-gate strip / Inspector rail (per-event surfaces) gate on this model-layer fact;
// the stage MOUNT and the honesty CHIP route through the COMPLETE predicate below (sensingStageApplies),
// which pairs it with the positioned conjunct. Mirrors hasQueryDraws exactly. Pure; O(draws), early exit.
export const hasSensingEvents = (draws: readonly (SensingDraw | null)[]): boolean => draws.some(d => d !== null)

// ── THE SENSING REGISTER — the sensing kind-sequence as the reveal clock's first consumer ─────────────────
// The four-gate strip is a per-tick instrument, but its mount fed it a SELECTED event's verdict — so it went
// dark on free playback and stale while a tour flew. This makes it LIVE: the kind-22 verdicts ordered ascending
// by tick, plus the shared reveal clock over their ticks, so the strip can ask "which verdict has the playhead
// REACHED?" (revealedDraw) rather than "which verdict is selected?". The ordering aligns index-for-index with
// the clock's ticks, so a revealed count maps straight to a verdict. Load-path (built once per model); the
// comms strip and belief ellipse reuse the SAME clock over their own kind-sequences — a different kind-filter,
// no second clock.
export interface SensingRegister {
  ordered: SensingDraw[]   // the kind-22 verdicts, ascending by tick (index i ↔ the clock's ordinal i)
  clock: RevealClock       // the prefix-count over ordered[i].tick
}
export function sensingRegister(data: SensingStageData): SensingRegister {
  const ordered = data.draws.filter((d): d is SensingDraw => d !== null).sort((a, b) => a.tick - b.tick)
  return { ordered, clock: buildRevealClock(ordered.map(d => d.tick)) }
}

// The verdict the playhead has REACHED — the latest revealed in the register (tick ≤ playhead), or null when
// the playhead sits before the first verdict (the honest empty: no verdict yet, never a stale sticky one that
// a scrub-back left behind). Pure; O(log n) via the reveal clock, zero allocation — the live strip re-asks
// this on every playhead move. `playhead` rides the EventTick brand (the strip brands the store playhead at
// its own ingestion), so a raw StateFrame cannot be laundered in through this seam.
export function revealedDraw(reg: SensingRegister, playhead: EventTick): SensingDraw | null {
  const i = reg.clock.latestRevealedIndex(playhead)
  return i >= 0 ? reg.ordered[i]! : null
}

// ── THE COMPLETE APPLICABILITY PREDICATE (the sibling of queryStageApplies) ──────────────────────────────
// The sensing stage applies to a run iff it is POSITIONED and carries kind-22 verdicts. POSITIONED is not a
// convenience conjunct — it is the lens's evidence contract: the stage VOICE is the eligible-tinted flight
// trail, so a positionless run has no trail to tint, and mounting the apparatus there would drape scenario
// furniture (cone / range ring / occluder) over a void — the same rule that withholds the query stage from a
// run with no drawable probes. The conjunct ALSO makes the two stage lenses mutually exclusive BY
// CONSTRUCTION: queryStageApplies requires positionless, this requires positioned — so a decoded run carrying
// BOTH kind-22 and kind-23 events (no certified bundle does, but nothing rejects one) can never mount two
// stages in one scene. That matters because the two stages draw in DIFFERENT bases (the sensing apparatus in
// the shared basis A [e,−d,n]; the self-contained query stage in basis B [n,−d,e]): a double mount would put
// mixed bases on one canvas and split the bounds/framing selection between them. Every consumer that mounts
// a stage or selects stage bounds/framing (Scene's mounts, activeStageBounds and the Entities/CameraRig
// threading, App's honesty chip) routes through THIS predicate, so no site can arbitrate differently; its
// NAME is what the registration pins as mountGate. The `&&` short-circuit keeps the positionless load path
// from paying buildSensingStage at all.
export interface SensingStageSource extends SensingSource {
  entityKeys(): readonly string[]
}

// ── THE SENSING SUBJECT — the entity the kind-22 verdicts are ABOUT ─────────────────────────────────
// Each kind-22 verdict NAMES a subject (SensingDraw.subject = "1:<id>", decoded from the payload's subject:U64 —
// spec-3b §11.1). The eligible-tinted stage tints THAT entity's flight, so the stage's applicability must resolve
// against the subject the verdicts name — NOT entityKeys()[0], which on a multi-entity run is a DIFFERENT entity
// (tinting it with the subject's eligibility is the wrong-entity defect). Returns the single subject, or null when
// there are no verdicts, or when the verdicts name MORE THAN ONE distinct subject (a single-trail stage cannot
// honestly tint two flights — withhold rather than tint the wrong one). Every certified bundle is single-subject
// (f2a: all verdicts name '1:0' === entityKeys()[0]), so today this is exactly entityKeys()[0].
export function sensingSubject(draws: readonly (SensingDraw | null)[]): string | null {
  let subject: string | null = null
  for (const d of draws) {
    if (d === null) continue
    if (subject === null) subject = d.subject
    else if (subject !== d.subject) return null // multi-subject — no single trail to tint; withhold
  }
  return subject
}

// ── THE SENSING-RUN CONSUMER REFERENCE (the subject key AND its instance index, resolved ONCE) ─────────
// The sensing-subject fix corrected the STAGE mesh (sensingTrail tints the kind-22 subject's flight), but Scene.Entities still consumed
// entityKeys()[0]'s trail/bounds and tracked instance index 0 — so on a run whose subject is NOT the first entity
// (a first entity 1:0 with kind-22 verdicts naming 1:7), the establishing frame, the arrival fit, the follow bias
// and the i===0 tracking ring all followed 1:0 while the eligibility trail followed 1:7: camera + highlight on a
// DIFFERENT entity than the evidence concerns. This resolves the subject once for EVERY sensing-run consumer —
// the subject KEY (which flight to trail/bound) and its INDEX in entityKeys() (which instanced cone the tracking /
// finale ring / head tint name). null when the stage does not apply (no kind-22 verdicts, a multi-subject scene,
// or a subject absent from the key list); Scene then threads the non-sensing defaults (entityKeys()[0]'s
// trail/bounds, index 0), byte-identical to the prior behavior. Every certified bundle is single-subject with the subject at
// index 0, so this returns { key: entityKeys()[0], index: 0 } there — no real behavior moves; the latent
// multi-subject incoherence is what closes.
export interface SensingSubjectRef { key: string; index: number }
export function sensingSubjectRef(
  entityKeys: readonly string[], draws: readonly (SensingDraw | null)[],
): SensingSubjectRef | null {
  const key = sensingSubject(draws)
  if (key === null) return null
  const index = entityKeys.indexOf(key)
  return index < 0 ? null : { key, index }
}

// Does the sensing SUBJECT have a REAL, non-static flight to tint? Walks the subject's decoded poses and applies
// the SAME emptiness bar buildTrail uses (MIN_EXTENT on the bbox diagonal): a subject absent from every frame, or
// positioned-but-STATIC (an f0-like point), yields an EMPTY trail buffer — so the tinted stage would read NaN over
// nothing and the honesty chip would claim decoded-real flight over a void. The bbox diagonal is a
// permutation/sign-flip invariant, so measuring it on the NED pose equals buildTrail's three-space extent exactly.
function subjectHasFlight(model: SensingSource, subject: string): boolean {
  let seen = false
  let minN = Infinity, minE = Infinity, minD = Infinity, maxN = -Infinity, maxE = -Infinity, maxD = -Infinity
  const n = model.tickCount + 1
  for (let t = 0; t < n; t++) {
    // Load-path walk (the applicability gate, at model publish); brand the integer counter at the boundary.
    const st = model.entityStatesAt(t as StateFrame).get(subject)
    if (!st) continue
    const p = st.pos
    if (p.length < 3 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue
    seen = true
    if (p[0]! < minN) minN = p[0]!; if (p[0]! > maxN) maxN = p[0]!
    if (p[1]! < minE) minE = p[1]!; if (p[1]! > maxE) maxE = p[1]!
    if (p[2]! < minD) minD = p[2]!; if (p[2]! > maxD) maxD = p[2]!
  }
  return seen && Math.hypot(maxN - minN, maxE - minE, maxD - minD) >= MIN_EXTENT
}

// The sensing stage applies iff the kind-22 verdicts name ONE subject AND that subject has a real flight to tint
// This REPLACES the old `entityKeys().length > 0 && hasSensingEvents(draws)`: that gate was true for a
// positioned-but-static run (an empty trail buffer → NaN reads) and, on a multi-entity run, said nothing about
// WHICH entity the verdicts were about (the tint landed on [0] regardless). Resolving against the sensing subject
// closes both. The view (Scene) builds the SAME subject's trail (buildTrail(model, sensingSubject(...))), so the
// gate and the tinted geometry agree on which flight the stage is about.
export function sensingStageApplies(model: SensingStageSource): boolean {
  const draws = buildSensingStage(model).draws
  // Admission REQUIRES the subject to RESOLVE against the RENDERED key set (entityKeys(), the first-populated-
  // frame entities Scene instances a cone per). sensingSubjectRef returns null for (no kind-22 verdicts / a multi-
  // subject scene / a subject ABSENT from entityKeys()). That last case is the late-spawn hole: a subject that
  // first appears AFTER the initial frame has a real flight (subjectHasFlight walks EVERY frame) yet is not in
  // entityKeys(), so Scene's `sensingSubjectRef(...)?.key` would be null and its optional-chaining would fall back
  // to buildTrail(undefined) === entityKeys()[0]'s trail at subjectIndex 0 — tinting/following the WRONG entity
  // while hasSensing stayed true. Folding the ref resolution into the gate FAILS CLOSED: hasSensing is false
  // exactly when the subject can't be coherently tinted, and Scene (which resolves the SAME ref) then never reaches
  // the default-trail fallback after admission.
  const ref = sensingSubjectRef(model.entityKeys(), draws)
  if (ref === null) return false
  return subjectHasFlight(model, ref.key)
}

// ── LOS clearance geometry the recompute needs the occluder for (re-exported for the tour/framing) ──────
export const OCCLUDER = { center: OCCLUDER_C, r2: OCCLUDER_R2 } as const
export const SENSOR = { origin: SENSOR_O, r2max: R2MAX } as const

// ── THE LAW-4 DECLARATION, AS DATA — f2a is the FIRST conforming citizen of the provenance ledger ───────
// This is the query stage's prose declaration graduated to a typed const (lensContract.LensRegistration) —
// question / surface split / borrowed hues (LAW 2) / what it dims / honest empty state / the honesty chip /
// the tour / the ONE mount gate / and the six-tier provenance ledger classifying every pixel-class the lens
// paints by HOW IT KNOWS. The ledger is the worked example the standing rule exists to produce; a later task
// lifts the query stage into the same shape and extracts the lookup mechanism.
const SRC = 'contract/EXP-F2a-scene-and-sensing-excerpt.md'
const STATE = 'contract/spec-3b-evidence-layer.md §11.2 (Entity state frames; excerpt: g = frame k+1 pos)'
const K22 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-22 EligibilityEvaluated)'

const LEDGER: readonly PixelClass[] = [
  { id: 'trail-pose', tier: 'decoded', source: STATE,
    answer: 'the drone flight is decoded-real — each trail vertex is the state-frame pose the engine committed that tick' },
  { id: 'eligible-tint', tier: 'decoded', source: K22,
    answer: 'the trail tint is the decoded eligibility boolean per tick — affirm where the sensor admits the drone, ember where it does not' },
  { id: 'gate-lanes', tier: 'decoded', source: K22,
    answer: 'each of the four gate lanes is the decoded boolean the engine recorded this tick (in_range / in_fov / los_clear / eligible)' },
  { id: 'in-range-recompute', tier: 'recomputed', source: `${SRC} (in_range: d² ≤ r²max)`,
    answer: 'in-range re-derived in-browser — squared distance from the sensor vs the squared max range — compared live to the engine bit',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('sensing:pose'), form: 'form:in-range' } },
  { id: 'los-clear-recompute', tier: 'recomputed', source: `${SRC} (LOS: sensor→target segment vs occluder Q, discriminant form)`,
    answer: 'line-of-sight re-derived in-browser — the sensor→drone segment tested against the occluder sphere — compared live to the engine bit',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs('sensing:pose'), form: 'form:los-clear' } },
  // THE FLAGSHIP (made a type). The live conjunction ANDs the two LIVE legs (in_range, los_clear —
  // re-derived from the decoded pose) with the in_fov leg carried as the DECODED CLAIM, checked against the
  // engine's eligible bit. The arm is MINTED (makeWitnessInputs — copied, frozen, validated) FROM sensingMath's
  // OWN exported ELIGIBLE_CONJUNCTION_INPUTS, which is ALSO the executor capability's form:eligible-conjunction
  // tuple; the per-form boot guard set-compares the two, so the declaration and the real recompute cannot drift.
  // The engine's eligible bit is a comparand, un-nameable here — the echo cannot compile OR construct.
  { id: 'eligible-conjunction', tier: 'recomputed', source: `${SRC} (eligible = in_range ∧ in_fov ∧ los_clear)`,
    answer: 'eligibility re-derived as the AND of the LIVE-recomputed in_range and los_clear (from the decoded pose) with the decoded in_fov claim, checked against the engine eligible bit — a genuine re-derivation on two of three legs, not an echo of the engine\'s own component bits',
    agree: { basis: 'live-inputs', inputs: makeWitnessInputs(...ELIGIBLE_CONJUNCTION_INPUTS), form: 'form:eligible-conjunction' } },
  { id: 'in-fov-claim', tier: 'pinned-bits', source: `${SRC} (in_FOV: |wrap(bearing−ψs)| ≤ half_fov; half_fov = vendored-libm atan2 bits)`,
    answer: 'in-FOV is shown in the claim voice — its threshold is a pinned vendored-libm angle and kind-22 stores no bearing scalar to recompute, so it is never a live check' },
  { id: 'tiebreak-badge', tier: 'decoded', source: `${K22} (tiebreak_applied, D-017 ties-reported)`,
    answer: 'a tiebreak badge marks a tick the engine flagged as decided exactly at a boundary' },
  { id: 'sensor-pose-cone', tier: 'scenario-constant', source: `${SRC} (O, ψs=0, half_fov, r²max)`,
    answer: 'the sensor pose, its field-of-view cone and its range ring are scenario constants — declared, not decoded' },
  { id: 'occluder-body', tier: 'scenario-constant', source: `${SRC} (occluder Q: C=(41,41,0), r²=41)`,
    answer: 'the occluder sphere is a scenario constant' },
  { id: 'detection-mark', tier: 'decoded', source: 'contract/spec-3b-evidence-layer.md §11.1 (kind-1 DetectionMade)',
    answer: 'each detection mark is a decoded kind-1 measurement in NED meters' },
  { id: 'not-yet-ghost', tier: 'decoded', source: STATE,
    answer: 'a pose beyond the playhead is the real recorded flight rendered in the NOT-YET voice (hollow, never blooming), filling in when the playhead writes it (constitution §4)' },
  { id: 'identity-plate', tier: 'presentational', source: null, answer: PLATE_LEDGER_ANSWER },
  { id: 'presentational', tier: 'presentational', source: null,
    answer: 'camera moves, fades, the grid and the fog encode no data' },
]

// The honesty chip — DERIVED from the ledger, test-pinned against it (chipAgreesWithLedger): it names
// scenario constants iff the ledger has scenario-constant classes, and claims decoded-real iff the ledger
// has decoded classes. One source of honesty per lens; the chip is its projection, not a second author.
// Wording is owner-tweakable; the honesty CONTENT is fixed by the ledger.
//   Naming choice: the chip now names the DETECTIONS alongside flight & eligibility — the ledger's third
// decoded-real class (detection-mark, tier `decoded`) had no sighted surface, so a cold viewer met the marks
// as an unnamed bright pile. This is the "give the ledger sentence a surface" fix on the stage's own prose
// voice (no new chrome): honest (detections ARE decoded-real) and still names the constants, so it clears
// chipAgreesWithLedger unchanged. The SHRINK + GRADE above stop the marks shouting; this names what they are.
export const SENSING_HONESTY =
  'flight, eligibility & detections decoded-real — sensor pose, FOV and occluder are scenario constants'

export const F2A_REGISTRATION: LensRegistration = validateRegistration({
  id: 'f2a-sensing',
  question: {
    primary: 'What does the sensor admit? (Q4/Q1-adjacent — what was decided about whom, in real NED space)',
    adjacent: ['Q1 where/when is the drone', 'Q5 can I trust this pixel (the two-voice recompute + the ledger)'],
  },
  surfaces: { stage: 'SensingStage', instrument: 'SensingStrip' },
  // LAW 2 — borrowed token NAMES only (compile-time membership via BorrowedHue): the eligibility tint reuses
  // the verdict pair; the gate recompute marks reuse the integrity ✓/✗ pair; selection is accent; ambient
  // sensor/occluder geometry wears the query category steel; quiet annotations wear textDim.
  borrowedHues: ['verdictAffirm', 'verdictNegate', 'verified', 'mismatch', 'accent', 'textDim', 'category:query'],
  dims: 'one verdict at full voice — the live tick; spent trail fades behind the head; selection re-lenses the rest to the supporting register',
  emptyState: 'a run with no kind-22 events mounts no sensing stage, wears no chip, and shows the honest empty rail (inherited registry behavior, not per-lens improvisation); a positionless run mounts none either — there is no flight trail to tint, so the apparatus would dress a void (the shared sensingStageApplies gate: positioned AND kind-22 verdicts)',
  honestyChip: SENSING_HONESTY,
  tourId: 'f2a-sensing',
  mountGate: sensingStageApplies.name,
  provenance: LEDGER,
})
