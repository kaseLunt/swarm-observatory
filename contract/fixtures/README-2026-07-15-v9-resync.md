# 2026-07-15 — the v9/s4 atomic resync (T1)

All six published runs flipped v8/s3 → v9/s4 in one commit, with `contract/identity.json`.
Source: Certus **main-lineage @ b4f7e14** (`b4f7e1479e355ac7528cc3d720407898e0a5b1f6`) — the
last v9/s4 commit before the F5 k-bump.

**History-rewrite note.** Certus's history was rewritten for its public launch; the prior v9
drop (robust-f3a, 2026-07-09) cites the pre-rewrite SHA `5ac32c4`. The two commits' v9 content
pins are identical — `schema_registry_hash d7f96f5c…`, `state_registry_hash 1ba27650…`,
`rustc-1.93.0`, `cargo_lock ec4455d0…` — and those content pins, not the SHA, are the binding
identity. SHAs recorded in sidecars are navigation aids into whichever history the reader has.

**Generation.** e0/f0/f1 re-vendored verbatim from the committed v9 goldens. f2a/f3a/f4
regenerated as certified KAT drops (`f0-producer --kat`, seed 42): three fresh-process attempts
each, all byte-identical (D1), `bundle-verify` exit 0, result_ids matching the manifests.
Layout per the house convention: `<attempt_id>/{bundle.det, manifest.json}` + `IDENTITY.json`.

## ERRATUM — vendored spec-3a §6.5 (state_schema_version in the F0 KAT recipe)

`contract/spec-3a-event-schema.md` §6.5 (the F0 KAT generation recipe, ~line 448) still reads
`state_schema_version = 3` and explains only the s3 Cognitive fill. At `b4f7e14` the current
state schema is **s4**; the paragraph is stale UPSTREAM at that commit (the s4 bump did not
touch §6.5's prose). The checked-in F0 bundle and manifest are s4-consistent — the stale text
is guidance-only. Why F0's bytes are unchanged across s3→s4: **F0 emits neither Cognitive nor
Weapon entities**, so neither the s3 Cognitive fill nor the s4 Weapon declaration reaches its
byte stream.

The vendored spec is a byte-identical snapshot of its source (SOURCE.lock pins it); we do not
patch vendored files in place. The correction belongs upstream — flagged for the owner to land
in Certus when the C1 freeze lifts (the v11-era spec text should also be checked for the same
paragraph). Until then, this erratum is the authoritative reading for §6.5's version line.

## Sidecar authority correction (review catch)

The f4 sidecar briefly cited a nonexistent `EXP-F4-ablation.json` (drafting error in this
resync); corrected to `roadmap/evidence/EXP-F4-correct.json`, which owns f4's exact
case_id/result_id at `b4f7e14`. A publication test now pins every KAT sidecar's cited record
by exact name.
