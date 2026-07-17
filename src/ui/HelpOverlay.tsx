// Ephemeral help overlay. Open state is component-local (lifted to App), deliberately NOT in the
// store or URL — it is transient UI, not a shareable view. Closed by ?, Esc, backdrop, or button
// (Esc/? are routed through App's single keydown owner; backdrop/button close here).

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

type Row = { keys: string; act: string }

const GRAMMAR: Row[] = [
  { keys: 'Space / K', act: 'play-pause' },
  // "step ∓1 tick" made the reader decode minus-plus notation to learn which arrow goes which way
  // (v0.5d) — each arrow now states its own direction, plainly.
  { keys: '← / →', act: '← −1 · → +1 tick' },
  { keys: 'J / L', act: 'speed slower / faster' },
  { keys: '1 – 4', act: 'set speed (0.25× · 1× · 4× · 8×)' },
  { keys: 'F', act: 'focus camera on selected agent' },
  { keys: 'O', act: "observer's eye — POV of the query stage (e0)" },
  { keys: 'Esc', act: 'deselect (or close this help)' },
  { keys: '?', act: 'toggle this help' },
  { keys: 'click timeline', act: 'select nearest event' },
  { keys: 'drag timeline', act: 'scrub playhead' },
  { keys: 'shift-click timeline', act: 'select event' },
  { keys: 'click cone', act: 'select agent' },
]

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Modality: on open, remember the element that had focus (the header ? button, typically) and move
  // focus into the dialog (its close button). On close/unmount, restore focus to that element so
  // keyboard users land back where they were. Deps on `open` only; the returned cleanup runs when the
  // overlay closes.
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    // Only restore focus if the remembered element is still in the document: a run-switch while help
    // is open can unmount the element that had focus (e.g. a nav button), and calling .focus() on a
    // detached node is a silent no-op at best — guard on isConnected so we never chase a stale ref.
    return () => { const prev = prevFocusRef.current; if (prev?.isConnected) prev.focus() }
  }, [open])

  if (!open) return null

  // Focus trap. The panel's only focusable is the close button, so a Tab / Shift+Tab that would
  // otherwise escape the dialog is redirected straight back to it — focus can never leave the modal.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus() }
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="keyboard and pointer grammar"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <h2>keyboard &amp; pointer</h2>
        <div className="help-grid">
          {GRAMMAR.map((r) => (
            <div className="help-row" key={r.keys}>
              <span className="help-keys">{r.keys}</span>
              <span className="help-act">{r.act}</span>
            </div>
          ))}
        </div>
        <button ref={closeRef} className="help-close" onClick={onClose}>close (Esc)</button>
      </div>
    </div>
  )
}
