import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildQueryDraws, hasQueryDraws, queryStageApplies, type QueryDraw } from './queryStage'

// ── the HAS-QUERY-CONTENT gate, pinned against the REAL bundles ─────────
// buildQueryDraws never returns null — a run with no kind-23 events yields an all-null seq-indexed array — so
// `positionless` ALONE cannot tell e0 (a real query stage) apart from a positionless run whose event kinds have
// no stage lens (f4). hasQueryDraws is the ONE predicate that does; the query stage MOUNT, its origin anchor
// (which lives inside the mount), the honesty chip, and the Inspector's empty-stage rail all gate on it, so the
// app can never again wear the "scenario constants" chip or the origin-anchor octahedron over a void.

// e0/f0/f1 are flat .det fixtures; f2a/f3a/f4 are dir fixtures (one attempt dir holding bundle.det).
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

// The gating the app derives from the two model-level facts, mirrored here EXACTLY so the classification the
// components render is pinned per run class (Scene's mount = queryData(positionless) + hasQueryDraws; App's
// chip = positionless + hasQueryDraws; Inspector's three-way rail voice).
type Rail = 'cone' | 'timeline' | 'empty-stage'
function classify(model: RunModel): { positionless: boolean; hasContent: boolean; mountsStage: boolean; showsChip: boolean; rail: Rail } {
  const positionless = model.entityKeys().length === 0
  const hasContent = hasQueryDraws(buildQueryDraws(model).draws)
  const gate = queryStageApplies(model) // the ONE complete stage-mount + honesty-chip + rail predicate
  return {
    positionless,
    hasContent,
    mountsStage: gate,
    showsChip: gate,
    rail: !positionless ? 'cone' : hasContent ? 'timeline' : 'empty-stage',
  }
}

describe('hasQueryDraws — the pure predicate', () => {
  test('empty and all-null draw arrays are false; one non-null draw is true', () => {
    expect(hasQueryDraws([])).toBe(false)
    expect(hasQueryDraws([null, null, null])).toBe(false)
    const d: QueryDraw = { kind: 1, seq: 0, object: 1, point: [0, 0, 0], verdict: 'INSIDE', tiebreak: false, d2: 0, dist: 0 }
    expect(hasQueryDraws([null, d, null])).toBe(true)
  })
})

// ── the COMPLETE applicability predicate (positionless AND kind-23 draws) ────────────────────────
// The mount/chip/rail all route through queryStageApplies now; the registration registers its NAME (not the
// CONTENT half `hasQueryDraws`, which under-described the real gate — the old pin caught a rename but not the
// missing positionless conjunct). These pins are premise-first: the complete predicate is a DISTINCT function
// from the half it was under-named as, and it reproduces `positionless && hasQueryDraws` on every real bundle.
describe('queryStageApplies — the ONE complete predicate the three surfaces share', () => {
  test('it is the full conjunction, not the content half — the mountGate name distinguishes them', () => {
    // PREMISE: the old mountGate named hasQueryDraws (the content half) — a different function from the whole gate.
    expect(queryStageApplies.name).not.toBe(hasQueryDraws.name)
    expect(queryStageApplies.name).toBe('queryStageApplies')
  })
  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42'])(
    'reproduces positionless && hasQueryDraws exactly on %s (no site can drift)', (name) => {
      const model = modelFor(name)
      const positionless = model.entityKeys().length === 0
      const hasContent = hasQueryDraws(buildQueryDraws(model).draws)
      expect(queryStageApplies(model)).toBe(positionless && hasContent)
    },
  )
  test('e0 applies (positionless + kind-23 draws); every other run does NOT', () => {
    expect(queryStageApplies(modelFor('e0_seed42'))).toBe(true)
    for (const name of ['f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42']) {
      expect(queryStageApplies(modelFor(name))).toBe(false) // f4 positionless-but-no-draws is the key negative
    }
  })
})

describe('has-query-content against the REAL bundles', () => {
  test('e0 HAS query content (75 kind-23 draws)', () => {
    expect(hasQueryDraws(buildQueryDraws(modelFor('e0_seed42')).draws)).toBe(true)
  })
  // The release-blocking cases: positionless-non-query and positioned runs alike must read FALSE, so the stage,
  // its anchor, and the chip are all withheld (f4 was the app's one false-chip / phantom-furniture run).
  test.each(['f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42', 'f4_seed42'])('%s has NO query content', (name) => {
    expect(hasQueryDraws(buildQueryDraws(modelFor(name)).draws)).toBe(false)
  })
})

describe('stage-mount / honesty-chip / rail gating per run class', () => {
  // e0 — the only run that mounts the stage and wears the honesty chip; its rail points at the timeline.
  test('e0 (positionless + query): mounts stage, shows chip, rail = timeline', () => {
    expect(classify(modelFor('e0_seed42'))).toEqual({ positionless: true, hasContent: true, mountsStage: true, showsChip: true, rail: 'timeline' })
  })
  // f4 — positionless with NO stage lens: NO stage, NO chip (the fixed false claim), honest empty-stage rail.
  test('f4 (positionless, no query): no stage, no chip, rail = empty-stage', () => {
    expect(classify(modelFor('f4_seed42'))).toEqual({ positionless: true, hasContent: false, mountsStage: false, showsChip: false, rail: 'empty-stage' })
  })
  // Positioned runs never mount the query stage and keep the honest "click the cone" invitation.
  test.each(['f0_seed42', 'f1_seed42', 'f2a_seed42', 'f3a_seed42'])('%s (positioned): no stage, no chip, rail = cone', (name) => {
    expect(classify(modelFor(name))).toMatchObject({ positionless: false, mountsStage: false, showsChip: false, rail: 'cone' })
  })
})
