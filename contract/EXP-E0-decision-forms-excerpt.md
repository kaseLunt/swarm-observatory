# SANCTIONED EXCERPT — EXP-E0 pinned decision forms (contract lines 77–159)

**Purpose:** the "Show the Math" verdict-recompute layer (swarm-observatory v0.6). These are
the NORMATIVE hit predicates, tie-break predicates, and reported-scalar clamp forms for every
kind-23 geometry query — operand order is normative (doctrine §1.6).

**Sanction:** cut byte-faithfully (sed, not retyped) from `roadmap/work/EXP-E0-contract.md`,
git blob `d7b98d5c05af3d5133e38974a813c831936d7e32` (same anchor as your kind-23 excerpt —
re-verify with `git hash-object roadmap/work/EXP-E0-contract.md` before shipping).
NON-AUTHORITATIVE copy; staleness boundary: on any anchor mismatch, re-request, never patch.
Note for the recompute layer: `atan2` values come from the vendored pure-Rust libm with pinned
KAT vectors — recompute bearings only via those pinned bits, never a platform libm.

--- BEGIN VERBATIM (EXP-E0-contract.md:77-159) ---
## Pinned decision forms (operand order is normative — doctrine §1.6). Boundary DECISIONS
## compare exactly-computed quantities: the sphere and triangle forms are division- and
## sqrt-free everywhere; the AABB slab form uses pinned correctly-rounded IEEE divisions,
## EXACT for every boundary fixture (axis-aligned directions: divisor ±1.0 or a power of two).
## `sqrt`/division otherwise appear only in REPORTED scalars, never in decisions.
Common: `dot(p, q) = ((p.n * q.n) + (p.e * q.e)) + (p.d * q.d)`;
`cross(p, q) = ((p.e * q.d) - (p.d * q.e), (p.d * q.n) - (p.n * q.d), (p.n * q.e) - (p.e * q.n))`;
componentwise `sub`. All arithmetic f64; `sqrt` is IEEE-exact; `atan2` comes ONLY from the
vendored pure-Rust `libm` (doctrine §1.4) — the SECOND transcendental consumer, through the same
one-seam pattern as F1's sin/cos; every `atan2` evaluation the canonical run needs is pinned as
`((y_bits, x_bits) → out_bits)` KAT vectors (doctrine §4). The E0 KAT set MUST additionally
include at least one **disagreement sentinel**: an input pair, found by sweep at harvest, whose
vendored-libm output bits differ from the native platform libm on at least one CI OS — proving
the vector tier distinguishes the implementations (the doctrine §5 fma-contraction-sentinel
structure), committed in the same frozen KAT file.

- **Point-in-ball** (`p` vs `S`): `dl = sub(p, center)`; `d2 = dot(dl, dl)`;
  `inside = d2 <= r2`; `tiebreak_applied = inside && (d2 == r2)`.
- **Point-in-box** (`p` vs `B`): `inside = (min.n <= p.n) && (p.n <= max.n) && (min.e <= p.e) &&
  (p.e <= max.e) && (min.d <= p.d) && (p.d <= max.d)`;
  `tiebreak_applied = inside && ((p.n == min.n) || (p.n == max.n) || (p.e == min.e) ||
  (p.e == max.e) || (p.d == min.d) || (p.d == max.d))`.
- **Range/bearing** (observer `o` → target `g`): `dl = sub(g, o)`;
  `range_m = sqrt(dot(dl, dl))` (dot's pinned order: `((dn*dn) + (de*de)) + (dd*dd)`);
  `bearing_rad = atan2(dl.e, dl.n)` then the domain remap `if bearing_rad == -PI
  { bearing_rad = PI }`. Bearing is north-referenced, CW positive (the D-015
  `HEADING_NORTH_CW` sense), domain `(-π, π]` (the boundary convention `RAD_PLUS_MINUS_PI`
  pins for signed angles; [[D-017]] closes it for heading-sense angles too). The remap is a
  DEFENSIVE general-form guard: `atan2` returns `-π` only for `y == -0.0, x < 0`, which no
  lattice subtraction can produce — no schedule row exercises it (unlike F1's seed-reachable
  ψ0 remap); the harness-validation suite covers the line with a synthetic vector
  (`atan2(-0.0, -1.0) = -π → remap → +π`). Zero range: `atan2(+0.0, +0.0) = +0.0` (IEEE
  special case) — DEFINED and total; semantically arbitrary (see claim scope).
  `tiebreak_applied = ((dl.n == 0.0) && (dl.e == 0.0)) || (the remap fired)` — the
  horizontally-degenerate case where the declared IEEE special case, not geometry, decided
  the bearing.
- **Ray/segment vs sphere** (origin `o`, direction/endpoint `w`): ray mode `dir = w`; segment
  mode `dir = sub(w, o)`. `oc = sub(o, center)`; `a = dot(dir, dir)`; `b = dot(oc, dir)`;
  `c = dot(oc, oc) - r2`; `disc = (b * b) - (a * c)`; segment only: `f1 = (a + (2.0 * b)) + c`.
  - ray HIT ⇔ `(c <= 0.0) || ((disc >= 0.0) && ((-b) >= 0.0))`;
    `tiebreak_applied = hit && ((disc == 0.0) || (c == 0.0))`.
  - segment HIT ⇔ `(c <= 0.0) || (f1 <= 0.0) || ((disc >= 0.0) && (0.0 <= (-b)) && ((-b) <= a))`;
    `tiebreak_applied = hit && ((disc == 0.0) || (c == 0.0) || (f1 == 0.0))`.
  - reported `t` (first contact; every hit branch with `c > 0.0` implies `disc >= 0.0`): the raw
    near-root can round one ULP outside the decision range at near-contact geometry, so the
    reported scalar is CLAMPED by pinned branches (decision-bounded, like the AABB/triangle
    scalars are by construction):
    ray: `t = if c <= 0.0 { 0.0 } else { let tr = ((-b) - sqrt(disc)) / a;
    if tr < 0.0 { 0.0 } else { tr } }`;
    segment: `t = if c <= 0.0 { 0.0 } else { let tr = ((-b) - sqrt(disc)) / a;
    if tr < 0.0 { 0.0 } else if tr > 1.0 { 1.0 } else { tr } }`.
- **Ray/segment vs AABB** (pinned branch form — NaN unreachable by construction, doctrine §1.8):
  init `tmin = 0.0`, `tmax = +inf` (ray) or `tmax = 1.0` (segment); for each axis IN ORDER
  n, e, d: `if dir.axis == 0.0 { if (o.axis < min.axis) || (o.axis > max.axis) { MISS };
  if (o.axis == min.axis) || (o.axis == max.axis) { tb_axis = true } } else {
  t1 = (min.axis - o.axis) / dir.axis; t2 = (max.axis - o.axis) / dir.axis;
  lo = min(t1, t2); hi = max(t1, t2); tmin = max(tmin, lo); tmax = min(tmax, hi) }`
  (`min`/`max` as pinned `<=` selections). HIT ⇔ `tmin <= tmax`;
  `tiebreak_applied = hit && (tb_axis || (tmin == tmax))`; reported `t = tmin`
  (0.0 when the origin is inside).
- **Ray/segment vs triangle** (division-free two-sided Möller–Trumbore; decisions compare exact
  products, division only in the reported scalar): `e1 = sub(B, A)`; `e2 = sub(C, A)`;
  `h = cross(dir, e2)`; `det = dot(e1, h)`; `s = sub(o, A)`.
  - `det == 0.0` (parallel or in-plane) ⇒ MISS by DECLARED PREDICATE;
    `tiebreak_applied = (dot(s, cross(e1, e2)) == 0.0)` (the ray lies IN the plane — the
    predicate resolved a genuinely degenerate contact; see claim scope).
  - else `q = cross(s, e1)`; `u = dot(s, h)`; `v = dot(dir, q)`; `t = dot(e2, q)`;
    `det > 0.0`: HIT ⇔ `(u >= 0.0) && (v >= 0.0) && ((u + v) <= det) && (0.0 <= t)`
    (segment adds `&& (t <= det)`);
    `det < 0.0`: HIT ⇔ `(u <= 0.0) && (v <= 0.0) && ((u + v) >= det) && (t <= 0.0)`
    (segment adds `&& (det <= t)`);
    `tiebreak_applied = hit && ((u == 0.0) || (v == 0.0) || ((u + v) == det) || (t == 0.0) ||
    (segment: t == det))`; reported `t_report = t / det` (a raw `-0.0` — e.g. `t == +0.0` with
    `det < 0` — is normalized to `+0.0` by the canonical encoder, doctrine §1.8).
- **LOS** (observer `o` → target `g`) — the GENERAL rule, stated occluder-set-generically so
  F2a inherits it verbatim: `los_clear = !(any occluder in the scenario's pinned occluder set
  has a SEGMENT hit for (o, g))`; the occluder set and its iteration order are scenario
  content; NO short-circuit; the order is immaterial to the boolean and load-bearing only for
  the bundle-composition group layout. Composite `tiebreak_applied = (tb_S || tb_B || tb_T)`
  (the OR of the component flags — an eligibility consumer sees whether ANY tie-break was
  involved in the answer). Instantiated here for the pinned set (S, B, T) in that order; in
  the schedule every LOS composite is preceded by its three component `RAY_OCCLUDER` segment
  queries with IDENTICAL `(o, g)` — composition is bundle-checkable across the 4-tick group.
--- END VERBATIM ---
