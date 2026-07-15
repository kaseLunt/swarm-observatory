# Swarm Observatory v0.3 — Guided Tour + Chapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The recruiter's 60 seconds — a data-driven guided tour that auto-plays over a real bundle (camera, selection, captions as scripted view-state keyframes), plus burst/segment-derived timeline chapters; the tour doubles as the capture-video shooting script.

**Architecture:** A tour is pure data — an array of steps `{at, tick?, select?, focus?, caption, hold}` executed by a small driver that writes through the EXISTING store actions (`setTick`, `select`, `setPlaying`) and focus channel; nothing in the tour path invents state (spec §4.5: a tour is scripted view state). Chapters derive from decoded events (F1's `MotionSegmentStarted` kinds; density bursts elsewhere) at model load, rendered as timeline bands. Deploy/hosting stays gated on the public flip; the comms weather lens stays dormant (zero comms kinds exist in any bundle — untestable content, deferred per ledger).

**Tech Stack:** unchanged; **no new dependencies**.

## Global Constraints

- Spec §5.5 is the contract: a tour is a sequence of (playhead, camera, selection, caption) keyframes replayed over a REAL bundle; it reuses the lenses and view-state store wholesale; the hosted demo's primary action is "▶ take the tour" with free exploration one click away.
- §8 frame rules ABSOLUTE: the tour driver is timer/effect-driven (steps fire on schedule or on reaching a tick), never per-frame JS beyond reading the existing store; captions are DOM.
- §4.4 honesty: captions describe what is actually on screen (real event data — the caption for a chain step may interpolate real values like the query kind); no invented numbers.
- Reduced-motion: tour still runs (it is content, not decoration) but camera focus cuts and caption transitions collapse per the existing token/motion system; holds shorten to keep total <45s.
- TDD for all pure logic (tour compiler/scheduler state machine, chapter derivation); components covered by typecheck + browser verify + smoke (established convention).
- Full gate before every commit: `npm run test && npm run typecheck && npm run lint && npm run build && npm run smoke`.
- Conventional commits; NEVER add Co-Authored-By or any AI attribution. Stage by explicit path. Report paths: `.superpowers/sdd/task-v03-N-report.md`.
- Baseline: main @ e2312ab, 124 unit + 5 smoke green. Runs: f0 (2 events), e0 (75-query chain, det-only), f1 (67 events incl. MotionSegmentStarted kind 0x0120, det-only, real motion).

---

### Task 1: Tour engine — pure step compiler + scheduler state machine

**Files:**
- Create: `src/tour/tourTypes.ts`, `src/tour/tourEngine.ts`
- Test: `src/tour/tourEngine.test.ts`

**Interfaces:**
- Produces:
```ts
// tourTypes.ts
export interface TourStep {
  tick?: number                 // scrub here (paused) before the step body
  play?: { to: number; speed: number }  // or: play from current tick to this tick
  select?: { entity?: string | null; event?: number | null }
  focus?: boolean               // fire the camera focus channel at the selection
  caption: string
  holdMs: number                // dwell after actions complete (normal motion)
}
export interface Tour { id: string; runId: string; title: string; steps: TourStep[] }

// tourEngine.ts — a pure, timer-agnostic state machine:
export interface TourState { stepIndex: number; status: 'idle' | 'stepping' | 'holding' | 'done' }
export function advanceTour(state: TourState, tour: Tour, event: 'start' | 'actionsComplete' | 'holdElapsed' | 'stop'): TourState
export function stepActions(step: TourStep): Array<{ kind: 'scrub'; tick: number } | { kind: 'play'; to: number; speed: number } | { kind: 'select'; entity: string | null | undefined; event: number | null | undefined } | { kind: 'focus' }>
export function holdFor(step: TourStep, reduced: boolean): number  // reduced → min(holdMs, 1200)
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from 'vitest'
import { advanceTour, stepActions, holdFor } from './tourEngine'
import type { Tour, TourStep } from './tourTypes'

const tour: Tour = { id: 't', runId: 'e0', title: 'T', steps: [
  { tick: 0, caption: 'a', holdMs: 2000 },
  { tick: 10, select: { event: 10 }, caption: 'b', holdMs: 3000 },
  { play: { to: 74, speed: 4 }, caption: 'c', holdMs: 1000 },
] }

describe('tour state machine', () => {
  test('start → stepping(0); actionsComplete → holding; holdElapsed → stepping(1)', () => {
    let s = advanceTour({ stepIndex: -1, status: 'idle' }, tour, 'start')
    expect(s).toEqual({ stepIndex: 0, status: 'stepping' })
    s = advanceTour(s, tour, 'actionsComplete')
    expect(s.status).toBe('holding')
    s = advanceTour(s, tour, 'holdElapsed')
    expect(s).toEqual({ stepIndex: 1, status: 'stepping' })
  })
  test('last step holdElapsed → done; stop from anywhere → done', () => {
    let s = { stepIndex: 2, status: 'holding' as const }
    expect(advanceTour(s, tour, 'holdElapsed').status).toBe('done')
    expect(advanceTour({ stepIndex: 1, status: 'stepping' }, tour, 'stop').status).toBe('done')
  })
  test('stepActions order: scrub, select, focus, play', () => {
    const step: TourStep = { tick: 5, select: { entity: '1:0' }, focus: true, play: { to: 20, speed: 4 }, caption: 'x', holdMs: 0 }
    expect(stepActions(step).map(a => a.kind)).toEqual(['scrub', 'select', 'focus', 'play'])
  })
  test('holdFor caps holds under reduced motion', () => {
    expect(holdFor(tour.steps[1]!, false)).toBe(3000)
    expect(holdFor(tour.steps[1]!, true)).toBe(1200)
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
// tourEngine.ts
import type { Tour, TourStep } from './tourTypes'

export interface TourState { stepIndex: number; status: 'idle' | 'stepping' | 'holding' | 'done' }

export function advanceTour(state: TourState, tour: Tour, event: 'start' | 'actionsComplete' | 'holdElapsed' | 'stop'): TourState {
  if (event === 'stop') return { stepIndex: state.stepIndex, status: 'done' }
  if (event === 'start') return { stepIndex: 0, status: 'stepping' }
  if (event === 'actionsComplete' && state.status === 'stepping') return { ...state, status: 'holding' }
  if (event === 'holdElapsed' && state.status === 'holding') {
    const next = state.stepIndex + 1
    return next >= tour.steps.length ? { stepIndex: state.stepIndex, status: 'done' } : { stepIndex: next, status: 'stepping' }
  }
  return state
}

export function stepActions(step: TourStep) {
  const out: Array<{ kind: 'scrub'; tick: number } | { kind: 'play'; to: number; speed: number } | { kind: 'select'; entity: string | null | undefined; event: number | null | undefined } | { kind: 'focus' }> = []
  if (step.tick !== undefined) out.push({ kind: 'scrub', tick: step.tick })
  if (step.select) out.push({ kind: 'select', entity: step.select.entity, event: step.select.event })
  if (step.focus) out.push({ kind: 'focus' })
  if (step.play) out.push({ kind: 'play', to: step.play.to, speed: step.play.speed })
  return out
}

export const holdFor = (step: TourStep, reduced: boolean): number => (reduced ? Math.min(step.holdMs, 1200) : step.holdMs)
```

- [ ] **Step 4: Run → PASS. Full gate. Step 5: Commit** — `git add src/tour && git commit -m "feat: tour engine -- pure step compiler and scheduler state machine"`

---

### Task 2: Chapter derivation (pure, TDD)

**Files:**
- Create: `src/tour/chapters.ts`
- Test: `src/tour/chapters.test.ts`

**Interfaces:**
- Consumes: `RunModel` (kind column via eventAt/ticks, tickCount), `EVENT_KIND_NAMES`.
- Produces: `deriveChapters(model: RunModel): Array<{ startTick: number; endTick: number; label: string }>` — rule: if the run contains kind `0x0120` (`MotionSegmentStarted`) events, each one opens a chapter (label `segment N`, N from order, closing at the next one or run end); otherwise ONE chapter spanning the run (label `run`). (Density-burst chaptering is deferred until a fixture exhibits real bursts — honesty over invented structure; documented.)

- [ ] **Step 1: Failing tests**

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { deriveChapters } from './chapters'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const f1 = new RunModel(decodeBundle(load('f1_seed42.det')), null)
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)

describe('chapter derivation', () => {
  test('F1: one chapter per MotionSegmentStarted, contiguous, covering the run', () => {
    const ch = deriveChapters(f1)
    expect(ch.length).toBeGreaterThan(1)                       // F1 has multiple segments
    expect(ch[0]!.startTick).toBe(0)
    expect(ch.at(-1)!.endTick).toBe(f1.tickCount)
    for (let i = 1; i < ch.length; i++) expect(ch[i]!.startTick).toBe(ch[i - 1]!.endTick)
    expect(ch[0]!.label).toBe('segment 1')
  })
  test('E0 (no segment kinds): single run-spanning chapter', () => {
    expect(deriveChapters(e0)).toEqual([{ startTick: 0, endTick: e0.tickCount, label: 'run' }])
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import type { RunModel } from '../model/runModel'

const MOTION_SEGMENT_STARTED = 0x0120

export function deriveChapters(model: RunModel): Array<{ startTick: number; endTick: number; label: string }> {
  const starts: number[] = []
  for (let seq = 0; seq < model.eventCount; seq++) {
    if (model.eventAt(seq).kind === MOTION_SEGMENT_STARTED) starts.push(model.ticks[seq]!)
  }
  if (starts.length === 0) return [{ startTick: 0, endTick: model.tickCount, label: 'run' }]
  const prelude = starts[0] !== 0            // honest labeling: a pre-segment span is 'lead-in', not a fake segment
  if (prelude) starts.unshift(0)
  return starts.map((s, i) => ({
    startTick: s,
    endTick: i + 1 < starts.length ? starts[i + 1]! : model.tickCount,
    label: prelude ? (i === 0 ? 'lead-in' : `segment ${i}`) : `segment ${i + 1}`,
  }))
}
```

(Construction cost: one envelope decode per event, once per call — call it ONCE per model in the consumer and cache; note in the component task.)

- [ ] **Step 4: Run → PASS (adjust the F1 expectations to the REAL segment count the fixture yields — assert the actual number once observed, don't leave `greaterThan(1)` if the true count is stable; document it). Full gate. Step 5: Commit** — `git add src/tour && git commit -m "feat: chapter derivation from motion-segment events"`

---

### Task 3: Tour driver hook + store integration

**Files:**
- Create: `src/tour/useTour.ts`
- Modify: `src/ui/Scene.tsx` (export a `requestFocus()` helper wrapping the focusRequest channel if not already importable), `src/state/viewStore.ts` (nothing new expected — verify the driver needs only existing actions)
- Test: `src/tour/useTour.test.ts` (the schedulable core extracted pure; hook glue browser-verified)

**Interfaces:**
- Consumes: tourEngine, store actions (setTick/select/setPlaying/setSpeed), focus channel, prefersReducedMotion, syncUrl.
- Produces: `useTour(model: RunModel | null): { active: Tour | null; stepIndex: number; caption: string | null; start(tour: Tour): void; stop(): void }` — the driver executes stepActions via store writes; `play` steps set speed+playing and watch for arrival at `to` via a **subscription** (store.subscribe on tick — NOT a raF loop; fires ≤ once per tick change) then pause; holds via setTimeout registered in a cleanup-owned Set (the Task-6-v0.2b cancellable pattern); stop() restores playing=false and clears timers/subscriptions; any USER transport/selection input during a tour (keyboard, scrub, click) calls stop() — wire via a store subscription comparing against tour-driven writes (a `driving` ref flag set around the driver's own writes).

- [ ] **Step 1: Extract + test the pure arrival predicate and interruption discriminator**

```ts
// in useTour.ts, exported for tests:
export const arrived = (tick: number, to: number): boolean => tick >= to
// PHASE-AWARE interrupt discrimination. CRITICAL: during a 'play' step the transport's rAF loop
// writes tick every frame WITHOUT the driving flag — tick changes are EXPECTED then, not user input.
// During 'playing': foreign iff selection changed, or playing flipped false BEFORE arrival (user paused).
// During 'static' (scrub/hold): any unbracketed tick or selection change is user input.
export function isForeignWrite(
  driving: boolean,
  phase: 'playing' | 'static',
  playTarget: number | null,
  prev: { tick: number; playing: boolean; selectedEvent: number | null },
  next: { tick: number; playing: boolean; selectedEvent: number | null },
): boolean {
  if (driving) return false
  if (next.selectedEvent !== prev.selectedEvent) return true
  if (phase === 'playing') {
    return prev.playing && !next.playing && (playTarget === null || next.tick < playTarget) // paused early = user
  }
  return next.tick !== prev.tick
}
```
Tests: arrived boundary (74/74 true, 73/74 false); isForeignWrite table — driving suppresses everything; static + tick change → true; playing + tick change → false; playing + selection change → true; playing + early pause (tick < target) → true; playing + arrival pause (tick >= target, the driver's own pause is bracketed anyway) → false.

- [ ] **Step 2: Implement the hook** per the interface above — all timers in a cancellable Set; subscription unsubscribed on stop/unmount; `driving.current = true` strictly around the driver's own store writes (synchronous — zustand notifies synchronously, so the flag correctly brackets them). Reduced motion: holds via holdFor, `play` steps keep their speed (content, not decoration) — document.

- [ ] **Step 3: Full gate (hook glue compiles; pure parts tested). Step 4: Commit** — `git add src/tour src/ui && git commit -m "feat: tour driver hook -- store-integrated step execution with user-interrupt detection"`

---

### Task 5: The E0 + F1 tours (content) + tour UI

**ORDERING NOTE: this task runs AFTER the chapter-bands task below (the F1 tour's caption references the visible chapters). The controller dispatches Task 4 (bands) before this one; numbering here reflects authoring order, not execution order.**

**Files:**
- Create: `src/tour/tours.ts` (the authored tours), `src/ui/TourOverlay.tsx` (caption bar + step dots + stop button)
- Modify: `src/ui/App.tsx` (mount TourOverlay; "▶ tour" header button when a tour exists for the current run), `src/ui/app.css`

**Interfaces:**
- Consumes: useTour, Tour type, tokens/motion.
- Produces: `TOURS: Record<string, Tour>` keyed by runId; `<TourOverlay>` rendering the active caption (aria-live polite), step-dots progress, and a stop (×) button; ESC and any user transport input stop the tour (Task 3's machinery).

- [ ] **Step 1: Author the E0 tour** (the hero — six steps, ~45s normal motion; captions must describe REAL data):

```ts
export const TOURS: Record<string, Tour> = {
  e0: { id: 'e0-hero', runId: 'e0', title: 'The causal chain', steps: [
    { tick: 0, caption: 'A real run bundle — 75 geometry queries, every byte re-verified against the pinned hashes you saw on load.', holdMs: 5000 },
    { play: { to: 20, speed: 4 }, caption: 'Playback is exact replay: every tick is the authoritative recorded state, never simulation.', holdMs: 3000 },
    { tick: 37, select: { event: 37 }, caption: 'Every event knows its cause. Selecting one lights its entire causal chain — 37 ancestors, 37 descendants.', holdMs: 6000 },
    { select: { event: 36 }, caption: 'Walk the chain like a debugger — each step is a real recorded event with its query and result.', holdMs: 4000 },
    { select: { event: 35 }, caption: 'Cause by cause, back toward the root…', holdMs: 3500 },
    { tick: 74, select: { event: 74 }, caption: 'The full run: one unbroken causal chain, byte-verified end to end. Explore freely — every view is a shareable URL.', holdMs: 6000 },
  ] },
  f1: { id: 'f1-motion', runId: 'f1', title: 'Motion lifecycle', steps: [
    { tick: 0, select: { entity: '1:0' }, focus: true, caption: 'A single agent with real recorded motion — position, heading, speed, all decoded from the certified bundle.', holdMs: 5000 },
    { play: { to: 32, speed: 4 }, caption: 'The camera follows authoritative state. Segment chapters below derive from real MotionSegmentStarted events.', holdMs: 4000 },
    { play: { to: 64, speed: 8 }, caption: 'Through every commanded segment to the final recorded state.', holdMs: 5000 },
  ] },
}
```
(Verify each caption's claims against the fixture — event 37's chain sizes, F1's segment chapters — adjust numbers to the REAL values during browser verify; captions with wrong numbers are decorative fiction.)

- [ ] **Step 2: TourOverlay** — bottom-center floating caption bar (tokens: bg-panel/border-bright, --fs-body, fade via --dur-base), step dots (`●○○…`), × stop button; hidden when no active tour. The header gains `▶ tour` (only when TOURS[runId] exists && model ready).

- [ ] **Step 3: Browser verify** — run the FULL e0 tour: captions sequence, chain lights at step 3, chain-walk steps, end state; interrupt mid-tour with a scrub → tour stops cleanly, app fully interactive; f1 tour: camera focus-follows, chapter bands visible beneath (landed in the prior task); reduced-motion: holds cap, total < 45s. Screenshots `.superpowers/sdd/task-v03-5-browser.png`.

- [ ] **Step 4: Full gate. Step 5: Commit** — `git add src/tour src/ui && git commit -m "feat: authored e0/f1 tours + tour overlay with captions, progress, interrupt-to-explore"`

---

### Task 4: Timeline chapter bands (EXECUTES BEFORE the tours task above)

**Files:**
- Modify: `src/ui/Timeline.tsx`, `src/ui/app.css` (if band labels are DOM — prefer canvas)
- Test: existing chapters tests cover derivation; band GEOMETRY pure helper tested

**Interfaces:**
- Consumes: `deriveChapters` (computed ONCE per model in the Timeline's existing per-model effect, alongside bins/fills), tokens.
- Produces: `chapterBands(chapters, tickCount, width): Array<{ x: number; w: number; label: string }>` (pure, tested — 2 tests: F1-shaped multi-chapter mapping; single-chapter full-width) + canvas rendering: subtle alternating band tint (`--bg-elevated` at low alpha) behind the density ribbon with boundary ticks; labels drawn at band start (fillText, --text-faint, --fs-mono size), skipped when a band is narrower than its label.

- [ ] **Step 1: TDD chapterBands. Step 2: Wire into the per-model effect + draw (band tint FIRST, then density, then chain, then playhead — verify the idle-repaint skip's inputs unchanged: chapters are per-model constants, no new skip dependency). Step 3: Browser verify f1 (bands match segments; labels legible; e0 single band unobtrusive). Step 4: Full gate. Step 5: Commit** — `git add src/ui src/tour && git commit -m "feat: timeline chapter bands from derived segments"`

---

### Task 6: Smoke + wrap

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Tour smoke** — `?run=e0`: click `▶ tour` → caption bar visible with the step-1 text substring → press ArrowRight (user input) → tour stops (caption bar gone) and the app responds normally (readout advanced). A second test: let step 1 elapse (wait ~5.5s) → caption changes to step-2 substring (proves the scheduler advances).
- [ ] **Step 2: Full gate + build + smoke (7 total). Step 3: Commit** — `git add e2e && git commit -m "test: tour smoke -- start, auto-advance, interrupt-to-explore"`

---

## Plan self-review notes (applied)

- **Spec §5.5 coverage:** data-driven keyframes over real bundles (T1/T4), reuses store/lenses wholesale (T3 writes only through existing actions), "▶ take the tour" primary action (T4), doubles as capture script (the E0 tour IS the video script). §10 row 3: chapters (T5), tour (T4), comms weather EXPLICITLY deferred (zero comms kinds in any bundle — ledgered), hosted deploy gated on the public flip (owner-side).
- **Honesty:** captions verified against real fixture values during browser verify (T4 step 1 note); chapters derive from real events with the burst heuristic deferred rather than invented (T2).
- **§8:** the driver is subscription+timer based (≤1 fire per tick change, cancellable-Set timers per the v0.2b pattern); zero frame-path additions; chapter bands precomputed per model.
- **Interrupt-to-explore** is a first-class requirement (T3 discriminator, T4 verify, T6 smoke) — the spec's "free exploration one click away."
- **Type consistency:** Tour/TourStep (T1) consumed by T3/T4; deriveChapters (T2) by T5; holdFor's reduced cap (T1) by T3.
