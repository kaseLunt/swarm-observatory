import { expect, test, type Page } from '@playwright/test'
// The profile-conflation tripwire, imported from THE single source — the same binding
// hangar.test.ts and publication.test.ts scan with, so the e2e pattern can never drift from the unit
// pattern. The leaf module has zero imports on purpose: this project is tsconfig.node.json (nodenext,
// hence the explicit .ts extension via allowImportingTsExtensions), and a zero-import file typechecks
// under both the app and node programs.
import { PROFILE_CONFLATION_RE } from '../src/ui/profileConflation.ts'

test('boots, verifies F0, renders scene, restores deep link', async ({ page }) => {
  await page.goto('/?run=f0&tick=1')
  await expect(page.locator('.provenance')).toContainText('provenance', { timeout: 15000 })
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓')
  await expect(page.locator('.provenance tr.mismatch')).toHaveCount(0)
  await expect(page.locator('#viewport canvas')).toBeVisible()
  await expect(page.locator('.readout')).toHaveText('tick 1 / 2') // deep link restored (F0 tickCount = 2)
  await page.screenshot({ path: 'e2e/screenshots/smoke.png', fullPage: true })
})

test('E0 det-only run decodes, verifies trailer, shows claims-absent provenance', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  await expect(page.locator('.provenance')).toContainText('(det-only)')
  await expect(page.locator('.counts')).toContainText('75 events · 75 ticks')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75')
  // Honesty (the false-green fix): a det-only run carries NO manifest claims, so NO claim row may
  // paint a false green. Discriminating selector = the case_id row: it is a trailer-SOURCED value (read from
  // the trailer, never recomputed against anything), so it wears the ATTESTED voice (•, 'attested'), never
  // 'verified' — and never the ○ self-check ring the trailer-reproduced hash rows earn (a value with no
  // oracle must not wear a check glyph).
  const caseIdRow = page.locator('.provenance tr', { hasText: 'case_id' })
  await expect(caseIdRow).toHaveClass(/attested/)
  await expect(caseIdRow).not.toHaveClass(/verified/)
  // Table-wide: with every row claims-absent, there is genuinely no green anywhere (the trailer
  // consistency line is a separate <p class="counts">, not a tr, and stays ✓).
  await expect(page.locator('.provenance tr.verified')).toHaveCount(0)
})

test('stale deep-link event does not white-screen (C1)', async ({ page }) => {
  // ?ev=40 points past f0's tiny event range. The selection invariant (useRun publishes only after
  // clearing an out-of-range selectedEvent; App's selectRun/clamp back it up) must hold BEFORE any
  // child renders against the model, so chain code never spreads undefined and the app renders
  // normally instead of blanking. The ErrorBoundary would surface `.screen.error` if it slipped —
  // assert that surface is absent too.
  await page.goto('/?run=f0&ev=40')
  await expect(page.locator('.provenance')).toContainText('provenance', { timeout: 15000 })
  await expect(page.locator('.readout')).toBeVisible()
  await expect(page.locator('.screen.error')).toHaveCount(0)
})

test('run switch clears a carried selection and leaks no stale ev into the new URL', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })
  // Shift-click mid-timeline selects the nearest event (sets ev) and writes it to the URL. A bare
  // locator.click defaults to the element center = mid-timeline; the modifier makes it a selection.
  await page.locator('.timeline canvas').click({ modifiers: ['Shift'] })
  await expect(page).toHaveURL(/ev=/)
  // Switch to f0 via the header nav button. selectRun clears BOTH selections and force-syncs the URL,
  // so f0 renders cleanly (readout 'tick 0 / 2') and no stale ev is carried into the new run's URL.
  // A run switch unmounts the WHOLE ready tree (the current-load witness gate) including the WebGL
  // canvas, so the post-switch paint pays a full context re-init — on CI's software renderer that
  // costs what the FIRST load costs. First-paint allowance, same as the initial-load asserts.
  await page.getByRole('button', { name: 'f0', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
  await expect(page).toHaveURL(/run=f0/)
  await expect(page).not.toHaveURL(/ev=/)
  await expect(page.locator('.screen.error')).toHaveCount(0)
})

test('keyboard grammar drives the transport', async ({ page }) => {
  await page.goto('/?run=f0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })

  // Help affordance + overlay modality (run while tick is still 0). The visible header ? button opens
  // the same overlay the ?-key toggles; while it is open the overlay owns the keyboard, so Space must
  // be swallowed (no play underneath the modal) and the readout must stay put. Esc then closes it.
  await page.getByRole('button', { name: 'keyboard shortcuts' }).click()
  await expect(page.getByText('play-pause')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2') // playback did NOT start under the modal
  await page.keyboard.press('Escape')
  await expect(page.getByText('play-pause')).not.toBeVisible()

  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.readout')).toHaveText('tick 1 / 2')
  await expect(page).toHaveURL(/tick=1/)
  // Help overlay: Playwright delivers Shift+Slash as key '?'. Assert on the auto-retrying visibility
  // of a grammar row — no isVisible() poll and no type('?') fallback (a stray second '?' would just
  // re-toggle the overlay shut).
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByText('play-pause')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('play-pause')).not.toBeVisible()

  // Double-toggle regression: clicking the play button focuses it, so a single Space must fire
  // exactly ONE toggle. App preventDefaults the key and blurs the button, so the browser's native
  // "Space activates the focused button" can't add a second toggle. f0 is only 2 ticks (playback
  // auto-completes near-instantly), so the duration-independent signal is the blur — after Space the
  // play button must no longer hold focus (the guard's blur ran) and the transport reads paused (▶).
  // If the guard regressed, the button would keep focus and the double activation nets back to where
  // it started.
  const playButton = page.locator('.timeline button').first()
  await playButton.click()
  await expect(playButton).toBeFocused()
  await page.keyboard.press('Space')
  await expect(playButton).not.toBeFocused()
  await expect(playButton).toHaveText('▶')
})

test('guided tour starts on ?run=e0 and a user interrupt (ArrowRight) closes it while the transport still advances', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  await page.getByRole('button', { name: '▶ tour' }).click()
  // Step 1's caption (tours.ts, e0-hero): stable substring, not the full sentence.
  await expect(page.locator('.tour-caption')).toContainText('A real run bundle')
  // ArrowRight is a genuine user gesture: source-signaled via notifyUserInput() BEFORE the step
  // action runs (interrupt.ts), so the tour stops first and the transport still steps normally.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  await expect(page.locator('.readout')).toHaveText('tick 1 / 75')
})

test('guided tour auto-advances to step 2 after the step-1 hold elapses, then Escape stops it cleanly', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  await page.getByRole('button', { name: '▶ tour' }).click()
  await expect(page.locator('.tour-caption')).toContainText('A real run bundle')
  // The advance into the 'exact replay' caption is gated by the FIRST caption's holdMs (tours.ts e0-hero,
  // now 7300ms after the reading-window resize — was 5500). The auto-retrying assertion polls until the
  // scheduler's holdElapsed dispatch fires and advances the state machine — proving auto-advance, not just
  // the initial caption paint — without a hard `waitForTimeout`. Timeout 12000 (was 8000) sits comfortably
  // above the 7300ms hold + tour-start latency so the resize does not race the poll on a slow runner.
  await expect(page.locator('.tour-caption')).toContainText('exact replay', { timeout: 12000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
})

// ── cold open, discoverability, witnessable playback ─────────────────────────────────────

// ── ZERO-CLICK THESIS on the cold open ──────────────────────────────────────────────────
// CONSCIOUS REWRITE: the earlier cold-open test asserted the first-visit tour
// NUDGE treatment on a bare `/`. This change replaces that first-visit cold-open experience with the ZERO-CLICK
// THESIS: a bare cold open opens the thesis card AND auto-plays the first tour beat. The nudge PRECEDENT is
// preserved verbatim — it still governs the DEEP-LINK first-visit path (see the ?run=e0 tour tests above,
// which still see the launcher) — and the auto-play retires that same NUDGE_KEY, so a returning visit is calm.
// Only the BARE cold open changed; every ?run= test is untouched (a deep link is never a cold open).
test('cold open: the zero-click thesis card + auto-played first tour beat; an interrupt keeps the card; a returning visit is calm', async ({ page }) => {
  // HERO SWITCH (dev/v0.6): a bare `/` now boots f1 (the cold-open star — a moving vehicle) not e0. f1 is a
  // golden DET-ONLY run, so its honesty voice is the SELF-CHECK (○), NOT the manifest-grade ✓ (two-voice truth,
  // self-check ≠ verified) — its trailer reproduces its own sealed hashes, but no external manifest backs it.
  await page.goto('/')
  await expect(page.locator('.provenance')).toContainText('(det-only)', { timeout: 15000 })
  // ZERO-CLICK THESIS: the card shows the run's REAL verdict headline. f1 is det-only → the self-check ring
  // ○ (.thesis-verdict.self), and it NEVER wears the manifest-grade green (.verified) it did not earn.
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible()
  await expect(card.locator('.thesis-verdict.self')).toBeVisible()      // det-only → the self-check ○, not a false green
  await expect(card.locator('.thesis-verdict.verified')).toHaveCount(0) // NEGATIVE: never the manifest-grade ✓
  await expect(card).toContainText('not its source')                   // the in-app independence line
  await expect(card.getByRole('button', { name: 'copy link' })).toBeVisible()
  // …and the FIRST tour beat auto-PLAYS with zero clicks — f1's establish caption is up unprompted.
  await expect(page.locator('.tour-caption')).toContainText('A single drone with real recorded motion')
  // Interruptible by ANY transport input (the existing notifyUserInput grammar): Escape stops the tour at
  // tick 0 (a deselect — clears f1 step 0's '1:0' selection, no playhead move), the tour overlay clears,
  // and the share card PERSISTS. CONSCIOUS RECONCILIATION: this interrupt lands during BEAT 0
  // — before the auto-tour reaches its first playback beat — so the collapse trigger (tourPastFirstBeat) never
  // fired and it is the FULL card that survives the interrupt (what this test has always proven: the share
  // weapon outlives an interrupt). The new collapse contract — beat 1 collapses the card to a header chip — is
  // proven in the dedicated test below, so this beat-0 interrupt assertion is preserved verbatim.
  await page.keyboard.press('Escape')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  await expect(card).toBeVisible()                                     // the share weapon survives the interrupt
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64')     // f1 tickCount = 64
  // × dismisses the card (and stops any still-running tour).
  await card.getByRole('button', { name: 'dismiss' }).click()
  await expect(card).toHaveCount(0)
  // A returning visit is calm: the auto-play retired the first-visit key, so no card and no auto-tour fire;
  // the plain ▶ tour launcher remains. (The URL is now ?run=f1 — a non-bare load is not a cold open either.)
  await page.reload()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  await expect(page.locator('.thesis-card')).toHaveCount(0)
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '▶ tour', exact: true })).toBeVisible()
})

// A capturing clipboard shim (string — the e2e tsconfig.node.json has no DOM lib, so browser code travels as
// strings, the CAPTURE_SCENE house pattern), installed via a post-load evaluate right before the copy click.
// navigator.clipboard.writeText is unreliable in headless Chromium even with granted permissions (it rejects on
// the un-focused/headless page — confirmed both here and under the chrome-devtools MCP browser), so the REAL
// clipboard is a browser CAPABILITY out of scope for this suite. The shim resolves + records the argument, so the
// assertion proves what IS ours: the click builds the correct shareable URL and the label flips to the honest
// success feedback. The URL STRING-BUILDING is separately unit-pinned in url.test.ts (buildShareUrl + NEVER-list).
const CLIPBOARD_SHIM = `(() => {
  window.__copiedUrl = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { window.__copiedUrl = t; return Promise.resolve() } },
  })
})()`

test('the thesis card copy-link builds the current shareable view URL — with NO verification state (NEVER-list)', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible({ timeout: 15000 })
  // Stop the auto-tour first (Escape = deselect at tick 0, no move) so the copied view is the stable rest.
  await page.keyboard.press('Escape')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  await page.evaluate(CLIPBOARD_SHIM) // install the capturing shim now (post-load evaluate is the reliable path)
  const copy = card.getByRole('button', { name: 'copy link' })
  await copy.click()
  // Assert the DURABLE evidence — what the handler WROTE — not the label flip: the "link copied ✓" feedback is
  // real (browser-verified + it self-resets after 2s), but on the swiftshader runner the click+round-trip overhead
  // can outrun that 2s window, so polling the transient label is flaky. __copiedUrl is permanent: it is set iff
  // the click reached the success path (built the URL, awaited a resolved write) — which is also exactly what
  // flips the label. So this pins the meaningful behavior deterministically.
  const clip = (await page.evaluate('window.__copiedUrl')) as string
  // A full shareable URL for the CURRENT view — the run in the URL grammar, and NO verification state (the
  // NEVER-list). A shared link reproduces the view; the recipient's browser re-verifies. HERO SWITCH: the
  // bare cold open is f1 now, so the copied view is run=f1.
  expect(clip).toContain('run=f1')
  for (const banned of ['verif', 'seal', 'verdict', 'hash', 'trust']) {
    expect(clip.toLowerCase(), `share URL must not carry '${banned}'`).not.toContain(banned)
  }
})

// ── the cold-open card COLLAPSES to a header verdict chip once the auto-tour leaves beat 0 ──
// The card used to persist over the WHOLE tour. Now the full card holds through beat 0 (its cold-
// open share moment) and collapses to a header chip once the first playback beat begins — the chip is the SAME
// verdict voice, × still dismisses. The full card is a once-per-browser first-visit surface: after collapse it
// never returns except via cleared storage, and a reload from the collapsed state is calm — no card, no chip
// (pinned by the dedicated reload test below). This preserves what the beat-0 interrupt test above proves while
// pinning the new collapse contract.
test('cold open: the full card collapses to a header verdict chip when the auto-tour reaches its first playback beat', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible({ timeout: 15000 })                     // beat 0 — the full share card is up
  await expect(page.locator('.thesis-chip')).toHaveCount(0)             // …and NOT yet the collapsed chip
  // Let the tour advance on its own (no interrupt) past f1's ~5.8s establishing hold into beat 1 (the playback
  // caption). Reaching beat 1 (stepIndex ≥ 1) is the collapse signal.
  await expect(page.locator('.tour-caption')).toContainText('Playback advances the recorded trajectory', { timeout: 12000 })
  // The full card is GONE and the header verdict chip has taken its place — the SAME det-only self-check voice, with ×.
  await expect(card).toHaveCount(0)
  const chip = page.locator('.thesis-chip')
  await expect(chip).toBeVisible()
  await expect(chip.locator('.thesis-chip-verdict.self')).toBeVisible()      // det-only → the self-check ○, header-scale
  await expect(chip.locator('.thesis-chip-verdict.verified')).toHaveCount(0) // NEGATIVE: the chip never wears the manifest-grade ✓
  // × on the chip still dismisses (and the full card does NOT re-expand — collapse is a one-way session latch).
  await chip.getByRole('button', { name: 'dismiss' }).click()
  await expect(page.locator('.thesis-chip')).toHaveCount(0)
  await expect(page.locator('.thesis-card')).toHaveCount(0)
})

// ── after collapse, a RELOAD is CALM — the full card is once-per-browser (first visit) ──────
// The sibling collapse test proves the chip is a one-way SESSION latch (an interrupt never re-expands it). This
// pins the deeper PERSISTENCE invariant the docs used to misstate: the first cold open's auto-play retires
// NUDGE_KEY (startTour → dismissNudge), so a reload seeds nudgeSeen=true and the zero-click arming rejects — and
// the boot has already rewritten the URL to ?run=f1, a non-bare load that is not a cold open either. Either way
// a reload from the COLLAPSED state is a returning visit: NO full card AND NO chip, the calm posture (the plain
// ▶ tour launcher, no first-visit pulse). Only cleared storage would bring the full card back. Mirrors the
// cold-open test's returning-visit block; the difference is the pre-reload state — collapsed, never dismissed.
test('cold open: after the card collapses, a reload is calm — no card, no chip, the returning-visit posture', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible({ timeout: 15000 })                     // beat 0 — the full share card is up
  // Let the tour advance on its own past f1's establishing hold into beat 1 (the collapse signal), exactly as
  // the sibling collapse test does — the full card gives way to the header verdict chip. Reaching the beat-1
  // caption proves the collapse fired BEFORE the reload, so the reload genuinely starts from the collapsed state.
  await expect(page.locator('.tour-caption')).toContainText('Playback advances the recorded trajectory', { timeout: 12000 })
  await expect(card).toHaveCount(0)                                      // collapsed — the full card is gone…
  await expect(page.locator('.thesis-chip')).toBeVisible()             // …and the header verdict chip stands in
  // RELOAD from the collapsed state (no dismiss). The first cold open already retired NUDGE_KEY, so this is a
  // returning visit, not a fresh first-visit cold open — the zero-click open must NOT re-arm.
  await page.reload()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 }) // f1 tickCount = 64
  // THE INVARIANT: the reload is calm — NEITHER the full card NOR the collapsed chip survives it. (A reload
  // never repaints the once-per-browser full card; only cleared storage would.)
  await expect(page.locator('.thesis-card')).toHaveCount(0)
  await expect(page.locator('.thesis-chip')).toHaveCount(0)
  await expect(page.locator('.tour-overlay')).toHaveCount(0)           // …and no auto-tour on a returning visit
  // The calm returning-visit posture: the plain ▶ tour launcher is present WITHOUT the first-visit pulse CTA.
  const tourBtn = page.getByRole('button', { name: '▶ tour', exact: true })
  await expect(tourBtn).toBeVisible()
  await expect(tourBtn).not.toHaveClass(/tour-nudge-cta/)
})

// ── the copy-link has a PERMANENT home in the app chrome (the header), not just the cold-open card ──
// A deep link (?run=e0) is never a cold open, so no thesis card ever mounts — yet the share weapon must still be
// reachable. The header copy-link proves it: present with no card in sight, and it builds the same shareable
// view URL with NO verification state (the NEVER-list), exactly as the card's copy did.
test('the permanent header copy-link builds the shareable view URL with no card present (NEVER-list)', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 }) // e0 tickCount = 75
  await expect(page.locator('.thesis-card')).toHaveCount(0)             // a deep link is not a cold open — no card
  const headerCopy = page.locator('.header-copy')
  await expect(headerCopy).toBeVisible()                                // …but the share weapon is permanent in the chrome
  await page.evaluate(CLIPBOARD_SHIM)
  await headerCopy.click()
  const clip = (await page.evaluate('window.__copiedUrl')) as string
  expect(clip).toContain('run=e0')
  for (const banned of ['verif', 'seal', 'verdict', 'hash', 'trust']) {
    expect(clip.toLowerCase(), `share URL must not carry '${banned}'`).not.toContain(banned)
  }
})

// STALE-GREEN ON RUN SWITCH. The cold-open thesis card is a cold-open artifact: it reads the OPENING
// run's verdict and speaks the zero-click thesis. A run switch makes that narrative stale, and for the
// one-commit identity window it would otherwise paint the PRIOR run's ✓ under the NEW run's name (the
// seal-race twin). So the card must CLOSE on any run switch. (The verdict-withhold guard on the prop is the
// second belt, unit-pinned in thesis.test.ts / hangar.test.ts; this proves the card-close behavior end-to-end.)
test('a run switch closes the cold-open thesis card (no prior run’s ✓ under a new run’s name)', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible({ timeout: 15000 })
  await expect(card.locator('.thesis-verdict.self')).toBeVisible() // f1 is det-only → its REAL self-check ○ on the cold open (HERO SWITCH)
  // Switch f1 → f0 via the header run-switcher (the card is top-center at desktop width, clear of the
  // left-aligned nav, so the button is directly clickable). Navigation retires the cold-open narrative.
  await page.getByRole('button', { name: 'f0', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
  await expect(card).toHaveCount(0) // the card is gone — never repainted with f1's verdict under f0
  // …and it does not spontaneously reopen on the switched-to run (the arm is a once-per-cold-open latch).
  await expect(page.locator('.thesis-card')).toHaveCount(0)
  await expect(page.locator('.screen.error')).toHaveCount(0)
})

// The deep-link tour-NUDGE treatment (restored). The zero-click rewrite dropped the only test pinning the
// first-visit nudge TREATMENT (the pulse CTA on the ▶ tour button + the quiet dismiss ×). That precedent is
// NOT gone — it still governs the DEEP-LINK first-visit path, because a deep link (?run=…) is never a cold
// open, so the zero-click thesis is skipped BY DESIGN and the nudge is the discoverability voice there. This
// fresh-context deep link (Playwright isolates storage per test = a first visit) re-pins that treatment AND
// the design invariant that the deep-link path shows NO zero-click card / auto-tour.
test('a first-visit deep link shows the tour-nudge treatment (pulse CTA + dismiss ×) and NO zero-click open', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  // A deep link is not a cold open: neither the thesis card nor the auto-tour ever fires here.
  await expect(page.locator('.thesis-card')).toHaveCount(0)
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  // The nudge TREATMENT: the ▶ tour button wears the pulse CTA class, and the quiet dismiss × is present.
  const tourBtn = page.getByRole('button', { name: '▶ tour', exact: true })
  await expect(tourBtn).toHaveClass(/tour-nudge-cta/)
  const dismiss = page.getByRole('button', { name: 'dismiss tour nudge' })
  await expect(dismiss).toBeVisible()
  // The × retires the treatment: the pulse class drops and the × goes away (the nudge is marked seen).
  await dismiss.click()
  await expect(tourBtn).not.toHaveClass(/tour-nudge-cta/)
  await expect(page.getByRole('button', { name: 'dismiss tour nudge' })).toHaveCount(0)
})

test('plain-clicking the timeline selects the nearest event (no drag → select, not scrub)', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })
  // A plain click (no modifier, no drag) selects the nearest event and lights its chain — the
  // discoverable path that previously required the Shift modifier. It writes ?ev= and must NOT move the
  // playhead (a select, not a scrub): the readout stays at tick 0.
  await page.locator('.timeline canvas').click()
  await expect(page).toHaveURL(/ev=/)
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75')
})

test('a tour play step plays VISIBLY — the playhead sweeps through intermediate ticks, not an instant jump', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  await page.getByRole('button', { name: '▶ tour' }).click()
  // Step 2 (tours.ts e0-hero) is a play step from tick 0 → 20. Under the witness-normalized base (1× covers
  // a whole run in ~WITNESS_RUN_SECONDS), that step sweeps visibly on BOTH counts: the base rate alone plays
  // ticks at a watchable pace, and the tour re-normalizes THIS step to ~WITNESS_SECONDS of wall time via its
  // witnessSpeed pacing — either way the readout passes THROUGH intermediate ticks. This test pins that
  // visible sweep: catching any mid-flight tick proves playback is witnessable, not an instant jump.
  // Timeout 12000 (was 8000): the 'exact replay' caption is gated by step 0's holdMs, now 7300ms (the reading-window resize).
  await expect(page.locator('.tour-caption')).toContainText('exact replay', { timeout: 12000 })
  await expect(page.locator('.readout')).toHaveText(/^tick (?:[1-9]|1[0-9]) \/ 75$/, { timeout: 6000 })
})

// ── natural-end finale ─────────────────────────────────────────────────────────────────

test('playing to the natural end lights the finale; a scrub clears it (first end-of-play assertion)', async ({ page }) => {
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')
  await expect(viewport).toHaveAttribute('data-finale', 'false') // no finale before the run has played
  // Play the naive path (unselected f1) to its natural end. 8× so the ~8s run completes fast + deterministically;
  // the establishing shot stages it and the natural-end finale closes on the resting head.
  await page.getByRole('button', { name: '8×', exact: true }).click()
  await page.getByRole('button', { name: '▶', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 64 / 64', { timeout: 10000 })
  await expect(viewport).toHaveAttribute('data-finale', 'true') // natural end → the finale is lit
  // A scrub (a drag past the click threshold) moves the playhead → clears the finale (the rest display stops).
  const box = (await page.locator('.timeline canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(viewport).toHaveAttribute('data-finale', 'false') // scrub cleared it
})

// ── error-screen escape hatch ────────────────────────────────────────────────────────────

test('unknown run: honest error retained + escape hatch to the default run', async ({ page }) => {
  // Adjudicated posture: an unknown ?run= deep link gets an HONEST decode-failed screen with the full
  // error text (never a silent fallback), plus a guarded escape affordance layered on top — the button
  // routes through the SAME selectRun path the header nav uses, so URL + store + reload semantics are
  // identical to a normal run switch.
  await page.goto('/?run=not-a-run')
  await expect(page.locator('.screen.error h1')).toHaveText('decode failed')
  // Full error text is retained (honesty), naming the offending run — not swallowed by the recovery.
  await expect(page.locator('.screen.error pre')).toContainText("unknown run 'not-a-run'")
  // HERO SWITCH: the escape hatch targets DEFAULT_RUN, now f1 (button label reads "open f1 instead").
  await page.getByRole('button', { name: /open f1 instead/ }).click()
  // Escapes to f1 through the normal ceremony → ready: the readout settles at 'tick 0 / 64' (f1's tickCount),
  // and the URL reflects the switch.
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  await expect(page).toHaveURL(/run=f1/)
})

// ── raycast fix — click reaches the 3D subject at ANY corridor position ────────────────
// The pick/hover hit InstancedMesh's boundingSphere froze at the drone's first-picked position: three.js
// computes it ONCE (only when null) and never after setMatrixAt, so every ray early-returned once the
// subject travelled away and clicks selected nothing (diag symptom A). These are the suite's FIRST
// 3D-cone-click tests. The subject is sub-pixel-small at the establish distance, so we click its EXACT
// projected screen centre computed from the app's OWN three.js camera — captured in-browser via the
// standard __THREE_DEVTOOLS__ 'observe' hook (same technique as the diagnosis probes). The browser
// source is passed as STRINGS on purpose: the e2e
// tsconfig (tsconfig.node.json) excludes the DOM lib, so an inline evaluate arrow touching window/three
// would not typecheck — strings keep the browser code opaque to tsc while results stay typed on Node.
type HeadProj = { x: number; y: number; onScreen: boolean; world: [number, number, number] }

// Wrap three's WebGLRenderer.render (via the devtools observe hook, installed before the app boots) to
// latch the live scene + camera the first time a cone InstancedMesh is present. The same object instances
// live for the whole session, so their matrices are read fresh at projection time.
const CAPTURE_SCENE = `(() => {
  const dt = new EventTarget()
  window.__THREE_DEVTOOLS__ = dt
  dt.addEventListener('observe', (e) => {
    const renderer = e.detail
    if (!renderer || typeof renderer.render !== 'function' || renderer.__wrapped) return
    renderer.__wrapped = true
    window.__renderer = renderer
    const orig = renderer.render.bind(renderer)
    renderer.render = (scene, camera) => {
      if (scene && scene.isScene && !window.__sceneLocked) {
        let hasCone = false
        scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'ConeGeometry') hasCone = true })
        if (hasCone) { window.__scene = scene; window.__camera = camera; window.__sceneLocked = true }
      }
      return orig(scene, camera)
    }
  })
})()`

// Project the hit mesh's instance-0 origin (the cone's geometric centre — the ideal ray target) through
// the live camera to CSS pixel coordinates for page.mouse.click. onScreen guards against a framing
// regression silently clicking empty canvas. Returns null until the scene is latched. hitRadius >= 0.6
// disambiguates the enlarged INVISIBLE hit mesh (0.9) from the visible cone (0.4).
const PROJECT_HEAD = `(() => {
  const scene = window.__scene, camera = window.__camera, renderer = window.__renderer
  if (!scene || !camera || !renderer) return null
  let hit = null
  scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'ConeGeometry' && o.geometry.parameters.radius >= 0.6) hit = o })
  if (!hit) return null
  const Matrix4 = hit.matrix.constructor
  const Vector3 = camera.position.constructor
  const mat = new Matrix4(); hit.getMatrixAt(0, mat)
  const pos = new Vector3().setFromMatrixPosition(mat)
  const ndc = pos.clone().project(camera)
  const rect = renderer.domElement.getBoundingClientRect()
  return {
    x: (ndc.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-ndc.y * 0.5 + 0.5) * rect.height + rect.top,
    onScreen: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
    world: [pos.x, pos.y, pos.z],
  }
})()`

// Read the live camera POSITION (the app's camera lives off the React fiber tree, so the DOM can't witness it —
// same devtools-hook capture as PROJECT_HEAD). Used to PROVE the scrub-from-finale re-fit (a design ruling): at a
// finale rest the camera sits on the composed close-up (~25u off the head); leaving the finale by a scrub must
// ease it to the WIDE establishing frame (whole-trajectory fit, hundreds of u away) — a large, unambiguous move,
// NOT the v0.5b void where the camera stayed parked at the empty sky (delta ~0).
const CAMERA_POS = `(() => {
  const c = window.__camera
  if (!c) return null
  return [c.position.x, c.position.y, c.position.z]
})()`

// Seat three's boundingSphere cache at the TICK-0 position so the later far-corridor click is a REAL guard
// for the fix: r3f raycasts on pointer-move, three computes the sphere once (when null) and never after
// setMatrixAt. Moving over the viewport now caches the sphere at the origin corridor; the drone then
// travels away, so WITHOUT the fix the subsequent click's ray early-returns against this stale sphere and
// selects nothing. WITH the fix (boundingSphere nulled beside the matrix update) the ray recomputes and hits.
//
// GUARD-EROSION CAVEAT: the seat's efficacy hinges on this canvas-CENTRE pointermove actually reaching r3f's
// raycaster. Today the pointer lands on the interaction (hit) mesh with nothing above it, so the sphere gets
// seeded. A future HUD overlay stacked over the canvas centre that swallows pointer events would silently
// de-fang the seat — no error, the move just never raycasts — and these tests would still PASS against a
// regressed fix (the stale sphere was never actually seeded, so nothing exercised it). The removal-proof is
// the only reliable re-verification: revert the fix (drop the `hit.boundingSphere = null`) and confirm these
// 3D-click tests FAIL; if they stay green with the fix removed, the seat has been eroded and must be re-armed.
async function seatEarlySphere(page: Page): Promise<void> {
  // SCENE-LIVE GATE (a conscious timing fix). The readout turns
  // interactive BEFORE the r3f Canvas finishes its first (SwiftShader-slow) mount, and BOTH of this
  // helper's callers act within that window under the test runner: (1) the seeding pointer-moves here
  // raycast NOTHING until the hit mesh exists — the exact seat erosion the caveat above warns about —
  // and (2) a ▶ click in that window fires the play-rising-edge establish request BEFORE Entities
  // mounts, where the channel's deliberate mount-seed consumes it without acting (camera stays on the
  // load vantage). The earlier canvas was wide enough to mask (2) geometrically; the reserved-column
  // canvas is not. Waiting for the CAPTURE_SCENE latch (the first rendered cone frame) restores the
  // scenario the tests describe: a user acting on a visibly-live stage. The swallowed-establish
  // mount window itself is flagged for endgame adjudication (app behavior, not test).
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 }) // string: e2e tsconfig has no DOM lib
  const box = (await page.locator('#viewport canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2 + 6)
}

// Deterministic replacement for the finale/establish ease-settle sleeps (v0.5c endgame). The finale close-up
// and the scrub-from-finale establishing frame both arrive via a multi-frame camera EASE; rather than guess its
// duration with a fixed waitForTimeout (900/1200ms — brittle under load), poll the app's OWN camera position
// (CAMERA_POS, the same devtools-hook capture the assertions read) every ~100ms and return the instant two
// consecutive samples coincide (< EPS apart) — i.e. the ease has converged. The ease is asymptotic, so once the
// per-100ms delta drops below EPS the residual distance to the final frame is also sub-EPS — far inside the click
// tolerance and the >10u move threshold. Generous timeout; throws (a real regression, never silent
// flake) if the camera never stabilises. ONE helper, three call sites: the finale, the pre-scrub rest, the post-
// scrub establish. Requires window.__camera latched (CAPTURE_SCENE init script + a played-to-finale frame).
async function waitForCameraStable(page: Page): Promise<void> {
  const EPS = 0.05
  const deadline = Date.now() + 8000
  let prev = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(prev, 'camera latched for the stability poll').not.toBeNull()
  while (Date.now() < deadline) {
    await page.waitForTimeout(100)
    const cur = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
    expect(cur, 'camera captured during the stability poll').not.toBeNull()
    if (Math.hypot(cur![0] - prev![0], cur![1] - prev![1], cur![2] - prev![2]) < EPS) return
    prev = cur
  }
  throw new Error('camera never stabilised within the settle timeout')
}

// Wait for the finale close-up to be GENUINELY REACHED (CI run 28992396802). The finale close-up
// is a DETERMINISTIC ~241u from the composed load vantage [6,4.5,9] (finaleFraming composes head+FINALE_DISTANCE
// around the far natural-end head; useTour.ts names the ~241u strand). For the tour-from-finale test's >100u
// anti-regression to MEAN anything, `before` must be that resting close-up — not a waypoint on the way there.
// A plain waitForCameraStable is insufficient HERE: its "two consecutive samples <0.05u/100ms" window is also
// satisfied by any momentary render stall BEFORE / EARLY-IN the finale ease. On a slow SwiftShader runner (the
// GitHub ubuntu box, ~first exposure of this suite to a slow renderer) the camera can still be at/near the load
// vantage when the poll declares "stable", so `before` is captured metres from the vantage and the reset then
// measures a false, tiny move — CI run 28992396802 snapshotted `before` at Δ=25.1u (the ease barely begun; the
// camera was still ~25u off the vantage, NOT ~241u down-corridor) and the >100u assertion failed. So gate on
// genuine ARRIVAL, not mere momentary stillness: poll until the camera is BOTH settled (<EPS between samples)
// AND provably ON the close-up (>200u from the load vantage — cleanly between the ~25u slow-runner false-early
// stall and the ~241u true rest, deterministic sim → no run-to-run drift in the target). Generous timeout;
// throws (a real finale-compose regression, never a silent flake) if the close-up is never reached.
async function waitForFinaleCloseUp(page: Page): Promise<void> {
  const EPS = 0.05
  const ARRIVED_FROM_VANTAGE = 200 // ≪ the ~241u rest, ≫ the ~25u slow-runner false-early stall (CI run 28992396802)
  const VANTAGE: readonly [number, number, number] = [6, 4.5, 9] // the composed load vantage (matches the toVantage assertion)
  const deadline = Date.now() + 15000
  let prev = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(prev, 'camera latched for the finale close-up poll').not.toBeNull()
  while (Date.now() < deadline) {
    await page.waitForTimeout(100)
    const cur = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
    expect(cur, 'camera captured during the finale close-up poll').not.toBeNull()
    const settled = Math.hypot(cur![0] - prev![0], cur![1] - prev![1], cur![2] - prev![2]) < EPS
    const fromVantage = Math.hypot(cur![0] - VANTAGE[0], cur![1] - VANTAGE[1], cur![2] - VANTAGE[2])
    if (settled && fromVantage > ARRIVED_FROM_VANTAGE) return
    prev = cur
  }
  throw new Error('finale close-up never reached (camera never settled >200u from the load vantage within the timeout)')
}

// Wait for the tour-start RESET to actually LAND (CI run 28993785155). The reset is an
// INSTANT camera cut, but it is executed inside Scene's useFrame, and on a slow SwiftShader runner the tour
// click triggers a long SYNCHRONOUS React/r3f reflow (step-0 caption + tour overlay + inspector re-render)
// that STALLS the render loop for hundreds of ms — to seconds — BEFORE the next frame runs the cut. During
// that stall the camera is FROZEN on the finale close-up, so a plain waitForCameraStable (two consecutive
// still samples) is satisfied by the STALL and samples the PRE-reset close-up. That is exactly how CI run
// 28993785155 failed: it read the camera 25.0u off `before` (the finale ease's residual creep) instead of
// ~241u on the vantage, and the >100u assertion failed with Δ=25.0u — the same false-early symptom the earlier
// before-gate (waitForFinaleCloseUp, CI run 28992396802) cured for the OTHER sample, now reproduced on the
// AFTER sample. "Camera not moving" is an UNSOUND proxy for "the reset finished": it is equally true while
// the render loop is stalled and the cut has not yet run. (Traced under a throttled repro: the reset DOES
// fire and DOES land on the vantage — the loop just resumes late; the product camera reset is correct, the
// stability proxy is the flaw.) So gate on the reset having DEMONSTRABLY taken effect: settled AND moved a
// large distance OFF the close-up. The reset travels ~241u; the pre-cut stall/creep is ≤25u; 150u sits
// cleanly between them, so a landed reset passes and a pre-cut stall never does. Throws (a REAL reset
// regression — e.g. a re-introduced finale-ease fight, or a reset that never fires — never a silent flake)
// if the camera never leaves the close-up within the timeout; the caller's toVantage<5 assertion then
// independently verifies WHERE it landed, so a reset that moves far but lands wrong is still caught.
//   STEP-0 CURRENCY (invariant tightening): the wait may span up to 12s, but the invariant under test is
// that STEP 0 OPENS on the correct stage — a reset that lands only AFTER step 0 has already played on the
// wrong camera (the f1 step-0 hold is 5000ms) or after the tour advanced/stopped would still satisfy
// "settled and >150u off the close-up" and slip through. So every poll iteration FIRST verifies the tour is
// still ON step 0 via the overlay's existing step indicator (.tour-count renders `stepIndex+1/total` — step 0
// ⟺ a leading '1/'; prefix-matched so the check is tour-length-agnostic, no new product code or DOM). If the
// indicator is gone (tour stopped/finished) or past 1/, throw with a message DISTINCT from the never-landed
// throw below: a reset arriving late is a different regression from a reset never arriving.
async function waitForTourResetOffCloseUp(page: Page, closeUp: [number, number, number]): Promise<void> {
  const EPS = 0.05
  const LEFT_CLOSE_UP = 150 // ≫ the ≤25u pre-cut stall/finale-creep, ≪ the ~241u reset travel to the vantage
  const deadline = Date.now() + 12000
  let prev = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(prev, 'camera latched for the tour-reset poll').not.toBeNull()
  while (Date.now() < deadline) {
    await page.waitForTimeout(100)
    // Step-0 currency BEFORE the landed check: a landing is only witnessed while step 0 is still current.
    // Read without auto-wait (evaluate, not a locator): a missing .tour-count means the overlay itself is
    // gone — the tour stopped/finished before the reset landed, equally a step-0-currency failure.
    const count = (await page.evaluate('document.querySelector(".tour-count")?.textContent ?? null')) as string | null
    if (count === null || !count.startsWith('1/')) {
      throw new Error(`tour left step 0 before the reset landed (tour-count read ${JSON.stringify(count)}) — step 0 must OPEN on the reset stage, not inherit it late`)
    }
    const cur = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
    expect(cur, 'camera captured during the tour-reset poll').not.toBeNull()
    const settled = Math.hypot(cur![0] - prev![0], cur![1] - prev![1], cur![2] - prev![2]) < EPS
    const offCloseUp = Math.hypot(cur![0] - closeUp[0], cur![1] - closeUp[1], cur![2] - closeUp[2])
    if (settled && offCloseUp > LEFT_CLOSE_UP) return
    prev = cur
  }
  throw new Error('tour-start reset never landed (camera never settled >150u off the finale close-up within the timeout)')
}

// Wait for a camera move to LAND on an expected vantage (v0.6). The house pattern (waitForFinaleCloseUp
// / waitForTourResetOffCloseUp): gate on a DEMONSTRATED state — the camera both SETTLED (two consecutive samples
// <EPS/100ms apart) AND arrived NEAR the target vantage — never on mere stillness (a render stall is also still).
// Used to prove the e0 query-stage tour-start reset frames the stage (stageBounds/STAGE_FRAME_OPTS): the tour
// click cuts the camera back to the core-theatre vantage, and this returns once it is provably there. Throws (a
// real reset regression, never a silent flake) if the camera never settles near the vantage within the timeout.
async function waitForCameraNear(page: Page, target: [number, number, number]): Promise<void> {
  const EPS = 0.05
  const NEAR = 2 // within 2u of the captured stage vantage = demonstrably re-framed on the core theatre
  const deadline = Date.now() + 12000
  let prev = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(prev, 'camera latched for the stage-frame poll').not.toBeNull()
  let lastDist = Infinity, lastCur = prev
  while (Date.now() < deadline) {
    await page.waitForTimeout(100)
    const cur = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
    expect(cur, 'camera captured during the stage-frame poll').not.toBeNull()
    const settled = Math.hypot(cur![0] - prev![0], cur![1] - prev![1], cur![2] - prev![2]) < EPS
    lastDist = Math.hypot(cur![0] - target[0], cur![1] - target[1], cur![2] - target[2])
    lastCur = cur
    if (settled && lastDist < NEAR) return
    prev = cur
  }
  throw new Error(`e0 tour-start never framed the stage (last Δ=${lastDist.toFixed(1)}u; cur=${lastCur!.map(n => n.toFixed(0)).join(',')}; target=${target.map(n => n.toFixed(0)).join(',')})`)
}

// Wait for a camera move to DEMONSTRABLY FIRE off a known origin (v0.6). Same false-early-stable
// trap the tour-from-finale saga closed (waitForFinaleCloseUp / waitForTourResetOffCloseUp, two hotfix rounds):
// a plain waitForCameraStable after a keypress is ALSO satisfied by a render STALL BEFORE the ease begins, so
// it samples the pre-move vantage and the following move assertion reads Δ≈0. Gate on a DEMONSTRATED state —
// settled (two consecutive samples <EPS/100ms) AND moved >minDist off `from`. Used after pressing O to prove
// the Observer's Eye preset eases the camera off the stage vantage. Throws (a real preset regression — the POV
// move never fired — never a silent flake) if the camera never settles far from `from` within the timeout.
async function waitForCameraMovedFrom(page: Page, from: [number, number, number], minDist: number): Promise<void> {
  const EPS = 0.05
  const deadline = Date.now() + 12000
  let prev = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(prev, 'camera latched for the move poll').not.toBeNull()
  let lastDist = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(100)
    const cur = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
    expect(cur, 'camera captured during the move poll').not.toBeNull()
    const settled = Math.hypot(cur![0] - prev![0], cur![1] - prev![1], cur![2] - prev![2]) < EPS
    lastDist = Math.hypot(cur![0] - from[0], cur![1] - from[1], cur![2] - from[2])
    if (settled && lastDist > minDist) return
    prev = cur
  }
  throw new Error(`camera move never fired (settled >${minDist}u off the origin was never observed; last Δ=${lastDist.toFixed(1)}u)`)
}

test('3D click at the natural-end finale selects the celebrated head and KEEPS the finale (raycast fix)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')

  // Seat the stale sphere at the origin corridor, THEN play the naive path to its natural end (8× so the
  // ~8s run completes fast + deterministically) — so the finale click genuinely exercises the fix.
  await seatEarlySphere(page)
  await page.getByRole('button', { name: '8×', exact: true }).click()
  await page.getByRole('button', { name: '▶', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 64 / 64', { timeout: 10000 })
  await expect(viewport).toHaveAttribute('data-finale', 'true')
  // Let the finale camera ease settle so the projected head position is stable at click time.
  await waitForCameraStable(page)

  const head = (await page.evaluate(PROJECT_HEAD)) as HeadProj | null
  expect(head, 'three.js scene/camera captured and head projected').not.toBeNull()
  expect(head!.onScreen, `celebrated head on-screen (world ${head!.world.join(', ')})`).toBe(true)
  await page.mouse.click(head!.x, head!.y)

  // Selection landed on the subject (?sel=1:0, colon percent-encoded) AND the finale is KEPT — select()
  // does not clear finale, so the head re-lenses SELECTED over the lit rest (v0.5b grammar).
  await expect(page).toHaveURL(/sel=1(?:%3A|:)0/)
  await expect(viewport).toHaveAttribute('data-finale', 'true')
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

test('3D click far down-corridor (paused mid-play) selects the subject after it has travelled far (raycast fix)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')

  // DEVIATIONS from the plan's "pause mid-corridor via scrub" — both forced by camera reality, verified with
  // a projection probe:
  //   1. A scrub moves ONLY the playhead, never the camera, so a scrubbed head projects wherever the mount
  //      establish frame happens to point. We PLAY then pause instead (still a mid-play pause).
  //   2. During UNSELECTED play the camera does NOT follow (follow is selected-play only; unselected
  //      mid-run presence is the known composition gap the design ruling addresses). The camera holds the
  //      establish frame, and the f1 subject's +X bulge carries it OFF the right edge through the true
  //      middle (ticks ~10-44 off-screen), curving back on-screen for the LATE corridor (ticks ~45-63).
  //      So the reachable far-corridor click is late-corridor — the drone is ~195u past the frozen tick-0
  //      sphere there, which is exactly what exercises the fix (position, not timeline-midpoint, is the point).
  // Seat the stale sphere at tick 0, then PLAY at 1× (the readout samples at 8/s, so a slow sweep makes the
  // late-corridor tick window reliably catchable; the ladder is [0.25, 1, 4, 8] — no 2×).
  await seatEarlySphere(page)
  await page.getByRole('button', { name: '1×', exact: true }).click()
  await page.getByRole('button', { name: '▶', exact: true }).click()
  // Pause in the on-screen late-corridor window (48-58) — well past the frozen sphere, well before the
  // finale (tick 64). The exact tick is not asserted (playback pace is wall-clock, not frame-deterministic).
  await expect(page.locator('.readout')).toHaveText(/^tick (?:4[89]|5[0-8]) \/ 64$/, { timeout: 10000 })
  await page.keyboard.press('Space') // Space toggles play→pause
  await expect(viewport).toHaveAttribute('data-finale', 'false') // paused mid-run, not a finale rest

  const head = (await page.evaluate(PROJECT_HEAD)) as HeadProj | null
  expect(head, 'three.js scene/camera captured and head projected').not.toBeNull()
  expect(head!.onScreen, `far-corridor head on-screen (world ${head!.world.join(', ')})`).toBe(true)
  await page.mouse.click(head!.x, head!.y)
  await expect(page).toHaveURL(/sel=1(?:%3A|:)0/)
})

// ── scrub-from-finale context re-fit (a design-ruling amendment) ─────────────────────────────
// The v0.5b spec line "clearing the finale never re-frames" stranded the f1 scrubber at the empty sky where the
// celebrated head had been (dressing cleared correctly, camera parked on the close-up → a black void). The design ruling
// reverses it NARROWLY: leaving a finale by a playhead MOVE hands back the wide establishing frame. This proves
// the camera MOVES (off the ~25u close-up to the whole-trajectory fit) — the direct anti-void assertion.
test('scrub-from-finale eases the camera to the establishing frame — the camera provably MOVES (no void)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')

  // Play the naive path (unselected f1) to its natural end so the camera lands on the composed finale close-up.
  await page.getByRole('button', { name: '8×', exact: true }).click()
  await page.getByRole('button', { name: '▶', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 64 / 64', { timeout: 10000 })
  await expect(viewport).toHaveAttribute('data-finale', 'true')
  await waitForCameraStable(page) // let the finale ease settle so the pre-scrub sample IS the resting close-up
  const beforePos = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(beforePos, 'camera captured at the finale rest').not.toBeNull()

  // Scrub the playhead back (a drag past the click threshold): clears the finale AND — per the design ruling — hands back
  // the establishing frame. The gate is store-batch causality: the scrub's setTick writes {tick, finale:false}
  // atomically, so the tick MOVED on the same run → the re-fit fires (an establish request).
  const box = (await page.locator('.timeline canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(viewport).toHaveAttribute('data-finale', 'false') // finale cleared
  await waitForCameraStable(page) // let the establish ease converge

  const afterPos = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(afterPos, 'camera captured after the scrub').not.toBeNull()
  const moved = Math.hypot(
    afterPos![0] - beforePos![0], afterPos![1] - beforePos![1], afterPos![2] - beforePos![2],
  )
  // The establishing frame (whole-trajectory fit, hundreds of u back) is far from the finale close-up, so the
  // ease is a large, unambiguous move. v0.5b stranded the camera here (delta ~0 — the void); the threshold cleanly
  // separates the ruled behaviour from the regression.
  expect(moved, `camera eased off the close-up toward the establishing frame (Δ=${moved.toFixed(2)}u)`).toBeGreaterThan(10)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── tour-start camera reset (a design ruling) ────────────────────────────────────────────────
// A guided tour's step-0 caption is authored against the CameraRig LOAD vantage, but the tour can be launched
// from ANY prior camera state. Entered from a natural-end finale, the camera was parked on the finale close-up
// (~230u down f1's corridor) and step 0 played over an empty horizon with the head stranded ~241u away — ~8s of
// the ~20s guided pitch broken (a design ruling). useTour.start() now cuts the camera to the composed load
// vantage first. This proves the from-finale entry — the money case — via the app's OWN camera: it moves a large
// distance OFF the close-up and lands on the composed default [6,4.5,9] where step 0 was authored to open.
test('tour-from-finale resets the camera to the composed load vantage (step 0 opens on the correct stage)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')

  // Play the naive path to its natural end so the camera parks on the composed finale close-up (far down-corridor).
  await page.getByRole('button', { name: '8×', exact: true }).click()
  await page.getByRole('button', { name: '▶', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 64 / 64', { timeout: 10000 })
  await expect(viewport).toHaveAttribute('data-finale', 'true')
  await waitForFinaleCloseUp(page) // NOT plain waitForCameraStable: on a slow runner that snapshots `before` mid-ease (CI run 28992396802, Δ=25.1u) — gate on genuine close-up arrival so `before` IS the ~241u resting close-up
  const before = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(before, 'camera captured at the finale rest').not.toBeNull()

  // Start the f1 tour (exact name — kept from when a second first-visit nudge button existed; the nudge
  // is now a treatment of this same button (a later design change) so exact matching is simply harmless precision).
  // A design ruling: start() cuts the camera to the load vantage so step 0's caption opens on the correct stage.
  await page.getByRole('button', { name: '▶ tour', exact: true }).click()
  await expect(page.locator('.tour-caption')).toBeVisible({ timeout: 8000 })
  // NOT plain waitForCameraStable: the cut is instant but runs in a useFrame the slow-runner render loop can
  // STALL past for hundreds of ms after the click (CI run 28993785155, Δ=25.0u) — a plain stability poll then
  // samples the FROZEN pre-cut close-up. Gate on the reset having LANDED (settled AND >150u off the close-up),
  // not on mere momentary stillness. `before` is that close-up.
  await waitForTourResetOffCloseUp(page, before as [number, number, number])

  const after = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(after, 'camera captured after the tour started').not.toBeNull()
  const moved = Math.hypot(after![0] - before![0], after![1] - before![1], after![2] - before![2])
  // The finale close-up sits ~230u+ down-corridor; the reset lands on the composed default. A large move OFF the
  // close-up (the ~241u strand the ruling names) — the anti-regression to the "caption over an empty horizon".
  expect(moved, `camera left the finale close-up (Δ=${moved.toFixed(1)}u)`).toBeGreaterThan(100)
  // …and landed ON the composed load vantage [6,4.5,9] (the stage step 0 was authored against).
  const toVantage = Math.hypot(after![0] - 6, after![1] - 4.5, after![2] - 9)
  expect(toVantage, `camera at the composed load vantage (Δ=${toVantage.toFixed(1)}u)`).toBeLessThan(5)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── the e0 QUERY-STAGE tour-start reset frames the stage ──────────────────────────────
// The e0 tour-start reset frames the query stage via stageBounds/STAGE_FRAME_OPTS (the core-theatre vantage),
// but no e2e proved the POSITIONLESS path — the existing tour-reset test above is f1/positioned only. On e0 the
// stage frame IS the CameraRig load frame, so a bare "tour lands on the stage" assertion is trivially true even
// if the reset did nothing. To make it load-bearing we PERTURB the camera off the vantage first, then prove
// the reset re-frames the stage. The perturbation is the Observer's Eye preset (press O) — a PROGRAMMATIC ease
// to the drawn observer's POV, which (unlike an orbit-drag) leaves no OrbitControls damping residual to fight
// the reset — so it doubles as browser proof that the POV preset moves the camera. Then gate on a DEMONSTRATED
// state (settled AND back on the captured vantage — the house pattern, never mere stillness).
test('the e0 POV preset moves the camera and the query tour reframes the stage', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  // The e0 CameraRig frames the core-theatre stage at load; latch that vantage as the reset target.
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  await waitForCameraStable(page)
  const vantage = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(vantage, 'camera latched at the e0 stage vantage').not.toBeNull()

  // OBSERVER'S EYE: press O to ease the camera to the drawn observer's POV (O ≈ n=−601, far off the
  // core-theatre vantage). Click the viewport first so the window keydown owner isn't swallowed by a focused
  // control, then press the key. The move is large + programmatic — no orbit-damping residual to fight the reset.
  await page.locator('#viewport canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('o')
  // NOT plain waitForCameraStable: on a slow runner a render stall BEFORE the POV ease begins satisfies mere
  // stillness and samples the pre-press vantage (Δ≈0), the exact false-early-stable flake the tour-from-finale
  // saga closed. Gate on the move having DEMONSTRABLY fired (settled AND >50u off the vantage) — the same
  // shape as waitForTourResetOffCloseUp. The assertion below then re-verifies where it landed.
  await waitForCameraMovedFrom(page, vantage as [number, number, number], 50)
  const pov = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  const movedToPov = Math.hypot(pov![0] - vantage![0], pov![1] - vantage![1], pov![2] - vantage![2])
  expect(movedToPov, `POV preset eased the camera off the stage vantage (Δ=${movedToPov.toFixed(1)}u)`).toBeGreaterThan(50)

  // Start the tour: step 0's tour-start reset re-frames the query stage. Gate on the camera DEMONSTRABLY back
  // on the captured vantage (settled AND near it), then assert it landed there.
  await page.getByRole('button', { name: '▶ tour' }).click()
  await expect(page.locator('.tour-caption')).toContainText('A real run bundle')
  await waitForCameraNear(page, vantage as [number, number, number])
  const after = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  const toVantage = Math.hypot(after![0] - vantage![0], after![1] - vantage![1], after![2] - vantage![2])
  expect(toVantage, `tour-start reframed the query stage (Δ=${toVantage.toFixed(1)}u)`).toBeLessThan(5)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── THE HANGAR + earned verdict voice ──────────────────────────────────────────────
// The run-library front door renders a card per published run. Verdict badges are SESSION-EARNED AND
// two-voice: a card wears the attested • until its run is opened this session; a VISITED FULL-MANIFEST
// run then earns the manifest-grade ✓, while a VISITED DET-ONLY run earns the SELF-CHECK • ("self-verified
// this session · no external oracle") — never the ✓ it did not earn.
test('the Hangar renders all six cards; a visited full-manifest run earns ✓, a visited det-only run earns the self-check •, an unvisited run stays attested •', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0')
  // e0's ceremony seals on load → e0 is sealed this session before we ever open the Hangar.
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })

  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  await expect(page.locator('.hangar-card')).toHaveCount(6)
  // Each run with an authored tour names its chip by the lens it launches (consumed from the TOURS
  // titles), so the three tour chips differentiate instead of reading one generic label — the ▶
  // affordance stays. exact:true pins the whole "▶ {title}" accessible name, not a substring of it.
  await expect(page.locator('.hangar-card[data-run="e0"]').getByRole('button', { name: '▶ The query stage', exact: true })).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f1"]').getByRole('button', { name: '▶ Motion lifecycle', exact: true })).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f2a"]').getByRole('button', { name: '▶ What the sensor admits', exact: true })).toBeVisible()
  // Every run WITHOUT an authored tour offers exactly one action — "open run" — and zero tour chips.
  for (const noTour of ['f0', 'f3a', 'f4']) {
    const card = page.locator(`.hangar-card[data-run="${noTour}"]`)
    await expect(card.getByRole('button')).toHaveCount(1)
    await expect(card.getByRole('button', { name: 'open run', exact: true })).toHaveCount(1)
  }
  // The disclaimer chip is the surface's thesis: the index is a map, not the authority.
  await expect(page.locator('.hangar-disclaimer')).toContainText('a tampered index can misdirect, never forge')
  // e0 (DET-ONLY) was opened this session → its card earned the SELF-CHECK voice (attested •, "self-verified this
  // session · no external oracle"), NEVER the manifest-grade ✓ (det-only surfaces carry no ✓). f0 is unvisited
  // → attested • ("certified · on record"). The label distinguishes a sealed det-only card from an unvisited one.
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-verdict.attested')).toContainText('self-verified this session')
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-verdict.verified')).toHaveCount(0) // NEGATIVE: det-only NEVER the ✓
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.attested')).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.verified')).toHaveCount(0)
  // BINDING PROHIBITION (a design ruling): no OTHER-campaign wordmark touches the published f3a card —
  // not /robust/, and not the softer "statistical-acceptance / acceptance campaign" the old scan missed.
  // Scanned with the SHARED tripwire (single-sourced), never a local literal copy.
  await expect(page.locator('.hangar-card[data-run="f3a"]')).not.toContainText(PROFILE_CONFLATION_RE)
  // f3a shows real sim duration (12.0s); the det-only e0 card keeps the assumed voice.
  await expect(page.locator('.hangar-card[data-run="f3a"] .hangar-clock')).toContainText('0:12.0')
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-clock.assumed')).toContainText('assumed')
  // Viewport (not fullPage): a fixed modal overlay composites incorrectly under a fullPage capture.
  await page.screenshot({ path: 'e2e/screenshots/task-v06-5b-hangar.png' })

  // Open f0 from its card → the Hangar closes, f0's ceremony runs and seals. Reopen → f0 now wears ✓
  // (the attested→sealed cross-surface transition — the design's cheapest delight).
  await page.locator('.hangar-card[data-run="f0"]').getByRole('button', { name: 'open run' }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.verified')).toBeVisible()
  await page.waitForTimeout(300) // let the open animation settle so the capture is the fully-painted modal
  await page.screenshot({ path: 'e2e/screenshots/task-v06-5b-hangar-sealed.png' })

  // Esc closes the modal front door (App's keydown owner modal-captures while it is open).
  await page.keyboard.press('Escape')
  await expect(page.locator('.hangar-panel')).toHaveCount(0)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── the SIM-CLOCK reads real time on published runs, assumed elsewhere ──────────────
test('the readout shows real dt_us sim time on f3a and keeps the assumed tick readout on e0', async ({ page }) => {
  // f3a pins dt_us = 125000 → 96 ticks × 125000µs = 12.0s. At tick 0 the clock reads 0:00.0 / 0:12.0.
  await page.goto('/?run=f3a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.readout')).toHaveText('0:00.0 / 0:12.0')
  // The provenance panel shows the real dt (not "(assumed)") for a full-manifest run.
  await expect(page.locator('.provenance')).toContainText('125000µs')

  // THE QUALITY REGISTER on a REAL dirty manifest: f3a self-declares dirty=true. That row now wears the register
  // — the • attested mark + a caveat note carrying the treatment class — NOT the alarm ✗ it once did. Prove BOTH
  // visible carriers end-to-end: the class interpolation AND the CSS rule (its computed effect), so a deleted
  // interpolation or a misspelled `.prov-note.caveat` rule fails HERE, not only in the unit tests.
  const dirtyRow = page.locator('.provenance tr[data-prov-key="dirty"]')
  await expect(dirtyRow).toHaveClass(/attested/)      // the on-record voice…
  await expect(dirtyRow).not.toHaveClass(/mismatch/)  // …never the alarm register
  const dirtyCaveat = dirtyRow.locator('.prov-note.caveat')
  await expect(dirtyCaveat).toHaveCount(1)            // the treatment class is really interpolated onto the note
  await expect(dirtyCaveat).toContainText('build-hygiene disclosure')
  await expect(dirtyCaveat).toContainText('non-citable under the publication contract')
  // the treatment's CSS rule actually EXISTS and APPLIES: the caveat note carries the hairline left-rule (its own
  // property), which a plain provenance note does NOT — the computed-style contrast proves the rule is live.
  const caveatBorder = await page.evaluate(`getComputedStyle(document.querySelector('.provenance tr[data-prov-key="dirty"] .prov-note.caveat')).borderLeftStyle`)
  expect(caveatBorder).toBe('solid')
  const plainBorder = await page.evaluate(`getComputedStyle(document.querySelector('.provenance tr[data-prov-key="commit"] .prov-note')).borderLeftStyle`)
  expect(plainBorder).toBe('none') // a plain attested note has no such rule — the contrast proves the treatment is the register's own
  // HUE COHERENCE: the • glyph's colour follows the row CLASS the register set (tr.attested → the slate --pending),
  // the SAME hue a plain attested row (commit) wears — so the glyph char AND its hue both follow the register mark,
  // never a badge-class split painting the • the wrong colour. (Contrast: a real ✗ integrity row is red.)
  const dirtyGlyphColor = await page.evaluate(`getComputedStyle(document.querySelector('.provenance tr[data-prov-key="dirty"] .prov-glyph')).color`)
  const attestedGlyphColor = await page.evaluate(`getComputedStyle(document.querySelector('.provenance tr[data-prov-key="commit"] .prov-glyph')).color`)
  expect(dirtyGlyphColor).toBe(attestedGlyphColor)

  await page.screenshot({ path: 'e2e/screenshots/task-v06-5b-simclock-real.png', fullPage: true })

  // e0 is det-only (KAT tier): the readout keeps the neutral tick voice — no false real-clock claim.
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })
})

// ── the query stage / honesty chip / origin anchor gate on kind-23 content ──
// buildQueryDraws never returns null (a run with no geometry queries yields an all-null seq-indexed array), so
// the old `positionless`-ALONE gate mounted the query stage — its origin-anchor octahedron + scenario solids —
// AND painted the "occluder & region bodies are scenario constants" honesty chip on f4, a positionless run whose
// event kinds carry NO kind-23 draws: the app's one FALSE claim, over phantom furniture. All three now gate on
// hasQueryDraws. THE COMMS-LENS UPDATE: f4 is no longer an empty stage — it is the CONTESTED-LINK lens (comms kinds
// 5/6/7). So the load-bearing invariant this test defends is now stated as a CONTRAST between two chips: f4
// wears the COMMS chip (its real lens) and NEVER the QUERY chip's false "scenario constants" claim; e0 wears
// the QUERY chip and never the comms one. A regression that lets the query chip paint f4's non-query stage — or
// that drops a chip wholesale — is caught by the contrast, not just a bare absence.
test('f4 (positionless, comms) wears the COMMS chip and never the query chip; e0 keeps the query chip', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/?run=f4')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  // f4 wears its OWN lens chip (the contested link) — sent & arrived decoded-real, sent-vs-arrived only…
  await expect(page.locator('.scene-chip')).toContainText('sent & arrived')
  // …and NEVER the query stage's "scenario constants" claim (the false-over-a-void claim this gate refuses).
  await expect(page.locator('#viewport')).not.toContainText('scenario constants')
  // The empty-stage rail is GONE — f4 now has a lens surface (the comms strip), not the "no stage lens" voice.
  await expect(page.locator('.comms-strip')).toBeVisible()
  await expect(page.locator('.inspector-empty')).toHaveCount(0)

  // CONTRAST — e0 IS a real query stage: the QUERY honesty chip is present with its exact wording, and it does
  // NOT wear the comms chip — proving each lens's chip is narrowed to the run it actually draws.
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer self-consistent ○', { timeout: 15000 })
  await expect(page.locator('.scene-chip')).toContainText('occluder & region bodies are scenario constants')
  await expect(page.locator('.scene-chip')).not.toContainText('sent & arrived')

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── v0.8: THE CERTIFICATION WALL — front-door entry, the zero-green rest state, and verify-all ──────────
// The Wall opens by declaring what it has NOT verified: a dim field of attested dots, ZERO integrity green,
// exact-integer census. The acceptance gate is a rest-state with no .verified dot. Then verify-all recomputes
// every seed's bytes in a real worker and the dots flip in TRUE completion order at real timing.
test('the Wall: front-door entry, a ZERO-GREEN rest state, then verify-all greens all 50 in true order', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })

  // FRONT DOOR: the Wall is reachable from the Hangar's campaign entry (the campaign expansion).
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  const campaign = page.locator('.hangar-campaign-card[data-campaign="robust-f3a"]')
  await expect(campaign).toBeVisible()
  // The campaign entry NAMES the ROBUST campaign (correct); the f3a RUN card stays clean (no conflation).
  await expect(campaign).toContainText(PROFILE_CONFLATION_RE)
  await expect(page.locator('.hangar-card[data-run="f3a"]')).not.toContainText(PROFILE_CONFLATION_RE)
  await campaign.getByRole('button', { name: 'open the wall →' }).click()

  // REST STATE — the acceptance gate: the Wall is up, ZERO integrity-green dots, the census declares 0 of 50.
  await expect(page.locator('.wall-panel')).toBeVisible()
  await expect(page.locator('.wall-dot')).toHaveCount(50)
  await expect(page.locator('.wall-dot.verified')).toHaveCount(0) // NEGATIVE: not one green before interaction
  await expect(page.locator('.wall-census')).toContainText('0 of 50 recomputed and matched here · 50 on record · 0 contradicted')
  // The ROBUST verdict rides the attested voice (on record), and the two gauges rendered from the manifest.
  await expect(page.locator('.wall-verdict.attested')).toContainText('ROBUST')
  await expect(page.locator('.wall-gauge')).toHaveCount(2)
  await page.waitForTimeout(300) // let the modal settle for a clean capture
  await page.screenshot({ path: 'e2e/screenshots/w5-wall-rest.png' })

  // VERIFY-ALL — the hero moment. Real worker, real bytes, real timing.
  await page.getByRole('button', { name: /verify all 50/ }).click()
  // Mid-verify: catch a frame where SOME (not all) dots have flipped — true completion order is visible as a
  // ragged fill, not a smooth cascade. Best-effort capture (the window is real work); not a gate assertion.
  try {
    // String form: the e2e tsconfig has no DOM lib (the house pattern — see the __scene wait above).
    await page.waitForFunction(
      '(function(){var v=document.querySelectorAll(".wall-dot.verified").length; return v>=3 && v<50})()',
      undefined, { timeout: 15000 })
    await page.screenshot({ path: 'e2e/screenshots/w5-wall-midverify.png' })
  } catch { /* verification outran the mid-frame window — the completed assertion below is the real gate */ }

  // COMPLETION: every seed recomputed-and-matched THIS session → 50 green receipts, census counts to 50.
  await expect(page.locator('.wall-census')).toContainText('50 of 50 recomputed and matched here', { timeout: 30000 })
  await expect(page.locator('.wall-dot.verified')).toHaveCount(50)
  await expect(page.locator('.wall-dot.mismatch')).toHaveCount(0)
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e/screenshots/w5-wall-complete.png' })

  // Esc closes the Wall (App's keydown owner modal-captures it, like the Hangar).
  await page.keyboard.press('Escape')
  await expect(page.locator('.wall-panel')).toHaveCount(0)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── v0.8.1: THE CERTIFICATION WALL HEADER FRONT DOOR — one header entry, the SAME open action ──────────────
// The Wall (and, inside it, the "test the seal" tamper demo) is the app's hero beat but sat 3-4 interactions
// deep behind the Hangar. A persistent header entry opens it DIRECTLY. It routes through the SAME openWall
// action the Hangar's campaign card uses (App wires both front doors to one callback — the synchronous store
// seed + keyed remount), so the header path lands the IDENTICAL rest state the Hangar path does (the front-door
// test above pins that same state via the Hangar): 50 seed dots, zero integrity green, the 0-of-50 census, the
// attested ROBUST verdict, the two gauges. And it is present regardless of which run is loaded — proven here on
// f0 (a full-manifest RUN, not the campaign), where no Hangar was ever opened.
test('the Certification Wall header entry opens the Wall directly (same zero-green rest state as the Hangar path), on any run', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=f0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })

  // The header entry is present WITHOUT any Hangar open — the persistent front door, not a surface buried behind it.
  const entry = page.getByRole('button', { name: 'certification wall', exact: true })
  await expect(entry).toBeVisible()
  await expect(page.locator('.hangar-panel')).toHaveCount(0)
  await entry.click()

  // The Wall opens DIRECTLY, in the SAME zero-green rest state the Hangar-path front-door test above pins — the
  // one open action backs both entries, so the two land byte-for-byte the same surface.
  await expect(page.locator('.wall-panel')).toBeVisible()
  await expect(page.locator('.wall-dot')).toHaveCount(50)
  await expect(page.locator('.wall-dot.verified')).toHaveCount(0) // NEGATIVE: not one green before interaction
  await expect(page.locator('.wall-census')).toContainText('0 of 50 recomputed and matched here · 50 on record · 0 contradicted')
  await expect(page.locator('.wall-verdict.attested')).toContainText('ROBUST')
  await expect(page.locator('.wall-gauge')).toHaveCount(2)
  // The tamper demo lives INSIDE the Wall — discoverability of the Wall is discoverability of both; no duplicate entry.
  await expect(page.getByRole('button', { name: /flip one byte/ })).toBeVisible()

  // Esc closes it through the same modal-capture path the Hangar-opened Wall uses.
  await page.keyboard.press('Escape')
  await expect(page.locator('.wall-panel')).toHaveCount(0)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── v0.9 THE HEADER LADDER — priority-condensation across every tier, zero horizontal overflow ──────────────
// SUPERSEDES the v0.8.1 narrow-width stopgap (the two-span "certification wall"/"wall" label swap at ≤1080px and
// its `.wall-open-full` display:none pin). The header now sheds chrome from the outside in, in a fixed priority
// order, and stays ONE row at every width: the six-run switcher collapses to a `run ▾` picker; the low-priority
// chrome (hangar, copy-link) sheds its labels to icons then folds into a `⋯` overflow menu; the wordmark word
// recedes to its mark; the cold-open verdict chip sheds its wide headline to its glyph; and at the phone floor
// the panel-toggles also fold into `⋯` and the spacing tightens. The two BRAND CTAs — the ▶ tour launcher and
// the certification-wall entry — never fold and survive at EVERY width. Breakpoints (headerModel.ts): condense
// ≤1080px, overflow ≤960px, mobile ≤640px. (The bare-cold-open + phone-floor coverage lives in its own test
// below — this one drives the deep-linked tiers.)
//
// The overflow check would FALSE-GREEN if it ran before the widest chrome existed (nav / hangar / copy-link hang
// off the async runs/index.json load), so we load at the full width and assert the widest chrome PRESENT before
// measuring anything — the precondition the v0.8.1 test established, kept and extended across the ladder's tiers.
test('the header ladder: one row with zero overflow at every tier; the run switcher, low-priority chrome, and wordmark condense while the tour + wall CTAs survive at every width', async ({ page }) => {
  const noOverflow = () => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth') // string form: the e2e tsconfig has no DOM lib

  // ── FULL TIER (1280px) — the widest chrome, asserted PRESENT before any measurement (the false-green guard). ──
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('header nav button')).toHaveCount(6)                              // all six run entries, in the button row
  await expect(page.getByRole('button', { name: 'hangar', exact: true })).toBeVisible()       // hangar, labeled
  await expect(page.locator('.header-copy')).toBeVisible()                                    // copy-link, labeled
  await expect(page.getByRole('button', { name: '▶ tour', exact: true })).toBeVisible()       // BRAND CTA: tour launcher (f2a has a tour)
  await expect(page.getByRole('button', { name: 'dismiss tour nudge' })).toBeVisible()        // the first-visit nudge ×
  await expect(page.getByRole('button', { name: 'certification wall', exact: true })).toBeVisible() // BRAND CTA: wall, FULL label
  await expect(page.locator('.evidence-open')).toHaveText('evidence table')                  // evidence table, labeled (low-priority chrome, rides the `chrome` axis)
  await expect.poll(noOverflow, { timeout: 5000, message: 'no horizontal overflow at the full tier (1280px)' }).toBe(true)

  // ── CONDENSED TIER (1080px, the picker threshold) — the switcher collapses to `run ▾`, low-priority chrome
  //    sheds labels to icons, the wall label condenses to "wall". The BRAND CTAs stay visible. ──
  await page.setViewportSize({ width: 1080, height: 720 })
  await expect(page.getByRole('button', { name: 'switch run' })).toBeVisible()                // the `run ▾` picker replaces…
  await expect(page.locator('header nav button')).toHaveCount(0)                              // …the six-button row (gone)
  await expect(page.getByRole('button', { name: '▶ tour', exact: true })).toBeVisible()       // BRAND CTA survives
  await expect(page.getByRole('button', { name: 'wall', exact: true })).toBeVisible()         // BRAND CTA survives; label condensed to "wall"
  await expect(page.getByRole('button', { name: 'certification wall', exact: true })).toHaveCount(0) // …the full label is gone at this tier
  await expect(page.getByRole('button', { name: 'copy link' })).toBeVisible()                 // copy-link sheds to its icon, accessible name kept
  await expect(page.locator('.evidence-open')).toHaveText('▦')                                // …evidence table sheds to its ▦ table mark (accessible name kept)
  await expect.poll(noOverflow, { timeout: 5000, message: 'no horizontal overflow at the condensed tier (1080px)' }).toBe(true)

  // ── OVERFLOW TIER (960px, the ⋯ threshold) — the low-priority chrome folds into `⋯`; the wordmark word
  //    recedes to its mark. The picker and BOTH brand CTAs stay inline. ──
  await page.setViewportSize({ width: 960, height: 720 })
  await expect(page.getByRole('button', { name: 'more actions' })).toBeVisible()              // the `⋯` overflow menu appears
  await expect(page.getByRole('button', { name: 'hangar', exact: true })).toHaveCount(0)      // hangar folded away (into ⋯, closed)
  await expect(page.locator('.evidence-open')).toHaveCount(0)                                 // evidence table folded away too (into ⋯, closed)
  await expect(page.getByRole('button', { name: 'switch run' })).toBeVisible()                // the picker still reachable
  await expect(page.getByRole('button', { name: '▶ tour', exact: true })).toBeVisible()       // BRAND CTA survives
  await expect(page.getByRole('button', { name: 'wall', exact: true })).toBeVisible()         // BRAND CTA survives (never folds into ⋯)
  await expect(page.locator('header h1')).toHaveClass(/sr-only/)                              // the wordmark word recedes to the mark
  await expect.poll(noOverflow, { timeout: 5000, message: 'no horizontal overflow at the overflow tier (960px)' }).toBe(true)

  // ── VERY NARROW (900px) — deep inside the overflow tier: still one row, still zero overflow, and the two
  //    brand CTAs are STILL visible (the ladder's whole promise: the hero beats never disappear). ──
  await page.setViewportSize({ width: 900, height: 720 })
  await expect(page.getByRole('button', { name: 'more actions' })).toBeVisible()
  await expect(page.getByRole('button', { name: '▶ tour', exact: true })).toBeVisible()       // BRAND CTA survives at 900px
  await expect(page.getByRole('button', { name: 'wall', exact: true })).toBeVisible()         // BRAND CTA survives at 900px
  await expect.poll(noOverflow, { timeout: 5000, message: 'no horizontal overflow at a very narrow width (900px)' }).toBe(true)
})

// The run picker is REAL, not chrome: at the condensed tier it opens and switches runs.
test('the header ladder: the `run ▾` picker opens and switches runs (condensed tier)', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 }) // condensed (≤1080, >960) → the picker, not the button row
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('header nav button')).toHaveCount(0) // the button row is condensed away
  // Open the picker and switch f2a → f0 through a menu item. A run switch unmounts the whole ready tree (a full
  // WebGL context re-init on CI's software renderer), so allow the first-paint timeout, as the run-switch tests do.
  await page.getByRole('button', { name: 'switch run' }).click()
  await page.getByRole('menuitem', { name: 'f0', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 }) // f0 tickCount = 2 — the switch landed
  await expect(page).toHaveURL(/run=f0/)
})

// The `⋯` overflow menu is REAL, not chrome: at the narrowest tier it opens and its folded items work; and
// opening a modal from it closes the menu (focus leaves the disclosure), so no stale menu lingers and the
// first Esc closes the MODAL, not a menu behind it (the modal-Esc interleave).
test('the header ladder: the `⋯` overflow menu opens, its folded hangar item works, and the menu closes when the modal takes focus', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 }) // overflow (≤960) → hangar + copy-link folded into ⋯
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'hangar', exact: true })).toHaveCount(0) // not inline — it lives in ⋯
  // Open ⋯ and activate the folded hangar item → the Hangar overlay opens (proves the folded action is live).
  await page.getByRole('button', { name: 'more actions' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  await page.getByRole('menuitem', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  await expect(page.locator('.header-menu-popup')).toHaveCount(0) // the menu closed when the modal took focus — no stale menu
  // The FIRST Esc closes the MODAL (not a menu behind it) — the interleave is coherent.
  await page.keyboard.press('Escape')
  await expect(page.locator('.hangar-panel')).toHaveCount(0)
})

// F1 — the open menu OWNS the keyboard (the modal idiom, by explicit state): transport is inert beneath it,
// Esc closes the MENU only, and the menu closes when focus leaves it; with the menu closed the transport is
// fully live again. Uses f1 (64 playable ticks) at the condensed tier so the `run ▾` picker is the switcher.
test('the header ladder: an open disclosure owns the keyboard — transport inert, Esc closes the menu only, closed → transport live', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 }) // condensed → the picker
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })

  // Open the picker. While it is open the transport is INERT: ArrowRight must NOT scrub the run beneath it.
  await page.getByRole('button', { name: 'switch run' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64') // no scrub beneath the open menu

  // Esc closes the MENU only — it does NOT also reach the transport as a deselect/scrub (the readout holds).
  await page.keyboard.press('Escape')
  await expect(page.locator('.header-menu-popup')).toHaveCount(0)
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64')

  // With the menu CLOSED the transport is fully live again: ArrowRight now steps the playhead.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.readout')).toHaveText('tick 1 / 64')

  // Close-on-focus-exit: reopen, move focus OUT of the disclosure subtree (to the help button) → the menu closes
  // (no stale-open menu whose listeners would linger behind another surface — the Tab-away / focus-departure form).
  await page.getByRole('button', { name: 'switch run' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  await page.getByRole('button', { name: 'keyboard shortcuts' }).focus()
  await expect(page.locator('.header-menu-popup')).toHaveCount(0)
})

// F2 + F3 — the bare cold open appends the verdict CHIP into the header (the TRUE widest chrome the deep-linked
// tests never exercised), and the phone floor (360-390px) must still be one row. Sweep the tight tier edges and
// the phones WITH the chip present, asserting zero overflow at each — the chip stays compact (glyph only) so its
// wide headline never enters the row.
test('the header ladder: a bare cold open keeps one row with the verdict chip present, down to the phone floor (360px)', async ({ page }) => {
  const noOverflow = () => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth') // string form: the e2e tsconfig has no DOM lib
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  // Let the auto-tour collapse the full cold-open card into the header verdict CHIP (beat 1 — f1's playback beat).
  await expect(page.locator('.tour-caption')).toContainText('Playback advances the recorded trajectory', { timeout: 15000 })
  const chip = page.locator('.thesis-chip')
  await expect(chip).toBeVisible()
  // The chip is COMPACT: its wide headline is sr-only (never in the row), leaving just the verdict glyph.
  await expect(chip.locator('.thesis-chip-verdict .sr-only')).toHaveCount(1)
  // Sweep the tier edges + the phones with the chip PRESENT — one row, zero overflow at every width. Includes
  // the full tier's narrow end (1081), both sides of the overflow floor (961/960) and the mobile floor (641/640),
  // and three phone widths (390/375/360).
  for (const w of [1081, 1080, 961, 960, 641, 640, 390, 375, 360]) {
    await page.setViewportSize({ width: w, height: 720 })
    await expect(chip).toBeVisible() // the chip persists across resizes (a latched cold-open surface)
    // POLL until the resize re-render SETTLES: the ladder re-renders on the resize event, so a raw read can
    // catch the wider previous tier mid-transition (the tier boundaries shrink the content monotonically, so
    // a settled fit is the true steady state). A genuine overflow never settles and still fails the poll.
    await expect.poll(noOverflow, { timeout: 5000, message: `no horizontal overflow at ${w}px with the cold-open verdict chip present` }).toBe(true)
  }
})

// F4 — a disclosure opened over the cold-open CARD must paint ABOVE it (the header lifts into its own stacking
// layer while open — the app layers overlays by z-index, no portal idiom — above the card's z-47, below the
// modals' z-50), and its items must be clickable over the card.
test('the header ladder: a disclosure opens ABOVE the cold-open card and its items are clickable (stacking-context raise)', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 }) // condensed → the picker exists AND the full card is up
  await page.goto('/')
  const card = page.locator('.thesis-card')
  await expect(card).toBeVisible({ timeout: 15000 }) // beat 0 — the full card is up (z-47)
  // Escape stops the auto-tour at beat 0 but KEEPS the card (the share weapon survives the interrupt) — a stable
  // state to open a menu over.
  await page.keyboard.press('Escape')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
  await expect(card).toBeVisible()

  await page.getByRole('button', { name: 'switch run' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  // The header is lifted into its own stacking layer while a disclosure is open (49: above the card's 47, below
  // the modals' 50) — the direct proof of the fix.
  const headerZ = await page.evaluate('getComputedStyle(document.querySelector("header")).zIndex')
  expect(Number(headerZ), 'the header is raised above the cold-open card while a disclosure is open').toBe(49)
  // Paint order: elementFromPoint at the popup's own centre returns the popup (or a descendant) — nothing paints over it.
  const onTop = await page.evaluate(`(() => {
    const r = document.querySelector('.header-menu-popup').getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!el && !!el.closest('.header-menu-popup')
  })()`)
  expect(onTop, 'the popup paints above the cold-open card').toBe(true)
  // …and a folded item is clickable over the card: switch runs to prove it (f0 → tick 0 / 2).
  await page.getByRole('menuitem', { name: 'f0', exact: true }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
})

// F1 (closure) — keyboard ownership is IDENTITY-KEYED, so a tier change that mounts a SECOND disclosure
// beneath the open one cannot steal the first's claim. Open the picker at 1000px → resize to 960px (the ⋯
// overflow menu mounts while the picker stays open) → the picker must KEEP the keyboard: K does not toggle
// playback and the menu stays open.
test('the header ladder: keyboard ownership survives a tier change — the open picker keeps it when the ⋯ menu mounts beneath', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 }) // condensed → the picker (the ⋯ is not yet mounted)
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  await page.getByRole('button', { name: 'switch run' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  // Cross the overflow boundary: the ⋯ overflow menu MOUNTS (a second HeaderMenu instance) while the picker
  // stays mounted AND open. The ⋯ mount must NOT clear the picker's ownership token (identity-conditional).
  await page.setViewportSize({ width: 960, height: 720 })
  await expect(page.getByRole('button', { name: 'more actions' })).toBeVisible() // the ⋯ mounted…
  await expect(page.locator('.header-menu-popup')).toBeVisible()                  // …and the picker is STILL open
  // Shift+Tab from the item to the picker trigger (focus stays in the disclosure subtree → menu stays open),
  // then press K (the play toggle). The picker still OWNS the keyboard, so K is swallowed: no playback.
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('KeyK')
  await expect(page.locator('.header-menu-popup')).toBeVisible() // the menu remains open
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64') // transport unchanged — K did not toggle play
})

// F2 (closure) — a folded action restores focus to the ⋯ trigger BEFORE the modal/panel opens, so the modal
// snapshots the trigger (not document.body) as its opener and returns focus there on close; a panel action
// leaves focus on the trigger, never on body. Run at the phone floor where the ⋯ holds both kinds of item.
test('the header ladder: a folded action restores focus to the ⋯ trigger (the modal snapshots it; a panel action never lands on body)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 }) // mobile → ⋯ holds hangar + copy + the two panel toggles
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  const trigger = page.getByRole('button', { name: 'more actions' })
  const focusName = () => page.evaluate('document.activeElement && document.activeElement.getAttribute("aria-label")')

  // Hangar via ⋯: the item restores focus to the ⋯ trigger before opening the Hangar, so the Hangar snapshots
  // the trigger as its opener — and its Esc returns focus THERE (the Hangar restores its opener on close).
  await trigger.click()
  await page.getByRole('menuitem', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.hangar-panel')).toHaveCount(0)
  expect(await focusName(), 'focus returns to the ⋯ trigger after the Hangar closes (never body)').toBe('more actions')

  // A mobile panel action: opening the agent panel closes the ⋯ and leaves focus on the ⋯ trigger, never body.
  await trigger.click()
  await page.getByRole('menuitem', { name: 'agent panel', exact: true }).click()
  await expect(page.locator('.inspector.open')).toBeVisible()
  expect(await focusName(), 'focus stays on the ⋯ trigger after a panel action (never body)').toBe('more actions')
})

// F3 (closure) — the OPEN ⋯ popup must stay within a phone viewport in the REAL widest state: a FRESH deep
// link (Playwright isolates storage per test) still shows the tour nudge, pushing the ⋯ trigger far right, so
// a left-anchored popup would open off-screen. Right-anchored, it opens INTO the viewport. Measured with the
// menu OPEN, and both folded panel toggles activated from inside it.
test('the header ladder: at a phone width with the tour nudge present, the OPEN ⋯ popup stays within the viewport and its folded panel toggles work', async ({ page }) => {
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 720 })
    await page.goto('/?run=f2a') // a deep link with fresh (isolated) storage → the first-visit tour nudge is PRESENT
    await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
    await expect(page.getByRole('button', { name: 'dismiss tour nudge' })).toBeVisible() // the real widest state (nudge present)
    // OPEN the ⋯: the right-anchored popup AND the document must both stay within the viewport.
    await page.getByRole('button', { name: 'more actions' }).click()
    await expect(page.locator('.header-menu-popup')).toBeVisible()
    const box = await page.evaluate(`(() => {
      const r = document.querySelector('.header-menu-popup').getBoundingClientRect()
      return { left: r.left, right: r.right, iw: window.innerWidth, scrollW: document.documentElement.scrollWidth }
    })()`) as { left: number; right: number; iw: number; scrollW: number }
    expect(box.left, `the open ⋯ popup's left edge is within the viewport at ${w}px`).toBeGreaterThanOrEqual(0)
    expect(box.right, `the open ⋯ popup's right edge is within the viewport at ${w}px`).toBeLessThanOrEqual(box.iw)
    expect(box.scrollW <= box.iw, `no document overflow with the ⋯ open at ${w}px`).toBe(true)
    // ACTIVATE both folded panel toggles from inside the popup — the agent panel, then the provenance panel.
    await page.getByRole('menuitem', { name: 'agent panel', exact: true }).click()
    await expect(page.locator('.inspector.open')).toBeVisible()
    await page.getByRole('button', { name: 'more actions' }).click()
    await page.getByRole('menuitem', { name: 'provenance panel', exact: true }).click()
    await expect(page.locator('.provenance.open')).toBeVisible()
  }
})

// The run picker carries UNSIGNED runs/index.json ids — a hostile long id must not escape the left-anchored
// popup at a phone width (horizontal scroll + unreachable choices). Stub the index (no existing idiom, so a
// page.route intercept — the index is a single memoized fetch) to inject a 64-char id, OPEN the picker at 360
// AND 375, and assert the popup box, every item box, and the document scrollWidth all stay within the
// viewport (the id ellipsizes, never extends the box), and the hostile item is still activatable.
const HOSTILE_ID = 'a'.repeat(64) // an unsigned, URL-safe long id — ~448px of text, far past any phone width
test('the header ladder: a hostile long run id ellipsizes inside the picker and never escapes the viewport (360/375), and stays activatable', async ({ page }) => {
  // Inject the long id into the index (its base points at a real bundle; we assert the SWITCH fires, not the
  // load). route persists for the page's lifetime, so one registration covers both goto()s in the loop.
  await page.route('**/runs/index.json', async (route) => {
    const runs = await route.fetch().then(r => r.json()) as unknown[]
    runs.push({ id: HOSTILE_ID, title: 'hostile long id', base: 'runs/f0', ticks: 2, kinds: {} })
    await route.fulfill({ json: runs })
  })
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 720 })
    await page.goto('/?run=f2a')
    await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
    // OPEN the PICKER (the left-anchored disclosure that carries the run ids).
    await page.getByRole('button', { name: 'switch run' }).click()
    await expect(page.locator('.header-menu-popup')).toBeVisible()
    // the hostile item must be PRESENT (the index injection took) and its accessible name is the FULL id.
    await expect(page.getByRole('menuitem', { name: HOSTILE_ID, exact: true })).toBeVisible()
    // the popup box, EVERY item box, and the document must all stay within the viewport.
    const box = await page.evaluate(`(() => {
      const iw = window.innerWidth
      const pop = document.querySelector('.header-menu-popup').getBoundingClientRect()
      const items = Array.from(document.querySelectorAll('.header-menu-popup .header-menu-item')).map(el => el.getBoundingClientRect())
      const rights = [pop.right, ...items.map(r => r.right)]
      const lefts = [pop.left, ...items.map(r => r.left)]
      return { minLeft: Math.min(...lefts), maxRight: Math.max(...rights), iw, scrollW: document.documentElement.scrollWidth }
    })()`) as { minLeft: number; maxRight: number; iw: number; scrollW: number }
    expect(box.minLeft, `picker popup + items left edge within the viewport at ${w}px`).toBeGreaterThanOrEqual(0)
    expect(box.maxRight, `picker popup + items right edge within the viewport at ${w}px`).toBeLessThanOrEqual(box.iw)
    expect(box.scrollW <= box.iw, `no document overflow with the picker open (hostile id) at ${w}px`).toBe(true)
    // …and the hostile item is still ACTIVATABLE — clicking it fires the switch (the URL updates to the id).
    await page.getByRole('menuitem', { name: HOSTILE_ID, exact: true }).click()
    await expect(page).toHaveURL(new RegExp('run=' + HOSTILE_ID))
  }
})

// The Wall re-earns from zero: reopening after a completed verify shows a fresh ZERO-GREEN rest state (a ✓
// dies when you leave and is re-earned — no persisted/cached receipts).
test('the Wall re-earns: reopening after a full verify is back to zero green (receipts are session-only)', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await page.locator('.hangar-campaign-card[data-campaign="robust-f3a"]').getByRole('button', { name: 'open the wall →' }).click()
  await expect(page.locator('.wall-panel')).toBeVisible()
  await page.getByRole('button', { name: /verify all 50/ }).click()
  await expect(page.locator('.wall-census')).toContainText('50 of 50 recomputed and matched here', { timeout: 30000 })
  // Leave the view (cancels + resets the campaign store) and reopen → a true rest state, zero green.
  await page.keyboard.press('Escape')
  await expect(page.locator('.wall-panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await page.locator('.hangar-campaign-card[data-campaign="robust-f3a"]').getByRole('button', { name: 'open the wall →' }).click()
  await expect(page.locator('.wall-panel')).toBeVisible()
  await expect(page.locator('.wall-dot.verified')).toHaveCount(0)
  await expect(page.locator('.wall-census')).toContainText('0 of 50 recomputed and matched here')
})

// ── v0.8: THE TAMPER MOMENT — the ✗ path made demonstrable ──────────────────────────────────────────────
// Every shipped bundle verifies green, so the REFUSAL machinery was invisible. The Wall's tamper demo fetches ONE
// certified bundle (seed 42), verifies its pristine bytes, flips ONE byte of a recorded MEASUREMENT in a browser-
// memory clone, and re-verifies — painting the pristine chain (✓ external pins beside ○ trailer-self rings) beside
// the tampered refusal (event_hash ✗ cascading to result_id ✗). This is DOM, not WebGL (SwiftShader-safe). The
// honesty rail: the demo NEVER enters the census.
test('the Wall tamper demo: flip one byte → the side-by-side refusal (event_hash ✗ cascades to result_id ✗)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })

  // Open the Wall through the front door.
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await page.locator('.hangar-campaign-card[data-campaign="robust-f3a"]').getByRole('button', { name: 'open the wall →' }).click()
  await expect(page.locator('.wall-panel')).toBeVisible()

  // The census is at rest — and it must STAY at rest through the demo (the isolation rail: the demo's tampered
  // verdict never enters the session census). Capture it before.
  await expect(page.locator('.wall-census')).toContainText('0 of 50 recomputed and matched here · 50 on record · 0 contradicted')

  // FLIP ONE BYTE — the skeptic's ten seconds. (auto-scrolls the CTA into view.)
  await page.getByRole('button', { name: /flip one byte/ }).click()
  await expect(page.locator('.tamper-result')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.tamper-col')).toHaveCount(2)

  // PRISTINE column: the verified voice; zero red. The seven-pin chain reads honestly — 3 external ✓ pins
  // (result_id / case_id / bundle sha-256) beside 4 trailer-self ○ rings (event_hash / state hash / counts).
  const published = page.locator('.tamper-col').nth(0)
  await expect(published.locator('.tamper-verdict.verified')).toBeVisible()
  await expect(published.locator('.tamper-row.verified')).toHaveCount(3)
  await expect(published.locator('.tamper-row.self')).toHaveCount(4)
  await expect(published.locator('.tamper-row.mismatch')).toHaveCount(0)

  // TAMPERED column: the mismatch voice, and the CASCADE — event_hash ✗ → result_id ✗ (bundle sha-256 ✗ too);
  // the untouched fields stay ✓ (surgical, not a blanket refusal).
  const flipped = page.locator('.tamper-col').nth(1)
  await expect(flipped.locator('.tamper-verdict.mismatch')).toBeVisible()
  await expect(flipped.locator('.tamper-row.mismatch')).toHaveCount(3)
  await expect(flipped.locator('.tamper-row.mismatch').filter({ hasText: 'event_hash' })).toHaveCount(1)
  await expect(flipped.locator('.tamper-row.mismatch').filter({ hasText: 'result_id' })).toHaveCount(1)
  await expect(flipped.locator('.tamper-row.verified').filter({ hasText: 'case_id' })).toHaveCount(1)

  // ISOLATION: the session census is untouched — the demo lives in its own ephemeral state, never the rollup.
  await expect(page.locator('.wall-census')).toContainText('0 of 50 recomputed and matched here · 50 on record · 0 contradicted')

  // BROWSER EVIDENCE — the side-by-side refusal.
  await page.locator('.tamper-result').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e/screenshots/w6-tamper.png' })

  await page.keyboard.press('Escape')
  await expect(page.locator('.wall-panel')).toHaveCount(0)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// Latch the live COMMS scene the first time an OctahedronGeometry mesh is present (the pads/anchor). The
// CAPTURE_SCENE cone latch never fires for positionless f4 (no cones), so the comms hero needs its own
// structural latch. Same __THREE_DEVTOOLS__ observe hook; browser source as a STRING (the e2e tsconfig has no
// DOM lib — the house pattern).
const CAPTURE_COMMS_SCENE = `(() => {
  const dt = new EventTarget()
  window.__THREE_DEVTOOLS__ = dt
  dt.addEventListener('observe', (e) => {
    const renderer = e.detail
    if (!renderer || typeof renderer.render !== 'function' || renderer.__wrapped) return
    renderer.__wrapped = true
    const orig = renderer.render.bind(renderer)
    renderer.render = (scene, camera) => {
      if (scene && scene.isScene && !window.__sceneLocked) {
        let hasOcta = false
        scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'OctahedronGeometry') hasOcta = true })
        if (hasOcta) { window.__scene = scene; window.__sceneLocked = true }
      }
      return orig(scene, camera)
    }
  })
})()`

// Read the anchor's SDF label off the live scene: find the troika Text (a mesh carrying a NON-EMPTY .text — the
// empty entity-plate Text, if any, is skipped) and report its text + its EFFECTIVE visibility (visible only if it
// and every ancestor up to the scene root are visible — the anchor group toggles the whole subtree). Null until latched.
const ANCHOR_LABEL_STATE = `(() => {
  const scene = window.__scene
  if (!scene) return null
  let label = null
  scene.traverse((o) => { if (o.isMesh && typeof o.text === 'string' && o.text.length > 0) label = o })
  if (!label) return { found: false, visible: false, text: '' }
  let visible = true
  for (let n = label; n && n !== scene; n = n.parent) { if (!n.visible) { visible = false; break } }
  return { found: true, visible: visible, text: label.text }
})()`

// ── THE CONTESTED LINK (f4) — the one lost packet: the ledger-by-scrub, the t30 anchor, the cold entry ─────
// The hero beat of the v0.9 cycle: a steady link, proven honest, and the ONE packet you can point at. This
// drives the EVIDENTIARY hero end-to-end (the ledger written by the scrub, the flagged gap that appears at
// t30 and persists, a cold deep-link that lands on the anchor). The 3D bloom itself is the stage's visual
// emphasis (proven sub-/super-threshold in commsStageView.test.ts); here we assert the DOM-observable truth
// PLUS the anchor's decoded SDF label at rest (read through the scene-graph hook, since troika text is WebGL).
test('f4 the contested link: the ledger is written by the scrub, the t30 loss anchors, and a cold deep-link shows it', async ({ page }) => {
  await page.addInitScript(CAPTURE_COMMS_SCENE) // latch the comms scene so the anchor's SDF label is readable at the end
  // Open f4 at rest — the comms strip mounts, the honesty chip is up, the ledger starts empty.
  await page.goto('/?run=f4&tick=0')
  const strip = page.locator('.comms-strip')
  await expect(strip).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '0/0/0')
  // The honesty chip names the lens honestly: sent & arrived decoded-real, placement presentational, sent-vs-arrived.
  await expect(page.locator('.scene-chip')).toContainText('sent & arrived')

  // JUST BEFORE the loss (tick 29): 14 sent · 14 delivered · 0 lost — the drop is NOT-YET (no gap mark yet).
  await page.goto('/?run=f4&tick=29')
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '14/14/0', { timeout: 15000 })
  await expect(page.locator('.comms-lane-drop')).toHaveCount(0)
  await expect(page.locator('.comms-lane-notyet')).toBeVisible()

  // Scrub to t30 with a real gesture (ArrowRight): the ledger ticks 1 lost, and the flagged gap appears.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '15/14/1')
  const drop = page.locator('.comms-lane-drop')
  await expect(drop).toBeVisible()
  await expect(drop).toHaveClass(/caveat/)        // the quality register treatment…
  await expect(drop).not.toHaveClass(/mismatch/)  // …NEVER the integrity alarm

  // The anchor PERSISTS as the viewer scrubs past it (the viewer can always find the loss again).
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.comms-lane-drop')).toBeVisible()

  // COLD ENTRY: a deep-link straight to t30 lands on the anchor with no scrubbing.
  await page.goto('/?run=f4&tick=30')
  await expect(page.locator('.comms-lane-drop')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '15/14/1')

  // FULL REVEAL (tick 64 — past the last send): the run's final tally, and the pairing wears the ○ ring.
  await page.goto('/?run=f4&tick=64')
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '32/31/1', { timeout: 15000 })
  await expect(page.locator('.comms-pairing')).toContainText('○')  // ○ decoded-consistency ring…
  await expect(strip).not.toContainText('✓')                       // …NEVER the manifest-grade ✓
  await expect(strip).not.toContainText('✗')                       // …and never the integrity alarm

  // THE ANCHOR NAMES THE LOSS (hero-check §4): at rest after the run end the persistent anchor wears its DECODED
  // "t30 · LOSS" SDF label — the resting stage points at the loss on its own, not only in the strip text. The
  // label is troika WebGL text (read through the scene-graph hook); the exact string is derived + pinned in the unit test.
  await page.waitForFunction(`(() => { const s = ${ANCHOR_LABEL_STATE}; return !!(s && s.found && s.visible); })()`, undefined, { timeout: 15000 })
  const labelState = await page.evaluate(ANCHOR_LABEL_STATE) as { found: boolean; visible: boolean; text: string } | null
  expect(labelState?.text, 'the anchor names the loss with the DECODED tick · reason, shown at rest after the run end').toBe('t30 · LOSS')
})

// THE BINDING GPU RULE — the pulses are PRECOMPILED (instanced attributes) and UNIFORM-DRIVEN (the playhead), so
// NO shader program compiles during playback. The old InstancedMesh + setColorAt path allocated instanceColor on
// the FIRST active pulse and compiled the instancing-COLOUR shader variant right then — a compile hitch at the t2
// crossing. This probes it at the strongest browser level available: renderer.info.programs.length (the WebGL
// program cache, read through the app's OWN renderer via the __THREE_DEVTOOLS__ observe hook — the CAPTURE_SCENE
// house pattern) must be STABLE across a play-from-0 sweep past the first pulse. A lazy compile would grow it; the
// precompiled ShaderMaterial (warmed at gl.compile) does not. Browser source is passed as STRINGS (the e2e
// tsconfig excludes the DOM lib — the same reason PROJECT_HEAD et al. are strings).
test('f4 warmup: no shader program compiles during a play-from-0 sweep past the first pulse (precompiled + uniform-driven)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE) // installs the devtools observe hook → window.__renderer on renderer create
  await page.goto('/?run=f4&tick=0')
  await expect(page.locator('.comms-strip')).toBeVisible({ timeout: 15000 })
  // Wait for the app's renderer AND a settle, so the composer's own Bloom/ToneMapping passes — which warm on the
  // first COMPOSITE, not gl.compile — are already compiled and counted in the baseline (not what this probe measures).
  await page.waitForFunction('window.__renderer && window.__renderer.info', { timeout: 15000 })
  await page.waitForTimeout(700)
  const programsAt = async () => (await page.evaluate('window.__renderer.info.programs.length')) as number
  const before = await programsAt()
  expect(before, 'the pulse ShaderMaterial + composer passes compiled at warmup (a non-empty program cache)').toBeGreaterThan(0)
  // PLAY FROM 0 — clicking the transport's play button starts the sweep; the playhead crosses t2 (the first
  // delivered pulse's window). The ledger advancing off 0/0/0 proves the sweep is underway (the first send revealed).
  await page.locator('.timeline button').first().click()
  await expect(page.locator('.comms-ledger')).not.toHaveAttribute('data-comms-ledger', '0/0/0', { timeout: 15000 })
  await page.waitForTimeout(700) // let a few more pulse windows open/close during live playback
  const after = await programsAt()
  expect(after, 'NO new program compiled during playback — the pulses are precompiled + uniform-driven').toBe(before)
})

// ── THE RAW EVIDENCE TABLE (the byte-X-ray): the interrogation surface, universal across all six runs ──
test('the raw evidence table: opens from the header, filters to the ONE dropped packet, and a row-click deep-links the selection', async ({ page }) => {
  await page.goto('/?run=f4&tick=64') // full reveal — whole-run and revealed agree on the final tally
  await expect(page.locator('.comms-strip')).toBeVisible({ timeout: 15000 })
  // the header entry (full tier) opens the modal — a peer to the Hangar/Wall (the same overlay idiom)
  await page.getByRole('button', { name: 'evidence table', exact: true }).click()
  const panel = page.locator('.evidence-panel')
  await expect(panel).toBeVisible()
  // provenance: the table names its mechanism (decoded rendering) — it claims nothing, it SHOWS
  await expect(panel.locator('.evidence-provenance')).toHaveText('every row decoded from the bundle in your browser')
  // whole-run scope by default: 64 comms events, one row each, the population named
  await expect(panel.locator('[data-evidence-count]')).toHaveText('64 events')
  await expect(panel.locator('tbody tr.evidence-row')).toHaveCount(64)
  // filter to kind 7 (MessageDropped): the ONE drop row remains; the readout names the filtered population
  await panel.locator('.evidence-kind-chip[data-kind="7"]').click()
  await expect(panel.locator('tbody tr.evidence-row')).toHaveCount(1)
  await expect(panel.locator('[data-evidence-count]')).toHaveText('64 events · 1 shown')
  // the drop row shows its true decoded fields (msg 14, reason 3 LOSS, jam_state 0) — decoded bytes, no verdict
  const drop = panel.locator('tbody tr.evidence-row').first()
  await expect(drop.locator('.evidence-payload')).toContainText('msg=14')
  await expect(drop.locator('.evidence-payload')).toContainText('reason=3')
  await expect(drop.locator('.evidence-payload')).toContainText('jam_state=0')
  // the rounded snr_db is reachable by KEYBOARD: focus its disclosure and activate it → the exact f64 appears
  // in accessible DOM (not a mouse-only title). This inspects the value; it does NOT select or close the modal.
  const snr = drop.locator('.evidence-field-btn') // the ONE lossy field on the drop row (snr_db=12.0412)
  await snr.focus()
  await page.keyboard.press('Enter')
  await expect(drop.locator('.evidence-field-full')).toHaveText('(12.041199826559248)')
  await expect(panel).toBeVisible() // inspecting the value did not close the modal
  // clicking the row's seq button routes through the ONE select path: it deep-links (?ev=) and closes the table
  await drop.locator('.evidence-rowbtn').click()
  await expect(page.locator('.evidence-panel')).toHaveCount(0)
  await expect(page).toHaveURL(/ev=/)
})

test('the raw evidence table: scope is labeled and honest — whole run vs revealed-so-far at a mid playhead', async ({ page }) => {
  await page.goto('/?run=f4&tick=30') // the playhead at the loss: the ledger reads 15/14/1 → 30 of 64 events revealed
  await expect(page.locator('.comms-ledger')).toHaveAttribute('data-comms-ledger', '15/14/1', { timeout: 15000 })
  await page.getByRole('button', { name: 'evidence table', exact: true }).click()
  const panel = page.locator('.evidence-panel')
  await expect(panel).toBeVisible()
  // whole run (default): the labeled scope names the full population; all 64 rows present
  await expect(panel.locator('.evidence-scope-btn').first()).toHaveText('whole run · 64 events')
  await expect(panel.locator('[data-evidence-count]')).toHaveText('64 events')
  await expect(panel.locator('tbody tr.evidence-row')).toHaveCount(64)
  // the revealed-so-far option names its OWN population (30 of 64), driven by the shared reveal clock
  const revealed = panel.locator('.evidence-scope-btn').nth(1)
  await expect(revealed).toHaveText('revealed so far · 30 of 64')
  await revealed.click()
  await expect(panel.locator('tbody tr.evidence-row')).toHaveCount(30) // truncated to the tick ≤ playhead prefix
  await expect(panel.locator('[data-evidence-count]')).toHaveText('30 events')
})

test('the raw evidence table: folded into the ⋯ overflow at a narrow width, its menuitem opens the modal (rides the chrome axis)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 }) // overflow tier → the evidence entry folds into ⋯
  await page.goto('/?run=f2a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.evidence-open')).toHaveCount(0) // not inline — it lives in ⋯
  await page.getByRole('button', { name: 'more actions' }).click()
  await expect(page.locator('.header-menu-popup')).toBeVisible()
  await page.getByRole('menuitem', { name: 'evidence table', exact: true }).click()
  await expect(page.locator('.evidence-panel')).toBeVisible()
  // the modal takes focus, so the ⋯ menu closes behind it (no stale menu) — the first Esc closes the MODAL
  await expect(page.locator('.header-menu-popup')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.evidence-panel')).toHaveCount(0)
})

// ── THE BELIEF LENS (f3a): the shrinking disc, the growing error, decoded and honest ───────────────────────
// The ONE belief journey: open f3a, read the current 1σ at tick 2 (the widest disc), scrub to the end, and confirm
// the reported confidence TIGHTENED (1σ → 0.44 m) while the ACTUAL error against the decoded truth GREW past it — the
// truth leaves the disc, the tracker overconfident. The strip's stated 1σ + error (data-track-sigma / -error) are the
// legible, deterministic signals (the ring's radius / the gap-line length ARE those numbers; unit-pinned). The chip
// carries the honesty contract: a REAL belief-vs-reality comparison, both halves decoded.
test('f3a belief lens: the reported 1σ shrinks while the actual error grows — a decoded belief-vs-reality comparison', async ({ page }) => {
  await page.goto('/?run=f3a&tick=2')
  // f3a carries a manifest (real sim clock), so the readout shows mm:ss.s and the tick lives in its title — the
  // load/deep-link gate is the title reading tick 2 / 96 (tickCount 96).
  await expect(page.locator('.readout')).toHaveAttribute('title', 'tick 2 / 96', { timeout: 15000 })
  // THE HONESTY CHIP — the belief lens's contract: the ring is the tracker's decoded estimate, the drone the decoded
  // state truth, the gap the actual error — a REAL belief-vs-reality comparison. The chip self-gates on
  // trackBeliefApplies (f3a only), so exactly this text is present.
  const chip = page.locator('.scene-chip')
  await expect(chip).toContainText('tracker', { timeout: 15000 })
  await expect(chip).toContainText('state truth')
  await expect(chip).toContainText('belief-vs-reality')
  await expect(chip).toContainText('1.83 m → 0.44 m')       // the reported 1σ shrink
  await expect(chip).toContainText('0.23 m → 2.43 m')       // …while the actual error grows
  // THE STRIP — a live playhead instrument with no selection (the belief run owns the aside). At tick 2 the current
  // 1σ is the widest disc (~1.83 m), stated as a disc (isotropic).
  const sigma = page.locator('.track-sigma')
  await expect(sigma).toContainText('1σ 1.83 m', { timeout: 15000 })
  await expect(sigma).toContainText('disc')
  const early = Number(await sigma.getAttribute('data-track-sigma'))
  expect(early, 'the widest disc at the first update').toBeCloseTo(1.826, 2)
  // SCRUB TO THE END — a timeline drag to the far right moves the playhead well past the last update (tick 79), so
  // the current disc is the tightest the tracker ever reported AND the error is at its worst.
  const box = (await page.locator('.timeline canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.98, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  // THE DISC HAS SHRUNK — the reveal discipline, end-to-end: the tracker's reported 1σ tightened to ~0.44 m.
  await expect(sigma).toContainText('1σ 0.44 m', { timeout: 10000 })
  const late = Number(await sigma.getAttribute('data-track-sigma'))
  expect(late, 'the tightest disc at the end of the track').toBeCloseTo(0.443, 2)
  expect(late, 'the disc visibly tightened — the filter reported gaining confidence').toBeLessThan(early)
  // …BUT the actual error grew past the disc — the truth is OUTSIDE the 1σ (overconfident), the decoded gap ~2.43 m.
  const err = page.locator('.track-error')
  await expect(err).toContainText('error 2.43 m')
  await expect(err).toContainText('OUTSIDE the disc')
  await expect(err).toContainText('overconfident')
  // …and the belief lens never mints a verdict glyph (it is a derivation, not an adjudication).
  const stripText = (await page.locator('.track-strip').textContent()) ?? ''
  for (const glyph of ['✓', '✗', '○']) expect(stripText, `no ${glyph} in the belief strip`).not.toContain(glyph)
})
