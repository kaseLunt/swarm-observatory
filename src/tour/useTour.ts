import { useEffect, useRef, useState } from 'react'
import type { RunModel } from '../model/runModel'
import type { Tour, TourShot } from './tourTypes'
import { advanceTour, stepActions, holdFor } from './tourEngine'
import type { TourState } from './tourEngine'
import { registerTourInterrupt, unregisterTourInterrupt } from './interrupt'
import { useViewStore, syncUrl } from '../state/viewStore'
import { witnessSpeed } from '../state/transport'
import { focusSelected, requestTrailFrame, cancelTrailFrame, cancelTourArrivalFrame, requestTourStartFrame } from '../ui/frameChannels'
import { prefersReducedMotion } from '../ui/motion'

// ── Pure, schedulable core (exported for the node-env unit tests) ────────────────────────────────
// The hook glue below needs a DOM + the live store and cannot run under the node-env vitest runner;
// these two pure predicates carry the load-bearing logic and are unit-tested in useTour.test.ts. The
// glue is verified by the browser + smoke passes.

// A 'play' step is complete once the (integer) playhead reaches or passes its target tick.
// Exported for tests: unit-tested directly in useTour.test.ts (see the section note above).
export const arrived = (tick: number, to: number): boolean => tick >= to

// PHASE-AWARE interrupt discrimination. CRITICAL: during a 'play' step the transport's rAF loop
// writes tick every frame WITHOUT the driving flag — tick changes are EXPECTED then, not user input.
// During 'playing': foreign iff selection changed, or playing flipped false BEFORE arrival (user paused).
// During 'static' (scrub/hold): any unbracketed tick or selection change is user input.
//
// This detector is the BELT; source-signaling (interrupt.ts → notifyUserInput) is the primary channel
// (see the listener). The entity check below is the belt's load-bearing case: an entity-only click
// (select(k, null)) changes selectedEntity but NOT selectedEvent, so it would slip past both phase
// branches — and the 3D-canvas/pointer-miss caller is not one we source-wire. Proven false-positive
// free: the transport never writes selectedEntity, and every driver select is bracketed (driving=true).
// Two more belt-residue notes: (a) a pointer-miss click when nothing is already selected produces no
// delta (null→null on both fields) and so does not interrupt — nothing observable changed, this is
// deliberate, not a gap; (b) camera orbit (OrbitControls) touches no store state at all, so it
// deliberately does NOT interrupt either (the tour never continuously drives the camera — the
// focus ease triggered by a 'focus' action is one-shot, not ongoing ownership).
// Exported for tests: unit-tested directly in useTour.test.ts (see the section note above).
export function isForeignWrite(
  driving: boolean,
  phase: 'playing' | 'static',
  playTarget: number | null,
  prev: { tick: number; playing: boolean; selectedEvent: number | null; selectedEntity: string | null },
  next: { tick: number; playing: boolean; selectedEvent: number | null; selectedEntity: string | null },
): boolean {
  if (driving) return false
  if (next.selectedEntity !== prev.selectedEntity) return true // belt: entity-only click, both phases
  if (next.selectedEvent !== prev.selectedEvent) return true
  if (phase === 'playing') {
    return prev.playing && !next.playing && (playTarget === null || next.tick < playTarget) // paused early = user
  }
  return next.tick !== prev.tick
}

// ── The hook ─────────────────────────────────────────────────────────────────────────────────────

export interface TourHandle {
  active: Tour | null
  stepIndex: number
  caption: string | null
  start(tour: Tour): void
  stop(): void
}

type ViewSnapshot = ReturnType<typeof useViewStore.getState>
type Phase = 'playing' | 'static'
type SetView = (v: { active: Tour | null; stepIndex: number; caption: string | null }) => void

interface Driver {
  start(tour: Tour): void
  stop(): void
  dispose(): void
}

// Plain (non-React) factory: owns ALL mutable tour state in closure variables and drives the pure
// tourEngine reducer via store writes. Built once per hook instance (a stable ref) so its single store
// subscription and its timers keep a stable identity for the tour's whole lifetime.
// Exported for the node-env unit test (like `arrived` / `isForeignWrite`): the factory is NOT a hook — it
// uses the store as a singleton — so start()/stop()/dispose() are drivable directly against the real store
// without a DOM/renderHook harness (the repo carries none).
export function createDriver(setView: SetView, modelRef: { current: RunModel | null }): Driver {
  const store = useViewStore // the store singleton (.getState/.setState/.subscribe) — not a hook call

  let tour: Tour | null = null
  let engine: TourState = { stepIndex: -1, status: 'idle' }
  let phase: Phase = 'static'
  let playTarget: number | null = null
  // AUTHORED per-beat camera arrive (v0.7). The CURRENT step's `arrive` descriptor (or null), captured in
  // enterStep and read at the four fire sites below — mirroring playTarget's lifecycle (a step attribute, not a
  // stepActions action, so tourEngine stays untouched: a design ruling / the `caption` precedent). null =
  // today's behavior byte-for-byte (a play beat frames the trajectory-so-far; a static beat holds the frame).
  let pendingArrive: TourShot | null = null
  // The user's transport speed captured at start(), restored ONLY on natural completion (see finish).
  let savedSpeed = 1
  // driving.current-equivalent: true strictly while executing the driver's OWN store writes so the
  // subscription can distinguish them from user/transport writes. See the synchronous-notify note below.
  let driving = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let unsub: (() => void) | null = null

  const clearTimers = (): void => { timers.forEach(id => clearTimeout(id)); timers.clear() }

  // Zustand notifies listeners SYNCHRONOUSLY inside set(): set → listeners run inline → set returns.
  // That is exactly why the `driving` bracket works: while we run the driver's own writes we hold
  // driving=true, the subscription fires re-entrantly DURING each write and still sees driving=true
  // (it was never cleared — notification is synchronous, not deferred), so it skips them. Any write the
  // bracket does not wrap is therefore genuinely foreign (a user gesture, or the transport rAF loop).
  const bracket = (fn: () => void): void => {
    const prevDriving = driving
    driving = true
    // Restore the PRIOR value, not clear-to-false: today no bracket() call is nested (each driver
    // function wraps its own writes exactly once), so prevDriving is always false and this is
    // behavior-identical. Restoring rather than clearing makes the invariant structural, though — if a
    // future bracketed function ever calls another bracketed function, the inner call's finally can no
    // longer un-drive the outer one that is still in flight.
    try { fn() } finally { driving = prevDriving }
  }

  // Advance the state machine on a real event; act only on GENUINE transitions. advanceTour returns the
  // SAME state reference on a no-op (documented contract) — the `next === prev` guard turns that into a
  // do-nothing, which is what enforces the single-delivery of scheduleHold/enterStep (a stray duplicate
  // 'actionsComplete'/'holdElapsed' is a no-op, never a double schedule).
  function dispatch(event: 'start' | 'actionsComplete' | 'holdElapsed'): void {
    if (tour === null) return
    const prev = engine
    const next = advanceTour(prev, tour, event)
    if (next === prev) return
    engine = next
    if (next.status === 'stepping') enterStep(next.stepIndex)
    else if (next.status === 'holding') scheduleHold(next.stepIndex)
    else if (next.status === 'done') finish(true) // NATURAL completion → restore the user's speed
  }

  // Enter a stepping(i) state: publish the caption, then execute ALL of the step's actions (possibly
  // zero) as bracketed driver writes. Synchronous actions (scrub/select/focus) finish inline; a 'play'
  // action defers completion to arrival (see startPlay). Zero actions → dispatch immediately.
  function enterStep(i: number): void {
    if (tour === null) return
    const step = tour.steps[i]
    if (step === undefined) return // noUncheckedIndexedAccess guard; the engine never indexes OOB
    clearTimers() // single-delivery insurance: no stale hold may straddle a step boundary
    // STEP-BOUNDARY CAMERA INVALIDATION (v0.7 fixwave) — the sibling of clearTimers above: no stale
    // TRAIL-FRAME shot may straddle a step boundary either. The prior beat's tour-arrival request writes ONE
    // global channel; under a render suspension the hold timer (a plain setTimeout) can reach HERE before the
    // frame loop consumed it, so a resumed frame would apply beat N-1's stale shot against beat N's live anchors
    // and suppress beat N's follow until convergence. Invalidate it BEFORE this step's actions: the consume then
    // stands down any active prior-beat ease and drops the unconsumed request (cancelTourArrivalFrame raises the
    // `cancelled` stand-down + supersedes the stamp). GATED to i > 0: step 0 has no prior beat in this tour, and
    // start() already owns the fresh-start / restart stand-down (its tour-start reset + restart cancelTrailFrame),
    // so firing on step 0 would be redundant AND would break the "an un-authored static beat requests nothing"
    // opt-in contract. Scoped to intent 'tour-arrival' inside the writer, so a boundary with no prior arrival
    // request (a leftover establish/finale intent) is a correct no-op.
    if (i > 0) cancelTourArrivalFrame()
    phase = 'static'
    playTarget = null
    pendingArrive = step.arrive ?? null // this step's authored camera arrive (fresh each step → no stale leak)
    setView({ active: tour, stepIndex: i, caption: step.caption })

    const actions = stepActions(step)
    let play: { to: number; speed: number } | null = null
    bracket(() => {
      for (const a of actions) {
        if (a.kind === 'scrub') store.getState().setTick(a.tick)
        else if (a.kind === 'select') {
          // Adapt the engine's tri-state select payload to the real store API select(entity, event):
          // undefined = leave the current value unchanged (the store has no partial select), null =
          // clear, a value = set. Read the current selection fresh so unchanged fields are preserved.
          const cur = store.getState()
          const entity = a.entity === undefined ? cur.selectedEntity : a.entity
          const event = a.event === undefined ? cur.selectedEvent : a.event
          cur.select(entity, event)
        }
        else if (a.kind === 'focus') focusSelected() // reuse the Scene focus channel verbatim (no 2nd channel)
        else if (a.kind === 'play') play = { to: a.to, speed: a.speed }
      }
    })

    if (play === null) {
      // STATIC beat (scrub/select, no playback). Fire the authored arrive HERE — a static beat gets a
      // camera arrive only when it declares one (opt-in), so every static beat without one stays pixel-identical
      // (no request). The scrub already landed inside the bracket above, so the tick is current when Scene
      // resolves the shot (the onArrived/RM ordering law: request AFTER the actions land). This is the new
      // capability the "authored against static frames" beats (f2a b1/b5) needed — they held a dead frame before.
      if (pendingArrive !== null) requestTrailFrame(pendingArrive)
      dispatch('actionsComplete')
      return
    }
    startPlay(play)
  }

  function startPlay(p: { to: number; speed: number }): void {
    const m = modelRef.current
    // Clamp the target into the model's tick range. Correctness, not hygiene: if to > tickCount the
    // transport auto-pauses at tickCount (done) with tick=tickCount < to, which (a) never satisfies
    // arrived() → the tour hangs, and (b) LOOKS like an early user pause to isForeignWrite → falsely
    // aborts the tour. Clamping makes the end-of-timeline pause coincide with arrival.
    const target = m === null ? p.to : Math.min(p.to, m.tickCount)
    const cur = store.getState().tick
    if (arrived(cur, target)) {
      // Already at/past the target (e.g. a scrub landed on it): no playback to run. Land + complete.
      bracket(() => { store.getState().setTick(target); store.getState().setPlaying(false) })
      // this play beat still gets its authored arrive (opt-in — only when declared, so an un-authored
      // already-arrived beat stays byte-identical: no request). AFTER the bracket, so the tick is landed.
      if (pendingArrive !== null) requestTrailFrame(pendingArrive)
      dispatch('actionsComplete')
      return
    }
    // Reduced motion: SNAP, don't animate. Witness pacing is a ~WITNESS_SECONDS presentation flight, and
    // under the witness-normalized base even 1× plays a whole run over ~WITNESS_RUN_SECONDS (~8s) — so an
    // animated play step is genuine decorative motion that prefers-reduced-motion must collapse to instant.
    // The OLD path ("skip the witness write → the ladder rate completes ~instantly") is now FALSE: at the
    // new base a ladder-rate play step is seconds long, not a frame. So we mirror the arrived() early path
    // above: bracket setTick(target) + setPlaying(false) and complete the step. No witness write, no
    // playback — content lands in full (the playhead reaches the target), it just arrives instantly.
    //   ARRIVAL PARITY: the snap bypasses onArrived, so it must request the arrival framing + trail hold-light
    // ITSELF — the constraint is that requestTrailFrame fires AFTER the bracket (below), mirroring onArrived's
    // ordering, so the tick is already snapped to `target` when Scene consumes the request. Without it a
    // reduced-motion tour loses the framing a normal (animated) arrival gets. The camera framing snaps
    // (focusLerpFactor factor 1) and the trail lights: both are honest INSTANT CUTS, not animation, so reduced
    // motion permits them. Reduced-motion tours are therefore still FRAMED and LIT at every arrival — parity
    // with the animated path.
    if (prefersReducedMotion()) {
      bracket(() => { store.getState().setTick(target); store.getState().setPlaying(false) })
      // Mirror onArrived's ordering: tick is already snapped to `target` above, so Scene reads the correct
      // arrived tick when it consumes this request. Pass the authored arrive (RM PARITY — same shot,
      // delivered as an instant cut via the shared focusLerpFactor factor-1 snap; null = the trajectory-so-far
      // default). A reduced-motion tour is therefore composed with the SAME authored frames, just cut not eased.
      requestTrailFrame(pendingArrive)
      dispatch('actionsComplete')
      return
    }
    phase = 'playing'
    playTarget = target
    // Witnessable pacing: under the witness-normalized base a play step covers only a SPAN of the run, so
    // at the user's ladder speed its duration would vary with span/tickCount (step to step). The authored
    // `p.speed` is superseded by an off-ladder rate that re-normalizes THIS span to ~WITNESS_SECONDS of
    // wall time (witnessSpeed). Written via store.setState (NOT setSpeed, which snaps to the user ladder
    // [0.25,1,4,8]) so the presentation rate can sit between notches and read as off-ladder in Timeline;
    // the user's ladder speed is restored on every exit path (finish). This is TOUR-ONLY presentation
    // pacing — USER playback semantics are untouched (the tour was always scripted pacing, so normalizing
    // its own scripted play step to be witnessable is honest). The run's tickCount is the pacing base.
    bracket(() => {
      store.setState({ speed: witnessSpeed(target - cur, m?.tickCount ?? 1) })
      store.getState().setPlaying(true)
    })
    // Deliberately NOT dispatching actionsComplete here: the transport rAF now advances tick and the
    // subscription detects arrival → onArrived pauses and completes the step's actions.
  }

  // Fired from the subscription when tick reaches the target during a play step.
  function onArrived(): void {
    const target = playTarget
    phase = 'static'
    playTarget = null
    // Snap to the exact target (fraction→0) and pause. Bracketed so the re-entrant (synchronous) fire
    // of this same subscription sees driving=true and skips — no self-trigger, no false interrupt.
    bracket(() => {
      if (target !== null) store.getState().setTick(target)
      store.getState().setPlaying(false)
    })
    // Frame at the arrival hold: a NATURAL play-step arrival requests a trail frame; Scene eases the camera to
    // the arrival shot. This lives ONLY in onArrived — user interrupts route through stop()/finish() and so
    // never trigger the framing (point 1). Pass the step's authored arrive — an authored beat composes its
    // vantage (compose-around-head, sensing conjunction, stage), null the trajectory-so-far default (byte-
    // identical). The tick was just snapped to `target`, so Scene reads the correct arrived tick when it consumes.
    requestTrailFrame(pendingArrive)
    dispatch('actionsComplete')
  }

  function scheduleHold(i: number): void {
    if (tour === null) return
    const step = tour.steps[i]
    if (step === undefined) return
    // Dwell is NOT motion (v0.5d): holdFor returns the authored holdMs for everyone — reduced
    // motion no longer shortens holds (they are caption-READING time, authored 3500-6000ms for reading;
    // the old 1200ms rm cap gave rm users LESS reading time). Reduced motion's job is done elsewhere: a
    // play step's witness-paced flight SNAPS in startPlay (setTick to the target, no playback), and the
    // camera eases collapse to instant cuts (factor 1). Playback CONTENT is never skipped — it lands
    // instantly rather than travelling; this hold then dwells the full authored beat on that content.
    const id = setTimeout(() => { timers.delete(id); dispatch('holdElapsed') }, holdFor(step))
    timers.add(id)
  }

  const listener = (next: ViewSnapshot, prev: ViewSnapshot): void => {
    // Our own bracketed writes: ignore entirely. This also makes onArrived's writes (which fire this
    // listener re-entrantly) safe from self-triggering the arrival branch below.
    if (driving) return
    // SOURCE-SIGNALING (interrupt.ts → notifyUserInput) is the PRIMARY interrupt channel: scrub / speed /
    // keyboard / focus callers call stop() at the source BEFORE their store write lands, so this delta
    // detector never has to catch them. That is what keeps the play-phase logic below sound — a scrub
    // during a play step stops the tour BEFORE its tick write, so the tick-ignore and the arrival check
    // can't be fooled by a user scrub (a scrub PAST the target would otherwise mimic natural arrival).
    // This detector is the BELT for selection-only inputs — chiefly entity-only clicks, whose source
    // (the 3D canvas / pointer-miss) we do not wire and which leave selectedEvent untouched.
    // prev/next (the listener's own arguments) already carry tick/playing/selectedEvent/selectedEntity,
    // which structurally satisfies isForeignWrite's narrower parameter type — pass them straight through
    // instead of allocating a throwaway { ... } literal on every store notify (2 allocs/frame during play).
    if (isForeignWrite(false, phase, playTarget, prev, next)) { stop(); return }
    if (phase === 'playing' && playTarget !== null && arrived(next.tick, playTarget)) onArrived()
  }

  // Exactly ONE store subscription while a tour is active — it is both the tick-arrival watcher and the
  // foreign-write detector — established on start, removed on stop/done/dispose.
  const ensureSubscribed = (): void => { if (unsub === null) unsub = store.subscribe(listener) }
  const unsubscribe = (): void => { if (unsub !== null) { unsub(); unsub = null } }

  // Tear the tour down and (optionally) reflect the resting state into the URL. ALWAYS restore the
  // user's pre-tour ladder speed. Rationale: witness pacing (startPlay) replaces `speed`
  // with an off-ladder presentation rate on every play step, so during a tour the store's `speed` is
  // NEVER a user choice — leaving it in place would poison USER playback with the tour's slow rate.
  // A user speed GESTURE that interrupts still wins: it calls notifyUserInput() (→ stop → this restore)
  // and THEN applies its own setSpeed, which lands after. Before any play step has run, `speed` already
  // equals savedSpeed, so the restore is a harmless no-op there (matching the old interrupt behavior).
  function finish(withSync: boolean): void {
    clearTimers()
    unsubscribe()
    unregisterTourInterrupt() // source-signal channel is tour-scoped: drop it on EVERY exit path
    // Restore the resting transport: a play step in flight leaves playing=true; bring it to rest so
    // autoplay does not outlive the tour. Bracketed for discipline even though the subscription is gone.
    bracket(() => {
      store.getState().setPlaying(false)
      store.getState().setSpeed(savedSpeed)
    })
    tour = null
    engine = { stepIndex: engine.stepIndex, status: 'done' }
    phase = 'static'
    playTarget = null
    if (withSync) syncUrl(true) // deep-linkable resting tick/selection after a stopped/finished tour
    setView({ active: null, stepIndex: 0, caption: null })
  }

  function stop(): void {
    if (tour === null) return // idempotent
    // INTERRUPT exit path: a user scrub/speed/click or the overlay's × routes here (belt detector,
    // source-signal channel, and the public handle all call stop). Cancel any in-flight trail-frame arrival
    // ease so it does not outlive the tour — Scene clears the active ease next frame. A mid-tour RESTART is
    // NOT one of these interrupts: it routes App.startTour → start() DIRECTLY (never through stop), so start()
    // owns the restart-side cancelTrailFrame. NATURAL completion also skips here (it dispatches straight to
    // finish(true) from the engine's 'done' state), so the final wide framing converges during the last hold.
    cancelTrailFrame()
    finish(true) // interrupt/stop → restore the user's pre-tour ladder speed (undo any witness pacing)
  }

  function start(tour_: Tour): void {
    // Restart-safe: from ANY prior state, rest the transport and reset the machine, then enter step 0.
    // RESTART cancels an in-flight trail-frame arrival ease. A mid-tour ▶ re-click routes App.startTour →
    // start() DIRECTLY — never through stop() — so an arrival ease from the PRIOR tour would otherwise
    // outlive the restart (masked today only by f1's step-0 focus action, which supersedes it). Guard on
    // `tour !== null` (the closure's prior-tour handle, set below to tour_): only a RESTART cancels — a fresh
    // start from idle (tour === null) has no ease to abandon and must not raise a spurious stand-down.
    //   RESTART also restores the user's ladder speed: the store's `speed` is still the prior tour's
    // OFF-LADDER witness rate (startPlay overwrote it), and — because a restart never routes through
    // stop()/finish() — nothing else restores it. The constraint: that stale witness speed must not survive
    // into the new tour's establishing beat. Under a LIVE reduced-motion toggle the new tour SNAPS every play
    // step (no witness write), so a surviving off-ladder speed would just sit there DIMMING the ladder with
    // nothing animating. savedSpeed still holds the user's captured ladder speed (captured on the original
    // fresh start; the `tour === null` guard below skips re-capture on a restart). Bracketed like every other
    // in-tour store write so the prior tour's still-live subscription ignores it (symmetric with cancelTrailFrame).
    if (tour !== null) {
      cancelTrailFrame()
      bracket(() => { store.getState().setSpeed(savedSpeed) })
    }
    clearTimers()
    // Capture the user's transport speed ONLY when no tour is currently active. The ▶ button stays
    // clickable mid-tour, so start() can be re-entered while a PRIOR tour is still driving playback
    // (tour !== null) — at that instant store.getState().speed is the TOUR's own play speed (e.g. 4x),
    // not the user's. Capturing unconditionally would poison savedSpeed with that tour-owned value and
    // hand it back on the NEW tour's natural completion. finish() always nulls `tour` on every exit path
    // (done/stop/dispose), so a genuinely fresh start still captures — only a mid-tour restart skips it.
    if (tour === null) savedSpeed = store.getState().speed
    // Rest the transport AND clear any live natural-end finale: a tour OWNS the stage, so its opening beat must
    // never render over finale dressing. setPlaying(false) alone KEEPS the finale (the store only clears it on
    // the play RISING edge), so clear it explicitly here — matching setTick's finale:false write. Safe only by
    // accident today (both authored tours' step 0 scrubs to tick 0 → setTick clears it); a future tour whose
    // first step lacks a playhead move would otherwise open over a stale finale. Bracketed so a restarting prior
    // tour's still-live subscription ignores the write (symmetric with the setPlaying below).
    bracket(() => { store.setState({ finale: false }); store.getState().setPlaying(false) }) // stop any in-flight autoplay from a prior tour
    // TOUR-START CAMERA RESET (v0.5d): put the camera on the composed LOAD vantage the choreography was
    // authored against, so step 0's caption opens on the correct stage from EVERY entry state — a finale rest
    // (camera parked ~25u off the corridor's far head, ~241u from where step 0 expects it), a mid-run orbit, or
    // cold. This is the ONE sanctioned tour-file change; the reset routes through Scene's requestTourStartFrame
    // module channel (the focusSelected/requestTrailFrame house shape already imported here) so useTour pulls in
    // no new Scene camera internals — Scene consumes it as an instant cut to frameFor(bounds, LOAD_FRAME_OPTS).
    // Not bracketed: it is a module-channel stamp bump, not a store write, so the tour subscription is unaffected.
    // On a PLAIN tour the camera is already at the vantage, so the cut is pixel-equivalent (a no-op). It precedes
    // dispatch('start') below, so it is in place before step 0's own actions (e.g. f1's focus) run.
    // STEP-0 ARBITRATION (v0.7 closure): SUPERSEDE the trail-frame channel UNCONDITIONALLY — idle starts
    // included — before the tour-start posture is requested. A NATURAL completion nulls `tour` WITHOUT cancelling
    // the channel (it routes engine 'done' → finish(), skipping stop()'s cancelTrailFrame so the final wide framing
    // converges during the last hold), so a completed tour's FINAL arrival shot survives PENDING (cancelled:false,
    // its close-up shot). The restart cancel above is gated on `tour !== null` — now FALSE after a completion — so on
    // a fresh replay nothing stands that stale shot down, and a deferred consume would apply it AFTER the tour-start
    // reset: the replay opens on the prior close-shot with focus cleared. cancelTourArrivalFrame drops it here.
    // Scoped to intent 'tour-arrival' inside the writer, so a NON-tour leftover (a pending finale/establish frame)
    // is a correct no-op — the tour-start reset already owns that posture. Does NOT touch trailHold.lit (the writer's
    // contract): step 0's own actions own the light. Redundant-but-harmless on a RESTART (the cancelTrailFrame above
    // already stood the ease down); the point is precisely the IDLE-after-completion path that guard skips.
    cancelTourArrivalFrame()
    requestTourStartFrame()
    tour = tour_
    engine = { stepIndex: -1, status: 'idle' }
    phase = 'static'
    playTarget = null
    ensureSubscribed()
    registerTourInterrupt(stop) // source-signaled interrupts: scrub/speed/keys/focus → notifyUserInput → stop
    dispatch('start')
  }

  // Run switch (model identity change) or unmount: the tour was scripted against the old run. Tear it
  // down WITHOUT a URL write (the new run owns the URL). No-op cheaply when no tour is active.
  function dispose(): void {
    if (tour === null) { clearTimers(); unsubscribe(); unregisterTourInterrupt(); return }
    finish(false) // run switch / unmount → restore the user's ladder speed (undo any witness pacing)
  }

  return { start, stop, dispose }
}

export function useTour(model: RunModel | null): TourHandle {
  const [view, setView] = useState<{ active: Tour | null; stepIndex: number; caption: string | null }>(
    { active: null, stepIndex: 0, caption: null },
  )

  // model is read through a ref so the once-built driver always sees the current model (to clamp play
  // targets to tickCount) without being rebuilt — the driver must persist across renders.
  const modelRef = useRef(model)
  modelRef.current = model

  // Exactly one driver per hook instance (useRef, not useMemo: useMemo may be discarded and recomputed,
  // which would silently drop a running tour's state).
  const driverRef = useRef<Driver | null>(null)
  if (driverRef.current === null) driverRef.current = createDriver(setView, modelRef)
  const driver = driverRef.current

  // Cleanup on run switch (model change) and on unmount.
  useEffect(() => driver.dispose, [model, driver])

  return { active: view.active, stepIndex: view.stepIndex, caption: view.caption, start: driver.start, stop: driver.stop }
}
