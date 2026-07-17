# SWARM-OBSERVATORY MASTER ROADMAP

**Status:** authority for WHAT ships WHEN. Established 2026-07-08 from the advisory-bench
audit + vision engagement (sources: `.superpowers/sdd/design-directive-v06plus.md`, the
arch-lead ROADMAP slate, the portfolio STRATEGY slate — all adjudicated in the ledger).

**THE ANTI-FORGETTING PROTOCOL (binding on the loop):**
1. Every cycle-open plan authoring READS this file and pulls its cycle's items; every
   cycle-close UPDATES statuses (shipped / moved / re-triggered). Status updates ride the
   cycle's docs commits.
2. Every endgame fable/whole-branch brief includes a ROADMAP-SYNC check: items shipped
   this cycle marked, nothing silently dropped. A roadmap drift = a review finding.
3. Items never leave this file — they ship, or they carry an explicit status and trigger.
   Removal requires an owner-visible note.

**Legend:** status = `IN-FLIGHT | NEXT | PLANNED | GATED(trigger) | PARKED(reason) |
STANDING-RULE | OWNER-GATE`. Sources: D=design directive, S=arch systems, P=portfolio,
R=bench critique rulings, U=unconstrained horizon, G=résumé-sweep gaps.

---

## GOVERNING DOCUMENTS

| Artifact | Status |
|---|---|
| Lens Constitution (`docs/superpowers/specs/2026-07-08-lens-constitution.md`) | RATIFIED 2026-07-08 — every plan cites it |
| Design directive (`.superpowers/sdd/design-directive-v06plus.md`) | commentary of record |
| Design spec §6/§8 (`docs/superpowers/specs/2026-07-04-swarm-observatory-design.md`) | standing authority; §5.3 amendment pending at Contested Link consult (OWNER-GATE) |

## STANDING RULES (never expire)

- Tour-per-lens: every new lens ships with its 60-second tour. (D)
- Echo grammar governs every past-in-present render. (Constitution §4)
- Chain/trace work is designed as the single-entity degenerate case of the cross-entity trace. (U7)
- Lens-registry provenance metadata decided at registry design time — before comms/f2a lenses build. (U11/S5)
- Live-sim seam hygiene: load-path precomputes document their immutability assumption. (S-tail; buys U15)
- Two-voice verification marks: recomputed-and-matched vs claimed-not-recomputed, never the same glyph. (R2→D4)
- No uncertified content on the stage, ever. (P-cut, Tier-1)
- Codex reviews every task; critic PROTECT lists bind fix waves. (loop law)

---

## v0.5d — STAGING REFINEMENTS (SHIPPED)

| Item | Source | Status |
|---|---|---|
| T1 aspect-lead / ring handoff / re-fit tail | v0.5c critic | SHIPPED (24cb358) |
| T2 distance-true ring / pause persistence / tour-start reset | v0.5c critic | SHIPPED (7dad8d0) |
| T3 bench polish wave: controls.update() fix; R1-reserve stable viewport + designed empty state; R2 two-voice badges; R4 RM holds ≥ authored; R5 wordmark/run-titles/single CTA; R7 seams/help-wording/chip-occlusion; opus m1–m3 riders | codex/R1/R2/R4/R5/R7 | SHIPPED (691f4ba) |
| Endgame: clean-room, codex sweep, scoped critic | loop | PASSED (all four gates; critic SHIP) |

## FLIP-PREP TRACK (parallel, delivers BEFORE the 07-12 sitting)

| Item | Source | Status |
|---|---|---|
| README draft: independence sentence, hero GIF, two-tier verification story, C1-honest roadmap line, process section | P1 | SHIPPED-DRAFT (ba265f7; truth-fixes ride each endgame — v0.7 fixed the method counts to 894 unit / 28 smoke / 81 conformance; hero GIF = placeholder captured 2026-07-08, regen at flip — regen ritual = v0.7 T7 via the rung-2 capture clock, `docs/capture.md`; owner cut-level + license/naming still gated) |
| LICENSE choice + file | P1 (new catch) | OWNER-GATE (recommend MIT; excerpt carve-out at sitting; DRAFT PREPARED this cycle — the file lands with the decision) |
| Byte-exact conformance CI badge | P1 | SHIPPED (e1ce23b + b15b6a6 read-only token, merged c391aad; conformance.yml live w/ `contents: read`; scope widened to all six published run families this wave; README badge slot stays commented until the workflow runs green on main — activates at flip) |
| Capture pipeline rung 1: provenance-stamped stills | S3/P3 | PREMISE-CORRECTED (2026-07-09, rung-2 disclosure: rung 1 never existed as code; the README-GIF need is served by rung-2 captures — regen = v0.7 T7 via `?capture=<fps>`) |
| Pre-flip deploy rehearsal (Pages dry-run) | P-inv | DONE (v0.7 T7 — Pages dry-run rehearsal complete; no flip; delivered before the 07-12 sitting) |
| Flip timing: hold for v0.6 | P4 | OWNER-GATE (two advisors recommend hold) |
| README process-depth (how hard to surface the SDD method) | P1 | OWNER-GATE (bench recommends: own it hard) |
| Naming input to the sitting: tagline carries verification, not swarm scale; second launch beat (C1 = "the swarm arrives") pre-planned | P4 | OWNER-GATE (input relayed) |

## v0.6 — THE QUERY STAGE + THE CONSTITUTION ERA (NEXT major cycle)

| Item | Source | Status |
|---|---|---|
| T0: Scene.tsx split (Wave A frameChannels.ts, Wave B component files w/ own scratch) + spine loop-bound one-liner | S(adopted) | SHIPPED (f07d6b8 Wave A + e08760a Wave B; move-only, byte-identity gate held 364/364; frameChannels/chainLinks/chainSpine/trajectoryTrail/cameraRig extracted, camera arbitration deliberately unsplit) |
| T-early: TIMELINE LEGIBILITY PASS (hover-identify every mark, quiet legend, kind lanes, arcs-on-selection, progressive density) | D21/G | SHIPPED (a00ee0c legibility pass; tip a49a8c8 after the per-kind-lane + heat hit-test bit-exact closure waves) |
| Query stage (geometric replay; draw inventory + vendored excerpt are the ground truth; core-theatre framing r≈674; fade-spent-rays/persist-contacts; act tinting; tiebreak badges; CLEAR beats as act finales) | v0.6 core | SHIPPED (2460215 model layer + 7242bbe stage; tip 0840b1f after the NOT-YET-ghost + component un-suppression waves and the all-75 stage-silence invariant) |
| SHOW THE MATH: decision forms rendered w/ decoded numbers + in-browser verdict recompute (75/75 agreement display) | D3 | SHIPPED (8161f12; bit-exact Object.is recompute holds all-75 at zero tolerance, bearings display the pinned-libm bits [atan2 banned + import-closure scan guard], the '?' unverifiable voice for null composites) |
| Observer's Eye POV preset (eclipse/open-sky beats) | D6 | SHIPPED (7d1bbe2; 'pov' FrameIntent rides the existing trail-frame owner — no 4th camera owner, T0 guard held) |
| Ceremony handoff (shared-element continuity into provenance panel) | R6 | SHIPPED (44f5f21; confirmed hash lines settle into their provenance rows, stage fades beneath — rides the real decode timing, no fake delays, no staged cascades) |
| Zero-click thesis: auto cold-open first beat + verdict headline + in-app independence line + copy-link | P2 | SHIPPED (44f5f21 + fix waves 3991b43/f81c870; withheld-verdict fail-safe, loadIsCurrent identity join, copy-link never carries verdict/seal; ZERO_CLICK_SCOPE toggle → MORNING GATE #10) |
| THE HANGAR: run-library front door w/ story cards (all six run families live — no locked cards) | D5 | SHIPPED (2ef47b4, merged 909b34b; session-earned seal machine w/ identity binding + break-on-mismatch, declared-vs-decoded histograms; default-run + verdict-headline OWNER-GATEs drafted-not-decided, ride the morning list) |
| Palette: verdict-pair hues + causality token (un-double-spend integrity pair + time's gold) | R3 | RESOLVED-SHIPPED (Set 1 approved + applied 1daf1e7; both gold double-spends retired, playhead keeps timeCursor, zero new hex beyond the set) |
| Capture rung 2: fixed-dt capture clock (de-flakes all gate evidence) | S3 | SHIPPED (built cdf1614, merged 11a5cca after a 5-round review closure; `?capture=<fps>` fixed-dt clock, playhead-timeline determinism proven bit-identical under cross-jitter, speed-independent pacing, `capture` never emitted by encodeLink; rung-3 visual delta seam = the named row in THE FLIP section, spec `docs/capture.md`) |
| Frame-budget baseline capture (perf-budget.json, trend-not-gate) | S6 | DONE (`.superpowers/sdd/perf-baseline-v06.md`: all six runs clean vs the 16.7ms budget; e0 wash path +4.7% avg / max exactly at threshold, no degradation at 8×; ritual re-run at the v0.7 endgame, trend-not-gate) |
| Synthetic forge, minimal subset (price the spine/query caps) | S7 | RECHARACTERIZED — DESIGN-OWED (STOP report 2026-07-09: no generator, no spec, no scale targets, no thresholds exist anywhere in the record; the row describes a render-cap PRICING exercise never designed; the fuzz-harness reading was a conflation. SPEC-FIRST rider on v0.7 T3 — cap-pricing and the horizon are the same emphasis-budget economics) |
| Parallel design consults: CONTESTED LINK (D1, v0.8 target) + CERTIFICATION WALL (D4, v0.7 design half) | D1/D4 | DONE (design-of-record: `.superpowers/sdd/consult-d1-contested-link.md` + `.superpowers/sdd/consult-d4-certification-wall.md`) |
| Constitution compliance: query stage files the LAW-4 declaration | Constitution | STANDING |

> **v0.6 release critic (gate 4): SHIP-WITH-NOTES** (`.superpowers/sdd/critic-v06-full.md`).
> Ruling 3 — a must-fix honesty-class item — LANDED (be0a6ae) pre-merge and shipped with v0.6
> (main @ c32bd4c). The other ruling direction items have roadmap homes in the NEXT-CYCLE
> follow-ups below and in the relay / owner-gate sections.

## POST-v8 RE-SYNC WINDOW — **CLOSED** (v8 merged upstream 2026-07-08 evening, main @ f378e8f; all refreshed drops delivered + verified, incl. the F3a seed w/ Track{mean,P,ν,S}; publication + Hangar shipped in v0.6 — window consumed)

| Item | Source | Status |
|---|---|---|
| Contract re-sync to schema v8 (ONE re-sync; no v7 churn) | contract law | **MERGED** (40a48cc; worktree-isolated chore/contract-resync-v8, merged after v0.5d T3) |
| f2a + f3a + f4 app publication (SIX certified run families: f0/e0/f1/f2a/f3a/f4) + Hangar cards unlock | P-inv/D5 | SHIPPED (fe080fe publish + 0dfb204 merge; verify-before-publish ritual held, robust-wordmark prohibition pinned 3 ways; Hangar cards live via 909b34b) |
| SENSING GAUNTLET: f2a lens (eligible-tinted trail + four-gate instrument strip) | D2 | PULLED → v0.7 T2, THE CENTERPIECE (its trigger fired at the 2026-07-09 cycle open exactly per its own text; did not die silently) |
| Sim-clock readout (real dt_us on f2a/f3a/f4; e0/f0/f1 keep the "assumed" tick voice) | D-tail | SHIPPED (2ef47b4 / 909b34b; dt_us===125000 real → 0:12.0 on f2a/f3a/f4; det-only e0/f1 + f0's 1000µs==playback-step keep the assumed voice) |

## THE FLIP (GATED: 07-12 sitting outcomes + owner word; recommended WITH v0.6)

| Item | Source | Status |
|---|---|---|
| Public flip + Pages deploy + repo hygiene (topics, social preview, pinned) | P | GATED(sitting + owner) |
| Share cards: build-time per-run OG + repo social image | P5 | GATED(flip; assets from capture pipeline) |
| Launch posts (Show HN + LinkedIn shapes) + capture video (owner-driven, consumes rung-3 footage) | P-inv | GATED(flip) |
| Capture rung 3: the VISUAL DELTA SEAM (capture-aware delta through the r3f frame loop — camera focus/trail/follow easing, finale ring scale, predictive lead; proof = camera-state cross-jitter digest) | S3 | PLANNED — named debt at the rung-2 merge (11a5cca); spec `docs/capture.md` §"Rung 3"; TRIGGER: before any cross-machine motion-frame bit-identity claim, and no later than the tour-clip rung |
| Capture rung 4: WebCodecs tour clips (renumbered from "rung 3" — the capture ladder's rung 3 is the visual delta seam per `docs/capture.md`) | S3 | PLANNED(pre-flip) |
| Embed mode ?embed=1 | S4 vs P-cut | GATED(flip; ADJUDICATED flip-optional, not flip-blocking) |
| Engineering-receipts page; ARCHITECTURE.md + plans index; "verify it yourself" affordance | P-inv | PLANNED(flip window) |
| Post-tour cross-run prompt; idle attract-mode rider | P-inv | PLANNED(flip window, feel-gated by critic) |

## NEXT-CYCLE — v0.6 RELEASE-CRITIC FOLLOW-UPS (SHIP-WITH-NOTES; `.superpowers/sdd/critic-v06-full.md`)

| Item | Source | Status |
|---|---|---|
| THE WHY WASH / aggregation horizon: e0's linear chain lights all 75 magenta on any selection; the constitution's own aggregate-beyond-a-horizon rule (Part I.E / III.7) shipped unenforced — apply N-hops + a root chip | critic R1 | SHIPPED (v0.7 T3, 94bbac8 — the wash is dead: N-hops + HOP_DECAY + root/N-hops chip, rest-state SHA-identical proof-protected; HOP_DECAY symmetry = OWNER-GATE G4, before/after evidence exists) |
| Tour authored camera for beats 5–6 (Act III plays at the frame's left edge; the finale CLEAR runs off-screen; the mechanism exists, §8-clean) | critic R2 | SHIPPED (v0.7 T4, 94bd25f — f1 hero + f2a native authored; e0 beats 5–6 EXPLICIT-CARRIED to v0.8-open, never silently dropped; ratification = OWNER-GATE G6) |
| Hangar histogram kind NAMES (kind 289 × 96 renders as unnamed integers on the front door) | critic R4 | SHIPPED (v0.7 T5, 200393e — kind 288/289 named from the registry, zero invented wording) |
| Thesis card collapse-to-header-chip once beat 1 starts (it persists over the whole tour today) | critic R6 | SHIPPED (v0.7 T5, 200393e — thesis card collapses to the header verdict chip at stepIndex≥1; reload-calm invariant corrected bf61890) |

## v0.7 — THE FLIGHT DEEPENING (ENDGAME 2026-07-10 — T0, T2–T7 SHIPPED; T1 REPORT-DELIVERED / HELD on relay #2; opened 2026-07-09; plan of record `docs/superpowers/plans/2026-07-09-swarm-observatory-v0.7-flight-deepening.md`; branch `dev/v0.7`; scope (b) owner-approved)

| Item | Source | Status |
|---|---|---|
| T0 debt wave: duplicate index fetch, eventsByTick EMPTY const, stale-dist smoke guard | S-cut / T5b | SHIPPED (3ccb7b0 / 21d225b / 2f423c5 + 273786a — dup index fetch + eventsByTick EMPTY const + stale-dist smoke guard; the identity.json stale-critical guard-input catch landed 273786a) |
| T1 V8→V9 CONTRACT RE-SYNC: `contract/identity.json` v8/s3 → the 07-09 drop's v9/s4; worktree-isolated `chore/contract-resync-v9` per the 40a48cc precedent; ONE re-sync, contract law | relay #12 / contract law | DONE — the atomic v9/s4 resync landed, main @ `766981b`, 2026-07-15 (all six published runs flip v8/s3→v9/s4 in one merge with `contract/identity.json`; relay #2 Bucket A — the atomic six-run flip — COMPLETE; Bucket B — the 50-seed robust sidecar — RE-EARNED 2026-07-15: verdict_level=2 ROBUST, 50 variants × 3 attempts, gates 31/31, live identity == precommitted pins; outputs cached for the v0.8 Wall's vendoring decision) |
| C1 twin consults: (a) registry provenance metadata (standing rule, binds T2's start); (b) entity identity language (G19) | U11/S5 + G19 | DONE (`.superpowers/sdd/consult-v07-c1.md` — (a) registry provenance metadata + (b) entity identity language; both bound T2's start) |
| T2 THE SENSING GAUNTLET: f2a lens per D2, grounded in the delivered scene+sensing excerpt; four-gate strip; LAW-4 declaration; 60-second tour; legend multi-kind rider | D2 | SHIPPED (3cc070f; codex 4-round — the sensing gauntlet centerpiece; UI naming = OWNER-GATE G5) |
| T3 THE HORIZON: miniwave §§1–2 + §1.4 generic (HORIZON_HOPS / HOP_DECAY / ambient yield / chainmeta chip / bounded arcs); S7 forge SPEC rider (design-owed, spec-first) | critic R1 + S7 | SHIPPED (94bbac8 — the wash is dead: HORIZON_HOPS=3 + HOP_DECAY + root/N-hops chip, rest-state SHA-identical proof-protected; S7 forge SPEC authored at `docs/superpowers/specs/2026-07-09-synthetic-forge-spec.md`, §6 build-vs-defer decision gate OPEN; HOP_DECAY symmetry = OWNER-GATE G4) |
| T4 THE AUTHORED CAMERA: f1 hero tour first, f2a native, e0 beats 5–6 iff cheap; I-1 mount-race rider (TDD + deterministic repro) | critic R2/R7 | SHIPPED-pending-codex-closure @ pin 94bd25f (f1 hero + f2a native authored + I-1 mount-race fix; e0 beats 5–6 EXPLICIT-CARRIED to v0.8-open; ratification = OWNER-GATE G6) |
| T5 front-door polish: histogram kind NAMES, thesis-card collapse, copy-link permanent home, cosmetic nits | critic R4/R6 + debts | SHIPPED (200393e — histogram kind names + thesis-card collapse + permanent copy-link home; #21 seal-adjacent nits DEFERRED-EXPLICITLY) |
| T6 lens registry extraction (two live lenses) + C1(a) provenance metadata | S5/U11 | SHIPPED (3c4504d — lens registry over two live citizens + C1(a) provenance metadata + ask-any-pixel; e0 asymmetry closed; codex review queued @ pin) |
| T7 flip-prep parallel: Pages dry-run, hero GIF regen from f1 via the rung-2 clock (claim language respects the rung-2 boundary), LICENSE prepared-not-committed, the sitting brief | P-track | DONE (8d100d9 — capture.md ritual = the real f1 recipe; the e0 recipe labeled Historical/superseded; Pages dry-run + LICENSE draft delivered) |

> **v0.7 ENDGAME — CYCLE-CLOSE CARRIES & DOCKETS** (this wave's clause-2 catches; each carries an
> explicit trigger, none silently dropped):
> - **CODEX DEBT QUEUE** (fires at the true codex reset — the quota wall pushed all four past the
>   window; the review floor is satisfied by QUEUEING, never skipping): T4-wave closure @ pin
>   `94bd25f`; T6 review @ pin `3c4504d`; SOL deep audit @ base `ea51a15..3c4504d`; the endgame
>   whole-branch sweep. Pins recorded.
> - **ev99 VOICE-SPLIT docket** — T2-owner follow-up (the sensing-gauntlet two-voice census /
>   voice-split question; rides the owner's word).
> - **e0 authored beats 5–6** — EXPLICIT-CARRY to v0.8-open (library-tier, iff cheap; the R2
>   generalization shipped f1 + f2a native, e0 deferred — carried, never dropped).
> - **S7 forge §6 decision gate** — build-vs-defer for the synthetic forge (spec
>   `docs/superpowers/specs/2026-07-09-synthetic-forge-spec.md` §6), empirically informed: f2a has
>   ZERO causation edges and f4's deepest chain = 1 hop → the cap-D defer is the leaning. OWNER/DESIGN gate.
> - **anti-echo `basis: live-inputs | decoded-consistency` discriminant** — the registry-evolution
>   catch: a recompute's basis (live inputs vs decoded-consistency) wants a first-class registry field
>   so the two-voice grammar stays honest as lenses multiply. → v0.8 registry evolution.
> - **N2 centralize the shot reset** across the 8 channel writers (one reset site, not eight — the
>   sweep's N2). → v0.8.
> - **N3 `cancelTourArrivalFrame` finale-intent latent edge** — a finale-intent shot can outlive its
>   intent across a boundary (the sweep's N3); note-tier (humanly-unreached today, pinned to fail loud
>   if it grows).
> - **README method-section counts** — truth-fixed to 894 unit / 28 smoke / 81 conformance this wave;
>   regenerate at the flip window alongside the hero-GIF regen (both drift every cycle).

## v0.8 — THE WALL, IN PUBLIC (cycle opened 2026-07-15; **LADDER COMPLETE 2026-07-16** — all eight rungs merged to `dev/v0.8` @ bfcda1a, three public tree-snapshots pushed [090d88f the Wall / 074752b the tamper moment / 779b0c9 the authored tour], site LIVE at kaselunt.github.io/swarm-observatory; plan of record `docs/superpowers/plans/2026-07-15-swarm-observatory-v0.8-the-wall-in-public.md`; branch `dev/v0.8`; scope approved as filed on the owner's filed defaults — G-1 scope, G-2 public flip [scrub-conditional], G-3 Bucket B [DONE — ROBUST re-earned same night], G-4 LICENSE [MIT + `contract/` carve-out]; re-targeted v0.7→v0.8 at the 2026-07-09 cycle open — the Wall's existence condition MET at 1367433)

**THE LADDER (approved as filed; per-wave detail lives in the plan of record above):**

| Item | Source | Status |
|---|---|---|
| W0 FLIP-PREP polish (week 1, no feature budget): README counts truth-fix (894→1111/88/28 drift), ARCHITECTURE.md + public process receipts, LICENSE (MIT + `contract/` carve-out), the Pages flip itself | portfolio 1/6/9 | SHIPPED — PUBLIC 2026-07-16 via the orphan/fresh-history pattern (review caught codename/paths/work-email in dev ancestry → tree-snapshot commits only, dev parentage never published; f7424c3 = the first public commit; LICENSE + README landed 2287f5b/890a40e lineage; live at kaselunt.github.io/swarm-observatory) |
| W0' A3 branded ticks (parallel): EventTick/StateFrame/TransportTick brands at the RunModel boundary; ONE resolveCursor (zero-alloc out-param form); store/URL tick NOT branded | arch 2 | SHIPPED (5917816) |
| W1 VOICES module (thin): two-family taxonomy (VERDICTS ✓○•✗ / NO-VERDICT ·?NOT-YET), single-source in theme.ts idiom, the 4-surface attested drift fixed; ev99 folds in as a note-level `basis` ruling | design 7/8 | SHIPPED (838644d — boot-time single-source assert + exhaustive VOICE_MARK; ev99 basis note shipped, full text deferred-on-trigger) |
| W2 I5 CausalNeighborhood: causalNeighborhood(seq,{maxHop,maxPerHop}), pinned truncation order, count-true chainmeta; causalChain demoted | arch 3 | SHIPPED (f8a914d — smallest-seq truncation from the decode law; bounded ascending survivor buffer) |
| W3 A1 witness union: closed two-arm union (basis live-inputs \| decoded-consistency IS the tag); tokens resolved by buildLensRegistry; comparand excluded from InputToken at the type level; NO interpreter | arch 4 | SHIPPED (fc2776b — ComparandToken disjoint at compile time; branded AgreementResult demanded at the render boundary) |
| W4 Campaign spine: persistent worker, hash-and-discard verify, RunSummary (never useRun×N); decode-cancellation debt lands here; RUN_CATALOG build-time generation trigger (>~12 citizens) | arch 5/6 | SHIPPED (d14b08a — the cycle's deepest convergence: the fail-closed producer-coherence table [5 legal rows; DERIVE/DECLARE/CRASH three-way law], epoch-fenced cancellation, worker-side catalog resolution; build-time generation trigger unhit, stands) |
| W5 THE WALL (hero): D4 execution + design rails — green-is-a-receipt (rest state zero-green zero-bloom screenshot = review gate), real timing or a cut, 5-acquirable/45-on-record split honest, verify-all choreography in true completion order | design 1-4, portfolio 3/4 | SHIPPED + LIVE (fd2ede8; public snapshot #1 090d88f — 50 seeds verified in-browser against the in-app catalog authority; cancel preserves observed evidence; verdict.det in-browser decode = the W5 carry, deferred-on-trigger) |
| W6 THE TAMPER MOMENT: the ✗ path demonstrated — one byte flipped, the fold refuses on screen, the skeptic's ten seconds | portfolio 9 | SHIPPED + LIVE (d2e483b; public snapshot #2 074752b — decoder-owned meas span, CRC repaired so the refusal is CRYPTOGRAPHIC not structural; the seven-row INTENDED_CASCADE pinned) |
| W7 e0 authored beats (rider): The first block (tk39), The second observer (crane n=−601), Clean passage (tk74); + N2 shot-reset carry | design 5/6 | SHIPPED + LIVE (bfcda1a; public snapshot #3 779b0c9 — three decode-true shots, two new TourShot kinds; 3 review rounds → APPROVED with mutation-ratified closes; the review arc was ALL claims-vs-assertions defects, zero geometry/decode defects) |
| **v0.8.1 polish wave** (owner-approved, post-close): the Wall's header front-door (one shared open action); the dirty row's full disclosure (build-hygiene + non-citable under the publication contract) + `dirty`/`run_complete` validated strict-boolean fail-closed + **incomplete runs refuse admission** (run_complete=false → the not-published gate, proved at the hook with a two-directional decoder-spy test); the private-shorthand scrub (~131 files, ~1420 lines — the WHY stays, the pointers die); README poster + trued counts; both tours byte-pinned strict | release critic QW-1/2 + rounds | SHIPPED + LIVE (44d826d; public snapshot #4 7ee7cd6 — 8 commits, 5 codex rounds → APPROVED zero findings; gates 1656/205/34) |
| R3 visual-delta seam (capture-aware delta through the r3f frame loop) | arch 9, design 9 | DEFERRED — own trigger: no frame-loop co-scheduling with a new-surface cycle |
| CSR event-store | arch 7 | DEFERRED — trigger restated: ≥10^5 events |

CUT: the A1 interpreter ("DSL" half) — echo unrepresentable per the arch verdict; the
campaign-sibling pipeline stays bounded to stream-and-discard beyond W4.

**Pre-ladder v0.8 backlog** (tracked before the candidate ladder synthesized the cycle;
kept per the anti-forgetting protocol — the ladder above is the executing plan):

| Item | Source | Status |
|---|---|---|
| CERTIFICATION WALL (constellation by real statistics; acquisition-as-choreography; two-voice marks; absent-sidecar state first-class) | D4 | SHIPPED (v0.8 W5, fd2ede8 — the FULL 50-seed campaign vendored + pinned in the in-app catalog authority [plan_id + per-seed sha256 + full stat tuples incl. bound bit-strings]; the D2 verdict-grade ask DISCHARGED: Bucket B re-earned ROBUST 2026-07-15 and shipped as the Wall's bytes) |
| Campaign sibling pipeline: persistent worker + RunSummary + drill-in through untouched hero path; NEVER useRun×N | S2-cliff | SHIPPED (v0.8 W4, d14b08a — the campaign spine IS this row: module worker, fold-and-discard, {requestToken,campaignId,seed}-only wire; bounded to stream-and-discard per the cycle CUT) |
| IMPORT-AND-VERIFY WORKBENCH (drag-drop bundle → same gate/ceremony; session-scoped runs; "flip one byte, watch it fail") | S2 | PLANNED (front-end of the importer) |
| DIFF KERNEL (runDiff: divergence, per-column deltas, state-hash lane) | S1a | PLANNED |
| Ghost overlay (second run slaved to the tick; reduced-alpha trail+cones) | S1b | GATED(first scenario-sharing pair — day one of campaign acquisition) |
| A/B split view | S1c | GATED(ghost proves insufficient — possibly never) |
| COMMAND PALETTE (Cmd-K: jump/find/go-to-beat) | G16 | PLANNED (data outgrows scrubbing here) |
| RAW EVENT TABLE (sortable/filterable, tabular figures) | G17 | PLANNED (nearly free) |
| Compare mode (two seeds split-stage) | D-tail | GATED(v0.7 acquisition) |
| Evidence-DAG navigator | S-tail | PLANNED (folds into wall design) |
| Frame-budget harness → CI gating | S6 | PLANNED (baseline exists from v0.6) |
| Raycast scale remedy: hover-raycast throttle → instanced BVH (three-mesh-bvh upgrade rides this) | S-cliff | GATED(≥1k instances content) |
| String-keyed entity maps → columnar per-tick arrays (worker-side) | S-cliff | GATED(≥5k entities) |
| Entity identity language DESIGN (callsigns, glyph taxonomy, identity plates) | G19 | DONE (v0.7 C1(b) consult `.superpowers/sdd/consult-v07-c1.md` — callsign / glyph taxonomy / identity-plate language decided; the owner's "which one is the drone" verdict = G5 naming input) |
| DRONE SILHOUETTE (owner, 2026-07-16): the entity mesh is an upward cone — reads as an abstract marker, not an aircraft; design a legible drone form (quad/fixed-wing silhouette or a stylized read that stays cheap at instanced scale and CVD-safe in the glyph taxonomy) | owner | QUEUED for the v0.9 design bench — rules BEFORE the comms cycle multiplies entities (same design-before-migration-tax logic as identity plates); shape=class taxonomy from G19 is the constraint frame |
| Lens registry extraction (from two live lenses: query stage + sensing gauntlet) + ask-any-pixel provenance metadata decided | S5/U11 | SHIPPED (v0.7 T6, 3c4504d — extracted from the two live lenses; ask-any-pixel provenance metadata decided at C1(a)) |

## v0.9 — THE CONTESTED LINK (comms; **CYCLE OPENED 2026-07-17** on the owner's morning word — G-1 scope as laddered, G-2 the yaw-only delta silhouette, G-3 the dirty ✗→quality-register migration approved; G-4 launch beat = drafted-at-close, never auto-posted; plan of record `docs/superpowers/plans/2026-07-17-swarm-observatory-v0.9-the-contested-link.md`; branch `dev/v0.9`; designed during v0.6; shifted v0.8→v0.9 at the 2026-07-09 renumber — the Wall takes v0.8)

**THE LADDER (approved; per-wave detail in the plan of record):**

| # | Wave | Status |
|---|------|--------|
| W0 | Quick-win rider: conformance badge uncommented, tour chips named by lens, caption-band carry closed, README process-receipt links | SHIPPED (2a7b62c+355a8bb → merged f79cf24; 2 rounds; the chip refactor briefly resurrected the retired prototype-key class — caught and re-killed with the hasOwn idiom) |
| W1 | THE QUALITY REGISTER (do-first): the third register (• + caveat, ev99-basis idiom, no 8th glyph); dirty:true migrates OFF ✗ (G-3 approved); comms drop/degraded inherit later | SHIPPED (merged 4195fc3; 3 rounds — built → consumed-from-source → the whole voice on one source, mutation-ratified; the G-3 migration live) |
| W2 | HEADER LADDER: priority-condensation (run ▾ picker, CTAs never fold, ⋯ overflow) | SHIPPED (merged 861e58d; 4 rounds, 11 findings — identity-keyed menu ownership, focus-restoring closes, four tiers to 360px, every real occupant budgeted incl. the cold-open chip; the v0.8.1 stopgap retired) |
| W3 | DECODE EXTENSION: decodeMessage*/decodeTrack* (kinds 5/6/7 + 2/3/4), oracle tests, no contract change | SHIPPED (merged 1b2d093; 1 round ZERO findings — the cycle's cleanest; six decoders, the signed latency_us kept bigint; the hero's identity enriched: msg 14, tick 30, reason LOSS) |
| W4 | SHARED REVEAL CLOCK + LIVE REGISTER (discharges the v0.7 live-playhead carry) | SHIPPED (merged 976eb21; 2 rounds + ship-bar close — the carry DISCHARGED; the live strip owns the tour's flight; the NOT-YET voice speaks pre-first-verdict) |
| W5 | THE COMMS LENS + THE HERO: the one lost packet (f4 tk30), latency lane, ledger-by-scrub; drop wears the quality register never ✗; in-shader visibility (the named frame-path risk) | QUEUED |
| W6 | BELIEF vs REALITY (honest): covEllipse.ts leaf, the f3a shrinking disc; sent-vs-arrived degeneration on f4; no fabricated ✓ | QUEUED |
| W7 | THE RAW EVIDENCE TABLE: the byte-X-ray interrogation surface, all six runs | QUEUED |
| W8 | THE DRONE SILHOUETTE (owner ask, G-2 approved): oriented flat delta, yaw-only from the already-decoded heading; migration table per the design consult | QUEUED |

DEFERRED on triggers: belief sparklines (BeliefUpdated in ZERO runs), jam/contest grammar (upstream jammer-active F4), campaign-scale comms, command palette (arch: not yet).

**Pre-ladder v0.9 backlog** (kept per the anti-forgetting protocol; the ladder above is the executing plan):

| Item | Source | Status |
|---|---|---|
| Comms lens movement one: duet stage, latency-lane headline, the one-lost-packet story, write-as-you-play ledger | D1 | **CONSULT DONE** (`.superpowers/sdd/consult-d1-contested-link.md` = the design source): STORY PIVOTED on decode evidence (f4 contains no contest — constant SNR, jammer inactive, 1 LOSS drop; the honest story is "a steady link and the one lost packet"); LAW-4 declaration filed (first constitution citizen); echo-grammar DURATION precedent ruled (4 clauses, auction corollary written); §5.3 amendment TEXT READY → OWNER-GATE; build-ready at re-sync (re-run the decode probe first — the v9 re-sync is v0.7 T1; the probe rider is noted in T1's brief so it doesn't silently wait). **RE-CONFIRMED at v0.9 open: the arch consult re-decoded v9/s4 fresh — D1's numbers hold EXACTLY.** NEW UPSTREAM (long game): jammer-ACTIVE F4 scenario — new scenario authoring upstream, slow; lens ships beautiful without it. → EXECUTING as W5 |
| Message-pairing index (msg → send/outcome) | D-tail | PLANNED (enables the lens) |
| Jam-state timeline lane | D-tail | PLANNED (phase 2) |
| BELIEF vs REALITY: covariance ellipses from real Track{mean,P}; brain-inspector sparklines (BeliefUpdated) | U9 | PLANNED (F3a-drop gate SATISFIED — fixture vendored `contract/fixtures/f3a_seed42`, Track{mean,P,ν,S}; lens builds in v0.8) |
| TELEMETRY STRIPS (fuel/speed/heading sparklines → playhead-synced strip chart) | G18 | PLANNED |
| ATTENTION RAIL (volunteered beats: tiebreaks/CLEARs/drops/mismatches, deep-linked) + THE DEBRIEF (end-of-run box score) | G20/U12 | PLANNED (fold together + seek keys) |
| Evidence-seek keys [ / ] | D-tail | PLANNED |
| Curator mode (named shareable moment sets) | U14 | PLANNED |
| Byte X-ray (field-span highlighting) + certified citation copy | D-tail | PLANNED (pairs w/ Show the Math) |
| Schema atlas (24 kinds: present/lensed/dormant) | D-tail | PLANNED |
| Dev harness route (spec §9) | D-tail | PLANNED (pays across every lens cycle) |

## C1 ERA — "THE SWARM ARRIVES" (GATED: Certus C1 milestone)

| Item | Source | Status |
|---|---|---|
| Hero run (4+ entities, crossing trajectories, contact event, legible finale) | P/D | GATED(C1) — PRE-REGISTERED as the first C1-day upstream ask |
| CAUSALITY TRACE cross-entity (the signature: echo-grammar thread across the dimmed stage; aggregate-beyond-horizon; walk-don't-view time-travel steps) | U7 | GATED(C1 content; grammar proven on f2a earlier; UI naming = OWNER-GATE) |
| TACTICAL PLOT (synchronized top-down ortho companion) | U8 | GATED(earns keep at f2a; indispensable C1 — may pull earlier) |
| THE AUCTION (TaskProposed/Bid/Assigned negotiation ribbon + commitment bonds) | U10 | GATED(kinds 11–13 emitted; bid-bearing scenario via visual-payload spec) |
| Spatial comms weather map (§5.3 original form; placement upgrades presentational→data-true) | D1/C1 | GATED(C1) |
| Multi-entity follow grammar (subject-follow + whole-swarm establish via trajectoryBounds) | S-cliff | GATED(C1 content) |
| Second launch beat: v0.8+ "the swarm arrives" release + post | P4 | GATED(C1) |
| ASK ANY PIXEL full rollout (all lenses; interrogation mode) | U11 | GATED(registry carries metadata — decided at S5) |
| Spine over-cap selection-centered window | ledger carry | GATED(>10k-event bundles) |

## HORIZON (named destinations; every seam decision buys them)

| Item | Source | Status |
|---|---|---|
| THE LABORATORY: WASM perturb-and-re-run, live re-certification through the ceremony | U15 | PARKED(post-v0.x; §4.1 seam kept clean by standing rule) |
| Run-as-sculpture 4D minimap (where the trace literally renders as a cone) | U13 | PARKED(instrument-not-hero; pull when a cycle wants it) |
| Annotation/share layer beyond URL state | S-tail | PARKED(storage story) |
| Schema dialect door (multi-version decode) | S-cond | PARKED(priced DON'T-BUILD; re-open only for frozen-generation display designs) |
| Chunk-split pass (1.34MB advisory) | S-tail | GATED(embeds exist) |

## SMALL DEBTS (from bench cut-lists; fold opportunistically, never silently drop)

- Duplicate runs/index.json fetch (App + useRun) — one-line lift. (S-cut) PULLED → v0.7 T0.
- ChainSpine selection-branch recomputes causalChain per tick-change — RESOLVED BY DELETION (ChainSpine deleted at 586ec5c when the query stage replaced it as e0's stage). (S-cut)
- eventsByTick `?? []` → EMPTY const. (S-cut) PULLED → v0.7 T0.
- Decode cancellation — owned by the v0.7 persistent-worker job protocol. (S-cut)
- pausedMidRun pure-helper extraction if the gate is touched again. (T2 opus m5)
- Tour-start same-frame race stamp-swallow. (T2 opus m4, humanly unreachable)
- Mount-time missed-rising-edge establish race (I-1, v0.5d T3): pre-mount play never requests
  establish (the subscription doesn't exist yet) — remedy = mount-effect
  already-playing-and-eligible detection firing `requestEstablishFrame` after the ref seed;
  MUST gate against run-switch remounts; needs TDD + deterministic repro + scoped review (opus
  blast-radius ruling); severity low (software-rendering window). PULLED → v0.7 T4 rider
  (same camera neighborhood).
- Critic cosmetic nits (v0.5d endgame): attested-note wrap at 320px; tour-time empty-state
  instruction-voice redundancy; idle empty-state personality-pass candidate.
  PULLED → v0.7 T5 (opportunistic).
- ci.yml top-level permissions absent → GITHUB_TOKEN inherited the repo default (npm ci
  lifecycle scripts w/ possibly-write creds). LANDED THIS WAVE ({contents: read}, deploy.yml
  form; artifact upload unaffected). (endgame)
- Stale-dist smoke footgun: playwright `webServer` only PREVIEWS, never builds, and
  `reuseExistingServer` compounds it → a stale `dist/` can make new smoke tests falsely
  fail/pass. Add a build step or a dist-freshness check to the smoke path. (T5b merge-verify)
  PULLED → v0.7 T0 (before this cycle's smoke growth).
- Heat aggregate CLICK affordance: heat click selects the nearest-in-lane sole event or
  no-ops (multi); a true "show me this bin's events" affordance is unbuilt — the aggregate
  honesty is hover-voice only. (T1 closure carry)
- Legend mark-swatch multi-kind rendering: TRIGGER-FIRED — the legend-swatch story needs a
  multi-kind pass once a run fans lanes wide (raised at f1's 2-lane fan-out). (T1)
  PULLED → v0.7 T2 rider (f2a fans wider).
- Single-source CSS generation: theme.css mirrors ~22 token hexes guarded by a full-coverage
  agreement test; generate the CSS from the TS token source instead of maintaining the
  mirror. (T3 codex LOW)
- Timeline amber-comment sweep: stale "amber causal arc" comments predating the spine-violet
  swatch. LANDED THIS WAVE (app.css + Timeline.tsx comments re-pointed to the spine/violet
  token; comment-plane only, zero code change). (endgame)
- updateRange GPU-upload cut: the query stage's per-tick instance writes are O(changed) but
  flag whole-buffer `needsUpdate`; a targeted `updateRange` would trim the GPU upload.
  (T3 W1 residual)
- Copy-link permanent home: the cold-open copy-link is card-only; it wants a permanent home
  in the app chrome, not just the thesis card. (T6 deviation flag) PULLED → v0.7 T5.
- Temp/orphaned-files hygiene: handle-lagged Temp worktree dirs (`swarm-obs-*`) linger after
  deregistration, plus orphaned codex job files under abandoned worktrees. Sweep
  opportunistically (never delete inside other repos' state dirs). (endgame)

## UPSTREAM RELAY QUEUE (status as of 2026-07-08 evening — the batch was answered same-day)

1. Decision forms → **DELIVERED** (`contract/EXP-E0-decision-forms-excerpt.md`, byte-faithful
   lines 77–159, anchor d7b98d5c verified). ⚠ BINDING v0.6 CONSTRAINT: bearings come from
   vendored-libm pinned KAT bits — Show-the-Math must NEVER recompute a bearing via platform
   `Math.atan2`; recompute pure-arithmetic forms only, bearings display the pinned values.
2. F3a campaign manifest → **DELIVERED** (`contract/EXP-F3a-robust-campaign-manifest.FIXTURE.json`
   + PROVENANCE sidecar, sha256 verified) — deliberately the POST-v8 version (plan_id 636c4b4c…)
   so the design fixture doesn't go stale at the bump. Schema = reference-not-guarantee.
   **SUPERSEDED 2026-07-09:** the v9 pinned_variants excerpt vendored at 1367433 replaces
   this v8 fixture (plan_id 636c4b4c, cut pre-bump) as the design source.
3. f2a scene+sensing excerpt → **DELIVERED** (`contract/EXP-F2a-scene-and-sensing-excerpt.md`,
   anchor b4396fd0 verified): sensor pose, half-angle cone, squared-range threshold, closed
   occluder sphere Q, the in-range/in-FOV/LOS conjunction forms + FOV-edge exactness. The
   Sensing Gauntlet's stage body is in hand.
4. F3a seed KAT drop → **DELIVERED-EARLY** (v8-batched): delivered with the v8-refreshed
   F2a/F4 fixtures; Track{mean,P,ν,S} payloads for Belief vs Reality vendored
   (`contract/fixtures/f3a_seed42`, IDENTITY.json verified).
5. Refreshed v8 drops → **DELIVERED** (batched with #4; re-synced this branch at 40a48cc,
   Certus main @ f378e8f, schema v8/s3). POST-V8 RE-SYNC WINDOW consumed.
6. Visual-payload spec for future scenario content → RELAYED (standing; bid-bearing scenarios
   when auction kinds emit).
7. C1 hero-run → **PRE-REGISTERED upstream** (IDEA-c1-hero-run-scenario-observatory-prereg,
   review trigger = C1 scenario design; falsifiability wins any conflict → non-canonical
   second run as the fallback). In the queue before the queue exists.
8. Drop-README v8 refresh → **QUEUED**: the vendored
   `contract/fixtures/README-2026-07-08-drop.md` still narrates the v7 drop (main @ 9cb3e8d,
   schema v7/s3, superseded attempt-ids, no f3a) — their write covers v7 only. Request a
   refreshed upstream README for the v8 evening drops. Local sidecar
   `contract/fixtures/README-v8-drop-note.md` bridges meanwhile (never-patch-in-place).
   Still open at the v0.7 cycle open: the 07-09 drop ships its own v9 README
   (`contract/fixtures/README-2026-07-09-drop.md`) covering that drop only; rides the
   residual send (v0.7 plan gate G2).
9. D4 CERTIFICATION WALL asks → **ANSWERED — ALL THREE DELIVERED 2026-07-09 (1367433)**:
   (a) robust-f3a bundle drop DELIVERED as the **5-seed starter** (seeds 42–46, Certus
   main @ 5ac32c4, schema v9/s4, pinned rustc `--locked`; 3 fresh-process attempts per seed
   byte-identical — D1 held; bundle-verify exit 0 at destination; manifests `dirty: false`);
   the full 50-seed set (seeds 47–91, the aggregate ROBUST/D2 verdict) = standing follow-up
   ask. (b) pins-record excerpt DELIVERED
   (`contract/EXP-F3a-robust-pinned-variants-excerpt.md`, all 50 v9 variants,
   source-blob-anchored). (c) gating-note DELIVERED byte-exact
   (`contract/EXP-F3a-D2-gating-note.FIXTURE.md`, framed hash reproduces a7da0b75 == pins).
   **THE WALL'S EXISTENCE CONDITION IS MET** — the Wall = v0.8 centerpiece per the
   owner-approved v0.7 scope.
10. LONG-GAME (relayed, standing): operation-order-pinned STAT recompute forms (statistical
    acceptance recompute for the Wall) + jammer-ACTIVE F4 scenario authoring (the Contested
    Link's contested version — new upstream scenario work, slow; the lens ships beautiful
    without it).
11. Incident byte-close offer → draft presented to owner 2026-07-09, **awaiting owner send**
    (patch vs their 1b1a3f0, or closed on their word). STILL OPEN at the v0.7 cycle open —
    the 07-09 drop did not close it; rides the residual send (v0.7 plan gate G2).
12. Re-sync window → **REPORT-DELIVERED / HELD ON RELAY #2** (v0.7 T1): the 07-09 drop (1367433) is cut from
    Certus main @ 5ac32c4 at schema **v9/s4**; our `contract/identity.json` pins v8/s3.
    Per the post-v8 precedent the re-sync executes in-cycle, worktree-isolated
    (`chore/contract-resync-v9`), ONE re-sync — the drop-verification report is DELIVERED and
    defined the scope; the v9 flip is ATOMIC across all six published runs, so T1 is HELD pending
    the owner's relay #2 answer (EXPLICIT-CARRY to v0.8-open if unanswered — never a silent drop).
    Committed evidence stays provable without a run (the decoupled publish path).
13. Clean-tree re-drop ask (release-critic ruling 5, UPSTREAM PROPOSAL): all three v8 published
    runs (f2a/f3a/f4) carry `dirty: true` from an upstream build flag, so each spends the
    mismatch `✗` glyph permanently with no caption. Request a clean-tree re-drop, or an upstream
    captioned dirty-flag provenance note, so the `✗` stops reading as a standing false alarm.
    **NEW EVIDENCE 2026-07-09:** the robust-f3a drop's manifests are `dirty: false` —
    clean-tree drops are demonstrably available upstream; the ask stands for the published
    v8 f2a/f3a/f4 families. Rides the residual send (v0.7 plan gate G2).

## OWNER-GATE LEDGER (every decision that waits on the owner)

| Decision | Recommendation | When |
|---|---|---|
| LICENSE | MIT + excerpt carve-out review | before flip / at sitting |
| Flip timing | hold for v0.6 | at/after the 07-12 sitting (G7) |
| README process-depth | own the method hard | with README draft |
| Naming (product + tagline + trace UI name) | tagline = verification; trace ≠ "cone" | sitting + constitution |
| Palette Set 1 (verdict pair + causality token) | per R3 evidence | RESOLVED — Set 1 approved + applied 1daf1e7 |
| §5.3 comms amendment (duet form) | adopt w/ C1-gated weather map | at Contested Link consult |
| §4 fourth-voice amendment (NOT-YET as the echo grammar's 4th voice) | ADOPT — text ready in `consult-t3-selection-grammar.md` (Ruling 1 TIER-3), fable-endorsed | constitution amendment / next owner window |
| Hangar default-run + verdict-headline | fold into Hangar gate | v0.6 (drafted-not-decided; rides the morning list) |
| Residual relay send: #11 byte-close (+ riders #13 clean-tree re-drop, #8 README refresh) | one send closes the queue's open tail; #13 now carries the drop's dirty:false evidence; #11/#13/#8 ride the single send | during v0.7 (G2) — OPEN; nothing in-cycle blocks |
| HOP_DECAY symmetric decay (amends the R3-swatch causal-role tones, §6-class) | approve on before/after frames | v0.7 T3 gate (G4) — OPEN; before/after evidence EXISTS (94bbac8) |
| f2a lens UI naming + identity-language naming | candidates from v0.7 C1(b) | v0.7 T2 gate (G5) — STILL OPEN; ships with defaults (NATO phonetic / 'drone' / 'What the sensor admits'), owner may override at the sitting |
| Authored camera beats ratification (+ e0 vantage swatch TIER-3, iff e0 treated) | before/after pairs | v0.7 T4 gate (G6) — OPEN; before/after pairs exist + the raised-vantage premise now f2a-evidenced |

> **Morning veto list** — 10 items accumulated this cycle (recommended-call-made, marked veto
> in the ledger; defaults ship as-implemented unless the owner vetoes): (1) helix-pulse retire,
> (2) NED-flip ratified, (3) finale close-up excludes the far CLEAR line, (4) tiebreak = textDim
> ring, (5) CONTACT_DIM 0.4→0.25 (bloom physics), (6) opacity-lift kept on evidence, (7) TIER-3
> NOT-YET fourth voice, (8) Hangar default-run, (9) POV aims the theatre centroid, (10)
> ZERO_CLICK_SCOPE. Full detail: the MORNING VETO LIST in `.superpowers/sdd/progress.md`.
>
> The v0.6 release critic **ratifies** (1) helix-pulse retire, (3) finale-CLEAR framing, (4)
> tiebreak ring, (5) CONTACT_DIM, (6) opacity-lift, and (10) ZERO_CLICK first-visit — with the
> RM auto-start flagged for the owner's **explicit blessing** — and **does not ratify-as-final**
> (9) POV-at-centroid (accept as shipped, revisit). Source: `.superpowers/sdd/critic-v06-full.md`
> ruling 7.
