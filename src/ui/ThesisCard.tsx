import { useEffect, useRef, useState } from 'react'
import { INDEPENDENCE_LINE, thesisSubline, thesisVerdictFor } from './thesis'
import type { TrustVerdict } from '../decode/verify'

// COLLAPSED FORM (v0.7): once the auto-tour leaves its opening establishing beat the full card
// collapses to this header verdict chip — the EXISTING verdict voice (glyph + headline), header-scale, NO new
// chrome. × still dismisses (App stops the tour + retires it for the session; a fresh cold open re-mounts the
// full card). The copy-link is deliberately NOT repeated here: it now has its own permanent home in the app
// chrome. The verdict WITHHOLDS exactly as the card does (null → no glyph/headline); × always renders.
//   The chip is a REAL header occupant on a bare cold open, so it rides the header ladder: `compact` (every
// tier below full) sheds the wide headline ("self-consistent — no external manifest", "hash mismatch —
// integrity claim failed") to an sr-only reading, leaving just the verdict GLYPH visible — the verdict voice
// survives (the glyph is the mark; the headline stays available to assistive tech) and the narrow one-row
// header never overflows. Full width keeps the full headline.
export function ThesisChip({ verdict, onDismiss, compact }: {
  verdict: TrustVerdict | null
  onDismiss: () => void
  compact?: boolean
}) {
  const v = thesisVerdictFor(verdict)
  return (
    <span className="thesis-chip" aria-label="run verdict">
      {v && (
        <span className={`thesis-chip-verdict ${v.cls}`}>
          <span className="thesis-glyph" aria-hidden="true">{v.glyph}</span>
          <span className={compact ? 'sr-only' : undefined}>{v.headline}</span>
        </span>
      )}
      <button className="thesis-chip-dismiss" aria-label="dismiss" onClick={onDismiss}>×</button>
    </span>
  )
}

// THE ZERO-CLICK THESIS CARD (v0.6 — the cold-open share surface). One card that states the thesis
// of the whole app in three beats: the VERDICT headline (the run's REAL verify result — two-voice grammar,
// never staged), the INDEPENDENCE line (the decoder never saw the engine's source yet reproduces its
// hashes), and the COPY-LINK share weapon. It rides beside the auto-started first tour beat on a bare cold
// open; ANY transport input interrupts that tour (the existing notifyUserInput grammar), and the card holds
// the share affordance until dismissed with ×. DOM only — no WebGL, no frame path.
//
// verification state NEVER rides the URL: the copy handler builds the link from the VIEW
// grammar alone (run/tick/sel/ev/speed) — the recipient's own browser re-verifies from the bytes.
export function ThesisCard({ verdict, onCopyLink, onDismiss }: {
  // TrustVerdict = the run's real trust verdict (three-voice grammar); null = WITHHELD (fail-safe): the
  // identity join failed or no hashes exist, so no verdict glyph/subline is painted — never a false green.
  verdict: TrustVerdict | null
  onCopyLink: () => Promise<boolean>
  onDismiss: () => void
}) {
  const v = thesisVerdictFor(verdict)
  // The subline is verdict-bound, so it withholds together with the verdict (TS narrows the non-null branch).
  const sub = verdict === null ? null : thesisSubline(verdict)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const copy = async () => {
    const ok = await onCopyLink()
    if (!ok) return // clipboard blocked (rare); leave the label so the user can retry — never a false "copied"
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }
  return (
    <section className="thesis-card" aria-label="run verdict and share">
      <button className="thesis-dismiss" aria-label="dismiss" onClick={onDismiss}>×</button>
      {/* Verdict + subline render ONLY when a verdict is known (v non-null). When WITHHELD they are omitted
          entirely — the honest blank of the fail-safe. The independence line (a static claim about how
          THIS app was built, always true) and the copy-link share weapon (view-only) are not verdict-bound,
          so they always render. */}
      {v && (
        <p className={`thesis-verdict ${v.cls}`}>
          <span className="thesis-glyph" aria-hidden="true">{v.glyph}</span>{v.headline}
        </p>
      )}
      {sub && <p className="thesis-sub">{sub}</p>}
      <p className="thesis-independence">{INDEPENDENCE_LINE}</p>
      <div className="thesis-actions">
        <button className="thesis-copy" onClick={copy}>{copied ? 'link copied ✓' : 'copy link'}</button>
      </div>
    </section>
  )
}
