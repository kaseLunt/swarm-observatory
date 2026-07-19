import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'
import {
  EVIDENCE_PROVENANCE, buildEvidenceRows, buildEvidenceRevealClock, revealedEventCount,
  applyView, scopeRows, kindCounts, filterActive, wholeScopeLabel, revealedScopeLabel, populationLabel,
  type SortKey, type SortDir, type EvField,
} from './evidenceTable'

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE RAW EVIDENCE TABLE — the byte-X-ray modal (the interrogation surface a skeptic reaches for).
//
// HOME: a modal overlay, peer to the Hangar and the Certification Wall — the SAME backdrop/panel idiom
// (role=dialog, aria-modal, focus trap, focus-first-on-open + restore-on-close; Esc is owned by App's
// keydown owner exactly as the Hangar/Wall are). A table is universal across all six runs (not a lens),
// so a modal front door — not the lens aside — is its honest home. (This is the VIEW half; the pure row
// model + all sort/filter/scope math live in evidenceTable.ts — the hangar.ts/hangarView.tsx split.)
//
// IT CLAIMS NOTHING; IT SHOWS. Every row is a rendering of decodeBundle's output. No recomputation, no
// verdicts — the header says exactly that (EVIDENCE_PROVENANCE). Scope is labeled in BOTH modes (whole-run
// default; a revealed-so-far toggle driven by the shared reveal clock); every filtered count names its
// population ('N events · M shown').
//
// SCALE: the biggest published run is <500 events — plain DOM rows, no virtualization (the CSR trigger is
// 1e5). Render cost is bounded by the filtered set. DOM/React only — no WebGL, no frame loop.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'seq', label: 'seq' },
  { key: 'tick', label: 'tick' },
  { key: 'kind', label: 'kind' },
  { key: 'payload', label: 'payload' },
]

export interface EvidenceTableProps {
  open: boolean
  model: RunModel
  onSelect: (seq: number) => void // the ONE select path (App wires select + deep-link + close) — one code path for selection, never a second
  onClose: () => void
}

export function EvidenceTable({ open, model, onSelect, onClose }: EvidenceTableProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // The playhead + current selection ride the store (the Inspector idiom). While the modal is open the
  // transport keyboard is inert beneath it (App's keydown owner), so the playhead is effectively static for
  // the session — the revealed scope reflects where the playhead rests. selectedEvent lights the active row.
  const playhead = useViewStore(s => s.tick)
  const selectedEvent = useViewStore(s => s.selectedEvent)

  // Local view state — reset each open because App mounts the modal only while open (a fresh mount).
  const [revealedOnly, setRevealedOnly] = useState(false)
  const [text, setText] = useState('')
  const [activeKinds, setActiveKinds] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [sortKey, setSortKey] = useState<SortKey>('seq')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Built once per model (a bounded pure pass; not the frame path). rows is every decoded event.
  const rows = useMemo(() => buildEvidenceRows(model), [model])
  const clock = useMemo(() => buildEvidenceRevealClock(model), [model])
  // The kind chips count over the ACTIVE SCOPE (the whole run, or the revealed prefix) — NOT the whole run
  // always. A revealed-so-far chip must report only what the playhead has revealed, or it would spoiler the
  // future event composition through the filter UI and break the one-population-per-view contract.
  const scoped = useMemo(() => scopeRows(rows, revealedOnly, playhead), [rows, revealedOnly, playhead])
  const counts = useMemo(() => kindCounts(scoped), [scoped])

  const total = model.eventCount
  const revealed = revealedEventCount(clock, playhead)
  const scopeBase = revealedOnly ? revealed : total

  const opts = useMemo(
    () => ({ revealedOnly, playhead, activeKinds, text, sortKey, sortDir }),
    [revealedOnly, playhead, activeKinds, text, sortKey, sortDir],
  )
  const shown = useMemo(() => applyView(rows, opts), [rows, opts])
  const isFiltered = filterActive(opts)

  // Modality (mirrors the Hangar): remember the opener, move focus into the dialog, restore on close.
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('button, [href], input, [tabindex]')
    first?.focus()
    return () => { const prev = prevFocusRef.current; if (prev?.isConnected) prev.focus() }
  }, [open])

  if (!open) return null

  // Focus trap (mirrors the Hangar): keep Tab / Shift+Tab inside the panel; Esc-to-close is App's keydown owner.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  const toggleKind = (kind: number) => setActiveKinds(prev => {
    const next = new Set(prev)
    if (next.has(kind)) next.delete(kind); else next.add(kind)
    return next
  })
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <div className="evidence-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="evidence-panel"
        role="dialog"
        aria-modal="true"
        aria-label="raw evidence table"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <header className="evidence-head">
          <div className="evidence-title">
            <h2>the raw evidence table</h2>
            {/* Provenance: names the mechanism (decoded rendering), no more. The table CLAIMS nothing. */}
            <p className="evidence-provenance">{EVIDENCE_PROVENANCE}</p>
          </div>
          <button className="evidence-close" onClick={onClose}>close (Esc)</button>
        </header>

        <div className="evidence-controls">
          {/* SCOPE — labeled in BOTH modes; the toggle is explicit. Each option names its own population. */}
          <div className="evidence-scope" role="group" aria-label="scope">
            <button
              className={!revealedOnly ? 'evidence-scope-btn active' : 'evidence-scope-btn'}
              aria-pressed={!revealedOnly}
              onClick={() => setRevealedOnly(false)}
            >{wholeScopeLabel(total)}</button>
            <button
              className={revealedOnly ? 'evidence-scope-btn active' : 'evidence-scope-btn'}
              aria-pressed={revealedOnly}
              onClick={() => setRevealedOnly(true)}
            >{revealedScopeLabel(revealed, total)}</button>
          </div>

          {/* FREE-TEXT filter over the rendered fields (case-insensitive substring). */}
          <input
            className="evidence-search"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="filter fields…"
            aria-label="filter rows by text"
          />

          {/* KIND filter — the multi-select chip idiom. Empty = show all; a chip adds its kind to the
              allow-list. Each chip names its kind and its true count. */}
          <div className="evidence-kinds" role="group" aria-label="filter by kind">
            {counts.map(c => {
              const on = activeKinds.has(c.kind)
              return (
                <button
                  key={c.kind}
                  data-kind={c.kind}
                  className={on ? 'evidence-kind-chip active' : 'evidence-kind-chip'}
                  aria-pressed={on}
                  onClick={() => toggleKind(c.kind)}
                >{c.name} · {c.count}</button>
              )
            })}
          </div>
        </div>

        {/* POPULATION readout — names the scope's population, and the shown subset when a filter narrows it. */}
        <p className="evidence-count" data-evidence-count>{populationLabel(scopeBase, shown.length, isFiltered)}</p>

        <div className="evidence-scroll">
          <table className="evidence-table">
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th key={col.key} aria-sort={ariaSort(col.key)}>
                    <button
                      className={sortKey === col.key ? `evidence-sort ${sortDir}` : 'evidence-sort'}
                      onClick={() => onSort(col.key)}
                    >{col.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr
                  key={r.seq}
                  data-seq={r.seq}
                  className={r.seq === selectedEvent ? 'evidence-row active' : 'evidence-row'}
                  onClick={() => onSelect(r.seq)}
                >
                  {/* the seq cell is a real button so a keyboard user can select a row (the Inspector's
                      evlist idiom); pointer clicks anywhere on the row select too (stopPropagation avoids a
                      double-fire). */}
                  <td className="evidence-num">
                    <button
                      className="evidence-rowbtn"
                      aria-label={`select event ${r.seq}`}
                      onClick={(e) => { e.stopPropagation(); onSelect(r.seq) }}
                    >{r.seq}</button>
                  </td>
                  <td className="evidence-num">{r.tick}</td>
                  <td className="evidence-kind">{r.kindName} <span className="evidence-kindnum">({r.kind})</span></td>
                  <td className="evidence-payload">
                    {r.fields.map((f, i) => <EvidenceFieldCell key={`${f.key}-${i}`} field={f} />)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="evidence-empty">no rows match — clear the filter or widen the scope</p>
          )}
        </div>
      </div>
    </div>
  )
}

// A rendered payload field. When the inline value is a rounded/truncated render (field.full !== null) the field
// becomes a keyboard- AND touch-operable DISCLOSURE: a native <button> that toggles an inline expansion showing
// the exact value in accessible DOM — not a mouse-only title, so a keyboard or touch user can always reach the
// full-precision value where the inline rounds (the honesty rule: never lossy without the full value REACHABLE
// by any input). aria-expanded carries the state; the dotted underline hints the affordance. A field whose
// inline is already exact (full === null: bigint ids, integers, bools, whole f64s, short raw-byte spans) stays a
// plain span — no affordance to clutter the dense table. Clicking a field disclosure STOPS PROPAGATION so it
// inspects the value without selecting the row (the seq button + the row's other cells remain the select path).
function EvidenceFieldCell({ field }: { field: EvField }) {
  const [expanded, setExpanded] = useState(false)
  if (field.full === null) {
    return <span className="evidence-field"><span className="evidence-field-key">{field.key}</span>={field.value}</span>
  }
  return (
    <span className="evidence-field">
      <button
        type="button"
        className="evidence-field-btn"
        aria-expanded={expanded}
        aria-label={`${field.key}: ${expanded ? 'hide' : 'show'} the full-precision value`}
        title={field.full}
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
      ><span className="evidence-field-key">{field.key}</span>={field.value}</button>
      {expanded && <span className="evidence-field-full"> ({field.full})</span>}
    </span>
  )
}
