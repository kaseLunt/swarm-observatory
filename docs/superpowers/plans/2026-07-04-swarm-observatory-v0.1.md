# Swarm Observatory v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app that loads a real Contested Skies V2 run bundle, verifies its hashes byte-exactly in a worker, and plays it back: timeline scrubbing, instanced 3D entities, E0 geometry-query markers, provenance panel, deep links, perf HUD, CI with preview builds.

**Architecture:** Static Vite + React + TypeScript app. Data flows one direction: `BundleSource (fetch) → Decoder (TS, independent implementation of spec-3a §3.6/§6.5) → RunModel (indexed, lazy) → views`. Decode + blake3 verification run in a Web Worker and return transferable typed-array columns. All view state lives in one zustand store and round-trips through the URL.

**Tech Stack:** Vite, React 19, TypeScript (strict), vitest, zustand, @react-three/fiber + three + @react-three/drei, r3f-perf, @noble/hashes (blake3), Playwright (smoke), GitHub Actions.

## Global Constraints

Every task's requirements implicitly include these (from the spec, `docs/superpowers/specs/2026-07-04-swarm-observatory-design.md`):

- TypeScript `strict: true`; no `any` on exported signatures.
- Branded types for `Tick`, `Seq`, `EventKindId` (spec §3).
- **No React state in the frame loop** — per-frame reads use `useViewStore.getState()` / subscriptions, never props/useState (spec §8.1).
- **No per-frame allocation** in `useFrame` — preallocated scratch objects only (spec §8.2).
- Decode/hash work runs in a Web Worker; worker→main uses **transferable ArrayBuffers**, never structured-clone JSON (spec §8.2–8.3).
- Identity gate tuple (spec §4.2): `event_schema_version=4`, `state_schema_version=2`, `schema_registry_hash=dd0e96c3e6545e0dd5b347c2e5c089a669430481be1243f49794f62b0b7c6dd2`, `state_registry_hash=0e1c162a21132984d7876cc4f7035490cd930a7068b97acacbd973ba5dfabb2c` — but always **read from `contract/identity.json`**, never hardcoded in src.
- All multi-byte wire values **little-endian** (`fixed-le/v1`). CRC32C = Castagnoli, init `0xFFFFFFFF`, reflected, final XOR `0xFFFFFFFF`, over `tag ++ payload_len ++ payload`.
- blake3 modes (spec-3a §3.6): registry hashes = **regular**; `derive(CTX_*)` = **derive_key** with the CTX ASCII string as context; RNG = keyed (not needed in v0.1).
- Commits: conventional commits (`feat:`, `test:`, `chore:`, `ci:`). **NEVER add Co-Authored-By or any AI attribution.**
- The main repo is read **only** by `tools/sync-contract.mjs`. Application/test code reads `contract/` and `public/runs/` only.
- Do not add dependencies beyond those named in this plan.

**Wire-format quick reference (normative source: `contract/spec-3a-event-schema.md` §0, §3.6, §6.5):**

```
FileHeader (24 B): magic "DETBNDL1" ++ format_version:u32=1 ++ event_schema_version:u32
                   ++ state_schema_version:u32 ++ header_crc32c:u32 (CRC32C over preceding 20 B)
Frame:             tag:u8 {1=Event,2=StateTick,3=Trailer} ++ payload_len:u32 ++ payload ++ crc32c:u32
                   (CRC over tag ++ payload_len ++ payload; framing is NOT hashed)
Event payload:     seq:u64 ++ tick:u64 ++ kind:u16 ++ causation:Option<u64> (u8 0|1 ++ u64)
                   ++ payload_bytes {u32 len ++ bytes}
StateTick payload: tick_index:u64 ++ entity_count:u32 ++ per entity sorted by (ns:u16, id:u64):
                   ns:u16 ++ id:u64 ++ field_len:u32 ++ field_bytes  (field_len excludes the key)
Entity v2 fields (ns=1, 53+ B): value:u64 ++ alive:u8 ++ pos:VecF64 ++ vel:VecF64 ++ heading_rad:f64
                   ++ speed_mps:f64 ++ turn_rate_radps:f64 ++ fuel:f64 ++ setpoint:VecF64
                   (VecF64 = u32 count ++ count × f64-LE)
Trailer payload:   case_id:[u8;32] ++ event_hash:[u8;32] ++ state_trajectory_hash:[u8;32]
                   ++ event_count:u64 ++ tick_count:u64 ++ termination_reason:u16
Hash fold (§3.3):  E = blake3.derive_key("det-event-log/v1");  per Event frame  (seq order):  E.update(0x01 ++ payload)
                   S = blake3.derive_key("det-state-traj/v1"); per StateTick frame (tick order): S.update(0x02 ++ payload)
                   result_id = blake3.derive_key("det-result/v1")( 0x03 ++ case_id ++ E.final ++ S.final
                               ++ event_count:u64 ++ tick_count:u64 ++ termination_reason:u16 )
Kind 23 payload (GeometryQueryResolved, spec-3b §11.1 row 23, fixed-le field order):
                   query_kind:u16 {1=POINT_IN_REGION,2=RANGE_BEARING,3=RAY_OCCLUDER,4=LOS}
                   ++ subject:u64 ++ object:u64 ++ argv:VecF64 ++ result_flag:u8(bool)
                   ++ result_scalars:VecF64 ++ tiebreak_applied:u8(bool)
```

**Golden expected values (byte-exact test targets):**

| Fixture | event_hash | state_trajectory_hash | result_id | events/ticks |
|---|---|---|---|---|
| `f0_seed42` | `071949371fa43eb266ccea54470b45de4c68cc36d7f6e6dac26d0ef180643bfb` | `b508664a027448d7ade1bcabd5a7d95c7983d0fe72f62a4953d03f72e5039cd8` | `49cc34fcff95f847a8c725a001e54d25d7d2c847dea1caa494eded20119f7624` | 2 / 2 (6 frames, 744 B) |
| `e0_seed42` | `d49a83dbf529cc27f8b80a63b5e3753ee1403c9b7c10be4879de44c02aa31b4f` | `cae08e1976497ab296470a8b1b029c328bf9f73458840ffb75faa66db37b9590` | `88cca1016255795f6ef98136112ea2fecf62d8d1415396caae5d61d99be29682` | 75 / 75 (152 frames, 20,003 B) |
| `f1_seed42` | (read from vendored `f1_seed42.json` at Task 2) | ″ | ″ | ″ |

F0 `case_id = 58c6962b02eb46d473f3192f3e4a4e910fb56282d74510cdac1dbfa18deaf8b6`; E0 `case_id = 400e566059203085fb2a2579d91ecae7fbffc467137c6b97a123d66a82853b5d`.

---

### Task 1: Repo scaffold + CI skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `eslint.config.js`, `.gitattributes`, `.gitignore`, `.github/workflows/ci.yml`, `src/sanity.test.ts`

**Interfaces:**
- Produces: `npm run dev|build|test|lint|typecheck` all working; CI running typecheck+lint+test on push/PR.

- [ ] **Step 1: Scaffold**

```bash
cd path/to/swarm-observatory
npm create vite@latest . -- --template react-ts
# NOTE: the directory is non-empty (docs/, .git/) — when the scaffolder prompts,
# choose "Ignore files and continue". If running non-interactively, scaffold into
# a temp dir and copy everything except its .git into the repo root instead.
npm i zustand @noble/hashes three @react-three/fiber @react-three/drei
npm i -D vitest r3f-perf @types/three eslint @eslint/js typescript-eslint
```

- [ ] **Step 2: Config files**

`.gitattributes`:
```
* text=auto eol=lf
*.det binary
```

`tsconfig.json` — ensure under `compilerOptions`: `"strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]` (keep Vite template's other options).

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/',
  test: { include: ['src/**/*.test.ts'] },
})
```
(If `test` key errors on types, add `/// <reference types="vitest/config" />` at top.)

`eslint.config.js`:
```js
import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['dist', 'contract', 'public'] },
  js.configs.recommended,
  ...ts.configs.recommended,
)
```

`package.json` scripts:
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "lint": "eslint .",
  "typecheck": "tsc -b --noEmit"
}
```

`src/ui/App.tsx` (placeholder until Task 13):
```tsx
export default function App() {
  return <div>swarm-observatory</div>
}
```
`src/main.tsx`: render `<App />` into `#root` (Vite template default, adjusted import path).

`src/sanity.test.ts`:
```ts
import { expect, test } from 'vitest'
test('sanity', () => { expect(1 + 1).toBe(2) })
```

- [ ] **Step 3: Verify locally**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass, `dist/` produced.

- [ ] **Step 4: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist }
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite+react+ts app with vitest, eslint, CI"
```

---

### Task 2: Contract snapshot — sync script + vendored fixtures

**Files:**
- Create: `tools/sync-contract.mjs`, `contract/` (generated), `public/runs/` (generated)

**Interfaces:**
- Consumes: a local Certus checkout (default `path/to/certus`, override via `CERTUS_REPO` env).
- Produces: `contract/SOURCE.lock`, `contract/identity.json` (`{ eventSchemaVersion, stateSchemaVersion, schemaRegistryHash, stateRegistryHash }`), `contract/spec-3a-event-schema.md`, `contract/spec-3b-evidence-layer.md`, `contract/fixtures/{f0_primitives.json, f0_seed42.det, f0_seed42.manifest.json, f0_seed42.json, e0_seed42.det, e0_seed42.json, f1_seed42.det, f1_seed42.json}`, `public/runs/f0/{bundle.det, manifest.json}`, `public/runs/index.json`.

- [ ] **Step 1: Write the script**

`tools/sync-contract.mjs`:
```js
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = process.env.CERTUS_REPO ?? 'path/to/certus'
const GOLDEN = join(SRC, 'tools/reference-encoder/golden')
const SPECS = join(SRC, 'docs/v2/architecture')
const FIXTURES = [
  'f0_primitives.json', 'f0_seed42.det', 'f0_seed42.manifest.json', 'f0_seed42.json',
  'e0_seed42.det', 'e0_seed42.json', 'f1_seed42.det', 'f1_seed42.json',
]

mkdirSync('contract/fixtures', { recursive: true })
mkdirSync('public/runs/f0', { recursive: true })

const files = {}
const vendor = (src, dst) => {
  cpSync(src, dst)
  files[dst.replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(src)).digest('hex')
}
for (const f of FIXTURES) vendor(join(GOLDEN, f), join('contract/fixtures', f))
for (const f of ['spec-3a-event-schema.md', 'spec-3b-evidence-layer.md']) vendor(join(SPECS, f), join('contract', f))

const manifest = JSON.parse(readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8'))
writeFileSync('contract/identity.json', JSON.stringify({
  eventSchemaVersion: manifest.inputs.event_schema_version,
  stateSchemaVersion: manifest.inputs.state_schema_version,
  schemaRegistryHash: manifest.inputs.schema_registry_hash,
  stateRegistryHash: manifest.inputs.state_registry_hash,
}, null, 2))

cpSync('contract/fixtures/f0_seed42.det', 'public/runs/f0/bundle.det')
cpSync('contract/fixtures/f0_seed42.manifest.json', 'public/runs/f0/manifest.json')
writeFileSync('public/runs/index.json', JSON.stringify([{ id: 'f0', title: 'F0 determinism fixture (seed 42)', base: 'runs/f0' }], null, 2))

const commit = execSync('git rev-parse HEAD', { cwd: SRC }).toString().trim()
const dirty = execSync('git status --porcelain', { cwd: SRC }).toString().trim().length > 0
writeFileSync('contract/SOURCE.lock', JSON.stringify({ certus_commit: commit, certus_dirty: dirty, synced_at: new Date().toISOString(), files }, null, 2))
console.log(`synced from ${commit}${dirty ? ' (DIRTY)' : ''}`)
for (const f of ['f0_seed42.json', 'e0_seed42.json', 'f1_seed42.json'])
  console.log(f, Object.keys(JSON.parse(readFileSync(join('contract/fixtures', f), 'utf8'))).join(','))
```

- [ ] **Step 2: Run it and inspect**

Run: `node tools/sync-contract.mjs`
Expected: `synced from <40-hex>`, then three lines listing each pins-file's keys. Confirm `e0_seed42.json` and `f1_seed42.json` both contain `case_id, event_hash, state_trajectory_hash, result_id, event_count, tick_count`. If `f1_seed42.json` lacks any of these keys, exclude F1 from the Task 8 golden table (F0 + E0 remain mandatory) and record the discrepancy in the commit message.

- [ ] **Step 3: Commit (vendored fixtures are committed — they are the test ground truth)**

```bash
git add tools/sync-contract.mjs contract public/runs && git commit -m "feat: contract snapshot sync script + vendored golden fixtures"
```

---

### Task 3: Branded types + ByteReader

**Files:**
- Create: `src/lib/brand.ts`, `src/lib/bytes.ts`
- Test: `src/lib/bytes.test.ts`

**Interfaces:**
- Produces:
  - `brand.ts`: `type Tick`, `type Seq`, `type EventKindId` (branded numbers); `asTick(n)`, `asSeq(n)`, `asKind(n)`.
  - `bytes.ts`: `class DecodeError extends Error { code: DecodeErrorCode }` with `DecodeErrorCode = 'BadMagic'|'BadVersion'|'BadHeaderCrc'|'TruncatedFrame'|'BadCrc'|'UnknownFrameTag'|'FrameAfterTrailer'|'InvalidOptionTag'|'InvalidBool'|'InvalidUtf8'|'MalformedPayload'`; `class ByteReader { constructor(bytes: Uint8Array); off: number; u8(): number; u16(): number; u32(): number; u64(): bigint; f64(): number; bytes(n: number): Uint8Array; utf8(): string; option<T>(read: () => T): T | null; bool(): boolean; vecF64(): number[]; remaining(): number; safeU64(): number }` — all LE; out-of-bounds reads throw `DecodeError('MalformedPayload')`; `safeU64` throws if the value exceeds `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 1: Write the failing test (vectors from `contract/fixtures/f0_primitives.json`)**

`src/lib/bytes.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ByteReader, DecodeError } from './bytes'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const hex = (name: string) => {
  const v = vectors.find(v => v.name === name)
  if (!v) throw new Error(`missing vector ${name}`)
  return Uint8Array.from(v.bytes.match(/../g)!.map(b => parseInt(b, 16)))
}

describe('ByteReader against f0_primitives vectors', () => {
  test('scalars', () => {
    expect(new ByteReader(hex('u8_max')).u8()).toBe(0xff)
    expect(new ByteReader(hex('u16_max')).u16()).toBe(0xffff)
    expect(new ByteReader(hex('u32_max')).u32()).toBe(0xffffffff)
    expect(new ByteReader(hex('u64_max')).u64()).toBe(0xffffffffffffffffn)
    expect(new ByteReader(hex('f64_1p5')).f64()).toBe(1.5)
    expect(new ByteReader(hex('f64_pos_zero')).f64()).toBe(0)
  })
  test('utf8 length-prefixed', () => {
    expect(new ByteReader(hex('utf8_f0')).utf8()).toBe('f0')
    expect(new ByteReader(hex('utf8_empty')).utf8()).toBe('')
  })
  test('option', () => {
    const r0 = new ByteReader(hex('option_none'))
    expect(r0.option(() => r0.u64())).toBeNull()
    const r1 = new ByteReader(hex('option_some_u64_7'))
    expect(r1.option(() => r1.u64())).toBe(7n)
  })
  test('enum tag is u16 LE', () => {
    expect(new ByteReader(hex('enum_eventkind_f0fixture_u16')).u16()).toBe(0xf000)
  })
  test('out-of-bounds throws MalformedPayload', () => {
    const r = new ByteReader(new Uint8Array([1]))
    expect(() => r.u32()).toThrowError(DecodeError)
  })
  test('safeU64 rejects > 2^53', () => {
    expect(() => new ByteReader(hex('u64_max')).safeU64()).toThrow()
  })
})
```
(Adjust the `option` call shape to the implemented signature: `option(read)` invokes `read()` after consuming a valid Some tag.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/bytes.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/brand.ts`:
```ts
declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }
export type Tick = Brand<number, 'Tick'>
export type Seq = Brand<number, 'Seq'>
export type EventKindId = Brand<number, 'EventKindId'>
const nonNegInt = (n: number, what: string): number => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer, got ${n}`)
  return n
}
export const asTick = (n: number): Tick => nonNegInt(n, 'Tick') as Tick
export const asSeq = (n: number): Seq => nonNegInt(n, 'Seq') as Seq
export const asKind = (n: number): EventKindId => nonNegInt(n, 'EventKindId') as EventKindId
```

`src/lib/bytes.ts`:
```ts
export type DecodeErrorCode =
  | 'BadMagic' | 'BadVersion' | 'BadHeaderCrc' | 'TruncatedFrame' | 'BadCrc'
  | 'UnknownFrameTag' | 'FrameAfterTrailer' | 'InvalidOptionTag' | 'InvalidBool'
  | 'InvalidUtf8' | 'MalformedPayload'

export class DecodeError extends Error {
  constructor(public readonly code: DecodeErrorCode, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'DecodeError'
  }
}

export class ByteReader {
  private view: DataView
  off = 0
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  private need(n: number) {
    if (this.off + n > this.buf.byteLength) throw new DecodeError('MalformedPayload', `need ${n} bytes at offset ${this.off}`)
  }
  u8(): number { this.need(1); return this.view.getUint8(this.off++) }
  u16(): number { this.need(2); const v = this.view.getUint16(this.off, true); this.off += 2; return v }
  u32(): number { this.need(4); const v = this.view.getUint32(this.off, true); this.off += 4; return v }
  u64(): bigint { this.need(8); const v = this.view.getBigUint64(this.off, true); this.off += 8; return v }
  f64(): number { this.need(8); const v = this.view.getFloat64(this.off, true); this.off += 8; return v }
  bytes(n: number): Uint8Array { this.need(n); const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v }
  utf8(): string {
    const len = this.u32()
    const raw = this.bytes(len)
    try { return new TextDecoder('utf-8', { fatal: true }).decode(raw) }
    catch { throw new DecodeError('InvalidUtf8') }
  }
  bool(): boolean {
    const b = this.u8()
    if (b > 1) throw new DecodeError('InvalidBool', `${b}`)
    return b === 1
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8()
    if (tag === 0) return null
    if (tag === 1) return read()
    throw new DecodeError('InvalidOptionTag', `${tag}`)
  }
  vecF64(): number[] {
    const n = this.u32()
    const out = new Array<number>(n)
    for (let i = 0; i < n; i++) out[i] = this.f64()
    return out
  }
  safeU64(): number {
    const v = this.u64()
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new DecodeError('MalformedPayload', `u64 ${v} exceeds safe integer`)
    return Number(v)
  }
  remaining(): number { return this.buf.byteLength - this.off }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/bytes.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/lib && git commit -m "feat: branded types + fixed-le ByteReader, tested against f0_primitives vectors"`

---

### Task 4: CRC32C

**Files:**
- Create: `src/lib/crc32c.ts`
- Test: `src/lib/crc32c.test.ts`

**Interfaces:**
- Produces: `crc32c(bytes: Uint8Array): number` (unsigned 32-bit).

- [ ] **Step 1: Failing test**

`src/lib/crc32c.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { crc32c } from './crc32c'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const hex = (name: string) => Uint8Array.from(vectors.find(v => v.name === name)!.bytes.match(/../g)!.map(b => parseInt(b, 16)))

test('RFC 3720 check value', () => {
  expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe3069283)
})
test('file_header vector: trailing u32 is CRC of first 20 bytes', () => {
  const h = hex('file_header')
  const stored = new DataView(h.buffer, h.byteOffset).getUint32(20, true)
  expect(crc32c(h.subarray(0, 20))).toBe(stored)
})
for (const name of ['frame_event_example', 'frame_statetick_example', 'frame_trailer_example']) {
  test(`${name}: trailing u32 is CRC of tag++len++payload`, () => {
    const f = hex(name)
    const stored = new DataView(f.buffer, f.byteOffset).getUint32(f.byteLength - 4, true)
    expect(crc32c(f.subarray(0, f.byteLength - 4))).toBe(stored)
  })
}
```

- [ ] **Step 2: Run → FAIL** (module missing).

- [ ] **Step 3: Implement**

`src/lib/crc32c.ts`:
```ts
const TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
  TABLE[i] = c >>> 0
}
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/crc32c* && git commit -m "feat: CRC32C (Castagnoli), verified against check value and golden frame vectors"`

---

### Task 5: blake3 hash domains

**Files:**
- Create: `src/lib/hashing.ts`
- Test: `src/lib/hashing.test.ts`

**Interfaces:**
- Produces: `CTX = { EVENT: 'det-event-log/v1', STATE: 'det-state-traj/v1', RESULT: 'det-result/v1' }`; `createDeriveHasher(ctx: string): { update(b: Uint8Array): void; digest(): Uint8Array }`; `deriveHash(ctx: string, data: Uint8Array): Uint8Array`; `toHex(b: Uint8Array): string`.

- [ ] **Step 1: Failing test (blake3 mode vectors from the primitives file)**

`src/lib/hashing.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createDeriveHasher, deriveHash, toHex } from './hashing'

const vectors: Record<string, { name: string; bytes: string; input?: string; key?: string; context?: string }[]> =
  { all: JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8')) }
const v = (name: string) => vectors.all.find(x => x.name === name)!
const un = (h: string) => Uint8Array.from(h.match(/../g)!.map(b => parseInt(b, 16)))

test('derive_key mode matches official BLAKE3 vector', () => {
  const dk = v('blake3_derive_key_len3')
  expect(toHex(deriveHash(dk.context!, un(dk.input!)))).toBe(dk.bytes)
})
test('incremental derive hasher equals one-shot', () => {
  const dk = v('blake3_derive_key_len3')
  const h = createDeriveHasher(dk.context!)
  h.update(un(dk.input!).subarray(0, 1)); h.update(un(dk.input!).subarray(1))
  expect(toHex(h.digest())).toBe(dk.bytes)
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/lib/hashing.ts`:
```ts
import { blake3 } from '@noble/hashes/blake3'

export const CTX = {
  EVENT: 'det-event-log/v1',
  STATE: 'det-state-traj/v1',
  RESULT: 'det-result/v1',
} as const

export function createDeriveHasher(ctx: string) {
  const h = blake3.create({ context: new TextEncoder().encode(ctx) })
  return {
    update: (b: Uint8Array) => { h.update(b) },
    digest: () => h.digest(),
  }
}
export const deriveHash = (ctx: string, data: Uint8Array): Uint8Array => {
  const h = createDeriveHasher(ctx)
  h.update(data)
  return h.digest()
}
export const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
```
(If `@noble/hashes` expects the context option under a different key in the installed version, consult its README — the test vector is the arbiter.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/hashing* && git commit -m "feat: blake3 derive_key hash domains, verified against official vectors"`

---

### Task 6: FileHeader + frame iterator

**Files:**
- Create: `src/decode/frames.ts`
- Test: `src/decode/frames.test.ts`

**Interfaces:**
- Consumes: `ByteReader`, `DecodeError`, `crc32c`.
- Produces: `FILE_HEADER_LEN = 24`; `interface FileHeader { formatVersion: number; eventSchemaVersion: number; stateSchemaVersion: number }`; `parseFileHeader(bytes: Uint8Array): FileHeader`; `FrameTag = { Event: 1, StateTick: 2, Trailer: 3 } as const`; `interface RawFrame { tag: number; payload: Uint8Array }`; `iterateFrames(bytes: Uint8Array): RawFrame[]` — CRC-checks every frame, throws `TruncatedFrame`/`BadCrc`/`UnknownFrameTag`, enforces Trailer-last (`FrameAfterTrailer`) and exactly one Trailer.

- [ ] **Step 1: Failing test**

`src/decode/frames.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { FrameTag, iterateFrames, parseFileHeader, FILE_HEADER_LEN } from './frames'
import { DecodeError } from '../lib/bytes'

const det = (name: string) => new Uint8Array(readFileSync(`contract/fixtures/${name}`))

describe('golden bundle framing', () => {
  test('F0 header: format 1, events v4, state v2', () => {
    const h = parseFileHeader(det('f0_seed42.det'))
    expect(h).toEqual({ formatVersion: 1, eventSchemaVersion: 4, stateSchemaVersion: 2 })
  })
  test('F0: 6 frames = 3 StateTick + 2 Event + 1 Trailer, trailer last', () => {
    const frames = iterateFrames(det('f0_seed42.det'))
    const tags = frames.map(f => f.tag)
    expect(frames).toHaveLength(6)
    expect(tags.filter(t => t === FrameTag.StateTick)).toHaveLength(3)
    expect(tags.filter(t => t === FrameTag.Event)).toHaveLength(2)
    expect(tags.at(-1)).toBe(FrameTag.Trailer)
  })
  test('E0: 152 frames (76 StateTick + 75 Event + Trailer), 20003 bytes', () => {
    const bytes = det('e0_seed42.det')
    expect(bytes.byteLength).toBe(20003)
    const frames = iterateFrames(bytes)
    expect(frames).toHaveLength(152)
  })
  test('corrupting one payload byte → BadCrc', () => {
    const bytes = det('f0_seed42.det').slice()
    bytes[FILE_HEADER_LEN + 10]! ^= 0xff
    expect(() => iterateFrames(bytes)).toThrowError(/BadCrc/) // DecodeError message starts with its code
  })
  test('corrupting magic → BadMagic', () => {
    const bytes = det('f0_seed42.det').slice()
    bytes[0] = 0x58
    expect(() => parseFileHeader(bytes)).toThrowError(/BadMagic/)
  })
  test('truncated tail → TruncatedFrame', () => {
    const bytes = det('f0_seed42.det').subarray(0, det('f0_seed42.det').byteLength - 3)
    expect(() => iterateFrames(bytes)).toThrowError(DecodeError)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/decode/frames.ts`:
```ts
import { ByteReader, DecodeError } from '../lib/bytes'
import { crc32c } from '../lib/crc32c'

export const FILE_HEADER_LEN = 24
const MAGIC = 'DETBNDL1'
export const FrameTag = { Event: 1, StateTick: 2, Trailer: 3 } as const

export interface FileHeader { formatVersion: number; eventSchemaVersion: number; stateSchemaVersion: number }
export interface RawFrame { tag: number; payload: Uint8Array }

export function parseFileHeader(bytes: Uint8Array): FileHeader {
  if (bytes.byteLength < FILE_HEADER_LEN) throw new DecodeError('TruncatedFrame', 'header')
  const r = new ByteReader(bytes)
  const magic = new TextDecoder().decode(r.bytes(8))
  if (magic !== MAGIC) throw new DecodeError('BadMagic', magic)
  const formatVersion = r.u32()
  const eventSchemaVersion = r.u32()
  const stateSchemaVersion = r.u32()
  const storedCrc = r.u32()
  if (crc32c(bytes.subarray(0, 20)) !== storedCrc) throw new DecodeError('BadHeaderCrc')
  if (formatVersion !== 1) throw new DecodeError('BadVersion', `format ${formatVersion}`)
  return { formatVersion, eventSchemaVersion, stateSchemaVersion }
}

export function iterateFrames(bytes: Uint8Array): RawFrame[] {
  parseFileHeader(bytes)
  const frames: RawFrame[] = []
  let off = FILE_HEADER_LEN
  let sawTrailer = false
  while (off < bytes.byteLength) {
    if (sawTrailer) throw new DecodeError('FrameAfterTrailer')
    if (off + 5 > bytes.byteLength) throw new DecodeError('TruncatedFrame', `frame header at ${off}`)
    const tag = bytes[off]!
    const len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, true)
    if (off + 5 + len + 4 > bytes.byteLength) throw new DecodeError('TruncatedFrame', `payload at ${off}`)
    const payload = bytes.subarray(off + 5, off + 5 + len)
    const stored = new DataView(bytes.buffer, bytes.byteOffset + off + 5 + len, 4).getUint32(0, true)
    if (crc32c(bytes.subarray(off, off + 5 + len)) !== stored) throw new DecodeError('BadCrc', `frame at ${off}`)
    if (tag !== FrameTag.Event && tag !== FrameTag.StateTick && tag !== FrameTag.Trailer)
      throw new DecodeError('UnknownFrameTag', `${tag}`)
    if (tag === FrameTag.Trailer) sawTrailer = true
    frames.push({ tag, payload })
    off += 5 + len + 4
  }
  if (!sawTrailer) throw new DecodeError('TruncatedFrame', 'no trailer')
  return frames
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/decode && git commit -m "feat: file header + CRC-checked frame iterator over golden bundles"`

---

### Task 7: Payload decoders (Event, StateTick, Entity v2, Trailer, kind-23)

**Files:**
- Create: `src/decode/payloads.ts`
- Test: `src/decode/payloads.test.ts`

**Interfaces:**
- Consumes: `ByteReader`, brands, `FrameTag`.
- Produces:
  - `EVENT_KIND_NAMES: Record<number, string>` (all of §6.5.1: 1..24 + 0xF000 `F0_FIXTURE`), `GEOMETRY_QUERY_RESOLVED = 23`.
  - `interface EventEnvelope { seq: Seq; tick: Tick; kind: EventKindId; causationId: Seq | null; payload: Uint8Array }`, `decodeEvent(payload: Uint8Array): EventEnvelope`.
  - `interface EntityRecord { namespaceTag: number; id: bigint; fieldBytes: Uint8Array }`, `interface StateTickFrame { tickIndex: number; entities: EntityRecord[] }`, `decodeStateTick(payload: Uint8Array): StateTickFrame`.
  - `interface EntityV2 { value: bigint; alive: boolean; pos: number[]; vel: number[]; headingRad: number; speedMps: number; turnRateRadps: number; fuel: number; setpoint: number[] }`, `decodeEntityV2(fieldBytes: Uint8Array): EntityV2` (throws `MalformedPayload` on trailing bytes).
  - `interface Trailer { caseId: Uint8Array; eventHash: Uint8Array; stateTrajectoryHash: Uint8Array; eventCount: number; tickCount: number; terminationReason: number }`, `decodeTrailer(payload: Uint8Array): Trailer`.
  - `interface GeometryQuery { queryKind: number; subject: bigint; object: bigint; argv: number[]; resultFlag: boolean; resultScalars: number[]; tiebreakApplied: boolean }`, `decodeGeometryQuery(payload: Uint8Array): GeometryQuery`, `GEOMETRY_QUERY_KIND_NAMES = { 1: 'POINT_IN_REGION', 2: 'RANGE_BEARING', 3: 'RAY_OCCLUDER', 4: 'LOS' }`.

- [ ] **Step 1: Failing test**

`src/decode/payloads.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { iterateFrames, FrameTag } from './frames'
import { decodeEvent, decodeStateTick, decodeEntityV2, decodeTrailer, decodeGeometryQuery, GEOMETRY_QUERY_RESOLVED } from './payloads'

const vectors: { name: string; bytes: string }[] = JSON.parse(readFileSync('contract/fixtures/f0_primitives.json', 'utf8'))
const vecPayload = (name: string) => {
  const f = Uint8Array.from(vectors.find(v => v.name === name)!.bytes.match(/../g)!.map(b => parseInt(b, 16)))
  return f.subarray(5, f.byteLength - 4) // strip tag+len and crc
}
const det = (name: string) => new Uint8Array(readFileSync(`contract/fixtures/${name}`))

describe('primitives frame vectors', () => {
  test('event example: seq 0, tick 0, kind F0_FIXTURE, no causation, 22-byte payload', () => {
    const e = decodeEvent(vecPayload('frame_event_example'))
    expect(e.seq).toBe(0); expect(e.tick).toBe(0); expect(e.kind).toBe(0xf000)
    expect(e.causationId).toBeNull(); expect(e.payload.byteLength).toBe(22)
  })
  test('statetick example: tick 0, entities (1,0) 53B and (9,0) 98B', () => {
    const s = decodeStateTick(vecPayload('frame_statetick_example'))
    expect(s.tickIndex).toBe(0)
    expect(s.entities.map(e => [e.namespaceTag, e.fieldBytes.byteLength])).toEqual([[1, 53], [9, 98]])
    const ent = decodeEntityV2(s.entities[0]!.fieldBytes)
    expect(ent.alive).toBe(true); expect(ent.pos).toEqual([]); expect(ent.fuel).toBe(0)
  })
  test('trailer example: STEP_LIMIT', () => {
    const t = decodeTrailer(vecPayload('frame_trailer_example'))
    expect(t.terminationReason).toBe(2)
    expect(t.caseId.byteLength).toBe(32)
  })
})

describe('golden F0 events', () => {
  test('seq 1 has causation Some(0) — the causal edge exists', () => {
    const events = iterateFrames(det('f0_seed42.det')).filter(f => f.tag === FrameTag.Event).map(f => decodeEvent(f.payload))
    expect(events.map(e => [e.seq, e.tick, e.causationId])).toEqual([[0, 0, null], [1, 1, 0]])
  })
})

describe('golden E0 geometry queries', () => {
  test('all 75 events are kind 23 and their payloads decode fully', () => {
    const frames = iterateFrames(det('e0_seed42.det')).filter(f => f.tag === FrameTag.Event)
    expect(frames).toHaveLength(75)
    for (const f of frames) {
      const e = decodeEvent(f.payload)
      expect(e.kind).toBe(GEOMETRY_QUERY_RESOLVED)
      const q = decodeGeometryQuery(e.payload)
      expect([1, 2, 3, 4]).toContain(q.queryKind)
      expect(typeof q.resultFlag).toBe('boolean')
    }
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/decode/payloads.ts`:
```ts
import { asKind, asSeq, asTick, type EventKindId, type Seq, type Tick } from '../lib/brand'
import { ByteReader, DecodeError } from '../lib/bytes'

export const EVENT_KIND_NAMES: Record<number, string> = {
  1: 'DetectionMade', 2: 'TrackConfirmed', 3: 'TrackUpdated', 4: 'TrackDropped',
  5: 'MessageSent', 6: 'MessageDelivered', 7: 'MessageDropped', 8: 'BeliefUpdated',
  9: 'DesignationSent', 10: 'HandoffAccepted', 11: 'TaskProposed', 12: 'TaskBid',
  13: 'TaskAssigned', 14: 'DecisionMade', 15: 'FireCommand', 17: 'WeaponLaunched',
  18: 'DamageApplied', 19: 'TargetDestroyed', 20: 'AuthorizationDecided',
  21: 'FireRejected', 22: 'EligibilityEvaluated', 23: 'GeometryQueryResolved',
  24: 'AllocationStateUpdated', 0xf000: 'F0_FIXTURE',
}
export const GEOMETRY_QUERY_RESOLVED = 23
export const GEOMETRY_QUERY_KIND_NAMES: Record<number, string> =
  { 1: 'POINT_IN_REGION', 2: 'RANGE_BEARING', 3: 'RAY_OCCLUDER', 4: 'LOS' }

export interface EventEnvelope { seq: Seq; tick: Tick; kind: EventKindId; causationId: Seq | null; payload: Uint8Array }
export function decodeEvent(payload: Uint8Array): EventEnvelope {
  const r = new ByteReader(payload)
  const seq = asSeq(r.safeU64())
  const tick = asTick(r.safeU64())
  const kind = asKind(r.u16())
  const causation = r.option(() => r.safeU64())
  const inner = r.bytes(r.u32())
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing event bytes')
  return { seq, tick, kind, causationId: causation === null ? null : asSeq(causation), payload: inner }
}

export interface EntityRecord { namespaceTag: number; id: bigint; fieldBytes: Uint8Array }
export interface StateTickFrame { tickIndex: number; entities: EntityRecord[] }
export function decodeStateTick(payload: Uint8Array): StateTickFrame {
  const r = new ByteReader(payload)
  const tickIndex = r.safeU64()
  const n = r.u32()
  const entities: EntityRecord[] = []
  for (let i = 0; i < n; i++) {
    const namespaceTag = r.u16()
    const id = r.u64()
    const fieldBytes = r.bytes(r.u32())
    entities.push({ namespaceTag, id, fieldBytes })
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing statetick bytes')
  return { tickIndex, entities }
}

export interface EntityV2 {
  value: bigint; alive: boolean; pos: number[]; vel: number[]
  headingRad: number; speedMps: number; turnRateRadps: number; fuel: number; setpoint: number[]
}
export function decodeEntityV2(fieldBytes: Uint8Array): EntityV2 {
  const r = new ByteReader(fieldBytes)
  const out: EntityV2 = {
    value: r.u64(), alive: r.bool(), pos: r.vecF64(), vel: r.vecF64(),
    headingRad: r.f64(), speedMps: r.f64(), turnRateRadps: r.f64(), fuel: r.f64(), setpoint: r.vecF64(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing entity bytes')
  return out
}

export interface Trailer {
  caseId: Uint8Array; eventHash: Uint8Array; stateTrajectoryHash: Uint8Array
  eventCount: number; tickCount: number; terminationReason: number
}
export function decodeTrailer(payload: Uint8Array): Trailer {
  const r = new ByteReader(payload)
  const t: Trailer = {
    caseId: r.bytes(32), eventHash: r.bytes(32), stateTrajectoryHash: r.bytes(32),
    eventCount: r.safeU64(), tickCount: r.safeU64(), terminationReason: r.u16(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing trailer bytes')
  return t
}

export interface GeometryQuery {
  queryKind: number; subject: bigint; object: bigint; argv: number[]
  resultFlag: boolean; resultScalars: number[]; tiebreakApplied: boolean
}
export function decodeGeometryQuery(payload: Uint8Array): GeometryQuery {
  const r = new ByteReader(payload)
  const q: GeometryQuery = {
    queryKind: r.u16(), subject: r.u64(), object: r.u64(), argv: r.vecF64(),
    resultFlag: r.bool(), resultScalars: r.vecF64(), tiebreakApplied: r.bool(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing kind-23 bytes')
  return q
}
```

- [ ] **Step 4: Run → PASS.** (If the E0 kind-23 test fails on field order, re-read the vendored `contract/spec-3b-evidence-layer.md` §11.1 row 23 — the table order is normative; fix the decoder, not the test.)
- [ ] **Step 5: Commit** — `git add src/decode && git commit -m "feat: event/statetick/entity-v2/trailer/kind-23 payload decoders against golden vectors"`

---

### Task 8: Canonical verification — the dual fold + result_id (keystone)

**Files:**
- Create: `src/decode/verify.ts`
- Test: `src/decode/verify.test.ts`

**Interfaces:**
- Consumes: `iterateFrames`, `FrameTag`, `decodeTrailer`, `createDeriveHasher`, `CTX`, `toHex`.
- Produces: `interface VerifyResult { eventHashHex: string; stateHashHex: string; resultIdHex: string; caseIdHex: string; eventCount: number; tickCount: number; terminationReason: number; matchesTrailer: boolean }`; `foldAndVerify(bytes: Uint8Array): VerifyResult`.

- [ ] **Step 1: Failing test (byte-exact against all three golden pins)**

`src/decode/verify.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { foldAndVerify } from './verify'

interface Pins { case_id: string; event_hash: string; state_trajectory_hash: string; result_id: string; event_count: number | string; tick_count: number | string }
const cases: { det: string; pins: Pins }[] = [
  { det: 'f0_seed42.det', pins: readPins('f0_seed42.json') },
  { det: 'e0_seed42.det', pins: readPins('e0_seed42.json') },
  { det: 'f1_seed42.det', pins: readPins('f1_seed42.json') },
]
function readPins(name: string): Pins { return JSON.parse(readFileSync(`contract/fixtures/${name}`, 'utf8')) }

describe.each(cases)('independent re-fold of $det', ({ det, pins }) => {
  const v = foldAndVerify(new Uint8Array(readFileSync(`contract/fixtures/${det}`)))
  test('event_hash matches golden', () => expect(v.eventHashHex).toBe(pins.event_hash))
  test('state_trajectory_hash matches golden', () => expect(v.stateHashHex).toBe(pins.state_trajectory_hash))
  test('result_id matches golden', () => expect(v.resultIdHex).toBe(pins.result_id))
  test('case_id matches golden', () => expect(v.caseIdHex).toBe(pins.case_id))
  test('counts match golden and trailer', () => {
    expect(v.eventCount).toBe(Number(pins.event_count))
    expect(v.tickCount).toBe(Number(pins.tick_count))
    expect(v.matchesTrailer).toBe(true)
  })
})

test('one flipped payload bit is caught before hashing (CRC), never silently verified', () => {
  const bytes = new Uint8Array(readFileSync('contract/fixtures/f0_seed42.det')).slice()
  bytes[30]! ^= 0x01
  expect(() => foldAndVerify(bytes)).toThrow()
})
```
(If Task 2 showed `f1_seed42.json` lacks these keys, drop the F1 row and note it in the commit message.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/decode/verify.ts`:
```ts
import { CTX, createDeriveHasher, deriveHash, toHex } from '../lib/hashing'
import { DecodeError } from '../lib/bytes'
import { FrameTag, iterateFrames } from './frames'
import { decodeTrailer, type Trailer } from './payloads'

export interface VerifyResult {
  eventHashHex: string; stateHashHex: string; resultIdHex: string; caseIdHex: string
  eventCount: number; tickCount: number; terminationReason: number; matchesTrailer: boolean
}

const TAG = (t: number) => Uint8Array.of(t)

export function foldAndVerify(bytes: Uint8Array): VerifyResult {
  const E = createDeriveHasher(CTX.EVENT)
  const S = createDeriveHasher(CTX.STATE)
  let eventCount = 0
  let stateFrames = 0
  let trailer: Trailer | null = null
  for (const f of iterateFrames(bytes)) {
    if (f.tag === FrameTag.Event) { E.update(TAG(1)); E.update(f.payload); eventCount++ }
    else if (f.tag === FrameTag.StateTick) { S.update(TAG(2)); S.update(f.payload); stateFrames++ }
    else trailer = decodeTrailer(f.payload)
  }
  if (!trailer) throw new DecodeError('TruncatedFrame', 'no trailer')
  const tickCount = stateFrames - 1 // State[0] initial + one per tick (§3.3)
  const eventHash = E.digest()
  const stateHash = S.digest()

  const pre = new Uint8Array(1 + 32 * 3 + 8 + 8 + 2)
  const dv = new DataView(pre.buffer)
  pre[0] = FrameTag.Trailer
  pre.set(trailer.caseId, 1); pre.set(eventHash, 33); pre.set(stateHash, 65)
  dv.setBigUint64(97, BigInt(eventCount), true)
  dv.setBigUint64(105, BigInt(tickCount), true)
  dv.setUint16(113, trailer.terminationReason, true)
  const resultId = deriveHash(CTX.RESULT, pre)

  const matchesTrailer =
    toHex(eventHash) === toHex(trailer.eventHash) &&
    toHex(stateHash) === toHex(trailer.stateTrajectoryHash) &&
    eventCount === trailer.eventCount && tickCount === trailer.tickCount

  return {
    eventHashHex: toHex(eventHash), stateHashHex: toHex(stateHash), resultIdHex: toHex(resultId),
    caseIdHex: toHex(trailer.caseId), eventCount, tickCount,
    terminationReason: trailer.terminationReason, matchesTrailer,
  }
}
```

- [ ] **Step 4: Run → PASS.** Three independent implementations (Rust producer, Python oracle, this TS decoder) now agree byte-for-byte. If a hash mismatches, the bug hunt order is: fold input (`tag ++ payload`, framing excluded) → derive_key context bytes → result_id preimage layout.
- [ ] **Step 5: Commit** — `git add src/decode && git commit -m "feat: canonical dual fold + result_id recomputation, byte-exact on F0/E0/F1 goldens"`

---

### Task 9: Manifest parser + identity gate

**Files:**
- Create: `src/decode/manifest.ts`
- Test: `src/decode/manifest.test.ts`

**Interfaces:**
- Produces: `interface RunManifest { eventSchemaVersion: number; stateSchemaVersion: number; schemaRegistryHash: string; stateRegistryHash: string; scenarioId: string; seed: string; dtUs: number; eventHash: string; stateTrajectoryHash: string; resultId: string; eventCount: number; tickCount: number; runComplete: boolean; terminationReason: number; simTimeStartUs: string; simTimeEndUs: string; caseId: string; attemptId: string; commit: string; dirty: boolean; createdAt: string }`; `parseManifest(jsonText: string): RunManifest` (throws `Error` naming the missing/malformed field); `interface Identity { eventSchemaVersion: number; stateSchemaVersion: number; schemaRegistryHash: string; stateRegistryHash: string }`; `type GateResult = { ok: true } | { ok: false; field: string; expected: string; actual: string }`; `gateManifest(m: RunManifest, id: Identity): GateResult`.

- [ ] **Step 1: Failing test**

`src/decode/manifest.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { gateManifest, parseManifest, type Identity } from './manifest'

const text = readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8')
const identity: Identity = JSON.parse(readFileSync('contract/identity.json', 'utf8'))

describe('golden F0 manifest', () => {
  const m = parseManifest(text)
  test('fields', () => {
    expect(m.eventSchemaVersion).toBe(4)
    expect(m.stateSchemaVersion).toBe(2)
    expect(m.scenarioId).toBe('f0-fixture')
    expect(m.dtUs).toBe(1000)
    expect(m.eventCount).toBe(2)
    expect(m.tickCount).toBe(2)
    expect(m.runComplete).toBe(true)
    expect(m.terminationReason).toBe(2)
    expect(m.resultId).toMatch(/^[0-9a-f]{64}$/)
    expect(m.caseId).toMatch(/^[0-9a-f]{64}$/)
  })
  test('gate passes against pinned identity', () => {
    expect(gateManifest(m, identity)).toEqual({ ok: true })
  })
  test('gate rejects a foreign state registry with the offending field named', () => {
    const evil = { ...m, stateRegistryHash: 'ff'.repeat(32) }
    const r = gateManifest(evil, identity)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('state_registry_hash')
  })
  test('missing required field names the field', () => {
    const broken = JSON.parse(text)
    delete broken.outputs.hashes.result_id
    expect(() => parseManifest(JSON.stringify(broken))).toThrow(/result_id/)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/decode/manifest.ts`:
```ts
export interface RunManifest {
  eventSchemaVersion: number; stateSchemaVersion: number
  schemaRegistryHash: string; stateRegistryHash: string
  scenarioId: string; seed: string; dtUs: number
  eventHash: string; stateTrajectoryHash: string; resultId: string
  eventCount: number; tickCount: number; runComplete: boolean; terminationReason: number
  simTimeStartUs: string; simTimeEndUs: string
  caseId: string; attemptId: string; commit: string; dirty: boolean; createdAt: string
}

function req<T>(v: T | undefined | null, path: string): T {
  if (v === undefined || v === null) throw new Error(`manifest: missing ${path}`)
  return v
}
const hex64 = (v: string, path: string): string => {
  if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`manifest: ${path} is not 64-hex`)
  return v
}

export function parseManifest(jsonText: string): RunManifest {
  const j = JSON.parse(jsonText)
  const inputs = req(j.inputs, 'inputs')
  const outputs = req(j.outputs, 'outputs')
  const hashes = req(outputs.hashes, 'outputs.hashes')
  const prov = req(j.provenance, 'provenance')
  return {
    eventSchemaVersion: req(inputs.event_schema_version, 'inputs.event_schema_version'),
    stateSchemaVersion: req(inputs.state_schema_version, 'inputs.state_schema_version'),
    schemaRegistryHash: hex64(req(inputs.schema_registry_hash, 'inputs.schema_registry_hash'), 'schema_registry_hash'),
    stateRegistryHash: hex64(req(inputs.state_registry_hash, 'inputs.state_registry_hash'), 'state_registry_hash'),
    scenarioId: req(inputs.scenario_id, 'inputs.scenario_id'),
    seed: String(req(inputs.seed, 'inputs.seed')),
    dtUs: Number(req(inputs.config?.dt_us, 'inputs.config.dt_us')),
    eventHash: hex64(req(hashes.event_hash?.value, 'outputs.hashes.event_hash.value'), 'event_hash'),
    stateTrajectoryHash: hex64(req(hashes.state_trajectory_hash?.value, 'outputs.hashes.state_trajectory_hash.value'), 'state_trajectory_hash'),
    resultId: hex64(req(hashes.result_id?.value, 'outputs.hashes.result_id.value'), 'result_id'),
    eventCount: Number(req(outputs.event_count, 'outputs.event_count')),
    tickCount: Number(req(outputs.tick_count, 'outputs.tick_count')),
    runComplete: req(outputs.run_complete, 'outputs.run_complete'),
    terminationReason: req(outputs.termination_reason, 'outputs.termination_reason'),
    simTimeStartUs: String(req(outputs.sim_time_start_us, 'outputs.sim_time_start_us')),
    simTimeEndUs: String(req(outputs.sim_time_end_us, 'outputs.sim_time_end_us')),
    caseId: hex64(req(prov.case_id, 'provenance.case_id'), 'case_id'),
    attemptId: req(prov.attempt_id, 'provenance.attempt_id'),
    commit: req(prov.commit, 'provenance.commit'),
    dirty: req(prov.dirty, 'provenance.dirty'),
    createdAt: req(prov.created_at, 'provenance.created_at'),
  }
}

export interface Identity { eventSchemaVersion: number; stateSchemaVersion: number; schemaRegistryHash: string; stateRegistryHash: string }
export type GateResult = { ok: true } | { ok: false; field: string; expected: string; actual: string }

export function gateManifest(m: RunManifest, id: Identity): GateResult {
  const checks: [string, string | number, string | number][] = [
    ['event_schema_version', id.eventSchemaVersion, m.eventSchemaVersion],
    ['state_schema_version', id.stateSchemaVersion, m.stateSchemaVersion],
    ['schema_registry_hash', id.schemaRegistryHash, m.schemaRegistryHash],
    ['state_registry_hash', id.stateRegistryHash, m.stateRegistryHash],
  ]
  for (const [field, expected, actual] of checks)
    if (expected !== actual) return { ok: false, field, expected: String(expected), actual: String(actual) }
  return { ok: true }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/decode && git commit -m "feat: manifest parser + four-tuple identity gate (dialect screen data)"`

---

### Task 10: decodeBundle columns + worker + BundleSource

**Files:**
- Create: `src/decode/decodeBundle.ts`, `src/decode/worker.ts`, `src/source/bundleSource.ts`
- Test: `src/decode/decodeBundle.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–9.
- Produces:
  - `interface DecodedRun { header: FileHeader; seq: Float64Array; tick: Float64Array; kind: Uint16Array; causation: Float64Array /* -1 = None */; payloadOff: Uint32Array; payloadLen: Uint32Array; stateOff: Uint32Array; stateLen: Uint32Array /* payload spans into det, index = tickIndex */; det: ArrayBuffer; verify: VerifyResult }`
  - `decodeBundle(det: ArrayBuffer): DecodedRun` — pure, callable from tests and worker.
  - `transferablesOf(run: DecodedRun): ArrayBuffer[]`.
  - Worker protocol: main posts `{ det: ArrayBuffer }` (transferred); worker posts `{ type: 'progress', fraction: number }` then `{ type: 'done', run: DecodedRun }` (transferred) or `{ type: 'error', code: string, message: string }`.
  - `decodeInWorker(det: ArrayBuffer, onProgress?: (f: number) => void): Promise<DecodedRun>`.
  - `fetchBundle(baseUrl: string): Promise<{ det: ArrayBuffer; manifestText: string }>` (fetches `${baseUrl}/bundle.det` + `${baseUrl}/manifest.json`, throws on non-200).

- [ ] **Step 1: Failing test (pure function only — the worker wrapper is thin glue)**

`src/decode/decodeBundle.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from './decodeBundle'
import { decodeEvent } from './payloads'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('decodeBundle columns (E0)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  test('75 events, 76 state frames, verified', () => {
    expect(run.seq.length).toBe(75)
    expect(run.stateOff.length).toBe(76)
    expect(run.verify.matchesTrailer).toBe(true)
  })
  test('columns agree with a direct payload decode (spot check seq 10)', () => {
    const span = new Uint8Array(run.det).subarray(run.payloadOff[10]!, run.payloadOff[10]! + run.payloadLen[10]!)
    const e = decodeEvent(span)
    expect(e.seq).toBe(run.seq[10]); expect(e.tick).toBe(run.tick[10]); expect(e.kind).toBe(run.kind[10])
  })
  test('seq column is 0..74 in order; causation -1 encodes None', () => {
    expect(run.seq[0]).toBe(0); expect(run.seq[74]).toBe(74)
    expect([...run.causation].every(c => c === -1 || (c >= 0 && Number.isInteger(c)))).toBe(true)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/decode/decodeBundle.ts`:
```ts
import { FILE_HEADER_LEN, FrameTag, parseFileHeader, type FileHeader } from './frames'
import { crc32c } from '../lib/crc32c'
import { DecodeError } from '../lib/bytes'
import { decodeEvent } from './payloads'
import { foldAndVerify, type VerifyResult } from './verify'

export interface DecodedRun {
  header: FileHeader
  seq: Float64Array; tick: Float64Array; kind: Uint16Array; causation: Float64Array
  payloadOff: Uint32Array; payloadLen: Uint32Array
  stateOff: Uint32Array; stateLen: Uint32Array
  det: ArrayBuffer
  verify: VerifyResult
}

export function decodeBundle(det: ArrayBuffer): DecodedRun {
  const bytes = new Uint8Array(det)
  const header = parseFileHeader(bytes)
  const verify = foldAndVerify(bytes) // full CRC + fold pass; throws on malformed input

  const events: { seq: number; tick: number; kind: number; causation: number; off: number; len: number }[] = []
  const states: { off: number; len: number }[] = []
  let off = FILE_HEADER_LEN
  while (off < bytes.byteLength) {
    const tag = bytes[off]!
    const len = new DataView(det, off + 1, 4).getUint32(0, true)
    const pOff = off + 5
    if (tag === FrameTag.Event) {
      const e = decodeEvent(bytes.subarray(pOff, pOff + len))
      events.push({ seq: e.seq, tick: e.tick, kind: e.kind, causation: e.causationId ?? -1, off: pOff, len })
    } else if (tag === FrameTag.StateTick) {
      states.push({ off: pOff, len })
    }
    off = pOff + len + 4
  }
  void crc32c // (CRC already enforced inside foldAndVerify's iterateFrames)

  const n = events.length
  const run: DecodedRun = {
    header, det, verify,
    seq: new Float64Array(n), tick: new Float64Array(n), kind: new Uint16Array(n),
    causation: new Float64Array(n), payloadOff: new Uint32Array(n), payloadLen: new Uint32Array(n),
    stateOff: new Uint32Array(states.length), stateLen: new Uint32Array(states.length),
  }
  events.forEach((e, i) => {
    if (e.seq !== i) throw new DecodeError('MalformedPayload', `seq ${e.seq} at index ${i}`)
    run.seq[i] = e.seq; run.tick[i] = e.tick; run.kind[i] = e.kind
    run.causation[i] = e.causation; run.payloadOff[i] = e.off; run.payloadLen[i] = e.len
  })
  states.forEach((s, i) => { run.stateOff[i] = s.off; run.stateLen[i] = s.len })
  return run
}

export const transferablesOf = (r: DecodedRun): ArrayBuffer[] => [
  r.det, r.seq.buffer, r.tick.buffer, r.kind.buffer, r.causation.buffer,
  r.payloadOff.buffer, r.payloadLen.buffer, r.stateOff.buffer, r.stateLen.buffer,
] as ArrayBuffer[]
```

`src/decode/worker.ts`:
```ts
import { decodeBundle, transferablesOf } from './decodeBundle'
import { DecodeError } from '../lib/bytes'

self.onmessage = (msg: MessageEvent<{ det: ArrayBuffer }>) => {
  try {
    self.postMessage({ type: 'progress', fraction: 0 })
    const run = decodeBundle(msg.data.det)
    self.postMessage({ type: 'progress', fraction: 1 })
    self.postMessage({ type: 'done', run }, { transfer: transferablesOf(run) })
  } catch (e) {
    const code = e instanceof DecodeError ? e.code : 'Unknown'
    self.postMessage({ type: 'error', code, message: e instanceof Error ? e.message : String(e) })
  }
}
```

`src/source/bundleSource.ts`:
```ts
import type { DecodedRun } from '../decode/decodeBundle'

export async function fetchBundle(baseUrl: string): Promise<{ det: ArrayBuffer; manifestText: string }> {
  const [detRes, manRes] = await Promise.all([fetch(`${baseUrl}/bundle.det`), fetch(`${baseUrl}/manifest.json`)])
  if (!detRes.ok) throw new Error(`fetch ${baseUrl}/bundle.det: ${detRes.status}`)
  if (!manRes.ok) throw new Error(`fetch ${baseUrl}/manifest.json: ${manRes.status}`)
  return { det: await detRes.arrayBuffer(), manifestText: await manRes.text() }
}

export function decodeInWorker(det: ArrayBuffer, onProgress?: (f: number) => void): Promise<DecodedRun> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../decode/worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (m: MessageEvent<{ type: string; run?: DecodedRun; fraction?: number; code?: string; message?: string }>) => {
      if (m.data.type === 'progress') onProgress?.(m.data.fraction!)
      else if (m.data.type === 'done') { resolve(m.data.run!); w.terminate() }
      else { reject(new Error(`${m.data.code}: ${m.data.message}`)); w.terminate() }
    }
    w.postMessage({ det }, { transfer: [det] })
  })
}
```

- [ ] **Step 4: Run → PASS** (`npx vitest run src/decode`). Also `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add src/decode src/source && git commit -m "feat: transferable column decode + worker wrapper + static bundle source"`

---

### Task 11: RunModel

**Files:**
- Create: `src/model/runModel.ts`
- Test: `src/model/runModel.test.ts`

**Interfaces:**
- Consumes: `DecodedRun`, `RunManifest`, payload decoders.
- Produces: `class RunModel` — `constructor(run: DecodedRun, manifest: RunManifest | null)`; `eventCount: number`; `tickCount: number`; `readonly verify: VerifyResult` (= `run.verify`); `readonly ticks: Float64Array` (= `run.tick`, for the timeline density ribbon); `eventAt(seq: number): EventEnvelope`; `parentOf(seq: number): number | null`; `childrenOf(seq: number): readonly number[]`; `eventsByTick(tick: number): readonly number[]`; `entityKeys(): readonly string[]` (format `"${ns}:${id}"`, from StateTick 0); `entityStatesAt(tick: number): ReadonlyMap<string, EntityV2>` (ns=1 records only; LRU cache, capacity 16); `geometryQueryAt(seq: number): GeometryQuery | null`. **No module-level singletons** — everything is instance state (spec §5.6 protection).

- [ ] **Step 1: Failing test**

`src/model/runModel.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from './runModel'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const f0 = new RunModel(decodeBundle(load('f0_seed42.det')), null)
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)

describe('causal index (F0)', () => {
  test('event 1 parent is 0; event 0 children are [1]', () => {
    expect(f0.parentOf(1)).toBe(0)
    expect(f0.parentOf(0)).toBeNull()
    expect(f0.childrenOf(0)).toEqual([1])
  })
  test('verify and ticks column are exposed', () => {
    expect(f0.verify.matchesTrailer).toBe(true)
    expect(f0.ticks.length).toBe(2)
  })
})
describe('tick index (E0)', () => {
  test('every tick 0..74 has exactly one event', () => {
    for (let t = 0; t < 75; t++) expect(e0.eventsByTick(t)).toHaveLength(1)
  })
  test('kind-23 payloads decode via geometryQueryAt; F0 fixture events return null', () => {
    expect(e0.geometryQueryAt(0)).not.toBeNull()
    expect(f0.geometryQueryAt(0)).toBeNull()
  })
})
describe('lazy state materialization equivalence', () => {
  test('same tick decoded twice (through cache eviction) is deeply equal', () => {
    const first = structuredClone(e0.entityStatesAt(5))
    for (let t = 6; t < 30; t++) e0.entityStatesAt(t) // force eviction (LRU 16)
    expect(structuredClone(e0.entityStatesAt(5))).toEqual(first)
  })
  test('F0 entity value follows the fixture transitions (0 at tick 0)', () => {
    const s0 = f0.entityStatesAt(0)
    expect([...s0.keys()]).toEqual(['1:0'])
    expect(s0.get('1:0')!.value).toBe(0n)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/model/runModel.ts`:
```ts
import type { DecodedRun } from '../decode/decodeBundle'
import type { RunManifest } from '../decode/manifest'
import {
  GEOMETRY_QUERY_RESOLVED, decodeEvent, decodeEntityV2, decodeGeometryQuery, decodeStateTick,
  type EntityV2, type EventEnvelope, type GeometryQuery,
} from '../decode/payloads'

export class RunModel {
  readonly eventCount: number
  readonly tickCount: number
  readonly verify: DecodedRun['verify']
  readonly ticks: Float64Array
  private det: Uint8Array
  private children: number[][]
  private byTick: number[][]
  private stateCache = new Map<number, Map<string, EntityV2>>() // insertion-ordered → LRU
  private static CACHE_CAP = 16

  constructor(private run: DecodedRun, readonly manifest: RunManifest | null) {
    this.det = new Uint8Array(run.det)
    this.verify = run.verify
    this.ticks = run.tick
    this.eventCount = run.seq.length
    this.tickCount = run.stateOff.length - 1
    this.children = Array.from({ length: this.eventCount }, () => [])
    this.byTick = Array.from({ length: this.tickCount }, () => [])
    for (let i = 0; i < this.eventCount; i++) {
      const c = run.causation[i]!
      if (c >= 0) this.children[c]!.push(i)
      this.byTick[run.tick[i]!]!.push(i)
    }
  }

  private payloadSpan(seq: number): Uint8Array {
    return this.det.subarray(this.run.payloadOff[seq]!, this.run.payloadOff[seq]! + this.run.payloadLen[seq]!)
  }
  eventAt(seq: number): EventEnvelope { return decodeEvent(this.payloadSpan(seq)) }
  parentOf(seq: number): number | null { const c = this.run.causation[seq]!; return c >= 0 ? c : null }
  childrenOf(seq: number): readonly number[] { return this.children[seq]! }
  eventsByTick(tick: number): readonly number[] { return this.byTick[tick] ?? [] }

  entityKeys(): readonly string[] {
    return [...this.decodeState(0).keys()]
  }
  entityStatesAt(tick: number): ReadonlyMap<string, EntityV2> {
    const hit = this.stateCache.get(tick)
    if (hit) { this.stateCache.delete(tick); this.stateCache.set(tick, hit); return hit }
    const m = this.decodeState(tick)
    this.stateCache.set(tick, m)
    if (this.stateCache.size > RunModel.CACHE_CAP)
      this.stateCache.delete(this.stateCache.keys().next().value!)
    return m
  }
  private decodeState(tick: number): Map<string, EntityV2> {
    const span = this.det.subarray(this.run.stateOff[tick]!, this.run.stateOff[tick]! + this.run.stateLen[tick]!)
    const frame = decodeStateTick(span)
    const m = new Map<string, EntityV2>()
    for (const e of frame.entities)
      if (e.namespaceTag === 1) m.set(`${e.namespaceTag}:${e.id}`, decodeEntityV2(e.fieldBytes))
    return m
  }
  geometryQueryAt(seq: number): GeometryQuery | null {
    if (this.run.kind[seq] !== GEOMETRY_QUERY_RESOLVED) return null
    return decodeGeometryQuery(this.eventAt(seq).payload)
  }
}
```
(Note: `structuredClone` of a Map containing `bigint` works in Node 22 and browsers; if vitest's environment complains, compare field-by-field instead.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/model && git commit -m "feat: RunModel with causal/tick indexes and LRU lazy state materialization"`

---

### Task 12: View store, deep links, transport clock

**Files:**
- Create: `src/state/viewStore.ts`, `src/state/transport.ts`, `src/state/url.ts`
- Test: `src/state/url.test.ts`, `src/state/transport.test.ts`

**Interfaces:**
- Produces:
  - `transport.ts`: `advancePlayhead(tick: number, fraction: number, dtMs: number, speed: number, dtUs: number, maxTick: number): { tick: number; fraction: number; done: boolean }` — pure. Sim-seconds per wall-second = `speed`; ticks advanced = `dtMs * 1000 * speed / dtUs`. Clamps at `maxTick` with `fraction 0` and `done: true`.
  - `url.ts`: `interface LinkState { run: string; tick: number; sel: string | null; ev: number | null; speed: number }`; `encodeLink(s: LinkState): string` (query string, omits defaults); `parseLink(qs: string): Partial<LinkState>` (ignores malformed values).
  - `viewStore.ts`: zustand store `useViewStore` with state `{ runId: string; tick: number; fraction: number; playing: boolean; speed: number; selectedEntity: string | null; selectedEvent: number | null }` and actions `{ setTick(t: number): void; setPlaying(p: boolean): void; setSpeed(s: number): void; select(entity: string | null, event: number | null): void; applyLink(l: Partial<LinkState>): void }`. Playhead consumers read via `useViewStore.getState()` in `useFrame` (never as props). A `syncUrl()` helper writes `history.replaceState` throttled to ≤ 2 Hz and never during `playing`.

- [ ] **Step 1: Failing tests**

`src/state/transport.test.ts`:
```ts
import { expect, test } from 'vitest'
import { advancePlayhead } from './transport'

test('1× over one wall second advances 1 sim second of ticks (dt 1000µs → 1000 ticks)', () => {
  const r = advancePlayhead(0, 0, 1000, 1, 1000, 5000)
  expect(r.tick).toBe(1000); expect(r.done).toBe(false)
})
test('fractional accumulation over 60 frames ≈ 1 tick at dt=1s (fp-tolerant)', () => {
  let s = { tick: 0, fraction: 0, done: false }
  for (let i = 0; i < 60; i++) s = advancePlayhead(s.tick, s.fraction, 1000 / 60, 1, 1000000, 74)
  expect(s.tick + s.fraction).toBeCloseTo(1, 6) // never assert fp accumulation exactly
})
test('clamps at maxTick', () => {
  const r = advancePlayhead(74, 0.9, 1000, 8, 1000000, 74)
  expect(r).toEqual({ tick: 74, fraction: 0, done: true })
})
```

`src/state/url.test.ts`:
```ts
import { expect, test } from 'vitest'
import { encodeLink, parseLink } from './url'

test('round-trip', () => {
  const s = { run: 'e0', tick: 42, sel: '1:0', ev: 17, speed: 2 }
  expect(parseLink(encodeLink(s))).toEqual(s)
})
test('defaults omitted; malformed ignored', () => {
  expect(encodeLink({ run: 'f0', tick: 0, sel: null, ev: null, speed: 1 })).toBe('run=f0')
  expect(parseLink('run=f0&tick=NaN&ev=-3')).toEqual({ run: 'f0' })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/state/transport.ts`:
```ts
export function advancePlayhead(tick: number, fraction: number, dtMs: number, speed: number, dtUs: number, maxTick: number) {
  const ticks = tick + fraction + (dtMs * 1000 * speed) / dtUs
  if (ticks >= maxTick) return { tick: maxTick, fraction: 0, done: true }
  return { tick: Math.floor(ticks), fraction: ticks - Math.floor(ticks), done: false }
}
```

`src/state/url.ts`:
```ts
export interface LinkState { run: string; tick: number; sel: string | null; ev: number | null; speed: number }

export function encodeLink(s: LinkState): string {
  const p = new URLSearchParams()
  p.set('run', s.run)
  if (s.tick > 0) p.set('tick', String(s.tick))
  if (s.sel) p.set('sel', s.sel)
  if (s.ev !== null) p.set('ev', String(s.ev))
  if (s.speed !== 1) p.set('speed', String(s.speed))
  return p.toString()
}

export function parseLink(qs: string): Partial<LinkState> {
  const p = new URLSearchParams(qs)
  const out: Partial<LinkState> = {}
  const run = p.get('run'); if (run) out.run = run
  const num = (k: string) => { const v = Number(p.get(k)); return Number.isFinite(v) && v >= 0 ? v : null }
  const tick = p.get('tick') !== null ? num('tick') : null; if (tick !== null) out.tick = tick
  const ev = p.get('ev') !== null ? num('ev') : null; if (ev !== null) out.ev = ev
  const speed = p.get('speed') !== null ? num('speed') : null; if (speed !== null && speed! > 0) out.speed = speed
  const sel = p.get('sel'); if (sel) out.sel = sel
  return out
}
```

`src/state/viewStore.ts`:
```ts
import { create } from 'zustand'
import { encodeLink, parseLink, type LinkState } from './url'

interface ViewState {
  runId: string; tick: number; fraction: number; playing: boolean; speed: number
  selectedEntity: string | null; selectedEvent: number | null
  setTick(t: number): void; setPlaying(p: boolean): void; setSpeed(s: number): void
  select(entity: string | null, event: number | null): void
  applyLink(l: Partial<LinkState>): void
}

export const useViewStore = create<ViewState>((set) => ({
  runId: 'f0', tick: 0, fraction: 0, playing: false, speed: 1,
  selectedEntity: null, selectedEvent: null,
  setTick: (tick) => set({ tick: Math.max(0, Math.floor(tick)), fraction: 0 }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  select: (selectedEntity, selectedEvent) => set({ selectedEntity, selectedEvent }),
  applyLink: (l) => set((s) => ({
    runId: l.run ?? s.runId, tick: l.tick ?? s.tick,
    selectedEntity: l.sel ?? s.selectedEntity, selectedEvent: l.ev ?? s.selectedEvent,
    speed: l.speed ?? s.speed,
  })),
}))

let lastSync = 0
export function syncUrl(): void {
  const s = useViewStore.getState()
  if (s.playing) return
  const now = performance.now()
  if (now - lastSync < 500) return
  lastSync = now
  const qs = encodeLink({ run: s.runId, tick: s.tick, sel: s.selectedEntity, ev: s.selectedEvent, speed: s.speed })
  history.replaceState(null, '', `?${qs}`)
}
export function applyUrlOnLoad(): void {
  useViewStore.getState().applyLink(parseLink(location.search.slice(1)))
}
```

- [ ] **Step 4: Run → PASS** (`npx vitest run src/state`).
- [ ] **Step 5: Commit** — `git add src/state && git commit -m "feat: view store, pure transport clock, URL deep-link codec"`

---

### Task 13: App shell, Timeline, Provenance panel

**Files:**
- Create: `src/ui/Timeline.tsx`, `src/ui/ProvenancePanel.tsx`, `src/ui/badges.ts`, `src/ui/useRun.ts`, `src/ui/density.ts`, `src/ui/app.css`
- Modify: `src/ui/App.tsx`
- Test: `src/ui/density.test.ts`, `src/ui/badges.test.ts`

**Interfaces:**
- Consumes: `fetchBundle`, `decodeInWorker`, `parseManifest`, `gateManifest`, `RunModel`, `useViewStore`, `advancePlayhead`, `syncUrl`, `applyUrlOnLoad`, `EVENT_KIND_NAMES`.
- Produces:
  - `density.ts`: `densityBins(ticks: Float64Array, tickCount: number, bins: number): Float32Array` (normalized 0..1 per bin).
  - `badges.ts`: `type BadgeState = 'pending' | 'verified' | 'mismatch'`; `badge(expectedHex: string | null, recomputedHex: string | null): BadgeState` — `pending` while recomputed is null, `verified` on equal, `mismatch` otherwise (a null expected with a recomputed value is `verified` — det-only runs have no manifest claim to contradict).
  - `useRun.ts`: `useRun(runId: string): { model: RunModel | null; gate: GateResult | null; error: string | null; progress: number }` — fetches `runs/index.json`, then the pair; worker-decodes; gates; builds RunModel. Unknown-dialect result renders the gate screen, not the run.
  - `Timeline.tsx`: canvas strip — density ribbon, playhead line, click-to-scrub, play/pause + speed buttons; a `requestAnimationFrame` loop drives `advancePlayhead` writing to the store; canvas redraw reads `getState()` (no React re-render per frame); space bar toggles play.
  - `ProvenancePanel.tsx`: renders manifest identity fields (`scenario_id`, `seed`, `case_id`, `result_id`, `event_hash`, `state_trajectory_hash`, both registry hashes, `commit`, `dirty`, `created_at`) each with its badge glyph (`⋯` pending / `✓` verified / `✗` mismatch) computed from `run.verify` vs manifest.
  - `App.tsx`: layout = main viewport (Scene mounts in Task 14; placeholder div until then) + right provenance panel + bottom timeline; run picker from `runs/index.json`; dialect-gate screen shows the offending field/expected/actual; decode errors show code + message.

- [ ] **Step 1: Failing tests (pure parts)**

`src/ui/density.test.ts`:
```ts
import { expect, test } from 'vitest'
import { densityBins } from './density'

test('bins events by tick and normalizes to max 1', () => {
  const ticks = Float64Array.from([0, 0, 0, 5, 9])
  const bins = densityBins(ticks, 10, 5)
  expect(bins.length).toBe(5)
  expect(bins[0]).toBe(1)       // 3 events in ticks 0-1 → max bin
  expect(bins[2]).toBeCloseTo(1 / 3) // 1 event in ticks 4-5
  expect(bins[4]).toBeCloseTo(1 / 3)
})
test('empty run yields zeros', () => {
  expect([...densityBins(new Float64Array(0), 10, 4)]).toEqual([0, 0, 0, 0])
})
```

`src/ui/badges.test.ts`:
```ts
import { expect, test } from 'vitest'
import { badge } from './badges'

test('states', () => {
  expect(badge('aa', null)).toBe('pending')
  expect(badge('aa', 'aa')).toBe('verified')
  expect(badge('aa', 'bb')).toBe('mismatch')
  expect(badge(null, 'aa')).toBe('verified')
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement pure modules**

`src/ui/density.ts`:
```ts
export function densityBins(ticks: Float64Array, tickCount: number, bins: number): Float32Array {
  const out = new Float32Array(bins)
  if (tickCount === 0) return out
  for (let i = 0; i < ticks.length; i++) {
    const b = Math.min(bins - 1, Math.floor((ticks[i]! / tickCount) * bins))
    out[b]!++
  }
  const max = Math.max(...out)
  if (max > 0) for (let i = 0; i < bins; i++) out[i]! /= max
  return out
}
```

`src/ui/badges.ts`:
```ts
export type BadgeState = 'pending' | 'verified' | 'mismatch'
export function badge(expectedHex: string | null, recomputedHex: string | null): BadgeState {
  if (recomputedHex === null) return 'pending'
  if (expectedHex === null) return 'verified'
  return expectedHex === recomputedHex ? 'verified' : 'mismatch'
}
```

- [ ] **Step 4: Run pure tests → PASS.**

- [ ] **Step 5: Implement the components**

`src/ui/useRun.ts`:
```ts
import { useEffect, useState } from 'react'
import { fetchBundle, decodeInWorker } from '../source/bundleSource'
import { gateManifest, parseManifest, type GateResult, type Identity } from '../decode/manifest'
import { RunModel } from '../model/runModel'
import identity from '../../contract/identity.json'

export interface RunEntry { id: string; title: string; base: string }

export function useRun(runId: string) {
  const [state, setState] = useState<{ model: RunModel | null; gate: GateResult | null; error: string | null; progress: number }>({ model: null, gate: null, error: null, progress: 0 })
  useEffect(() => {
    let alive = true
    setState({ model: null, gate: null, error: null, progress: 0 })
    ;(async () => {
      try {
        const index: RunEntry[] = await (await fetch('runs/index.json')).json()
        const entry = index.find(r => r.id === runId) ?? index[0]
        if (!entry) throw new Error('no runs published')
        const { det, manifestText } = await fetchBundle(entry.base)
        const manifest = parseManifest(manifestText)
        const gate = gateManifest(manifest, identity as Identity)
        if (!gate.ok) { if (alive) setState(s => ({ ...s, gate })); return }
        const run = await decodeInWorker(det, f => { if (alive) setState(s => ({ ...s, progress: f })) })
        if (alive) setState({ model: new RunModel(run, manifest), gate, error: null, progress: 1 })
      } catch (e) {
        if (alive) setState(s => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
      }
    })()
    return () => { alive = false }
  }, [runId])
  return state
}
```
(Enable `"resolveJsonModule": true` in tsconfig for the identity import.)

`src/ui/Timeline.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { RunModel } from '../model/runModel'
import { useViewStore, syncUrl } from '../state/viewStore'
import { advancePlayhead } from '../state/transport'
import { densityBins } from './density'

export function Timeline({ model, ticksColumn, dtUs }: { model: RunModel; ticksColumn: Float64Array; dtUs: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speed = useViewStore(s => s.speed)
  const playing = useViewStore(s => s.playing)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const bins = densityBins(ticksColumn, model.tickCount, 200)
    let last = performance.now()
    let raf = 0
    const draw = (now: number) => {
      const s = useViewStore.getState()
      if (s.playing) {
        const a = advancePlayhead(s.tick, s.fraction, now - last, s.speed, dtUs, model.tickCount - 1)
        useViewStore.setState({ tick: a.tick, fraction: a.fraction, playing: !a.done && s.playing })
      }
      last = now
      const { width: w, height: h } = canvas
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < bins.length; i++) {
        ctx.fillStyle = `rgba(90, 170, 255, ${0.15 + 0.85 * bins[i]!})`
        ctx.fillRect((i / bins.length) * w, h * (1 - bins[i]! * 0.8) - 4, w / bins.length - 1, bins[i]! * 0.8 * h)
      }
      const cur = useViewStore.getState()
      const x = ((cur.tick + cur.fraction) / Math.max(1, model.tickCount - 1)) * w
      ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 1, 0, 2, h)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [model, ticksColumn, dtUs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        useViewStore.getState().setPlaying(!useViewStore.getState().playing)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const scrub = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = Math.round(((e.clientX - rect.left) / rect.width) * (model.tickCount - 1))
    useViewStore.getState().setTick(t)
    syncUrl()
  }

  return (
    <div className="timeline">
      <button onClick={() => useViewStore.getState().setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
      {[0.25, 1, 4, 8].map(s => (
        <button key={s} className={s === speed ? 'active' : ''} onClick={() => useViewStore.getState().setSpeed(s)}>{s}×</button>
      ))}
      <canvas ref={canvasRef} width={1200} height={64} onClick={scrub} />
      <TickReadout maxTick={model.tickCount - 1} />
    </div>
  )
}

function TickReadout({ maxTick }: { maxTick: number }) {
  // throttled subscription: re-renders at most on integer-tick changes
  const tick = useViewStore(s => s.tick)
  return <span className="readout">tick {tick} / {maxTick}</span>
}
```

`src/ui/ProvenancePanel.tsx`:
```tsx
import type { RunModel } from '../model/runModel'
import { badge, type BadgeState } from './badges'

const GLYPH: Record<BadgeState, string> = { pending: '⋯', verified: '✓', mismatch: '✗' }

export function ProvenancePanel({ model }: { model: RunModel }) {
  const m = model.manifest
  const verify = model.verify
  const rows: [string, string, BadgeState][] = [
    ['scenario', m?.scenarioId ?? '(det-only)', 'verified'],
    ['seed', m?.seed ?? '—', 'verified'],
    ['case_id', short(verify.caseIdHex), badge(m?.caseId ?? null, verify.caseIdHex)],
    ['result_id', short(verify.resultIdHex), badge(m?.resultId ?? null, verify.resultIdHex)],
    ['event_hash', short(verify.eventHashHex), badge(m?.eventHash ?? null, verify.eventHashHex)],
    ['state_trajectory_hash', short(verify.stateHashHex), badge(m?.stateTrajectoryHash ?? null, verify.stateHashHex)],
    ['schema_registry', short(m?.schemaRegistryHash ?? ''), 'verified'],
    ['state_registry', short(m?.stateRegistryHash ?? ''), 'verified'],
    ['commit', m?.commit ?? '—', 'verified'],
    ['dirty', String(m?.dirty ?? '—'), m?.dirty ? 'mismatch' : 'verified'],
  ]
  return (
    <aside className="provenance">
      <h2>provenance</h2>
      <table><tbody>
        {rows.map(([k, val, b]) => (
          <tr key={k} className={b}><td>{GLYPH[b]}</td><td>{k}</td><td title={val}>{val}</td></tr>
        ))}
      </tbody></table>
      <p className="counts">{verify.eventCount} events · {verify.tickCount} ticks · trailer {verify.matchesTrailer ? 'consistent ✓' : 'INCONSISTENT ✗'}</p>
    </aside>
  )
}
const short = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h)
```
(`model.verify` and `model.ticks` are provided by Task 11.)

`src/ui/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useRun, type RunEntry } from './useRun'
import { Timeline } from './Timeline'
import { ProvenancePanel } from './ProvenancePanel'
import { applyUrlOnLoad, syncUrl, useViewStore } from '../state/viewStore'
import './app.css'

export default function App() {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const runId = useViewStore(s => s.runId)
  useEffect(() => { applyUrlOnLoad() }, [])
  useEffect(() => { fetch('runs/index.json').then(r => r.json()).then(setRuns).catch(() => setRuns([])) }, [])
  const { model, gate, error, progress } = useRun(runId)
  const selectRun = (id: string) => { useViewStore.setState({ runId: id, tick: 0, fraction: 0, playing: false }); syncUrl() }

  if (error) return <div className="screen error"><h1>decode failed</h1><pre>{error}</pre></div>
  if (gate && !gate.ok) return (
    <div className="screen gate">
      <h1>this bundle speaks a newer dialect</h1>
      <p><code>{gate.field}</code></p>
      <p>expected <code>{gate.expected}</code></p>
      <p>found <code>{gate.actual}</code></p>
    </div>
  )
  if (!model) return <div className="screen loading">decoding… {(progress * 100).toFixed(0)}%</div>

  return (
    <div className="app">
      <header>
        <h1>swarm observatory</h1>
        <nav>{runs.map(r => <button key={r.id} className={r.id === runId ? 'active' : ''} onClick={() => selectRun(r.id)}>{r.id}</button>)}</nav>
      </header>
      <main id="viewport">{/* Scene mounts here in Task 14 */}</main>
      <ProvenancePanel model={model} />
      <Timeline model={model} ticksColumn={model.ticks} dtUs={model.manifest?.dtUs ?? 1000} />
    </div>
  )
}
```
`RunModel` must expose the tick column for the density ribbon: add `readonly ticks: Float64Array` (`this.ticks = run.tick`) alongside `verify`.

`src/ui/app.css` (dark, minimal — the §6 design pass lands in v0.2; keep it clean, not styled-by-accident):
```css
:root { color-scheme: dark; font-family: 'Segoe UI', system-ui, sans-serif; }
body { margin: 0; background: #0b0f14; color: #d7e0ea; }
.app { display: grid; grid-template: "header header" auto "viewport panel" 1fr "timeline timeline" auto / 1fr 320px; height: 100vh; }
header { grid-area: header; display: flex; gap: 1rem; align-items: center; padding: 0.5rem 1rem; border-bottom: 1px solid #1c2733; }
header h1 { font-size: 1rem; margin: 0; letter-spacing: 0.2em; text-transform: uppercase; color: #7fb4e6; }
#viewport { grid-area: viewport; min-height: 0; }
.provenance { grid-area: panel; overflow-y: auto; border-left: 1px solid #1c2733; padding: 1rem; font-size: 0.8rem; }
.provenance table { width: 100%; border-collapse: collapse; }
.provenance td { padding: 2px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.provenance tr.verified td:first-child { color: #4ade80; }
.provenance tr.mismatch td:first-child { color: #f87171; }
.timeline { grid-area: timeline; display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 1rem; border-top: 1px solid #1c2733; }
.timeline canvas { flex: 1; min-width: 0; cursor: crosshair; }
button { background: #16202b; color: #d7e0ea; border: 1px solid #263445; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
button.active { border-color: #7fb4e6; color: #7fb4e6; }
.screen { display: grid; place-items: center; height: 100vh; text-align: center; }
.readout { font-variant-numeric: tabular-nums; color: #8899aa; }
```

- [ ] **Step 6: Verify** — `npm run typecheck && npm run test && npm run dev`; open `http://localhost:5173/?run=f0`: provenance panel shows all-green badges against the F0 manifest, timeline scrubs and plays, URL updates on pause/scrub, reload restores tick. This is a browser-visual step — state plainly in the task log that you verified it by eye.
- [ ] **Step 7: Commit** — `git add src/ui src/model && git commit -m "feat: app shell with timeline transport, provenance badges, deep links"`

---

### Task 14: 3D scene — instanced entities, interpolation, E0 query pulses, perf HUD

**Files:**
- Create: `src/ui/Scene.tsx`
- Modify: `src/ui/App.tsx` (mount `<Scene model={model} />` in `#viewport`)
- Test: `src/ui/scenePlacement.test.ts` (pure placement logic), extracted into `src/ui/placement.ts`

**Interfaces:**
- Consumes: `RunModel`, `useViewStore` (transient reads only), `EntityV2`.
- Produces: `placement.ts`: `entityPosition(out: [number, number, number], e: EntityV2, index: number): void` — writes NED pos when `e.pos.length === 3` (x=east, y=-down→up, z=north for three.js), else a deterministic grid fallback `[2 * index, 0, 0]`; `lerp3(out, a, b, t)`.

- [ ] **Step 1: Failing test**

`src/ui/scenePlacement.test.ts`:
```ts
import { expect, test } from 'vitest'
import { entityPosition, lerp3 } from './placement'
import type { EntityV2 } from '../decode/payloads'

const ent = (pos: number[]): EntityV2 => ({ value: 0n, alive: true, pos, vel: [], headingRad: 0, speedMps: 0, turnRateRadps: 0, fuel: 0, setpoint: [] })

test('NED pos maps to three.js x=E, y=up(-D), z=N', () => {
  const out: [number, number, number] = [0, 0, 0]
  entityPosition(out, ent([100, 200, -50]), 0) // N=100 E=200 D=-50
  expect(out).toEqual([200, 50, 100])
})
test('empty pos falls back to deterministic grid by index', () => {
  const out: [number, number, number] = [0, 0, 0]
  entityPosition(out, ent([]), 3)
  expect(out).toEqual([6, 0, 0])
})
test('lerp3', () => {
  const out: [number, number, number] = [0, 0, 0]
  lerp3(out, [0, 0, 0], [10, 20, 30], 0.5)
  expect(out).toEqual([5, 10, 15])
})
```

- [ ] **Step 2: Run → FAIL, then implement**

`src/ui/placement.ts`:
```ts
import type { EntityV2 } from '../decode/payloads'

export function entityPosition(out: [number, number, number], e: EntityV2, index: number): void {
  if (e.pos.length === 3) { out[0] = e.pos[1]!; out[1] = -e.pos[2]!; out[2] = e.pos[0]! }
  else { out[0] = 2 * index; out[1] = 0; out[2] = 0 }
}
export function lerp3(out: [number, number, number], a: readonly number[], b: readonly number[], t: number): void {
  for (let i = 0; i < 3; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t
}
```

`src/ui/Scene.tsx`:
```tsx
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Perf } from 'r3f-perf'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'
import { entityPosition, lerp3 } from './placement'

const scratchMat = new THREE.Matrix4()
const scratchA: [number, number, number] = [0, 0, 0]
const scratchB: [number, number, number] = [0, 0, 0]
const scratchP: [number, number, number] = [0, 0, 0]

function Entities({ model }: { model: RunModel }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const pulseRef = useRef<THREE.Mesh>(null)
  const keys = useMemo(() => model.entityKeys(), [model])

  useFrame(() => {
    const { tick, fraction } = useViewStore.getState()
    const t0 = Math.min(tick, model.tickCount)
    const t1 = Math.min(t0 + 1, model.tickCount)
    const s0 = model.entityStatesAt(t0)
    const s1 = model.entityStatesAt(t1)
    const mesh = meshRef.current
    if (!mesh) return
    keys.forEach((k, i) => {
      const a = s0.get(k); const b = s1.get(k) ?? a
      if (!a) return
      entityPosition(scratchA, a, i)
      entityPosition(scratchB, b ?? a, i)
      lerp3(scratchP, scratchA, scratchB, fraction)
      scratchMat.makeRotationY(-(a.headingRad))
      scratchMat.setPosition(scratchP[0], scratchP[1], scratchP[2])
      mesh.setMatrixAt(i, scratchMat)
    })
    mesh.instanceMatrix.needsUpdate = true

    // E0 geometry-query pulse: expand a ring at the subject entity of this tick's kind-23 event
    const pulse = pulseRef.current
    if (pulse) {
      const seqs = model.eventsByTick(Math.min(tick, model.tickCount - 1))
      const q = seqs.length ? model.geometryQueryAt(seqs[0]!) : null
      if (q) {
        const idx = keys.indexOf(`1:${q.subject}`)
        const st = s0.get(`1:${q.subject}`)
        if (st) { entityPosition(scratchP, st, Math.max(idx, 0)); pulse.position.set(scratchP[0], scratchP[1], scratchP[2]) }
        const r = 0.5 + fraction * 2
        pulse.scale.setScalar(r)
        ;(pulse.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - fraction)
        ;(pulse.material as THREE.MeshBasicMaterial).color.setHex(q.resultFlag ? 0x4ade80 : 0xf87171)
        pulse.visible = true
      } else pulse.visible = false
    }
  })

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, keys.length]} frustumCulled={false}>
        <coneGeometry args={[0.4, 1.2, 6]} />
        <meshStandardMaterial color="#7fb4e6" emissive="#1a3a5c" />
      </instancedMesh>
      <mesh ref={pulseRef} visible={false} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1, 48]} />
        <meshBasicMaterial transparent depthWrite={false} />
      </mesh>
    </>
  )
}

export function Scene({ model }: { model: RunModel }) {
  return (
    <Canvas camera={{ position: [8, 6, 12], fov: 50 }} dpr={[1, 2]}>
      {import.meta.env.DEV && <Perf position="top-left" />}
      <color attach="background" args={['#0b0f14']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 10, 3]} intensity={1.2} />
      <gridHelper args={[40, 40, '#1c2733', '#141c26']} />
      <Entities model={model} />
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  )
}
```
Mount in `App.tsx`: `<main id="viewport"><Scene model={model} /></main>` (import at top). Note the frame loop touches React never — all reads via `getState()`, all writes via refs and scratch objects (Global Constraints).

- [ ] **Step 3: Run tests → PASS** (`npx vitest run src/ui`), `npm run typecheck`.
- [ ] **Step 4: Manual verify** — `npm run dev`, run `f0`: two-glyph grid, pulse absent (no kind-23), play works, r3f-perf HUD shows steady 60fps and **zero GC sawtooth while playing**. Note results in the task log. (E0 visual verification arrives when a LIVE E0 bundle is published to `public/runs/` — the golden `e0_seed42.det` has no manifest pair; that step is deferred to the v0.2 sample-content pass, and the E0 decode path is already golden-tested headlessly.)
- [ ] **Step 5: Commit** — `git add src/ui && git commit -m "feat: instanced 3D scene with tick interpolation, E0 query pulses, perf HUD"`

---

### Task 15: Playwright smoke + Pages deploy

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `.github/workflows/deploy.yml`
- Modify: `.github/workflows/ci.yml`, `package.json`

**Interfaces:**
- Consumes: the built app + `public/runs/f0`.
- Produces: CI gate "smoke" (app boots, decodes F0, all badges verified, canvas present, screenshot artifact); `main` deploys to GitHub Pages.

- [ ] **Step 1: Install and configure**

```bash
npm i -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader'] } } }],
})
```

`e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

test('boots, verifies F0, renders scene, restores deep link', async ({ page }) => {
  await page.goto('/?run=f0&tick=1')
  await expect(page.locator('.provenance')).toContainText('provenance', { timeout: 15000 })
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓')
  await expect(page.locator('.provenance tr.mismatch')).toHaveCount(0)
  await expect(page.locator('#viewport canvas')).toBeVisible()
  await expect(page.locator('.readout')).toHaveText('tick 1 / 1') // deep link restored (F0 maxTick = 1)
  await page.screenshot({ path: 'e2e/screenshots/smoke.png', fullPage: true })
})
```

`package.json` script: `"smoke": "playwright test"`.

- [ ] **Step 2: Run locally** — `npm run build && npm run smoke` → PASS, screenshot written.

- [ ] **Step 3: Wire CI + deploy**

Append to `ci.yml` job steps (after build):
```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run smoke
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: smoke-screenshots, path: e2e/screenshots }
```

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.d.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: BASE_PATH=/swarm-observatory/ npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: d
        uses: actions/deploy-pages@v4
```
(Enable Pages → GitHub Actions source in repo settings when the repo is pushed to GitHub — a human step; note it in the task log.)

- [ ] **Step 4: Commit** — `git add -A && git commit -m "ci: playwright smoke gate + GitHub Pages deploy"`

---

## Plan self-review notes (already applied)

- **Spec coverage v0.1 (spec §10 row 1):** decode+verify (T3–T8), narrow scope + not-a-verifier (T6–T8 implement exactly the §4.2 list), identity gate incl. `state_registry_hash` (T9), worker + transferables (T10), provenance panel (T13), timeline scrub/play (T13), StateTick positions + interpolation policy + E0 kind-23 rendering (T14), deep links (T12–T13), perf HUD (T14), CI + preview artifact + Pages (T1, T15), contract sync + `SOURCE.lock` (T2), branded types (T3), no-singleton RunModel (T11).
- **Deliberately out (per spec):** drag-drop and `.obsrun.zip` (v0.2, §4.1), keyboard grammar beyond space (v0.2, §6), cinematic post/design pass (v0.2, §6), comms lens & tour (v0.3). LIVE E0 sample publication is content, not code — it rides the first sync after a LIVE bundle is at hand.
- **Known seams called out inline:** `f1_seed42.json` key-shape check (T2 verifies before T8 consumes); noble blake3 context-option name (T5's vector is the arbiter); kind-23 field order (T7 defers to vendored spec-3b on failure); `RunModel.verify`/`RunModel.ticks` additions (T13 owns them with tests).
