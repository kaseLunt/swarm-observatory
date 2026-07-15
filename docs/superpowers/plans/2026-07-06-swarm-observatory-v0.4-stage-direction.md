# Swarm Observatory v0.4 — Stage Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Close the gap both critiques named: the panels are polished but the stage is under-directed — make the 3D scene, camera, and color system carry the product the way the ceremony and tours already do.

**Requirement sources (BINDING — implementers read the relevant sections):** the two critiques ledgered in `.superpowers/sdd/progress.md` (CRITIQUE 1 = first-impression, CRITIQUE 2 = craft review, full texts in the session record; concrete values below are extracted from them). Spec §6/§8 still bind; PROTECTED surfaces (do not regress): ceremony structure/staging, help-overlay color grammar, motion tokens/reduced-motion rigor, tour captions, timeline information density.

**Tech Stack:** unchanged; no new dependencies.

## Global Constraints
- §8 absolute: zero rAF allocation; all new per-frame work in-place (follow-lerp, trail ring buffer).
- Honesty absolute: every visual element data-bound or explicitly presentational (the e0 causal layout task documents its presentation-not-position framing in-UI).
- EVERY task browser-verified with screenshots judged EXPERIENTIALLY ("does this read as designed?") — not just compliance. Full gate before each commit. Conventional commits, no attribution. Reports: `.superpowers/sdd/task-v04-N-report.md`.
- Baseline: main @ bc5a8e3, 178 unit + 7 smoke.

### Task 1: Camera direction — framing + auto-follow
Default camera `[6,4.5,9]` fov 50, target `y≈1` (subject ~18-22% frame height, horizon upper third). While playing and nothing user-focused: lerp OrbitControls target toward the subject/swarm centroid at ~0.05/frame (reuse the focus-lerp scratch machinery; reduced-motion → snap per existing factor rules). Fit-to-trajectory-bounds at model load for motion runs (compute bounds from decoded states ONCE). ACCEPTANCE: the f1 tour never loses its subject; the final beat frames the resting drone. Files: `src/ui/Scene.tsx`. Pure helpers (`fitBounds`, `followTarget`) TDD'd in `src/ui/placement.ts` or a new `src/ui/camera.ts`.

### Task 2: World dressing — grid, atmosphere, trail, glow
Two-tier grid (cells `#243444`, majors every 5th `#31465b`) with radial fade dying at edges (echoes the favicon range rings); radial backdrop vignette (`#0c1420`→`#05070a`) behind the canvas (CSS on #viewport — canvas stays transparent-cleared or scene bg removed accordingly); trajectory fading polyline for motion runs (preallocated ring buffer, drawRange, zero alloc/frame); resting emissive lift `#0a1420`→`#12263a`; additive ground-ring under the selected entity (gives bloom a source); bloom retune intensity 0.9-1.1, luminanceThreshold 0.4 — VERIFY perceptible halo in screenshot + perf gate re-run (r3f-perf numbers in report; ≥60fps mandatory). Files: `src/ui/Scene.tsx`, `src/ui/app.css`, `src/ui/theme.ts` (new grid tokens mirrored in theme.css + agreement test).

### Task 3: Color ownership — token de-collision ✋ OWNER SWATCH GATE
The palette double-books hues: `cat-query`==accent, `cat-decision`==timeCursor, `cat-mutating`==mismatch, and the selection ring is mismatch-red (selection reads as error). Proposal: query→`#38bdf8`, decision→`#f5a524` (amber-adjacent, distinct from timeCursor `#ffd166`), mutating→`#ef6b73` (distinct from mismatch `#f87171`), accent reserved for UI/selection ONLY, selection ring/lens → accent cyan. Produce a SWATCH page (like v0.2b Task 1) rendering old-vs-new on real surfaces (inspector rows, timeline fills, scene selection, provenance) — ✋ STOP for owner approval before applying. Then apply: theme.ts+theme.css+agreement test+every consumer (categorize glyph hues ride the tokens automatically; Scene SELECTION_COLORS; Timeline fills). Files: `src/ui/theme.*`, `src/ui/Scene.tsx`.

### Task 4: e0 causal spine in 3D (presentation layout)
e0's subject has no state row (no positions) — the chain currently exists only in 2D. Lay the 75-event chain out procedurally in the scene (e.g. a low helix/arc sweep around the origin ring: deterministic function of seq, NOT fake telemetry) and draw the selected chain as a glowing spine (instanced segments, HDR accent, zero alloc). The layout is PRESENTATION: label the view "causal view — layout is presentational" in the inspector or a scene chip when active (honesty rule). Selected/ancestor/descendant segments lens like the 2D chain. ACCEPTANCE: selecting event 37 on e0 produces a screenshot-worthy lit spine. Files: `src/ui/Scene.tsx` (+ pure layout helper TDD'd), `src/ui/chain.ts` reuse.

### Task 5: Timeline ribbon redesign
Density as filled area/heatstrip (not full-height pickets): drop the 0.15 alpha floor (empty ≈ background), cap ribbon height ~55-60%, tall marks reserved for chain hits + selected event; playhead and chapter bands unchanged. Keep zero-alloc (precompute per model). ACCEPTANCE: f1's uniform 1/tick density reads calm; e0's chain highlight pops. Files: `src/ui/Timeline.tsx`.

### Task 6: Typography + panel hierarchy
Type scale opens to ~1.25 ratio: wordmark + ceremony/gate H1 → 1.4-1.5rem (keep 0.22em tracking); section headers → 13-14px; body 13px. Hash/id/numeric value cells → mono stack (`ui-monospace, 'Cascadia Code', monospace`) matching the ceremony. Provenance: group rows (Identity / Hashes / Integrity) with the counts+trailer line as a pinned footer; `.provenance h2` gets accent color (parity with inspector); det-only pending rows relabeled confidently (`self-verified · no external oracle`); `alive: true` → green status pill; `termination_reason` int → word map. Radar glyph (16-18px inline copy of the favicon mark) locked left of the wordmark; `<title>` case matched. Files: `src/ui/type.css`, `app.css`, `ProvenancePanel.tsx`, `App.tsx`, `index.html`.

### Task 7: Ceremony payoff + cold open + discoverability
Ceremony: one plain-language line under the H1 ("re-checking every byte against its cryptographic signature, live in your browser"); ~400ms settle beat on the completed double-✓ before dissolve (display-staging, floors pattern, reduced-motion skips); H1 takes the new display tier. Cold open: default run → e0; first-visit "▶ take the tour" nudge chip (dismissed state in localStorage — the app's first persistent state, keep it honest/tiny). Discoverability: plain timeline CLICK selects nearest event, DRAG scrubs (shift-click keeps working); cone hit-target enlarged (invisible hit mesh) + hover highlight (in-place emissive lift, §8). Smoke updates where selectors/defaults shift (default-run change touches existing tests — update deliberately, document). Files: `App.tsx`, `useRun.ts` defaults, `Ceremony.tsx`, `Timeline.tsx`, `Scene.tsx`, `e2e/smoke.spec.ts`.

### Task 8: Whole-branch gates
Fable whole-branch (experiential lens mandatory: screenshots judged against BOTH critiques; protected surfaces intact) + Codex probes (goldens/guards/§8/property/hygiene) + clean-room + final wave. The two critics are RE-INVOKED on the finished branch for a before/after verdict — the release gate is "would the first-impression viewer now screenshot it?"

## Plan self-review notes
- Task 3 carries the release's only owner gate (palette changes owner-approved per v0.2b precedent); tasks 1-2 are independent of it and run first while the swatch awaits review. Task 4 depends on nothing else; 5-7 independent; ordering 1→2→(3 swatch‖4)→5→6→7→8.
- Honesty risk concentrated in Task 4 (presentational layout) — mitigated by the explicit in-UI labeling requirement.
- Both critiques' "protect" lists are enforced as regression criteria at Task 8.
