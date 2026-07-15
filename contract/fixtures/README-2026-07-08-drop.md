# Certified fixture drop — F2a + F4 seed-42 KAT bundles (2026-07-08)

Dropped by the Certus-side session (owner-relayed request), regenerated from a PINNED clean
worktree of Certus `main @ 9cb3e8d` on the pinned toolchain (`rustc-1.93.0`, `--locked`) —
NOT copied from the working tree (a registry-bump build was mutating it at drop time).

## Layout (differs from your flat e0/f0/f1 fixtures — deliberately)

```
f2a_seed42/
  88a2d7d8b30b36fd44783b9176a6e161/   # the attempt dir: EXACTLY {bundle.det, manifest.json}
  IDENTITY.json                        # identity metadata, OUTSIDE the attempt dir
f4_seed42/
  08a6565699f07417758000beb68b55a4/
  IDENTITY.json
```

WHY: Certus's `bundle-verify` enforces file-set EXACTNESS on the attempt dir (any surplus file
→ `reject: UnexpectedFile`; fail-closed anti-smuggling) AND requires the dir to be NAMED the
attempt_id (`ManifestMismatch` otherwise). This layout lets you run the certified verifier on
the vendored fixture AS-IS:

```
bundle-verify.exe <fixture>/<attempt_id>     # exit 0 + prints the recomputed result_id
```

Final-gated at drop time: both ACCEPT — F2a → `c690319c…b9eefa`, F4 → `eda3ab4a…547c35`,
each equal to the pinned KAT identities in `roadmap/evidence/EXP-{F2a,F4}-correct.json` and
byte-identical (`cmp` + sha256 + len) to the committed goldens
`tools/reference-encoder/golden/{f2a,f4}_seed42.det`. An independent adversarial verifier
agent recomputed every hash and re-read every pin before this drop was finalized.

## HONEST CONTENT LABELS (read before wiring presentation items)

- **Nothing in the ladder is truly multi-entity yet.** Every rung through F4 explicitly
  deferred multi-entity state to C1 (the P2 keystone). Your "awaits multi-entity content"
  items will fully unblock only at C1.
- **f2a_seed42 — the closest entity-bearing content today:** one moving target entity (state
  trajectory, F1 closed-form motion) + a static scenario sensor; sensing/eligibility events
  (incl. kind 22 EligibilityEvaluated). 212 events, 96 ticks, 12.0s sim time.
- **f4_seed42 — the comms-kinds preview:** kinds 5/6/7 (MessageSent/Delivered/Dropped), 64
  events (32 sends + 32 outcomes), 96 ticks. **ZERO entity partition** — endpoints are pinned
  scenario content, not entities. Do not build multi-entity assumptions on this fixture.
- Tier: KAT (hermetic synthetic identity). `manifest.json` provenance shows
  `commit=UNKNOWN/dirty=true` — expected for a KAT-tier local build (identity injection is a
  LIVE-tier requirement); the certified source pin is IDENTITY.json's `source_commit`.

## Staleness boundary

Valid as of Certus `main @ 9cb3e8d` (2026-07-08, event/state schema v7/s3). The EXP-F6a k=7
registry bump is IN FLIGHT and re-pins every identity (schema v8). A refreshed drop will be
offered after it lands — on any doubt, re-verify against the pins at your vendored commit and
re-request; never patch in place.
