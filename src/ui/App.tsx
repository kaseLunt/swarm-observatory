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
import { GateScreen } from './GateScreen'
import { TourOverlay } from './TourOverlay'
import { Hangar } from './hangarView'
import { CertificationWall, type CertificationWallHandle } from './wallView'
import { EvidenceTable } from './evidenceTableView'
import { HeaderMenu } from './HeaderMenu'
import { useHeaderTier } from './useHeaderTier'
import { headerLayout } from './headerModel'
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
import { commsStageApplies, buildCommsStage, commsChipCopy } from './commsStage'
import { trackBeliefApplies, buildTrackBelief, trackBeliefChipCopy } from './trackBelief'
import { honestyChipFor } from './lensRegistry'
import './app.css'

// The app's ONE piece of persistent state: a single
// localStorage key that retires the first-visit tour nudge forever — the nudge is a pulse TREATMENT of
// the one tour button (plus a quiet dismiss ×), retired once a tour has ever been started or the × is
// clicked. Deliberately one boolean key — no per-run bookkeeping.
const NUDGE_KEY = 'so.tourNudgeSeen'

// ZERO-CLICK THESIS (v0.6) — cold-open behavior, the SINGLE-POINT OWNER TOGGLE. The plan pins WHAT
// (auto cold-open first beat + verdict headline + independence line + copy-link) but NOT the scope, so this
// one constant is the seam the owner tunes (the design report flags the options — this is a DEFAULT, not a
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
// — the seal fold, a discriminated verdict) through and let readyAnnouncementText carry it (manifest-verified
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

// Query-stage honesty chip (binding honesty rule; a design-review ruling). The chip speaks the e0
// lens's honesty line — "occluder & region bodies are scenario constants" — read THROUGH the registry
// (honestyChipFor('e0-query') === QUERY_STAGE_HONESTY, the registration's projection), so the rendered text
// and the ledger it must agree with have ONE source. It is TRUE only where the stage actually draws those
// bodies, so it self-gates on the COMPLETE applicability predicate (queryStageApplies — positionless AND kind-23
// draws), the SAME gate Scene's mount and the Inspector rail route through: a positionless run whose event
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

// The CONTESTED-LINK honesty chip (f4) — the third sibling. Self-gates on the ONE complete comms predicate
// (commsStageApplies — positionless AND comms-kinds AND no kind-23), the same arbitrated gate Scene's mount and
// the Inspector strip route through, so it appears iff the comms stage draws. The INVARIANT honesty claim is the
// registration's projection (COMMS_HONESTY, read through the registry): decoded-real, presentational placement,
// sent-vs-arrived. The RUN-SPECIFIC summary (the counts, the "steady link · SNR constant" clause, the "one lost
// packet" language) is DERIVED per-run from the decoded content (commsChipCopy) so it can never over-claim on
// other data — a send-only source reads its own honest 1/0/0, never the f4 story.
function CommsChip({ model, tourActive }: { model: RunModel; tourActive: boolean }) {
  const hasComms = useMemo(() => commsStageApplies(model), [model])
  const copy = useMemo(() => (hasComms ? commsChipCopy(buildCommsStage(model)) : null), [hasComms, model])
  if (!hasComms || copy === null) return null
  return <div className={tourActive ? 'scene-chip scene-chip-tour' : 'scene-chip'}>{honestyChipFor('f4-comms')} · {copy}</div>
}

// The BELIEF honesty chip (f3a) — the fourth sibling. Self-gates on the ONE complete belief predicate
// (trackBeliefApplies — POSITIONED AND track updates AND no kind-22), the same arbitrated gate Scene's mount and the
// Inspector strip route through, so it appears iff the belief stage draws. The INVARIANT honesty claim is the
// registration's projection (TRACK_BELIEF_HONESTY, read through the registry): the ring is the tracker's own decoded
// estimate and the drone flies the decoded state truth, so the gap between them is the tracker's actual error — a real
// belief-vs-reality comparison, both halves decoded. The RUN-SPECIFIC summary (the shrink + the actual-error growth,
// or the fail-closed degradation) is DERIVED per-run from the decoded content (trackBeliefChipCopy) so it can never
// over-claim on other data.
function BeliefChip({ model, tourActive }: { model: RunModel; tourActive: boolean }) {
  const hasBelief = useMemo(() => trackBeliefApplies(model), [model])
  const copy = useMemo(() => (hasBelief ? trackBeliefChipCopy(buildTrackBelief(model)) : null), [hasBelief, model])
  if (!hasBelief || copy === null) return null
  return <div className={tourActive ? 'scene-chip scene-chip-tour' : 'scene-chip'}>{honestyChipFor('f3a-track')} · {copy}</div>
}

// COPY-LINK PERMANENT HOME (v0.7, LAW-4). The cold-open card's share weapon was card-only; this
// gives it a permanent home in the app chrome (the header) so the shareable-URL affordance is reachable at all
// times — not just during the transient cold-open card. A new ANSWER in an existing surface (LAW-4), never new
// chrome: the SAME copyShareLink, the same honest "copied ✓" feedback (never a false confirm if the clipboard
// is blocked — the label flips only on a resolved success, mirroring the card's copy handler verbatim).
// The header ladder condenses copy-link in three steps as the viewport narrows, so this ONE component
// carries three presentations of the SAME copy action + the same honest "copied" feedback (the label
// flips only on a resolved success — never a false confirm if the clipboard is blocked):
//   • 'label'    — full tier: the "copy link" / "link copied ✓" text button (the visible text IS the
//                  accessible name, so the success is announced to assistive tech).
//   • 'icon'     — condensed tier: the ⧉ / ✓ glyph (the design's kept copy mark) with a CONSTANT
//                  aria-label "copy link", so the accessible name stays complete though a glyph alone
//                  would not be descriptive.
//   • 'menuitem' — overflow tier: a labeled item inside the `⋯` overflow menu (role menuitem).
// Only ONE variant renders per tier (the tier is a JS branch, not two co-mounted copies), so there is
// never a second live "copied" state to keep in sync.
function HeaderCopyLink({ onCopyLink, variant }: {
  onCopyLink: () => Promise<boolean>
  variant: 'label' | 'icon' | 'menuitem'
}) {
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
  const className = variant === 'icon' ? 'header-copy header-copy-icon'
    : variant === 'menuitem' ? 'header-menu-item'
    : 'header-copy'
  const content = variant === 'icon' ? (copied ? '✓' : '⧉') : (copied ? 'link copied ✓' : 'copy link')
  return (
    <button
      className={className}
      role={variant === 'menuitem' ? 'menuitem' : undefined}
      aria-label={variant === 'icon' ? 'copy link' : undefined}
      onClick={copy}
    >{content}</button>
  )
}

export default function App() {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  // The Hangar: a modal run-library front door reachable from the header — never a takeover of the
  // default view (owner-gate posture: DEFAULT_RUN is f1 post-hero-switch; the landing-route option is flagged, not taken).
  const [hangarOpen, setHangarOpen] = useState(false)
  // The Certification Wall (v0.8): a modal campaign surface, peer to the Hangar (the same overlay idiom).
  // Reached from the Hangar's campaign entry; closing it cancels any in-flight verify (the Wall's own effect
  // cleanup fences the queue). z-index/keyboard modality mirror the Hangar exactly.
  const [wallOpen, setWallOpen] = useState(false)
  // OPEN-GENERATION counter. Bumped on every open so the Wall is KEYED to a fresh generation and REMOUNTS
  // each session — its component-local state (the gauge load, the verifying flag) starts fresh, so the first paint
  // after a reopen can never show a prior session's gauges or a stale cancel button.
  const [wallGen, setWallGen] = useState(0)
  // The Raw Evidence Table: a modal byte-X-ray, peer to the Hangar/Wall (the same overlay idiom).
  // DOM/React only — no WebGL, no frame loop. Mounted only while open, so each open is a fresh mount whose
  // filters/sort/scope start at rest.
  const [tableOpen, setTableOpen] = useState(false)
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
  // Storage AVAILABILITY, probed ONCE at mount, tracked SEPARATELY from nudgeSeen. A denied/throwing
  // store reads as nudgeSeen=false above — indistinguishable from a genuine first visit — so 'first-visit'
  // scope would auto-play on EVERY bare load (it can never persist that the visit happened). The probe
  // (read+write, no persisted key) lets the arming decision suppress the zero-click open entirely when the
  // store can't back 'first-visit', rather than replay it forever. Read-only after mount: private-mode
  // availability does not change within a session.
  const [storageOk] = useState(probeStorage)
  // ZERO-CLICK THESIS: the cold-open card is open. Latched true ONCE by the arming effect below (a bare
  // cold open, first-visit or 'always' scope), dismissed by the card's ×. Held in state (not derived) so the
  // auto-tour's own nudge-retire (startTour → dismissNudge flips nudgeSeen) cannot yank the card mid-session.
  const [thesisOpen, setThesisOpen] = useState(false)
  // COLD-OPEN CARD COLLAPSE: once the auto-tour leaves its opening establishing beat the full
  // card collapses to a header verdict chip. A one-way LATCH (never re-expands mid-session; an interrupt that
  // resets the tour stepIndex must not bring the card back). The full card is a once-per-browser (first-visit)
  // surface: the first cold open's auto-play persists NUDGE_KEY, so a reload seeds nudgeSeen=true and the
  // zero-click arming rejects — a reload from the collapsed state is CALM (no card, no chip), never a repaint of
  // the full card; only cleared storage restores it. Rendering is gated on thesisOpen, so a dismiss/run-switch
  // that closes the card hides the chip too regardless of this latch.
  const [thesisCollapsed, setThesisCollapsed] = useState(false)
  // Fire-once guard for the zero-click arming (also the StrictMode double-invoke guard in dev; prod is single).
  const zeroClickFiredRef = useRef(false)
  // Prior runId for the card-close effect. Seeded null and set on the effect's first run (mount), so the
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
  // …and for the Wall (v0.8): while it is open the transport keyboard is inert beneath it and Esc closes it.
  const wallOpenRef = useRef(false)
  useEffect(() => { wallOpenRef.current = wallOpen }, [wallOpen])
  // …and for the evidence table: while it is open the transport keyboard is inert beneath it and Esc closes it.
  const tableOpenRef = useRef(false)
  useEffect(() => { tableOpenRef.current = tableOpen }, [tableOpen])
  // The unified Wall CLOSE (Esc + any programmatic close): run the mounted Wall's synchronous stop routine FIRST
  // (abort the in-flight fetch, fence the verify queue, reset the store), THEN flip `open`. Doing the teardown
  // synchronously — rather than leaning on the unmount cleanup alone — closes the window in which a late verify
  // 'done' could still write the store after close. Stable identity (the keydown owner closes over it).
  const closeWall = useCallback(() => { wallRef.current?.stop(); setWallOpen(false) }, [])
  // THE ONE WALL OPEN ACTION. Both front doors — the Hangar's campaign card AND the header entry — route
  // through this single callback, never a second open path. Seed the campaign store SYNCHRONOUSLY (from the
  // shared campaignSeedIds source) BEFORE the keyed Wall mounts, so render 1 reads 0-of-50 with no dependence
  // on effect timing or render lane; the store's passive subscription lands after paint, so a layout-effect
  // seed alone would flash 0-of-0 on a non-sync-lane open. Then bump the open-generation counter so the Wall
  // is KEYED to a fresh generation and REMOUNTS each open — its component-local state (the gauge load, the
  // verifying flag) starts fresh, so the first paint after a reopen can never show a prior session's gauges
  // or a stale cancel button. Finally flip `open`.
  const openWall = useCallback(() => {
    useCampaignStore.getState().init(campaignSeedIds(ROBUST_F3A))
    setWallGen(g => g + 1)
    setWallOpen(true)
  }, [])
  const runId = useViewStore(s => s.runId)
  // Session-seal set: drives which Hangar cards wear the earned ✓. Event-rate (changes once per
  // newly-sealed run), so this App re-render never touches the frame path.
  const sealedRuns = useViewStore(s => s.sealedRuns)
  // Finale marker (v0.5b): reflect the store's ephemeral finale flag onto the scene container as a
  // deterministic, DOM-observable signal (data-finale on #viewport — mirrors the aria/ReadyAnnouncement
  // "state on a stable element" precedent). Event-rate (the flag flips once at natural-end and once on any
  // clear), so this App re-render never touches the frame path. The e2e smoke asserts on it.
  const finale = useViewStore(s => s.finale)
  // Header condensation tier (the priority ladder). A width-driven external store that re-renders the
  // header only when the viewport crosses a ladder threshold — never on the frame path. headerLayout
  // turns the tier into the per-control intents the header JSX branches on (run switcher form, low-
  // priority chrome form, wall label, wordmark) — the SINGLE source shared with the unit-tested pure
  // model, so the ladder's rules are never a hand-maintained twin between the code and the CSS.
  const layout = headerLayout(useHeaderTier())
  // Header-menu keyboard ownership — IDENTITY-KEYED and SYNCHRONOUS. A header disclosure (the run picker
  // or the ⋯ overflow) claims the keyboard the SAME way the Hangar/Wall modals do: while one is open the
  // window keydown owner goes inert on this EXPLICIT token — a ref holding WHICH menu owns it ('picker' |
  // 'overflow' | null), read without re-registering the listener and updated SYNCHRONOUSLY from the menu's
  // event handlers (open / Esc / outside / focus-exit / child-action / unmount), so the owner sees a close
  // the instant it happens. The token is keyed by menu id and released CONDITIONALLY on identity: a second
  // instance mounting or unmounting can never clear another's claim (the tier-change bug where the newly-
  // mounted ⋯ cleared the still-open picker's ownership). Both instances publish here; only the holder
  // clears. (The header's stacking-context raise above the cold-open thesis card is pure CSS —
  // `header:has(.header-menu-popup)` in app.css — so it tracks the popup's DOM presence directly.)
  const activeMenuRef = useRef<string | null>(null)
  const onMenuOwnership = useCallback((id: string, open: boolean) => {
    if (open) activeMenuRef.current = id
    else if (activeMenuRef.current === id) activeMenuRef.current = null // identity-conditional release — never clear another's claim
  }, [])
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
    // Speed pin: capture pacing is speed-INDEPENDENT — captureSpeed pins the transport rate
    // multiplier to 1 while engaged, so the fps alone encodes the capture rate. Pin the STORE to 1× on a
    // successful arm too, so the speed UI reads the true effective rate (a ?speed=8&capture= deep link
    // would otherwise light 8× while capture plays at 1×). Later speed writes (keystroke, tour
    // witnessSpeed) are display-only during capture — the capture survives them deterministically (the
    // ruling and its rationale live on captureSpeed / docs/capture.md). Gated on isCapturing(): a
    // REFUSED arm must not touch the store — the live path stays behavior-identical.
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
  // new run and no stale sel/ev is written into the new run's URL. syncUrl(true) — an unforced
  // sync mid-navigation could be throttle-dropped, leaving the URL stale.
  const selectRun = (id: string) => {
    // finale:false is the invariant-before-publish clear (a design ruling): a natural-end finale must NEVER
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

  // COPY-LINK — the share weapon. Build the shareable URL for the CURRENT view from the URL grammar
  // (run/tick/sel/ev/speed) and copy it. Verification state NEVER rides the URL (the NEVER-list): the link
  // reproduces the VIEW, and the recipient's own browser re-verifies from the bytes. Returns success so the
  // card can show honest "copied" feedback (never a false confirm if the clipboard is blocked).
  const copyShareLink = async (): Promise<boolean> => {
    const s = useViewStore.getState()
    // never serialize a tour's OFF-LADDER witness pace. During the auto-played cold-open tour (and any
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

  // Evidence-table row select → the ONE existing select path (deep-links ?ev=), then close the modal so the
  // table is a navigation surface INTO the stages (one code path for selection, never a second). The subject (when the kind names
  // one) rides along via the SAME subjectOfEvent the Inspector's pick uses — own-property-safe over unsigned ids.
  const selectFromTable = (seq: number) => {
    useViewStore.getState().select(model?.subjectOfEvent(seq) ?? null, seq)
    syncUrl(true)
    setTableOpen(false)
  }

  // SESSION-SEAL RECONCILIATION (the checkmark economy; the seal-race fix + the identity-join guard): when THIS
  // run's own bytes have finished verifying (loadedRunId === runId — identity carried with the data, the
  // load-bearing guard: on the commit right after a run switch the store runId has already flipped but
  // useRun still holds the PRIOR run's model/hashes), reconcile the seal set with the verdict:
  //   • verified (matchesTrailer)  → recordSeal(runId, resultId): fresh seal, no-op on the same bytes, or
  //     REPLACE when a re-load verified DIFFERENT bytes (the ✓ names exactly what it saw).
  //   • mismatched (✗ by design)   → breakSeal(runId): a previously-sealed card flips to the alarm ✗ voice
  //     (a stale green over demonstrably-mismatching bytes would contradict the design's "✗ escalates and
  //     persists"); a never-sealed run stays attested. shouldBreakSeal carries the same identity join, so
  //     a stale ✗ from the run we just switched AWAY from can never revoke the destination's seal.
  // Both store actions are reference-stable no-ops on repeat, so the re-fire on every ready re-render is
  // inert after the first.
  useEffect(() => {
    if (!hashes) return
    // the seal binds to the TRUST verdict, not matchesTrailer: a full-manifest run whose recomputed pins
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

  // HANGAR → TOUR handoff (the third tour entry point, now on the ONE admission predicate). Once the
  // run parked by a tour card is ready, start its authored tour. The guards, in order:
  //   • pendingTour !== runId → not our pending run (or none): do nothing.
  //   • model absent OR NOT loadIsCurrent → the destination is still LOADING (a stale prior model during the
  //     switch gap is non-null but names the PRIOR run): WAIT — never start against old data, never consume
  //     pendingTour (the earlier bug: a `model && …` gate started the destination's choreography on the prior
  //     run's bytes and cleared pendingTour, so the real destination never got its tour).
  //   • resident + current → tourAdmitted decides: admit (start) on a non-mismatch run with a tour, else REFUSE
  //     (a mismatch destination's det-only captions claim a self-check it did not earn). Either way CONSUME
  //     pendingTour — start on a valid admit, or drop a doomed request (reason discarded) so it never re-fires.
  //   • CANCEL the parked intent on navigation to a DIFFERENT run OR a terminal load error for the pending
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

  // ZERO-CLICK THESIS arming (the storage-availability fix): on a BARE cold open, once the run is
  // ready, open the thesis card AND auto-play the first tour beat. The whole predicate is the pure
  // shouldArmZeroClick — scope toggle + cold-open signal + a tour existing + (for 'first-visit') an UNSEEN
  // marker AND an AVAILABLE store (a denied store can't back 'first-visit', so suppress rather than
  // replay every visit). startTour() dismisses the nudge, so the pulse treatment never also fires (the
  // auto-play IS the discoverability — one cold-open voice, not two). The fire-once ref makes it idempotent
  // (and dev-StrictMode-safe). Deps [model] match the sibling effects (this eslint config does not enforce
  // exhaustive-deps); the predicate reads runId/nudgeSeen/storageOk fresh this pass.
  useEffect(() => {
    if (!model || zeroClickFiredRef.current) return
    // WHETHER a tour may start is the ONE admission predicate (identity + verdict + tour-exists). This
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

  // COLD-OPEN CARD COLLAPSE: the full card holds through beat 0 (its cold-open share moment —
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

  // CLOSE THE COLD-OPEN CARD ON ANY RUN SWITCH. The thesis card is a cold-open artifact: it reads the
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
      // Hangar modal capture: the run library is a modal front door — the transport keyboard is
      // inert beneath it, and Esc closes it (symmetric with the help overlay's modal capture). The
      // backdrop click and the close button are the pointer paths; this is the keyboard path.
      if (hangarOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); setHangarOpen(false) }
        return
      }
      // Wall modal capture: the campaign surface is a modal too — the transport keyboard is inert beneath
      // it, and Esc closes it THROUGH the same synchronous stop routine the close button + backdrop use:
      // closeWall tears the session down (abort/fence/reset) before flipping `open`, never leaving it to the
      // passive unmount cleanup alone. The next open remounts a fresh Wall (the wallGen key).
      if (wallOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); closeWall() }
        return
      }
      // Evidence-table modal capture: the byte-X-ray is a modal too — the transport is inert beneath it and
      // Esc closes it (symmetric with the Hangar/Wall). Non-Esc keys return WITHOUT preventDefault, so typing
      // reaches the table's search input natively.
      if (tableOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); setTableOpen(false) }
        return
      }
      // Header-disclosure capture: the run picker / the ⋯ overflow own the keyboard while open, exactly
      // as the modals above do — the transport is inert whenever ANY menu holds the ownership token (this
      // is the EXPLICIT-STATE guard, not event-bubbling alone, so a stray arrow/space can never scrub a run
      // even if focus has drifted off a menu item, and it survives a tier change that mounts a second menu
      // beneath the open one). The menu's own capture-phase listeners handle Esc/arrows and close it.
      if (activeMenuRef.current !== null) return
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
        // Observer's Eye: request the POV ease. notifyUserInput() above already stopped any running
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
  if (gate && !gate.ok) return <GateScreen gate={gate} />
  // the current-load identity witness gates the WHOLE ready subtree, not just the thesis verdict + seals.
  // The production gate IS the tested helper readyTreeVisible(model, runId, loadedRunId) — consumed here, never a
  // hand-inlined twin of its logic (the tested gate and the production gate must be the same function). The
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
  // name — WITHHELD (null) when the resident hashes don't belong to the run on stage or none exist (a fail-safe,
  // never a false green). It is the TRUST verdict itself (the seal fold): a manifest-mismatching run reads ✗
  // here, a det-only run reads ○ self-consistent (never the manifest-grade green), a manifest-verified run ✓.
  // Shared by the full card and its collapsed header chip so both speak one verdict voice.
  const thesisVerdict = loadIsCurrent(runId, loadedRunId) && hashes ? hashes.verdict : null

  return (
    <div className="app">
      {/* SR-only: announces the run's VERDICT (verified, or loaded-but-unverified on a trailer
          mismatch) once the app is interactive (see component note). */}
      <ReadyAnnouncement runId={runId} model={model} verdict={hashes?.verdict} />
      {/* `header-mobile` tightens the phone-floor spacing so the protected controls fit a 360px viewport
          (ladder-model driven — layout.dense). The stacking-context raise above the cold-open card while a
          disclosure is open is handled in CSS via `header:has(.header-menu-popup)`, not a class here. */}
      <header className={layout.dense ? 'header-mobile' : undefined}>
        {/* Identity lockup (priority-(a)): the favicon's radar mark (same paths, same cyan) locked left
            of the wordmark — the browser-tab identity carried into the app chrome. Decorative, so
            aria-hidden. At the narrowest (overflow) tier the WORD recedes to just the mark: the <h1> is
            kept in the DOM as the page heading for assistive tech (sr-only), while the accent-cyan mark
            alone holds the visual identity — the chrome yields its pixels last, never its meaning. */}
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
          <h1 className={layout.wordmark === 'mark' ? 'sr-only' : undefined}>swarm observatory</h1>
        </div>
        {/* THE RUN SWITCHER (priority-(b), ALWAYS reachable). At full width the six-run button row
            (ids as the compact labels, the runs/index.json titles as native tooltips). Below the condense
            threshold it collapses to a compact `run ▾` picker — the largest single space win, and the
            picker scales past six runs the button row cannot. The picker is a keyboard-operable disclosure
            (a button + a menu of the same run entries), NOT a hidden two-row wrap. */}
        {layout.runSwitcher === 'buttons'
          ? <nav>{runs.map(r => <button key={r.id} title={r.title} className={r.id === runId ? 'active' : ''} onClick={() => selectRun(r.id)}>{r.id}</button>)}</nav>
          : runs.length > 0 && (
            <HeaderMenu menuId="picker" label="run ▾" ariaLabel="switch run" className="run-picker" onOwnership={onMenuOwnership}>
              {(close) => runs.map(r => (
                <button
                  key={r.id}
                  role="menuitem"
                  className={r.id === runId ? 'header-menu-item active' : 'header-menu-item'}
                  aria-current={r.id === runId ? 'true' : undefined}
                  title={r.title}
                  onClick={() => { close(); selectRun(r.id) }}
                >{r.id}</button>
              ))}
            </HeaderMenu>
          )}
        {/* THE HANGAR front door (priority-(e), low-priority chrome): opens the run-library overlay.
            Inline while the row has room — a full label at the full tier, a ⌂ icon (with a kept accessible
            name) at the condensed tier. At the narrowest (overflow) tier it is NOT here: it folds into the
            `⋯` overflow menu below. Gated on runs so it never opens an empty library. */}
        {layout.chrome !== 'overflow' && runs.length > 0 && (
          <button
            className="hangar-open"
            aria-label={layout.chrome === 'icons' ? 'hangar' : undefined}
            onClick={() => setHangarOpen(true)}
          >{layout.chrome === 'icons' ? '⌂' : 'hangar'}</button>
        )}
        {/* THE RAW EVIDENCE TABLE front door (low-priority chrome — rides the SAME `chrome` axis as the hangar
            + copy-link): opens the byte-X-ray modal. A full label at the full tier, a ▦ table mark at the
            condensed tier (a UI affordance mark in the ⌂/⧉/☰ chrome family, NOT an evidence-alphabet glyph),
            folded into the `⋯` overflow at the narrowest tiers. It is an INSTRUMENT surface, not a brand CTA,
            so it folds like the hangar — never competing with the two protected CTAs (tour + wall). NOT gated
            on the run index: it reads the LOADED run's model (always present in the ready tree), so it is
            reachable on every run — the whole point of the table is that it is universal across all six runs. */}
        {layout.chrome !== 'overflow' && (
          <button
            className="evidence-open"
            aria-label={layout.chrome === 'icons' ? 'evidence table' : undefined}
            onClick={() => setTableOpen(true)}
          >{layout.chrome === 'icons' ? '▦' : 'evidence table'}</button>
        )}
        {/* Certification Wall front door (priority-(c), a BRAND CTA): the app's hero surface — the
            byte-verification wall and, inside it, the "test the seal" tamper demo — reachable directly from
            the persistent chrome, not three interactions deep behind the Hangar. Routes through the SAME
            openWall action the Hangar's campaign card uses (one open path — the synchronous store seed +
            keyed remount), never a second entry. Not gated on the run index: the campaign is independent of
            which run is loaded, so the wall is always reachable once the app is interactive.
            LADDER RULE: this CTA never folds — it is always inline at every width. Only its LABEL condenses,
            from "certification wall" (full tier) to "wall" (condensed/overflow), so a heavier header stays
            within the viewport without ever hiding the entry. The visible text is the accessible name at
            both weights. */}
        <button className="wall-open" onClick={openWall}>{layout.wallLabel}</button>
        {/* Guided-tour launcher (priority-(c), a BRAND CTA — always inline, never folds): shown only when
            an authored tour exists for the current run. The header renders only after the model is ready
            (past the !model gate), so model-readiness is already guaranteed here. Clicking starts
            (restart-safe); interrupts are source-signaled and the overlay's × calls stop() — no keyboard key
            is bound (transport grammar is frozen).
            ONE tour CTA (v0.5d): the first-visit nudge is a TREATMENT of this button (the accent wash +
            nudge-pulse ring, plus the quiet dismiss ×), never a second button — two CTAs for one action made
            the chrome compete with itself. Starting a tour or dismissing retires the treatment forever
            (NUDGE_KEY). */}
        {/* the ▶ button is the third tour entry point, gated on the ONE admission predicate (tour-exists +
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
        {/* Copy-link (priority-(d), low-priority chrome): the share weapon, reachable in the app chrome —
            not only inside the transient cold-open card. Inline while the row has room (a "copy link" label
            at the full tier, a ⧉ icon at the condensed tier); at the narrowest (overflow) tier it folds into
            the `⋯` overflow menu below. Gated on runs so it never offers a link before a run loaded. */}
        {layout.chrome !== 'overflow' && runs.length > 0 && (
          <HeaderCopyLink onCopyLink={copyShareLink} variant={layout.chrome === 'icons' ? 'icon' : 'label'} />
        )}
        {/* THE `⋯` OVERFLOW MENU (the narrowest tiers): the escape hatch where the low-priority chrome
            folds — the two brand CTAs and the run picker above NEVER fold in here. A keyboard-operable
            disclosure. At the overflow tier it holds the hangar + copy-link; at the mobile floor it ALSO
            absorbs the two panel-toggles (the last inline chrome to fold, per the ladder's priority order).
            At the overflow tier the ⋯ always has content to fold — the evidence table folds here on every run
            (it is not run-index-gated) — so the menu renders whenever chrome is at the overflow tier. */}
        {layout.chrome === 'overflow' && (
          <HeaderMenu menuId="overflow" label="⋯" ariaLabel="more actions" className="header-overflow" onOwnership={onMenuOwnership}>
            {(close) => (
              <>
                {/* close() FIRST — it restores focus to the ⋯ trigger before the action, so the modal/panel
                    that opens snapshots the trigger (a stable element) as its opener, never document.body. */}
                {runs.length > 0 && (
                  <button role="menuitem" className="header-menu-item" onClick={() => { close(); setHangarOpen(true) }}>hangar</button>
                )}
                {/* the evidence table folds here at the narrowest tiers (it rides the `chrome` axis with the
                    hangar + copy-link); not run-gated — it reads the loaded run's model. */}
                <button role="menuitem" className="header-menu-item" onClick={() => { close(); setTableOpen(true) }}>evidence table</button>
                {/* the copy item keeps the menu OPEN so its "link copied ✓" feedback is seen — Esc or an
                    outside press closes it. */}
                {runs.length > 0 && <HeaderCopyLink onCopyLink={copyShareLink} variant="menuitem" />}
                {/* Phone floor: the panel-toggles join the overflow (they are the last inline chrome to fold).
                    close() first so focus lands on the ⋯ trigger, never body, after the panel opens. */}
                {layout.panelToggles === 'overflow' && (
                  <>
                    <button role="menuitem" className="header-menu-item" onClick={() => { close(); setPanelOpen(p => (p === 'inspector' ? null : 'inspector')) }}>agent panel</button>
                    <button role="menuitem" className="header-menu-item" onClick={() => { close(); setPanelOpen(p => (p === 'provenance' ? null : 'provenance')) }}>provenance panel</button>
                  </>
                )}
              </>
            )}
          </HeaderMenu>
        )}
        {/* Collapsed cold-open card: once the auto-tour leaves beat 0 the full card becomes this header
            verdict chip — the existing verdict voice, × still dismisses. It is a REAL header occupant on a
            bare cold open, so the ladder models it: the chip is `compact` at every tier (headerModel.ts —
            even the full tier's narrow end cannot fit the six-button chrome beside the wide headline), so it
            sheds "self-consistent — no external manifest" to just the verdict glyph, keeping the headline as
            an sr-only reading so the meaning survives and the row never overflows. */}
        {thesisOpen && thesisCollapsed && <ThesisChip verdict={thesisVerdict} onDismiss={dismissThesis} compact={layout.chip === 'glyph'} />}
        {/* Side-panel toggles (present only ≤1080px, where the panels are overlays; CSS-hidden above).
            They ride the ladder: labeled at the condensed tier, sheared to ☰ icons at the overflow tier,
            and folded into the `⋯` menu at the mobile floor (rendered there instead of here). */}
        {layout.panelToggles !== 'overflow' && (
        <div className="panel-toggles">
          <button aria-label={layout.panelToggles === 'icons' ? 'agent panel' : undefined} onClick={() => setPanelOpen(p => (p === 'inspector' ? null : 'inspector'))}>{layout.panelToggles === 'icons' ? '☰' : '☰ agent'}</button>
          <button aria-label={layout.panelToggles === 'icons' ? 'provenance panel' : undefined} onClick={() => setPanelOpen(p => (p === 'provenance' ? null : 'provenance'))}>{layout.panelToggles === 'icons' ? '☰' : '☰ provenance'}</button>
        </div>
        )}
        {/* Visible help affordance: discoverable without knowing the ?-shortcut (some layouts need
            AltGr for ?). Opens the same overlay the ? key toggles; focus moves into the modal on open. */}
        <button className="help-toggle" aria-label="keyboard shortcuts" onClick={() => setHelpOpen(true)}>?</button>
      </header>
      {/* Keyed on runId so a caught error clears when the operator switches runs (fresh boundary). */}
      <ErrorBoundary key={runId}>
        {/* tourActive lets the live sensing strip OWN the aside during a tour: the f2a tour holds a sensing
            selection while its play beats move the playhead, so the strip must track the playhead, not freeze on
            the held verdict. Same run-scoped signal the honesty chips read (tour.active?.runId === runId). */}
        <Inspector model={model} open={panelOpen === 'inspector'} tourActive={tour.active?.runId === runId} />
        {/* stage-enter: the CEREMONY HANDOFF — a one-shot CSS fade-up as the stage takes over from
            the load ceremony (the stage "fades up beneath" while the confirmed hash lines settle into their
            provenance rows). Fires on this element's mount, i.e. exactly at the ceremony→app handoff; no rAF,
            no frame work, no fake delay (the load budget holds). Reduced-motion collapses it to an instant show. */}
        <main id="viewport" className="stage-enter" data-finale={finale ? 'true' : 'false'}>
          <Scene model={model} />
          {/* Honesty chip: the query stage's probe geometry is decoded-real, but the occluder & region
              BODIES (sphere / box / triangle) are scenario constants, not bundle state — the chip states
              exactly that (QUERY_STAGE_HONESTY). QueryStageChip self-gates on the COMPLETE applicability
              predicate (queryStageApplies — positionless AND kind-23 draws), the same gate Scene's mount
              uses, so it appears iff the stage actually draws those bodies (never over f4's void, never on a
              positioned run) — no App-side outer gate to drift from the mount. TOUR POSTURE (v0.5d,
              honesty priority): while this run's tour caption bar is up it can occlude the chip's lower-left
              berth — the chip is the honesty contract and is NEVER covered, so it lifts to the viewport's
              top-left for the tour's duration (CSS). The class flips at tour start/stop (event-rate re-render
              App already does), never on the frame path. */}
          <QueryStageChip model={model} tourActive={tour.active?.runId === runId} />
          {/* The sensing chip is the honesty contract for f2a (a POSITIONED-run lens); it self-gates on
              sensingStageApplies and lifts above the tour caption exactly as the query chip does. */}
          <SensingChip model={model} tourActive={tour.active?.runId === runId} />
          {/* The comms chip is the honesty contract for f4 (the contested link); it self-gates on
              commsStageApplies and lifts above the tour caption exactly as the other two chips do. */}
          <CommsChip model={model} tourActive={tour.active?.runId === runId} />
          {/* The belief chip is the honesty contract for f3a (the shrinking disc); it self-gates on
              trackBeliefApplies and lifts above the tour caption exactly as the other three chips do. */}
          <BeliefChip model={model} tourActive={tour.active?.runId === runId} />
        </main>
        <ProvenancePanel model={model} open={panelOpen === 'provenance'} />
        <Timeline model={model} />
      </ErrorBoundary>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* The Hangar run-library overlay. DOM/React only — no WebGL, no frame loop. A card whose run has
          an authored tour makes the tour its primary action; the chip names the lens (tours.ts tourTitle,
          own-property-safe over the unsigned index ids). */}
      <Hangar
        open={hangarOpen}
        runs={runs}
        currentRunId={runId}
        sealedRuns={sealedRuns}
        loadedRunId={loadedRunId}
        loadedResultId={hashes?.resultId ?? null}
        onClose={() => setHangarOpen(false)}
        onOpenRun={openRunFromHangar}
        onOpenTour={openTourFromHangar}
        onOpenWall={() => { setHangarOpen(false); openWall() }}
      />
      {/* The Certification Wall: the campaign surface. DOM/React only — no WebGL, no frame loop. Peer
          modal to the Hangar. Rendered ONLY while open AND keyed on the open-generation counter, so each open is
          a fresh MOUNT: the first paint after a reopen shows the loading state + 0-of-50 census + verify-all
          CTA, never a prior session's gauges or cancel button. Esc/close route through closeWall (synchronous
          stop); the Wall's own button + backdrop stop it directly, so every close path fences the queue. */}
      {wallOpen && <CertificationWall key={wallGen} ref={wallRef} onClose={() => setWallOpen(false)} />}
      {/* The Raw Evidence Table: a modal byte-X-ray, peer to the Hangar/Wall. DOM/React only — no WebGL, no
          frame loop. Mounted ONLY while open, so each open is a fresh mount (its filters/sort/scope start at
          rest). model is non-null here (past the readyTree gate). Row-select routes through selectFromTable —
          the ONE select path (deep-link ?ev= + close). */}
      {tableOpen && <EvidenceTable open model={model} onSelect={selectFromTable} onClose={() => setTableOpen(false)} />}
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
      {/* THE ZERO-CLICK THESIS CARD: the cold-open surface — verdict headline (the run's REAL verify
          result), the in-app independence line, and the copy-link share weapon. Opened by the arming effect on
          a bare cold open; held until × so the share affordance survives an auto-tour interrupt.
          the verdict is passed ONLY when the resident hashes provably belong to the run on stage
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
