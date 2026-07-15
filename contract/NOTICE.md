# contract/ — vendored upstream reference material (NOT under the repository MIT license)

This directory vendors reference material from the upstream simulation-engine
project: format specifications (or sanctioned excerpts), certified fixture
bundles, and pinned hashes. It is redistributed here solely to make this
application's conformance verification independently checkable. It is not
covered by the repository's MIT license; no other use is licensed.

Provenance and integrity pins: `contract/SOURCE.lock` (records the exact
upstream engine commit each synced file came from, its SHA-256, and whether the
upstream tree was dirty at sync), plus in-file git-blob anchors on the
sanctioned excerpts and per-drop `IDENTITY.json` on the certified fixture drops.
