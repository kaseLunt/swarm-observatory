// Frame channels (extracted MOVE-ONLY from Scene.tsx — v0.6 T0 Wave A). The module-scope channels the
// Scene frame loop consumes: bare objects read on the frame path by stamp compare / boolean load (never
// a store hit, zero allocation), written at event rate by App / useTour / OrbitControls handlers, plus
// the pure predicates TDD'd at channel level. Every block below moved verbatim; see each channel's own
// comment for its contract.
import { useViewStore } from '../state/viewStore'
import type { TourShot } from '../tour/tourTypes'

// User-orbit gate for auto-follow: OrbitControls' start/end events flip this while the user is actively
// dragging the camera, so the follow ease pauses (never fights a drag) and resumes on release. A plain
// module ref — the frame path reads it without a store hit or React subscription (mirrors focusRequest).
export const orbitDragging = { current: false }

// Cross-component focus channel (no new state machinery): App's `focus` key action calls
// focusSelected(), which snapshots the current selection and bumps a stamp. Entities' useFrame
// picks up the new stamp and eases OrbitControls' target toward the selected entity — the frame
// path only reads this plain object (never allocates). A `<dialog>`-free, store-free ephemeral.
export const focusRequest = { key: null as string | null, stamp: 0 }
export function focusSelected(): void {
  focusRequest.key = useViewStore.getState().selectedEntity
  focusRequest.stamp++
}

// Trail-frame one-shot channel (tour play-step arrival) — the SAME source-signaled shape as focusRequest
// above: a bare module object the frame path reads by stamp compare (never allocates). useTour.onArrived
// bumps the stamp on a NATURAL play-step arrival; the frame loop then eases the camera to a framing of the
// trajectory-SO-FAR and disarms the follow coast. The framing is derived from the trail prefix at the
// arrived tick (read from the store/trail at consume time), so the monotonic stamp carries the "act" signal.
//
// STAND-DOWN (`cancelled`) mirrors the focus channel's `focusRequest.key = null` house style: cancelTrailFrame()
// raises the flag and bumps the stamp so the frame loop consumes it and clears the active ease within one
// frame (allocation-free). useTour calls it from TWO sites: its INTERRUPT exit path (stop) — a user scrub/
// speed/click mid-ease must abandon the arrival shot — AND start() on a mid-tour RESTART, which routes
// App.startTour → start() DIRECTLY (never through stop), so start() cancels an in-flight ease left by the
// PRIOR tour. A NATURAL completion routes through finish() WITHOUT cancelling, so the final wide framing
// converges during the last hold. requestTrailFrame() lowers the flag again so a later arrival re-arms cleanly.
//
// Exported for tests: the request OBJECT is read only by camera.test.ts (channel-level coverage — the
// 'trail-frame request channel' describe). Production never imports the object itself: the frame loop reads
// it via stamp compare, and useTour drives it through the requestTrailFrame/cancelTrailFrame writers below
// (those two ARE production imports).
//
// INTENT (ruling 4): a frame request carries an explicit intent so the frame-loop consume can pick the right
// framing (and lighting) WITHOUT a second channel. 'tour-arrival' = today's semantics EXACTLY (trail-prefix
// fit + hold-light); 'establish' = whole-trajectory fit WITHOUT the hold-light (an establishing shot must
// not light the journey at play start — it would defeat the comet, and the rising-edge play clear at
// TrajectoryTrail would race it); 'finale' (T3) = the composed natural-end rest shot (see requestFinaleFrame
// below). The default 'tour-arrival' is cosmetic — every writer sets the intent explicitly.
// Exported for tests, though nothing imports the NAME today: camera.test.ts's intent-scoping asserts are
// typed through trailFrameRequest's exported shape (this union types its `intent` field), and production
// writes intents only via the request/cancel writers below — the export gives external code a name for the union.
// 'pov' (v0.6 T4b — Observer's Eye) rides the SAME trail-frame ease owner (NOT a fourth camera owner — the
// T0 split guard reserves that trigger): the consume's 'pov' branch eases to the observer POV framing
// (queryScene.povFraming) exactly as 'finale' eases to its close-up. cancelEstablishFrame is guarded to
// 'establish', so a selection never cancels a POV ease; its own stand-down is convergence or an orbit-drag.
export type FrameIntent = 'tour-arrival' | 'establish' | 'finale' | 'pov'
// `refit` (v0.5d ruling 5) is the establish-path RATE discriminator: an establish request fired by the
// scrub-from-finale gate (shouldRefitOnFinaleClear → requestRefitFrame) carries refit=true so the consume eases it
// at the GENTLER refitLerpFactor rate; a plain establish (the play rising edge → requestEstablishFrame) carries
// refit=false and keeps the FOCUS_EASE_RATE feel that passed two gates. It rides the SAME 'establish' intent (not a
// new enum member) so cancelEstablishFrame stays byte-identical — a selection still cancels a refit ease exactly as
// it cancels a plain establish. Only the 'establish' consume branch reads it, and both establish writers set it, so
// it is always current when read. Exported (with the object) only for the channel tests.
// `shot` (v0.7 T4) is the AUTHORED per-beat camera descriptor, riding the SAME 'tour-arrival' intent (NOT a new
// intent, NOT a new camera owner — the T0 arbitration guard). It carries GRAMMAR only (a TourShot kind); the
// Scene consume resolves it to a Framing from live scene data at consume time. It is a REFERENCE to the long-
// lived tour-data literal — zero allocation at request time, read exactly once on the stamp change. INVARIANT
// (mirroring refit ⟹ 'establish'): shot !== null ⟹ intent === 'tour-arrival'. Only requestTrailFrame sets it
// (and always to intent 'tour-arrival'); every non-tour writer below RESETS shot = null — so a stale authored
// shot can never be read under a non-tour intent. `null` = today's semantics exactly (the trajectory-so-far fit).
export const trailFrameRequest = { stamp: 0, cancelled: false, intent: 'tour-arrival' as FrameIntent, refit: false, shot: null as TourShot | null }

// Trail hold-light: while a tour hold dwells on a framed trajectory, the head-relative comet fade
// gives way to a fully-lit path (the hold's claim is "behold the journey" — a faded journey is a void).
// Set by requestTrailFrame (natural arrival), cleared by cancelTrailFrame (interrupt) and by the next
// rising edge of `playing` (any new playback returns the comet). Exported for tests.
export const trailHold = { lit: false }

// requestTrailFrame lights the hold (natural arrival → behold the journey); cancelTrailFrame drops it
// back to the comet (interrupt). The two writers ride the SAME sites that drive the arrival camera ease,
// so no new call sites in useTour are needed — the light and the framing arm/disarm together. Adding the
// explicit intent leaves the TOUR path byte-identical (intent 'tour-arrival' + lit, exactly as before) —
// the consume block's tour-arrival branch is unchanged, so tour framing + hold-light stay pixel-identical.
// INVARIANT refit ⟹ intent==='establish': reset refit=false here so a prior requestRefitFrame() can never
// leave refit=true latched under this non-establish intent.
// `shot` (v0.7 T4) — the authored per-beat arrive, or null for today's trajectory-so-far fit. Every production
// call site passes it explicitly (useTour's four fire sites); the default keeps the channel tests' no-arg calls
// (and any future caller) on the byte-identical null path. Sets the intent to 'tour-arrival' as always, so the
// shot ⟹ 'tour-arrival' invariant holds by construction.
export function requestTrailFrame(shot: TourShot | null = null): void { trailFrameRequest.cancelled = false; trailFrameRequest.intent = 'tour-arrival'; trailFrameRequest.refit = false; trailFrameRequest.shot = shot; trailFrameRequest.stamp++; trailHold.lit = true }
export function cancelTrailFrame(): void { trailFrameRequest.cancelled = true; trailFrameRequest.shot = null; trailFrameRequest.stamp++; trailHold.lit = false }

// STEP-BOUNDARY invalidation (v0.7 T4 fixwave, W2). A tour-arrival shot request writes ONE global trailFrameRequest;
// but the hold timer (a plain setTimeout, alive across a render suspension) can advance the driver to the NEXT beat
// before the frame loop consumes it — so a resumed frame loop would consume beat N-1's STALE shot against beat N's
// live anchors, activate a stale ease, and suppress beat N's follow until convergence. The driver calls this at
// every step boundary BEFORE the new step's actions to invalidate the prior beat's owner: it raises the SAME
// `cancelled` stand-down cancelTrailFrame uses (so the consume's cancelled-branch stands down any active prior-beat
// ease AND — being the latest stamp — supersedes an unconsumed pending request, dropping the stale shot) and clears
// shot. SCOPED to intent 'tour-arrival' (the cancelEstablishFrame precedent): a step boundary where no beat yet made
// a tour-arrival request leaves the intent a pre-tour leftover (establish/finale) which has nothing to invalidate —
// the tour-start reset already stood that down — so the guard makes it a correct no-op there. UNLIKE cancelTrailFrame
// it does NOT touch trailHold.lit: the hold-light is the next action's business (a play beat's rising edge returns
// the comet; a static beat's requestTrailFrame re-lights), and the driver only ever fires this on a step≥1 boundary
// (never a fresh step-0 start — start() owns that), so it can never clear a light the current beat still wants.
// Exported for tests (the channel-level stand-down + scoping); the driver drives it at enterStep.
export function cancelTourArrivalFrame(): void {
  if (trailFrameRequest.intent !== 'tour-arrival') return
  trailFrameRequest.cancelled = true
  trailFrameRequest.shot = null
  trailFrameRequest.stamp++
}

// Establishing-shot request (T2, ruling 3/4): frame the WHOLE trajectory on the rising edge of an
// unselected, tour-free play, WITHOUT lighting the hold. No trailHold write here — the comet must survive
// play start, and the rising-edge play clear at TrajectoryTrail keeps lit=false. Splitting framing from
// lighting is the whole point of the intent enum. Exported for tests (channel intent scoping).
export function requestEstablishFrame(): void { trailFrameRequest.cancelled = false; trailFrameRequest.intent = 'establish'; trailFrameRequest.refit = false; trailFrameRequest.shot = null; trailFrameRequest.stamp++ }
// Scrub-from-finale RE-FIT establish request (v0.5d ruling 5). The SAME whole-trajectory establish framing as
// requestEstablishFrame (intent 'establish', no hold-light — the consume is shared), but flagged refit=true so the
// consume eases it at the gentler refitLerpFactor rate: leaving a finale by a scrub whipped the close-up→wide move
// (critic n5). Scoped to the falling-edge refit caller only (shouldRefitOnFinaleClear); plain establish keeps the
// focus rate. cancelEstablishFrame (guarded to intent 'establish') cancels this too — a selection mid-refit hands
// off to follow exactly as it does mid-establish (T2 semantics intact). Exported for tests.
export function requestRefitFrame(): void { trailFrameRequest.cancelled = false; trailFrameRequest.intent = 'establish'; trailFrameRequest.refit = true; trailFrameRequest.shot = null; trailFrameRequest.stamp++ }
// SCOPED stand-down: cancels an in-flight ease ONLY when the active intent is 'establish' (a selection
// landed mid-establishing-ease → the user chose the subject, so follow takes over). The intent guard IS the
// scoping mechanism the enum exists for: a tour's own select actions fire this too, but the active intent is
// then 'tour-arrival', so it is a NO-OP and a tour-arrival frame is NEVER cancelled by a selection.
// (cancelTrailFrame stays the tour interrupt's intent-agnostic stand-down.) Exported for tests.
export function cancelEstablishFrame(): void { if (trailFrameRequest.intent !== 'establish') return; trailFrameRequest.cancelled = true; trailFrameRequest.stamp++ }

// Finale request (T3, ruling 2/5): the natural-end edge sets the store finale flag inside the Timeline
// transport batch; the Entities finale subscription calls this on the rising edge to arm the composed rest
// shot. Like requestTrailFrame it LIGHTS the hold (trailHold.lit = true — the reusable half of the tour
// machinery: the journey stays lit at rest, ruling 2), but the consume frames finaleFraming(TRUE head) for a
// positioned run / the whole-helix bounds for e0 (NOT TRAIL_FRAME_OPTS). A 'finale' intent — a THIRD class on
// the enum — so cancelEstablishFrame (guarded to 'establish') can NEVER cancel it (r2); the finale's own
// stand-down is the store finale FALLING edge (scrub/step/play → the subscription unlights the hold and drops
// any in-flight ease). v0.5c ruling 3: leaving a finale via a playhead MOVE additionally hands back the
// establishing context (an establish request on that edge — see shouldRefitOnFinaleClear below); all OTHER
// finale clears still never re-frame. Idempotent: a play-at-rest re-fire (r1) re-requests harmlessly (the
// camera is already there → a no-op ease). Exported for tests.
// INVARIANT refit ⟹ intent==='establish': reset refit=false here too.
export function requestFinaleFrame(): void { trailFrameRequest.cancelled = false; trailFrameRequest.intent = 'finale'; trailFrameRequest.refit = false; trailFrameRequest.shot = null; trailFrameRequest.stamp++; trailHold.lit = true }

// Observer's Eye POV request (v0.6 T4b, directive II.6): a keyboard gesture (O) requests the POV shot — stand
// at the drawn observer O, look toward the interrogated theatre. Rides the SAME trail-frame ease as
// establish/finale (intent 'pov', no hold-light — it is a vantage, not a "behold the journey" beat); the
// consume computes the framing from queryScene.povFraming (null → no-op: f0/f1 have no observer). refit=false
// so a prior requestRefitFrame can't leave refit latched under this non-establish intent. Exported for tests.
export function requestPovFrame(): void { trailFrameRequest.cancelled = false; trailFrameRequest.intent = 'pov'; trailFrameRequest.refit = false; trailFrameRequest.shot = null; trailFrameRequest.stamp++ }

// Tour-start camera RESET channel (v0.5d ruling 6). A guided tour's step-0 caption assumes the camera opens on
// the CameraRig LOAD vantage — the composed default framing the choreography was authored against. But a tour can
// be launched from ANY prior camera state: a finale rest (~25u off the corridor's far head), a mid-run orbit, or
// cold. Entered from a finale, ~8s of the ~20s guided pitch played over an empty horizon with the head stranded
// ~241u away (the critic's RULING: "restores the direction, not touches it"). This one-shot module channel (the
// focusRequest / trailFrameRequest house shape: a bare stamp the frame loop reads by compare, zero-alloc, no store)
// lets useTour.start() request an INSTANT cut back to the load vantage without importing Scene camera internals it
// doesn't already have. The Entities consume computes frameFor(bounds, LOAD_FRAME_OPTS) — the SAME opts CameraRig
// frames at load, so on a PLAIN tour (already at the vantage) the cut writes identical values → PIXEL-EQUIVALENT
// (a no-op). Instant, not eased: tour-start is an explicit stage-take (RM parity trivial), and an ease would be
// fought by step-0's own focus action on f1. Exported for tests (stamp channel, like requestTrailFrame).
export const tourStartFrameRequest = { stamp: 0 }
export function requestTourStartFrame(): void { tourStartFrameRequest.stamp++ }

// Scrub-from-finale re-fit gate (v0.5c ruling 3), extracted as a PURE predicate so it can be TDD'd exhaustively:
// the falling-edge effect that calls it lives inside a Scene subscription a unit test can't cheaply mount, so the
// effect stays a thin caller and this predicate carries the whole gate. Returns true when a finale was just LEFT
// by a playhead MOVE on the SAME run of a positioned, fittable run — the scrub / arrow-key step / deep-link (the
// "void") class — and the camera should ease back to the wide establishing frame instead of parking at the empty
// sky where the finale head was.
//   Store-batch CAUSALITY is the detector (verified by the controller): setTick / applyLink write
// {tick, finale:false} ATOMICALLY, so a playhead move shows as tick-changed in the SAME batch as the finale
// clear. The other finale clears are excluded by their batch SHAPE, not by isTourActive(): tour-start's bracket
// (useTour.ts:341) and play-at-rest (setPlaying(true)) clear finale WITHOUT moving the tick → tick unchanged;
// selectRun (App.tsx:93) moves the tick but changes runId in the same batch → runId differs. e0/f0 keep stay-put
// (positionless → !positioned, and f0's static point → null bounds). NOT isTourActive(): start() clears finale at
// useTour.ts:341 BEFORE registerTourInterrupt at :347, so it is provably false at this edge — the tick-move gate
// is the correct, race-free detector. Exported for tests.
export function shouldRefitOnFinaleClear(
  s: { finale: boolean; tick: number; runId: string },
  prev: { finale: boolean; tick: number; runId: string },
  positioned: boolean,
  boundsNonNull: boolean,
): boolean {
  return !s.finale && prev.finale && s.tick !== prev.tick && s.runId === prev.runId && positioned && boundsNonNull
}

// MOUNT-TIME already-playing-and-eligible establish detector (I-1, v0.5d T3 debt → v0.7 T4 rider). The
// establishing shot's only OTHER caller is the rising-edge arm inside the store subscription Entities registers
// at MOUNT — but that subscription cannot catch a `playing` rising edge that fired BEFORE it attached. On a slow
// (SwiftShader) mount the ▶ can land before Entities mounts, so the establishing shot never armed and the camera
// stranded on the composed load vantage while the subject flew off-frame (severity LOW — a software-rendering
// window; degraded = the load vantage — but a real gap). CORRECTED diagnosis (progress.md): a MISSED EDGE, not a
// swallowed stamp — nothing ever REQUESTED, so "stop the mount-seed consuming" fixes nothing. The remedy is this
// mount-time DECISION, fired ONCE by the Scene mount-effect AFTER the ref seed (so the consume sees a genuine
// stamp change): the SAME eligibility as the rising-edge arm (positioned · unselected · tour-free · fittable ·
// mid-run), keyed on the ALREADY-TRUE `playing` instead of a false→true edge.
//   NO double-fire with the arm: an already-playing mount has no future rising edge to also fire it, and a run
// that mounts at REST fails the `playing` gate — which is EVERY run switch (App.selectRun rests the transport to
// playing=false), so a remount never re-establishes. A tour (cold-open autoplay owns the camera), a selection
// (follow the subject), a positionless run (e0 — nothing to frame), a null-bounds run (f0 static point /
// unfittable — the consume guards it too), and the natural-end rest (tick === tickCount — the finale owns it) are
// each excluded exactly as the arm excludes them. Pure; unit-tested (the deterministic repro of the missed edge).
export function shouldEstablishOnMount(
  s: { playing: boolean; selectedEntity: string | null; tick: number },
  positioned: boolean,
  boundsNonNull: boolean,
  tourActive: boolean,
  tickCount: number,
): boolean {
  return s.playing && positioned && s.selectedEntity === null && !tourActive && boundsNonNull && s.tick < tickCount
}

// The FOLLOW-ARM half of a play edge, split from the establish half (v0.7 T4 fixwave, W1). The live rising-edge
// subscription arm does TWO things — arm the auto-follow coast for ANY positioned run (a moving subject must be
// tracked), THEN request an establishing shot only when the STRICTER establish eligibility holds — but the mount
// reconciliation (the I-1 fix) wired ONLY the establish half. So a SELECTED early-play mount (?run=f1&sel=1:0 + ▶
// landing before Entities mounts) requested nothing (shouldEstablishOnMount correctly rejects a selection present)
// AND never armed follow, so the selected vehicle left frame until a pause/resume edge re-armed it. This is the
// follow-arm gate, INDEPENDENT of establish eligibility: a play moment arms the coast whenever the run is
// positioned. Trivial by construction, but pinned as the pure companion to shouldEstablishOnMount so the play-edge
// contract ("arm follow whenever positioned && playing, THEN apply establish eligibility") is unit-covered — the
// Scene.onPlayEdge handler shared by the subscription arm and the mount reconciliation IS this predicate followed
// by shouldEstablishOnMount. Pure; unit-tested.
export function shouldArmFollowOnPlay(positioned: boolean, playing: boolean): boolean {
  return positioned && playing
}
