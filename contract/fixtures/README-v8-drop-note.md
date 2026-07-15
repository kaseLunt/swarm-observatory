# v8 drop note (local sidecar — reconciles the vendored v7 drop README)

The sibling `README-2026-07-08-drop.md` is a vendored upstream file narrating the **v7** drop
(Certus `main @ 9cb3e8d`, schema v7/s3, with now-superseded attempt-ids and no `f3a`); it is
retained **verbatim** per its own never-patch-in-place rule, so this local sidecar carries the
correction instead. The fixtures currently vendored under `contract/fixtures/` are the
**2026-07-08-evening v8 drops** (Certus `main @ f378e8f`, schema **v8/s3**) — `f2a_seed42`,
`f3a_seed42`, and `f4_seed42`, each an `<attempt_id>/` attempt dir beside its own
`IDENTITY.json`; the authoritative per-fixture anchors (bundle `sha256` + byte length,
`case_id`, `result_id`, schema versions, source pin) live in each `<fixture>/IDENTITY.json`,
which is the pin to trust over the stale v7 narrative. A refreshed upstream README covering the
v8 drops is queued (see the ROADMAP upstream relay queue, item 8).
