import * as THREE from 'three'

// ── THE ORIENTED DRONE DELTA — a flat arrowhead planform, nose along the decoded heading ─────────────────
// The shared silhouette for the interactive entity (Scene.Entities) and the f2a sensing head
// (sensingStageView). It REPLACES the axially-symmetric apex-up cone that WASTED the decoded heading: the app
// already rotated the cone by the heading, but a cone is symmetric about the yaw axis, so the rotation was
// invisible. The delta makes that already-decoded heading legible — it reads as "a drone that points where it
// is going" at the app's camera distances, is one cheap BufferGeometry shared across the InstancedMesh (ONE
// draw call for all N), and is CVD-safe by construction (shape = class, no hue channel).
//
// HONESTY — YAW ONLY. The delta lies flat in the deck plane (local x–z) and is rotated ONLY about the vertical
// axis: makeRotationY(headingRad) at the render site. NO pitch, NO bank/roll — the bundle carries no attitude
// field, so tilting the mesh would invent data it never recorded. Altitude lives in the trail, never in the
// mesh. A shallow raised centreline spine (+y) is the ONE presentational body cue (it catches the key light so
// the form reads as a body from the oblique camera); it encodes no data.
//
// THE ROTATION CONVENTION (derived from decoded motion — droneDelta.test.ts pins it). The nose rests on local
// +Z. At heading 0 the decoded velocity is world +Z (nedToThree of due-north motion) and makeRotationY(0) is
// identity, so the nose must rest on +Z. For a general heading the decoded velocity in three-space is
// (sin h, cos h) — vel_NED = speed·(cos h, sin h), mapped through nedToThree's [e,−d,n] basis — and
// makeRotationY(h)·(+Z) = (sin h, cos h) exactly. So the render site rotates by +headingRad (NOT −headingRad,
// the sign the symmetric cone hid: it would point the nose at the MIRROR (−sin h, cos h), against the motion).
// The nose-leads-motion pin proves the alignment over f1's real straight decoded segment at a NON-ZERO heading
// — the discriminating witness a zero-heading run (f2a flies due north the whole run) could never catch.

// Delta proportions as fractions of the marker bounding radius r. The wingtips sit at hypot(0.6, 0.8)·r = r,
// so the bounding radius (the farthest planform vertex from the local origin, in the deck plane — the extent
// the camera fit binds) is EXACTLY r. The rear notch (centre, forward of the wingtips) cuts the chevron
// concavity that reads the arrowhead as a delta rather than a plain triangle; the spine apex is the raised
// centreline body cue. Exported so the extent oracle derives r from the geometry, never a hand-copied literal.
export const DELTA_NOSE_Z = 1.0
export const DELTA_WING_HALFWIDTH = 0.6
export const DELTA_WING_Z = -0.8
export const DELTA_NOTCH_Z = -0.4
export const DELTA_SPINE_Y = 0.42
export const DELTA_SPINE_Z = 0.08

// Build the shared delta BufferGeometry at bounding radius `r`. Pure JS (no WebGL — the tintedTrailGeometry
// precedent), so a unit test binds the ACTUAL vertex buffer. Built ONCE per surface (module const for the
// InstancedMesh entity; a mount-time useMemo for the f2a head) and shared across all instances.
//   Vertices: 0 nose · 1 tail-left · 2 tail-right · 3 rear notch · 4 raised spine apex (5 verts, 6 tris — the
// cheapest legible delta). The flat arrowhead underside plus four faces lifting the edges to the centreline
// apex form the raised body; computeVertexNormals lights it under the entity's standard material (the head's
// basic material is unlit — the spine still gives silhouette depth from the oblique camera).
export function deltaGeometry(r: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const p = new Float32Array([
    0, 0, DELTA_NOSE_Z * r,                              // 0 nose
    -DELTA_WING_HALFWIDTH * r, 0, DELTA_WING_Z * r,      // 1 tail-left wingtip
    DELTA_WING_HALFWIDTH * r, 0, DELTA_WING_Z * r,       // 2 tail-right wingtip
    0, 0, DELTA_NOTCH_Z * r,                             // 3 rear notch (chevron concavity)
    0, DELTA_SPINE_Y * r, DELTA_SPINE_Z * r,             // 4 spine apex (raised centreline body)
  ])
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setIndex([
    // flat arrowhead underside
    0, 3, 1,
    0, 2, 3,
    // the raised spine — nose / wingtips / notch lifted to the centreline apex
    0, 1, 4,
    0, 4, 2,
    1, 3, 4,
    2, 4, 3,
  ])
  g.computeVertexNormals()
  return g
}

// The delta's bounding radius, computed from the ACTUAL geometry buffer (max planform vertex distance from the
// local origin in the deck plane) — the drift-twin the camera fit and the crop oracle bind so the marker's
// declared visual extent can never drift from the drawn shape. By construction this equals the `r` passed in.
export function deltaBoundingRadius(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  let max = 0
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const d = Math.hypot(x, z)
    if (d > max) max = d
  }
  return max
}
