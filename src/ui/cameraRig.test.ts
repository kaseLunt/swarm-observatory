import { describe, expect, test } from 'vitest'
import { frameFor, isFiniteFraming, type Bounds, type Framing } from './camera'
import { loadFraming, STAGE_FRAME_OPTS, SENSING_STAGE_FRAME_OPTS, SENSING_REST_ELEVATION_DEG, LOAD_FRAME_OPTS } from './cameraRig'

// The shared load / tour-start framing decision. Scene threads ONE activeStageBounds (the query core
// theatre for e0, the sensing scope for f2a, null otherwise) into BOTH CameraRig's load write and Entities'
// tour-start reset via this helper, so step 0 opens byte-identically on the load frame. The earlier bug: the
// tour-start reset consumed the QUERY stageBounds only (null for f2a), cutting f2a's tour start to plain
// trajectory bounds. Pinning the helper pins that a present stageBounds wins over the trail bounds.
describe('loadFraming (shared load/tour-start framing)', () => {
  const sensing: Bounds = { center: [48, 0, 21], radius: 130 } // f2a-shaped: the sensing scope, hundreds of units across
  const trail: Bounds = { center: [0, 0, 20], radius: 95 }      // the plain trajectory bounds the earlier f2a tour start cut to

  test('a non-null stageBounds (f2a sensing scope / e0 query theatre) frames the STAGE uncapped', () => {
    expect(loadFraming(sensing, trail)).toEqual(frameFor(sensing, STAGE_FRAME_OPTS))
  })

  test('the sensing bounds, NOT the trail bounds, drive the frame when stageBounds is present (the regression)', () => {
    // If the tour-start reset fell back to the trail bounds (the earlier f2a bug) it would frame
    // frameFor(trail, LOAD_FRAME_OPTS) — a materially different shot. Pin that the stage bounds win.
    expect(loadFraming(sensing, trail)).not.toEqual(frameFor(trail, LOAD_FRAME_OPTS))
  })

  test('null stageBounds → the capped composed load vantage over the trail bounds (f0/f1/f4 unchanged)', () => {
    expect(loadFraming(null, trail)).toEqual(frameFor(trail, LOAD_FRAME_OPTS))
  })

  test('a NaN-radius stage bounds falls back to the composed default (finite guard — a poisoned bundle still loads legibly)', () => {
    const f = loadFraming({ center: [0, 0, 0], radius: NaN }, trail)
    expect(isFiniteFraming(f)).toBe(true)
    expect(f).toEqual(frameFor(null, LOAD_FRAME_OPTS))
  })

  // The sensing stage's RAISED resting vantage. The default STAGE fit rests ~22.6° above the deck, where the
  // sensing ground-plane apparatus (FOV wedge / range ring / occluder) self-occludes; SENSING_STAGE_FRAME_OPTS lifts
  // it to SENSING_REST_ELEVATION_DEG so the geometry separates. The stageOpts param scopes it: e0 keeps STAGE_FRAME_OPTS.
  const elevationOf = (f: Framing): number => {
    const dy = f.position[1] - f.target[1]
    const d = Math.hypot(f.position[0] - f.target[0], dy, f.position[2] - f.target[2])
    return (Math.asin(dy / d) * 180) / Math.PI
  }

  test('SENSING_STAGE_FRAME_OPTS is the shared STAGE fit plus the sensing elevation (35°)', () => {
    expect(SENSING_REST_ELEVATION_DEG).toBe(35)
    expect(SENSING_STAGE_FRAME_OPTS).toEqual({ ...STAGE_FRAME_OPTS, elevationDeg: SENSING_REST_ELEVATION_DEG })
  })

  test('loadFraming with the sensing opts frames the scope at ~35°, vs the ~22.6° house angle the default STAGE opts (e0) keep', () => {
    expect(elevationOf(loadFraming(sensing, trail, SENSING_STAGE_FRAME_OPTS))).toBeCloseTo(SENSING_REST_ELEVATION_DEG)
    expect(elevationOf(loadFraming(sensing, trail))).toBeCloseTo(22.588, 2) // default stageOpts = STAGE_FRAME_OPTS → unchanged (e0)
  })

  test('the raised load/rest frame equals frameFor(scope, SENSING_STAGE_FRAME_OPTS) — the bookend (f2a b5) lands on it by construction', () => {
    // The load write, the tour-start reset and the 'stage' bookend all call frameFor(sensingScope, SENSING_STAGE_FRAME_OPTS):
    // equal by construction, so raising the resting vantage keeps the tour-camera.spec bookend parity (camB5 ≈ stageVantage).
    expect(loadFraming(sensing, trail, SENSING_STAGE_FRAME_OPTS)).toEqual(frameFor(sensing, SENSING_STAGE_FRAME_OPTS))
    expect(loadFraming(sensing, trail, SENSING_STAGE_FRAME_OPTS)).not.toEqual(loadFraming(sensing, trail)) // raised ≠ the house vantage
  })
})
