import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { trackBeliefApplies, hasTrackContent, buildTrackBelief, type TrackBeliefSource } from './trackBelief'
import { queryStageApplies, type StageSource } from './queryStage'
import { sensingStageApplies, type SensingStageSource } from './sensingStage'
import { commsStageApplies, type CommsSource } from './commsStage'
import type { Eligibility, GeometryQuery, TrackUpdated } from '../decode/payloads'

// ── The belief mount gate, pinned against the REAL bundles + the synthetic arbitration (mirrors the comms/sensing/
// query gating tests). trackBeliefApplies is the ONE complete predicate the belief-stage MOUNT (Scene), the honesty
// CHIP (App) and the Inspector strip all share — POSITIONED AND track updates AND no kind-22. The positioned conjunct
// makes it exclusive with the two POSITIONLESS lenses (query, comms); the no-kind-22 conjunct YIELDS to the sensing
// gauntlet (both positioned), exactly as comms yields to the query stage via no-kind-23.

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
const ALL_RUNS = ['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42']

describe('trackBeliefApplies against the REAL bundles — exactly f3a mounts the belief stage', () => {
  test('f3a mounts (positioned, track updates, no kind-22)', () => {
    const model = modelFor('f3a_seed42')
    expect(trackBeliefApplies(model)).toBe(true)
    expect(hasTrackContent(buildTrackBelief(model))).toBe(true)
  })
  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f4_seed42'])('%s does NOT mount the belief stage', (name) => {
    expect(trackBeliefApplies(modelFor(name))).toBe(false)
  })

  // THE FULL EXCLUSIVITY PROOF, real data: the FOUR stage lenses are mutually exclusive across every bundle — never
  // two stages in one scene. This is the strongest proof f3a mounts ONLY belief (not sensing/query/comms).
  test('the FOUR stage lenses are MUTUALLY EXCLUSIVE across every real bundle — at most one mounts', () => {
    for (const name of ALL_RUNS) {
      const m = modelFor(name)
      const active = [
        queryStageApplies(m), sensingStageApplies(m), commsStageApplies(m), trackBeliefApplies(m),
      ].filter(Boolean).length
      expect(active, `${name} mounts at most one stage`).toBeLessThanOrEqual(1)
    }
  })
  test('f3a mounts belief and NOTHING else (query/sensing/comms all withheld there)', () => {
    const m = modelFor('f3a_seed42')
    expect(queryStageApplies(m)).toBe(false)   // positioned → the positionless query stage is withheld
    expect(sensingStageApplies(m)).toBe(false) // no kind-22 verdicts
    expect(commsStageApplies(m)).toBe(false)   // positioned → the positionless comms stage is withheld
    expect(trackBeliefApplies(m)).toBe(true)
  })
})

// ── THE HOSTILE SYNTHETICS — the arbitration paths no certified bundle exercises ──────────────────────────────
// A combined source satisfying ALL FOUR applies functions structurally. Toggles decide which content each carries.
type Mixed = TrackBeliefSource & StageSource & SensingStageSource & CommsSource
function mixed(opts: { positioned: boolean; track: boolean; kind22: boolean; kind23: boolean; comms: boolean }): Mixed {
  // seq layout: 0 = a track update (if track), 1 = kind-22 (if kind22), 2 = kind-23 (if kind23), 3 = a MessageSent (if comms).
  const K = { track: 3, k22: 22, k23: 23, comms: 5 }
  const layout: number[] = []
  const idx = { track: -1, k22: -1, k23: -1, comms: -1 }
  if (opts.track) { idx.track = layout.length; layout.push(K.track) }
  if (opts.kind22) { idx.k22 = layout.length; layout.push(K.k22) }
  if (opts.kind23) { idx.k23 = layout.length; layout.push(K.k23) }
  if (opts.comms) { idx.comms = layout.length; layout.push(K.comms) }
  const upd: TrackUpdated = { track: 1n, mean: [1, 0, 0, 0], cov: [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], innovation: [0, 0], innovationCov: [0, 0, 0, 0] }
  const elig: Eligibility = { subject: 0n, sensor: 1n, inRange: true, inFov: true, losClear: true, eligible: true, tiebreakApplied: false }
  const query: GeometryQuery = { queryKind: 1, subject: 0n, object: 2n, argv: [0, 0, 0], resultFlag: true, resultScalars: [], tiebreakApplied: false }
  const tickCount = 6
  // a real flight for '1:0' so sensingStageApplies' subjectHasFlight passes when kind-22 is present + positioned.
  const flight = (frame: number): ReadonlyMap<string, { pos: number[] }> =>
    opts.positioned ? new Map([['1:0', { pos: [frame * 5, 0, 0] }]]) : new Map()
  return {
    eventCount: layout.length,
    tickCount,
    ticks: layout.map(() => 2),
    kindAt: (s) => layout[s] ?? -1,
    entityKeys: () => (opts.positioned ? ['1:0'] : []),
    // belief
    trackConfirmedAt: () => null,
    trackUpdatedAt: (s) => (opts.track && s === idx.track ? upd : null),
    trackDroppedAt: () => null,
    // sensing
    eligibilityAt: (s) => (opts.kind22 && s === idx.k22 ? elig : null),
    detectionAt: () => null,
    entityStatesAt: (frame) => flight(frame as number),
    // query
    geometryQueryAt: (s) => (opts.kind23 && s === idx.k23 ? query : null),
    // comms
    messageSentAt: (s) => (opts.comms && s === idx.comms ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
    messageDeliveredAt: () => null,
    messageDroppedAt: () => null,
    parentOf: () => null,
    manifestDtUs: () => 125000,
  }
}
const activeCount = (m: Mixed): number =>
  [queryStageApplies(m), sensingStageApplies(m), commsStageApplies(m), trackBeliefApplies(m)].filter(Boolean).length

describe('the belief lens YIELDS to the sensing gauntlet — positioned + track + kind-22 mounts SENSING, not belief', () => {
  test('PREMISE: the raw track content is present AND sensing genuinely applies (the double-mount this closes)', () => {
    const m = mixed({ positioned: true, track: true, kind22: true, kind23: false, comms: false })
    expect(hasTrackContent(buildTrackBelief(m))).toBe(true) // track content exists…
    expect(sensingStageApplies(m)).toBe(true)               // …and so does a positioned sensing stage
  })
  test('arbitrated: belief WITHHELD (kind-22 present), sensing mounts — exactly one stage', () => {
    const m = mixed({ positioned: true, track: true, kind22: true, kind23: false, comms: false })
    expect(trackBeliefApplies(m)).toBe(false) // belief yields (the no-kind-22 conjunct)
    expect(sensingStageApplies(m)).toBe(true)
    expect(activeCount(m)).toBe(1)
  })
  test('track-only (no kind-22): the belief stage mounts, sensing does not — exactly one stage', () => {
    const m = mixed({ positioned: true, track: true, kind22: false, kind23: false, comms: false })
    expect(trackBeliefApplies(m)).toBe(true)
    expect(sensingStageApplies(m)).toBe(false)
    expect(activeCount(m)).toBe(1)
  })
})

describe('the belief lens is POSITIONED — a positionless run with track content withholds it (exclusive with query/comms)', () => {
  test('positionless + track: belief WITHHELD (no entity partition — the disc would float in a void)', () => {
    const m = mixed({ positioned: false, track: true, kind22: false, kind23: false, comms: false })
    expect(trackBeliefApplies(m)).toBe(false)
    expect(activeCount(m)).toBeLessThanOrEqual(1)
  })
  test('positionless + track + kind-23: the QUERY stage mounts, belief withheld — exactly one stage', () => {
    const m = mixed({ positioned: false, track: true, kind22: false, kind23: true, comms: false })
    expect(queryStageApplies(m)).toBe(true)
    expect(trackBeliefApplies(m)).toBe(false)
    expect(activeCount(m)).toBe(1)
  })
  test('positionless + track + comms: the COMMS stage mounts, belief withheld — exactly one stage', () => {
    const m = mixed({ positioned: false, track: true, kind22: false, kind23: false, comms: true })
    expect(commsStageApplies(m)).toBe(true)
    expect(trackBeliefApplies(m)).toBe(false)
    expect(activeCount(m)).toBe(1)
  })
  test('EXHAUSTIVE: across every content combination, at most ONE of the four stage lenses ever mounts', () => {
    for (const positioned of [true, false]) {
      for (const track of [true, false]) {
        for (const kind22 of [true, false]) {
          for (const kind23 of [true, false]) {
            for (const comms of [true, false]) {
              const m = mixed({ positioned, track, kind22, kind23, comms })
              expect(activeCount(m), `positioned=${positioned} track=${track} k22=${kind22} k23=${kind23} comms=${comms}`).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    }
  })
})
