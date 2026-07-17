import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import { ROBUST_F3A, campaignSeedIds, resolveAppBase } from '../decode/campaignCatalog'
import { buildCampaignJobs, createCampaignQueue, type CampaignQueue } from '../decode/campaignQueue'
import { useCampaignStore } from '../state/campaignStore'
import { requireGlyph } from './voices'
import { censusLine, gaugeDisplay, gaugeLoadFromFetch, seedVoice, stopWallSession, type GaugeLoad } from './wall'
import { TamperDemoPanel } from './tamperDemoView'

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE CERTIFICATION WALL (v0.8) — the campaign certification surface, opened by declaring what it
// has NOT verified. The design-of-record + the v0.8 amended design ruling are binding; this is their pixels.
//
// LAW-4 DECLARATION (constitution §4 — filed in-code for this new surface, the Hangar precedent):
//   • Question (Q5, at campaign scale): "can I trust this campaign's artifacts?" — answered by handing
//     the viewer the recomputation, not a badge. A certification wall that says "don't take our word —
//     press verify."
//   • Surface split (LAW 3): this is the INSTRUMENT half — density, DOM/React only, ZERO WebGL and no
//     frame loop (the load budget: the Wall never mounts the r3f canvas and does no rAF work; dots flip at EVENT rate
//     as the store's per-seed transitions land, never on a frame). No React state mutated in any loop;
//     zero steady per-frame allocation (there is no frame).
//   • Borrowed hues (LAW 2, zero new tokens): integrity `verified` (green) ONLY on a seed the store
//     evidence-derived 'verified' THIS session; the attested slate `•` (`--pending`) for on-record; the
//     alarm `--mismatch` ✗ for a contradicted pin; the dim `--text-dim` availability `?` for a fetch
//     failure (never ✗). The gauges' statistical pass/fail wears the verdict pair (`--verdict-affirm`/
//     `--verdict-negate`) — certified DECISIONS, carried by hue while the glyph stays the attested `•`
//     (a design ruling: the two colour systems are never cross-spent; green ≠ statistical pass).
//   • What it dims (LAW 1): at rest the whole field is quiet attested dots — beauty is DEFERRED, the
//     field only lights as the viewer verifies. A ✗ anywhere claims the alarm register.
//   • Honest empty states: an unfetchable manifest → the gauges say so plainly (no fabricated band); a
//     campaign at rest declares "0 of 50 recomputed and matched here" — the census IS the design.
//
// EVERY glyph is sourced from the ONE voices module (requireGlyph) — never a literal (the glyph source sweep).
// PROFILE-CONFLATION (a design ruling): this surface IS the ROBUST campaign and names it correctly; the
// correct-profile f3a library card stays untouched — the two are separate entities and must never conflate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// The sidecar's own contract line (the design thesis) — the manifest is an INDEX, never the authority: the ✓ is
// re-earned by the browser, never trusted from the manifest. Shared verbatim-class with the Hangar.
const DISCLAIMER = 'index, not authority — a tampered index can misdirect, never forge.'

// A compact hash form for the plan id (the ProvenancePanel short() idiom): 8…6.
const shortHash = (h: string): string => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h)

// The imperative handle App holds: the ONE synchronous teardown (abort the fetch, fence the queue, reset
// the store), so the Esc close path can run the SAME routine the close button + backdrop use before `open` flips.
export interface CertificationWallHandle {
  readonly stop: () => void
}

export interface CertificationWallProps {
  onClose: () => void
  // React 19 ref-as-prop: App attaches this to reach `stop()` for the Esc close path.
  ref?: Ref<CertificationWallHandle>
}

// The Wall is mounted ONLY while open, and REMOUNTS on every open (App keys it on an open-generation counter), so
// there is no `open` prop and no "reset on open" bookkeeping: a fresh mount IS the fresh session. That remount is
// the remount fix — the first paint after a reopen is provably fresh (loading gauges, verify-all CTA, 0-of-50 census),
// never a prior session's retained state.
export function CertificationWall({ onClose, ref }: CertificationWallProps) {
  const cat = ROBUST_F3A
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const queueRef = useRef<CampaignQueue | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // the tamper demo's in-flight fetch controller, registered by TamperDemoPanel, aborted by the SAME
  // synchronous stop routine below. Hoisting it here means a close-while-demo-fetching tears the demo fetch down
  // synchronously (the Wall's stop path), not only on the child's passive unmount cleanup (the late-work race).
  const demoAbortRef = useRef<AbortController | null>(null)

  // The seed ids in catalog (seed-number) order — the honest geometry (a design ruling: a seed-ordered field, no fake
  // scatter). Derived from the ONE shared source (campaignSeedIds) that App's open action seeds the store from, so
  // the open-action seed and this component's seeds can never disagree on the id set. Consumed by the replay-backstop
  // layout effect below and by startVerifyAll's re-init.
  const seedIds = campaignSeedIds(cat)

  const phase = useCampaignStore(s => s.phase)
  const rollup = useCampaignStore(s => s.rollup)
  const [load, setLoad] = useState<GaugeLoad>({ kind: 'loading' })
  const [verifying, setVerifying] = useState(false)

  // ── STORE SEED — TWO SEEDS, ONE STORE, A DELIBERATE DIVISION OF LABOR (the first-frame fix) ────────────
  // The campaign store is a module-scoped EXTERNAL store, and a close resets it to rest (total=0). A fresh open must
  // paint 0-of-50, never the 0-of-0 flash of the just-reset store. That correctness is split across TWO idempotent
  // seeds — neither redundant; they cover DIFFERENT moments:
  //
  //   1) THE OPEN-ACTION SEED (App.onOpenWall — FIRST-FRAME CORRECTNESS IN EVERY LANE). App calls
  //      useCampaignStore.getState().init(campaignSeedIds(ROBUST_F3A)) SYNCHRONOUSLY, before it flips `wallOpen`
  //      and bumps wallGen. So by the time this keyed component first RENDERS, the store is already seeded: render 1
  //      reads 0-of-50 with NO dependence on any lifecycle or lane. This is the load-bearing seed for the first
  //      painted frame — see below for why a layout effect alone cannot be.
  //
  //   2) THIS LAYOUT-EFFECT SEED (StrictMode REPLAY BACKSTOP — re-seed after the dev cleanup-reset). It does NOT
  //      carry the first frame; the open-action seed already did. It exists solely for React's dev StrictMode
  //      lifecycle, which replays effects setup → cleanup → setup: the fetch effect's cleanup runs stopSession() →
  //      reset(), zeroing the store, and the replay's SECOND setup must put it back. A layout effect re-runs on
  //      every setup, so it re-seeds after that cleanup-reset; a render-phase initializer (the original bug) ran
  //      once and never did, leaving the replayed Wall at 0-of-0. Proven by the StrictMode client-mount regression
  //      tests in wallView.test.tsx.
  //
  // WHY THE LAYOUT EFFECT CANNOT OWN THE FIRST PAINTED FRAME (why seed #1 is required, not just nicer): zustand
  // registers its useSyncExternalStore subscription in a PASSIVE effect. This layout-effect init() mutates the
  // store, but at layout-commit time the component is NOT yet subscribed, so the mutation schedules no re-render;
  // React only NOTICES the changed snapshot when the passive subscription is set up — which is AFTER paint on a
  // default/transition-lane mount. A sync-lane mount (a plain button click) happens to flush that passive work
  // before paint, which MASKED the gap; a startTransition/default-lane open would paint the render-1 snapshot,
  // 0-of-0, for one frame. Seeding at the open action removes the timing dependence structurally — render 1 reads a
  // seeded store in any lane. (This was proven against the pinned React 19.2.7 + zustand 5.0.14.)
  //
  // BOTH IDEMPOTENT (init is a pure set of a fixed id list), so running both — and the dev double-run of this one —
  // is harmless. NO FIGHT WITH THE CLOSE TEARDOWN: a CLOSE is ALWAYS an unmount (App renders the Wall only while
  // open, keyed on wallGen), so there is no reopen-within-a-single-mount; on a real unmount the fetch cleanup's
  // reset() is final and this effect does not re-run. The ONLY setup → cleanup → setup that re-seeds is the dev
  // replay — exactly what this backstop is for.
  useLayoutEffect(() => { useCampaignStore.getState().init(seedIds) }, [])

  // ── THE REMOUNT / SESSION POSTURE (a design decision, stated in-code) ──────────────────────────────────────
  // A "session" is THE MODAL BEING OPEN. Two teardown verbs, deliberately distinct:
  //   • CLOSE (the close button, the backdrop, or Esc) ENDS the session → stopSession() resets the store, so a
  //     REOPEN is a fresh rest (zero green). This is the design's north star made literal: "a ✓ dies when you
  //     leave and is re-earned" — leaving the certification surface is an explicit, labelled act.
  //   • CANCEL (in-view — cancelVerifyAll) is NOT a session end: it stops the in-flight verify but PRESERVES
  //     every terminal receipt already earned this session (a ✓ or an observed ✗). "Green is a receipt THIS
  //     session" cuts both ways — an ordinary cancel must not silently DELETE observed evidence. Only the
  //     in-flight seeds return to attested-pending (store.cancelPending()).
  //   • RE-RUN (verify-all again) is the explicit intra-session reset: it re-inits to rest, then re-earns.
  // The module store persists across a close (zustand is module-scoped), but CLOSE deliberately resets it —
  // reopening earns from zero — so no prior session's green survives under a fresh open.
  const stopSession = useCallback(() => {
    stopWallSession({
      // Abort the manifest fetch AND the tamper demo's in-flight fetch in the one synchronous stop — the
      // demo controller rides the same close path as the queue fence + store reset, never the passive-cleanup race.
      abort: () => {
        abortRef.current?.abort(); abortRef.current = null
        demoAbortRef.current?.abort(); demoAbortRef.current = null
      },
      cancelQueue: () => { queueRef.current?.cancel(); queueRef.current = null },
      reset: () => useCampaignStore.getState().reset(),
    })
  }, [])

  // App holds this handle so the Esc close path runs the SAME synchronous stop routine the close button + backdrop
  // use, BEFORE `open` flips — the store reset + fetch abort + queue fence are never left to the unmount
  // cleanup alone. Stable (stopSession is a []-dep callback), so the handle identity never churns.
  useImperativeHandle(ref, () => ({ stop: stopSession }), [stopSession])

  // MOUNT lifecycle. The component is mounted only while open and remounts per open, so this is a per-session
  // mount effect: fetch the vendored manifest under an AbortController and route the result through the fail-closed
  // parse into the discriminated load state. The store seed (the synchronous initializer above) and the
  // loading/idle defaults (fresh useState) are already in place — no "reset on open" bookkeeping is needed. On
  // close/unmount the cleanup runs stopSession() — the SAME synchronous teardown the close controls invoke — which
  // aborts this fetch, so a late resolution after close never sets state (the aborted-signal guard).
  useEffect(() => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const absoluteBase = resolveAppBase(import.meta.env.BASE_URL, document.baseURI)
    fetch(new URL(cat.manifestUrl, absoluteBase).href, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!ctrl.signal.aborted) setLoad(gaugeLoadFromFetch(j, cat)) })
      .catch(() => { if (!ctrl.signal.aborted) setLoad({ kind: 'failed' }) })
    return () => { stopSession() }
    // cat is a frozen module constant; this is a mount-once effect (stopSession identity is stable).
  }, [stopSession])

  // COMPLETION: when a verify pass has drained (no seed left pending/running), the field HOLDS — flip the
  // CTA back to "verify all" (re-runnable). Detected from the rollup alone (event-rate), never a timer.
  useEffect(() => {
    if (verifying && rollup.total > 0 && rollup.pending === 0) setVerifying(false)
  }, [verifying, rollup.total, rollup.pending])

  // Modality (mirrors the Hangar): on mount, remember the opener and move focus into the dialog; on unmount
  // (close), restore focus to the opener. Runs once per session — the mount IS the open.
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('button, [href], [tabindex]')
    first?.focus()
    return () => { const prev = prevFocusRef.current; if (prev?.isConnected) prev.focus() }
  }, [])

  // VERIFY-ALL — the hero moment. Re-init to rest first (a re-run re-earns from zero), then start the queue
  // at the spine's default concurrency. Each queue event drives the store's per-seed transition (the store
  // IS the choreography): 'started' → running, 'done' → the evidence-coherent terminal verdict. Dots flip at
  // REAL completion in TRUE order — no staged cascade, no minimum-duration shimmer.
  const startVerifyAll = () => {
    const store = useCampaignStore.getState()
    store.init(seedIds) // return to rest, then re-earn
    queueRef.current?.cancel()
    const queue = createCampaignQueue({
      onEvent: (e) => {
        const st = useCampaignStore.getState()
        if (e.type === 'started') st.markRunning(e.id)
        else if (e.type === 'done') st.record(e.summary)
        // 'queued' — every seed was seeded 'pending' on open; nothing to do.
      },
    })
    queueRef.current = queue
    queue.start(buildCampaignJobs(cat))
    setVerifying(true)
  }

  // CANCEL (in-view) — the epoch fence aborts in-flight verifies and clears the queue with no late events. The
  // store's cancelPending() returns ONLY the in-flight seeds (running/pending) to attested-pending and PRESERVES
  // every terminal receipt already earned this session — an observed ✗ (or a ✓) survives an ordinary cancel
  // NOT init(seedIds): re-init wiped observed evidence, silently deleting a contradiction off the very
  // surface that exists to show it. (A completed session's evidence is re-earned only on an explicit CLOSE-then-
  // reopen, or a fresh RE-RUN — see the posture note above.)
  const cancelVerifyAll = () => {
    queueRef.current?.cancel()
    queueRef.current = null
    useCampaignStore.getState().cancelPending()
    setVerifying(false)
  }

  // Focus trap (mirrors the Hangar; Esc-to-close is owned by App's keydown owner — the modal-capture path).
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    if (!focusables || focusables.length === 0) return
    const firstEl = focusables[0]!
    const lastEl = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus() }
    else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus() }
  }

  const attestedGlyph = requireGlyph('attested')

  // CLOSE (the close button + the backdrop the Wall owns directly): stop the session SYNCHRONOUSLY — abort the
  // fetch, fence the queue, reset the store — THEN hand up to onClose. Esc is owned by App's keydown owner,
  // which invokes the SAME stopSession through the imperative handle (stop()) before flipping `open` — so all
  // three close paths tear down through one idempotent routine, synchronously, never leaning on passive cleanup.
  const handleClose = () => { stopSession(); onClose() }

  return (
    <div className="wall-backdrop" onClick={handleClose}>
      <div
        ref={panelRef}
        className="wall-panel"
        role="dialog"
        aria-modal="true"
        aria-label="certification wall"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <header className="wall-head">
          <div className="wall-title">
            <h2>{cat.campaignId}</h2>
            <p className="wall-subtitle">50-seed statistical campaign</p>
          </div>
          {/* The ROBUST verdict rides the ATTESTED voice — on record, not a session receipt. The
              wall's ✓s are the receipts; this wordmark is the engine's verdict, decoded/attested. */}
          <span className="wall-verdict attested">
            <span className="wall-glyph" aria-hidden="true">{attestedGlyph}</span>
            {cat.verdictLevelName} · on record
          </span>
        </header>
        <p className="wall-plan">
          plan <span className="wall-mono" title={cat.planId}>{shortHash(cat.planId)}</span>
          {' · '}attempt {cat.attemptsPerVariant} — no supersedes chain{' · '}rustc-1.93.0
        </p>

        {/* THE GAUGES — the campaign's statistical verdict, on record (attested •). Bounds decoded from pinned
            f64 bits (never a platform recompute); the whole block is FAIL-CLOSED — a manifest that does not
            validate as THIS campaign's certified verdict renders ONE '?' unverifiable state with a reason, never
            a partial/wrong-band/false-pass row. Per-open discriminated load state, cleared to `loading`. */}
        {load.kind === 'loaded' ? (
          <ul className="wall-gauges">
            {load.members.map((g) => (
              <li key={g.kind} className="wall-gauge" title={`${g.kind} — statistic ${g.statisticText} · band [${g.criticalLo} — ${g.criticalHi}] · dof ${g.dof} · α ${g.alphaPpm}ppm · ${g.sidedness}`}>
                <span className="wall-gauge-kind">{g.label}</span>
                <span className="wall-gauge-stat">{gaugeDisplay(g.statistic)}</span>
                <span className="wall-gauge-band" aria-hidden="true">
                  <span className="wall-gauge-lo">{gaugeDisplay(g.criticalLo)}</span>
                  <span className="wall-gauge-track">
                    <span className="wall-gauge-tick" style={{ left: `${g.position * 100}%` }} />
                  </span>
                  <span className="wall-gauge-hi">{gaugeDisplay(g.criticalHi)}</span>
                </span>
                <span className="wall-gauge-meta">dof {g.dof} · α {g.alphaPct}</span>
                {/* Statistical decision hue (verdict pair), attested • glyph — never integrity green. */}
                <span className={g.pass ? 'wall-gauge-pass' : 'wall-gauge-fail'}>
                  <span className="wall-glyph" aria-hidden="true">{attestedGlyph}</span>
                  {g.pass ? 'pass' : 'fail'}
                </span>
              </li>
            ))}
          </ul>
        ) : load.kind === 'invalid' ? (
          // FAIL-CLOSED: the vendored manifest did not validate as this campaign's certified verdict — the '?'
          // unverifiable voice (a no-verdict state, dim; NEVER the integrity ✗) + the machine reason. No gauge
          // is drawn: absence of a trustworthy verdict is stated, never a fabricated or partial one.
          <p className="wall-gauges-invalid">
            <span className="wall-glyph" aria-hidden="true">{requireGlyph('unverifiable')}</span>
            aggregate verdict unverifiable — <code>campaign-manifest.json</code> failed validation ({load.reason}); press verify to recompute each seed’s bytes.
          </p>
        ) : (
          <p className="wall-gauges-empty">aggregate verdict on record — <code>campaign-manifest.json</code> {load.kind === 'loading' ? 'is loading…' : 'did not load'}; press verify to recompute each seed’s bytes.</p>
        )}

        {/* THE SEED FIELD — 50 seed-numbered cells, seed-ordered (earned geometry, no fake scatter). Each
            consumes a voices-module glyph via its store phase. At rest: all attested • (zero green). */}
        <div className="wall-grid" role="list" aria-label="campaign seeds">
          {cat.seeds.map((s) => {
            const id = String(s.seed)
            const v = seedVoice(phase[id] ?? 'pending')
            return (
              <span key={id} role="listitem" className={`wall-dot ${v.cls}`} title={`seed ${s.seed} · ${v.label}`}>
                <span className="wall-dot-glyph" aria-hidden="true">{requireGlyph(v.markId)}</span>
                <span className="wall-dot-seed">{s.seed}</span>
              </span>
            )
          })}
        </div>

        {/* THE CENSUS — exact integers, and the reduced-motion narration (aria-live). It opens by declaring
            what has NOT been verified; it counts up in true completion order as the field lights. */}
        <div className="wall-footer">
          <p className="wall-census" aria-live="polite">{censusLine(rollup)}</p>
          {verifying
            ? <button className="wall-cancel" onClick={cancelVerifyAll}>cancel</button>
            : <button className="wall-cta" onClick={startVerifyAll}>verify all {cat.nSeeds}</button>}
        </div>

        {/* THE TAMPER MOMENT: the ✗ path made demonstrable. Beneath the census — the field proves fifty
            green receipts; this proves the refusal. Its result lives in the panel's OWN ephemeral state and NEVER
            enters the campaign store (the session census above stays pure); the fetched seed-42 bytes are cloned
            before one byte is flipped, so nothing published is touched. See tamperDemoView.tsx. */}
        <TamperDemoPanel cat={cat} abortRef={demoAbortRef} />

        <p className="wall-disclaimer">{DISCLAIMER}</p>
        <button className="wall-close" onClick={handleClose}>close (Esc)</button>
      </div>
    </div>
  )
}
