// ── The pinned f2a sensing scene — a deliberately ZERO-IMPORT module (excerpt §pinned scene) ────────────
// Semantics of record: contract/EXP-F2a-scene-and-sensing-excerpt.md (sensor pose / half-angle cone / max
// range / occluder Q + the decision forms). Cut byte-faithfully from EXP-F2a-contract.md. These are
// SCENARIO CONTENT (content-addressed input, not bundle state): the sensor's pose, the FOV half-angle, the
// max range, and the occluder — the same "scenario constants, not state" status the query stage's region
// bodies carry. World frame: NED meters (D-015); the occluder is a CLOSED point set (D-017).
//
// This module imports NOTHING and must stay that way (checked by the SCAN-COVERAGE pin in
// sensingMath.test.ts): it is the ONLY runtime dependency of the sensing recompute surface (sensingMath.ts),
// which makes the no-transcendental source scan's closure claim true by construction. The FOV is carried as
// the EXACT 3-4-5 rise/run ratio — never an atan2/tan call — so the cone geometry is exact AND this surface
// stays trig-free (the in_fov DECISION is the decoded boolean, never recomputed here; see sensingMath).

export type Vec3 = readonly [number, number, number]

// ── Sensor (scenario content) ──────────────────────────────────────────────────────────────────────────
// Position O = origin; heading psi_s = 0.0 (due North — the ONE heading whose sin/cos are IEEE-exact, so the
// whole trajectory stays on the integer lattice). Max range enters ONLY as a squared threshold (sqrt appears
// in no decision — E0's certified region convention): r2max = R_max² = 10404, R_max = 102 (48-90-102 =
// 6·(8,15,17)).
export const SENSOR_O: Vec3 = [0.0, 0.0, 0.0]
export const SENSOR_PSI = 0.0
export const R_MAX = 102.0
export const R2MAX = 10404.0

// FOV half-angle = the vendored-libm bits of atan2(48, 36) — the 3-4-5 angle (≈ 0.9272952180 rad ≈ 53.13°).
// Defining the threshold AS the fixture point's bearing bits is what makes the FOV-edge equality exact BY
// CONSTRUCTION. We do NOT call atan2 (this surface is trig-free): the cone is drawn from the EXACT rise/run
// of the 3-4-5 triangle — the FOV boundary has slope east/north = 48/36 = 4/3, so at forward reach x the
// cone half-width is x·(FOV_RISE/FOV_RUN). Exact, and no transcendental enters. FOV_HALF_RAD is the pinned
// numeric value for a readout ONLY (a claim, displayed — never a decision input; in_fov is decoded).
export const FOV_RISE = 48.0
export const FOV_RUN = 36.0
export const FOV_HALF_TAN = FOV_RISE / FOV_RUN            // = 4/3 exactly — the cone's east/north slope
export const FOV_HALF_RAD = 0.9272952180016122            // atan2(48,36) as an f64 — DISPLAY claim only, never decided on

// ── Occluder sphere Q (scenario content; a CLOSED point set per D-017) ──────────────────────────────────
// Center C = (41,41,0); r2 = 41 (r = √41 is irrational; ONLY r² enters any pinned form — chosen so the
// sight-line tangency discriminant vanishes exactly in ℤ). Path clearance is proven in the excerpt: the
// target never enters Q and Q never swallows the sensor.
export const OCCLUDER_C: Vec3 = [41.0, 41.0, 0.0]
export const OCCLUDER_R2 = 41.0

// ── Target motion (-certified machinery, consumed as certified) ───────────────────────────────────────
// Straight north-running flight: e(k) = 48.0 constant; per-tick northing step v_eff·dt_s = 16·0.125 = 2.0
// m/tick exactly; n(k) = n0 + 2k, with n0 = -58 - phase·2 (the seed axis). These lattice facts describe the
// DECODED trajectory (surfaced from state frames, not recomputed here); pinned for the tour's framing and
// for the free decoded-vs-decoded consistency assertion (excerpt path e = 48).
export const TARGET_E = 48.0
export const NORTH_STEP = 2.0
export const RUN_TICKS = 96
