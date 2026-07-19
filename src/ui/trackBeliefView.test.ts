import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ringTransform, DISC_COLOR, GAP_COLOR, discLuminance, DISC_IS_SUB_BLOOM, GAP_IS_SUB_BLOOM } from './trackBeliefView'
import { posEllipse } from './covEllipse'
import { buildTrackBelief } from './trackBelief'
import { nedToThree } from './placement'
import { BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'

// ── The belief STAGE view — the pure ring-transform derivation + the quiet-disc discipline ───────────────────
// A vitest cannot run the useFrame loop (no R3F canvas), so it pins the PURE ringTransform the loop writes — the
// ring's centre is the decoded mean through the shared basis, its radius is the 1σ eigen-semi-axis — plus the
// sub-bloom colour discipline. The reveal behaviour (NOT-YET → current, scrub-back widens) is pinned in
// trackBelief.test.ts (currentSample / sigmaAt) and end-to-end in the smoke journey.

function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

describe('ringTransform — the ring is centred on the DECODED mean, its radius is the 1σ semi-axis', () => {
  test('a DISC scales uniformly by the 1σ radius, no rotation, centred at nedToThree(mean)', () => {
    const e = posEllipse([3.333, 0, 0, 0, 0, 3.333, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 4)!
    expect(e.isDisc).toBe(true)
    const t = ringTransform(e, 12, -5) // meanN 12 (north), meanE −5 (east)
    // centre: NED[n,e,d]=[12,−5,0] → three[e,−d,n]=[−5,0,12] (the shared basis; y is ±0 on the deck plane)
    expect([...t.pos]).toEqual([...nedToThree([12, -5, 0])])
    expect(t.pos[0]).toBe(-5)      // east
    expect(t.pos[1]).toBeCloseTo(0, 12) // deck (−0)
    expect(t.pos[2]).toBe(12)      // north
    // uniform radius = the 1σ semi-axis, no orientation
    expect(t.scaleX).toBeCloseTo(e.semiMajor, 12)
    expect(t.scaleZ).toBeCloseTo(e.semiMajor, 12)
    expect(t.scaleX).toBe(t.scaleZ)
    expect(t.rotYRad).toBe(0)
  })

  test('an anisotropic ellipse takes the two semi-axes on the two in-plane axes + the major-axis rotation', () => {
    const e = posEllipse([4, 0, 0, 1], 2)! // semi 2 × 1, angle 0
    const t = ringTransform(e, 0, 0)
    expect(t.scaleX).toBeCloseTo(2, 12)
    expect(t.scaleZ).toBeCloseTo(1, 12)
    expect(t.rotYRad).toBeCloseTo(0, 12)
  })

  // NUMERICAL HONESTY — the ring TRANSFORM of the two hostile matrices renders their TRUE axes (not a circle / not a 0-axis).
  test('the hostile tiny matrix [[1e-20,0],[0,0]] renders its TRUE axes (1e-10 × 0), never a circle from a false isDisc', () => {
    const e = posEllipse([1e-20, 0, 0, 0], 2)!
    const t = ringTransform(e, 0, 0)
    expect(t.scaleX).toBeCloseTo(1e-10, 20) // the real major axis
    expect(t.scaleZ).toBe(0)                // the real minor axis is EXACTLY zero — never smeared equal to the major
    expect(t.scaleX).not.toBe(t.scaleZ)     // an ellipse, not a disc
  })
  test('the extreme condition-number matrix [[1e16,0],[0,1]] renders the small axis as 1, NOT 0 (determinant-stable λmin)', () => {
    const e = posEllipse([1e16, 0, 0, 1], 2)!
    const t = ringTransform(e, 0, 0)
    expect(t.scaleX).toBeCloseTo(1e8, 0)
    expect(t.scaleZ, 'the minor in-plane axis is 1, not lost to cancellation').toBeCloseTo(1, 9)
  })

  test('on the FROZEN f3a bundle: the ring radius equals the decoded 1σ, shrinking 1.83 m → 0.44 m', () => {
    const model = new RunModel(decodeBundle(detFixture('f3a_seed42')), null)
    const data = buildTrackBelief(model)
    const first = data.samples[0]!
    const last = data.samples.at(-1)!
    const tf = ringTransform(first.ellipse!, first.meanN, first.meanE)
    const tl = ringTransform(last.ellipse!, last.meanN, last.meanE)
    // the ring's uniform scale IS the decoded 1σ (a disc) — the shrink the smoke journey observes
    expect(tf.scaleX).toBeCloseTo(1.83, 2)
    expect(tl.scaleX).toBeCloseTo(0.44, 2)
    expect(tl.scaleX).toBeLessThan(tf.scaleX)
    // …and the ring rides the decoded mean, not a state-frame pose
    expect([...tf.pos]).toEqual([...nedToThree([first.meanN, first.meanE, 0])])
  })
})

describe('the disc + the gap-line are QUIET (sub-bloom) — the tightening + the error read, never a second emphasis', () => {
  test('the disc colour sits BELOW the bloom threshold (the mutating category token, scaled down)', () => {
    expect(discLuminance(DISC_COLOR)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
    expect(DISC_IS_SUB_BLOOM).toBe(true)
  })
  test('the gap-line colour sits BELOW the bloom threshold (a dim annotation between the two data marks)', () => {
    expect(discLuminance(GAP_COLOR)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
    expect(GAP_IS_SUB_BLOOM).toBe(true)
  })
})
