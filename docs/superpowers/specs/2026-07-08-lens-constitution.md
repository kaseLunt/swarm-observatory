# THE LENS CONSTITUTION — swarm-observatory

**Status:** RATIFIED 2026-07-08 (owner). §6-class design authority — amendments through the
owner gate only. Every lens, surface, and interaction proposed after this date is judged
against this document; release-gate critics inherit it as their rubric. The v0.6 query
stage is its first compliant citizen.

**Source:** the design-lead vision engagement (composite directive,
`.superpowers/sdd/design-directive-v06plus.md`), distilled. This page is the authority; the
directive is its commentary.

---

## 1. The five questions

Every surface in the app answers exactly one question about a **subject**:

| # | Question | Answer surface |
|---|---|---|
| Q1 | **Where/when is it?** | the stage, the tactical plot, the timeline (orientation) |
| Q2 | **Why did it happen?** | the causality trace (chain today; cross-entity at C1) |
| Q3 | **What does it believe?** | belief/covariance ghosts |
| Q4 | **What was said / decided?** | the comms and auction lenses |
| Q5 | **Can I trust this pixel?** | provenance surfaces, ask-any-pixel |

A proposal that cannot name its question is not yet a design.

## 2. The selection pivot

One noun, five verbs. **Selection is the only pivot**: hover identifies, click selects,
expansion interrogates. New capabilities arrive as new *answers inside this grammar* —
never as new modes. The causality trace is what selection lensing *becomes* when expanded;
interrogation is one level deeper into the same object. A viewer who learns the app on the
causal chain already knows how to use every future lens.

## 3. The four laws

**LAW 1 — The emphasis budget is a mechanism, not a taste.** One question at full voice on
the stage at a time. Invoking a lens *automatically* dims the others (the shipped
lensing/dimming machinery, formalized as a fader hierarchy). If three things glow, nothing
does — enforced structurally, not editorially.

**LAW 2 — Hue is identity, chroma is hierarchy; the palette does not grow.** New lenses
introduce no new colors: they light events in the hues those events already own everywhere
else, and dim the rest. The *territory* each hue covers grows; the palette does not.
(Palette-value changes remain possible — through the swatch → owner-gate channel only.)

**LAW 3 — Two surfaces: drama on the stage, density in the instruments.** Every feature
splits along this line, as synchronized views of the same selection: bids ribbon =
instrument, commitment bond = stage; SNR strip = instrument, pulse = stage; trace arcs =
instrument, lit thread = stage. Numbers wear tabular figures; instruments summarize before
they itemize.

**LAW 4 — No new chrome if it can ship as a new answer.** Every lens must declare, before
implementation: its **question** (from §1), its **surface** (stage/instrument split), its
**borrowed hue**, **what it dims**, and its **honest empty state**. If it needs a new
toggle, panel, or glow to exist, the design isn't done.

## 4. The echo grammar (core chapter)

Trails, the spine, the causality trace, and belief ghosts all draw **the past into the
present frame**. They must all speak it identically, in three voices:

- **NOW** — live entities at the current tick. The only things rendered in the present
  voice.
- **THEN** — ghost anchors: events pinned at the position where they actually happened
  (the decoded state at their tick — data-true), rendered quiet, low-chroma, tick-labeled,
  unmistakably historical. *The past is never presentable as the present, by construction.*
- **WHY** — the lit thread connecting anchors: causation as the connective, wearing
  event-kind hues, older links dimmer.
- **NOT-YET** *(amendment, 2026-07-09 — owner-gated)* — recorded events beyond the playback
  frontier: rendered hollow/outline, never blooming, never presentable as the written
  present, filling in when the playhead writes them. The shared principle behind this voice
  and every quiet glyph in the instrument grammar: **unearned or unverifiable states render
  quiet, glyphed, and reasoned — never the earned signal.** Every future lens that renders
  the future into the present frame (comms pulses, auction windows, belief ghosts) speaks
  this voice.

Any surface that renders historical data outside these voices is non-compliant.

## 5. Standing risk rulings

- **Density at scale** → *aggregate first, itemize on demand*: summarize what is far or
  numerous (chips, heat, counts), itemize what is near or selected; spent elements fade,
  contacts and conclusions persist.
- **Mode proliferation** → one lens control, keyboard-mapped; the selection grammar
  constant across all lenses; tours teach one question at a time (progressive disclosure —
  the naive path stays as simple as today's).
- **Instrument citizenship** — the timeline is a first-class instrument with its own bar:
  every mark hover-identifiable, kinds in lanes, arcs reserved for selection, progressive
  density. Every new lens that projects onto it must keep it readable by a first-time
  viewer.
- **RM hold sizing (I-2 rider)** — Tour authoring sizes `holdMs` as the FULL reading window
  for its caption — never discounted on the assumption that captions are pre-exposed during
  flight (RM viewers receive the hold alone).

## 6. Compliance

- Every cycle plan cites this document; every new lens's design section fills in the LAW 4
  declaration.
- Release-gate critics judge against §1–5 explicitly.
- The five instrument citizens named at ratification (command palette, raw event table,
  telemetry strips, entity identity language, attention rail) are constitutional
  instruments — they serve all questions and are scheduled on the roadmap.
- Naming reserved to the owner: the causality trace's UI name ("thread"/"trace"/"why" —
  never "cone" in the UI), and all product naming.
