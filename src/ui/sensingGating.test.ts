import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import {
  buildSensingStage, hasSensingEvents, sensingStageApplies, sensingSubject, sensingSubjectRef,
  type SensingDraw, type SensingStageSource,
} from './sensingStage'
import { queryStageApplies, type StageSource } from './queryStage'
import type { Eligibility, GeometryQuery } from '../decode/payloads'

// ── The sensing mount gate, pinned against the REAL bundles (mirrors queryStageGating.test.ts) ──────────
// sensingStageApplies is the ONE complete predicate the sensing-stage MOUNT (Scene), the honesty CHIP (App)
// and the stage-bounds/framing selection all share, so "does this lens have something to say about this
// run" can never drift across sites. It is POSITIONED AND kind-22 verdicts — the MIRROR of the query
// stage's positionless requirement, which is exactly what arbitrates the two stage lenses to at most one
// active stage per scene (they draw in different bases; see the mixed-run block below). This pins that
// exactly f2a mounts it and nothing else does.

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

// The gating the app derives, mirrored here EXACTLY: sensing mounts on the COMPLETE sensingStageApplies
// (positioned AND kind-22 verdicts). The plain trajectory trail mounts whenever the sensing stage does not
// — so a sensing run mounts the sensing stage INSTEAD (they never double-draw).
function classify(model: RunModel): { positionless: boolean; hasSensing: boolean; mountsSensing: boolean; mountsPlainTrail: boolean; showsSensingChip: boolean } {
  const positionless = model.entityKeys().length === 0
  const hasSensing = hasSensingEvents(buildSensingStage(model).draws) // the CONTENT half, kept visible
  const applies = sensingStageApplies(model)                          // the complete arbitrated gate
  return {
    positionless,
    hasSensing,
    mountsSensing: applies,      // Scene: {hasSensing && <SensingStage/>} — hasSensing = sensingStageApplies(model)
    mountsPlainTrail: !applies,  // Scene: {!hasSensing && <TrajectoryTrail/>}
    showsSensingChip: applies,   // App: <SensingChip/> self-gates on sensingStageApplies
  }
}

describe('hasSensingEvents — the pure predicate', () => {
  test('empty and all-null draw arrays are false; one non-null draw is true', () => {
    expect(hasSensingEvents([])).toBe(false)
    expect(hasSensingEvents([null, null])).toBe(false)
    const d: SensingDraw = { seq: 0, tick: 0, subject: '1:0', sensor: '0', inRange: true, inFov: true, losClear: true, eligible: true, tiebreak: false, g: [0, 0, 0] }
    expect(hasSensingEvents([null, d])).toBe(true)
  })
})

describe('has-sensing-content against the REAL bundles', () => {
  test('f2a HAS sensing content (96 kind-22 verdicts) — a POSITIONED sensing run', () => {
    const c = classify(modelFor('f2a_seed42'))
    expect(c).toEqual({ positionless: false, hasSensing: true, mountsSensing: true, mountsPlainTrail: false, showsSensingChip: true })
  })
  // The release-blocking cases: every other run has NO kind-22, so no sensing stage, no chip — and the
  // positioned non-sensing runs keep their plain trajectory trail (the sensing stage never usurps it).
  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f3a_seed42', 'f4_seed42'])('%s has NO sensing content', (name) => {
    const c = classify(modelFor(name))
    expect(c.hasSensing).toBe(false)
    expect(c.mountsSensing).toBe(false)
    expect(c.showsSensingChip).toBe(false)
    expect(c.mountsPlainTrail).toBe(true)
  })
})

// ── STAGE ARBITRATION — at most ONE active stage per scene, resolved BEFORE bounds/framing ───────────────
// The two stage lenses draw in DIFFERENT bases: the sensing apparatus in the shared basis A [e,−d,n], the
// self-contained query stage in basis B [n,−d,e]. No certified bundle carries both kind-22 and kind-23
// events, but nothing REJECTS such a run — and under the raw per-lens gates (hasSensingEvents alone beside
// queryStageApplies) a positionless run carrying both kinds would mount BOTH stages: mixed bases on one
// canvas, with Scene's activeStageBounds selecting sensing-space bounds while finaleBounds/observerFraming
// stay query-space. sensingStageApplies' positioned conjunct is the arbitration: sensing demands a flight
// trail to tint, the query stage demands positionless — mutually exclusive by construction. A synthetic
// mixed source is the witness precisely because no certified bundle can exercise this path.
type MixedSource = SensingStageSource & StageSource
function positionlessSource(opts: { kind22: boolean; kind23: boolean }): MixedSource {
  // Both payloads are contract-shaped: the kind-22 verdict is a plain eligibility row (its subject is
  // absent from every state frame, so g resolves null — the honest positionless shape); the kind-23 row is
  // a well-formed POINT_IN_REGION on the closed box B (object 2, argv = one point, no scalars), so
  // buildQueryDraws' fail-loud validation accepts it.
  const eligibility: Eligibility = { subject: 0n, sensor: 0n, inRange: true, inFov: true, losClear: true, eligible: true, tiebreakApplied: false }
  const query: GeometryQuery = { queryKind: 1, subject: 0n, object: 2n, argv: [0, 0, 0], resultFlag: true, resultScalars: [], tiebreakApplied: false }
  return {
    eventCount: 2,
    tickCount: 2,
    ticks: [0, 1],
    entityKeys: () => [], // POSITIONLESS — the arbitration's deciding fact
    kindAt: (seq: number) => (seq === 0 ? 22 : 23),
    eligibilityAt: (seq: number) => (opts.kind22 && seq === 0 ? eligibility : null),
    detectionAt: () => null,
    geometryQueryAt: (seq: number) => (opts.kind23 && seq === 1 ? query : null),
    entityStatesAt: () => new Map(),
  }
}

describe('stage arbitration — a positionless run carrying BOTH kind-22 and kind-23', () => {
  test('PREMISE: the raw per-lens conjunction admits BOTH stages — the mixed-bases mount this gate closes', () => {
    const m = positionlessSource({ kind22: true, kind23: true })
    // The content half of the sensing gate is TRUE (kind-22 verdicts exist) and the query gate is TRUE
    // (positionless AND kind-23 draws) — so gating the sensing mount on content alone would mount the
    // basis-A apparatus AND the basis-B query stage into one scene.
    expect(hasSensingEvents(buildSensingStage(m).draws)).toBe(true)
    expect(queryStageApplies(m)).toBe(true)
  })
  test('arbitrated: sensing WITHHELD (no flight trail to tint), query mounts — exactly one stage', () => {
    const m = positionlessSource({ kind22: true, kind23: true })
    expect(sensingStageApplies(m)).toBe(false)
    expect(queryStageApplies(m)).toBe(true)
  })
  test('bounds/framing selection follows the same arbitration (the Scene activeStageBounds mirror)', () => {
    // Scene: activeStageBounds = hasSensing ? sensingStageBounds : stageBounds, with hasSensing =
    // sensingStageApplies(model). Arbitrated FALSE here ⇒ the query-space stage bounds are selected —
    // consistent with the one mounted (query) stage and with finaleBounds/observerFraming, which are
    // query-space by construction. No consumer frames a stage that is not there.
    const m = positionlessSource({ kind22: true, kind23: true })
    const hasSensing = sensingStageApplies(m)
    const activeStage: 'sensing' | 'query' | null = hasSensing ? 'sensing' : queryStageApplies(m) ? 'query' : null
    expect(activeStage).toBe('query')
  })
  test('positionless kind-22-only: BOTH stages withheld — nothing draws over the void', () => {
    const m = positionlessSource({ kind22: true, kind23: false })
    expect(hasSensingEvents(buildSensingStage(m).draws)).toBe(true) // content exists...
    expect(sensingStageApplies(m)).toBe(false)                      // ...but there is no flight to tint
    expect(queryStageApplies(m)).toBe(false)                        // and no kind-23 draws either
  })
  test('mutual exclusion holds across every REAL bundle too — the two stages never co-apply', () => {
    for (const name of ['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42']) {
      const model = modelFor(name)
      expect(sensingStageApplies(model) && queryStageApplies(model), name).toBe(false)
    }
  })
})

// ── M7 — the gate resolves against the SENSING SUBJECT, not entityKeys()[0] ───────────────────────────────
// The eligible-tinted stage tints the entity the kind-22 verdicts NAME. The old gate (entityKeys().length > 0 &&
// hasSensingEvents) said nothing about WHICH entity, and passed a positioned-but-STATIC run (an empty trail
// buffer). Both defects are premise-first below against synthetic sources (no certified bundle is multi-subject
// or static-with-sensing, so the witnesses must be synthetic). Poses are decoded NED [n,e,d].
function positionedSource(opts: {
  keys: string[]
  poses: Record<string, [number, number, number][]> // key → pose per state frame (0..tickCount)
  subject: bigint                                    // the kind-22 subject id (namespace-1)
  tickCount: number
}): SensingStageSource {
  const eligibility: Eligibility = { subject: opts.subject, sensor: 0n, inRange: true, inFov: true, losClear: true, eligible: true, tiebreakApplied: false }
  return {
    eventCount: 1,
    tickCount: opts.tickCount,
    ticks: [0],
    entityKeys: () => opts.keys,
    kindAt: (seq: number) => (seq === 0 ? 22 : -1),
    eligibilityAt: (seq: number) => (seq === 0 ? eligibility : null),
    detectionAt: () => null,
    entityStatesAt: (tick: number) => {
      const m = new Map<string, { pos: number[] }>()
      for (const k of opts.keys) { const p = opts.poses[k]?.[tick]; if (p) m.set(k, { pos: p }) }
      return m
    },
  }
}
// A moving flight (extent ≫ MIN_EXTENT) and a static point, over `frames` state frames.
const northFlight = (frames: number, east: number): [number, number, number][] =>
  Array.from({ length: frames }, (_, t): [number, number, number] => [t * 2, east, 0])
const eastFlight = (frames: number): [number, number, number][] =>
  Array.from({ length: frames }, (_, t): [number, number, number] => [0, t * 2, 0])
const staticPoint = (frames: number): [number, number, number][] =>
  Array.from({ length: frames }, (): [number, number, number] => [5, 5, 0])

describe('sensingSubject — the entity the kind-22 verdicts name', () => {
  test('a single-subject draw list resolves to that subject; verdicts naming two subjects resolve to null', () => {
    const d = (subject: string): SensingDraw => ({ seq: 0, tick: 0, subject, sensor: '0', inRange: true, inFov: true, losClear: true, eligible: true, tiebreak: false, g: [0, 0, 0] })
    expect(sensingSubject([null, d('1:7'), d('1:7')])).toBe('1:7')
    expect(sensingSubject([])).toBeNull()
    expect(sensingSubject([null, null])).toBeNull()
    expect(sensingSubject([d('1:0'), d('1:7')])).toBeNull() // multi-subject: no single trail to tint
  })
})

describe('M7 — multi-entity: the gate binds to the SUBJECT, not entityKeys()[0] (wrong-entity tint)', () => {
  // keys[0] = '1:0' flies EAST; the kind-22 verdicts name subject 7 ('1:7'), which flies NORTH.
  const model = positionedSource({
    keys: ['1:0', '1:7'],
    poses: { '1:0': eastFlight(5), '1:7': northFlight(5, 48) },
    subject: 7n,
    tickCount: 4,
  })
  const draws = buildSensingStage(model).draws

  test('PREMISE: the OLD gate (entityKeys>0 && hasSensingEvents) applies — and would tint entityKeys()[0]', () => {
    expect(model.entityKeys().length > 0 && hasSensingEvents(draws)).toBe(true) // old gate: MOUNTS
    expect(model.entityKeys()[0]).toBe('1:0')                                   // …and would tint '1:0'…
    expect(sensingSubject(draws)).toBe('1:7')                                   // …with '1:7's eligibility (WRONG)
  })
  test('THE FIX: the subject is resolved to the entity the verdicts name (1:7), not entityKeys()[0]', () => {
    expect(sensingSubject(draws)).toBe('1:7')
    // The subject HAS a real flight, so the stage APPLIES — correctly SUBJECT-BOUND (Scene builds 1:7's trail).
    expect(sensingStageApplies(model)).toBe(true)
  })
})

describe('M7 — positioned-but-STATIC: the gate withholds (an empty trail is not a flight to tint)', () => {
  // A single positioned subject with a STATIC pose — extent below MIN_EXTENT → buildTrail returns an empty buffer.
  const model = positionedSource({ keys: ['1:0'], poses: { '1:0': staticPoint(5) }, subject: 0n, tickCount: 4 })
  const draws = buildSensingStage(model).draws

  test('PREMISE: the OLD gate applies (positioned + kind-22) — mounting the stage over an empty trail (NaN reads)', () => {
    expect(model.entityKeys().length > 0 && hasSensingEvents(draws)).toBe(true)
  })
  test('THE FIX: the gate WITHHOLDS — the sensing subject has no non-static flight to tint', () => {
    expect(sensingSubject(draws)).toBe('1:0')       // the subject resolves…
    expect(sensingStageApplies(model)).toBe(false)  // …but it has no drawable flight, so no stage
  })
  test('a moving single subject (the f2a shape) still APPLIES — the withhold is specific to a dead trail', () => {
    const moving = positionedSource({ keys: ['1:0'], poses: { '1:0': northFlight(5, 48) }, subject: 0n, tickCount: 4 })
    expect(sensingStageApplies(moving)).toBe(true)
  })
})

// ── A LATE-SPAWNING subject: the gate must FAIL CLOSED when the subject is absent from entityKeys() ──────
// entityKeys() covers only the FIRST-populated-frame entities (the cones Scene instances). A subject that first
// appears LATER has a real flight (subjectHasFlight walks EVERY frame) yet is NOT in entityKeys(), so
// sensingSubjectRef cannot resolve its index. The OLD gate (sensingSubject non-null + subjectHasFlight) ADMITTED
// it — then Scene's `sensingSubjectRef(...)?.key` was null and optional-chaining fell back to buildTrail(undefined)
// === entityKeys()[0]'s trail at subjectIndex 0, tinting/following the WRONG entity while hasSensing stayed true.
// The fix folds the ref resolution into the gate, so admission requires the subject to resolve against the key set.
function lateSpawnSource(): SensingStageSource {
  const eligibility: Eligibility = { subject: 7n, sensor: 0n, inRange: true, inFov: true, losClear: true, eligible: true, tiebreakApplied: false }
  const spawnFrame = 1 // '1:7' first appears at state frame 1 — AFTER the first-populated frame (frame 0 is '1:0' only)
  return {
    eventCount: 1,
    tickCount: 4,
    ticks: [0],
    entityKeys: () => ['1:0'], // the FIRST-populated-frame set — the late-spawning subject '1:7' is absent from it
    kindAt: (seq: number) => (seq === 0 ? 22 : -1),
    eligibilityAt: (seq: number) => (seq === 0 ? eligibility : null),
    detectionAt: () => null,
    entityStatesAt: (tick: number) => {
      const m = new Map<string, { pos: number[] }>()
      m.set('1:0', { pos: [0, 0, 0] })                              // the first entity, present every frame
      if (tick >= spawnFrame) m.set('1:7', { pos: [tick * 10, 48, 0] }) // the subject: a real NORTH flight, spawns late
      return m
    },
  }
}

describe('a late-spawning subject (present in the frames, ABSENT from entityKeys()) fails the gate closed', () => {
  const model = lateSpawnSource()
  const draws = buildSensingStage(model).draws

  test('PREMISE: the OLD chain ADMITTED — the subject resolves AND has a real flight — yet it is NOT in entityKeys()', () => {
    expect(sensingSubject(draws)).toBe('1:7')                 // the verdicts name a single subject…
    expect(model.entityKeys()).toEqual(['1:0'])               // …which is ABSENT from the rendered key set
    expect(model.entityKeys().includes('1:7')).toBe(false)
    // so the old admission (sensingSubject non-null && subjectHasFlight) was TRUE, and Scene would then fall back
    // to entityKeys()[0] ('1:0') at subjectIndex 0 — tinting/following the wrong entity while hasSensing was true.
  })
  test('THE FIX: the stage is WITHHELD — the subject cannot resolve its index against entityKeys()', () => {
    expect(sensingSubjectRef(model.entityKeys(), draws)).toBeNull() // the SAME ref Scene resolves — null ⇒ no fallback trail
    expect(sensingStageApplies(model)).toBe(false)                  // hasSensing false: nothing tinted, no wrong-entity follow
  })
})
