import { useEffect, useMemo, useRef } from 'react'
import type { RunModel } from '../model/runModel'
import { EVENT_KIND_NAMES } from '../decode/payloads'
import { useViewStore, syncUrl } from '../state/viewStore'
import { notifyUserInput, isTourActive } from '../tour/interrupt'
import { deriveChapters, chapterBands, chapterAt } from '../tour/chapters'
import { advancePlayhead } from '../state/transport'
import { captureSpeed, frameDeltaMs } from '../state/captureClock'
import { densityBins, densityMode } from './density'
import { activeChain, type ChainGeometry } from './chain'
import {
  assignLanes, heatAggregateAt, heatBinAtPx, laneClickSeq, laneHeightFrac, laneHitAtY, laneTopFrac,
  nearestSeqAt,
} from './lanes'
import { hoverIdentity, type HoverTarget } from './timelineHover'
import { usePlayheadSample } from './usePlayheadSample'
import { formatSimClock, hasRealSimClock } from './hangar'
import { CATEGORY, PALETTE } from './theme'
// SPEEDS reaches ui via keyboard.ts's re-export, never a direct ../state/speeds import: speeds.ts
// homes the ladder in state/ so the store can clamp to it (state→state), and ui consumers layer on
// top through keyboard.ts (its own comment declares this). Retires the inline [0.25,1,4,8] literal.
import { SPEEDS, isLadderSpeed } from './keyboard'

// Tiny local hex → [r,g,b] parse so canvas rgba() strings can be composited from design tokens with
// per-element alpha. Parses ONCE at module scope (chain overlay) or once-per-model (density fills) —
// never in the rAF draw loop (frame-loop rule).
const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// Causal-chain overlay is the causality voice, not time. R3 swatch (owner-approved 2026-07-09): it now reads
// the dedicated `spine` violet — un-borrowed from the amber time-cursor so the gold playhead line (still
// timeCursor, below) cuts cleanly through the chain instead of hiding inside a gold comb of arcs and ticks.
// Composited once here — not per frame; the alphas are unchanged (only the base hue moved off timeCursor).
const [tcR, tcG, tcB] = rgb(PALETTE.spine)
const CHAIN_ARC = `rgba(${tcR},${tcG},${tcB},0.35)`
const CHAIN_MARK = `rgba(${tcR},${tcG},${tcB},0.9)`
// Chapter band furniture — composited ONCE at module scope (frame-loop rule), never per frame.
// TINT is bgElevated over bgPanel at low alpha: a barely-there lift that separates segments without
// fighting the query-hued density ribbon. EDGE is the brighter border token for a crisp 1px divider.
const [beR, beG, beB] = rgb(PALETTE.bgElevated)
const BAND_TINT = `rgba(${beR},${beG},${beB},0.55)`
const [bbR, bbG, bbB] = rgb(PALETTE.borderBright)
const BAND_EDGE = `rgba(${bbR},${bbG},${bbB},0.6)`
// Chapter-label typography: --fs-mono (0.72rem ≈ 11px) in the house sans family, faint. Canvas can't
// resolve CSS custom properties, so the size is inlined; font/baseline are set once on the ctx (they
// persist across frames — no per-frame font churn). PAD is the left inset of the label from its band.
const BAND_FONT = "11px 'Segoe UI', system-ui, sans-serif"
const BAND_LABEL_PAD = 4
// Lane rendering (constitution §5 kind-separated lanes + progressive density). Band GEOMETRY (the
// lanes.ts LABEL_BAND reservation + lane tiling, via laneTopFrac/laneHeightFrac) lives in lanes.ts — the
// single source the pointer hit-testing shares — so draw and hover can never disagree about rows. A SPARSE lane draws
// one MARK_W-wide mark per event (hover-identifiable); a DENSE lane (past densityMode's threshold) fills
// with alpha-graded heat — HEAT_BINS columns capped at HEAT_ALPHA (well under 1) so the field stays calm
// and the meaning-bearing overlays (chain, selection, playhead) ride cleanly on top.
const MARK_W = 1.5
const HEAT_BINS = 200
const HEAT_ALPHA = 0.68
// Kind → display name for hover identity, mirroring the Inspector's fallback-to-number contract
// (EVENT_KIND_NAMES covers every registry kind — incl. the motion substrate 0x0120/0x0121 named in
// v0.7; a kind outside the registry still falls through to its numeric id).
const kindName = (kind: number): string => EVENT_KIND_NAMES[kind] ?? String(kind)

// Below this many pixels of pointer travel a press is a CLICK (selects the nearest event); at or above
// it the press is a scrub-DRAG (moves the playhead live). Small enough that a deliberate drag registers
// instantly, large enough that a jittery click never scrubs by accident.
const DRAG_THRESHOLD = 4

// Pixel → tick, clamped to the model's tick range. Pure + exported for unit test. setTick clamps the
// LOWER bound (0), but a drag PAST the right edge yields clientX > rect.right → a raw tick > tickCount
// that nothing downstream clamps; without the UPPER clamp the playhead would rest beyond the final
// tick. Clamping the upper bound here makes a past-edge drag rest exactly on the final tick (tickCount).
export const tickAtX = (clientX: number, rectLeft: number, rectWidth: number, tickCount: number): number =>
  Math.min(tickCount, Math.round(((clientX - rectLeft) / rectWidth) * tickCount))

export function Timeline({ model }: { model: RunModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Pointer-gesture scratch: distinguishes a click (select) from a drag (scrub) across down→move→up.
  // A plain ref (not state) — gesture bookkeeping must never trigger a render.
  const dragRef = useRef<{ startX: number; moved: boolean; pointerId: number; shift: boolean } | null>(null)
  const speed = useViewStore(s => s.speed)
  const playing = useViewStore(s => s.playing)
  // During a tour play step the store speed is the OFF-LADDER witness pace, so no ladder member
  // matches `s === speed`. Computed once per render (a cheap membership check, not per button) so the
  // ladder can dim honestly rather than lie with a nearest-match highlight. isLadderSpeed is the single
  // source (state/speeds via keyboard.ts) shared with the share-link guard (shareSpeed) — same rule.
  const offLadder = !isLadderSpeed(speed)

  // Derived-once-per-model timeline structure — all pure, model-only. The tick-domain chapters (also the
  // hover chapter lookup), the per-event kind column (hover kind name + lane assignment), and the per-kind
  // lanes. useMemo keeps the O(eventCount) envelope decodes off every render; BOTH the rAF effect and the
  // pointer handlers read these, so deriving them here (not inside the effect) shares one copy across both.
  const chapters = useMemo(() => deriveChapters(model), [model])
  const kinds = useMemo(() => {
    // model.kindAt reads the pre-decoded kind array (a plain index) — NOT eventAt(i).kind, whose
    // decodeEvent re-parses the whole payload span for every event on each model change (review finding).
    const k = new Uint16Array(model.eventCount)
    for (let i = 0; i < model.eventCount; i++) k[i] = model.kindAt(i)
    return k
  }, [model])
  const lanes = useMemo(() => assignLanes(kinds), [kinds])
  // Per-lane density mode + hit/draw data. laneData[i] is the lane's (tick, seq) pairs sorted by tick
  // (then seq — the decoder does not enforce tick monotonicity, so sort rather than assume): the SAME
  // arrays the draw loop renders marks/heat from and nearestSeqAt/heatAggregateAt binary-search in the
  // pointer handlers — draw and hit-test can never disagree about a lane's contents. heatN is the heat
  // bin count, capped at the tick count so a lane can't oversample its own axis; the pointer's aggregate
  // span uses the SAME value, so the hover describes exactly the bin the draw painted.
  const laneModes = useMemo(() => lanes.map(l => densityMode(l.seqs.length)), [lanes])
  const laneData = useMemo(() => lanes.map(l => {
    const order = [...l.seqs].sort((a, b) => (model.ticks[a]! - model.ticks[b]!) || (a - b))
    return { ticks: Float64Array.from(order, s => model.ticks[s]!), seqs: order }
  }), [lanes, model])
  const heatN = Math.min(HEAT_BINS, Math.max(1, model.tickCount))

  // Active causal chain for the selected event — recomputed only in the subscription effect below;
  // the rAF draw loop reads this ref (never React) to stay allocation-free per frame (frame-loop rule).
  // Effect-local (not module scope): a module-level ref would survive a Timeline unmount/remount
  // (run-switch goes through the loading screen, which unmounts Timeline) and could satisfy the
  // idle-repaint skip below on the new run's very first frame, leaving the canvas blank.
  const activeChainRef = useRef<ChainGeometry | null>(null)
  // Previous-frame scratch for the idle-repaint skip. When paused and nothing observable changed
  // (tick, fraction, selectedEvent, canvas size, chain-ref identity), the draw is a no-op.
  const prevTickRef = useRef(NaN)
  const prevFractionRef = useRef(NaN)
  const prevSelectedEventRef = useRef<number | null>(null)
  const prevWRef = useRef(NaN)
  const prevHRef = useRef(NaN)
  const prevChainRef = useRef<ChainGeometry | null>(null)

  // Recompute the chain geometry off the frame loop: seed from current selection, then react to
  // selectedEvent changes. Writes the ref the draw loop consumes. activeChain is the selection gate —
  // null selection ⟹ null geometry ⟹ no arcs drawn (arcs reserved for selection, LAW 1).
  useEffect(() => {
    const compute = (ev: number | null) => { activeChainRef.current = activeChain(model, ev) }
    compute(useViewStore.getState().selectedEvent)
    return useViewStore.subscribe((s, prev) => { if (s.selectedEvent !== prev.selectedEvent) compute(s.selectedEvent) })
  }, [model])

  useEffect(() => {
    // Reset the idle-repaint sentinels for this mount/model so frame one always paints — otherwise
    // a fresh mount could inherit values from a previous run that happen to match the new run's
    // first frame and skip painting entirely (blank canvas until interaction).
    prevTickRef.current = NaN
    prevFractionRef.current = NaN
    prevSelectedEventRef.current = null
    prevWRef.current = NaN
    prevHRef.current = NaN
    prevChainRef.current = null
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    // Per-lane fill precompute (ONCE per model; the rAF loop only indexes these — zero per-frame
    // allocation). Each per-kind lane carries: its opaque MARK fill (the lane's CATEGORY hue — hue is
    // identity and does not grow; same-category kind-lanes share it and are told apart by row + hover
    // naming), and — for a DENSE lane only — precomputed alpha-graded heat-bin fill strings (a sparse
    // lane's heat is null; it draws marks, never heat). Tick/seq data + modes come from the component
    // memos (laneData/laneModes) — the same arrays the pointer hit-testing reads.
    const laneMarkFill = lanes.map(l => { const [r, g, b] = rgb(CATEGORY[l.category].hue); return `rgb(${r},${g},${b})` })
    const laneHeat = lanes.map((l, i) => {
      if (laneModes[i] === 'ticks') return null
      const [r, g, b] = rgb(CATEGORY[l.category].hue)
      const dbins = densityBins(laneData[i]!.ticks, model.tickCount, heatN)
      return Array.from(dbins, v => `rgba(${r},${g},${b},${(HEAT_ALPHA * v).toFixed(3)})`)
    })
    // Chapter bands: mapped to the fraction domain (width=1) so the draw loop scales them by the live
    // canvas width with pure arithmetic — the canvas buffer width is read per-frame, so band pixels can
    // never be precomputed. Label widths are measured ONCE now (measureText is not free) and cached
    // alongside; the draw loop only compares a cached width against the band's current pixel width.
    // Setting ctx.font/textBaseline here (not per frame) is deliberate: they persist across the rAF loop.
    const bands = chapterBands(chapters, model.tickCount, 1)
    ctx.font = BAND_FONT
    ctx.textBaseline = 'top'
    const labelW = bands.map(b => ctx.measureText(b.label).width)
    let last = performance.now()
    let raf = 0
    const draw = (now: number) => {
      const s = useViewStore.getState()
      const { width: w, height: h } = canvas
      // Idle-repaint skip: paused and every observable input equal to the last painted frame → no-op.
      if (!s.playing && s.tick === prevTickRef.current && s.fraction === prevFractionRef.current
        && s.selectedEvent === prevSelectedEventRef.current
        && w === prevWRef.current && h === prevHRef.current && activeChainRef.current === prevChainRef.current) {
        last = now
        raf = requestAnimationFrame(draw)
        return
      }
      if (s.playing) {
        // Capture seam: both halves are the IDENTITY whenever capture is not engaged
        // (the default, and always in the live app) — frameDeltaMs returns `now - last` unchanged and
        // captureSpeed returns s.speed unchanged, byte-identical to the wall-clock path (within the load budget). During a
        // ?capture= session frameDeltaMs returns the fixed per-frame delta (the recorded playhead
        // sequence is stable and reproducible on any machine) and captureSpeed pins the rate multiplier
        // to 1: the fps alone encodes capture pacing, so a ?speed= deep link or a mid-capture speed
        // write (keystroke, tour witnessSpeed) is display-only and can never scale the fixed delta —
        // see captureClock.ts. advancePlayhead is otherwise untouched.
        const a = advancePlayhead(s.tick, s.fraction, frameDeltaMs(now - last), captureSpeed(s.speed), model.tickCount)
        // advanceSeq++ marks this write as a TRANSPORT-DRIVEN advance (the playback provenance the comms pulse
        // pool reads) — the terminal frame (a.done → playing:false) still bumps it, so the final played interval
        // is processed BEFORE playback stops (the hero fires on a natural ending), and a scrub/drag never bumps it.
        useViewStore.setState({ tick: a.tick, fraction: a.fraction, playing: !a.done && s.playing, advanceSeq: s.advanceSeq + 1 })
        // End-of-run auto-sync deep-links the resting tick when playback reaches maxTick. SKIP while a
        // tour is active: a tour play step reaches maxTick with the OFF-LADDER witness speed still in
        // the store (the tour listener pauses on arrival, but finish() has not yet restored the ladder
        // speed — and for a mid-tour play step that ends on maxTick, finish() never runs here at all),
        // so syncing now would poison the URL with speed=<witness>. The tour's own exit path
        // (finish → forced syncUrl AFTER restoring the ladder speed) covers the real resting sync.
        // NATURAL-END FINALE (a design ruling): the naive path's destination. At the same edge as the
        // resting-URL sync — a.done on a manual, non-tour play — raise the ephemeral finale flag in the SAME
        // transport batch (the standing load-budget exception; a one-shot store write, never per frame). It drives BOTH
        // the frame-loop consumers (camera close-up, head paint, lit journey) via a Scene subscription AND the
        // React consumers (the entity head repaint, the DOM marker) — a module channel alone could not
        // re-render a React consumer. (e0's QueryStage, which replaced ChainSpine here, needs no finale flag:
        // at the resting tick its own tick subscription already holds the full stage.) The set is IDEMPOTENT:
        // a play-at-rest re-fire (advancePlayhead no-ops
        // at the clamp, a.done && s.playing true again) simply re-sets it, so play-at-rest KEEPS the finale.
        if (a.done && s.playing && !isTourActive()) { syncUrl(true); useViewStore.setState({ finale: true }) }
      }
      last = now
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = PALETTE.bgPanel; ctx.fillRect(0, 0, w, h)
      // Chapter band tint + boundary marks FIRST (background, behind density → label → chain →
      // playhead): alternating subtle tint on even-indexed bands and a 1px boundary mark at each
      // internal segment edge. Everything scales from the fraction-domain bands by the live width;
      // the only per-frame work is arithmetic + draw calls (no allocation, no string building).
      ctx.fillStyle = BAND_TINT
      for (let i = 0; i < bands.length; i += 2) ctx.fillRect(bands[i]!.x * w, 0, bands[i]!.w * w, h)
      ctx.fillStyle = BAND_EDGE
      for (let i = 1; i < bands.length; i++) ctx.fillRect(bands[i]!.x * w, 0, 1, h)
      const tc = Math.max(1, model.tickCount)
      // PER-KIND lanes (§5): events split into one row per distinct kind BELOW the label band so rows
      // mean something; a single-kind run collapses to ONE lane (assignLanes → no empty striping).
      // Progressive density per lane — a SPARSE lane paints individual per-event marks (each hover-
      // identifiable), a DENSE lane paints alpha-graded heat. Band geometry comes from lanes.ts
      // (laneTopFrac/laneHeightFrac — the same functions the pointer hit-testing inverts), scaled by the
      // live canvas height. Pure arithmetic over precomputed fills; zero allocation.
      const laneCount = lanes.length
      if (laneCount > 0) {
        const laneH = laneHeightFrac(laneCount) * h
        for (let i = 0; i < laneCount; i++) {
          const top = laneTopFrac(i, laneCount) * h
          const heat = laneHeat[i]
          if (heat) {
            // Dense: tile alpha-graded bins edge-to-edge across the lane band. Integer-snapped boundaries
            // abut exactly (no sub-pixel AA seam), so a uniform-density lane reads as one calm field.
            const bw = w / heat.length
            for (let b = 0; b < heat.length; b++) {
              ctx.fillStyle = heat[b]!
              const x0 = Math.round(b * bw)
              ctx.fillRect(x0, top, Math.round((b + 1) * bw) - x0, laneH)
            }
          } else {
            // Sparse: one calm category-hued mark per event, inset 1px top/bottom within its lane.
            ctx.fillStyle = laneMarkFill[i]!
            const my = top + 1
            const mh = Math.max(1, laneH - 2)
            const lt = laneData[i]!.ticks
            for (let k = 0; k < lt.length; k++) ctx.fillRect((lt[k]! / tc) * w - MARK_W / 2, my, MARK_W, mh)
          }
        }
      }
      // Chapter labels AFTER the lanes (a dense lane could otherwise overpaint a label) but still behind
      // the chain overlay and playhead — skipped when the band is narrower than its pre-measured label.
      // Labels sit in the reserved LABEL_BAND at the top, clear of the lanes. No allocation per frame.
      ctx.fillStyle = PALETTE.textFaint
      for (let i = 0; i < bands.length; i++) {
        if (bands[i]!.w * w >= labelW[i]! + BAND_LABEL_PAD) ctx.fillText(bands[i]!.label, bands[i]!.x * w + BAND_LABEL_PAD, 3)
      }
      // Causal chain overlay (after lanes, before playhead): quadratic arcs bowing up from the baseline
      // for each causation edge, then a bright tick marker for every chain member. Drawn ONLY when a chain
      // is active (activeChain gates it on selection) — arcs reserved for selection, LAW 1.
      const chain = activeChainRef.current
      if (chain) {
        ctx.strokeStyle = CHAIN_ARC; ctx.lineWidth = 1
        for (let i = 0; i + 1 < chain.arcs.length; i += 2) {
          const xa = (chain.arcs[i]! / tc) * w
          const xb = (chain.arcs[i + 1]! / tc) * w
          ctx.beginPath()
          ctx.moveTo(xa, h)
          ctx.quadraticCurveTo((xa + xb) / 2, h * 0.25, xb, h)
          ctx.stroke()
        }
        ctx.fillStyle = CHAIN_MARK
        for (let i = 0; i < chain.ticks.length; i++) {
          const x = (chain.ticks[i]! / tc) * w
          ctx.fillRect(x - 1, 0, 2, h)
        }
      }
      // Selection mark (drawn ON TOP of the chain, under the playhead): the focal event is already an
      // spine-violet chain member, but "what is selected" must read instantly — so it is lifted out of the
      // chain set into a dominant full-height 3px bar in the app-wide selection hue (accent cyan).
      // This integrates with the chain overlay (elevating that one tick) rather than duplicating it,
      // and gives e0's selected event a mark that clearly dominates the quiet steel density field.
      if (s.selectedEvent !== null) {
        const sx = (model.ticks[s.selectedEvent]! / tc) * w
        ctx.fillStyle = PALETTE.accent
        ctx.fillRect(sx - 1, 0, 3, h)
      }
      const cur = useViewStore.getState()
      const x = ((cur.tick + cur.fraction) / tc) * w
      ctx.fillStyle = PALETTE.timeCursor; ctx.fillRect(x - 1, 0, 2, h)
      // Record this frame's observable inputs for the next idle check.
      prevTickRef.current = cur.tick; prevFractionRef.current = cur.fraction; prevSelectedEventRef.current = s.selectedEvent
      prevWRef.current = w; prevHRef.current = h; prevChainRef.current = chain
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [model, chapters, lanes, laneModes, laneData, heatN])

  const tickAt = (clientX: number, rect: DOMRect) =>
    tickAtX(clientX, rect.left, rect.width, model.tickCount)

  // Discoverability: a plain CLICK selects the nearest event and lights its causal chain
  // (the primary way to explore the chain without knowing the shift modifier); a DRAG scrubs the
  // playhead live; shift-click still selects (kept for muscle memory). The down→move→up split is what
  // separates the two so a click never scrubs and a drag never selects.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { startX: e.clientX, moved: false, pointerId: e.pointerId, shift: e.shiftKey }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  // Lane-aware pointer resolution: the lane under the pointer's Y via lanes.ts's laneHitAtY — the hit
  // POLICY over the same geometry the draw loop tiles with, so the pointed row is always the drawn row.
  // Shared by hover identity AND click selection (symmetry: what a hover names is what a click selects);
  // with ≥2 lanes this is what stops a lower lane's mark answering with a different lane's event at the
  // same tick. Resolves NULL in a multi-lane label band (chapter territory — no lane marks are drawn
  // there) and for an empty run.
  const laneAt = (clientY: number, rect: DOMRect): number | null =>
    lanes.length > 0 ? laneHitAtY((clientY - rect.top) / rect.height, lanes.length) : null

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // HOVER IDENTITY (DOM event-rate, NEVER the frame path; the load budget holds): resolve what sits under the cursor
    // from x + y→lane math and write it to the canvas's native title — the run-switcher's tooltip
    // mechanism made dynamic. Resolution is LANE-SCOPED and mode-aware: a ticks-mode lane names its
    // nearest event by rounded tick (causal arc appended only when the event is in the lit chain — arcs
    // reserved for selection); a heat-mode lane resolves the PAINTED BIN from the RAW x-fraction
    // (heatBinAtPx over backing-store pixels — never via the rounded tick, whose half-tick boundaries would report the neighbor bin
    // across each painted bin's right half) and answers >1 event as an AGGREGATE (count + tick span —
    // naming one event there would be false specificity), a sole-event bin as that event, and an empty
    // stretch — or a multi-lane label band — falls through to the chapter voice. No canvas hit-testing.
    const tick = tickAt(e.clientX, rect)
    const chain = activeChainRef.current
    // The causal-arc voice appears iff the arc is actually DRAWN on the ribbon — and under the aggregation
    // horizon an arc is drawn only when BOTH endpoints are members (a hop-HORIZON_HOPS boundary member's
    // parent is a non-member, so its edge is not on the ribbon). Gate parentSeq on both memberships so the
    // tooltip can never name an arc the overlay didn't paint (honest by construction).
    const arcParent = (seq: number): number | null => {
      if (!chain || !chain.members.has(seq)) return null
      const p = model.parentOf(seq)
      return p !== null && chain.members.has(p) ? p : null
    }
    let event: HoverTarget['event'] = null
    let aggregate: HoverTarget['aggregate'] = null
    const li = laneAt(e.clientY, rect)
    if (li !== null) {
      const ld = laneData[li]!
      if (laneModes[li] === 'heat') {
        // CSS x → BACKING-STORE x (canvas.width — the domain the draw's Math.round tiling lives in), so
        // heatBinAtPx replicates the painted boundaries bit-exactly (e.currentTarget IS the canvas).
        const bx = ((e.clientX - rect.left) / rect.width) * e.currentTarget.width
        const bin = heatBinAtPx(bx, e.currentTarget.width, heatN)
        const agg = heatAggregateAt(ld.ticks, ld.seqs, bin, model.tickCount, heatN)
        if (agg.soleSeq !== null) {
          event = {
            seq: agg.soleSeq, kind: kinds[agg.soleSeq]!, tick: model.ticks[agg.soleSeq]!,
            parentSeq: arcParent(agg.soleSeq),
            subject: model.subjectOfEvent(agg.soleSeq),
          }
        } else if (agg.count > 1) {
          aggregate = { count: agg.count, startTick: agg.startTick, endTick: agg.endTick }
        }
      } else {
        const seq = nearestSeqAt(ld.ticks, ld.seqs, tick)
        if (seq !== null) {
          event = {
            seq, kind: kinds[seq]!, tick: model.ticks[seq]!,
            parentSeq: arcParent(seq),
            subject: model.subjectOfEvent(seq),
          }
        }
      }
    }
    e.currentTarget.title = hoverIdentity({ tick, event, aggregate, chapter: chapterAt(chapters, tick) }, kindName)

    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId || d.shift) return // shift = selection-only, never a scrub
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return
      // Crossed the threshold: this press is a scrub-drag. Source-signal a running tour ONCE (a scrub
      // during a play step is invisible to the delta detector — tick writes are expected then), then
      // scrub live for the remainder of the drag.
      d.moved = true
      notifyUserInput()
    }
    useViewStore.getState().setTick(tickAt(e.clientX, rect))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    // Multi-pointer discrimination: only the pointer that STARTED the gesture may end it. A second
    // finger's pointerup landing on the canvas must not tear down the in-flight drag — match pointerId
    // before clearing (touch-action:none on the canvas keeps the browser from hijacking it as a
    // scroll/pinch gesture, so the primary pointer's stream stays intact).
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    if (d.moved) {
      // A drag scrubbed live; land the final tick and deep-link it.
      useViewStore.getState().setTick(tickAt(e.clientX, rect))
      syncUrl(true)
      return
    }
    // No drag → a CLICK (plain or shift): select IN THE CLICKED LANE via laneClickSeq — the same laneAt
    // resolution and the same mode split the hover uses, so what the hover names is what the click
    // selects. Ticks-mode: nearest event (±2 window). Heat-mode: the painted bin's SOLE event, or a
    // NO-OP on a multi-event bin — the hover just answered "N events" for that bin, and selecting one
    // arbitrary member would claim precision it disclaimed (an aggregate-selection affordance is future
    // work, tracked on the roadmap). A multi-lane label-band click resolves no lane → no selection (the
    // band is chapter territory). Selection-only — a miss never scrubs. Source-signal a running tour
    // first (a click is user input regardless of which branch it takes).
    notifyUserInput()
    const li = laneAt(e.clientY, rect)
    // CSS x → backing-store x for the heat-bin inversion (same mapping as the hover path above).
    const seq = li === null ? null : laneClickSeq(
      laneModes[li]!, laneData[li]!.ticks, laneData[li]!.seqs,
      tickAt(e.clientX, rect), ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      e.currentTarget.width, model.tickCount, heatN,
    )
    if (seq !== null) {
      useViewStore.getState().select(useViewStore.getState().selectedEntity, seq)
      syncUrl(true)
    }
  }

  return (
    <div className="timeline">
      <button onClick={() => {
        notifyUserInput()
        const next = !playing
        useViewStore.getState().setPlaying(next)
        if (!next) syncUrl(true)
      }}>{playing ? '⏸' : '▶'}</button>
      {SPEEDS.map(s => (
        <button
          key={s}
          className={s === speed ? 'active' : offLadder ? 'offladder' : ''}
          title={offLadder ? 'tour is pacing playback — press any speed to take over' : undefined}
          onClick={() => { notifyUserInput(); useViewStore.getState().setSpeed(s) }}
        >{s}×</button>
      ))}
      <div className="timeline-track">
        <canvas
          ref={canvasRef}
          width={1200}
          height={64}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => { const d = dragRef.current; if (d && e.pointerId === d.pointerId) dragRef.current = null }}
        />
        {/* WHISPER-QUIET LEGEND (constitution LAW 4 — a new answer, not new chrome): the smallest honest
            home is one faint line under the ribbon teaching the three marks. textFaint voice, tokens only
            (the swatches ARE the drawn hues — steel event mark, tinted chapter band, spine-violet causal arc);
            aria-hidden because the canvas title already carries per-mark identity to assistive tech. */}
        <div className="timeline-legend" aria-hidden="true">
          <span><i className="tl-sw tl-sw-mark" /> mark = event</span>
          <span><i className="tl-sw tl-sw-band" /> band = chapter</span>
          <span>
            <svg className="tl-sw tl-sw-arc" viewBox="0 0 14 9" width="14" height="9"><path d="M1 8 Q7 0 13 8" /></svg>
            arc = causation
          </span>
        </div>
      </div>
      <TickReadout maxTick={model.tickCount} dtUs={model.manifest?.dtUs} />
    </div>
  )
}

function TickReadout({ maxTick, dtUs }: { maxTick: number; dtUs: number | undefined }) {
  // Sampled subscription: re-renders at most 8×/s while playing (never on the 60Hz frame path),
  // immediately on pause/scrub edges. Closes the readout-every-frame item.
  const tick = usePlayheadSample(8)
  // SIM-CLOCK: a run whose manifest pins a real dt (f2a/f3a/f4, 125000µs) shows genuine sim time
  // as mm:ss.s current / total — the tick survives in the title. The det-only / assumed tier (e0/f0/f1)
  // NEVER reaches this branch (hasRealSimClock is false for them), so it keeps the exact "tick X / Y"
  // readout — no false real-clock claim on a KAT-tier run, and the smoke suite's readout text is intact.
  if (dtUs !== undefined && hasRealSimClock(dtUs)) {
    return (
      <span className="readout" title={`tick ${tick} / ${maxTick}`}>
        {formatSimClock(tick * dtUs)} / {formatSimClock(maxTick * dtUs)}
      </span>
    )
  }
  return <span className="readout">tick {tick} / {maxTick}</span>
}
