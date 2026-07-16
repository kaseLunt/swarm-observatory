import { expect, test, type Page } from '@playwright/test'

// ── v0.7 T4: THE AUTHORED TOUR CAMERA — both tours played through, per-beat evidence ─────────────────────────
// The authored per-beat arrives ride the EXISTING trail-frame channel on intent 'tour-arrival' (no new camera
// owner). These specs play each tour beat-by-beat, capture a screenshot at every beat (the G6 before/after
// evidence — the AFTER frames; the .superpowers/sdd/task-v07-4-*.png set), and pin the headline behaviours the
// design consult ruled: the f1 cold-open front door now ENDS on the finale close-up (not the 340u "near-empty
// void"), and the f2a tour opens AND closes on the whole-instrument stage bookend with authored relationship
// shots between. Zero console errors on both. The exact per-shot math is unit-pinned (camera.test.ts
// shotFraming); these prove the wiring end-to-end in a real (ANGLE SwiftShader) browser.
//
// W4 (v0.7 T4 fixwave) HARDENING: every sampled beat now (a) GATES on the beat's destination TICK before it reads
// the camera/head, so a mid-flight pose is never measured; (b) asserts TWO-SIDED bounds around the authored
// distances (a lower bound rejects the legacy auto-follow ending ~18-23u off the head — which the old one-sided
// < 90 / < 60 accepted — and an upper bound rejects the 340u prefix void); (c) f2a beats 1-4 each carry a
// cam→head distance assertion (the conjunction / head destination class), not a screenshot alone. settle() now
// requires LIVE render frames between samples, so a stalled render is no longer accepted as "settled".
//
// Camera capture reuses the smoke suite's devtools-hook pattern (the app camera lives off the React fiber tree,
// so the DOM cannot witness it): wrap WebGLRenderer.render via __THREE_DEVTOOLS__ to latch scene+camera and count
// live frames, then project/read at will. Browser source travels as STRINGS — the e2e tsconfig (tsconfig.node.json)
// excludes the DOM lib, so an inline evaluate touching window/three would not typecheck.
const CAPTURE_SCENE = `(() => {
  const dt = new EventTarget()
  window.__THREE_DEVTOOLS__ = dt
  dt.addEventListener('observe', (e) => {
    const renderer = e.detail
    if (!renderer || typeof renderer.render !== 'function' || renderer.__wrapped) return
    renderer.__wrapped = true
    const orig = renderer.render.bind(renderer)
    renderer.render = (scene, camera) => {
      if (scene && scene.isScene && !window.__sceneLocked) {
        let hasCone = false
        scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'ConeGeometry') hasCone = true })
        if (hasCone) { window.__scene = scene; window.__camera = camera; window.__sceneLocked = true }
      }
      window.__frames = (window.__frames || 0) + 1 // W4: a live-render heartbeat settle() checks for stalls
      return orig(scene, camera)
    }
  })
})()`
// The latched camera position + the live-frame heartbeat, read together so settle() can tell a converged camera
// (frames advancing, position steady) from a STALLED render (frames frozen, position steady) — W4.
const CAMERA_SAMPLE = `(() => { const c = window.__camera; return { p: c ? [c.position.x, c.position.y, c.position.z] : null, f: window.__frames || 0 } })()`
// The subject cone's instance-0 world origin (the drone head) via the latched scene — the anchor the authored
// compose-around-head / conjunction shots frame. The radius<0.6 filter selects the INTERACTIVE cone (r=0.4), not
// the sensing-stage head marker (r=7) or the enlarged hit target (r=0.9). Returns null until the scene is latched.
const HEAD_POS = `(() => {
  const scene = window.__scene
  if (!scene) return null
  let cone = null
  scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'ConeGeometry' && o.geometry.parameters.radius < 0.6) cone = o })
  if (!cone) return null
  const Matrix4 = cone.matrix.constructor, Vector3 = scene.position.constructor
  const m = new Matrix4(); cone.getMatrixAt(0, m)
  const p = new Vector3().setFromMatrixPosition(m)
  return [p.x, p.y, p.z]
})()`

// Poll until the app camera has settled: two consecutive samples < EPS apart AND live render frames between them.
// The frame-liveness gate (W4) is what makes this NOT accept a stalled render — a freeze repeats the same camera
// position, which the pre-W4 settle() latched as "settled"; requiring cur.f > prev.f rejects that. A generous
// deadline THROWS on a real freeze or a camera that never converges (the pre-W4 code silently returned the stale
// sample). Mirrors the smoke suite's waitForCameraStable, plus the heartbeat.
async function settle(page: Page): Promise<[number, number, number]> {
  const EPS = 0.05
  const deadline = Date.now() + 8000
  const read = async (): Promise<{ p: [number, number, number] | null; f: number }> =>
    (await page.evaluate(CAMERA_SAMPLE)) as { p: [number, number, number] | null; f: number }
  let prev = await read()
  while (Date.now() < deadline) {
    await page.waitForTimeout(120)
    const cur = await read()
    if (prev.p && cur.p && cur.f > prev.f && Math.hypot(cur.p[0] - prev.p[0], cur.p[1] - prev.p[1], cur.p[2] - prev.p[2]) < EPS) return cur.p
    prev = cur
  }
  if (!prev.p) throw new Error('camera never latched')
  throw new Error('camera never settled within the deadline (stalled render, or a camera still in motion)')
}

// Gate on the beat's DESTINATION tick before sampling (W4): a play beat's flight takes ~WITNESS_SECONDS, so the
// caption appears (at step entry) well BEFORE the playhead reaches the target — reading the head/camera then would
// measure a mid-flight pose. The tick lives in the '.readout' TEXT for a det-tier run (f1: "tick X / 64") and in
// its TITLE for a real-sim-clock run (f2a shows "mm:ss / mm:ss", title "tick X / 95"), so read title || text.
async function waitForTick(page: Page, target: number): Promise<void> {
  await page.waitForFunction(
    `(() => { const el = document.querySelector('.readout'); if (!el) return false; const s = el.getAttribute('title') || el.textContent || ''; const m = /tick\\s+(\\d+)/.exec(s); return m ? parseInt(m[1], 10) >= ${target} : false })()`,
    undefined,
    { timeout: 30000 },
  )
}
const dist = (a: readonly [number, number, number], b: readonly [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test('f1 hero tour: authored arrives compose around the head; the front door ENDS on the finale close-up, not the void', async ({ page }) => {
  test.setTimeout(100_000) // the f1 tour's three beats (holds 5.8+7.1+5.0s) + witness flights + tick-gates + settle polls
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f1') // a deep link is not a cold open → no auto-tour; we drive it explicitly
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  // W2 NEGATIVE CONTROL — latch the PRE-TOUR (load-vantage) camera. Beat 0 is UN-AUTHORED (no arrive — the
  // protected hero frame), so its camera must NOT displace beyond noise from this vantage: an un-authored beat
  // requests no camera move (the opt-in contract). This is the complement to the per-beat MINIMUM DISPLACEMENT
  // asserts below — together they prove a measured beat move comes from an AUTHORED arrive, not incidental drift.
  const preTour = await settle(page)

  await page.getByRole('button', { name: '▶ tour', exact: true }).click()
  // Beat 0 — the PROTECTED hero frame (composed load vantage + a near-no-op focus at the origin). Screenshot it.
  await expect(page.locator('.tour-caption')).toContainText('A single drone with real recorded motion')
  const camB0 = await settle(page)
  expect(dist(camB0, preTour), `f1 b0 is un-authored → the camera must NOT displace (Δ=${dist(camB0, preTour).toFixed(2)}u)`).toBeLessThan(2)
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f1-beat0.png' })

  // Beat 1 — compose-around-head MEDIUM: the camera leaves the load vantage to sit ~medium off the mid-flight head.
  await expect(page.locator('.tour-caption')).toContainText('Playback advances the recorded trajectory', { timeout: 20000 })
  await waitForTick(page, 32) // W4: the beat's play destination — gate before sampling so the head is the ARRIVED pose
  const camB1 = await settle(page)
  const headB1 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f1-beat1.png' })
  // The medium compose sits the camera ~HEAD_MEDIUM_DISTANCE (50) off the head (finaleFraming → |cam−head| ≈ 50).
  // TWO-SIDED (W4): the lower bound rejects the legacy auto-follow ending ~18u off the head (the old one-sided < 90
  // accepted it); the upper rejects the ~168u prefix void. NOT a wide fit, NOT a follow speck.
  const dB1 = dist(camB1, headB1)
  expect(dB1, `f1 b1 composes ~medium (50u) around the head — two-sided (Δcam→head=${dB1.toFixed(0)}u)`).toBeGreaterThan(40)
  expect(dB1, `f1 b1 is not a wide fit (Δcam→head=${dB1.toFixed(0)}u)`).toBeLessThan(64)
  // W2 MINIMUM DISPLACEMENT: the arrive actually MOVED the camera off the beat-0 hero frame (a stale/un-applied
  // shot would leave it there → 0 displacement). Measured ~101u; the floor rejects a non-move with wide margin.
  const mvB1 = dist(camB1, camB0)
  expect(mvB1, `f1 b1's arrive moved the camera off the beat-0 hero frame (Δcam→cam=${mvB1.toFixed(0)}u)`).toBeGreaterThan(40)

  // Beat 2 — the terminal beat lands the FINALE CLOSE-UP framing (finaleFraming, ~distance 25 off the terminal
  // head) — the headline fix: the auto-played front door ends on the app's best frame, not the 340u prefix void.
  await expect(page.locator('.tour-caption')).toContainText('On through every commanded segment', { timeout: 20000 })
  await waitForTick(page, 64) // gate on the terminal tick before sampling
  const camB2 = await settle(page)
  const headB2 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f1-beat2.png' })
  // The finale close-up sits ~FINALE_DISTANCE (25) off the head. TWO-SIDED (W4): the lower bound rejects a
  // collapsed camera; the upper (~34) rejects the ~340u prefix void the pre-T4 front door ended on.
  const dB2 = dist(camB2, headB2)
  // W2 TIGHTENED terminal window: exclude the 18-23u legacy auto-follow close (the authored finale close-up is
  // FINALE_DISTANCE=25). The pre-W2 lower bound of 16 admitted that stale follow ending; 24 rejects it while the
  // measured value sits at ~25.1. Upper 32 (was 38) still rejects the ~340u prefix void with margin.
  expect(dB2, `f1 terminal is the finale close-up (~25u), not the 18-23u legacy follow — two-sided (Δcam→head=${dB2.toFixed(1)}u)`).toBeGreaterThan(24)
  expect(dB2, `f1 terminal is not the 340u void (Δcam→head=${dB2.toFixed(1)}u)`).toBeLessThan(32)
  // W2 MINIMUM DISPLACEMENT: the terminal arrive moved the camera off beat 1 (measured ~164u).
  const mvB2 = dist(camB2, camB1)
  expect(mvB2, `f1 b2's terminal arrive moved the camera off beat 1 (Δcam→cam=${mvB2.toFixed(0)}u)`).toBeGreaterThan(40)

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

test('f2a sensing tour: opens and closes on the stage bookend, with authored conjunction/head arrives between', async ({ page }) => {
  test.setTimeout(170_000) // the f2a tour's six beats total ~56s of holds + witness flights + tick-gates + per-beat settle polls
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  // W2 NEGATIVE CONTROL — the PRE-TOUR load-vantage camera. Beat 0 is UN-AUTHORED (no arrive — the FOCUS PAN is
  // dropped, only the tour-start reset frames the stage), so its camera must NOT displace beyond noise from here.
  // The complement to the per-beat MINIMUM DISPLACEMENT asserts below (a real arrive move vs incidental drift).
  const preTour = await settle(page)

  await page.getByRole('button', { name: '▶ tour', exact: true }).click()
  // Beat 0 — the whole-instrument STAGE fit (the tour-start reset frames the sensing scope; the focus pan is
  // dropped, so nothing moves during the inventory caption). Latch this vantage — beat 5 must return to it.
  await expect(page.locator('.tour-caption')).toContainText('A single drone in real recorded flight')
  const stageVantage = await settle(page)
  expect(dist(stageVantage, preTour), `f2a b0 is un-authored → the camera must NOT displace (Δ=${dist(stageVantage, preTour).toFixed(2)}u)`).toBeLessThan(2)
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat0.png' })

  // Beat 1 — CONJUNCTION (sensor + drone head): the camera cranes IN from the ~405u stage to the relationship shot
  // so the drone-to-cone-edge gap (the voice-split claim) is a visible fact. A scrub beat (tick 48 lands instantly).
  await expect(page.locator('.tour-caption')).toContainText('the drone is still OUTSIDE the field-of-view cone', { timeout: 20000 })
  await waitForTick(page, 48)
  const camB1 = await settle(page)
  const headB1 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat1.png' })
  expect(dist(camB1, stageVantage), `f2a b1 cranes in off the stage vantage (Δ=${dist(camB1, stageVantage).toFixed(0)}u)`).toBeGreaterThan(100)
  // The conjunction frames the sensor + the drone head (+ marker extents) — a relationship shot ~80-125u off the
  // head. TWO-SIDED (W4): the lower rejects the legacy follow-close ending; the upper rejects the ~405u stage / void.
  const dB1 = dist(camB1, headB1)
  expect(dB1, `f2a b1 is the conjunction relationship shot (Δcam→head=${dB1.toFixed(0)}u)`).toBeGreaterThan(50)
  expect(dB1, `f2a b1 is not the wide stage / void (Δcam→head=${dB1.toFixed(0)}u)`).toBeLessThan(170)

  // Beat 2 — the crossing (conjunction): play INTO the cone, then frame the relationship at the arrived tick.
  await expect(page.locator('.tour-caption')).toContainText('Watch it cross INTO the cone', { timeout: 20000 })
  await waitForTick(page, 56)
  const camB2 = await settle(page)
  const headB2 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat2.png' })
  const dB2 = dist(camB2, headB2)
  expect(dB2, `f2a b2 crossing is a conjunction shot (Δcam→head=${dB2.toFixed(0)}u)`).toBeGreaterThan(50)
  expect(dB2, `f2a b2 is not the wide stage / void (Δcam→head=${dB2.toFixed(0)}u)`).toBeLessThan(180)
  // W2 MINIMUM DISPLACEMENT: b2's arrive MOVED the camera off beat 1. This is the headline stale-frame guard —
  // beat 1's camera sits ~72u from beat 2's head, INSIDE the 50-180 window above, so a stale (un-applied) beat-1
  // frame would pass the cam→head bound but NOT this cam→cam move (measured ~19u; floor 8 rejects a non-move).
  const mvB2 = dist(camB2, camB1)
  expect(mvB2, `f2a b2's arrive moved the camera off beat 1 — a stale beat-1 frame would pass the window but not this (Δcam→cam=${mvB2.toFixed(0)}u)`).toBeGreaterThan(8)

  // Beat 3 — the eclipse (conjunction + occluder): the fit widens to seat Q on the sightline, so the shot sits
  // a little farther off the head than the bare conjunction.
  await expect(page.locator('.tour-caption')).toContainText('the occluder cuts the line of sight', { timeout: 20000 })
  await waitForTick(page, 67)
  const camB3 = await settle(page)
  const headB3 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat3.png' })
  const dB3 = dist(camB3, headB3)
  expect(dB3, `f2a b3 eclipse is a (wider) conjunction shot (Δcam→head=${dB3.toFixed(0)}u)`).toBeGreaterThan(50)
  expect(dB3, `f2a b3 is not the wide stage / void (Δcam→head=${dB3.toFixed(0)}u)`).toBeLessThan(210)
  // W2 MINIMUM DISPLACEMENT: b3's eclipse arrive MOVED the camera off beat 2 (beat 2's camera ~74.5u from beat 3's
  // head sits INSIDE the 50-210 window, so the cam→cam move is the real stale-frame guard; measured ~30u).
  const mvB3 = dist(camB3, camB2)
  expect(mvB3, `f2a b3's eclipse arrive moved the camera off beat 2 (Δcam→cam=${mvB3.toFixed(0)}u)`).toBeGreaterThan(12)

  // Beat 4 — the max-range tie (head MEDIUM): compose ~50u AROUND the head (the sensor 102u away need not be in
  // frame). TWO-SIDED around HEAD_MEDIUM_DISTANCE (50) — the head destination class, distinct from the conjunctions.
  await expect(page.locator('.tour-caption')).toContainText('the drone is admitted again', { timeout: 20000 })
  await waitForTick(page, 82)
  const camB4 = await settle(page)
  const headB4 = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat4.png' })
  const dB4 = dist(camB4, headB4)
  expect(dB4, `f2a b4 composes ~medium (50u) around the head (Δcam→head=${dB4.toFixed(0)}u)`).toBeGreaterThan(38)
  expect(dB4, `f2a b4 is the compose-around-head medium, not a wide shot (Δcam→head=${dB4.toFixed(0)}u)`).toBeLessThan(66)
  // W2 MINIMUM DISPLACEMENT: b4's head-medium arrive MOVED the camera off beat 3 (measured ~43u).
  const mvB4 = dist(camB4, camB3)
  expect(mvB4, `f2a b4's head-medium arrive moved the camera off beat 3 (Δcam→cam=${mvB4.toFixed(0)}u)`).toBeGreaterThan(15)

  // Beat 5 — THE BOOKEND: crane back to the whole-instrument stage (all 96 verdicts on the trail), landing on
  // the SAME canonical vantage free exploration starts from — rest-state parity by construction.
  await expect(page.locator('.tour-caption')).toContainText('Ninety-six sensing verdicts', { timeout: 20000 })
  await waitForTick(page, 95)
  const camB5 = await settle(page)
  await page.screenshot({ path: '.superpowers/sdd/task-v07-4-f2a-beat5.png' })
  expect(dist(camB5, stageVantage), `f2a b5 returns to the stage bookend (Δ=${dist(camB5, stageVantage).toFixed(1)}u)`).toBeLessThan(5)
  // W2 MINIMUM DISPLACEMENT: the crane-back to the stage MOVED the camera off the beat-4 head-medium (measured ~272u).
  const mvB5 = dist(camB5, camB4)
  expect(mvB5, `f2a b5's crane-back moved the camera off beat 4 (Δcam→cam=${mvB5.toFixed(0)}u)`).toBeGreaterThan(40)

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── v0.8 W7: THE e0 QUERY-STAGE TOUR — the three authored arrives (corridor / crane / stage bookend) ─────────
// e0 is POSITIONLESS (no drone cone to compose around), so this proves the arrives by the CAMERA MOVE alone —
// no HEAD_POS. The scene still latches (Entities mounts a count-0 cone InstancedMesh, so the CAPTURE_SCENE hook
// finds a ConeGeometry and locks __scene/__camera). The minimal beats-advance contract the design bench ruled:
// beats 0-1 hold the composed stage frame (un-authored → no displacement); beat 2 'corridor' cranes IN to the
// first block; beat 4 'crane' moves to the observer-crane vantage; beat 5 'stage' returns to the SAME bookend
// the load vantage sits on (rest-state parity). The exact per-shot math is unit-pinned (camera.test.ts
// shotFraming + queryScene.oracle.test.ts decode-true anchors); this proves the wiring end-to-end in ANGLE
// SwiftShader. The three AFTER frames are the browser evidence (.superpowers/sdd/task-v08-w7-e0-shot{1,2,3}.png).
test('e0 query-stage tour: corridor / crane / stage-bookend arrives each move the camera; beat 5 returns to the load bookend', async ({ page }) => {
  test.setTimeout(150_000) // e0's six beats (holds 7.7+11.1+10.4+8.9+8.8+8.4s ≈ 55s) + witness flights + tick-gates + settles
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0') // a deep link is not a cold open → no auto-tour; we drive it explicitly
  await expect(page.locator('.readout')).toContainText('tick 0 / 75', { timeout: 15000 })
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  // The PRE-TOUR load vantage — for e0 this IS the stage bookend (CameraRig frames the query core theatre on
  // load). Beat 0 is UN-AUTHORED, so its camera must NOT displace from here; beat 5's 'stage' arrive must RETURN.
  const preTour = await settle(page)

  await page.getByRole('button', { name: '▶ tour', exact: true }).click()
  // Beat 0 — the composed stage frame (the tour-start reset frames the core theatre; no arrive). Must not move.
  await expect(page.locator('.tour-caption')).toContainText('A real run bundle')
  const camB0 = await settle(page)
  expect(dist(camB0, preTour), `e0 b0 is un-authored → the camera must NOT displace (Δ=${dist(camB0, preTour).toFixed(2)}u)`).toBeLessThan(2)

  // Beat 2 — 'corridor': crane IN from the ~1800u stage to the first blocked sightline (tk39, origin→sphere), a
  // much tighter frame. Assert it MOVED off the stage vantage. (Beat 1 holds the stage frame — un-authored.)
  await expect(page.locator('.tour-caption')).toContainText('Act II — sightlines from the origin', { timeout: 25000 })
  await waitForTick(page, 43)
  const camB2 = await settle(page)
  await page.screenshot({ path: '.superpowers/sdd/task-v08-w7-e0-shot1.png' })
  const mvB2 = dist(camB2, preTour)
  expect(mvB2, `e0 b2 'corridor' cranes in off the stage vantage (Δ=${mvB2.toFixed(0)}u)`).toBeGreaterThan(100)

  // Beat 4 — 'crane': move to the observer-crane vantage (behind + above the drawn observer at n=−601). Assert it
  // MOVED off the corridor frame. (Beat 3 is the Show-the-Math select beat — un-authored, holds beat 2's frame.)
  await expect(page.locator('.tour-caption')).toContainText('Act III — a second observer', { timeout: 25000 })
  await waitForTick(page, 74)
  const camB4 = await settle(page)
  await page.screenshot({ path: '.superpowers/sdd/task-v08-w7-e0-shot2.png' })
  const mvB4 = dist(camB4, camB2)
  expect(mvB4, `e0 b4 'crane' moved off the corridor frame (Δ=${mvB4.toFixed(0)}u)`).toBeGreaterThan(100)

  // Beat 5 — 'stage': the bookend. Crane back to the whole-instrument core theatre, landing on the SAME vantage
  // the load / free-exploration rest sits on (rest-state parity); the closing CLEAR sightline's far runaway end
  // lies OUTSIDE this framed core theatre. Assert it RETURNED to preTour AND moved off beat 4's crane.
  await expect(page.locator('.tour-caption')).toContainText('The closing beat', { timeout: 25000 })
  const camB5 = await settle(page)
  await page.screenshot({ path: '.superpowers/sdd/task-v08-w7-e0-shot3.png' })
  expect(dist(camB5, preTour), `e0 b5 returns to the load bookend (Δ=${dist(camB5, preTour).toFixed(1)}u)`).toBeLessThan(5)
  const mvB5 = dist(camB5, camB4)
  expect(mvB5, `e0 b5's crane-back moved the camera off beat 4 (Δ=${mvB5.toFixed(0)}u)`).toBeGreaterThan(100)

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})
