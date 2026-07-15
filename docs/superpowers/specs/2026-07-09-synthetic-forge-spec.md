# SYNTHETIC FORGE — MINIMAL SPEC (design-owed, spec-first)

**Status:** SPEC ONLY — no forge exists, and this document does **not** authorize building one. It
prices the exercise so the owner/plan can decide build-vs-defer with numbers in hand. Per the v0.7
plan rider (`docs/superpowers/plans/2026-07-09-swarm-observatory-v0.7-flight-deepening.md` §2.3 T3,
row 11) and the 2026-07-09 STOP report: row S7 "synthetic forge, minimal subset" was found to have
**no generator, no spec, no scale targets, and no thresholds anywhere in the record** — the row
describes a render-cap PRICING exercise that was never designed. This is that design.
**Pairs with:** the aggregation horizon (`.superpowers/sdd/consult-legibility-miniwave.md` §§1–2,
shipped in v0.7 T3). Cap-pricing and the horizon are the **same economics** — *what may speak at
once, at what scale* — read from the two ends: the horizon caps what is **lit** (the emphasis
budget), the forge prices what is **held in buffers and walked per frame** (the render budget).

---

## 1. WHY — the question the forge answers

The v0.6 perf baseline (`.superpowers/sdd/perf-baseline-v06.md`) measured the six PUBLISHED runs and
found no frame-budget violation: every run sits at 4.6–4.9ms avg / 8.3ms p95 against the 16.7ms
(60fps) work-budget line, e0's selection path costs +4.7% avg with a single at-threshold 25ms frame.
Its own headline names the gap this forge closes:

> "…a render cost dominated by fixed per-frame overhead rather than by per-run entity/event count
> **at this fixture scale (single-digit-to-low-hundreds of entities/events, well under the design
> spec's 'hundreds of entities + thousands of GPU primitives' stress target).**"

So the baseline cannot answer the design spec's actual stress question — it has no fixture large
enough to exercise the caps. The published runs top out at **257 events / 212 entities-worth of
marks** (f3a / f2a). The design spec (`2026-07-04-swarm-observatory-design.md` §8) targets *hundreds
of entities + thousands of GPU primitives at 60fps sustained*. **The forge's sole job is to
manufacture that scale as CONFORMANCE-VALID fixtures**, so the caps below can be priced honestly
before real campaign content forces the question.

The horizon (T3) makes this urgent-but-bounded, not an emergency: it caps the LIT set at ≤7 lines
regardless of run size (§3.A below), so the wash is an O(1)-in-N cost. What remains O(N) is the
buffer allocation and the per-frame scene-graph walk (§3.B–D). The forge prices exactly those.

## 2. THE GENERATOR — shape (spec, not code)

A pure function `forgeRun(params) → RunBundle` producing a bundle **byte-compatible with the real
decode path** (`src/decode/decodeBundle.ts` — the same envelope, event-kind, and trailer format the
published fixtures use), so a forged run loads through the identical `useRun → decodeBundle →
RunModel` pipeline with zero app changes and appears as an extra `?run=` id (never shipped; a
`fixtures/forge/` dev-only tree, git-ignored or excerpt-gated).

Parameters (the pricing knobs — each maps to a cap in §3):

| Param | Meaning | Prices |
|---|---|---|
| `events: N` | total event count | instanced-mesh capacity (= eventCount), decode/heap |
| `chainDepth: D` | causation-chain length (linear, e0-style hash chain, parent = seq−1) | the horizon neighborhood + timeline arcs |
| `fanout: F` | children per causation node (F=1 ⇒ linear; F>1 ⇒ a branching DAG) | `causalHops` BFS cost, cross-entity `ChainLinks` (MAX_LINKS=256) |
| `queryDensity: q` | fraction of events that are kind-23 query draws (lines+contacts) | the QueryStage line/contact/badge buffers + the per-tick rewrite window |
| `entities: E` | distinct namespace-1 subjects (drives cross-entity links) | `ChainLinks` cap, lane/timeline density |
| `ticks: T` | playhead length (reveal clock span) | scrub-to-render, the O(changed) tick rewrite |

Determinism: seeded, pure, and **reproducible byte-for-byte** across processes (the same discipline
the real KAT drops hold — `--locked`, no wall-clock, no float nondeterminism in the generator).

## 3. THE CAP TARGETS TO PRICE (what the forge stresses)

Each target is a real constant/allocation in the shipped renderer. The forge exists to find the N/D
at which each stops being free. Read the SOURCE column against the running code, not this doc.

| # | Cap | Source | O(·) | What forge measures |
|---|---|---|---|---|
| **A** | **Emphasis budget — LIT set ≤ 2·HORIZON_HOPS+1 = 7 lines** | `chain.ts HORIZON_HOPS`; `queryStageView.tsx selectedLineColor`/`ROLE_BY_HOP`/`LINE_AMBIENT_YIELD` | **O(1) in N** | that the lit (blooming) line count stays ≤7 at ANY N/D — the horizon's core promise; a LEGIBILITY threshold, not perf |
| **B** | **Line/contact/badge instance capacity = `eventCount`** | `queryStageView.tsx` `<instancedMesh args={[…, eventCount]}>` (×3) | O(N) buffers | GPU buffer bytes + upload cost as N → thousands; the full-prefix packing under selection is O(N) held even though ≤7 are lit |
| **C** | **Per-tick rewrite window** (unselected: `LINE_FADE_TICKS`=6; selected: the trailing window + append) | `queryStageView.tsx` line pass | O(changed), **not** O(revealed) | that the tick-advance rewrite stays bounded (window + appends) as N/D grow — the §8 claim, priced |
| **D** | **Cross-entity causal links — `MAX_LINKS = 256`** | `chainLinks.tsx` (drops + warns beyond) | O(min(chain, 256)) | at what E/fanout the 256 cap actually clips (today unreachable — the published max chain is e0's linear 74; f2a/f4 have ≤1-hop chains) |
| **E** | **Timeline bounded arcs ≤ 2·HORIZON_HOPS = 6** | `chain.ts chainTicks` | O(1) in N | that the overlay stays a local stitch (not a comb) at any D — the horizon on the 2D surface |
| **F** | **`causalHops` BFS build on the selection edge** | `chain.ts causalHops` | O(chain) once per select | that the hop-map build cost stays off the tick path (rebuilt only on the selection edge) as D/fanout grow |

## 4. THE ROUND-TRIP GATE (what makes a forged run legitimate)

A forged bundle is only admissible if it survives the SAME conformance path the published fixtures do
— otherwise the perf numbers are measured against a fiction:

1. **Encode → decode identity:** `decodeBundle(forgeRun(p))` succeeds and the decoded `RunModel`
   round-trips the generator's declared event count, kinds, causation, and ticks (no silent drops).
2. **Trailer verify:** the forged bundle carries a self-consistent trailer that passes the app's
   existing `verify` path (`src/decode/verify.test.ts`) — a forged run wears the same
   "self-verified · no external oracle" provenance a det-only run wears; it must NEVER claim a
   recomputed/attested status it did not earn (LAW-4 honesty — a synthetic run is honestly synthetic).
3. **No conformance regression:** adding the forge module leaves the conformance suite (81) green;
   forged fixtures live OUTSIDE the published `contract/fixtures/` set the conformance count pins.

## 5. PASS / FAIL THRESHOLDS

Priced against the design spec §8 targets and the v0.6 baseline. "Pass" = the cap is proven free at
the target scale; "fail" = the cap needs a mitigation (the §6 decision gate fires).

| Metric | Target (design §8 / baseline) | Fail trigger |
|---|---|---|
| Frame time, sustained | p95 ≤ 16.6ms at **N ≈ hundreds of entities + thousands of primitives**, incl. selection active + 8× | p95 > 16.6ms sustained (a pattern, not one frame) at the target scale |
| Emphasis budget (cap A) | LIT line count = ≤7 at EVERY tested N/D | any tested frame lights > 7 lines (a horizon regression) |
| Timeline arcs (cap E) | ≤ 2·HORIZON_HOPS at every D | any selection draws > 2·HORIZON_HOPS arcs, or an arc endpoint that is not a member |
| Tick-rewrite cost (cap C) | per-tick line writes bounded by (window + appends), independent of N | per-tick writes scale with N (an O(revealed) regression) |
| Scrub-to-render | ≤ 100ms at target scale | > 100ms |
| Load-to-interactive | ≤ 3s decode+verify+ceremony at target N | > 3s attributable to decode/build (not network) |
| Heap | no growth across repeated select/deselect at target N | monotonic growth (a leak) |

## 6. BUILD-VS-DEFER DECISION GATE (the spec-first discipline)

**Build the minimal generator ONLY if this spec prices it small.** The estimate:

- **Small (build it):** a pure `forgeRun` that emits linear-chain kind-23 query runs (caps A/B/C/E/F
  — everything except cross-entity links) is a **single module + one round-trip test**, because it
  reuses the existing envelope/decode format and needs no new app surface (it appears as a `?run=`
  id). This is the recommended minimal cut — it prices the five caps that the horizon directly
  governs, which is the whole reason the forge pairs with T3.
- **Not small (defer):** cross-entity DAG generation (cap D, `MAX_LINKS`) requires modelling
  multi-subject causation and pose trajectories — a materially larger generator, and cap D is
  **provably unreachable on today's data** (empirical finding, v0.7 T3 browser pass: f2a has zero
  causation edges, f4's deepest chain is 1 hop; only e0's degenerate linear chain exceeds the
  horizon at all). Defer cap D until real campaign/C1 cross-entity content exists to size it against.

**Recommendation:** author the small cut (caps A/B/C/E/F, linear only) as a follow-up task when the
ladder has room; hold cap D behind the C1 cross-entity content gate. Until then this spec IS the
deliverable — the row is design-owed, and the design is now on the record with targets and
thresholds a future implementer can execute against without re-inventing the question.

---

**Governance:** spec-only; zero source changed by this document. Supersedes the S7 row's prior
under-specified "price the spine/query caps" one-liner. The cap constants named above
(`HORIZON_HOPS`, `LINE_FADE_TICKS`, `MAX_LINKS`, the `eventCount` instance capacities) are the
single source of truth — this doc references them, never re-states their values as forkable copies.
