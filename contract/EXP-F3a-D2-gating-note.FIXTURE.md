# EXP-F3a D2 gating note (hash-anchored)

This file is the PINNED artifact behind `ConformanceAttestation.gating_note_hash` for EXP-F3a: its raw
committed bytes are folded (single-file section-4.4 framing: u32 path_len ++ repo-relative POSIX path ++
u32 content_len ++ raw bytes, no LF normalization) into every EXP-F3a ROBUST `verdict_digest`. Editing it
changes the hash and re-earns the verdict (D-002). It states exactly what D2 is gated on and the
acceptance that flips `d2_status` from Gated (1) to Demonstrated (2). The decision rationale lives in
D-014 (freely editable); THIS file changes only if the gating claim itself changes. It is frozen BEFORE
the robust harvest so its hash is stable when it folds into the certified robust verdict.

## The claim being gated

D2 (EXP-F3a contract, Acceptance / determinism levels): the SAME binary on the SAME architecture on a
DIFFERENT machine produces byte-identical output (`result_id`) for the single-target tracking run AND the
same aggregated statistical verdict. D1 (fresh-process, same machine) is earned per seed; the statistical
acceptance COMPOSES on top of D1 (spec-3c §4). D2 is asserted as `Gated (1)`, deliberately NOT
`Demonstrated (2)`.

## What D2 is gated on

Cross-machine byte-identity of floating-point results requires pinning the FP execution environment, none
of which this repository implements yet. F3a's trusted-path arithmetic is ENTIRELY inside the doctrine
§1.5 IEEE-exact set (`+ − × ÷ sqrt`): the 4-state constant-velocity Kalman filter, the `alg_id=1`
Cholesky solve, and the certifier's NEES/NIS recompute contain NO transcendental — so the STATISTICAL
verdict, recomputed by the certifier from the emitted `{mean, P, ν, S}` sufficient statistics + the
pinned closed-form truth, is FP-environment-independent GIVEN byte-identical sufficient statistics
(IEEE-exact ops are round-to-nearest-deterministic across any conformant machine at a fixed evaluation
order, which the contract's §1.6 operand order pins). What is NOT yet cross-machine-guaranteed is the
input those sufficient statistics fold: the harness measurement generator's Box-Muller noise. F3a is the
FOURTH libm consumer on the ladder (F1's `sin`/`cos` → E0's `atan2` → F2a → F3a) and the FIRST consumer
of `ln`: each `DetectionMade.meas = H·truth + noise` folds `ln(u1)`/`cos(theta)`/`sin(theta)` from the
vendored pure-Rust `libm`, and those noisy measurements propagate through the filter into every emitted
`mean`/`ν` and thus the run's `result_id` and the aggregated `NEES_agg`/`NIS_agg`. The surface D2 gates
is therefore the cross-machine bit-identity of the noise-generated measurement stream (hence the whole
event stream's `result_id`, and through it the sufficient statistics the statistical verdict consumes) —
NOT the filter/certifier arithmetic, which is IEEE-exact and provably FP-environment-independent at the
pinned operand order (the contract's claim scope). The load-bearing items:

1. ISA-baseline pinning: build with an explicit fixed `target-cpu` baseline so codegen cannot vary with
   the build host, and disable runtime CPU-feature dispatch in every dependency that performs it (a
   dispatch-selected SIMD path on machine A vs scalar on machine B can round differently). The filter's
   IEEE-exact ops are dispatch-neutral by construction; the `ln`/`cos`/`sin` argument reductions are not.
2. libm determinism: the vendored `libm` (=0.2.16) is the ONE transcendental provider; its bit-exact
   outputs are pinned in F3a's OWN frozen transcendental KAT -- the 12,000 `(input-bits → output-bits)`
   `ln`/`cos`/`sin` PAIRS the 50-seed campaign draws (50 seeds × 80 detection ticks × 3 functions),
   carrying the INS-028 disagreement sentinel (re-verified divergent at the F3a harvest) -- and folded by
   the oracle; the offline bundle-verify noise TABLE re-uses those SAME transcendental bits (KAT-agreed
   row-for-row, libm-free comparisons only -- D-010 intact). The system libm (never used) differs across
   OS versions and hardware-dispatched routines.
3. FMA contraction: fused-multiply-add contraction must be explicitly controlled (forbidden or forced),
   not left to codegen choice. The exact-dyadic lattice arithmetic (the `F`/`H`/`R`/`P_init` matrices,
   the Cholesky of the seed-independent `P_64`/`S_64`) is FMA-neutral by construction, but the Box-Muller
   `r·c`/`r·s` composition and the `ln`/`cos`/`sin` argument reductions are not -- fusion there changes
   the noise bits and thus the emitted measurement.
4. MXCSR / FP control state: the rounding mode and flush-to-zero/denormals-are-zero bits must be asserted
   at run start, not inherited from the host process environment.

## Acceptance: what flips Gated -> Demonstrated

All of the following, recorded in the evidence record that cites this note:

- The four pinning measures above implemented (or each shown vacuous for the workload) and enforced by the
  build/run configuration under CI.
- One binary, built once, executed on TWO physically distinct machines of the same ISA baseline, producing
  byte-identical `result_id` for the full pinned sweep (seeds 42..=91) AND byte-identical aggregated
  `NEES_agg`/`NIS_agg` (the `verdict_schema_version=2` `StatResultBlock`): those two ids are then published
  as `d2_a_result_id` / `d2_b_result_id` in the attestation (they are all-zero while Gated).
- The claim scope stays unchanged: single-target track CONSISTENCY (exactly one track with the pinned
  lifecycle; NEES and NIS inside the precommitted two-sided chi-square bounds at `k* = 64` when the filter
  model matches the deterministic truth-generating model, the certifier recomputing from sufficient
  statistics + closed-form truth), and D1 reproducibility on the pinned scene and schedule -- never
  cross-machine FP identity of the noise-generated measurements.

Until then, any attestation citing this note carries `d2_status = 1 (Gated)` and all-zero `d2_a_result_id`
/ `d2_b_result_id`, and a ROBUST verdict remains honest: robustness is claimed over seeds, fresh processes,
conformance gates, offline re-verification, and the statistical acceptance composed on D1 - never over
cross-machine FP identity of the noise-generated measurement stream.
