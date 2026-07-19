import { validateRegistration, type LensRegistration, type PixelClass } from './lensContract'
import { posEllipse, type PosEllipse } from './covEllipse'
import { resolveCursor, type FrameOffset } from './cursor'
import type { TrackConfirmed, TrackUpdated, TrackDropped } from '../decode/payloads'
import { asEventTick, asStateFrame, type EventTick, type StateFrame } from '../lib/brand'
import { buildRevealClock, type RevealClock } from '../model/revealClock'

// ── THE BELIEF LENS — the f3a track-belief model layer over kinds 2/3/4 ──────────────────────────────────────
// A PURE, load-path model layer (the sibling of buildCommsStage / buildSensingStage / buildQueryDraws, run ONCE at
// model publish) that turns the decoded TrackConfirmed / TrackUpdated / TrackDropped payloads into the belief
// lens's evidence: the tracker's OWN reported position uncertainty rendered as a shrinking DISC around its decoded
// mean, following the playhead — AND, because f3a carries the real flying subject, the ACTUAL error of that belief.
// The decoders live in payloads.ts; RunModel exposes trackUpdatedAt / …ConfirmedAt / …DroppedAt and entityStatesAt;
// the eigendecomposition of the position covariance submatrix lives in the pure covEllipse leaf.
//
// THE DECODE OF RECORD (pinned against the frozen f3a_seed42 bundle in messageTrack.oracle.test.ts + the tests here):
// 1 TrackConfirmed (track 1, about subject 0) / 78 TrackUpdated (ticks 2..79) / 1 TrackDropped (reason TIMEOUT=1);
// the position covariance submatrix is ISOTROPIC (off-diagonals 0, equal diagonal) at every tick, so the belief is an
// honest DISC, never a tilted ellipse; the reported 1σ shrinks 1.83 m → 0.44 m as the filter gains confidence.
//
// A REAL BELIEF-vs-REALITY COMPARISON, RESOLVED DELIBERATELY (not a disclaimed coincidence). The ring sits at the
// DECODED MEAN (the tracker's estimate); the drone flies the DECODED STATE TRUTH; the offset between them is the
// tracker's ACTUAL error — both halves decoded, so the gap is honest data, not a rendering artifact to hide behind a
// disclaimer. The comparison is claimed, so the A3 event-tick-vs-state-frame question is LIVE and answered ON PURPOSE:
// the track update committed at EVENT tick t estimates the subject's position at tick t, so it is compared against the
// STATE FRAME t pose (offset 0 — posterior-estimate-vs-same-tick-truth, the principled pairing). The pose is read
// through resolveCursor / the branded StateFrame accessor (offset 0 is the SAME frame Scene.Entities renders the drone
// at on a non-sensing run), so the raw event tick can never launder in as a state read — the seam the arch consult
// said the brands carry, now resolved rather than avoided. (Offset 1 fits some ticks better numerically — a leading
// filter bias — but the leading bias IS part of the error; the posterior-vs-same-tick pairing is the one that is
// well-defined.) On f3a the story the gap tells: the reported 1σ tightens to 0.44 m while the actual error grows to
// ~2.43 m — the truth ends ~5σ OUTSIDE the disc, the tracker overconfident, and the track TIMES OUT. That is the
// lens's honest name. (The innovation ν in TrackUpdated is the measurement residual, a DIFFERENT and larger quantity
// than the estimate error — |ν| ≈ 5 m vs a ~1.5 m gap — so the gap is NOT cross-pinned against ν; a false equality
// would be the dishonesty this whole change removes.) No BeliefUpdated (kind 8) bytes exist in any run, so the
// belief-SPARKLINE half stays deferred; this lens claims covariance-from-track-updates + the decoded error, nothing more.
//
// THE GRAMMAR (the brand-protecting rule): the disc/1σ AND the gap are DERIVED-DISPLAY — derivations of decoded values
// with NO external oracle to compare against — so they wear NO verdict glyph (never ○, never ✓; the derivation
// declares itself in words). The mean, the reality pose, and the lifecycle are decoded FACTS shown plain. No new
// glyphs, no new hues — the lens borrows the mutating category token (track kinds ARE the mutating category, theme).

// The position submatrix dimension for f3a's [px,py,vx,vy] state: the cov is a 4×4 row-major matrix, and the
// position marginal is its top-left 2×2 (flat indices {0,1,4,5}). Named here so a re-vendor that changes the state
// width moves the dim WITH the decode, never a hardcoded 4 at a downstream surface.
export const POS_DIM = 4

// THE BELIEF-vs-REALITY PAIRING OFFSET — the track update at event tick t estimates the subject's position AT tick t,
// so its comparand is the STATE FRAME t pose (offset 0: posterior-estimate-vs-same-tick-truth). This is ALSO the frame
// Scene.Entities renders the drone at on a non-sensing run (poseFrameOffset 0), so the numeric gap the strip states
// equals the gap the viewer sees. Typed FrameOffset so resolveCursor accepts it; the brand makes a raw event tick a
// compile error at the entityStatesAt seam. (Not TARGET_FRAME_OFFSET — that is the SENSING off-by-one, a different lens.)
export const POS_FRAME_OFFSET: FrameOffset = 0

// ── A decoded track update, tick-tagged, with its DERIVED contour AND its decoded-vs-decoded error ─────────────
// `ellipse` is the DERIVED-DISPLAY disc/ellipse of the decoded position covariance, or null when that submatrix is
// malformed (non-symmetric / non-PSD / non-finite — covEllipse fails closed rather than mint a NaN ring). meanN/meanE
// are the decoded mean position (mean[0]=north, mean[1]=east, NED metres) — the ring's CENTRE (the estimate). truthN/
// truthE are the tracked subject's DECODED STATE pose at the paired frame (reality), or null if unavailable; gap is the
// distance between them — the tracker's ACTUAL error (both halves decoded), or null when either half is missing.
export interface TrackSample {
  seq: number
  tick: number
  meanN: number
  meanE: number
  ellipse: PosEllipse | null
  truthN: number | null
  truthE: number | null
  gap: number | null
}

// A sample is VALID iff its covariance decoded to a real contour AND its mean is finite (a ring cannot be placed at
// a NaN position). The definitive disc renders only over valid samples; a single invalid sample fails the lens closed.
export const sampleValid = (s: TrackSample): boolean =>
  s.ellipse !== null && Number.isFinite(s.meanN) && Number.isFinite(s.meanE)

// ── Everything the stage + strip consume, built in one publish-time pass ────────────────────────────────────
export interface TrackBeliefData {
  samples: TrackSample[]     // decoded kind-3 TrackUpdated, ascending by tick (index i ↔ the clock's ordinal i)
  clock: RevealClock         // the reveal clock over samples[i].tick — the disc follows the playhead through THIS
  track: bigint | null       // the single track id iff EVERY track event agrees (one track); null on zero / multi-track
  subject: bigint | null     // the tracked subject id from TrackConfirmed (the entity the belief is ABOUT), or null
  subjectKey: string | null  // "1:<subject>" — the entity key the reality pose is read from, or null (no subject)
  confirmedTick: number | null
  dropped: { tick: number; reason: number } | null // TrackDropped (reason enum; f3a TIMEOUT=1)
  malformedCount: number     // samples whose position cov / mean failed validity — the fail-closed disclosure count
  allDiscs: boolean          // every VALID sample is isotropic (a disc) — the copy may say "disc" only then
  // whole-run 1σ endpoints (decoded-derived, the eigen-semi-axis), for the run-scoped chip. null when no valid sample.
  sigmaFirst: number | null  // the FIRST (earliest tick) valid sample's 1σ — the widest belief
  sigmaLast: number | null   // the LAST valid sample's 1σ — the tightest
  // THE BELIEF-vs-REALITY HALF — available iff a subject resolved AND at least one valid sample has a decoded truth pose.
  hasReality: boolean
  gapFirst: number | null    // the tracker's actual error at the first valid sample (whole-run)
  gapLast: number | null     // …at the last valid sample
  truthEndsOutsideSigma: boolean // at the last valid sample the truth lies OUTSIDE the reported 1σ disc (gap > σ) — overconfidence
  // THE RENDERABLE GATE — a SINGLE track AND every sample valid. The definitive disc + the stated 1σ render only when
  // renderable; a multi-track run or any malformed covariance fails the lens closed to counts + a disclosure (the comms
  // precedent — "definitive visuals require consistent data"). Multi-track's per-track discs are the deferred instanced-N path.
  renderable: boolean
}

// The minimal shape buildTrackBelief needs — RunModel satisfies it structurally (no import cycle). The three track
// accessors return the decoded payloads; entityStatesAt reads the STATE-FRAME domain (the reality pose — its parameter
// is StateFrame, so a raw event tick cannot substitute); entityKeys() is the positioned gate; kindAt arbitrates against sensing.
export interface TrackBeliefSource {
  readonly eventCount: number
  readonly tickCount: number
  readonly ticks: ArrayLike<number>
  kindAt(seq: number): number
  entityKeys(): readonly string[]
  entityStatesAt(frame: StateFrame): ReadonlyMap<string, { pos: number[] }>
  trackConfirmedAt(seq: number): TrackConfirmed | null
  trackUpdatedAt(seq: number): TrackUpdated | null
  trackDroppedAt(seq: number): TrackDropped | null
}

// One-pass build of the whole belief model. A run with no track events yields empty samples (honest empty state).
// Load-path only; every allocation is at publish, the reveal clock answers O(log n) thereafter.
export function buildTrackBelief(source: TrackBeliefSource): TrackBeliefData {
  const samples: TrackSample[] = []
  let track: bigint | null = null
  let multiTrack = false
  let subject: bigint | null = null
  let confirmedTick: number | null = null
  let dropped: { tick: number; reason: number } | null = null
  // The single-track guard: the FIRST track id any event names is the track; a DIFFERENT id later is multi-track
  // (the definitive single disc is then withheld — the multi-track instanced path is deferred).
  const noteTrack = (id: bigint): void => {
    if (track === null) track = id
    else if (track !== id) multiTrack = true
  }
  for (let seq = 0; seq < source.eventCount; seq++) {
    const conf = source.trackConfirmedAt(seq)
    if (conf !== null) { confirmedTick = source.ticks[seq]!; subject = conf.subject; noteTrack(conf.track); continue }
    const drop = source.trackDroppedAt(seq)
    if (drop !== null) { dropped = { tick: source.ticks[seq]!, reason: drop.reason }; noteTrack(drop.track); continue }
    const upd = source.trackUpdatedAt(seq)
    if (upd === null) continue
    noteTrack(upd.track)
    samples.push({
      seq, tick: source.ticks[seq]!,
      meanN: upd.mean[0] ?? NaN, meanE: upd.mean[1] ?? NaN,
      // DECODE-TRUE: the contour is derived from the decoded cov VERBATIM (position marginal only), never a re-fit.
      ellipse: posEllipse(upd.cov, POS_DIM),
      truthN: null, truthE: null, gap: null, // the reality half is attached in the second pass below
    })
  }
  samples.sort((a, b) => a.tick - b.tick)

  // ── THE REALITY HALF — the decoded state truth + the actual error, resolved through the BRANDED accessor ──────
  // For each sample, read the tracked subject's committed pose at the paired STATE FRAME (offset 0, via resolveCursor —
  // the SAME frame Scene renders the drone at), and derive the gap = |mean − truth|. The frame is a branded StateFrame,
  // so a raw event tick is a compile error here (the A3 seam). Absent only when no subject is named (a hypothetical run)
  // or the pose is missing at that frame — then the reality half is honestly withheld (hasReality false), not fabricated.
  const subjectKey = subject !== null ? `1:${subject}` : null
  if (subjectKey !== null) {
    const lastFrame = asStateFrame(source.tickCount)
    for (const s of samples) {
      const frame = resolveCursor(asEventTick(s.tick), POS_FRAME_OFFSET, lastFrame).t0
      const pos = source.entityStatesAt(frame).get(subjectKey)?.pos
      if (pos && pos.length >= 2 && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
        s.truthN = pos[0]!
        s.truthE = pos[1]!
        if (sampleValid(s)) s.gap = Math.hypot(s.meanN - pos[0]!, s.meanE - pos[1]!)
      }
    }
  }

  const clock = buildRevealClock(samples.map(s => s.tick))
  const valid = samples.filter(sampleValid)
  const malformedCount = samples.length - valid.length
  const allDiscs = valid.length > 0 && valid.every(s => s.ellipse!.isDisc)
  const sigmaFirst = valid.length ? valid[0]!.ellipse!.semiMajor : null
  const sigmaLast = valid.length ? valid.at(-1)!.ellipse!.semiMajor : null
  // The reality half's whole-run endpoints — first/last VALID sample that also has a decoded truth pose.
  const withGap = valid.filter(s => s.gap !== null)
  const hasReality = subjectKey !== null && withGap.length > 0
  const gapFirst = withGap.length ? withGap[0]!.gap : null
  const gapLast = withGap.length ? withGap.at(-1)!.gap : null
  const truthEndsOutsideSigma = gapLast !== null && sigmaLast !== null && gapLast > sigmaLast
  // THE SINGLE-TRACK id — the track iff EVERY track event agrees on it (the comms `link` precedent: null when the
  // sends disagree). Null on zero OR multi-track, so a downstream `track === null` (with content) IS the multi-track case.
  const singleTrackId = track !== null && !multiTrack ? track : null
  const renderable = singleTrackId !== null && samples.length > 0 && malformedCount === 0
  return {
    samples, clock, track: singleTrackId, subject, subjectKey, confirmedTick, dropped, malformedCount, allDiscs,
    sigmaFirst, sigmaLast, hasReality, gapFirst, gapLast, truthEndsOutsideSigma, renderable,
  }
}

// HAS-TRACK-CONTENT — the CONTENT half of the applicability gate: ANY decoded TrackUpdated present. A run with track
// content but a malformed covariance still MOUNTS so its disclosure appears (the ledger fails closed, no disc renders),
// exactly as the comms lens mounts on an internally-anomalous run. Pure.
export const hasTrackContent = (data: TrackBeliefData): boolean => data.samples.length > 0

// ── THE CURRENT DISC — the sample the playhead has REVEALED (the reveal clock's latest), or null before the first ─
// Keyed on the reveal clock: before the first update's tick → null (the NOT-YET voice — no disc yet, never a stale
// sticky one a scrub-back left behind); at/after → the latest revealed sample. A scrub back reduces the ordinal, so
// the disc GROWS BACK (an earlier update is wider) — the reveal discipline, pure in both directions. `playhead` rides
// the EventTick brand (the surface brands the store playhead at its own ingestion), so a raw StateFrame cannot launder in.
export function currentSample(data: TrackBeliefData, playhead: EventTick): TrackSample | null {
  const i = data.clock.latestRevealedIndex(playhead)
  return i >= 0 ? data.samples[i]! : null
}

// The CURRENT 1σ (metres) the playhead has revealed — the eigen-semi-axis of the current sample's decoded covariance —
// or null before the first update (NOT-YET) or when that sample is invalid. Playhead-scoped; the strip re-asks on every move.
export function sigmaAt(data: TrackBeliefData, playhead: EventTick): number | null {
  const s = currentSample(data, playhead)
  return s && sampleValid(s) ? s.ellipse!.semiMajor : null
}

// The CURRENT actual error (metres) the playhead has revealed — the decoded gap between the estimate and the state
// truth at the current sample — or null before the first update or when the reality half is unavailable. Playhead-scoped.
export function errorAt(data: TrackBeliefData, playhead: EventTick): number | null {
  const s = currentSample(data, playhead)
  return s ? s.gap : null
}

// How many track updates the playhead has revealed so far — a prefix count of the reveal clock. Playhead-scoped ledger.
export const revealedUpdateCount = (data: TrackBeliefData, playhead: EventTick): number => data.clock.revealedCount(playhead)

// ── THE FAIL-CLOSED DISCLOSURE MODE — the ONE phrase the strip / chip degrade to on a non-renderable run ─────────
// Precedence by severity: a multi-track run cannot render ONE disc ('multiple tracks'); else a malformed covariance
// makes the disc untrustworthy ('malformed covariance'). The two surfaces share this so their words never diverge.
export type TrackDisclosureMode = 'multiple tracks' | 'malformed covariance'
export function trackDisclosureMode(data: TrackBeliefData): TrackDisclosureMode {
  // Reached only on a non-renderable run that HAS track content (samples > 0), so track === null ⟺ multi-track
  // (every sample named a track id; disagreement nulled it). Otherwise the covariance was malformed. Multi-track wins.
  return data.track === null ? 'multiple tracks' : 'malformed covariance'
}

// ── THE DATA-DRIVEN CHIP COPY — every claim EARNED from the decoded content, gated on the renderable state ───────
// The static honesty chip (TRACK_BELIEF_HONESTY) states only the always-true claim; the run-specific summary is
// DERIVED here so it can never over-claim on other data. SCOPE-LABELLED: the chip is RUN-scoped (it never scrubs), so
// every branch names "whole run". When the reality half is present the copy names BOTH halves + the actual-error growth
// (the comparison earned honestly); otherwise it states the belief-only shrink. On a non-renderable run it degrades to
// the counts + the failure mode, never a shrink / disc / error claim it cannot back.
export function trackBeliefChipCopy(data: TrackBeliefData): string {
  const scope = 'whole run'
  const updates = data.samples.length
  if (!data.renderable) {
    const mode = trackDisclosureMode(data)
    const parts = [`${updates} track update${updates === 1 ? '' : 's'}`]
    if (data.malformedCount > 0) parts.push(`${data.malformedCount} covariance${data.malformedCount === 1 ? '' : 's'} malformed`)
    return `${scope}: ${parts.join(' · ')} — ${mode}, so no definitive disc`
  }
  const shape = data.allDiscs ? 'disc' : 'ellipse'
  const shapeNote = data.allDiscs ? ' (isotropic)' : ''
  const from = data.sigmaFirst!.toFixed(2), to = data.sigmaLast!.toFixed(2)
  if (data.hasReality && data.gapFirst !== null && data.gapLast !== null) {
    const gFrom = data.gapFirst.toFixed(2), gTo = data.gapLast.toFixed(2)
    const escaped = data.truthEndsOutsideSigma
      ? `the truth leaves the disc (≈${(data.gapLast / data.sigmaLast!).toFixed(1)}σ out — overconfident)`
      : 'the truth stays within the disc'
    const timeout = data.dropped?.reason === 1 ? '; the track times out' : ''
    return `${scope}: the ring is the tracker's estimate, the drone the decoded state truth; the reported 1σ ${shape} tightens ${from} m → ${to} m${shapeNote} while the actual error grows ${gFrom} m → ${gTo} m — ${escaped}${timeout}. Both halves decoded`
  }
  return `${scope}: the tracker's 1σ ${shape} tightens ${from} m → ${to} m${shapeNote} across ${updates} updates — its own reported uncertainty, decoded (no reality overlay on this run)`
}

// ── THE COMPLETE APPLICABILITY PREDICATE (the sibling of queryStageApplies / sensingStageApplies / commsStageApplies) ─
// The belief lens applies to a run iff it is POSITIONED (a track is the tracker's belief ABOUT a scene entity — the
// disc rides in that entity's world, and the reality pose the error is measured against IS that entity; with no entity
// partition there is no subject to believe about and none to compare against) AND it carries track updates AND it has
// NO kind-22 verdicts. The positioned conjunct is the SAME arbitration axis the sensing/query split uses — it makes the
// belief lens mutually exclusive with the two POSITIONLESS lenses (query, comms) BY CONSTRUCTION. The no-kind-22
// conjunct YIELDS to the sensing gauntlet (both are positioned lenses), exactly as commsStageApplies yields to the
// query stage via its no-kind-23 conjunct — the newer lens defers. No certified bundle mixes track updates with
// kind-22 (f3a has tracks + no kind-22; f2a has kind-22 + no tracks), so today this is exactly f3a mounting and nothing
// else. This is the ONE predicate the stage MOUNT (Scene), the honesty CHIP (App), and the Inspector strip all route
// through; its NAME is what the registration pins as mountGate.
const ELIGIBILITY_EVALUATED = 22
const TRACK_UPDATED_KIND = 3 // kind-3 TrackUpdated — the disc's source (payloads.TRACK_UPDATED; inlined to keep the leaf light)
function hasKind(source: TrackBeliefSource, kind: number): boolean {
  for (let seq = 0; seq < source.eventCount; seq++) if (source.kindAt(seq) === kind) return true
  return false
}
export function trackBeliefApplies(source: TrackBeliefSource): boolean {
  if (source.entityKeys().length === 0) return false          // POSITIONED — the disc rides in the tracked entity's world
  if (hasKind(source, ELIGIBILITY_EVALUATED)) return false    // yield to the sensing gauntlet (both are positioned lenses)
  // CHEAP kindAt short-circuit BEFORE the decode build (the commsStageApplies idiom: gate on the cheap facts, decode
  // last): a run with no kind-3 TrackUpdated cannot be a belief run, so it never pays buildTrackBelief — and a minimal
  // model mock lacking the track accessors is never asked to decode. Only a run that genuinely carries updates builds.
  if (!hasKind(source, TRACK_UPDATED_KIND)) return false
  return hasTrackContent(buildTrackBelief(source))
}

// ── THE LAW-4 DECLARATION, AS DATA — f3a is the FOURTH conforming citizen of the provenance ledger ──────────────
const K2 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-2 TrackConfirmed)'
const K3 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-3 TrackUpdated)'
const K4 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-4 TrackDropped)'
const STATE = 'contract/spec-3b-evidence-layer.md §11.2 (Entity state frames — the subject\'s committed pose)'

const TRACK_LEDGER: readonly PixelClass[] = [
  { id: 'track-mean', tier: 'decoded', source: K3,
    answer: 'the ring is CENTRED on the decoded track mean — the tracker\'s OWN estimated position (mean[0..1], NED metres), shown at true world coordinates; it is the belief\'s centre (the estimate), the reality half is compared against it' },
  { id: 'covariance-disc', tier: 'derived-display', source: `${K3} (the position covariance submatrix → 1σ eigen-semi-axis)`,
    answer: 'the disc RADIUS is a display-tier derivation of the decoded covariance — the 1σ eigen-semi-axis of the position submatrix (indices {0,1,4,5} of the 4×4 P), a symmetric-2×2 eigendecomposition; on f3a the submatrix is isotropic, so it is an honest DISC (equal semi-axes), never a tilted ellipse the matrix does not make. It is a derivation of decoded values with no external oracle, so it declares itself in words and wears no glyph' },
  { id: 'reality-pose', tier: 'decoded', source: STATE,
    answer: 'the drone\'s flight is the decoded STATE TRUTH — the tracked subject\'s committed pose at state frame t (offset 0: the tracker\'s tick-t estimate is compared against the tick-t ground truth, the principled pairing), read through the branded StateFrame accessor so a raw event tick can never launder in (the A3 seam, resolved deliberately now the comparison is claimed). It is the reality half the belief is measured against — the SAME frame the scene renders the drone at' },
  { id: 'belief-error', tier: 'derived-display', source: `${STATE} vs ${K3} (|mean − state pose|)`,
    answer: 'the belief-vs-reality GAP is a display-tier derivation — the distance between the decoded estimate (the mean) and the decoded truth (the subject\'s state pose at frame t); it is the tracker\'s ACTUAL error, both halves decoded, no external oracle, so it declares itself and wears no glyph. On f3a it grows 0.23 m → 2.43 m while the reported 1σ shrinks to 0.44 m — the truth ends ~5σ outside the disc (the tracker overconfident, the track times out)' },
  { id: 'ring-outline', tier: 'presentational', source: null,
    answer: 'the ring OUTLINE (the 1σ contour line in the horizontal plane) and its line weight encode no data — only its RADIUS (the covariance-disc class) and its CENTRE (the track-mean class) are data; the contour curve itself is presentational' },
  { id: 'sigma-readout', tier: 'derived-display', source: `${K3} (1σ = sqrt of the position-variance eigenvalue)`,
    answer: 'the stated 1σ in metres is the SAME display-tier derivation shown as a number — the eigen-semi-axis of the decoded position covariance; on f3a it shrinks 1.83 m → 0.44 m across the run as the filter reports gaining confidence. A derivation of decoded values, no external oracle — no glyph' },
  { id: 'track-lifecycle', tier: 'decoded', source: `${K2}/${K4} (subject, reason)`,
    answer: 'the track lifecycle is decoded — TrackConfirmed opens the track (naming its subject id) and TrackDropped closes it (its reason enum; f3a TIMEOUT); shown plain, the run\'s own record of when the belief began and ended' },
  { id: 'not-yet-update', tier: 'decoded', source: K3,
    answer: 'before its tick a track update is the future rendered in the NOT-YET voice (no disc yet); the disc appears when the playhead reveals the update and tightens as later updates are revealed, and a scrub back widens it again (constitution §4)' },
  { id: 'update-tally', tier: 'derived-display', source: `${K3} (the reveal-clock prefix count)`,
    answer: 'the "N updates revealed so far" tally is a display-tier prefix count of the decoded TrackUpdated events with tick ≤ the playhead — written by the viewer\'s own scrub, never a precomputed reveal-independent total; at full reveal it reads 78' },
  { id: 'presentational', tier: 'presentational', source: null,
    answer: 'the camera, the grid, the fog and the ring\'s draw order encode no data' },
]

// The static honesty chip — the ALWAYS-TRUE claim, DERIVED from the ledger and test-pinned against it
// (chipAgreesWithLedger): it claims decoded-real (the ledger has decoded classes) and names NO scenario constants
// (there are none — the disc + the gap are derivations of decoded values, not declared constants). It carries NO
// run-specific numbers — those depend on the run's data, so the App derives them per-run via trackBeliefChipCopy. The
// load-bearing honesty: the ring is BELIEF (the tracker's estimate) and the drone is REALITY (the decoded state truth),
// so the gap between them is the tracker's actual error — a real comparison, both halves decoded, named not disclaimed.
export const TRACK_BELIEF_HONESTY =
  'the ring is the tracker\'s own decoded estimate and the drone flies the decoded state truth — the gap between them is the tracker\'s actual error; both halves decoded, a real belief-vs-reality comparison'

export const F3A_TRACK_REGISTRATION: LensRegistration = validateRegistration({
  id: 'f3a-track',
  question: {
    primary: 'How sure is the tracker, and how right? (Q4/Q1-adjacent — the reported 1σ tightening, beside the ACTUAL error against the decoded truth)',
    adjacent: [
      'Q1 where does the tracker think the target is (the decoded mean) vs where it really is (the decoded state pose)',
      'Q5 can I trust this pixel (the disc + the gap are declared derivations of decoded values — no external oracle, no verdict glyph)',
    ],
  },
  surfaces: { stage: 'TrackBeliefStage', instrument: 'TrackBeliefStrip' },
  // LAW 2 — borrowed token NAMES only: the disc + the gap-line wear the MUTATING category token (track kinds 2/3/4 ARE
  // the mutating category — categorize.ts), the quiet chrome + NOT-YET voice wear textDim, the readout wears textPrimary.
  // No verdict hue is borrowed because the lens renders NO verdict marks (no recomputed class, no quality caveat).
  borrowedHues: ['category:mutating', 'textDim', 'textPrimary'],
  dims: 'one shrinking disc at the tracker\'s mean with a quiet line to the true pose (sub-bloom) so the tightening AND the growing error read — the run\'s belief-vs-reality mark; every other pixel stays out of its way',
  emptyState: 'a run with no track updates (or a POSITIONLESS run, or a positioned run carrying kind-22 verdicts) mounts no belief stage and wears no chip — the shared trackBeliefApplies gate (POSITIONED AND track updates AND no kind-22), the same fail-closed idiom the query/sensing/comms lenses use',
  honestyChip: TRACK_BELIEF_HONESTY,
  tourId: null, // no authored tour — the lens ships as the belief-vs-reality half; an authored tour is a follow-up (mirrors f4-comms)
  mountGate: trackBeliefApplies.name,
  provenance: TRACK_LEDGER,
})
