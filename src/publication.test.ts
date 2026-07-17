import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { foldAndVerify } from './decode/verify'
import { decodeBundle } from './decode/decodeBundle'
import { gateManifest, parseManifest, type Identity } from './decode/manifest'
import { resolveLoadPlan, RUN_CATALOG } from './decode/runCatalog'
import { ROBUST_F3A } from './decode/campaignCatalog'
import { PROFILE_CONFLATION_RE } from './ui/hangar'
import { parseCampaignGauges, f64FromHexBits } from './ui/wall'
import identity from '../contract/identity.json'

// The v0.6 publication window. The three v8-certified KAT fixtures (f2a/f3a/f4
// seed-42) are published to public/runs/ as FULL-manifest runs and named in index.json. This suite
// is the house's publication gate: the byte contract must hold end to end — the vendored fixture
// bytes == the published bytes == the sha256 pinned in <fixture>/IDENTITY.json — and an independent
// re-fold of the PUBLISHED bytes must recover the pinned identity before anything ships. The house
// never publishes unverified bytes. The Certification Wall rider's f3a robust
// prohibition is pinned at the bottom.

interface IdentityAnchor {
  experiment: string; seed: number; case_id: string; result_id: string
  bundle_det_sha256: string; bundle_det_len: number
  event_schema_version: number; state_schema_version: number; pins_record: string
}
interface RunEntry {
  id: string; title: string; base: string; detOnly?: boolean
  ticks: number; kinds: Record<string, number>; dtUs?: number; supersedesPlanId?: string
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const bytes = (p: string): Uint8Array => new Uint8Array(readFileSync(p))
const text = (p: string): string => readFileSync(p, 'utf8')
const json = <T>(p: string): T => JSON.parse(text(p)) as T

// The single <attempt_id>/ dir under a fixture — the anti-smuggling drop layout (the attempt dir
// holds EXACTLY {bundle.det, manifest.json}; IDENTITY.json sits beside it). See
// contract/fixtures/README-2026-07-08-drop.md.
function attemptDir(fixture: string): string {
  const base = `contract/fixtures/${fixture}`
  const dirs = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  expect(dirs, `${fixture}: exactly one attempt dir`).toHaveLength(1)
  return `${base}/${dirs[0]}`
}

// Published run ⇒ certifying fixture + the run's expected size (documents the shipped content).
const PUBLISHED = [
  { id: 'f2a', fixture: 'f2a_seed42', eventCount: 212, tickCount: 96 },
  { id: 'f3a', fixture: 'f3a_seed42', eventCount: 257, tickCount: 96 },
  { id: 'f4', fixture: 'f4_seed42', eventCount: 64, tickCount: 96 },
]

const index = json<RunEntry[]>('public/runs/index.json')

describe.each(PUBLISHED)('published run $id', ({ id, fixture, eventCount, tickCount }) => {
  const anchor = json<IdentityAnchor>(`contract/fixtures/${fixture}/IDENTITY.json`)
  const src = attemptDir(fixture)
  const publishedDet = bytes(`public/runs/${id}/bundle.det`)

  test('published bundle.det is byte-identical to the certified fixture', () => {
    expect(sha256(publishedDet)).toBe(sha256(bytes(`${src}/bundle.det`)))
  })
  test('published bytes match the IDENTITY.json sha256 + length anchor', () => {
    expect(sha256(publishedDet)).toBe(anchor.bundle_det_sha256)
    expect(publishedDet.byteLength).toBe(anchor.bundle_det_len)
  })
  test('published manifest.json is byte-identical to the certified fixture', () => {
    expect(text(`public/runs/${id}/manifest.json`)).toBe(text(`${src}/manifest.json`))
  })

  // Independent re-fold of the PUBLISHED bytes recovers the pinned identity (the decode-verify ritual).
  const v = foldAndVerify(publishedDet)
  test('decoded case_id matches the IDENTITY anchor', () => expect(v.caseIdHex).toBe(anchor.case_id))
  test('decoded result_id matches the IDENTITY anchor', () => expect(v.resultIdHex).toBe(anchor.result_id))
  test('decoded counts match the shipped run and the trailer is self-consistent', () => {
    expect(v.eventCount).toBe(eventCount)
    expect(v.tickCount).toBe(tickCount)
    expect(v.matchesTrailer).toBe(true)
  })

  // Full-manifest publication (like f0): the manifest must gate against the app identity so useRun's
  // manifest path reaches 'ready' (not the gate screen), and it must agree with the decoded bytes.
  const m = parseManifest(text(`public/runs/${id}/manifest.json`))
  test('manifest gates OK against contract/identity.json (the run loads, not gated out)', () => {
    expect(gateManifest(m, identity as Identity)).toEqual({ ok: true })
  })
  test('manifest case_id/result_id and counts agree with the decoded bytes', () => {
    expect(m.caseId).toBe(v.caseIdHex)
    expect(m.resultId).toBe(v.resultIdHex)
    expect(Number(m.eventCount)).toBe(v.eventCount)
    expect(Number(m.tickCount)).toBe(v.tickCount)
  })
  test('manifest carries a real dt_us (published runs render the true sim clock)', () => {
    expect(Number.isFinite(m.dtUs)).toBe(true)
    expect(m.dtUs).toBeGreaterThan(0)
  })

  // index.json names the run as a full-manifest entry (no det-only flag) with an honest title.
  test('index.json carries a full-manifest entry with an honest title', () => {
    const entry = index.find(e => e.id === id)
    expect(entry, `index.json entry for ${id}`).toBeTruthy()
    expect(entry!.base).toBe(`runs/${id}`)
    expect(entry!.detOnly).toBeUndefined()
    expect(entry!.title.trim().length).toBeGreaterThan(0)
  })
})

// ── DECLARED index metadata proven against the real decoder (declared-vs-decoded) ───────────
// The Hangar renders index.json's declared `kinds` histogram + `ticks` without decoding anything; the
// declaration is publish-time metadata (tools/runIndex.mjs). Here the REAL decoder re-derives both from
// the published bytes and the declaration must match EXACTLY — the two-voice split the design-of-record names:
// the card shows the declaration, this test proves it true at build time.
const detBuf = (p: string): ArrayBuffer => { const b = bytes(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }
function decodedHistogram(run: { kind: Uint16Array }): Record<string, number> {
  const h: Record<string, number> = {}
  for (const k of run.kind) h[k] = (h[k] ?? 0) + 1
  return h
}

describe.each(index)('index metadata for $id', (entry) => {
  const run = decodeBundle(detBuf(`public/${entry.base}/bundle.det`))
  test('declared kind histogram matches the decoded bundle exactly', () => {
    expect(entry.kinds).toEqual(decodedHistogram(run))
  })
  test('declared tick count matches the decoded state-frame span', () => {
    expect(entry.ticks).toBe(run.stateOff.length - 1)
  })
  test('the declared histogram never wears a voice glyph (it is pure {kind: count} integers)', () => {
    for (const [k, c] of Object.entries(entry.kinds)) {
      expect(Number.isInteger(Number(k))).toBe(true)
      expect(Number.isInteger(c) && c > 0).toBe(true)
    }
  })
  test('no run declares a supersedes_plan_id today (surfaced only if a manifest carries one)', () => {
    expect(entry.supersedesPlanId).toBeUndefined()
  })
})

// The sim-clock carried review item: the three published runs pin dt_us === 125000 EXACTLY —
// 96 ticks × 125000µs = 12.0s of real sim time. det-only e0/f1 declare no dtUs (they keep the assumed
// voice); f0's dtUs equals the playback assumption (1000) so it too keeps the assumed voice.
describe('index metadata: real sim-clock dt', () => {
  test.each(PUBLISHED)('$id declares dtUs === 125000', ({ id }) => {
    expect(index.find(e => e.id === id)!.dtUs).toBe(125000)
  })
  test('e0 and f1 (det-only) declare no dtUs — no false real-clock claim', () => {
    expect(index.find(e => e.id === 'e0')!.dtUs).toBeUndefined()
    expect(index.find(e => e.id === 'f1')!.dtUs).toBeUndefined()
  })
  test('f0 declares its real manifest dt (1000) which equals the playback assumption', () => {
    expect(index.find(e => e.id === 'f0')!.dtUs).toBe(1000)
  })
})

// ── CERTIFICATION WALL RIDER — the f3a ROBUST prohibition ──────────────────
// The vendored f3a_seed42 is the CORRECT single-target-track campaign (case ff4b6a1f…, pins_record
// EXP-F3a-correct.json — it certifies track CONSISTENCY, not statistical acceptance). The ROBUST
// 50-seed statistical acceptance is a DIFFERENT bundle (case 0b82614b…, EXP-F3a-robust.json): same
// seed number, two campaigns (byte-verified 2026-07-09; both cases re-pinned at the v9
// contract flip per D-002 — a schema bump re-pins every identity). The published f3a card/entry
// must NEVER carry the ROBUST wordmark, and the bytes we shipped must be the correct campaign — not
// the robust sidecar.
describe('f3a is the CORRECT campaign and carries no ROBUST wordmark', () => {
  const F3A_CORRECT_CASE = 'ff4b6a1f002ca2f2df5406d72bccd76d53dd4601e0921f491dff6b7d19f08299'
  const F3A_ROBUST_CASE_PREFIX = '0b82614b' // the v9 robust sidecar seed-42 row we must NOT have shipped
  const anchor = json<IdentityAnchor>('contract/fixtures/f3a_seed42/IDENTITY.json')
  const entry = index.find(e => e.id === 'f3a')!

  test('the published f3a is case ff4b6a1f (correct), never 0b82614b (robust sidecar)', () => {
    expect(anchor.case_id).toBe(F3A_CORRECT_CASE)
    expect(anchor.case_id.startsWith(F3A_ROBUST_CASE_PREFIX)).toBe(false)
    expect(foldAndVerify(bytes('public/runs/f3a/bundle.det')).caseIdHex).toBe(F3A_CORRECT_CASE)
    expect(parseManifest(text('public/runs/f3a/manifest.json')).caseId).toBe(F3A_CORRECT_CASE)
  })
  test('the f3a IDENTITY pins the CORRECT record, not the robust one', () => {
    expect(anchor.pins_record).toMatch(/F3a-correct/i)
    expect(anchor.pins_record).not.toMatch(/robust/i)
  })
  // Every KAT sidecar's cited authority is pinned by NAME — a sidecar citing a record that does not
  // exist upstream is a dead re-verification pointer (an auditor following it hits nothing). The
  // exists-at-source check runs at vendor time; THIS pin stops a mistyped/invented record name from
  // riding a future drop through CI unnoticed.
  test('every KAT sidecar cites its experiment\'s -correct evidence record by exact name', () => {
    for (const [id, record] of [['f2a', 'EXP-F2a-correct'], ['f3a', 'EXP-F3a-correct'], ['f4', 'EXP-F4-correct']] as const) {
      const a = json<IdentityAnchor>(`contract/fixtures/${id}_seed42/IDENTITY.json`)
      expect(a.pins_record).toBe(`roadmap/evidence/${record}.json`)
    }
  })
  test('the f3a index entry carries no robust / statistical-acceptance wordmark', () => {
    for (const value of Object.values(entry))
      if (typeof value === 'string') expect(value).not.toMatch(PROFILE_CONFLATION_RE)
  })
  test('no published run entry anywhere carries the profile-conflation wordmark (index is not a smuggling channel)', () => {
    expect(text('public/runs/index.json')).not.toMatch(PROFILE_CONFLATION_RE)
  })
})

// THE GENERATOR BYTE-IDENTITY GATE. serializeIndex (tools/runIndex.mjs) OWNS public/runs/index.json;
// this pins committed bytes === generator output, so a hand edit, a stale regeneration, or an order
// change that bypasses the generator fails HERE. (This property was verified by execution in review
// twice before it was bound as a test — a cited-but-unwritten gate is folklore, not a gate.)
test('committed index.json is byte-identical to serializeIndex() (the generator owns the file)', async () => {
  const { serializeIndex } = await import('../tools/runIndex.mjs')
  expect(text('public/runs/index.json')).toBe(serializeIndex())
})

// ── the trusted run catalog agrees with the generated index — EXACT key-set equality (drift gate) ──
// runCatalog.ts pins the load plan (base + manifest policy) IN THE APP BUNDLE; index.json is discovery only.
// The two are separate lists, so a run added/reordered in one but not the other would diverge silently — this
// gate (the byte-identity gate's sibling) fails if the two id sets are not EXACTLY equal, or if any published
// index entry is not a certified catalog citizen with the SAME base and the SAME manifest policy.
//   This gate was strengthened from SUBSET (index ⊆ catalog) to EXACT equality (index = catalog): the prior gate
// caught an index entry with no catalog pin, but NOT a catalog citizen with no index entry (a run pinned in the
// app bundle that the front door never lists) — the reverse divergence. Exact key-set equality closes both.
test('the catalog id set and the published index id set are EXACTLY equal (no divergence in either direction)', () => {
  const index = json<RunEntry[]>('public/runs/index.json')
  const catalogIds = [...Object.keys(RUN_CATALOG)].sort()
  const indexIds = index.map(e => e.id).sort()
  expect(indexIds, 'every catalog citizen is published AND every published id is a catalog citizen').toEqual(catalogIds)
})
test('every published index entry is a certified catalog citizen with matching base + manifest policy', () => {
  const catalogIndex = json<RunEntry[]>('public/runs/index.json')
  for (const entry of catalogIndex) {
    const plan = resolveLoadPlan(entry.id)
    expect(plan, `index id '${entry.id}' must resolve to a load plan`).not.toBeNull()
    expect(plan!.certified, `index id '${entry.id}' must be pinned in RUN_CATALOG`).toBe(true)
    expect(plan!.base, `catalog base for '${entry.id}'`).toBe(entry.base)
    // det-only in the index ⟺ manifest NOT required in the catalog (no silent det-only↔manifest divergence).
    expect(plan!.manifestRequired, `manifest policy for '${entry.id}'`).toBe(entry.detOnly !== true)
  }
})

// ── THE ROBUST-F3A CAMPAIGN DRIFT GATE (catalog ⇄ vendored manifest ⇄ vendored bytes) ─────────────────
// The campaign vendored 50 bundle.det + a campaign-manifest.json into public/campaigns/robust-f3a/, and pinned
// the plan_id + 50 per-seed {case_id, result_id, sha256} IN THE APP BUNDLE (campaignCatalog.ts — the authority;
// the fetched manifest is discovery only, the index-is-not-authority lesson at birth). These three artifacts must agree exactly, or
// a consumer could verify a seed against forged pins. This gate closes all three seams: the in-bundle catalog
// vs the vendored manifest rows, and (spot-check) the catalog pins vs the ACTUAL vendored bundle bytes — the
// same publish-time byte contract the single-run runs get above, at campaign scale.
interface CampaignManifest {
  verdict_pointer: { plan_id: string; verdict_level: number; verdict_level_name: string; n_seeds: number; attempts_per_variant: number }
  seeds: { count: number; index: { seed: number; case_id: string; result_id: string; bundle_det_sha256: string; bundle_det_len: number }[] }
}

describe('robust-f3a campaign: the vendored manifest is present and well-formed', () => {
  const man = json<CampaignManifest>('public/campaigns/robust-f3a/campaign-manifest.json')
  test('the vendored manifest indexes 50 seeds (42..91)', () => {
    expect(man.seeds.count).toBe(50)
    expect(man.seeds.index).toHaveLength(50)
    expect(man.seeds.index.map(r => r.seed)).toEqual(Array.from({ length: 50 }, (_, i) => 42 + i))
  })
  test('the catalog header agrees with the manifest verdict_pointer (plan_id, verdict, n_seeds)', () => {
    expect(ROBUST_F3A.planId).toBe(man.verdict_pointer.plan_id)
    expect(ROBUST_F3A.verdictLevel).toBe(man.verdict_pointer.verdict_level)
    expect(ROBUST_F3A.verdictLevelName).toBe(man.verdict_pointer.verdict_level_name)
    expect(ROBUST_F3A.nSeeds).toBe(man.verdict_pointer.n_seeds)
    expect(ROBUST_F3A.attemptsPerVariant).toBe(man.verdict_pointer.attempts_per_variant)
  })
})

describe('robust-f3a campaign: catalog pins ⇄ vendored manifest rows (exact, all 50)', () => {
  const man = json<CampaignManifest>('public/campaigns/robust-f3a/campaign-manifest.json')
  const rowBySeed = new Map(man.seeds.index.map(r => [r.seed, r]))
  test.each(ROBUST_F3A.seeds.map(s => s.seed))('seed %d: catalog pin === manifest row', (seed) => {
    const pin = ROBUST_F3A.seeds.find(s => s.seed === seed)!
    const row = rowBySeed.get(seed)!
    expect(pin.caseId).toBe(row.case_id)
    expect(pin.resultId).toBe(row.result_id)
    expect(pin.sha256).toBe(row.bundle_det_sha256)
    expect(pin.len).toBe(row.bundle_det_len)
  })
})

describe('robust-f3a campaign: catalog pins ⇄ ACTUAL vendored bundle bytes (all 50)', () => {
  test.each(ROBUST_F3A.seeds.map(s => s.seed))('seed %d: vendored bundle.det matches its pinned sha256 + length', (seed) => {
    const pin = ROBUST_F3A.seeds.find(s => s.seed === seed)!
    const det = bytes(`public/campaigns/robust-f3a/${seed}/bundle.det`)
    expect(sha256(det)).toBe(pin.sha256)
    expect(det.byteLength).toBe(pin.len)
  })
  // A fold spot-check: an independent re-fold of the vendored bytes recovers the pinned identity (the
  // decode-verify ritual) for a spread of seeds — the campaign analogue of the single-run re-fold above.
  test.each([42, 46, 65, 84, 91])('seed %d: re-folded case_id/result_id recover the pinned identity', (seed) => {
    const pin = ROBUST_F3A.seeds.find(s => s.seed === seed)!
    const v = foldAndVerify(bytes(`public/campaigns/robust-f3a/${seed}/bundle.det`))
    expect(v.caseIdHex).toBe(pin.caseId)
    expect(v.resultIdHex).toBe(pin.resultId)
    expect(v.matchesTrailer).toBe(true)
  })
})

// ── THE GAUGE DRIFT GATE (the Wall's statistical instrument reads the vendored manifest) ───────────────
// The Wall renders the aggregate ROBUST verdict — NEES/NIS statistics + their precommitted critical bounds —
// from the vendored campaign-manifest.json (the certifier's verdict.det is a distinct binary format the app's
// frames/payloads infrastructure does not decode; the honest source is the drift-gated sidecar). NOTHING
// statistical is hand-hardcoded in source: this gate pins the gauge model parseCampaignGauges yields against
// the vendored bytes, so an edit that broke the members, the pass, or the pinned critical bits fails HERE.
interface GaugeManifest {
  schema: string
  profile: string
  verdict_pointer: { plan_id: string }
  statistical_pointer: { verdict_schema_version: number; member_count: number; members: { test_id: number; kind: string; statistic: string; pass: boolean }[] }
  test_params_echo: { members: { test_id: number; dof: number; alpha_ppm: number; critical_lo_bits: string; critical_hi_bits: string }[] }
}

// THE PRECOMMITTED LITERALS (the fix for the CIRCULAR gate). The old gate decoded the manifest's own
// critical bits and compared them to THEMSELVES (`g.criticalLo === f64FromHexBits(p.critical_lo_bits)`): editing
// the manifest moved BOTH sides, so nothing pinned the precommit and a skewed bound sailed through (the mutation
// test below proves the old gate passed a nibble flip). These are the four bound bit-strings + the
// statistic-relevant params, captured ONCE from the certified gate run — the verified values; the
// current vendored manifest IS that certified drop, so the bits were read from it once and FROZEN here as
// literals. The gate compares them against the manifest AND against parseCampaignGauges' decoded output, so a
// future manifest edit that drifts a bound away from the precommit fails against a fixed literal, not a copy.
//
// TWO PIN LAYERS, THREE INDEPENDENT WITNESSES. There are now two places the certified tuple is pinned:
//   1. campaignCatalog.ts — the RUNTIME authority. parseCampaignGauges rejects any FETCHED value that differs
//      from it, so a tampered/stale MANIFEST alone can never reach the Wall (the catalog guards the user).
//   2. PINNED_GAUGES here — an INDEPENDENT CI literal copy that imports neither the catalog nor the manifest.
// The layers are deliberately NOT shared: because the runtime check is fetch === catalog, a COORDINATED edit that
// forged BOTH the catalog AND the vendored manifest to agree would pass at runtime. These frozen literals are the
// third witness that pair cannot move — the gate below pins catalog ⇄ literals AND manifest ⇄ literals AND
// parseCampaignGauges-output ⇄ literals, so all three must agree with the precommit or CI fails (the gate guards
// the catalog). Keep PINNED_GAUGES hand-frozen; do NOT refactor it to read from campaignCatalog.ts (that would
// collapse the third witness back into the pair it exists to catch).
const PINNED_GAUGES = {
  CHI2_NEES: {
    testId: 2, dof: 200, alphaPpm: 25000, statistic: '212.57017224319395', pass: true,
    loBits: '4063bc0da9d80e2d', hiBits: '406eef7b64db220a',
    criticalLo: 157.87666790197673, criticalHi: 247.48381274032027,
  },
  CHI2_NIS: {
    testId: 3, dof: 100, alphaPpm: 25000, statistic: '93.21421605417723', pass: true,
    loBits: '4051c0e6fdc9bc29', hiBits: '4060caeecd55fdf4',
    criticalLo: 71.01409859371837, criticalHi: 134.34165064616502,
  },
} as const

describe('gauge drift gate: the Wall gauge model decodes from the vendored, pinned manifest', () => {
  const man = json<GaugeManifest>('public/campaigns/robust-f3a/campaign-manifest.json')
  const model = parseCampaignGauges(man, ROBUST_F3A)
  const gauges = model.ok ? model.members : []

  test('the vendored manifest VALIDATES as this campaign (fail-closed parse ok) with the two certified members', () => {
    expect(model.ok).toBe(true)
    expect(gauges.map(g => g.kind).sort()).toEqual(['CHI2_NEES', 'CHI2_NIS'])
    for (const g of gauges) expect(g.pass).toBe(true)
  })
  test('each certified statistic sits STRICTLY inside its precommitted band (the pass is real, not asserted)', () => {
    for (const g of gauges) {
      expect(g.criticalHi).toBeGreaterThan(g.criticalLo)
      expect(g.statistic).toBeGreaterThan(g.criticalLo)
      expect(g.statistic).toBeLessThan(g.criticalHi)
      expect(g.position).toBeGreaterThan(0)
      expect(g.position).toBeLessThan(1)
    }
  })
  test('the pinned bit-strings decode to the pinned bounds (the literals are internally self-consistent)', () => {
    for (const g of Object.values(PINNED_GAUGES)) {
      expect(f64FromHexBits(g.loBits)).toBe(g.criticalLo)
      expect(f64FromHexBits(g.hiBits)).toBe(g.criticalHi)
    }
  })
  test('the CATALOG stat pins EQUAL the independent precommit literals (catches a coordinated catalog+manifest edit)', () => {
    // Layer 1 (campaignCatalog.ts) is the runtime authority parseCampaignGauges enforces against the fetch; this
    // gate pins that authority itself to the frozen third-witness literals, so a catalog value edited in lock-step
    // with the manifest (which the runtime fetch === catalog check would wave through) still fails HERE.
    const specByTestId = new Map(ROBUST_F3A.stat.members.map(s => [s.testId, s]))
    for (const [kind, g] of Object.entries(PINNED_GAUGES)) {
      const s = specByTestId.get(g.testId)!
      expect(s.kind).toBe(kind)
      expect(s.statistic).toBe(g.statistic)
      expect(s.pass).toBe(g.pass)
      expect(s.dof).toBe(g.dof)
      expect(s.alphaPpm).toBe(g.alphaPpm)
      expect(s.loBits).toBe(g.loBits)
      expect(s.hiBits).toBe(g.hiBits)
      expect(s.sidedness).toBe('TWO') // PINNED_GAUGES carries no sidedness; the catalog pins the raw token
    }
  })
  test('the vendored manifest bits + params MATCH the precommitted LITERALS (not a copy of themselves)', () => {
    const paramByTestId = new Map(man.test_params_echo.members.map(p => [p.test_id, p]))
    const statByTestId = new Map(man.statistical_pointer.members.map(s => [s.test_id, s]))
    for (const [kind, g] of Object.entries(PINNED_GAUGES)) {
      const p = paramByTestId.get(g.testId)!
      expect(p.critical_lo_bits).toBe(g.loBits)
      expect(p.critical_hi_bits).toBe(g.hiBits)
      expect(p.dof).toBe(g.dof)
      expect(p.alpha_ppm).toBe(g.alphaPpm)
      const s = statByTestId.get(g.testId)!
      expect(s.kind).toBe(kind)
      expect(s.statistic).toBe(g.statistic)
      expect(s.pass).toBe(g.pass)
    }
  })
  test('parseCampaignGauges output MATCHES the precommitted literals (the decode path is pinned to the precommit)', () => {
    expect(model.ok).toBe(true)
    for (const g of gauges) {
      const pin = PINNED_GAUGES[g.kind as keyof typeof PINNED_GAUGES]
      expect(pin, `unexpected gauge kind ${g.kind}`).toBeTruthy()
      expect(g.criticalLo).toBe(pin.criticalLo)
      expect(g.criticalHi).toBe(pin.criticalHi)
      expect(g.dof).toBe(pin.dof)
      expect(g.statisticText).toBe(pin.statistic)
      expect(g.pass).toBe(pin.pass)
    }
  })
  test('MUTATION: flipping one hex nibble in a synthetic manifest copy fails the gate (the OLD circular gate passed it)', () => {
    // Deep-clone the vendored manifest and flip ONE nibble of the NEES lower-bound bits. The OLD gate decoded
    // the mutated bits and compared them to the mutated manifest's OWN bits — equal, so it PASSED the tamper.
    // The literal pin catches it: the mutated bits no longer equal the precommit, and the decoded bound no
    // longer equals the precommitted double (a self-comparison would have moved WITH the mutation).
    const mutated = JSON.parse(JSON.stringify(man)) as GaugeManifest
    const neesParams = mutated.test_params_echo.members.find(p => p.test_id === 2)!
    const orig = neesParams.critical_lo_bits
    const flipped = orig.slice(0, -1) + (orig.endsWith('d') ? 'c' : 'd')
    expect(flipped).not.toBe(orig)
    neesParams.critical_lo_bits = flipped
    // Arm 1 — the manifest bits no longer equal the precommitted literal.
    expect(neesParams.critical_lo_bits).not.toBe(PINNED_GAUGES.CHI2_NEES.loBits)
    // Arm 2 — the decode path yields a bound that is NOT the precommitted double.
    const mutatedModel = parseCampaignGauges(mutated, ROBUST_F3A)
    if (mutatedModel.ok) {
      const nees = mutatedModel.members.find(g => g.kind === 'CHI2_NEES')!
      expect(nees.criticalLo).not.toBe(PINNED_GAUGES.CHI2_NEES.criticalLo)
    }
    // (A larger flip that pushed the bound past the statistic would instead fail-close mutatedModel.ok=false —
    // also a catch; the point is the precommit no longer moves with the manifest.)
  })
})

// ── THE WALL ROBUST-WORDMARK RIDER (the two entities never conflate) ────────────────
// The Certification Wall IS the ROBUST campaign and NAMES it correctly (its catalog-sourced header wears the
// robust wordmark). The correct-profile f3a RUN is a DIFFERENT entity that must never carry it. This rider
// pins BOTH directions so the tripwire cannot be satisfied by scrubbing the wordmark off the surface that
// SHOULD carry it: the campaign catalog carries robust; the f3a run entry does not.
describe('Wall rider: the Wall names ROBUST; the f3a run surfaces never do (no conflation)', () => {
  test('the campaign catalog carries the ROBUST wordmark — the Wall names its own campaign', () => {
    expect(ROBUST_F3A.campaignId).toMatch(PROFILE_CONFLATION_RE)
    expect(ROBUST_F3A.verdictLevelName).toMatch(PROFILE_CONFLATION_RE)
  })
  test('the correct-profile f3a run entry still carries NO robust wordmark (the tripwire holds)', () => {
    const f3a = index.find(e => e.id === 'f3a')!
    for (const value of Object.values(f3a))
      if (typeof value === 'string') expect(value).not.toMatch(PROFILE_CONFLATION_RE)
  })
})
