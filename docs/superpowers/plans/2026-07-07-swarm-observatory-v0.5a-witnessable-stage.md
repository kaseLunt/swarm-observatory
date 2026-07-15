# Swarm Observatory v0.5a "Witnessable Stage" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the craft visible outside the tour: manual playback becomes witness-normalized (1× ≈ whole run in ~8 s instead of an invisible sub-second blink), and tour holds light the full trajectory so the finale frames a lit journey instead of a faded void.

**Architecture:** One pacing kernel changes (`advancePlayhead`'s rate becomes `speed × maxTick / WITNESS_RUN_SECONDS`; dtUs leaves pacing entirely and remains display-only provenance). Everything downstream is coupling management: `witnessSpeed` re-derived against the new base (or tours blow up to 120–140 s/step), reduced-motion tours snap instead of relying on the old rate being fast, and stale rate comments are rewritten. The trail hold-light is a small cross-component module signal in the existing channel style.

**Tech Stack:** unchanged (Vite + React 19 + TS strict, zustand 5, R3F, vitest node, Playwright).

## Global Constraints

- §8 frame rules binding: zero allocation in `useFrame`/rAF paths; uniform writes on state CHANGE only (ref-guarded).
- **Honesty invariants:** the provenance panel's `dtUs` display (`ProvenancePanel.tsx` `${m.dtUs}µs` / `(assumed)`) is untouched — dt remains a true recorded fact; playback pacing never claimed real-time in any UI copy, and no copy is added that claims otherwise. `ASSUMED_DT_US` keeps its display-only role; do NOT reuse it in pacing.
- Protected surfaces: ceremony, help grammar, tour captions, timeline density — untouched.
- URL/ladder semantics preserved: `SPEEDS` members keep their values (they are multipliers of the base, not absolute rates), `clampSpeed`/`applyLink`/`encodeLink`/J-L notch/digit keys/offladder dimming all unchanged in code (verify by test + grep, not assumption).
- Conventional commits; NEVER any Co-Authored-By/AI attribution.
- Baseline: `main @ 423e45d`, 33 files / 255 tests, 11 smoke.
- Stale comments are review findings: every comment that states the old `1e6·speed/dtUs` rate or "1000 ticks/sec at dtUs=1000" must be rewritten where touched files carry them.

---

### Task 1: Transport re-base — witness-normalized pacing

**Files:**
- Modify: `src/state/transport.ts` (advancePlayhead, witnessSpeed, new const; file is 23 lines — rewrite carefully)
- Modify: `src/state/transport.test.ts` (2 rate tests + 2 witnessSpeed tests rewritten; clamp/rest/floor tests preserved)
- Modify: `src/ui/Timeline.tsx` (call site ~L147; `dtUs` prop removal ~L60; effect dep ~L231; stale comments)
- Modify: `src/ui/App.tsx` (~L259: drop the `dtUs=` prop from `<Timeline>`; keep `ASSUMED_DT_US` import ONLY if still used elsewhere in App — grep)
- Modify: `src/tour/useTour.ts` (startPlay ~L159-195: witnessSpeed call + dtUs derivation deletion + reduced-motion snap; stale comments)

**Interfaces:**
- Produces: `export const WITNESS_RUN_SECONDS = 8` in transport.ts — the wall-clock duration of one full run at 1×.
- Changes: `advancePlayhead(tick, fraction, dtMs, speed, maxTick)` — **dtUs parameter removed**. New per-frame delta: `(dtMs / 1000) * speed * (Math.max(1, maxTick) / WITNESS_RUN_SECONDS)`. The `ticks >= maxTick → {tick: maxTick, fraction: 0, done: true}` clamp/rest branch is preserved byte-for-byte in behavior.
- Changes: `witnessSpeed(span, tickCount, seconds = WITNESS_SECONDS)` — **dtUs parameter replaced by tickCount**. New formula: `(Math.max(1, span) * WITNESS_RUN_SECONDS) / (seconds * Math.max(1, tickCount))`. (Derivation: solve `seconds = span / (speed · tickCount / W)`. Sanity: e0 span 20, tc 75, s 3 → 0.2667; rate 6.67 t/s; duration 3.0 s ✓.)
- `WITNESS_SECONDS = 3` (per-STEP tour dwell target) is unchanged and distinct from `WITNESS_RUN_SECONDS = 8` (per-RUN 1× duration) — document the relationship where both live.

**Behavioral contract:**
1. Manual 1× plays any run start-to-finish in ~`WITNESS_RUN_SECONDS` wall seconds; the ladder scales it (4× → ~2 s, 0.25× → ~32 s).
2. Tour play steps still take ~`WITNESS_SECONDS` (~3 s) each — via the re-derived witnessSpeed. The store value stays off-ladder for current tours (e0 → 0.2667, f1 → 1.333) so the Timeline `offladder` dimming keeps working. KNOWN COSMETIC (accept + comment): a future tour whose witnessSpeed lands exactly on a ladder member would light that button during the step.
3. **Reduced motion:** the old path ("skip the witness write → ladder rate → completes ~instantly") is BROKEN by the new base (1× is now ~8 s — a 4 s animated play step violates reduced-motion). Replace the skip with an explicit snap: in `startPlay`, when `prefersReducedMotion()`, bracket `setTick(target)` + `setPlaying(false)` and dispatch `actionsComplete` (mirror the existing `arrived()` early path a few lines above — same shape). No witness write, no playback, content lands instantly. Rewrite the reduced-motion comment block accordingly.
4. End-of-run rest/done semantics, the end-of-run auto-sync tour guard in Timeline, and `savedSpeed` capture/restore are untouched.
5. `dtUs` no longer flows into any pacing path: Timeline loses the prop entirely (grep `dtUs` afterward — remaining hits must be decode/manifest/ProvenancePanel/ASSUMED_DT_US display only).

- [ ] **Step 1: Rewrite the transport tests first** (they pin the NEW contract; watch the rate tests fail against the old implementation):

```ts
test('1× plays a full run in ~WITNESS_RUN_SECONDS of wall time', () => {
  // 64-tick run (f1 shape), 60fps for WITNESS_RUN_SECONDS seconds at 1× → arrives at maxTick.
  let s = { tick: 0, fraction: 0, done: false }
  const frames = Math.round(WITNESS_RUN_SECONDS * 60)
  for (let i = 0; i < frames && !s.done; i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, 1, 64)
  expect(s.done).toBe(true)
})
test('rate is run-normalized: half the run takes half the time at 1×', () => {
  let s = { tick: 0, fraction: 0, done: false }
  const frames = Math.round((WITNESS_RUN_SECONDS / 2) * 60)
  for (let i = 0; i < frames; i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, 1, 64)
  expect(s.tick + s.fraction).toBeCloseTo(32, 0)
})
test('witnessSpeed round-trip: computed speed covers the span in ~seconds under the new base', () => {
  const span = 20, tickCount = 75, seconds = 3
  const speed = witnessSpeed(span, tickCount, seconds)
  let s = { tick: 0, fraction: 0, done: false }
  for (let i = 0; i < Math.round(seconds * 60); i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, speed, 1e9)
  expect(s.tick + s.fraction).toBeCloseTo(span, 1)
})
test('witnessSpeed stays off-ladder for shipped tours', () => {
  expect((SPEEDS as readonly number[]).includes(witnessSpeed(20, 75))).toBe(false)   // e0
  expect((SPEEDS as readonly number[]).includes(witnessSpeed(32, 64))).toBe(false)   // f1 both steps
})
```

PRESERVE (adjusting only the removed dtUs argument): the maxTick clamp/rest test, the at-rest no-op test, the span-floor test. Add: `maxTick 0 guard — advancePlayhead(0, 0, 16, 1, 0) does not NaN/hang (Math.max(1,·))`.

- [ ] **Step 2: Implement transport.ts** per the Interfaces block; rewrite the file-top comments (the old rate derivation comment is now false).
- [ ] **Step 3: Timeline + App**: call becomes `advancePlayhead(s.tick, s.fraction, now - last, s.speed, model.tickCount)`; remove the prop/dep/App pass-through; rewrite the end-of-run guard comment ONLY if it references the old rate (its tour-speed logic is still true).
- [ ] **Step 4: useTour startPlay**: delete the dtUs derivation line; `witnessSpeed(target - cur, m?.tickCount ?? 1)`; implement the reduced-motion snap (contract point 3); rewrite the witness-pacing comment block (it derives the old rate).
- [ ] **Step 5: grep proofs**: `dtUs` (pacing-free), `1e6` (transport only if at all), stale "1000 ticks/sec" comments gone from touched files.
- [ ] **Step 6: Browser-verify** (dev server, kill after): f1 manual 1× play is a smooth ~8 s flight (WATCH it); e0 manual play shows the pulse walking (~8 s); 4×/0.25× scale; J/L + digits + buttons work; URL `?speed=4` round-trips; f1 tour steps still ~3 s each with off-ladder dimming; reduced-motion emulation → tour play steps snap instantly, manual play still animates (reduced-motion governs decorative animation, not content playback — manual play at a chosen speed is content; state this in the report).
- [ ] **Step 7: Full suite + tsc + commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/state/ src/ui/Timeline.tsx src/ui/App.tsx src/tour/useTour.ts
git commit -m "feat(transport): witness-normalized playback -- 1x plays the run in ~8s; witnessSpeed re-based; reduced-motion tours snap"
```

---

### Task 2: Trail hold-light — the journey stays lit during holds

**Files:**
- Modify: `src/ui/Scene.tsx` (channel additions beside `trailFrameRequest` ~L68-70; `TrajectoryTrail` ~L760-803)
- Modify: `src/tour/useTour.ts` (no new calls needed if the channel hooks ride `requestTrailFrame`/`cancelTrailFrame` — verify)
- Test: none new required (uniform-driving is component-bound; the channel state transitions get a unit test beside the existing channel tests in camera.test.ts)

**Interfaces:**
- Produces, beside the existing channel in Scene.tsx (exported for tests, marked as such):

```ts
// Trail hold-light: while a tour hold dwells on a framed trajectory, the head-relative comet fade
// gives way to a fully-lit path (the hold's claim is "behold the journey" — a faded journey is a void).
// Set by requestTrailFrame (natural arrival), cleared by cancelTrailFrame (interrupt) and by the next
// rising edge of `playing` (any new playback returns the comet). Exported for tests.
export const trailHold = { lit: false }
```

`requestTrailFrame()` additionally sets `trailHold.lit = true`; `cancelTrailFrame()` sets it `false`.

**Behavioral contract:**
1. On a natural play-step arrival, the revealed trail renders at full brightness (every vertex at `TRAIL_HEAD_ALPHA`) for the duration of the hold — including through the NEXT play step's start? NO: a rising edge of `playing` restores the comet fade (so f1's second play step travels with the comet, then re-lights at its own arrival).
2. Natural tour completion leaves the final hold lit (the resting shot shows the whole journey — this is the critic's finale fix). A later manual play clears it via the rising edge; a scrub while at rest does NOT clear it (examining the journey at rest is the point).
3. Tour interrupt (`cancelTrailFrame`) restores the comet immediately.
4. §8: the fade switch is ONE uniform write on state change. Expose `uFadeTicks` on the memo's returned line object (it currently exposes only `uHead`); in the `useFrame`, ref-guard: when `(trailHold.lit && !playing)` differs from the last applied state, write `uFadeTicks = 1e9` (lit) or `TRAIL_FADE_TICKS` (comet). The rising-edge `playing` detection doubles as the clear: when `playing` is true, set `trailHold.lit = false`. Zero allocation; two boolean reads per frame otherwise.
5. Positioned-run manual use is unaffected (trailHold only ever set by tour arrivals); e0 (no trail) inert.

- [ ] **Step 1:** Channel unit test (request sets lit, cancel clears; mirror the stamp test's placement).
- [ ] **Step 2:** Implement per contract (read the LIVE TrajectoryTrail — expose the uniform, add the guarded write + rising-edge clear).
- [ ] **Step 3: Browser-verify:** full f1 tour — arrival at 32: path-so-far fully lit through the hold; second play step: comet returns while flying; arrival at 64: ENTIRE corridor lit in the wide finale, and it STAYS lit after the tour ends (screenshot this — it's the critic's money shot); scrub at rest: stays lit; press play: comet returns; re-run tour and interrupt mid-hold: comet returns instantly. Reduced motion: framing snaps (existing), lighting still switches (it's not motion).
- [ ] **Step 4:** Full suite + tsc + commit

```bash
npx vitest run && npx tsc --noEmit
git add src/ui/Scene.tsx src/ui/camera.test.ts src/tour/useTour.ts
git commit -m "feat(scene): tour holds light the full trajectory -- the finale frames a lit journey, comet fade returns on playback"
```

---

## Endgame (lite — small release, but the transport change is semantic)

1. Clean-room gate (fresh worktree: ci/tsc/unit/smoke/build).
2. Codex TASK-MODE probe: transport re-base coupling sweep (every advancePlayhead/witnessSpeed caller under the new base; reduced-motion paths; URL/ladder semantics; trailHold lifecycle/stuck-state; §8 on the uniform writes).
3. Fable brief pass: semantics coherence (is the new pacing honestly presented? do the two WITNESS constants read clearly?) + ledger sweep.
4. **Manual-path experiential critic** (the release gate): first-timer presses play on e0 and f1 WITHOUT the tour — does the app now perform? Then the f1 tour finale — does it land? Verdict drives the fix wave.
5. Leave `dev/v0.5a` UNMERGED for owner word.

**Dissolution checks for the critic (from v0.4.1's verdict):** post-play dead-end (drone off-screen unselectable) and coast-crawl-after-teleport should both dissolve with witnessable pacing — verify rather than assume; if either survives, it becomes a fix-wave item with fresh design.
