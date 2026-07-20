import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { asEventTick } from '../lib/brand'
import {
  buildCommsStage, ledgerAt, revealedPairs, dropRevealAt, pulseProgressAt, spatialAlong, pulseDuration, flightTicks,
  commsStageApplies, hasCommsEvents, supportedDropCaveat, commsChipCopy, commsAnomalyCount,
  deliveredPulseClass, deliveredPulseClassId, heroPresentationAt,
  DROP_FLIGHT_TICKS, HERO_PRESENT_TICKS, PULSE_STRETCH, F4_COMMS_REGISTRATION, COMMS_HONESTY,
  type CommsData, type CommsSource, type CommsPair,
} from './commsStage'
import { checkPairing } from './commsMath'
import { recomputedVerdict } from './lensContract'
import { ASSUMED_DT_US, WITNESS_RUN_SECONDS } from '../state/transport'
import { SPEEDS } from '../state/speeds'
import type { MessageSent, MessageDelivered, MessageDropped } from '../decode/payloads'
import type { RunManifest } from '../decode/manifest'

// ── THE COMMS LENS ORACLE — the model derivations pinned against the frozen f4 bundle, through the real
// decoders (the messageTrack.oracle.test.ts posture: every literal is what the decode MUST reproduce, never a
// copy of a design table). The ground truth: 32 sent / 31 delivered / 1 lost = msg 14 @ tick 30, reason LOSS,
// jam 0, snr constant 12.041199826559248, latency 134–375µs, src 1 → dst 2, channel 1, tx 256 W.

function detFixture(name: string): ArrayBuffer {
  try {
    const b = readFileSync(`contract/fixtures/${name}.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } catch {
    const base = `contract/fixtures/${name}`
    const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
    const b = readFileSync(`${base}/${dir}/bundle.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
}
// f4's recorded tick period is dt = 125000µs. Production passes the loaded manifest to RunModel, so f4's pulse
// clock is dtKnown; the model tests pass a manifest carrying that dt so they match production (the comms path
// reads only manifestDtUs, so a minimal manifest suffices). modelWithDt drives a DIFFERENT recorded period.
const modelWithDt = (name: string, dtUs: number): RunModel =>
  new RunModel(decodeBundle(detFixture(name)), { dtUs } as unknown as RunManifest)
const modelFor = (name: string): RunModel => modelWithDt(name, 125000)

describe('buildCommsStage — the pairing table and the counts against the frozen f4 bundle', () => {
  const model = modelFor('f4_seed42')
  const data: CommsData = buildCommsStage(model)

  test('32 sends / 31 delivered / 1 dropped — every send accounted for by exactly one outcome', () => {
    expect(data.sends.length).toBe(32)
    expect(data.pairs.filter(p => p.outcome === 'delivered').length).toBe(31)
    expect(data.pairs.filter(p => p.outcome === 'dropped').length).toBe(1)
    expect(data.pairs.length).toBe(32)
    expect(data.orphanOutcomes).toEqual([])
    expect(data.allPaired).toBe(true)
  })

  test('the ONE loss: msg 14 dropped at tick 30, reason 3 (LOSS), jam_state 0', () => {
    expect(data.drop).not.toBeNull()
    expect(data.drop!.msg).toBe(14n)
    expect(data.drop!.outcomeTick).toBe(30)
    expect(data.drop!.send.tick).toBe(30) // the send lands on the drop's own tick (latency sub-tick)
    expect(data.drop!.reason).toBe(3)     // LOSS (not JAMMED=1, not RANGE=2)
    expect(data.drop!.jamState).toBe(0)   // jam inactive — no contested-channel overclaim
    expect(data.drop!.latencyUs).toBeNull() // a drop carries no latency
  })

  test('one steady link: src 1 → dst 2, channel 1, tx 256 W', () => {
    expect(data.link).toEqual({ src: 1n, dst: 2n, channel: 1, txPowerW: 256 })
  })

  test('snr is the single constant 12.041199826559248 across all comms events (zero weather)', () => {
    expect(data.snrConstant).not.toBeNull()
    expect(Object.is(data.snrConstant, 12.041199826559248)).toBe(true)
  })

  test('the delivered latency lane spans 134–375µs (decoded verbatim)', () => {
    const lat = data.pairs
      .filter(p => p.outcome === 'delivered')
      .map(p => Number(p.latencyUs))
      .sort((a, b) => a - b)
    expect(lat[0]).toBe(134)
    expect(lat.at(-1)).toBe(375)
    expect(lat.length).toBe(31)
  })

  test('THE FREE INTEGRITY EVIDENCE: every causation edge resolves to its send — the pairing is self-consistent', () => {
    expect(data.allCausationOk).toBe(true)
    for (const p of data.pairs) expect(p.causationOk).toBe(true)
  })
})

// ── THE LEDGER-BY-SCRUB — the running tally is the reveal clock's PREFIX counts, never a precomputed total ────
describe('ledgerAt — the sent/delivered/lost tally is written by the playhead, at the ≤ boundary', () => {
  const data = buildCommsStage(modelFor('f4_seed42'))
  const led = (t: number) => ledgerAt(data, asEventTick(t))

  test('before the first send the ledger is empty', () => {
    expect(led(0)).toEqual({ sent: 0, delivered: 0, lost: 0 })
    expect(led(1)).toEqual({ sent: 0, delivered: 0, lost: 0 })
  })

  test('JUST BEFORE the loss (tick 29) the ledger is 14 sent · 14 delivered · 0 lost — the drop is NOT-YET', () => {
    // Sends are every 2 ticks over 2..64; ticks ≤ 29 are 2,4,…,28 = 14 sends, all delivered.
    expect(led(29)).toEqual({ sent: 14, delivered: 14, lost: 0 })
    expect(dropRevealAt(data, asEventTick(29))).toBe('not-yet')
  })

  test('AT the loss (tick 30) the ledger ticks 1 lost — 15 sent · 14 delivered · 1 lost — the drop ANCHORS', () => {
    // The msg-14 send and its drop both land on tick 30, so both are revealed at the ≤ boundary.
    expect(led(30)).toEqual({ sent: 15, delivered: 14, lost: 1 })
    expect(dropRevealAt(data, asEventTick(30))).toBe('anchored')
  })

  test('full reveal reads 32 / 31 / 1 — and sent always equals delivered + lost (every send has its outcome)', () => {
    // Tick 95 is the run's silent tail end (sends run to tick 64; ticks 65..95 are silent) — a playhead there
    // has revealed every outcome, so the ledger rests on the final tally.
    expect(led(95)).toEqual({ sent: 32, delivered: 31, lost: 1 })
    for (const t of [0, 10, 29, 30, 31, 64, 95]) {
      const l = led(t)
      expect(l.sent, `sent = delivered + lost at tick ${t}`).toBe(l.delivered + l.lost)
    }
  })

  test('revealedPairs grows monotonically and reaches all 32 at full reveal', () => {
    expect(revealedPairs(data, asEventTick(1)).length).toBe(0)
    expect(revealedPairs(data, asEventTick(30)).length).toBe(15)
    expect(revealedPairs(data, asEventTick(95)).length).toBe(32)
  })
})

// ── THE PULSE VISIBILITY + COLLAPSE — pulseProgressAt (exact-current) + spatialAlong, the shader's mirrors ────
// In-shader, visibility is a pure function of the playhead uniform: visible ⇔ playhead ∈ [t0, t0+dur), progress
// (playhead−t0)/dur. pulseProgressAt IS that rule (the shader mirrors it), so a scrub / pause / terminal rest shows
// exactly the pulses whose windows contain the playhead — nothing to latch, no interval or settle special-casing.
describe('the pulse primitives — exact-current visibility + the drop collapse (the shader\'s mirror)', () => {
  const data = buildCommsStage(modelFor('f4_seed42'))
  const dropDur = DROP_FLIGHT_TICKS

  test('exact-current: the drop pulse renders only INSIDE its [30, 30.9) window (a pure function of the playhead)', () => {
    expect(pulseProgressAt(30, dropDur, 29.99)).toBeNull()          // before t30 — the link is quiet
    expect(pulseProgressAt(30, dropDur, 30)).toBeCloseTo(0, 9)      // launches at the source (progress 0)
    expect(pulseProgressAt(30, dropDur, 30 + dropDur / 2)).toBeGreaterThan(0)
    expect(pulseProgressAt(30, dropDur, 30 + dropDur)).toBeNull()   // window closed — the anchor takes over
    expect(pulseProgressAt(30, dropDur, 95)).toBeNull()             // the terminal rest shows nothing (no latch)
  })

  test('spatialAlong: a delivered pulse runs the full span; the DROP collapses at mid-span (never past 0.5)', () => {
    expect(spatialAlong(0, false)).toBeCloseTo(0, 9)
    expect(spatialAlong(1, false)).toBeCloseTo(1, 9)     // delivered lands at dst
    expect(spatialAlong(0, true)).toBeCloseTo(0, 9)      // drop launches at src
    expect(spatialAlong(1, true)).toBeCloseTo(0.5, 9)    // drop collapses AT mid-span, never past it
    for (const p of [0.1, 0.37, 0.5, 0.9]) expect(spatialAlong(p, true)).toBeLessThanOrEqual(0.5)
  })

  test('a delivered flight is < 1 tick and mid-window renders (the ×300 stretch never crosses a tick boundary)', () => {
    expect(PULSE_STRETCH).toBe(300)
    const first = data.pairs.find(p => p.outcome === 'delivered' && p.send.tick === 2)!
    const dur = flightTicks(first.latencyUs!, data.dtUs)
    expect(dur).toBeGreaterThan(0)
    expect(dur).toBeLessThan(1)
    expect(pulseProgressAt(2, dur, 2 + dur / 2)).toBeCloseTo(0.5, 9) // linear along the span
    for (const p of data.pairs) if (p.outcome === 'delivered') expect(flightTicks(p.latencyUs!, data.dtUs)).toBeLessThan(1)
  })

  // The old interval-aware pool and its terminal-settle machinery are RETIRED by the in-shader move: a per-frame
  // uniform recompute cannot latch a transient, and a window jumped past between frames is simply not shown that
  // frame (the persistent reveal-clock anchor marks the loss durably). What remains is the exact-current rule above.
  test('exact-current is order-free: a window jumped PAST shows nothing; landing IN it shows it — no interval memory', () => {
    expect(pulseProgressAt(30, dropDur, 31)).toBeNull()      // the playhead is past the closed window — quiet
    expect(pulseProgressAt(30, dropDur, 40)).toBeNull()      // far past — quiet (no interval to "catch" it)
    expect(pulseProgressAt(30, dropDur, 30)).toBeCloseTo(0, 9) // landing at the window start shows it
  })
})

// ── THE HERO MOMENT IS CADENCE-SAFE — a declared linger window, sampled at every supported playback stride ──────
// The 0.9-tick collapse is smaller than a coarse stride, so a pure-uniform sample could jump clean over the run's
// ONE emphasized moment. The HERO's window widens to [t0, t0 + max(dur, HERO_PRESENT_TICKS)): the collapse completes
// first (the decoded instant), then a declared afterglow decays to zero. Sized so the window width ≥ the worst
// supported stride, guaranteeing at least one frame samples it at every cadence (a window W ≥ stride S always
// contains a sample of an S-spaced sweep) — INCLUDING the terminal (clamped) frame at the run's end.
describe('the hero moment is cadence-safe — every supported cadence samples the linger window (incl. the terminal frame)', () => {
  const model = modelFor('f4_seed42')
  const maxTick = model.tickCount
  const dropDur = DROP_FLIGHT_TICKS
  // the per-frame tick stride advancePlayhead applies at a given speed + refresh: (dtMs/1000)·speed·maxTick/WITNESS.
  const strideOf = (speed: number, fps: number): number => (speed * maxTick) / (fps * WITNESS_RUN_SECONDS)
  // a contiguous sweep 0 → end (the terminal frame clamps to end); did ANY sample land in the hero window?
  const heroSampled = (t0: number, end: number, s: number): boolean => {
    for (let ph = 0; ; ph += s) {
      const sample = Math.min(ph, end)               // the terminal frame clamps to the run end
      if (heroPresentationAt(t0, dropDur, sample) !== null) return true
      if (sample >= end) return false
    }
  }
  const cadences: [string, number][] = SPEEDS.flatMap(sp =>
    [[`${sp}x/30Hz`, strideOf(sp, 30)], [`${sp}x/60Hz`, strideOf(sp, 60)]] as [string, number][])

  test.each(cadences)('at %s the stride ≤ the linger window, and a sweep samples the hero window at least once', (_label, stride) => {
    expect(stride).toBeLessThanOrEqual(HERO_PRESENT_TICKS)   // window width ≥ stride ⇒ a sample is guaranteed
    expect(heroSampled(30, maxTick, stride)).toBe(true)       // the mid-run hero (t30) is sampled at this cadence
  })

  test('the TERMINAL crossing: a hero near the run end is sampled by the last (clamped) frame at the worst stride', () => {
    const worst = Math.max(...cadences.map(([, s]) => s))
    expect(worst).toBeLessThanOrEqual(HERO_PRESENT_TICKS)
    // a run that ENDS one tick into the hero (drop at end−1): the last stride crosses t0 and the terminal frame
    // clamps to the run end, which lands INSIDE the still-open linger window → the moment is not lost at the ending.
    expect(heroSampled(29, 30, worst)).toBe(true)
    // a hero whose linger window extends PAST the run end is still caught by the clamped terminal frame.
    expect(heroSampled(30, 31, worst)).toBe(true)
  })
})

// ── THE AFTERGLOW MIRROR — heroPresentationAt: the collapse blooms, then a SUB-BLOOM ember steps down + decays ──
// The shader mirrors this exactly (isHero widens the window; the fragment scales the HDR hero colour by the intensity).
// The collapse is intensity 1 (the ONE bloom); the afterglow STEPS DOWN to a sub-bloom cap (afterglowMax) at the phase
// boundary, then decays cap → 0 — NEVER continuous from 1 (it must be sub-bloom from its first frame). A scrub INTO
// the afterglow shows the correct decay point (honest); PAST the window shows nothing (the anchor carries on). The
// cap is passed in (the view derives it from the colour vs the bloom threshold; here a representative cap pins the shape).
describe('heroPresentationAt — the collapse blooms full, the afterglow steps to a sub-bloom cap and decays to zero', () => {
  const t0 = 30, dur = DROP_FLIGHT_TICKS
  const window = Math.max(dur, HERO_PRESENT_TICKS)
  const linger = window - dur
  const cap = 0.3 // a representative sub-bloom cap (the view derives the real one from luminance vs the threshold)

  test('the COLLAPSE phase [t0, t0+dur) renders at full intensity 1 (the decoded instant — the bloom), cap-independent', () => {
    expect(heroPresentationAt(t0, dur, t0, cap)).toBe(1)             // launch
    expect(heroPresentationAt(t0, dur, t0 + dur * 0.5, cap)).toBe(1) // mid-collapse — still full (the cap does NOT touch the collapse)
    expect(heroPresentationAt(t0, dur, t0 + dur * 0.999, cap)).toBe(1)
    // the collapse POSITION completes through its original 0.9-tick easeOut curve (pulseProgressAt + spatialAlong,
    // unchanged), landing at mid-span; through the afterglow the position freezes there (progress clamps to 1).
    expect(pulseProgressAt(t0, dur, t0 + dur * 0.5)).toBeCloseTo(0.5, 9)
    expect(spatialAlong(1, true)).toBeCloseTo(0.5, 9)          // the frozen afterglow position — mid-span
  })

  test('the AFTERGLOW STEPS DOWN to the cap at the boundary (never continuing from 1), then decays cap → 0', () => {
    // the STEP-DOWN: just before the boundary the collapse is 1; AT the boundary the emphasis is the sub-bloom cap.
    expect(heroPresentationAt(t0, dur, t0 + dur - 1e-6, cap)).toBe(1)                     // last collapse frame — full bloom
    expect(heroPresentationAt(t0, dur, t0 + dur, cap)).toBeCloseTo(cap, 9)                // FIRST afterglow frame — the cap (a step DOWN)
    expect(heroPresentationAt(t0, dur, t0 + dur + linger * 0.5, cap)).toBeCloseTo(cap * 0.5, 9)  // mid-linger — cap decayed halfway
    expect(heroPresentationAt(t0, dur, t0 + dur + linger * 0.75, cap)).toBeCloseTo(cap * 0.25, 9) // a scrub INTO the tail → its decay point
    expect(heroPresentationAt(t0, dur, t0 + window - 1e-6, cap)).toBeCloseTo(0, 6)        // window end → 0
    // MONOTONIC and never above the cap across the whole afterglow (never re-blooms).
    for (const f of [0, 0.1, 0.4, 0.6, 0.9]) expect(heroPresentationAt(t0, dur, t0 + dur + linger * f, cap)!).toBeLessThanOrEqual(cap + 1e-9)
  })

  test('PAST the window renders NOTHING — the persistent anchor carries the loss on (scrub/deep-link exactness)', () => {
    expect(heroPresentationAt(t0, dur, t0 + window, cap)).toBeNull()  // exactly at the window end (right-open) → nothing
    expect(heroPresentationAt(t0, dur, t0 + window + 5, cap)).toBeNull()
    expect(heroPresentationAt(t0, dur, t0 - 0.01, cap)).toBeNull()    // before t0 → nothing
  })
})

// ── THE NEAR-TERMINAL HERO COMPLETES ITS DECAY — the effective playhead (uPlayhead + terminal fade) reaches 0 ────
// A hero at maxTick−1 has a window extending past the run; at terminal rest uPlayhead clamps at maxTick, so the
// afterglow would freeze at a positive intensity — visible forever. The terminal fade adds to the hero's playhead so
// the EFFECTIVE playhead reaches the window end (intensity 0, then clipped). Here the shader-mirror math is pinned:
// heroPresentationAt at the clamped playhead is stuck > 0; advancing the effective playhead drives it to 0, then null.
describe('the near-terminal hero completes its decay via the effective (fade-advanced) playhead — never a stuck bloom', () => {
  const dur = DROP_FLIGHT_TICKS
  const cap = 0.3
  const t0 = 29, maxTick = 30                       // a hero one tick before the run end (window [29, 33) ⊃ maxTick 30)
  const windowEnd = t0 + Math.max(dur, HERO_PRESENT_TICKS) // 33

  test('at the CLAMPED playhead the afterglow is stuck > 0 (the bug), and advancing the fade drives it to 0 then null', () => {
    // uPlayhead frozen at maxTick: the effective playhead is maxTick + fade. fade 0 → stuck at a positive intensity.
    const stuck = heroPresentationAt(t0, dur, maxTick, cap)
    expect(stuck).not.toBeNull()
    expect(stuck!).toBeGreaterThan(0)               // the near-terminal hero would bloom forever without the fade
    // advance the fade toward the remaining linger (windowEnd − maxTick = 3): the effective playhead sweeps to the
    // window end, the intensity decays monotonically to 0, and past it the pulse disappears (null → clipped).
    const remaining = windowEnd - maxTick           // 3 ticks of fade complete the decay
    let prev = stuck!
    for (const f of [0.5, 1.5, 2.5]) {
      const v = heroPresentationAt(t0, dur, maxTick + f, cap)!
      expect(v).toBeLessThan(prev)                  // strictly decreasing as the fade advances
      prev = v
    }
    expect(heroPresentationAt(t0, dur, maxTick + remaining - 1e-6, cap)).toBeCloseTo(0, 6) // fade complete → intensity 0
    expect(heroPresentationAt(t0, dur, maxTick + remaining, cap)).toBeNull()               // at the window end → disappears
  })
})

// ── THE GRAMMAR PINS — the ○ pairing (never ✓) and the mount arbitration ─────────────────────────────────────
describe('the pairing wears the ○ self-consistent ring, NEVER the ✓ (decoded-consistency, no external oracle)', () => {
  const data = buildCommsStage(modelFor('f4_seed42'))

  test('checkPairing agrees on f4, and recomputedVerdict resolves the DECLARED arm to selfConsistent — not verified', () => {
    const { summary, agreed } = checkPairing(data)
    expect(summary.paired).toBe(true)
    expect(summary.causationOk).toBe(true)
    expect(summary.endpointOk).toBe(true) // the THIRD reading — f4's receipts all name their send's endpoints
    expect(summary.agreed).toBe(true)
    // The arm is resolved from the REGISTRATION (the ask-any-pixel authority), not a bare literal here.
    const cls = F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'outcome-pairing')!
    expect(cls.tier).toBe('recomputed')
    expect(cls.agree).toEqual({ basis: 'decoded-consistency', decoded: 'comms:pairing-vs-causation-vs-endpoints' })
    expect(agreed, 'f4 is consistent — a FORMED agreement, not an unformed check').not.toBeNull()
    const rv = recomputedVerdict(cls.agree!, agreed!)
    expect(rv.mark).toBe('selfConsistent') // the ring, never 'verified'
    expect(rv.mark).not.toBe('verified')
  })
})

// ── THE PAIRING IS A BIJECTION, not a cardinality match ─────────────────────────────────────────────────────
// A synthetic source: two sends (A, B), but TWO delivered outcomes for A and NONE for B. |pairs| would equal
// |sends| under a count check — yet it is NOT a pairing (B is unmatched, A double-claimed). allPaired must be
// false, so the ○ is never minted for it.
describe('a duplicate-outcome / unmatched-send source does NOT mint the self-consistent ring', () => {
  // Two sends msg 1 (tick 2) and msg 2 (tick 4); outcomes: delivered msg 1 (seq 2), delivered msg 1 AGAIN (seq 3).
  const source: CommsSource = {
    eventCount: 4, tickCount: 6, ticks: [2, 4, 2, 4],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 || s === 1 ? 5 : 6),
    messageSentAt: (s): MessageSent | null =>
      s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
        : s === 1 ? { msg: 2n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
    messageDeliveredAt: (s): MessageDelivered | null =>
      (s === 2 || s === 3) ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null, // BOTH claim msg 1
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 2 ? 0 : s === 3 ? 0 : null),
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('the hostile counterexample: a cardinality check would pass, but the bijection guard refuses', () => {
    expect(data.pairs.length).toBe(1)                    // only ONE valid pair — the second outcome is a duplicate
    expect(data.duplicateOutcomes).toEqual([3])          // the second msg-1 outcome — rejected, never hidden
    expect(data.allPaired).toBe(false)                   // NOT a bijection (send B unmatched, A double-claimed)
    const { agreed } = checkPairing(data)
    expect(agreed, 'a duplicate is a REAL disagreement, not an unformed check').not.toBeNull()
    expect(recomputedVerdict(F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'outcome-pairing')!.agree!, agreed!).mark)
      .toBe('mismatch')                                  // an actual disagreement earns the mismatch, never the ring
  })
})

// ── the drop's caveat is DERIVED from the decoded reason/jam, never assumed ─────────────────────────────────
describe('supportedDropCaveat classifies the DECODED drop shape, failing closed on the unsupported', () => {
  const mk = (reason: number, jamState: number): CommsPair => ({
    msg: 14n, send: { seq: 0, tick: 30, msg: 14n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 },
    outcomeSeq: 1, outcomeTick: 30, outcome: 'dropped', latencyUs: null, reason, jamState, snrDb: 12, causationOk: true, endpointOk: true,
  })
  test('reason LOSS (3) + jam inactive (0) → the link-loss caveat; every other shape fails closed (null)', () => {
    expect(supportedDropCaveat(mk(3, 0))).toBe('link-loss') // the f4 shape
    expect(supportedDropCaveat(mk(1, 0))).toBeNull()        // JAMMED — the lens does not yet describe it
    expect(supportedDropCaveat(mk(2, 0))).toBeNull()        // RANGE
    expect(supportedDropCaveat(mk(3, 1))).toBeNull()        // LOSS but jam ACTIVE — an unsupported contested shape
  })
  test('the real f4 drop is the supported shape, and its caveat kind IS the drop-anchor pixel declaration', () => {
    const drop = buildCommsStage(modelFor('f4_seed42')).drop!
    const declared = F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'drop-anchor')!.caveat
    expect(declared).toBe('link-loss')
    expect(supportedDropCaveat(drop)).toBe(declared) // the decoded shape EARNS the declared caveat
  })
})

// ── the chip copy is EARNED from the decoded content, never asserted ────────────────────────────────────────
describe('commsChipCopy derives the run story; a send-only source renders honest counts, not the f4 story', () => {
  test('the real f4 renders the full story (steady link, 32/31/1, the one lost packet)', () => {
    const copy = commsChipCopy(buildCommsStage(modelFor('f4_seed42')))
    expect(copy).toContain('32 sent · 31 delivered · 1 lost')
    expect(copy).toContain('steady link')            // the SNR is in fact constant on f4
    expect(copy).toContain('the one packet that never arrived')
  })
  // A send-only run cannot PROVE "no loss" (its one send is unresolved), so the copy shows honest
  // incompleteness (recorded + unresolved counts) and NEVER the "no packet lost" assurance.
  test('a positionless SEND-ONLY source (1 sent, 0 outcomes) shows honest incompleteness, never a no-loss assurance', () => {
    const source: CommsSource = {
      eventCount: 1, tickCount: 4, ticks: [2],
      entityKeys: () => [],
      kindAt: () => 5,
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 9, txPowerW: 256 } : null),
      messageDeliveredAt: (): MessageDelivered | null => null,
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: () => null,
      manifestDtUs: () => 125000,
    }
    const data = buildCommsStage(source)
    expect(data.allPaired).toBe(false) // one send with no outcome — the mapping is NOT complete
    const copy = commsChipCopy(data)
    expect(copy).toContain('1 sent')
    expect(copy).toContain('0 outcomes recorded')
    expect(copy).toContain('1 unresolved')
    expect(copy).toContain('outcome mapping incomplete')
    expect(copy).not.toContain('no packet lost')                  // the false assurance it cannot prove
    expect(copy).not.toContain('0 lost')                          // no loss count on an incomplete mapping
    expect(copy).not.toContain('the one packet that never arrived')
    expect(copy).not.toContain('32')
  })
})

// ── THE GRAMMAR PINS — the ○ pairing (never ✓) and the mount arbitration ─────────────────────────────────────
describe('the pairing wears the ○ self-consistent ring, NEVER the ✓ (decoded-consistency, no external oracle)', () => {
  const data = buildCommsStage(modelFor('f4_seed42'))

  test('checkPairing agrees on f4, and recomputedVerdict resolves the DECLARED arm to selfConsistent — not verified', () => {
    const { summary, agreed } = checkPairing(data)
    expect(summary.paired).toBe(true)
    expect(summary.causationOk).toBe(true)
    expect(summary.endpointOk).toBe(true) // the THIRD reading — f4's receipts all name their send's endpoints
    expect(summary.agreed).toBe(true)
    // The arm is resolved from the REGISTRATION (the ask-any-pixel authority), not a bare literal here.
    const cls = F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'outcome-pairing')!
    expect(cls.tier).toBe('recomputed')
    expect(cls.agree).toEqual({ basis: 'decoded-consistency', decoded: 'comms:pairing-vs-causation-vs-endpoints' })
    expect(agreed, 'f4 is consistent — a FORMED agreement, not an unformed check').not.toBeNull()
    const rv = recomputedVerdict(cls.agree!, agreed!)
    expect(rv.mark).toBe('selfConsistent') // the ring, never 'verified'
    expect(rv.mark).not.toBe('verified')
  })
})

describe('commsStageApplies — the mount gate, pinned against the REAL bundles (mirrors the query/sensing gates)', () => {
  test('f4 mounts the comms stage (positionless, comms-kinds, no kind-23)', () => {
    const model = modelFor('f4_seed42')
    expect(commsStageApplies(model)).toBe(true)
    expect(hasCommsEvents(buildCommsStage(model))).toBe(true)
  })

  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42'])('%s does NOT mount the comms stage', (name) => {
    const model = modelFor(name)
    expect(commsStageApplies(model)).toBe(false)
    expect(hasCommsEvents(buildCommsStage(model))).toBe(false)
  })
})

// ── the hero is EXACTLY ONE SUPPORTED DROP; supported+unsupported two-drop yields NO hero ──────────────────
describe('a supported + unsupported two-drop run has no hero (no bloom, no "one lost packet")', () => {
  // sends msg 1 (@t2), msg 2 (@t4); drops: msg 1 LOSS jam-0 (supported), msg 2 JAMMED jam-1 (unsupported).
  const source: CommsSource = {
    eventCount: 4, tickCount: 6, ticks: [2, 4, 2, 4],
    entityKeys: () => [],
    kindAt: (s) => (s < 2 ? 5 : 7),
    messageSentAt: (s): MessageSent | null =>
      s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
        : s === 1 ? { msg: 2n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (s): MessageDropped | null =>
      s === 2 ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 }   // supported LOSS
        : s === 3 ? { msg: 2n, reason: 1, snrDb: 12, jamState: 1 } : null, // unsupported JAMMED
    parentOf: (s) => (s === 2 ? 0 : s === 3 ? 1 : null),
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('two drops (one supported, one not) ⇒ NO hero, the mapping is still a complete bijection', () => {
    expect(data.drops.length).toBe(2)
    expect(data.allPaired).toBe(true)          // every send has exactly one outcome — a complete bijection…
    expect(data.hero).toBeNull()               // …but 2 drops ⇒ NO single lost packet to headline
    expect(supportedDropCaveat(data.drops[0]!)).toBe('link-loss') // the LOSS is supported…
    expect(supportedDropCaveat(data.drops[1]!)).toBeNull()        // …the JAMMED is not
  })
  test('the copy degrades to counts — "2 packets lost", never the hero language', () => {
    const copy = commsChipCopy(data)
    expect(copy).toContain('2 lost')
    expect(copy).toContain('2 packets lost')
    expect(copy).not.toContain('the one packet that never arrived')
  })
  test('dropRevealAt is "none" (no hero anchor/bloom), regardless of playhead', () => {
    expect(dropRevealAt(data, asEventTick(4))).toBe('none')
    expect(dropRevealAt(data, asEventTick(95))).toBe('none')
  })
})

// ── snrConstant sees EVERY decoded event, including an anomalous orphan outcome ─────────────────────────────
describe('an anomalous orphan outcome with a different SNR kills the "steady link" clause', () => {
  const source: CommsSource = {
    eventCount: 2, tickCount: 4, ticks: [2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    // an ORPHAN delivery (msg 99 has no send) carrying a DIFFERENT snr — it must still count toward "constant".
    messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 99n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 99 } : null),
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: () => null,
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('the orphan is rejected from pairing, but its SNR still kills the constant claim (collected pre-rejection)', () => {
    expect(data.orphanOutcomes).toEqual([1]) // the orphan outcome — rejected from the pairing…
    expect(data.snrConstant).toBeNull()      // …yet its snr 99 (≠ the send's 12) is seen, so SNR is NOT constant
    expect(commsChipCopy(data)).not.toContain('steady link')
  })
})

// ── the pixel ledger distinguishes the delivered-pulse (derived) from the drop's presentational flight ──────
describe('the drop pulse\'s presentational flight is declared, matching the chip', () => {
  test('BOTH delivered-pulse ids are registered (recorded + missing); drop-pulse-flight is presentational; the lumped class is gone', () => {
    const byId = (id: string) => F4_COMMS_REGISTRATION.provenance.find(p => p.id === id)
    expect(byId('delivered-pulse-recorded')!.tier).toBe('derived-display') // decoded latency ×300 (RECORDED)
    expect(byId('delivered-pulse-missing')!.tier).toBe('presentational')   // the MISSING arm — now REGISTERED, reachable
    expect(byId('drop-pulse-flight')!.tier).toBe('presentational') // no latency — a declared estimate
    expect(byId('delivered-pulse')).toBeUndefined()                // the old single ambiguous id is gone
    expect(byId('message-pulse')).toBeUndefined()                  // the lumped class is retired
  })

  // the delivered-pulse class matches the TRUTH per clock state AND both arms are REACHABLE: two
  // distinct registered ids the caller selects by dtKnown, so a manifestless run resolves the presentational answer
  // through the context-free askPixel lookup (a single conditional function had nothing routing to its false arm).
  test('deliveredPulseClass has two REGISTERED ids: derived-display RECORDED, presentational MISSING, both in the ledger', () => {
    const recorded = deliveredPulseClass(true)
    expect(recorded.id).toBe('delivered-pulse-recorded')
    expect(recorded.tier).toBe('derived-display')
    expect(recorded.source).not.toBeNull()          // it cites the decoded kind-6 latency_us
    expect(recorded.answer).toContain('decoded')
    const missing = deliveredPulseClass(false)
    expect(missing.id).toBe('delivered-pulse-missing')
    expect(missing.tier).toBe('presentational')      // no decoded timing — a fixed declared bound
    expect(missing.source).toBeNull()                // it cites no decoded source
    expect(missing.answer).toContain('PRESENTATIONAL')
    expect(missing.answer).toContain('withheld')     // the decoded-timing claim is withheld
    // the selector picks the truthful id by dtKnown; BOTH are registered (not just the RECORDED arm).
    expect(deliveredPulseClassId(true)).toBe('delivered-pulse-recorded')
    expect(deliveredPulseClassId(false)).toBe('delivered-pulse-missing')
    expect(F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'delivered-pulse-recorded')).toEqual(recorded)
    expect(F4_COMMS_REGISTRATION.provenance.find(p => p.id === 'delivered-pulse-missing')).toEqual(missing)
  })
  test('the timing claim is DYNAMIC + dtKnown-gated: true latency ×300 WITH a manifest, presentational WITHOUT', () => {
    // The static honesty chip carries NO timing claim (it depends on the run's manifest); the per-run chip does.
    expect(COMMS_HONESTY).not.toContain('true latency ×300')
    // WITH a manifest dt (dtKnown): a delivered pulse flies true latency ×300; the drop is a presentational estimate.
    const withDt = commsChipCopy(buildCommsStage(modelWithDt('f4_seed42', 125000)))
    expect(withDt).toContain('true latency ×300')
    expect(withDt).toContain('presentational estimate') // the drop's flight
    // WITHOUT a manifest (a manifestless but RENDERABLE run) the delivered flight is a FIXED presentational bound —
    // pulseDuration ignores BOTH dtUs and latency — so the chip names the fixed bound and NEVER claims "true latency".
    const noDtData = buildCommsStage({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [], kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null), manifestDtUs: () => null, // NO recorded tick period → MISSING state
    })
    expect(noDtData.dtKnown).toBe(false)
    const noDt = commsChipCopy(noDtData)
    // THE MISSING CHIP names the FIXED PRESENTATIONAL BOUND, and does NOT mention a clock — nothing in the MISSING
    // path consumes dtUs (pulseDuration ignores it), so an "assumed 1000µs clock" mention would imply clock-derived
    // timing that never happens. It withholds "true latency" either way.
    expect(noDt).toContain('fixed presentational bound')
    expect(noDt).toContain('no recorded tick period')
    expect(noDt).not.toContain('true latency ×300')
    expect(noDt).not.toContain('assumed')   // the clock mention is dropped — nothing consumes dtUs under MISSING
    expect(noDt).not.toContain(`${ASSUMED_DT_US}µs`)
    expect(noDt).not.toContain('1000µs')
  })
})

// ── DEFINITIVE VISUALS FAIL CLOSED ON INCONSISTENCY — a conflicting outcome hides no loss claim ──────────────
// A duplicate/orphan/causation anomaly makes an accepted outcome untrustworthy (it may be hiding a conflicting
// one). The hero (and therefore the bloom, the anchor, the "never arrived" story) requires a CONSISTENT mapping;
// on inconsistency the lens degrades to a counts + anomaly disclosure, never a definitive per-message loss claim.
describe('definitive visuals require a consistent mapping (fail closed on a conflicting outcome)', () => {
  const send = (msg: bigint): MessageSent => ({ msg, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 })
  const deliver = (msg: bigint): MessageDelivered => ({ msg, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 })
  const drop = (msg: bigint): MessageDropped => ({ msg, reason: 3, snrDb: 12, jamState: 0 }) // a SUPPORTED LOSS shape

  // one send msg 1; two conflicting outcomes for it (a drop and a delivery), in the given seq order.
  const conflicting = (dropSeq: number, deliverSeq: number): CommsSource => ({
    eventCount: 3, tickCount: 6, ticks: [2, 2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : s === dropSeq ? 7 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? send(1n) : null),
    messageDeliveredAt: (s): MessageDelivered | null => (s === deliverSeq ? deliver(1n) : null),
    messageDroppedAt: (s): MessageDropped | null => (s === dropSeq ? drop(1n) : null),
    parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
    manifestDtUs: () => 125000,
  })

  test('DROP-then-DELIVER for one msg → NOT consistent, NO hero, no "never arrived"; the disclosure names the anomaly', () => {
    const data = buildCommsStage(conflicting(1, 2)) // seq1 drop, seq2 deliver
    expect(data.consistent).toBe(false)
    expect(data.hero).toBeNull()                                     // no definitive loss — the delivery would be HIDDEN
    expect(dropRevealAt(data, asEventTick(2))).toBe('none')          // no anchor, no bloom
    expect(data.duplicateOutcomes.length).toBe(1)
    const copy = commsChipCopy(data)
    expect(copy).toContain('inconsistent')
    expect(copy).toContain('anomalous')
    expect(copy).not.toContain('the one packet that never arrived')
  })

  test('DELIVER-then-DROP for one msg → NOT consistent, NO hero (the drop would be hidden), the disclosure names it', () => {
    const data = buildCommsStage(conflicting(2, 1)) // seq1 deliver, seq2 drop
    expect(data.consistent).toBe(false)
    expect(data.hero).toBeNull()
    expect(data.drops.length).toBe(0)                               // the accepted pair is the delivery; the drop is the conflict
    expect(data.duplicateOutcomes.length).toBe(1)
    expect(commsChipCopy(data)).toContain('inconsistent')
  })

  test('an ORPHAN drop (a drop for a msg with no send) → NOT consistent, NO hero, disclosed', () => {
    const data = buildCommsStage({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 7),
      messageSentAt: (s): MessageSent | null => (s === 0 ? send(1n) : null),
      messageDeliveredAt: (): MessageDelivered | null => null,
      messageDroppedAt: (s): MessageDropped | null => (s === 1 ? drop(2n) : null), // orphan: msg 2 has no send
      parentOf: () => null,
      manifestDtUs: () => 125000,
    })
    expect(data.orphanOutcomes.length).toBe(1)
    expect(data.consistent).toBe(false)
    expect(data.hero).toBeNull()
    expect(commsChipCopy(data)).toContain('inconsistent')
  })

  test('a CAUSATION disagreement on an otherwise-headline-able drop → NOT consistent, NO hero (the gate is both readings)', () => {
    const data = buildCommsStage({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 7),
      messageSentAt: (s): MessageSent | null => (s === 0 ? send(1n) : null),
      messageDeliveredAt: (): MessageDelivered | null => null,
      messageDroppedAt: (s): MessageDropped | null => (s === 1 ? drop(1n) : null), // a supported single LOSS…
      parentOf: (s) => (s === 1 ? 99 : null),                                       // …but its causation edge disagrees
      manifestDtUs: () => 125000,
    })
    expect(data.allPaired).toBe(true)        // a complete bijection…
    expect(data.allCausationOk).toBe(false)  // …but the two readings disagree
    expect(data.consistent).toBe(false)
    expect(data.hero).toBeNull()             // so the definitive loss is WITHHELD, even though drops.length === 1 and supported
    expect(dropRevealAt(data, asEventTick(2))).toBe('none')
    expect(commsChipCopy(data)).toContain('inconsistent')
  })

  test('the real f4 is CONSISTENT and keeps its hero (the fix withholds only on a real anomaly)', () => {
    const data = buildCommsStage(modelFor('f4_seed42'))
    expect(data.consistent).toBe(true)
    expect(data.hero).not.toBeNull()
    expect(data.hero!.msg).toBe(14n)
  })
})

// ── 'A STEADY LINK' REQUIRES THE LINK; MULTI-LINK DATA DEGRADES ──────────────────────────────────────────────
describe('a steady-link claim requires a single link, and multi-link data degrades', () => {
  // two sends to DIFFERENT dst (msg 1 → dst 2, msg 2 → dst 3), both delivered, EQUAL snr — a consistent bijection
  // over MORE THAN ONE link.
  const source: CommsSource = {
    eventCount: 4, tickCount: 6, ticks: [2, 4, 2, 4],
    entityKeys: () => [],
    kindAt: (s) => (s < 2 ? 5 : 6),
    messageSentAt: (s): MessageSent | null =>
      s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
        : s === 1 ? { msg: 2n, src: 1n, dst: 3n, channel: 1, snrDb: 12, txPowerW: 256 } : null, // dst 3 — a second link
    messageDeliveredAt: (s): MessageDelivered | null =>
      s === 2 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }
        : s === 3 ? { msg: 2n, src: 1n, dst: 3n, latencyUs: 210n, snrDb: 12 } : null,
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 2 ? 0 : s === 3 ? 1 : null),
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('a perfect bijection with equal SNR is consistent but NOT renderable when the link is not singular', () => {
    expect(data.allPaired).toBe(true)
    expect(data.allCausationOk).toBe(true)
    expect(data.consistent).toBe(true)       // a perfect bijection…
    expect(data.link).toBeNull()             // …but the sends disagree on the endpoint — more than one link
    expect(data.snrConstant).not.toBeNull()  // the SNR is constant across all events…
    expect(data.renderable).toBe(false)      // …yet the duet cannot render multiple links
    expect(data.hero).toBeNull()             // no single-link hero
  })
  test('the chip claims NO steady link (constant SNR alone is not enough) and states the multi-link mode', () => {
    const copy = commsChipCopy(data)
    expect(copy).not.toContain('steady link') // a constant SNR over MULTIPLE links is not a steady link
    expect(copy).toContain('multiple links')
  })
})

// ── OUTCOME-ONLY DATA STILL MOUNTS AND DISCLOSES ────────────────────────────────────────────────────────────
describe('outcome-only data mounts the lens and shows its disclosure', () => {
  // a DROPPED-only run: an orphan drop (msg 5) with NO send — internally anomalous, but it must MOUNT so the
  // promised disclosure appears (hasCommsEvents keys on ANY comms kind, not sends alone).
  const source: CommsSource = {
    eventCount: 1, tickCount: 4, ticks: [2],
    entityKeys: () => [],
    kindAt: () => 7,
    messageSentAt: (): MessageSent | null => null,
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (s): MessageDropped | null => (s === 0 ? { msg: 5n, reason: 3, snrDb: 12, jamState: 0 } : null),
    parentOf: () => null,
    manifestDtUs: () => 125000,
  }

  test('a dropped-only run MOUNTS (hasCommsEvents true) and is inconsistent (the orphan disclosed), no hero', () => {
    expect(commsStageApplies(source)).toBe(true)          // the lens MOUNTS despite zero sends…
    const data = buildCommsStage(source)
    expect(hasCommsEvents(data)).toBe(true)
    expect(data.orphanOutcomes.length).toBe(1)            // …the orphan drop is recorded…
    expect(data.renderable).toBe(false)
    expect(data.hero).toBeNull()
    expect(commsChipCopy(data)).toContain('inconsistent') // …and the disclosure appears
  })
})

// ── AN UNFORMED COMPARISON EARNS THE NO-VERDICT VOICE, NEVER A FALSE MISMATCH ────────────────────────────────
describe('incomplete is NOT inconsistent — an unformed pairing check is null, not a false mismatch', () => {
  // one send, ZERO outcomes — the pairing check for msg 1 cannot be formed (there is no outcome to compare).
  const source: CommsSource = {
    eventCount: 1, tickCount: 4, ticks: [2],
    entityKeys: () => [],
    kindAt: () => 5,
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (): MessageDelivered | null => null,
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: () => null,
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('checkPairing returns NULL (no comparison ran), NOT a branded false — the incomplete mapping is unformed', () => {
    expect(data.allPaired).toBe(false)          // an unmatched send…
    expect(commsAnomalyCount(data)).toBe(0)     // …but NO actual disagreement (no orphan/duplicate/causation conflict)
    const { agreed } = checkPairing(data)
    expect(agreed).toBeNull()                   // unformed — NOT a false mismatch
  })
  test('the chip says "incomplete" (the SAME state the strip shows), never "inconsistent", never a loss assurance', () => {
    const copy = commsChipCopy(data)
    expect(copy).toContain('incomplete')
    expect(copy).not.toContain('inconsistent')
    expect(copy).not.toContain('no packet lost')
  })
})

// ── A DELIVERED RECEIPT'S ENDPOINTS MUST MATCH ITS SEND (a contradictory receipt is an anomaly) ──────────────
describe('a delivered receipt whose endpoints contradict its send is an anomaly, not a clean delivery', () => {
  // send msg 1 (1 -> 2); a causally-MATCHED delivery for msg 1 naming a DIFFERENT dst (1 -> 9).
  const source: CommsSource = {
    eventCount: 2, tickCount: 4, ticks: [2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 9n, latencyUs: 200n, snrDb: 12 } : null), // dst 9 != send's 2
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 ? 0 : null), // causally MATCHED — only the endpoint contradicts
    manifestDtUs: () => 125000,
  }
  const data = buildCommsStage(source)

  test('MODEL: paired by msg id + causation, but the endpoint disagreement -> not consistent, no hero, counted', () => {
    expect(data.pairs.length).toBe(1)
    expect(data.pairs[0]!.causationOk).toBe(true)  // the causation matched...
    expect(data.pairs[0]!.endpointOk).toBe(false)  // ...but the endpoints contradict (the receipt was NOT discarded)
    expect(data.consistent).toBe(false)
    expect(data.renderable).toBe(false)
    expect(data.hero).toBeNull()
    expect(commsAnomalyCount(data)).toBe(1)        // the endpoint anomaly feeds the count
  })
  test('CHIP: makes NO steady/no-loss claim over the contradictory receipt -- it discloses "inconsistent"', () => {
    const copy = commsChipCopy(data)
    expect(copy).not.toContain('no packet lost')
    expect(copy).not.toContain('steady link') // constant SNR, but the link is NOT clean
    expect(copy).toContain('inconsistent')
  })
})

// ── ENDPOINT SYMMETRY: the check compares BOTH src AND dst — a swap and a src-only disagreement are caught ──────
// The earlier hostile receipts all varied only the DST. The endpoint check is `outcomeSrc === send.src &&
// outcomeDst === send.dst`, so it must also catch (a) a SWAPPED receipt (2 -> 1 for a 1 -> 2 send: both fields
// differ, the pair is symmetric) and (b) a SRC-ONLY disagreement (a receipt whose dst matches but src does not — a
// dst-only check would MISS this). Both are anomalies feeding !consistent, no hero, and the inconsistent disclosure.
describe('the endpoint check catches a swapped (2->1) receipt AND a src-only disagreement (not just dst)', () => {
  const endpointSource = (outSrc: bigint, outDst: bigint): CommsSource => ({
    eventCount: 2, tickCount: 4, ticks: [2, 2],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: outSrc, dst: outDst, latencyUs: 200n, snrDb: 12 } : null),
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 ? 0 : null), // causally MATCHED in every case — only the endpoints vary
    manifestDtUs: () => 125000,
  })

  // (send 1->2) paired with each hostile receipt: [label, receipt src, receipt dst]
  const cases: [string, bigint, bigint][] = [
    ['a SWAPPED 2->1 receipt (src symmetry — both fields differ)', 2n, 1n],
    ['a SRC-ONLY disagreement (dst matches, src does not — a dst-only check would miss it)', 9n, 2n],
  ]
  for (const [label, outSrc, outDst] of cases) {
    const data = buildCommsStage(endpointSource(outSrc, outDst))
    test(`MODEL: ${label} -> paired + causation ok, endpoint NOT ok, not consistent, no hero`, () => {
      expect(data.pairs[0]!.causationOk).toBe(true)
      expect(data.pairs[0]!.endpointOk).toBe(false)
      expect(data.allEndpointsOk).toBe(false)
      expect(data.allPaired).toBe(true)      // the bijection + causation still hold — ONLY the endpoint reading fails
      expect(data.allCausationOk).toBe(true)
      expect(data.consistent).toBe(false)
      expect(data.renderable).toBe(false)
      expect(data.hero).toBeNull()
      expect(commsAnomalyCount(data)).toBe(1)
    })
    test(`CHIP: ${label} -> discloses "inconsistent", no steady/no-loss claim`, () => {
      const copy = commsChipCopy(data)
      expect(copy).toContain('inconsistent')
      expect(copy).not.toContain('steady link')
      expect(copy).not.toContain('no packet lost')
    })
  }
})

// ── THE AUDIT POPULATION — every RESOLVING outcome is audited BEFORE duplicate rejection (order-independent) ─────
// The bug: addOutcome returned on a duplicate BEFORE evaluating causation/endpoint, so a contradictory duplicate
// delivery's formed reading was discarded — and the audit then depended on arrival order (drop-first vs delivery-
// first gave different counts). The fix audits EVERY resolving outcome (msg matches a send), accepted OR duplicate.
// The receipt's causation/endpoint denominators read from this population; trajectories read from accepted pairs.
describe('every resolving outcome is audited before duplicate rejection (the counts are order-independent)', () => {
  const send1 = { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } as const
  // helpers to read the strip's endpoint-reading counts straight off the model's audit population.
  const epReadings = (d: CommsData): number => d.resolvingAudits.filter(a => a.outcome === 'delivered').length
  const epAgreed = (d: CommsData): number => d.resolvingAudits.filter(a => a.outcome === 'delivered' && a.endpointOk).length

  // CASE A/B — a drop + a contradictory duplicate delivery (1→9), the two arrival orders. Either way the delivery's
  // endpoint reading is RETAINED: 1 formed reading, 0 agreeing → "0 of 1 endpoint readings agree" (order-independent).
  const dropAndDupDelivery = (dropFirst: boolean): CommsSource => ({
    eventCount: 3, tickCount: 6, ticks: [2, 3, 3],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : dropFirst ? (s === 1 ? 7 : 6) : (s === 1 ? 6 : 7)),
    messageSentAt: (s): MessageSent | null => (s === 0 ? send1 : null),
    messageDeliveredAt: (s): MessageDelivered | null => {
      const dSeq = dropFirst ? 2 : 1
      return s === dSeq ? { msg: 1n, src: 1n, dst: 9n, latencyUs: 200n, snrDb: 12 } : null // 1→9 CONTRADICTS
    },
    messageDroppedAt: (s): MessageDropped | null => {
      const xSeq = dropFirst ? 1 : 2
      return s === xSeq ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 } : null
    },
    parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
    manifestDtUs: () => 125000,
  })
  test('a drop + a contradictory duplicate delivery (1→9): "0 of 1 endpoint readings", SAME in both arrival orders', () => {
    for (const dropFirst of [true, false]) {
      const d = buildCommsStage(dropAndDupDelivery(dropFirst))
      expect(d.resolvingAudits.length, `2 resolving outcomes (${dropFirst ? 'drop-first' : 'delivery-first'})`).toBe(2)
      expect(epReadings(d)).toBe(1)  // one delivery forms the endpoint comparison, whether accepted or duplicate
      expect(epAgreed(d)).toBe(0)    // it CONTRADICTS (1→9) — the reading is retained, never discarded by order
      expect(d.duplicateOutcomes.length).toBe(1)
    }
  })

  // CASE C — an accepted delivery (1→2, agrees) + a contradictory duplicate delivery (1→9): TWO formed readings,
  // one agreeing → "1 of 2 endpoint readings agree" (the hostile case; order-independent).
  const twoDeliveries = (goodFirst: boolean): CommsSource => ({
    eventCount: 3, tickCount: 6, ticks: [2, 3, 3],
    entityKeys: () => [],
    kindAt: (s) => (s === 0 ? 5 : 6),
    messageSentAt: (s): MessageSent | null => (s === 0 ? send1 : null),
    messageDeliveredAt: (s): MessageDelivered | null => {
      if (s === 0) return null
      const good = { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }  // agrees
      const bad = { msg: 1n, src: 1n, dst: 9n, latencyUs: 200n, snrDb: 12 }   // contradicts
      return s === 1 ? (goodFirst ? good : bad) : (goodFirst ? bad : good)
    },
    messageDroppedAt: (): MessageDropped | null => null,
    parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
    manifestDtUs: () => 125000,
  })
  test('two deliveries, one contradicting: "1 of 2 endpoint readings agree", SAME in both arrival orders', () => {
    for (const goodFirst of [true, false]) {
      const d = buildCommsStage(twoDeliveries(goodFirst))
      expect(epReadings(d), `2 formed endpoint readings (${goodFirst ? 'good-first' : 'bad-first'})`).toBe(2)
      expect(epAgreed(d)).toBe(1)   // exactly one agrees, regardless of which arrived first — order-independent
      expect(d.duplicateOutcomes.length).toBe(1)
    }
  })

  // THE ANOMALY AGGREGATE is a SET OF FACTS, not an order of arrivals — the same two distinct facts (one duplicate
  // outcome + one contradictory endpoint reading) whether good or bad arrived first. The old aggregate (disagreements
  // over ACCEPTED pairs) gave 1 when the good receipt won acceptance and 2 when the bad did.
  test('commsAnomalyCount is order-independent (2 anomalous facts in BOTH arrival orders), and the chip agrees', () => {
    const counts = [true, false].map(goodFirst => commsAnomalyCount(buildCommsStage(twoDeliveries(goodFirst))))
    expect(counts).toEqual([2, 2]) // 1 duplicate + 1 endpoint disagreement — invariant to arrival order
    for (const goodFirst of [true, false]) {
      const copy = commsChipCopy(buildCommsStage(twoDeliveries(goodFirst)))
      expect(copy, `${goodFirst ? 'good-first' : 'bad-first'} chip`).toContain('2 anomalous')
    }
  })
})

// ── DISCLOSURE PRECEDENCE: anomaly -> incomplete -> multiple-links ───────────────────────────────────────────
describe('the disclosure mode orders by severity (anomaly -> incomplete -> multiple-links)', () => {
  test('INCOMPLETE + multi-link (two links, one outcome) -> "incomplete", the unresolved count is NOT hidden', () => {
    // two sends: msg 1 (1->2) delivered; msg 2 (1->9, a second link) with NO outcome (unresolved).
    const data = buildCommsStage({
      eventCount: 3, tickCount: 6, ticks: [2, 4, 2],
      entityKeys: () => [],
      kindAt: (s) => (s < 2 ? 5 : 6),
      messageSentAt: (s): MessageSent | null =>
        s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
          : s === 1 ? { msg: 2n, src: 1n, dst: 9n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
      messageDeliveredAt: (s): MessageDelivered | null => (s === 2 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 2 ? 0 : null),
      manifestDtUs: () => 125000,
    })
    expect(data.link).toBeNull()          // multiple links...
    expect(data.renderable).toBe(false)
    const copy = commsChipCopy(data)
    expect(copy).toContain('incomplete')  // ...but incomplete takes precedence -- the unresolved count shows
    expect(copy).toContain('unresolved')
    expect(copy).not.toContain('multiple links')
  })
  test('INCONSISTENT + multi-link (an endpoint anomaly on a two-link run) -> "inconsistent" (highest severity)', () => {
    // msg 2 sent to dst 9, delivered claiming dst 8 -- an endpoint anomaly, AND a multi-link run.
    const data = buildCommsStage({
      eventCount: 4, tickCount: 6, ticks: [2, 4, 2, 4],
      entityKeys: () => [],
      kindAt: (s) => (s < 2 ? 5 : 6),
      messageSentAt: (s): MessageSent | null =>
        s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
          : s === 1 ? { msg: 2n, src: 1n, dst: 9n, channel: 1, snrDb: 12, txPowerW: 256 } : null,
      messageDeliveredAt: (s): MessageDelivered | null =>
        s === 2 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }
          : s === 3 ? { msg: 2n, src: 1n, dst: 8n, latencyUs: 210n, snrDb: 12 } : null, // dst 8 != send's 9
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 2 ? 0 : s === 3 ? 1 : null),
      manifestDtUs: () => 125000,
    })
    expect(data.link).toBeNull()                        // multi-link...
    expect(commsAnomalyCount(data)).toBeGreaterThan(0)  // ...AND an endpoint anomaly
    expect(commsChipCopy(data)).toContain('inconsistent') // the worst is reported
  })
})

// ── THE PULSE CLOCK READS THE MANIFEST (a different recorded period scales the windows) ──────────────────────
describe('the pulse clock reads the manifest dtUs (a different period scales the flight windows)', () => {
  test('a DOUBLE period halves the flight ticks; the clock is dtKnown either way', () => {
    const d1 = buildCommsStage(modelWithDt('f4_seed42', 125000))
    const d2 = buildCommsStage(modelWithDt('f4_seed42', 250000)) // twice the tick period -> half the flight ticks
    expect(d1.dtKnown).toBe(true)
    expect(d2.dtKnown).toBe(true)
    expect(d1.dtUs).toBe(125000)
    expect(d2.dtUs).toBe(250000)
    const p1 = d1.pairs.find(p => p.outcome === 'delivered' && p.send.tick === 2)!
    const p2 = d2.pairs.find(p => p.outcome === 'delivered' && p.send.tick === 2)!
    // pulseDuration reads data.dtUs (RECORDED, dtKnown true), so the flight window SCALES with the recorded period.
    expect(pulseDuration(p2, d2.dtUs, d2.dtKnown)).toBeCloseTo(pulseDuration(p1, d1.dtUs, d1.dtKnown) / 2, 9)
    for (const p of d2.pairs) if (p.outcome === 'delivered') expect(pulseDuration(p, d2.dtUs, d2.dtKnown)).toBeLessThan(1)
  })

  // the MISSING clock's delivered flight is BOUNDED, so no pulse outlives the run. Under the assumed 1000µs
  // clock a 200µs latency would stretch 60 ticks (×300/1000) and stay in flight at the run's terminal rest; the
  // declared bounded duration keeps it inside its send's tick instead.
  test('a MISSING clock gives delivered pulses a bounded flight (< 1 tick), never the 60-tick assumed-clock overshoot', () => {
    const missing = buildCommsStage({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [], kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null), manifestDtUs: () => null, // MISSING clock
    })
    expect(missing.dtKnown).toBe(false)
    expect(missing.renderable).toBe(true) // consistent single link — it WOULD animate the delivered pulse
    const delivered = missing.pairs.find(p => p.outcome === 'delivered')!
    // the assumed-clock stretch WOULD be 60 ticks; the bounded declared duration is < 1 tick instead.
    expect(flightTicks(delivered.latencyUs!, missing.dtUs)).toBeCloseTo(60, 9) // the overshoot the fix avoids
    expect(pulseDuration(delivered, missing.dtUs, missing.dtKnown)).toBeLessThan(1)
    // the pulse's window is [send.tick, send.tick + dur) — it ends WELL before the run's end (tick 4), so an
    // exact-current sample at the terminal/cold rest renders NOTHING (no pulse survives the run's end).
    expect(pulseProgressAt(delivered.send.tick, pulseDuration(delivered, missing.dtUs, missing.dtKnown), 4)).toBeNull()
    expect(pulseProgressAt(delivered.send.tick, pulseDuration(delivered, missing.dtUs, missing.dtKnown), 3)).toBeNull()
  })
})

// ── THE TOUR-PER-LENS DECLARATION — the comms lens now registers its authored tour ────────────────────────
// The lens ships with its guided tour, so the registration's tourId points at it (mirrors the e0/f2a per-lens
// pins). The biconditional against the tour registry (tourId ⟺ hasTour) is enforced generically in tours.test.ts.
describe('the comms lens registers its authored tour (the standing tour-per-lens rule)', () => {
  test('F4_COMMS_REGISTRATION.tourId names the authored tour', () => {
    expect(F4_COMMS_REGISTRATION.tourId).toBe('f4-comms')
  })
})
