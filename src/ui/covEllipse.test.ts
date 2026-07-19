import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { posEllipse } from './covEllipse'
import { decodeBundle } from '../decode/decodeBundle'
import { decodeEvent, decodeTrackUpdated, TRACK_UPDATED } from '../decode/payloads'

// ── covEllipse — the pure eigendecomposition leaf, pinned against the FROZEN f3a bytes + synthetics ─────────
// Same posture as messageTrack.oracle.test.ts: the f3a sigma endpoints here are DERIVED from the real vendored
// bytes THROUGH the decoders and the eigendecomposition — the literals are what the math MUST reproduce, never a
// copy of a design table. The isotropy is ASSERTED before any "disc" language (the honesty pin). The anisotropic
// path is exercised on a hand-built symmetric matrix with KNOWN eigenvalues (future bundles), and the fail-closed
// contract on malformed / non-PSD / non-finite / non-symmetric matrices (never a NaN ring).

function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const payloadOf = (run: ReturnType<typeof decodeBundle>, i: number) =>
  decodeEvent(new Uint8Array(run.det).subarray(run.payloadOff[i]!, run.payloadOff[i]! + run.payloadLen[i]!)).payload
const updatedSeqs = (run: ReturnType<typeof decodeBundle>): number[] => {
  const out: number[] = []
  for (let i = 0; i < run.kind.length; i++) if (run.kind[i] === TRACK_UPDATED) out.push(i)
  return out
}

describe('posEllipse vs. the frozen f3a bundle — the isotropic shrinking DISC (1.83 m → 0.44 m)', () => {
  const run = decodeBundle(detFixture('f3a_seed42'))
  const seqs = updatedSeqs(run)
  // f3a's TrackUpdated cov is a 4×4 row-major [px,py,vx,vy] covariance → dim 4, position submatrix {0,1,4,5}.
  const DIM = 4
  const covAt = (i: number): number[] => decodeTrackUpdated(payloadOf(run, seqs[i]!)).cov

  test('the FIRST update (tick 2) is an isotropic DISC — 1σ 1.83 m (variance 3.333), asserted isotropic BEFORE disc language', () => {
    const cov = covAt(0)
    expect(run.tick[seqs[0]!]).toBe(2)
    // ISOTROPY FIRST (the honesty pin): off-diagonals bit-exact 0 AND equal diagonal — so it IS a disc, not an ellipse.
    expect(cov[1]).toBe(0)
    expect(cov[4]).toBe(0)
    expect(cov[0]).toBe(cov[5])
    const e = posEllipse(cov, DIM)!
    expect(e, 'a well-formed PSD submatrix decodes').not.toBeNull()
    expect(e.isDisc).toBe(true)                     // …only NOW may the copy say "disc"
    expect(e.semiMajor).toBeCloseTo(e.semiMinor, 12) // equal semi-axes — a circle
    expect(e.angleRad).toBe(0)                       // a disc has no orientation → 0
    // the 1σ is DERIVED here (sqrt of the decoded position variance), the derivation IS the pin.
    expect(cov[0]).toBeCloseTo(3.333, 3)
    expect(e.semiMajor).toBeCloseTo(Math.sqrt(cov[0]!), 15) // 1σ === sqrt(variance) exactly for a disc
    expect(e.semiMajor).toBeCloseTo(1.83, 2)
  })

  test('the LAST update (tick 79) is a tighter DISC — 1σ 0.44 m (variance 0.196)', () => {
    const cov = covAt(seqs.length - 1)
    expect(run.tick[seqs.at(-1)!]).toBe(79)
    expect(cov[1]).toBe(0); expect(cov[4]).toBe(0); expect(cov[0]).toBe(cov[5])
    const e = posEllipse(cov, DIM)!
    expect(e.isDisc).toBe(true)
    expect(cov[0]).toBeCloseTo(0.196, 3)
    expect(e.semiMajor).toBeCloseTo(0.44, 2)
  })

  test('EVERY one of the 78 updates is an isotropic disc, and the sequence is MONOTONICALLY tightening', () => {
    let prev = Infinity
    for (let i = 0; i < seqs.length; i++) {
      const e = posEllipse(covAt(i), DIM)!
      expect(e, `update ${i} decodes`).not.toBeNull()
      expect(e.isDisc, `update ${i} is a disc`).toBe(true)
      expect(e.semiMajor, `update ${i} tightens or holds`).toBeLessThanOrEqual(prev + 1e-12)
      prev = e.semiMajor
    }
    // the filter visibly gains confidence end-to-end: the last 1σ is far tighter than the first.
    expect(posEllipse(covAt(seqs.length - 1), DIM)!.semiMajor)
      .toBeLessThan(posEllipse(covAt(0), DIM)!.semiMajor)
  })

  // a few MID-RUN values derived independently (sqrt of the decoded variance) — the derivation is the pin.
  test('mid-run 1σ values equal sqrt(decoded position variance) exactly (independent derivation)', () => {
    for (const i of [10, 25, 40, 60]) {
      const cov = covAt(i)
      const e = posEllipse(cov, DIM)!
      expect(e.semiMajor).toBeCloseTo(Math.sqrt(cov[0]!), 15)
      expect(e.semiMinor).toBeCloseTo(Math.sqrt(cov[5]!), 15)
    }
  })
})

describe('posEllipse — the anisotropic path on hand-built symmetric matrices with KNOWN eigenvalues', () => {
  // A 2×2 matrix (dim 2). The eigenvalues of [[a,b],[b,c]] are (a+c)/2 ± sqrt(((a−c)/2)²+b²).
  test('axis-aligned, major along the FIRST axis: [[4,0],[0,1]] → semi 2 × 1, angle 0, NOT a disc', () => {
    const e = posEllipse([4, 0, 0, 1], 2)!
    expect(e.semiMajor).toBeCloseTo(2, 12)
    expect(e.semiMinor).toBeCloseTo(1, 12)
    expect(e.angleRad).toBeCloseTo(0, 12)     // major along the first axis
    expect(e.isDisc).toBe(false)
  })
  test('axis-aligned, major along the SECOND axis: [[1,0],[0,4]] → semi 2 × 1, angle π/2', () => {
    const e = posEllipse([1, 0, 0, 4], 2)!
    expect(e.semiMajor).toBeCloseTo(2, 12)
    expect(e.semiMinor).toBeCloseTo(1, 12)
    expect(e.angleRad).toBeCloseTo(Math.PI / 2, 12) // major along the second axis
  })
  test('a 45°-rotated ellipse: [[3,1],[1,3]] → eigenvalues 4 & 2 (semi 2 × √2), angle π/4', () => {
    const e = posEllipse([3, 1, 1, 3], 2)!
    expect(e.semiMajor).toBeCloseTo(2, 12)
    expect(e.semiMinor).toBeCloseTo(Math.SQRT2, 12)
    expect(e.angleRad).toBeCloseTo(Math.PI / 4, 12)
    expect(e.isDisc).toBe(false)
  })
  test('the position submatrix is read from a LARGER (dim 4) matrix — velocity cells never leak in', () => {
    // a 4×4 whose top-left position block is [[4,0],[0,1]] and whose velocity block is wild — the ellipse must
    // read ONLY indices {0,1,4,5}, so the velocity values (indices 10,11,14,15) cannot change the answer.
    const cov = [4, 0, 9, 9, 0, 1, 9, 9, 9, 9, 999, 7, 9, 9, 7, 999]
    const e = posEllipse(cov, 4)!
    expect(e.semiMajor).toBeCloseTo(2, 12)
    expect(e.semiMinor).toBeCloseTo(1, 12)
  })
  test('a true disc reports isDisc even when embedded in a dim-4 matrix', () => {
    const cov = [3.333, 0, 0, 0, 0, 3.333, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const e = posEllipse(cov, 4)!
    expect(e.isDisc).toBe(true)
    expect(e.semiMajor).toBeCloseTo(e.semiMinor, 12)
    expect(e.semiMajor).toBeCloseTo(Math.sqrt(3.333), 12)
  })
})

describe('posEllipse — FAIL CLOSED on malformed / non-PSD / non-finite / non-symmetric (never a NaN ring)', () => {
  test('a NON-SYMMETRIC submatrix (off-diagonals disagree) fails closed → null', () => {
    expect(posEllipse([1, 2, 3, 1], 2)).toBeNull() // b=2 ≠ b2=3
  })
  test('a NEGATIVE VARIANCE on the diagonal (non-PSD) fails closed → null', () => {
    expect(posEllipse([-1, 0, 0, 1], 2)).toBeNull()
    expect(posEllipse([1, 0, 0, -1], 2)).toBeNull()
  })
  test('a symmetric-but-NON-PSD submatrix (correlation exceeds the variances → negative eigenvalue) fails closed', () => {
    // [[1,2],[2,1]]: eigenvalues 1±2 = 3 and −1 → not positive-semidefinite → null (never a sqrt(−1) NaN axis).
    expect(posEllipse([1, 2, 2, 1], 2)).toBeNull()
  })
  test('a NON-FINITE cell (NaN / ±Infinity) fails closed → null', () => {
    expect(posEllipse([NaN, 0, 0, 1], 2)).toBeNull()
    expect(posEllipse([1, 0, 0, Infinity], 2)).toBeNull()
    expect(posEllipse([1, Infinity, Infinity, 1], 2)).toBeNull()
  })
  test('a TOO-SHORT array for the claimed dim fails closed → null (a short cov cannot hold a dim×dim matrix)', () => {
    expect(posEllipse([1, 0, 0], 2)).toBeNull()      // needs 4
    expect(posEllipse([1, 0, 0, 1, 0], 4)).toBeNull() // needs 16
  })
  test('a bad dim (fractional / < 2) fails closed → null', () => {
    expect(posEllipse([1, 0, 0, 1], 1)).toBeNull()
    expect(posEllipse([1, 0, 0, 1], 2.5)).toBeNull()
  })
  test('a genuine ZERO-uncertainty axis (a degenerate but valid PSD matrix) does NOT fail — semiMinor 0, NOT a disc', () => {
    // [[4,0],[0,0]]: eigenvalues 4 & 0 — PSD (both ≥ 0). A valid (if degenerate) contour, not a malformed one, and
    // MAXIMALLY anisotropic (one axis zero) — so it must NOT read as a disc.
    const e = posEllipse([4, 0, 0, 0], 2)!
    expect(e).not.toBeNull()
    expect(e.semiMajor).toBeCloseTo(2, 12)
    expect(e.semiMinor).toBeCloseTo(0, 12)
    expect(e.isDisc).toBe(false)
  })
})

// ── THE NUMERICAL-HONESTY REGRESSIONS — scale-relative isDisc + determinant-stable λmin ──────────────
describe('posEllipse — numerical honesty on the two hostile matrices', () => {
  // THE HOSTILE TINY MATRIX: a maximally-anisotropic TINY matrix — axes 1e-10 × 0. An ABSOLUTE ~1e-9 isDisc floor
  // would misclassify this as a disc and paint a circle where an axis is EXACTLY zero. The scale-RELATIVE gate keeps
  // it an ellipse (semiMinor 0).
  test('the hostile tiny matrix [[1e-20,0],[0,0]] is NOT a disc: axes 1e-10 × 0 (a scale-relative isDisc, no absolute floor)', () => {
    const e = posEllipse([1e-20, 0, 0, 0], 2)!
    expect(e).not.toBeNull()
    expect(e.isDisc, 'a maximally-anisotropic tiny matrix is never a disc').toBe(false)
    expect(e.semiMajor).toBeCloseTo(1e-10, 20)
    expect(e.semiMinor).toBe(0) // the second axis is EXACTLY zero — never smeared to equal the first by an absolute floor
  })
  // THE EXTREME CONDITION-NUMBER MATRIX: λmin = 1 exactly, but computed 0 by the catastrophic cancellation of
  // trace/2 − half. The determinant form (λmin = det/λmax) recovers the true 1, so the SMALL axis renders 1, not 0.
  test('the extreme condition-number matrix [[1e16,0],[0,1]] gives semiMinor 1, NOT 0 (determinant-stable λmin — no catastrophic cancellation)', () => {
    const e = posEllipse([1e16, 0, 0, 1], 2)!
    expect(e).not.toBeNull()
    expect(e.semiMajor).toBeCloseTo(1e8, 0)
    expect(e.semiMinor, 'the small axis is exactly 1, not lost to cancellation').toBeCloseTo(1, 9)
    expect(e.isDisc).toBe(false)
    expect(e.angleRad).toBeCloseTo(0, 12) // major along the first axis (the 1e16 diagonal)
  })
})
