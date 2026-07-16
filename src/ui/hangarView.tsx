import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RunEntry } from './useRun'
import { assumedClockTitle, cardNote, cardVerdict, effectiveSealStatus, histogramRows, realSimDuration, sealFor, VOICE_GLYPH, type SealRecord, type SealStatus } from './hangar'
import { CATEGORY } from './theme'
import { ROBUST_F3A } from '../decode/campaignCatalog'

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE HANGAR (T5b, D5) — the run-library front door.
//
// LAW-4 DECLARATION (constitution §4 — filed in-code for this new surface):
//   • Question (Q5, at library scale): "which run is this, and can I trust its pixels?" — the front
//     door that answers before the stage is ever mounted.
//   • Surface split (LAW 3): this is the INSTRUMENT half — density, DOM/React only, ZERO WebGL and no
//     frame loop (§8: the Hangar never mounts the r3f canvas and does no rAF work). Its STAGE half is
//     the drill-through: opening a card rides the existing hero/ceremony path.
//   • Borrowed hues (LAW 2, zero new tokens): the integrity voices ONLY — verified green (`--verified`)
//     for a card the ceremony SEALED this session, the attested slate `•` (`--pending`, the canonical
//     attested token — v0.8 W1) otherwise, and the alarm `--mismatch` ✗ for a seal later BROKEN by a
//     mismatched re-load (closure item 1). The voice glyph + class are sourced from voices.ts. The kind
//     histogram wears event-IDENTITY category hues (`--cat-*`), never a provenance voice glyph and
//     never the R3 verdict pair (those are statistical pass/fail — the v0.7 Wall's, not the Hangar's).
//   • What it dims (LAW 1): within itself a sealed ✓ card carries the earned emphasis; at rest the
//     field is quiet attested dots. It dims nothing on the frame — it is not on the frame.
//   • Honest empty states: (a) index did not load → the library says so plainly, no fake cards;
//     (b) a run with no authored tour offers "open run", never a disabled/fake tour affordance;
//     (c) the assumed-clock tier (e0/f0/f1) shows its tick count as "assumed", never a fabricated
//     real duration.
//
// D4 CHECKMARK ECONOMY: a card is SESSION-EARNED — attested `•` until its run is opened and its
// ceremony seals green THIS session (sealedRuns, in-memory only). Reload ⟹ every card back to `•`.
// A seal CONTRADICTED by a later mismatched re-load renders the alarm ✗ (never ✓, never plain •) and is
// session-terminal — the state machine lives in hangar.ts (recordSeal/breakSeal/effectiveSealStatus).
// D4 RULING 2: the f3a verdict is sourced from its own identity (correct campaign), never a sidecar —
// the ROBUST wordmark never touches this card (pinned in hangar.test.ts).
// D4 6.4: the card is the exact container the v0.7 Certification Wall expands into (head band /
// instrument zone / field zone budgeted now) so the front door does not reflow when the Wall lands.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// The sidecar's own contract line, verbatim-class (D4 Part 1 thesis): the Hangar reads index.json,
// which is a convenience map — a tampered index can misdirect a lookup but can never forge a
// verification (the ✓ is re-earned by the browser, never trusted from the index).
const DISCLAIMER = 'index, not authority — a tampered index can misdirect, never forge.'

export interface HangarProps {
  open: boolean
  runs: RunEntry[]
  currentRunId: string
  sealedRuns: SealRecord[]
  // The loaded run's identity, published atomically with model+hashes by useRun (W1). The render-side
  // guard (effectiveSealStatus) uses it so a ✓ is painted only while the seal's resultId matches the
  // bytes actually on stage when that run is the open one (closure item 1's "hold only while" clause).
  loadedRunId: string | null
  loadedResultId: string | null
  tourRunIds: readonly string[]
  onClose: () => void
  onOpenRun: (id: string) => void
  onOpenTour: (id: string) => void
  // The Wall's front-door entry (v0.8 W5): opens the campaign Certification Wall. The Wall is the Hangar's
  // campaign expansion (D4 6.4) — reachable HERE, following the card/CTA grammar.
  onOpenWall: () => void
}

export function Hangar({ open, runs, currentRunId, sealedRuns, loadedRunId, loadedResultId, tourRunIds, onClose, onOpenRun, onOpenTour, onOpenWall }: HangarProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Modality (mirrors HelpOverlay): remember the opener, move focus into the dialog, restore on close.
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    // Focus the first focusable in the panel (the close button) once it has mounted.
    const first = panelRef.current?.querySelector<HTMLElement>('button, [href], [tabindex]')
    first?.focus()
    return () => { const prev = prevFocusRef.current; if (prev?.isConnected) prev.focus() }
  }, [open])

  if (!open) return null

  // Focus trap: keep Tab / Shift+Tab inside the panel (Esc-to-close is owned by App's keydown owner,
  // symmetric with the help modal). Wrap at the boundaries so focus can never escape the dialog.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="hangar-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="hangar-panel"
        role="dialog"
        aria-modal="true"
        aria-label="run library"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <header className="hangar-head">
          <h2>the hangar</h2>
          <button className="hangar-close" onClick={onClose}>close (Esc)</button>
        </header>
        {runs.length === 0 ? (
          // Honest empty state (a): the index did not load. No fake cards, no "coming soon".
          <p className="hangar-empty">run library unavailable — <code>runs/index.json</code> did not load.</p>
        ) : (
          <div className="hangar-grid">
            {runs.map((entry) => (
              <HangarCard
                key={entry.id}
                entry={entry}
                current={entry.id === currentRunId}
                sealStatus={effectiveSealStatus(sealFor(sealedRuns, entry.id), loadedRunId, loadedResultId)}
                hasTour={tourRunIds.includes(entry.id)}
                onOpenRun={onOpenRun}
                onOpenTour={onOpenTour}
              />
            ))}
          </div>
        )}
        {/* CAMPAIGNS (v0.8 W5) — the Wall's front door. A campaign is a SEPARATE entity from a run: it names
            the ROBUST campaign correctly (the profile-conflation tripwire guards only the correct-profile f3a
            RUN card above, which stays untouched — the two must never conflate). The verdict rides the ATTESTED
            voice (on record, not a session receipt); the ✓ receipts are earned inside the Wall. */}
        <section className="hangar-campaigns" aria-label="campaigns">
          <p className="hangar-campaigns-label">campaigns</p>
          <article className="hangar-campaign-card" data-campaign={ROBUST_F3A.campaignId}>
            <div className="hangar-campaign-info">
              <h4>{ROBUST_F3A.campaignId} — 50-seed statistical campaign</h4>
              <p className="hangar-campaign-note">seeds 42–91 · acquire and re-verify every bundle byte-for-byte in your browser</p>
            </div>
            <span className="hangar-campaign-verdict">
              <span className="hangar-glyph" aria-hidden="true">{VOICE_GLYPH.attested}</span>
              {ROBUST_F3A.verdictLevelName} · on record
            </span>
            <button className="hangar-campaign-open" onClick={onOpenWall}>open the wall →</button>
          </article>
        </section>
        {/* Disclaimer chip (D4): the index is a map, not the authority. Always present on the surface. */}
        <p className="hangar-disclaimer">{DISCLAIMER}</p>
      </div>
    </div>
  )
}

function HangarCard({ entry, current, sealStatus, hasTour, onOpenRun, onOpenTour }: {
  entry: RunEntry; current: boolean; sealStatus: SealStatus; hasTour: boolean
  onOpenRun: (id: string) => void; onOpenTour: (id: string) => void
}) {
  const verdict = cardVerdict(entry.id, sealStatus)
  const rows = histogramRows(entry.kinds)
  const maxCount = rows.length > 0 ? rows[0]!.count : 1
  const duration = realSimDuration(entry) // mm:ss.s for a real-clock run, else null (assumed voice)
  // F5 — entry.id is UNSIGNED index.json data; an OWN-property lookup (cardNote) so a prototype-shaped id can never
  // resolve an inherited member (Object.prototype / the Object constructor) into a crashing React child.
  const note = cardNote(entry.id)

  return (
    <article className={current ? 'hangar-card current' : 'hangar-card'} data-run={entry.id}>
      {/* HEAD BAND (reserved: v0.7 Wall header) — title largest, earned verdict beside it. */}
      <header className="hangar-card-head">
        <h3>{entry.title}</h3>
        <span className={`hangar-verdict ${verdict.state}`}>
          <span className="hangar-glyph" aria-hidden="true">{VOICE_GLYPH[verdict.state]}</span>
          {verdict.label}
        </span>
      </header>

      {/* INSTRUMENT ZONE (reserved: v0.7 Wall gauges) — the forward-note + the sim clock. */}
      {note && <p className="hangar-card-note">{note}</p>}
      <p className="hangar-card-clock">
        {duration !== null
          ? <span className="hangar-clock" title={`real sim duration — dt ${entry.dtUs}µs/tick × ${entry.ticks} ticks`}>sim {duration}</span>
          : <span className="hangar-clock assumed" title={assumedClockTitle(entry)}>{entry.ticks} ticks · assumed clock</span>}
      </p>

      {/* FIELD ZONE (reserved: v0.7 Wall seed field) — the DECLARED kind histogram (identity hues,
          no voice glyph). Bars are proportional to the dominant kind; counts are tabular. */}
      <ul className="hangar-hist">
        {rows.map((r) => (
          <li key={r.kind} className="hangar-hist-row">
            <span className="hangar-hist-bar" style={{ width: `${Math.max(4, (r.count / maxCount) * 100)}%`, background: CATEGORY[r.category].hue }} />
            {/* Compact fit (T5/R4): the cell ellipsis-truncates a long registry name (e.g. MotionSegmentStarted);
                title carries the full name verbatim so nothing is lost — the shown text is always the registry's. */}
            <span className="hangar-hist-name" title={r.name}>{r.name}</span>
            <span className="hangar-hist-count">{r.count}</span>
          </li>
        ))}
      </ul>

      {/* supersedes_plan_id (D4): surfaced only when a manifest carries a non-zero chain — the anti-
          p-hacking tripwire made architectural. Dormant today (no published manifest carries one). */}
      {entry.supersedesPlanId && (
        <p className="hangar-supersedes">supersedes {entry.supersedesPlanId}</p>
      )}

      {/* ACTIONS — tour is the primary action where an authored tour exists; else open the run. */}
      <footer className="hangar-card-actions">
        {hasTour ? (
          <>
            <button className="hangar-primary" onClick={() => onOpenTour(entry.id)}>▶ tour</button>
            <button className="hangar-secondary" onClick={() => onOpenRun(entry.id)}>open run</button>
          </>
        ) : (
          <button className="hangar-primary" onClick={() => onOpenRun(entry.id)}>open run</button>
        )}
      </footer>
    </article>
  )
}
