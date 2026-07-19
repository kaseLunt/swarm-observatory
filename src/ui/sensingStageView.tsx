import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useViewStore } from '../state/viewStore'
import { PALETTE, CATEGORY, hexToThree } from './theme'
import type { Trail } from './trail'
import { TARGET_FRAME_OFFSET, evaluatedFrame, type SensingStageData, type SensingDraw } from './sensingStage'
import { resolveCursorInto, eventTickOf, type FrameCursor } from './cursor'
import type { EventTick, StateFrame, TransportTick } from '../lib/brand'
import {
  SENSOR_O, R_MAX, FOV_HALF_RAD, OCCLUDER_C, OCCLUDER_R2,
} from './sensingScenario'
import { nedToThree } from './placement'
import { deltaGeometry } from './droneDelta'

// The sensing head's frame-loop cursor: reused every fraction-rate write (the load budget). lerpHeadPosition runs
// synchronously to completion, so a single module-scope cursor is reentrancy-safe.
const headCursor: FrameCursor = { t0: 0 as StateFrame, t1: 0 as StateFrame }

// ── The Sensing Gauntlet stage — f2a's stage voice ────────────────────────────────────────
// The instrument voice is the four-gate strip (Inspector); THIS is the drama on the 3D stage (LAW 3). It
// stages the sensor apparatus at the origin, its FOV cone and range ring, the occluder sphere Q, and the
// drone's flight as an ELIGIBLE-TINTED TRAIL: the recorded path, each vertex tinted by the decoded eligibility
// verdict the engine EVALUATED AGAINST that pose (byFrame — a tick-k verdict is decided against state frame
// k+1's pos, so the tint indexes by frame, landing on the exact pose the sensor decided about, not one step
// behind it) — affirm where the sensor admits the drone, ember where it does not. A viewer can SAY WHAT THEY
// SAW: the drone glows green inside the cone-and-clear, and dims to ember as it leaves range / FOV.
//
// ECHO GRAMMAR (constitution §4): the whole recorded path is drawn ONCE as a dim, hollow NOT-YET outline —
// the future, present but unwritten. The eligible-tinted bright line fills in over it as the playhead
// advances (a drawRange reveal), and the drone's live pose rides the head in the NOW voice. Nothing beyond
// the frontier ever blooms; it is the quiet outline until the playhead writes it.
//
// SCENARIO CONSTANTS (honesty chip / the ledger): the sensor pose, FOV cone, range ring and occluder are
// SCENARIO CONSTANTS, not decoded state — they wear the quiet steel the query stage's region bodies wear.
// Trig is fine HERE (the cone tessellation) — this is presentational geometry in the VIEW, not the recompute
// surface; the constitution bans BEARING recomputation on the verification surface (sensingMath), not trig
// in general.
//
// PERF: the eligible-tinted trail and the NOT-YET outline are STATIC geometry (positions + vertex
// colours baked once at load); a tick reveals a longer prefix via a single setDrawRange write — O(1) per
// tick, zero per-frame allocation, no useFrame (an event-rate store subscription). f2a is a fixed 96-tick
// scene, so even the O(revealed) detection/head updates are trivially bounded. ONE exception:
// the head's POSITION follows the store fraction — a fraction-rate subscription write (frame-
// rate during play, silent while paused), one zero-alloc lerp, so the head rides the same continuous
// curve Entities' interactive delta does. Reveal / tint / marks stay per-tick.

// NED (n,e,d) → three [x=east, y=up=−down, z=north] — the ONE app-wide basis-A conversion (placement.nedToThree),
// the SAME transform the flight trail (entityPosition), the interactive drone delta (Scene.Entities) and the
// tour-camera anchors (Scene.SENSOR_THREE/OCCLUDER_THREE) draw through. The apparatus (FOV cone, range ring,
// sensor, occluder, detection marks) MUST share it: the basis-drift defect was this file drifting to a private, MIRRORED
// [n,−d,e] basis (x↔z), so the FOV cone opened +x perpendicular to the +z flight it judged — a drone dead-centre
// of the drawn cone read "outside FOV". `t3` is now a bound alias of the shared function (one definition, so the
// apparatus and the flight can never fall into two bases again); the old comment's claim to "mirror
// queryStageView.t3" was the defect — that stage is basis B, self-contained, and must NOT be mirrored here.
const t3 = nedToThree

// Colour vocabulary — TOKENS ONLY (LAW 2). Derived once at module scope.
const AFFIRM = new THREE.Color(hexToThree(PALETTE.verdictAffirm)) // eligible = admitted
const NEGATE = new THREE.Color(hexToThree(PALETTE.verdictNegate)) // ineligible = rejected
const STEEL = new THREE.Color(hexToThree(CATEGORY.query.hue))     // ambient scenario geometry (constants)
const DIM = new THREE.Color(hexToThree(PALETTE.textDim))          // the NOT-YET hollow outline / apparatus

// The drone's live-pose marker BOUNDING RADIUS — now the oriented drone delta (droneDelta.ts), not the former
// apex-up cone. EXPORTED (v0.7 fixwave): Scene threads it into the authored 'conjunction' shot so the fit
// bounds the marker's VISUAL extent, not just its centre — a narrow-aspect frame no longer crops the marker's
// rightmost vertex off-screen. The delta below is built at this radius, and deltaBoundingRadius(HEAD_DELTA_GEO)
// re-derives EXACTLY this value from the drawn buffer (the drift-twin the crop oracle binds), so the declared
// extent can never drift from the drawn shape. Value unchanged from the cone era, so every conjunction fit is
// byte-stable — only the shape under the radius changed (cone → flat delta).
export const HEAD_R = 7
// The head delta silhouette, built ONCE at module load (shared across the fixed f2a scene's single head mesh —
// mounted via <primitive>, so it is app-owned, never r3f-disposed). It lies FLAT in the deck plane and is
// yawed by the decoded heading at the render site (makeRotationY(heading) — see the head mesh below); the
// bundle carries no attitude, so no pitch/roll is ever applied. Replaces the former coneGeometry
// [HEAD_R, HEAD_CONE_H, 4] (a squat apex-up pyramid that WASTED the heading — a cone is yaw-symmetric).
export const HEAD_DELTA_GEO = deltaGeometry(HEAD_R)
// The sensor apparatus (octahedron) radius. EXPORTED alongside HEAD_R for the same conjunction fit. A named
// const so the octahedron geometry and the camera fit share ONE value (was an inline literal 9).
export const SENSOR_MARKER_R = 9
// ── Detection marks — the design-ruling fix (the detection pile that out-bloomed the eclipse and bookend) ─────
// SHRINK: r 5 → 2. At 5 the 17 kind-1 marks (the drone steps 2m/tick) fused into one glowing capsule; at 2
// they read as a countable BEAD-CHAIN of contacts — which is what they ARE, decoded measurements. The radius
// was the only thing lying (count + positions are decoded-true). GRADE: the LATEST revealed mark is the live
// detection at full affirm (one contact, coincident with the head's own bloom); every earlier mark recedes to
// the sub-bloom MARK_SPENT register — the e0 contact-grammar precedent (CONTACT_DIM: identity kept, hierarchy
// ceded below the bloom threshold) — so the persisted trail is SUPPORTING evidence, never additive-stacked into
// a second bloom. MARK_DIM 0.5 lands MARK_SPENT at the SAME sub-bloom luminance the ratified e0 dimmed
// constellation sits at (verdictAffirm ×0.5 ≈ 0.357 < BLOOM_LUMINANCE_THRESHOLD 0.4). Exported so the bloom-
// threshold test binds the renderer's ACTUAL colours (MARK_LIVE clears the cutoff; MARK_SPENT sits below it).
export const MARK_R = 2
export const MARK_DIM = 0.5
export const MARK_LIVE = new THREE.Color(hexToThree(PALETTE.verdictAffirm))                       // live detection — full affirm, blooms
export const MARK_SPENT = new THREE.Color(hexToThree(PALETTE.verdictAffirm)).multiplyScalar(MARK_DIM) // persisted contacts — sub-bloom
const OCC_R = Math.sqrt(OCCLUDER_R2) // √41 ≈ 6.403 — the occluder's real radius (r² is the pinned form)

// Build a flat FOV sector (ground plane) as a triangle fan from the sensor apex out to the range arc,
// spanning ±FOV_HALF_RAD around due-North. north = R·cos(bearing), east = R·sin(bearing). Presentational
// geometry (drawn, never decided): the tessellation trig is fine on the VIEW surface.
//
// The vertex-array builders are EXPORTED, pure, and parameterized on the NED→three conversion (defaulting
// to the shared t3): the rendered-space oracle must bind the ACTUAL vertex data the meshes draw — an inline
// construction drift (say, a swapped cos/sin mirroring the drawn cone) would leave the exported predicates
// green, so binding the conversion alone is not enough. The parameter exists so the oracle can rebuild the
// SAME construction under a deliberately swapped basis and prove the drawn buffer discriminates the bases;
// production callers never pass it, so the drawn geometry stays bound to the one shared basis-A conversion.
type NedToThree = (p: readonly [number, number, number]) => [number, number, number]
export function fovSectorPositions(convert: NedToThree = t3): number[] {
  const N = 32
  const pos: number[] = []
  const apex = convert(SENSOR_O)
  let prev: [number, number, number] | null = null
  for (let i = 0; i <= N; i++) {
    const bearing = -FOV_HALF_RAD + (2 * FOV_HALF_RAD) * (i / N)
    const p = convert([R_MAX * Math.cos(bearing), R_MAX * Math.sin(bearing), 0])
    if (prev) { pos.push(...apex, ...prev, ...p) }
    prev = p
  }
  return pos
}
// Exported (with coneEdgesGeometry below) so the oracle reads the very Float32 buffer the mesh mounts —
// BufferGeometry is pure JS (the tintedTrailGeometry precedent), so this runs in the node test env.
export function fovSectorGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fovSectorPositions()), 3))
  g.computeVertexNormals()
  return g
}

// The range ring + the two FOV boundary rays, as one line-segment set (ground plane). The ring is the max
// range; the two rays are the FOV edges out to that range — together they read as "the sensor cone".
// The layout is load-bearing for the oracle: RING segment pairs first, then [apex, edge(−1), apex, edge(+1)]
// as the final four vertices — the boundary-ray terminals it pins live at the buffer's tail.
export function coneEdgePositions(convert: NedToThree = t3): number[] {
  const pts: number[] = []
  const RING = 96
  for (let i = 0; i < RING; i++) {
    const a0 = (2 * Math.PI * i) / RING, a1 = (2 * Math.PI * (i + 1)) / RING
    pts.push(...convert([R_MAX * Math.cos(a0), R_MAX * Math.sin(a0), 0]), ...convert([R_MAX * Math.cos(a1), R_MAX * Math.sin(a1), 0]))
  }
  const apex = convert(SENSOR_O)
  for (const s of [-1, 1]) {
    const edge = convert([R_MAX * Math.cos(s * FOV_HALF_RAD), R_MAX * Math.sin(s * FOV_HALF_RAD), 0])
    pts.push(...apex, ...edge)
  }
  return pts
}
export function coneEdgesGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coneEdgePositions()), 3))
  return g
}

// ── RENDERED-SPACE APPARATUS PREDICATES (the test class that would have caught the two-basis defect) ──
// These decide a three-space HEAD pose's relationship to the DRAWN cone / range ring / occluder, computed from
// the SAME `t3` (the ONE shared basis-A conversion) and the SAME scenario constants the geometry above is built
// from. A rendered-space oracle (sensingStageView.test) feeds them the head at its FLIGHT-basis three position
// (placement.nedToThree of the decoded pose — where the trail/head actually render) and asserts they reproduce
// the decoded in_fov / in_range / los_clear bits at EVERY tick. If the apparatus basis ever drifts from the
// flight basis again, the drawn membership stops matching the engine and the oracle fails loud — the codebase's
// "drift-twin" discipline (bind the renderer's ACTUAL projection, never a private re-derivation) generalized
// from radii to the basis. Pure; a head pose is already three-space.
const segMinDist2 = (
  a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number],
): number => {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
  const ab2 = abx * abx + aby * aby + abz * abz
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - a[0]) * abx + (c[1] - a[1]) * aby + (c[2] - a[2]) * abz) / ab2))
  const dx = c[0] - (a[0] + abx * t), dy = c[1] - (a[1] + aby * t), dz = c[2] - (a[2] + abz * t)
  return dx * dx + dy * dy + dz * dz
}
// The DRAWN sensor apex and occluder body — the same t3 projection of the scenario constants the octahedron /
// sphere / cone are placed by. Exported so the oracle binds these values, not a hand-copied literal, AND can
// prove they equal the tour-camera anchors (Scene's SENSOR_THREE / OCCLUDER_THREE, computed from the SAME
// shared conversion): after that basis-drift defect the apparatus and the anchors MUST agree.
export const SENSOR_THREE: [number, number, number] = t3(SENSOR_O)
export const OCCLUDER_THREE = { center: t3(OCCLUDER_C), r2: OCCLUDER_R2 } as const
// The drawn FOV boundary-ray direction at ±half-angle — exactly as coneEdgesGeometry lays the two edges.
export const fovEdgeThree = (side: 1 | -1): [number, number, number] =>
  t3([Math.cos(side * FOV_HALF_RAD), Math.sin(side * FOV_HALF_RAD), 0])
// Inside the drawn cone: the head's ground-plane bearing off the cone axis (+z, due-North in basis A) is within
// the drawn half-angle. The wedge is drawn symmetric about +z spanning ±FOV_HALF_RAD, so this is |bearing| ≤
// FOV_HALF_RAD; at the 3-4-5 pose (north 36, east 48) the bearing is atan2(48,36) === FOV_HALF_RAD exactly — ON
// the drawn edge, the closed boundary where the engine's in_fov flips true.
export const drawnInFov = (h: readonly [number, number, number]): boolean =>
  Math.abs(Math.atan2(h[0], h[2])) <= FOV_HALF_RAD
// Inside the drawn range ring (radius R_MAX): squared three-space distance from the drawn sensor ≤ R_MAX². t3 is
// an isometry, so this equals the engine's NED d² ≤ r²max (R_MAX² = 10404 = r²max). Closed boundary (≤).
export const drawnInRange = (h: readonly [number, number, number]): boolean => {
  const dx = h[0] - SENSOR_THREE[0], dy = h[1] - SENSOR_THREE[1], dz = h[2] - SENSOR_THREE[2]
  return dx * dx + dy * dy + dz * dz <= R_MAX * R_MAX
}
// Clear of the drawn occluder: the drawn sensor→head sightline stays STRICTLY outside the drawn sphere. The
// occluder is a CLOSED point set (D-017), so tangency (min-dist² === r²) counts as blocked — hence strict `>`.
export const drawnLosClear = (h: readonly [number, number, number]): boolean =>
  segMinDist2(SENSOR_THREE, h, OCCLUDER_THREE.center) > OCCLUDER_THREE.r2

// The eligible-tinted trail geometry: positions (three-space, from buildTrail — vertex i ↔ state frame i) +
// a per-vertex colour baked from the decoded eligibility of the verdict EVALUATED AGAINST that frame's pose
// (byFrame[i]: affirm / ember; the dim NOT-YET colour for a frame with no verdict — e.g. frame 0). Built once
// per model; a tick reveals a prefix via setDrawRange. Indexing by FRAME (not tick) is what lands each
// eligibility bit on the exact pose it was computed from — a tick-k verdict's g is state frame k+1's pos.
//
// BORN HIDDEN (§4): the geometry mounts at drawRange (0, 0) so the bright tinted line shows NOTHING until
// the first sync writes the revealed prefix. The default FULL drawRange would flash the whole future eligible/
// ineligible trail for one frame on mount / run-switch — a NOT-YET violation. Exported so a unit test can pin
// the born-hidden drawRange without a WebGL context (BufferGeometry is pure JS).
export function tintedTrailGeometry(trail: Trail, byFrame: readonly (SensingDraw | null)[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(trail.positions, 3))
  const colors = new Float32Array(trail.count * 3)
  for (let i = 0; i < trail.count; i++) {
    const d = byFrame[i] ?? null
    const c = d === null ? DIM : d.eligible ? AFFIRM : NEGATE
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.setDrawRange(0, 0) // born hidden — the layout-effect sync reveals the correct prefix pre-paint
  return g
}

// The head's FRACTIONAL pose — the SAME (t0, t1, fraction) sample Scene.Entities lerps
// the interactive delta with: t0 = the evaluated frame of the current tick (evaluatedFrame — the ONE
// tick→frame map), t1 = the next frame clamped to the terminal vertex, lerped by the store fraction. A
// pause does NOT clear the fraction (only setTick does), so a head snapped at the integer frame sat up to
// one 2-m step behind the mid-motion delta — the fractional half of the two-pose finding. The verdict TINT
// and the drawRange REVEAL stay integer-frame (a kind-22 verdict is a per-tick fact; it does not
// interpolate) — ONLY the pose follows the fraction. Pure (no WebGL), zero allocation: writes into the
// caller's vector (the view passes head.position directly). Exported for the bundle-level parity test.
export function lerpHeadPosition(out: THREE.Vector3, trail: Trail, tick: EventTick, fraction: number): void {
  // The head rides the SAME cursor Scene's interactive delta and ChainLinks resolve — resolveCursor is the ONE
  // home of the (t0, t1) offset/clamp shape (it composes evaluatedFrame). `tick` arrives ALREADY in the event
  // domain: every caller brands the plain store playhead at ITS OWN ingestion (eventTickOf), so this
  // wrapper never re-brands a bare number — a StateFrame (an already-offset frame) is now a compile error here,
  // which is what makes the double-application of TARGET_FRAME_OFFSET uncompilable. The terminal vertex is
  // branded StateFrame at this single lastFrame ingestion. Zero alloc: the module-scope headCursor scratch (the load budget).
  resolveCursorInto(headCursor, tick, TARGET_FRAME_OFFSET, (trail.count - 1) as StateFrame)
  const f0 = headCursor.t0, f1 = headCursor.t1
  const p = trail.positions
  out.set(
    p[f0 * 3]! + (p[f1 * 3]! - p[f0 * 3]!) * fraction,
    p[f0 * 3 + 1]! + (p[f1 * 3 + 1]! - p[f0 * 3 + 1]!) * fraction,
    p[f0 * 3 + 2]! + (p[f1 * 3 + 2]! - p[f0 * 3 + 2]!) * fraction,
  )
}

export function SensingStage({ trail, data }: { trail: Trail; data: SensingStageData }) {
  const marksRef = useRef<THREE.InstancedMesh>(null)
  // born hidden — zero the draw count the instant the mesh mounts so a run-switch never flashes ALL
  // detection contacts (stacked at the origin under their identity matrices) before the first tick sync
  // writes the correct revealed count.
  const initMarks = useCallback((m: THREE.InstancedMesh | null) => { marksRef.current = m; if (m) m.count = 0 }, [])
  const headRef = useRef<THREE.Mesh>(null)

  const fovGeo = useMemo(() => fovSectorGeometry(), [])
  const edgesGeo = useMemo(() => coneEdgesGeometry(), [])
  // The two polylines are THREE.Line objects built imperatively (R3F's <line> JSX collides with the SVG
  // intrinsic; trajectoryTrail.tsx sets the same precedent). They render via <primitive>; the tinted line's
  // drawRange is bumped per tick.
  const notYetLine = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(trail.positions, 3))
    const m = new THREE.LineBasicMaterial({ color: DIM, transparent: true, opacity: 0.16, toneMapped: false, fog: false, depthWrite: false })
    const l = new THREE.Line(g, m); l.renderOrder = 2; l.frustumCulled = false
    return l
  }, [trail])
  const tintedLine = useMemo(() => {
    const g = tintedTrailGeometry(trail, data.byFrame)
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false, fog: false, depthWrite: false })
    const l = new THREE.Line(g, m); l.renderOrder = 3; l.frustumCulled = false
    return l
  }, [trail, data.byFrame])
  useEffect(() => () => {
    fovGeo.dispose(); edgesGeo.dispose()
    notYetLine.geometry.dispose(); (notYetLine.material as THREE.Material).dispose()
    tintedLine.geometry.dispose(); (tintedLine.material as THREE.Material).dispose()
  }, [fovGeo, edgesGeo, notYetLine, tintedLine])

  // Detection marks sorted by tick, so a reveal is a prefix (setCount O(1) per tick).
  const marks = useMemo(() => [...data.detections].sort((a, b) => a.tick - b.tick), [data.detections])
  const markMats = useMemo(() => marks.map(m => new THREE.Matrix4().setPosition(...t3(m.pos))), [marks])

  // useLayoutEffect: the first sync runs PRE-PAINT (in the React commit, before R3F's next rAF render),
  // so the born-hidden geometry/head/marks are placed at their correct revealed prefix before anything is
  // drawn — no full-trail flash on mount / run-switch even in the worst case.
  useLayoutEffect(() => {
    const build = () => {
      const marksMesh = marksRef.current, head = headRef.current
      const { tick } = useViewStore.getState()
      // The sensing visuals index by the EVALUATED state frame: a tick-k verdict was decided against frame
      // k+1's pose (TARGET_FRAME_OFFSET), and trail vertex f is state frame f (buildTrail). So the head rides
      // the frame the current tick committed, and the reveal writes the prefix up to (and including) that
      // frame — the tint then lands on the exact pose the sensor decided about, and tick 95 reaches the
      // terminal frame 96 (the last vertex). Clamped so the terminal tick never indexes past the trajectory.
      const headFrame = evaluatedFrame(tick, TARGET_FRAME_OFFSET, trail.count - 1)
      const reveal = Math.max(0, Math.min(headFrame + 1, trail.count)) // frames 0..headFrame written

      // The eligible-tinted trail fills in over the NOT-YET outline (drawRange reveal — O(1)).
      tintedLine.geometry.setDrawRange(0, reveal)

      // The drone's live head wears the NOW voice, TINTED by the verdict the committed frame was evaluated
      // against (byFrame[headFrame] — this tick's decision, on the pose it decided on). The tint is integer-
      // frame by design (a verdict does not interpolate); the head's POSITION is written by place() below,
      // which follows the store fraction so the head and Entities' interactive delta never split mid-tick.
      if (head) {
        const d = data.byFrame[headFrame] ?? null
        ;(head.material as THREE.MeshBasicMaterial).color.copy(d === null ? DIM : d.eligible ? AFFIRM : NEGATE)
        // Orient the delta by the committed frame's decoded heading — YAW ONLY (rotation.y = makeRotationY(heading);
        // no pitch/roll, the bundle carries no attitude). The SAME +heading convention and per-tick (integer-frame)
        // heading the interactive delta uses (Scene reads a.headingRad at the evaluated frame), so the two never
        // split. The former head cone did not rotate at all — it was yaw-symmetric; the delta flies the heading the
        // trail already carries (trail.heading is vertex-aligned with the positions the head rides).
        head.rotation.y = trail.heading[headFrame] ?? 0
        head.visible = true // born hidden in JSX; shown once the first sync has placed + oriented + tinted it
      }

      // Detection marks materialise as the playhead reaches their tick (persist thereafter). GRADE (a design ruling):
      // the NEWEST revealed mark is the live detection at full affirm; every earlier mark recedes to the sub-
      // bloom MARK_SPENT register, so the persisted contacts read as a countable bead-chain and never a fused
      // blooming capsule. Per-instance colour (instanceColor); ≤17 marks, so this O(revealed) recolour is the
      // trivially-bounded work this fixed 96-tick scene already sanctions (the load-budget note above), and it is correct
      // across a scrub-back (n shrinks → the new newest re-brightens, the earlier marks stay spent).
      if (marksMesh) {
        let n = 0
        for (let i = 0; i < marks.length; i++) { if (marks[i]!.tick > tick) break; marksMesh.setMatrixAt(n, markMats[i]!); n++ }
        for (let i = 0; i < n; i++) marksMesh.setColorAt(i, i === n - 1 ? MARK_LIVE : MARK_SPENT)
        marksMesh.count = n
        marksMesh.instanceMatrix.needsUpdate = true
        if (marksMesh.instanceColor) marksMesh.instanceColor.needsUpdate = true
      }
    }
    // The head POSE follows the store fraction: the same evaluated (t0, t1, fraction)
    // lerp Entities renders the interactive delta with, so a mid-motion pause (fraction ≠ 0 — a pause never
    // clears it) shows ONE drone, not a delta up to a full 2-m step ahead of a tick-snapped head. This is a
    // fraction-RATE write (frame-rate during play, silent while paused — Timeline's draw loop is the only
    // fraction writer): one lerp into the head's own vector, zero allocation — the same load-budget class of work
    // Entities' per-frame delta lerp already does. Everything else in build() stays event-rate (per tick).
    const place = () => {
      const head = headRef.current
      if (!head) return
      // Ingestion: viewStore.tick is a plain TransportTick (a bare scrub coordinate); brand it into the
      // event domain HERE, at this surface's own store read, exactly as Scene/ChainLinks do — lerpHeadPosition
      // now demands an EventTick and applies TARGET_FRAME_OFFSET itself, so this is the ONE offset application.
      const vs = useViewStore.getState()
      lerpHeadPosition(head.position, trail, eventTickOf(vs.tick as TransportTick), vs.fraction)
    }
    build(); place()
    return useViewStore.subscribe((s, prev) => {
      if (s.tick !== prev.tick) build()
      if (s.tick !== prev.tick || s.fraction !== prev.fraction) place()
    })
  }, [trail, data, marks, markMats, tintedLine])

  return (
    <group>
      {/* Sensor apparatus at the origin — an aperture marker (◎). A scenario constant; quiet steel, never a
          verdict hue, never dressed as an agent. Mounted at the EXPORTED SENSOR_THREE (the same t3 anchor the
          drawn-space oracle + the tour camera bind), so the marker's transform is pinned, not an inline literal. */}
      <mesh position={SENSOR_THREE} renderOrder={2}>
        <octahedronGeometry args={[SENSOR_MARKER_R]} />
        <meshBasicMaterial color={hexToThree(CATEGORY.query.hue)} toneMapped={false} fog={false} wireframe />
      </mesh>

      {/* FOV cone (flat sector) — scenario constant, translucent steel, no data. */}
      <mesh geometry={fovGeo} renderOrder={1}>
        <meshBasicMaterial color={STEEL} side={THREE.DoubleSide} transparent opacity={0.09} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>
      {/* Range ring + FOV boundary rays — the cone's outline, brighter steel. */}
      <lineSegments geometry={edgesGeo} renderOrder={2}>
        <lineBasicMaterial color={STEEL} transparent opacity={0.5} toneMapped={false} fog={false} depthWrite={false} />
      </lineSegments>

      {/* Occluder sphere Q — a scenario constant (a quiet hollow body). Mounted at the EXPORTED
          OCCLUDER_THREE.center (the same t3 anchor the oracle binds), so its transform is pinned, not an inline literal. */}
      <mesh position={OCCLUDER_THREE.center} renderOrder={1}>
        <sphereGeometry args={[OCC_R, 20, 16]} />
        <meshBasicMaterial color={STEEL} wireframe transparent opacity={0.35} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>

      {/* THE NOT-YET OUTLINE — the whole recorded flight, drawn hollow and dim (constitution §4). The bright
          eligible-tinted line fills in over it as the playhead advances; nothing here blooms. */}
      <primitive object={notYetLine} />
      {/* THE ELIGIBLE-TINTED TRAIL (the stage voice) — the revealed prefix, per-vertex affirm/ember by the
          decoded eligibility boolean. vertexColors; a tick reveals a longer drawRange. */}
      <primitive object={tintedLine} />

      {/* Decoded detection marks (kind-1 meas, NED meters) — persistent contacts, revealed by tick. SHRINK +
          GRADE (a design ruling): a small radius (a countable bead-chain, not a fused capsule) and per-instance colour
          (instanceColor) so the live mark is full affirm and the spent trail is sub-bloom. Material colour is
          left at the default white — instanceColor carries the true hue. Born at count 0 (initMarks) so a mount
          never flashes every contact before the first sync. */}
      <instancedMesh ref={initMarks} args={[undefined, undefined, Math.max(1, marks.length)]} frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[MARK_R, 12, 10]} />
        <meshBasicMaterial toneMapped={false} fog={false} />
      </instancedMesh>

      {/* The drone's live pose — the NOW voice (▸ the vehicle), riding the evaluated frame lerped by the
          store fraction (the SAME continuous curve Entities' interactive delta renders) and tinted by the
          committed frame's eligibility verdict. The oriented drone delta (droneDelta.ts): a flat arrowhead
          yawed by the decoded heading (build() sets rotation.y = heading — YAW ONLY, no pitch/roll). The cone
          it replaces was yaw-symmetric so it never NEEDED to orient; the delta shows the heading the trail
          already flies. Born hidden (visible=false); the first layout-effect sync places + orients + tints +
          reveals it pre-paint, so no delta flashes at the origin on mount. The geometry is app-owned (module
          const via <primitive>), never r3f-disposed. */}
      <mesh ref={headRef} renderOrder={4} visible={false}>
        <primitive object={HEAD_DELTA_GEO} attach="geometry" dispose={null} />
        <meshBasicMaterial color={AFFIRM} toneMapped={false} fog={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
