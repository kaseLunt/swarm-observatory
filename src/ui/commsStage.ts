import {
  validateRegistration, type LensRegistration, type PixelClass,
} from './lensContract'
import type { QualityCaveat } from './voices'
import type { MessageSent, MessageDelivered, MessageDropped } from '../decode/payloads'
import type { EventTick } from '../lib/brand'
import { buildRevealClock, type RevealClock } from '../model/revealClock'
import { ASSUMED_DT_US } from '../state/transport'

// ── THE CONTESTED LINK — the comms lens's model layer over kinds 5/6/7 ─────────────────────────────────────
// A PURE, load-path model layer that turns the decoded MessageSent / MessageDelivered / MessageDropped payloads
// (core kinds 5/6/7) into the duet's evidence: the send↔outcome PAIRING (matched by the `msg` id and INDEPENDENTLY
// cross-checked against the causation edges), the reveal-clock prefix counts the ledger is written from, and the
// ONE dropped packet that is the run's hero. The decoders live in payloads.ts; the RunModel accessors
// (messageSentAt / messageDeliveredAt / messageDroppedAt) return the payloads; this module lights them. Nothing
// here touches the frame path — buildCommsStage is the one-pass sibling of buildQueryDraws / buildSensingStage,
// run ONCE at model publish.
//
// THE DECODE OF RECORD (pinned against the frozen f4_seed42 bundle in messageTrack.oracle.test.ts): 32 sends /
// 31 delivered / 1 dropped; every event carries the single constant snr_db 12.041199826559248 (zero weather); one
// steady link src 1 → dst 2, channel 1, tx 256 W; the drop is msg 14 @ tick 30, reason 3 (LOSS), jam_state 0; all
// 32 outcomes' causation_id resolves to their send's seq. The story the lens tells is exactly what those bytes
// support — "a steady link and the one lost packet." No BeliefUpdated bytes exist, so the lens is sent-vs-arrived
// and its copy says only that (honest degeneration).
//
// THE GRAMMAR (the brand-protecting rule): the msg-id pairing is a DECODED-CONSISTENCY self-check, so it wears
// the self-consistent ring, NEVER the manifest-verified check mark (no external oracle pins it); the DROP is a
// QUALITY fact about the link (the voices quality register, the attested mark + a caveat), NEVER the integrity
// mismatch mark; snr / latency are decoded facts shown plain. No new glyphs, no new hues — the lens borrows the
// comms category token (theme `comms #a78bfa`) and speaks the frozen seven-mark alphabet.

// ── The decoded send record (kind-5), tick-tagged ─────────────────────────────────────────────────────────
export interface CommsSend {
  seq: number
  tick: number
  msg: bigint
  src: bigint
  dst: bigint
  channel: number
  snrDb: number
  txPowerW: number
}

// ── A send↔outcome PAIR — the duet's atom (the msg-id pairing, causation cross-checked) ────────────────────
// `paired` is always true for a pair that reached this list (it exists because a send with this msg id was
// found); an ORPHAN outcome (no matching send) is surfaced separately (orphanOutcomes) so the self-consistency
// check can refuse it, never a silently dropped row. `causationOk` is the INDEPENDENT reading: the outcome's
// causation_id resolves to its send's seq — the free integrity evidence (two decodings of the bytes agree).
export interface CommsPair {
  msg: bigint
  send: CommsSend
  outcomeSeq: number
  outcomeTick: number
  outcome: 'delivered' | 'dropped'
  latencyUs: bigint | null // delivered only (the decoded sim-time transit delta); null on a drop
  reason: number | null    // dropped only — 3 = LOSS (spec-3b §11.1 row 7 JAMMED=1 | RANGE=2 | LOSS=3)
  jamState: number | null  // dropped only — 0 = jam inactive on f4 (no contested-channel overclaim)
  snrDb: number            // the outcome's decoded snr_db
  causationOk: boolean     // the outcome's causation_id === its send's seq (the independent cross-check)
  // A THIRD independent reading: a MessageDelivered carries its OWN src/dst — they must match the send's
  // endpoints. A causally-matched receipt naming a DIFFERENT dst is a contradictory receipt (an anomaly), not a
  // clean delivery. Always true for a drop: MessageDropped carries NO endpoint field (only reason/jam/snr — see
  // the decoder), so there is nothing to cross-check beyond the msg-id pairing + causation already checked.
  endpointOk: boolean
}

// ── AN OUTCOME AUDIT — a causation/endpoint reading for EVERY outcome whose msg resolves to a send ──────────────
// Two populations, kept separate: the ACCEPTED PAIRS (CommsPair, above) are the TRAJECTORIES the stage animates
// (the bijection — first outcome per send); the AUDIT is broader — it records a causation + endpoint reading for
// every RESOLVING outcome (msg matches a send), INCLUDING duplicates, computed BEFORE the bijection rejects them.
// So a contradictory duplicate delivery's endpoint reading is retained and countable (never discarded by arrival
// order). Orphans are NOT audited (no send to compare against). The receipt's causation/endpoint DENOMINATORS read
// from this population; the trajectory/ledger/hero read from the accepted pairs.
export interface OutcomeAudit {
  outcome: 'delivered' | 'dropped'
  causationOk: boolean // the outcome's causation edge resolves to its send's seq
  endpointOk: boolean  // a delivery: its src/dst match the send's; a drop: true (no endpoint — forms no comparison)
}

// The presentational duet placement (three-space) + the pulse time-stretch — DECLARED, not decoded. The
// endpoints are pinned scenario content (Engine-only state, zero entity partition), so they are PADS, not
// drones: placement is presentational (chip-declared). This is the endpoint-resolver seam's positionless arm —
// a data-true resolver slots in when positioned comms content lands, and nothing in the pulse math changes. Src
// low-left, dst right with lead room; pulses travel left→right, agreeing with the timeline's reading direction.
export const COMMS_PAD_SRC: readonly [number, number, number] = [-9, 0, -3]
export const COMMS_PAD_DST: readonly [number, number, number] = [9, 0, 3]
// The mid-span point a dropped pulse collapses to (and the persistent anchor rests at) — the geometric mean of
// the two pads, so the anchor sits on the link exactly halfway.
export const COMMS_MID_SPAN: readonly [number, number, number] = [
  (COMMS_PAD_SRC[0] + COMMS_PAD_DST[0]) / 2,
  (COMMS_PAD_SRC[1] + COMMS_PAD_DST[1]) / 2,
  (COMMS_PAD_SRC[2] + COMMS_PAD_DST[2]) / 2,
]
// THE ONE PINNED, CHIP-DECLARED TIME-STRETCH: a delivered pulse's flight is its true latency_us × PULSE_STRETCH
// sim-microseconds. On the frozen bundle the max latency 375µs × 300 = 112 500 sim-µs = 0.9 tick (dt 125 000µs)
// < dt, so NO pulse ever crosses a tick boundary and two pulses never coexist — the stretch is lawful (true
// duration sub-perceptual, one pinned constant, never moves an event across a tick). Relative speeds stay TRUE
// (one uniform constant); the flight is legible.
export const PULSE_STRETCH = 300
// The drop carries NO latency (kind-7 has no latency field), so its flight is a DECLARED presentational
// duration — it launches, decelerates, and collapses at mid-span. Bounded < 1 tick like every delivered flight,
// so the fizzle stays inside its own tick (the reveal-clock boundary is exact).
export const DROP_FLIGHT_TICKS = 0.9

// THE MISSING-CLOCK DELIVERED FLIGHT — a DECLARED presentational duration (bounded < 1 tick, the drop's bound) used
// for a delivered pulse ONLY when the tick period is MISSING (dtKnown false). With no recorded dt the true-latency
// claim is already withheld, so the flight is presentational anyway; a bounded declared duration keeps the message
// crossing legible while guaranteeing the pulse SETTLES within its send's tick — never the 60-tick overshoot the
// assumed 1000µs clock would give a 200µs latency (×300/1000 = 60 ticks), which would leave pulses in flight at the
// run's terminal rest. Chip-disclosed like the drop's flight (commsChipCopy's dtKnown-false timing clause).
export const MISSING_DELIVERED_FLIGHT_TICKS = 0.9

// THE HERO PRESENTATION WINDOW — a DECLARED presentational persistence (in TICKS) beyond the decoded instant, so the
// run's ONE emphasized moment is CADENCE-SAFE. The 0.9-tick collapse is far smaller than a coarse playback stride
// (8×/30Hz ≈ 2.1 ticks/frame), so a pure-uniform sample could jump clean over it — the anchor would still mark the
// loss, but the staged MOMENT could be skipped. So the HERO's visibility window is [t0, t0 + max(dur, this)): the
// collapse completes first (unchanged, the decoded instant), then a declared AFTERGLOW decays to zero across the
// remainder. Sized > the worst supported stride so at least one frame samples the window at every cadence
// (a window of width W ≥ stride S always contains a sample of an S-spaced sweep). Presentational, ledger/provenance-
// disclosed like the drop's flight — it joins the declared-presentational family (the pads, the drop flight). Only
// the hero gets this guarantee; a skipped routine delivery at 8× is fine (the ledger/lane carry every message).
export const HERO_PRESENT_TICKS = 4

// A delivered pulse's flight duration in TICKS, from its decoded latency and the run's dt (µs). Pure.
export const flightTicks = (latencyUs: bigint, dtUs: number): number =>
  (Number(latencyUs) * PULSE_STRETCH) / dtUs

// ── Everything the stage + strip + ledger consume, built in one publish-time pass ──────────────────────────
export interface CommsData {
  sends: CommsSend[]          // decoded kind-5 sends, ascending by tick
  pairs: CommsPair[]          // send↔outcome pairs, ascending by outcome tick (bijective — one accepted per send)
  drops: CommsPair[]          // every ACCEPTED dropped pair, ascending by tick (one on the steady link; ≥2 degrades the copy)
  drop: CommsPair | null      // the FIRST accepted dropped pair, or null if none dropped
  // THE HERO — the run's single, headline-able lost packet: exactly ONE dropped pair, that drop a shape the lens
  // honestly describes (supportedDropCaveat), AND the whole outcome mapping CONSISTENT (see `consistent`). null on
  // anything else — 2+ drops, an unsupported drop, or an inconsistent mapping — so the "one lost packet" story, the
  // persistent anchor, and the single stage bloom are keyed on THIS, never on a first-accepted-outcome that might
  // be hiding a conflicting one.
  hero: CommsPair | null
  orphanOutcomes: number[]    // outcome seqs whose msg id matched NO send — refused, never hidden
  duplicateOutcomes: number[] // outcome seqs whose send ALREADY had an accepted outcome — a second, conflicting receipt
  // THE AUDIT POPULATION — a causation/endpoint reading for every RESOLVING outcome (msg matches a send), accepted
  // OR duplicate, computed before the bijection rejects duplicates. The receipt's causation/endpoint denominators
  // read from THIS (order-independent, never discarding a contradictory duplicate's reading); trajectories read
  // from `pairs`. Excludes orphans (no send to compare against).
  resolvingAudits: OutcomeAudit[]
  rawDelivered: number        // decoded kind-6 events, BEFORE pairing rejection — the raw recorded count for the disclosure
  rawDropped: number          // decoded kind-7 events, BEFORE pairing rejection
  link: { src: bigint; dst: bigint; channel: number; txPowerW: number } | null // the single link iff every send agrees
  snrConstant: number | null  // the single snr_db iff EVERY decoded kind-5/6/7 event shares it, finite + bit-exact —
                              // collected before pairing rejection, so an anomalous outcome's SNR still counts against it
  dtUs: number                // the sim tick period (µs) the pulse stretch maps latency onto — the manifest's
                              // RECORDED dtUs when present (validated finite+positive AT ADMISSION), else the app's
                              // ONE shared assumed clock (ASSUMED_DT_US), never a lens-private constant
  dtKnown: boolean            // whether dtUs is the run's RECORDED manifest period. When false (a manifestless /
                              // det-only run) the pulse animates on the shared assumed clock, and the timing copy
                              // says the flight is a presentational estimate — never "true latency" it cannot back
  // Reveal-clock prefix counts — the ledger is written from THESE (never a precomputed reveal-independent total):
  sentClock: RevealClock      // sends with tick ≤ playhead
  deliveredClock: RevealClock // delivered outcomes with tick ≤ playhead
  droppedClock: RevealClock   // dropped outcomes with tick ≤ playhead
  // Pairing self-consistency (the self-check ring's inputs): the send↔outcome map is a BIJECTION (every send has
  // EXACTLY one outcome, no orphan outcome, no duplicate outcome) AND every causation edge resolves. Two
  // independent readings of the bytes both point — free integrity evidence. A mere cardinality match
  // (|pairs| === |sends|) is NOT enough: two outcomes for A and none for B has the same count yet is not a
  // pairing, so allPaired demands the bijection, not the count.
  allPaired: boolean
  allCausationOk: boolean
  // THE THIRD NAMED READING — every delivered receipt's OWN src/dst matched its send's endpoints (a drop carries no
  // endpoint, so it never fails this). Exposed as a first-class check beside allPaired/allCausationOk so the strip
  // renders THREE named states and the mismatch mark is always attributable to a specific reading, never unexplained.
  allEndpointsOk: boolean
  // THE CONSISTENCY GATE — allPaired && allCausationOk && allEndpointsOk: the whole mapping is a trustworthy
  // bijection AND all THREE independent readings of the bytes (msg-id pairing, causation edges, delivered endpoints)
  // agree.
  consistent: boolean
  // THE DUET-RENDERABLE GATE — consistent AND a SINGLE link (link !== null). The duet stage draws ONE src→dst
  // path, and every DEFINITIVE visual (the hero, the bloom, the anchor, the "never arrived" story, the traveling
  // pulses, the single-link ledger tally, the per-message latency lane) assumes exactly that. So the whole lens —
  // stage, strip, and chip — gates its definitive visuals on THIS: on an inconsistent, incomplete, or multi-link
  // mapping it fails closed AS ONE to a counts-and-mode disclosure, never a per-message or single-link claim it
  // cannot back.
  renderable: boolean
}

// The minimal shape buildCommsStage needs — RunModel satisfies it structurally (no import cycle). `parentOf`
// is the causation edge (the outcome → its cause seq); the cross-check reads it INDEPENDENTLY of the msg id.
export interface CommsSource {
  readonly eventCount: number
  readonly tickCount: number
  readonly ticks: ArrayLike<number>
  kindAt(seq: number): number
  entityKeys(): readonly string[]
  messageSentAt(seq: number): MessageSent | null
  messageDeliveredAt(seq: number): MessageDelivered | null
  messageDroppedAt(seq: number): MessageDropped | null
  parentOf(seq: number): number | null
  // The recorded tick period (µs) from the run's manifest, or null when the run carries no manifest (det-only).
  // The pulse clock reads THIS — the hardcoded default is a fallback, never the source of truth (a run recorded
  // with a different period must animate latency on ITS clock, not a baked constant).
  manifestDtUs(): number | null
}

// THE THREE PULSE-CLOCK STATES — one authority, no lens-private constant:
//   • RECORDED — a manifest dtUs. It is validated finite+positive AT ADMISSION (manifest.ts parseManifest, the ONE
//     authority for dt_us validity), so a non-null manifestDtUs() here is trustworthy: dtKnown = true, true-latency.
//   • MISSING  — no manifest (a det-only KAT run). The pulse animates on ASSUMED_DT_US — the app's SHARED assumed
//     clock (the same const the ProvenancePanel labels "assumed" and the Hangar sim-clock partition keys on), NOT a
//     second private 125000µs constant. dtKnown = false, so the timing copy discloses the assumption.
//   • INVALID  — never reaches this seam: parseManifest rejects a non-finite / ≤0 dt_us as a malformed manifest, so
//     the comms lens never re-owns that validity check (avoiding two contradictory authorities).

// One-pass build of the whole comms model. A run with no kind-5/6/7 events yields empty sends/pairs (honest
// empty state). Load-path only; every allocation is at publish, the reveal clocks answer O(log n) thereafter.
export function buildCommsStage(source: CommsSource): CommsData {
  const sends: CommsSend[] = []
  const sendByMsg = new Map<string, CommsSend>()
  // Every decoded kind-5/6/7 snr_db, collected BEFORE any pairing rejection, so an orphan/duplicate
  // outcome carrying a DIFFERENT snr still kills the "constant" claim (it cannot be excluded to fake a steady link).
  const rawSnrs: number[] = []
  for (let seq = 0; seq < source.eventCount; seq++) {
    const s = source.messageSentAt(seq)
    if (s === null) continue
    const rec: CommsSend = {
      seq, tick: source.ticks[seq]!, msg: s.msg, src: s.src, dst: s.dst,
      channel: s.channel, snrDb: s.snrDb, txPowerW: s.txPowerW,
    }
    sends.push(rec)
    sendByMsg.set(String(s.msg), rec)
    rawSnrs.push(s.snrDb)
  }
  sends.sort((a, b) => a.tick - b.tick)

  const pairs: CommsPair[] = []
  const orphanOutcomes: number[] = []
  const duplicateOutcomes: number[] = []
  const resolvingAudits: OutcomeAudit[] = [] // a reading for EVERY resolving outcome (accepted + duplicate)
  const matchedSend = new Set<number>() // send seqs already claimed by an outcome — the bijection guard
  let rawDelivered = 0, rawDropped = 0   // raw decoded outcome counts, BEFORE pairing rejection (for the disclosure)
  let allCausationOk = true
  const addOutcome = (
    seq: number, msg: bigint, outcome: 'delivered' | 'dropped',
    latencyUs: bigint | null, reason: number | null, jamState: number | null, snrDb: number,
    outcomeSrc: bigint | null, outcomeDst: bigint | null, // a MessageDelivered's OWN endpoints; null for a drop
  ): void => {
    const send = sendByMsg.get(String(msg))
    if (!send) { orphanOutcomes.push(seq); return }        // an outcome with no matching send — refused, never hidden
    // AUDIT FIRST — compute the causation + endpoint readings for EVERY resolving outcome, BEFORE the bijection
    // decides accept-vs-duplicate. A contradictory duplicate delivery's endpoint reading is thus retained and
    // countable, so the receipt's denominators are order-independent (previously a discarded reading made the
    // audit depend on arrival order). A delivery's OWN src/dst must match its send's endpoints; a drop carries no
    // endpoint (spec — no field), so it forms no endpoint comparison (endpointOk true, filtered out of the count).
    const causationOk = source.parentOf(seq) === send.seq
    const endpointOk = outcome === 'dropped' ? true : (outcomeSrc === send.src && outcomeDst === send.dst)
    resolvingAudits.push({ outcome, causationOk, endpointOk })
    if (matchedSend.has(send.seq)) { duplicateOutcomes.push(seq); return } // a SECOND outcome for one send — audited, but not a trajectory
    matchedSend.add(send.seq)
    if (!causationOk) allCausationOk = false // the CONSISTENCY gate folds ACCEPTED pairs only (a duplicate already fails allPaired)
    pairs.push({
      msg, send, outcomeSeq: seq, outcomeTick: source.ticks[seq]!, outcome,
      latencyUs, reason, jamState, snrDb, causationOk, endpointOk,
    })
  }
  for (let seq = 0; seq < source.eventCount; seq++) {
    const d = source.messageDeliveredAt(seq)
    if (d !== null) { rawDelivered++; rawSnrs.push(d.snrDb); addOutcome(seq, d.msg, 'delivered', d.latencyUs, null, null, d.snrDb, d.src, d.dst); continue }
    const x = source.messageDroppedAt(seq)
    if (x !== null) { rawDropped++; rawSnrs.push(x.snrDb); addOutcome(seq, x.msg, 'dropped', null, x.reason, x.jamState, x.snrDb, null, null) }
  }
  pairs.sort((a, b) => a.outcomeTick - b.outcomeTick)

  // THE PAIRING IS A BIJECTION, not a cardinality match: EXACTLY one outcome per send, no orphan outcome, no
  // duplicate outcome, and every send matched. Two outcomes for A and none for B would have |pairs| === |sends|
  // yet leave a send unmatched (matchedSend.size < sends.length) AND a duplicate — so it fails here, and the
  // self-consistent ring is never minted for it.
  const allPaired =
    orphanOutcomes.length === 0 && duplicateOutcomes.length === 0 && matchedSend.size === sends.length
  const allEndpointsOk = pairs.every(p => p.endpointOk)
  // THE CONSISTENCY GATE — a trustworthy bijection AND all THREE independent readings agree: the msg-id pairing,
  // the causation edges, AND the delivered endpoints (a receipt whose src/dst contradict its send is an anomaly).
  // Every definitive visual is gated on this.
  const consistent = allPaired && allCausationOk && allEndpointsOk

  // The single link iff every send names the same src/dst/channel/tx (one steady link).
  let link: CommsData['link'] = null
  if (sends.length > 0) {
    const f = sends[0]!
    link = sends.every(s => s.src === f.src && s.dst === f.dst && s.channel === f.channel && s.txPowerW === f.txPowerW)
      ? { src: f.src, dst: f.dst, channel: f.channel, txPowerW: f.txPowerW } : null
  }

  // The single snr iff EVERY decoded comms event (rawSnrs, collected before pairing rejection) shares one FINITE,
  // bit-exact value (Object.is on the f64 — zero weather). A NaN first element fails Number.isFinite; an
  // anomalous outcome with a different snr fails the equality — either way the "steady link" clause is withheld.
  let snrConstant: number | null = null
  if (rawSnrs.length > 0 && rawSnrs.every(v => Number.isFinite(v) && Object.is(v, rawSnrs[0]!))) snrConstant = rawSnrs[0]!

  // THE DUET-RENDERABLE GATE — a consistent mapping AND a SINGLE link. The duet draws one src→dst path, so
  // multi-link data (link null — sends disagree on endpoints/channel/power) cannot be rendered as a duet even
  // when the pairing is a perfect bijection.
  const renderable = consistent && link !== null

  const drops = pairs.filter(p => p.outcome === 'dropped')
  const drop = drops.length > 0 ? drops[0]! : null
  // THE HERO — exactly ONE dropped pair, a shape the lens honestly describes, on a RENDERABLE (consistent, single-
  // link) mapping. Anything else (2+ drops, an unsupported drop, an inconsistent mapping, or multiple links)
  // yields NO hero → no "one lost packet" story, no anchor, no bloom. Requiring `renderable` is what makes a
  // definitive loss claim fail closed: without it, a MessageDropped accepted ahead of a discarded MessageDelivered
  // for the same msg would render a loss that hides a delivery, or a multi-link run would headline a loss on a
  // single-link duet that does not represent it.
  const hero = renderable && drops.length === 1 && supportedDropCaveat(drops[0]!) !== null ? drops[0]! : null

  // THE PULSE CLOCK — three states, one authority (see the block above). A non-null manifestDtUs() is RECORDED (its
  // validity was settled at admission), so dtKnown reduces to a presence test; MISSING falls to the shared assumed
  // clock; INVALID cannot arrive. dtKnown gates the chip's true-latency claim vs. the assumed-clock disclosure.
  const manifestDt = source.manifestDtUs()
  const dtKnown = manifestDt !== null
  const dtUs = dtKnown ? manifestDt : ASSUMED_DT_US

  const sentClock = buildRevealClock(sends.map(s => s.tick))
  const deliveredClock = buildRevealClock(pairs.filter(p => p.outcome === 'delivered').map(p => p.outcomeTick))
  const droppedClock = buildRevealClock(drops.map(p => p.outcomeTick))

  return {
    sends, pairs, drops, drop, hero, orphanOutcomes, duplicateOutcomes, resolvingAudits, rawDelivered, rawDropped,
    link, snrConstant, dtUs, dtKnown,
    sentClock, deliveredClock, droppedClock, allPaired, allCausationOk, allEndpointsOk, consistent, renderable,
  }
}

// HAS-COMMS-EVENTS — the CONTENT half of the applicability gate: ANY comms kind present (a send OR an outcome).
// Outcome-only data (a delivered-only or dropped-only run) is internally anomalous, but the lens must still MOUNT
// so its disclosure appears — the orphan outcomes land in the inconsistent path, nothing definitive renders. Pure.
export const hasCommsEvents = (data: CommsData): boolean =>
  data.sends.length > 0 || data.rawDelivered > 0 || data.rawDropped > 0

// ── THE LEDGER-BY-SCRUB — the running tally written from the reveal clock's PREFIX counts ───────────────────
// sent / delivered / lost SO FAR — each a prefix count of events with tick ≤ playhead, never a precomputed
// reveal-independent total. At full reveal it reads 32 / 31 / 1. `playhead` rides the EventTick brand (the
// strip brands the store playhead at its own ingestion), so a raw StateFrame cannot launder in.
export interface CommsLedger { sent: number; delivered: number; lost: number }
export function ledgerAt(data: CommsData, playhead: EventTick): CommsLedger {
  return {
    sent: data.sentClock.revealedCount(playhead),
    delivered: data.deliveredClock.revealedCount(playhead),
    lost: data.droppedClock.revealedCount(playhead),
  }
}

// A delivered pair is REVEALED at the playhead iff its outcome tick ≤ playhead — the latency lane shows exactly
// the pairs the scrubbing has written. Pure; the strip re-asks on every playhead move.
export function revealedPairs(data: CommsData, playhead: EventTick): CommsPair[] {
  return data.pairs.filter(p => p.outcomeTick <= (playhead as number))
}

// ── THE HERO'S REVEAL STATE — the anchor + bloom obey the reveal clock, keyed on the HERO ───────────────────
// Keyed on data.hero (exactly one supported drop), NOT "the first drop": a run with no hero (0 drops, ≥2 drops,
// or a single unsupported drop) returns 'none' — no anchor, no bloom, no "always-findable loss" language. When a
// hero exists: before its tick → NOT-YET (the anchor is withheld); at/after → ANCHORED (the persistent
// conclusion). The single stage BLOOM is the emphasis during the hero drop's own flight window.
export type DropReveal = 'none' | 'not-yet' | 'anchored'
export function dropRevealAt(data: CommsData, playhead: EventTick): DropReveal {
  if (data.hero === null) return 'none'
  return (playhead as number) >= data.hero.outcomeTick ? 'anchored' : 'not-yet'
}

// ── THE DECODED DROP CLASSIFIER — the caveat is DERIVED from the bytes, never assumed ───────────────────────
// The quality caveat a drop wears is a function of its DECODED reason + jam_state, not a fixed mapping. reason 3
// (LOSS) with jam inactive (jam_state 0) is the shape this lens honestly describes → the 'link-loss' caveat. Any
// other shape (JAMMED/RANGE/other reason, or jam_state ≠ 0) is a contested-channel outcome the lens cannot yet
// describe (no such certified bundle exists) → null, and the strip FAILS CLOSED with an honest refusal rather
// than misreport a jammed drop as a plain loss. (The supported caveat KIND is declared on the drop-anchor pixel
// class — the registry authority; this only decides whether the DECODED shape earns it.)
export function supportedDropCaveat(pair: CommsPair): QualityCaveat | null {
  return pair.reason === 3 && pair.jamState === 0 ? 'link-loss' : null
}

// ── THE DECODED DROP-REASON NAME — ONE source for the reason WORD (spec-3b §11.1 row 7) ─────────────────────
// The kind-7 reason CODE → its spec name. ONE home so the strip's caveat line and the stage's anchor label can
// never name the same code two different ways (the strip used to hardcode "LOSS"). Codes: JAMMED=1 | RANGE=2 |
// LOSS=3 (spec-3b §11.1 row 7). An unknown/absent code degrades to a plain, non-fabricating token — never a
// guessed shape (a lens that cannot name the reason says "DROP", it does not invent one).
export function dropReasonName(reason: number | null): string {
  return reason === 1 ? 'JAMMED' : reason === 2 ? 'RANGE' : reason === 3 ? 'LOSS' : 'DROP'
}

// ── THE ANCHOR LABEL — the persistent conclusion NAMES itself, DECODED (never a hardcoded string) ────────────
// The stage anchor's SDF label text, DERIVED from the decoded hero pair: its outcome tick and its decoded reason
// word (dropReasonName — the ONE source the strip shares). On the frozen f4 bundle this reads "t30 · LOSS", but
// nothing here is literal — the tick is data.hero.outcomeTick and the word is dropReasonName(data.hero.reason),
// so the label tracks the decode, not a copy of it. Pure; the view builds the string ONCE at React render (never
// per frame) and the reveal clock (dropRevealAt) gates its display, exactly as the anchor mesh's.
export function anchorLabel(hero: CommsPair): string {
  return `t${hero.outcomeTick} · ${dropReasonName(hero.reason)}`
}

// ── THE FAIL-CLOSED DISCLOSURE MODE — the ONE word the stage / strip / chip all degrade to ──────────────────
// The precedence is by SEVERITY, so a run with more than one problem reports the worst honestly: an actual
// DISAGREEMENT (an orphan / duplicate outcome, a causation conflict, a contradictory endpoint) is 'inconsistent';
// then UNMATCHED sends (no outcome yet) are 'incomplete'; only a COMPLETE bijection over more than one link is
// 'multiple links'. Ordering incomplete BEFORE multiple-links is load-bearing: two sends on different links with
// one outcome must report the unresolved count ('incomplete'), never hide it behind 'multiple links'. The three
// surfaces share this so their words can never diverge.
export type CommsDisclosureMode = 'inconsistent' | 'incomplete' | 'multiple links'
export function commsDisclosureMode(data: CommsData): CommsDisclosureMode {
  if (commsAnomalyCount(data) > 0) return 'inconsistent'                    // an actual disagreement (highest severity)
  if (data.sends.length - data.pairs.length > 0) return 'incomplete'       // unmatched sends — before multiple-links
  return 'multiple links'                                                   // a COMPLETE bijection over more than one link
}

// The count of ANOMALOUS FACTS for the disclosure — ORDER-INDEPENDENT. Every component is derived from an
// arrival-order-invariant population: each orphan outcome (no matching send), each duplicate outcome (a second
// outcome for a resolved send — the count of "extra" outcomes is invariant), and each AUDIT-ROW disagreement
// (a resolving outcome whose causation OR endpoint reading disagrees — the audit population records EVERY resolving
// outcome, accepted or duplicate). The old formula counted disagreements over the ACCEPTED pairs, so which of two
// conflicting receipts became the trajectory changed the total (good-then-bad reported 1, bad-then-good reported 2);
// reading the disagreements off the audit population makes the aggregate a set of facts, not an order of arrivals.
export function commsAnomalyCount(data: CommsData): number {
  return data.orphanOutcomes.length + data.duplicateOutcomes.length
    + data.resolvingAudits.filter(a => !a.causationOk || !a.endpointOk).length
}

// ── THE DATA-DRIVEN CHIP COPY — every claim EARNED from the decoded content, gated on the duet-renderable state ─
// The static honesty chip (COMMS_HONESTY) states only the always-true claim; the run-specific summary is DERIVED
// here so it can never over-claim on other data. The "steady link · SNR constant" clause requires BOTH a SINGLE
// link (data.link) AND a constant SNR — a constant SNR alone over a MULTI-link run is not "a steady link". THE
// GATE: any definitive loss language (a no-loss assurance, "the one lost packet", a per-message count) renders
// ONLY when the mapping is RENDERABLE (consistent AND single-link); otherwise the copy degrades to the raw
// recorded counts + the failure mode, never a loss or single-link claim it cannot back.
//   SCOPE-LABELLED: the chip's totals are RUN-scoped (it does not scrub — it always states the whole run), so
// EVERY branch names its scope ("whole run: …"), so the chip's "32 sent" never reads as a contradiction of the
// playhead-scoped "0 so far" strip ledger beside it (the chip is the most prominent surface — it must self-label).
export function commsChipCopy(data: CommsData): string {
  const sent = data.sends.length
  const scope = 'whole run' // the chip is run-scoped, never playhead-scoped — it names that scope in every branch
  // "A steady link" requires the whole duet to be RENDERABLE (a consistent, single link — no contradictory
  // receipt, no multi-link) AND a constant SNR. A constant SNR over a link whose deliveries contradict their
  // sends is not steady; nor is a single send-agreeing link whose delivery names a different endpoint.
  const link = (data.renderable && data.snrConstant !== null)
    ? `a steady link (SNR ${data.snrConstant.toFixed(2)} dB, constant)` : 'the link'
  if (!data.renderable) {
    const mode = commsDisclosureMode(data)
    if (mode === 'multiple links') {
      return `${link} — ${scope}: ${sent} sent across multiple links; the duet renders a single link only, so no per-message duet claim`
    }
    const recorded = data.rawDelivered + data.rawDropped
    const unresolved = sent - data.pairs.length // sends with no ACCEPTED outcome
    const anomalies = commsAnomalyCount(data)
    const parts = [`${sent} sent`, `${recorded} outcome${recorded === 1 ? '' : 's'} recorded`]
    if (unresolved > 0) parts.push(`${unresolved} unresolved`)
    if (anomalies > 0) parts.push(`${anomalies} anomalous`)
    return `${link} — ${scope}: ${parts.join(' · ')} (outcome mapping ${mode} — no loss assurance)`
  }
  const delivered = data.pairs.filter(p => p.outcome === 'delivered').length
  const lost = data.drops.length
  const counts = `${sent} sent · ${delivered} delivered · ${lost} lost`
  const loss = lost === 0 ? 'no packet lost'
    : data.hero !== null ? 'the one packet that never arrived' // exactly one SUPPORTED drop on a renderable mapping — the hero
    : `${lost} packet${lost === 1 ? '' : 's'} lost`            // ≥2 drops, or a single unsupported drop — no hero language
  // THE TIMING CLAIM names what the animation ACTUALLY uses. RECORDED: a delivered pulse flies its TRUE latency ×300
  // (the recorded dt IS consumed). MISSING: the delivered flight is a FIXED presentational bound — pulseDuration
  // ignores BOTH dtUs and latency (1µs and 200µs animate identically), so the copy names the fixed bound and does
  // NOT mention a clock. Nothing in the MISSING path consumes dtUs (audited: only pulseDuration reads CommsData.dtUs,
  // and it ignores it when dtKnown is false), so an "assumed 1000µs clock" mention would imply a clock-derived timing
  // that never happens. The true-latency claim is withheld either way.
  const timing = data.dtKnown
    ? 'delivered pulses fly true latency ×300, the drop\'s flight is a presentational estimate'
    : 'pulse flight is a fixed presentational bound — no recorded tick period (every crossing animates identically)'
  return `${link} — ${scope}: ${counts} · ${loss} · ${timing}`
}

// ── THE PULSE PRIMITIVES — pure, allocation-free (the frame-path's per-move derivation) ─────────────────────
// A pulse's flight window (in TICKS) for a pair: [t0, t0 + dur), t0 = the send's tick. Exported so the view and
// the cadence tests share ONE definition of "when is this pulse in flight". A RECORDED delivered flight is
// latency×300/dt (bounded < 1 tick by the spec's sub-tick latency); a MISSING delivered flight is the DECLARED
// bounded presentational duration (the true-latency claim is already withheld, so it does not stretch on the tiny
// assumed clock and can never outlive the run); the drop's flight is the DECLARED presentational duration. dtKnown
// selects the delivered arm — the ONE seam where the MISSING clock changes the animation.
export const pulseDuration = (pair: CommsPair, dtUs: number, dtKnown: boolean): number =>
  pair.outcome === 'dropped' ? DROP_FLIGHT_TICKS
    : pair.latencyUs === null ? 0
    : dtKnown ? flightTicks(pair.latencyUs, dtUs) : MISSING_DELIVERED_FLIGHT_TICKS

// The SPATIAL fraction (0..1) along the src→dst link for a raw flight progress. A DELIVERED pulse runs the whole
// span (→1, lands at dst); the DROP decelerates (ease-out) and collapses at mid-span (→0.5). ONE home for the
// collapse geometry, shared by the view and its tests. Pure, no allocation.
const easeOut = (p: number): number => 1 - (1 - p) * (1 - p)
export const spatialAlong = (progress: number, isDrop: boolean): number =>
  isDrop ? easeOut(progress) * 0.5 : progress

// THE EXACT-CURRENT PULSE PROGRESS — the raw flight progress [0,1) of a pulse at the playhead, or null when the
// playhead is outside its window [t0, t0+dur). This is the ONE visibility+progress rule the render obeys, and the
// SHADER MIRRORS IT EXACTLY (aT0/aDur attributes + the uPlayhead uniform): visible ⇔ playhead ∈ [t0, t0+dur),
// progress = (playhead − t0)/dur. Because visibility is a pure function of the playhead, scrubs / pauses / the
// terminal frame need no special-casing — a pulse renders whenever the playhead is inside its window, and rests
// otherwise. (This retires the old interval-aware CPU pool AND its terminal-settle machinery: that pool was written
// on store writes and could latch a transient at rest; a per-frame in-shader uniform recomputes visibility every
// frame, so there is nothing to latch. The reveal-clock-driven anchor/ledger are untouched.)
export function pulseProgressAt(t0: number, dur: number, playhead: number): number | null {
  if (dur <= 0) return null
  return t0 <= playhead && playhead < t0 + dur ? (playhead - t0) / dur : null
}

// THE HERO PRESENTATION — the rendered INTENSITY of the hero pulse at the playhead, or null outside its (extended)
// window [t0, t0 + max(dur, HERO_PRESENT_TICKS)). The SHADER MIRRORS THIS EXACTLY (isHero attribute selects the wider
// window; the fragment multiplies the HDR hero colour by this intensity). Two phases, a pure function of the
// playhead: the COLLAPSE [t0, t0+dur) renders at full intensity 1 (the decoded instant — the 0.9-tick easeOut
// collapse via pulseProgressAt/spatialAlong, unchanged), then the declared AFTERGLOW [t0+dur, t0+window) decays the
// intensity linearly 1 → 0 across the linger (the position stays frozen at the collapse end — mid-span). A scrub /
// deep-link INTO the afterglow shows the correct decay point (honest); PAST the window shows nothing (the persistent
// anchor carries the loss on). This guarantees the emphasized moment is sampled at every supported cadence.
export function heroPresentationAt(t0: number, dur: number, playhead: number, afterglowMax = 1): number | null {
  const window = Math.max(dur, HERO_PRESENT_TICKS)
  if (!(t0 <= playhead && playhead < t0 + window)) return null // outside the extended window — not rendered
  if (playhead < t0 + dur) return 1                            // the collapse phase — full HDR intensity 1 (the ONE bloom)
  const linger = window - dur
  if (linger <= 0) return 1                                    // no afterglow (dur ≥ the window) — degenerate guard
  // THE AFTERGLOW STEPS DOWN to the sub-bloom cap at the phase boundary, then decays monotonically cap → 0. It is
  // NEVER continuous from 1: the collapse is the ONE bloom, the afterglow a visible-but-quiet fading ember. The cap
  // (afterglowMax, derived in the view from the hero colour's luminance vs the bloom threshold) is passed in so the
  // model mirror stays layer-clean; the shader mirrors this exactly (uAfterglowMax · the decay fraction).
  return afterglowMax * (1 - (playhead - (t0 + dur)) / linger)
}

// ── THE PRECOMPILED PULSE INSTANCES — all spawn data known at STAGE BUILD (nothing needs per-frame CPU writes) ──
// Every message's flight is STATIC per run: its window [t0, t0+dur), its from→to path, whether it is the collapsing
// drop, whether it is the hero. So the whole instance set is computed ONCE here and written into instanced buffer
// ATTRIBUTES at build time; the frame loop then writes only the playhead uniform (the entire per-frame CPU cost),
// and the shader derives each instance's position + visibility + bloom from these attributes and that uniform. A
// NON-RENDERABLE mapping yields ZERO instances — the stage withholds every trajectory, degrading AS ONE with the
// strip (lane withheld) and the chip (loss language withheld). The pinned behaviors all live here now: the drop's
// collapse (isDrop), the ONE bloom (isHero → the HDR colour), the MISSING-clock fixed flight (pulseDuration), and
// the !renderable withhold (empty). A vitest cannot see into the shader, so it pins THESE attribute values.
export interface PulseInstances {
  count: number
  t0: Float32Array     // per-instance window start (the send's tick)
  dur: Float32Array    // per-instance flight duration in ticks (pulseDuration — RECORDED latency×300/dt, or the MISSING fixed bound, or the drop bound)
  from: Float32Array   // count×3 — the path start (the src pad today; the endpoint-resolver seam feeds per-message endpoints later)
  to: Float32Array     // count×3 — the path end (the dst pad)
  isDrop: Float32Array // 1 = a dropped pulse (collapses at mid-span), 0 = delivered (runs to dst)
  isHero: Float32Array // 1 = the hero drop (the ONE HDR bloom), 0 = sub-bloom
}
export function buildPulseInstances(data: CommsData): PulseInstances {
  const pairs = data.renderable ? data.pairs : [] // !renderable → NO trajectories (degrade as one)
  const count = pairs.length
  const t0 = new Float32Array(count)
  const dur = new Float32Array(count)
  const from = new Float32Array(count * 3)
  const to = new Float32Array(count * 3)
  const isDrop = new Float32Array(count)
  const isHero = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const p = pairs[i]!
    t0[i] = p.send.tick
    dur[i] = pulseDuration(p, data.dtUs, data.dtKnown)
    from[i * 3] = COMMS_PAD_SRC[0]; from[i * 3 + 1] = COMMS_PAD_SRC[1]; from[i * 3 + 2] = COMMS_PAD_SRC[2]
    to[i * 3] = COMMS_PAD_DST[0]; to[i * 3 + 1] = COMMS_PAD_DST[1]; to[i * 3 + 2] = COMMS_PAD_DST[2]
    isDrop[i] = p.outcome === 'dropped' ? 1 : 0
    isHero[i] = p === data.hero ? 1 : 0
  }
  return { count, t0, dur, from, to, isDrop, isHero }
}

// ── THE COMPLETE APPLICABILITY PREDICATE (the sibling of queryStageApplies / sensingStageApplies) ────────────
// The comms lens applies to a run iff it is POSITIONLESS (the duet is a positionless form — Engine-only state,
// no entity flight to overlay) AND it carries comms events, AND it has NO kind-23 query draws. The last conjunct
// ARBITRATES against the query stage: both are positionless lenses (unlike the sensing stage, which the
// positioned/positionless split alone separates), so a positionless run carrying BOTH comms and kind-23 events
// would otherwise mount two stages. Comms yields to the query stage there (no certified bundle mixes them —
// f4 has comms and no kind-23; e0 has kind-23 and no comms — so today this is exactly f4 mounting and nothing
// else). This is the ONE predicate the stage MOUNT (Scene), the honesty CHIP (App) and the Inspector strip all
// route through; its NAME is what the registration pins as mountGate.
const GEOMETRY_QUERY_RESOLVED = 23
function hasKind23(source: CommsSource): boolean {
  for (let seq = 0; seq < source.eventCount; seq++) if (source.kindAt(seq) === GEOMETRY_QUERY_RESOLVED) return true
  return false
}
export function commsStageApplies(source: CommsSource): boolean {
  if (source.entityKeys().length !== 0) return false
  if (hasKind23(source)) return false
  return hasCommsEvents(buildCommsStage(source))
}

// ── THE LAW-4 DECLARATION, AS DATA — f4 is the THIRD conforming citizen of the provenance ledger ────────────
const K5 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-5 MessageSent)'
const K6 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-6 MessageDelivered)'
const K7 = 'contract/spec-3b-evidence-layer.md §11.1 (kind-7 MessageDropped)'
const CAUSATION = 'contract/spec-3b-evidence-layer.md §11.1 (event envelope causation_id — Spec 3a §3.6)'

// THE DELIVERED-PULSE PROVENANCE — TWO DISTINCT registered classes, so the truth per clock state is REACHABLE
// through the context-free static askPixel lookup (a single conditional function would never be routed to — the
// registry has no run state at lookup time). The CALLER picks the truthful id by dtKnown (deliveredPulseClassId);
// both ids are registered in COMMS_LEDGER and boot-validated:
//   • RECORDED (delivered-pulse-recorded): DERIVED-DISPLAY of the decoded latency_us × the pinned stretch — the
//     TIMING is decoded, only the path is presentational.
//   • MISSING (delivered-pulse-missing): pulseDuration ignores BOTH dtUs and latency (a fixed bound), so the flight
//     is PURELY PRESENTATIONAL — every crossing animates identically, no timing datum; the decoded claim withheld.
export const DELIVERED_PULSE_RECORDED_ID = 'delivered-pulse-recorded'
export const DELIVERED_PULSE_MISSING_ID = 'delivered-pulse-missing'
// The CALLER's id selector — a rendered delivered pulse asks under THIS id, so a MISSING run resolves the
// presentational answer and a RECORDED run the decoded one (the registry stays context-free — the caller carries the state).
export const deliveredPulseClassId = (dtKnown: boolean): string =>
  dtKnown ? DELIVERED_PULSE_RECORDED_ID : DELIVERED_PULSE_MISSING_ID
export function deliveredPulseClass(dtKnown: boolean): PixelClass {
  return dtKnown
    ? { id: DELIVERED_PULSE_RECORDED_ID, tier: 'derived-display', source: `${K6} (latency_us · the ×${PULSE_STRETCH} pinned stretch)`,
        answer: `a DELIVERED pulse's flight is a display-tier derivation — its true decoded latency_us stretched by the ONE pinned ×${PULSE_STRETCH} constant (bounded so no pulse crosses a tick boundary) along the presentational link; the TIMING is decoded, only the path is presentational` }
    : { id: DELIVERED_PULSE_MISSING_ID, tier: 'presentational', source: null,
        answer: 'without a recorded tick period a DELIVERED pulse\'s flight is PURELY PRESENTATIONAL — a fixed declared bound (the animation ignores BOTH the tick period and the decoded latency, so every crossing animates identically); it encodes no timing datum, and the decoded-timing claim is withheld' }
}

const COMMS_LEDGER: readonly PixelClass[] = [
  { id: 'station-pads', tier: 'presentational', source: null,
    answer: 'the two station pads (src, dst) are presentational placement — the endpoints are pinned scenario content (Engine-only state, no entity partition), so they are PADS, not decoded drone poses; the layout encodes no datum' },
  { id: 'link-baseline', tier: 'presentational', source: null,
    answer: 'the link baseline between the pads is a presentational spine — it encodes no data, only "these two stations are the one link"' },
  deliveredPulseClass(true),  // delivered-pulse-recorded — production f4 (RECORDED); the rendered pulse asks under this id when dtKnown
  deliveredPulseClass(false), // delivered-pulse-missing — a manifestless run asks under THIS id; reachable through askPixel, boot-validated
  { id: 'drop-pulse-flight', tier: 'presentational', source: null,
    answer: `a DROPPED pulse carries no latency (kind-7 has none), so its flight is a presentational ESTIMATE — a declared fixed duration (the fizzle's decelerate-and-collapse), chip-declared like the station pads; it encodes no timing datum, only "here is where the loss happens". The HERO drop then LINGERS: after the collapse (the decoded instant) a declared AFTERGLOW persists ~${HERO_PRESENT_TICKS} ticks, decaying to zero — presentational persistence (never a decoded duration) sized so the run's one emphasized moment is sampled at every playback cadence, joining the declared-presentational family` },
  { id: 'latency-lane', tier: 'decoded', source: K6,
    answer: 'each latency-lane mark is a decoded kind-6 latency_us (the sim-time transit delta) on a FIXED 0–400µs axis — never auto-fit, so a steady link never renders float noise as fake weather' },
  { id: 'snr-readout', tier: 'decoded', source: `${K5}/${K6}/${K7} (snr_db)`,
    answer: 'the SNR readout is the decoded snr_db shown plain — on f4 it is the single constant 12.04 dB across all 64 comms events, labelled "constant this run" (a steady channel, no weather)' },
  { id: 'drop-anchor', tier: 'decoded', source: `${K7} (reason LOSS=3, jam_state)`,
    answer: 'the drop anchor is the decoded kind-7 outcome — reason LOSS, jam_state 0 — a data-true channel loss, marked at mid-span by a persistent label naming its DECODED tick and reason word (e.g. "t30 · LOSS", derived from the hero pair, never a literal string); it wears the quality register (the attested mark plus a caveat note), a fitness fact about the link, never the integrity mismatch mark',
    // THE QUALITY CAVEAT, MACHINE-READABLE ON THE PIXEL: the drop's voice is the quality register's, declared
    // HERE so the registry authority (pixelVoice → the attested mark, never the sealed ✓) and the CommsStrip render
    // resolve through ONE source — so the registry authority and the render can never split on the drop's voice.
    caveat: 'link-loss' },
  { id: 'outcome-pairing', tier: 'recomputed', source: `${K5}/${K6}/${K7} (msg id) · ${CAUSATION} · ${K5}/${K6} (src/dst endpoints)`,
    answer: 'the send-to-outcome pairing is checked for decoded self-consistency across THREE independent readings of the bytes — every outcome matched to a send by its msg id, INDEPENDENTLY every causation edge resolved to that send, AND every delivered receipt\'s own src/dst matching its send\'s endpoints — three readings that agree; it wears the self-consistent ring (no external oracle), never the manifest-verified check mark. A single mark, but attributable: the strip names each reading\'s state, so a mismatch always points to one check',
    agree: { basis: 'decoded-consistency', decoded: 'comms:pairing-vs-causation-vs-endpoints' } },
  { id: 'ledger-tally', tier: 'derived-display', source: `${K5}/${K6}/${K7} (the reveal-clock prefix counts)`,
    answer: 'the sent / delivered / lost tally is a display-tier prefix count of the decoded events with tick ≤ the playhead — written by the viewer\'s own scrub, never a precomputed reveal-independent total; at full reveal it reads 32 / 31 / 1' },
  { id: 'not-yet-drop', tier: 'decoded', source: K7,
    answer: 'before its tick the recorded drop is the future rendered in the NOT-YET voice (hollow, never blooming); at its tick the playhead writes it and the persistent anchor remains (constitution §4)' },
  { id: 'presentational', tier: 'presentational', source: null,
    answer: 'the camera, the pulse bloom easing, the spent-pulse fade and the fog encode no data' },
]

// The static honesty chip — the ALWAYS-TRUE claim, DERIVED from the ledger and test-pinned against it
// (chipAgreesWithLedger): it claims decoded-real (the ledger has decoded classes) and names NO scenario
// constants (the pads are presentational — the endpoint resolver's positionless arm). It carries NO run-specific
// counts, "steady link", or pulse-TIMING claim — those depend on the run's data/manifest (a manifestless run has
// no recorded tick period), so the App derives them per-run from the decoded content via commsChipCopy. Honest
// degeneration: no receiver belief exists in the bytes, so the lens is sent-vs-arrived and the chip says only that.
export const COMMS_HONESTY =
  'sent & arrived are decoded-real — station placement is presentational; sent-vs-arrived only (the bytes carry no receiver belief)'

export const F4_COMMS_REGISTRATION: LensRegistration = validateRegistration({
  id: 'f4-comms',
  question: {
    primary: 'What was said? (Q4 — every transmission on the link, and the one that never arrived)',
    adjacent: ['Q5 can I trust this pixel (the decoded-consistency pairing ring + the ledger)', 'Q1-adjacent when did each message cross the link'],
  },
  surfaces: { stage: 'CommsStage', instrument: 'CommsStrip' },
  // LAW 2 — borrowed token NAMES only: the comms category violet carries the lens identity; the drop wears the
  // quality register's pending slate (the • attested mark's hue); the ledger/pairing wear the self ring's slate;
  // pads and quiet chrome wear textDim; selection is accent.
  borrowedHues: ['category:comms', 'pending', 'accent', 'textDim', 'textPrimary'],
  dims: 'one bloom per run — the t30 fizzle; every clean pulse is unbloomed and spent, the SNR lane is a labelled hairline, the ledger rests on its final tally through the silent tail so the ONE loss reads',
  emptyState: 'a run with no comms events (or a positioned run, or a positionless run whose kinds carry query draws) mounts no comms stage and wears no chip — the shared commsStageApplies gate (positionless AND comms-kinds AND no kind-23), the same fail-closed idiom the query/sensing lenses use',
  honestyChip: COMMS_HONESTY,
  tourId: 'f4-comms', // the authored guided tour for this lens — "the one lost packet" (TOURS.f4); the derived
                      // pointer at the tour registry, pinned against it by the tour-drift test (tourId ⟺ hasTour)
  mountGate: commsStageApplies.name,
  provenance: COMMS_LEDGER,
})
