// ── covEllipse — THE PURE MATH LEAF: 2×2 position-submatrix eigendecomposition ─────────────────────────────
// A sibling of sensingMath / showMath: a PURE, zero-runtime-import leaf that turns a decoded covariance matrix
// into the geometry of its position-uncertainty contour — the belief lens's disc/ellipse. It reads the decoded
// `cov` VERBATIM (never a smoothed / interpolated / re-fit value) and derives the 1σ semi-axes + orientation of
// the top-left 2×2 POSITION submatrix by a symmetric-2×2 eigendecomposition. It is DERIVED-DISPLAY (a derivation
// of decoded values — no external oracle to check against), so nothing here adjudicates or wears a verdict glyph.
//
// THE HONEST-SHAPE RULE: a degenerate ISOTROPIC submatrix (equal diagonal, zero off-diagonal → equal
// eigenvalues) is a CIRCLE, and this reports it as one (isDisc true, angle 0) — never a forced tilted ellipse
// the matrix does not make. f3a_seed42's position covariance IS isotropic (the honest shrinking DISC); the
// general anisotropic path is implemented + tested synthetically for future bundles.
//
// FAIL CLOSED (the belief lens degrades on a non-PSD matrix, never renders a NaN ring): a submatrix that is
// non-finite, too short to hold a dim×dim matrix, NON-SYMMETRIC (a covariance is symmetric by definition), or
// NON-PSD (a negative variance / a correlation exceeding the variances → a negative eigenvalue) returns null.
// The caller (trackBelief) withholds the ring and discloses the count — the comms-precedent degradation shape.

export interface PosEllipse {
  /** the larger 1σ semi-axis in the position plane — sqrt(λmax) (metres for a NED-metre covariance). */
  readonly semiMajor: number
  /** the smaller 1σ semi-axis — sqrt(λmin). Equals semiMajor exactly for a disc. */
  readonly semiMinor: number
  /** orientation of the MAJOR axis, measured from the submatrix's first axis toward its second (radians).
   *  0 for a disc (isotropic — a circle has no orientation) and for an axis-aligned major-along-first case. */
  readonly angleRad: number
  /** isotropic — the two semi-axes are equal (to a relative tolerance) → an honest DISC, never a tilted ellipse.
   *  The copy uses THIS to say "disc" only when the matrix actually makes one (f3a's case). */
  readonly isDisc: boolean
}

// A covariance stored as a dim×dim row-major matrix must be symmetric; a decoded off-diagonal pair that differs
// beyond this tolerance RELATIVE to the matrix scale is malformed → fail closed (not silently symmetrized). f3a's
// off-diagonals are bit-exact 0, so this never bites there; it only forgives sub-ULP f64 noise on a genuine symmetric P.
const SYM_REL_TOL = 1e-9
// ε for the disc test: eigenvalues agreeing to ~9 significant figures (separation ≤ ε·λmax) read as a disc. f3a's
// submatrix is BIT-EXACT isotropic (separation exactly 0), so this forgives only sub-ULP round-off, never real
// anisotropy — a scale-RELATIVE gate, so a tiny maximally-anisotropic matrix is never misread as a disc.
const ISO_REL_TOL = 1e-9
// A smaller eigenvalue this far below zero (relative to the matrix scale) is a genuine non-PSD matrix → fail
// closed; within it, the eigenvalue is f64 round-off and clamps to 0 (a degenerate-but-valid zero-uncertainty axis).
const PSD_REL_TOL = 1e-9

// posEllipse(cov, dim): the 1σ position-uncertainty contour of the top-left 2×2 submatrix of a dim×dim row-major
// covariance. dim ≥ 2; for f3a's [px,py,vx,vy] state, dim = 4 and the position submatrix is indices {0,1,4,5}.
// Returns null on a malformed / non-PSD / non-finite submatrix (the fail-closed contract). Pure, allocation-light.
export function posEllipse(cov: readonly number[], dim: number): PosEllipse | null {
  if (!Number.isInteger(dim) || dim < 2) return null
  // A dim×dim row-major matrix must carry dim² cells; a short array cannot hold the claimed matrix → malformed.
  if (cov.length < dim * dim) return null
  // The top-left 2×2 POSITION submatrix: a b / b2 c, at flat indices 0, 1, dim, dim+1.
  const a = cov[0]!, b = cov[1]!, b2 = cov[dim]!, c = cov[dim + 1]!
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(b2) || !Number.isFinite(c)) return null
  // THE MATRIX SCALE — the magnitude every tolerance below is RELATIVE to. NO additive unit floor: an absolute
  // ~1e-9 floor would misclassify a maximally-anisotropic TINY matrix (e.g. [[1e-20,0],[0,0]], axes 1e-10 × 0) as
  // symmetric-and-isotropic and paint a circle where an axis is exactly zero (the hostile tiny-matrix invariant). Zero only for the all-zero
  // matrix, handled below as a degenerate zero-radius disc.
  const matScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(b2), Math.abs(c))
  // SYMMETRY — a covariance is symmetric; off-diagonals disagreeing beyond a scale-relative tolerance are malformed.
  if (Math.abs(b - b2) > SYM_REL_TOL * matScale) return null
  const off = (b + b2) / 2 // symmetric within tolerance → the shared off-diagonal (average forgives sub-ULP noise)
  // A negative variance on either diagonal is non-PSD (an uncertainty cannot be negative) → fail closed (this also
  // catches a negative-DEFINITE matrix, whose λmax ≤ 0 would otherwise slip the det-based λmin guard below).
  if (a < -PSD_REL_TOL * matScale || c < -PSD_REL_TOL * matScale) return null
  // Symmetric-2×2 eigenvalues. λmax = trace/2 + half is well-conditioned (a sum of NON-NEGATIVE terms — a,c ≥ 0).
  // half = ½·√((a−c)² + 4·off²) is a DIRECT hypot, so the eigenvalue SEPARATION 2·half is cancellation-free.
  const half = Math.hypot((a - c) / 2, off)
  const lambdaMax = (a + c) / 2 + half
  // λmin from the DETERMINANT (λmax·λmin = det = a·c − off²), NOT trace/2 − half: the latter CATASTROPHICALLY
  // CANCELS when the eigenvalues differ by many orders of magnitude — [[1e16,0],[0,1]] has exact λmin = 1 but
  // computes 0 via subtraction (the extreme condition-number invariant). λmax = 0 ⇒ the zero (degenerate) matrix ⇒ λmin = 0.
  const det = a * c - off * off
  const lambdaMin = lambdaMax > 0 ? det / lambdaMax : 0
  // PSD — the SMALLER eigenvalue must be ≥ 0 (a correlation exceeding the variances drives det, hence λmin, negative).
  if (lambdaMin < -PSD_REL_TOL * matScale) return null
  const semiMajor = Math.sqrt(Math.max(lambdaMax, 0))
  const semiMinor = Math.sqrt(Math.max(lambdaMin, 0))
  // MAJOR-AXIS ORIENTATION — the standard symmetric-2×2 formula θ = ½·atan2(2·off, a−c). Cancellation-free and
  // correct for axis-aligned (off 0 → 0 or π/2 by the sign of a−c) AND extreme-ratio matrices; a disc → ½·atan2(0,0)=0.
  const angleRad = 0.5 * Math.atan2(2 * off, a - c)
  // ISOTROPIC → a disc: the eigenvalue SEPARATION (2·half, cancellation-free) relative to the eigenvalue SCALE (λmax)
  // — SCALE-RELATIVE, no additive floor. λmax ≤ 0 ⇒ the zero matrix ⇒ a (zero-radius) disc.
  const isDisc = lambdaMax <= 0 ? true : 2 * half <= ISO_REL_TOL * lambdaMax
  return { semiMajor, semiMinor, angleRad, isDisc }
}
