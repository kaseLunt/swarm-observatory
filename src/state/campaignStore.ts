import { create } from 'zustand'
import { deriveRunStatus, type RunStatus, type RunSummary } from '../decode/campaignVerify'

// ── THE CAMPAIGN STORE SLICE (presentation-free — the Wall renders it) ─────────────────────────────────────────
// A SEPARATE small store from viewStore (the single-run playhead has nothing to do with a 50-seed rollup).
// It holds the per-seed PHASE map + the campaign rollup, and NOTHING about how any of it looks — no glyphs, no
// voice, no colour. Rendering (the ✓/✗ voices, the wall) is the Wall's job; this is the data it consumes. The spine
// (queue events → these actions) is the only writer.
//
// A seed phase is 'pending' (enqueued, not started) → 'running' (dispatched) → a terminal RunStatus
// ('verified' | 'mismatch' | 'error'). The rollup is DERIVED from the phase map by a pure function
// (computeRollup) and recomputed on every mutation, so a subscriber re-renders on the counts alone.

export type SeedPhase = 'pending' | 'running' | RunStatus

export interface CampaignRollup {
  verified: number
  mismatched: number
  error: number
  pending: number // not yet terminal (enqueued or running)
  total: number
}

// Pure rollup math — exported so it is unit-testable without a store, and so the store and any other consumer
// reduce the SAME way (one definition, no drift). `pending` is the residual: everything not yet terminal.
export function computeRollup(phase: Readonly<Record<string, SeedPhase>>, total: number): CampaignRollup {
  let verified = 0
  let mismatched = 0
  let error = 0
  for (const p of Object.values(phase)) {
    if (p === 'verified') verified++
    else if (p === 'mismatch') mismatched++
    else if (p === 'error') error++
  }
  return { verified, mismatched, error, pending: total - verified - mismatched - error, total }
}

const emptyRollup = (total: number): CampaignRollup => ({ verified: 0, mismatched: 0, error: 0, pending: total, total })

// DERIVE-DON'T-TRUST, the store's own last-line guarantee: never GREEN a seed unless BOTH the worker's label
// AND its EVIDENCE say verified. A fail-closed rollup may under-count a green but must NEVER over-count one. When
// the label claims 'verified' the phase becomes whatever the evidence DERIVES (deriveRunStatus) — so a mislabelled
// 'verified' (sha256ok false, ids null, …) falls to 'mismatch'/'error' instead of greening. A non-green label is
// honoured as-is: a transport 'error' (errorSummary — sha256ok false, null ids) is not reproducible from verify
// flags, and an over-refusal is safe. In production a summary already passed the worker-client boundary
// (label === derived), so this only ever bites a non-worker path; it is defence in depth, not the boundary's
// substitute.
//
// The MIRROR of the boundary's block⟺¬decoded law — and, like the boundary, EVIDENCE outranks the label in BOTH
// directions, INCLUDING when the label's incoherence is the only problem. deriveRunStatus is blind to the error block,
// so we DERIVE FIRST: a claimed-'verified' whose evidence derives 'mismatch' (the relabelled fold-threw-mismatch:
// nonempty digest, ¬sha256ok, ids null, block) or 'error' (fold threw, sha pin matched) records THAT derived verdict —
// an integrity failure is never buried in the operational 'error' bucket by the label. The block forces 'error' ONLY
// when the evidence would OTHERWISE green: a {'verified', canonical ids + flags, error:{…}} summary derives 'verified',
// yet no producer emits verified+block, so the incoherent block is the sole problem → 'error', never a green. (The
// operational errorSummary — status 'error', empty digest — is a non-green label, honoured as-is by the first line,
// its OWN branch, never routed through derivation.) The order is the fix: the old code forced 'error' on EVERY
// block-bearing 'verified' BEFORE deriving, concealing a would-be MISMATCH as an availability 'error' — integrity
// evidence hidden in the operational bucket, on exactly the bypass inputs this defence-in-depth layer exists for. The
// worker-client boundary crashes on every one of these shapes, so this only bites a non-worker path; the second layer
// never relies on the first.
function coherentPhase(summary: RunSummary): RunStatus {
  // THE DIGEST AXIS FIRST — ABOVE every label branch: an EMPTY digest means no bytes were ever fetched and
  // hashed, so no integrity comparison existed to fail, REGARDLESS of what the label claims ('verified',
  // 'mismatch', or 'error' — only the last is coherent, and 'error' is what every empty-digest summary
  // records). Derivation is digest-blind and would read the null-ids/¬sha256ok shape as an integrity
  // 'mismatch'; a relabelled operational failure must land in availability, never integrity.
  if (summary.sha256Hex === '') return 'error'
  if (summary.status !== 'verified') return summary.status // a non-green label (integrity 'mismatch' etc.) is its own branch
  // DERIVE FIRST for nonempty digests — evidence outranks the label. A claimed-'verified' whose evidence derives
  // 'mismatch'/'error' records that real verdict, so a relabelled integrity failure is never concealed as an
  // availability 'error'.
  const derived = deriveRunStatus(summary)
  if (derived !== 'verified') return derived
  // The evidence WOULD green: force 'error' only here, where a block on an otherwise-coherent green is the sole
  // incoherence (deriveRunStatus is block-blind; no producer emits verified+block). Never green such a summary.
  if (summary.error !== undefined) return 'error'
  return 'verified'
}

interface CampaignStoreState {
  total: number
  phase: Record<string, SeedPhase>
  summaries: Record<string, RunSummary>
  rollup: CampaignRollup
  // Seed the run set (all 'pending'). Idempotent per id set — called when a campaign run begins.
  init(ids: readonly string[]): void
  // A seed was dispatched to the worker.
  markRunning(id: string): void
  // A seed's verdict arrived (the worker's RunSummary). Sets its terminal phase + stores the summary.
  record(summary: RunSummary): void
  // Cancel the IN-FLIGHT verification WITHOUT erasing observed evidence. Every seed that reached a
  // TERMINAL verdict this session (verified / mismatch / error) KEEPS its phase, summary, and census count — an
  // observed contradiction (✗) must never vanish on an ordinary cancel. Only the not-yet-terminal seeds
  // (running / pending) return to attested-pending. Distinct from reset(): reset() ENDS the session (a fresh
  // mount → true rest); cancelPending() is a mid-session stop that preserves the receipts already earned.
  cancelPending(): void
  // Clear everything (a run switch / unmount).
  reset(): void
}

export const useCampaignStore = create<CampaignStoreState>((set) => ({
  total: 0,
  phase: {},
  summaries: {},
  rollup: emptyRollup(0),
  init: (ids) => {
    const phase: Record<string, SeedPhase> = {}
    for (const id of ids) phase[id] = 'pending'
    set({ total: ids.length, phase, summaries: {}, rollup: computeRollup(phase, ids.length) })
  },
  markRunning: (id) => set((s) => {
    // Only a known, not-yet-terminal seed transitions to running (a stale/unknown id is ignored — the store
    // never invents a row). running does not change the rollup (pending counts running too), but the phase map
    // must reflect it so the Wall can voice "in flight".
    if (!(id in s.phase) || s.phase[id] !== 'pending') return s
    return { phase: { ...s.phase, [id]: 'running' } }
  }),
  record: (summary) => set((s) => {
    const id = summary.id
    if (!(id in s.phase)) return s // a summary for a seed we never seeded — ignore (no phantom rows)
    // The phase is the EVIDENCE-coherent status, never the raw wire label — the rollup (a certification surface)
    // must not green on a summary its own flags contradict. The summary is stored verbatim so the Wall can still show
    // the underlying evidence beside the (possibly downgraded) verdict.
    const phase = { ...s.phase, [id]: coherentPhase(summary) }
    return { phase, summaries: { ...s.summaries, [id]: summary }, rollup: computeRollup(phase, s.total) }
  }),
  cancelPending: () => set((s) => {
    // Return ONLY the in-flight seeds (running/pending) to attested-pending; terminal phases + their summaries
    // are untouched, so the recomputed rollup preserves every verified/mismatched/error count earned this
    // session. (running → pending clears the "verifying" in-flight posture; a straggler is already fenced by
    // the queue's epoch bump, so no late record() will re-terminal a reverted seed.)
    let changed = false
    const phase: Record<string, SeedPhase> = {}
    for (const [id, p] of Object.entries(s.phase)) {
      if (p === 'running') { phase[id] = 'pending'; changed = true }
      else phase[id] = p
    }
    if (!changed) return s // nothing in flight — no-op (idempotent; a second cancel is a clean no-op)
    return { phase, rollup: computeRollup(phase, s.total) }
  }),
  reset: () => set({ total: 0, phase: {}, summaries: {}, rollup: emptyRollup(0) }),
}))
