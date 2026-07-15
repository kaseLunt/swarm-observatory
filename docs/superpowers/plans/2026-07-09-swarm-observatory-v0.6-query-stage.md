# v0.6 — THE QUERY STAGE + THE CONSTITUTION ERA

**Branch:** `dev/v0.6` (base: main @ 857f020, v0.5d shipped, schema v8, six run families vendored)
**Governance:** this plan cites and is bound by the LENS CONSTITUTION
(`docs/superpowers/specs/2026-07-08-lens-constitution.md`). The query stage is its first
compliant citizen and files the first in-code LAW-4 declaration. Items pulled from
`docs/superpowers/ROADMAP.md` per the anti-forgetting protocol (clause 1).
**Authoritative design sources (do not restate — read):** the draw inventory
(`.superpowers/sdd/design-v06-draw-inventory.md` — 75-row draw table, stage metrics, density
ruling, act structure, API gaps), the vendored excerpts (`contract/EXP-E0-kind23-geometry-excerpt.md`,
`contract/EXP-E0-decision-forms-excerpt.md`), the composite directive
(`.superpowers/sdd/design-directive-v06plus.md` Parts II.3/II.6 + IV.21).

## Pinned constraints

- Constitution §1–5 binding; the v0.5d critic PROTECT list binding (frozen stage geometry &
  CALIB basis, two-voice glyph grammar, RM=authored, NM tour direction, chip posture, beaded
  spine, chrome discipline). The v0.5c PROTECT survivors (e0 write-as-you-play contract,
  finale composition, scrub destinations) also hold — the query stage REPLACES the helix as
  e0's stage but the reveal/truncate/rest contract carries over verbatim.
- §8 physics; eases via clamped helpers; RM contract; zero steady per-frame allocation.
- ⚠ BINDING (decision-forms excerpt): bearings come from vendored-libm pinned KAT bits —
  Show-the-Math NEVER recomputes a bearing via platform `Math.atan2`; recompute
  pure-arithmetic forms only; bearing values render as pinned-bit display.
- Palette: build against CURRENT tokens. The R3 swatch (verdict-pair + causality hues) is an
  owner gate mid-cycle; if approved, application is a token-value swap (the system's whole
  point). No new colors anywhere (LAW 2).
- Out of scope: campaign items, comms build (v0.8 — its consult is done), C1 anything.

## Tasks (SEQUENTIAL unless marked; sole-writer discipline; opus + codex every task)

### T0 — Scene split + spine loop-bound (arch TIER-3, adopted)
Move-only, behavior-identity. Wave A: extract `src/ui/frameChannels.ts` (focusRequest,
trailFrameRequest + FrameIntent + writers, tourStartFrameRequest, trailHold, orbitDragging,
shouldRefitOnFinaleClear) — 3 known import sites (useTour, App, camera.test). Wave B:
ChainSpine→chainSpine.tsx, TrajectoryTrail→trajectoryTrail.tsx, ChainLinks→chainLinks.tsx,
CameraRig→cameraRig.tsx — each with ITS OWN scratch vectors (retires the "Entities finished
first" cross-component ordering contract). Scene.tsx lands ~700 lines (Entities + shell).
Camera arbitration deliberately NOT split (trigger = 4th camera owner). RIDER: the spine
accumulation loop bound `i < min(reveal, capacity)` (O(eventCount)→O(capacity) per
tick-change — fix the template BEFORE QueryStage clones it). Gate: 364 unit + 16 smoke pass
with import-path updates only; smoke pixel assertions = the behavior-identity proof.

### T1 — Timeline legibility pass (constitution instrument-citizenship, D21)
Hover identification on every mark (ask-any-pixel's first citizen), whisper-quiet legend,
kind-separated lanes, arcs reserved for selection (LAW 1), progressive density (ticks
sparse → heat dense). The ribbon must be readable by a first-time viewer BEFORE the query
stage projects onto it. Design authority: directive Part IV.21.

### SWATCH (parallel with T1 — design artifact, no code collision) — R3 palette rev-3
Sonnet-tier task builds the swatch page (scratch HTML, real surfaces): verdict pair gets its
own two hues (un-double-spend the integrity green/red), chain highlight gets a causality
token (chroma grading kept). ΔE/CVD receipts per rev-2 precedent. STOPS at the owner gate.
Apply (token-value swap + agreement tests) lands as a rider on T3 if approved.

### T2 — Query-stage model layer + LAW-4 declaration
Load-path only, zero decoder/model-core change (dossier: geometryQueryAt already returns the
payload; argv is dark). Build per the draw inventory's API gaps: `queryDraw(seq)` per-kind
parsed views (excerpt §1 layouts; computed hit points o+t·dir when [t] present),
`losComponents(seq)` (3 preceding same-(o,g) rows), `queryBounds(model)` presets
{full r≈1216-DECOY, core-theatre (19.5,0,0) r≈674 = DEFAULT, solids+contacts r≈259},
scenario solids from excerpt §2 (sphere/box/TRIANGLE — never a plane) as module consts +
honesty chip wording. FILE THE LAW-4 DECLARATION in-code (question Q1/Q2-adjacent per the
directive; surface split; borrowed hues = existing verdict/category tokens; what it dims;
honest empty state). Pure helpers TDD'd against the draw table's machine copy
(verify/v06-draw-table.json).

### T3 — Query-stage rendering (the release's heart)
The stage per the inventory + directive: observer + probes write the world (rays fade-spent,
21 contacts persist on 13 spots, 3 solids materialize where touched), act tinting (3 acts,
temporally disjoint fan sources), LOS composites draw per-occluder contact from their
component triplets, tiebreak boundary badges (20 ticks), CLEAR beats (tk51/74) as act
finales, core-theatre default framing. Reveal clock = `spineRevealCount` REUSED VERBATIM
(seq==tick holds for e0) → the write-as-you-play/scrub-back contract holds by construction.
Replaces ChainSpine as e0's stage (chain re-lensing on selection persists — the spine's
causal-role lensing carries into the new geometry). Mount beside the positionless guard.
GPU/§8: instanced rays/contacts, event-rate rebuilds, fade via the trail-shader pattern.
RIDER (if swatch approved): palette rev-3 token swap + agreement tests.

### T4 — Show the Math + Observer's Eye + the query tour
(a) SHOW THE MATH (D3): click any verdict/badge → the pinned decision form rendered with
decoded numbers substituted (decision-forms excerpt = the authority); in-browser recompute
of all 75 verdicts (pure-arithmetic forms ONLY — the atan2/libm constraint is binding;
bearings display pinned bits, never recomputed) with engine-vs-ours agreement display;
disagreement renders in the mismatch voice (display-tier, spec §11 holds). (b) OBSERVER'S
EYE (D6): POV-at-O camera preset — BLOCKED = eclipse, CLEAR = open sky; frameFor/ease reuse,
§8-clean. (c) THE QUERY TOUR (tour-per-lens standing rule): 60s, captions decode-true,
the acts as beats, a CLEAR finale, RM per the constitution's hold-sizing rider.

### T5 — The Hangar + publication window
(a) Publish f2a/f4/f3a runs (v8 gate FIRED): decode-verify → public/runs + index.json
titles; lenses for their kinds come later (f2a=v0.6-window-optional, comms=v0.8) — published
runs render honestly with existing surfaces (entities/timeline/inspector; kind-generic).
(b) THE HANGAR (D5): run-library front door — story cards (title, earned verdict voice, kind
histogram, real sim duration via dt_us, tour as primary action); folds the default-run +
verdict-headline owner gates (flag at review). (c) sim-clock readout (real dt_us on
f2a/f4/f3a; e0/f0/f1 keep the "assumed" voice).

**T5 RIDER BLOCK — D4 Certification Wall consult adoptions (consult-d4-certification-wall.md
is the design of record; this block pins the load-bearing subset):**
- ⚠ BINDING PROHIBITION (pin with a test): the ROBUST wordmark never touches the published
  f3a card. The vendored `f3a_seed42` fixture is the CORRECT campaign (case 5dc77bdf…,
  pins_record EXP-F3a-correct.json); the robust campaign sidecar's seed-42 row is a DIFFERENT
  bundle (case e8dcdb33…, authority EXP-F3a-robust.json.pinned_variants). Same seed number,
  two campaigns — controller byte-verified 2026-07-09.
- Checkmark economy: ✓ is SESSION-EARNED ONLY (reload ⟹ dots); no persisted/build-time
  checkmarks anywhere. Card verdict badges wear the attested voice until a run is opened and
  sealed this session.
- Two color systems never cross-spent: integrity green = recomputed-and-matched EXCLUSIVELY;
  the R3 verdict pair = statistical pass/fail. Zero new tokens.
- Kind histograms = publish-time index metadata (declared, not recomputed at render).
- `supersedes_plan_id` always surfaced; the "tampered index misdirects, never forges" line is
  the surface's disclaimer chip; `test_params_echo` courtesy-copy caveat travels with it.
- Reserve the v0.7 Wall panel geometry (census + gauges collapse per constitution §5 at scale).
- NEVER-list: no unearned ✓, no index-as-authority, no fake constellation/staged cascades, no
  partial-verification totals, ✗ escalates and persists, verification state never in the URL.
- Upstream dependency: the Wall's verify-all needs the robust-f3a bundle drop (relay ask #1,
  queued 2026-07-09); until it lands, the Wall ships against acquirable targets only.

### T6 — Ceremony handoff + zero-click thesis (R6 + P2)
Shared-element continuity: confirmed hash lines settle into their provenance-panel rows,
stage fades up beneath (rides REAL decode timing — no fake delays; §8 load budget holds).
Then the zero-click thesis: one thesis card → auto-play the first tour beat, interruptible
by ANY input; verdict headline on the panel; in-app independence line; copy-link button
(the share weapon drawn). Design authority: directive II.6 + portfolio P2.

## Endgame (4 gates + extras)
Clean-room; codex whole-branch; fable brief (+ roadmap-sync clause 2); FULL experiential
critic (not scoped — this cycle changes the app's face; before/after vs 857f020; the e0
query stage judged against the owner's original "spasmodic blinking" complaint — the meaning
arrives HERE). Endgame extras per roadmap: capture rung 2 (fixed-dt clock), frame-budget
baseline (perf-budget.json, trend-not-gate), synthetic forge minimal subset (price the
caps). D4 Certification Wall consult dispatched in parallel during the cycle.

**Hard limits (standing):** no merge/push without owner word; codex every task; no
attribution; PROTECT lists binding; constitution compliance judged at every review.
