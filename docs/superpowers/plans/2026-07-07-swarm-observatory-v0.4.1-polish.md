# Swarm Observatory v0.4.1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the non-gated v0.5 backlog: root-fix the tick-0 entity-subject defect, direct the two remaining camera beats (mid-tour holds frame the trail, follow gated on selection), give the error screen an escape hatch, and land the review minors + v0.2c carries.

**Architecture:** Model layer first — `entityKeys()` is redefined to the *first populated tick*, which simultaneously fixes the trail subject, the `positionless` classification, and the follow-cam subject set (all three consume it). Camera work rides the corrected model. Remaining tasks are independent surface polish, dispatched sequentially in the shared checkout.

**Tech Stack:** Vite + React 19 + TypeScript strict, zustand 5, @react-three/fiber + drei + postprocessing, vitest (node env), Playwright smoke.

## Global Constraints

- **§8 frame rules are binding:** ZERO allocation in `useFrame`/rAF paths; module scratch; event-driven recompute at click/notify/selection rate is the sanctioned shape.
- **Protected surfaces** (owner + both critics): ceremony honesty grammar, help-overlay grammar, tour captions, timeline density. Only changes explicitly granted below may touch them (T6's ceremony verdict mark is granted — it *strengthens* the honesty claim).
- **No new dependencies.** Never modify `contract/` or `public/runs/`.
- **TDD** every pure-logic change (vitest, node env). Visual changes are browser-verified by the implementer against the dev server before commit.
- Conventional commits. **NEVER add Co-Authored-By or any AI attribution.**
- After this release these have exactly one source of truth: speed ladder (`SPEEDS`), dt fallback (`ASSUMED_DT_US`), palette (`PALETTE`/`CATEGORY`).
- Baseline: `main @ 3d44cf6`, 33 test files / 224 tests green, 10 smoke green.
- **Out of scope (do not touch):** e0 origin-pulse presentation (owner decision pending); campaign view (blocked on Certus PR-D); public deploy.

---

### Task 1: Entity-subject root fix — `entityKeys()` = first populated tick

**Files:**
- Modify: `src/model/runModel.ts` (entityKeys, ~L61-63; add `firstPopulatedTick`)
- Modify: `src/ui/trail.ts` (contract docs only)
- Test: `src/model/runModel.test.ts` (or the existing model test file — find it; if none exists over real fixtures, add one using the same fixture-loading pattern the decode tests use)
- Test: `src/ui/trail.test.ts` (extend the existing stub-based tests)

**Interfaces:**
- Produces: `RunModel.firstPopulatedTick(): number` — index of the first tick (0..tickCount inclusive) whose namespace-1 entity map is non-empty; `-1` if no tick ever has entities. Lazily computed once, cached.
- Changes semantics of: `RunModel.entityKeys(): readonly string[]` — now the keys at `firstPopulatedTick()` (decode order), `[]` when `-1`. Consumers (`buildTrail` subject, `positionless` in Scene/App, follow centroid keys) need **no code change** — verify each still type-checks and behaves.

**Why:** Today `entityKeys()` decodes tick 0 only. A run whose first entity appears at tick k>0 renders no trail, is misclassified positionless (mounts ChainSpine), and never engages follow. Current bundles are unaffected (f0/f1 populate at tick 0; e0 never populates) — this is latent-defect removal with byte-identical behavior on current content.

- [ ] **Step 1: Write the failing tests**

In the model test file (real fixtures — reuse whatever fixture/model construction helper the existing decode or model tests use; the f1 fixture is `contract/fixtures/*f1*seed42*`):

```ts
test('firstPopulatedTick: f1 populates at tick 0', () => {
  expect(f1Model.firstPopulatedTick()).toBe(0)
  expect(f1Model.entityKeys()).toEqual(['1:0'])
})

test('firstPopulatedTick: e0 never populates', () => {
  expect(e0Model.firstPopulatedTick()).toBe(-1)
  expect(e0Model.entityKeys()).toEqual([])
})
```

In `src/ui/trail.test.ts`, extend the stub `BoundsSource` pattern already used there with a late-subject case (stub semantics must mirror the NEW contract — `entityKeys()` returns keys at the first populated tick):

```ts
test('late-appearing subject: entityKeys reflects first populated tick, trail backfills pre-spawn', () => {
  const src = stubSource({
    tickCount: 5,
    entityKeys: ['1:0'],                       // present from tick 3 onward
    statesAt: (t) => t >= 3 ? new Map([['1:0', entityAt(t, t, 0)]]) : new Map(),
  })
  const trail = buildTrail(src)
  expect(trail.count).toBe(6)
  // ticks 0-2 backfilled from the first real position (tick 3)
  expect(trail.positions[0]).toBe(trail.positions[3 * 3])
})
```

(Adapt `stubSource`/`entityAt` to the existing test helpers' actual names — extend, don't duplicate.)

- [ ] **Step 2: Run tests to verify the new model tests fail**

Run: `npx vitest run src/model src/ui/trail.test.ts`
Expected: the `firstPopulatedTick` tests FAIL (`firstPopulatedTick is not a function`); trail tests may already pass (the backfill logic exists — the new test pins the *contract*).

- [ ] **Step 3: Implement in `src/model/runModel.ts`**

```ts
  private firstPopulated: number | null = null

  /** First tick (0..tickCount inclusive) whose namespace-1 entity map is non-empty; -1 if none ever.
   *  Lazy + cached: worst case (a truly positionless run like e0) is one full state scan at load
   *  time — sanctioned load-path work, never on the frame path. */
  firstPopulatedTick(): number {
    if (this.firstPopulated === null) {
      this.firstPopulated = -1
      for (let t = 0; t <= this.tickCount; t++) {
        if (this.entityStatesAt(t).size > 0) { this.firstPopulated = t; break }
      }
    }
    return this.firstPopulated
  }

  /** Entity keys at the FIRST POPULATED tick (decode order — deterministic from bundle bytes),
   *  not tick 0: a subject that spawns late still defines the trail/follow/positionless subject set.
   *  Entities appearing only after that tick are not in the set — single-subject presentation is a
   *  deliberate choice for current content (documented in trail.ts). */
  entityKeys(): readonly string[] {
    const f = this.firstPopulatedTick()
    return f < 0 ? [] : [...this.entityStatesAt(f).keys()]
  }
```

(Adjust the loop bound to the actual state-tick count if states are indexed 0..tickCount-1 — check `stateOff.length` and match `buildTrail`'s `n = tickCount + 1` convention.)

- [ ] **Step 4: Document the subject rule in `src/ui/trail.ts`**

Above `buildTrail`, replace/extend the existing doc comment:

```ts
// SUBJECT RULE (v0.4.1): the trail subject is entityKeys()[0] — the first namespace-1 entity
// present at the run's first populated tick, in decode order. Deterministic from bundle bytes.
// Single-subject is a deliberate presentation choice for current single-agent content; per-entity
// trails are content-gated future work (campaign bundles).
```

- [ ] **Step 5: Verify all three consumers**

Grep `entityKeys` across `src/` — for each call site (trail.ts subject, Scene positionless + follow keys, App positionless) confirm the new semantics are correct-or-better and no site assumes "keys at tick 0" specifically. Note findings in the report.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: 224 + new tests, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/model/runModel.ts src/ui/trail.ts src/model/*.test.ts src/ui/trail.test.ts
git commit -m "fix(model): entityKeys from first populated tick -- trail/positionless/follow share the corrected subject set"
```

---

### Task 2: Camera direction — mid-tour holds frame the trail; follow gated on selection; dormant arm

**Files:**
- Modify: `src/ui/Scene.tsx` (follow block ~L269-301, rising-edge subscription ~L122-127, trail wiring ~L661)
- Modify: the module that owns `focusSelected()` (the Scene focus channel — find it; useTour.ts L150 imports it) — add the trail-frame request channel beside it, same shape
- Modify: `src/tour/useTour.ts` (`onArrived`, ~L198-209)
- Modify: `src/ui/camera.ts` only if `boundsFromPositions(positions, count)` needs a prefix-count clarification comment
- Test: `src/ui/camera.test.ts` (prefix-count bounds), plus a unit test for the new request channel (mirror how `src/tour/interrupt.ts` is tested, if it is)

**Interfaces:**
- Produces: `requestTrailFrame(): void` and `takeTrailFrameStamp(): number` (monotonic stamp, module state — exact naming may follow the focus channel's existing convention; keep the pair symmetrical with it).
- Consumes: `boundsFromPositions(positions: Float32Array, count: number)` with `count = arrivedTick + 1` (prefix of the trail — positions are per-tick, so no subarray allocation is needed), `frameFor(bounds, opts)` with the same opts CameraRig uses.

**Behavioral contract (the taste-bearing part — implement exactly this):**
1. **On natural arrival of a tour play step** (`onArrived` in useTour — natural arrivals only; interrupts route through `finish` and must NOT trigger this), request a trail frame.
2. Scene consumes the request **event-driven** (stamp compare per frame is a number compare; the framing computation runs once per request — sanctioned rate): compute `bounds = boundsFromPositions(trail.positions, min(tick, trail.count - 1) + 1)` → `frameFor(bounds, sameOptsAsCameraRig)`, store the target position/target into **preallocated scratch** (module or ref-level `THREE.Vector3`s / plain numbers — zero per-frame allocation).
3. While the trail-frame is active, ease `camera.position` and `controls.target` toward the stored framing each frame at `focusLerpFactor(reduced)` (reduced motion ⇒ factor 1 ⇒ snap — same rule as focus). Converge (< 1e-2 squared distance on both) ⇒ deactivate.
4. Consuming a request **disarms `followCoastRef`** — the trail frame supersedes both the intermediate-beat disarm and the final-beat landing branch.
5. Cancel on user input exactly like the focus channel does (orbit drag start cancels; any tour interrupt already stops future requests at the source).
6. Inert when `trail.count === 0` (e0: no-op) — guard at consume time.
7. **Follow gate:** the follow block (~L281) additionally requires `(selectedEntity !== null || isTourActive())` — manual play with nothing selected no longer auto-pans (the publish-time CameraRig fit already frames the whole trajectory, so an unselected play stays in frame by construction). `isTourActive` comes from `src/tour/interrupt.ts` (module boolean read — frame-path free). Read `selectedEntity` from the same store snapshot the frame loop already uses — no new subscription, no allocation.
8. **Dormant arm (M6):** the rising-edge subscription arms `followCoastRef` only when the run has positioned entities — capture `model.entityKeys().length > 0` in the effect closure (dep `[model]`). e0 never arms.

- [ ] **Step 1: Write failing tests** — camera prefix-count bounds:

```ts
test('boundsFromPositions over a prefix count ignores later points', () => {
  const p = new Float32Array([0,0,0, 10,0,0, 1000,0,0])
  const partial = boundsFromPositions(p, 2)!
  expect(partial.center[0]).toBeCloseTo(5)
  const full = boundsFromPositions(p, 3)!
  expect(full.center[0]).toBeCloseTo(500)
})
```

Plus the channel unit test (request bumps the stamp; consuming is caller-side state):

```ts
test('trail-frame request stamps monotonically', () => {
  const before = takeTrailFrameStamp()
  requestTrailFrame()
  expect(takeTrailFrameStamp()).toBe(before + 1)
})
```

- [ ] **Step 2: Run to verify** the channel test fails (function missing); the bounds test may already pass (it pins the prefix-count contract this task now depends on).

- [ ] **Step 3: Implement the channel** beside `focusSelected()` in its module, mirroring its shape verbatim (stamp counter, no listeners):

```ts
// Trail-frame one-shot (tour play-step arrival): Scene consumes by stamp compare in the frame
// loop and eases to a framing of the trajectory-so-far. Same source-signaled shape as focus.
let trailFrameStamp = 0
export function requestTrailFrame(): void { trailFrameStamp++ }
export function takeTrailFrameStamp(): number { return trailFrameStamp }
```

- [ ] **Step 4: Implement the Scene consume + ease** per the behavioral contract (points 2-6). Zero-allocation discipline: scratch refs for the framing target; the `frameFor` call happens once per request (its returned arrays are event-rate allocations — sanctioned; copy them into scratch immediately).

- [ ] **Step 5: Implement the follow gate + dormant arm** (points 7-8). Keep the existing comment block at L282-288 accurate — amend it to describe the new gate and the trail-frame supersession.

- [ ] **Step 6: Wire `onArrived`** in useTour: after the snap+pause, `requestTrailFrame()` (only in the natural-arrival path).

- [ ] **Step 7: Browser-verify** (dev server, both tours + manual):
  - f1 tour: step 2 arrival (to:32) → camera eases out to frame the path-so-far, hold shows trail + drone; step 3 arrival (to:64) → full-trajectory wide shot on the final hold.
  - e0 tour: no camera motion from this feature at any point.
  - Manual play, nothing selected → camera stays put; select `1:0` then play → follow engages; pause mid-run → no re-center (existing user-pause rule intact).
  - Reduced motion (devtools emulation) → arrival framing snaps, no ease.
  - Orbit-drag during the arrival ease → ease cancels immediately.

- [ ] **Step 8: Full suite + commit**

```bash
npx vitest run
git add -A src/
git commit -m "feat(camera): tour holds frame the trajectory-so-far; follow gated on selection/tour; coast arms only on positioned runs"
```

---

### Task 3: Error-screen escape hatch — "open e0 instead"

**Files:**
- Modify: `src/ui/App.tsx` (error branch, ~L147)
- Modify: `src/ui/app.css` (only if the existing button styles don't already cover it)
- Test: extend the Playwright smoke suite (the existing smoke file) with the hostile-run case

**Interfaces:**
- Consumes: the existing default-run constant (find it — parseLink/applyLink defaults `run` to `e0`; import THAT symbol, do not hardcode a second `'e0'`) and App's existing run-switch path (the header nav's `selectRun`/equivalent handler — reuse it verbatim so URL + store + reload semantics stay identical).

**Why:** Adjudicated Codex probe-5 posture stands: an unknown `?run=` deep link gets an *honest error*, never a silent fallback. This adds the recovery affordance on top — full error text retained, plus one action.

- [ ] **Step 1: Implement the affordance**

```tsx
if (error) return (
  <div className="screen error">
    <h1>decode failed</h1>
    <pre>{error}</pre>
    {runId !== DEFAULT_RUN && (
      <button onClick={() => selectRun(DEFAULT_RUN)}>open {DEFAULT_RUN} instead</button>
    )}
  </div>
)
```

(Adapt `DEFAULT_RUN`/`selectRun` to the real symbols. The `runId !== DEFAULT_RUN` guard: when e0 itself fails, a retry button would be a lie — omit it.)

- [ ] **Step 2: Add the smoke test** (append to the existing smoke file, matching its style):

```ts
test('unknown run: honest error + escape to default', async ({ page }) => {
  await page.goto('/?run=not-a-run')
  await expect(page.locator('h1')).toHaveText('decode failed')
  await page.getByRole('button', { name: /open e0 instead/ }).click()
  await expect(page.locator('h1')).not.toHaveText('decode failed', { timeout: 15000 })
})
```

(Adapt the post-click assertion to the suite's existing ready-state pattern — assert on whatever the other tests use for "run loaded".)

- [ ] **Step 3: Run smoke + unit, browser-verify the styling** (button uses existing button chrome; screen stays honest), then commit:

```bash
npx vitest run && npx playwright test
git add src/ui/App.tsx src/ui/app.css e2e/ tests/
git commit -m "feat(ui): error screen gains 'open e0 instead' escape -- honest error retained, recovery added"
```

---

### Task 4: Review minors — witness-speed ladder state, agreement-test coverage, spine capacity bound

**Files:**
- Modify: `src/ui/Timeline.tsx` (speed buttons ~L283-285)
- Modify: `src/ui/app.css` (off-ladder style)
- Modify: `src/ui/theme.test.ts` (six missing PALETTE tokens)
- Modify: `src/ui/Scene.tsx` (ChainSpine capacity, ~L472/L526), `src/ui/spine.ts` (cap const)
- Test: `src/ui/theme.test.ts`, `src/ui/Timeline.test.ts` (if an off-ladder helper is extracted), spine cap stays review-verified

**Sub-item A — witness-speed active state (M3).** During a tour play step the store speed is off-ladder, so no button matches `s === speed` and the ladder shows nothing active. Make that state *legible* without lying (no nearest-match highlight) and without blocking interrupts (buttons stay enabled — pressing one is a legitimate tour interrupt):

```tsx
{SPEEDS.map(s => (
  <button
    key={s}
    className={s === speed ? 'active' : offLadder ? 'offladder' : ''}
    title={offLadder ? 'tour is pacing playback — press any speed to take over' : undefined}
    onClick={() => { notifyUserInput(); useViewStore.getState().setSpeed(s) }}
  >{s}×</button>
))}
```

with `const offLadder = !(SPEEDS as readonly number[]).includes(speed)` computed once per render, and CSS (adapt the selector to the transport container's real class):

```css
/* Off-ladder (tour witness pacing): no ladder member is authoritative, so the ladder dims
   rather than lying with a nearest-match highlight. Buttons stay live — any press interrupts. */
.timeline button.offladder { opacity: 0.55; }
```

**This also retires the inline `[0.25, 1, 4, 8]` literal** — import `SPEEDS` via the sanctioned ui-side re-export (`keyboard.ts` re-exports it per speeds.ts's own comment; respect that layering).

**Sub-item B — agreement-test coverage (M4).** Add the six untested PALETTE tokens to the `pairs` array in `src/ui/theme.test.ts`:

```ts
['bgElevated', 'bg-elevated'], ['border', 'border'], ['borderBright', 'border-bright'],
['textPrimary', 'text-primary'], ['textDim', 'text-dim'], ['textFaint', 'text-faint'],
```

**First verify each CSS var name actually exists in theme.css** — if a token's var is named differently, map to the real name; if a token has NO css var (JS-only), do NOT invent one — exclude it with an explicit comment naming the JS-only tokens so the exclusion is intentional, not silent. Report which of the two cases you hit.

**Sub-item C — spine capacity bound (M5, forward-bound interpretation — flagged for whole-branch review).** Chains can't exceed `eventCount` by construction, but capacity `= eventCount` is an unbounded allocation vector once campaign-scale bundles (10⁵ events) arrive. Bound it, mirroring the ChainLinks `MAX_LINKS` precedent:

In `src/ui/spine.ts`:

```ts
// Presentational spine capacity bound: the layout is illustrative (chip says so), so a
// campaign-scale bundle must not allocate an unbounded instanced buffer for it. Chains at or
// under the cap render fully; beyond it we keep the first (root-side) edges and warn — the
// same drop-and-warn shape as ChainLinks MAX_LINKS.
export const SPINE_MAX_SEGMENTS = 4096
```

In ChainSpine: `const count = Math.min(model.eventCount, SPINE_MAX_SEGMENTS)`; bound the build loop at `count` instances and `console.warn` the dropped-edge count when exceeded (selection-notify rate — same as ChainLinks' warn).

- [ ] **Step 1:** theme.test additions first (they may FAIL if theme.css names differ — that's the point; resolve per sub-item B's rule).
- [ ] **Step 2:** Timeline off-ladder state + SPEEDS import; browser-verify: start f1 tour → ladder dims with tooltip during the play step; press 4× mid-play → tour interrupts, 4× lights up.
- [ ] **Step 3:** Spine cap; verify e0 renders identically (75 « 4096).
- [ ] **Step 4:** Full suite + commit:

```bash
npx vitest run
git add src/ui/ src/state/
git commit -m "fix(ui): off-ladder ladder state legible, agreement test covers all palette tokens, spine capacity bounded"
```

---

### Task 5: Perf & lifecycle carries — compile warmup, Inspector 8Hz split, composer-cleanup verdict

**Files:**
- Modify: `src/ui/Scene.tsx` (Canvas props ~L672-681; EffectComposer comment ~L710)
- Modify: `src/ui/Inspector.tsx`
- Test: none new (frame-path/lifecycle work is review- and browser-verified; note this in the report)

**Sub-item A — renderer.compile warmup.** The Canvas mounts *after* the ceremony (model publish), so first-frame shader compilation happens exactly at the ceremony dissolve — the worst moment to hitch. Add:

```tsx
onCreated={({ gl, scene, camera }) => { gl.compile(scene, camera) }}
```

to the Canvas. Scope honestly: this compiles materials present at mount (grid, spine/trail, entities); the postprocessing composer compiles its own passes on first composite and is NOT covered — say so in a comment. Browser-verify: hard-reload each run, watch for the dissolve hitch (before/after comparison on a devtools performance recording is ideal; a described observation is acceptable).

**Sub-item B — Inspector 8Hz split.** `usePlayheadSample(8)` re-renders the whole Inspector at 8Hz during playback, including the fully tick-invariant `EventDetail` (depends only on `seq`/`model`) and `subjectEvents` (depends only on `sel`/`model`):

- Wrap `EventDetail` in `React.memo` (its props are stable across ticks — verify no inline-object/closure props defeat it; if any exist, hoist them).
- `const subjectEvents = useMemo(() => (sel ? model.eventsForSubject(sel) : EMPTY_EVENTS), [sel, model])` with a module-level `const EMPTY_EVENTS: never[] = []` so the unselected branch is referentially stable.
- The tick-VARIANT agent-state table keeps its 8Hz sampling — that's its job.

**Sub-item C — composer-cleanup verdict (zero-code).** The v0.2b ledger flagged composer disposal as a future vector "if Canvas persists". Verified state: the Canvas is unkeyed but always unmounts on a run switch (model→null gates the subtree), so r3f disposes the declarative passes. Pin that invariant with a comment above `<EffectComposer>`:

```tsx
{/* Declarative composer: r3f disposes these passes when the Canvas unmounts. The Canvas is
    unkeyed but ALWAYS unmounts on a run switch (model -> null gates the whole subtree), so no
    manual dispose is needed. If the Canvas ever persists across runs, add explicit cleanup. */}
```

- [ ] **Step 1:** onCreated warmup + honesty comment; browser-verify the dissolve on all three runs.
- [ ] **Step 2:** Inspector memoization; verify with React DevTools profiler (or render-count console instrumentation removed before commit) that EventDetail does not re-render during playback with a selection held.
- [ ] **Step 3:** Composer comment.
- [ ] **Step 4:** Full suite + commit:

```bash
npx vitest run
git add src/ui/
git commit -m "perf(ui): shader warmup at canvas creation, Inspector tick-invariant split; composer disposal invariant pinned"
```

---

### Task 6: Hygiene & a11y carries — MOTION prune, live matchMedia, ASSUMED_DT_US, aria-live, ceremony verdict mark

**Files:**
- Modify: `src/ui/theme.ts` (delete MOTION, ~L36-41)
- Modify: `src/ui/motion.ts` (live matchMedia) + consumers of `prefersReducedMotion` (verify each stays correct under live semantics)
- Create: `src/ui/motion.test.ts` (or extend if exists)
- Modify: `src/state/transport.ts` (ASSUMED_DT_US) + `src/ui/App.tsx` ~L214, `src/tour/useTour.ts` ~L182, `src/ui/ProvenancePanel.tsx` ~L49-50
- Modify: `src/ui/App.tsx` (aria-live ready announcement) + `src/ui/app.css` (`.sr-only`)
- Modify: `src/ui/Ceremony.tsx` (verdict-aware step mark) — **granted change to a protected surface: it strengthens the honesty grammar**
- Test: `src/ui/Ceremony.test.ts` (or wherever lineState's tests live — put `stepMark` beside them), `src/ui/motion.test.ts`

**Sub-item A — MOTION prune.** Grep confirms zero consumers of `MOTION` (theme.ts L36-41; the `MOTION_SEGMENT_STARTED` in chapters.ts is an unrelated symbol). The v0.2b fable triage said consume-or-prune; the answer is prune. Delete the export. Re-grep after to prove nothing breaks; `npx tsc --noEmit` must stay clean.

**Sub-item B — live matchMedia.** `prefersReducedMotion()` is a fresh `.matches` read per call but callers snapshot it (Scene's `reducedRef` reads once at mount) — a mid-session OS toggle doesn't propagate. Rewrite `src/ui/motion.ts`:

```ts
// Live reduced-motion signal: one MediaQueryList with a change listener keeps `current` fresh,
// so a mid-session OS toggle propagates without remounts. Reading is a module-boolean load —
// frame-path free. SSR/test-safe: no window -> false, wiring deferred to first read.
let current = false
let wired = false
function wire(): void {
  if (wired || typeof window === 'undefined' || !window.matchMedia) return
  wired = true
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  current = mql.matches
  mql.addEventListener?.('change', (e) => { current = e.matches })
}
export function prefersReducedMotion(): boolean {
  wire()
  return current
}
```

(`focusLerpFactor`/`followLerpFactor` stay as-is.) Then fix the SNAPSHOTTING consumers: Scene's `reducedRef` — replace its reads in the frame loop with direct `prefersReducedMotion()` calls (module boolean load, zero alloc) and delete the ref, OR keep the ref and update it via the same listener; prefer the direct read (less state). Verify useRun/useTour call sites already re-read per invocation (they do — confirm and note).

Test (node env; module state forces `vi.resetModules()` + dynamic import per test):

```ts
test('no window: false, never throws', async () => {
  vi.resetModules()
  const { prefersReducedMotion } = await import('./motion')
  expect(prefersReducedMotion()).toBe(false)
})

test('live change propagates', async () => {
  vi.resetModules()
  let listener: ((e: { matches: boolean }) => void) | undefined
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listener = cb } }),
  })
  const { prefersReducedMotion } = await import('./motion')
  expect(prefersReducedMotion()).toBe(false)
  listener!({ matches: true })
  expect(prefersReducedMotion()).toBe(true)
  vi.unstubAllGlobals()
})
```

**Sub-item C — ASSUMED_DT_US.** In `src/state/transport.ts`:

```ts
// Single authority for the dt assumption on manifests that omit dtUs. Display surfaces
// (ProvenancePanel) label values derived from it as assumed — keep that labeling honest
// if this value ever changes.
export const ASSUMED_DT_US = 1000
```

Replace the three sites: App `dtUs={model.manifest?.dtUs ?? ASSUMED_DT_US}`; useTour `const dtUs = m?.manifest?.dtUs ?? ASSUMED_DT_US`; ProvenancePanel `` val: `${ASSUMED_DT_US}µs (assumed)` ``. Grep for any remaining `?? 1000` in src/ afterward.

**Sub-item D — aria-live ready announcement.** The ceremony live region unmounts at model publish; the moment the app becomes interactive is silent to assistive tech. Add a contained component (App, rendered in the ready branch):

```tsx
function ReadyAnnouncement({ runId, model }: { runId: string; model: RunModel }) {
  const [msg, setMsg] = useState('')
  // Live regions announce CHANGES: mount empty, fill a beat later so the announcement fires.
  useEffect(() => {
    const t = setTimeout(() => setMsg(
      `run ${runId} verified and ready — ${model.eventCount} events, ${model.tickCount} ticks`
    ), 100)
    return () => clearTimeout(t)
  }, [runId, model])
  return <div className="sr-only" role="status" aria-live="polite">{msg}</div>
}
```

with the standard visually-hidden pattern in app.css:

```css
.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
```

Wording note: "verified and ready" is only honest because the ready branch is downstream of the gate screen — a mismatch bundle never reaches it. State this in a comment.

**Sub-item E — ceremony verdict mark.** On a mismatch bundle the step-level "hashes confirming" mark renders a green ✓ (bound to phase/settling) while the per-hash ticks show ✗. Fix at the step level with a pure, testable helper in Ceremony.tsx (exported for tests, beside the existing `lineState` pattern):

```ts
// Step-level mark must carry the verdict, not just completion: a done step whose hash
// comparison FAILED shows ✗/mismatch, never a green ✓. (Per-hash ticks already carry it;
// this closes the step-level gap.)
export function stepMark(confirm: LineState, matches: boolean | null): { glyph: string; cls: string } {
  if (confirm === 'done' && matches === false) return { glyph: '✗', cls: 'done mismatch' }
  return { glyph: MARK[confirm], cls: confirm }
}
```

Usage at the confirm `<li>` (~L44-45): `const cm = stepMark(confirm, hashes ? hashes.matchesTrailer : null)` → `<li className={`cstep ${cm.cls}`}><span className="cmark">{cm.glyph}</span>`. CSS: `.cstep.mismatch .cmark { color: var(--mismatch); }`. Tests:

```ts
test('stepMark: done + mismatch shows the failure', () => {
  expect(stepMark('done', false)).toEqual({ glyph: '✗', cls: 'done mismatch' })
})
test('stepMark: done + match, pending, active are unchanged', () => {
  expect(stepMark('done', true)).toEqual({ glyph: '✓', cls: 'done' })
  expect(stepMark('done', null)).toEqual({ glyph: '✓', cls: 'done' })
  expect(stepMark('pending', false)).toEqual({ glyph: '▪', cls: 'pending' })
  expect(stepMark('active', false)).toEqual({ glyph: '▸', cls: 'active' })
})
```

(`'active'`'s glyph is `▸` per the MARK map — verify against the live file. Note: `stepMark('pending'|'active', false)` keeping the neutral mark is deliberate — the verdict only lands when the step completes.)

- [ ] **Step 1:** stepMark TDD (tests first, watch them fail, implement).
- [ ] **Step 2:** motion.ts TDD (tests first — resetModules pattern).
- [ ] **Step 3:** MOTION prune + ASSUMED_DT_US + aria-live; `npx tsc --noEmit` clean; grep proofs in the report.
- [ ] **Step 4:** Browser-verify: OS reduced-motion toggle mid-session now changes focus/follow snapping live; screen-reader region present in the DOM (inspect); ceremony unchanged on healthy bundles.
- [ ] **Step 5:** Full suite + commit:

```bash
npx vitest run
git add src/
git commit -m "fix(ui): ceremony step mark carries the verdict; live reduced-motion; ASSUMED_DT_US + a11y ready announcement; prune dead MOTION"
```

---

### Task 7: e0 pulse onto the causal spine (owner decision: option B)

**Files:**
- Modify: `src/ui/Scene.tsx` (pulse block, ~L206-231; pulse mesh ~L332-335)
- Modify: `src/ui/spine.ts` (scratch-writing layout variant)
- Test: `src/ui/spine.test.ts` (or wherever spineLayout's tests live)

**Owner ruling:** On positionless runs the query pulse relocates onto the event's own spine node (`spineLayout(seq, count)`) instead of silently defaulting to the world origin. The spine's existing honesty chip ("causal view — layout is presentational") covers the placement claim — no new copy.

**Interfaces:**
- Produces: `spineLayoutInto(out: Float32Array | number[], seq: number, count: number): void` in `src/ui/spine.ts` — same math as `spineLayout`, writes into `out` (no allocation). Refactor `spineLayout` to delegate to it so the existing tests keep pinning the math.

**Behavioral contract:**
1. **Positionless run (ChainSpine mounted):** each tick's kind-23 event pulses at that event's helix node. Position is computed **only when the event seq changes** (cache the last seq in a ref) via `spineLayoutInto` into existing scratch — zero per-frame allocation (§8: `spineLayout`'s returned tuple must NOT be called on the frame path).
2. **Orientation:** on the spine the ring **billboards** (manual `quaternion.copy(camera.quaternion)` — the v0.2b drei-Billboard lesson applies, no drei Billboard). Rationale: the ground pulse is a ground-plane ripple at an entity; the spine pulse is a node flash in mid-air — a flat ring reads as a sliver from the composed camera. On positioned runs the ring keeps its existing flat rotation — reset the quaternion/rotation when the subject path is positioned (the mesh is shared; whichever path runs must fully own its orientation each frame it's visible).
3. **Positioned run, subject absent this tick** (late-spawn pre-spawn): hide the pulse (`visible = false`) instead of pulsing at a stale/origin position — closes the residual sibling of the T1 park fix.
4. Verdict color / HDR boost / scale-fraction animation unchanged in both paths.

- [ ] **Step 1:** TDD `spineLayoutInto` — assert it writes the same values `spineLayout` returns for a few (seq, count) pairs, then refactor `spineLayout` to delegate.
- [ ] **Step 2:** Implement the Scene pulse changes per the contract (read the live pulse block first; the `if (st)` guard region is where paths 1 and 3 fork).
- [ ] **Step 3:** Browser-verify: e0 playback — pulse walks the helix, verdict-colored, billboarded, blooms when active; f1 unchanged (ground ripple at the drone); e0 chip present; no console errors.
- [ ] **Step 4:** Full suite + commit:

```bash
npx vitest run
git add src/ui/
git commit -m "feat(scene): query pulse walks the causal spine on positionless runs (owner ruling: option B)"
```

---

## Endgame (whole-branch, after all 7 tasks)

1. Clean-room gate: fresh worktree, `npm ci`, full unit + smoke, build.
2. Fable whole-branch review (0-critical bar; check the M5 forward-bound interpretation explicitly).
3. Codex TASK-MODE probes: frame-path allocation audit vs `3d44cf6`, module-state/lifecycle inventory, hostile URL matrix (error-affordance path now in scope), hygiene sweep.
4. Scoped experiential critic (browser): f1 tour hold framing + unselected-play gating only — is the stage direction *better*, not just implemented.
5. Leave `dev/v0.4.1` UNMERGED. Morning summary + e0 origin-pulse decision brief.
