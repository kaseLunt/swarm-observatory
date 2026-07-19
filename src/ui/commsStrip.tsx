import {
  ledgerAt, revealedPairs, dropRevealAt, supportedDropCaveat, commsAnomalyCount, commsDisclosureMode,
  dropReasonName, F4_COMMS_REGISTRATION, type CommsData, type CommsPair,
} from './commsStage'
import { checkPairing } from './commsMath'
import { recomputedVerdict } from './lensContract'
import { eventTickOf } from './cursor'
import { markClass, requireGlyph, qualityPresentation, type QualityCaveat, type MarkKey } from './voices'
import { identityPlate, compactPlate } from './identityPlate'
import type { TransportTick } from '../lib/brand'
import type { AgreeSource } from './agreeSource'

// ── THE CONTESTED-LINK STRIP — f4's INSTRUMENT voice (LAW 3) ─────────────────────────────────────────────────
// The stage draws the duet drama (the pulses + the fizzle); THIS is the density: the LATENCY LANE (sent→delivered
// pairs, the latency visible on a FIXED 0–400µs axis, the ONE gap where the packet never arrived), the
// LEDGER-BY-SCRUB (sent / delivered / lost written from the reveal clock's prefix counts — never a precomputed
// total), the SNR hairline (a labelled constant, never auto-fit), and the two-voice evidence grammar:
//   • the send↔outcome PAIRING wears the ○ self-consistent ring (decoded-consistency — no external oracle pins
//     it), NEVER the ✓ — resolved through recomputedVerdict from the class's DECLARED arm;
//   • the DROP wears the QUALITY REGISTER (• attested + a caveat note, the caveat treatment), a fitness fact about
//     the link, NEVER the integrity ✗ — the same register `dirty:true` wears in the ProvenancePanel.
// The whole strip follows the PLAYHEAD (the reveal clock), so it is live on free playback and writes itself as
// the viewer scrubs. `tick` is the plain store playhead (a TransportTick); it is branded into the event domain
// HERE at this surface's own read, exactly as the sensing live strip does.

// The DECLARED pairing arm, resolved ONCE from the f4 registration (the ask-any-pixel authority) — so the ○ a
// row wears derives from ITS pixel-class's declared witness, not a bare boolean re-decided here. Fail-loud at
// module load if the class or its arm vanished (the render-boundary registry discipline).
const PAIRING_ARM: AgreeSource = (() => {
  const a = F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'outcome-pairing')?.agree
  if (!a) throw new Error("commsStrip: f4 class 'outcome-pairing' declares no AgreeSource — the pairing ring cannot derive a witness")
  return a
})()

// THE DROP'S QUALITY CAVEAT KIND — sourced from the drop-anchor PIXEL DECLARATION, not a strip-local
// literal. So the registry authority (pixelVoice → the • mark) and this render resolve the SAME caveat through
// qualityPresentation — ONE source, no split. Fail-loud at module load if the declaration vanished.
const DROP_ANCHOR_CAVEAT: QualityCaveat = (() => {
  const c = F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'drop-anchor')?.caveat
  if (!c) throw new Error("commsStrip: f4 class 'drop-anchor' declares no quality caveat — the drop's voice cannot derive from the registry")
  return c
})()

// The lane's FIXED latency axis (µs) — never auto-fit: a near-constant latency series must not render float
// noise as fake weather, and the drop sits at the floor as the flagged gap.
const LANE_MAX_US = 400

const xPctOf = (tick: number, first: number, last: number): number =>
  last > first ? ((tick - first) / (last - first)) * 100 : 50

export function CommsStrip({ data, tick }: { data: CommsData; tick: number }) {
  const playhead = eventTickOf(tick as TransportTick)
  const shown = revealedPairs(data, playhead)
  // THE PAIRING RECEIPT describes the SAME full-run population the MARK judges — checkPairing is reveal-independent
  // (it weighs orphans/duplicates/causation/endpoints over the whole run), so the counts here are full-run too, NOT
  // the revealed subset. Otherwise a duplicate-outcome run would render the mismatch ✗ beside three named checks all
  // passing on the accepted subset, with the failing outcome invisible — the attribution promise broken.
  // THE CAUSATION + ENDPOINT counts denominate over the AUDIT POPULATION (data.resolvingAudits — a reading for
  // EVERY resolving outcome, accepted OR duplicate), so the receipt describes the SAME population the readings were
  // formed over, order-independent: a contradictory DUPLICATE delivery's reading is COUNTED, never discarded by
  // arrival order. Two populations, each labeled by its noun: "sends resolved" is the accepted-pairs (trajectory)
  // population; "causation edges" / "endpoint readings" are the audit population.
  //   Causation is FORMED by every resolving outcome (each carries a causation edge). Endpoint readings are FORMED
  // by DELIVERIES only — a DROP supplies no endpoint (spec — no field), so it forms no endpoint comparison (never a
  // vacuous agreement). f4: "32 of 32 causation edges agree · 31 of 31 endpoint readings agree" (the drop counts in
  // causation, not endpoints); an all-drop run: "N of N causation edges agree · 0 endpoint readings" (no claim).
  const causationReadings = data.resolvingAudits.length
  const causationAgreed = data.resolvingAudits.filter(a => a.causationOk).length
  const causationClause = causationReadings > 0
    ? `${causationAgreed} of ${causationReadings} causation edges agree`
    : '0 causation edges' // no resolving outcome — no causation comparison formed
  const endpointReadings = data.resolvingAudits.filter(a => a.outcome === 'delivered').length
  const endpointAgreed = data.resolvingAudits.filter(a => a.outcome === 'delivered' && a.endpointOk).length
  const endpointClause = endpointReadings > 0
    ? `${endpointAgreed} of ${endpointReadings} endpoint readings agree`
    : '0 endpoint readings' // no delivery supplied an endpoint — no comparison formed, no claim
  const orphans = data.orphanOutcomes.length       // an outcome with NO matching send — a mismatch trigger
  const duplicates = data.duplicateOutcomes.length // a SECOND outcome for an already-resolved send — a mismatch trigger
  const unresolved = data.sends.length - data.pairs.length // sends with no accepted outcome — the incomplete (no-verdict) trigger

  // The pairing verdict. An UNFORMED comparison (a send whose outcome is missing, with NO disagreement — agreed
  // is null) earns the NO-VERDICT voice (the query/sensing precedent for an unformed check), NEVER a false
  // mismatch. A formed comparison resolves through recomputedVerdict: an agreement wears the self-consistent ring,
  // an actual disagreement wears the mismatch mark. The executor mints the branded agreement; a lens cannot
  // fabricate it.
  const { agreed } = checkPairing(data)
  const pairing: { mark: MarkKey; note: string } = agreed === null
    ? { mark: 'unverifiable', note: 'some sends have no outcome — the pairing check is incomplete, not a disagreement' }
    : recomputedVerdict(PAIRING_ARM, agreed)

  const link = data.link
  const src = link ? compactPlate(identityPlate(`${link.src}`, 'entity')) : '—'
  const dst = link ? compactPlate(identityPlate(`${link.dst}`, 'entity')) : '—'

  // Shared sub-lines rendered by BOTH the renderable strip and the fail-closed disclosure.
  const header = <h3>the link — {src} → {dst}{link ? ` · ch ${link.channel}` : ''}</h3>
  const snrLine = data.snrConstant !== null
    ? <p className="comms-snr">snr {data.snrConstant.toFixed(2)} dB — constant this run</p> : null
  // THE NAMED READINGS + ANOMALY ROWS behind the single ring/mismatch mark — the three self-consistency checks
  // (msg-id pairing completeness, causation edges, delivered endpoints) PLUS an explicit row per anomaly class
  // (orphans, duplicates, unresolved). Each is a visible count, so the mark is always attributable to a failing
  // row: a 1→9 receipt shows "0 of 1 endpoint readings agree"; a duplicate shows "1 duplicate outcome"; an unformed
  // run shows "N sends unresolved" — never a ✗ beside all-passing checks. SCOPE-LABELLED "whole run": this receipt
  // is run-scoped (checkPairing is reveal-independent), so it names its scope to sit honestly beside the playhead-
  // scoped "so far" ledger — at tick 0 the ledger reads "0 so far" while the receipt reads "whole run: 32", no
  // contradiction.
  const pairingLine = (
    <p className="comms-pairing">
      <span className={`comms-mark ${markClass(pairing.mark)}`} title={pairing.note}>{requireGlyph(pairing.mark)}</span>
      {' '}
      <span className="comms-scope">whole run</span>{' '}
      {data.pairs.length} of {data.sends.length} sends resolved · {causationClause} · {endpointClause}
      {orphans > 0 ? ` · ${orphans} orphan outcome${orphans === 1 ? '' : 's'}` : ''}
      {duplicates > 0 ? ` · ${duplicates} duplicate outcome${duplicates === 1 ? '' : 's'}` : ''}
      {unresolved > 0 ? ` · ${unresolved} send${unresolved === 1 ? '' : 's'} unresolved` : ''}
      {' — '}{pairing.note}
    </p>
  )
  const degenLine = <p className="comms-degenerate">sent-vs-arrived only — the bundle carries no receiver belief to show</p>

  // FAIL CLOSED, AS ONE — a non-renderable mapping (inconsistent / incomplete / multi-link) makes every definitive
  // per-message and single-link visual unsafe: an accepted outcome may HIDE a conflicting one, and the duet draws
  // a single link only. So withhold the ledger tally, the latency lane, and every drop/hero visual, and render a
  // disclosure naming the failure MODE (shared with the stage + chip). The pairing line carries its own voice —
  // the mismatch mark on a disagreement, the no-verdict mark on a merely-incomplete mapping.
  if (!data.renderable) {
    const mode = commsDisclosureMode(data)
    const recorded = data.rawDelivered + data.rawDropped
    const anomalies = commsAnomalyCount(data)
    const unresolved = data.sends.length - data.pairs.length
    const disclosure = mode === 'multiple links'
      ? `multiple links on this run — ${data.sends.length} sent; the duet renders a single link only, so no per-message or loss claim.`
      : `outcome mapping ${mode} — ${data.sends.length} sent · ${recorded} outcome${recorded === 1 ? '' : 's'} recorded`
        + `${unresolved > 0 ? ` · ${unresolved} unresolved` : ''}${anomalies > 0 ? ` · ${anomalies} anomalous` : ''}`
        + `; no definitive per-message or loss claim.`
    return (
      <section className="comms-strip">
        {header}
        <p className="comms-disclosure" data-comms-mode={mode}>{disclosure}</p>
        {snrLine}
        {pairingLine}
        {degenLine}
      </section>
    )
  }

  // ── THE CONSISTENT STRIP — a trustworthy bijection, so the definitive visuals render ─────────────────────────
  const ledger = ledgerAt(data, playhead)
  const heroReveal = dropRevealAt(data, playhead) // keyed on the HERO (one supported drop on a consistent mapping)
  const revealedDrops = data.drops.filter(d => d.outcomeTick <= (playhead as number)) // every revealed drop
  const delivered = shown.filter(p => p.outcome === 'delivered')

  // Each revealed drop is classified through supportedDropCaveat — reason LOSS + jam inactive earns the declared
  // 'link-loss' caveat (the attested quality mark); any other shape fails closed (a refusal naming the decoded
  // reason/jam, never a fabricated loss). The HERO owns the "one lost packet" story + the attested block; anything
  // else (a single unsupported drop, or ≥2 drops) degrades to honest counts. dropQOf resolves a drop's quality
  // presentation, or null to refuse.
  const dropQOf = (d: CommsPair): ReturnType<typeof qualityPresentation> | null =>
    supportedDropCaveat(d) === DROP_ANCHOR_CAVEAT ? qualityPresentation(DROP_ANCHOR_CAVEAT) : null
  const heroQ = data.hero ? qualityPresentation(DROP_ANCHOR_CAVEAT) : null // the hero is supported by construction

  const first = data.pairs.length ? data.pairs[0]!.outcomeTick : 0
  const last = data.pairs.length ? data.pairs.at(-1)!.outcomeTick : 1

  return (
    <section className="comms-strip">
      {header}

      {/* THE LEDGER-BY-SCRUB — the running tally, written by the playhead's prefix counts. SCOPE-LABELLED "so far":
          this tally is playhead-scoped (it grows as the viewer scrubs), so it names its scope to sit honestly beside
          the run-scoped "whole run" pairing receipt — at tick 0 "0 sent · 0 delivered · 0 lost so far" no longer
          contradicts the receipt's "whole run: 32 of 32 sends resolved". */}
      <p className="comms-ledger" data-comms-ledger={`${ledger.sent}/${ledger.delivered}/${ledger.lost}`}>
        <span className="comms-count"><b>{ledger.sent}</b> sent</span>
        <span className="comms-count"><b>{ledger.delivered}</b> delivered</span>
        <span className={ledger.lost > 0 ? 'comms-count comms-count-lost' : 'comms-count'}><b>{ledger.lost}</b> lost</span>
        <span className="comms-scope">so far</span>
      </p>

      {/* THE LATENCY LANE — the delivered pairs on a FIXED 0–400µs axis, and EVERY revealed drop as a flagged gap
          (supported → the • caveat mark; unsupported → an honest refusal, never a fabricated loss). */}
      <div className="comms-lane" role="img" aria-label={`latency lane · fixed 0–${LANE_MAX_US}µs · ${delivered.length} delivered · ${ledger.lost} lost`}>
        {delivered.map(p => (
          <span
            key={p.outcomeSeq}
            className="comms-lane-mark"
            style={{ left: `${xPctOf(p.outcomeTick, first, last)}%`, bottom: `${(Number(p.latencyUs) / LANE_MAX_US) * 100}%` }}
            title={`msg ${p.msg} · t${p.outcomeTick} · ${p.latencyUs}µs`}
          />
        ))}
        {revealedDrops.map(d => {
          const q = dropQOf(d)
          const leftPct = xPctOf(d.outcomeTick, first, last)
          return q
            // THE FLAGGED GAP — the drop at the lane floor, wearing the quality register (• + caveat treatment),
            // NEVER the integrity ✗. This is the two-second "find the one wrong number" mark.
            ? <span key={d.outcomeSeq}
                className={`comms-lane-drop ${markClass(q.mark)} ${q.treatment}`}
                style={{ left: `${leftPct}%` }}
                title={`msg ${d.msg} · t${d.outcomeTick} · ${q.note}`}
              >{requireGlyph(q.mark)}</span>
            // FAIL CLOSED — a drop shape the lens cannot honestly describe; refuse rather than misreport.
            : <span key={d.outcomeSeq}
                className={`comms-lane-drop comms-lane-drop-refused ${markClass('unverifiable')}`}
                style={{ left: `${leftPct}%` }}
                title={`msg ${d.msg} · t${d.outcomeTick} · reason ${d.reason}, jam ${d.jamState} — an unsupported drop shape`}
              >{requireGlyph('unverifiable')}</span>
        })}
        {heroReveal === 'not-yet' && (
          <span className={`comms-lane-notyet ${markClass('notYet')}`}>the recorded loss is still ahead of the playhead</span>
        )}
      </div>
      <p className="comms-lane-axis">latency · fixed 0–{LANE_MAX_US}µs (never auto-fit)</p>

      {snrLine}
      {pairingLine}

      {/* THE DROP CAVEAT — three honest cases: the HERO (one supported drop) speaks the attested story; a single
          UNSUPPORTED drop refuses (naming the decoded reason/jam); ≥2 drops degrade to counts, no hero language. */}
      {data.hero && heroReveal === 'anchored' && heroQ
        ? <p className="comms-drop">
            <span className={`comms-mark ${markClass(heroQ.mark)}`}>{requireGlyph(heroQ.mark)}</span>
            {' '}
            msg {data.hero.msg} — sent at t{data.hero.send.tick}, never arrived (reason {dropReasonName(data.hero.reason)}, jam inactive).
            <span className={`comms-caveat-note ${heroQ.treatment}`}>{heroQ.note}</span>
          </p>
        : revealedDrops.length === 0
          ? null
          : data.drops.length === 1
            // a SINGLE total drop that is NOT the hero ⟹ an unsupported shape ⟹ refuse, naming the decoded reason/jam.
            ? <p className="comms-drop comms-drop-refused">
                msg {data.drops[0]!.msg} dropped with reason {data.drops[0]!.reason}, jam_state {data.drops[0]!.jamState} — a
                channel-drop shape this lens does not yet describe; refusing to report it as a plain loss (no such certified bundle exists).
              </p>
            // ≥2 drops — no single lost packet to headline; the copy degrades to the counts (the lane shows each drop).
            : <p className="comms-drop comms-drop-degraded">
                {revealedDrops.length} of {data.drops.length} losses recorded — not a single supported loss, so the copy
                degrades to counts (no “one lost packet” headline).
              </p>}

      {degenLine}
    </section>
  )
}

// A thin export so the Inspector can gate the comms strip the way it gates the sensing strip; the strip is
// always live (playhead-driven), so there is no separate "live" wrapper — this IS it.
export type { CommsPair }
