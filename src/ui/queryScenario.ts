// ── The pinned e0 scenario — a deliberately ZERO-IMPORT module (excerpt §1 kinds + §2 geometry) ─────────
// This module imports NOTHING and must stay that way (checked by the SCAN-COVERAGE pin in
// showMath.test.ts): it is the ONLY runtime dependency of the Show-the-Math verification surface
// (showMath.ts), which makes the no-transcendental source scan's closure claim — "the scanned files ARE
// the runtime closure" — true by construction. queryStage.ts re-exports everything here verbatim, so
// model-layer consumers keep their import path; showMath imports from HERE so its value-import closure
// never pulls in queryStage's runtime import of ./camera (whose framing math carries SANCTIONED trig —
// the constitution bans BEARING recomputation on the verification surface, not trig in general).

export type Vec3 = readonly [number, number, number]

// Query sub-kinds (excerpt §1). These live inside every kind-23 payload's `query_kind` field.
export const QUERY_KIND = { POINT_IN_REGION: 1, RANGE_BEARING: 2, RAY_OCCLUDER: 3, LOS: 4 } as const

// ── Scenario geometry (excerpt §2 — NORMATIVE constants, NOT bundle content) ───────────────────────────
// These are SCENARIO input (content-addressed, not state — spec-3b:932). The observer is deliberately
// absent: it is per-seed and lives in each event's argv (excerpt §3) — a renderer reads it from the event,
// never from a constant. The seed-42 drawn observer happens to be (-601.0688172251292, -37.78292521222363,
// 0), but that is data, not scenario, and is surfaced through queryDraw's o/g fields.
export const SPHERE = { center: [256, 0, 0] as Vec3, radius: 65, r2: 4225 } as const
export const BOX = { min: [384, -160, -64] as Vec3, max: [448, -96, 64] as Vec3 } as const
// Occluder 3 is a bounded TRIANGLE facet in the plane n=640 — NEVER a plane/slab. Rays passing outside the
// triangle at n=640 legitimately MISS (excerpt §2, D-017). Render the bounded facet.
export const TRIANGLE = { a: [640, -64, -64] as Vec3, b: [640, 64, -64] as Vec3, c: [640, 0, 64] as Vec3 } as const
