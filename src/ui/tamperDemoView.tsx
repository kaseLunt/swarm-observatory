import { useEffect, useRef, useState, type RefObject } from 'react'
import { campaignBundlePath, resolveAppBase, resolveCampaignSeed, type CampaignCatalog } from '../decode/campaignCatalog'
import { markClass, requireGlyph } from './voices'
import { seedVoice } from './wall'
import { DEMO_SEED_ID, runTamperDemo, TamperDemoError, type DemoSide, type OracleKind, type TamperDemoResult } from './tamperDemo'

// ── THE TAMPER MOMENT — the ✗ path, on the Wall (v0.8) ────────────────────────────────────────────────
// The Wall proves fifty green receipts; this makes the REFUSAL visible — the skeptic's ten seconds. It fetches ONE
// certified bundle (seed 42) via a direct main-thread use of the pure campaignVerify core (the worker queue is for
// fifty; one bundle needs no queue), verifies the PRISTINE bytes, flips ONE byte of a recorded MEASUREMENT in a
// browser-memory clone, re-verifies, and paints the two per-pin chains side by side: the pristine chain (✓ external
// pins beside ○ trailer-self rings) beside the tampered refusal (event_hash ✗ cascading to result_id ✗). See
// tamperDemo.ts for the byte-offset choice, the source/cascade gates, and why the frame CRC is repaired. Glyphs are
// sourced ONLY from the voices module (requireGlyph) — never a literal here.
//
// HONESTY RAILS (all filed in the copy + the code):
//   (a) ISOLATION — the demo NEVER touches the campaign store; it lives in this component's ephemeral state, so the
//       Wall's session census/rollup stays pure (unit-pinned in tamperDemo.test.ts).
//   (b) TRANSPARENCY — the footer states plainly that one recorded value of a browser-memory copy changed and the
//       published bundle is untouched.
//   (c) REAL VOICES — the pristine side paints its real 'verified' voice and the tampered side its real 'mismatch'
//       voice (seedVoice, the SAME mapping the seed dots wear); each row wears the mark its (oracle × result)
//       actually earns — an external ✓, a trailer-self ○ ring, a ✗ contradiction, or a ? unverifiable — never a
//       flat ✓/✗ that overclaims a self-check as external agreement.
//   (d) REDUCED MOTION — the reveal fade is disabled under prefers-reduced-motion (the app idiom).
//   (e) FAIL LOUD — a non-certified source or an unexpected result is a typed TamperDemoError, rendered as an
//       honest refusal (distinct from a fetch/load failure), never a silently wrong or inverted demo.

// Each pin row names its ORACLE (compared-to-what) — a skeptic's first question. One source, rendered as a sub-note.
const ORACLE_NOTE: Record<OracleKind, string> = {
  'byte-identity': 'vs the published sha-256',
  'trailer-self': 'vs the sealed trailer',
  'catalog-pin': 'vs the certified identity',
}

type DemoState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: TamperDemoResult }
  // `refusal` = a typed TamperDemoError (a non-certified source or an anomalous result) vs a fetch/load failure —
  // the two get different honest copy below.
  | { readonly kind: 'failed'; readonly reason: string; readonly refusal: boolean }

// One side's column: the real campaign verdict (seedVoice — the SAME voice a seed dot wears) atop the per-pin
// chain. Each row wears the mark its (oracle × result) earns — an external ✓, a trailer-self ○ ring, a ✗, or a ?.
function DemoColumn({ title, side }: { title: string; side: DemoSide }) {
  const v = seedVoice(side.status) // 'verified' → ✓ receipt · 'mismatch' → ✗ contradiction (both real)
  return (
    <div className="tamper-col">
      <p className="tamper-col-head">{title}</p>
      <p className={`tamper-verdict ${v.cls}`}>
        <span className="tamper-glyph" aria-hidden="true">{requireGlyph(v.markId)}</span>
        {v.label}
      </p>
      <ul className="tamper-chain" role="list">
        {side.rows.map((r) => (
          <li key={r.key} className={`tamper-row ${markClass(r.mark)}`}>
            <span className="tamper-mark" aria-hidden="true">{requireGlyph(r.mark)}</span>
            <span className="tamper-key">{r.label}</span>
            <span className="tamper-oracle">{ORACLE_NOTE[r.oracle]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The demo affordance + its ephemeral result panel. `cat` is the Wall's catalog (the ROBUST campaign); the demo
// resolves seed 42's pins + load path from it (the catalog authority — never a manifest field), so it cannot be
// pointed at other bytes. Rendered by the Wall beneath the census.
//
// the Wall passes its `abortRef` so the demo's in-flight fetch is aborted by the Wall's SYNCHRONOUS stop
// routine (stopWallSession) at close, not only by this child's passive unmount cleanup: the demo controller is
// registered in the SAME ref the Wall's stop path aborts, so a close-while-fetching tears down synchronously.
// The unmount cleanup below stays as the secondary fence (Esc/unmount), and the aborted-signal guard stops any
// setState after teardown.
export function TamperDemoPanel({ cat, abortRef }: { cat: CampaignCatalog; abortRef?: RefObject<AbortController | null> }) {
  const [state, setState] = useState<DemoState>({ kind: 'idle' })
  const localRef = useRef<AbortController | null>(null)
  const ctrlRef = abortRef ?? localRef // share the Wall's ref when hosted, so its synchronous stop aborts us

  // Secondary fence: on unmount abort any in-flight demo fetch. The demo writes NO store, so a late resolution
  // after close is harmless beyond the wasted work; the aborted-signal guard below stops any setState.
  useEffect(() => () => { ctrlRef.current?.abort() }, [ctrlRef])

  const run = () => {
    const seed = resolveCampaignSeed(cat.campaignId, DEMO_SEED_ID)
    if (!seed) { setState({ kind: 'failed', reason: `seed ${DEMO_SEED_ID} is not in the catalog`, refusal: false }); return }
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setState({ kind: 'running' })
    const absoluteBase = resolveAppBase(import.meta.env.BASE_URL, document.baseURI)
    const url = new URL(campaignBundlePath(cat, seed), absoluteBase).href
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`fetch failed (${r.status})`))))
      .then((buf) => {
        if (ctrl.signal.aborted) return
        // The pure core: GATE the source, tamper a clone, re-verify. NEVER touches the campaign store (rail a).
        // A non-certified source or an anomalous result throws a typed TamperDemoError (rail e).
        const result = runTamperDemo(new Uint8Array(buf), { caseId: seed.caseId, resultId: seed.resultId, sha256: seed.sha256 })
        setState({ kind: 'done', result })
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setState({ kind: 'failed', reason: e instanceof Error ? e.message : String(e), refusal: e instanceof TamperDemoError })
      })
  }

  return (
    <div className="tamper-demo">
      {state.kind !== 'done' && (
        <button className="tamper-cta" onClick={run} disabled={state.kind === 'running'}>
          {state.kind === 'running' ? 'flipping one byte…' : 'test the seal — flip one byte, watch it refuse'}
        </button>
      )}
      {state.kind === 'failed' && (
        <p className="tamper-fail">
          <span className="tamper-glyph" aria-hidden="true">{requireGlyph('unverifiable')}</span>
          {state.refusal
            ? `${state.reason} — the published seal is unchanged.`
            : `couldn’t load seed ${DEMO_SEED_ID}’s bytes to demonstrate (${state.reason}) — the seal is unchanged; try again.`}
        </p>
      )}
      {state.kind === 'done' && (
        <div className="tamper-result" role="group" aria-label="tamper demonstration">
          <p className="tamper-head">the tamper moment</p>
          <p className="tamper-sub">
            seed {DEMO_SEED_ID} · one byte of a recorded measurement — the first {state.result.kindName}’s
            position ({state.result.fieldName}, offset {state.result.flippedOffset}), flipped in a copy held only in
            your browser
          </p>
          <div className="tamper-cols">
            <DemoColumn title="as published" side={state.result.pristine} />
            <DemoColumn title="one byte flipped" side={state.result.tampered} />
          </div>
          {/* HONESTY (rails b + c + the CRC note): plain-language what happened. The recomputation is real; the
              tamper is a valid content edit (the clone still decodes); the published bundle is untouched. */}
          <p className="tamper-note">
            we cloned the certified bytes, changed one recorded measurement of the first detection, and repaired the
            frame’s plain checksum — the move a tamperer makes. The clone still decodes cleanly, yet the identity,
            re-derived from the bytes, refused it: the event hash (a self-check against the bundle’s own sealed
            trailer) diverged, and that break cascaded into the externally-pinned result_id, which broke too. Every
            untouched field still agrees. The published bundle — and this session’s receipts — are untouched.
          </p>
          <button className="tamper-cta tamper-again" onClick={run}>flip again</button>
        </div>
      )}
    </div>
  )
}
