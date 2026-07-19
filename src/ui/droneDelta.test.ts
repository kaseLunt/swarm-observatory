import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildTrail } from './trail'
import {
  deltaGeometry, deltaBoundingRadius, DELTA_NOSE_Z, DELTA_WING_HALFWIDTH, DELTA_WING_Z, DELTA_NOTCH_Z, DELTA_SPINE_Y,
} from './droneDelta'

// ── THE ORIENTED DRONE DELTA — the convention derived from decoded motion, and pinned ────────────────────
// The delta REPLACES the axially-symmetric cone that wasted the decoded heading. The nose rests on local +Z,
// and the render site (Scene.Entities / the f2a head) yaws it by makeRotationY(headingRad) — vertical axis
// ONLY. These pins are the net the task requires: the nose leads the MOTION over a straight decoded segment
// (the convention is derived from the bytes, not assumed), the transform is yaw-only (no pitch/roll the bundle
// never carried), and the declared marker extent equals the drawn geometry's real bounding radius.

// e0/f0/f1 are flat .det fixtures; f2a/f3a/f4 are dir fixtures (one attempt dir holding bundle.det) — the same
// resolver messageTrack.oracle.test uses.
function loadModel(name: string): RunModel {
  let b: Buffer
  try {
    b = readFileSync(`contract/fixtures/${name}.det`)
  } catch {
    const base = `contract/fixtures/${name}`
    const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
    b = readFileSync(`${base}/${dir}/bundle.det`)
  }
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return new RunModel(decodeBundle(ab as ArrayBuffer), null)
}

// The production transform: nose on local +Z, yawed by makeRotationY(sign·heading). Returns the world-space
// nose direction in the ground plane. sign +1 is the shipped (correct) convention; −1 is the OLD cone sign.
const NOSE_LOCAL = new THREE.Vector3(0, 0, 1)
function noseGround(headingRad: number, sign: 1 | -1 = 1): { x: number; z: number } {
  const v = NOSE_LOCAL.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(sign * headingRad))
  return { x: v.x, z: v.z }
}
const align2 = (n: { x: number; z: number }, dx: number, dz: number): number =>
  (n.x * dx + n.z * dz) / (Math.hypot(n.x, n.z) * Math.hypot(dx, dz))

describe('nose-leads-motion — the convention derived from f1\'s real decoded flight', () => {
  const trail = buildTrail(loadModel('f1_seed42'))

  test('over EVERY straight decoded segment, the delta nose aligns with the velocity direction (makeRotationY(+heading))', () => {
    let tested = 0
    let nonZeroTested = 0
    for (let f = 0; f + 1 < trail.count; f++) {
      const dx = trail.positions[(f + 1) * 3]! - trail.positions[f * 3]!
      const dz = trail.positions[(f + 1) * 3 + 2]! - trail.positions[f * 3 + 2]!
      if (Math.hypot(dx, dz) < 1e-3) continue // at rest — no motion direction to lead
      const h = trail.heading[f]!
      if (Math.abs(h - trail.heading[f + 1]!) > 1e-9) continue // a turn spans two headings — only straight segments
      // The nose (local +Z yawed by +heading) points exactly along the decoded ground velocity.
      expect(align2(noseGround(h), dx, dz)).toBeGreaterThan(0.9999)
      tested++
      if (Math.abs(Math.sin(h)) > 0.4) nonZeroTested++
    }
    expect(tested).toBeGreaterThan(0)
    // The discriminating requirement: at least one tested frame has a genuinely NON-ZERO heading (|sin h| large),
    // where the mirrored sign is visibly wrong. A due-north run (f2a, heading 0) could never exercise this.
    expect(nonZeroTested).toBeGreaterThan(0)
  })

  test('the OLD cone sign (makeRotationY(−heading)) would point the nose OFF the motion at a non-zero heading (the mirror the cone hid)', () => {
    // Find the straight segment with the largest |sin(heading)| — where the sign matters most.
    let best = -1, bestSin = -1
    for (let f = 0; f + 1 < trail.count; f++) {
      const dx = trail.positions[(f + 1) * 3]! - trail.positions[f * 3]!
      const dz = trail.positions[(f + 1) * 3 + 2]! - trail.positions[f * 3 + 2]!
      if (Math.hypot(dx, dz) < 1e-3) continue
      const h = trail.heading[f]!
      if (Math.abs(h - trail.heading[f + 1]!) > 1e-9) continue
      const s = Math.abs(Math.sin(h))
      if (s > bestSin) { bestSin = s; best = f }
    }
    expect(best).toBeGreaterThanOrEqual(0)
    expect(bestSin).toBeGreaterThan(0.4) // a genuinely non-zero heading witness exists in f1
    const dx = trail.positions[(best + 1) * 3]! - trail.positions[best * 3]!
    const dz = trail.positions[(best + 1) * 3 + 2]! - trail.positions[best * 3 + 2]!
    const h = trail.heading[best]!
    expect(align2(noseGround(h, 1), dx, dz)).toBeGreaterThan(0.9999) // shipped sign: leads the motion
    expect(align2(noseGround(h, -1), dx, dz)).toBeLessThan(0.9)      // old cone sign: the mirror, off the motion
  })
})

describe('f2a due-north flight — heading 0 rests the nose on world +Z (the identity case)', () => {
  const trail = buildTrail(loadModel('f2a_seed42'))
  test('the head delta nose leads f2a\'s decoded north velocity, and heading is 0 throughout (why f2a cannot catch the sign)', () => {
    let moved = 0
    for (let f = 0; f + 1 < trail.count; f++) {
      const dx = trail.positions[(f + 1) * 3]! - trail.positions[f * 3]!
      const dz = trail.positions[(f + 1) * 3 + 2]! - trail.positions[f * 3 + 2]!
      if (Math.hypot(dx, dz) < 1e-3) continue
      expect(Math.abs(Math.sin(trail.heading[f]!))).toBeLessThan(1e-6) // due north the whole run → sign-blind
      expect(align2(noseGround(trail.heading[f]!), dx, dz)).toBeGreaterThan(0.9999)
      moved++
    }
    expect(moved).toBeGreaterThan(0)
  })
})

describe('yaw-only — the delta lies flat in the ground plane, no pitch/roll (the bundle carries no attitude)', () => {
  test('makeRotationY(heading) fixes the world up-axis and maps the ground plane to itself, for any heading', () => {
    for (const h of [0, 0.3, 1.2, -2.6, 2.9344, Math.PI, -Math.PI / 2]) {
      const m = new THREE.Matrix4().makeRotationY(h)
      const up = new THREE.Vector3(0, 1, 0).applyMatrix4(m)
      expect(up.x).toBeCloseTo(0, 12); expect(up.y).toBeCloseTo(1, 12); expect(up.z).toBeCloseTo(0, 12)
      // A ground-plane vector stays in the ground plane (y = 0): no pitch, no bank.
      const g = new THREE.Vector3(0.7, 0, -0.3).applyMatrix4(m)
      expect(g.y).toBeCloseTo(0, 12)
    }
  })

  test('the geometry itself is flat — the planform lies at y = 0; only the single centreline spine apex is raised', () => {
    const g = deltaGeometry(7)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    // Vertices 0..3 (nose, wingtips, notch) are the flat planform; vertex 4 is the raised spine apex (on x = 0).
    for (let i = 0; i < 4; i++) expect(p.getY(i)).toBeCloseTo(0, 12)
    expect(p.getY(4)).toBeGreaterThan(0)      // the spine is raised (a presentational body cue)
    expect(p.getX(4)).toBeCloseTo(0, 12)      // ...on the centreline, so it never widens the ground footprint
    expect(p.getY(4)).toBeCloseTo(DELTA_SPINE_Y * 7, 4) // Float32 buffer precision
  })
})

describe('marker extent — derived from the drawn geometry (the drift-twin)', () => {
  test('deltaBoundingRadius equals the radius the delta is built at, for any size', () => {
    for (const r of [0.6, 1.35, 7, 12.5]) {
      expect(deltaBoundingRadius(deltaGeometry(r))).toBeCloseTo(r, 6)
    }
  })

  test('the wingtips sit at radius r (hypot(0.6, 0.8) = 1) and the nose at radius r — the two farthest planform points', () => {
    expect(Math.hypot(DELTA_WING_HALFWIDTH, DELTA_WING_Z)).toBeCloseTo(1, 12)
    expect(Math.abs(DELTA_NOSE_Z)).toBeCloseTo(1, 12)
    expect(Math.abs(DELTA_NOTCH_Z)).toBeLessThan(1) // the rear notch is forward of the wingtips (the chevron concavity)
  })
})
