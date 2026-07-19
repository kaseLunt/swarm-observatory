import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import {
  buildTrackBelief, currentSample, sigmaAt, errorAt, revealedUpdateCount, hasTrackContent,
  trackDisclosureMode, trackBeliefChipCopy, trackBeliefApplies, POS_DIM,
  TRACK_BELIEF_HONESTY, F3A_TRACK_REGISTRATION, type TrackBeliefSource,
} from './trackBelief'
import { chipAgreesWithLedger } from './lensContract'
import { PALETTE, CATEGORY } from './theme'
import { asEventTick, asStateFrame } from '../lib/brand'
import type { TrackConfirmed, TrackUpdated, TrackDropped } from '../decode/payloads'

// ── The belief lens model layer, pinned against the frozen f3a bundle + synthetics ───────────────────────────
// The oracle numbers here are DERIVED from the real vendored bytes THROUGH the decoders + the eigendecomposition —
// the literals are what the model MUST reproduce, never a copy of a design table. The reveal discipline, the
// fail-closed degradations (multi-track, malformed covariance, non-finite mean), and the registration contract
// are pinned alongside.

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
const ph = (t: number) => asEventTick(t)

describe('buildTrackBelief vs. the frozen f3a bundle — the one track, the shrinking disc', () => {
  const model = modelFor('f3a_seed42')
  const data = buildTrackBelief(model)

  test('the model decodes 78 updates of ONE track (id 1, about subject 0), confirmed then dropped (TIMEOUT)', () => {
    expect(data.samples.length).toBe(78)
    expect(data.track).toBe(1n)
    expect(data.subject).toBe(0n)
    expect(data.confirmedTick).not.toBeNull()
    expect(data.dropped).not.toBeNull()
    expect(data.dropped!.reason).toBe(1) // TIMEOUT=1
    expect(hasTrackContent(data)).toBe(true)
    expect(data.renderable).toBe(true)  // single track + every covariance valid
    expect(data.malformedCount).toBe(0)
    expect(data.allDiscs).toBe(true)    // every position submatrix is isotropic → the honest DISC
  })

  test('the samples are ascending by tick, spanning 2..79 (aligned index-for-index with the reveal clock)', () => {
    expect(data.samples[0]!.tick).toBe(2)
    expect(data.samples.at(-1)!.tick).toBe(79)
    for (let i = 1; i < data.samples.length; i++) expect(data.samples[i]!.tick).toBeGreaterThanOrEqual(data.samples[i - 1]!.tick)
    expect(data.clock.total).toBe(78)
  })

  test('the whole-run 1σ endpoints are DERIVED (sqrt of the decoded position variance): 1.83 m → 0.44 m', () => {
    // independent derivation from the decoded cov, NOT a copy of the model's own posEllipse output.
    const first = model.trackUpdatedAt(data.samples[0]!.seq)!
    const last = model.trackUpdatedAt(data.samples.at(-1)!.seq)!
    expect(data.sigmaFirst).toBeCloseTo(Math.sqrt(first.cov[0]!), 12)
    expect(data.sigmaLast).toBeCloseTo(Math.sqrt(last.cov[0]!), 12)
    expect(data.sigmaFirst).toBeCloseTo(1.83, 2)
    expect(data.sigmaLast).toBeCloseTo(0.44, 2)
    expect(data.sigmaLast!).toBeLessThan(data.sigmaFirst!) // the filter visibly gains confidence
  })

  test('the ring centre is the DECODED mean (mean[0]=north, mean[1]=east), not a state-frame pose', () => {
    const s0 = data.samples[0]!
    const upd = model.trackUpdatedAt(s0.seq)!
    expect(s0.meanN).toBe(upd.mean[0])
    expect(s0.meanE).toBe(upd.mean[1])
    expect(POS_DIM).toBe(4) // f3a's [px,py,vx,vy] state → the 4×4 covariance
  })

  // ── THE REVEAL DISCIPLINE — the disc follows the playhead; before tick 2 it is NOT-YET; scrub-back widens it ──
  test('before the first update (ticks 0,1) the current disc is NULL (NOT-YET); at tick 2 the first disc appears', () => {
    expect(currentSample(data, ph(0))).toBeNull()
    expect(currentSample(data, ph(1))).toBeNull()
    expect(sigmaAt(data, ph(0))).toBeNull()
    const at2 = currentSample(data, ph(2))
    expect(at2).not.toBeNull()
    expect(at2!.tick).toBe(2)
    expect(sigmaAt(data, ph(2))).toBeCloseTo(data.sigmaFirst!, 12)
  })

  test('scrub FORWARD tightens the disc, scrub BACK widens it (a pure function of the playhead, both directions)', () => {
    const early = sigmaAt(data, ph(3))!
    const mid = sigmaAt(data, ph(40))!
    const late = sigmaAt(data, ph(79))!
    expect(mid).toBeLessThan(early) // later reveal → tighter
    expect(late).toBeLessThan(mid)
    // scrub BACK from 79 to 3 recovers the wider early disc (no sticky reveal left behind)
    expect(sigmaAt(data, ph(3))).toBe(early)
    expect(late).toBeCloseTo(data.sigmaLast!, 12)
  })

  test('the revealed-update tally is the reveal clock prefix count: 0 before, grows with the playhead, 78 at full reveal', () => {
    expect(revealedUpdateCount(data, ph(0))).toBe(0)
    expect(revealedUpdateCount(data, ph(2))).toBe(1)
    expect(revealedUpdateCount(data, ph(79))).toBe(78)
    expect(revealedUpdateCount(data, ph(200))).toBe(78) // past the end — the whole sequence
  })

  // ── THE BELIEF-vs-REALITY HALF — the ring is the estimate, the drone the truth; the decoded gap is the error ──
  test('the reality half is decoded (subject 1:0), and each per-sample gap = |mean − state[t]| (offset 0)', () => {
    expect(data.hasReality).toBe(true)
    expect(data.subjectKey).toBe('1:0')
    // tick 2 — the gap derived INDEPENDENTLY from the decoded bytes (offset 0: the tracker's tick-t estimate vs the
    // tick-t state truth). The decoded fixture oracle: mean(2.22,0.03) vs state(2,0), gap 0.226.
    const s2 = data.samples[0]!
    const truth2 = model.entityStatesAt(asStateFrame(2)).get('1:0')!.pos
    expect(s2.truthN).toBe(truth2[0])
    expect(s2.truthE).toBe(truth2[1])
    expect(s2.gap).toBeCloseTo(Math.hypot(s2.meanN - truth2[0]!, s2.meanE - truth2[1]!), 12)
    expect(s2.gap).toBeCloseTo(0.226, 2)
    // tick 3 — the decoded fixture oracle: mean(5.4038,−0.6452) vs state(4,0), gap 1.545, ~within the σ 1.673 there.
    const s3 = data.samples.find(s => s.tick === 3)!
    expect(s3.gap).toBeCloseTo(1.545, 2)
    expect(s3.gap!).toBeLessThan(s3.ellipse!.semiMajor) // early: the truth sits INSIDE the 1σ disc
  })

  test('THE OVERCONFIDENCE FINDING — the reported 1σ shrinks while the actual error GROWS; the truth ends outside the disc', () => {
    expect(data.gapFirst).toBeCloseTo(0.226, 2)   // the error at the first update
    expect(data.gapLast).toBeCloseTo(2.43, 2)     // …grows by the last update
    expect(data.gapLast!).toBeGreaterThan(data.gapFirst!) // error grows while σ shrinks (1.83 → 0.44)
    expect(data.truthEndsOutsideSigma).toBe(true) // gapLast (2.43) > sigmaLast (0.44) — the truth left the disc
    expect(data.gapLast! / data.sigmaLast!).toBeGreaterThan(5) // ≈5.5σ outside — overconfident
  })

  test('errorAt follows the playhead: NOT-YET before t2, then the growing decoded error (a pure function of the playhead)', () => {
    expect(errorAt(data, ph(0))).toBeNull()
    expect(errorAt(data, ph(2))).toBeCloseTo(data.gapFirst!, 12)
    expect(errorAt(data, ph(79))).toBeCloseTo(data.gapLast!, 12)
    expect(errorAt(data, ph(79))!).toBeGreaterThan(errorAt(data, ph(3))!) // the error grows as the playhead advances
  })

  test('the chip names BOTH halves + the actual-error growth + the overconfidence — a real belief-vs-reality claim', () => {
    const chip = trackBeliefChipCopy(data)
    expect(chip).toContain('whole run')
    expect(chip).toContain('disc')
    expect(chip).toContain('decoded')
    expect(chip).toContain('1.83 m → 0.44 m')            // the reported 1σ shrink
    expect(chip).toContain('actual error')
    expect(chip).toContain('0.23 m → 2.43 m')            // …while the actual error grows
    expect(chip).toContain('the truth leaves the disc')  // overconfident
    expect(chip).toContain('the track times out')        // the TIMEOUT drop, earned from the decoded reason
    expect(chip).toContain('Both halves decoded')
  })
})

// ── SYNTHETIC SOURCES — the fail-closed degradations no certified bundle exercises ────────────────────────────
// A minimal TrackBeliefSource. `entityKeys` positioned by default (the belief lens's positioned gate); overridable.
function trackSource(opts: {
  updates: { tick: number; track: bigint; mean: number[]; cov: number[] }[]
  confirmed?: { tick: number; track: bigint; subject: bigint }
  dropped?: { tick: number; track: bigint; reason: number }
  positioned?: boolean
  kind22?: boolean
  tickCount?: number
}): TrackBeliefSource {
  // seq layout: [confirmed?] then updates then [dropped?] then [a kind-22 filler?]
  type Ev = { kind: number; tick: number; conf?: TrackConfirmed; upd?: TrackUpdated; drop?: TrackDropped }
  const evs: Ev[] = []
  if (opts.confirmed) evs.push({ kind: 2, tick: opts.confirmed.tick, conf: { track: opts.confirmed.track, subject: opts.confirmed.subject, mean: [0, 0, 0, 0], cov: new Array(16).fill(0) } })
  for (const u of opts.updates) evs.push({ kind: 3, tick: u.tick, upd: { track: u.track, mean: u.mean, cov: u.cov, innovation: [0, 0], innovationCov: [0, 0, 0, 0] } })
  if (opts.dropped) evs.push({ kind: 4, tick: opts.dropped.tick, drop: { track: opts.dropped.track, reason: opts.dropped.reason } })
  if (opts.kind22) evs.push({ kind: 22, tick: 0 })
  return {
    eventCount: evs.length,
    tickCount: opts.tickCount ?? 100,
    ticks: evs.map(e => e.tick),
    kindAt: (s) => evs[s]!.kind,
    entityKeys: () => (opts.positioned === false ? [] : ['1:0']),
    // No reality poses in these synthetics (an empty state map) → hasReality false → the belief-only branch. The real
    // belief-vs-reality half is pinned against the frozen f3a bundle (which carries the subject's real poses) above.
    entityStatesAt: () => new Map<string, { pos: number[] }>(),
    trackConfirmedAt: (s) => evs[s]!.conf ?? null,
    trackUpdatedAt: (s) => evs[s]!.upd ?? null,
    trackDroppedAt: (s) => evs[s]!.drop ?? null,
  }
}
// a well-formed isotropic 4×4 cov with variance v on the position diagonal.
const isoCov = (v: number): number[] => { const c = new Array(16).fill(0); c[0] = v; c[5] = v; c[10] = 1; c[15] = 1; return c }

describe('buildTrackBelief — the fail-closed degradations (multi-track, malformed cov, non-finite mean)', () => {
  test('a MALFORMED covariance (non-symmetric) fails the lens closed: malformedCount 1, not renderable, disclosure "malformed covariance"', () => {
    const bad = isoCov(3); bad[1] = 2; bad[4] = 5 // off-diagonals disagree → covEllipse returns null
    const data = buildTrackBelief(trackSource({ updates: [
      { tick: 2, track: 1n, mean: [1, 0, 0, 0], cov: isoCov(3) },
      { tick: 3, track: 1n, mean: [2, 0, 0, 0], cov: bad },
    ] }))
    expect(data.samples.length).toBe(2)
    expect(data.malformedCount).toBe(1)
    expect(data.renderable).toBe(false)
    expect(trackDisclosureMode(data)).toBe('malformed covariance')
    const chip = trackBeliefChipCopy(data)
    expect(chip).toContain('malformed covariance')
    expect(chip).not.toContain('tightens') // no shrink claim on a suspect covariance stream
  })

  test('MULTIPLE tracks fail closed: track null, not renderable, disclosure "multiple tracks"', () => {
    const data = buildTrackBelief(trackSource({ updates: [
      { tick: 2, track: 1n, mean: [1, 0, 0, 0], cov: isoCov(3) },
      { tick: 3, track: 2n, mean: [2, 0, 0, 0], cov: isoCov(2) },
    ] }))
    expect(data.track).toBeNull()
    expect(data.renderable).toBe(false)
    expect(trackDisclosureMode(data)).toBe('multiple tracks')
    expect(trackBeliefChipCopy(data)).toContain('multiple tracks')
  })

  test('a NON-FINITE mean fails closed (a ring cannot be placed at NaN): counted malformed, not renderable', () => {
    const data = buildTrackBelief(trackSource({ updates: [
      { tick: 2, track: 1n, mean: [NaN, 0, 0, 0], cov: isoCov(3) },
    ] }))
    expect(data.malformedCount).toBe(1)
    expect(data.renderable).toBe(false)
  })

  test('a single-track, all-valid synthetic IS renderable (the positive control) and states the shrink', () => {
    const data = buildTrackBelief(trackSource({
      confirmed: { tick: 1, track: 7n, subject: 3n },
      updates: [
        { tick: 2, track: 7n, mean: [1, 0, 0, 0], cov: isoCov(4) }, // 1σ 2
        { tick: 5, track: 7n, mean: [2, 0, 0, 0], cov: isoCov(1) }, // 1σ 1
      ],
      dropped: { tick: 9, track: 7n, reason: 1 },
    }))
    expect(data.renderable).toBe(true)
    expect(data.track).toBe(7n)
    expect(data.subject).toBe(3n)
    expect(data.sigmaFirst).toBeCloseTo(2, 12)
    expect(data.sigmaLast).toBeCloseTo(1, 12)
    // NO reality pose in this synthetic (empty state map) → the belief-only chip branch, honestly labelled.
    expect(data.hasReality).toBe(false)
    const chip = trackBeliefChipCopy(data)
    expect(chip).toContain('2.00 m → 1.00 m')
    expect(chip).toContain('no reality overlay on this run')
    expect(chip).not.toContain('actual error') // no error claim without a reality pose
  })
})

// ── THE REGISTRATION — the FOURTH conforming citizen ─────────────────────────────────────────────────────────
describe('F3A_TRACK_REGISTRATION — the LAW-4 declaration as data', () => {
  test('the mount gate is the ONE complete predicate (trackBeliefApplies), shared by mount/chip/strip', () => {
    expect(F3A_TRACK_REGISTRATION.mountGate).toBe(trackBeliefApplies.name)
    expect(F3A_TRACK_REGISTRATION.id).toBe('f3a-track')
  })
  test('the honesty chip is DERIVED from and AGREES with the ledger (one source of honesty)', () => {
    expect(F3A_TRACK_REGISTRATION.honestyChip).toBe(TRACK_BELIEF_HONESTY)
    expect(chipAgreesWithLedger(F3A_TRACK_REGISTRATION)).toBe(true)
  })
  test('every borrowed hue names an EXISTING token (LAW 2 — the palette does not grow)', () => {
    const paletteKeys = new Set(Object.keys(PALETTE))
    const categoryKeys = new Set(Object.keys(CATEGORY))
    for (const h of F3A_TRACK_REGISTRATION.borrowedHues) {
      if (h.startsWith('category:')) expect(categoryKeys.has(h.slice('category:'.length))).toBe(true)
      else expect(paletteKeys.has(h)).toBe(true)
    }
    // the identity hue is the MUTATING category (track kinds 2/3/4 ARE the mutating category)
    expect(F3A_TRACK_REGISTRATION.borrowedHues).toContain('category:mutating')
  })
  test('the disc + 1σ + gap classes are DERIVED-DISPLAY (no verdict glyph); the reality pose is DECODED; NO recomputed class', () => {
    const byId = new Map(F3A_TRACK_REGISTRATION.provenance.map(p => [p.id, p]))
    expect(byId.get('covariance-disc')!.tier).toBe('derived-display')
    expect(byId.get('sigma-readout')!.tier).toBe('derived-display')
    expect(byId.get('belief-error')!.tier).toBe('derived-display') // the gap is a derivation of decoded values — no glyph
    expect(byId.get('track-mean')!.tier).toBe('decoded')
    expect(byId.get('reality-pose')!.tier).toBe('decoded')          // the state truth is a decoded fact
    // NO recomputed class (so no executor is needed — a derivation, never an adjudication) and NO quality caveat
    expect(F3A_TRACK_REGISTRATION.provenance.some(p => p.tier === 'recomputed')).toBe(false)
    expect(F3A_TRACK_REGISTRATION.provenance.some(p => p.caveat !== undefined)).toBe(false)
    // …and NO scenario-constant class (the disc is a derivation of decoded values, not a declared constant)
    expect(F3A_TRACK_REGISTRATION.provenance.some(p => p.tier === 'scenario-constant')).toBe(false)
  })
  test('every non-presentational pixel-class carries a contract/ anchor', () => {
    for (const p of F3A_TRACK_REGISTRATION.provenance) {
      if (p.tier !== 'presentational') expect(p.source!).toMatch(/^contract\//)
      else expect(p.source).toBeNull()
    }
  })
})
