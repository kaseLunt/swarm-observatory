import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import {
  makeWitnessInputs,
  type AgreeSource, type AgreementResult, type InputToken, type ComparandToken,
} from './agreeSource'
import { agreeBasisNote } from './lensContract'
import { basisNote, BASIS_NOTE } from './voices'
import { F2A_REGISTRATION } from './sensingStage'

// The AgreeSource witness union (v0.8) makes the echo class UNREPRESENTABLE. These pin the
// compile-level guarantees (the comparand cannot be named as an input; the AgreementResult brand cannot be
// fabricated), the RUNTIME closure of the covariance hole (a comparand smuggled past the compiler is
// refused at construction), the mint LOCK (only the two executors may stamp agreement), and the one-truth
// wiring (the basis note a surface renders comes from the arm's TAG, never a second author).

// A never-CALLED function isolates a pure COMPILE pin from runtime (the call inside would throw; we only assert
// it cannot type-check). Referenced with `void` so it is neither unused nor executed.
function _echoCompilePin(): void {
  // THE ECHO COUNTEREXAMPLE — naming `engine:eligible` (the comparand a recompute checks AGAINST) as an input
  // cannot compile: it is a ComparandToken, never a member of InputToken, so makeWitnessInputs' rest parameter
  // refuses it. If this line ever STOPPED erroring, the echo would be representable again.
  // @ts-expect-error — engine:eligible is a ComparandToken, not an InputToken: makeWitnessInputs refuses it
  makeWitnessInputs('engine:eligible')
}
void _echoCompilePin

describe('the echo exclusion — the comparand cannot be named as an input (compile AND runtime)', () => {
  test('a well-formed live-inputs arm type-checks; its inputs ride a minted WitnessInputs', () => {
    // Legitimate: two LIVE legs + the DECODED in_fov claim — the comparand (engine eligible bit) is absent.
    const genuine: AgreeSource = {
      basis: 'live-inputs',
      inputs: makeWitnessInputs('sensing:in-range-live', 'sensing:los-clear-live', 'sensing:in-fov-claim'),
      form: 'form:eligible-conjunction',
    }
    expect(genuine.basis).toBe('live-inputs')
    if (genuine.basis === 'live-inputs')
      expect([...genuine.inputs]).toEqual(['sensing:in-range-live', 'sensing:los-clear-live', 'sensing:in-fov-claim'])
  })

  test('the decoded-consistency downgrade arm type-checks (the honest, non-manifest-grade witness)', () => {
    const downgrade: AgreeSource = { basis: 'decoded-consistency', decoded: 'sensing:eligibility-vs-decoded-legs' }
    expect(downgrade.basis).toBe('decoded-consistency')
  })

  test('the mutable-alias contamination cannot COMPILE into a witness, and is REJECTED at runtime', () => {
    // THE EXACT EXPLOIT closes. TypeScript arrays are covariant (the unsound corner of the language), so an
    // InputToken[] aliases to a wider (InputToken|ComparandToken)[]; the comparand is pushed through the alias,
    // contaminating the underlying array. Under the OLD `readonly InputToken[]` field this passed with ZERO
    // diagnostics — through BOTH validateRegistration and the boot guard. Now:
    const inputs: InputToken[] = ['sensing:pose']
    const wide: (InputToken | ComparandToken)[] = inputs   // legal — array covariance (the unsound part)
    wide.push('engine:eligible')                           // the comparand rides into `inputs` at runtime

    // (a) COMPILE + RUNTIME: the contaminated array cannot become a witness — spreading the widened array into
    //     the constructor is refused (its rest param is InputToken, not InputToken|ComparandToken), and even if
    //     the type refusal is suppressed the constructor throws on the smuggled comparand.
    // @ts-expect-error — the widened element type is not assignable to the InputToken rest parameter
    expect(() => makeWitnessInputs(...wide)).toThrow(/not a legal witness InputToken/)

    // (b) COMPILE: a direct field assignment of the plain array is refused too — a plain InputToken[] is not the
    //     branded WitnessInputs (structural substitution is blocked). The arm still builds at RUNTIME (a raw
    //     object literal), proving the exclusion is a TYPE refusal, not a runtime coincidence.
    // @ts-expect-error — a plain InputToken[] is not the branded WitnessInputs
    const arm: AgreeSource = { basis: 'live-inputs', inputs, form: 'form:in-range' }
    expect(arm.basis).toBe('live-inputs')

    // (c) RUNTIME regardless: a hostile cast that erases the compile refusal is still caught — the constructor
    //     validates VALUES against the closed vocabulary, so the smuggled comparand throws.
    expect(() => makeWitnessInputs(...(wide as InputToken[]))).toThrow(/not a legal witness InputToken/)
  })

  test('makeWitnessInputs COPIES and FREEZES — a later mutation of the source cannot reach the witness', () => {
    const src: InputToken[] = ['sensing:pose']
    const w = makeWitnessInputs(...src)
    src.push('sensing:in-fov-claim')           // mutate the source AFTER minting
    expect([...w]).toEqual(['sensing:pose'])    // the witness is unchanged (it copied its arguments)
    expect(Object.isFrozen(w)).toBe(true)       // and frozen (no post-construction push can reach it)
  })
})

describe('the AgreementResult brand is minted ONLY by the executor — fabrication is a COMPILE pin', () => {
  test('a summary cannot be fabricated as static data (missing the un-nameable executor brand)', () => {
    // A lens cannot file "agreement" it never computed: an AgreementResult carries lib/brand's private
    // `unique symbol`, so an object literal is missing a property it cannot even name — a type error. Only
    // showMath.recomputeAll / sensingMath.recomputeAllSensing (which actually RAN the comparison) mint it.
    // @ts-expect-error — an AgreementResult cannot be fabricated as static data (missing the executor's brand)
    const forged: AgreementResult<{ total: number }> = { total: 1 }
    expect(forged.total).toBe(1) // the value is a plain object at runtime; the brand is phantom
  })
})

// ── THE MINT LOCK: `as AgreementResult` may appear ONLY in the sanctioned executors ───────────────────────────
describe('the AgreementResult mint is LOCKED to the sanctioned executors (sweep)', () => {
  // SCOPE, honestly stated: this sweep targets DRIFT — a future edit reaching for `as AgreementResult` at a new
  // site to file agreement it never computed. It is NOT a defense against a hostile author (a split-string
  // cast, eval, or the Function constructor defeats ANY lexical scan); runtime-opaque values are out of scope.
  // The mint's LOAD-BEARING half — the brand rides MathCard.agree / GateLine.agree to the mark resolvers, which
  // DEMAND it (recomputedVerdict) — is what makes deleting a mint a COMPILE error (proven by tsc, not here);
  // this pins WHERE mints may live so a third one cannot appear unnoticed.
  const SANCTIONED = ['ui/showMath.ts', 'ui/sensingMath.ts', 'ui/commsMath.ts']
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
  const relOf = (abs: string): string => abs.replaceAll('\\', '/').replace(/^.*?\/src\//, '').replace(/^src\//, '')
  const MINT = /\bas\s+AgreementResult\b/

  test('every `as AgreementResult` assertion in src/ sits in the sanctioned executor allowlist', () => {
    const mints: string[] = []
    for (const abs of walk('src')) {
      const rel = relOf(abs)
      const stripped = stripComments(readFileSync(abs, 'utf8'))
      stripped.split('\n').forEach((line, i) => {
        if (MINT.test(line)) mints.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    const unsanctioned = mints.filter(m => !SANCTIONED.some(s => m.startsWith(s + ':')))
    expect(unsanctioned, `AgreementResult mint outside the sanctioned executors:\n${unsanctioned.join('\n')}`).toEqual([])
    // LOAD-BEARING: the sweep actually reached EVERY executor's mints (guards against a walk that matched nothing).
    expect(mints.some(m => m.startsWith('ui/showMath.ts:'))).toBe(true)
    expect(mints.some(m => m.startsWith('ui/sensingMath.ts:'))).toBe(true)
    expect(mints.some(m => m.startsWith('ui/commsMath.ts:'))).toBe(true)
  })

  test('the detector matches the mint form it hunts, and NOT a bare type annotation (a third mint WOULD be caught)', () => {
    expect(MINT.test('const x = foo as AgreementResult<Bar>')).toBe(true)
    expect(MINT.test('  return summary as AgreementResult<RecomputeSummary>')).toBe(true)
    // a TYPE ANNOTATION is not a mint — the brand flows from a real executor call, not a bare declaration.
    expect(MINT.test('const x: AgreementResult<Bar> = mint(v)')).toBe(false)
  })
})

// ── THE MINT SITES: AST-pin every `as AgreementResult` to its EXACT sanctioned enclosing function ──────
describe('the AgreementResult mint SITES are pinned by enclosing function, not just by file', () => {
  // The mint-lock sweep above allowlists FILES: a SECOND `as AgreementResult` added INSIDE an executor — including a
  // direct cast of an UNCOMPUTED boolean — would pass it (it is "in showMath.ts"). This pins the SITES. Parse each
  // executor with the TS compiler (ts.createSourceFile — the scan-test idiom), collect every `as AgreementResult`
  // ASSERTION (an AsExpression, so a return-TYPE annotation `: AgreementResult<…>` is NOT counted — precisely what
  // the regex could not tell apart) tagged with its ENCLOSING FUNCTION, and require the EXACT sanctioned set. An
  // extra cast anywhere — even in the same file, even in a new helper — changes the set and fails.
  // The right-most identifier of a (possibly qualified) type name: both `AgreementResult` and `ns.AgreementResult`
  // resolve to 'AgreementResult'.
  const typeNameText = (n: ts.EntityName): string => (ts.isIdentifier(n) ? n.text : n.right.text)
  // Does an asserted TYPE reach an `AgreementResult` reference through the equivalence-preserving wrappers a cast
  // can hide behind? Unwrap parentheses; descend into intersection (and union) members; then match the reference
  // by name. This is what closes the syntactic-equivalent evasions that a bare `n.type.typeName === 'AgreementResult'`
  // check waves through: `x as (AgreementResult<b>)` (parenthesized) and `x as AgreementResult<b> & {}` (intersection).
  const typeRefersToAgreementResult = (t: ts.TypeNode | undefined): boolean => {
    if (!t) return false
    if (ts.isParenthesizedTypeNode(t)) return typeRefersToAgreementResult(t.type)
    if (ts.isIntersectionTypeNode(t) || ts.isUnionTypeNode(t)) return t.types.some(typeRefersToAgreementResult)
    if (ts.isTypeReferenceNode(t)) return typeNameText(t.typeName) === 'AgreementResult'
    return false
  }
  // A mint assertion is EITHER form of type assertion — `expr as T` (AsExpression) OR the angle-bracket `<T>expr`
  // (TypeAssertion, legal in these non-TSX .ts files) — whose asserted type reaches AgreementResult. Treating BOTH
  // node forms, and normalizing the asserted type above, is what makes the site pin robust to syntactic equivalents.
  // THE HONEST RESIDUAL: what a checker-free scan CANNOT see is an ALIAS — `x as SomeAlias` where
  // `type SomeAlias = AgreementResult<…>` — because it matches NAMES, and the alias' name is not 'AgreementResult'.
  // The companion alias-ban sweep below forbids minting such an alias anywhere in src/; that ban is precisely what
  // makes this name-matching detector SOUND (no dodging name it cannot enumerate).
  const isAgreementResultAssertion = (n: ts.Node): n is ts.AsExpression | ts.TypeAssertion =>
    (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && typeRefersToAgreementResult(n.type)
  // the INNERMOST named function enclosing a node: a function/method declaration by its own name; an
  // arrow/function-expression by the const it is assigned to (the `agrees` per-row helper).
  const enclosingFn = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
        if (ts.isFunctionExpression(n) && n.name) return n.name.text
        if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text
        return '<anonymous>'
      }
    }
    return '<module>'
  }
  const mintSitesIn = (fileName: string, src: string): string[] => {
    const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS)
    const sites: string[] = []
    const visit = (n: ts.Node): void => {
      if (isAgreementResultAssertion(n)) sites.push(enclosingFn(n))
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return sites.sort()
  }
  const read = (rel: string): string => readFileSync(`src/${rel}`, 'utf8')

  test('showMath.ts mints ONLY in agrees + recomputeAll (the per-row helper + the aggregate return)', () => {
    expect(mintSitesIn('showMath.ts', read('ui/showMath.ts'))).toEqual(['agrees', 'recomputeAll'])
  })
  test('sensingMath.ts mints ONLY in agrees + recomputeAllSensing', () => {
    expect(mintSitesIn('sensingMath.ts', read('ui/sensingMath.ts'))).toEqual(['agrees', 'recomputeAllSensing'])
  })
  test('commsMath.ts mints ONLY in checkPairing (the pairing self-consistency executor)', () => {
    expect(mintSitesIn('commsMath.ts', read('ui/commsMath.ts'))).toEqual(['checkPairing'])
  })
  test('across ALL executors there are EXACTLY five sanctioned mint sites', () => {
    const all = [
      ...mintSitesIn('showMath.ts', read('ui/showMath.ts')),
      ...mintSitesIn('sensingMath.ts', read('ui/sensingMath.ts')),
      ...mintSitesIn('commsMath.ts', read('ui/commsMath.ts')),
    ]
    expect(all).toHaveLength(5)
  })
  test('PREMISE-DEFEAT — an EXTRA cast (a direct mint of an uncomputed boolean) in a new function is CAUGHT', () => {
    // the file-level mint-lock sweep waves this through (it is "inside showMath.ts"); the site pin does not.
    const hostile = [
      'const agrees = (m: boolean): AgreementResult<boolean> => m as AgreementResult<boolean>',
      'export function recomputeAll() { const summary = {}; return summary as AgreementResult<Summary> }',
      'function fabricate(uncomputed: boolean) { return uncomputed as AgreementResult<boolean> }', // the drift
    ].join('\n')
    const sites = mintSitesIn('showMath.ts', hostile)
    expect(sites).toContain('fabricate')                     // the extra site is SEEN (a return-type annotation would not be)
    expect(sites).not.toEqual(['agrees', 'recomputeAll'])    // so the exact-set pin fails
  })

  test('PREMISE-DEFEAT — the SYNTACTIC EQUIVALENTS of `as AgreementResult` do not evade the detector', () => {
    // A bare-identifier match (`n.type.typeName.text === 'AgreementResult'` on an AsExpression only) is dodged by
    // four equivalent spellings of the SAME mint. Each is proven SEEN — the enclosing fn is collected — so the
    // exact-set pin fails on it exactly as on a plain `as`. The genuine `agrees` mint anchors each case (so we
    // are asserting the EXTRA site is added, not merely that something matched).
    const parenthesized = 'function fabricate(u: boolean) { return u as (AgreementResult<boolean>) }'
    const intersection  = 'function fabricate(u: boolean) { return u as AgreementResult<boolean> & {} }'
    const angleBracket   = 'function fabricate(u: boolean) { return <AgreementResult<boolean>>u }' // legal in .ts
    const qualified      = 'function fabricate(u: boolean) { return u as ns.AgreementResult<boolean> }'
    for (const form of [parenthesized, intersection, angleBracket, qualified]) {
      const src = `const agrees = (m: boolean): AgreementResult<boolean> => m as AgreementResult<boolean>\n${form}`
      expect(mintSitesIn('showMath.ts', src)).toEqual(['agrees', 'fabricate'].sort())
    }
    // CONTROL — the alias spelling is NOT caught here (a name-match cannot see through a rename). That residual is
    // closed structurally by the alias-ban sweep below, not by this detector.
    const aliased = 'function fabricate(u: boolean) { return u as AR }' // `type AR = AgreementResult<boolean>` elsewhere
    expect(mintSitesIn('showMath.ts', aliased)).toEqual([])
  })

  test('the FIVE legitimate mint sites still pass unchanged under the hardened detector', () => {
    // Regression guard for part (a): normalizing the asserted type and admitting the angle-bracket form must not
    // add or drop any real site. (The per-file exact-set tests above already assert this against the live source;
    // this states the invariant explicitly next to the premise-defeat cases.)
    const show = mintSitesIn('showMath.ts', read('ui/showMath.ts'))
    const sensing = mintSitesIn('sensingMath.ts', read('ui/sensingMath.ts'))
    const comms = mintSitesIn('commsMath.ts', read('ui/commsMath.ts'))
    expect(show).toEqual(['agrees', 'recomputeAll'])
    expect(sensing).toEqual(['agrees', 'recomputeAllSensing'])
    expect(comms).toEqual(['checkPairing'])
  })
})

// ── F2b — THE ALIAS BAN: no new nameable alias for AgreementResult may exist in src/ (makes name-matching SOUND) ─
describe('no src/ site mints a new NAME for AgreementResult that a cast could hide behind (alias ban)', () => {
  // WHY this sweep exists — the honest residual of every checker-free mint scan (the mint-lock regex AND the mint-site AST pin):
  // both match the NAME 'AgreementResult'. `value as AgreementResult<b>` in any spelling is caught (part a); but
  // `type AR = AgreementResult<b>; value as AR` casts to a name the scans cannot enumerate, minting the brand while
  // evading BOTH layers. Closing that WITHOUT a full type-checker means forbidding the alias itself: if no src/ file
  // (outside agreeSource.ts, where the type is DEFINED) creates a new nameable alias for AgreementResult, then the
  // only names a mint cast can spell are 'AgreementResult' (caught) — the name-matching detector becomes SOUND.
  //
  // Two ways to mint a new name, both banned: a TYPE-ALIAS declaration (`type X = AgreementResult<…>`, including
  // through an intersection/union) and a RENAMING import (`import { AgreementResult as X }`). What is NOT an alias
  // and stays legal: USING the type in a POSITION. The complete enumeration of legitimate references (all POSITIONS,
  // no wrapping alias) is: the plain (un-renamed) `import type { AgreementResult }` in the three consumers; the
  // MathCard.agree / GateLine.agree FIELD types; recomputedVerdict's PARAMETER type; and the executors' RETURN
  // types (recomputeAll / recomputeAllSensing, and the per-row `agrees` annotations). Positions are fine; a new
  // ALIAS wrapping the type is the only thing this sweep forbids.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
  const relOf = (abs: string): string => abs.replaceAll('\\', '/').replace(/^.*?\/src\//, '').replace(/^src\//, '')
  const typeNameText = (n: ts.EntityName): string => (ts.isIdentifier(n) ? n.text : n.right.text)
  const typeRefersToAgreementResult = (t: ts.TypeNode | undefined): boolean => {
    if (!t) return false
    if (ts.isParenthesizedTypeNode(t)) return typeRefersToAgreementResult(t.type)
    if (ts.isIntersectionTypeNode(t) || ts.isUnionTypeNode(t)) return t.types.some(typeRefersToAgreementResult)
    if (ts.isTypeReferenceNode(t)) return typeNameText(t.typeName) === 'AgreementResult'
    return false
  }
  // Scan one file for the two alias-minting forms. Returns forbidden findings; also reports whether the file made a
  // PLAIN (allowed) reference to AgreementResult, so the sweep can prove it actually reached the type (not vacuous).
  const scanFile = (rel: string, src: string): { forbidden: string[]; sawPlainRef: boolean } => {
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const forbidden: string[] = []
    let sawPlainRef = false
    const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const visit = (n: ts.Node): void => {
      // (1) a type-alias declaration whose definition reaches AgreementResult — a new nameable alias.
      if (ts.isTypeAliasDeclaration(n) && typeRefersToAgreementResult(n.type))
        forbidden.push(`${rel}:${lineOf(n)}: type ${n.name.text} = … AgreementResult …`)
      // (2) a RENAMING import specifier for AgreementResult (`AgreementResult as X`) — also a new nameable alias.
      //     A plain `{ AgreementResult }` (propertyName undefined, or local === original) is the sanctioned position.
      if (ts.isImportSpecifier(n)) {
        const original = (n.propertyName ?? n.name).text
        if (original === 'AgreementResult') {
          if (n.name.text === 'AgreementResult') sawPlainRef = true
          else forbidden.push(`${rel}:${lineOf(n)}: import { AgreementResult as ${n.name.text} }`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return { forbidden, sawPlainRef }
  }

  test('src/ contains no type-alias or renaming import that creates a second name for AgreementResult', () => {
    const forbidden: string[] = []
    let sawAnyPlainRef = false
    for (const abs of walk('src')) {
      const rel = relOf(abs)
      if (rel === 'ui/agreeSource.ts') continue // the DEFINITION home — exempt (it authors the name, not an alias of it)
      const r = scanFile(rel, readFileSync(abs, 'utf8'))
      forbidden.push(...r.forbidden)
      sawAnyPlainRef ||= r.sawPlainRef
    }
    expect(
      forbidden,
      `A new name for AgreementResult would let a cast dodge the mint scans (mint ONLY via the sanctioned sites; an ` +
      `alias makes name-matching unsound). Remove:\n${forbidden.join('\n')}`,
    ).toEqual([])
    // LOAD-BEARING: the walk actually reached a plain AgreementResult import (guards against a walk that matched
    // nothing making the empty `forbidden` list vacuously true).
    expect(sawAnyPlainRef, 'the alias-ban walk never saw an AgreementResult reference — the scan is not reaching src/').toBe(true)
  })

  test('PREMISE-DEFEAT — a type-alias (bare or via intersection) and a renaming import are all FLAGGED', () => {
    const hostile = [
      'import { AgreementResult as AR } from "./agreeSource"',      // renaming import — a new name
      'type Laundered = AgreementResult<boolean>',                  // bare alias
      'type Sneaky = { note: string } & AgreementResult<boolean>',  // alias via intersection
      'const x = v as AR',                                          // the cast the alias enables — name-match blind
    ].join('\n')
    const { forbidden } = scanFile('ui/hostile.ts', hostile)
    expect(forbidden).toHaveLength(3)
    expect(forbidden.some(f => f.includes('type Laundered'))).toBe(true)
    expect(forbidden.some(f => f.includes('type Sneaky'))).toBe(true)
    expect(forbidden.some(f => f.includes('AgreementResult as AR'))).toBe(true)
  })

  test('a plain (un-renamed) import and a mere USE-position of AgreementResult are NOT flagged', () => {
    const benign = [
      'import type { AgreementResult } from "./agreeSource"',       // plain import — the sanctioned position
      'interface Card { agree: AgreementResult<boolean> | null }',  // a FIELD position (MathCard/GateLine shape)
      'function verdict(a: AgreementResult<boolean>): void {}',     // a PARAMETER position (recomputedVerdict shape)
      'function mint(): AgreementResult<Summary> { return 0 as never }', // a RETURN position (executor shape)
    ].join('\n')
    const { forbidden, sawPlainRef } = scanFile('ui/benign.ts', benign)
    expect(forbidden).toEqual([])
    expect(sawPlainRef).toBe(true)
  })
})

describe('the basis NOTE is sourced from the arm TAG (ev99 closed — one truth with voices.BASIS_NOTE)', () => {
  test('agreeBasisNote renders each arm\'s note from its own basis discriminant', () => {
    const live: AgreeSource = { basis: 'live-inputs', inputs: makeWitnessInputs('sensing:pose'), form: 'form:in-range' }
    const downgrade: AgreeSource = { basis: 'decoded-consistency', decoded: 'query:los-vs-decoded-components' }
    expect(agreeBasisNote(live)).toBe(basisNote('live-inputs'))
    expect(agreeBasisNote(live)).toBe(BASIS_NOTE['live-inputs'])
    expect(agreeBasisNote(downgrade)).toBe(BASIS_NOTE['decoded-consistency'])
  })

  test('a REAL migrated class renders its note from its declared tag (the flagship)', () => {
    const flag = F2A_REGISTRATION.provenance.find(p => p.id === 'eligible-conjunction')!
    expect(flag.agree).toBeDefined()
    expect(agreeBasisNote(flag.agree!)).toBe(BASIS_NOTE['live-inputs'])
  })
})
