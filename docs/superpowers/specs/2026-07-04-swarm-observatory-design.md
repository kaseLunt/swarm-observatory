# Swarm Observatory — Design

> **Status: approved design (2026-07-04, rev 2 after external review).** A standalone,
> UI-focused companion app that renders Contested Skies V2 run bundles as a rich,
> interactive recorded-run replay — comms, "brains," and causality made visible. ("Live"
> is not claimed anywhere in v0.x; a live mode is a future BundleSource implementation.) Separate repo, separate cadence; the main project's
> evidence platform is never modified or depended upon at build time.

## 1. Purpose & audience

- **What it is:** a polished, browser-based observatory for watching a recorded swarm run
  think — 3D spatial scene, causal timeline, per-drone brain inspection, comms visualization.
- **Who it's for:** (a) recruiters/interviewers evaluating autonomy-frontend and
  simulation-platform skill — hosted link + 60-second capture; (b) the public — a
  zero-setup, shareable web demo.
- **What it is not:** not evidence, not a debugging workbench (Rerun owns that in the main
  project), not a game. It renders authoritative recorded state only — it never simulates,
  invents, or approximates autonomy state (inherits VISION's view discipline).

## 2. Relationship to the main project

- **Consumer, never author.** The app reads V2 run bundles (spec-3a byte format). It has
  zero authority over the main repo and imposes no work items on it.
- **Grows with the schema.** Every new experiment that lands in V2 (comms, estimation,
  tasking) automatically appears in the app at baseline fidelity; lenses add high fidelity
  per event kind over time.
- **Protocol-agnostic by construction.** The current stigmergic comms design is slated for
  replacement. Therefore no lens may bind to protocol internals — only to schema event
  *kinds* and their declared fields (e.g. `MessageSent/Delivered/Dropped`). Swapping the
  comms algorithm must be a zero-change event for this app.

## 3. Stack & repo

- **Repo:** `swarm-observatory` (this repo), standalone. Deploys as a static site.
- **Stack:** Vite + React + TypeScript. 3D via react-three-fiber (Three.js) +
  `@react-three/postprocessing`. 2D panels (inspector, timeline) in DOM/SVG. Global state
  (playhead, selection, loaded run) in zustand. No game engine, no backend server.
- **Type discipline:** TypeScript `strict`; `Tick`, `Seq`, `EntityId`, `EventKind`, and
  byte offsets are distinct **branded types** — tick/seq/array-index confusion is the
  classic replay-app bug family and the compiler eliminates it for free. (Mirrors the
  main project's units-frame-types idea.)
- **Browser baseline:** current Chrome/Edge/Firefox/Safari, WebGL2 required (WebGPU
  optional enhancement, §3 escape hatch). Desktop is the target experience; mobile
  degrades gracefully to view-only playback with a "best on desktop" note — never broken.
- **WebGPU escape hatch:** Three.js WebGPURenderer is available if particle-field lenses
  ever exceed WebGL comfort; not used in v0.x.

## 4. Architecture — data layer

Three ports, one direction of flow:

```
BundleSource  →  Decoder  →  RunModel  →  Lenses
```

### 4.1 BundleSource
Where bytes come from. A V2 run bundle is a **directory pair** per spec-3a §6.5.14:
`bundle.det` (framed byte stream) + `manifest.json`. Supported inputs, explicitly:

- **Static hosted sample:** fetch `/runs/<name>/bundle.det` + `/runs/<name>/manifest.json`.
- **Drag-drop directory** (where the browser supports directory drops) containing the pair.
- **Portable single-file form:** `.obsrun.zip` containing exactly `bundle.det` +
  `manifest.json`. The zip is **transport only** — all verification (CRC, hashes) runs
  over the inner raw bytes, never over the archive.

The interface is deliberately shaped so a future WASM-compiled engine can sit behind it
(live in-browser runs, "perturb and re-run") with no changes downstream. Replay-first;
WASM later.

### 4.2 Decoder (independent TypeScript implementation)
- Written **from spec-3a §6.5 prose**, not ported from the Rust producer — an independent
  implementation of the byte contract (the main project's INS-002 principle: a byte spec
  needs an independent encoder/decoder to be trusted).
- Implements: `DETBNDL1` file header, `Frame { tag, payload_len, payload, crc32c }`
  (little-endian, CRC32C/Castagnoli checked per frame), `Event` / `StateTick` / `Trailer`
  frame payloads, manifest parsing.
- **Verification in the browser:** recomputes `event_hash`, `state_trajectory_hash`, and
  `result_id` (blake3 via WASM) and compares against the manifest. Results surface in the
  UI as integrity badges ("event_hash ✓ recomputed").
- **Schema-hash gating:** the decoder pins the `(event_schema_version, state_schema_version,
  schema_registry_hash, state_registry_hash)` set it supports. `state_registry_hash` is
  gated too because it fingerprints exactly what the UI renders from StateTicks
  (per-partition field layouts + projection rule ids) — an event-only gate could silently
  misrender positions. An unknown hash/version yields an explicit "this bundle speaks a
  newer dialect" screen showing the offending value — never silent misrendering.
- **Two-tier unknown handling (strict order):**
  1. *Unknown registry hash or version* → the dialect gate above. **No semantic decoding
     is attempted** — no best-effort rendering under an unknown registry.
  2. *Known registry, event kind without a dedicated lens* → generic decoded event in the
     timeline and inspector (kind id + decoded envelope + raw payload hex). Nothing is
     dropped.
- **v0.1 decoder scope (deliberately narrow):** file header, frame iteration, CRC32C,
  manifest parse, StateTick decode (current state v2), Trailer decode, hash recomputation,
  generic event table. It does **not** replicate `bundle-verify`'s rejection taxonomy —
  this app is an observatory, not a verifier.
- Runs in a **Web Worker**: decode + hashing never block the UI thread; verification
  renders as progress.

### 4.3 RunModel (in-memory, lens-agnostic)
- Indexes: events by `seq`, state ticks by `tick`, **causal edges from `causation_id`**
  (bidirectional: parents and children), entity registry from state partitions, per-kind
  event indexes.
- **Lazy state materialization:** state ticks are kept as decoded-on-demand keyframes, not
  fully materialized objects — long runs stay within browser memory budgets (~1–2 GB
  working-set ceiling).
- Carries **no protocol semantics**. It knows events, ticks, causation, entities. Lenses
  interpret; the model never does.

### 4.4 Time model
One global playhead `(tick, fraction)` owned by the store. Every view — 3D scene,
timeline, inspector, comms layer — derives from it. Controls: scrub, play 0.25×–8×, step
±1 tick, jump-to-event. Because bundles are deterministic recordings with authoritative
per-tick state, backward scrubbing is exact.

**Interpolation policy (one rule):** inspectors, events, causality, beliefs, and any
pass/fail or semantic display are **tick-exact**. Spatial rendering may visually
interpolate between two **adjacent authoritative StateTicks** for smooth animation — and
interpolated state must never generate semantic events or be presented as authoritative.
The UI never extrapolates beyond recorded ticks.

### 4.5 View state & deep links
The **entire view state** — loaded run, playhead, selection, camera pose, active lens,
open panels — lives in one serializable store and round-trips through the URL
(`?run=…&tick=…&sel=…&lens=…&ev=…`). Any moment anyone finds is a link they can share.
Binding rule: no component may hoard view state locally; if it isn't in the store, it
isn't view state. (This is also what makes the guided tour (§5.5) a pure data artifact.)

## 5. Lenses

### 5.1 Swarm Mind observatory (spatial hub)
Dark, planetarium-grade 3D scene: drones as instanced oriented glyphs with motion trails,
environment/region geometry rendered as ground truth. Interactions:
- **Click-to-inspect agent inspector:** select a drone → docked panel with its entity
  state, event history at/around the playhead, geometry queries, the currently selected
  event, and causal parents/children where present. With today's E0-only content that
  means state-tick fields plus `GeometryQueryResolved` events ("asked: inside region R? →
  answer", with the resolved geometry highlighted in-scene). It is labeled **"agent
  inspector"** until real cognitive kinds exist; once `Cognitive`-namespace kinds land, it
  upgrades to a true brain inspector — belief/decision strip chart with sparklines and a
  mini causal graph. (Honest labeling: "brain" is earned, not claimed.)
- **Selection lensing:** selecting an entity dims the world and lights up everything
  causally or spatially connected to it.
- **E0-specific visualization:** regions as translucent volumes whose *edges* flare when a
  query lands exactly on a boundary; query resolution as an animated ray/cone from the
  asking entity; boundary/tie-break moments (closed-boundary semantics) get a distinct
  visual beat. Boundaries are E0's whole point — the visualization says so.

### 5.2 Causal replay theater (day-one hero)
Timeline strip: event-density heat ribbon, per-kind lanes, playhead, burst-derived
"chapter" segmentation. Signature interaction: **click any event → its causal chain
lights up** — `causation_id` edges walked to roots and consequences, drawn simultaneously
as an arc diagram on the timeline and as glowing links between entities in the 3D scene;
steppable like a debugger. Integrity badges (hash verification results) live here. Works
fully with existing E0/F0/F1 bundles on day one.

### 5.3 Comms weather map (dormant until comms kinds land)
Toggleable atmospheric layer over the same scene, bound **only** to generic comms event
shapes: messages as light pulses traveling entity-to-entity, drops as visible fizzles,
sustained flow as glowing channels, degradation/congestion as weather fronts. Until comms
kinds exist in a loaded bundle, the lens reports "no comms events in this run" — honest by
default. Protocol swaps (stigmergy → future) are invisible to it (§2).

### 5.4 Provenance panel (app chrome, always available)
A docked panel — and the substance behind the loading ceremony (§6) — showing the loaded
run's identity from the manifest: scenario/experiment id, `case_id`, `result_id`,
`event_hash`, `state_trajectory_hash`, both registry hashes, source provenance where
present, and live verification status for each recomputed hash. This is the app's
credibility anchor: the ceremony is concrete, not decorative.

### 5.5 Guided tour mode (the recruiter's 60 seconds)
A data-driven narrative layer: a tour is a sequence of `(playhead, camera, selection,
caption)` keyframes played over a real bundle — camera flies, selections light up,
captions explain what the viewer is seeing. Reuses the lenses and view-state store
wholesale (a tour is just scripted view state, §4.5), and doubles as the shooting script
for the capture video. The hosted demo opens with "▶ take the tour" as the primary
action; free exploration is one click away.

### 5.6 Later lenses (parked)
- **Belief-vs-reality split-world** (ground truth vs a drone's estimated world, divergence
  as ghosts/tethers) — blocked until estimation experiments exist in V2.
- **Compare mode** (two runs side-by-side — e.g. same plan, different seeds, diverging) —
  natural fit for the main project's multi-seed robust suites. Parked, but protected: the
  RunModel must not assume a singleton run (no module-level singletons), so this stays
  cheap to add.

Listed to shape the plug-in boundaries, not scheduled.

## 6. Design language (authoritative — do not re-vibe)

The rule that reconciles "impressive" with "honest": **rich, cinematic rendering where
every pixel is data-bound.** Push visual richness as far as taste allows; no decorative
fiction. Every glow, pulse, trail, and particle maps to a real event or state field.

- **One coherent system:** defined dark palette with semantic color — each event category
  owns a hue everywhere it appears (scene, timeline, inspector). One type family with a
  real scale. One motion language: shared easing/spring constants app-wide.
- **Cinematic rendering pass:** HDR + bloom + tonemapping post-processing, depth-cued
  atmosphere, SDF text labels crisp at any zoom, damped camera with focus-pull transitions
  on selection.
- **Micro-interaction polish:** panels/timeline respond with springs; hover states
  everywhere; selection lensing eases in; nothing snaps.
- **Keyboard-first transport:** space play/pause, arrows step ±1 tick, J/K/L shuttle
  (video-editor grammar), number keys for speed, `F` focus-selected, `Esc` deselect — the
  app is fully drivable without the mouse; shortcuts surface in a `?` overlay.
- **Accessibility as polish:** `prefers-reduced-motion` honored (cinematic moves become
  cuts); the semantic palette is color-blind-safe — hue is never the *only* channel
  (shape/icon redundancy on every event-category encoding).
- **A designed opening:** bundle load renders as a verification ceremony — frames
  decoding, hashes confirming, scene assembling — the loading screen itself demonstrates
  the integrity story.
- **Aesthetic north star:** high-end mission control (Bloomberg-terminal density,
  planetarium darkness) — professional and polished, never "video game," never sparse for
  sparseness's sake.
- The `frontend-design` skill is used at implementation time to **execute** this
  direction (typography, exact palette values, component styling). It does not redefine
  the direction. This section wins conflicts.

## 7. Error handling

- Decode errors (`BadMagic`, `BadCrc`, truncation, oversize) → explicit failure screen
  naming the frame index and error; partial content is never rendered as if complete.
- Unknown `schema_registry_hash` / versions → the "newer dialect" gate (§4.2).
- Hash verification mismatch → prominent warning state; the run may still be viewed but
  every integrity badge shows the failure. (Faithful display of an unfaithful bundle,
  clearly labeled.)
- Absent event kinds → lenses state plainly that the run contains no such events.

## 8. Performance engineering (binding rules, not aspirations)

Stutter has exactly four causes in a browser 3D app; each gets a structural countermeasure
decided now, because none can be retrofitted:

1. **React re-renders in the frame loop — forbidden.** React reconciliation is for
   *structure* (panels, mounting lenses). Per-frame animation mutates refs, instanced
   attributes, and uniforms inside `useFrame`. The playhead — which changes 60×/s during
   playback — is a **transient value**: the 3D scene and timeline canvas read it directly
   per frame (zustand transient subscriptions / refs); DOM panels that display tick
   numbers subscribe throttled (~10 Hz) or on pause. A fast-changing value must never be
   passed as a React prop.
2. **GC pressure — designed out.** Decoded state lives in preallocated **typed arrays**
   (SoA: `Float32Array` positions/orientations per tick window), not JS object graphs —
   this also serves lazy materialization (§4.3). Hot paths allocate nothing per frame:
   scratch `Vector3`s reused, object pools for pulses/effects, no per-frame closures or
   array spreads. Worker→main transfers use **transferable ArrayBuffers**, never
   structured-clone JSON.
3. **Main-thread long tasks — forbidden.** Decode, hashing, and causal-graph indexing all
   run in the worker (§4.2); anything main-thread that could exceed ~4 ms is chunked or
   moved. Playback and scrubbing must remain interactive *during* background indexing.
4. **Mid-session shader/material creation — forbidden.** All materials are created and
   shaders precompiled (`renderer.compile`) during the loading ceremony — first-click
   jank from lazy compilation is a bug by definition. Comms pulses and particle effects
   are **GPU-animated**: the CPU writes spawn parameters (from, to, t₀, t₁) into instance
   attributes; the shader does the motion. Thousands of live pulses cost the main thread
   nothing.

**Scale + smoothness targets (measured, not vibed):**

- 60 fps sustained (frame p99 ≤ 16.6 ms) with hundreds of entities + thousands of live
  GPU primitives, at 8× playback, on mid-range hardware.
- Scrub-to-render latency ≤ 100 ms anywhere in the run; play/pause response ≤ 1 frame.
- Load-to-interactive ≤ 3 s for a typical fixture bundle (verification may continue as
  ceremony after interactivity).
- Bundle working set within browser comfort (~1–2 GB); long runs degrade by keyframe
  eviction + re-decode, never by crashing.

**Instrumentation is part of v0.1:** a dev-mode perf HUD (frame time, draw calls, GC
events) ships from the first scene, and the targets above are re-checked on the fixture
runs before each release tag. A stutter is a defect with a profile trace, not an
impression.

## 9. Testing, CI & dev tooling

- **Decoder golden tests:** decode the main repo's committed golden/KAT bundles (F0, F1,
  E0 canonical) as vendored fixtures; assert byte-exact recomputation of `event_hash`,
  `state_trajectory_hash`, `result_id` against manifest values. This doubles as an
  independent cross-implementation check of the byte spec.
- **RunModel unit tests:** causal-edge indexing (roots, chains, fan-out), lazy
  materialization equivalence (materialized tick == direct decode), unknown-kind
  passthrough, view-state URL round-trip (§4.5).
- **Visual smoke:** headless screenshot of each lens on a fixture bundle per CI run;
  eyeball-diff, not pixel-exact.
- **CI from day one:** typecheck + lint + unit/golden tests + visual smoke on every push;
  **every PR deploys a preview URL** (static hosting) — for a UI project the preview link
  is the review, and the demo link stays permanently fresh.
- **Dev harness:** a dev-mode route that hot-loads a lens against fixture slices (small
  extracted tick windows, clearly labeled as slices with verification badges expectedly
  red) — iterate on a boundary flare or a burst without scrubbing a full run. No
  Storybook; this route is the sandbox.

## 10. Scope ladder

| Stage | Contents | Demoable as |
|-------|----------|-------------|
| v0.1 | Decode `bundle.det` + `manifest.json` (narrow scope, §4.2) in a worker, verify hashes, provenance panel, timeline (scrub/play), StateTick entity positions + E0 `GeometryQueryResolved` rendering, view-state store + deep links (§4.5), perf HUD, CI + previews | "It plays real runs and proves them" |
| v0.2 | Causal chain click-through (timeline arcs + in-scene links), agent inspector, selection lensing, keyboard transport, design-language pass + cinematic post + verification ceremony | "The hero demo" |
| v0.3 | Comms weather map (behind kind-detection), chapter segmentation, guided tour (§5.5), polish + hosted deploy + capture video | "The shareable link" |

Each stage ends demoable. WASM live engine is explicitly out of scope for v0.x (the
BundleSource seam is its future home).

## 11. Non-goals

- Not the evidence platform; produces no evidence, alters none.
- Not a verifier: hash recomputation is a display feature; `bundle-verify`'s full
  rejection taxonomy stays in the main project.
- No UI-invented or extrapolated autonomy state, ever.
- No backend service; static hosting only.
- No binding to comms-protocol internals (§2).
- No native build; Rerun remains the native/debug path in the main project.

## 12. Cross-repo development protocol

The main project's frozen-contract discipline makes coordination **episodic, not
continuous**: the schema identity only moves at batched registry-bump ceremonies, so
between bumps the two repos need zero synchronization.

- **`contract/` snapshot (main → observatory, pull-based).** This repo vendors everything
  a development session needs: `SOURCE.lock` (the Certus commit SHA + content hashes of
  each vendored file), the spec-3a byte-contract sections (decode authority),
  `identity.json` (the pinned version/registry-hash tuple from §4.2), and fixture bundles
  (F0/F1/E0 goldens + sample LIVE runs). A `tools/sync-contract` script refreshes the
  snapshot from a local Certus checkout and rewrites `SOURCE.lock`.
- **Sync trigger:** after each registry bump lands on Certus `main` — and only then. The
  script compares `SOURCE.lock` against the local Certus HEAD and reports staleness; a
  stale snapshot remains fully workable (it is pinned), so staleness informs, never blocks.
- **Session self-containment:** observatory sessions read `contract/` as the decode
  authority and never read the Certus repo directly (except while running the sync
  ritual). Certus sessions never read this repo at all — the main project does not know
  the observatory exists (§2: consumer, never author).
- **Back-flow only as captures:** a TS-decoder disagreement with a golden hash is an
  INS-002-class finding; a schema field a renderer wishes existed is an idea. Both flow
  back solely via the main repo's `/capture` mechanism, carrying zero authority to create
  work there.
