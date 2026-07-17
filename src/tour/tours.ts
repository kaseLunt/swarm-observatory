import type { Tour } from './tourTypes'
import { F2A_TOUR_TITLE } from '../ui/identityPlate'
import type { TrustVerdict } from '../decode/verify'
import { loadIsCurrent } from '../ui/hangar'

// Authored guided tours, keyed by runId. Captions describe REAL fixture data — every number below is
// verified against the decoded bundle (see the Task-5 report for the offline decode that pinned them):
//   E0: 75 GEOMETRY_QUERY_RESOLVED events over 75 ticks (seq == tick), all geometry queries. The v0.6
//       query stage replays them as GEOMETRY, in three acts (design draw inventory §3.1): Act I "learn the
//       objects" (0-35: point/range/ray probes sweep sphere→box→triangle), Act II "sightlines from the
//       origin" (36-55: 5 LOS composites; the FIRST BLOCK is tk39 — the sphere @ (191,0,0)), Act III "the
//       drawn observer" (56-74: a per-seed observer at n=−601 interrogates from a new vantage; the closing
//       CLEAR is tk74, O→(−1024,0,0), the only observer-phase clear line). Event 74 is the terminal.
// single drone '1:0', 67 events / 64 ticks, 3 MotionSegmentStarted chapters (ticks 0/24/48)
//       rendered as bands beneath the timeline. Both bundles are det-only, so their honesty voice is the
//       SELF-CHECK, not verification (two-voice truth: self-check ≠ verified). The event_hash / result_id
//       the ceremony re-computes tick ○ (self-consistent) on load — the bundle's event and state hashes (and its
//       counts) recomputed from these bytes and matched its OWN sealed trailer; there is NO external manifest
//       oracle. That self-check's SCOPE is exactly those payload hashes + counts (what matchesTrailer folds) —
//       NOT case_id or termination_reason, which are trailer-SOURCED (CRC-fixable) inputs to result_id, never
//       recomputed against anything. So these det-only captions claim the HASHES settled on load — never
//       "every byte" or "end to end" (that would over-claim the trailer-sourced fields), and NEVER "verified"
//       (that green is reserved for a full-manifest run).
// Selection contract (see tourTypes.ts TourStep.select): undefined = preserve current selection,
// null = explicit clear. Because of that, the FIRST step of every tour must ESTABLISH full
// selection state explicitly (never leave a field undefined) — otherwise a partial deep-link
// payload from before the tour started (e.g. a stale selectedEvent from a prior run/selection)
// would leak into the tour instead of the clean state the captions assume. Later steps may then
// rely on preserve-semantics (partial payloads composing against the tour-established state).
export const TOURS: Record<string, Tour> = {
  e0: {
    id: 'e0-hero',
    runId: 'e0',
    title: 'The query stage',
    // The tour-per-lens for the query stage: the acts as beats, the first hit, the first block, a
    // Show-the-Math beat, the CLEAR finale. holdMs is the FULL reading window for each caption
    // (constitution §5 RM hold-sizing rider — never discounted on assumed flight pre-exposure). Sized at
    // ≤20 chars/sec of caption length (holdMs ≈ caption.length·50, rounded up): step0 153ch→7700, step1
    // 221ch→11100, step2 208ch→10400, step3 177ch→8900, step4 175ch→8800, step5 163ch→8400 (a valid floor —
    // a later rewording left it below 8400). Every number
    // is decode-true (draw inventory §3): first block tk39 (S), the drawn observer at n=−601, the closing
    // CLEAR tk74. Step 0 opens on the composed stage frame (the tour-start reset frames stageBounds).
    //   AUTHORED PER-BEAT CAMERA (v0.8 — captions/holdMs UNCHANGED, so the §5 reading windows survive
    // verbatim; beats 0–1 stay on the composed stage frame the tour-start reset already frames, and beat 3's
    // Show-the-Math beat keeps the inspector as its subject — none of them move). The three authored arrives are
    // DECODE-TRUE (queryScene composes each from the parsed draws, never eyeballed): beat 2 'corridor' fits the
    // FIRST BLOCKED sightline's origin→sphere→contact run so the ray dying at tk39 is the frame's event; beat 4
    // 'crane' cranes behind the drawn observer aimed at the theatre it interrogates — the eye in the foreground,
    // staging the post-tour O-key POV down the same axis; beat 5 'stage' lands the query core-theatre bookend
    // (the runaway-excluded core keeps the closing CLEAR sightline's far runaway end OUTSIDE the framed theatre — "clean
    // passage", so the bookend needn't widen to the 1024u shot — and free exploration starts from the canonical rest
    // vantage). RM = instant cut throughout.
    steps: [
      { tick: 0, select: { entity: null, event: null }, caption: 'A real run bundle — 75 geometry queries, replayed as the geometry they resolved. Its event and state hashes recomputed and matched its own seal, on load.', holdMs: 7700 },
      { play: { to: 20, speed: 4 }, caption: 'Playback is exact replay — every tick is the authoritative recorded state, never simulation. Act I writes the world: points land inside or outside the sphere and box, and rays reach out and STOP where they strike a solid.', holdMs: 11100 },
      { play: { to: 43, speed: 4 }, arrive: { kind: 'corridor' }, caption: 'Act II — sightlines from the origin. A line of sight reaches for a far target and dies at the first solid in its way: at tick 39 the sphere blocks it, and the sightline stops dead at the contact where it hit.', holdMs: 10400 },
      { select: { event: 39 }, caption: 'Select any query to check the math. This blocked sightline’s verdict is recomputed live in your browser from the decoded numbers — the engine’s answer and ours agree, on all 75.', holdMs: 8900 },
      { play: { to: 74, speed: 8 }, arrive: { kind: 'crane' }, caption: 'Act III — a second observer, drawn per-seed at n=−601, interrogates the same world from a new vantage. After the tour, press O to stand at its eye and look down the sightline.', holdMs: 8800 },
      { tick: 74, select: { event: 74 }, arrive: { kind: 'stage' }, caption: 'The closing beat — a clear line of sight sails clean through empty space. One run, 75 queries, self-checked on load. Explore freely: every view is a shareable URL.', holdMs: 8400 },
    ],
  },
  f1: {
    id: 'f1-motion',
    runId: 'f1',
    title: 'Motion lifecycle',
    // f1 is the DEFAULT + the cold-open star (HERO SWITCH, dev/v0.6): this tour is the first thing a bare-
    // cold-open visitor ever sees — auto-played, zero-click. holdMs is the FULL reading window for each
    // caption (constitution §5 RM hold-sizing rider — never discounted on assumed flight pre-exposure),
    // sized ≤20 chars/sec exactly as the e0 tour's wave was (holdMs ≥ caption.length·50, rounded up to
    // the next 100): step0 115ch→5800, step1 141ch→7100, step2 63ch→3200. The pre-switch holds
    // (5000/4000/5000) read the first two captions FASTER than 20 ch/s (≈23 and ≈35 ch/s — a reading-window
    // violation) so they are raised onto the rider; step2 was already above its 3200 floor and is kept at
    // 5000 (a generous close-beat window is never shortened — the rider is a floor, not a ceiling).
    // AUTHORED CAMERA (v0.7, shot-authored first — the cold-open star's front door). Beat 0 is the calibrated
    // hero frame (the composed load vantage + a focus ease that is a near-no-op at the origin) — PROTECTED, no
    // arrive. Beats 1–2 retire the trajectory-so-far fit (the app's own ruling: f1's oversized corridor is read
    // through MOTION + trail, never a wide fit — the 168u/340u prefix fits ended the front door on the "near-
    // empty void" the critiques condemned): beat 1 composes AROUND the mid-flight head (medium — the celebrated
    // finale grammar applied mid-journey, trail receding into the fog), beat 2's terminal arrive lands the finale
    // CLOSE-UP framing (byte-identical to the natural-end rest close-up) so the auto-played front door ends on
    // the app's BEST frame. RM = instant cut (the shared focusLerpFactor factor-1 snap). Captions/holds unchanged.
    steps: [
      { tick: 0, select: { entity: '1:0', event: null }, focus: true, caption: 'A single drone with real recorded motion — position, heading, and speed, decoded straight from the sealed bundle.', holdMs: 5800 },
      { play: { to: 32, speed: 4 }, arrive: { kind: 'head', distance: 'medium' }, caption: 'Playback advances the recorded trajectory tick by tick. The segment chapters below the timeline derive from real MotionSegmentStarted events.', holdMs: 7100 },
      { play: { to: 64, speed: 8 }, arrive: { kind: 'head', distance: 'close' }, caption: 'On through every commanded segment to the final recorded state.', holdMs: 5000 },
    ],
  },
  f2a: {
    id: 'f2a-sensing',
    runId: 'f2a',
    // Tour title behind the naming placeholder (identityPlate.F2A_TOUR_TITLE) — the owner's one-line swap.
    title: F2A_TOUR_TITLE,
    // THE SENSING GAUNTLET, now with its NATIVE AUTHORED CAMERA (v0.7). Every number is decode-
    // true from the f2a bundle: the drone (1:0) flies north (e = 48 constant); the sensor watches from the
    // origin. Eligibility is a GAUNTLET of three gates and the run exercises all three — the drone enters the FOV
    // cone at the EXACT 3-4-5 edge (tick 55, a boundary tie), the occluder cuts line of sight for a stretch
    // (ticks 57–67, eligibility drops mid-window), and it leaves at the EXACT max-range edge (tick 82, r = 102,
    // another tie). Selected events: #99 (tick 48 — in range ✓, LOS clear ✓, in FOV ✗ → ineligible, the voice
    // split on show), #211 (tick 95 — the terminal verdict). holdMs is the FULL reading window per caption
    // (constitution §5 RM hold-sizing rider — never discounted), sized ≥ caption.length·50 rounded up to the next
    // 100. The first step establishes full selection state explicitly (the deep-link contract).
    //   AUTHORED ARRIVES (a design consult; captions/holds UNCHANGED, so §5 windows survive verbatim):
    // this tour was authored against the STATIC stage frame — its most important claims (the FOV gap, the
    // crossing, the eclipse, the range tie) were sub-2% of frame and effectively invisible. Beat 0 opens on the
    // whole-instrument stage fit (the tour-start reset already frames the sensing scope — the FOCUS PAN is DROPPED
    // so nothing moves during the inventory caption; the selection ring + identity plates carry "which one is the
    // drone"). Beats 1–3 use the CONJUNCTION shot (fit the sensor + the drone's live head): the drone-to-cone-edge
    // gap becomes a visible fact (b1), the crossing is watchable in-frame (b2 — b1 pre-seats the camera on the
    // crossing region), and b3 adds the OCCLUDER so Q reads interposed on the sightline (the eclipse). Beat 4
    // composes AROUND the head at the max-range tie (the drone resting ON the ring — the sensor 102u away need
    // not be in frame). Beat 5 CRANES back to the stage bookend (all 96 verdicts written on the trail; the
    // terminal head — n≈116, OUTSIDE beat 4's prefix box — is now framed) and lands on the canonical rest vantage
    // free exploration starts from. RM = instant cut. Every vantage is computed from live scene data, never typed.
    steps: [
      { tick: 0, select: { entity: '1:0', event: null }, caption: 'A single drone in real recorded flight, watched by a fixed sensor at the origin. Its field-of-view cone, range ring and the occluder sphere are scenario constants; the flight itself is decoded-real.', holdMs: 9900 },
      { tick: 48, select: { event: 99 }, arrive: { kind: 'conjunction' }, caption: 'In range, and line of sight is clear — but the drone is still OUTSIDE the field-of-view cone, so the sensor does not admit it. In range and LOS clear are recomputed live; in FOV is the claim voice — a pinned angle, no bearing in the bundle to recompute.', holdMs: 12700 },
      { play: { to: 56, speed: 3 }, arrive: { kind: 'conjunction' }, caption: 'Watch it cross INTO the cone at the exact 3-4-5 edge — tick 55, a boundary the engine flags as a tie. The trail flips green and the sensor makes its first detection.', holdMs: 8600 },
      { play: { to: 67, speed: 4 }, arrive: { kind: 'conjunction', occluder: true }, caption: 'Then the occluder cuts the line of sight: in range and in view, but blocked — so eligibility drops back to ember for a stretch.', holdMs: 7000 },
      { play: { to: 82, speed: 4 }, arrive: { kind: 'head', distance: 'medium' }, caption: 'The sightline clears and the drone is admitted again — right up to the exact max-range edge at tick 82, another boundary tie.', holdMs: 6800 },
      { tick: 95, select: { event: 211 }, arrive: { kind: 'stage' }, caption: 'Ninety-six sensing verdicts. In range, LOS clear and eligibility are recomputed live in your browser and match the engine byte for byte; in FOV is shown honestly in the claim voice. Every view is a shareable URL.', holdMs: 11400 },
    ],
  },
}

// An authored tour exists for this run id — an OWN-property check (Object.hasOwn) so a prototype key
// ('__proto__', 'toString', 'constructor') can never resolve TOURS[key] to an INHERITED member and pass a
// truthy "a tour exists" test. The runId here always comes from the store/catalog, but the own-property check
// keeps this predicate honest at the type/lookup level regardless of caller.
export function hasTour(runId: string): boolean {
  return Object.hasOwn(TOURS, runId)
}

// ── THE ONE TOUR-ADMISSION PREDICATE ────────────────────────────────────────────────────────────────
// A tour may start iff ALL of:
//   • a model is resident (hasModel), and
//   • it belongs to the CURRENT run (loadIsCurrent — closes the switch-gap hole: during a run switch a STALE
//     prior model is non-null while the store runId already names the destination, so a `model && …` gate would
//     start the destination's choreography against the PRIOR run's data), and
//   • the run's verdict is not a mismatch (a mismatched bundle's det-only tour captions claim a self-check the
//     bytes did not earn — the exact gate the ▶ button and the zero-click auto-arm already enforce), and
//   • an authored tour exists for the run (own-property check).
// ALL THREE tour entry points — the ▶ button, the zero-click auto-arm, and the Hangar handoff — consume THIS, so
// no entry point can drift from the other two (the Hangar handoff was the third hole this closes). `verdict` is
// passed RAW (hashes?.verdict): loadIsCurrent inside already refuses a verdict that belongs to a non-current run,
// so a stale prior-run verdict can never admit the destination. null verdict (not yet known) fails open on the
// verdict leg — but hasModel + loadIsCurrent still gate, and in the ready tree the verdict is concrete.
export function tourAdmitted(
  runId: string, hasModel: boolean, loadedRunId: string | null, verdict: TrustVerdict | null | undefined,
): boolean {
  return hasModel && loadIsCurrent(runId, loadedRunId) && verdict !== 'mismatch' && hasTour(runId)
}

// The Hangar → tour handoff decision as a PURE action, so App's effect is a thin dispatch and the
// switch-gap + cancellation behavior is unit-testable without a render harness. The parked intent is
// "tour <pendingTour> ON ARRIVAL at it" — never "tour <pendingTour> whenever it is next opened":
//   • 'idle'   — no pending tour: do nothing (never consume pendingTour).
//   • 'cancel' — the intent no longer applies, so DROP it (consume pendingTour without starting). Two triggers
//                (a) NAVIGATION AWAY — pendingTour names a run that is NOT the current one, so we are no
//                longer heading to the parked destination; leaving it parked would let a LATER plain-open of that
//                destination start a tour on a non-tour visit (the stale-replay bug). (b) TERMINAL ERROR — the
//                pending destination's own load failed (hasError), so the arrival will never complete; drop the
//                intent rather than leave it parked forever waiting for a model that will never publish.
//   • 'wait'   — our pending run, its bytes not resident + current yet AND no error (the switch gap: a stale PRIOR
//                model is non-null while loadedRunId still names the prior run). WAIT — do not start against old
//                data, and do NOT consume pendingTour, so the real destination still gets its tour once it loads.
//   • 'start'  — resident + current + admitted: start the tour AND consume pendingTour.
//   • 'refuse' — resident + current but NOT admitted (a mismatch destination, or no authored tour): consume
//                pendingTour WITHOUT starting (drop the doomed request; the reason is discarded silently).
export type TourHandoffAction = 'idle' | 'cancel' | 'wait' | 'start' | 'refuse'
export function tourHandoffAction(
  pendingTour: string | null, runId: string, hasModel: boolean, loadedRunId: string | null,
  verdict: TrustVerdict | null | undefined, hasError: boolean,
): TourHandoffAction {
  if (pendingTour === null) return 'idle'
  if (pendingTour !== runId) return 'cancel' // navigated to a DIFFERENT run — the arrival intent is abandoned
  if (hasError) return 'cancel'              // the destination's OWN load terminally failed — no arrival will come
  if (!hasModel || !loadIsCurrent(runId, loadedRunId)) return 'wait' // still loading — never start, never consume
  return tourAdmitted(runId, hasModel, loadedRunId, verdict) ? 'start' : 'refuse'
}
