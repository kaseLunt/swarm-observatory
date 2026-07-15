# Swarm Observatory v0.2a — Interaction Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mechanics of the hero demo — causal chain click-through (timeline arcs + in-scene links), entity selection with lensing, the agent/event inspector, keyboard transport grammar, rest-on-final-state end clamp, and det-only run support so the E0 golden (75-event causal chain) becomes live content.

**Architecture:** Everything builds on v0.1's proven layers: RunModel gains two pure indexes (causal chain walk, kind-23 subject index); selection/chain state flows through the existing zustand store; all visuals obey the §8 frame-loop rules (per-frame reads via `getState()`, zero hot-path allocation, selection-driven data precomputed in effects into refs/buffers the rAF loops consume).

**Tech Stack:** unchanged (Vite, React 19, TS strict, vitest, zustand 5, @react-three/fiber + drei, Playwright). **No new dependencies.**

## Global Constraints

- Spec §8 binding rules: no React state in frame loops (rAF/useFrame read via `useViewStore.getState()`); zero unconditional per-frame allocation; scratch objects module-level; selection/chain recomputation happens on selection change (effects), never per frame.
- TypeScript strict; branded types stay; no `any` on exported signatures; `import type` under verbatimModuleSyntax; no constructor parameter properties (erasableSyntaxOnly).
- Vitest 4: use `toThrow`, never `toThrowError`.
- Interpolation policy (spec §4.4): semantic displays (inspector, readout, chain, pulse) are tick-exact; only spatial rendering interpolates.
- View state lives in the store and round-trips the URL (spec §4.5). Exception, by design: the help overlay's open/closed state is ephemeral UI, not shareable view state — it stays component-local and out of the URL.
- Honesty: det-only runs show claims-absent provenance (never fabricate a manifest); unknown run ids error visibly (no silent fallback).
- Conventional commits; NEVER add Co-Authored-By or any AI attribution. Stage by explicit path.
- Full gate before every commit: `npm run test && npm run typecheck && npm run lint`; `npm run build && npm run smoke` where the task says so.
- Baseline at plan time: main @ e79502f, 73 tests, smoke green. F0: 2 events/2 ticks/3 state frames. E0 golden det (`contract/fixtures/e0_seed42.det`): 75 events (all kind-23), 75 ticks, 76 state frames, single causal chain root=seq 0, depth 75.

---

### Task 1: Rest-on-final-state transport + forced URL sync + deep-link clamp

**Files:**
- Modify: `src/state/transport.ts` (no signature change — semantics of callers change), `src/state/viewStore.ts`, `src/ui/Timeline.tsx`, `src/ui/Scene.tsx`, `src/ui/App.tsx`, `e2e/smoke.spec.ts`
- Test: `src/state/transport.test.ts`, `src/state/url.test.ts` (unchanged), new assertions in existing files

**Interfaces:**
- Consumes: `advancePlayhead(tick, fraction, dtMs, speed, dtUs, maxTick)`, `syncUrl()`, `RunModel.tickCount`.
- Produces: callers now pass `maxTick = model.tickCount` (playback rests ON the final StateTick); `syncUrl(force?: boolean)` — `force: true` bypasses the 500 ms throttle (used by pause/end-clamp paths); a tick-clamp effect in App that clamps a deep-linked tick into `[0, model.tickCount]` once the model loads.

- [ ] **Step 1: Update the transport test for the new caller semantics**

In `src/state/transport.test.ts`, replace the clamp test with:

```ts
test('clamps at maxTick and rests there (rest-on-final-state)', () => {
  const r = advancePlayhead(74, 0.9, 1000, 8, 1000000, 75) // maxTick now = tickCount
  expect(r).toEqual({ tick: 75, fraction: 0, done: true })
})
test('at rest on maxTick, further advance is a no-op', () => {
  const r = advancePlayhead(75, 0, 16, 1, 1000000, 75)
  expect(r).toEqual({ tick: 75, fraction: 0, done: true })
})
```

- [ ] **Step 2: Run → the first passes already (pure function unchanged), the second passes too.** `advancePlayhead` itself needs NO change — the semantics move to the callers. Verify: `npx vitest run src/state`.

- [ ] **Step 3: viewStore — forced sync**

In `src/state/viewStore.ts` change `syncUrl` signature:

```ts
export function syncUrl(force = false): void {
  const s = useViewStore.getState()
  if (s.playing) return
  const now = performance.now()
  if (!force && now - lastSync < 500) return
  lastSync = now
  const qs = encodeLink({ run: s.runId, tick: s.tick, sel: s.selectedEntity, ev: s.selectedEvent, speed: s.speed })
  history.replaceState(null, '', `?${qs}`)
}
```

- [ ] **Step 4: Timeline — maxTick = tickCount, forced syncs**

In `src/ui/Timeline.tsx`:
- Every `model.tickCount - 1` used as the playhead range becomes `model.tickCount`: the `advancePlayhead(...)` call's `maxTick` argument, the scrub mapping (`(e.clientX...) * model.tickCount`), the playhead-x mapping (`(cur.tick + cur.fraction) / Math.max(1, model.tickCount)`), and `<TickReadout maxTick={model.tickCount} />`.
- The pause button's `syncUrl()` and the clamp-transition `syncUrl()` become `syncUrl(true)` (these are the exact writes the 500 ms throttle could drop).

- [ ] **Step 5: Scene — no pulse past the last event tick**

In `src/ui/Scene.tsx`, the pulse block currently reads `model.eventsByTick(Math.min(tick, model.tickCount - 1))`. Change to tick-exact semantics:

```ts
const seqs = tick < model.tickCount ? model.eventsByTick(tick) : EMPTY_SEQS
```

with `const EMPTY_SEQS: readonly number[] = []` at module level (no per-frame allocation). The entity interpolation clamps (`Math.min(tick, model.tickCount)` / `t0+1` capped) already handle `tick === tickCount` — at rest the scene renders the final StateTick statically. Verify by reading; no change needed there.

- [ ] **Step 6: App — clamp a deep-linked tick when the model loads**

In `src/ui/App.tsx`, after `useRun` returns a model, add:

```tsx
useEffect(() => {
  if (!model) return
  const t = useViewStore.getState().tick
  if (t > model.tickCount) useViewStore.getState().setTick(model.tickCount)
}, [model])
```

- [ ] **Step 7: Smoke — new readout expectations**

In `e2e/smoke.spec.ts`: F0 `tickCount` is 2, so the deep link `/?run=f0&tick=1` now reads `tick 1 / 2`:

```ts
await expect(page.locator('.readout')).toHaveText('tick 1 / 2')
```

- [ ] **Step 8: Full gate + build + smoke** — `npm run test && npm run typecheck && npm run lint && npm run build && npm run smoke` all green.

- [ ] **Step 9: Commit** — `git add src/state src/ui e2e && git commit -m "feat: rest-on-final-state end clamp, forced URL sync on pause, deep-link tick clamp"`

---

### Task 2: Det-only runs + publish the E0 golden + honest unknown-run error

**Files:**
- Modify: `src/source/bundleSource.ts`, `src/ui/useRun.ts`, `public/runs/index.json`, `tools/sync-contract.mjs`
- Create: `public/runs/e0/bundle.det` (copied from `contract/fixtures/e0_seed42.det` — do NOT run the sync script; the contract snapshot is frozen until the upstream registry bump lands)
- Test: `e2e/smoke.spec.ts` (det-only assertions)

**Interfaces:**
- Consumes: `fetchBundle`, `decodeInWorker`, `parseManifest`, `gateManifest`, `RunModel(run, manifest | null)` (null-manifest path already renders claims-absent provenance).
- Produces: `RunEntry` gains `detOnly?: boolean`; `fetchDet(baseUrl): Promise<ArrayBuffer>` exported from bundleSource; useRun's det-only branch (header-version gate only — the four-tuple manifest gate needs a manifest); unknown `?run=` id yields the error screen, never a silent `index[0]` fallback.

- [ ] **Step 1: bundleSource — split det fetch**

```ts
export async function fetchDet(baseUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(`${baseUrl}/bundle.det`)
  if (!res.ok) throw new Error(`fetch ${baseUrl}/bundle.det: ${res.status}`)
  return res.arrayBuffer()
}
```

Refactor `fetchBundle` to use it (`const det = await fetchDet(baseUrl)` alongside the manifest fetch — keep `Promise.all` shape by fetching both concurrently: `const [det, manRes] = await Promise.all([fetchDet(baseUrl), fetch(...)])`).

- [ ] **Step 2: useRun — det-only branch + unknown-run error**

In `src/ui/useRun.ts`:
- `export interface RunEntry { id: string; title: string; base: string; detOnly?: boolean }`
- Replace the `?? index[0]` fallback: `const entry = index.find(r => r.id === runId); if (!entry) throw new Error(\`unknown run '\${runId}' — pick a run from the header\`)`
- Branch:

```ts
if (entry.detOnly) {
  const det = await fetchDet(entry.base)
  const run = await decodeInWorker(det, f => { if (alive) setState(s => ({ ...s, progress: f })) })
  const idn = identity as Identity
  if (run.header.eventSchemaVersion !== idn.eventSchemaVersion || run.header.stateSchemaVersion !== idn.stateSchemaVersion) {
    if (alive) setState(s => ({ ...s, gate: { ok: false, field: 'bundle.det schema versions', expected: `${idn.eventSchemaVersion}/${idn.stateSchemaVersion}`, actual: `${run.header.eventSchemaVersion}/${run.header.stateSchemaVersion}` } }))
    return
  }
  if (alive) setState({ model: new RunModel(run, null), gate: { ok: true }, error: null, progress: 1 })
  return
}
```

(Note: the worker path already runs the FULL header gate added in the v0.1 fix wave for manifest runs — this branch reuses the same screen for det-only. Keep the existing manifest path untouched.)

- [ ] **Step 3: Publish E0 det-only**

```bash
mkdir -p public/runs/e0 && cp contract/fixtures/e0_seed42.det public/runs/e0/bundle.det
```

`public/runs/index.json` becomes:

```json
[
  { "id": "f0", "title": "F0 determinism fixture (seed 42)", "base": "runs/f0" },
  { "id": "e0", "title": "E0 geometry sweep (golden, det-only)", "base": "runs/e0", "detOnly": true }
]
```

Also append the same publish lines to `tools/sync-contract.mjs` (after the f0 publish block) so FUTURE re-syncs keep e0 current — but do not run the script now (frozen until the upstream bump merges):

```js
mkdirSync('public/runs/e0', { recursive: true })
cpSync('contract/fixtures/e0_seed42.det', 'public/runs/e0/bundle.det')
```

and extend the script's index.json write with the e0 entry (matching the JSON above).

- [ ] **Step 4: Smoke — E0 det-only loads honestly**

Add to `e2e/smoke.spec.ts`:

```ts
test('E0 det-only run decodes, verifies trailer, shows claims-absent provenance', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.provenance')).toContainText('(det-only)')
  await expect(page.locator('.counts')).toContainText('75 events · 75 ticks')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75')
})
```

(Verify the counts line's actual class/casing against ProvenancePanel — `.counts` renders `{verify.eventCount} events · {verify.tickCount} ticks · ...`.)

- [ ] **Step 5: Full gate + build + smoke** (2 smoke tests now). **Step 6: Commit** — `git add src/source src/ui public/runs tools/sync-contract.mjs e2e && git commit -m "feat: det-only run support, E0 golden published, honest unknown-run error"`

---

### Task 3: RunModel — causal chain walk + kind-23 subject index (pure, TDD)

**Files:**
- Modify: `src/model/runModel.ts`
- Test: `src/model/runModel.test.ts`

**Interfaces:**
- Consumes: existing `parentOf`/`childrenOf`/columns; `decodeEvent`/`decodeGeometryQuery` at construction.
- Produces: `causalChain(seq: number): { ancestors: readonly number[]; descendants: readonly number[] }` (ancestors nearest-first; descendants BFS order); `eventsForSubject(entityKey: string): readonly number[]` (kind-23 events whose subject is that ns-1 entity, seq order); `subjectOf(seq: number): string | null` (entity key of a kind-23 event's subject, else null).

- [ ] **Step 1: Failing tests**

```ts
describe('causal chain (E0: single chain of depth 75)', () => {
  test('from seq 40: ancestors 39..0 nearest-first, descendants 41..74', () => {
    const c = e0.causalChain(40)
    expect(c.ancestors[0]).toBe(39); expect(c.ancestors).toHaveLength(40); expect(c.ancestors.at(-1)).toBe(0)
    expect(c.descendants[0]).toBe(41); expect(c.descendants).toHaveLength(34); expect(c.descendants.at(-1)).toBe(74)
  })
  test('root has no ancestors; leaf has no descendants', () => {
    expect(e0.causalChain(0).ancestors).toHaveLength(0)
    expect(e0.causalChain(74).descendants).toHaveLength(0)
  })
})
describe('subject index (E0: all 75 events are kind-23)', () => {
  test('every event has a subject key and the index covers all 75', () => {
    const keys = new Set<string>()
    let total = 0
    for (const k of e0.entityKeys()) { const s = e0.eventsForSubject(k); total += s.length; s.forEach(() => keys.add(k)) }
    expect(total).toBe(75)
  })
  test('subjectOf agrees with the index; F0 fixture events have null subject', () => {
    const k = e0.subjectOf(0)!
    expect(e0.eventsForSubject(k)).toContain(0)
    expect(f0.subjectOf(0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

In the constructor, after the existing index loop, build the subject index (decode each kind-23 payload once — construction-time, not frame-path):

```ts
private subjectSeqs = new Map<string, number[]>()
private subjects: (string | null)[]
// in constructor:
this.subjects = new Array(this.eventCount).fill(null)
for (let i = 0; i < this.eventCount; i++) {
  if (run.kind[i] !== GEOMETRY_QUERY_RESOLVED) continue
  const q = decodeGeometryQuery(decodeEvent(this.payloadSpan(i)).payload)
  const key = `1:${q.subject}`
  this.subjects[i] = key
  const arr = this.subjectSeqs.get(key)
  if (arr) arr.push(i); else this.subjectSeqs.set(key, [i])
}
```

Methods:

```ts
causalChain(seq: number): { ancestors: readonly number[]; descendants: readonly number[] } {
  const ancestors: number[] = []
  let p = this.parentOf(seq)
  while (p !== null) { ancestors.push(p); p = this.parentOf(p) }
  const descendants: number[] = []
  const queue: number[] = [...this.childrenOf(seq)]
  for (let qi = 0; qi < queue.length; qi++) { descendants.push(queue[qi]!); queue.push(...this.childrenOf(queue[qi]!)) }
  return { ancestors, descendants }
}
eventsForSubject(entityKey: string): readonly number[] { return this.subjectSeqs.get(entityKey) ?? EMPTY }
subjectOf(seq: number): string | null { return this.subjects[seq] ?? null }
```

with `const EMPTY: readonly number[] = []` at module level. (The one-slot `geometryQueryAt` memo is unaffected — the constructor uses the decoders directly.)

- [ ] **Step 4: Run → PASS (all existing tests too). Step 5: Full gate. Step 6: Commit** — `git add src/model && git commit -m "feat: RunModel causal chain walk + kind-23 subject index"`

---

### Task 4: Entity selection — instanced picking, lensing colors, deselect

**Files:**
- Modify: `src/ui/Scene.tsx`, `src/ui/app.css`
- Test: manual browser verify (selection is a browser interaction; assertion-grade coverage lands with Task 7's keyboard smoke)

**Interfaces:**
- Consumes: store `select(entity, event)`, `selectedEntity`; `keys` array (entity keys by instance index).
- Produces: clicking a cone selects its entity (`select(key, null)` + `syncUrl(true)`); clicking empty space deselects; lensing — selected instance full color + others dimmed via `instanceColor`; a `SELECTION_COLORS` module constant other tasks reuse.

- [ ] **Step 1: Picking + colors in Scene.tsx**

r3f instanced meshes deliver `e.instanceId` on pointer events. Add to `<instancedMesh>`:

```tsx
onClick={(e) => { e.stopPropagation(); const k = keys[e.instanceId!]; if (k) { useViewStore.getState().select(k, null); syncUrl(true) } }}
```

On `<Canvas>` add `onPointerMissed={() => { useViewStore.getState().select(null, null); syncUrl(true) }}`.

Lensing (NOT per-frame — a subscription effect):

```tsx
const SELECTED = new THREE.Color('#7fb4e6')
const DIMMED = new THREE.Color('#22303f')
const NEUTRAL = new THREE.Color('#5a7fa6')
// inside Entities:
useEffect(() => {
  const apply = (sel: string | null) => {
    const mesh = meshRef.current
    if (!mesh) return
    keys.forEach((k, i) => mesh.setColorAt(i, sel === null ? NEUTRAL : k === sel ? SELECTED : DIMMED))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  apply(useViewStore.getState().selectedEntity)
  return useViewStore.subscribe((s, prev) => { if (s.selectedEntity !== prev.selectedEntity) apply(s.selectedEntity) })
}, [keys])
```

Set the material to `vertexColors`-compatible instancing: `<meshStandardMaterial color="#ffffff" emissive="#1a3a5c" />` and initialize all instance colors to NEUTRAL in the same effect's first `apply`. (With instanceColor set, the material base color multiplies — keep base white so instance colors read true.)

- [ ] **Step 2: Restore-from-URL**: selection already round-trips via `sel` (store `applyLink`); verify `?sel=1:0` colors the cone on load in the browser.

- [ ] **Step 3: Browser verify** (chrome-devtools MCP as in v0.1 Tasks 13/14): on `?run=e0` — click a cone → it brightens, others dim, URL gains `sel=`; click empty space → neutral colors, `sel` gone; reload with `?sel=` → selection restored. Screenshot to `.superpowers/sdd/task-v02a-4-browser.png`. No console errors; HUD steady 60fps (the effect must not run per frame — confirm no GC sawtooth).

- [ ] **Step 4: Full gate. Step 5: Commit** — `git add src/ui && git commit -m "feat: instanced entity picking with selection lensing colors"`

---

### Task 5: Causal chain visuals — timeline arcs + markers, in-scene links, event click-select

**Files:**
- Modify: `src/ui/Timeline.tsx`, `src/ui/Scene.tsx`
- Create: `src/ui/chain.ts` (pure chain-geometry helpers)
- Test: `src/ui/chain.test.ts`

**Interfaces:**
- Consumes: `RunModel.causalChain/subjectOf/eventsByTick`, store `selectedEvent`, `ticks` column.
- Produces: `chain.ts`: `chainTicks(model, seq): { ticks: Float64Array; arcs: Float64Array }` — `ticks` = sorted unique tick of every chain member (selected + ancestors + descendants); `arcs` = flat `[tickA, tickB, ...]` pairs for each causation edge in the chain (parent tick → child tick). `nearestEventSeq(model, tick): number | null` — the seq at that tick (first of `eventsByTick`), else nearest tick with events within ±2 ticks, else null.

- [ ] **Step 1: Failing tests**

```ts
import { chainTicks, nearestEventSeq } from './chain'
// e0 model as in runModel.test.ts
test('chainTicks on E0 seq 40 spans the full chain with 74 arcs', () => {
  const c = chainTicks(e0, 40)
  expect(c.ticks).toHaveLength(75)          // every event tick participates
  expect(c.arcs).toHaveLength(74 * 2)       // 74 edges, flat pairs
  expect(c.arcs[0]).toBe(0); expect(c.arcs[1]).toBe(1) // root edge 0→1
})
test('nearestEventSeq exact hit and ±2 window', () => {
  expect(nearestEventSeq(e0, 10)).toBe(10)  // E0: one event per tick, seq === tick
  expect(nearestEventSeq(f0, 1)).toBe(1)
  const past = nearestEventSeq(e0, 76)      // tick 76 has no events; 74 is 2 away
  expect(past).toBe(74)
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `src/ui/chain.ts`**

```ts
import type { RunModel } from '../model/runModel'

export function chainTicks(model: RunModel, seq: number): { ticks: Float64Array; arcs: Float64Array } {
  const { ancestors, descendants } = model.causalChain(seq)
  const members = [...ancestors, seq, ...descendants]
  const tickSet = new Set<number>()
  const arcs: number[] = []
  for (const m of members) {
    tickSet.add(model.ticks[m]!)
    const p = model.parentOf(m)
    if (p !== null) arcs.push(model.ticks[p]!, model.ticks[m]!)
  }
  return { ticks: Float64Array.from([...tickSet].sort((a, b) => a - b)), arcs: Float64Array.from(arcs) }
}

export function nearestEventSeq(model: RunModel, tick: number): number | null {
  for (let d = 0; d <= 2; d++) {
    for (const t of d === 0 ? [tick] : [tick - d, tick + d]) {
      if (t < 0 || t >= model.tickCount) continue
      const seqs = model.eventsByTick(t)
      if (seqs.length) return seqs[0]!
    }
  }
  return null
}
```

(Arc count note: members of one chain contribute an edge per non-root member — E0 from seq 40 → 75 members, 74 edges. The root's parentOf is null.)

- [ ] **Step 4: Timeline — markers, arcs, click-to-select-event, perf riders**

In `src/ui/Timeline.tsx`:
- Module-level ref holding the active chain: `let activeChain: { ticks: Float64Array; arcs: Float64Array } | null = null` — set by an effect subscribing to `selectedEvent` (compute via `chainTicks`, or null when deselected). The rAF draw reads it directly (no React in the loop).
- Precompute the density fill styles ONCE per model (perf rider): `const fills = Array.from(bins, b => \`rgba(90,170,255,\${0.15 + 0.85 * b})\`)` in the effect where `bins` is computed; the draw loop indexes `fills[i]` (kills ~200 template strings/frame).
- Skip idle repaint (perf rider): at the top of `draw`, if `!s.playing` and nothing changed since the last paint (`tick`, `fraction`, `selectedEvent`, canvas size all equal to the previous frame's values, chain ref identity unchanged), skip straight to `requestAnimationFrame(draw)`. Track previous values in module-level scratch vars.
- Draw chain (after density, before playhead): for each `activeChain.ticks[i]` draw a 2px bright marker (`#ffd166` at 0.9 alpha) at its x; for each arc pair draw a quadratic curve from xA to xB with control point midway at height h*0.25, stroke `rgba(255,209,102,0.35)`, 1px. All coordinates derive from `tick / model.tickCount * w`.
- Click handling: the existing `scrub` becomes selection-aware — on click, `const seq = nearestEventSeq(model, t)`; if the click is within 4px vertical of the top half (event region) AND seq !== null → `useViewStore.getState().select(useViewStore.getState().selectedEntity, seq); syncUrl(true)`; else scrub as before. Simpler and predictable: **shift-click selects the nearest event; plain click scrubs** — implement that (one modifier, no pixel-region guessing), and note it in the help overlay (Task 7).

- [ ] **Step 5: Scene — in-scene chain links**

New `ChainLinks` component inside Scene (sibling of `Entities`):

```tsx
const MAX_LINKS = 256
function ChainLinks({ model }: { model: RunModel }) {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  const chainRef = useRef<{ pairs: [string, string][] } | null>(null)
  useEffect(() => {
    const compute = (ev: number | null) => {
      if (ev === null) { chainRef.current = null; return }
      const { ancestors, descendants } = model.causalChain(ev)
      const members = [...ancestors, ev, ...descendants]
      const pairs: [string, string][] = []
      for (const m of members) {
        const p = model.parentOf(m)
        if (p === null) continue
        const a = model.subjectOf(p); const b = model.subjectOf(m)
        if (a && b && a !== b && pairs.length < MAX_LINKS) pairs.push([a, b])
      }
      chainRef.current = { pairs }
    }
    compute(useViewStore.getState().selectedEvent)
    return useViewStore.subscribe((s, prev) => { if (s.selectedEvent !== prev.selectedEvent) compute(s.selectedEvent) })
  }, [model])
  useFrame(() => {
    const geo = geoRef.current
    if (!geo) return
    const chain = chainRef.current
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    if (!chain || chain.pairs.length === 0) { geo.setDrawRange(0, 0); return }
    const { tick } = useViewStore.getState()
    const t0 = Math.min(tick, model.tickCount)
    const s0 = model.entityStatesAt(t0)
    let n = 0
    for (const [a, b] of chain.pairs) {
      const ea = s0.get(a); const eb = s0.get(b)
      if (!ea || !eb) continue
      entityPosition(scratchA, ea, 0); entityPosition(scratchB, eb, 0)
      pos.setXYZ(n * 2, scratchA[0], scratchA[1], scratchA[2])
      pos.setXYZ(n * 2 + 1, scratchB[0], scratchB[1], scratchB[2])
      n++
    }
    pos.needsUpdate = true
    geo.setDrawRange(0, n * 2)
  })
  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(MAX_LINKS * 2 * 3), 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffd166" transparent opacity={0.5} />
    </lineSegments>
  )
}
```

(Buffer allocated once at mount; per-frame writes only. The `entityPosition(..., 0)` index-fallback argument is unused when pos.length===3 — E0 entities may have empty pos and collapse to the grid; links between grid-fallback positions with index 0 will overlap — acceptable until richer bundles; do NOT thread instance indexes through, keep it simple.) Note: E0's events share few distinct subjects, so `a !== b` filtering may yield few/zero visible links on E0 — the timeline arcs are E0's hero visual; links earn their keep on multi-entity bundles. This is expected, not a defect.

- [ ] **Step 6: Browser verify** on `?run=e0`: shift-click mid-timeline → chain markers + arcs light the whole ribbon (single 75-chain), `ev=` in URL; scrubbing still works with plain click; perf HUD steady, no idle repaint (pause and confirm the draw loop goes quiet via the HUD's frame graph). Screenshot.

- [ ] **Step 7: Full gate. Step 8: Commit** — `git add src/ui && git commit -m "feat: causal chain visuals -- timeline arcs and markers, in-scene links, shift-click event select"`

---

### Task 6: Inspector panel + sampled playhead hook

**Files:**
- Create: `src/ui/Inspector.tsx`, `src/ui/usePlayheadSample.ts`
- Modify: `src/ui/App.tsx` (grid gains an `inspector` area on the left), `src/ui/app.css`, `src/ui/Timeline.tsx` (TickReadout switches to the sampled hook)
- Test: `src/ui/usePlayheadSample.test.ts` (hook logic via renderHook is overkill without extra deps — test the pure sampler predicate instead; see Step 1)

**Interfaces:**
- Consumes: `RunModel` (entityStatesAt, eventsForSubject, eventAt, geometryQueryAt, causalChain, subjectOf, EVENT_KIND_NAMES, GEOMETRY_QUERY_KIND_NAMES), store selection.
- Produces: `usePlayheadSample(hz?: number): number` — integer tick, re-rendering at most `hz` while playing, immediately on pause/scrub; `<Inspector model={model} />` docked panel.

- [ ] **Step 1: The sampler**

`src/ui/usePlayheadSample.ts`:

```ts
import { useEffect, useState } from 'react'
import { useViewStore } from '../state/viewStore'

export function usePlayheadSample(hz = 8): number {
  const [tick, setTick] = useState(() => useViewStore.getState().tick)
  useEffect(() => {
    let last = useViewStore.getState().tick
    const read = () => { const t = useViewStore.getState().tick; if (t !== last) { last = t; setTick(t) } }
    const unsub = useViewStore.subscribe((s, prev) => {
      if (!s.playing || s.playing !== prev.playing) read() // paused updates + play/pause edges are immediate
    })
    const id = setInterval(() => { if (useViewStore.getState().playing) read() }, 1000 / hz)
    return () => { unsub(); clearInterval(id) }
  }, [hz])
  return tick
}
```

Test the predicate logic as a pure function if extraction is clean; otherwise cover via typecheck + browser verify and say so in the report (React hooks without a DOM test lib are out of unit scope by v0.1 convention).

- [ ] **Step 2: Inspector component**

`src/ui/Inspector.tsx` — renders nothing when no selection; otherwise three stacked sections:

```tsx
import type { RunModel } from '../model/runModel'
import { EVENT_KIND_NAMES, GEOMETRY_QUERY_KIND_NAMES } from '../decode/payloads'
import { useViewStore, syncUrl } from '../state/viewStore'
import { usePlayheadSample } from './usePlayheadSample'

export function Inspector({ model }: { model: RunModel }) {
  const sel = useViewStore(s => s.selectedEntity)
  const ev = useViewStore(s => s.selectedEvent)
  const tick = usePlayheadSample(8)
  if (!sel && ev === null) return null
  const t = Math.min(tick, model.tickCount)
  const st = sel ? model.entityStatesAt(t).get(sel) : undefined
  const subjectEvents = sel ? model.eventsForSubject(sel) : []
  const pick = (n: number) => { useViewStore.getState().select(model.subjectOf(n) ?? sel, n); syncUrl(true) }
  return (
    <aside className="inspector">
      {sel && (
        <section>
          <h2>agent {sel}</h2>
          {st ? (
            <table><tbody>
              <tr><td>alive</td><td>{String(st.alive)}</td></tr>
              <tr><td>pos</td><td>{st.pos.length ? st.pos.map(v => v.toFixed(2)).join(', ') : '(none)'}</td></tr>
              <tr><td>heading</td><td>{st.headingRad.toFixed(4)} rad</td></tr>
              <tr><td>speed</td><td>{st.speedMps.toFixed(2)} m/s</td></tr>
              <tr><td>fuel</td><td>{st.fuel.toFixed(2)}</td></tr>
            </tbody></table>
          ) : <p>(not present at tick {t})</p>}
        </section>
      )}
      {sel && subjectEvents.length > 0 && (
        <section>
          <h2>events · {subjectEvents.length}</h2>
          <ul className="evlist">
            {subjectEvents.map(n => (
              <li key={n} className={n === ev ? 'active' : ''}>
                <button onClick={() => pick(n)}>#{n} t{model.ticks[n]} {EVENT_KIND_NAMES[model.eventAt(n).kind] ?? model.eventAt(n).kind}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ev !== null && <EventDetail model={model} seq={ev} onPick={pick} />}
    </aside>
  )
}

function EventDetail({ model, seq, onPick }: { model: RunModel; seq: number; onPick: (n: number) => void }) {
  const e = model.eventAt(seq)
  const q = model.geometryQueryAt(seq)
  const { ancestors, descendants } = model.causalChain(seq)
  return (
    <section>
      <h2>event #{seq}</h2>
      <table><tbody>
        <tr><td>kind</td><td>{EVENT_KIND_NAMES[e.kind] ?? e.kind}</td></tr>
        <tr><td>tick</td><td>{e.tick}</td></tr>
        {q && <>
          <tr><td>query</td><td>{GEOMETRY_QUERY_KIND_NAMES[q.queryKind] ?? q.queryKind}</td></tr>
          <tr><td>result</td><td className={q.resultFlag ? 'flag-true' : 'flag-false'}>{String(q.resultFlag)}{q.tiebreakApplied ? ' (tiebreak)' : ''}</td></tr>
          <tr><td>scalars</td><td>{q.resultScalars.map(v => v.toFixed(4)).join(', ') || '—'}</td></tr>
        </>}
      </tbody></table>
      <p className="chainnav">
        {e.causationId !== null && <button onClick={() => onPick(e.causationId!)}>← cause #{e.causationId}</button>}
        {descendants.length > 0 && <button onClick={() => onPick(descendants[0]!)}>effect #{descendants[0]} →</button>}
        <span className="chainmeta">{ancestors.length} up · {descendants.length} down</span>
      </p>
    </section>
  )
}
```

- [ ] **Step 3: Layout** — App grid: `grid-template: "header header header" auto "inspector viewport panel" 1fr "timeline timeline timeline" auto / 260px 1fr 320px;` with `.inspector { grid-area: inspector; overflow-y: auto; border-right: 1px solid #1c2733; padding: 1rem; font-size: 0.8rem; }` — when Inspector returns null the column collapses: give the grid `minmax(0, auto)` for the inspector column instead of fixed `260px` (`... / minmax(0, auto) 1fr 320px`). Mount `<Inspector model={model} />` before `<main>`. Switch `TickReadout` to `usePlayheadSample(8)` (closes the readout-every-frame item).

- [ ] **Step 4: Browser verify** on `?run=e0`: select entity → panel appears with live state; click an event in the list → detail + chain nav; ← cause / effect → walk the chain like a debugger (the spec's signature interaction); playhead ticking at ≤8Hz in the panel while playing. Screenshot.

- [ ] **Step 5: Full gate. Step 6: Commit** — `git add src/ui && git commit -m "feat: agent/event inspector with causal chain navigation, sampled playhead hook"`

---

### Task 7: Keyboard transport grammar + help overlay + smoke extensions

**Files:**
- Create: `src/ui/keyboard.ts`, `src/ui/HelpOverlay.tsx`
- Modify: `src/ui/App.tsx` (single keydown handler + overlay state), `src/ui/Timeline.tsx` (REMOVE its space handler — one owner), `src/state/viewStore.ts` (setSpeed clamp), `tsconfig.node.json` (e2e coverage), `e2e/smoke.spec.ts`
- Test: `src/ui/keyboard.test.ts`, `src/state/transport.test.ts` (speed clamp)

**Interfaces:**
- Consumes: store actions; `syncUrl(true)`.
- Produces: `SPEEDS = [0.25, 1, 4, 8] as const`; `type KeyAction = { type: 'toggle' } | { type: 'step'; delta: 1 | -1 } | { type: 'speed'; value: number } | { type: 'speedNotch'; dir: 1 | -1 } | { type: 'deselect' } | { type: 'help' } | { type: 'focus' }`; `mapKey(code: string, key: string, isEditable: boolean): KeyAction | null`; store `setSpeed` clamps to SPEEDS (nearest).

- [ ] **Step 1: Failing tests**

```ts
import { mapKey, SPEEDS } from './keyboard'
test('grammar', () => {
  expect(mapKey('Space', ' ', false)).toEqual({ type: 'toggle' })
  expect(mapKey('KeyK', 'k', false)).toEqual({ type: 'toggle' })
  expect(mapKey('ArrowRight', 'ArrowRight', false)).toEqual({ type: 'step', delta: 1 })
  expect(mapKey('ArrowLeft', 'ArrowLeft', false)).toEqual({ type: 'step', delta: -1 })
  expect(mapKey('KeyJ', 'j', false)).toEqual({ type: 'speedNotch', dir: -1 })
  expect(mapKey('KeyL', 'l', false)).toEqual({ type: 'speedNotch', dir: 1 })
  expect(mapKey('Digit2', '2', false)).toEqual({ type: 'speed', value: SPEEDS[1] })
  expect(mapKey('Escape', 'Escape', false)).toEqual({ type: 'deselect' })
  expect(mapKey('Slash', '?', false)).toEqual({ type: 'help' })
  expect(mapKey('KeyF', 'f', false)).toEqual({ type: 'focus' })
})
test('editable targets swallow everything', () => {
  expect(mapKey('Space', ' ', true)).toBeNull()
  expect(mapKey('KeyJ', 'j', true)).toBeNull()
})
test('unmapped keys are null', () => { expect(mapKey('KeyZ', 'z', false)).toBeNull() })
```

And in `src/state/transport.test.ts`-adjacent (store): `setSpeed(0)` → clamps to 0.25; `setSpeed(999)` → 8; `setSpeed(4)` → 4. (Test via `useViewStore.getState().setSpeed(...)` + read-back — zustand stores work headless in vitest.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

`src/ui/keyboard.ts`:

```ts
export const SPEEDS = [0.25, 1, 4, 8] as const
export type KeyAction =
  | { type: 'toggle' } | { type: 'step'; delta: 1 | -1 }
  | { type: 'speed'; value: number } | { type: 'speedNotch'; dir: 1 | -1 }
  | { type: 'deselect' } | { type: 'help' } | { type: 'focus' }

export function mapKey(code: string, key: string, isEditable: boolean): KeyAction | null {
  if (isEditable) return null
  switch (code) {
    case 'Space': case 'KeyK': return { type: 'toggle' }
    case 'ArrowRight': return { type: 'step', delta: 1 }
    case 'ArrowLeft': return { type: 'step', delta: -1 }
    case 'KeyJ': return { type: 'speedNotch', dir: -1 }
    case 'KeyL': return { type: 'speedNotch', dir: 1 }
    case 'Escape': return { type: 'deselect' }
    case 'KeyF': return { type: 'focus' }
  }
  if (key === '?') return { type: 'help' }
  const d = /^Digit([1-4])$/.exec(code)
  if (d) return { type: 'speed', value: SPEEDS[Number(d[1]) - 1]! }
  return null
}
```

Store clamp in `viewStore.ts`:

```ts
setSpeed: (speed) => set({ speed: SPEEDS.reduce((best, s) => Math.abs(s - speed) < Math.abs(best - speed) ? s : best, SPEEDS[0]) }),
```

(import SPEEDS from '../ui/keyboard' — or move SPEEDS to `src/state/speeds.ts` if the ui→state import direction bothers lint; keep state importing from state: create `src/state/speeds.ts` with the constant, both files import it. DO move it — `src/state/speeds.ts` is the home; keyboard.ts re-exports for its consumers.)

App-level handler (single owner — REMOVE Timeline's space handler entirely):

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable
    const action = mapKey(e.code, e.key, editable)
    if (!action) return
    e.preventDefault()
    if (t instanceof HTMLButtonElement) t.blur() // kills the spacebar double-toggle
    const st = useViewStore.getState()
    switch (action.type) {
      case 'toggle': st.setPlaying(!st.playing); if (st.playing) syncUrl(true); break
      case 'step': st.setPlaying(false); st.setTick(Math.max(0, Math.min((model?.tickCount ?? 0), st.tick + action.delta))); syncUrl(true); break
      case 'speed': st.setSpeed(action.value); break
      case 'speedNotch': { const i = SPEEDS.indexOf(st.speed as typeof SPEEDS[number]); st.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + action.dir))]!); break }
      case 'deselect': st.select(null, null); syncUrl(true); break
      case 'help': setHelpOpen(h => !h); break
      case 'focus': focusSelected(); break
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [model])
```

`focusSelected`: expose the OrbitControls target — in Scene, `<OrbitControls makeDefault>` registers on r3f state; simplest cross-component channel without new state machinery: a module-level `export const focusRequest = { key: null as string | null, stamp: 0 }` in Scene.tsx; `focusSelected()` sets `focusRequest.key = selectedEntity; focusRequest.stamp++`; Entities' useFrame checks `focusRequest.stamp !== lastStamp` and eases `controls.target` toward the selected entity's position (`useThree(s => s.controls)`); allocation-free via scratch. Damped by OrbitControls itself.

`HelpOverlay.tsx`: a `<dialog>`-styled fixed panel listing the grammar (Space/K play-pause · ←/→ step · J/L speed · 1-4 speeds · shift-click timeline = select event · click cone = select agent · F focus · Esc deselect · ? help), closed by Esc/?/backdrop click. Component-local open state passed from App (`helpOpen`, `setHelpOpen`).

- [ ] **Step 4: e2e tsconfig coverage** — add to `tsconfig.node.json`'s `include`: `"playwright.config.ts", "e2e/**/*.ts"` (they run under node; @playwright/test brings its own types).

- [ ] **Step 5: Smoke extensions**

```ts
test('keyboard grammar drives the transport', async ({ page }) => {
  await page.goto('/?run=f0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.readout')).toHaveText('tick 1 / 2')
  await expect(page).toHaveURL(/tick=1/)
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByText('play-pause')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('play-pause')).not.toBeVisible()
})
```

(Playwright sends `?` as Shift+Slash; adjust to `page.keyboard.type('?')` if press form is finicky — assert whichever fires the overlay.)

- [ ] **Step 6: Full gate + build + smoke (4 tests). Step 7: Browser verify** focus-F easing + J/L notching on `?run=e0` with HUD steady. **Step 8: Commit** — `git add src/ui src/state tsconfig.node.json e2e && git commit -m "feat: keyboard transport grammar, help overlay, speed clamp, e2e typecheck coverage"`

---

## Plan self-review notes (applied)

- **Spec coverage (v0.2a slice):** end-clamp owner decision (T1), §4.1 det-only honesty + §7 unknown-run (T2), causal chain = §5.2's signature interaction (T3-T5), selection lensing §5.1 (T4), inspector §5.1 (T6), keyboard §6 grammar (T7), issue-#2 riders placed: rgba precompute + idle repaint skip (T5), TickReadout throttle (T6), setSpeed clamp + spacebar focus fix (T7), deep-link tick clamp (T1), unknown-run fallback (T2), e2e tsconfig (T7), syncUrl force (T1). Deliberately NOT here (v0.2b design pass): cinematic post, palette/type/motion tokens, verification ceremony, SDF labels, favicon, provenance claimed-glyphs. Not here (other): drag-drop/.obsrun.zip (needs design pass context for drop UX), compare mode, tour.
- **Frame-loop audit of new code:** ChainLinks buffer preallocated, chain recompute on selection-change effects only, timeline chain via module ref, fills precomputed, idle repaint skipped, inspector sampled at 8Hz. The `entityStatesAt` maps hit the LRU (adjacent ticks).
- **Type consistency:** `select(entity, event)` signature matches v0.1 store; `RunModel.ticks` is the Float64Array column (tick per seq) — chainTicks indexes it by seq, correct; `subjectOf` returns the `'1:<id>'` key format used by `entityKeys`/`entityStatesAt`.
- **E0 in-scene links may be empty** (few distinct subjects) — documented as expected in T5; timeline arcs are E0's hero visual.
