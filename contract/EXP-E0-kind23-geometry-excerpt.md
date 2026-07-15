# SANCTIONED EXCERPT — `GeometryQueryResolved` (core kind 23), EXP-E0 geometry semantics

**Purpose:** normative per-kind `argv`/`result_scalars` layouts, scenario geometry, and
FRAME/TIEBREAK bindings for the Observatory's "query stage" E0 lens (v0.6). Read-only excerpt;
nothing in the frozen contract moves.

**Sanction & provenance (verify before shipping the lens):**
- Normative source: `roadmap/work/EXP-E0-contract.md` (FROZEN, rev 2, panel-hardened; last
  touched `10efaf6`). Git blob hash of the LF-frozen bytes this excerpt was cut from:
  `d7b98d5c05af3d5133e38974a813c831936d7e32` — re-verify with
  `git hash-object roadmap/work/EXP-E0-contract.md` before vendoring. The certifier re-derives
  `contract_version` from these raw bytes on every CI run, so a drifted source contract cannot
  certify — if the blob hash matches, the semantics below are the certified ones.
- Machine-checked mirror of the scene constants: `tools/reference-encoder/e0_geometry.py`
  lines 116–126 (the oracle recomputes the canonical run from them; byte-parity with the engine
  is gate-proven).
- **This excerpt is NON-AUTHORITATIVE** (the hashed contract is the authority) and carries a
  staleness boundary: valid as of Certus `main` @ `7ad42af` (2026-07-08). If the blob hash
  above ever mismatches, re-cut the excerpt; do not patch it in place.

---

## 1. Kind-23 payload semantics (contract §"Pinned emitted content", lines 161–184)

`query_kind`: `POINT_IN_REGION = 1 | RANGE_BEARING = 2 | RAY_OCCLUDER = 3 | LOS = 4`.

`subject = 0` at E0 (opaque sentinel). `object`: `0` = none/composite, `1` = sphere `S`,
`2` = box `B`, `3` = triangle `T`.

| query_kind | `argv` layout | `result_flag` | `result_scalars` |
|---|---|---|---|
| 1 POINT_IN_REGION | `[p.n, p.e, p.d]` | `inside` | ball (`object=1`): `[d2]` · box (`object=2`): `[]` |
| 2 RANGE_BEARING | `[o.n, o.e, o.d, g.n, g.e, g.d]` | constant `true` | `[range_m, bearing_rad]` |
| 3 RAY_OCCLUDER | `[mode, o.n, o.e, o.d, w.n, w.e, w.d]` | `hit` | `[t]` on hit, else `[]` |
| 4 LOS | `[o.n, o.e, o.d, g.n, g.e, g.d]` | `los_clear` | `[]` |

**RAY_OCCLUDER `mode` (contract lines 178–180, verbatim):** `mode: 0.0 = ray, w = direction;
1.0 = segment, w = endpoint`.

**Reported `t` (first contact; decision-bounded CLAMPED branches, lines 120–136, 149):**
- ray (sphere form): `t = 0.0` if origin inside (`c <= 0.0`), else `((-b) - sqrt(disc)) / a`
  clamped at `0.0` — **t parametrizes `o + t·dir`, so metric distance = `t · |dir|`**;
- segment: `dir = w − o`, same root **clamped to `[0.0, 1.0]`** — `t` is the fraction along
  `o → w`;
- AABB (slab form): `t = tmin` (`0.0` when the origin is inside);
- triangle (two-sided Möller–Trumbore): `t_report = t/det`, `−0.0` normalized to `+0.0`
  (doctrine §1.8).

**LOS composition (lines 151–159):** `los_clear = !(any occluder in the pinned set has a
SEGMENT hit for (o, g))`, occluder order S, B, T, no short-circuit. In the schedule every LOS
composite is **preceded by its three component RAY_OCCLUDER segment queries with identical
`(o, g)`** (argv `[1.0, o…, g…]`, `object` = 1, 2, 3) — a replay lens can draw the composite's
per-occluder contacts from those three rows. Composite rows carry `object = 0`.
`tiebreak_applied` on the composite = OR of the three component flags.

## 2. Scenario geometry (contract §"Pinned scene", lines 41–53 — normative constants)

- **Sphere `S`:** center `(256.0, 0.0, 0.0)`, `r = 65.0` (`r2 = 4225.0`; 65 is a 5·13
  hypotenuse — the boundary carries non-axis integer lattice points).
- **AABB `B`:** `min = (384.0, −160.0, −64.0)`, `max = (448.0, −96.0, 64.0)`.
- **Occluder 3 is a TRIANGLE, not a wall:** `A = (640.0, −64.0, −64.0)`,
  `B = (640.0, 64.0, −64.0)`, `C = (640.0, 0.0, 64.0)` — a facet in the plane `n = 640`,
  normal along ±n. Render the bounded facet; a plane/slab is wrong (rays passing outside the
  triangle at `n = 640` legitimately MISS).
- Occluders are **CLOSED point sets** (D-017: boundary comparisons ladder-wide are closed,
  boundary membership observable via `tiebreak_applied`). `POINT_IN_REGION` regions are the
  solid closed ball `S` and closed box `B` only (the triangle is an occluder facet, never a
  region).

## 3. The observer (contract §"Pinned run parameters", lines 59–75)

Default observer `(0.0, 0.0, 0.0)`. Schedule rows marked `O*` use a **per-seed DRAWN
observer** — two draws at `purpose_slot_id = 0x0100`, tick 0, ordinals 0/1, 53-bit map
`u = (draw >> 11) / 2^53`, then `n_o = u1·128 − 704`, `e_o = u2·128 − 64`, `d_o = 0.0`;
`O* ∈ n:[−704.0, −576.0] (closed) × e:[−64.0, 64.0) (half-open) × {0.0}`. The drawn observer
folds into identity **via the emitted `argv`** — a renderer should always read the observer
from each event's `argv`, never assume a constant (your decoder already does this).

## 4. FRAME and TIEBREAK bindings (contract lines 163–173; D-015, D-017)

- **Semantic pairs:** `tiebreak_applied` binds `TIEBREAK = DECLARED_PREDICATE (3)` — the ONLY
  registry semantic pair on row 23. `argv`, `result_scalars`, `subject`, `object` are
  `sem_count = 0` (opaque at the schema tier); their per-element meaning is pinned by the
  hashed contract itself — which is exactly what this excerpt vendors.
- **Frame:** coordinates are **NED meters** (D-015). `range_m` in meters. `bearing_rad` is
  **north-referenced, CW-positive** (`HEADING_NORTH_CW`), domain `(−π, π]` with the defensive
  `−π → +π` remap; zero horizontal range yields `bearing = +0.0` (declared IEEE special case,
  semantically arbitrary — flagged via `tiebreak_applied`).
- **Tie-breaks** (render-relevant): ball `inside && d2 == r2`; box `inside && p on any face`;
  RANGE_BEARING `horizontally degenerate || remap fired`; ray/segment `hit && (disc == 0 ||
  c == 0 || [segment] f1 == 0)`; AABB `hit && (axis-parallel face graze || tmin == tmax)`;
  triangle `hit && (u == 0 || v == 0 || u+v == det || t == 0 || [segment] t == det)`, plus the
  in-plane `det == 0` declared-MISS case.

## 5. Confirm/correct against your decoded reconstructions

| Your reconstruction | Verdict |
|---|---|
| RANGE_BEARING argv `[from(3), to(3)]`, scalars `[range, bearing]` | **CONFIRMED** (+ `result_flag` is constant `true` — carry no meaning from it) |
| LOS argv `[from(3), to(3)]`, scalars empty | **CONFIRMED** (+ use the 3 preceding component rows for per-occluder contact detail) |
| RAY_OCCLUDER argv `[mode, origin(3), dir-or-endpoint(3)]` | **CONFIRMED** |
| mode `0` = infinite ray, `t` in `|dir|` units; mode `1` = segment, `t ∈ [0,1]` | **CONFIRMED — your flagged inference is exactly the contract's pinning** (lines 179–180; `t` clamps per §1 above; note ray `t` is clamped at `0.0`, and `[t]` is present only on hit) |
| POINT_IN_REGION argv `[point(3)]` | **CONFIRMED**; **ADDITION:** scalars are `[d2]` for the ball but `[]` for the box — key off `object` (1 vs 2) |
| Sphere `c=(256,0,0) r=65` | **CONFIRMED** |
| Box `[384,448]×[−160,−96]×[−64,64]` | **CONFIRMED** |
| **Wall `n=640, d∈[−64,64]`** | **CORRECTED: it is a bounded TRIANGLE** (vertices in §2) — your inferred extent matches the vertex bounding box, but the facet is triangular; render it as such |
| Observer `(−601.0688, −37.7829, 0)` bit-exact vs golden | **CONFIRMED as the seed-42 DRAWN observer** (in-interval per §3); it is per-seed, not a scenario constant — keep reading it from `argv` |

---
*Cut 2026-07-08 from Certus `main` @ `7ad42af` by the Certus-side session (owner-relayed
request). Questions about the decision forms themselves (hit predicates, clamping): contract
lines 77–159 are the normative pinned forms; vendor more of them the same way if the lens
grows verdict-recompute features.*
