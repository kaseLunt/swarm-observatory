import { memo, useCallback, useMemo } from 'react'
import type { RunModel } from '../model/runModel'
import { EVENT_KIND_NAMES, GEOMETRY_QUERY_KIND_NAMES } from '../decode/payloads'
import { useViewStore, syncUrl } from '../state/viewStore'
import { usePlayheadSample } from './usePlayheadSample'
import { categoryOf } from './categorize'
import { CATEGORY } from './theme'
import { buildQueryDraws, losComponents, queryStageApplies, E0_REGISTRATION, type QueryDraw } from './queryStage'
import { showMath, recomputeAll, type MathCard } from './showMath'
import { buildSensingStage, sensingRegister } from './sensingStage'
import { SensingStrip, SensingLiveStrip } from './sensingStrip'
import { buildCommsStage, commsStageApplies } from './commsStage'
import { CommsStrip } from './commsStrip'
import { buildTrackBelief, trackBeliefApplies } from './trackBelief'
import { TrackBeliefStrip } from './trackBeliefStrip'
import { recomputedVerdict } from './lensContract'
import type { AgreeSource } from './agreeSource'
import { identityPlate, fullPlate } from './identityPlate'
import { HORIZON_HOPS, HORIZON_OPTS, causalNeighborhood, type NeighborhoodSummary } from './chain'
import type { StateFrame } from '../lib/brand'
import { markClass, requireGlyph, type MarkKey } from './voices'

// draw.kind → the e0 recomputed pixel-class whose DECLARED AgreeSource arm a ShowTheMath card's verdict wears.
// Resolved ONCE at module load, fail-loud if a class or its arm drifted (the registry discipline at
// the render boundary). The verdict mark is then derived from the arm, not a bare boolean, so a
// decoded-consistency arm would wear the ○ ring — never the ✓ — and render its basis note beside the mark.
const queryArmOf = (classId: string): AgreeSource => {
  const a = E0_REGISTRATION.provenance.find(p => p.id === classId)?.agree
  if (!a) throw new Error(`Inspector: e0 class '${classId}' declares no AgreeSource — its verdict mark cannot derive a witness`)
  return a
}
const QUERY_VERDICT_ARM: Record<QueryDraw['kind'], AgreeSource> = {
  1: queryArmOf('region-verdict'),
  2: queryArmOf('range-scalar'),
  3: queryArmOf('occluder-verdict'),
  4: queryArmOf('los-verdict'),
}

// The verdict mark + basis note for a ShowTheMath card, derived from the class's DECLARED arm. An
// unverifiable card (no basis to recompute — a missing LOS composite) stays the ? no-verdict state; otherwise
// the mark comes from recomputedVerdict, which DEMANDS card.agree's brand and HONORS agree.basis (✓ for a
// live-inputs agreement, ○ for a decoded-consistency one, ✗ on disagreement).
export function showMathMark(card: MathCard, arm: AgreeSource): { mark: MarkKey; note: string } {
  // A null agree = NO comparison ran (a missing LOS composite) → the '?' no-verdict state. Narrowing on it
  // reduces card.agree from AgreementResult<boolean> | null to the branded boolean recomputedVerdict DEMANDS,
  // so a null can NEVER reach a verdict mark — the typecheck forces this branch first. card.unverifiable
  // is the display driver and coincides with agree===null (the executor sets both in the missing-composite arm).
  if (card.agree === null) return { mark: 'unverifiable', note: '' }
  return recomputedVerdict(arm, card.agree)
}

// What the chainmeta chip needs — sourced ENTIRELY from the SAME causalNeighborhood traversal the pixels come
// from (never a second walk that could disagree). `up`/`down` are the RETAINED neighbourhood counts (≤ HORIZON_HOPS
// each), NOT whole-chain totals — presenting a bounded count as the total would be the exact lie this wave kills.
export interface ChainMeta {
  up: number
  down: number
  upBeyond: boolean                                    // the chain continues past the ancestor horizon
  downBeyond: boolean                                  // the chain continues past the descendant horizon
  truncated: NeighborhoodSummary['truncated']          // a per-hop breadth cut, if any
}

// The Inspector's chainmeta declaration — the ONE place the collapsed
// ancestry is declared, and it lives in EXISTING chrome (no new surface). The counts are the horizon-bounded
// neighbourhood's RETAINED up/down — the same members the stage and timeline light. " · nearest N shown" is
// appended IFF the chain actually extends beyond the horizon on either side (a cheap boundary probe), so it never
// overclaims aggregation when the whole chain is already lit (a root/leaf/short selection stays bare). If a hop was
// truncated by the per-hop cap, " · N dropped" says so honestly — the count-true summary made visible, never a
// silent drop. Pure.
export function chainMetaText(m: ChainMeta): string {
  const parts = [`${m.up} up · ${m.down} down`]
  if (m.upBeyond || m.downBeyond) parts.push(`nearest ${HORIZON_HOPS} shown`)
  if (m.truncated) parts.push(`${m.truncated.dropped} dropped`)
  return parts.join(' · ')
}

// Referentially-stable empty list for the unselected branch: keeping ONE identity means the
// subjectEvents useMemo below returns the same array every tick when nothing is selected, so its
// consumers don't churn. A fresh `[]` each render would defeat that stability.
const EMPTY_EVENTS: never[] = []

// Category glyph shown before a kind name — the color-blind-safe redundant channel (shape, not just
// hue) carried everywhere a category appears. Colored with the category token hue.
function CatGlyph({ kind }: { kind: number }) {
  const cat = categoryOf(kind)
  return <span className="cat-glyph" style={{ color: CATEGORY[cat].hue }}>{CATEGORY[cat].glyph}</span>
}

export function Inspector({ model, open = false, tourActive = false }: { model: RunModel; open?: boolean; tourActive?: boolean }) {
  const sel = useViewStore(s => s.selectedEntity)
  const ev = useViewStore(s => s.selectedEvent)
  const tick = usePlayheadSample(8)
  // 8Hz split: usePlayheadSample re-renders this component 8×/s during playback, but the events list
  // and EventDetail are tick-INVARIANT (they depend only on sel/model, not the tick). Memoise their
  // inputs — and hoist them ABOVE the early return so the hooks run unconditionally (rules of hooks) —
  // so a held selection keeps stable inputs across ticks; only the agent-state table below re-derives
  // per tick. `pick` is useCallback'd so it stays referentially stable and does not defeat
  // React.memo(EventDetail), whose sole function prop this is.
  const subjectEvents = useMemo(() => (sel ? model.eventsForSubject(sel) : EMPTY_EVENTS), [sel, model])
  const pick = useCallback(
    (n: number) => { useViewStore.getState().select(model.subjectOf(n) ?? sel, n); syncUrl(true) },
    [model, sel],
  )
  // Empty-state voice, THREE-way (v0.6 — honest empty state, constitution LAW 4):
  //   • positioned run (f0/f1/f2a/f3a) → a cone IS on the stage → "click the cone, or the timeline".
  //   • positionless WITH a query stage (e0) → no cone, but the timeline drives the stage → "click the timeline".
  //   • positionless with NO stage lens (f4 — its event kinds carry no kind-23 draws, so the stage stays a
  //     grid) → must NOT invite a click on geometry that isn't there; name the real surfaces instead.
  // hasStageContent reuses the ONE complete applicability predicate (queryStageApplies — positionless AND kind-23
  // draws; the same gate Scene's mount and the honesty chip route through), so all sites agree on "does
  // the stage apply here". Its `&&` short-circuit builds draws only for a positionless run; memoised per model,
  // under App's run-scoped ErrorBoundary, so a malformed-bundle throw lands on the boundary as the stage's does.
  const positionless = useMemo(() => model.entityKeys().length === 0, [model])
  const hasStageContent = useMemo(() => queryStageApplies(model), [model])
  // THE SENSING REGISTER (the reveal clock's first consumer): the kind-22 verdicts ordered by tick + the shared
  // reveal clock over them, built once per model. It drives the LIVE strip — the four-gate instrument follows
  // the playhead instead of a held selection, so it no longer goes dark on free playback or stale during a
  // tour's flight. Built for EVERY model but empty (ordered.length 0) for a non-sensing run, so those runs keep
  // the exact idle empty rail below. Memoised per model (the ShowTheMath / stage precedent — a small pure pass).
  const sensingReg = useMemo(() => sensingRegister(buildSensingStage(model)), [model])
  // THE CONTESTED-LINK strip (f4): the latency lane + the ledger-by-scrub + the two-voice grammar. Gated on the
  // ONE complete comms predicate (commsStageApplies), so it appears iff the comms stage draws — the same gate
  // Scene's mount and the App chip route through. Built once per model; empty-cheap for a non-comms run. On f4
  // the strip OWNS the aside (no per-event detail mode — the strip is a live playhead instrument), so the idle
  // rail below is suppressed the way it is for a sensing run.
  const hasComms = useMemo(() => commsStageApplies(model), [model])
  // Built ONLY when the comms lens applies — commsStageApplies short-circuits on a positioned run before it
  // decodes anything, so a non-comms run (or a minimal test mock lacking the comms accessors) never builds.
  const commsData = useMemo(() => (hasComms ? buildCommsStage(model) : null), [hasComms, model])
  // THE BELIEF strip (f3a): the 1σ readout + the shrink + the update tally-by-scrub. Gated on the ONE complete belief
  // predicate (trackBeliefApplies), so it appears iff the belief stage draws — the same gate Scene's mount and the App
  // chip route through. Built once per model; null-cheap for a non-track run. On f3a the strip is a LIVE playhead
  // instrument (like the sensing live / comms strips), so it owns the aside even with nothing selected.
  const hasBelief = useMemo(() => trackBeliefApplies(model), [model])
  const beliefData = useMemo(() => (hasBelief ? buildTrackBelief(model) : null), [hasBelief, model])
  // Is the SELECTED event itself a sensing verdict? Then the detail path (EventDetail's SensingStrip) pins that
  // ONE verdict's full form and the live register stands down — the two modes are mutually exclusive. Memoised
  // on [model, ev] so the 8Hz playback sampling never re-decodes the selected payload to re-answer this.
  const evIsSensing = useMemo(() => ev !== null && model.eligibilityAt(ev) !== null, [model, ev])
  // Show the live register whenever the run carries verdicts AND (a tour is running OR a specific verdict is
  // NOT being inspected). The tour clause is load-bearing: a tour holds a sensing selection (event #99 at tick
  // 48) while its play beats advance the playhead to later ticks — so a running tour must let the live strip
  // OWN the sensing aside and track the playhead, or the strip would freeze on the tick-48 gates while the
  // caption narrates tick 56/67/82. It reads correct at the hold beat too: the playhead sits at 48 there, so
  // the live strip shows the same tick-48 verdict the held detail would. Outside a tour, a user-held sensing
  // selection still pins EventDetail (the point of selecting) — that is the DETAIL mode; the two never coexist.
  const showLiveStrip = sensingReg.ordered.length > 0 && (tourActive || !evIsSensing)
  // DESIGNED EMPTY STATE (stable stage viewport). The inspector column is permanently
  // RESERVED in the desktop grid (app.css: fixed first track), because mounting/unmounting this aside
  // resized the 3D canvas ~250px sideways on every selection change — corrupting every held frame (tour
  // arrivals, the finale hero-click, Esc). With the column always occupied, no selection renders quiet,
  // honest chrome instead of nothing: what would appear here, and how to summon it. This also fills the
  // app's one missing empty state (every other surface already has an honest empty posture). Below the
  // 1080px breakpoint the aside is an off-canvas overlay (position: fixed), so the drawer mechanics are
  // unchanged — the toggle now simply shows this hint instead of a blank slide-in.
  // The idle empty rail — no selection AND no live register to show. A sensing run with verdicts falls through
  // to the main aside below (which renders the live strip even with nothing selected), so its strip is live on
  // free playback. Every non-sensing run keeps this exact centred empty rail (byte-identical): f4's "no stage
  // lens" voice, f0/f1/f2a-free's hints.
  if (!sel && ev === null && sensingReg.ordered.length === 0 && !hasComms && !hasBelief) return (
    <aside className={open ? 'inspector inspector-idle open' : 'inspector inspector-idle'}>
      <p className="inspector-empty">
        no selection
        <span>{!positionless
          ? 'click the drone, or the timeline, to inspect'
          : hasStageContent
            ? 'click the timeline to inspect an event'
            : 'this run’s event kinds have no stage lens yet — the timeline and inspector are its surfaces'}</span>
      </p>
    </aside>
  )
  // The state panel reads the entity at the RAW playhead frame — offset 0, the committed integer tick (this is
  // the data panel's own semantics; the rendered cone applies the sensing offset separately). Brand the clamped
  // frame StateFrame at this accessor boundary. NOTE: on a sensing run this frame is one step behind the
  // cone's evaluated frame (k vs k+1) — a deliberate divergence, flagged for the bench, not changed here.
  const t = Math.min(tick, model.tickCount)
  const st = sel ? model.entityStatesAt(t as StateFrame).get(sel) : undefined
  return (
    <aside className={open ? 'inspector open' : 'inspector'}>
      {sel && (
        <section>
          {/* Identity is typographic: the full plate retires "agent {key}" — glyph · callsign · class
              noun · data-true key. The raw key still rides the URL (sel=…); the callsign never serializes. */}
          <h2 className="identity-plate">{fullPlate(identityPlate(sel, 'entity'))}</h2>
          {st ? (
            <table><tbody>
              <tr><td>alive</td><td><span className={st.alive ? 'pill pill-ok' : 'pill pill-off'}>{String(st.alive)}</span></td></tr>
              <tr><td>pos</td><td>{st.pos.length ? st.pos.map(v => v.toFixed(2)).join(', ') : '(none)'}</td></tr>
              <tr><td>heading</td><td>{st.headingRad.toFixed(4)} rad</td></tr>
              <tr><td>speed</td><td>{st.speedMps.toFixed(2)} m/s</td></tr>
              <tr><td>fuel</td><td>{st.fuel.toFixed(2)}</td></tr>
            </tbody></table>
          ) : <p>(not present at tick {t})</p>}
        </section>
      )}
      {sel && subjectEvents.length > 0 && (
        <section>
          <h2>events · {subjectEvents.length}</h2>
          <ul className="evlist">
            {subjectEvents.map(n => {
              // Decode the envelope once per row — kind was previously read via two eventAt(n) calls
              // (each re-decodes the payload span) to build one label.
              const k = model.eventAt(n).kind
              return (
                <li key={n} className={n === ev ? 'active' : ''}>
                  <button onClick={() => pick(n)}><CatGlyph kind={k} /> #{n} t{model.ticks[n]} {EVENT_KIND_NAMES[k] ?? k}</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {ev !== null && <EventDetail model={model} seq={ev} onPick={pick} showSensingStrip={!tourActive} />}
      {/* THE LIVE SENSING STRIP — the four-gate instrument tracks the playhead (the reveal clock's current
          verdict), so it is live on free playback, stays current under a held entity/non-sensing selection, and
          OWNS the aside while a tour flies (the tour holds a sensing selection but the playhead moves). It is
          suppressed only for a user-held sensing verdict outside a tour (EventDetail's strip is the detail mode
          then — and EventDetail suppresses ITS strip whenever a tour is active), and absent on non-sensing runs;
          the two modes never both draw. Fed the same 8Hz playhead sample the state panel reads. */}
      {showLiveStrip && <SensingLiveStrip reg={sensingReg} tick={tick} />}
      {/* THE CONTESTED-LINK strip (f4) — the latency lane + the ledger-by-scrub, driven by the playhead (the
          reveal clock), so it writes itself as the viewer scrubs. It owns the aside on a comms run the way the
          sensing live strip owns it on a sensing run; the two lenses are mutually exclusive by their gates. */}
      {hasComms && commsData && <CommsStrip data={commsData} tick={tick} />}
      {/* THE BELIEF strip (f3a) — the 1σ readout + the shrink + the update tally, driven by the playhead (the reveal
          clock), so it writes itself as the viewer scrubs. It owns the aside on a track run the way the sensing/comms
          live strips own it on theirs; the four lenses are mutually exclusive by their gates. */}
      {hasBelief && beliefData && <TrackBeliefStrip data={beliefData} tick={tick} />}
    </aside>
  )
}

// Tick-invariant: depends only on seq/model. Memoised so the Inspector's 8Hz playback sampling does
// not re-render it — its props (model, seq, onPick) are all stable while a selection is held (onPick is
// useCallback'd in the parent; verified no inline-object/closure prop reaches it).
const EventDetail = memo(function EventDetail({ model, seq, onPick, showSensingStrip = true }: { model: RunModel; seq: number; onPick: (n: number) => void; showSensingStrip?: boolean }) {
  const e = model.eventAt(seq)
  const q = model.geometryQueryAt(seq)
  // The sensing verdict for a kind-22 event (with its decoded target pose attached) — built only when the
  // selected event IS a kind-22 (eligibilityAt is a cheap kind-gate + one payload decode). The four-gate
  // strip is the Q5 "can I trust this pixel?" answer for a sensing verdict, as ShowTheMath is for a query.
  const sensingDraw = useMemo(
    () => (model.eligibilityAt(seq) ? buildSensingStage(model).draws[seq] ?? null : null), [model, seq])
  // The chainmeta counts come from the SAME bounded neighbourhood the stage/timeline/links draw (HORIZON_OPTS),
  // probeHorizon = true so the chip can honestly say whether the chain extends past the horizon. The nav buttons
  // read the immediate cause (envelope causationId) and nearest effect (first child) directly — O(1), no full chain.
  const nb = causalNeighborhood(model, seq, HORIZON_OPTS, true)
  const firstEffect = model.childrenOf(seq)[0]
  const meta: ChainMeta = {
    up: nb.ancestors, down: nb.descendants,
    upBeyond: nb.ancestorsBeyond, downBeyond: nb.descendantsBeyond,
    truncated: nb.summary.truncated,
  }
  return (
    <section>
      <h2>event #{seq}</h2>
      <table><tbody>
        <tr><td>kind</td><td><CatGlyph kind={e.kind} /> {EVENT_KIND_NAMES[e.kind] ?? e.kind}</td></tr>
        <tr><td>tick</td><td>{e.tick}</td></tr>
        {q && <>
          <tr><td>query</td><td>{GEOMETRY_QUERY_KIND_NAMES[q.queryKind] ?? q.queryKind}</td></tr>
          <tr><td>result</td><td className={q.resultFlag ? 'flag-true' : 'flag-false'}>{String(q.resultFlag)}{q.tiebreakApplied ? ' (tiebreak)' : ''}</td></tr>
          <tr><td>scalars</td><td>{q.resultScalars.map(v => v.toFixed(4)).join(', ') || '—'}</td></tr>
        </>}
      </tbody></table>
      <p className="chainnav">
        {e.causationId !== null && <button onClick={() => onPick(e.causationId!)}>← cause #{e.causationId}</button>}
        {firstEffect !== undefined && <button onClick={() => onPick(firstEffect)}>effect #{firstEffect} →</button>}
        <span className="chainmeta">{chainMetaText(meta)}</span>
      </p>
      {q && <ShowTheMath model={model} seq={seq} />}
      {/* The DETAIL strip — one selected verdict's full form. Suppressed while a tour is active (showSensingStrip
          false): the tour holds this selection but its playhead moves, so the LIVE strip owns the sensing aside
          and tracks the playhead instead of this frozen selection. Outside a tour it renders as before. */}
      {showSensingStrip && sensingDraw && <SensingStrip draw={sensingDraw} />}
    </section>
  )
})

// SHOW THE MATH (v0.6) — the Q5 "can I trust this pixel?" answer for a selected kind-23
// query, rendered as a new ANSWER inside the Inspector instrument (LAW 4: no new chrome). The pinned decision
// form (contract/EXP-E0-decision-forms-excerpt.md) with the decoded numbers substituted, then the verdict
// RECOMPUTED in-browser (showMath — pure arithmetic, NEVER a bearing) and compared to the engine's: a match
// wears the ✓ (verified voice, recomputed-and-matched EXCLUSIVELY); a disagreement wears the ✗ (mismatch
// voice — display-tier, spec §11, never hidden). The bearing is a pinned vendored-libm bit — a CLAIM row (no
// ✓), the quieter voice of the provenance panel's `attested`. The footer proves the whole run: engine-vs-ours
// on all 75. buildQueryDraws is re-run here (memoised per model) so the Inspector stays self-contained — the
// Scene builds its own copy for the stage; a ~75-event pure pass, not worth threading through App.
function ShowTheMath({ model, seq }: { model: RunModel; seq: number }) {
  const stage = useMemo(() => buildQueryDraws(model), [model])
  const summary = useMemo(() => recomputeAll(stage.draws, stage.losComposites), [stage])
  const draw = stage.draws[seq]
  if (!draw) return null
  const card = showMath(draw, draw.kind === 4 ? losComponents(seq, stage) : null)
  // The verdict mark is derived from the class's DECLARED AgreeSource arm, not re-decided from a bare
  // boolean: ? unverifiable (recompute impossible — a no-verdict state, never a false ✗) · ✓ verified /
  // ○ self-consistent (per the arm's basis) · ✗ mismatch (disagreed). card.agree's brand makes this
  // load-bearing — a plain boolean cannot flow into the mark resolver.
  const { mark: vmark, note } = showMathMark(card, QUERY_VERDICT_ARM[draw.kind])
  return (
    <section className="showmath">
      <h2>show the math</h2>
      <p className="showmath-form">{card.form}</p>
      <table><tbody>
        {card.lines.map(l => (
          <tr key={l.label}><td>{l.label}</td><td>{l.value}</td></tr>
        ))}
      </tbody></table>
      <p className={`showmath-verdict ${markClass(vmark)}`}>
        <span className="showmath-glyph">{requireGlyph(vmark)}</span>
        <span>{card.unverifiable
          ? card.verdict
          : `recompute ${card.verdict}${card.agree ? ' · matches engine' : ` · engine ${card.engine}`}`}</span>
      </p>
      {/* the arm's basis note, visible beside the mark (ev99's note convention): a live-inputs row
          reads "recomputed from live decoded inputs"; a decoded-consistency row would read "…no external
          oracle" beside its ○ ring, so the union is worn at the mark, never demoted to prose. */}
      {note && <p className="showmath-note showmath-basis">{note}</p>}
      {card.claims.map(c => (
        <p className="showmath-claim" key={c.label}>
          <span className="showmath-claim-val">{c.label} {c.value}</span>
          {card.claimNote && <span className="showmath-note">{card.claimNote}</span>}
        </p>
      ))}
      <p className="showmath-agg">in-browser recompute · {summary.agreed}/{summary.total} agree</p>
    </section>
  )
}
