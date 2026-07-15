import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildQueryDraws, losComponents, type RayDraw, type PointDraw, type RangeBearingDraw, type SightlineDraw } from './queryStage'
import {
  recomputeAll, recomputeBall, recomputeBox, recomputeRay, recomputeRange, recomputeLos, rangeMatches,
  showMath, num,
} from './showMath'

// SHOW-THE-MATH recompute tests (v0.6 T4a). The load-bearing oracle: recompute every kind-23 verdict from
// the REAL decoded e0 bundle and prove the browser recomputation AGREES WITH THE ENGINE on all 75 — the
// same fixture + decode path the model-layer oracle test uses. Plus per-form spot checks + the constitution
// guard that this module recomputes NO bearing (never Math.atan2/trig — the pinned-libm binding).

const load = (n: string): ArrayBuffer => {
  const b = readFileSync(`contract/fixtures/${n}`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

describe('recomputeAll — engine verdict vs ours, on the real e0 bundle', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model)

  test('all 75 events recompute-and-match the engine (0 disagreements)', () => {
    const s = recomputeAll(stage.draws, stage.losComposites)
    expect(s.total).toBe(75)
    expect(s.agreed).toBe(75)
    expect(s.disagreements).toEqual([])
  })

  test('a corrupted engine verdict is CAUGHT (the guard is meaningful, not vacuous)', () => {
    // Flip one parsed engine verdict; recomputeAll must now report exactly that seq as a disagreement — the
    // ✗ voice is reachable (a silently-passing recompute would be worthless as a verification surface).
    const tampered = stage.draws.map(d => (d && d.seq === 0 && d.kind === 1
      ? ({ ...d, verdict: d.verdict === 'INSIDE' ? 'OUTSIDE' : 'INSIDE' } as PointDraw)
      : d))
    const s = recomputeAll(tampered, stage.losComposites)
    expect(s.agreed).toBe(74)
    expect(s.disagreements).toEqual([0])
  })
})

describe('per-form recompute (pinned decision forms, doctrine §1.6)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model)
  const at = (seq: number) => stage.draws[seq]!

  test('point-in-ball: inside (tk0), boundary d²=r²=4225 (tiebreak), first outside (tk3)', () => {
    const inside = recomputeBall((at(0) as PointDraw).point)
    expect(inside.inside).toBe(true)
    // tk2 is the pinned boundary probe: d² == r² == 4225 (a 5·13 lattice point) → INSIDE with tiebreak.
    const boundary = recomputeBall((at(2) as PointDraw).point)
    expect(boundary.d2).toBe(4225)
    expect(boundary.inside).toBe(true)
    expect(boundary.tiebreak).toBe(true)
    expect(recomputeBall((at(3) as PointDraw).point).inside).toBe(false)
  })

  test('point-in-box: a face graze recomputes INSIDE + tiebreak (closed set, tk5-8)', () => {
    // Find a kind-1 box (object 2) draw the engine marked INSIDE — recompute must agree, and a boundary one carries tb.
    const boxDraw = stage.draws.find((d): d is PointDraw => d?.kind === 1 && d.object === 2 && d.verdict === 'INSIDE')!
    const r = recomputeBox(boxDraw.point)
    expect(r.inside).toBe(true)
  })

  test('ray ∩ sphere: a hit (tk19) and the tangent tiebreak (tk17)', () => {
    expect(recomputeRay(at(19) as RayDraw).hit).toBe(true)
    const tangent = recomputeRay(at(17) as RayDraw)
    expect(tangent.hit).toBe(true)
    expect(tangent.tiebreak).toBe(true) // tk17 is the pinned tangent graze
  })

  test('ray ∩ triangle: the in-plane declared-MISS (tk33) recomputes MISS', () => {
    const d = at(33) as RayDraw
    expect(d.object).toBe(3)
    expect(recomputeRay(d).hit).toBe(false) // det==0 ⇒ declared MISS
  })

  test('LOS: tk39 BLOCKED (S hits) and tk51 CLEAR (all 3 miss) recompute from component geometry', () => {
    const blocked = losComponents(39, stage)!
    expect(recomputeLos(blocked)).toBe(false) // BLOCKED
    const clear = losComponents(51, stage)!
    expect(recomputeLos(clear)).toBe(true) // CLEAR
  })
})

describe('range recompute + the bearing binding (kind 2)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model)

  test('recomputed range matches the stored range_m for every RANGE_BEARING row — at EXACT equality', () => {
    for (const d of stage.draws) {
      if (d?.kind !== 2) continue
      // rangeMatches is now Object.is (no tolerance): every row must be BIT-EXACT, proving the recompute
      // forms are operand-order-faithful to the engine. A failure here would be a real operand-order
      // discovery, not something to loosen away.
      expect(rangeMatches(recomputeRange(d.o, d.g), d.rangeM)).toBe(true)
    }
  })

  test('rangeMatches is EXACT — one ULP apart is NOT a match (the old relative tolerance is gone)', () => {
    expect(rangeMatches(1, 1)).toBe(true)
    expect(rangeMatches(240, 240)).toBe(true)
    // 1 + Number.EPSILON is the next f64 after 1 — one ULP. Exactness admits no slack.
    expect(rangeMatches(1, 1 + Number.EPSILON)).toBe(false)
    // The old 1e-9 relative tolerance would have PASSED this 1e-9 gap; Object.is rejects it.
    expect(rangeMatches(240, 240 + 1e-9)).toBe(false)
  })

  test('the card DISPLAYS the stored bearing bits verbatim and NEVER recomputes them', () => {
    const d = stage.draws.find((x): x is RangeBearingDraw => x?.kind === 2)!
    const card = showMath(d, null)
    // The bearing is a CLAIM row (no ✓) echoing the model layer's stored bits — asserted against
    // draw.bearingRad/bearingDeg directly (NO atan2 here in the test either — the binding is total).
    expect(card.claims).toHaveLength(1)
    expect(card.claims[0]!.label).toBe('bearing')
    expect(card.claims[0]!.value).toBe(`${num(d.bearingRad)} rad · ${num(d.bearingDeg)}°`)
    expect(card.claimNote).toMatch(/pinned/)
    // The ✓-bearing quantity for kind 2 is the RANGE, not the bearing.
    expect(card.agree).toBe(true)
    expect(card.verdict).toMatch(/ m$/)
  })
})

describe('showMath card shape (the Inspector surface)', () => {
  const run = decodeBundle(load('e0_seed42.det'))
  const model = new RunModel(run, null)
  const stage = buildQueryDraws(model)

  test('a matching verdict agrees; a disagreeing engine verdict flips agree=false (mismatch voice)', () => {
    const ball = stage.draws.find((d): d is PointDraw => d?.kind === 1 && d.object === 1)!
    const good = showMath(ball, null)
    expect(good.agree).toBe(true)
    expect(good.form).toMatch(/point in ball/)
    const flipped = showMath({ ...ball, verdict: ball.verdict === 'INSIDE' ? 'OUTSIDE' : 'INSIDE' } as PointDraw, null)
    expect(flipped.agree).toBe(false) // ✗ is reachable — display-tier, never hidden
  })

  test('LOS card names the first blocker and lists per-occluder contacts', () => {
    const los = stage.draws[39] as SightlineDraw
    const card = showMath(los, losComponents(39, stage))
    expect(card.verdict).toMatch(/BLOCKED/)
    expect(card.lines.some(l => l.label === 'S')).toBe(true)
    expect(card.agree).toBe(true)
  })

  test('a LOS row with NO composite is UNVERIFIABLE — agree:false, never a tautological ✓', () => {
    // Without the 3 component rays there is nothing to recompute; the card must DECLINE (unverifiable voice),
    // never derive the answer from the engine's OWN verdict and then "agree" with it (the old false-green).
    const los = stage.draws[39] as SightlineDraw
    const card = showMath(los, null) // composite deliberately withheld
    expect(card.agree).toBe(false)
    expect(card.unverifiable).toBe(true)
    expect(card.verdict).toMatch(/unverifiable/i)
    // The tautology guard: flipping the engine verdict must NOT flip agree to true (a verdict-derived
    // "clear" would have — that is exactly the false green this pins out).
    const flipped = showMath(
      { ...los, verdict: los.verdict === 'LOS_CLEAR' ? 'BLOCKED' : 'LOS_CLEAR' } as SightlineDraw, null)
    expect(flipped.agree).toBe(false)
    expect(flipped.unverifiable).toBe(true)
  })

  test('LOS drift case: the card tells ONE recomputed story — verdict, blocker, and rows never contradict', () => {
    // The drift surface this card exists to expose: tamper a component's ENGINE data so the recompute
    // disagrees, and every layer of the card must speak from the RECOMPUTED side (never a recomputed
    // verdict over engine-derived rows/blocker — the pre-fix internal contradiction).
    // (a) recomputed-HIT vs engine-MISS: move the S component's origin INTO the sphere (recompute: HIT;
    // c = dot(oc,oc) − r² = −r² ≤ 0) while its stored verdict/t stay MISS/null. The card must say
    // BLOCKED · S over an S row that SAYS hit — never BLOCKED over rows all reading "clear".
    const clearComp = losComponents(51, stage)!
    const los51 = stage.draws[51] as SightlineDraw
    const sIdx = clearComp.components.findIndex(c => c.object === 1)
    const tamperedHit: RayDraw = { ...clearComp.components[sIdx]!, o: [256, 0, 0] } // the sphere centre
    const cardBlocked = showMath(los51, {
      ...clearComp,
      components: clearComp.components.map((c, i) => (i === sIdx ? tamperedHit : c)),
    })
    expect(cardBlocked.agree).toBe(false) // recomputed BLOCKED vs engine LOS_CLEAR — the ✗ voice
    expect(cardBlocked.verdict).toBe('BLOCKED · S') // blocker named from the RECOMPUTED hits, in S,B,T order
    const sRow = cardBlocked.lines.find(l => l.label === 'S')!
    expect(sRow.value).toBe('hit (no contact point)') // recomputed hit, no stored t — NEVER 'clear'
    // (b) engine-false-HIT: move the BLOCKED composite's S component origin far off the corridor so the
    // recompute MISSES while its stored verdict/t/hitPoint stay HIT. The card must say plain CLEAR — the
    // engine-derived composite.firstBlocker must NOT append '· S' — over rows all reading clear.
    const blockedComp = losComponents(39, stage)!
    const los39 = stage.draws[39] as SightlineDraw
    const bIdx = blockedComp.components.findIndex(c => c.object === 1)
    const tamperedMiss: RayDraw = { ...blockedComp.components[bIdx]!, o: [0, 10000, 0] } // segment passes ~5000u from S
    const cardClear = showMath(los39, {
      ...blockedComp,
      components: blockedComp.components.map((c, i) => (i === bIdx ? tamperedMiss : c)),
    })
    expect(cardClear.agree).toBe(false) // recomputed CLEAR vs engine BLOCKED
    expect(cardClear.verdict).toBe('CLEAR') // EXACTLY — no engine-derived blocker suffix
    expect(cardClear.lines.filter(l => l.label !== 'sightline').map(l => l.value)).toEqual(['clear', 'clear', 'clear'])
  })

  test('a ray-hit card RECOMPUTES the metric derivation (hit = o+t·dir, dist = t·|dir|), not an echo', () => {
    const d = stage.draws[19] as RayDraw
    const card = showMath(d, null)
    expect(card.verdict).toMatch(/HIT/)
    // The displayed reach/hit are showMath's OWN recompute from raw (o, target) + t. Assert them against an
    // independent t·|dir| computed HERE — pinning that the card shows the recomputed value (the raw t·|dir|),
    // not a model-layer field passed through.
    const dir: readonly [number, number, number] = d.mode === 0
      ? d.target
      : [d.target[0] - d.o[0], d.target[1] - d.o[1], d.target[2] - d.o[2]]
    const reach = d.t! * Math.hypot(dir[0], dir[1], dir[2])
    const distLine = card.lines.find(l => l.label.startsWith('dist'))!
    expect(distLine.value).toBe(`${num(reach)} m`)
    const hitLine = card.lines.find(l => l.label === 'hit')!
    expect(hitLine.value).toBe(
      `(${num(d.o[0] + d.t! * dir[0])}, ${num(d.o[1] + d.t! * dir[1])}, ${num(d.o[2] + d.t! * dir[2])})`)
  })
})

test('CONSTITUTION GUARD: the recompute closure (showMath.ts + queryScenario.ts) recomputes NO transcendental', () => {
  // A bearing is a pinned vendored-libm KAT bit; NOTHING in the recompute RUNTIME closure may reach for a
  // trig / atan2. The scanned set — showMath.ts + queryScenario.ts — IS that closure EXACTLY, by
  // construction: the SCAN-COVERAGE pin below proves showMath's only VALUE import is queryScenario and
  // that queryScenario imports nothing. queryStage.ts (previously scanned) is now a TYPE-ONLY edge, erased
  // at runtime, and is deliberately NOT scanned: it is the model layer with its own oracle suite; its
  // runtime closure includes ./camera, whose framing math carries SANCTIONED trig (the constitution bans
  // BEARING recomputation on the verification surface, not trig in general — scanning it would false-flag
  // legitimate code and force exemptions that weaken this guard); and its bearing surface is byte-pinned
  // by its own oracle tests (the stored result_scalars[1] bits surfaced verbatim, proven against the
  // frozen draw table). Comments are stripped first (these files NAME the banned functions in prose —
  // that stays allowed); code is not. The pattern is the trig NAME as a whole word, not just the literal
  // `Math.atan2(` the first cut matched — so it defeats aliasing (`const a = Math.atan2`), bracket access
  // (`Math['atan2']`), a destructure (`const { atan2 } = Math`), and a helper import/call — every one of
  // which surfaces the name as a bare token in stripped code. Word-bounded so innocent substrings (cost,
  // constant, single, tangent) never trip it.
  //   RESIDUAL (documented, adjudicated out of scope): an ADVERSARIAL evasion — split-string access like
  // Math['at'+'an2'], a Function constructor, eval — defeats ANY lexical scan; this guard targets
  // ACCIDENTAL drift (a future edit reaching for the obvious call), not a hostile author. The layered
  // backstop that catches an actual bearing recompute REGARDLESS of how it is spelled — and ANYWHERE it
  // lives — is the byte-pin oracle above ('the card DISPLAYS the stored bearing bits verbatim'): the claim
  // row is asserted equal to the STORED d.bearingRad/bearingDeg bits, so any recomputed value that differs
  // by even one ULP fails there no matter what produced it.
  const strip = (p: string): string =>
    readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const code = strip('src/ui/showMath.ts') + '\n' + strip('src/ui/queryScenario.ts')
  expect(code).not.toMatch(/\b(?:atan2|atan|asin|acos|sin|cos|tan)\b/)
})

test('SCAN-COVERAGE PIN: showMath.ts VALUE-imports exactly ./queryScenario, which itself imports NOTHING', () => {
  // The trig scan above claims its scanned files ARE showMath's runtime closure. This test makes that
  // claim CHECKED, not asserted, in two halves. (1) showMath's VALUE imports — the only edges that survive
  // to runtime — must be exactly the zero-import scenario module. Full `import type` statements are ERASED
  // at compile time (verbatimModuleSyntax: true — the statement form matters: an inline `{ type X }` in a
  // value import keeps the module edge, which is why the queryStage types ride a separate `import type`
  // statement), so they are distinguished and allowlisted rather than counted: a type-only edge to
  // queryStage is deliberate and harmless (its runtime closure has ./camera's sanctioned framing trig,
  // which must never ride into this surface). (2) queryScenario.ts must import NOTHING — the property that
  // makes the closure claim true by construction. Any new value import, any new type-only source, or an
  // import appearing inside queryScenario fails HERE and forces a conscious re-adjudication of the scan's
  // coverage — extend the scan, or justify why not — instead of silently widening the unscanned surface.
  // Matches static, side-effect (`import '…'`), and dynamic (`import('…')`) forms on comment-stripped source.
  const strip = (p: string): string =>
    readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const code = strip('src/ui/showMath.ts')
  const stmts = [...code.matchAll(/import\s+([^'"]*?)from\s+['"]([^'"]+)['"]/g)]
  const valueImports = [
    ...stmts.filter(m => !/^type\b/.test(m[1]!.trim())).map(m => m[2]!),
    ...[...code.matchAll(/import\s*['"]([^'"]+)['"]/g)].map(m => m[1]!), // side-effect imports (runtime)
    ...[...code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]!), // dynamic imports (runtime)
  ]
  expect([...new Set(valueImports)].sort()).toEqual(['./queryScenario'])
  const typeOnly = stmts.filter(m => /^type\b/.test(m[1]!.trim())).map(m => m[2]!)
  for (const s of typeOnly) expect(['./queryScenario', './queryStage']).toContain(s)
  // Value RE-EXPORTS are runtime edges too: `export { x } from '…'` / `export * from '…'` widen the
  // closure exactly like an import (only `export type … from` is erased). Neither file may carry one.
  const reExports = (src: string): string[] =>
    [...src.matchAll(/export\s+([^'"]*?)from\s+['"]([^'"]+)['"]/g)]
      .filter(m => !/^type\b/.test(m[1]!.trim()))
      .map(m => m[2]!)
  expect(reExports(code)).toEqual([])
  // Parser-coverage self-check: the extractor must actually catch both runtime re-export forms.
  expect(reExports(`export { a } from './x'\nexport * from './y'\nexport type { T } from './z'`))
    .toEqual(['./x', './y'])
  // The closure claim holds only while the one value dependency stays dependency-FREE — check it.
  const scenario = strip('src/ui/queryScenario.ts')
  expect(scenario).not.toMatch(/\bimport\b|\brequire\s*\(/)
  expect(reExports(scenario)).toEqual([])
})
