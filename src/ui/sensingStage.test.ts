import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { PALETTE, CATEGORY } from './theme'
import {
  buildSensingStage, hasSensingEvents, sensingStageApplies, sensingSubjectRef, F2A_REGISTRATION, SENSING_HONESTY,
  TARGET_FRAME_OFFSET, evaluatedFrame, type SensingDraw, type SensingSource,
} from './sensingStage'
import { chipAgreesWithLedger } from './lensContract'
import { buildTrail } from './trail'
import { boundsFromPositions } from './camera'
import { entityPosition, lerp3 } from './placement'
import { NORTH_STEP } from './sensingScenario'
import { lerpHeadPosition } from './sensingStageView'
import { resolveCursor } from './cursor'
import { asEventTick, asStateFrame } from '../lib/brand'
import * as THREE from 'three'

// f2a/f3a/f4 are dir fixtures (one attempt dir holding bundle.det); e0/f0/f1 are flat .det.
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

describe('buildSensingStage — the f2a kind-22 model, against the REAL bundle', () => {
  const model = modelFor('f2a_seed42')
  const stage = buildSensingStage(model)

  test('f2a HAS sensing events (96 kind-22 verdicts) — the ONE mount predicate reads true', () => {
    expect(hasSensingEvents(stage.draws)).toBe(true)
    const nonNull = stage.draws.filter((d): d is SensingDraw => d !== null)
    expect(nonNull.length).toBe(96)
    expect(stage.byTick.filter(d => d !== null).length).toBe(96)
  })

  test('every verdict resolves a decoded target pose (the frame offset is correct — none poseless)', () => {
    const nonNull = stage.draws.filter((d): d is SensingDraw => d !== null)
    for (const d of nonNull) expect(d.g).not.toBeNull()
  })

  test('the kind-22 subject matches the single state-frame entity key (decoded-vs-decoded consistency)', () => {
    const keys = model.entityKeys()
    expect(keys.length).toBe(1) // f2a is a single-subject scene (the drone)
    const subject = keys[0]!
    for (const d of stage.draws) if (d) expect(d.subject).toBe(subject)
  })

  test('the 17 decoded detection marks carry finite NED-meter positions (kind-1 meas)', () => {
    expect(stage.detections.length).toBe(17)
    for (const m of stage.detections) {
      expect(m.pos.every(Number.isFinite)).toBe(true)
      expect(Number.isFinite(m.snrDb)).toBe(true)
    }
  })

  test('the eligible tint is the decoded eligible boolean, per tick (both polarities appear on this run)', () => {
    const nonNull = stage.draws.filter((d): d is SensingDraw => d !== null)
    // The gauntlet is a gauntlet: the drone is admitted on some ticks and rejected on others.
    expect(nonNull.some(d => d.eligible)).toBe(true)
    expect(nonNull.some(d => !d.eligible)).toBe(true)
  })
})

// W1 — the eligible tint indexes by the EVALUATED state frame, not the tick. A tick-k verdict is decided
// against state frame k+1's pose (TARGET_FRAME_OFFSET; the excerpt: "g = frame k+1, the frame the tick-k step
// commits"), and buildTrail lays vertex f = state frame f. So byFrame[f] must be the verdict whose g was read
// from frame f — landing each eligibility bit on the exact pose it describes, not the pose one 2-m step behind
// it. Verified against the REAL decoded bundle (the same object identity the renderer paints vertex f with).
describe('byFrame — the eligible tint indexes by the EVALUATED state frame (W1: not one pose behind)', () => {
  const model = modelFor('f2a_seed42')
  const stage = buildSensingStage(model)

  test('byFrame has one slot per state frame (0..tickCount) — 1:1 with the trail vertices (tickCount+1)', () => {
    expect(stage.byFrame.length).toBe(model.tickCount + 1)
  })

  test('frame 0 carries NO verdict (the first verdict, tick 0, was evaluated against frame 1)', () => {
    expect(stage.byFrame[0]).toBeNull()
  })

  test('a tick-k verdict lands on frame k+1 — the pose it was EVALUATED against (ticks 55, 82, 94)', () => {
    for (const k of [55, 82, 94]) {
      expect(stage.byFrame[k + 1]).toBe(stage.byTick[k]) // same object identity the renderer tints vertex k+1 with
      expect(stage.byFrame[k + 1]!.tick).toBe(k)
    }
  })

  test('the terminal verdict (tick 95) lands on frame 96 — the last trail vertex, clamped, not dropped', () => {
    expect(stage.byFrame[96]).toBe(stage.byTick[95])
    expect(stage.byFrame[96]!.tick).toBe(95)
    expect(stage.byFrame.length - 1).toBe(96) // 96 is the last frame index (byFrame length is tickCount+1 = 97)
  })

  test('byFrame[f] === byTick[f−1] for every frame that carries a verdict (the pure 1-frame shift)', () => {
    for (let f = 1; f < stage.byFrame.length; f++) expect(stage.byFrame[f]).toBe(stage.byTick[f - 1])
  })
})

describe('the other runs have NO sensing events (the gate is discriminating)', () => {
  test.each(['e0_seed42', 'f0_seed42', 'f1_seed42', 'f3a_seed42', 'f4_seed42'])('%s has no kind-22 verdicts', (name) => {
    expect(hasSensingEvents(buildSensingStage(modelFor(name)).draws)).toBe(false)
  })
})

describe('F2A_REGISTRATION — the first conforming citizen of the provenance ledger', () => {
  test('it validated at publish (import did not throw) and carries the enumerated ledger', () => {
    expect(F2A_REGISTRATION.id).toBe('f2a-sensing')
    // Bind to sensingStageApplies' FUNCTION identity, not a bare string: a predicate rename that skipped
    // this registration fails here — mount/chip/bounds share this one arbitrated gate and cannot silently
    // drift. Premise-first: the COMPLETE gate (positioned AND kind-22) is a DISTINCT function from the
    // content half it was once registered as — the second pin proves the registration no longer
    // under-describes the real mount gate.
    expect(F2A_REGISTRATION.mountGate).toBe(sensingStageApplies.name)
    expect(F2A_REGISTRATION.mountGate).not.toBe(hasSensingEvents.name)
    expect(F2A_REGISTRATION.provenance.length).toBeGreaterThanOrEqual(12)
  })

  test('every borrowed hue names an EXISTING token (LAW 2 — the palette does not grow)', () => {
    const paletteKeys = new Set(Object.keys(PALETTE))
    const categoryKeys = new Set(Object.keys(CATEGORY))
    for (const h of F2A_REGISTRATION.borrowedHues) {
      if (h.startsWith('category:')) expect(categoryKeys.has(h.slice('category:'.length))).toBe(true)
      else expect(paletteKeys.has(h)).toBe(true)
    }
  })

  test('every non-presentational pixel-class carries a contract/ anchor', () => {
    for (const p of F2A_REGISTRATION.provenance) {
      if (p.tier !== 'presentational') {
        expect(p.source).toBeTruthy()
        expect(p.source!).toMatch(/^contract\//)
      } else {
        expect(p.source).toBeNull()
      }
    }
  })

  test('the in_fov class is pinned-bits (never recomputed); in_range/los_clear/eligible are recomputed', () => {
    const byId = new Map(F2A_REGISTRATION.provenance.map(p => [p.id, p]))
    expect(byId.get('in-fov-claim')!.tier).toBe('pinned-bits')
    expect(byId.get('in-range-recompute')!.tier).toBe('recomputed')
    expect(byId.get('los-clear-recompute')!.tier).toBe('recomputed')
    expect(byId.get('eligible-conjunction')!.tier).toBe('recomputed')
  })

  test('the identity plate is itself a ledger entry — tier presentational (the two halves are one system)', () => {
    const plate = F2A_REGISTRATION.provenance.find(p => p.id === 'identity-plate')!
    expect(plate.tier).toBe('presentational')
    expect(plate.answer).toMatch(/presentational/)
  })

  test('the honesty chip is DERIVED from and agrees with the ledger (one source of honesty)', () => {
    expect(F2A_REGISTRATION.honestyChip).toBe(SENSING_HONESTY)
    expect(chipAgreesWithLedger(F2A_REGISTRATION)).toBe(true)
    // the honesty CONTENT is fixed even as wording is owner-tweakable: it names constants AND claims decoded.
    expect(SENSING_HONESTY).toMatch(/decoded-real/)
    expect(SENSING_HONESTY).toMatch(/scenario constants/)
  })

  test('it registers a tour (the tour-per-lens standing rule, structurally)', () => {
    expect(F2A_REGISTRATION.tourId).toBe('f2a-sensing')
  })
})

// evaluatedFrame — THE ONE tick→frame map. The sensing head (sensingStageView) and the interactive drone
// cone / hit target / label / ring / follow+focus targets (Scene.Entities) BOTH call this, so the closure-
// round fix cannot fork the truth: change the formula here and both surfaces move together.
describe('evaluatedFrame — the shared tick→frame map (sensing head + interactive cone)', () => {
  test('offset 0 is the identity clamp — non-sensing is byte-identical to the prior Math.min(tick, tickCount)', () => {
    for (const [tick, last] of [[0, 96], [1, 96], [55, 96], [96, 96], [200, 96]] as const)
      expect(evaluatedFrame(tick, 0, last)).toBe(Math.min(tick, last))
  })

  test('offset 1 rides one frame ahead and clamps at the terminal vertex (never past the trajectory)', () => {
    expect(evaluatedFrame(0, 1, 96)).toBe(1)   // tick 0 → frame 1: the interactive pose is NEVER the origin vertex
    expect(evaluatedFrame(55, 1, 96)).toBe(56)
    expect(evaluatedFrame(95, 1, 96)).toBe(96) // the terminal verdict tick lands on the last frame
    expect(evaluatedFrame(96, 1, 96)).toBe(96) // the finale rest (tick === tickCount) clamps, does not overrun
  })
})

// PAUSED-TICK POSE PARITY (the closure-round finding). Before the fix, at a paused tick Scene.Entities
// painted the drone cone at frame `tick` (offset 0) while SensingStage painted the head at frame tick+1 —
// two poses of one drone, one 2-m north step apart, on one stage (and the raycast cone hit-tested the stale
// pose). The fix threads TARGET_FRAME_OFFSET through the interactive pose so both ride the same evaluated
// frame. Proven pure here against the REAL bundle: the cone reads entityPosition(state frame f) and the head
// reads trail vertex f — buildTrail lays vertex f = entityPosition(state frame f), so equal frame ⇒ equal
// pose by construction. model.tickCount === trail.count − 1, so the two clamps pick the SAME f.
describe('paused-tick pose parity — the interactive drone rides the frame the sensing head paints (f2a)', () => {
  const model = modelFor('f2a_seed42')
  const trail = buildTrail(model)
  const subject = model.entityKeys()[0]!
  const OFFSET = TARGET_FRAME_OFFSET // the sensing head's offset — the interactive cone reuses this ONE constant

  // The interactive cone's paused (fraction 0) pose: entityPosition of the subject at the evaluated frame,
  // index 0 — exactly the matrix Scene.Entities writes for the cone / hit target / label / ring.
  const interactivePose = (tick: number): [number, number, number] => {
    const f = evaluatedFrame(tick, OFFSET, model.tickCount)
    const out: [number, number, number] = [0, 0, 0]
    entityPosition(out, model.entityStatesAt(asStateFrame(f)).get(subject)!, 0)
    return out
  }
  // The sensing head's pose: trail.positions at the head frame — exactly where SensingStage places the head.
  const headPose = (tick: number): [number, number, number] => {
    const f = evaluatedFrame(tick, OFFSET, trail.count - 1)
    return [trail.positions[f * 3]!, trail.positions[f * 3 + 1]!, trail.positions[f * 3 + 2]!]
  }

  test('the interactive-cone clamp and the head clamp resolve the SAME frame (tickCount === trail.count − 1)', () => {
    expect(model.tickCount).toBe(trail.count - 1)
    for (const tick of [0, 55, model.tickCount])
      expect(evaluatedFrame(tick, OFFSET, model.tickCount)).toBe(evaluatedFrame(tick, OFFSET, trail.count - 1))
  })

  test('interactive cone pose === sensing head pose at ticks 0 / 55 / terminal (coincident, not 2-m apart)', () => {
    for (const tick of [0, 55, model.tickCount]) {
      const cone = interactivePose(tick), head = headPose(tick)
      for (let i = 0; i < 3; i++) expect(cone[i]!).toBeCloseTo(head[i]!, 6)
    }
  })

  test('the pre-fix (unshifted) cone sat exactly one 2-m north step behind — the gap the fix closes', () => {
    // Reconstruct the OLD derivation (offset 0: cone reads frame `tick`) and show it differed from the head
    // (frame tick+1) by exactly the lattice north step. entityPosition maps NED-North → three-z, and the
    // f2a flight is n(k)=n0+2k with E,D constant, so the whole gap is on three-z.
    const tick = 55
    const stale: [number, number, number] = [0, 0, 0]
    entityPosition(stale, model.entityStatesAt(asStateFrame(tick)).get(subject)!, 0) // offset 0 — the bug
    const head = headPose(tick)
    expect(Math.abs(head[2] - stale[2])).toBeCloseTo(NORTH_STEP, 6) // 2.0 m — the exact stale-pose offset
    expect(head[0]).toBeCloseTo(stale[0], 6) // east unchanged frame-to-frame (the gap is purely the N step)
  })
})

// FRACTIONAL POSE PARITY (closure round 2). A pause does NOT clear the store fraction (only setTick does —
// viewStore), so integer-frame parity is only half the claim: Entities lerps the interactive cone t0→t1 by
// the fraction, and a head snapped at the integer evaluated frame sat ~1 m behind it at fraction 0.5,
// approaching the full 2-m split near fraction 1 — the residual half of the original two-pose finding. The
// head now lerps the SAME evaluated (t0, t1, fraction) sample (lerpHeadPosition), so cone and head coincide
// at EVERY playhead sample, not just integer rests. Proven against the REAL bundle.
describe('fractional pose parity — the head lerps the same (t0, t1, fraction) sample as the cone (f2a)', () => {
  const model = modelFor('f2a_seed42')
  const trail = buildTrail(model)
  const subject = model.entityKeys()[0]!
  const OFFSET = TARGET_FRAME_OFFSET

  // Scene.Entities' interactive pose at (tick, fraction): entityPosition at the evaluated t0 and its
  // successor t1, lerped by the fraction — the exact derivation the frame loop writes into the cone /
  // raycast hit-target matrix (Scene.tsx useFrame).
  const conePose = (tick: number, fraction: number): [number, number, number] => {
    // The test mirror of the cursor idiom now routes through the ONE resolver (A3) — the same (t0, t1) pair
    // Scene.Entities lerps the interactive cone with, so this parity oracle can never drift from the shipped shape.
    const { t0, t1 } = resolveCursor(asEventTick(tick), OFFSET, asStateFrame(model.tickCount))
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0]
    const p: [number, number, number] = [0, 0, 0]
    entityPosition(a, model.entityStatesAt(t0).get(subject)!, 0)
    entityPosition(b, model.entityStatesAt(t1).get(subject)!, 0)
    lerp3(p, a, b, fraction)
    return p
  }
  // The sensing head's pose: the view's own exported lerp, into a vector exactly as place() writes it.
  const headPoseF = (tick: number, fraction: number): [number, number, number] => {
    const v = new THREE.Vector3()
    lerpHeadPosition(v, trail, asEventTick(tick), fraction)
    return [v.x, v.y, v.z]
  }

  test('cone === head at ticks 0 / 55 / 95 across fractions 0 / 0.5 / 0.99 (the mid-motion pause window)', () => {
    for (const tick of [0, 55, 95]) {
      for (const fraction of [0, 0.5, 0.99]) {
        const c = conePose(tick, fraction), h = headPoseF(tick, fraction)
        for (let i = 0; i < 3; i++) expect(c[i]!).toBeCloseTo(h[i]!, 6)
      }
    }
  })

  test('the lerp is live, not a snapped no-op: fraction 0.5 moves the head half a north step', () => {
    const h0 = headPoseF(55, 0), h5 = headPoseF(55, 0.5)
    expect(Math.abs(h5[2]! - h0[2]!)).toBeCloseTo(NORTH_STEP / 2, 6) // three-z = NED north
    expect(h5[0]).toBeCloseTo(h0[0]!, 6) // east constant on this flight — the motion is purely the N step
  })

  test('the pre-fix snapped head sat 0.99 of a step behind the fraction-0.99 cone — the split this closes', () => {
    // Reconstruct the OLD head derivation (snapped at the evaluated frame, fraction ignored) and show the
    // near-full two-pose split it left against the lerping cone at a fraction-0.99 pause — then that the
    // NEW head closes it exactly.
    const f = evaluatedFrame(55, OFFSET, trail.count - 1)
    const snapped = [trail.positions[f * 3]!, trail.positions[f * 3 + 1]!, trail.positions[f * 3 + 2]!]
    const cone = conePose(55, 0.99)
    expect(Math.abs(cone[2]! - snapped[2]!)).toBeCloseTo(0.99 * NORTH_STEP, 6) // ~1.98 m — the old split
    const head = headPoseF(55, 0.99)
    for (let i = 0; i < 3; i++) expect(cone[i]!).toBeCloseTo(head[i]!, 6) // …and the new head closes it
  })

  test('terminal clamp: at the rest tick both t0 and t1 clamp to frame 96 — stationary under any fraction', () => {
    const rest = headPoseF(model.tickCount, 0)
    for (const fraction of [0, 0.5, 0.99]) {
      const c = conePose(model.tickCount, fraction), h = headPoseF(model.tickCount, fraction)
      for (let i = 0; i < 3; i++) expect(c[i]!).toBeCloseTo(h[i]!, 6)
      expect(h[2]!).toBeCloseTo(rest[2]!, 6) // no fraction can push the pose past the trajectory
    }
  })
})

// ── F3 — the sensing SUBJECT is resolved ONCE for every Scene.Entities consumer ────────────────────────────
// M7 fixed the STAGE mesh to tint the kind-22 subject's flight, but Scene.Entities still consumed entityKeys()[0]'s
// trail/bounds and tracked instance index 0. sensingSubjectRef resolves the subject KEY (which flight to
// trail/bound) AND its instance INDEX (which cone the tracking/finale ring name) so camera + highlight name the
// entity the evidence concerns. Certified bundles are single-subject-at-index-0 (byte-identical to pre-F3); the
// synthetic below is the latent multi-subject case — a first entity 1:0 with verdicts naming 1:7.
describe('sensingSubjectRef (F3) — the subject key + index name the entity the verdicts concern', () => {
  const keys = ['1:0', '1:7']
  const mkDraw = (seq: number, subject: string): SensingDraw => ({
    seq, tick: seq, subject, sensor: '0', inRange: true, inFov: true, losClear: true, eligible: true, tiebreak: false, g: [0, 0, 0],
  })
  const draws: (SensingDraw | null)[] = [mkDraw(0, '1:7'), null, mkDraw(2, '1:7')]

  test('the subject key + index name 1:7 at index 1, NOT entityKeys()[0]', () => {
    const ref = sensingSubjectRef(keys, draws)!
    expect(ref.key).toBe('1:7')
    expect(ref.index).toBe(1)
    expect(ref.key).not.toBe(keys[0]) // the whole point — the subject is not the first entity
  })

  test('the threaded trail/bounds name the SUBJECT (1:7\'s flight), never entityKeys()[0]\'s (1:0)', () => {
    // A minimal two-entity source: 1:0 flies along N, 1:7 along E — visibly different tracks.
    const source = {
      tickCount: 3,
      entityKeys: () => keys,
      entityStatesAt: (t: number) => new Map<string, { pos: number[] }>([
        ['1:0', { pos: [t, 0, 0] }],
        ['1:7', { pos: [0, t * 7, 0] }],
      ]),
    } as unknown as Parameters<typeof buildTrail>[0]
    const ref = sensingSubjectRef(keys, draws)!
    const subjectTrail = buildTrail(source, ref.key)
    const firstEntityTrail = buildTrail(source) // default → entityKeys()[0] === '1:0'
    // The threaded trail is 1:7's flight, distinct from the first entity's — and equals an explicit 1:7 build.
    expect(Array.from(subjectTrail.positions)).not.toEqual(Array.from(firstEntityTrail.positions))
    expect(Array.from(subjectTrail.positions)).toEqual(Array.from(buildTrail(source, '1:7').positions))
    // …so the camera-fit bounds derived from that trail also name the subject.
    expect(boundsFromPositions(subjectTrail.positions, subjectTrail.count))
      .not.toEqual(boundsFromPositions(firstEntityTrail.positions, firstEntityTrail.count))
  })

  test('withheld pin: no verdicts, multi-subject, or a subject absent from the key list → null (Scene falls back to the head defaults)', () => {
    expect(sensingSubjectRef(keys, [null, null])).toBeNull()                              // no kind-22 verdicts
    expect(sensingSubjectRef(keys, [mkDraw(0, '1:0'), mkDraw(1, '1:7')])).toBeNull()      // multi-subject → withheld
    expect(sensingSubjectRef(['1:0'], [mkDraw(0, '1:9')])).toBeNull()                     // subject absent from entityKeys
  })
})

// F2 — SensingSource.entityStatesAt reads the STATE-FRAME domain. buildSensingStage looks up the target pose at
// the EVALUATED frame (tick + TARGET_FRAME_OFFSET); typing the accessor's parameter StateFrame closes the
// method-bivariance hole that let a raw number — or, worse, a raw EVENT tick (substituting the un-shifted tick is
// the exact historical verdict-vs-pose off-by-one) — index this map through the structural seam. Both directives
// fire at typecheck; the runtime calls still return the (empty) Map, so the pin locks the domain both ways.
describe('SensingSource.entityStatesAt — the frame-domain seam rejects raw ticks (F2)', () => {
  // Annotated as SensingSource (not `satisfies`) so `src.entityStatesAt` carries the interface's DECLARED
  // (frame: StateFrame) signature — the pins below then fail specifically on the brand mismatch, not on arity.
  const src: SensingSource = {
    eventCount: 0, tickCount: 0, ticks: [] as readonly number[],
    kindAt: () => -1, eligibilityAt: () => null, detectionAt: () => null,
    entityStatesAt: () => new Map<string, { pos: number[] }>(),
  }
  test('a bare number cannot index the state-frame accessor', () => {
    // @ts-expect-error a raw number is not a StateFrame
    expect(src.entityStatesAt(0)).toBeInstanceOf(Map)
  })
  test('an EventTick cannot index the state-frame accessor (the un-shifted-tick substitution)', () => {
    // @ts-expect-error an EventTick is not a StateFrame
    expect(src.entityStatesAt(asEventTick(0))).toBeInstanceOf(Map)
  })
})
