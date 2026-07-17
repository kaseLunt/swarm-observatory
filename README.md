# swarm observatory

<!-- NAME SLOT: product name + tagline are under adjudication at the 07-12 sitting.
     "swarm observatory" is the working name; the line below is the current repo
     description and the recommended tagline (it sells verification, not swarm scale). -->

**A browser observatory for deterministic drone-swarm run bundles — independent
byte-exact verification, causal replay, instanced 3D playback.**

[![CI](https://github.com/kaseLunt/swarm-observatory/actions/workflows/ci.yml/badge.svg)](https://github.com/kaseLunt/swarm-observatory/actions/workflows/ci.yml)
[![byte-exact conformance](https://github.com/kaseLunt/swarm-observatory/actions/workflows/conformance.yml/badge.svg)](https://github.com/kaseLunt/swarm-observatory/actions/workflows/conformance.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

The decoder in this app was written from the simulation engine's binary format
specification — not from the engine's Rust source — and it reproduces the engine's
cryptographic run hashes **byte-for-byte**. Every time a run loads, your browser
re-derives those hashes from the raw bundle and shows you the receipts before it
renders a single frame.

<!-- HERO POSTER: a static frame (the Certification Wall after verify-all) that LINKS to the live app —
     the site is the real demo, and a 93KB PNG is a far kinder cold-load for a first-time evaluator than the
     multi-MB motion capture, which is preserved one click beneath it (not deleted). The prior e0 placeholder
     is kept at docs/media/hero-e0-chain.gif for history; the capture ritual behind the motion clip is in
     docs/capture.md. -->
[![The Certification Wall with all 50 campaign seeds recomputed and matched byte-for-byte in your browser: a field of green check receipts, the aggregate NEES and NIS gauges on record, the ROBUST verdict, and the exact-integer census — 50 of 50 recomputed, 0 contradicted.](docs/media/wall-poster.png)](https://kaselunt.github.io/swarm-observatory/)

▶ **[Watch the 6-second screen capture](docs/media/hero-f1-flight.gif)** — a single byte-verified vehicle flying its recorded corridor while the provenance panel re-derives its hashes from the bundle with no external oracle.

**Live demo:** `https://kaselunt.github.io/swarm-observatory/` <!-- SLOT: goes live at flip -->
— the front door opens on **f1**, a vehicle flying its byte-verified recorded path. Or jump
into the library: the e0 geometry-certification run with a lit causal chain at
[`?run=e0&tick=37&ev=37`](https://kaselunt.github.io/swarm-observatory/?run=e0&tick=37&ev=37)

## What this is

A React + Three.js replay and provenance-verification app for run bundles produced by a
deterministic drone-swarm simulation engine (a separate, private Rust project). It decodes
the engine's binary bundle format in a web worker, cryptographically re-verifies every run
at load, and then lets you scrub, inspect, and walk the causal chain of everything that
happened — with every view addressable by URL. Nothing on the stage is animation data:
every position, event, and verdict was decoded from certified bytes, and the app shows you
the verification rather than asking you to take its word.

## How the verification works

Every run passes the same gate before it is allowed to render:

1. **Fetch** `bundle.det` — a framed binary stream: CRC32C-checked header, event frames,
   state-tick frames, and a trailer carrying the engine's own evidence hashes and counts.
2. **Decode** in a web worker. Every frame is CRC-checked; every payload goes through a
   fail-loud parser (malformed input throws a typed decode error — it never renders).
3. **Re-fold** the evidence: keyed BLAKE3 (derive-key contexts `det-event-log/v1` and
   `det-state-traj/v1`) over every event and state frame, then re-derive the run's
   `result_id` over the trailer's exact 115-byte preimage.
4. **Compare, and show the comparison.** The load ceremony ticks each hash ✓ or ✗ with the
   actual verdict — a tampered or inconsistent bundle shows a red mismatch, never a quiet
   fallback render.

**Two honesty tiers, by design.** `f0` ships with its certified manifest: the app compares
the recomputed hashes and `result_id` against the manifest's pins, and its badges go green
only on a match. `e0` and `f1` are published det-only — golden bundles without manifests —
so the app verifies them against their own trailers and *says exactly that*: the
manifest-tier badges stay neutral instead of painting a false green. A recomputation with
nothing to compare against is never presented as a certification. In CI, all six published
runs are additionally checked byte-exact against the engine's pinned hashes under
`contract/fixtures/`, and every vendored contract file is pinned by one of three
mechanisms: the synced format specs and flat goldens by SHA-256 in
[`contract/SOURCE.lock`](./contract/SOURCE.lock) (which also records the exact upstream engine
commit and whether that tree was dirty at sync); the sanctioned excerpts by in-file git-blob
anchors; and the certified fixture drops by a per-drop `IDENTITY.json` carrying each bundle's
SHA-256 and byte length. CI verifies the vendored pins on every push.

**The independence claim, precisely.** The TypeScript decoder was implemented from the
engine's format specifications alone (vendored under `contract/`), without reading the
engine's Rust implementation. Three implementations now derive identical hashes for every
certified run — the Rust engine, the engine project's Python reference oracle, and this
decoder. That three-way, cross-implementation, byte-exact agreement is re-proven in CI on
every push. The engine itself is private; this repo vendors its frozen format contract,
certified fixtures, and pinned hashes — enough for anyone to re-verify every published run
without the engine.

Verify it yourself:

```bash
npm ci
npm run conformance   # re-folds all six published run bundles (f0/e0/f1/f2a/f3a/f4) and checks every evidence hash byte-exact against the vendored pins — or it fails
```
<!-- `npm run conformance` runs src/decode/verify.test.ts + src/publication.test.ts — the
     byte-exact golden subset isolated from lint/build/e2e — and is what
     .github/workflows/conformance.yml verifies on every push. -->

## Tours and deep links

Press `?` in the app for the full keyboard grammar. The golden runs carry guided tours:
**The causal chain** (e0) selects one event out of 75 and lights its entire ancestry — then
walks it, cause by cause, like a debugger; **Motion lifecycle** (f1) follows a single
entity from spawn to finale. Every view — run, tick, selection, event, playback speed —
lives in the URL (`?run=e0&tick=37&ev=37`), so any moment you find is a link you can send.

## Where this is going

Stated plainly: the engine is pre-C1, so nothing here is multi-entity yet. Six certified run
families ship today: a determinism fixture (`f0`), a 75-query geometry sweep (`e0`), a
single-entity motion lifecycle (`f1`), and — on the engine's v9 schema — a scene-and-sensing
run (`f2a`), a single-target track (`f3a`), and a comms link (`f4`). The three v9 runs publish
as full-manifest bundles (the same honesty tier as `f0`); `e0` and `f1` remain det-only. All
six are vendored and hash-verified under `contract/fixtures/`. The **query stage** now renders
e0's spatial queries as a geometric replay, with the browser re-computing the engine's
*decisions* and not just its bytes. **Show the Math** puts those recomputations on screen and
agrees with the engine on all 75 to the bit. **The Hangar** is the run-library front door — a
card per run family that earns its verification seal only after you open it and its hashes
re-fold in your browser this session. Multi-entity content arrives with the engine's C1
milestone — and the causal-chain grammar here is deliberately designed as the single-entity
case of the cross-entity trace that will ship with it.

## The method

<!-- ============ PROCESS-DEPTH CUT-POINTS (owner gate) ============
     FULL  = keep everything A..D (recommended: own it hard).
     MID   = delete A..B (drops the explicit agent-loop naming; keeps the process).
     MIN   = keep only C..D (tests, CI, plans, constitution — no process story).
     These markers do not render on GitHub. -->
<!-- CUT-POINT A -->
This repository is an experiment in a second thing besides the app: shipping
agent-written code at high cadence without giving up engineering rigor. The code is
written by AI coding agents; the specs, the review gates, and every adjudication are
mine. If the commit density looks unusual, that's why — the interesting artifact is not
just the app, it's the process that let it ship this fast while staying provable.

Every task runs the same loop: a committed plan
([`docs/superpowers/plans/`](./docs/superpowers/plans/) — thirteen cycles so far, v0.1 through
v0.8), a written brief, implementation, and then **two independent reviews per task** — a
line-level code review, and a separate adversarial pass that must produce *executable
evidence* for its findings, not opinions. The two disagree regularly; findings are
adjudicated (fix now / defer with a trigger / reject with reasons), and both reviewers have
caught real bugs the other missed. The byte-exact conformance keystone — the moment this
decoder first re-derived the engine's pinned hashes — passed on its first run against the
vendored goldens, which is the kind of result a spec-first process is supposed to buy you.
<!-- CUT-POINT B -->
Releases are gated, not tagged: a release candidate passes the full unit and end-to-end
suites, an adversarial review sweep, an experiential critic pass that judges the app as a
*viewer experience* (camera work, motion, honesty of every badge and empty state), and a
clean-room rebuild — `npm ci` from the lockfile in a fresh worktree, full suite, build, and
smoke, proving the repo reproduces from scratch. Visual and interaction changes ship with
their own gate evidence.

Design is governed the same way. A one-page
[lens constitution](./docs/superpowers/specs/2026-07-08-lens-constitution.md) — five
questions a viewer can ask, one selection grammar, four laws, and a strict grammar for how
the past may be drawn into the present frame — is ratified and binding: every new surface
is judged against it before it ships.
<!-- CUT-POINT C -->
Current state of the gates: **1656 unit tests** (including the 205-test byte-exact conformance
subset) and **34 Playwright end-to-end checks** (as of v0.8); CI runs typecheck, lint, the
full test suite, a production build, and the browser smoke pass on every push, and has been
green on GitHub runners since the first push. The test suite re-derives every pinned hash
from the vendored bundles on every run.

**Process receipts.** The committed [plans](./docs/superpowers/plans/) and the living
[roadmap](./docs/superpowers/ROADMAP.md) are in the repo — the build process is inspectable.
<!-- CUT-POINT D -->

## Stack

React 19 · react-three-fiber / Three.js · Zustand · TypeScript · Vite · BLAKE3 via
`@noble/hashes` · hand-rolled CRC32C · Vitest · Playwright. No backend — decode,
verification, and playback all run client-side; hosting is static.

```bash
npm ci
npm run dev     # local app
npm test        # unit tests, including the byte-exact golden suite
npm run smoke   # Playwright end-to-end checks
```

## License

[MIT](./LICENSE) for everything in this repository **except** the `contract/` tree.
`contract/` vendors reference material from the private upstream simulation engine —
format specifications, sanctioned excerpts, and certified fixture bundles — and is
redistributed under its own notice ([`contract/NOTICE.md`](./contract/NOTICE.md)),
excluded from the MIT grant.
