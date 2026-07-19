import type { RunModel } from '../model/runModel'
import { asEventTick } from '../lib/brand'
import { buildRevealClock, type RevealClock } from '../model/revealClock'
import {
  EVENT_KIND_NAMES,
  DETECTION_MADE, ELIGIBILITY_EVALUATED, GEOMETRY_QUERY_RESOLVED,
  TRACK_CONFIRMED, TRACK_UPDATED, TRACK_DROPPED,
  MESSAGE_SENT, MESSAGE_DELIVERED, MESSAGE_DROPPED,
  decodeDetection, decodeEligibility, decodeGeometryQuery,
  decodeTrackConfirmed, decodeTrackUpdated, decodeTrackDropped,
  decodeMessageSent, decodeMessageDelivered, decodeMessageDropped,
} from '../decode/payloads'

// ── THE RAW EVIDENCE TABLE — the pure row model (the byte-X-ray's data layer) ─────────────────────────────
// A rendering of decodeBundle's output, event by event. NO recomputation, NO verdicts: the table only SHOWS
// the decoded bytes — that is its honesty (the header copy says exactly that: EVIDENCE_PROVENANCE). Every
// pure decision (per-kind field decoding, bigint/f64 rendering, sort/filter/scope semantics) lives HERE where
// a test can pin it against the oracles' known values; EvidenceTable.tsx is the glue that renders these.
//
// PROVENANCE: each row's fields are decoded THROUGH the SAME payloads.ts decoders the lenses use (kinds
// 1/2/3/4/5/6/7/22/23), off the model's already-decoded envelope (model.eventAt(seq).payload). A kind with no
// typed decoder (the motion substrate 288/289, the f0 fixture 61440) renders its inner payload as raw bytes —
// still decoded-from-the-bundle (the envelope IS decoded; the inner bytes are shown as themselves), never a
// fabricated field. The kind COLUMN carries the registry name (name + number) via kindLabel.

export const EVIDENCE_PROVENANCE = 'every row decoded from the bundle in your browser'

// A single rendered payload field: a compact key=value. `full` carries the FULL-PRECISION value whenever
// `value` is a lossy (rounded) rendering of an f64/vec — reachable on demand (the cell's title/expand), so a
// rounded number is NEVER shown without its exact value one hover away. `full` is null when `value` is already
// exact (bigint ids, integers, bools, integer-valued f64s, short raw-byte spans).
export interface EvField { readonly key: string; readonly value: string; readonly full: string | null }

export interface EvRow {
  readonly seq: number
  readonly tick: number
  readonly kind: number
  readonly kindName: string      // the registry name, or `kind N` (own-property-safe — see kindLabel)
  readonly fields: readonly EvField[]
  readonly text: string          // lowercased searchable text over the RENDERED strings (the free-text filter reads this)
}

// The kind's registry name, or the honest `kind N` fallback. An OWN-property lookup (Object.hasOwn) — the same
// discipline runCatalog / tours.ts / hangar.ts hold: `kind` is a Uint16 number so a numeric read is already
// safe, but hasOwn keeps this correct even if EVENT_KIND_NAMES ever gained string keys, and it can never
// resolve an inherited Object.prototype member (toString, constructor) into a bogus name.
export function kindLabel(kind: number): string {
  return Object.hasOwn(EVENT_KIND_NAMES, kind) ? EVENT_KIND_NAMES[kind]! : `kind ${kind}`
}

// ── VALUE RENDERING (the honesty rules) ───────────────────────────────────────────────────────────────────
// bigint → its canonical decimal string (String(bigint) is exact, and signed for an i64 latency delta). f64 →
// a sensibly rounded inline value PLUS the exact round-trippable value in `full` (never lossy without the full
// value reachable). String(x) is JS's shortest round-tripping decimal — the canonical exact form of an f64.

function canonicalF64(x: number): string { return String(x) } // shortest round-trip; NaN/±Infinity → 'NaN'/'Infinity'

function roundedF64(x: number): string {
  if (!Number.isFinite(x)) return String(x)
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x) // exact integers render whole (256, 0)
  const abs = Math.abs(x)
  if (abs >= 1e7 || abs < 1e-4) return x.toPrecision(6) // extreme magnitudes → significant-figure form
  return String(Number(x.toFixed(4)))                   // 4dp, trailing zeros trimmed (0.196000 → 0.196)
}

// value = the inline (possibly rounded) rendering; full = the exact value, or null when the inline IS exact.
export function formatF64(x: number): { value: string; full: string | null } {
  const full = canonicalF64(x)
  const value = roundedF64(x)
  return { value, full: value === full ? null : full }
}

export function formatVec(xs: readonly number[]): { value: string; full: string | null } {
  if (xs.length === 0) return { value: '[]', full: null }
  const inline: string[] = []
  const canon: string[] = []
  let anyRounded = false
  for (const x of xs) {
    const f = formatF64(x)
    inline.push(f.value)
    canon.push(f.full ?? f.value)
    if (f.full !== null) anyRounded = true
  }
  return { value: `[${inline.join(', ')}]`, full: anyRounded ? `[${canon.join(', ')}]` : null }
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.byteLength; i++) out += (i ? ' ' : '') + bytes[i]!.toString(16).padStart(2, '0')
  return out
}

const RAW_INLINE_MAX = 32 // bytes shown inline before truncating (the full hex stays reachable in `full`)

// A kind with no typed decoder: show the inner payload as raw bytes. HONEST — named 'raw bytes' so it is never
// mistaken for a typed field; the full hex is reachable when the span exceeds the inline budget.
function rawBytesField(payload: Uint8Array): EvField {
  const len = payload.byteLength
  const fullHex = toHex(payload)
  if (len <= RAW_INLINE_MAX) return { key: 'raw bytes', value: `${len} B: ${fullHex}`, full: null }
  return { key: 'raw bytes', value: `${len} B: ${toHex(payload.subarray(0, RAW_INLINE_MAX))} …`, full: `${len} B: ${fullHex}` }
}

const idField = (key: string, v: bigint): EvField => ({ key, value: v.toString(), full: null }) // canonical decimal, signed-safe
const intField = (key: string, v: number): EvField => ({ key, value: String(v), full: null })
const boolField = (key: string, v: boolean): EvField => ({ key, value: v ? 'true' : 'false', full: null })
const f64Field = (key: string, v: number): EvField => { const f = formatF64(v); return { key, value: f.value, full: f.full } }
const vecField = (key: string, xs: readonly number[]): EvField => { const f = formatVec(xs); return { key, value: f.value, full: f.full } }

// The per-kind field decode. Each arm transcribes the decoded payload's fields in spec order (the SAME
// decoders payloads.ts owns) — the row is a rendering of those exact values, nothing computed.
function decodeFields(kind: number, payload: Uint8Array): EvField[] {
  switch (kind) {
    case DETECTION_MADE: {
      const d = decodeDetection(payload)
      return [idField('subject', d.subject), idField('sensor', d.sensor), vecField('meas', d.meas), f64Field('snr_db', d.snrDb)]
    }
    case TRACK_CONFIRMED: {
      const t = decodeTrackConfirmed(payload)
      return [idField('track', t.track), idField('subject', t.subject), vecField('mean', t.mean), vecField('cov', t.cov)]
    }
    case TRACK_UPDATED: {
      const t = decodeTrackUpdated(payload)
      return [idField('track', t.track), vecField('mean', t.mean), vecField('cov', t.cov),
        vecField('innovation', t.innovation), vecField('innovation_cov', t.innovationCov)]
    }
    case TRACK_DROPPED: {
      const t = decodeTrackDropped(payload)
      return [idField('track', t.track), intField('reason', t.reason)]
    }
    case MESSAGE_SENT: {
      const m = decodeMessageSent(payload)
      return [idField('msg', m.msg), idField('src', m.src), idField('dst', m.dst),
        intField('channel', m.channel), f64Field('snr_db', m.snrDb), f64Field('tx_power_w', m.txPowerW)]
    }
    case MESSAGE_DELIVERED: {
      const m = decodeMessageDelivered(payload)
      // latency_us is a signed i64 sim-time delta — rendered as its canonical (signed) decimal via idField.
      return [idField('msg', m.msg), idField('src', m.src), idField('dst', m.dst),
        idField('latency_us', m.latencyUs), f64Field('snr_db', m.snrDb)]
    }
    case MESSAGE_DROPPED: {
      const m = decodeMessageDropped(payload)
      return [idField('msg', m.msg), intField('reason', m.reason), f64Field('snr_db', m.snrDb), intField('jam_state', m.jamState)]
    }
    case ELIGIBILITY_EVALUATED: {
      const e = decodeEligibility(payload)
      return [idField('subject', e.subject), idField('sensor', e.sensor),
        boolField('in_range', e.inRange), boolField('in_fov', e.inFov), boolField('los_clear', e.losClear),
        boolField('eligible', e.eligible), boolField('tiebreak_applied', e.tiebreakApplied)]
    }
    case GEOMETRY_QUERY_RESOLVED: {
      const q = decodeGeometryQuery(payload)
      return [intField('query_kind', q.queryKind), idField('subject', q.subject), idField('object', q.object),
        vecField('argv', q.argv), boolField('result', q.resultFlag), vecField('result_scalars', q.resultScalars),
        boolField('tiebreak_applied', q.tiebreakApplied)]
    }
    default:
      return [rawBytesField(payload)]
  }
}

// The concatenated key=value rendering of a row's payload — the 'payload' sort key and one input to the row's
// searchable text. A pure join over the fields' OWN string values (never an object keyed by data).
export function payloadText(fields: readonly EvField[]): string {
  return fields.map(f => `${f.key}=${f.value}`).join('  ')
}

function rowText(seq: number, tick: number, kind: number, kindName: string, fields: readonly EvField[]): string {
  const parts: string[] = [String(seq), String(tick), String(kind), kindName]
  for (const f of fields) {
    parts.push(f.key, f.value)
    if (f.full !== null) parts.push(f.full) // the full-precision value is searchable too
  }
  return parts.join(' ').toLowerCase()
}

export function buildEvidenceRow(model: RunModel, seq: number): EvRow {
  const e = model.eventAt(seq)
  const kind = e.kind as number
  const tick = e.tick as number
  let fields: EvField[]
  try {
    fields = decodeFields(kind, e.payload)
  } catch (err) {
    // The published bundles are frozen + verified, so this arm is not reached in practice; it keeps one
    // malformed event from taking the whole table down — it shows the honest error + the raw bytes instead.
    fields = [{ key: 'decode error', value: err instanceof Error ? err.message : String(err), full: null }, rawBytesField(e.payload)]
  }
  const kindName = kindLabel(kind)
  return { seq, tick, kind, kindName, fields, text: rowText(seq, tick, kind, kindName, fields) }
}

export function buildEvidenceRows(model: RunModel): EvRow[] {
  const rows: EvRow[] = new Array(model.eventCount)
  for (let i = 0; i < model.eventCount; i++) rows[i] = buildEvidenceRow(model, i)
  return rows
}

// ── THE SHARED REVEAL CLOCK over the run's whole event sequence (ONE clock, every consumer shares it) ─────
// buildRevealClock over the per-event ticks answers "how many events has the playhead revealed?" (tick ≤
// playhead) in O(log n). The per-event tick array is ascending across every published run (the engine commits
// events in tick order), which buildRevealClock validates and fails loud on if it ever isn't.
export function buildEvidenceRevealClock(model: RunModel): RevealClock {
  return buildRevealClock(model.ticks)
}

// The revealed prefix count at a raw playhead (clamped to a non-negative integer for the EventTick brand).
export function revealedEventCount(clock: RevealClock, playhead: number): number {
  return clock.revealedCount(asEventTick(Math.max(0, Math.floor(playhead))))
}

// ── SORT / FILTER / SCOPE (pure) ──────────────────────────────────────────────────────────────────────────
export type SortKey = 'seq' | 'tick' | 'kind' | 'payload'
export type SortDir = 'asc' | 'desc'

export interface ViewOpts {
  readonly revealedOnly: boolean       // scope toggle: false = whole run, true = revealed-so-far (tick ≤ playhead)
  readonly playhead: number            // the playhead, for the revealed-only scope
  readonly activeKinds: ReadonlySet<number> // the kind allow-list: EMPTY = show all; non-empty = show only these
  readonly text: string                // free-text filter over the rendered fields (case-insensitive substring)
  readonly sortKey: SortKey
  readonly sortDir: SortDir
}

function sortValue(r: EvRow, key: SortKey): number | string {
  switch (key) {
    case 'seq': return r.seq
    case 'tick': return r.tick
    case 'kind': return r.kind
    case 'payload': return payloadText(r.fields)
  }
}

// Stable in BOTH directions: equal keys keep their original (seq) order because the tiebreak is the original
// index and is NOT multiplied by the direction sign. Deterministic — no reliance on the engine's sort stability.
export function sortRows(rows: readonly EvRow[], key: SortKey, dir: SortDir): EvRow[] {
  const mul = dir === 'asc' ? 1 : -1
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const av = sortValue(a, key)
      const bv = sortValue(b, key)
      let c: number
      if (typeof av === 'number' && typeof bv === 'number') c = av - bv
      else c = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
      return c !== 0 ? c * mul : ai - bi
    })
    .map(([r]) => r)
}

// A filter is ACTIVE when a kind allow-list or a non-empty text query is narrowing the population. Text-only or
// kind-only both count — the readout then names the population honestly ('N events · M shown').
export function filterActive(opts: Pick<ViewOpts, 'activeKinds' | 'text'>): boolean {
  return opts.activeKinds.size > 0 || opts.text.trim() !== ''
}

// The ACTIVE SCOPE predicate: the whole run, or the revealed prefix (tick ≤ playhead) in revealed-only mode.
// The ONE population per view — shared by the row list, the reveal-clock count, AND the kind chips — so a chip
// can never advertise a kind's FUTURE composition (e.g. the final 32/31/1 while the playhead sits mid-run,
// which both breaks the scope contract and spoilers the event mix through the filter UI). The comms lesson:
// one population, named once, obeyed everywhere.
export function inActiveScope(r: EvRow, revealedOnly: boolean, playhead: number): boolean {
  return !revealedOnly || r.tick <= Math.floor(playhead)
}

// The active scope's row set — the population the chips count over and the row list narrows within.
export function scopeRows(rows: readonly EvRow[], revealedOnly: boolean, playhead: number): EvRow[] {
  return revealedOnly ? rows.filter(r => inActiveScope(r, revealedOnly, playhead)) : rows.slice()
}

// Scope → kind allow-list → text → sort. The revealed-only scope filters by the SAME tick ≤ playhead predicate
// the reveal clock counts and the chips scope over, so the shown set, the chips, and the 'M of N' count always
// agree (pinned in the tests).
export function applyView(rows: readonly EvRow[], opts: ViewOpts): EvRow[] {
  const needle = opts.text.trim().toLowerCase()
  const kinds = opts.activeKinds
  const filtered = rows.filter(r =>
    inActiveScope(r, opts.revealedOnly, opts.playhead) &&
    (kinds.size === 0 || kinds.has(r.kind)) &&
    (needle === '' || r.text.includes(needle)),
  )
  return sortRows(filtered, opts.sortKey, opts.sortDir)
}

// ── LABELS (the scope + population copy — every count names its scope) ─────────────────────────────────────
export interface KindCount { readonly kind: number; readonly name: string; readonly count: number }

// The per-kind counts for the filter chips, ascending by kind. Keyed by a numeric Map — never a plain object
// keyed by data — so a kind value can never resolve an inherited member (the own-property discipline).
export function kindCounts(rows: readonly EvRow[]): KindCount[] {
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([kind, count]) => ({ kind, name: kindLabel(kind), count }))
}

export const wholeScopeLabel = (total: number): string => `whole run · ${total} events`
export const revealedScopeLabel = (revealed: number, total: number): string => `revealed so far · ${revealed} of ${total}`

// The population readout. scopeBase is the current scope's population (total for whole-run, the revealed count
// for revealed-only). When a filter narrows it, both counts are named ('N events · M shown'); otherwise the
// scope's own count stands alone.
export function populationLabel(scopeBase: number, shown: number, isFiltered: boolean): string {
  return isFiltered ? `${scopeBase} events · ${shown} shown` : `${scopeBase} events`
}
