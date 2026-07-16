import { readFileSync } from 'node:fs'
import { describe, expect, test, beforeEach } from 'vitest'
import {
  censusLine, censusModel, f64FromHexBits, gaugeDisplay, gaugeLoadFromFetch, parseCampaignGauges,
  seedVoice, stopWallSession,
} from './wall'
import { ROBUST_F3A } from '../decode/campaignCatalog'
import { MARKS, requireGlyph } from './voices'
import { useCampaignStore } from '../state/campaignStore'
import { errorSummary, type RunSummary, type VerifyJob } from '../decode/campaignVerify'
import { createCampaignQueue, type CampaignVerifyTransport } from '../decode/campaignQueue'
import type { CampaignRollup } from '../state/campaignStore'

// ── THE WALL VIEW-MODEL (v0.8 W5) — census math, phase→voice, the decoded gauge, and the verify wiring ──

// ── SEED PHASE → VOICE (the honesty rail: green is a receipt; error is availability, never a false ✗) ────
describe('seedVoice: the store phase maps to the honest mark', () => {
  test('pending and running rest in the ATTESTED voice (• on record) — running is a state, not a new voice', () => {
    expect(seedVoice('pending').markId).toBe('attested')
    expect(seedVoice('running').markId).toBe('attested')
    // running carries the `running` STATE modifier atop the attested class — not an eighth voice.
    expect(seedVoice('pending').cls).toBe('attested')
    expect(seedVoice('running').cls).toContain('attested')
    expect(seedVoice('running').cls).toContain('running')
  })
  test('verified earns the integrity ✓ (session receipt); mismatch is the integrity ✗', () => {
    expect(seedVoice('verified').markId).toBe('verified')
    expect(seedVoice('mismatch').markId).toBe('mismatch')
    expect(requireGlyph(seedVoice('verified').markId)).toBe(requireGlyph('verified'))
    expect(requireGlyph(seedVoice('mismatch').markId)).toBe(requireGlyph('mismatch'))
  })
  // THE W4 DISTINCTION THE UI MUST NOT BLUR: an availability failure is NOT a contradiction.
  test('error is the AVAILABILITY voice (unverifiable ?), distinct from the integrity mismatch (✗)', () => {
    expect(seedVoice('error').markId).toBe('unverifiable')
    expect(seedVoice('error').markId).not.toBe(seedVoice('mismatch').markId)
    expect(requireGlyph(seedVoice('error').markId)).not.toBe(requireGlyph('mismatch'))
    // A no-verdict mark stays DIM — it never borrows a verdict hue (the two-family law).
    expect(MARKS[seedVoice('error').markId].family).toBe('no-verdict')
    expect(MARKS[seedVoice('mismatch').markId].family).toBe('verdict')
  })
  test('every phase resolves to a glyph-bearing, single-sourced mark (no literal minted here)', () => {
    for (const phase of ['pending', 'running', 'verified', 'mismatch', 'error'] as const) {
      expect(() => requireGlyph(seedVoice(phase).markId)).not.toThrow()
    }
  })
})

// ── THE CENSUS (exact integers — no rings, no percentages) ──────────────────────────────────────────────
const rollup = (o: Partial<CampaignRollup>): CampaignRollup =>
  ({ verified: 0, mismatched: 0, error: 0, pending: 0, total: 0, ...o })

describe('census: exact integers, the opening declaration of the unverified', () => {
  test('the rest state declares zero recomputed against the on-record total', () => {
    const c = censusModel(rollup({ pending: 50, total: 50 }))
    expect(c).toEqual({ recomputedAndMatched: 0, onRecord: 50, contradicted: 0, unavailable: 0 })
    expect(censusLine(rollup({ pending: 50, total: 50 }))).toBe('0 of 50 recomputed and matched here · 50 on record · 0 contradicted')
  })
  test('mid-verify counts up in true integers', () => {
    expect(censusLine(rollup({ verified: 12, pending: 38, total: 50 })))
      .toBe('12 of 50 recomputed and matched here · 50 on record · 0 contradicted')
  })
  // F4 — the numerator is "recomputed AND matched": a contradicted seed was ALSO fully recomputed here (that
  // recompute is what produced the ✗), so the leading count names only the CLEAN receipts and `contradicted` is
  // the recomputed-but-disagreed subset. PREMISE-FIRST: the old wording said "48 of 50 recomputed here · 2
  // contradicted", implying only 48 ran when in truth all 50 that reached a verdict were recomputed.
  test('a contradicted seed was recomputed too — the numerator says "matched", contradicted is the subset callout', () => {
    expect(censusLine(rollup({ verified: 48, mismatched: 2, total: 50 })))
      .toBe('48 of 50 recomputed and matched here · 50 on record · 2 contradicted')
  })
  test('an availability failure is a SEPARATE clause, appended only when present', () => {
    expect(censusLine(rollup({ verified: 49, error: 1, total: 50 })))
      .toBe('49 of 50 recomputed and matched here · 50 on record · 0 contradicted · 1 unavailable')
  })
})

// ── THE GAUGES — decoded from the vendored, drift-gated manifest (never hand-hardcoded) ─────────────────
describe('f64FromHexBits: the pinned critical bounds decode exactly (big-endian)', () => {
  test('decodes the NEES lower bound bits to its exact double', () => {
    expect(f64FromHexBits('4063bc0da9d80e2d')).toBe(157.87666790197673)
  })
  test('rejects a malformed width / charset (fails loud, never NaN)', () => {
    expect(() => f64FromHexBits('deadbeef')).toThrow()
    expect(() => f64FromHexBits('zzzzzzzzzzzzzzzz')).toThrow()
  })
})

describe('parseCampaignGauges: the vendored manifest → the decoded gauge model', () => {
  const manifest = JSON.parse(readFileSync('public/campaigns/robust-f3a/campaign-manifest.json', 'utf8'))
  const model = parseCampaignGauges(manifest, ROBUST_F3A)
  const gauges = model.ok ? model.members : []

  test('the certified manifest VALIDATES (ok) and yields exactly the two certified members', () => {
    expect(model.ok).toBe(true)
    expect(gauges.map(g => g.kind).sort()).toEqual(['CHI2_NEES', 'CHI2_NIS'])
  })
  test('NEES: statistic + pass + dof + α from the manifest; bounds decoded from pinned bits; tick in-band', () => {
    const nees = gauges.find(g => g.kind === 'CHI2_NEES')!
    expect(nees.statisticText).toBe('212.57017224319395')
    expect(nees.pass).toBe(true)
    expect(nees.dof).toBe(200)
    expect(nees.alphaPct).toBe('2.5%')
    expect(nees.sidedness).toBe('two-sided')
    // Bounds are the exact decoded bits, and the statistic sits strictly inside them (the pass is real).
    expect(nees.criticalLo).toBeCloseTo(157.8766679, 5)
    expect(nees.statistic).toBeGreaterThan(nees.criticalLo)
    expect(nees.statistic).toBeLessThan(nees.criticalHi)
    expect(nees.position).toBeGreaterThan(0)
    expect(nees.position).toBeLessThan(1)
  })
  test('NIS: the second member decodes with its own dof and band', () => {
    const nis = gauges.find(g => g.kind === 'CHI2_NIS')!
    expect(nis.statisticText).toBe('93.21421605417723')
    expect(nis.pass).toBe(true)
    expect(nis.dof).toBe(100)
    expect(nis.statistic).toBeGreaterThan(nis.criticalLo)
    expect(nis.statistic).toBeLessThan(nis.criticalHi)
  })
  test('gaugeDisplay is fixed 3dp (the wrong-number-across-the-room grain)', () => {
    expect(gaugeDisplay(212.57017224319395)).toBe('212.570')
  })
})

// ── F3: FAIL-CLOSED — every violation class collapses the WHOLE block to one unverifiable state ────────────
// The old parse joined by test_id only, DROPPED malformed members, accepted +Infinity, and never checked
// identity — so a tampered/skewed/truncated sidecar rendered partial/wrong-band/false-pass rows. Each test here
// mutates ONE thing off the certified manifest and asserts the whole model fail-closes (ok:false) with never a
// partial member. PREMISE-FIRST is called out on the silent-drop and Infinity cases the old code passed.
describe('parseCampaignGauges: fail-closed validation (F3) — any violation → ONE unverifiable state', () => {
  const good = () => JSON.parse(readFileSync('public/campaigns/robust-f3a/campaign-manifest.json', 'utf8'))

  test('a non-object manifest is unverifiable (not silently empty)', () => {
    expect(parseCampaignGauges(null, ROBUST_F3A).ok).toBe(false)
    expect(parseCampaignGauges(42, ROBUST_F3A).ok).toBe(false)
  })
  test('an absent statistical block is unverifiable, never an honest-looking empty', () => {
    const m = good(); delete m.statistical_pointer
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('IDENTITY: a mismatched profile / plan_id / schema is unverifiable (a sidecar for another campaign)', () => {
    const badProfile = good(); badProfile.profile = 'correct-f3a'
    expect(parseCampaignGauges(badProfile, ROBUST_F3A).ok).toBe(false)
    const badPlan = good(); badPlan.verdict_pointer.plan_id = '0'.repeat(64)
    expect(parseCampaignGauges(badPlan, ROBUST_F3A).ok).toBe(false)
    const badSchema = good(); badSchema.schema = 'some-other-schema/v9'
    expect(parseCampaignGauges(badSchema, ROBUST_F3A).ok).toBe(false)
  })
  test('a WRONG member count is unverifiable — never partial rows (PREMISE: the old parse rendered what it could)', () => {
    const dropped = good(); dropped.statistical_pointer.members.pop() // one member gone
    const m = parseCampaignGauges(dropped, ROBUST_F3A)
    expect(m.ok).toBe(false) // NOT one lonely gauge under the campaign header
  })
  test('a declared member_count that disagrees with the actual array length is unverifiable', () => {
    const m = good(); m.statistical_pointer.member_count = 3
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a DUPLICATE test_id is unverifiable (no double-counted / shadowed member)', () => {
    const m = good()
    m.statistical_pointer.members = [m.statistical_pointer.members[0], { ...m.statistical_pointer.members[0] }]
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a MIS-KINDED member (test_id 2 relabelled) is unverifiable', () => {
    const m = good(); m.statistical_pointer.members[0].kind = 'CHI2_NIS'
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a +Infinity upper bound is unverifiable (PREMISE: the old lo<hi test PASSED +Infinity)', () => {
    const m = good()
    m.test_params_echo.members[0].critical_hi_bits = '7ff0000000000000' // +Infinity
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a malformed / non-decodable critical bit-string is unverifiable', () => {
    const m = good(); m.test_params_echo.members[0].critical_lo_bits = 'not-hex'
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a pass ⟺ band inconsistency (a lying pass flag) is unverifiable', () => {
    // Push the NEES statistic OUTSIDE its band while keeping pass:true — the old parse would have rendered a
    // green pass whose tick sat outside the drawn band. Now the contradiction fail-closes the whole block.
    const m = good(); m.statistical_pointer.members[0].statistic = '9999.0'
    const parsed = parseCampaignGauges(m, ROBUST_F3A)
    expect(parsed.ok).toBe(false)
  })
  test('a coherent pass:false + out-of-band statistic is REJECTED — the certified verdict is catalog-pinned (F1)', () => {
    // PREMISE-FIRST: pre-F1 this VALIDATED (a coherent pass:false agreeing with an out-of-band statistic was
    // treated as "a legitimate failing verdict" and rendered as a fail gauge). F1 supersedes that: the certified
    // statistic + pass are now PINNED in the catalog, so the sidecar can no longer introduce a DIFFERENT-but-
    // coherent verdict — the campaign's verdict is fixed truth. An ACTUAL failing campaign would pin pass:false
    // in the catalog itself; a manifest that merely CLAIMS a different verdict is a deviation and fail-closes.
    const m = good()
    m.statistical_pointer.members[1].statistic = '9999.0'
    m.statistical_pointer.members[1].pass = false
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
})

// ── F1: THE CERTIFIED TUPLE IS CATALOG-PINNED — the render is catalog truth CONFIRMED by fetch, never raw fetch ─
// Pre-F1, parseCampaignGauges checked only IDENTITY + shape + internal consistency, then TRUSTED the sidecar's
// statistic/pass/dof/alpha/sidedness/bounds. A tampered or stale fetch could therefore render a COHERENT forgery
// (internally self-consistent, carrying this campaign's identity). Now every certified field is pinned in
// campaignCatalog.ts and a fetched deviation fail-closes the whole block. Each test mutates ONE field class off
// the certified manifest and asserts rejection; the pristine manifest still validates (the pins are truth, not a
// false tripwire). The independent literal copy in publication.test.ts (PINNED_GAUGES) additionally guards the
// catalog itself against a coordinated catalog+manifest edit — see the note there.
describe('parseCampaignGauges: F1 — a coherent forgery is rejected; each certified field class is pinned', () => {
  const good = () => JSON.parse(readFileSync('public/campaigns/robust-f3a/campaign-manifest.json', 'utf8'))

  test('the pristine certified manifest still VALIDATES (the catalog pins ARE the truth)', () => {
    expect(parseCampaignGauges(good(), ROBUST_F3A).ok).toBe(true)
  })
  test('a COHERENT forgery (statistic 9999 + pass:false, clean identity, internally consistent) is rejected', () => {
    // NEES: an out-of-band statistic with pass:false is INTERNALLY consistent and keeps this campaign's identity,
    // so every pre-F1 gate passed it. The catalog statistic + pass pins reject it: the fetch cannot forge the verdict.
    const m = good()
    m.statistical_pointer.members[0].statistic = '9999'
    m.statistical_pointer.members[0].pass = false
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('mutating the pass flag alone (pass:false on the certified NEES) is rejected', () => {
    const m = good(); m.statistical_pointer.members[0].pass = false
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('mutating dof is rejected', () => {
    const m = good(); m.test_params_echo.members[0].dof = 201
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('mutating alpha (alpha_ppm) is rejected', () => {
    const m = good(); m.test_params_echo.members[0].alpha_ppm = 10000
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('mutating sidedness (TWO → ONE) is rejected', () => {
    const m = good(); m.test_params_echo.members[0].sidedness = 'ONE'
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('mutating a bound bit-string (one nibble of critical_lo_bits) is rejected — a well-formed but wrong bound', () => {
    // Still 16 valid hex chars that decode to a FINITE ordered bound (so it passes every shape/finite/order gate);
    // only the catalog bit-string pin catches it. This is the coherent-skew the old circular gate missed.
    const m = good(); m.test_params_echo.members[0].critical_lo_bits = '4063bc0da9d80e2c'
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
})

// ── F2: THE PARAMS ECHO IS VALIDATED ATOMICALLY — no silent drop, no duplicate override ──────────────────────
// PREMISE-FIRST: the old reader filtered malformed rows away, then Map.set per row with no count/dup/id/kind
// guard — so a DUPLICATE test_id row (last write wins) could OVERRIDE a real row's dof/bits and the block STILL
// returned ok:true. The raw array is now gated whole before any map is built.
describe('parseCampaignGauges: F2 — the raw test_params_echo array is validated atomically', () => {
  const good = () => JSON.parse(readFileSync('public/campaigns/robust-f3a/campaign-manifest.json', 'utf8'))

  test('a DUPLICATE params row with a WRONG kind + tampered dof is rejected (the old map let it override dof, ok:true)', () => {
    // The counterexample the fix exists for: append a second test_id=2 row carrying a WRONG kind and a tampered
    // dof. Old behavior: rawMembers.filter kept it, Map.set(2, forged) OVERWROTE the real row → the NEES gauge
    // read dof 999, and (dof never touching band/pass consistency) the block returned ok:true. Now the exact-row-
    // count gate rejects the extra row.
    const m = good()
    const nees = m.test_params_echo.members.find((p: { test_id: number }) => p.test_id === 2)
    m.test_params_echo.members.push({ ...nees, kind: 'CHI2_NIS', dof: 999 })
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a duplicate that keeps the EXACT row count (id 2 twice, id 3 gone) is rejected (dup + missing id both caught)', () => {
    const m = good()
    m.test_params_echo.members[1] = { ...m.test_params_echo.members[0], dof: 999 } // two id=2 rows, id=3 dropped
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a malformed (non-object) params row is rejected, never silently dropped (PREMISE: the old filter dropped it)', () => {
    const m = good(); m.test_params_echo.members[1] = null
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
  test('a WRONG params row count (an extra well-formed row) is rejected', () => {
    const m = good()
    m.test_params_echo.members.push({ ...m.test_params_echo.members[0], test_id: 4, kind: 'CHI2_OTHER' })
    expect(parseCampaignGauges(m, ROBUST_F3A).ok).toBe(false)
  })
})

// ── F5: the per-open discriminated load state + the idempotent stop routine ─────────────────────────────────
describe('gaugeLoadFromFetch: the modal load state (F5)', () => {
  const good = () => JSON.parse(readFileSync('public/campaigns/robust-f3a/campaign-manifest.json', 'utf8'))
  test('a null fetch (network / !ok) → failed (an availability gap, never a fabricated verdict)', () => {
    expect(gaugeLoadFromFetch(null, ROBUST_F3A)).toEqual({ kind: 'failed' })
    expect(gaugeLoadFromFetch(undefined, ROBUST_F3A)).toEqual({ kind: 'failed' })
  })
  test('a valid manifest → loaded with the members', () => {
    const load = gaugeLoadFromFetch(good(), ROBUST_F3A)
    expect(load.kind).toBe('loaded')
    if (load.kind === 'loaded') expect(load.members.map(m => m.kind).sort()).toEqual(['CHI2_NEES', 'CHI2_NIS'])
  })
  test('a fetched-but-invalid manifest → invalid with a reason (distinct from failed)', () => {
    const m = good(); m.profile = 'not-this-campaign'
    const load = gaugeLoadFromFetch(m, ROBUST_F3A)
    expect(load.kind).toBe('invalid')
    if (load.kind === 'invalid') expect(load.reason.length).toBeGreaterThan(0)
  })
})

describe('stopWallSession: one idempotent teardown (F5)', () => {
  test('invokes all three handles, and a SECOND call is a clean no-op (idempotent)', () => {
    let aborts = 0, cancels = 0, resets = 0
    const handles = { abort: () => { aborts++ }, cancelQueue: () => { cancels++ }, reset: () => { resets++ } }
    expect(() => { stopWallSession(handles); stopWallSession(handles) }).not.toThrow()
    expect([aborts, cancels, resets]).toEqual([2, 2, 2]) // both calls ran cleanly; the primitives own no-op safety
  })
  test('stays consistent over real idempotent primitives (aborted controller, cancelled queue reset twice)', () => {
    const ctrl = new AbortController()
    const stop = () => stopWallSession({
      abort: () => ctrl.abort(),
      cancelQueue: () => {},
      reset: () => useCampaignStore.getState().reset(),
    })
    expect(() => { stop(); stop() }).not.toThrow()
    expect(ctrl.signal.aborted).toBe(true)
    expect(useCampaignStore.getState().total).toBe(0)
  })
})

// ── VERIFY-ALL START / CANCEL — the queue→store wiring, against a fake transport (no worker, no network) ─
// This is the EXACT wiring wallView.tsx uses (started → markRunning, done → record), driven by a controllable
// fake transport so the store transitions and the cancel fence are pinned without a browser.
describe('verify-all wiring: the queue drives the store; cancel fences cleanly', () => {
  const JOBS: VerifyJob[] = [
    { id: '42', seed: 42, campaignId: 'robust-f3a' },
    { id: '43', seed: 43, campaignId: 'robust-f3a' },
    { id: '44', seed: 44, campaignId: 'robust-f3a' },
  ]
  const IDS = JOBS.map(j => j.id)

  // A verified-shaped summary (the coherent shape the store re-derives to 'verified').
  const HEX = 'a'.repeat(64)
  const verifiedSummary = (id: string, seed: number): RunSummary => ({
    id, seed, status: 'verified', basis: 'campaign-manifest',
    sha256Hex: HEX, sha256ok: true, caseIdHex: HEX, resultIdHex: HEX,
    caseIdOk: true, resultIdOk: true, matchesTrailer: true,
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  })

  beforeEach(() => { useCampaignStore.getState().reset() })

  // Wire the queue events into the store the same way the component does.
  const wire = (transport: CampaignVerifyTransport) =>
    createCampaignQueue({
      concurrency: 3,
      transport,
      onEvent: (e) => {
        const st = useCampaignStore.getState()
        if (e.type === 'started') st.markRunning(e.id)
        else if (e.type === 'done') st.record(e.summary)
      },
    })

  test('start → dispatched seeds go running; a landed summary greens its seed; the rollup counts up', async () => {
    useCampaignStore.getState().init(IDS)
    // A transport whose resolution we control per job.
    const gate: Record<string, (s: RunSummary) => void> = {}
    const transport: CampaignVerifyTransport = (job) =>
      new Promise<RunSummary>((resolve) => { gate[job.id] = resolve })

    const q = wire(transport)
    q.start(JOBS)
    // All three dispatched (concurrency 3) → running.
    expect(useCampaignStore.getState().rollup.pending).toBe(3)
    expect(useCampaignStore.getState().phase['42']).toBe('running')

    // Land seed 43 FIRST (true completion order is honoured, not seed order).
    gate['43']!(verifiedSummary('43', 43))
    await Promise.resolve(); await Promise.resolve()
    expect(useCampaignStore.getState().phase['43']).toBe('verified')
    expect(useCampaignStore.getState().rollup.verified).toBe(1)
    // 42 is still in flight — the field flips at REAL completion, not on a staged cascade.
    expect(useCampaignStore.getState().phase['42']).toBe('running')
  })

  test('a fetch failure lands in the AVAILABILITY bucket (error), never as a contradiction (mismatch)', async () => {
    useCampaignStore.getState().init(IDS)
    const transport: CampaignVerifyTransport = (job) =>
      Promise.resolve(errorSummary(job.id, job.seed, 'FetchError', 'boom'))
    const q = wire(transport)
    q.start(JOBS)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const r = useCampaignStore.getState().rollup
    expect(r.error).toBe(3)
    expect(r.mismatched).toBe(0) // a 404 is NOT a ✗
    expect(useCampaignStore.getState().phase['42']).toBe('error')
  })

  test('cancel fences the batch: a straggler resolving AFTER cancel never touches the store', async () => {
    useCampaignStore.getState().init(IDS)
    let late: ((s: RunSummary) => void) | null = null
    const transport: CampaignVerifyTransport = (job, signal) =>
      new Promise<RunSummary>((resolve, reject) => {
        if (job.id === '42') late = resolve // capture 42's resolver to fire it AFTER cancel
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const q = wire(transport)
    q.start(JOBS)
    expect(useCampaignStore.getState().phase['42']).toBe('running')

    q.cancel()
    expect(q.running).toBe(false)
    // The straggler resolves late — the epoch fence must drop it: no verified seed, no rollup churn.
    late!(verifiedSummary('42', 42))
    await Promise.resolve(); await Promise.resolve()
    expect(useCampaignStore.getState().phase['42']).toBe('running') // unchanged — the late 'done' was fenced
    expect(useCampaignStore.getState().rollup.verified).toBe(0)
  })

  // F2 — the FULL component cancel (both halves: q.cancel() + store.cancelPending()) preserves earned evidence.
  // PREMISE-FIRST: the old cancelVerifyAll called store.init(seedIds), which reset EVERY phase — a landed ✓ (or
  // an observed ✗) vanished on an ordinary cancel. The fix keeps terminal receipts and reverts only in-flight.
  test('cancel (the component wiring) preserves earned evidence: a landed ✓ survives; only in-flight reverts (F2)', async () => {
    useCampaignStore.getState().init(IDS)
    const gate: Record<string, (s: RunSummary) => void> = {}
    const transport: CampaignVerifyTransport = (job, signal) =>
      new Promise<RunSummary>((resolve, reject) => {
        gate[job.id] = resolve
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const q = wire(transport)
    q.start(JOBS)
    // Land seed 42 as verified (an earned receipt); 43 and 44 remain in flight (running).
    gate['42']!(verifiedSummary('42', 42))
    await Promise.resolve(); await Promise.resolve()
    expect(useCampaignStore.getState().phase['42']).toBe('verified')
    expect(useCampaignStore.getState().phase['43']).toBe('running')

    // THE COMPONENT'S cancelVerifyAll, both halves: fence the queue AND cancelPending() the store.
    q.cancel()
    useCampaignStore.getState().cancelPending()
    const s = useCampaignStore.getState()
    expect(s.phase['42']).toBe('verified') // the receipt SURVIVES the cancel (the F2 fix)
    expect(s.rollup.verified).toBe(1)      // the census keeps its earned count — no return to zero
    expect(s.phase['43']).toBe('pending')  // in-flight seeds reverted to attested-pending (running posture gone)
    expect(s.phase['44']).toBe('pending')
  })
})
