# v0.7 — THE FLIGHT DEEPENING (plan of record)

**Status:** APPROVED — the owner confirmed scope (b) at the 2026-07-09 cycle-open gate
("looks good, continue"): flight-run deepening + un-park the legibility horizon + parallel
flip-prep. This document finalizes the cycle-open DRAFT and is the v0.7 plan of record.
**Base:** main @ `11a5cca` — capture rung 2 merged (5 review rounds); the v9-certified
robust-f3a drop vendored at `1367433`; CI green.
**Branch:** `dev/v0.7` (sole-writer discipline; opus + codex every task; four-gate endgame).
**Governance:** bound by the LENS CONSTITUTION
(`docs/superpowers/specs/2026-07-08-lens-constitution.md`) incl. the §4 NOT-YET fourth
voice. Items pulled from `docs/superpowers/ROADMAP.md` per the anti-forgetting protocol
(clause 1); every pulled row named in §2.1, every deliberately not-pulled row in §2.2; the
cycle-open ROADMAP sync rides this branch as its own docs commit.
**Authoritative design sources (read, don't restate):**
`.superpowers/sdd/consult-legibility-miniwave.md` — **the design-of-record for T3 (the
horizon) and the brief-source for T4 (§4.2)**;
`.superpowers/sdd/consult-d4-certification-wall.md` (the Wall's design-of-record, v0.8);
`contract/EXP-F2a-scene-and-sensing-excerpt.md` (the sensing lens's stage body, delivered);
`docs/capture.md` (the capture ladder: rung-2 boundary, rung-3 visual-delta-seam spec, the
flip GIF regeneration ritual);
`.superpowers/sdd/perf-baseline-v06.md` (clean baseline, all six runs);
`.superpowers/sdd/critic-v06-full.md` (SHIP-WITH-NOTES rulings).

---

## §0 — WHAT CHANGED BETWEEN DRAFT AND FINAL (the reality delta)

1. **The scope question is DECIDED:** scope (b), with (c)'s engineering as the T7 parallel
   track. Gate G1 closed.
2. **The relay was ANSWERED:** `1367433` on main vendored the v9-certified robust-f3a KAT
   drop — asks **#9a (as the 5-seed starter, seeds 42–46), #9b (pins excerpt), and #9c
   (gating note) are DELIVERED**. The Wall's existence condition is **MET**. The Wall stays
   v0.8 per the approved scope — but it is now a v0.8 centerpiece with real bytes and a
   finished design half: an execution cycle, not an invention.
3. **A V8→V9 CONTRACT RE-SYNC is due:** the drop is cut from Certus main @ `5ac32c4` at
   event/state schema **v9/s4**; our `contract/identity.json` pins **v8/s3**. Per the
   post-v8 precedent (`40a48cc`: re-sync executes in-cycle, worktree-isolated, ONE re-sync)
   this lands as **T1**, gated on the drop-verification agent's report (in flight at cycle
   open — its report defines the re-sync scope; this plan does not pre-empt it).
4. **Capture rung 2 is MERGED** (`11a5cca`) — T0 sheds the merge item. The **rung-3 visual
   delta seam** becomes a named roadmap row (spec: `docs/capture.md` §"Rung 3"); T7's claim
   language must respect the rung-2 boundary (§2.3 T7).
5. **The residual relay queue** (kept accurate): **#11 byte-close**, **#8 drop-README v8
   refresh**, and **#13 clean-tree re-drop** remain open. New evidence for #13: the 07-09
   drop's manifests are `dirty: false` — clean drops are demonstrably available upstream.

---

## §1 — THE SCOPE DECISION (record; the full argument lives in the DRAFT's §1)

Three centerpiece candidates were weighed: **(a) the Certification Wall** — design complete
but, at draft time, zero acquirable robust targets; **(b) the flight-run experience
deepening** — zero unsent upstream dependencies, the direct answer to the owner's own
morning verdicts, fires the second-lens registry gate; **(c) the flip cycle** — half
engineering-days, half owner-gated sitting decisions.

**DECIDED: (b) as the centerpiece, (c)'s engineering as the bounded T7 parallel track
delivering before the 07-12 sitting.** Post-decision reality upgraded (a)'s position
rather than weakening the choice: the robust drop landed (`1367433`), so the Wall's
existence condition is met — it holds **v0.8** with real bytes waiting, exactly the "flip
from strength / build when it can actually verify" sequencing the recommendation argued.

---

## §2 — THE SCOPE: LADDER, RIDERS, GATES, ENDGAME

### §2.1 Pulled rows (anti-forgetting protocol — each named, source, destination)

| # | Roadmap row (verbatim identity) | Source | Status at pull | Lands in |
|---|---|---|---|---|
| 1 | SENSING GAUNTLET: f2a lens (eligible-tinted trail + four-gate instrument strip) | D2 | CARRIED — MUST NOT DIE SILENTLY; its trigger ("re-trigger at the next cycle open as a first-class lens task") fires HERE | **T2 (centerpiece)** |
| 2 | THE WHY WASH / aggregation horizon (critic R1; constitution Part I.E/III.7 shipped unenforced) | critic R1 | NEXT; un-park **APPROVED with the scope** (G3 closed); design-of-record = `consult-legibility-miniwave.md` §§1–2 | **T3** |
| 3 | Tour authored camera for beats 5–6 (critic R2; "the mechanism exists, §8-clean") | critic R2 | NEXT; §4.2 brief ready in the miniwave consult | **T4** (generalized to the f1 hero + f2a) |
| 4 | Hangar histogram kind NAMES | critic R4 | NEXT | **T5** |
| 5 | Thesis card collapse-to-header-chip | critic R6 | NEXT | **T5** |
| 6 | Entity identity language DESIGN (callsigns, glyph taxonomy, identity plates) | G19 | PLANNED ("must precede C1 content"); owner's "which one is the drone" is this row's evidence | **C1 consult** |
| 7 | STANDING RULE: lens-registry provenance metadata decided at registry design time — BEFORE comms/f2a lenses build | U11/S5 | standing; binding on T2's start | **C1 consult** |
| 8 | Lens registry extraction (from two live lenses) + ask-any-pixel metadata | S5/U11 | GATED(second lens shipped) — the gate FIRES when T2 ships | **T6** (or explicit-carry with gate-satisfied note) |
| 9 | Capture rung 2: fixed-dt capture clock | S3 | **SHIPPED** (built `cdf1614`, merged `11a5cca` after a 5-round review closure; playhead-timeline determinism proven; `?capture=` never emitted by encodeLink; speed-independent pacing) | done pre-cycle; **T7 consumes** (GIF ritual, `docs/capture.md`) |
| 10 | Frame-budget baseline capture | S6 | CARRIED → **DONE** (`perf-baseline-v06.md`: all six runs clean vs the 16.7ms budget; e0 wash path +4.7% avg / max exactly at threshold, no degradation at 8× — heavier-but-in-budget) | roadmap flip at the cycle-open sync; ritual re-run at **endgame** |
| 11 | Synthetic forge, minimal subset ("price the spine/query caps") | S7 | CARRIED → **RECHARACTERIZED DESIGN-OWED** (STOP report 2026-07-09: no generator, no spec, no scale targets, no thresholds exist anywhere in the record; the row describes a render-cap PRICING exercise never designed; the fuzz-harness reading was a conflation) | **T3 rider** (SPEC-FIRST; pairs with the horizon — both are emphasis-budget economics) |
| 12 | Capture pipeline rung 1: provenance-stamped stills | S3/P3 | **PREMISE CORRECTED** (rung 1 never existed as code — rung-2 disclosure; the README-GIF need is served by rung-2 captures) | row relabeled at the sync; GIF work in **T7** |
| 13 | Pre-flip deploy rehearsal (Pages dry-run) | P-inv | PLANNED(pre-flip) | **T7** |
| 14 | README hero GIF: regenerate-at-flip-from-f1 (placeholder currently library-tier, honestly labeled) | P1 | SHIPPED-DRAFT rider | **T7** |
| 15 | Debt: duplicate runs/index.json fetch (one-line) | S-cut | open | **T0** |
| 16 | Debt: eventsByTick `?? []` → EMPTY const | S-cut | open | **T0** |
| 17 | Debt: stale-dist smoke footgun (build step / dist-freshness in the smoke path) | T5b merge-verify | open — already burned one merge-verify (17/19 illusion) | **T0** |
| 18 | Debt: legend mark-swatch multi-kind pass | T1 carry | TRIGGER-FIRED at f1's 2-lane fan-out; f2a fans wider | **T2 rider** |
| 19 | Debt: mount-time missed-rising-edge establish race (I-1) | v0.5d T3 | open; requires TDD + deterministic repro + scoped review (opus blast-radius ruling) | **T4 rider** (same camera neighborhood) |
| 20 | Debt: copy-link permanent home (card-only today) | T6 deviation | open | **T5** |
| 21 | Debt: critic cosmetic nits (attested-note wrap; empty-state voices) | v0.5d critic | open | **T5**, opportunistic |
| 22 | **V8→V9 CONTRACT RE-SYNC** (identity.json v8/s3 → drop schema v9/s4) | relay #12 / contract law | window **OPENED by `1367433`**; post-v8 precedent: in-cycle, worktree-isolated, ONE re-sync | **T1** (gated: drop-verification report) |

### §2.2 Deliberately NOT pulled (named so nothing dies silently)

- **The Wall (D4)** and the whole campaign suite — sibling pipeline (S2-cliff),
  import-and-verify workbench (S2), diff kernel (S1a), ghost overlay (S1b), A/B split
  (S1c), compare mode, evidence-DAG navigator, command palette (G16): **re-targeted v0.8
  at the sync** — the existence condition is now MET (`1367433`), so v0.8 opens with real
  bytes and a finished design half. **Raw event table (G17, "nearly free," constitutional
  instrument): stretch-rider only** — pull iff the ladder runs ahead of schedule.
- **The 50-seed robust full set (seeds 47–91)** — the aggregate ROBUST/D2 verdict's data.
  The 5-seed starter meets the Wall's existence condition; the full set is a standing
  follow-up ask on the relay (noted under #9's DELIVERED status). Not this cycle's pull.
- **Capture rung 3 — the VISUAL DELTA SEAM** (`docs/capture.md` §"Rung 3": capture-aware
  delta through the r3f frame loop — camera easing, finale ring, predictive lead; proven by
  a camera-state cross-jitter digest): **named roadmap row, NOT built this cycle.**
  Trigger: before any cross-machine motion-frame bit-identity claim, and no later than the
  WebCodecs tour-clip rung. T7 claims stay inside the rung-2 boundary.
- Frame-budget harness → **CI gating** (S6): needs a runner story; the endgame re-runs the
  baseline RITUAL (trend-not-gate) instead. Carry with trigger.
- Raycast BVH + columnar entity maps (S-cliffs): gated on ≥1k/≥5k content — no such
  content in this scope.
- Debts left with their triggers: decode cancellation (owned by the campaign
  persistent-worker protocol per its own text), pausedMidRun helper (iff gate touched),
  tour-start stamp-swallow (humanly unreachable), single-source CSS generation, updateRange
  GPU cut + heat-click affordance (e0/query-stage tier — baseline shows no urgency), temp
  hygiene (opportunistic, no-commit).
- Legibility spec §§5–6 (e0 identity chip copy, tiebreak Saturn rings): **stay parked with
  e0's demotion** (the G3 un-park re-activates §§1–2 only) — library-tier polish, pulled
  only if an e0 pass happens anyway.

### §2.3 The ladder (branch `dev/v0.7`; opus + codex every task; four-gate endgame)

**T0 — Open riders (first act, small, parallel).** Land debts #15/16/17 — the smoke path
gains a dist-freshness guarantee before this cycle's smoke growth. (The draft's other two
T0 items are already done at cycle open: rung 2 merged at `11a5cca`; the roadmap sync
commit rides this branch.)

**T1 — THE V8→V9 CONTRACT RE-SYNC (early task; worktree ritual; GATED).** The 07-09 drop
(`1367433`) is cut from Certus main @ `5ac32c4` at event/state schema **v9/s4**; our
`contract/identity.json` pins **v8/s3** (registry hashes b2b948d6… / dbf939ee…). Per
contract law and the post-v8 precedent (`40a48cc`: ONE re-sync, no version churn), the
re-sync executes in-cycle: branch `chore/contract-resync-v9` in its **own worktree**,
merged into `dev/v0.7` at its gate (single integration point; the isolation preserves
sole-writer discipline). **GATE: the drop-verification agent's report — in flight at cycle
open — DEFINES the re-sync scope**: destination verify status of the vendored v9 bundles,
the v8/s3→v9/s4 registry-hash surface, the decode-path delta, and whether the published v8
run families are touched (or a refreshed-drop ask joins the relay). T1's brief is written
FROM that report; this plan does not pre-empt it. Sequencing: nothing on T2–T5 consumes v9
bytes (the f2a lens builds on the delivered excerpt + the published v8 run), so T1
parallelizes with the centerpiece — but T1 must land before any surface consumes the
vendored v9 fixtures, and the D1 "re-run the decode probe first" rider is noted in T1's
brief so it doesn't silently wait for v0.9.

**C1 — Twin design consults (parallel with T0/T1; BOTH bind T2's start).**
(a) **Registry provenance metadata** (standing rule U11/S5): decide the ask-any-pixel
metadata shape a lens registers — before the second lens builds, exactly as the rule
demands. Arch-lead + design-lead, short.
(b) **Entity identity language** (G19): callsigns, glyph taxonomy, identity plates — the
system that answers "which one is the drone" everywhere, designed once so f2a (and every
C1 lens) doesn't pay migration tax. Naming candidates → owner gate G5.

**T2 — THE SENSING GAUNTLET (the centerpiece).** The f2a lens per D2, grounded
byte-for-byte in `EXP-F2a-scene-and-sensing-excerpt.md` (sensor pose, half-angle cone,
squared-range threshold, occluder sphere Q, the in-range/in-FOV/LOS conjunction + FOV-edge
exactness). Stage voice = eligible-tinted trail; instrument voice = the four-gate strip
(LAW 3 split stated in-code). **Files the LAW-4 declaration** (question Q1/Q4-adjacent
"what does the sensor admit?", surface split, borrowed hues only — LAW 2, what it dims,
honest empty state). NOT-YET compliance: any recorded-but-unwritten sensing state renders
in the fourth voice (hollow, never blooming). Ships with its **60-second tour** (standing
rule; holds sized as FULL reading windows per the §5 RM rider — the f1 hero-switch
precedent). Riders: timeline kind-lane/legend multi-kind pass (debt #18); registry
provenance metadata registered per C1(a). Naming of the lens in UI = owner gate G5.
Provenance-surface note: the published f2a family still carries the upstream `dirty: true`
✗ (relay #13, open) — the lens ships regardless; do not caption around it in-app.

**T3 — THE HORIZON (the why-wash mechanism, generic).** Implements
**`consult-legibility-miniwave.md` §§1–2 — the design-of-record** — plus §1.4:
`HORIZON_HOPS = 3` exported from `chain.ts`, consumed by stage AND timeline;
`HOP_DECAY [1.0, 0.65, 0.4]` direction-blind (owner gate G4 on before/after frames);
`LINE_AMBIENT_YIELD 0.3`; chainmeta chip ("74 up · 0 down · nearest 3 shown"); bounded
arcs (both endpoints members). Selection becomes a lens held over the rest state — the
constitution's own aggregate-beyond-horizon rule finally enforced. Generic by
construction: timeline arcs on every run, stage law wherever a causal lens exists; e0
benefits at library tier for free. Proof obligations = the spec's eight pinned tests +
before/after frames (hairball ev39, post-tour rest, ghost ignition). Perf framing per the
baseline: design debt, not a perf emergency (+4.7% avg / at-threshold max, in budget).
**Rider (S7, recharacterized): the forge SPEC — DESIGN-OWED, spec-first** — generator
shape, the spine/query cap targets to price, the round-trip gate, pass/fail thresholds;
build the minimal generator only if the spec prices it small. Cap-pricing and the horizon
are the same economics: what may speak at once, at what scale.

**T4 — THE AUTHORED CAMERA.** Per-beat framing intent through the tour step schema — the
tourEngine constraint that froze this in v0.6 was that wave's discipline, not law; it
lifts here by plan. Brief = the miniwave consult §4.2. Shot-author the **f1 hero tour
first** (the front door), then f2a's new tour natively; e0's beats 5–6 (Act III arrive,
finale framing) treated at library tier iff cheap, else docketed with the parked spec.
Authored against post-T2/T3 frames (the consult's craft-order ruling: never author shots
against dead frames). RM = cut, per-beat holds keep the §5 rider. Rider: I-1 mount-race
debt (#19) under its stated TDD-with-deterministic-repro protocol. Gate evidence:
before/after per authored beat → owner gate G6.

**T5 — FRONT-DOOR POLISH.** R4 histogram kind NAMES (the front door stops showing unnamed
integers); R6 thesis-card collapse-to-header-chip once beat 1 starts; copy-link permanent
home in app chrome (#20); cosmetic nits opportunistic (#21).

**T6 — LENS REGISTRY EXTRACTION (gate fires at T2-shipped).** Extract the registry from
two live lenses (query stage + sensing gauntlet) carrying the C1(a) provenance metadata.
If the cycle is long by here: explicit-carry to v0.8-open with a gate-satisfied note —
never a silent drop.

**T7 — FLIP-PREP PARALLEL TRACK (delivers BEFORE the 07-12 sitting; independent of the
ladder).** Pages deploy dry-run (rehearsal only, no flip). Hero GIF regenerated **from f1**
via the merged rung-2 capture clock, following the `docs/capture.md` flip regeneration
ritual (`?capture=<fps>`; ANGLE SwiftShader pixels) — retiring the library-tier placeholder
per the README's own regenerate-at-flip instruction. **Claim-language rider:** every
reproducibility claim in README/sitting-brief respects the rung-2 boundary — playhead
timeline + hold frames bit-stable anywhere; eased-motion frames reproduce same-machine
until the rung-3 visual delta seam lands (its named row is the honest ceiling). README
badge slot readiness confirmed (conformance already green on main — activation is a
one-line uncomment at flip). LICENSE file prepared-not-committed (MIT + excerpt carve-out,
per the standing recommendation). Output: **the sitting brief** — flip rec, naming input
(tagline carries verification), process-depth rec (own the method hard), all standing
owner gates in one page.

**ENDGAME — the v0.6 four-gate pattern, now house standard.** (1) clean-room (fresh
worktree, first-attempt discipline); (2) codex whole-branch (cross-task classes); (3)
fable brief with ROADMAP-SYNC clause-2 list (T2 SHIPPED fires the registry-gate note;
carried rows relabeled; relay-state note — incl. whether T1's report added asks); (4)
**full experiential release critic** — the founding-sentence test runs against the f1 cold
open + the sensing gauntlet, judged explicitly against constitution §1–5 and T2's LAW-4
declaration. Plus: perf RITUAL re-run diffed against `perf-baseline-v06.md`
(trend-not-gate); gate evidence set = authored-beat before/afters, horizon before/afters,
f2a lens frames, capture-clock GIF assets. Merge and push on the owner's word, per the
standing boundary.

### §2.4 Owner gates (decided ones recorded; open ones in gate order)

| Gate | Decision | State / prepared recommendation |
|---|---|---|
| G1 | THE SCOPE QUESTION | **DECIDED 2026-07-09: scope (b) + T7 parallel** |
| G2 | Residual relay send: **#11 byte-close** (+ riders: #13 clean-tree re-drop, #8 README refresh) | OPEN — nothing in-cycle blocks on it; #13 now carries the `dirty:false` evidence from the 07-09 drop; one send closes the queue's open tail |
| G3 | Un-park the legibility horizon (§§1–2 only; e0 §§5–6 stay parked) | **DECIDED 2026-07-09 — approved with the scope** |
| G4 | HOP_DECAY symmetric decay (amends the R3-swatch causal-role tones — §6-class value change; consult §2.2 flagged-not-smuggled) | approve on before/after frames at the T3 gate |
| G5 | f2a lens UI naming + tour copy; identity-language naming (constitution reserves naming to the owner) | candidates from C1(b) at the T2 gate |
| G6 | Authored camera beats ratification (+ the e0 raised-elevation vantage swatch, TIER-3, only if e0 gets treated in T4) | before/after pairs at the T4 gate |
| G7 | The sitting (07-12, standing gates): LICENSE, flip timing, README process-depth, naming/tagline | the T7 sitting brief carries all four |
| — | T1 re-sync merge (`chore/contract-resync-v9` → `dev/v0.7`) | rides the standing merge-on-the-owner's-word boundary, presented with the verification report + green gates |

Standing/carried gates not re-opened here: POV-at-centroid revisit (e0-tier,
accept-as-shipped stands), Hangar default-run + verdict-headline (shipped drafts stand
unless vetoed), the morning veto list (defaults ship as-implemented).

---

## §3 — THE UPSTREAM RELAY STATE AT CYCLE OPEN (post-`1367433`; queue kept accurate)

| Ask | State at cycle open | Notes |
|---|---|---|
| **#9a robust-f3a bundle drop** | **DELIVERED** (`1367433`) as the **5-seed starter** (seeds 42–46; Certus main @ `5ac32c4`, schema v9/s4, pinned rustc `--locked`; 3 fresh-process attempts per seed byte-identical — D1 held; bundle-verify exit 0 at destination; manifests `dirty: false`) | The Wall's existence condition is **MET**. Full 50-seed set (seeds 47–91, the aggregate ROBUST/D2 verdict) = standing follow-up ask. D2 = Gated until then. |
| **#9b pins-record excerpt** | **DELIVERED** (`contract/EXP-F3a-robust-pinned-variants-excerpt.md` — all 50 v9 variants, source-blob-anchored) | SUPERSEDES the stale v8 `EXP-F3a-robust-campaign-manifest.FIXTURE.json` (plan_id 636c4b4c, cut pre-bump). |
| **#9c gating-note text** | **DELIVERED** byte-exact (`contract/EXP-F3a-D2-gating-note.FIXTURE.md`; framed hash reproduces `a7da0b75` == pins) | The skeptic ladder's one genuinely recomputed DOCUMENT row is now real. |
| **#11 incident byte-close offer** | OPEN — still awaiting owner send | Nothing in-app blocks; rides the residual send (G2). |
| **#13 clean-tree re-drop** | OPEN | **New evidence:** the 07-09 drop is `dirty: false` — clean drops are demonstrably available. The ask stands for the published v8 f2a/f3a/f4 families whose uncaptioned ✗ persists. Rides G2. |
| **#8 drop-README v8 refresh** | OPEN | The 07-09 drop ships its own v9 README (`contract/fixtures/README-2026-07-09-drop.md`) covering that drop only; the v8 evening-drop README remains v7-narrated. Docs-plane; rides G2. |
| **#12 re-sync window** | **OPEN → CONSUMED BY v0.7 T1** | The drop is v9/s4 from `5ac32c4`; our pin is v8/s3. Post-v8 precedent: in-cycle, worktree-isolated, ONE re-sync. Scope defined by the drop-verification report (in flight). |
| #10 long-game (stat recompute forms + jammer-ACTIVE F4) | relayed, standing | The 50-seed follow-up (seeds 47–91) joins this standing list's cadence — the Wall's verdict-grade endgame, not its existence. |
| #7 C1 hero-run pre-registration | pre-registered | C1-era only. |

**Bottom line:** the scope decision's premise held and then improved — (b) was blocked by
nothing, and now (a)'s blocker fell too. v0.8 inherits a Wall with real bytes and a
finished design. The 5-seed starter would even permit a Wall-seed acquisition spike as a
stretch — the plan still does not bet v0.7 on it (the approved scope stands).

---

## §4 — ENDGAME SHAPE (summary)

Branch `dev/v0.7` off main `11a5cca` → T0/T1/C1 parallel open (T1 gated on the
drop-verification report) → T2 centerpiece → T3 → T4 → T5 → T6 (or explicit-carry) with T7
delivering the sitting brief before 07-12 → four-gate endgame (clean-room / codex
whole-branch / fable ROADMAP-SYNC / experiential release critic judging the f1 cold open +
the second lens against the constitution) → perf ritual re-run vs baseline → merge on the
owner's word. Success sentence for the release critic: *a cold staff engineer opens the
app, watches a real drone fly a tour whose camera was composed on purpose, opens the
sensing lens and sees exactly what the sensor admitted and why, and never once catches the
app claiming more than it recomputed.*
