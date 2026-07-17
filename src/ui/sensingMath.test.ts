import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildSensingStage, type SensingDraw } from './sensingStage'
import {
  recomputeAllSensing, recomputeInRange, recomputeLosClear, recomputeEligible, sensingGates,
} from './sensingMath'

function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const f2a = new RunModel(decodeBundle(detFixture('f2a_seed42')), null)
const stage = buildSensingStage(f2a)

// The load-bearing oracle: recompute every recomputable f2a gate from the REAL decoded bundle and prove the
// browser recomputation AGREES WITH THE ENGINE on all 96 — the same fixture + decode path the model uses.
describe('recomputeAllSensing — engine vs ours, on the real f2a bundle', () => {
  test('all 96 verdicts recompute-and-match: in_range, los_clear, and the eligible conjunction (0 disagreements)', () => {
    const s = recomputeAllSensing(stage.draws)
    expect(s.total).toBe(96)
    expect(s.poseless).toBe(0)
    expect(s.inRangeAgreed).toBe(96)
    expect(s.losClearAgreed).toBe(96)
    expect(s.conjunctionAgreed).toBe(96)
    expect(s.disagreements).toEqual([])
  })

  test('a corrupted engine bit is CAUGHT (the guard is meaningful, not vacuous)', () => {
    // Flip one decoded in_range; recomputeAllSensing must now report exactly that seq as a disagreement —
    // a silently-passing recompute would be worthless as a verification surface.
    const seq = stage.draws.findIndex((d): d is SensingDraw => d !== null)
    const tampered = stage.draws.map(d => (d && d.seq === seq ? ({ ...d, inRange: !d.inRange }) : d))
    const s = recomputeAllSensing(tampered)
    expect(s.inRangeAgreed).toBe(95)
    expect(s.disagreements).toEqual([seq])
  })
})

describe('per-form recompute (the pinned decision forms)', () => {
  test('in_range: d² ≤ r²max reproduces the decoded bit for every tick', () => {
    for (const d of stage.draws) if (d && d.g) expect(recomputeInRange(d.g).inRange).toBe(d.inRange)
  })
  test('los_clear: sensor→target segment vs occluder Q reproduces the decoded bit for every tick', () => {
    for (const d of stage.draws) if (d && d.g) expect(recomputeLosClear(d.g).losClear).toBe(d.losClear)
  })
  test('eligible = in_range ∧ in_fov ∧ los_clear is exactly the decoded eligible for every tick', () => {
    for (const d of stage.draws) if (d) expect(recomputeEligible(d.inRange, d.inFov, d.losClear)).toBe(d.eligible)
  })
  test('recomputeInRange is an honest predicate — a far pose is out of range, the origin is in range', () => {
    expect(recomputeInRange([0, 0, 0]).inRange).toBe(true)
    expect(recomputeInRange([1000, 1000, 0]).inRange).toBe(false)
  })
})

describe('THE VOICE SPLIT — in_range/los_clear/eligible recompute; in_fov is the claim voice, never a ✓', () => {
  const d = stage.draws.find((x): x is SensingDraw => x !== null)!
  const gates = sensingGates(d)
  const byId = new Map(gates.map(g => [g.id, g]))

  test('in_range, los_clear, eligible wear the recompute voice with a live agreement', () => {
    for (const id of ['in_range', 'los_clear', 'eligible'] as const) {
      expect(byId.get(id)!.voice).toBe('recompute')
      expect(typeof byId.get(id)!.agree).toBe('boolean')
    }
  })
  test('in_fov wears the CLAIM voice — agree is null (no bearing scalar exists to recompute), with its note', () => {
    const fov = byId.get('in_fov')!
    expect(fov.voice).toBe('claim')
    expect(fov.agree).toBeNull()
    expect(fov.note).toMatch(/no bearing/)
    // the decoded boolean is still surfaced (the lane) even though the recompute is withheld.
    expect(typeof fov.decoded).toBe('boolean')
  })
  test('a poseless draw declines EVERY recompute (agree null), never fabricates a position', () => {
    const poseless: SensingDraw = { ...d, g: null }
    const g = new Map(sensingGates(poseless).map(x => [x.id, x]))
    expect(g.get('in_range')!.agree).toBeNull()
    expect(g.get('los_clear')!.agree).toBeNull()
    // The eligible conjunction now goes LIVE on in_range + los_clear, so with no pose it too declines
    // (agree null) — it never falls back to a decoded-only echo dressed as a live ✓.
    expect(g.get('eligible')!.agree).toBeNull()
  })
})

// The eligible conjunction is a LIVE re-derivation, not an echo of the engine's own recorded component
// bits. It ANDs the LIVE-recomputed in_range and los_clear (from the decoded pose) with the DECODED in_fov
// claim, then checks that composite against the engine's eligible bit. The load-bearing distinction: an
// engine that lies about a geometry leg AND flips eligible to stay internally consistent is BLIND to a
// decoded-only echo (its own bits agree with themselves) but CAUGHT by the live legs.
describe('eligible is a LIVE conjunction (in_range + los_clear live, in_fov the decoded claim)', () => {
  // A fully-admitted, poseful verdict: all three legs true, eligible true, and the live legs agree.
  const admitted = stage.draws.find(
    (x): x is SensingDraw => x !== null && x.g !== null && x.inRange && x.inFov && x.losClear && x.eligible,
  )!
  const eligibleGate = (draw: SensingDraw) => new Map(sensingGates(draw).map(g => [g.id, g])).get('eligible')!

  test('the untampered admitted verdict agrees — the live conjunction is not vacuously ✗', () => {
    expect(eligibleGate(admitted).agree).toBe(true)
  })

  test('an engine that lies about in_range AND flips eligible to stay self-consistent is CAUGHT (an echo would have missed it)', () => {
    // Flip BOTH decoded in_range and decoded eligible to false: the DECODED bits stay internally consistent
    // (false ∧ in_fov ∧ los_clear === false === eligible), so a decoded-only ECHO agrees with itself and
    // shows ✓. But the LIVE in_range recompute from the UNCHANGED pose still says true, so the live
    // conjunction (true ∧ in_fov ∧ los_clear) === true ≠ decoded eligible(false) → ✗.
    const tampered: SensingDraw = { ...admitted, inRange: false, eligible: false }
    // the echo is provably blind: the AND of the DECODED bits equals the (also-flipped) decoded eligible
    expect(recomputeEligible(tampered.inRange, tampered.inFov, tampered.losClear)).toBe(tampered.eligible)
    // the live check is load-bearing: it disagrees
    expect(eligibleGate(tampered).agree).toBe(false)
  })

  test('the classic self-inconsistency (eligible true but the decoded in_fov claim is false) is STILL caught', () => {
    // in_fov enters the conjunction as the DECODED claim, so an engine that records eligible=true while its own
    // in_fov bit is false is a self-inconsistency the live check still flags: (live in_range ∧ false ∧ live
    // los) === false ≠ eligible(true) → ✗.
    const tampered: SensingDraw = { ...admitted, inFov: false }
    expect(eligibleGate(tampered).agree).toBe(false)
  })

  test('recomputeAllSensing counts the conjunction LIVE: the same in_range/eligible co-flip drives a disagreement', () => {
    // The aggregate oracle uses the SAME live conjunction. Co-flipping in_range+eligible on one poseful seq
    // keeps the decoded bits self-consistent (an echo would count all 96) but the live legs catch it.
    const tampered = stage.draws.map(d => (d && d.seq === admitted.seq ? ({ ...d, inRange: false, eligible: false }) : d))
    const s = recomputeAllSensing(tampered)
    expect(s.disagreements).toContain(admitted.seq)
    expect(s.conjunctionAgreed).toBeLessThan(s.total) // the live conjunction flagged it (an echo would be === total)
  })
})

// ── CONSTITUTION GUARD: the sensing recompute closure recomputes NO transcendental ──────────────────────
// Mirrors showMath.test.ts. A bearing/FOV threshold is a pinned vendored-libm KAT bit; NOTHING in the
// recompute RUNTIME closure may reach for trig / atan2 — in_fov is the DECODED boolean, never recomputed.
test('the recompute closure (sensingMath.ts + sensingScenario.ts) recomputes NO transcendental', () => {
  // Comments are stripped first (these files NAME atan2 in prose — that stays allowed); code is not. The
  // pattern is the trig NAME as a whole word, so it defeats aliasing/bracket/destructure spellings. Word-
  // bounded and case-sensitive-lowercase so innocent tokens (FOV_HALF_TAN uppercase, "constant", "cos…")
  // never trip it — the same discipline the query surface's scan uses.
  const strip = (p: string): string =>
    readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const code = strip('src/ui/sensingMath.ts') + '\n' + strip('src/ui/sensingScenario.ts')
  expect(code).not.toMatch(/\b(?:atan2|atan|asin|acos|sin|cos|tan)\b/)
})

// ── Runtime-closure extraction via the TS AST (the backtick dynamic-import evasion, closed) ──────────
// Mirrors showMath.test.ts. The old regex extractor keyed dynamic-import specifiers on `import\(\s*['"]…['"]\)`
// and so MISSED a template/computed specifier (import(`./camera`)) — which typechecks and survives into emitted
// JS unseen. Parsing with the TS compiler (ts.createSourceFile — `typescript` is the tsc-gate devDependency)
// sees import(...) regardless of how the specifier is spelled. Hardened rule: a module in a PINNED runtime
// closure may carry NO dynamic import of ANY form, and its value imports must be exactly the allowlisted set.
interface ModuleEdges {
  valueImports: string[]
  typeOnlyImports: string[]
  valueReExports: string[]
  dynamicImports: number
  requires: number
}
function moduleEdges(name: string, src: string): ModuleEdges {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS)
  const e: ModuleEdges = { valueImports: [], typeOnlyImports: [], valueReExports: [], dynamicImports: 0, requires: 0 }
  const specOf = (n: ts.Expression | undefined): string | null => (n && ts.isStringLiteral(n) ? n.text : null)
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const s = specOf(n.moduleSpecifier)
      if (s !== null) {
        const clause = n.importClause
        if (!clause) e.valueImports.push(s)                     // side-effect import '…' (runtime)
        else if (clause.isTypeOnly) e.typeOnlyImports.push(s)   // import type … from — declaration-level, FULLY erased
        // Otherwise a RUNTIME edge. verbatimModuleSyntax erases ONLY the declaration-level `import type`
        // above. An import clause with INLINE type-only specifiers but no value binding (`import { type A } from
        // './x'`) still EMITS the bare side-effect `import {} from './x'` — the module is evaluated — so it is a
        // value edge here, NOT erased. (Classifying it type-only would let a declaration-level `import type …
        // from './sensingStage'` be rewritten to the inline form to keep the closure scan green while widening
        // the runtime closure through the model layer.) A value binding is plainly a value edge.
        else e.valueImports.push(s)
      }
    } else if (ts.isExportDeclaration(n)) {
      const s = specOf(n.moduleSpecifier)
      if (s !== null && !n.isTypeOnly) e.valueReExports.push(s)
    } else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) e.dynamicImports++ // import(...) — ANY specifier form
      else if (ts.isIdentifier(n.expression) && n.expression.text === 'require') e.requires++
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return e
}
const readEdges = (path: string): ModuleEdges => moduleEdges(path, readFileSync(path, 'utf8'))

test('SCAN-COVERAGE PIN: sensingMath VALUE-imports exactly ./sensingScenario; NO dynamic import survives', () => {
  const e = readEdges('src/ui/sensingMath.ts')
  // (1) The only RUNTIME value edge is the zero-import scenario module — the trig scan's closure claim, checked.
  expect([...new Set(e.valueImports)].sort()).toEqual(['./sensingScenario'])
  // (2) Type-only edges are erased (verbatimModuleSyntax); ./agreeSource rides here (AgreementResult /
  //     AgreeCapability / InputToken are types), as do the sensingStage types. A NEW type-only source re-adjudicates.
  for (const s of e.typeOnlyImports) expect(['./sensingScenario', './sensingStage', './agreeSource']).toContain(s)
  // (3) No value re-export widens the closure like an import would (`export type … from` is erased, allowed).
  expect(e.valueReExports).toEqual([])
  // (4) THE HARDENING — NO dynamic import of ANY specifier form (quoted, templated, computed) and no require().
  expect(e.dynamicImports).toBe(0)
  expect(e.requires).toBe(0)
  // The one value dependency stays dependency-FREE — the property that makes the closure claim true.
  const sc = readEdges('src/ui/sensingScenario.ts')
  expect(sc.valueImports).toEqual([])
  expect(sc.typeOnlyImports).toEqual([])
  expect(sc.valueReExports).toEqual([])
  expect(sc.dynamicImports).toBe(0)
  expect(sc.requires).toBe(0)

  // PREMISE-DEFEAT — the exact evasion the old regex missed is now caught. The AST sees import() regardless of
  // how the specifier is spelled; the old extractor was blind to the template form.
  expect(/import\s*\(\s*['"][^'"]+['"]\s*\)/.test('import(`./camera`)')).toBe(false)          // old scan: blind
  expect(moduleEdges('probe.ts', 'const c = import(`./camera`)').dynamicImports).toBe(1)       // new scan: sees it
  expect(moduleEdges('probe.ts', 'const c = import("./" + x)').dynamicImports).toBe(1)         // computed too
  expect(moduleEdges('probe.ts', "const c = import('./camera')").dynamicImports).toBe(1)       // and quoted
  const probe = moduleEdges('probe.ts', "import { a } from './x'\nimport type { T } from './y'\nexport { z } from './w'\nexport type { U } from './v'")
  expect(probe.valueImports).toEqual(['./x'])
  expect(probe.typeOnlyImports).toEqual(['./y'])
  expect(probe.valueReExports).toEqual(['./w'])

  // PREMISE-DEFEAT — the INLINE type-only edge. Under verbatimModuleSyntax `import { type A } from './x'`
  // (inline `type` specifier, NO value binding) emits the bare side-effect `import {} from './x'` — a RUNTIME
  // edge. The new walk classifies it a value import; the OLD all-inline-type branch wrongly erased it (which
  // would let `import type … from './sensingStage'` be rewritten to this form to keep this pin green while
  // dragging the model layer into the runtime closure).
  const inlineTypeOnly = moduleEdges('probe.ts', "import { type A } from './x'")
  expect(inlineTypeOnly.valueImports).toEqual(['./x'])   // new walk: RUNTIME (was erased by the old logic)
  expect(inlineTypeOnly.typeOnlyImports).toEqual([])     // NOT erased — only a declaration-level `import type` is
  // a mixed value + inline-type import is (and stays) a value edge; only declaration-level `import type` erases.
  const mixed = moduleEdges('probe.ts', "import { v, type A } from './x'")
  expect(mixed.valueImports).toEqual(['./x'])
  expect(mixed.typeOnlyImports).toEqual([])
})
