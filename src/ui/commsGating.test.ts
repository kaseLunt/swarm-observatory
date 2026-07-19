import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { commsStageApplies, buildCommsStage, hasCommsEvents, type CommsSource } from './commsStage'
import { queryStageApplies, type StageSource } from './queryStage'
import { sensingStageApplies, type SensingStageSource } from './sensingStage'
import type { MessageSent, MessageDelivered, GeometryQuery, Eligibility } from '../decode/payloads'

// ── The comms mount gate, pinned against the REAL bundles + the synthetic arbitration (mirrors the query /
// sensing gating tests). commsStageApplies is the ONE complete predicate the comms-stage MOUNT (Scene), the
// honesty CHIP (App) and the Inspector strip all share — positionless AND comms-kinds AND no kind-23 draws. The
// no-kind-23 conjunct ARBITRATES against the query stage: both are positionless lenses, so a positionless run
// carrying BOTH would otherwise mount two stages; comms yields to the query stage there.

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
const modelFor = (name: string): RunModel => new RunModel(decodeBundle(detFixture(name)), null)

describe('commsStageApplies against the REAL bundles — exactly f4 mounts the comms stage', () => {
  test('f4 mounts (positionless, comms events, no kind-23)', () => {
    const model = modelFor('f4_seed42')
    expect(commsStageApplies(model)).toBe(true)
    expect(hasCommsEvents(buildCommsStage(model))).toBe(true)
  })
  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42'])('%s does NOT mount the comms stage', (name) => {
    expect(commsStageApplies(modelFor(name))).toBe(false)
  })
  test('the three stage lenses are MUTUALLY EXCLUSIVE across every real bundle — never two stages in one scene', () => {
    for (const name of ['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42']) {
      const m = modelFor(name)
      const active = [queryStageApplies(m), sensingStageApplies(m), commsStageApplies(m)].filter(Boolean).length
      expect(active, `${name} mounts at most one stage`).toBeLessThanOrEqual(1)
    }
  })
})

// ── THE ARBITRATION — a positionless run carrying BOTH comms and kind-23 mounts the query stage, NOT comms ────
// No certified bundle mixes comms and kind-23 (f4 has comms and no kind-23; e0 has kind-23 and no comms), so
// the witness is synthetic — precisely because no real bundle can exercise this path.
type MixedSource = CommsSource & StageSource & SensingStageSource
function positionlessSource(opts: { comms: boolean; kind23: boolean }): MixedSource {
  const send: MessageSent = { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 }
  const delivered: MessageDelivered = { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 }
  const query: GeometryQuery = { queryKind: 1, subject: 0n, object: 2n, argv: [0, 0, 0], resultFlag: true, resultScalars: [], tiebreakApplied: false }
  // seq layout: 0 = MessageSent (kind 5), 1 = MessageDelivered (kind 6), 2 = GeometryQueryResolved (kind 23)
  return {
    eventCount: 3,
    tickCount: 4,
    ticks: [1, 1, 2],
    entityKeys: () => [], // POSITIONLESS — both lenses are positionless, so the no-kind-23 conjunct is the arbiter
    kindAt: (seq: number) => (seq === 0 ? 5 : seq === 1 ? 6 : seq === 2 && opts.kind23 ? 23 : -1),
    messageSentAt: (seq: number) => (opts.comms && seq === 0 ? send : null),
    messageDeliveredAt: (seq: number) => (opts.comms && seq === 1 ? delivered : null),
    messageDroppedAt: () => null,
    parentOf: (seq: number) => (seq === 1 ? 0 : null), // the delivery's causation edge → its send
    manifestDtUs: () => 125000,
    geometryQueryAt: (seq: number) => (opts.kind23 && seq === 2 ? query : null),
    eligibilityAt: (): Eligibility | null => null,
    detectionAt: () => null,
    entityStatesAt: () => new Map(),
  }
}

describe('a positionless run carrying BOTH comms and kind-23 — comms YIELDS to the query stage', () => {
  test('PREMISE: the raw comms content half is TRUE and the query gate is TRUE — the double-mount this closes', () => {
    const m = positionlessSource({ comms: true, kind23: true })
    expect(hasCommsEvents(buildCommsStage(m))).toBe(true) // comms content exists…
    expect(queryStageApplies(m)).toBe(true)               // …and so does a positionless query stage
  })
  test('arbitrated: comms WITHHELD (kind-23 present), the query stage mounts — exactly one stage', () => {
    const m = positionlessSource({ comms: true, kind23: true })
    expect(commsStageApplies(m)).toBe(false)
    expect(queryStageApplies(m)).toBe(true)
  })
  test('comms-only (no kind-23): the comms stage mounts, the query stage does not', () => {
    const m = positionlessSource({ comms: true, kind23: false })
    expect(commsStageApplies(m)).toBe(true)
    expect(queryStageApplies(m)).toBe(false)
  })
})
