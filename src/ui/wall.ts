import type { SeedPhase, CampaignRollup } from '../state/campaignStore'
import type { CampaignCatalog } from '../decode/campaignCatalog'
import type { MarkKey } from './voices'

// ── THE CERTIFICATION WALL — pure view-model (v0.8 W5) ──────────────────────────────────────────────────
// The presentation-free half of the Wall: census math, the seed phase→voice mapping, and the aggregate
// gauge model decoded from the vendored campaign manifest. No React, no DOM — every function here is a
// total map from campaign FACTS (the campaignStore rollup / phase, the vendored manifest bytes) to the
// display data wallView.tsx renders. Unit-pinned in wall.test.ts where the honesty rules can be held.
//
// THE VOICE DISCIPLINE (D4 Rulings 1/5, the amended-consult RAIL 1): green is a receipt. A seed wears
// integrity `verified` ONLY on the store's evidence-derived 'verified' phase (recomputed AND matched THIS
// session); until then it rests in the ATTESTED voice (• on record — the catalog pins ARE the on-record
// claim). A fetch FAILURE ('error' phase) is the AVAILABILITY voice — the no-verdict `unverifiable` mark
// (?), NEVER the integrity ✗ (mismatch): absence of evidence is not contradiction (the W4 store fought
// nine rounds to keep the 'error' bucket distinct from integrity mismatch — this mapping must not blur it).
// Glyphs are resolved from the ONE voices module at render (never a literal here); this file names the
// MarkKey, so the seven-mark alphabet stays single-sourced.

// ── SEED PHASE → VOICE ──────────────────────────────────────────────────────────────────────────────────
// The store's per-seed phase → the mark it wears + a wall-local class + an honest one-word label. `cls`
// carries the sanctioned voice class (verified/attested/mismatch/unverifiable — all VOICE_CLASSES members)
// plus, for a dispatched seed, the `running` STATE modifier (an in-flight posture, not an eighth voice —
// the dot stays attested •, only its treatment says "in flight").
export interface SeedVoice {
  readonly markId: MarkKey
  readonly cls: string
  readonly label: string
}

export function seedVoice(phase: SeedPhase): SeedVoice {
  switch (phase) {
    case 'pending':  return { markId: 'attested',     cls: 'attested',         label: 'on record' }
    case 'running':  return { markId: 'attested',     cls: 'attested running', label: 'verifying' }
    case 'verified': return { markId: 'verified',     cls: 'verified',         label: 'recomputed this session' }
    case 'mismatch': return { markId: 'mismatch',     cls: 'mismatch',         label: 'contradicted' }
    // AVAILABILITY, not integrity: a fetch failure could not FORM the check (a missing basis), so it wears
    // the no-verdict `unverifiable` ? — never the ✗ that means "a pin disagreed". Visually dim, never a
    // verdict hue (the two-family law), and provably distinct from mismatch (asserted in wall.test.ts).
    case 'error':    return { markId: 'unverifiable', cls: 'unverifiable',     label: 'unavailable — not verified this session' }
  }
}

// ── THE CENSUS (exact integers — the headline that separates an instrument from marketing) ──────────────
// No percentages, no rings, no rounding: integers are the honest unit of verification (D4 Ruling 1). The
// line reads well ALOUD — it IS the reduced-motion narration (aria-live), so it names the earned count, the
// on-record total, and the contradicted count, appending an availability count only when a fetch has failed.
//
// F4 — THE NUMERATOR IS "recomputed AND matched", not "recomputed". Every CONTRADICTED seed ALSO ran a full
// in-browser recompute (that recompute is exactly what produced the ✗) — so "48 of 50 recomputed here · 2
// contradicted" is a lie of omission: it implies only 48 were recomputed when in truth all 50 that reached a
// verdict were, 48 matching and 2 disagreeing. The leading count is the count of clean receipts (the green ✓s
// the field lights), so the honest label is "recomputed and matched": it names precisely what that number is
// (recomputed AND agreed), leaving `contradicted` as the recomputed-but-disagreed subset callout. This keeps
// the headline from burying two red contradictions under a reassuring "50 of 50 recomputed" (the more honest of
// the finding's two options for this surface, whose whole ethos is to never overclaim).
export interface CensusModel {
  readonly recomputedAndMatched: number  // sessions ✓ — recomputed THIS session AND matched (the evidence-derived 'verified')
  readonly onRecord: number        // the pinned total (the catalog's on-record claim)
  readonly contradicted: number    // integrity ✗ — recomputed this session, a pin DISAGREED (also a full recompute)
  readonly unavailable: number      // availability ? — a fetch failed (never counted as contradicted)
}

export function censusModel(rollup: CampaignRollup): CensusModel {
  return {
    recomputedAndMatched: rollup.verified,
    onRecord: rollup.total,
    contradicted: rollup.mismatched,
    unavailable: rollup.error,
  }
}

// The census as one sentence — the surface's opening declaration of what it has NOT verified. `unavailable`
// is appended only when > 0 (a clean campaign never invents an availability clause to explain).
export function censusLine(rollup: CampaignRollup): string {
  const c = censusModel(rollup)
  const base = `${c.recomputedAndMatched} of ${c.onRecord} recomputed and matched here · ${c.onRecord} on record · ${c.contradicted} contradicted`
  return c.unavailable > 0 ? `${base} · ${c.unavailable} unavailable` : base
}

// ── THE AGGREGATE GAUGES — the campaign's statistical verdict, decoded HONESTLY ─────────────────────────
// The engine's ROBUST verdict lives in the certified aggregate bundle; its verdict.det is a DIFFERENT binary
// format from the run bundle (DETBNDL1) that the app's frames/payloads infrastructure decodes, so it is NOT
// in-browser decodable with reasonable effort (verdict-decode filed as a named carry in the W5 report). The
// honest source is the vendored, drift-gated campaign-manifest.json: it carries the certifier-recomputed
// members (statistic + pass) and the PRECOMMITTED critical bounds as pinned f64 BITS (the bearings-class
// discipline — pinned-bit display, NEVER a platform recompute). This module DECODES those bits to exact
// bounds; nothing statistical is hand-hardcoded — the numbers come from the vendored artifact or they do not
// appear. The gauge renders in the ATTESTED voice (• on record): it is the engine's verdict, not a session
// receipt (the wall's ✓s are the receipts). A future wave that recomputes NEES/NIS in-browser upgrades the
// gauge from • to a live ✓/✗; until then it is honestly on record.

// Decode 16 hex chars (8 bytes) as a BIG-ENDIAN IEEE-754 double — the pinned critical-bound format. Throws
// on a malformed width/charset so a corrupted pin fails loud rather than rendering NaN as a bound.
export function f64FromHexBits(hex: string): number {
  const clean = hex.trim().toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(clean)) throw new Error(`f64FromHexBits: expected 16 lowercase hex chars, got ${JSON.stringify(hex)}`)
  const view = new DataView(new ArrayBuffer(8))
  for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(clean.slice(i * 2, i * 2 + 2), 16))
  return view.getFloat64(0, false) // big-endian, matching the certifier's pinned-bits emission
}

export interface GaugeMember {
  readonly kind: string            // 'CHI2_NEES' — the certifier's test kind
  readonly label: string           // 'NEES' — the compact display name
  readonly statistic: number       // the certifier-recomputed aggregate statistic (numeric, for the band tick)
  readonly statisticText: string   // full-precision text exactly as pinned (displayed verbatim, never re-rounded)
  readonly pass: boolean           // the certified pass/fail decision (statistical, not byte-integrity)
  readonly dof: number
  readonly alphaPpm: number
  readonly alphaPct: string        // alpha as a percent ("2.5%") — display convenience, derived from ppm
  readonly sidedness: string       // "two-sided" — spelled from the pinned "TWO"
  readonly criticalLo: number      // decoded from critical_lo_bits (exact display of pinned bits)
  readonly criticalHi: number      // decoded from critical_hi_bits
  readonly position: number        // (statistic − lo) / (hi − lo), clamped [0,1] — the tick's place in the band
}

const SIDEDNESS: Readonly<Record<string, string>> = { TWO: 'two-sided', ONE: 'one-sided' }
const SHORT_KIND: Readonly<Record<string, string>> = { CHI2_NEES: 'NEES', CHI2_NIS: 'NIS' }

// The RAW `<key>.members` array off a JSON value — the ARRAY ITSELF (never filtered), or null when the shape is
// absent. F2: the old reader SILENTLY DROPPED any non-object row (a `.filter(...)`), so a malformed or duplicate
// row vanished instead of failing the block; the atomic validator below needs EVERY raw element so it can reject
// a wrong count / a malformed row / a duplicate id rather than paper over them.
function rawMembers(v: unknown, key: string): unknown[] | null {
  if (typeof v !== 'object' || v === null) return null
  const block = (v as Record<string, unknown>)[key]
  if (typeof block !== 'object' || block === null) return null
  const members = (block as Record<string, unknown>).members
  return Array.isArray(members) ? members : null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null)

// The parse RESULT is a discriminated union (W5 F3): the gauges either decode WHOLE (every member validated)
// or the whole block is UNVERIFIABLE with a reason. There is no partial success — a surface that renders "some
// of the campaign's verdict" from a manifest whose identity or shape it could not confirm is exactly the
// fail-open lie this closes. `ok:false` drives the '?' unverifiable voice + the reason line; NEVER a mystery row.
export type GaugeModel =
  | { readonly ok: true; readonly members: readonly GaugeMember[] }
  | { readonly ok: false; readonly reason: string }

const invalid = (reason: string): GaugeModel => ({ ok: false, reason })

// Parse the vendored manifest into the gauge model — FAIL-CLOSED, ATOMIC, and PINNED (W5 F3 + F2 + F1). The old
// parse joined by test_id ONLY, silently DROPPED any member it could not fully read, accepted a +Infinity upper
// bound (lo < hi is true for +Infinity), TRUSTED whatever statistic/pass/dof/bound the sidecar declared, and
// never checked the manifest's identity — so a tampered/stale/truncated sidecar rendered partial, wrong-band,
// false-pass, or wholly fabricated rows under the campaign header. Now EVERY invariant is a gate that fails the
// WHOLE block, and the in-bundle `cat` is the AUTHORITY the fetched sidecar is checked against value-for-value:
//   • identity — schema family, profile, and plan_id must name THIS campaign (a sidecar for another campaign,
//     or a re-pointed one, is not our verdict);
//   • shape — the StatResultBlock schema version, the EXACT member count, UNIQUE test_ids, and each member's
//     kind matching the certified test_id ⇄ kind pin (no dropped, extra, duplicated, or mis-kinded member);
//   • params atomicity (F2) — the RAW test_params_echo array is validated WHOLE before any map is built: exact
//     row count, every row well-formed, test_ids the EXACT expected set (unique, no extras), kind per id — so a
//     malformed/duplicate/wrong-kind row can no longer be silently dropped or overwrite a real one and still ok;
//   • certified tuple (F1) — statistic, pass, dof, alpha, sidedness, and BOTH bound bit-strings must byte-match
//     the catalog pin; the render is CATALOG truth CONFIRMED by the fetch, never raw fetch truth;
//   • bounds — both critical bits decode to FINITE doubles with lo < hi (a +Infinity upper is rejected here);
//   • consistency — pass ⟺ the statistic sits STRICTLY inside its band (a lying pass flag cannot ride through).
// ANY violation → one `ok:false` with a human reason; the surface then renders ONE unverifiable state, never a
// partial gauge. On success EVERY member equals the certified pin, so the render is all-or-nothing honest.
export function parseCampaignGauges(manifest: unknown, cat: CampaignCatalog): GaugeModel {
  const m = obj(manifest)
  if (m === null) return invalid('manifest is not an object')

  // IDENTITY — the fetched sidecar must name THIS campaign; the in-bundle catalog is the authority.
  const schema = str(m.schema)
  if (schema === null || !schema.startsWith(cat.stat.schemaPrefix)) return invalid(`unexpected manifest schema (want ${cat.stat.schemaPrefix}…)`)
  if (str(m.profile) !== cat.profile) return invalid(`profile mismatch (want ${cat.profile})`)
  const vp = obj(m.verdict_pointer)
  if (vp === null || str(vp.plan_id) !== cat.planId) return invalid('plan_id does not match the pinned campaign')

  // STATISTICAL BLOCK — present, right schema version, EXACT member count (declared AND actual).
  const sp = obj(m.statistical_pointer)
  if (sp === null) return invalid('statistical_pointer is absent')
  if (num(sp.verdict_schema_version) !== cat.stat.verdictSchemaVersion) return invalid('unexpected verdict_schema_version')
  const statMembers = Array.isArray(sp.members) ? sp.members : null
  if (statMembers === null) return invalid('statistical_pointer.members is not an array')
  const expectedCount = cat.stat.members.length
  if (num(sp.member_count) !== expectedCount || statMembers.length !== expectedCount) return invalid(`expected exactly ${expectedCount} statistical members`)

  // ── PARAMS ECHO — validated ATOMICALLY as a WHOLE before any lookup map is built (F2) ─────────────────────
  // The old code did rawMembers(...).filter (silently dropping malformed rows) then Map.set per row: a DUPLICATE
  // test_id row overwrote the real row's dof/bits (last write wins), and no count / id-set / kind check ran — so
  // a duplicate wrong-kind row could OVERRIDE a field and STILL return ok:true. Now the raw array is gated whole:
  // the EXACT expected row count, every row a well-formed object, each test_id a certified member (UNIQUE, no
  // extras), and each row's kind matching its id. Only a fully-valid array yields the lookup map.
  const specByTestId = new Map(cat.stat.members.map(s => [s.testId, s]))
  const rawParams = rawMembers(manifest, 'test_params_echo')
  if (rawParams === null) return invalid('test_params_echo.members is not an array')
  if (rawParams.length !== expectedCount) return invalid(`expected exactly ${expectedCount} test_params_echo rows`)
  const paramByTestId = new Map<number, Record<string, unknown>>()
  for (const raw of rawParams) {
    const p = obj(raw)
    if (p === null) return invalid('a test_params_echo row is not an object')
    const id = num(p.test_id)
    if (id === null) return invalid('a test_params_echo row has no numeric test_id')
    const spec = specByTestId.get(id)
    if (spec === undefined) return invalid(`unexpected test_params_echo test_id ${id} (not a certified member)`)
    if (paramByTestId.has(id)) return invalid(`duplicate test_params_echo test_id ${id}`)
    if (str(p.kind) !== spec.kind) return invalid(`test_params_echo test_id ${id} kind mismatch (want ${spec.kind})`)
    paramByTestId.set(id, p)
  }
  // count === expected + every id a certified member + no duplicate ⟹ the id set is EXACTLY the certified set.

  // ── STATISTICAL MEMBERS — each validated against the certified tuple pin (F1) ─────────────────────────────
  const out: GaugeMember[] = []
  const seen = new Set<number>()
  for (const raw of statMembers) {
    const sm = obj(raw)
    if (sm === null) return invalid('a statistical member is not an object')
    const testId = num(sm.test_id)
    if (testId === null) return invalid('a statistical member has no numeric test_id')
    if (seen.has(testId)) return invalid(`duplicate test_id ${testId}`)
    seen.add(testId)
    const spec = specByTestId.get(testId)
    if (spec === undefined) return invalid(`unexpected test_id ${testId} (not a certified member)`)
    const kind = str(sm.kind)
    if (kind !== spec.kind) return invalid(`test_id ${testId} kind mismatch (want ${spec.kind})`)

    // The statistic + pass DECISION are pinned in the catalog — the sidecar may only ECHO them, never change
    // them (F1). A fetched value that differs (a fabricated statistic, a flipped pass) is rejected here, so the
    // gauge displays CATALOG truth confirmed by the fetch, never a coherent forgery the fetch could smuggle in.
    const statisticText = str(sm.statistic)
    if (statisticText === null) return invalid(`${kind} has no statistic`)
    if (statisticText !== spec.statistic) return invalid(`${kind} statistic does not match the certified pin`)
    const statistic = Number(statisticText)
    if (!Number.isFinite(statistic)) return invalid(`${kind} statistic is not finite`)
    const pass = typeof sm.pass === 'boolean' ? sm.pass : null
    if (pass === null) return invalid(`${kind} has no boolean pass`)
    if (pass !== spec.pass) return invalid(`${kind} pass does not match the certified pin`)

    const p = paramByTestId.get(testId)
    if (p === undefined) return invalid(`${kind} has no test_params_echo row`)
    const dof = num(p.dof)
    const alphaPpm = num(p.alpha_ppm)
    const loBits = str(p.critical_lo_bits)
    const hiBits = str(p.critical_hi_bits)
    if (dof === null || alphaPpm === null || loBits === null || hiBits === null) return invalid(`${kind} params echo is incomplete`)
    // dof / alpha / sidedness / BOTH bound bit-strings must byte-match the catalog pin (F1). The bounds are a
    // pinned-bit DISPLAY, so a skewed bound is caught as a bit-string mismatch BEFORE it is ever decoded.
    if (dof !== spec.dof) return invalid(`${kind} dof does not match the certified pin`)
    if (alphaPpm !== spec.alphaPpm) return invalid(`${kind} alpha does not match the certified pin`)
    if (str(p.sidedness) !== spec.sidedness) return invalid(`${kind} sidedness does not match the certified pin`)
    if (loBits !== spec.loBits) return invalid(`${kind} critical_lo_bits does not match the certified pin`)
    if (hiBits !== spec.hiBits) return invalid(`${kind} critical_hi_bits does not match the certified pin`)

    let criticalLo: number, criticalHi: number
    try { criticalLo = f64FromHexBits(loBits); criticalHi = f64FromHexBits(hiBits) } catch { return invalid(`${kind} has malformed critical bits`) }
    if (!Number.isFinite(criticalLo) || !Number.isFinite(criticalHi)) return invalid(`${kind} has a non-finite bound`)
    if (!(criticalLo < criticalHi)) return invalid(`${kind} bounds are not ordered (lo < hi)`)

    // pass ⟺ the statistic is STRICTLY in-band — a certified decision that contradicts its own numbers is a
    // corrupt verdict, not a renderable gauge. (With the tuple pinned above this is belt-and-suspenders, but it
    // keeps the in-band invariant local and total.)
    const inBand = statistic > criticalLo && statistic < criticalHi
    if (pass !== inBand) return invalid(`${kind} pass/band inconsistency (pass=${pass}, statistic in-band=${inBand})`)

    const position = Math.min(1, Math.max(0, (statistic - criticalLo) / (criticalHi - criticalLo)))
    out.push({
      kind, label: SHORT_KIND[kind] ?? kind, statistic, statisticText, pass, dof, alphaPpm,
      alphaPct: `${alphaPpm / 10000}%`,
      sidedness: SIDEDNESS[str(p.sidedness) ?? ''] ?? (str(p.sidedness) ?? ''),
      criticalLo, criticalHi, position,
    })
  }
  return { ok: true, members: out }
}

// ── THE GAUGE LOAD STATE (W5 F5) — the modal's per-open discriminated lifecycle ─────────────────────────────
// One retained gauges array used to conflate loading / fetch-failure / validation-failure / success into "empty
// or not". This names all four so the surface can render each honestly and CLEAR to `loading` on every open:
//   loading — the fetch is in flight (never show a prior open's gauges);
//   loaded  — the manifest validated (F3) → the decoded members;
//   failed  — the fetch itself failed (network / !ok) — an availability gap, the manifest "did not load";
//   invalid — the manifest fetched but FAILED validation (F3) → the '?' unverifiable voice + the reason.
export type GaugeLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly members: readonly GaugeMember[] }
  | { readonly kind: 'failed' }
  | { readonly kind: 'invalid'; readonly reason: string }

// Map a fetched manifest (or null on a fetch failure) to the load state via the fail-closed parse. Pure/total,
// so the modal's state transition is unit-testable without React.
export function gaugeLoadFromFetch(fetched: unknown, cat: CampaignCatalog): GaugeLoad {
  if (fetched === null || fetched === undefined) return { kind: 'failed' }
  const model = parseCampaignGauges(fetched, cat)
  return model.ok ? { kind: 'loaded', members: model.members } : { kind: 'invalid', reason: model.reason }
}

// ── THE SYNCHRONOUS STOP ROUTINE (W5 F5) — one idempotent teardown for every close path ─────────────────────
// The Wall's fetch-abort + queue-fence + store-reset were deferred to the effect's PASSIVE cleanup alone — a
// scheduling window in which an in-flight verify 'done' could still write the store AFTER close. This is the ONE
// routine every close path invokes SYNCHRONOUSLY (the close button, the backdrop, and the effect cleanup as the
// safety net for Esc/unmount). Idempotent BY CONSTRUCTION: each handle's operation is a no-op when already done
// (abort an aborted controller, cancel a fenced queue, reset an empty store), so a close-button click followed
// by the unmount cleanup — both firing it — is safe. Taking the three handles as callbacks keeps it React-free
// and its idempotency directly unit-testable.
export interface WallStopHandles {
  readonly abort: () => void        // abort the in-flight manifest fetch (AbortController)
  readonly cancelQueue: () => void  // fence the verify queue (no late 'done')
  readonly reset: () => void        // reset the campaign store (close ends the session — see wallView posture note)
}
export function stopWallSession(h: WallStopHandles): void {
  h.abort()
  h.cancelQueue()
  h.reset()
}

// Display precision for the statistic + bounds in the gauge face (full precision rides the row title). Fixed
// 3dp is the D4 "wrong-number-across-the-room" grain; the exact pinned text is preserved in statisticText.
export function gaugeDisplay(n: number): string {
  return n.toFixed(3)
}
