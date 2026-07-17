import { beforeEach, describe, expect, test } from 'vitest'
import { computeRollup, useCampaignStore, type SeedPhase } from './campaignStore'
import type { RunStatus, RunSummary } from '../decode/campaignVerify'

function summary(id: string, status: RunStatus): RunSummary {
  return {
    id, seed: Number(id), status, basis: 'campaign-manifest',
    sha256Hex: 'x', sha256ok: status === 'verified', caseIdHex: 'c', resultIdHex: 'r',
    caseIdOk: status === 'verified', resultIdOk: status === 'verified', matchesTrailer: status !== 'error',
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  }
}

describe('computeRollup: pure rollup math', () => {
  test('counts each terminal status; pending is the residual', () => {
    const phase: Record<string, SeedPhase> = {
      a: 'verified', b: 'verified', c: 'mismatch', d: 'error', e: 'running', f: 'pending',
    }
    expect(computeRollup(phase, 6)).toEqual({ verified: 2, mismatched: 1, error: 1, pending: 2, total: 6 })
  })
  test('all pending ⇒ pending === total', () => {
    expect(computeRollup({ a: 'pending', b: 'pending' }, 2)).toEqual({ verified: 0, mismatched: 0, error: 0, pending: 2, total: 2 })
  })
  test('all verified ⇒ pending 0', () => {
    expect(computeRollup({ a: 'verified', b: 'verified' }, 2)).toEqual({ verified: 2, mismatched: 0, error: 0, pending: 0, total: 2 })
  })
})

describe('useCampaignStore: per-seed phase map + rollup', () => {
  beforeEach(() => useCampaignStore.getState().reset())

  test('init seeds all phases pending and totals the run', () => {
    useCampaignStore.getState().init(['42', '43', '44'])
    const s = useCampaignStore.getState()
    expect(s.total).toBe(3)
    expect(s.phase).toEqual({ 42: 'pending', 43: 'pending', 44: 'pending' })
    expect(s.rollup).toEqual({ verified: 0, mismatched: 0, error: 0, pending: 3, total: 3 })
  })

  test('markRunning moves a pending seed to running (rollup unchanged — running still counts pending)', () => {
    const st = useCampaignStore.getState()
    st.init(['42', '43'])
    st.markRunning('42')
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('running')
    expect(s.rollup.pending).toBe(2)
  })

  test('markRunning ignores unknown or already-terminal seeds (no phantom rows)', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.markRunning('999') // unknown
    st.record(summary('42', 'verified'))
    st.markRunning('42') // already terminal
    const s = useCampaignStore.getState()
    expect('999' in s.phase).toBe(false)
    expect(s.phase['42']).toBe('verified')
  })

  test('record sets the terminal phase, stores the summary, and recomputes the rollup', () => {
    const st = useCampaignStore.getState()
    st.init(['42', '43', '44', '45'])
    st.record(summary('42', 'verified'))
    st.record(summary('43', 'mismatch'))
    st.record(summary('44', 'error'))
    const s = useCampaignStore.getState()
    expect(s.phase).toEqual({ 42: 'verified', 43: 'mismatch', 44: 'error', 45: 'pending' })
    expect(s.rollup).toEqual({ verified: 1, mismatched: 1, error: 1, pending: 1, total: 4 })
    expect(s.summaries['42']!.status).toBe('verified')
  })

  test('record ignores a summary for a seed that was never seeded', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record(summary('77', 'verified'))
    const s = useCampaignStore.getState()
    expect('77' in s.phase).toBe(false)
    expect(s.rollup.total).toBe(1)
  })

  test('a full verified sweep ⇒ rollup all verified, pending 0', () => {
    const st = useCampaignStore.getState()
    const ids = Array.from({ length: 50 }, (_, i) => String(42 + i))
    st.init(ids)
    for (const id of ids) st.record(summary(id, 'verified'))
    const s = useCampaignStore.getState()
    expect(s.rollup).toEqual({ verified: 50, mismatched: 0, error: 0, pending: 0, total: 50 })
  })

  test('reset clears everything', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record(summary('42', 'verified'))
    st.reset()
    const s = useCampaignStore.getState()
    expect(s.total).toBe(0)
    expect(s.phase).toEqual({})
    expect(s.rollup).toEqual({ verified: 0, mismatched: 0, error: 0, pending: 0, total: 0 })
  })
})

describe('record: derive-don\'t-trust — never greens on contradictory evidence', () => {
  beforeEach(() => useCampaignStore.getState().reset())

  test('a "verified" summary whose sha256ok is false is downgraded to mismatch, not greened', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record({ ...summary('42', 'verified'), sha256ok: false })
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('mismatch')       // fell to the derived status, not the wire label
    expect(s.rollup.verified).toBe(0)            // the certification surface never counted the green
    expect(s.rollup.mismatched).toBe(1)
  })

  test('a "verified" summary with null id hexes is downgraded to error, not greened', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record({ ...summary('42', 'verified'), caseIdHex: null, resultIdHex: null })
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')          // ¬decoded ∧ sha256ok → error, never verified
    expect(s.rollup.verified).toBe(0)
    expect(s.rollup.error).toBe(1)
  })

  test('a coherent "verified" still greens (its evidence supports it)', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record(summary('42', 'verified'))
    expect(useCampaignStore.getState().rollup.verified).toBe(1)
  })

  test('a transport "error" (sha256ok false, null ids) stays error — a non-green label is not re-derived to mismatch', () => {
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record({ ...summary('42', 'error'), caseIdHex: null, resultIdHex: null, matchesTrailer: false })
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')          // 'error' is honoured (not flag-derivable), only greens are gated
    expect(s.rollup.error).toBe(1)
  })

  test('a block-bearing would-be-green "verified" (decoded, all flags pass) is still forced to error, never greened', () => {
    // The evidence ALONE (sha256ok true, non-null ids, all flags) derives 'verified' — deriveRunStatus is blind to the
    // error block. This is the ONLY case where the block still forces 'error': derivation would OTHERWISE green, so the
    // incoherent block is the sole problem. Mirrors the worker-client boundary; the second layer must not rely on the first.
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record({ ...summary('42', 'verified'), error: { code: 'DecodeError', message: 'certified bytes did not fold' } })
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')          // would-be-green + incoherent block → error
    expect(s.rollup.verified).toBe(0)            // never over-counted a green
    expect(s.rollup.error).toBe(1)
    expect(s.summaries['42']!.status).toBe('verified') // stored verbatim so the Wall can still show the underlying evidence
  })

  test('a "verified" relabelling a fold-threw MISMATCH (nonempty digest, ¬sha256ok, ids null, block) records MISMATCH, not error', () => {
    // PREMISE-FIRST: the OLD order (force 'error' on any block-bearing 'verified' BEFORE deriving) recorded this as
    // 'error' — an integrity failure concealed in the operational bucket. DERIVE FIRST: ¬decoded ∧ ¬sha256ok → 'mismatch',
    // and a derived non-green outranks the label, so it is recorded as MISMATCH (rollup.mismatched, never rollup.error).
    const st = useCampaignStore.getState()
    st.init(['42'])
    const relabelledMismatch = {
      ...summary('42', 'verified'),
      sha256ok: false, caseIdHex: null, resultIdHex: null, caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'tampered bytes: sha pin failed and the fold threw' },
    }
    st.record(relabelledMismatch)
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('mismatch')       // derived MISMATCH, NOT the old 'error'
    expect(s.rollup.mismatched).toBe(1)
    expect(s.rollup.error).toBe(0)               // the integrity failure was NOT buried as an availability error
    expect(s.rollup.verified).toBe(0)
    expect(s.summaries['42']!.status).toBe('verified') // stored verbatim
  })

  test('a "verified" relabelling an OPERATIONAL failure (EMPTY digest) records ERROR, never mismatch (digest axis)', () => {
    // The digest axis outranks derivation in the mirror exactly as it does at the boundary: an empty sha256Hex means
    // no bytes were ever fetched and hashed — derivation is digest-blind and would read the null-ids/¬sha256ok shape
    // as an integrity 'mismatch', but there was no integrity check to fail. A relabelled errorSummary is an
    // availability failure wearing a green label: it records 'error' (availability), never 'mismatch' (integrity).
    const st = useCampaignStore.getState()
    st.init(['42'])
    const relabelledOperational = {
      ...summary('42', 'verified'),
      sha256Hex: '', sha256ok: false, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'FetchError', message: 'HTTP 404' },
    }
    st.record(relabelledOperational)
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')          // availability, NOT integrity
    expect(s.rollup.error).toBe(1)
    expect(s.rollup.mismatched).toBe(0)          // no bytes were verified — nothing mismatched
    expect(s.rollup.verified).toBe(0)            // and certainly no green
  })

  test('a "mismatch" relabelling an OPERATIONAL failure (EMPTY digest) records ERROR — the digest axis outranks EVERY label', () => {
    // The digest guard sits ABOVE the non-'verified' early return: an errorSummary relabelled 'mismatch' would
    // otherwise return at the label branch and count as an INTEGRITY failure — but an empty digest proves no bytes
    // were fetched or hashed, so no integrity comparison existed to fail, regardless of the label's claim.
    const st = useCampaignStore.getState()
    st.init(['42'])
    const relabelledToMismatch = {
      ...summary('42', 'mismatch'),
      sha256Hex: '', sha256ok: false, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'FetchError', message: 'HTTP 404' },
    }
    st.record(relabelledToMismatch)
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')          // availability, regardless of the label
    expect(s.rollup.error).toBe(1)
    expect(s.rollup.mismatched).toBe(0)          // never a false integrity verdict
  })

  test('a "verified" relabelling the fold-threw ERROR arm (sha256ok true, ids null, block) records ERROR — the legitimately-derived error is preserved', () => {
    // The other derive-first arm: ¬decoded ∧ sha256ok → 'error' (certified bytes that will not fold). Derivation, not the
    // block, is what records it — a legitimately-derived 'error' is preserved, distinct from the would-be-green case above.
    const st = useCampaignStore.getState()
    st.init(['42'])
    st.record({
      ...summary('42', 'verified'),
      sha256ok: true, caseIdHex: null, resultIdHex: null, caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'certified bytes did not fold' },
    })
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('error')
    expect(s.rollup.error).toBe(1)
    expect(s.rollup.mismatched).toBe(0)
    expect(s.rollup.verified).toBe(0)
  })
})

describe('cancelPending: an in-view cancel preserves observed evidence', () => {
  beforeEach(() => useCampaignStore.getState().reset())

  test('terminal verdicts (verified/mismatch/error) SURVIVE; only in-flight seeds revert to attested-pending', () => {
    const st = useCampaignStore.getState()
    st.init(['42', '43', '44', '45', '46'])
    st.record(summary('42', 'verified'))
    st.record(summary('43', 'mismatch')) // an observed contradiction (✗) — must NOT vanish on cancel
    st.record(summary('44', 'error'))
    st.markRunning('45')                  // in flight
    // 46 stays pending
    st.cancelPending()
    const s = useCampaignStore.getState()
    // The three terminal phases + their counts are intact — the evidence surface keeps what it observed.
    expect(s.phase['42']).toBe('verified')
    expect(s.phase['43']).toBe('mismatch')
    expect(s.phase['44']).toBe('error')
    expect(s.rollup).toEqual({ verified: 1, mismatched: 1, error: 1, pending: 2, total: 5 })
    // Only the in-flight seed reverted (running → pending); the already-pending seed is untouched.
    expect(s.phase['45']).toBe('pending')
    expect(s.phase['46']).toBe('pending')
  })

  test('PREMISE-FIRST: the old handler (init) erased the contradiction; cancelPending keeps the ✗ and its count', () => {
    const st = useCampaignStore.getState()
    st.init(['42', '43'])
    st.record(summary('42', 'mismatch')) // one observed ✗
    st.markRunning('43')
    // init() (the OLD cancel) reset EVERY phase to pending → mismatched back to 0 (evidence silently deleted).
    st.cancelPending()
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('mismatch')
    expect(s.rollup.mismatched).toBe(1)                // the census does NOT return to zero contradicted
    expect(s.summaries['42']!.status).toBe('mismatch') // the underlying summary is retained too
  })

  test('idempotent: with nothing in flight, a second cancel is a clean no-op (same rollup + phase)', () => {
    const st = useCampaignStore.getState()
    st.init(['42', '43'])
    st.record(summary('42', 'verified'))
    st.cancelPending()
    const afterFirst = useCampaignStore.getState()
    const rollup1 = afterFirst.rollup
    const phase1 = afterFirst.phase
    st.cancelPending()
    const afterSecond = useCampaignStore.getState()
    expect(afterSecond.rollup).toEqual(rollup1)
    expect(afterSecond.phase).toBe(phase1) // same reference — the no-change guard returned the prior state
  })
})
