import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunModel } from '../model/runModel'
import type { TrustVerdict } from '../decode/verify'
import { loadRunIndex, useRun, type RunEntry } from './useRun'
import { Scene } from './Scene'
import { focusSelected, requestPovFrame } from './frameChannels'
import { Timeline } from './Timeline'
import { Ceremony } from './Ceremony'
import { ProvenancePanel } from './ProvenancePanel'
import { ThesisCard, ThesisChip } from './ThesisCard'
import { tourPastFirstBeat } from './thesis'
import { Inspector } from './Inspector'
import { HelpOverlay } from './HelpOverlay'
import { ErrorBoundary } from './ErrorBoundary'
import { TourOverlay } from './TourOverlay'
import { Hangar } from './hangarView'
import { CertificationWall, type CertificationWallHandle } from './wallView'
import { ROBUST_F3A, campaignSeedIds } from '../decode/campaignCatalog'
import { useCampaignStore } from '../state/campaignStore'
import { loadIsCurrent, readyTreeVisible, shouldBreakSeal, shouldSealRun } from './hangar'
import { mapKey, SPEEDS, shareSpeed } from './keyboard'
import { probeStorage, shouldArmZeroClick, type ZeroClickScope } from './coldOpen'
import { notifyUserInput } from '../tour/interrupt'
import { useTour } from '../tour/useTour'
import { TOURS, tourAdmitted, tourHandoffAction, hasTour } from '../tour/tours'
import { applyUrlOnLoad, syncUrl, useViewStore, DEFAULT_RUN } from '../state/viewStore'
import { parseCaptureFps, engageCapture, disengageCapture, captureClockOf, isCapturing } from '../state/captureClock'
import { buildShareUrl } from '../state/url'
import { readyAnnouncementText } from './ceremonyFormat'
import { queryStageApplies } from './queryStage'
import { sensingStageApplies } from './sensingStage'
import { honestyChipFor } from './lensRegistry'
import './app.css'

// The app's ONE piece of persistent state (Task v04-7; nudge reshaped by v0.5d bench R5c): a single
// localStorage key that retires the first-visit tour nudge forever — the nudge is a pulse TREATMENT of
// the one tour button (plus a quiet dismiss ×), retired once a tour has ever been started or the × is
// clicked. Deliberately one boolean key — no per-run bookkeeping.
const NUDGE_KEY = 'so.tourNudgeSeen'

// ZERO-CLICK THESIS (v0.6 T6, P2) — cold-open behavior, the SINGLE-POINT OWNER TOGGLE. The plan pins WHAT
// (auto cold-open first beat + verdict headline + independence line + copy-link) but NOT the scope, so this
// one constant is the seam the owner tunes (the T6 report flags the options — this is a DEFAULT, not a
// decision made for the owner):
//   'first-visit' — the auto-play + the card fire on a BARE cold open, once per browser, reusing the
//                   tour-nudge localStorage precedent (NUDGE_KEY) VERBATIM: no new persistence, no new key.
//   'always'      — every bare cold open (widen by dropping the !nudgeSeen gate — this constant is the
//                   only change; the arming predicate below already branches on it).
//   'off'         — veto: neither the auto-play nor the card ever fires (a returning-visitor-calm app).
const ZERO_CLICK_SCOPE: ZeroClickScope = 'first-visit'

// A cold open is a BARE load — no deep-link view state in the URL. A shared/deep link (?run=/?tick=/?ev=/…)
// is NEVER a cold open: it carries the visitor's intent, so the app lands exactly where it points and never
// hijacks it with an auto-tour (this also keeps every ?run= smoke test — and every shared URL — untouched).
// Captured ONCE at module eval, before applyUrlOnLoad/syncUrl can touch location.search.
const COLD_OPEN_AT_LOAD = typeof location !== 'undefined' && location.search.replace(/^\?/, '') === ''

// Capture entry point (rung 2): ?capture=<fps> engages the fixed-dt clock (flip regeneration invokes it —
// see docs/capture.md). null on every normal/shared load, so the live path is untouched; captured ONCE at
// module eval alongside COLD_OPEN_AT_LOAD. The clock is armed in an effect below, once the model is ready
// (tickCount) and its manifest dt_us is in hand. `?capture=` is NEVER emitted by encodeLink, so it can
// never ride a shared link into a visitor's browser.
const CAPTURE_FPS_AT_LOAD = typeof location !== 'undefined' ? parseCaptureFps(location.search) : null

// Screen-reader "ready" announcement (v0.4.1 a11y): the verification ceremony's live region unmounts
// at model publish, so the moment the app becomes interactive is otherwise silent to assistive tech.
// A live region only announces CHANGES, so this mounts EMPTY and fills a beat later — that content
// change is what fires the announcement.
//   The announcement is VERDICT-AWARE, not a blanket "verified". Only the schema/dialect gate returns
// early (a newer-dialect bundle routes to the gate screen and never reaches here); a hash/manifest mismatch
// does NOT gate — such a bundle publishes BY DESIGN (deliberate load-and-show) and every visual surface reads
// ✗/mismatch. So the AT must hear the same truth the ceremony shows: we thread the TRUST verdict (hashes.verdict
// — A2's seal fold, a discriminated verdict) through and let readyAnnouncementText carry it (manifest-verified
// vs. self-consistent vs. loaded-but-unverified). It is concrete by the time this mounts (see the helper's note
// + useRun's atomic model+hashes publish); the null/undefined branch is an unreachable defensive prior.
function ReadyAnnouncement({ runId, model, verdict }: {
  runId: string; model: RunModel; verdict: TrustVerdict | null | undefined
}) {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setMsg(
      readyAnnouncementText(runId, model.eventCount, model.tickCount, verdict)
    ), 100)
    return () => clearTimeout(t)
  }, [runId, model, verdict])
  return <div className="sr-only" role="status" aria-live="polite">{msg}</div>
}

// Query-stage honesty chip (binding honesty rule; v0.6 MUST-FIX, critic ruling 3). The chip speaks the e0
// lens's honesty line — "occluder & region bodies are scenario constants" — read THROUGH the registry
// (honestyChipFor('e0-query') === QUERY_STAGE_HONESTY, the registration's projection), so the rendered text
// and the ledger it must agree with have ONE source. It is TRUE only where the stage actually draws those
// bodies, so it self-gates on the COMPLETE applicability predicate (queryStageApplies — positionless AND kind-23
// draws; T6 M3), the SAME gate Scene's mount and the Inspector rail route through: a positionless run whose event
// kinds carry no kind-23 draws (f4) mounts no stage and wears no chip; a positioned run never applies either. The
// old split gate (App's outer positionless AND the chip's hasQueryDraws) is retired for the one predicate.
// Rendered UNDER the run-scoped <ErrorBoundary> (App mounts it inside <main>), and it builds the draws itself, so
// a malformed-bundle throw lands on the boundary fallback exactly as the stage's own build does. Memoised per
// model (the ShowTheMath / Scene precedent — a small pure pass, not worth threading a third copy through App).
function QueryStageChip({ model, tourActive }: { model: RunModel; tourActive: boolean }) {
  const applies = useMemo(() => queryStageApplies(model), [model])
  if (!applies) return null
  return <div className={tourActive ? 'scene-chip scene-chip-tour' : 'scene-chip'}>{honestyChipFor('e0-query')}</div>
}

// The SENSING GAUNTLET honesty chip (f2a) — the sibling of QueryStageChip. Self-gates on the ONE COMPLETE
// sensing predicate (sensingStageApplies — POSITIONED and kind-22 verdicts, the same arbitrated gate
// Scene's mount and stage-bounds selection route through), so it appears iff the sensing stage draws. Its
// wording is DERIVED from the f2a registration's ledger (SENSING_HONESTY, test-pinned to agree) and read
// THROUGH the registry (honestyChipFor('f2a-sensing')): the flight & eligibility are decoded-real; the
// sensor pose, FOV and occluder are scenario constants. A positioned run without kind-22 (f0/f1) wears no
// chip — and neither does a positionless run carrying kind-22 (its stage is withheld: no flight to tint),
// so the chip can never vouch for an apparatus that is not mounted.
function SensingChip({ model, tourActive }: { model: RunModel; tourActive: boolean }) {
  const hasSensing = useMemo(() => sensingStageApplies(model), [model])
  if (!hasSensing) return null
  return <div className={tourActive ? 'scene-chip scene-chip-tour' : 'scene-chip'}>{honestyChipFor('f2a-sensing')}</div>
}

// COPY-LINK PERMANENT HOME (v0.7 T5, debt #20 / LAW-4). The cold-open card's share weapon was card-only; this
// gives it a permanent home in the app chrome (the header) so the shareable-URL affordance is reachable at all
// times — not just during the transient cold-open card. A new ANSWER in an existing surface (LAW-4), never new
// chrome: the SAME copyShareLink, the same honest "copied ✓" feedback (never a false confirm if the clipboard
// is blocked — the label flips only on a resolved success, mirroring the card's copy handler verbatim).
function HeaderCopyLink({ onCopyLink }: { onCopyLink: () => Promise<boolean> }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = async () => {
    const ok = await onCopyLink()
    if (!ok) return // clipboard blocked (rare): leave the label so the user can retry — never a false "copied"
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }
  return <button className="header-copy" onClick={copy}>{copied ? 'link copied ✓' : 'copy link'}</button>
}

export default function App() {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  // The Hangar (T5b): a modal run-library front door reachable from the header — never a takeover of the
  // default view (owner-gate posture: DEFAULT_RUN is f1 post-hero-switch; the landing-route option is flagged, not taken).
  const [hangarOpen, setHangarOpen] = useState(false)
  // The Certification Wall (v0.8 W5): a modal campaign surface, peer to the Hangar (the same overlay idiom).
  // Reached from the Hangar's campaign entry; closing it cancels any in-flight verify (the Wall's own effect
  // cleanup fences the queue). z-index/keyboard modality mirror the Hangar exactly.
  const [wallOpen, setWallOpen] = useState(false)
  // OPEN-GENERATION counter (W5 F5). Bumped on every open so the Wall is KEYED to a fresh generation and REMOUNTS
  // each session — its component-local state (the gauge load, the verifying flag) starts fresh, so the first paint
  // after a reopen can never show a prior session's gauges or a stale cancel button.
  const [wallGen, setWallGen] = useState(0)
  // A handle to the mounted Wall's synchronous stop routine (abort the fetch, fence the queue, reset the store),
  // so the Esc close path can invoke the SAME teardown the close button + backdrop use — before `open` flips.
  const wallRef = useRef<CertificationWallHandle>(null)
  // Pending Hangar → tour handoff: a tour-card click switches the run and parks its id here; once that
  // run's model is ready the authored tour auto-starts (the effect below). null = no pending tour.
  const [pendingTour, setPendingTour] = useState<string | null>(null)
  // Under 900px the side panels are off-canvas overlays; these two header toggles slide one in at a
  // time (one-panel state, never both). Hidden ≥901px via CSS, so desktop ignores this entirely.
  const [panelOpen, setPanelOpen] = useState<'inspector' | 'provenance' | null>(null)
  // First-visit tour nudge. Seed from localStorage ONCE at mount (guarded — a disabled/private store
  // just means the chip reappears next visit, which is harmless). Set on first tour-start or dismiss.
  const [nudgeSeen, setNudgeSeen] = useState(() => {
    try { return localStorage.getItem(NUDGE_KEY) === '1' } catch { return false }
  })
  // Storage AVAILABILITY, probed ONCE at mount (W3), tracked SEPARATELY from nudgeSeen. A denied/throwing
  // store reads as nudgeSeen=false above — indistinguishable from a genuine first visit — so 'first-visit'
  // scope would auto-play on EVERY bare load (it can never persist that the visit happened). The probe
  // (read+write, no persisted key) lets the arming decision suppress the zero-click open entirely when the
  // store can't back 'first-visit', rather than replay it forever. Read-only after mount: private-mode
  // availability does not change within a session.
  const [storageOk] = useState(probeStorage)
  // ZERO-CLICK THESIS (T6): the cold-open card is open. Latched true ONCE by the arming effect below (a bare
  // cold open, first-visit or 'always' scope), dismissed by the card's ×. Held in state (not derived) so the
  // auto-tour's own nudge-retire (startTour → dismissNudge flips nudgeSeen) cannot yank the card mid-session.
  const [thesisOpen, setThesisOpen] = useState(false)
  // COLD-OPEN CARD COLLAPSE (T5, critic R6): once the auto-tour leaves its opening establishing beat the full
  // card collapses to a header verdict chip. A one-way LATCH (never re-expands mid-session; an interrupt that
  // resets the tour stepIndex must not bring the card back). The full card is a once-per-browser (first-visit)
  // surface: the first cold open's auto-play persists NUDGE_KEY, so a reload seeds nudgeSeen=true and the
  // zero-click arming rejects — a reload from the collapsed state is CALM (no card, no chip), never a repaint of
  // the full card; only cleared storage restores it. Rendering is gated on thesisOpen, so a dismiss/run-switch
  // that closes the card hides the chip too regardless of this latch.
  const [thesisCollapsed, setThesisCollapsed] = useState(false)
  // Fire-once guard for the zero-click arming (also the StrictMode double-invoke guard in dev; prod is single).
  const zeroClickFiredRef = useRef(false)
  // Prior runId for the W1 card-close effect. Seeded null and set on the effect's first run (mount), so the
  // effect closes the cold-open card ONLY on an actual run SWITCH — never on first paint, where the arming
  // effect legitimately opens it. (runId is always a concrete string, so null is an unambiguous "unseeded".)
  const prevRunIdRef = useRef<string | null>(null)
  // The keydown listener reads help-open via a ref (not the captured state) so it never goes stale
  // without re-registering the window listener on every toggle.
  const helpOpenRef = useRef(false)
  useEffect(() => { helpOpenRef.current = helpOpen }, [helpOpen])
  // Same ref pattern for the Hangar so the window keydown owner can modal-capture without re-registering.
  const hangarOpenRef = useRef(false)
  useEffect(() => { hangarOpenRef.current = hangarOpen }, [hangarOpen])
  // …and for the Wall (v0.8 W5): while it is open the transport keyboard is inert beneath it and Esc closes it.
  const wallOpenRef = useRef(false)
  useEffect(() => { wallOpenRef.current = wallOpen }, [wallOpen])
  // The unified Wall CLOSE (Esc + any programmatic close): run the mounted Wall's synchronous stop routine FIRST
  // (abort the in-flight fetch, fence the verify queue, reset the store), THEN flip `open`. Doing the teardown
  // synchronously — rather than leaning on the unmount cleanup alone — closes the window in which a late verify
  // 'done' could still write the store after close. Stable identity (the keydown owner closes over it).
  const closeWall = useCallback(() => { wallRef.current?.stop(); setWallOpen(false) }, [])
  const runId = useViewStore(s => s.runId)
  // Session-seal set (T5b): drives which Hangar cards wear the earned ✓. Event-rate (changes once per
  // newly-sealed run), so this App re-render never touches the frame path.
  const sealedRuns = useViewStore(s => s.sealedRuns)
  // Finale marker (v0.5b T3): reflect the store's ephemeral finale flag onto the scene container as a
  // deterministic, DOM-observable signal (data-finale on #viewport — mirrors the aria/ReadyAnnouncement
  // "state on a stable element" precedent). Event-rate (the flag flips once at natural-end and once on any
  // clear), so this App re-render never touches the frame path. The e2e smoke asserts on it.
  const finale = useViewStore(s => s.finale)
  useEffect(() => { applyUrlOnLoad() }, [])
  useEffect(() => { loadRunIndex().then(setRuns).catch(() => setRuns([])) }, [])
  const { model, gate, error, progress, phase, hashes, settling, loadedRunId } = useRun(runId)
  // Capture-clock arming (rung 2): only when ?capture= was present at load AND the model whose bytes are
  // showing is the one we asked for (loadIsCurrent — the same identity join the seal effect uses). The
  // clock derives from the MODEL ALONE (captureClockOf: tickCount + the model's own manifest dt_us — the
  // value parsed and verified with the loaded bytes); the runs/index metadata is deliberately NOT on this
  // path — it is a separate fetch that can fail/lag/go stale while the load succeeds, and deriving the
  // tier from it could silently arm a real-clock run as assumed. Disengages on teardown/run-switch so a
  // stale run's fixed delta can never outlive it. A no-op on every normal load
  // (CAPTURE_FPS_AT_LOAD === null), so the live frame loop is byte-identical.
  useEffect(() => {
    if (CAPTURE_FPS_AT_LOAD === null || !model || !loadIsCurrent(runId, loadedRunId)) return
    engageCapture(captureClockOf(model), CAPTURE_FPS_AT_LOAD)
    // Speed pin (round 3): capture pacing is speed-INDEPENDENT — captureSpeed pins the transport rate
    // multiplier to 1 while engaged, so the fps alone encodes the capture rate. Pin the STORE to 1× on a
    // successful arm too, so the speed UI reads the true effective rate (a ?speed=8&capture= deep link
    // would otherwise light 8× while capture plays at 1×). Later speed writes (keystroke, tour
    // witnessSpeed) are display-only during capture — the capture survives them deterministically (the
    // ruling and its rationale live on captureSpeed / docs/capture.md). Gated on isCapturing(): a
    // REFUSED arm must not touch the store — the live path stays behavior-identical (§8).
    if (isCapturing()) useViewStore.getState().setSpeed(1)
    return () => disengageCapture()
  }, [model, loadedRunId, runId])
  // Tour driver: one stable instance for the app's life, torn down + rebound on run switch (model
  // identity change) inside the hook. Called unconditionally here (before the early returns below) so
  // the hook order is stable across the ceremony/error/gate screens. The overlay + header button read
  // this handle; the header only mounts once model is ready, so `▶ tour` is inherently model-gated.
  const tour = useTour(model)
  // Run switch is a discrete navigation act. Reset the transport AND clear BOTH selections
  // (select(null,null), folded into the atomic setState) so no stale chain/selection carries into the
  // new run and no stale sel/ev is written into the new run's URL (I3). syncUrl(true) — an unforced
  // sync mid-navigation could be throttle-dropped, leaving the URL stale.
  const selectRun = (id: string) => {
    // finale:false is the invariant-before-publish clear (v0.5b T3, ruling 5): a natural-end finale must NEVER
    // bleed into the next run. The store singleton survives the run switch (only model/Canvas remount), so the
    // flag is reset atomically HERE — before the new run's Scene mounts — alongside the transport + selections.
    useViewStore.setState({ runId: id, tick: 0, fraction: 0, playing: false, selectedEntity: null, selectedEvent: null, finale: false })
    syncUrl(true)
  }

  // Retire the nudge (persist + hide) and start the current run's tour. Both the chip's CTA and the
  // header ▶ tour button route through here so "a tour was ever started" reliably dismisses the nudge.
  const dismissNudge = () => {
    setNudgeSeen(true)
    try { localStorage.setItem(NUDGE_KEY, '1') } catch { /* storage disabled: nudge simply returns next visit */ }
  }
  const startTour = () => { dismissNudge(); tour.start(TOURS[runId]!) }

  // COPY-LINK — the share weapon (T6, P2). Build the shareable URL for the CURRENT view from the URL grammar
  // (run/tick/sel/ev/speed) and copy it. Verification state NEVER rides the URL (the NEVER-list): the link
  // reproduces the VIEW, and the recipient's own browser re-verifies from the bytes. Returns success so the
  // card can show honest "copied" feedback (never a false confirm if the clipboard is blocked).
  const copyShareLink = async (): Promise<boolean> => {
    const s = useViewStore.getState()
    // W2 — never serialize a tour's OFF-LADDER witness pace. During the auto-played cold-open tour (and any
    // tour) the store's `speed` is a presentation artifact, not a user choice; shareSpeed collapses it to the
    // resting ladder default so the link reproduces the resting VIEW (mirrors Timeline's off-ladder guard and
    // its natural-end sync's isTourActive skip). An on-ladder user speed rides through unchanged.
    const url = buildShareUrl(location.origin, location.pathname, {
      run: s.runId, tick: s.tick, sel: s.selectedEntity, ev: s.selectedEvent, speed: shareSpeed(s.speed),
    })
    try { await navigator.clipboard.writeText(url); return true } catch { return false }
  }
  // Dismiss the cold-open thesis card. Also stops the auto-started tour (stop() is idempotent — a no-op if it
  // already ended or was interrupted): × means "let me look around", so the guided narration ends with it.
  const dismissThesis = () => { setThesisOpen(false); tour.stop() }

  // Hangar card actions. Both close the front door; the tour action ALSO parks a pending-tour request so
  // the authored tour auto-starts once the switched-to run is ready (see the effect below).
  const openRunFromHangar = (id: string) => { setHangarOpen(false); selectRun(id) }
  const openTourFromHangar = (id: string) => { setHangarOpen(false); selectRun(id); setPendingTour(id) }

  // SESSION-SEAL RECONCILIATION (T5b, D4 checkmark economy; W1 seal-race fix + closure item 1): when THIS
  // run's own bytes have finished verifying (loadedRunId === runId — identity carried with the data, the
  // load-bearing W1 guard: on the commit right after a run switch the store runId has already flipped but
  // useRun still holds the PRIOR run's model/hashes), reconcile the seal set with the verdict:
  //   • verified (matchesTrailer)  → recordSeal(runId, resultId): fresh seal, no-op on the same bytes, or
  //     REPLACE when a re-load verified DIFFERENT bytes (the ✓ names exactly what it saw).
  //   • mismatched (✗ by design)   → breakSeal(runId): a previously-sealed card flips to the alarm ✗ voice
  //     (a stale green over demonstrably-mismatching bytes would contradict D4's "✗ escalates and
  //     persists"); a never-sealed run stays attested. shouldBreakSeal carries the same identity join, so
  //     a stale ✗ from the run we just switched AWAY from can never revoke the destination's seal.
  // Both store actions are reference-stable no-ops on repeat, so the re-fire on every ready re-render is
  // inert after the first.
  useEffect(() => {
    if (!hashes) return
    // A2 — the seal binds to the TRUST verdict, not matchesTrailer: a full-manifest run whose recomputed pins
    // do not match the manifest must NEVER mint a seal (verdict 'mismatch'), even though its event/state hashes
    // reproduce the trailer. A run seals when its verdict is NOT a mismatch (manifest-verified OR self-consistent
    // — the seal predicates stay the identity-join×boolean primitive; the Hangar's cardVerdict renders a det-only
    // self-consistent seal in the ATTESTED voice, never the manifest-grade green, keyed on entry.detOnly).
    const sealed = hashes.verdict !== 'mismatch'
    if (shouldSealRun(runId, loadedRunId, sealed)) {
      useViewStore.getState().recordSeal(runId, hashes.resultId)
    } else if (shouldBreakSeal(runId, loadedRunId, sealed)) {
      useViewStore.getState().breakSeal(runId)
    }
  }, [hashes, runId, loadedRunId])

  // HANGAR → TOUR handoff (T5b; F1 — the third tour entry point, now on the ONE admission predicate). Once the
  // run parked by a tour card is ready, start its authored tour. The guards, in order:
  //   • pendingTour !== runId → not our pending run (or none): do nothing.
  //   • model absent OR NOT loadIsCurrent → the destination is still LOADING (a stale prior model during the
  //     switch gap is non-null but names the PRIOR run): WAIT — never start against old data, never consume
  //     pendingTour (the pre-F1 bug: a `model && …` gate started the destination's choreography on the prior
  //     run's bytes and cleared pendingTour, so the real destination never got its tour).
  //   • resident + current → tourAdmitted decides: admit (start) on a non-mismatch run with a tour, else REFUSE
  //     (a mismatch destination's det-only captions claim a self-check it did not earn). Either way CONSUME
  //     pendingTour — start on a valid admit, or drop a doomed request (reason discarded) so it never re-fires.
  //   • F6 — CANCEL the parked intent on navigation to a DIFFERENT run OR a terminal load error for the pending
  //     destination: the intent was "tour X on ARRIVAL", so a later plain-open of X must never inherit it. `error`
  //     is a dep + input so the effect re-runs (and cancels) the instant the destination's own load fails.
  // Deps include loadedRunId + hashes + error so the effect re-runs when the gap closes, the verdict arrives, or
  // the load fails. The decision is the pure tourHandoffAction (unit-tested); App only dispatches its side effects.
  useEffect(() => {
    const action = tourHandoffAction(pendingTour, runId, !!model, loadedRunId, hashes?.verdict, !!error)
    if (action === 'start') { startTour(); setPendingTour(null) }
    // 'refuse' drops a doomed request; 'cancel' drops an abandoned/failed intent; both consume. 'wait'/'idle' leave it parked.
    else if (action === 'refuse' || action === 'cancel') setPendingTour(null)
  }, [model, pendingTour, runId, loadedRunId, hashes, error])

  // ZERO-CLICK THESIS arming (T6, P2; W3 storage-availability fix): on a BARE cold open, once the run is
  // ready, open the thesis card AND auto-play the first tour beat. The whole predicate is the pure
  // shouldArmZeroClick — scope toggle + cold-open signal + a tour existing + (for 'first-visit') an UNSEEN
  // marker AND an AVAILABLE store (W3: a denied store can't back 'first-visit', so suppress rather than
  // replay every visit). startTour() dismisses the nudge, so the pulse treatment never also fires (the
  // auto-play IS the discoverability — one cold-open voice, not two). The fire-once ref makes it idempotent
  // (and dev-StrictMode-safe). Deps [model] match the sibling effects (this eslint config does not enforce
  // exhaustive-deps); the predicate reads runId/nudgeSeen/storageOk fresh this pass.
  useEffect(() => {
    if (!model || zeroClickFiredRef.current) return
    // F1 — WHETHER a tour may start is the ONE admission predicate (identity + verdict + tour-exists). This
    // subsumes the old inline `hashes?.verdict === 'mismatch'` guard (a mismatch run's det-only captions claim a
    // self-check the bytes did not earn) and the `!!TOURS[runId]` existence check. Shipped det-only runs are
    // always self-consistent, so it never withholds in production — it makes the static self-check copy honest.
    if (!tourAdmitted(runId, !!model, loadedRunId, hashes?.verdict)) return
    // …and WHEN to auto-open is the orthogonal cold-open decision (scope + bare load + unseen marker + storage).
    // hasTour is already proven by tourAdmitted above; pass it explicitly so the two stay single-sourced.
    if (!shouldArmZeroClick(ZERO_CLICK_SCOPE, COLD_OPEN_AT_LOAD, hasTour(runId), nudgeSeen, storageOk)) return
    zeroClickFiredRef.current = true
    setThesisOpen(true)
    startTour() // auto-play the first tour beat — interruptible by ANY transport input (existing grammar)
  }, [model])

  // COLD-OPEN CARD COLLAPSE (T5, critic R6): the full card holds through beat 0 (its cold-open share moment —
  // authored beside f1's establishing shot), then collapses to the header verdict chip once the auto-tour
  // reaches its first playback beat (tourPastFirstBeat: this run's tour active AND stepIndex ≥ 1). Latched
  // one-way — an interrupt that finishes the tour (stepIndex→0) can never re-expand the card. The full card
  // never returns on a reload either: it is a once-per-browser first-visit surface (the first cold open
  // persisted NUDGE_KEY, so a reload's zero-click arming rejects on nudgeSeen — the reload is calm, no card and
  // no chip); only cleared storage restores it. Gated on thesisOpen so it tracks ONLY the auto-played cold-open
  // card, never a manually-started tour (which never opens the card). Deps match the siblings (no exhaustive-deps).
  useEffect(() => {
    if (thesisOpen && !thesisCollapsed && tourPastFirstBeat(tour.active?.runId === runId, tour.stepIndex)) {
      setThesisCollapsed(true)
    }
  }, [thesisOpen, thesisCollapsed, tour.active, tour.stepIndex, runId])

  // W1(a) — CLOSE THE COLD-OPEN CARD ON ANY RUN SWITCH. The thesis card is a cold-open artifact: it reads the
  // opening run's verdict and speaks the zero-click thesis. A run switch (Hangar card / run-switcher) makes
  // that narrative stale — worse, it would leave the PRIOR run's ✓ painted under the NEW run's name for the
  // one-commit identity window (the seal-race twin; the verdict prop's withhold guard is the second belt).
  // Closing it on navigation is the honest move. The prevRunIdRef seed makes this fire ONLY on a real switch,
  // never on mount (where the arming effect owns opening it); the once-latched arming ref never re-opens it.
  useEffect(() => {
    if (prevRunIdRef.current === null) { prevRunIdRef.current = runId; return }
    if (prevRunIdRef.current !== runId) { prevRunIdRef.current = runId; setThesisOpen(false) }
  }, [runId])

  useEffect(() => {
    if (!model) return
    const t = useViewStore.getState().tick
    if (t > model.tickCount) useViewStore.getState().setTick(model.tickCount)
    // Stale selection clamp: a deep link (or a run-switch) can leave selectedEvent pointing past
    // the new model's event range. An out-of-range seq crashes chain code (e.g. childrenOf(seq)
    // spreads undefined), so clear the selection rather than let it reach chainTicks/causalChain.
    const selectedEvent = useViewStore.getState().selectedEvent
    if (selectedEvent !== null && selectedEvent >= model.eventCount) {
      useViewStore.getState().select(useViewStore.getState().selectedEntity, null)
    }
  }, [model])

  // Single keyboard owner (Timeline's Space handler was removed). Maps the video-editor transport
  // grammar to store actions; a focused button is blurred first so the browser's own Space/Enter
  // "click the button" never double-fires alongside our toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return // never steal keystrokes from an active IME composition
      // Grammar is inert until a model is loaded: on the ceremony/gate/error screens (no header, no
      // transport) a stray Space must NOT pre-arm playback for the run that's still decoding.
      if (!model) return
      // Hangar modal capture (T5b): the run library is a modal front door — the transport keyboard is
      // inert beneath it, and Esc closes it (symmetric with the help overlay's modal capture). The
      // backdrop click and the close button are the pointer paths; this is the keyboard path.
      if (hangarOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); setHangarOpen(false) }
        return
      }
      // Wall modal capture (W5): the campaign surface is a modal too — the transport keyboard is inert beneath
      // it, and Esc closes it THROUGH the same synchronous stop routine the close button + backdrop use (F5):
      // closeWall tears the session down (abort/fence/reset) before flipping `open`, never leaving it to the
      // passive unmount cleanup alone. The next open remounts a fresh Wall (the wallGen key).
      if (wallOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); closeWall() }
        return
      }
      const t = e.target as HTMLElement
      const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable
      const action = mapKey(e.code, e.key, editable, e.ctrlKey || e.metaKey || e.altKey)
      if (!action) return
      e.preventDefault()
      // Modal capture: while help is open the overlay owns the keyboard. preventDefault already fired
      // above (so Space can't scroll or activate a button), and here every mapped transport key is
      // swallowed EXCEPT the two that operate the modal itself — Esc (deselect→close) and ? (help
      // →toggle). Unmapped keys returned before preventDefault and pass through untouched.
      if (helpOpenRef.current && action.type !== 'deselect' && action.type !== 'help') return
      // Auto-repeat (held key): swallow repeated toggles — one Space/K = one play-pause, not a
      // machine-gun. Arrow-step repeat is deliberately kept (held → scrub) and falls through.
      if (e.repeat && action.type === 'toggle') return
      if (t instanceof HTMLButtonElement) t.blur() // kills the spacebar double-toggle on a focused button
      // Snapshot the transport state BEFORE notifyUserInput(): a running tour's stop() (invoked
      // synchronously below) mutates playing=false, so reading getState() AFTER the notify would hand
      // 'toggle' a post-stop playing=false and flip it back to true instead of pausing. Capturing here
      // means st.playing reflects what the user actually saw right before the tour-interrupt fired.
      const st = useViewStore.getState()
      // Source-signal a running tour BEFORE dispatching any transport action — this is the ONLY channel
      // that sees speed/focus keys (they never touch selectedEvent/tick in a way the delta detector can
      // read) and a keyboard scrub during a play step (tick writes are expected then). EXCEPTION: 'help'
      // — opening the shortcuts overlay is not taking control of the transport and must not kill a
      // running tour (judgment call; deselect/Esc, which the user means as "get me out", still does).
      // A second exception: 'deselect' while help is open is a pure modal-close (below), symmetric with
      // 'help' not killing a tour on OPEN — closing the overlay shouldn't kill one either.
      if (action.type !== 'help' && !(action.type === 'deselect' && helpOpenRef.current)) notifyUserInput()
      switch (action.type) {
        case 'toggle': st.setPlaying(!st.playing); if (st.playing) syncUrl(true); break
        case 'step': st.setPlaying(false); st.setTick(Math.max(0, Math.min(model?.tickCount ?? 0, st.tick + action.delta))); syncUrl(); break
        case 'speed': st.setSpeed(action.value); break
        case 'speedNotch': {
          // ORDERING DEPENDENCY: notch from a FRESH speed read, NOT the pre-notify `st` snapshot. During
          // a tour `st.speed` is the OFF-LADDER witness rate → indexOf === -1 → the notch would fall back
          // to 1×. notifyUserInput() above already ran the tour's synchronous speed restore (→ savedSpeed),
          // so the store now holds the user's true ladder speed — read it here to notch from that.
          const cur = useViewStore.getState().speed
          const i = SPEEDS.indexOf(cur as typeof SPEEDS[number])
          st.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + action.dir))]!)
          break
        }
        case 'deselect':
          if (helpOpenRef.current) setHelpOpen(false)
          else { st.select(null, null); syncUrl(true) }
          break
        case 'help': setHelpOpen(h => !h); break
        case 'focus': focusSelected(); break
        // Observer's Eye (T4b): request the POV ease. notifyUserInput() above already stopped any running
        // tour (a camera takeover, like focus) — the reused trail-frame owner then eases to the observer vantage.
        case 'pov': requestPovFrame(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [model])

  if (error) return (
    <div className="screen error">
      <h1>decode failed</h1>
      <pre>{error}</pre>
      {/* Recovery affordance layered on the adjudicated honest-error posture: the full
          error text above STAYS — this only adds one action. Routed through selectRun, the exact
          header-nav run-switch path, so URL + store + reload semantics are identical to a normal switch.
          Guarded on runId !== DEFAULT_RUN: when the default run ITSELF failed, an "open the default"
          button would be a retry lie, so it does not render. */}
      {runId !== DEFAULT_RUN && (
        <button onClick={() => selectRun(DEFAULT_RUN)}>open {DEFAULT_RUN} instead</button>
      )}
    </div>
  )
  if (gate && !gate.ok) return (
    <div className="screen gate">
      <h1>this bundle speaks a newer dialect</h1>
      <p><code>{gate.field}</code></p>
      <p>expected <code>{gate.expected}</code></p>
      <p>found <code>{gate.actual}</code></p>
    </div>
  )
  // I6 — the current-load identity witness gates the WHOLE ready subtree, not just the thesis verdict + seals.
  // The production gate IS the tested helper readyTreeVisible(model, runId, loadedRunId) — consumed here, never a
  // hand-inlined twin of its logic (M5: the tested gate and the production gate must be the same function). The
  // ready tree paints only when a model is present AND it belongs to the current run; the two ways it fails are
  // the two loading postures:
  //   • no model yet (a genuine load): show the REAL ceremony phase/hashes/progress as they arrive.
  //   • the one-commit run-switch gap (model non-null but naming the PRIOR run — loadedRunId !== runId, useRun's
  //     reset effect not yet run): show a FRESH loading posture and SUPPRESS the prior hashes, so no prior-run ✓
  //     glyph — not the ceremony tick, and not (below this gate) the Provenance ✓ rows or the stage — ever paints
  //     under the destination's identity. ONE gate closes the class the seal-race + thesis fixes each patched per
  //     surface. The trailing `|| !model` is redundant at runtime (readyTreeVisible already requires model !==
  //     null) but lets TS narrow `model` non-null for the ready tree below — a type-only restatement of the
  //     helper's presence conjunct, not a second copy of the identity rule.
  if (!readyTreeVisible(model, runId, loadedRunId) || !model) {
    const switchGap = model !== null // reached here only when !current, so a non-null model IS the stale prior run
    return <Ceremony phase={switchGap ? 'fetching' : phase} progress={switchGap ? 0 : progress} hashes={switchGap ? null : hashes} settling={switchGap ? false : settling} />
  }

  // The cold-open verdict, joined by IDENTITY (loadIsCurrent) so a prior run's ✓ never paints under a new run's
  // name — WITHHELD (null) when the resident hashes don't belong to the run on stage or none exist (W1 fail-safe,
  // never a false green). It is the TRUST verdict itself (A2 — the seal fold): a manifest-mismatching run reads ✗
  // here, a det-only run reads ○ self-consistent (never the manifest-grade green), a manifest-verified run ✓.
  // Shared by the full card and its collapsed header chip so both speak one verdict voice.
  const thesisVerdict = loadIsCurrent(runId, loadedRunId) && hashes ? hashes.verdict : null

  return (
    <div className="app">
      {/* SR-only: announces the run's VERDICT (verified, or loaded-but-unverified on a trailer
          mismatch) once the app is interactive (see component note). */}
      <ReadyAnnouncement runId={runId} model={model} verdict={hashes?.verdict} />
      <header>
        {/* Identity lockup: the favicon's radar mark (same paths, same cyan) locked left of the
            wordmark — the browser-tab identity carried into the app chrome. Decorative, so aria-hidden. */}
        <div className="wordmark">
          <svg className="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <circle cx="16" cy="16" r="15" fill="#080b0f" />
            <g fill="none" stroke="#56b6ff" strokeLinecap="round">
              <circle cx="16" cy="16" r="11" strokeWidth="1.5" opacity="0.35" />
              <circle cx="16" cy="16" r="6.5" strokeWidth="1.5" opacity="0.6" />
              <path d="M16 16 L24.5 7.5" strokeWidth="1.6" opacity="0.9" />
            </g>
            <circle cx="16" cy="16" r="1.8" fill="#56b6ff" />
            <circle cx="22.6" cy="11.4" r="2" fill="#56b6ff" />
          </svg>
          <h1>swarm observatory</h1>
        </div>
        {/* Run switcher surfaces the runs/index.json titles as native tooltips (v0.5d bench R5b) — the
            smallest honest surface: the ids stay the compact switch labels, the authored titles ("E0
            geometry sweep (golden, det-only)") answer "which run is this?" on hover/focus. */}
        <nav>{runs.map(r => <button key={r.id} title={r.title} className={r.id === runId ? 'active' : ''} onClick={() => selectRun(r.id)}>{r.id}</button>)}</nav>
        {/* The Hangar front door (T5b): opens the run-library overlay. Placed beside the run switcher —
            the least-invasive coherent entry (reachable from the header, not a takeover of the default view).
            Gated on runs so it never opens an empty library. */}
        {runs.length > 0 && (
          <button className="hangar-open" onClick={() => setHangarOpen(true)}>hangar</button>
        )}
        {/* Guided-tour launcher: shown only when an authored tour exists for the current run. The
            header renders only after the model is ready (past the !model gate), so model-readiness is
            already guaranteed here. Clicking starts (restart-safe); interrupts are source-signaled and
            the overlay's × calls stop() — no keyboard key is bound (transport grammar is frozen).
            ONE tour CTA (v0.5d bench R5c): the first-visit nudge is a TREATMENT of this button (the
            accent wash + nudge-pulse ring, plus the quiet dismiss ×), never a second button — two CTAs
            for one action made the chrome compete with itself. Starting a tour or dismissing retires
            the treatment forever (NUDGE_KEY). */}
        {/* F1 — the ▶ button is the third tour entry point, gated on the ONE admission predicate (tour-exists +
            identity + verdict): withheld on a MISMATCH run (its det-only captions claim a self-check the mismatched
            bytes did not earn), admitted for every honest run. model is non-null here (past the readyTree gate) and
            loadIsCurrent holds, so tourAdmitted reduces to "a tour exists AND the current verdict isn't a mismatch". */}
        {tourAdmitted(runId, !!model, loadedRunId, hashes?.verdict) && (
          <div className="tour-launch">
            <button
              className={!nudgeSeen && !tour.active ? 'tour-start tour-nudge-cta' : 'tour-start'}
              onClick={startTour}
            >▶ tour</button>
            {!nudgeSeen && !tour.active && (
              <button className="tour-nudge-x" aria-label="dismiss tour nudge" onClick={dismissNudge}>×</button>
            )}
          </div>
        )}
        {/* Copy-link permanent home (T5, #20): the share weapon, now always reachable in the app chrome — not
            only inside the transient cold-open card. Gated on runs so it never offers a link before a run loaded. */}
        {runs.length > 0 && <HeaderCopyLink onCopyLink={copyShareLink} />}
        {/* Collapsed cold-open card (T5, critic R6): once the auto-tour leaves beat 0 the full card becomes this
            header verdict chip — the existing verdict voice, × still dismisses. Gated on thesisOpen && collapsed. */}
        {thesisOpen && thesisCollapsed && <ThesisChip verdict={thesisVerdict} onDismiss={dismissThesis} />}
        {/* Mobile-only (CSS-hidden ≥901px). Each toggle opens its panel and closes the other. */}
        <div className="panel-toggles">
          <button onClick={() => setPanelOpen(p => (p === 'inspector' ? null : 'inspector'))}>☰ agent</button>
          <button onClick={() => setPanelOpen(p => (p === 'provenance' ? null : 'provenance'))}>☰ provenance</button>
        </div>
        {/* Visible help affordance: discoverable without knowing the ?-shortcut (some layouts need
            AltGr for ?). Opens the same overlay the ? key toggles; focus moves into the modal on open. */}
        <button className="help-toggle" aria-label="keyboard shortcuts" onClick={() => setHelpOpen(true)}>?</button>
      </header>
      {/* Keyed on runId so a caught error clears when the operator switches runs (fresh boundary). */}
      <ErrorBoundary key={runId}>
        <Inspector model={model} open={panelOpen === 'inspector'} />
        {/* stage-enter: the CEREMONY HANDOFF (T6, R6) — a one-shot CSS fade-up as the stage takes over from
            the load ceremony (the stage "fades up beneath" while the confirmed hash lines settle into their
            provenance rows). Fires on this element's mount, i.e. exactly at the ceremony→app handoff; no rAF,
            no frame work, no fake delay (§8 load budget holds). Reduced-motion collapses it to an instant show. */}
        <main id="viewport" className="stage-enter" data-finale={finale ? 'true' : 'false'}>
          <Scene model={model} />
          {/* Honesty chip: the query stage's probe geometry is decoded-real, but the occluder & region
              BODIES (sphere / box / triangle) are scenario constants, not bundle state — the chip states
              exactly that (QUERY_STAGE_HONESTY). QueryStageChip self-gates on the COMPLETE applicability
              predicate (queryStageApplies — positionless AND kind-23 draws; T6 M3), the same gate Scene's mount
              uses, so it appears iff the stage actually draws those bodies (never over f4's void, never on a
              positioned run) — no App-side outer gate to drift from the mount. TOUR POSTURE (v0.5d bench R7c,
              honesty priority): while this run's tour caption bar is up it can occlude the chip's lower-left
              berth — the chip is the honesty contract and is NEVER covered, so it lifts to the viewport's
              top-left for the tour's duration (CSS). The class flips at tour start/stop (event-rate re-render
              App already does), never on the frame path. */}
          <QueryStageChip model={model} tourActive={tour.active?.runId === runId} />
          {/* The sensing chip is the honesty contract for f2a (a POSITIONED-run lens); it self-gates on
              sensingStageApplies and lifts above the tour caption exactly as the query chip does. */}
          <SensingChip model={model} tourActive={tour.active?.runId === runId} />
        </main>
        <ProvenancePanel model={model} open={panelOpen === 'provenance'} />
        <Timeline model={model} />
      </ErrorBoundary>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* The Hangar run-library overlay (T5b). DOM/React only — no WebGL, no frame loop (§8). tourRunIds
          = the runs with authored tours (their cards make the tour the primary action). */}
      <Hangar
        open={hangarOpen}
        runs={runs}
        currentRunId={runId}
        sealedRuns={sealedRuns}
        loadedRunId={loadedRunId}
        loadedResultId={hashes?.resultId ?? null}
        tourRunIds={Object.keys(TOURS)}
        onClose={() => setHangarOpen(false)}
        onOpenRun={openRunFromHangar}
        onOpenTour={openTourFromHangar}
        onOpenWall={() => {
          setHangarOpen(false)
          // Seed the campaign store AT THE OPEN ACTION — synchronously, BEFORE the keyed Wall mounts (W5). Render 1
          // of that fresh mount then reads a store already at 0-of-50 in ANY lane, so the first painted frame is
          // correct with no dependence on effect timing (the Wall's layout-effect seed can't own the first frame:
          // zustand subscribes in a passive effect, so a default/transition-lane mount would paint 0-of-0 for one
          // frame). The Wall keeps its layout-effect seed as the StrictMode-replay backstop; both are idempotent.
          useCampaignStore.getState().init(campaignSeedIds(ROBUST_F3A))
          setWallGen(g => g + 1)
          setWallOpen(true)
        }}
      />
      {/* The Certification Wall (W5): the campaign surface. DOM/React only — no WebGL, no frame loop (§8). Peer
          modal to the Hangar. Rendered ONLY while open AND keyed on the open-generation counter, so each open is
          a fresh MOUNT (F5): the first paint after a reopen shows the loading state + 0-of-50 census + verify-all
          CTA, never a prior session's gauges or cancel button. Esc/close route through closeWall (synchronous
          stop); the Wall's own button + backdrop stop it directly, so every close path fences the queue. */}
      {wallOpen && <CertificationWall key={wallGen} ref={wallRef} onClose={() => setWallOpen(false)} />}
      {/* Run-scoped guard: runId flips synchronously on selectRun, but useTour's dispose effect is
          keyed on `model` (not runId), so it only tears the old driver down one effect-pass later —
          when useRun's runId-keyed effect re-fires and nulls model IMMEDIATELY (at decode START, before
          the new run's bytes even arrive), not "after the new run finishes decoding" as this comment
          used to claim. In the gap between the runId flip and that null-out, a stale tour.active from
          the PREVIOUS run's driver can render for one pass, flashing the wrong tour's overlay over the
          new run. Comparing the active tour's own runId to the current runId closes the gap. */}
      {tour.active?.runId === runId && (
        <TourOverlay active={tour.active} stepIndex={tour.stepIndex} caption={tour.caption} onStop={tour.stop} />
      )}
      {/* THE ZERO-CLICK THESIS CARD (T6, P2): the cold-open surface — verdict headline (the run's REAL verify
          result), the in-app independence line, and the copy-link share weapon. Opened by the arming effect on
          a bare cold open; held until × so the share affordance survives an auto-tour interrupt.
          W1(b/c) — the verdict is passed ONLY when the resident hashes provably belong to the run on stage
          (loadIsCurrent joins loadedRunId===runId, the same primitive the seal effect gates on) AND hashes
          exist; otherwise it is WITHHELD (null → no glyph/subline). This kills the old `?? true` fail-GREEN:
          on the most trust-critical surface a blank beats painting a prior run's ✓ under a new run's name. */}
      {thesisOpen && !thesisCollapsed && (
        <ThesisCard
          verdict={thesisVerdict}
          onCopyLink={copyShareLink}
          onDismiss={dismissThesis}
        />
      )}
    </div>
  )
}
