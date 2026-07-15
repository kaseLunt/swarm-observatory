# Swarm Observatory v0.2b — Design Language + Cinematic Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the functionally-complete observatory into the polished, cinematic hero demo spec §6 describes — one coherent visual system (semantic palette, type scale, motion language), HDR bloom + tonemapping rendering, the verification-ceremony load screen — while folding in the v0.2a-triaged carry items.

**Architecture:** A single design-token module (`theme.ts` + `theme.css`) becomes the source of truth every surface reads; a test asserts the CSS and JS sides agree. Subsequent tasks replace every ad-hoc color/spacing/duration with a token reference, then layer the cinematic render pass (`@react-three/postprocessing`) and the staged load ceremony on top. All §8 frame-loop rules hold — bloom lives in the GPU render pipeline, not per-frame JS.

**Tech Stack:** unchanged except ONE authorized new dependency — `@react-three/postprocessing` (+ its peer `postprocessing`), sanctioned by spec §3's cinematic-rendering requirement. drei's SDF `Text` (already installed) supplies crisp labels. No motion/animation library — CSS transitions + existing drei damping cover it.

## Global Constraints

- **Do not re-vibe.** Spec §6 (`docs/superpowers/specs/2026-07-04-swarm-observatory-design.md`) is the binding design authority: "rich, cinematic rendering where every pixel is data-bound … no decorative fiction. Every glow, pulse, trail, and particle maps to a real event or state field." Aesthetic north star: high-end mission control — Bloomberg-terminal density, planetarium darkness. Task 1 runs the frontend-design skill ONCE to lock concrete values; every later task executes those tokens, not fresh taste.
- **Every visual is data-bound** — no color/glow/motion that doesn't map to a real event kind or state field. Bloom intensity, category hue, pulse — all driven by decoded data.
- **§8 frame-loop rules remain ABSOLUTE:** no React state in rAF/useFrame; zero per-frame allocation; recomputation in effects, not frames. Post-processing is a render-pipeline addition (EffectComposer), not per-frame JS — but the perf HUD must confirm the 60fps budget survives bloom (§8 instrumentation rule: re-check targets before the release tag).
- **Accessibility (spec §6):** the semantic palette is color-blind-safe — hue is NEVER the only channel; every event-category encoding carries a redundant shape/icon. `prefers-reduced-motion: reduce` is honored (cinematic moves become cuts).
- **One authorized new dependency:** `@react-three/postprocessing` + `postprocessing`. No others.
- TypeScript strict; branded types intact; `import type` under verbatimModuleSyntax; no constructor parameter properties (erasableSyntaxOnly); Vitest 4 `toThrow`.
- Full gate before every commit: `npm run test && npm run typecheck && npm run lint`; add `&& npm run build && npm run smoke` on tasks that touch runtime/UI wiring. Design tasks are **browser-verified** (chrome-devtools MCP; screenshot to `.superpowers/sdd/task-v02b-N-browser.png`) — the established convention for visual work that has no clean unit seam; state this in each report.
- Conventional commits; NEVER add Co-Authored-By or any AI attribution. Stage by explicit path.
- Baseline at plan time: `main` @ 1520a00, 96 unit + 5 smoke green, clean-room reproducible. Runs: f0 (2 events), e0 (75-query det-only), f1 (67-event motion det-only).

---

### Task 1: Design tokens — lock the identity, one source of truth

**Files:**
- Create: `src/ui/theme.ts`, `src/ui/theme.css`
- Test: `src/ui/theme.test.ts`
- Modify: `src/main.tsx` (import theme.css before app.css)

**Interfaces:**
- Produces: `PALETTE` (record of semantic color tokens, hex strings), `CATEGORY` (event-category → `{ hue: string; glyph: string; label: string }`), `MOTION` (`{ fast: number; base: number; slow: number; easeOut: string }` — ms + cubic-bezier string), `hexToThree(hex: string): number` (0x-number for THREE). `theme.css` exposes the SAME palette as CSS custom properties on `:root`.

**Execution note (design-identity lock):** the implementer invokes the `frontend-design` skill ONCE here to refine the concrete values below within spec §6's locked direction (planetarium-dark mission control, semantic hue, bloom-ready). The values in this task are complete, working defaults — frontend-design may adjust exact hexes/scale, never the structure or the direction. **After this task, the controller pauses for an owner design-review of the token swatch** before the 6 dependent tasks build on it.

- [ ] **Step 1: Write the token modules**

`src/ui/theme.ts`:
```ts
// Single source of truth for the visual system (spec §6). CSS mirror: theme.css.
export const PALETTE = {
  bgVoid: '#080b0f',        // planetarium base
  bgPanel: '#10151c',
  bgElevated: '#16202b',
  border: '#1c2733',
  borderBright: '#2a3b4d',
  textPrimary: '#d7e0ea',
  textDim: '#8899aa',
  textFaint: '#5a6b7a',
  accent: '#56b6ff',        // selection / primary UI accent
  timeCursor: '#ffd166',    // playhead — its own token, NOT the decision-category hue (same value today, distinct meaning)
  verified: '#4ade80',
  mismatch: '#f87171',
  pending: '#64748b',
} as const

// Event-category semantics (spec-3a §2.3). Hue is NEVER the only channel — glyph is the
// redundant, color-blind-safe encoding carried everywhere a category appears.
export const CATEGORY = {
  query:    { hue: '#56b6ff', glyph: '◆', label: 'query/observation' },   // E0 kind-23
  decision: { hue: '#ffd166', glyph: '▲', label: 'decision/intent' },
  mutating: { hue: '#f87171', glyph: '●', label: 'resolver-mutating' },
  fact:     { hue: '#2dd4bf', glyph: '◇', label: 'resolver-fact' },
  comms:    { hue: '#a78bfa', glyph: '✳', label: 'comms' },
} as const
export type CategoryKey = keyof typeof CATEGORY

export const MOTION = {
  fast: 120,
  base: 220,
  slow: 400,
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const

export const hexToThree = (hex: string): number => parseInt(hex.slice(1), 16)
```

`src/ui/theme.css` (custom properties mirroring PALETTE + MOTION; app.css will migrate to these in later tasks):
```css
:root {
  --bg-void: #080b0f;
  --bg-panel: #10151c;
  --bg-elevated: #16202b;
  --border: #1c2733;
  --border-bright: #2a3b4d;
  --text-primary: #d7e0ea;
  --text-dim: #8899aa;
  --text-faint: #5a6b7a;
  --accent: #56b6ff;
  --time-cursor: #ffd166;
  --verified: #4ade80;
  --mismatch: #f87171;
  --pending: #64748b;
  --cat-query: #56b6ff;
  --cat-decision: #ffd166;
  --cat-mutating: #f87171;
  --cat-fact: #2dd4bf;
  --cat-comms: #a78bfa;
  --dur-fast: 120ms;
  --dur-base: 220ms;
  --dur-slow: 400ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --type-family: 'Segoe UI', system-ui, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
}
```

- [ ] **Step 2: Write the agreement test (the one automated guard for a visual module)**

`src/ui/theme.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PALETTE, CATEGORY, hexToThree } from './theme'

const css = readFileSync('src/ui/theme.css', 'utf8')
const cssVar = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!m) throw new Error(`missing --${name} in theme.css`)
  return m[1]!.toLowerCase()
}

describe('theme.ts and theme.css agree (single source of truth)', () => {
  test('palette hexes match the CSS custom properties', () => {
    const pairs: [keyof typeof PALETTE, string][] = [
      ['bgVoid', 'bg-void'], ['bgPanel', 'bg-panel'], ['accent', 'accent'],
      ['timeCursor', 'time-cursor'], ['verified', 'verified'], ['mismatch', 'mismatch'], ['pending', 'pending'],
    ]
    for (const [js, cssName] of pairs) expect(PALETTE[js].toLowerCase()).toBe(cssVar(cssName))
  })
  test('category hues match --cat-* variables', () => {
    for (const [key, { hue }] of Object.entries(CATEGORY))
      expect(hue.toLowerCase()).toBe(cssVar(`cat-${key}`))
  })
  test('every category carries a redundant glyph (color-blind safety)', () => {
    for (const c of Object.values(CATEGORY)) expect(c.glyph.length).toBeGreaterThan(0)
  })
  test('hexToThree parses to a THREE-usable number', () => {
    expect(hexToThree('#56b6ff')).toBe(0x56b6ff)
  })
})
```

- [ ] **Step 3: Run → FAIL (module missing). Step 4: Implement per Step 1 + wire main.tsx**

In `src/main.tsx`, import `./ui/theme.css` BEFORE `./ui/app.css` (cascade order — tokens defined first).

- [ ] **Step 5: Run → PASS. Full gate.**

- [ ] **Step 6: frontend-design pass + swatch**

Invoke the frontend-design skill to sanity-check the concrete values against spec §6's direction (adjust hexes/type scale only if it sharpens "mission control / planetarium"; keep the token structure and names). Build `npm run dev` and screenshot a swatch of PALETTE + CATEGORY (a temporary dev-only route or an inline block in App behind `?swatch=1`, removed before commit — OR just screenshot devtools rendering the CSS vars). Save to `.superpowers/sdd/task-v02b-1-swatch.png`.

- [ ] **Step 7: Commit** — `git add src/ui/theme.ts src/ui/theme.css src/ui/theme.test.ts src/main.tsx && git commit -m "feat: design-token module -- semantic palette, category hues, motion constants (single source of truth)"`

**→ CONTROLLER: pause for owner design-review of the swatch before dispatching Task 2.**

---

### Task 2: Semantic color system applied everywhere

**Files:**
- Modify: `src/ui/Scene.tsx`, `src/ui/Timeline.tsx`, `src/ui/Inspector.tsx`, `src/ui/ProvenancePanel.tsx`, `src/ui/badges.ts`, `src/ui/app.css`
- Create: `src/ui/categorize.ts`
- Test: `src/ui/categorize.test.ts`

**Interfaces:**
- Consumes: `CATEGORY`, `CategoryKey`, `PALETTE`, `hexToThree` from theme.ts.
- Produces: `categoryOf(kind: number): CategoryKey` — maps an EventKind to its category (spec-3a §2.3): kind 23 + 22 + 1 → `query`; 8/9/11-15 → `decision`; 2-7/10/17-19 → `mutating`; 20/21 → `fact`; 5/6/7 comms overlap resolved to `comms`; 0xF000 → `query` (F0 fixture, benign). The full mapping table is in the test.

- [ ] **Step 1: Failing test**

`src/ui/categorize.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { categoryOf } from './categorize'

describe('categoryOf maps EventKind → semantic category (spec-3a §2.3)', () => {
  test('query/observation family', () => {
    expect(categoryOf(23)).toBe('query')   // GeometryQueryResolved (E0)
    expect(categoryOf(1)).toBe('query')    // DetectionMade
    expect(categoryOf(0xf000)).toBe('query') // F0 fixture (benign default)
  })
  test('decision/intent family', () => {
    for (const k of [8, 9, 11, 12, 13, 14, 15]) expect(categoryOf(k)).toBe('decision')
  })
  test('resolver-mutating family', () => {
    for (const k of [2, 3, 4, 10, 17, 18, 19]) expect(categoryOf(k)).toBe('mutating')
  })
  test('comms family (message kinds)', () => {
    for (const k of [5, 6, 7]) expect(categoryOf(k)).toBe('comms')
  })
  test('resolver-fact family', () => {
    for (const k of [20, 21]) expect(categoryOf(k)).toBe('fact')
  })
  test('unknown kind falls back to query (never throws)', () => {
    // CONSCIOUS DEFAULT: F1's experiment-block motion kinds (0x0120/0x0121) have no §2.3 row;
    // 'query' hue+glyph is the neutral fallback until a motion category is designed. Documented, not accidental.
    expect(categoryOf(0x0120)).toBe('query')
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `src/ui/categorize.ts`**

```ts
import type { CategoryKey } from './theme'

const MAP: Record<number, CategoryKey> = {
  1: 'query', 22: 'query', 23: 'query', 0xf000: 'query',
  8: 'decision', 9: 'decision', 11: 'decision', 12: 'decision', 13: 'decision', 14: 'decision', 15: 'decision',
  2: 'mutating', 3: 'mutating', 4: 'mutating', 10: 'mutating', 17: 'mutating', 18: 'mutating', 19: 'mutating',
  5: 'comms', 6: 'comms', 7: 'comms',
  20: 'fact', 21: 'fact',
}
export function categoryOf(kind: number): CategoryKey { return MAP[kind] ?? 'query' }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Apply tokens across the surfaces (browser-verified)**

- **Scene.tsx lensing (fixes the emissive-floor DIMMED carry item):** replace the `SELECTION_COLORS`/`SELECTED`/`DIMMED`/`NEUTRAL` hexes via tokens. TECHNIQUE (InstancedMesh has NO per-instance emissive — per-instance brightness comes from HDR instance colors): SELECTED = `new THREE.Color(PALETTE.accent).multiplyScalar(2.2)` (an HDR instance color > 1.0 — under Task 5's bloom it glows; before Task 5 it simply renders bright — both correct); NEUTRAL = the accent at ~0.55 scalar; DIMMED = `#141d27` (genuinely recessed). Drop the material's flat emissive from `#1a3a5c` to `#0a1420` so DIMMED cones no longer float on the emissive floor. Verify in-browser: selected clearly pops, others recede (the contrast the reviewer flagged as muted).
- **Timeline.tsx:** the density ribbon and chain arcs read `CATEGORY.query.hue` / `PALETTE.accent`; when events of mixed categories exist (future), the per-kind lane color = `CATEGORY[categoryOf(kind)].hue`. Playhead reads `PALETTE.timeCursor` (its own token — the playhead is not an event category). Precomputed fill strings now derive from tokens.
- **Inspector.tsx:** event-list rows show the category glyph before the kind name (`CATEGORY[categoryOf(kind)].glyph` — the color-blind-safe redundancy); `.flag-true`/`.flag-false` map to `--verified`/`--mismatch`.
- **ProvenancePanel.tsx / badges.ts:** badge glyph colors read `--verified`/`--mismatch`/`--pending` (already the values, now via vars).
- **app.css:** replace every literal hex with the matching `var(--…)`. Header/inspector accent `#7fb4e6` → `var(--accent)`; borders → `var(--border)`; `#4ade80`/`#f87171` → `var(--verified)`/`var(--mismatch)`; `#ffd166` (help-keys) → `var(--cat-decision)`.

- [ ] **Step 6: Browser verify** on e0 + f1 + f0: category glyphs render in the inspector; lensing contrast is now obvious (screenshot the e0 selection); no color regressions; all badges correct. Screenshot `.superpowers/sdd/task-v02b-2-browser.png`.

- [ ] **Step 7: Full gate + build + smoke. Step 8: Commit** — `git add src/ui && git commit -m "feat: semantic color system across scene, timeline, inspector, provenance -- category glyphs + tokenized css"`

---

### Task 3: Typography scale + responsive layout

**Files:**
- Modify: `src/ui/app.css`
- Create: `src/ui/type.css`
- Modify: `src/ui/Scene.tsx` (Perf overlay reposition), `src/main.tsx` (import type.css)

**Interfaces:** none (pure CSS + one dev-gate reposition).

- [ ] **Step 1: Type scale (`src/ui/type.css`)** — one family (`var(--type-family)`), a real modular scale as custom props, applied to headings/labels/body/mono:
```css
:root {
  --fs-mono: 0.72rem; --fs-label: 0.7rem; --fs-body: 0.82rem; --fs-h2: 0.72rem; --fs-h1: 0.95rem;
  --tracking-label: 0.15em; --tracking-h1: 0.22em;
}
body { font-family: var(--type-family); }
.readout, .chainmeta, .help-keys, .provenance td, .inspector td { font-variant-numeric: tabular-nums; }
h1, .app header h1 { font-size: var(--fs-h1); letter-spacing: var(--tracking-h1); }
h2, .inspector h2, .help-panel h2 { font-size: var(--fs-h2); letter-spacing: var(--tracking-label); text-transform: uppercase; }
```
Import in main.tsx after theme.css, before app.css.

- [ ] **Step 2: Responsive grid (fixes the narrow-viewport squeeze carry item)** — in app.css, guard the center track and collapse side panels under a breakpoint:
```css
.app { grid-template-columns: minmax(0, auto) minmax(360px, 1fr) 320px; }
@media (max-width: 900px) {
  .app { grid-template: "header" auto "viewport" 1fr "timeline" auto / 1fr; }
  .inspector, .provenance { position: fixed; top: 0; bottom: 0; z-index: 40; width: min(320px, 85vw); background: var(--bg-panel); transform: translateX(var(--panel-shift, 0)); transition: transform var(--dur-base) var(--ease-out); }
  .inspector { left: 0; --panel-shift: -100%; } .provenance { right: 0; --panel-shift: 100%; }
  .inspector.open, .provenance.open { --panel-shift: 0; }
  .panel-toggles { display: flex; gap: 0.4rem; }
}
@media (min-width: 901px) { .panel-toggles { display: none; } }
```
DISMISSABILITY (the provenance panel always renders — a permanently-fixed overlay would cover the scene): under 900px both panels default OFF-CANVAS (translated out) and two small header toggle buttons (`.panel-toggles`: `☰ agent` / `☰ provenance`, plain App component state `panelOpen: 'inspector' | 'provenance' | null`) slide one in at a time; the `open` class is driven by that state. Desktop ≥901px: toggles hidden, panels in-grid exactly as today (the `position: fixed` block is inside the media query, so desktop is untouched). The `minmax(360px, 1fr)` center track guarantees the desktop scene never squeezes to nothing (the reviewer's finding); spec §3's "mobile degrades to view-only, never broken" is satisfied — scene + timeline full-width, panels on demand.

- [ ] **Step 3: Perf overlay reposition (fixes the dev-overlay overlap carry item)** — in Scene.tsx, the dev-only `<Perf>` moves off the inspector heading: `position="bottom-right"` (was top-left, which overlapped the inspector's top-left `h2`).

- [ ] **Step 4: Browser verify** — desktop layout unchanged and crisper; resize to 800px wide → panels overlay, scene stays full-height and readable (screenshot both widths); dev Perf overlay no longer overlaps the inspector. `.superpowers/sdd/task-v02b-3-browser.png`.

- [ ] **Step 5: Full gate + build. Step 6: Commit** — `git add src/ui src/main.tsx && git commit -m "feat: typographic scale + responsive layout (panels overlay under 900px, scene never collapses)"`

---

### Task 4: Motion language + micro-interactions

**Files:**
- Modify: `src/ui/app.css`
- Create: `src/ui/motion.ts`
- Test: `src/ui/motion.test.ts`
- Modify: `src/ui/Scene.tsx` (focus-pull respects reduced-motion)

**Interfaces:**
- Produces: `prefersReducedMotion(): boolean` (reads `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, SSR-safe guard); `FOCUS_LERP` constant (0.15 normal, 1 when reduced = instant cut).

- [ ] **Step 1: Failing test**

`src/ui/motion.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { prefersReducedMotion, focusLerpFactor } from './motion'

describe('reduced-motion honoring', () => {
  test('prefersReducedMotion false when matchMedia absent (node)', () => {
    expect(prefersReducedMotion()).toBe(false) // jsdom/node: no matchMedia → safe default
  })
  test('focusLerpFactor is instant (1) under reduced motion, eased (0.15) otherwise', () => {
    expect(focusLerpFactor(true)).toBe(1)
    expect(focusLerpFactor(false)).toBeCloseTo(0.15)
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `src/ui/motion.ts`**
```ts
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
export const focusLerpFactor = (reduced: boolean): number => (reduced ? 1 : 0.15)
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: CSS micro-interactions** — in app.css, add token-driven transitions + hover states (no new dep, CSS springs via the eased cubic-bezier):
```css
button { transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out); }
button:hover { border-color: var(--border-bright); background: var(--bg-elevated); }
button.active { border-color: var(--accent); color: var(--accent); }
.inspector, .provenance { transition: transform var(--dur-base) var(--ease-out); }
.evlist li button:hover { background: var(--bg-elevated); }
.help-backdrop { animation: fade-in var(--dur-base) var(--ease-out); }
.help-panel { animation: rise var(--dur-base) var(--ease-out); }
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
```
(Under `prefers-reduced-motion: reduce`, the `--dur-*` tokens are already 0ms from Task 1, so transitions/animations become instant — no separate rule needed; verify the keyframes still settle at their end state with 0 duration.)

- [ ] **Step 6: Scene focus-pull honors reduced motion** — the focus-ease in Entities' useFrame multiplies by `focusLerpFactor(prefersReducedMotion())` instead of the literal 0.15 (compute the boolean ONCE in an effect into a ref — matchMedia read is not per-frame; store `reducedRef.current`). A reduced-motion user gets an instant camera cut, not a glide. Keep the frame path allocation-free.

- [ ] **Step 7: Browser verify** — hover states on buttons/list rows spring in; help overlay rises; selection eases; then toggle OS reduced-motion (or emulate via devtools `prefers-reduced-motion`) → transitions become cuts, camera focus snaps. `.superpowers/sdd/task-v02b-4-browser.png`.

- [ ] **Step 8: Full gate + build. Step 9: Commit** — `git add src/ui && git commit -m "feat: motion language -- eased micro-interactions, hover states, reduced-motion honoring"`

---

### Task 5: Cinematic rendering pass

**Files:**
- Modify: `src/ui/Scene.tsx`, `package.json` (+ lockfile)
- Create: (none — effects inline in Scene)

**Interfaces:** none new; adds `<EffectComposer>` + `<Bloom>` to the Canvas and ACES tonemapping + fog to the scene.

- [ ] **Step 1: Add the authorized dependency**
```bash
cd path/to/swarm-observatory
npm install @react-three/postprocessing postprocessing
```
Confirm these are the ONLY additions to package.json dependencies.

- [ ] **Step 2: Cinematic scene wiring (Scene.tsx)** — inside `<Canvas>`:
  - Set the renderer tonemapping: `gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}` on the Canvas (or via `<Canvas flat={false}>` default + explicit). HDR-ready.
  - Depth-cued atmosphere: `<fog attach="fog" args={[PALETTE.bgVoid, 30, 400]} />` — CRITICAL VALUE CONSTRAINT: F1's entity travels to ~250 world units from origin; fog `far` MUST comfortably exceed that (400) or the moving cone vanishes. Browser-verify F1's cone stays visible across its whole path (scrub tick 0 → 64) with fog on; it should recede/dim with distance, never disappear.
  - Post: after the scene children,
    ```tsx
    <EffectComposer>
      <Bloom intensity={0.6} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
    </EffectComposer>
    ```
    Bloom makes selected/query glyphs and query pulses glow — data-bound (only bright, data-driven pixels bloom). Import `EffectComposer, Bloom` from `@react-three/postprocessing`.
  - Bloom sources (per-instance emissive does NOT exist on InstancedMesh): the SELECTED cone already crosses the threshold via its HDR instance color (Task 2's multiplyScalar(2.2) — verify it blooms); the query pulse is a separate non-instanced mesh — raise ITS material toward HDR (`color.multiplyScalar(1.8)` on the existing setHex path, or emissiveIntensity if switched to MeshStandardMaterial) so active queries glow; chain links get a modest boost only if visually warranted. The glow is earned by selection/query state, not decoration.

- [ ] **Step 3: SDF crisp label (drei, already installed)** — entities are currently unlabeled; add ONE label at the selected entity: drei `<Billboard>` wrapping drei `<Text>` (SDF — crisp at any zoom; Text does not auto-billboard, hence the wrapper) showing the entity key, `fontSize={0.5}` world units, color `PALETTE.textPrimary`, positioned ~1.2u above the cone. Position updates ride the EXISTING Entities frame loop: a `groupRef` whose `.position` is written from the already-computed selected-entity scratch position (zero new allocation, no new subscriptions); `visible=false` when nothing selected. Bounded cost: exactly one label ever.

- [ ] **Step 4: ChainLinks interpolation consistency (fixes the carry item)** — ChainLinks currently reads only `entityStatesAt(t0)` (tick-exact) while cones interpolate `t0→t1`. Make the link endpoints interpolate identically: read `s0`/`s1` and `lerp3` each endpoint by the same `fraction` the cones use (reuse the scratch vectors; zero-alloc). Now links track moving cones exactly. (Still inert on current fixtures — but correct when multi-subject content lands.)

- [ ] **Step 5: PERF RE-CHECK (spec §8 mandatory gate)** — `npm run dev`, r3f-perf HUD visible, on the largest run (e0, 75 entities-worth of draw): confirm sustained 60fps with bloom ON, no GC sawtooth. Record the frame-time reading in the report. If bloom drops below 60fps on mid hardware, lower `intensity`/resolution or gate mipmapBlur — but document the measured numbers either way (§8: no silent perf regressions).

- [ ] **Step 6: Browser verify** — e0 with a selected query event: glyph + pulse bloom, fog depth-cues the field, ACES tonemapping warms the whites, SDF label crisp on zoom. f1: moving cone blooms on selection, chain links (if any) track it. Screenshot `.superpowers/sdd/task-v02b-5-browser.png` — this is the "hero shot."

- [ ] **Step 7: Full gate + build + smoke** (smoke must still pass — the `#viewport canvas` selector is unaffected; bloom adds canvas layers, not DOM). **Step 8: Commit** — `git add src/ui package.json package-lock.json && git commit -m "feat: cinematic render pass -- HDR bloom, ACES tonemapping, depth fog, SDF labels, interpolated chain links"`

---

### Task 6: The verification ceremony (load screen)

**Files:**
- Create: `src/ui/Ceremony.tsx`
- Modify: `src/ui/useRun.ts` (expose staged phase), `src/ui/App.tsx` (render Ceremony during load), `src/ui/app.css`, `src/ui/ProvenancePanel.tsx` (det-only dt disclosure)

**Interfaces:**
- Consumes: `useRun`'s progress + verify results.
- Produces: `useRun` returns a `phase: 'idle' | 'fetching' | 'decoding' | 'verifying' | 'ready'` alongside `progress`; `<Ceremony phase progress hashes? />` renders the staged load sequence.

- [ ] **Step 1: Stage the load in useRun** — thread a `phase` through the existing async flow. HONESTY CONSTRAINT: verification is NOT a separable async stage (foldAndVerify runs inside the worker's decode; its result arrives WITH 'done') — do NOT fake a worker phase. The phases are display-staging of REAL arrival events: `fetching` (set before the index/bundle fetches) → `decoding` (first worker progress message) → `verifying` (set when the worker's done message arrives, i.e. the recomputed hashes now EXIST — this beat displays them confirming) → `ready` (model published). The perceptibility floor in Step 4 is what makes `verifying` visible; the data shown during it is always the real recomputed result. ERROR PATH: any failure at any phase routes to the existing error state (the App error branch renders instead of the ceremony — verify the ceremony can never strand on-screen after an error). Keep the alive-guard on every setState. Both det-only and manifest paths set phases.

- [ ] **Step 2: Ceremony component** — replaces the bare "decoding… 42%" screen with the spec §6 ceremony: three staged lines that light up in sequence as phase advances —
  - `▪ frames decoding` … fills with the worker progress bar
  - `▪ hashes confirming` … on `verifying`/`ready`, shows the recomputed `event_hash` / `result_id` short-hex ticking to ✓ (the integrity story, concretely — spec §6 "the loading screen itself demonstrates the integrity story")
  - `▪ scene assembling` … on `ready`, fades to the app
  Data-bound: the hashes shown are the REAL recomputed values from `verify`, not decoration. Style with tokens + the motion easings (staged fade-in). Honors reduced-motion (cuts, via the 0ms tokens).

- [ ] **Step 3: Det-only dt disclosure (fixes the carry item)** — in ProvenancePanel, when `manifest === null` (det-only), the dt row shows `dt 1000µs (assumed)` in `--text-faint` rather than presenting the guessed 1× playback as authoritative. Manifest runs show the real `dt_us` with no "(assumed)".

- [ ] **Step 4: Browser verify** — hard-reload `?run=e0`: the ceremony plays (frames → hashes confirming with real hex → scene assembles), not an instant flash; the provenance dt row reads "(assumed)" for e0/f1, plain for f0. Screenshot the ceremony mid-play `.superpowers/sdd/task-v02b-6-browser.png`. (If the fixture decodes too fast to see the ceremony, add a minimum-visible-duration of ~600ms per phase gated behind NOT reduced-motion — document it; the goal is a demonstrable ceremony, and honest: it shows real progress, just floored so it's perceptible.)

- [ ] **Step 5: Full gate + build + smoke** — the smoke's `.provenance` wait may now sit behind the ceremony; ensure the smoke still reaches "trailer consistent ✓" (bump its timeout if the min-duration floor delays readiness; keep assertions). **Step 6: Commit** — `git add src/ui && git commit -m "feat: verification ceremony load screen -- staged decode/verify/assemble with real recomputed hashes; det-only dt disclosure"`

---

### Task 7: Polish, hardening carries, favicon

**Files:**
- Modify: `src/ui/HelpOverlay.tsx`, `src/ui/App.tsx`, `src/state/viewStore.ts`, `src/decode/decodeBundle.ts`, `public/favicon.svg`, `index.html`
- Test: `src/state/viewStore.test.ts`, `src/decode/decodeBundle.test.ts`

**Interfaces:** none new; hardening + a11y + asset.

- [ ] **Step 1: Trailing-edge URL flush (fixes the throttle-drop carry)** — TDD in `src/state/viewStore.test.ts`. `syncUrl()` currently drops the last write of a rapid unforced burst. Add a trailing flush: when a throttled (dropped) unforced call happens, schedule a `setTimeout(flush, 500 - elapsed)` that writes the latest state if no forced write intervened; clear any pending timer on a forced write. Test: two rapid `syncUrl()` calls within 500ms → after the timer fires, the URL reflects the LATEST tick (not the first). (Use vitest fake timers.)

```ts
// test shape — NOTE: this repo's vitest runs in NODE env (no history/location globals exist;
// syncUrl would throw ReferenceError). Stub them explicitly:
test('trailing flush writes the latest state after a dropped throttled call', () => {
  vi.useFakeTimers()
  const replaceState = vi.fn()
  vi.stubGlobal('history', { replaceState })
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('performance', { now: () => Date.now() }) // align perf clock with fake timers if needed
  useViewStore.setState({ runId: 'f0', tick: 1, playing: false }); syncUrl(true)  // forced write lands
  useViewStore.setState({ tick: 5 }); syncUrl()                                    // throttled → trailing flush scheduled
  expect(replaceState).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(600)
  expect(replaceState).toHaveBeenCalledTimes(2)
  expect(replaceState.mock.lastCall![2]).toContain('tick=5')                      // latest state, not the dropped one
  vi.unstubAllGlobals(); vi.useRealTimers()
})
```
(Also assert a forced write CANCELS a pending trailing flush — third test case: schedule a flush, then syncUrl(true), advance timers, replaceState called exactly twice, not three times.)

- [ ] **Step 2: Tick-range decode guard (fixes the M5 carry — sibling of the causation guard)** — TDD in `src/decode/decodeBundle.test.ts`. In decodeBundle's post-walk validation loop (where `seq[i]===i` and the causation guard already live), add: `if (e.tick >= tickCount) throw new DecodeError('MalformedPayload', \`event tick \${e.tick} >= tickCount \${tickCount}\`)` (tickCount = stateFrames − 1, known after the walk). This closes the raw-TypeError-on-crafted-bundle hole at the decode boundary, matching the causation guard's discipline. Test: tamper an F0 event's tick to a huge value + recompute the frame CRC → `.toThrow(/tick/)`.

- [ ] **Step 3: Help affordance + overlay modality (fixes the a11y carry)** — HelpOverlay: (a) add a visible `?`-labeled button in the header that opens it (discoverable without knowing the shortcut — the AltGr-`?` layouts the reviewer flagged); (b) trap focus while open (focus the close button on open, restore on close; `Tab` cycles within the panel); (c) swallow transport keys while open (the App keydown handler returns early when `helpOpenRef.current` for non-Esc keys) so Space doesn't play underneath the modal.

- [ ] **Step 4: Keyboard grammar inert on load/error screens (fixes M3)** — in App's keydown handler, `if (!model) return` before dispatching (Space during load must not pre-arm playback).

- [ ] **Step 5: Designed favicon** — replace `public/favicon.svg` with a mission-control mark: a small SDF-style radar/observatory glyph on `--bg-void`, accent-cyan stroke (an inline SVG — concentric arcs + a swept dot, monochrome accent). Update `index.html` `<title>` to `swarm observatory`. (SVG favicon, no PNG needed.)

- [ ] **Step 6: Full gate + build + smoke** — the help-affordance smoke: extend the existing keyboard smoke to click the header `?` button → overlay visible → Esc closes; assert Space-while-open does NOT start playback. **Step 7: Browser verify** the favicon in the tab + help modality. **Step 8: Commit** — `git add src/ui src/state src/decode public/favicon.svg index.html && git commit -m "fix/feat: trailing URL flush, tick-range decode guard, help affordance + modality, keyboard-inert-on-load, favicon"`

---

## Plan self-review notes (applied)

- **Spec §6 coverage:** one coherent system = tokens (T1) + applied color (T2) + type (T3) + motion (T4); cinematic pass = bloom/tonemapping/fog/SDF (T5); micro-interaction polish = T4; verification ceremony = T6; color-blind-safe = category glyphs (T2) + reduced-motion (T4/T6). Every visual data-bound: category hue ← EventKind (T2), bloom ← selection/query state (T5), ceremony hashes ← real verify (T6).
- **Carry items placed (all 9):** emissive-floor DIMMED contrast (T2 §5); narrow-viewport squeeze (T3); Perf overlay overlap (T3); tick-invariant Inspector 8Hz split — NOTE: deferred as a SEPARATE consideration; the Fable triage marked it "one restructure item, negligible at fixture scale" — it is NOT in this design plan (it's a perf refactor, not design; capture as a standalone v0.2c/perf item so this plan stays design-scoped) → **flagged to owner, not silently dropped**; ChainLinks interpolation (T5 §4); help affordance + modality (T7); trailing URL flush (T7); det-only dt disclosure (T6); tick-range decode guard (T7).
- **§8 preserved:** the one frame-path change (focus-lerp reduced-motion, T4) reads matchMedia once into a ref; ChainLinks interpolation (T5) reuses scratch, zero-alloc; bloom is render-pipeline. Explicit perf re-check gate in T5 §5 (the §8 instrumentation rule).
- **One dep only:** @react-three/postprocessing + postprocessing (T5), spec §3-authorized. drei Text already present.
- **Type/name consistency:** PALETTE/CATEGORY/MOTION/hexToThree (T1) consumed by categorize.ts (T2), motion.ts (T4), Scene/Timeline/Inspector; `phase` union (T6) matches across useRun/Ceremony/App.
- **Owner gates:** T1 swatch review before the cascade; the Inspector-8Hz-split explicitly surfaced as out-of-scope-for-design rather than absorbed.
