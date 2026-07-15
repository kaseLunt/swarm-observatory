# Certified fixture drop — F3a ROBUST campaign bundles, seeds 42-46 (2026-07-09, v9)

Dropped by the Certus-side session (owner-relayed request), **regenerated from a clean worktree
of Certus `main` @ `5ac32c4`** (`5ac32c40432a54ffdd81f1ea94b40a09c1f63d06`) on the pinned
toolchain (`rustc-1.93.0`, `--locked`), with the LIVE build identity injected
(`CS_TOOLCHAIN_ID=rustc-1.93.0`, `CS_CARGO_LOCK_HASH=ec4455d0…`, `FORCE_REBUILD=1`). This is the
**v9-aligned** robust drop: the earlier v8 robust drop was deferred while the F6b k=8 registry
bump was in flight; main is now v9 (event schema **v9**, state schema **s4**), so these are the
aligned identities.

This drop adds the Observatory's **first acquirable ROBUST-campaign bundles**. The existing
`f3a_seed42/` fixture is the CORRECT/KAT tier (hermetic synthetic identity, still v8) and is
untouched by this drop.

## What was regenerated (and how it was verified)

The `robust-f3a` profile of `v2/experiments/EXP-F3a.json` (the pinned 42..=91 × N=3 sweep) was
trimmed to a 5-seed scratch axis `[42,43,44,45,46]` (identity `live`, `attempts_per_variant: 3`,
`robust.*` verbatim). `run-campaign --manifest … --profile robust-f3a` produced 3 fresh-process
attempts per seed. For every seed:
- all 3 attempts produced a **byte-identical** `bundle.det` (D1 reproducibility);
- `bundle-verify <attempt_dir>` → **exit 0** + a recomputed `result_id`;
- the recomputed `result_id` **and** the manifest `case_id` **equal** the certified v9 pins in
  `roadmap/evidence/EXP-F3a-robust.json.pinned_variants` (byte-for-byte, all 5 seeds).

| seed | case_id | result_id | bundle.det sha256 | len |
|---|---|---|---|---|
| 42 | `0b82614b372b0f9e90d64f32a3c8b04ed76563ceee13837c19bd9955ca76073a` | `9130689461912599b43cae77ba8cb6fc85ba032c0b41d7ef42417ad865b95122` | `702b0ce7413d05b9b9145c3bf868b3390da96ff6d9b199bd20c5f32fcfcd970d` | 79785 |
| 43 | `77efcda65dd04359ac9180fff034045c577f3ce1ff57186e3388a7c28f9e107d` | `5cfbe025c0faadadf234690162e5b95938a7eedb1e11fd32dab2ec689c5f9b18` | `c094cbae913f273a04514d07194702c30a51b2b74a4eb2fe5f37534fcb965f98` | 79785 |
| 44 | `183946e7d228481d4f98452a292cee42b3fa29850d564ab2e52c8f752b31705b` | `0a751844b5c42348b41cb4dabeccde557ea87fca735e602677ffba510f8fdd9a` | `c6cd8607c0ac90fc140e612e4c1b4db6a5ce9e0af406e85ee7f9eef39f186373` | 79785 |
| 45 | `c077db0c3961f470f0e27737bd443f613c1bae26dff7522f9b8871f96a4eb022` | `d5a5926072f2328d422d6449c6b60a711697774821cbe0ab2882e6a34fa385e5` | `51d10b944f289f6d364982260868af276cf3386f96d747df6a618a8a8e7311fe` | 79785 |
| 46 | `1f1e57e48629fcb6be45c176709d52c25ee2c76deb785cb61b47079df67a906c` | `1c3dea18764f2423b4ca6fca5f766c3a8a238be43d6e40f23595c37b89e0592d` | `560ed5f56361625101f19b0ca13c5a471217df0aa4d72690d44a057f552f87e0` | 79785 |

## Layout (same pattern as the f2a/f4 drops)

```
f3a_robust_seed42/
  491d9a770e57e857575f4e56f83e234d/   # the attempt dir: EXACTLY {bundle.det, manifest.json}
  IDENTITY.json                        # identity metadata, OUTSIDE the attempt dir
f3a_robust_seed43/  630b42c76e1f65594d6c8cc3b2dad7aa/  + IDENTITY.json
f3a_robust_seed44/  14a914d66e582706115301312a8ba90a/  + IDENTITY.json
f3a_robust_seed45/  042fdc660f53130dcf3dfb5f9130fe13/  + IDENTITY.json
f3a_robust_seed46/  2815e5979498440f3714dee8b9730d7c/  + IDENTITY.json
```

The attempt-dir name is the run's `attempt_id` (a 128-bit nonce, NOT folded into identity —
each seed had 3 such dirs; one representative is vendored). Certus's `bundle-verify` enforces
file-set EXACTNESS on the attempt dir (surplus file → `reject: UnexpectedFile`) AND requires the
dir be NAMED its `manifest.provenance.attempt_id`. Run the certified verifier on the vendored
fixture AS-IS:

```
bundle-verify.exe f3a_robust_seed42/491d9a770e57e857575f4e56f83e234d   # exit 0 + recomputed result_id
```

Each copied attempt dir was re-verified in place at drop time (all 5 → exit 0, recomputed
`result_id` equal to the pin).

## HONEST CONTENT LABELS (read before wiring presentation items)

- **This is a 5-seed STARTER batch, not the full campaign.** ROBUST at F3a is a **50-seed**
  statistical property (seeds 42..=91 × N=3): the certifier's NEES/NIS aggregate recompute
  against the precommitted two-sided chi-square bounds (dof 200 / 100, k*=64) and the
  `verdict_schema_version=2` StatResultBlock are defined only over all 50 seeds. **These 5
  fixtures each carry the certified per-seed D1 identity** (what `bundle-verify` re-earns); they
  do **not** by themselves re-earn the aggregate ROBUST/statistical verdict. The 45 remaining
  seeds are a follow-up drop.
- The authoritative per-seed identities for all 50 seeds are vendored as
  `contract/EXP-F3a-robust-pinned-variants-excerpt.md` (anchored to the source blob hash).
- **D2 is honestly Gated (1), not Demonstrated (2).** Cross-machine FP identity of the
  noise-generated measurement stream is deliberately NOT claimed — see
  `contract/EXP-F3a-D2-gating-note.FIXTURE.md` (byte-exact, hash-anchored) and its
  `.PROVENANCE.md`.
- Single-target tracking content: one confirmed track over its pinned lifecycle; 257 events /
  97 frames per attempt (1 MotionSegmentStarted + 96 MotionStepped + 80 DetectionMade + 1
  TrackConfirmed + 78 TrackUpdated + 1 TrackDropped). Tier: **robust (LIVE identity)** — unlike
  the KAT fixtures, `manifest.provenance` shows the real `commit=5ac32c4…` / `dirty=false`.

## Supersedes

- The stale `contract/EXP-F3a-robust-campaign-manifest.FIXTURE.json` per-seed ids (plan_id
  `636c4b4c…`, cut from the pre-merge `exp-f6a-bump @ bdb6feb`) do **NOT** reproduce at v9 main
  (current plan_id `c40caf85…`). Treat the vendored pinned-variants excerpt + these IDENTITY.json
  files as the current truth; the FIXTURE.json remains only as a design-format reference.
- Narrative-only supersession of `README-2026-07-08-drop.md` (v7) and `README-v8-drop-note.md`
  (v8) **for the f3a-robust surface**. Those f2a/f3a-KAT/f4 fixtures are unchanged; per their own
  never-patch-in-place rule they are retained verbatim.

## Staleness boundary

Valid as of Certus `main` @ `5ac32c4` (2026-07-09, event/state schema **v9/s4**,
toolchain `rustc-1.93.0`, `cargo_lock_hash ec4455d0…`). Any toolchain / `Cargo.lock` / schema
bump re-pins every identity (D-002). On any anchor doubt, re-verify against
`roadmap/evidence/EXP-F3a-robust.json` at your vendored commit and re-request — never patch in
place. Follow-up: the remaining 45 seeds (47..=91) to complete the acquirable 50-seed campaign.
