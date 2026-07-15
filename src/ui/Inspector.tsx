import { memo, useCallback, useMemo } from 'react'
import type { RunModel } from '../model/runModel'
import { EVENT_KIND_NAMES, GEOMETRY_QUERY_KIND_NAMES } from '../decode/payloads'
import { useViewStore, syncUrl } from '../state/viewStore'
import { usePlayheadSample } from './usePlayheadSample'
import { categoryOf } from './categorize'
import { CATEGORY } from './theme'
import { buildQueryDraws, losComponents, queryStageApplies } from './queryStage'
import { showMath, recomputeAll } from './showMath'
import { buildSensingStage } from './sensingStage'
import { SensingStrip } from './sensingStrip'
import { identityPlate, fullPlate } from './identityPlate'
import { HORIZON_HOPS } from './chain'

// The Inspector's chainmeta declaration (consult-legibility-miniwave §1.3) — the ONE place the collapsed
// ancestry is declared, and it lives in EXISTING chrome (no new surface). The exact up/down counts stay
// data-true; " · nearest N shown" is appended IFF the chain actually extends beyond the horizon on either
// side — so it never overclaims aggregation when the whole chain is already lit (e.g. a root/leaf selection).
// "nearest N shown" covers BOTH the stage and the timeline, which share the one HORIZON_HOPS constant. Pure.
export function chainMetaText(ancestors: number, descendants: number): string {
  const base = `${ancestors} up · ${descendants} down`
  return ancestors > HORIZON_HOPS || descendants > HORIZON_HOPS ? `${base} · nearest ${HORIZON_HOPS} shown` : base
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

export function Inspector({ model, open = false }: { model: RunModel; open?: boolean }) {
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
  // Empty-state voice, THREE-way (v0.6 MUST-FIX, critic ruling 3 — honest empty state, constitution LAW 4):
  //   • positioned run (f0/f1/f2a/f3a) → a cone IS on the stage → "click the cone, or the timeline".
  //   • positionless WITH a query stage (e0) → no cone, but the timeline drives the stage → "click the timeline".
  //   • positionless with NO stage lens (f4 — its event kinds carry no kind-23 draws, so the stage stays a
  //     grid) → must NOT invite a click on geometry that isn't there; name the real surfaces instead.
  // hasStageContent reuses the ONE complete applicability predicate (queryStageApplies — positionless AND kind-23
  // draws; T6 M3 — the same gate Scene's mount and the honesty chip route through), so all sites agree on "does
  // the stage apply here". Its `&&` short-circuit builds draws only for a positionless run; memoised per model,
  // under App's run-scoped ErrorBoundary, so a malformed-bundle throw lands on the boundary as the stage's does.
  const positionless = useMemo(() => model.entityKeys().length === 0, [model])
  const hasStageContent = useMemo(() => queryStageApplies(model), [model])
  // DESIGNED EMPTY STATE (v0.5d bench R1 — stable stage viewport). The inspector column is permanently
  // RESERVED in the desktop grid (app.css: fixed first track), because mounting/unmounting this aside
  // resized the 3D canvas ~250px sideways on every selection change — corrupting every held frame (tour
  // arrivals, the finale hero-click, Esc). With the column always occupied, no selection renders quiet,
  // honest chrome instead of nothing: what would appear here, and how to summon it. This also fills the
  // app's one missing empty state (every other surface already has an honest empty posture). Below the
  // 1080px breakpoint the aside is an off-canvas overlay (position: fixed), so the drawer mechanics are
  // unchanged — the toggle now simply shows this hint instead of a blank slide-in.
  if (!sel && ev === null) return (
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
  const t = Math.min(tick, model.tickCount)
  const st = sel ? model.entityStatesAt(t).get(sel) : undefined
  return (
    <aside className={open ? 'inspector open' : 'inspector'}>
      {sel && (
        <section>
          {/* Identity is typographic (G19): the full plate retires "agent {key}" — glyph · callsign · class
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
      {ev !== null && <EventDetail model={model} seq={ev} onPick={pick} />}
    </aside>
  )
}

// Tick-invariant: depends only on seq/model. Memoised so the Inspector's 8Hz playback sampling does
// not re-render it — its props (model, seq, onPick) are all stable while a selection is held (onPick is
// useCallback'd in the parent; verified no inline-object/closure prop reaches it).
const EventDetail = memo(function EventDetail({ model, seq, onPick }: { model: RunModel; seq: number; onPick: (n: number) => void }) {
  const e = model.eventAt(seq)
  const q = model.geometryQueryAt(seq)
  // The sensing verdict for a kind-22 event (with its decoded target pose attached) — built only when the
  // selected event IS a kind-22 (eligibilityAt is a cheap kind-gate + one payload decode). The four-gate
  // strip is the Q5 "can I trust this pixel?" answer for a sensing verdict, as ShowTheMath is for a query.
  const sensingDraw = useMemo(
    () => (model.eligibilityAt(seq) ? buildSensingStage(model).draws[seq] ?? null : null), [model, seq])
  const { ancestors, descendants } = model.causalChain(seq)
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
        {descendants.length > 0 && <button onClick={() => onPick(descendants[0]!)}>effect #{descendants[0]} →</button>}
        <span className="chainmeta">{chainMetaText(ancestors.length, descendants.length)}</span>
      </p>
      {q && <ShowTheMath model={model} seq={seq} />}
      {sensingDraw && <SensingStrip draw={sensingDraw} />}
    </section>
  )
})

// SHOW THE MATH (v0.6 T4a, directive II.3) — the Q5 "can I trust this pixel?" answer for a selected kind-23
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
  return (
    <section className="showmath">
      <h2>show the math</h2>
      <p className="showmath-form">{card.form}</p>
      <table><tbody>
        {card.lines.map(l => (
          <tr key={l.label}><td>{l.label}</td><td>{l.value}</td></tr>
        ))}
      </tbody></table>
      <p className={card.unverifiable ? 'showmath-verdict unverifiable' : card.agree ? 'showmath-verdict agree' : 'showmath-verdict disagree'}>
        <span className="showmath-glyph">{card.unverifiable ? '?' : card.agree ? '✓' : '✗'}</span>
        <span>{card.unverifiable
          ? card.verdict
          : `recompute ${card.verdict}${card.agree ? ' · matches engine' : ` · engine ${card.engine}`}`}</span>
      </p>
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
