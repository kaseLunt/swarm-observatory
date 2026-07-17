import type { RunPhase, CeremonyHashes } from './useRun'
import { lineState, shortHex, pinTick, resultIdTick, stepMark, MARK, type LineState } from './ceremonyFormat'

// The spec §6 verification ceremony: the load screen itself demonstrates the integrity story.
// Three staged lines light up in sequence as the real phase advances — frames decoding (bar filled
// by worker progress), hashes confirming (the REAL recomputed event_hash / result_id short-hex —
// event_hash ticks ○/✓/✗ from its own trailer reproduction + manifest pin; result_id ticks the derived •
// det-only or ✓/✗ under a manifest), scene assembling (the model publishes and the app takes over).
// The hashes AND their tick are always the genuine recomputed verify result threaded from useRun — never
// decoration. The pure state/format helpers live in
// ceremonyFormat.ts (unit-tested there); this file is the render only.
// Motion is token-driven; reduced-motion collapses every fade/tick to an instant cut (0ms tokens +
// no floors in useRun), so this same screen serves both perceptible and cut-through readers.

export function Ceremony({ phase, progress, hashes, settling = false }: { phase: RunPhase; progress: number; hashes: CeremonyHashes | null; settling?: boolean }) {
  const frames = lineState('decoding', phase)
  // Settle beat: during the payoff hold the confirm line resolves to 'done' (the completed
  // double-✓) while the scene has not yet assembled — so we force it done here rather than promote the
  // whole phase to 'ready' (which would also mark 'scene assembling' done before the model exists).
  const confirm: LineState = settling ? 'done' : lineState('verifying', phase)
  const assemble = lineState('ready', phase)
  const pct = Math.round(progress * 100)
  // Hashes have arrived (recomputed) from the moment 'verifying' begins; show them confirming.
  const showHashes = hashes !== null && (confirm === 'active' || confirm === 'done')
  // Per-PIN grading (a named hash row reflects its OWN comparisons, not the aggregate). Each row grades
  // from (a) its comparableManifestPins entry (hashes.pins — THE SAME list Provenance renders) and (b) its OWN
  // per-field trailer reproduction (hashes.trailerPins), never the aggregate matchesTrailer. So corrupting ONLY
  // the manifest's event_hash reds event_hash beside a green result_id, and corrupting ONLY the trailer's
  // state hash keeps event_hash ✓ (its own bytes reproduced) while the step mark carries the aggregate ✗ —
  // instead of over-refusing both named rows. result_id has no in-bundle trailer value (the trailer stores none),
  // so it passes `true` for reproduction: it grades from its manifest pin alone, ○ self-check when det-only.
  const pinMatch = (key: string): boolean | null =>
    hashes && hashes.pins ? (hashes.pins.find(p => p.key === key)?.match ?? null) : null
  const eventTick = hashes ? pinTick(pinMatch('event_hash'), hashes.trailerPins.eventHash) : null
  // result_id is DERIVED from trailer-sourced inputs — its own tick (resultIdTick), NOT pinTick: det-only it has no
  // oracle, so it renders the attested derived • (never a ○ self-check ring). A manifest pin backs it → ✓/✗.
  const resultTick = hashes ? resultIdTick(pinMatch('result_id')) : null
  // Step-level mark for 'hashes confirming' carries the TRUST verdict: a mismatch shows ✗, a self-consistent
  // run ○ (not a false ✓) at the step, not just at the result_id row. null verdict until hashes arrive.
  const cm = stepMark(confirm, hashes ? hashes.verdict : null)
  return (
    <div className={`screen ceremony${settling ? ' settling' : ''}`} role="status" aria-live="polite">
      <div className="ceremony-inner">
        <h1>verifying run</h1>
        {/* Plain-language thesis: what the staged checklist below is actually doing, in one honest line. Scoped
            to what the in-bundle check ACTUALLY proves — the event & state hashes and the frame counts
            reproduced from the bytes and matched to the run's sealed trailer. It deliberately does NOT claim
            "every byte" (that would over-claim result_id/case_id, which are derived/trailer-sourced, not checked
            here). Body size, faint — a subtitle, not a step. */}
        <p className="ceremony-thesis">re-deriving the event &amp; state hashes and frame counts from the bytes and matching them to the run’s sealed trailer, live in your browser</p>
        <ol className="ceremony-steps">
          <li className={`cstep ${frames}`}>
            <span className="cmark">{MARK[frames]}</span>
            <div className="cbody">
              <div className="crow"><span className="clabel">frames decoding</span><span className="cpct">{pct}%</span></div>
              <span className="cbar" aria-hidden="true"><span className="cbar-fill" style={{ width: `${pct}%` }} /></span>
            </div>
          </li>
          <li className={`cstep ${cm.cls}`}>
            <span className="cmark">{cm.glyph}</span>
            <div className="cbody">
              <div className="crow"><span className="clabel">hashes confirming</span></div>
              {showHashes && hashes && eventTick && resultTick && (
                <span className="chashes">
                  <code className="chash">event_hash <b>{shortHex(hashes.eventHash)}</b><span className={`ctick ${eventTick.cls}`}>{eventTick.glyph}</span></code>
                  <code className="chash">result_id <b>{shortHex(hashes.resultId)}</b><span className={`ctick ${resultTick.cls}`}>{resultTick.glyph}</span></code>
                </span>
              )}
            </div>
          </li>
          <li className={`cstep ${assemble}`}>
            <span className="cmark">{MARK[assemble]}</span>
            <div className="cbody"><div className="crow"><span className="clabel">scene assembling</span></div></div>
          </li>
        </ol>
      </div>
    </div>
  )
}
