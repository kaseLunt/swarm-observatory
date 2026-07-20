import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { TOURS } from './tours'
import type { TourShot } from './tourTypes'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildTrackBelief, sigmaAt, errorAt, currentSample, type TrackSample } from '../ui/trackBelief'
import { asEventTick } from '../lib/brand'
import { encodeLink } from '../state/url'

// ── f3a belief tour — the byte-pin AND the caption-honesty pin ─────────────────────────────
// Two guarantees live here. (1) THE BYTE-PIN: every caption string, holdMs, playhead/selection action and authored
// arrive is frozen as an exact tuple (the e0/f2a idiom) so a silent edit fails. (2) THE CAPTION-HONESTY PIN: every
// number a caption states is re-derived from the decoded f3a bundle THROUGH the belief model at that beat's own
// playhead (the reported-1σ series sigmaAt, the actual-error series errorAt) — the same values the strip renders. A
// caption that drifts from the decoded model, or an inside/outside claim that contradicts the tick's error/σ ratio,
// fails here. The literals below are the model's output, never a copy of a planning table.

const f3a = TOURS.f3a!

// The reading windows, verbatim — [caption, holdMs, arrive]. A single-char edit or a moved hold must change here in
// lockstep. Each caption is ALSO honesty-pinned to the decoded model below, so this fixture cannot freeze a lie.
const F3A_CAPTIONS: readonly [string, number, TourShot | undefined][] = [
  ["A tracker has locked onto one drone. At its first fix the belief is wide — the reported 1σ is 1.83 m — and the drone's decoded position sits inside the disc.", 7900, { kind: 'head', distance: 'medium' }],
  ["Two more fixes in, the reported 1σ pulls in to 1.55 m — the tracker is growing confident, and the drone's decoded position is still inside the tightening disc.", 8000, { kind: 'head', distance: 'medium' }],
  ["Keep going and the two part ways: the disc has tightened under a metre — a reported 1σ of 0.76 m — but the gap to the drone's decoded truth has grown to 2.25 m, the tracker's actual error. The drone is now outside the disc.", 11200, { kind: 'head', distance: 'close' }],
  ["At its last fix the tracker is most sure of all — a reported 1σ of 0.44 m — while the decoded truth sits 2.43 m away, well outside the ring the tracker drew. More certain, and less right — overconfident.", 10400, { kind: 'head', distance: 'close' }],
  ["No fix comes after tick 79. The estimate holds at its last value — 0.44 m of reported confidence against 2.43 m of actual error — and at tick 87 the track times out and is dropped (TIMEOUT). It grows overconfident, then times out.", 11700, { kind: 'head', distance: 'close' }],
  ["Both halves are decoded: the ring is the tracker's own reported estimate, the drone is the decoded state truth, and the gap between them is the tracker's actual error — derived from all 78 decoded updates, sampled here at four checkpoints. This run, tick, and selection can be shared by URL.", 14800, { kind: 'stage' }],
]

describe('f3a belief tour — exact caption / hold / action / arrive byte-pin (parity with e0/f2a)', () => {
  test('six beats, identity unchanged', () => {
    expect(f3a.id).toBe('f3a-track')
    expect(f3a.runId).toBe('f3a')
    expect(f3a.title).toBe('What the tracker believes') // F3A_TOUR_TITLE — the owner's one-line swap point, pinned
    expect(f3a.steps).toHaveLength(6)
  })
  test('every caption + holdMs is verbatim (the reading windows are byte-frozen)', () => {
    f3a.steps.forEach((step, i) => {
      const [caption, holdMs] = F3A_CAPTIONS[i]!
      expect(step.caption).toBe(caption)
      expect(step.holdMs).toBe(holdMs)
    })
  })
  test('every authored arrive is pinned exactly (the establish + tightening beats medium; the divergence beats close; the bookend stage)', () => {
    f3a.steps.forEach((step, i) => {
      expect(step.arrive).toEqual(F3A_CAPTIONS[i]![2])
    })
    expect(f3a.steps[0]!.arrive).toEqual({ kind: 'head', distance: 'medium' })
    expect(f3a.steps[3]!.arrive).toEqual({ kind: 'head', distance: 'close' }) // the divergence beat frames close (the legibility remedy)
    expect(f3a.steps[5]!.arrive).toEqual({ kind: 'stage' })
  })
  // The COMPLETE per-step pin — toStrictEqual, NOT toMatchObject. Any EXTRA or MISSING field fails: a stray play on a
  // scrub beat, or an entity added beside a preserve-selection beat, no longer slips through. Composed from the actions
  // + F3A_CAPTIONS so each caption string lives in exactly one place. Every beat is a PURE PAUSED SCRUB (a tick, no play).
  const F3A_ACTIONS = [
    { tick: 2, select: { entity: '1:0', event: null } },
    { tick: 4 },
    { tick: 25 },
    { tick: 79 },
    { tick: 87 },
    { tick: 87 },
  ]
  const EXPECTED_F3A_STEPS = F3A_CAPTIONS.map(([caption, holdMs, arrive], i) => ({ ...F3A_ACTIONS[i]!, caption, holdMs, ...(arrive ? { arrive } : {}) }))
  test('every step is EXACTLY pinned — action, caption, holdMs, arrive; NO extra or missing field (toStrictEqual)', () => {
    expect(f3a.steps).toStrictEqual(EXPECTED_F3A_STEPS)
  })
  test('every beat is a paused scrub — a tick, never a play (the belief surface is fully playhead-driven)', () => {
    f3a.steps.forEach((step, i) => {
      expect(step.tick, `beat ${i} carries a tick`).toBeTypeOf('number')
      expect(step.play, `beat ${i} carries no play flight`).toBeUndefined()
    })
  })
})

// ── THE CAPTION-HONESTY PIN — every number matched to the decoded model at the beat's own playhead ────────────
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

describe('f3a belief tour — every caption number pinned to the decoded model at its beat tick', () => {
  const model = new RunModel(decodeBundle(detFixture('f3a_seed42')), null)
  const data = buildTrackBelief(model)
  const sigStr = (t: number): string => sigmaAt(data, asEventTick(t))!.toFixed(2)
  const errStr = (t: number): string => errorAt(data, asEventTick(t))!.toFixed(2)
  const ratio = (t: number): number => errorAt(data, asEventTick(t))! / sigmaAt(data, asEventTick(t))!
  // The beat → playhead-tick map is READ FROM THE TOUR (never hardcoded), so a moved tick re-derives its own numbers.
  const tickAt = (i: number): number => f3a.steps[i]!.tick!
  const cap = (i: number): string => f3a.steps[i]!.caption
  // WHOLE-SERIES extrema over EVERY valid decoded sample — a superlative may ride ONLY a real global extremum, so a
  // caption that claims a maximum the series does not have (the non-monotonic error) fails HERE, not just at its tick.
  const valid: TrackSample[] = data.samples.filter(s => s.ellipse !== null && s.gap !== null)
  const extremumTick = (score: (s: TrackSample) => number): number =>
    valid.reduce((best, s) => (score(s) > score(best) ? s : best)).tick
  const minSigmaTick = extremumTick(s => -s.ellipse!.semiMajor)        // the tightest reported 1σ (the global minimum)
  const maxErrorTick = extremumTick(s => s.gap!)                        // the largest actual error
  const maxRatioTick = extremumTick(s => s.gap! / s.ellipse!.semiMajor) // the largest error/σ ratio

  test('the decoded anchors this tour is authored against are the real fixture values', () => {
    expect(data.samples[0]!.tick).toBe(2)          // first update
    expect(data.samples.at(-1)!.tick).toBe(79)     // last update
    expect(data.dropped).not.toBeNull()
    expect(data.dropped!.tick).toBe(87)            // TrackDropped tick
    expect(data.dropped!.reason).toBe(1)           // TIMEOUT
    expect(data.samples.length).toBe(78)
    // the beat ticks the tour scrubs to
    expect([tickAt(0), tickAt(1), tickAt(2), tickAt(3), tickAt(4), tickAt(5)]).toEqual([2, 4, 25, 79, 87, 87])
  })

  test('beat 0 (establish) — the widest reported 1σ, the truth INSIDE the disc', () => {
    expect(sigStr(2)).toBe('1.83')
    expect(cap(0)).toContain(`${sigStr(2)} m`)     // "1.83 m" — the strip's current-1σ at t2
    expect(ratio(2)).toBeLessThan(1)               // the truth is within the disc…
    expect(cap(0)).toContain('inside')             // …and the caption says so
  })

  test('beat 1 (the disc tightens) — a tighter reported 1σ, the truth STILL inside', () => {
    expect(sigStr(4)).toBe('1.55')
    expect(cap(1)).toContain(`${sigStr(4)} m`)     // "1.55 m"
    expect(sigmaAt(data, asEventTick(4))!).toBeLessThan(sigmaAt(data, asEventTick(2))!) // it genuinely tightened
    expect(ratio(4)).toBeLessThan(1)
    expect(cap(1)).toContain('inside')
  })

  test('beat 2 (the error grows) — a sub-metre 1σ but the actual error past it: the truth OUTSIDE', () => {
    expect(sigStr(25)).toBe('0.76')
    expect(errStr(25)).toBe('2.25')
    expect(cap(2)).toContain(`${sigStr(25)} m`)    // "0.76 m" — reported confidence
    expect(cap(2)).toContain(`${errStr(25)} m`)    // "2.25 m" — actual error
    expect(ratio(25)).toBeGreaterThan(1)           // the truth has left the disc…
    expect(cap(2)).toContain('outside')            // …stated plainly
  })

  test('beat 3 (the divergence) — the tightest 1σ, the truth well outside, OVERCONFIDENT (never "broken")', () => {
    expect(sigStr(79)).toBe('0.44')
    expect(errStr(79)).toBe('2.43')
    expect(cap(3)).toContain(`${sigStr(79)} m`)    // "0.44 m"
    expect(cap(3)).toContain(`${errStr(79)} m`)    // "2.43 m"
    expect(ratio(79)).toBeGreaterThan(1)
    expect(cap(3)).toContain('overconfident')      // the decoded phenomenon, the sanctioned word
    // its ONE superlative ("most sure of all") is BACKED by the whole-series global minimum σ landing on this tick; the
    // wrongness is a comparison ("less right"), never a maximum — the error is non-monotonic (pinned in the extrema test).
    expect(cap(3)).toContain('most sure of all')
    expect(tickAt(3)).toBe(minSigmaTick)
  })

  test('the ONLY superlative rides a real global extremum — min σ at the divergence tick; error + ratio peak ELSEWHERE', () => {
    // "most sure of all" is true: the divergence beat sits on the global-minimum reported 1σ (the whole series).
    expect(minSigmaTick).toBe(79)
    expect(tickAt(3)).toBe(minSigmaTick)
    // …but the WRONGNESS has no maximum at t79. The actual error peaks at t43 (~3.51 m), and so does the error/σ ratio,
    // so t79's 2.43 m is NOT the worst — a "most wrong" superlative would be false, which is why the captions carry none.
    expect(maxErrorTick).toBe(43)
    expect(maxErrorTick).not.toBe(tickAt(3))
    expect(maxRatioTick).toBe(43)
    expect(maxRatioTick).not.toBe(tickAt(3))
    expect(errorAt(data, asEventTick(43))!).toBeGreaterThan(errorAt(data, asEventTick(79))!) // t79 is NOT the max error
  })

  test('beat 4 (the timeout) — the held last values, the drop tick + reason, SEQUENTIAL not causal', () => {
    // at t87 the playhead is past the last update, so the strip holds the last-revealed sample's numbers
    expect(sigStr(87)).toBe('0.44')
    expect(errStr(87)).toBe('2.43')
    expect(cap(4)).toContain(`${sigStr(87)} m`)
    expect(cap(4)).toContain(`${errStr(87)} m`)
    expect(cap(4)).toContain(`tick ${data.samples.at(-1)!.tick}`) // "tick 79" — the last fix
    expect(cap(4)).toContain(`tick ${data.dropped!.tick}`)        // "tick 87" — the drop
    expect(cap(4)).toContain('TIMEOUT')                            // the decoded reason (enum 1)
    expect(cap(4)).toContain('then times out')                    // sequential
    expect(cap(4).toLowerCase()).not.toContain('because')         // never causal
  })

  test('beat 5 (the receipt) — DERIVED from all 78 updates across four checkpoints; both halves named', () => {
    // the comparison is DERIVED from the whole decoded series, not "shown" at all 78 — the honest verb.
    expect(cap(5)).toContain(`${data.samples.length} decoded updates`) // "78 decoded updates" — the derivation population
    expect(cap(5)).toContain('derived')
    expect(cap(5)).toContain('reported estimate')                 // the ring is the tracker's estimate
    expect(cap(5)).toContain('decoded state truth')               // the drone is the decoded truth
    expect(cap(5)).toContain('actual error')                      // the gap is the tracker's actual error
  })

  test('the receipt names the RIGHT checkpoint count — the tour renders exactly FOUR distinct belief states', () => {
    // the DISTINCT resting samples the six beats reveal (both t87 beats hold the t79 sample, so they add none).
    const checkpoints = new Set(f3a.steps.map(s => currentSample(data, asEventTick(s.tick!))!.tick))
    expect([...checkpoints].sort((a, b) => a - b)).toEqual([2, 4, 25, 79])
    expect(checkpoints.size).toBe(4)
    expect(cap(5)).toContain('four checkpoints') // the receipt names exactly this displayed-checkpoint count
  })

  test('the share claim binds to the URL serializer field set — the guided view (tour/step/framing) never round-trips', () => {
    // encodeLink is the ONE share serializer; its emitted params are exactly what a shared link reproduces. Binding the
    // caption to this set means a serialization that GROWS or SHRINKS breaks the pin, forcing the share claim to follow.
    const keys = [...new URLSearchParams(encodeLink({ run: 'f3a', tick: 79, sel: '1:0', ev: 5, speed: 8 })).keys()].sort()
    expect(keys).toEqual(['ev', 'run', 'sel', 'speed', 'tick']) // run · tick · selection (sel + ev) · speed — and NOTHING else
    // the caption promises ONLY what round-trips (run, tick, selection); the recipient gets a resting stage, not this guided view.
    const c = cap(5).toLowerCase()
    expect(c).toContain('run')
    expect(c).toContain('tick')
    expect(c).toContain('selection')
    expect(c, 'the retired overreach ("every view is a shareable URL") must be gone').not.toContain('shareable')
    for (const notShared of ['tour', 'step', 'framing', 'camera', 'guided']) {
      expect(c, `the share claim must not promise "${notShared}" round-trips`).not.toContain(notShared)
    }
  })

  test('the binding copy rules hold across EVERY caption (overconfident not broken, sequential not causal, no probability overclaim, no wrongness superlative)', () => {
    const banned = [
      'because',      // the timeout is sequential, never causal
      'broken', 'buggy', 'bug', // the tracker is overconfident, never defective
      '68%', 'probability', 'probably', // the disc is the reported 1σ, not a probability region
      'most wrong', 'worst', 'least accurate', 'least right', // NO wrongness superlative — the error is non-monotonic
    ]
    for (const step of f3a.steps) {
      const low = step.caption.toLowerCase()
      for (const b of banned) expect(low, `caption must not contain "${b}": ${step.caption}`).not.toContain(b)
      expect(low, `no "never more … wrong" superlative: ${step.caption}`).not.toMatch(/never more[\s\S]{0,40}wrong/)
      // the two-family evidence grammar must not grow into the belief captions: it wears NO verdict glyph, and the
      // captions never borrow the strip's σ-multiple overclaim format ("≈N.Nσ OUTSIDE").
      for (const glyph of ['✓', '✗', '○', '≈', 'OUTSIDE']) {
        expect(step.caption, `caption must not contain "${glyph}"`).not.toContain(glyph)
      }
    }
  })
})
