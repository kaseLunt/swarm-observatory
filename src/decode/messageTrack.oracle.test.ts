import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from './decodeBundle'
import { DecodeError } from '../lib/bytes'
import {
  decodeEvent,
  decodeMessageSent, decodeMessageDelivered, decodeMessageDropped,
  decodeTrackConfirmed, decodeTrackUpdated, decodeTrackDropped,
  MESSAGE_SENT, MESSAGE_DELIVERED, MESSAGE_DROPPED,
  TRACK_CONFIRMED, TRACK_UPDATED, TRACK_DROPPED,
} from './payloads'

// ── THE DECODE EXTENSION oracle: the comms kinds 5/6/7 + the track kinds 2/3/4 vs. the frozen bundles ─────
// Same posture as queryStage.oracle.test.ts: every pinned number here is DERIVED from the real vendored bytes
// THROUGH the new decoders — the literals are the values the decode MUST reproduce (the pin), never a copy of
// a design table. If a byte contract is ever re-vendored these move with it. The ground-truth counts are the
// f4/f3a kind histograms (spec-3b §11.1 byte layouts; the values below decode from the current v9/s4 drop).

// e0/f0/f1 are flat .det fixtures; f2a/f3a/f4 are dir fixtures (one attempt dir holding bundle.det) — the same
// resolver queryStageGating.test.ts uses.
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

// The inner (kind) payload for event index i, walked through the same decodeEvent envelope-strip RunModel uses.
const payloadOf = (run: ReturnType<typeof decodeBundle>, i: number) =>
  decodeEvent(new Uint8Array(run.det).subarray(run.payloadOff[i]!, run.payloadOff[i]! + run.payloadLen[i]!)).payload

const seqsOfKind = (run: ReturnType<typeof decodeBundle>, kind: number): number[] => {
  const out: number[] = []
  for (let i = 0; i < run.kind.length; i++) if (run.kind[i] === kind) out.push(i)
  return out
}

// ── f4_seed42 — THE CONTESTED LINK: 32 sent / 31 delivered / the ONE loss at tick 30 ─────────────────────
describe('comms decoders vs. the frozen f4 bundle (kinds 5/6/7)', () => {
  const run = decodeBundle(detFixture('f4_seed42'))
  const sentSeqs = seqsOfKind(run, MESSAGE_SENT)
  const deliveredSeqs = seqsOfKind(run, MESSAGE_DELIVERED)
  const droppedSeqs = seqsOfKind(run, MESSAGE_DROPPED)

  // The single SNR the whole run carries — a constant channel, "zero weather". Bit-exact: Object.is fails on
  // any low-bit drift, so this pins the raw decoded f64, never a rounded copy.
  const SNR_DB = 12.041199826559248

  test('the histogram is 32 MessageSent / 31 MessageDelivered / 1 MessageDropped', () => {
    expect(sentSeqs.length).toBe(32)
    expect(deliveredSeqs.length).toBe(31)
    expect(droppedSeqs.length).toBe(1)
    // 32 sends, 31 of them delivered, exactly one dropped — the delivered+dropped outcomes account for every send.
    expect(deliveredSeqs.length + droppedSeqs.length).toBe(sentSeqs.length)
  })

  test('snr_db is the single constant 12.041199826559248 across ALL 32 sends — bit-exact (Object.is on the f64)', () => {
    for (const seq of sentSeqs) {
      const m = decodeMessageSent(payloadOf(run, seq))
      expect(Object.is(m.snrDb, SNR_DB)).toBe(true)
    }
    // The same constant rides every delivery receipt and the drop too — all 64 comms events, zero weather.
    for (const seq of deliveredSeqs) expect(Object.is(decodeMessageDelivered(payloadOf(run, seq)).snrDb, SNR_DB)).toBe(true)
    expect(Object.is(decodeMessageDropped(payloadOf(run, droppedSeqs[0]!)).snrDb, SNR_DB)).toBe(true)
  })

  test('the whole run is ONE steady link: src 1 → dst 2, channel 1, tx_power 256 W', () => {
    for (const seq of sentSeqs) {
      const m = decodeMessageSent(payloadOf(run, seq))
      expect(m.src).toBe(1n)
      expect(m.dst).toBe(2n)
      expect(m.channel).toBe(1)
      expect(m.txPowerW).toBe(256)
    }
  })

  test('the ONE loss: msg 14 dropped at tick 30, reason 3 (LOSS), jam_state 0 — a decoded channel outcome, never an integrity ✗', () => {
    const dropSeq = droppedSeqs[0]!
    expect(run.tick[dropSeq]).toBe(30) // the tk30 fizzle — the run's single dropped packet
    const d = decodeMessageDropped(payloadOf(run, dropSeq))
    expect(d.msg).toBe(14n)
    expect(d.reason).toBe(3) // spec-3b §11.1 row 7: LOSS=3 (not JAMMED=1, not RANGE=2)
    expect(d.jamState).toBe(0) // zero jam — a plain loss, no contested-channel overclaim
  })

  test('every MessageDelivered carries a positive sim-time latency delta (decoded verbatim as signed I64)', () => {
    // latency_us is the schema's first I64 field (spec-3a §6.5.0); r.i64() reads it signed. On f4 all 31 are
    // small positive deltas well under dt=125000µs — the "steady link" the pivot rests on.
    const latencies = deliveredSeqs.map(seq => decodeMessageDelivered(payloadOf(run, seq)).latencyUs)
    for (const l of latencies) {
      expect(typeof l).toBe('bigint')
      expect(l > 0n).toBe(true)
      expect(l < 125000n).toBe(true)
    }
    const nums = latencies.map(Number).sort((a, b) => a - b)
    expect(nums[0]).toBe(134)
    expect(nums.at(-1)).toBe(375)
  })
})

// ── f3a_seed42 — BELIEF vs REALITY: 78 TrackUpdated, the covariance tightening 1.83m → 0.44m ──────────────
describe('track decoders vs. the frozen f3a bundle (kinds 2/3/4)', () => {
  const run = decodeBundle(detFixture('f3a_seed42'))
  const confirmedSeqs = seqsOfKind(run, TRACK_CONFIRMED)
  const updatedSeqs = seqsOfKind(run, TRACK_UPDATED)
  const droppedSeqs = seqsOfKind(run, TRACK_DROPPED)

  // The position 1σ is DERIVED from the decoded P matrix, not asserted blind: it is the eigen-semi-axis of the
  // top-left 2×2 position submatrix of `cov` (a 4×4 row-major [px,py,vx,vy] covariance) — indices {0,1,4,5}
  // of the flat VecF64. Symmetric-2×2 eigendecomposition: λ = tr/2 ± sqrt((a−c)²/4 + b²); semi-axis = sqrt(λ).
  // A degenerate isotropic submatrix (b=0, a=c) yields equal eigenvalues → equal semi-axes → the honest
  // shrinking DISC, not a tilted ellipse.
  function posSigma(cov: readonly number[]): { semiMajor: number; semiMinor: number; b: number } {
    const a = cov[0]!, b = cov[1]!, c = cov[5]!
    const half = Math.hypot((a - c) / 2, b)
    const mid = (a + c) / 2
    return { semiMajor: Math.sqrt(mid + half), semiMinor: Math.sqrt(mid - half), b }
  }

  test('the histogram is 1 TrackConfirmed / 78 TrackUpdated / 1 TrackDropped — one track (id 1) confirmed, updated, then dropped', () => {
    expect(confirmedSeqs.length).toBe(1)
    expect(updatedSeqs.length).toBe(78)
    expect(droppedSeqs.length).toBe(1)
    // The whole lifecycle is one track: TrackConfirmed opens id 1 (about subject 0), every TrackUpdated updates
    // that same id, and TrackDropped closes it with reason TIMEOUT=1 (spec-3b §11.1 row 4). Cross-checking the
    // ids proves the three decoders read the same `track:U64` field position off the frozen bytes.
    const conf = decodeTrackConfirmed(payloadOf(run, confirmedSeqs[0]!))
    expect(conf.track).toBe(1n)
    expect(conf.subject).toBe(0n)
    for (const seq of updatedSeqs) expect(decodeTrackUpdated(payloadOf(run, seq)).track).toBe(1n)
    const drop = decodeTrackDropped(payloadOf(run, droppedSeqs[0]!))
    expect(drop.track).toBe(1n)
    expect(drop.reason).toBe(1) // TIMEOUT=1 (not MERGED=2, not INVALIDATED=3)
  })

  test('the 78 TrackUpdated span 78 distinct ticks, 2..79 — near-per-tick playhead availability', () => {
    const ticks = updatedSeqs.map(seq => run.tick[seq]!)
    expect(new Set(ticks).size).toBe(78)
    expect(Math.min(...ticks)).toBe(2)
    expect(Math.max(...ticks)).toBe(79)
  })

  test('the TrackUpdated shape decodes to the §11.1 row-3 field widths: mean 4, cov 16, innovation 2, innovation_cov 4', () => {
    const t = decodeTrackUpdated(payloadOf(run, updatedSeqs[0]!))
    expect(t.mean.length).toBe(4)          // [px, py, vx, vy]
    expect(t.cov.length).toBe(16)          // 4×4 row-major
    expect(t.innovation.length).toBe(2)    // ν
    expect(t.innovationCov.length).toBe(4) // S, 2×2 row-major
  })

  test('THE TIGHTENING: position 1σ shrinks 1.83m (tick 2) → 0.44m (tick 79), isotropic → a shrinking DISC', () => {
    const first = decodeTrackUpdated(payloadOf(run, updatedSeqs[0]!))
    const last = decodeTrackUpdated(payloadOf(run, updatedSeqs.at(-1)!))
    expect(run.tick[updatedSeqs[0]!]).toBe(2)
    expect(run.tick[updatedSeqs.at(-1)!]).toBe(79)

    const s0 = posSigma(first.cov)
    const s1 = posSigma(last.cov)

    // Isotropy (the honesty pin — a decoded circle is a DISC, never an "ellipse"): off-diagonal 0, equal
    // diagonal → equal semi-axes. cov[1] and cov[4] are the two off-diagonal cells; both zero, and cov[0] === cov[5].
    expect(first.cov[1]).toBe(0); expect(first.cov[4]).toBe(0); expect(first.cov[0]).toBe(first.cov[5])
    expect(last.cov[1]).toBe(0); expect(last.cov[4]).toBe(0); expect(last.cov[0]).toBe(last.cov[5])
    expect(s0.semiMajor).toBeCloseTo(s0.semiMinor, 12) // disc, not ellipse
    expect(s1.semiMajor).toBeCloseTo(s1.semiMinor, 12)

    // The endpoints: 1σ 1.83m → 0.44m (position variance 3.333 → 0.196).
    expect(first.cov[0]).toBeCloseTo(3.333, 3)
    expect(last.cov[0]).toBeCloseTo(0.196, 3)
    expect(s0.semiMajor).toBeCloseTo(1.83, 2)
    expect(s1.semiMajor).toBeCloseTo(0.44, 2)
    expect(s1.semiMajor).toBeLessThan(s0.semiMajor) // the filter visibly gains confidence
  })
})

// ── Negative discipline — the decodeDetection failure idiom, held by every new decoder ────────────────────
describe('the new decoders reject malformed payloads exactly as decodeDetection does', () => {
  const run = decodeBundle(detFixture('f4_seed42'))
  const sentSeq = seqsOfKind(run, MESSAGE_SENT)[0]!
  const good = payloadOf(run, sentSeq)

  test('a TRUNCATED MessageSent payload throws (need-bytes guard), mirroring decodeDetection', () => {
    expect(() => decodeMessageSent(good.subarray(0, good.byteLength - 1))).toThrow(DecodeError)
  })

  test('a MessageSent payload with TRAILING bytes throws MalformedPayload (the remaining()!==0 guard)', () => {
    const extra = new Uint8Array(good.byteLength + 1)
    extra.set(good)
    let err: unknown
    try { decodeMessageSent(extra) } catch (e) { err = e }
    expect(err).toBeInstanceOf(DecodeError)
    expect((err as DecodeError).code).toBe('MalformedPayload')
  })

  test('the track decoders hold the same failure behavior on a garbled TrackUpdated', () => {
    const f3a = decodeBundle(detFixture('f3a_seed42'))
    const upd = payloadOf(f3a, seqsOfKind(f3a, TRACK_UPDATED)[0]!)
    expect(() => decodeTrackUpdated(upd.subarray(0, upd.byteLength - 1))).toThrow(DecodeError)
    const extra = new Uint8Array(upd.byteLength + 4)
    extra.set(upd)
    expect(() => decodeTrackUpdated(extra)).toThrow('MalformedPayload')
  })
})
