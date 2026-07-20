import { expect, test, type Page } from '@playwright/test'

// This test launches the f3a tour BY HAND and measures its divergence framing. A bare run deep link now auto-arms
// that run's tour on a FIRST visit, which would start a second, unbid tour (and, for f3a, scrub off tick 0 to the
// first fix) under the hand-driven measurement. Seed the tour-dismissal memory as already-retired — a RETURNING
// visitor, the calm posture in which a bare deep link does NOT auto-arm — so the test drives exactly the one tour
// it starts. The key mirrors the app's persistent tour-nudge marker; passed as a STRING (the e2e tsconfig excludes
// the DOM lib, so browser code travels as source — the house pattern).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(`try { localStorage.setItem('so.tourNudgeSeen', '1') } catch {}`)
})

// ── THE f3a BELIEF TOUR, END TO END — the run-through + the divergence framing ────────────────────────────
// The belief tour is PURE PAUSED SCRUBS, so each beat lands instantly and the hold is the whole beat duration; the
// tour auto-advances through the holds (there is no manual "next"). This spec (a) plays the tour to the divergence
// beat and asserts the caption is up AND the strip shows the diverging pair — the tightest reported 1σ (0.44 m) beside
// the actual error that has grown past it (2.43 m, OUTSIDE the disc, overconfident); and (b) proves the divergence is
// framed CLOSE to the head, not the sub-2%-of-frame wide shot the true-scale disc risks — a scale-free check (the
// divergence sits far nearer the head than the whole-flight load vantage does) plus a screenshot for the eye.
//
// Camera capture reuses the tour-camera suite's devtools-hook pattern (the app camera lives off the React fiber tree).
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
        let hasDelta = false
        scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && typeof o.geometry.name === 'string' && o.geometry.name.indexOf('entityDelta') === 0) hasDelta = true })
        if (hasDelta) { window.__scene = scene; window.__camera = camera; window.__sceneLocked = true }
      }
      window.__frames = (window.__frames || 0) + 1
      return orig(scene, camera)
    }
  })
})()`
const CAMERA_SAMPLE = `(() => { const c = window.__camera; return { p: c ? [c.position.x, c.position.y, c.position.z] : null, f: window.__frames || 0 } })()`
const HEAD_POS = `(() => {
  const scene = window.__scene
  if (!scene) return null
  let delta = null
  scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.name === 'entityDelta') delta = o })
  if (!delta) return null
  const Matrix4 = delta.matrix.constructor, Vector3 = scene.position.constructor
  const m = new Matrix4(); delta.getMatrixAt(0, m)
  const p = new Vector3().setFromMatrixPosition(m)
  return [p.x, p.y, p.z]
})()`
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
  throw new Error('camera never settled within the deadline')
}
async function waitForTick(page: Page, target: number): Promise<void> {
  await page.waitForFunction(
    `(() => { const el = document.querySelector('.readout'); if (!el) return false; const s = el.getAttribute('title') || el.textContent || ''; const m = /tick\\s+(\\d+)/.exec(s); return m ? parseInt(m[1], 10) >= ${target} : false })()`,
    undefined,
    { timeout: 30000 },
  )
}
const dist = (a: readonly [number, number, number], b: readonly [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test('f3a belief tour: the run reaches the divergence beat with the diverging pair on the strip, framed close to the head', async ({ page }) => {
  test.setTimeout(120_000) // beats 0-2 hold ~7.9+8.0+11.2s before the divergence beat, then the settle poll
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f3a') // a returning visitor's deep link does not auto-arm → no unbid tour; we drive it explicitly
  await expect(page.locator('.readout')).toHaveAttribute('title', 'tick 0 / 96', { timeout: 15000 })
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  const loadVantage = await settle(page) // the whole-flight load vantage (the wide shot the divergence must beat)

  await page.getByRole('button', { name: '▶ tour', exact: true }).click()
  // Beat 0 — the establish caption (the widest reported 1σ, the truth inside the disc).
  await expect(page.locator('.tour-caption')).toContainText('A tracker has locked onto one drone', { timeout: 15000 })
  await page.screenshot({ path: 'e2e/screenshots/f3a-tour-beat0.png' })

  // THE DIVERGENCE BEAT — auto-advance carries the tour through beats 1-2's holds into beat 3.
  await expect(page.locator('.tour-caption')).toContainText('most sure of all', { timeout: 45000 })
  await expect(page.locator('.tour-caption')).toContainText('overconfident')
  // THE STRIP SHOWS THE DIVERGING PAIR — the tightest reported 1σ beside the actual error that has grown past it.
  const sigma = page.locator('.track-sigma')
  await expect(sigma).toContainText('1σ 0.44 m')
  const err = page.locator('.track-error')
  await expect(err).toContainText('error 2.43 m')
  await expect(err).toContainText('OUTSIDE the disc')
  await expect(err).toContainText('overconfident')

  // THE FRAMING — the divergence is composed CLOSE to the head (the true-scale-disc legibility remedy), not the wide
  // load vantage. Gate on the beat-3 tick, settle, and assert the camera sits far nearer the head than the load
  // vantage did (a scale-free proof it is a head shot, not the whole-flight fit). Screenshot for the eye.
  await waitForTick(page, 79)
  const camDiv = await settle(page)
  const headDiv = (await page.evaluate(HEAD_POS)) as [number, number, number]
  await page.screenshot({ path: 'e2e/screenshots/f3a-tour-divergence.png' })
  const camToHead = dist(camDiv, headDiv)
  const loadToHead = dist(loadVantage, headDiv)
  expect(camToHead, `the divergence is a head shot (cam→head=${camToHead.toFixed(0)}u), far nearer the head than the load vantage (${loadToHead.toFixed(0)}u)`).toBeLessThan(loadToHead * 0.6)
  expect(dist(camDiv, loadVantage), `the divergence arrive moved the camera off the load vantage`).toBeGreaterThan(5)

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})
