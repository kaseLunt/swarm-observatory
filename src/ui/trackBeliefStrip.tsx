import {
  currentSample, sigmaAt, errorAt, revealedUpdateCount, trackDisclosureMode,
  type TrackBeliefData,
} from './trackBelief'
import { eventTickOf } from './cursor'
import { markClass } from './voices'
import { identityPlate, compactPlate } from './identityPlate'
import type { TransportTick } from '../lib/brand'

// ── THE BELIEF STRIP — f3a's INSTRUMENT voice (LAW 3) ────────────────────────────────────────────────────────
// The stage draws the shrinking disc + the gap-line; THIS is the legible number: the CURRENT 1σ (the tracker's
// reported confidence) beside the CURRENT actual error (the decoded gap to the true pose) — both playhead-scoped — the
// whole-run shrink AND error-growth (run-scoped), the update tally-by-scrub, and the lifecycle. The honesty every
// surface carries: the ring is the tracker's decoded ESTIMATE, the drone the decoded state TRUTH, and the gap between
// them is the tracker's ACTUAL error — a real belief-vs-reality comparison, both halves decoded, named not disclaimed.
//
// THE VOICE GRAMMAR: the 1σ, the disc, AND the gap are DERIVED-DISPLAY — derivations of decoded values with no external
// oracle — so they wear NO verdict glyph (never ○, never ✓); they declare their DERIVATION in words. The strip renders
// no marks at all (no recomputed class, no quality caveat). Scope is named on EVERY number: the current 1σ + error +
// tally are PLAYHEAD-scoped, the shrink + error-growth endpoints are RUN-scoped ("whole run"), so the two never read as
// a contradiction. `tick` is the plain store playhead (a TransportTick), branded EventTick HERE.

// TrackDropped reason enum (spec-3b §11.1 row 4) → its name, for the lifecycle line.
const DROP_REASON: Record<number, string> = { 1: 'TIMEOUT', 2: 'MERGED', 3: 'INVALIDATED' }
const dropReasonName = (r: number): string => DROP_REASON[r] ?? `reason ${r}`

export function TrackBeliefStrip({ data, tick }: { data: TrackBeliefData; tick: number }) {
  const playhead = eventTickOf(tick as TransportTick)

  // FAIL CLOSED, AS ONE — a non-renderable model (multiple tracks / a malformed covariance) makes the definitive
  // disc + the shrink/error claim unsafe. Withhold them and render a disclosure naming the failure MODE (shared with
  // the stage + chip), plus the honest count.
  if (!data.renderable) {
    const mode = trackDisclosureMode(data)
    const updates = data.samples.length
    const disclosure = mode === 'multiple tracks'
      ? `multiple tracks on this run — the single-track disc is withheld (the multi-track view is not yet built); ${updates} track update${updates === 1 ? '' : 's'} decoded.`
      : `${data.malformedCount} of ${updates} covariance${updates === 1 ? '' : 's'} malformed — the covariance stream is suspect, so no definitive disc; ${updates} track update${updates === 1 ? '' : 's'} decoded.`
    return (
      <section className="track-strip">
        <h3>the track</h3>
        <p className="track-disclosure" data-track-mode={mode}>{disclosure}</p>
      </section>
    )
  }

  const trackName = data.track !== null ? compactPlate(identityPlate(`${data.track}`, 'entity')) : '—'
  const subjectName = data.subject !== null ? compactPlate(identityPlate(`${data.subject}`, 'entity')) : null
  const revealed = revealedUpdateCount(data, playhead) // playhead-scoped tally
  const sigma = sigmaAt(data, playhead)                // the current 1σ the playhead has revealed, or null (NOT-YET)
  const err = errorAt(data, playhead)                  // the current actual error (decoded gap), or null (NOT-YET / no reality)
  const cur = currentSample(data, playhead)
  const shape = data.allDiscs ? 'disc' : 'ellipse'
  const firstTick = data.samples[0]!.tick
  // The current sample's truth-vs-disc verdict — is the true pose inside or outside the reported 1σ? Playhead-scoped.
  const sigmaRatio = err !== null && sigma !== null && sigma > 0 ? err / sigma : null

  return (
    <section className="track-strip">
      <h3>the track — {trackName}{subjectName ? ` · tracking ${subjectName}` : ''}</h3>

      {/* THE CURRENT 1σ — PLAYHEAD-scoped (the tracker's reported confidence). Before the first update it is the
          NOT-YET voice (no disc yet); at/after, the decoded eigen-semi-axis of the current sample. */}
      {sigma !== null && cur !== null ? (
        <p className="track-sigma" data-track-sigma={sigma.toFixed(3)}>
          <b>1σ {sigma.toFixed(2)} m</b> {shape} <span className="track-scope">at the playhead (t{cur.tick})</span>
        </p>
      ) : (
        <p className={`track-notyet ${markClass('notYet')}`}>
          no track update yet — the first is at tick {firstTick} (the disc appears when the playhead reaches it)
        </p>
      )}

      {/* THE CURRENT ACTUAL ERROR — PLAYHEAD-scoped: the decoded gap between the estimate (mean) and the truth (state
          pose), and whether the truth is inside or OUTSIDE the reported 1σ (overconfidence). Only when the reality half
          is available (a subject + a decoded pose); withheld otherwise (a hypothetical run with no reality overlay). */}
      {err !== null && sigmaRatio !== null && (
        <p className="track-error" data-track-error={err.toFixed(3)}>
          <b>error {err.toFixed(2)} m</b> to the true pose — {sigmaRatio > 1
            ? `≈${sigmaRatio.toFixed(1)}σ OUTSIDE the disc (overconfident)`
            : `within the disc (${sigmaRatio.toFixed(1)}σ)`}
          {' '}<span className="track-scope">at the playhead</span>
        </p>
      )}

      {/* THE UPDATE TALLY — PLAYHEAD-scoped prefix count over a NAMED population (the run's TrackUpdated events). */}
      <p className="track-tally" data-track-tally={`${revealed}/${data.samples.length}`}>
        <b>{revealed}</b> of {data.samples.length} track updates revealed <span className="track-scope">so far</span>
      </p>

      {/* THE SHRINK + ERROR-GROWTH — RUN-scoped endpoints (the chip states the same, and never scrubs). */}
      <p className="track-shrink">
        <span className="track-scope">whole run</span>: 1σ {data.sigmaFirst!.toFixed(2)} m → {data.sigmaLast!.toFixed(2)} m
        {data.allDiscs ? ' (isotropic disc)' : ''}
        {data.hasReality && data.gapFirst !== null && data.gapLast !== null
          ? ` · actual error ${data.gapFirst.toFixed(2)} m → ${data.gapLast.toFixed(2)} m${data.truthEndsOutsideSigma ? ' (the truth leaves the disc)' : ''}`
          : ''}
      </p>

      {/* THE LIFECYCLE — decoded facts shown plain (when present). */}
      {(data.confirmedTick !== null || data.dropped !== null) && (
        <p className="track-lifecycle">
          {data.confirmedTick !== null ? `confirmed t${data.confirmedTick}` : ''}
          {data.confirmedTick !== null && data.dropped !== null ? ' · ' : ''}
          {data.dropped !== null ? `dropped t${data.dropped.tick} (${dropReasonName(data.dropped.reason)})` : ''}
        </p>
      )}

      {/* THE MECHANISM DISCLOSURE — every claim names its authority: the radius is DECODED (a derivation of the
          covariance), the ring centre is the DECODED mean (the estimate), the drone is the DECODED state truth, the
          gap between them is the tracker's error, and the outline/line weight are PRESENTATIONAL. */}
      <p className="track-mechanism">
        the disc’s radius is decoded — the 1σ eigen-semi-axis of the tracker’s reported covariance; the ring is at the
        decoded mean (the estimate); the drone is the decoded state truth; the line between them is the tracker’s actual
        error; the contour + line weight are presentational
      </p>

      {/* THE HONESTY LINE — the ring is the tracker's decoded estimate, the drone the decoded state truth, and the gap
          the tracker's actual error: a real belief-vs-reality comparison, both halves decoded (or, absent a reality
          pose, belief only). */}
      <p className="track-degenerate">
        {data.hasReality
          ? 'the ring is the tracker’s decoded estimate; the drone flies the decoded state truth; the gap between them is the tracker’s actual error — both halves decoded, a real belief-vs-reality comparison'
          : 'the ring is the tracker’s decoded estimate — no reality pose on this run, so belief only (no comparison to show)'}
      </p>
    </section>
  )
}
