# Provenance — EXP-F3a D2 gating note (vendored byte-exact)

`EXP-F3a-D2-gating-note.FIXTURE.md` is a **byte-exact** copy of Certus
`roadmap/evidence/EXP-F3a-D2-gating-note.md`, cut 2026-07-09 from Certus `main` @ `5ac32c4`
(`5ac32c40432a54ffdd81f1ea94b40a09c1f63d06`) by the Certus-side session (owner-relayed request).

Kept byte-exact on purpose: this note is a HASH-ANCHORED artifact. Its raw committed bytes are
folded (section-4.4 single-file framing: `u32 path_len ++ repo-relative POSIX path ++
u32 content_len ++ raw bytes`, no LF normalization) into every EXP-F3a ROBUST `verdict_digest`.
Editing it changes the hash and re-earns the verdict (D-002) — so this vendored copy carries a
provenance sidecar rather than an in-file header.

Anchors (re-verify before shipping the lens):
- Repo-relative source path (the framing path): `roadmap/evidence/EXP-F3a-D2-gating-note.md`
- Git blob hash of the raw bytes: `538bcb08872c7f06f0ed36a016da5dde55c26819`
  (`git hash-object roadmap/evidence/EXP-F3a-D2-gating-note.md` at the vendored commit)
- Byte length: `6242` · sha256: `5b9f937124712d83df30669b81b3a38f414f7bcfe1aa55d592749aa24933f5fa`
- Certified `gating_note_hash` (section-4.4 framed blake3): reproduces as
  `a7da0b75a7db8fb5cf5bf7fe0af62d10c0ebeb270d044d7ba1a705630f88eac4` — equal to
  `EXP-F3a-robust.json.robust.gating_note_hash` (verified at drop time from these exact bytes).

What it gates: D2 (cross-machine byte-identity of the noise-generated measurement stream) is
honestly `Gated (1)`, NOT `Demonstrated (2)`. A ROBUST verdict is claimed over seeds, fresh
processes, the five conformance gates, offline re-verification, and the statistical acceptance
composed on D1 — never over cross-machine FP identity. This is the honest-scope companion to the
`EXP-F3a-robust-pinned-variants-excerpt.md`.

Staleness: valid as of Certus `main` @ `5ac32c4` (schema v9/s4). If the blob hash above ever
mismatches at your vendored commit, re-cut the copy; never patch it in place.
