# v0.8 — "THE WALL, IN PUBLIC" (plan of record)

**Status:** APPROVED — the owner approved SCOPE AS FILED at the 2026-07-15 cycle-open gate,
on the filed defaults (G-1 scope; G-2 public flip, scrub-conditional; G-3 Bucket B; G-4
LICENSE — see §4). This document finalizes the `plan-v08-candidate.md` synthesis — the
CANDIDATE / pre-owner-approval framing is retired — and is the v0.8 plan of record.
**Base:** main @ `766981b` — the atomic v9/s4 contract resync landed (T1 closes: all six
published runs flip v8/s3 → v9/s4 in one merge with `contract/identity.json`; f2a/f3a/f4
regenerated as certified KAT drops at the re-derived v9 pin, e0/f0/f1 re-vendored from
committed goldens; gates at merge: lint 0 / tsc 0 / 1112 unit / 88 conformance / 28 smoke /
build clean). Relay #2 Bucket A (the atomic six-run flip) is COMPLETE; Bucket B (the 50-seed
robust sidecar) is RUNNING, deferred to this cycle's Wall per G-3.
**Branch:** `dev/v0.8` (sole-writer discipline; opus + codex every task; four-gate endgame —
house standard since v0.6).
**Governance:** bound by the LENS CONSTITUTION
(`docs/superpowers/specs/2026-07-08-lens-constitution.md`). Items pulled from
`docs/superpowers/ROADMAP.md` per the anti-forgetting protocol (clause 1); the cycle-open
ROADMAP sync rides this same branch as its own docs commit (the T1 flip + the v0.8 cycle
section).
**Authoritative design sources (read, don't restate):**
`.superpowers/sdd/plan-v08-candidate.md` — the pre-approval ladder synthesis this document
supersedes;
`.superpowers/sdd/consult-v08-arch.md` / `-portfolio.md` / `-design.md` — the three
cycle-open consults the candidate synthesized;
`.superpowers/sdd/consult-d4-certification-wall.md` — the Wall's design-of-record (v0.7
carry, existence condition MET `1367433`);
`.superpowers/sdd/sitting-brief-2026-07-12.md` + `.superpowers/sdd/license-draft-for-sitting.md`
— the filed defaults G-2 and G-4 resolve against;
`contract/fixtures/README-2026-07-15-v9-resync.md` — the T1 resync's own drop note.

---

## §0 — WHAT CHANGED BETWEEN CANDIDATE AND OPEN (the reality delta)

1. **G-1 SCOPE is DECIDED:** the owner approved the ladder as filed — no wave was added, cut,
   or reordered at open. The three bench verdicts (portfolio UNDERSOLD / arch EVOLVE / design
   NEEDS-DIRECTION-given) stand as the ladder's rationale unchanged (§1).
2. **T1 landed, closing the window the candidate opened against:** the atomic v9/s4 resync
   merged at `766981b` (main). Relay #2's Bucket A (the six-run atomic flip) is COMPLETE;
   Bucket B (the 50-seed robust sidecar, seeds 47–91) is RUNNING — G-3 approved it outright
   rather than leaving it the candidate's "day-one owner-side ask" framing. This cycle's Wall
   (W5) builds against the vendored 5-seed set now and upgrades to the 50-seed aggregate when
   Bucket B lands.
3. **G-2 (the flip word) is RESOLVED, scrub-conditional:** the public Pages flip is approved.
   W0 executes a clean scrub of the published runs' `dirty: true` provenance flag (relay #13)
   tonight; a clean result flips; a blocker holds W0 to "prep only" (dry-run + assets staged,
   no publish) with a morning flag to the owner — never a silent slip either way.
4. **G-4 (LICENSE) is RESOLVED:** MIT at root + `contract/` carve-out, per the
   `sitting-brief-2026-07-12.md` filed defaults; drafts are already prepared
   (`license-draft-for-sitting.md`). W0 commits the file — no new deliberation.

---

## §1 — THE SCOPE DECISION (record)

Three cycle-open consults converged on one story — go public early, then earn the
Certification Wall on real bytes, with the type-level rigor landing exactly where it makes
the Wall cheaper:

- **portfolio: UNDERSOLD** — flip Pages public WEEK ONE (staleness is pure loss; the v9 clean
  re-drop retired the dirty-flag objection at Bucket A); Wall = launch beat 2; new
  must-have: the TAMPER MOMENT (flip one byte, watch it fail).
- **arch: EVOLVE** — A3 branded ticks first (kills the thrice-recurred bug class, days-small,
  runtime-erased), then I5 (two surfaces disagree about the causal neighborhood TODAY —
  honesty-tier), then A1 witness union (echo unrepresentable, CUT the interpreter), then the
  campaign spine that IS the Wall's load-bearing half.
- **design: NEEDS-DIRECTION (given)** — voice system AT CEILING, FREEZE + one-source VOICES
  module BEFORE any Wall pixel (real drift cited: three attested tokens across four
  surfaces); Wall north star = "opens by declaring what it has NOT verified"; e0 gets its
  three authored shots (authoring cost only).

**DECIDED 2026-07-15: scope approved as filed (G-1).** No candidate wave was added, cut, or
reordered at open; §2's ladder is the approved ladder, structurally verbatim from the
candidate synthesis.

---

## §2 — THE LADDER (approved)

| # | Wave | Contents | Source | Status at open |
|---|------|----------|--------|-----------------|
| W0 | FLIP-PREP polish (week 1, no feature budget) | README counts truth-fix (894→1111/88/28 drift), ARCHITECTURE.md + public process receipts, LICENSE (MIT + `contract/` carve-out, G-4), the Pages flip itself | portfolio 1/6/9 | **IN-FLIGHT tonight, scrub-conditional** (G-2: a clean scrub → flip; a blocker → prep-only + morning flag) |
| W0' | parallel: A3 branded ticks | EventTick/StateFrame/TransportTick brands at the RunModel boundary; ONE resolveCursor (zero-alloc out-param form); store/URL tick NOT branded | arch 2 | **DISPATCHED** |
| B-ask | day one, owner-side (RESOLVED at G-3) | Bucket B: the 50-seed robust sidecar + fetchable set, seeds 47–91 — Wall ships against 50, builds against the vendored 5 meanwhile | portfolio 5, arch 9 | **RUNNING** (G-3 approved) |
| W1 | VOICES module (thin) | two-family taxonomy (VERDICTS ✓○•✗ / NO-VERDICT ·?NOT-YET), single-source in theme.ts idiom, the 4-surface attested drift fixed; ev99 folds in as a note-level `basis` ruling (cheaper after A1's tag — ev99 text may trail into W3) | design 7/8 | QUEUED |
| W2 | I5 CausalNeighborhood | causalNeighborhood(seq,{maxHop,maxPerHop}), pinned truncation order, count-true chainmeta; causalChain demoted | arch 3 | QUEUED |
| W3 | A1 witness union | closed two-arm union (basis live-inputs \| decoded-consistency IS the tag); tokens resolved by buildLensRegistry; comparand excluded from InputToken at the type level; NO interpreter | arch 4 | QUEUED |
| W4 | Campaign spine | persistent worker, hash-and-discard verify, RunSummary (never useRun×N); decode-cancellation debt lands here; RUN_CATALOG build-time generation trigger (>~12 citizens) written into the brief | arch 5/6 | QUEUED |
| W5 | THE WALL (hero) | D4 execution + design rails: green-is-a-receipt (rest state zero-green zero-bloom screenshot = review gate), real timing or a cut, 5-acquirable/45-on-record split honest, verify-all choreography in true completion order | design 1-4, portfolio 3/4 | QUEUED |
| W6 | THE TAMPER MOMENT | the ✗ path demonstrated: one byte flipped, the fold refuses on screen — the skeptic's ten seconds; naturally a Wall/trust-surface rider | portfolio 9 | QUEUED |
| W7 | e0 authored beats (rider) | the three shots: The first block (tk39), The second observer (crane n=−601), Clean passage (tk74); + N2 shot-reset carry | design 5/6 | QUEUED |

DEFERRED on their own triggers: R3 visual-delta (no motion-bit-identity claim on this path;
never co-schedule frame-loop threading with a new-surface cycle — arch 9, design 9), CSR
event-store (trigger restated: ≥10^5 events — arch 7), catalog generation (fires mid-cycle if
the Wall's library work crosses ~12 citizens).

CUT: the A1 interpreter ("DSL" half), campaign-sibling pipeline beyond stream-and-discard.

---

## §3 — SEQUENCING RATIONALE (the one paragraph)

W0 ships what exists (portfolio: the flip is the single highest-leverage change and every
later commit lands in public as cadence signal); A3 rides parallel because it is
extraction-not-invention and de-risks every subsequent tick/frame touch; VOICES lands thin
before any Wall pixel (design's hard rail); I5 before the Wall because the Wall's
chip/summary surfaces consume the count-true neighborhood; A1 before the Wall's trust rows so
acceptance basis is a type, not prose; the spine is the Wall's engine; the tamper moment rides
the Wall's surfaces; e0 is authoring-only and can absorb schedule slack. Bucket B is
days-scale on the owner's side and gates nothing until W5 — approved day-one and now running
(G-3), so it lands ahead of the Wall's need rather than gating it.

---

## §4 — OWNER GATES AT OPEN (resolved 2026-07-15)

| Gate | Resolution |
|---|---|
| G-1 | SCOPE approved as filed — the ladder in §2 dispatches unchanged from the candidate. |
| G-2 | The Pages flip approved, **scrub-conditional**: a clean scrub of the published runs' `dirty: true` provenance flag (relay #13) executes tonight as part of W0; a clean result flips; a blocker holds W0 to "prep only" (dry-run + staged assets, no publish) with a morning flag to the owner — never a silent slip either way. |
| G-3 | Bucket B (the 50-seed robust sidecar, seeds 47–91) approved and **RUNNING** — no longer a day-one ask awaiting a decision; the Wall (W5) ships against the vendored 5-seed set meanwhile and upgrades to 50 when the sidecar lands. |
| G-4 | LICENSE **DECIDED: MIT at root + `contract/` carve-out**, per the `sitting-brief-2026-07-12.md` filed defaults; drafts already prepared (`license-draft-for-sitting.md`) — W0 commits the file, no new deliberation. |

---

**ENDGAME:** the house four-gate pattern (clean-room / codex whole-branch / fable
ROADMAP-SYNC / experiential release critic) applies at cycle close, per the v0.6/v0.7
precedent; this document is the cycle-open plan of record and does not pre-empt the
close-of-cycle brief.
