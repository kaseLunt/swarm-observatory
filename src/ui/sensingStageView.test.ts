import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import ts from 'typescript'
import * as THREE from 'three'
import {
  lerpHeadPosition, tintedTrailGeometry, MARK_LIVE, MARK_SPENT, MARK_DIM, MARK_R,
  SENSOR_THREE, OCCLUDER_THREE, fovEdgeThree, drawnInFov, drawnInRange, drawnLosClear,
  fovSectorPositions, coneEdgePositions, fovSectorGeometry, coneEdgesGeometry,
} from './sensingStageView'
import { PALETTE, hexToThree, BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { buildTrail, type Trail } from './trail'
import { buildSensingStage, TARGET_FRAME_OFFSET, type SensingDraw } from './sensingStage'
import { nedToThree } from './placement'
import { FOV_HALF_RAD, R_MAX, OCCLUDER_R2, SENSOR_O, OCCLUDER_C } from './sensingScenario'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { asEventTick, asStateFrame } from '../lib/brand'

// tintedTrailGeometry is pure THREE.BufferGeometry work (no WebGL, no DOM), so its born-hidden drawRange
// and its per-vertex tint indexing are unit-testable in the node env. The colours mirror the module's
// own token derivation (LAW 2 — the same PALETTE names the view uses).
const AFFIRM = new THREE.Color(hexToThree(PALETTE.verdictAffirm))
const NEGATE = new THREE.Color(hexToThree(PALETTE.verdictNegate))
const DIM = new THREE.Color(hexToThree(PALETTE.textDim))

function fakeTrail(n: number): Trail {
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) positions[i * 3 + 2] = i * 2 // z = frame·2, mirroring the real N-lattice step
  const index = new Float32Array(n)
  for (let i = 0; i < n; i++) index[i] = i
  return { positions, index, count: n, first: n > 0 ? 0 : -1 } // present from frame 0 (the first-appearance frame)
}
const draw = (tick: number, eligible: boolean): SensingDraw => ({
  seq: tick, tick, subject: '1:0', sensor: '0', inRange: true, inFov: true, losClear: eligible, eligible, tiebreak: false, g: [0, 0, 0],
})

describe('tintedTrailGeometry — born hidden + tint by evaluated frame', () => {
  // byFrame is frame-indexed: frame 0 has no verdict (the tick-0 verdict was evaluated against frame 1), then
  // one verdict per frame. This is exactly the shape buildSensingStage produces.
  const byFrame: (SensingDraw | null)[] = [null, draw(0, true), draw(1, false), draw(2, true)]

  test('the geometry mounts at drawRange (0, 0) — nothing is drawn before the first sync (no future-trail flash)', () => {
    const g = tintedTrailGeometry(fakeTrail(4), byFrame)
    expect(g.drawRange.start).toBe(0)
    expect(g.drawRange.count).toBe(0)
  })

  test('vertex f is tinted by byFrame[f] — null → the dim NOT-YET colour, eligible → affirm, ineligible → ember', () => {
    const g = tintedTrailGeometry(fakeTrail(4), byFrame)
    const col = g.getAttribute('color') as THREE.BufferAttribute
    const expectColor = (i: number, c: THREE.Color) => {
      expect(col.getX(i)).toBeCloseTo(c.r, 5)
      expect(col.getY(i)).toBeCloseTo(c.g, 5)
      expect(col.getZ(i)).toBeCloseTo(c.b, 5)
    }
    expectColor(0, DIM)     // frame 0: no verdict → the NOT-YET dim (not a fabricated affirm/ember)
    expectColor(1, AFFIRM)  // frame 1: eligible → affirm
    expectColor(2, NEGATE)  // frame 2: ineligible → ember
    expectColor(3, AFFIRM)  // frame 3: eligible → affirm
  })

  test('the position attribute aliases the trail buffer (zero copy — the reveal is a drawRange bump)', () => {
    const trail = fakeTrail(4)
    const g = tintedTrailGeometry(trail, byFrame)
    expect((g.getAttribute('position') as THREE.BufferAttribute).array).toBe(trail.positions)
  })
})

// ── STRUCTURAL INTEGRITY of the drawn geometries (defeat the buffer-VALUE-only assertions) ─────────────
// Every topology test in this file reads getAttribute('position').array VALUES. Three ways to render nothing /
// elsewhere while those values stay correct: (a) an all-zero INDEX buffer (three draws vertex 0 for every element
// — a degenerate), (b) a setDrawRange(0, 0) (nothing drawn), (c) a displaced/hidden object transform (correct
// geometry, wrong place — or zero-scaled to nothing). (a) and (b) are BufferGeometry properties, pinned here on
// the static apparatus builders (fovSector / coneEdges); the tinted-trail geometry is the DOCUMENTED exception —
// born-hidden at drawRange(0,0) by design (pinned in its own block above) — so the full-range assertion is scoped
// to the static apparatus.
//   (c) is an Object3D property, NOT on the geometry — and this is the correction the transform-chain block below makes: a
// mesh's position/rotation/scale (or a parent-group transform) lives on the Object3D and NEVER alters the local
// geometry buffer, so a displaced or zero-scaled apparatus leaves every value/topology assertion in this file
// GREEN. The prior claim here ("a displaced geometry would fail those value tests") was wrong. The transform
// chain therefore needs its OWN binding: the transform-chain block pins the meshes' actual transforms to the exported anchor
// constants (source-level identity, the hangar.test mountGate precedent) and pins the identity meshes as identity.
describe('the static apparatus geometries are non-indexed, itemSize-3, full draw range (nothing hidden)', () => {
  const STATIC: [string, () => THREE.BufferGeometry][] = [
    ['fovSectorGeometry', fovSectorGeometry],
    ['coneEdgesGeometry', coneEdgesGeometry],
  ]
  test.each(STATIC)('%s: non-indexed — the position stream IS the draw stream (an all-zero index cannot lie)', (_n, build) => {
    expect(build().index).toBeNull()
  })
  test.each(STATIC)('%s: the position attribute is itemSize 3 (x,y,z per vertex)', (_n, build) => {
    expect(build().getAttribute('position')!.itemSize).toBe(3)
  })
  test.each(STATIC)('%s: the draw range covers EVERY vertex (start 0, the default "all" count) — no setDrawRange(0,0)', (_n, build) => {
    const g = build()
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0)
    expect(g.drawRange.start).toBe(0)
    expect(g.drawRange.count).toBe(Infinity) // three's default "draw all"; any finite-short count would hide vertices
  })

  test('the tinted trail keeps its DOCUMENTED born-hidden exception (drawRange 0,0) but is otherwise non-indexed itemSize-3', () => {
    const g = tintedTrailGeometry(fakeTrail(4), [null, draw(0, true), draw(1, false), draw(2, true)])
    expect(g.index).toBeNull()
    expect(g.getAttribute('position')!.itemSize).toBe(3)
    expect(g.drawRange).toEqual({ start: 0, count: 0 }) // born hidden — the reveal bumps count per tick (its own block)
  })

  test('PREMISE: an all-zero index OR an empty drawRange leaves the VALUES intact but the structural checks catch it', () => {
    const good = fovSectorGeometry()
    const verts = good.getAttribute('position')!.count
    // (a) all-zero index: the position VALUES are untouched (a value-only test still passes), but three would draw
    // vertex 0 for every element. The non-indexed assertion rejects it.
    const zeroIndexed = fovSectorGeometry()
    zeroIndexed.setIndex(new Array(verts).fill(0))
    expect(zeroIndexed.getAttribute('position')!.array).toEqual(good.getAttribute('position')!.array) // values identical…
    expect(zeroIndexed.index).not.toBeNull()                                                          // …but the structure is caught
    // (b) empty drawRange: values untouched, nothing drawn. The full-range assertion rejects it.
    const hidden = fovSectorGeometry()
    hidden.setDrawRange(0, 0)
    expect(hidden.getAttribute('position')!.array).toEqual(good.getAttribute('position')!.array)
    expect(hidden.drawRange.count).not.toBe(Infinity)
  })
})

// ── the apparatus TRANSFORM CHAIN is bound to its DEFECT CLASS, checked at the SYNTAX level ──
// The geometry-buffer tests above pin the geometry BUFFERS; they cannot see an Object3D transform (position/rotation/scale/
// quaternion/matrix, or a parent-group transform) that moves or hides the apparatus. @react-three/test-renderer is
// NOT a dependency, so rather than render the tree we PIN THE SOURCE — but the EARLIER textual pins were a
// recursive-grammar hazard: a regex/substring capture of an element's opening tag cannot parse JSX. Three bypasses
// of ONE class proved it: (1) a prefix-only `toMatch(/<mesh position={SENSOR_THREE}/)` passed with a `scale={0}`
// appended AFTER; (2) a SPREAD (`{...{scale: 0}}`) or a WHITESPACED prop (`scale = {0}`) slipped past a `prop=`
// denylist; (3) an arrow-function prop (`onUpdate={() => undefined} scale={0}`) truncated the "opening tag" capture
// at the `=>`'s `>`, hiding the trailing `scale`. Textual capture cannot see a recursive grammar — so this block
// kills the CLASS: it parses the shipped view with the TypeScript compiler (ts.createSourceFile, ScriptKind.TSX —
// `typescript` is already the tsc-gate devDependency, imported here in the TEST only, no new dep) and asserts on
// PARSED JSX attributes. Each apparatus element is found by its STRUCTURAL anchor (its child geometry, its
// geometry/ref prop, or its unique tag): (a) NO JsxSpreadAttribute; (b) a PINNED element carries EXACTLY ONE
// `position` attribute whose initializer expression IS the pinned anchor (SENSOR_THREE / OCCLUDER_THREE.center) and
// NO other transform; (c) an IDENTITY element carries NO transform attribute at all — where "transform" is
// position/rotation/scale/quaternion/matrix* INCLUDING the R3F axis-suffixed forms (rotation-x, position-z, …),
// matched on the PARSED attribute NAME (no whitespace, spread, or arrow can evade a name comparison). The wrapping
// group is found structurally (the <group> whose descendants ARE the apparatus elements) and pinned identity.
//
// HONEST RESIDUAL — what source pins CANNOT prove: they bind the AUTHORED JSX, not RUNTIME mutation. The authored
// surface is now checked at the SYNTAX level, so the ENTIRE textual-bypass class is dead — a spread, a whitespaced
// prop, an arrow-function prop, an appended transform are all parsed structurally and caught. What remains conceded
// is runtime mutation: a future `headRef.current.scale.set(0,0,0)` in an effect would evade a source pin. That
// residual is bounded and accepted: the ONLY runtime transform writes in this view are POSITION writes (the head via
// lerpHeadPosition, the marks via setPosition(...t3(m.pos)) — both pinned below as source call-sites); there are no
// runtime scale/rotation/quaternion writes. The syntax-checked authored tags plus those two position-source pins
// together cover both surfaces for the shipped code.
describe('the apparatus transform chain is BOUND to its defect class (a displaced/zero-scaled/parented mount is caught)', () => {
  const src = readFileSync('src/ui/sensingStageView.tsx', 'utf8')
  // Parse the shipped view with the TS compiler (ScriptKind.TSX) — `typescript` is already the tsc-gate
  // devDependency, imported here in the TEST only. The whole textual-capture CLASS is dead: we assert on PARSED JSX
  // attributes, so whitespace, arrow-function props, and spreads are structure the parser sees, not characters a
  // regex can be fooled by.
  const sourceFile = ts.createSourceFile('sensingStageView.tsx', src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX)

  type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement
  type Attr = { name: string; expr: string | null } // expr = the attribute initializer's EXPRESSION text (null for a bare/boolean prop)
  type El = { tag: string; spread: boolean; attrs: Attr[]; node: JsxLike }
  const opening = (n: JsxLike): ts.JsxOpeningLikeElement => (ts.isJsxElement(n) ? n.openingElement : n)
  const parseEl = (n: JsxLike, sf: ts.SourceFile): El => {
    const o = opening(n)
    let spread = false
    const attrs: Attr[] = []
    for (const p of o.attributes.properties) {
      if (ts.isJsxSpreadAttribute(p)) { spread = true; continue }        // {...x} — a JsxSpreadAttribute, seen as structure not `prop=`
      const init = p.initializer
      const expr = init === undefined ? null                             // boolean-shorthand prop (no initializer)
        : ts.isJsxExpression(init) ? (init.expression?.getText(sf) ?? null)
        : init.getText(sf)                                               // a string-literal initializer
      attrs.push({ name: p.name.getText(sf), expr })
    }
    return { tag: o.tagName.getText(sf), spread, attrs, node: n }
  }
  // Every JSX element in the shipped view, parsed once.
  const allEls: El[] = []
  const collect = (n: ts.Node): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) allEls.push(parseEl(n, sourceFile))
    ts.forEachChild(n, collect)
  }
  collect(sourceFile)
  // Direct child-element tag names of a JsxElement (a self-closing element has none) — a structural anchor.
  const childTags = (n: JsxLike): string[] =>
    ts.isJsxElement(n)
      ? n.children.filter((c): c is JsxLike => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)).map(c => opening(c).tagName.getText(sourceFile))
      : []
  // The ONE apparatus element matching a structural predicate (throws loud if the anchor ever drifts).
  const only = (pred: (e: El) => boolean, label: string): El => {
    const found = allEls.filter(pred)
    if (found.length !== 1) throw new Error(`expected exactly one ${label}, found ${found.length}`)
    return found[0]!
  }
  // Each apparatus element, anchored STRUCTURALLY — independent of the transform we then assert on it: the sensor/
  // occluder/head by their CHILD geometry, the fov/edges by their geometry prop, the marks/group by their unique tag.
  const sensorMesh = only(e => e.tag === 'mesh' && childTags(e.node).includes('octahedronGeometry'), 'sensor octahedron <mesh>')
  const occluderMesh = only(e => e.tag === 'mesh' && childTags(e.node).includes('sphereGeometry'), 'occluder sphere <mesh>')
  const headMesh = only(e => e.tag === 'mesh' && childTags(e.node).includes('coneGeometry'), 'head cone <mesh>')
  const fovMesh = only(e => e.tag === 'mesh' && e.attrs.some(a => a.name === 'geometry' && a.expr === 'fovGeo'), 'fov sector <mesh geometry={fovGeo}>')
  const edgesSeg = only(e => e.tag === 'lineSegments' && e.attrs.some(a => a.name === 'geometry' && a.expr === 'edgesGeo'), 'edges <lineSegments geometry={edgesGeo}>')
  const marksMesh = only(e => e.tag === 'instancedMesh', 'marks <instancedMesh>')
  const groupEl = only(e => e.tag === 'group', 'apparatus <group>')

  // Transform denylist over PARSED attribute NAMES (anchored ^…$, so an axis suffix like `-x` is matched exactly and
  // nothing but a transform name matches). matrix\w* catches matrix / matrixAutoUpdate / matrixWorldAutoUpdate.
  const POSITION = /^position(-[xyz])?$/
  const NON_POSITION_TRANSFORM = /^(rotation|scale|quaternion|matrix\w*)(-[xyz])?$/
  const ANY_TRANSFORM = /^(position|rotation|scale|quaternion|matrix\w*)(-[xyz])?$/
  // A PINNED element: no spread, EXACTLY ONE whole-vector `position` whose initializer is the pinned anchor
  // expression, and NO rotation/scale/quaternion/matrix. (No-spread is the soundness precondition — a spread could
  // override any named prop, so it is banned before the named checks can be trusted.)
  const assertPinned = (e: El, what: string, anchorExpr: string): void => {
    expect(e.spread, `${what}: no JSX spread`).toBe(false)
    const positions = e.attrs.filter(a => POSITION.test(a.name))
    expect(positions.map(a => a.name), `${what}: exactly one position (no position-x twin / second position)`).toEqual(['position'])
    expect(positions[0]!.expr, `${what}: mounts at the pinned anchor`).toBe(anchorExpr)
    expect(e.attrs.some(a => NON_POSITION_TRANSFORM.test(a.name)), `${what}: no rotation/scale/quaternion/matrix rides along`).toBe(false)
  }
  // An IDENTITY element: no spread, and NO transform prop of any kind (absolute buffers / basis-placed instances / the group).
  const assertIdentity = (e: El, what: string): void => {
    expect(e.spread, `${what}: no JSX spread`).toBe(false)
    expect(e.attrs.some(a => ANY_TRANSFORM.test(a.name)), `${what}: no transform prop`).toBe(false)
  }
  // Parse a standalone JSX snippet into the same El view — for the premise-defeat mutations below.
  const snippet = (jsx: string): El => {
    const sf = ts.createSourceFile('snippet.tsx', `const _ = ${jsx}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let el: El | null = null
    const walk = (n: ts.Node): void => {
      if (el) return
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) el = parseEl(n, sf)
      else ts.forEachChild(n, walk)
    }
    walk(sf)
    if (el === null) throw new Error(`snippet did not parse to a JSX element: ${jsx}`)
    return el
  }

  test('PREMISE: parsed at the SYNTAX level, every textual bypass FAILS — arrow-prop, spread, whitespace, displacement, axis twin', () => {
    // The shipped tags pass the assertions…
    expect(() => assertPinned(sensorMesh, 'sensor', 'SENSOR_THREE')).not.toThrow()
    expect(() => assertIdentity(fovMesh, 'fov')).not.toThrow()
    // …THE FINDING: an arrow-function prop no longer truncates the "opening tag" at its `=>` — the trailing scale is parsed and CAUGHT.
    expect(() => assertPinned(snippet('<mesh position={SENSOR_THREE} onUpdate={() => undefined} scale={0}></mesh>'), 'arrow', 'SENSOR_THREE')).toThrow()
    // …a SPREAD is a JsxSpreadAttribute (not a `prop=`) — the parser sees it; the no-spread precondition bites, on pinned AND identity.
    expect(() => assertPinned(snippet('<mesh position={SENSOR_THREE} {...{ scale: 0 }}></mesh>'), 'spread', 'SENSOR_THREE')).toThrow()
    expect(() => assertIdentity(snippet('<mesh geometry={fovGeo} {...{ scale: 0 }}></mesh>'), 'spread-id')).toThrow()
    // …WHITESPACE around `=` is irrelevant to a parsed attribute name.
    expect(() => assertPinned(snippet('<mesh position = {SENSOR_THREE} scale = {0}></mesh>'), 'ws', 'SENSOR_THREE')).toThrow()
    expect(() => assertIdentity(snippet('<mesh geometry={fovGeo} scale = {0}></mesh>'), 'ws-id')).toThrow()
    // …a DISPLACED position (a different initializer expression) fails the pinned-anchor check.
    expect(() => assertPinned(snippet('<mesh position={[9, 9, 9]}></mesh>'), 'displaced', 'SENSOR_THREE')).toThrow()
    // …an axis-suffixed twin (position-x) fails exactly-one-position; an R3F axis transform (rotation-x) fails identity.
    expect(() => assertPinned(snippet('<mesh position={SENSOR_THREE} position-x={9}></mesh>'), 'twin', 'SENSOR_THREE')).toThrow()
    expect(() => assertIdentity(snippet('<mesh geometry={fovGeo} rotation-x={1}></mesh>'), 'axis-id')).toThrow()
  })

  test('PREMISE (Object3D): a transform displaces/hides the apparatus while the geometry BUFFER stays byte-identical', () => {
    // A transform lives on the Object3D, NEVER the local buffer, so a displaced/zero-scaled mesh renders the
    // apparatus wrong (or invisible) while every value/topology test above passes — hence this source-pin block.
    const g = fovSectorGeometry()
    const before = Float32Array.from(g.getAttribute('position')!.array)
    const mesh = new THREE.Mesh(g)
    mesh.position.set(1000, 0, 0); mesh.scale.setScalar(0); mesh.updateMatrixWorld(true)
    expect(g.getAttribute('position')!.array).toEqual(before)                    // buffer untouched — value tests can't catch it
    expect(mesh.matrixWorld.elements).not.toEqual(new THREE.Matrix4().elements)  // …but the render (matrixWorld) DID change
  })

  test('the sensor octahedron: mounts at the EXPORTED SENSOR_THREE and carries NO other transform prop', () => {
    assertPinned(sensorMesh, 'sensor octahedron', 'SENSOR_THREE')
    expect(SENSOR_THREE).toEqual(nedToThree(SENSOR_O)) // value: the shared t3 projection of the sensor origin
  })

  test('the occluder sphere: mounts at the EXPORTED OCCLUDER_THREE.center and carries NO other transform prop', () => {
    assertPinned(occluderMesh, 'occluder sphere', 'OCCLUDER_THREE.center')
    expect(OCCLUDER_THREE.center).toEqual(nedToThree(OCCLUDER_C)) // value: the shared t3 projection of the occluder centre
  })

  test('the FOV sector + range-ring/edge meshes mount at IDENTITY — absolute buffers, no position/rotation/scale/quaternion/matrix to displace them', () => {
    // These builders emit ABSOLUTE vertices (value-pinned), so their meshes take NO transform — one would
    // DOUBLE-apply the world offset. The parsed opening tags must be free of EVERY transform prop.
    assertIdentity(fovMesh, 'fov sector mesh')
    assertIdentity(edgesSeg, 'range-ring/edge lineSegments')
  })

  test('the detection marks: placed by the shared t3 basis (setPosition(...t3(m.pos))) AND the instancedMesh carries no transform', () => {
    // The position SOURCE — the basis pin: the instance matrices ARE the beads' transform, bound to t3 so
    // they ride the SAME basis as the trail (a mirrored basis would strew them off the flight). A runtime call-site,
    // not an authored attribute — the conceded position-only runtime residual, separately pinned.
    expect(src).toMatch(/setPosition\(\.\.\.t3\(m\.pos\)\)/)
    // …AND the element itself carries no transform: a scale={0} / position offset on the instancedMesh would hide or
    // shift the WHOLE bead-chain regardless of the per-instance matrices — the hole the setter-only pin left open.
    assertIdentity(marksMesh, 'marks instancedMesh')
  })

  test('the head cone: rides the tested lerpHeadPosition AND the mesh element carries no transform', () => {
    // The pose SOURCE — bound to the pinned lerp fn, not a literal: a runtime call-site (the conceded position-only residual).
    expect(src).toMatch(/lerpHeadPosition\(head\.position/)
    // …AND no element-level scale/rotation hides or reorients the head the setter placed (the setter-only hole).
    assertIdentity(headMesh, 'head cone mesh')
  })

  test('the parent <group> that WRAPS the apparatus carries no transform — anchored to the apparatus group, not any bare <group>', () => {
    assertIdentity(groupEl, 'apparatus group')
    // ANCHOR it to the apparatus: every apparatus element is a DESCENDANT of THIS group's node — so we have pinned
    // the group that actually wraps the apparatus, not some unrelated bare <group>.
    const descendants = new Set<JsxLike>()
    const w = (n: ts.Node): void => {
      if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && n !== groupEl.node) descendants.add(n)
      ts.forEachChild(n, w)
    }
    w(groupEl.node)
    for (const [el, name] of [[sensorMesh, 'sensor'], [occluderMesh, 'occluder'], [fovMesh, 'fov'], [edgesSeg, 'edges'], [marksMesh, 'marks'], [headMesh, 'head']] as const) {
      expect(descendants.has(el.node), `apparatus ${name} inside the pinned group`).toBe(true)
    }
    // PREMISE: a transform on the group fails the SAME assertion — a group-level offset is caught.
    expect(() => assertIdentity(snippet('<group position={[1, 0, 0]}></group>'), 'group-tamper')).toThrow()
  })
})

// The head pose lerps the evaluated frame pair by the store fraction — pure vector math,
// unit-testable without WebGL. fakeTrail: z = frame·2 (the N-lattice step), so the expected values are exact.
describe('lerpHeadPosition — the head follows the evaluated (t0, t1, fraction) sample', () => {
  test('fraction 0 sits on the evaluated frame; 0.5 sits halfway to its successor', () => {
    const v = new THREE.Vector3()
    lerpHeadPosition(v, fakeTrail(4), asEventTick(1), 0)   // tick 1 → frame 2 (offset 1)
    expect(v.z).toBe(4)
    lerpHeadPosition(v, fakeTrail(4), asEventTick(1), 0.5) // halfway frame 2 → 3
    expect(v.z).toBe(5)
  })

  test('at the terminal frame both endpoints clamp — no fraction can push the head past the trajectory', () => {
    const v = new THREE.Vector3()
    for (const fraction of [0, 0.5, 0.99]) {
      lerpHeadPosition(v, fakeTrail(4), asEventTick(3), fraction) // tick 3 → frame 4 clamps to last (3); t1 clamps too
      expect(v.z).toBe(6)
    }
  })

  // The brand forbids the double-offset. lerpHeadPosition applies TARGET_FRAME_OFFSET itself, so its `tick`
  // must be an EventTick (the raw playhead), NEVER a StateFrame (an already-evaluated frame): passing a resolved
  // frame would shift it a SECOND time. Typing `tick: EventTick` makes that a compile error at the primary named
  // cursor surface. The runtime call still runs (brands erase) — the @ts-expect-error alone locks the domain.
  test('a StateFrame cannot pass where lerpHeadPosition expects an EventTick (the double-offset the brand bars)', () => {
    const v = new THREE.Vector3()
    // @ts-expect-error a StateFrame is not an EventTick — an already-offset frame must not re-enter the offset
    lerpHeadPosition(v, fakeTrail(4), asStateFrame(3), 0)
    expect(v.z).toBe(6) // frame 3 clamps to the terminal vertex (fakeTrail(4)) — the erased runtime still resolves
  })
})

// ── DETECTION-MARK BLOOM BUDGET (the f2a detection pile that out-bloomed the eclipse/bookend) ───
// three.js `luminance()` (Rec.709) — the exact weights the postprocessing Bloom's LuminanceMaterial uses;
// renderer tone mapping is OFF before Bloom, so it sees these linear values. Mirrors queryStageView.test.ts's
// CONTACT_DIM guard: the persisted (spent) marks must sit BELOW the renderer's OWN cutoff so the pile never
// blooms, while the LIVE mark must clear it (a raised threshold that silently killed the live glow is caught).
// Bound THROUGH the renderer's exported colours — change MARK_DIM, the token, or the threshold and these move.
const W = [0.2126729, 0.7151522, 0.0721750] as const
const lum = (c: THREE.Color): number => W[0] * c.r + W[1] * c.g + W[2] * c.b

describe('detection marks — SHRINK + GRADE: a countable bead-chain, only the live mark blooms', () => {
  test('SHRINK: the mark radius is small (2), so 17 marks 2m apart read as a bead-chain, not a fused capsule', () => {
    expect(MARK_R).toBe(2)
  })
  test('the LIVE mark (full affirm) clears the bloom threshold — the guard is meaningful (live detection glows)', () => {
    expect(lum(MARK_LIVE)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD) // ≈0.72 — the current contact, coincident with the head
  })
  test('a SPENT mark (MARK_SPENT = affirm × MARK_DIM) sits BELOW the threshold — the persisted pile never blooms', () => {
    expect(lum(MARK_SPENT)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD) // ≈0.36 — the ratified e0 CONTACT_DIM sub-bloom register
    expect(MARK_SPENT.r).toBeCloseTo(MARK_LIVE.r * MARK_DIM, 6)     // spent IS the live colour × MARK_DIM (identity kept, hierarchy ceded)
    expect(MARK_SPENT.g).toBeCloseTo(MARK_LIVE.g * MARK_DIM, 6)
    expect(MARK_SPENT.b).toBeCloseTo(MARK_LIVE.b * MARK_DIM, 6)
  })
})

// ── RENDERED-SPACE ORACLE ────────────────────────────────────────────────────────────────────────
// The class of test that would have caught the two-basis defect. The prior sensing tests proved the FLIGHT
// (trail / head / paused-cone parity) and the MODEL (byFrame indexing), but nothing tied the drawn APPARATUS
// (cone / range ring / occluder) to the flight in ONE space — so the apparatus quietly drew through a mirrored
// [n,−d,e] basis while the flight ran through [e,−d,n], an x↔z reflection: a drone dead-centre of the drawn
// cone decoded "outside FOV". Here, for the REAL f2a bundle, we place the head at its FLIGHT-basis three
// position (placement.nedToThree of the decoded pose g — exactly where the trail/head render) and assert the
// apparatus's OWN t3-projected predicates (sensingStageView.drawnInFov/InRange/LosClear — the SAME basis the
// cone/ring/occluder are drawn with) reproduce the decoded in_fov / in_range / los_clear / eligible bits at
// EVERY tick. If the two bases ever diverge again, the drawn membership stops matching the engine and this
// fails loud. The reflection discriminant at the end proves the oracle is basis-sensitive (it would have failed
// on the pre-fix code).
function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
// nedToThree writes −down into the up slot, so a d=0 pose carries a harmless −0 (−0 === 0 and renders
// identically); normalize it to +0 for the strict tuple comparisons below (vitest's toEqual distinguishes them).
const nz1 = (x: number): number => (x === 0 ? 0 : x)
const nz = (v: readonly number[]): number[] => v.map(nz1)
// Point-to-segment squared distance — the test-side numeric for the "exactly tangent" / "within radius" claims
// (the reproduction itself goes through the exported drawnLosClear, which encapsulates this same math).
function segMinDist2(
  a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number],
): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
  const ab2 = abx * abx + aby * aby + abz * abz
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - a[0]) * abx + (c[1] - a[1]) * aby + (c[2] - a[2]) * abz) / ab2))
  const dx = c[0] - (a[0] + abx * t), dy = c[1] - (a[1] + aby * t), dz = c[2] - (a[2] + abz * t)
  return dx * dx + dy * dy + dz * dz
}

describe('rendered-space oracle — the drawn cone/ring/occluder reproduce the decoded verdict', () => {
  const model = new RunModel(decodeBundle(detFixture('f2a_seed42')), null)
  const stage = buildSensingStage(model)
  // The head at its FLIGHT-basis three position: placement.nedToThree of the pose the tick's verdict was
  // evaluated against — bit-identical to the trail vertex the head renders at (buildTrail lays vertex f via the
  // same entityPosition mapping). The apparatus predicates project the scenario constants through their OWN t3;
  // the assertion is that these two independently-projected surfaces agree with the engine.
  const headThreeAt = (tick: number): [number, number, number] => nedToThree(stage.byTick[tick]!.g!)

  test('the apparatus and the flight/anchor conversions are ONE basis (sensor + occluder agree bit-for-bit)', () => {
    // Scene's tour-camera anchors (SENSOR_THREE / OCCLUDER_THREE) are placement.nedToThree of these same
    // constants; the apparatus must land them identically, or the camera would frame a cone that isn't there.
    expect(nz(SENSOR_THREE)).toEqual(nz(nedToThree(SENSOR_O)))
    expect(nz(OCCLUDER_THREE.center)).toEqual(nz(nedToThree(OCCLUDER_C)))
    expect(OCCLUDER_THREE.r2).toBe(OCCLUDER_R2)
    expect(nz(SENSOR_THREE)).toEqual([0, 0, 0])            // sensor at the origin
    expect(nz(OCCLUDER_THREE.center)).toEqual([41, 0, 41]) // occluder on the n=e diagonal (three x=east, z=north)
  })

  test('the drawn FOV wedge is laid at ±FOV_HALF_RAD about the +z (due-North) cone axis', () => {
    const r = fovEdgeThree(1), l = fovEdgeThree(-1)
    expect(Math.atan2(r[0], r[2])).toBeCloseTo(FOV_HALF_RAD, 12)   // +edge opens toward +east of due-North
    expect(Math.atan2(l[0], l[2])).toBeCloseTo(-FOV_HALF_RAD, 12)  // −edge symmetric
    // the cone axis is +z (due-North), NOT +x — the exact thing the mirrored basis got wrong. Both edges keep a
    // positive north component (the 53.13° half-angle < 90°) and open to opposite east; the wedge straddles +z.
    expect(r[2]).toBeGreaterThan(0)
    expect(l[2]).toBeGreaterThan(0)
    expect(r[0]).toBeGreaterThan(0)   // +edge to +east
    expect(l[0]).toBeLessThan(0)      // −edge to −east
  })

  test('tick 48 — the head sits OUTSIDE the drawn wedge (bearing > half-angle); decoded in_fov false', () => {
    const h = headThreeAt(48)
    expect(Math.abs(Math.atan2(h[0], h[2]))).toBeGreaterThan(FOV_HALF_RAD)
    expect(drawnInFov(h)).toBe(false)
    expect(drawnInFov(h)).toBe(stage.byTick[48]!.inFov)
  })

  test('tick 55 — the 3-4-5 head sits EXACTLY on the drawn wedge edge; decoded in_fov flips true THERE', () => {
    const h = headThreeAt(55)
    expect(nz(h)).toEqual([48, 0, 36])                // NED (36,48,0) → three (east 48, up 0, north 36)
    expect(Math.atan2(h[0], h[2])).toBe(FOV_HALF_RAD) // atan2(48,36) === the pinned half-angle — ON the drawn edge
    expect(drawnInFov(h)).toBe(true)                  // closed boundary (≤) admits the edge
    expect(stage.byTick[54]!.inFov).toBe(false)       // one 2-m step before: outside the wedge
    expect(stage.byTick[55]!.inFov).toBe(true)        // at the edge: the decoded flip — the tour's own claim, true
  })

  test('tick 67 — the occluder is EXACTLY tangent to the drawn sightline; decoded los_clear false (eclipse)', () => {
    const h = headThreeAt(67)
    expect(nz(h)).toEqual([48, 0, 60])
    expect(segMinDist2(SENSOR_THREE, h, OCCLUDER_THREE.center)).toBe(OCCLUDER_R2) // min-dist² === r² exactly — tangent
    expect(drawnLosClear(h)).toBe(false)              // a CLOSED occluder blocks at tangency (strict >)
    expect(drawnLosClear(h)).toBe(stage.byTick[67]!.losClear)
  })

  test('tick 82 — the head sits EXACTLY on the drawn range ring; decoded in_range true, out one step later', () => {
    const h82 = headThreeAt(82), h83 = headThreeAt(83)
    expect(h82[0] ** 2 + h82[1] ** 2 + h82[2] ** 2).toBe(R_MAX * R_MAX) // 10404 === r²max exactly — on the ring
    expect(drawnInRange(h82)).toBe(true)              // closed boundary (≤)
    expect(drawnInRange(h83)).toBe(false)             // 48-90-102 → 48-92-… leaves the ring
    expect(drawnInRange(h82)).toBe(stage.byTick[82]!.inRange)
    expect(drawnInRange(h83)).toBe(stage.byTick[83]!.inRange)
  })

  test('FULL SWEEP: every decoded tick reproduces in_fov / in_range / los_clear / eligible from the drawn apparatus', () => {
    let checked = 0
    for (let t = 0; t < model.tickCount; t++) {
      const d = stage.byTick[t]
      if (!d || !d.g) continue
      const h = nedToThree(d.g)
      expect(drawnInFov(h), `in_fov @${t}`).toBe(d.inFov)
      expect(drawnInRange(h), `in_range @${t}`).toBe(d.inRange)
      expect(drawnLosClear(h), `los_clear @${t}`).toBe(d.losClear)
      // eligible is the drawn conjunction — the same AND the honesty recompute checks against the engine bit
      expect(drawnInRange(h) && drawnInFov(h) && drawnLosClear(h), `eligible @${t}`).toBe(d.eligible)
      checked++
    }
    expect(checked).toBe(96) // all 96 kind-22 ticks reproduced — none skipped
  })

  test('the eclipse window: the occluder is within its radius of the drawn sightline IFF the tick is blocked', () => {
    let blocked = 0
    for (let t = 0; t < model.tickCount; t++) {
      const d = stage.byTick[t]
      if (!d || !d.g) continue
      const within = segMinDist2(SENSOR_THREE, nedToThree(d.g), OCCLUDER_THREE.center) <= OCCLUDER_R2
      expect(within, `occluder-within-r ⟺ blocked @${t}`).toBe(!d.losClear)
      if (!d.losClear) blocked++
    }
    expect(blocked).toBeGreaterThan(0) // f2a has a real eclipse window (the beat exists)
  })

  test('BASIS DISCRIMINANT: the x↔z reflection (the basis-drift defect) MISclassifies FOV — the oracle is basis-sensitive', () => {
    // Reflecting the flight-basis head x↔z is exactly seeing it under the mirrored basis-B apparatus. It MUST
    // break the reproduction on at least one tick — proof this oracle would have failed on the pre-fix code.
    const reflect = (h: readonly [number, number, number]): [number, number, number] => [h[2], h[1], h[0]]
    let mismatches = 0
    for (let t = 0; t < model.tickCount; t++) {
      const d = stage.byTick[t]
      if (!d || !d.g) continue
      if (drawnInFov(reflect(nedToThree(d.g))) !== d.inFov) mismatches++
    }
    expect(mismatches).toBeGreaterThan(0)
    // concretely at tick 48: the mirrored apparatus calls the OUT-of-FOV ember drone dead-centre (in-FOV)
    expect(drawnInFov(reflect(headThreeAt(48)))).toBe(true)
    expect(stage.byTick[48]!.inFov).toBe(false)
  })

  // ── BUFFER BINDING — the oracle reads the ACTUAL rendered vertex data, not a parallel re-derivation ─────
  // Everything above proves the exported PREDICATES and ANCHORS share the flight basis — but the predicates
  // re-derive the wedge about +z via atan2 instead of reading the mesh buffers, so an inline drift in the
  // geometry CONSTRUCTION (say, a swapped cos/sin at the sector's bearing → a mirrored drawn cone) would
  // leave every predicate assertion green while the scene draws the wrong apparatus. The tests below close
  // that gap: they read the very Float32 position buffers the meshes mount (the geometry builders are pure
  // BufferGeometry — no WebGL) and bind them to the oracle's own anchors and predicates, then prove the
  // binding is construction-sensitive by rebuilding the SAME construction under a swapped basis.

  test('the geometry buffers ARE the builder output: element-wise Math.fround identity (Float32 quantization only)', () => {
    // The meshes store Float32; the builders emit f64. Pinning the buffers as the exact fround image of the
    // exported builders is what licenses every buffer-level assertion below — one vertex set, two precisions.
    const mismatchCount = (actual: ArrayLike<number>, source: number[]): number => {
      if (actual.length !== source.length) return -1
      let n = 0
      for (let i = 0; i < source.length; i++) if (!Object.is(actual[i], Math.fround(source[i]!))) n++
      return n
    }
    expect(mismatchCount(fovSectorGeometry().getAttribute('position')!.array, fovSectorPositions())).toBe(0)
    expect(mismatchCount(coneEdgesGeometry().getAttribute('position')!.array, coneEdgePositions())).toBe(0)
  })

  test('the drawn FOV boundary-ray terminals ARE apex + R_MAX·fovEdgeThree — read from the actual line buffer', () => {
    const arr = coneEdgesGeometry().getAttribute('position')!.array as Float32Array
    // coneEdgePositions' pinned layout: RING segment pairs first, then [apex, edge(−1), apex, edge(+1)] as
    // the final four vertices — the two boundary rays live at the buffer's tail.
    const base = arr.length - 12
    for (const [off, side] of [[base, -1], [base + 6, 1]] as const) {
      const e = fovEdgeThree(side as 1 | -1)
      for (let k = 0; k < 3; k++) {
        // The buffer is Float32Array, so the f64 expectation is compared under Math.fround — the exact value
        // the buffer stores, not a tolerance (nz collapses the harmless −0 the d=0 plane produces).
        expect(nz1(arr[off + k]!), `apex[${k}] side ${side}`).toBe(nz1(Math.fround(SENSOR_THREE[k]!)))
        expect(nz1(arr[off + 3 + k]!), `edge terminal[${k}] side ${side}`).toBe(nz1(Math.fround(SENSOR_THREE[k]! + R_MAX * e[k]!)))
      }
    }
  })

  // The range-RING prefix is swept, and the sweep is REAL, not a zero-area collapse. The earlier form pinned
  // count / radius / continuity / closure — all of which 192 COPIES of one R_MAX point silently satisfy. This adds
  // the two properties a degenerate cannot fake: every segment has NONZERO length, and the per-segment bearing
  // advances monotonically CCW summing to a full 2π. Reads the ACTUAL Float32 line buffer the lineSegments mounts.
  test('the drawn range ring is a FULL R_MAX circle: at R_MAX on the ground, continuous, closed, NONZERO-length segments, monotonic 2π sweep', () => {
    const arr = coneEdgesGeometry().getAttribute('position')!.array as Float32Array
    const RING = 96
    const RAD2_WIN = 0.01 // the same Float32 + transcendental-tessellation window the fan uses on d²
    const vert = (i: number): [number, number, number] => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
    // Layout: RING segment pairs (2·RING vertices) then [apex, edge(−1), apex, edge(+1)] (4 vertices) at the tail.
    expect(arr.length / 3 - 4).toBe(RING * 2) // a half-radius / one-segment ring would fail the vertex COUNT here
    for (let i = 0; i < RING * 2; i++) {
      const [x, y, z] = vert(i)
      // AT R_MAX (|d² − R_MAX²| within the window), not merely ≤ it — a half-radius ring vertex is off by ~7803.
      expect(Math.abs(x * x + y * y + z * z - R_MAX * R_MAX), `ring vertex ${i} AT R_MAX`).toBeLessThanOrEqual(RAD2_WIN)
      expect(nz1(y), `ring vertex ${i} on the ground plane`).toBe(0) // NED d=0 → three y=0 (−0 normalized)
    }
    // Segment continuity: segment i's end (2i+1) IS segment i+1's start (2i+2) — the shared arc endpoint, at the
    // SAME angle, so bit-identical (a disjoint/one-segment ring breaks this).
    for (let i = 0; i < RING - 1; i++) expect(nz(vert(2 * i + 1)), `segment ${i}→${i + 1} continuous`).toEqual(nz(vert(2 * i + 2)))
    // NONZERO length + monotonic 2π sweep: what a 192-copies-of-one-point ring cannot fake. Bearing is the
    // ground-plane atan2(x, z); the per-segment advance is small (2π/96), so folding into (−π, π] needs no unwrap.
    let totalSweep = 0
    for (let i = 0; i < RING; i++) {
      const a = vert(2 * i), b = vert(2 * i + 1)
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), `ring segment ${i} nonzero length`).toBeGreaterThan(1e-3)
      let d = Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2])
      d = Math.atan2(Math.sin(d), Math.cos(d)) // fold into (−π, π]
      expect(d, `ring segment ${i} advances CCW`).toBeGreaterThan(0)
      totalSweep += d
    }
    expect(totalSweep, 'the ring sweeps a full 2π (not a zero-sweep degenerate)').toBeCloseTo(2 * Math.PI, 2)
    // Closure: the last segment's end returns to the first segment's start (a full 2π sweep), within the Float32
    // cos(2π) ≠ cos(0) quantization.
    const first = vert(0), last = vert(2 * RING - 1)
    expect(Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]), 'ring closes at 2π').toBeLessThanOrEqual(1e-2)
  })

  test('PREMISE: a ring of 192 COPIES of one R_MAX point PASSES radius/continuity/closure but FAILS length + sweep', () => {
    const RING = 96
    const P: [number, number, number] = [R_MAX * Math.sin(0.3), 0, R_MAX * Math.cos(0.3)] // one point ON the ring
    const arr = new Float32Array(RING * 2 * 3)
    for (let i = 0; i < RING * 2; i++) { arr[i * 3] = P[0]; arr[i * 3 + 1] = P[1]; arr[i * 3 + 2] = P[2] }
    const vert = (i: number): [number, number, number] => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
    // It satisfies the OLD checks: every vertex at R_MAX, on the ground, continuity + closure trivially hold.
    for (let i = 0; i < RING * 2; i++) expect(Math.abs(vert(i)[0] ** 2 + vert(i)[1] ** 2 + vert(i)[2] ** 2 - R_MAX * R_MAX)).toBeLessThanOrEqual(0.01)
    for (let i = 0; i < RING - 1; i++) expect(nz(vert(2 * i + 1))).toEqual(nz(vert(2 * i + 2)))
    // …but the NEW discriminants reject it loud: zero segment length, and an angular sweep nowhere near 2π.
    let totalSweep = 0, maxLen = 0
    for (let i = 0; i < RING; i++) {
      const a = vert(2 * i), b = vert(2 * i + 1)
      maxLen = Math.max(maxLen, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
      let d = Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2]); d = Math.atan2(Math.sin(d), Math.cos(d))
      totalSweep += d
    }
    expect(maxLen).toBe(0)                                        // the "ring" is a single point — no segment has length
    expect(Math.abs(totalSweep - 2 * Math.PI)).toBeGreaterThan(1) // and it never approaches the real ring's 2π sweep
  })

  // The fan is pinned AT the ring AND has real area. The earlier form pinned apex/rim/within-wedge/edges, all of which
  // 32 degenerate [apex, e, e] triangles (both rim vertices coincident → zero area) silently satisfy. This adds the
  // three properties a zero-area collapse cannot fake: every triangle has NONZERO area, consecutive triangles
  // SHARE a rim vertex (a true fan), and the rim bearings sweep MONOTONICALLY across the full 2·FOV_HALF_RAD wedge.
  const triArea3 = (A: readonly number[], B: readonly number[], C: readonly number[]): number => {
    const ux = B[0]! - A[0]!, uy = B[1]! - A[1]!, uz = B[2]! - A[2]!
    const vx = C[0]! - A[0]!, vy = C[1]! - A[1]!, vz = C[2]! - A[2]!
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  }
  test('every drawn sector-fan vertex: apex at the sensor, rim AT R_MAX, edges ON the boundary rays — plus NONZERO area, shared rims, monotonic 2·FOV span', () => {
    const arr = fovSectorGeometry().getAttribute('position')!.array as Float32Array
    expect(arr.length / 3).toBe(96) // 32 fan triangles × 3 vertices — the whole drawn sector, none skipped
    const RAD2_WIN = 0.01
    const vert = (i: number): [number, number, number] => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
    for (let i = 0; i < 96; i++) {
      const [x, y, z] = vert(i)
      const d2 = x * x + y * y + z * z
      expect(drawnInFov([x, y, z]), `fan vertex ${i} inside the wedge`).toBe(true)
      expect(nz1(y), `fan vertex ${i} on the ground plane`).toBe(0)
      if (i % 3 === 0) {
        // The fan APEX vertex (each triangle is [apex, rim, rim]) — the sensor origin.
        expect(d2, `fan apex vertex ${i} at the sensor`).toBe(0)
      } else {
        // A rim (arc) vertex — AT R_MAX, |d² − R_MAX²| within the window (rejects the half-radius fan).
        expect(Math.abs(d2 - R_MAX * R_MAX), `fan rim vertex ${i} AT R_MAX`).toBeLessThanOrEqual(RAD2_WIN)
      }
    }
    // NONZERO area per triangle + consecutive triangles SHARE a rim vertex (the fan structure). A degenerate
    // [apex, e, e] fan collapses each area to 0; this rejects it loud.
    for (let t = 0; t < 32; t++) {
      expect(triArea3(vert(3 * t), vert(3 * t + 1), vert(3 * t + 2)), `fan triangle ${t} nonzero area`).toBeGreaterThan(1)
      if (t < 31) expect(nz(vert(3 * t + 2)), `fan triangle ${t}→${t + 1} shares a rim vertex`).toEqual(nz(vert(3 * (t + 1) + 1)))
    }
    // The rim bearings (ground-plane atan2(x, z), wedge axis +z) sweep MONOTONICALLY across the full
    // 2·FOV_HALF_RAD: p_0 is triangle 0's rim1 (vertex 1), then each triangle contributes its rim2 (vertex 3t+2).
    const rimBearing = (i: number): number => Math.atan2(vert(i)[0], vert(i)[2])
    const bearings = [rimBearing(1), ...Array.from({ length: 32 }, (_, t) => rimBearing(3 * t + 2))]
    for (let k = 1; k < bearings.length; k++) expect(bearings[k]!, `rim bearing ${k} monotonic`).toBeGreaterThan(bearings[k - 1]!)
    expect(bearings.at(-1)! - bearings[0]!, 'rim sweep spans the full 2·FOV_HALF_RAD wedge').toBeCloseTo(2 * FOV_HALF_RAD, 2)
    // The two extreme rim columns ARE the boundary-ray terminals (apex + R_MAX·fovEdgeThree) the cone outline
    // draws — the SAME points, so the fan cannot drift off the wedge edges.
    const edgeArr = coneEdgesGeometry().getAttribute('position')!.array as Float32Array
    const base = edgeArr.length - 12 // [apex, edge(−1), apex, edge(+1)]
    const minusEdge: [number, number, number] = [edgeArr[base + 3]!, edgeArr[base + 4]!, edgeArr[base + 5]!]
    const plusEdge: [number, number, number] = [edgeArr[base + 9]!, edgeArr[base + 10]!, edgeArr[base + 11]!]
    expect(nz(vert(1)), 'first fan rim column === the −FOV_HALF_RAD boundary-ray terminal').toEqual(nz(minusEdge))
    expect(nz(vert(95)), 'last fan rim column === the +FOV_HALF_RAD boundary-ray terminal').toEqual(nz(plusEdge))
  })

  test('PREMISE: a fan of 32 degenerate [apex, e, e] triangles FAILS nonzero-area + intra-triangle bearing advance', () => {
    // Build a zero-area fan explicitly: each triangle is [apex, p_t, p_t] — its two rim vertices COINCIDE. It sits
    // at R_MAX inside the wedge (passes the point-wise checks) but every triangle has zero area and no rim advance.
    const rim = (t: number): [number, number, number] => {
      const bearing = -FOV_HALF_RAD + (2 * FOV_HALF_RAD) * (t / 32)
      return nedToThree([R_MAX * Math.cos(bearing), R_MAX * Math.sin(bearing), 0])
    }
    const arr = new Float32Array(96 * 3)
    for (let t = 0; t < 32; t++) { const r = rim(t); arr.set(SENSOR_THREE, 9 * t); arr.set(r, 9 * t + 3); arr.set(r, 9 * t + 6) }
    const vert = (i: number): [number, number, number] => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
    let maxArea = 0
    for (let t = 0; t < 32; t++) maxArea = Math.max(maxArea, triArea3(vert(3 * t), vert(3 * t + 1), vert(3 * t + 2)))
    expect(maxArea).toBe(0) // every triangle is degenerate — the new nonzero-area assertion rejects it
    // rim2 − rim1 within each triangle is zero, so no triangle advances the bearing — the monotone sweep is absent.
    for (let t = 0; t < 32; t++) {
      expect(Math.atan2(vert(3 * t + 2)[0], vert(3 * t + 2)[2]) - Math.atan2(vert(3 * t + 1)[0], vert(3 * t + 1)[2])).toBe(0)
    }
  })

  test('BASIS DISCRIMINANT ON THE DATA: the same fan construction under swapped horizontal NED components fails the wedge', () => {
    // Premise-first, at the buffer level: rebuild the IDENTICAL sector construction with the two horizontal
    // NED components swapped (the x↔z mirror the predicate-space discriminant above models) and quantize it
    // exactly as the mesh buffer would. The true buffer passes the wedge test above vertex-for-vertex; the
    // mirrored buffer must FAIL it — proof the oracle is bound to the vertex DATA, so mutating the geometry
    // construction itself (not just the shared conversion) trips the oracle.
    const mirrored = new Float32Array(fovSectorPositions(p => nedToThree([p[1]!, p[0]!, p[2]!])))
    let fails = 0
    for (let i = 0; i < mirrored.length; i += 3) {
      if (!drawnInFov([mirrored[i]!, mirrored[i + 1]!, mirrored[i + 2]!])) fails++
    }
    expect(fails).toBeGreaterThan(0) // the mirrored wedge opens about +x — most of its fan leaves the drawn wedge
  })

  test('the drawn trail vertices ARE the oracle inputs: trail buffer[frame] === fround(nedToThree(decoded g))', () => {
    // buildTrail lays vertex f from state frame f via entityPosition — the mutating twin of nedToThree. The
    // oracle sweep above feeds the predicates nedToThree(g) (f64); the drawn line stores Float32. Binding
    // the two per component (fround identity; buildTrail collapses −0 to +0 on store, hence nz) proves the
    // drawn line and the oracle's inputs are the SAME points — not two derivations that happen to agree.
    const trail = buildTrail(model)
    expect(trail.count).toBe(model.tickCount + 1)
    let bound = 0
    for (let t = 0; t < model.tickCount; t++) {
      const d = stage.byTick[t]
      if (!d || !d.g) continue
      const f = Math.min(t + TARGET_FRAME_OFFSET, model.tickCount) // the evaluated frame g was read from
      const h = nedToThree(d.g)
      for (let k = 0; k < 3; k++) {
        expect(nz1(trail.positions[f * 3 + k]!), `trail[${f}][${k}] @tick ${t}`).toBe(nz1(Math.fround(h[k]!)))
      }
      bound++
    }
    expect(bound).toBe(96) // every kind-22 tick's evaluated pose bound to its drawn vertex
    // The boundary-pin ticks (t55 wedge edge, t67 tangency, t82 ring) ride integer-lattice poses — bind them
    // explicitly so the pinned beats stay visibly covered even if the sweep's shape ever changes.
    for (const t of [55, 67, 82]) {
      const f = t + TARGET_FRAME_OFFSET
      const h = nedToThree(stage.byTick[t]!.g!)
      expect(nz([trail.positions[f * 3]!, trail.positions[f * 3 + 1]!, trail.positions[f * 3 + 2]!]))
        .toEqual(nz([Math.fround(h[0]!), Math.fround(h[1]!), Math.fround(h[2]!)]))
    }
  })
})
