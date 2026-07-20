# v0.9.1 — The Tours

**Cycle thesis:** the two v0.9 lenses ship their guided stories, and the stories become
reachable. Discharges the standing rule (every lens ships with a 60-second tour) that v0.9
violated at close, plus the endgame critic's "marquee is unsignposted" finding.

**Inputs:** the three cycle-open consult rulings (`.superpowers/sdd/consult-v091-{arch,design,portfolio}.md`),
the v0.9 close ledger, the named carries.

**Base:** `dev/v0.9` @ `7a5f58c` (1981 unit / 205 conformance / 49 e2e green).

---

## Consult synthesis (what the leads agreed and where the controller ruled)

- **No engine work.** Tours already drive the playhead (`tick:` scrubs, `play:{to}` flights);
  the v0.9 pulse stage is stateless under `uPlayhead`, so a seeking tour has nothing to latch.
- **The loss beat is `play:{to:31}`, never a paused `tick:30`** (arch + design, independently):
  a paused t30 renders the hero pulse frozen full-bloom at its source — a launch, not a loss —
  and under reduced motion that frozen frame is the only frame. Rest in the afterglow window:
  fizzle, ember, the `t30 · LOSS` anchor.
- **Reduced motion is first-class and honest:** play snaps under RM, the bloom is skipped;
  every tour beat must land on evidence that survives the snap (the labeled anchor, the split
  ledger, the receipt) — never depend on the bloom being seen.
- **Deep links currently orphan the tours** (portfolio, verified in code): any non-empty query
  string suppresses cold-open auto-play, and the ▶ tour affordance only renders when a tour
  exists. Without a new rung, the launch link `?run=f4` lands on a frozen, silent stage.
- **shortTitle placement — controller ruling:** client-side authored map keyed by run id
  (design + portfolio), not a new field in the unsigned run index (arch's alternative). The
  unsigned index gains no new presentation strings; drift is pinned by test instead
  (every catalog id has a short form; length budget enforced). Arch's three-form discipline
  stands: `id` (URL, full-tier button), `shortTitle` (condensed picker, Hangar headline),
  `title` (tooltip, detail). Arch's upstream `displayName` proposal is noted for the
  campaign-scale trigger (13th run / campaign switcher).
- **The queryStageGating vocabulary carry — controller ruling:** design re-adjudicated the
  'empty-stage' vocabulary as correct; no rename. The sanctioned minor is instead the W2
  accessible-name test-vocabulary update design flagged. Folded into R1.

## The ladder

### R1 — Names on the switcher
Authored short-title map (client-side, keyed by run id, prototype-safe lookup with
`title ?? id` fallback). Switcher rows show the short form; tooltip carries id + full title;
the Hangar plate keeps the full title. Names name the RUN's capability, never the punchline
(a tour is a story; a switcher is a map). Fold: the sanctioned accessible-name
test-vocabulary update.
**Ship-bar:** six short forms approved at G-2 render in the condensed header's one-row
budget at 960px; presence + length invariant test; no derived-fact duplication.

### R2 — The f4 tour: "The one lost packet"
Six beats (design §1): establish the steady link → the ledger counting in lockstep → the
split → the loss witnessed → the labeled anchor → the receipt. The loss beat plays across
t30 at 1× with the camera locked (`arrive:{kind:'stage'}` on every play beat — stillness is
authored). Flip the comms lens registration `tourId` from null and add the drift test
(`tourId ≠ null ⟺ hasTour`). Pre-build: re-pin every caption number against the live strip's
rendered output at each beat's playhead (the ledger is playhead-scoped — pre-t30 beats must
not say "1 lost").
**Ship-bar:** caption-honesty test pinning every number to the decoded model at each beat's
playhead; RM path lands on anchor + split ledger + receipt; no contest/jam/failure language;
the loss stays quality-register voice ("never arrived"), never inconsistency voice.

### R3 — The f3a tour: "What the tracker believes"
Six beats (design §2): the disc and the drone → the disc tightens → the error grows → the
divergence (truth exits the ring) → the timeout → the receipt. Disc stays TRUE-SCALE (no
magnification — the f2a lesson); the stage shows the relationship, the strip carries the
precision (0.44 m vs 2.43 m). Timeout copy sequential, never causal ("grows wrong, then
times out"). Flip the belief lens registration `tourId` + drift test. Pixel-verify framing
at the divergence beat (`head` close).
**Ship-bar:** caption pins to the reported-σ and measured-error series at each beat's
playhead; "overconfident," never "broken"; no probability-region overclaim (reported 1σ
eigen-semi-axis, as shipped copy already names it).

### R4 — The story becomes reachable
Bare run deep links (`?run=X` with no tick/selection/state params) auto-arm that run's tour
when one exists and admission passes — exactly as the bare root auto-arms f1. State-bearing
links land as shared, unchanged. Cold open unchanged (f1 stays the front door). Tour remains
interruptible; interruption is remembered per the existing engine rules.
**Ship-bar:** e2e — `?run=f4` cold-load starts the f4 tour; `?run=f4&tick=12` does not;
root behavior byte-identical; admission refusal (mismatch verdict) still lands on the
frozen stage with no tour.

R2 ∥ R3 may run in parallel (disjoint lenses; `tours.ts` and the e2e file take additive
merges). R4 depends on R2 (it needs a tour to arm on the launch link) but not on R3.

## Gates (owner)

| Gate | Question | Recommendation |
|------|----------|----------------|
| G-1 | Scope: the four rungs above, including the ADDED R4 (a deep-link behavior change: bare `?run=` links now start the tour) | Approve as laddered |
| G-2 | The six short names (owner-visible copy) | f0 **Determinism** · f1 **Motion** · e0 **Geometry** · f2a **Sensing** · f3a **Target track** · f4 **Comms link** |
| G-3 | Launch timing (owner-only; not gating any rung) | HOLD the post until R2+R4 ship — the link is the marquee and you launch once. Separately: consider cutting the overconfidence paragraph from the first post (it spends the reserve story its own posting note says to hold) |

## Out of scope (named cuts)

No new lens, no new runs, no campaign/fleet surfaces, no multi-track (C1 territory). No
launch-post edits by the loop (owner's hand only). No tour-engine features. No index-format
changes. The f3a follow-up post is not drafted this cycle.

## Standing constraints (inherited, verbatim-in-effect)

Two-family evidence grammar, no new glyphs or hues. Every number names its scope; every
disclosure its mechanism; every count its population. Adversarial review on every wave;
verdict validity checked against the tool trace. No reviewer names or process shorthand in
shipped source. Public main advances by tree-snapshot commits only.
