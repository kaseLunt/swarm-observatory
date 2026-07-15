import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { foldAndVerify } from './decode/verify'
import { decodeBundle } from './decode/decodeBundle'
import { gateManifest, parseManifest, type Identity } from './decode/manifest'
import { resolveLoadPlan, RUN_CATALOG } from './decode/runCatalog'
import { PROFILE_CONFLATION_RE } from './ui/hangar'
import identity from '../contract/identity.json'

// The v0.6 publication window (task v06-T5a). The three v8-certified KAT fixtures (f2a/f3a/f4
// seed-42) are published to public/runs/ as FULL-manifest runs and named in index.json. This suite
// is the house's publication gate: the byte contract must hold end to end — the vendored fixture
// bytes == the published bytes == the sha256 pinned in <fixture>/IDENTITY.json — and an independent
// re-fold of the PUBLISHED bytes must recover the pinned identity before anything ships. The house
// never publishes unverified bytes. The T5 RIDER BLOCK (D4 Certification Wall consult) f3a robust
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

// ── T5b: DECLARED index metadata proven against the real decoder (declared-vs-decoded) ───────────
// The Hangar renders index.json's declared `kinds` histogram + `ticks` without decoding anything; the
// declaration is publish-time metadata (tools/runIndex.mjs). Here the REAL decoder re-derives both from
// the published bytes and the declaration must match EXACTLY — the two-voice split D4 Part 6.2 names:
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

// The sim-clock (T5c) carried review item: the three published runs pin dt_us === 125000 EXACTLY —
// 96 ticks × 125000µs = 12.0s of real sim time. det-only e0/f1 declare no dtUs (they keep the assumed
// voice); f0's dtUs equals the playback assumption (1000) so it too keeps the assumed voice.
describe('index metadata: real sim-clock dt (T5c)', () => {
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

// ── T5 RIDER BLOCK (D4 Certification Wall consult) — the f3a ROBUST prohibition ──────────────────
// The vendored f3a_seed42 is the CORRECT single-target-track campaign (case ff4b6a1f…, pins_record
// EXP-F3a-correct.json — it certifies track CONSISTENCY, not statistical acceptance). The ROBUST
// 50-seed statistical acceptance is a DIFFERENT bundle (case 0b82614b…, EXP-F3a-robust.json): same
// seed number, two campaigns (controller byte-verified 2026-07-09; both cases re-pinned at the v9
// contract flip per D-002 — a schema bump re-pins every identity). The published f3a card/entry
// must NEVER carry the ROBUST wordmark, and the bytes we shipped must be the correct campaign — not
// the robust sidecar.
describe('T5 rider: f3a is the CORRECT campaign and carries no ROBUST wordmark', () => {
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

// ── H1/F2: the trusted run catalog agrees with the generated index — EXACT key-set equality (drift gate) ──
// runCatalog.ts pins the load plan (base + manifest policy) IN THE APP BUNDLE; index.json is discovery only.
// The two are separate lists, so a run added/reordered in one but not the other would diverge silently — this
// gate (the byte-identity gate's sibling) fails if the two id sets are not EXACTLY equal, or if any published
// index entry is not a certified catalog citizen with the SAME base and the SAME manifest policy.
//   F2 strengthened this from SUBSET (index ⊆ catalog) to EXACT equality (index = catalog): the prior gate
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
