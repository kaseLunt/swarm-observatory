# SANCTIONED EXCERPT — EXP-F2a pinned scene + sensing decision forms

**Purpose:** the sensing lens's stage body (sensor pose, FOV half-angle cone, max range,
occluder) + the eligibility decision forms. Cut byte-faithfully from
`roadmap/work/EXP-F2a-contract.md`, git blob `b4396fd0a3bc03c8542e178f6fa4a816eb156876`
(re-verify with `git hash-object roadmap/work/EXP-F2a-contract.md`). NON-AUTHORITATIVE;
same staleness protocol as your E0 excerpts. World frame: NED meters (D-015); occluders are
CLOSED point sets (D-017), boundary contact observable via tiebreak flags.

--- BEGIN VERBATIM (EXP-F2a-contract.md:57-99, the pinned scene) ---
## Pinned scene + run parameters (all non-transcendental quantities exact small integers /
## dyadics; every decision quantity below is exactly representable — products bounded far
## below 2^53)
- `dt_us = 125_000` → `dt_s = (dt_us as f64) / 1.0e6` (the doctrine §2 expression TRANSCRIBED;
  here `dt_s = 0.125` exactly, so per-tick northing steps are exact).
- Run length: `96` ticks (`0..=95`), `step_limit = 96`.
- **Sensor** (scenario content): position `O = (0.0, 0.0, 0.0)`; heading `psi_s = 0.0` (due
  North — the ONE heading whose sin/cos are IEEE-exact, keeping the whole trajectory on the
  integer lattice); half-angle `half_fov :=` the vendored-libm output bits of
  `atan2(48.0, 36.0)` (the 3-4-5 angle, ≈ 0.9272952180 rad ≈ 53.13°; the normative BITS are
  pinned at the F2a KAT harvest — defining the threshold AS the fixture point's bearing bits is
  what makes the FOV-edge equality exact BY CONSTRUCTION); max range as a squared threshold
  `r2max = R_max * R_max = 10404.0` (`R_max = 102.0`; 48-90-102 = 6·(8,15,17) Pythagorean —
  the range boundary carries integer lattice points).
- **Occluder sphere `Q`** (scenario content; a CLOSED point set per D-017): center
  `C = (41.0, 41.0, 0.0)`, `r2 = 41.0` (r = √41 is irrational; ONLY r² enters any pinned form —
  chosen so the sight-line tangency discriminant vanishes exactly in ℤ: see worked table).
  Path clearance is proven: the target line `e = 48` stays `49 > 41` (d² vs r²) off `C`, and the
  sensor stays `3362 > 41` off `C` — the target is NEVER inside `Q` and `Q` never swallows the
  sensor (so the `c == 0.0` / `f1 == 0.0` hit-form disjuncts are unreachable by scene
  construction; see claim scope).
- **Target motion** (the F1-certified machinery, consumed as certified): `MotionParams` with
  limits `v_max = 40.0`, `w_max = 0.5`, `fuel0 = 512.0`, `burn = 2.0` (the F1 canonical values)
  and THREE identical straight segments (the F1 3-segment schedule shape, padded):
  `seg0 [0, 32)`, `seg1 [32, 64)`, `seg2 [64, 96)`, each `v_cmd = 16.0`, `w_cmd = 0.0` →
  `v_eff = 16.0` (unclamped), northing step `v_eff * dt_s = 2.0` m/tick exactly. Segment-entry
  chaining is exercised at ticks 32/64 with EXACT entry states (straight + lattice: worked-table
  rows). Initial state: `e0 = 48.0`, `d0 = 0.0`, heading `psi0 = 0.0` PINNED (not drawn — the
  lattice-exactness requirement), fuel `fuel0`; `n0` comes from the seed axis:
- **Seed axis (= crossing-path phase, the F1-ψ0/E0-observer pattern made lattice-exact):** ONE
  draw from the run RNG substream at **`purpose_slot_id = 0x0140`** (the first slot of F2a's k=2
  block, spec-3b §11.4; the DRAW key's `subsystem_id` is engine enumeration — the run's F2a
  subsystem entry — cited in the evidence record, the F1/E0 precedent), `entity_id = 0`, tick 0,
  ordinal 0 (DRAW
  mechanism Spec 3a §6.5.8, unchanged). With the exact 53-bit map
  `u = ((draw >> 11) as f64) / 9007199254740992.0` (`u ∈ [0.0, 1.0)`):
  `phase = floor(u * 16.0)` — EXACT (a power-of-two scale of a 53-bit dyadic, then an exact
  `floor`; `phase ∈ {0.0 .. 15.0}`) — and `n0 = -58.0 - (phase * 2.0)` — EXACT (integer-valued
  f64 arithmetic). Every draw therefore traverses the SAME integer lattice points time-shifted
  by `phase` ticks: boundary exactness holds for EVERY seed, not only the canonical one (a
  strict upgrade over the E0/F1 seed-row claim split; machine-swept over all 16 phases at
  authoring). Both maps are deterministic and the oracle recomputes them live.

--- END SCENE / BEGIN VERBATIM (EXP-F2a-contract.md:100-140, the decision forms) ---
## Pinned decision forms (operand order is normative — doctrine §1.6). The three COMPONENT
## forms are TRANSCRIBED from the frozen EXP-E0/EXP-F1 contracts (second-consumer rule);
## the in-FOV composition, the conjunction, and the adapter are F2a's new law. Boundary
## DECISIONS compare exactly-computed quantities; `sqrt` appears in NO decision; `atan2`
## comes ONLY from the vendored pure-Rust `libm` (doctrine §1.4) through E0's seam, and
## every evaluation the canonical runs need is pinned as `((y_bits, x_bits) → out_bits)`
## KAT vectors in F2a's OWN frozen KAT file (doctrine §4; see acceptance).
Common (E0's primitives, transcribed): `sub` componentwise;
`dot(p, q) = ((p.n * q.n) + (p.e * q.e)) + (p.d * q.d)`. Let `g` = the tick-k target position:
the F1 closed form evaluated at tick k — bit-identical to state frame k+1's `Entity.pos` (the
frame the tick-k step commits; frame k holds the tick-(k−1) evaluation and is NOT `g`). `g` is
produced by F1's straight closed form TRANSCRIBED (never a substitute formula):
`n(t) = n_seg + (v_eff * cos(psi_seg)) * t`; `e(t) = e_seg + (v_eff * sin(psi_seg)) * t`;
`psi(t) = psi_seg`; segment-relative `t = ((k - k_seg) as f64) * dt_s`; segment-entry state =
the previous segment's closed form at its full duration (the F1 chaining rule). With
`psi_seg = 0.0` every segment: `cos(0.0) = 1.0`, `sin(0.0) = +0.0` (IEEE-exact; these two
evaluations JOIN the F2a KAT set), so the per-tick lattice `n(k) = n0 + 2k`, `e(k) = 48.0`
used throughout this contract is the DERIVED consequence of the literal form, exact at every
tick.

- **in_range** (E0's point-in-ball form, instantiated for the ball `(O, r2max)`):
  `dl = sub(g, O)`; `d2 = dot(dl, dl)`;
  `in_range = d2 <= r2max`; `tb_range = in_range && (d2 == r2max)`.
  (The D-017 predicate `range <= R_max` decided sqrt-free on exact squares — E0's certified
  region convention; the `range_m` scalar is neither computed on a decision path nor emitted.)
- **bearing** (E0's range/bearing atan2 arm, transcribed incl. the defensive remap):
  `bearing_rad = atan2(dl.e, dl.n)` then `if bearing_rad == -PI { bearing_rad = PI }`
  (domain `(-π, π]`, north-referenced CW — D-015/D-017; the remap is unreachable on this
  scene's lattice — E0's general-form guard, covered by E0's harness vector, not re-proven
  here). Zero range is unreachable (`d2 >= 2304.0` on the canonical path).
- **in_FOV** (the NEW predicate — F2a's single new comparison site):
  `delta = wrap(bearing_rad - psi_s)` where `wrap` is F1's certified function TRANSCRIBED:
  `wrap(x) = { let y = x - ((2.0 * PI) * floor((x + PI) / (2.0 * PI))); if y == -PI { PI } else { y } }`;
  `abs_delta = |delta|` (IEEE-exact `abs`, doctrine §1.5);
  `in_fov = abs_delta <= half_fov`; `tb_fov = in_fov && (abs_delta == half_fov)`.
  With the pinned `psi_s = 0.0` the subtraction is exact (`x - 0.0 = x`) and `wrap` is the
  identity on `(-π, π)` (its floor term is 0 there; at exactly `+π` the floor term is 1 and
  the `-π` remap round-trips the value — unreachable here: `dl.e = 48.0` keeps every bearing
  strictly inside `(0, π)`) — `delta == bearing_rad` bit-for-bit, so
  the FOV-edge tick compares the fixture point's atan2 bits against `half_fov` (:= those same
  bits) — equality by construction. The heading-subtraction ±π seam (wrap's nonzero-floor
--- END VERBATIM ---
