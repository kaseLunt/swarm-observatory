import { expect, test, type Page } from '@playwright/test'
// The profile-conflation tripwire, imported from THE single source (closure item 2) — the same binding
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
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.provenance')).toContainText('(det-only)')
  await expect(page.locator('.counts')).toContainText('75 events · 75 ticks')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75')
  // Honesty (I2 false-green fix; F1 voice): a det-only run carries NO manifest claims, so NO claim row may
  // paint a false green. Discriminating selector = the case_id row: it is a trailer-SOURCED value (read from
  // the trailer, never recomputed against anything), so it wears the ATTESTED voice (•, 'attested'), never
  // 'verified' — and never the ○ self-check ring the trailer-reproduced hash rows earn (F1: a value with no
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

test('run switch clears a carried selection and leaks no stale ev into the new URL (I3)', async ({ page }) => {
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
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
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
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await page.getByRole('button', { name: '▶ tour' }).click()
  await expect(page.locator('.tour-caption')).toContainText('A real run bundle')
  // The advance into the 'exact replay' caption is gated by the FIRST caption's holdMs (tours.ts e0-hero,
  // now 7300ms after the §5 reading-window resize — was 5500). The auto-retrying assertion polls until the
  // scheduler's holdElapsed dispatch fires and advances the state machine — proving auto-advance, not just
  // the initial caption paint — without a hard `waitForTimeout`. Timeout 12000 (was 8000) sits comfortably
  // above the 7300ms hold + tour-start latency so the resize does not race the poll on a slow runner.
  await expect(page.locator('.tour-caption')).toContainText('exact replay', { timeout: 12000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
})

// ── Task v04-7: cold open, discoverability, witnessable playback ─────────────────────────────────────

// ── Task v0.6 T6: ZERO-CLICK THESIS on the cold open ──────────────────────────────────────────────────
// CONSCIOUS REWRITE (disclosed in the T6 report): the v0.4-7 cold-open test asserted the first-visit tour
// NUDGE treatment on a bare `/`. T6 (P2) replaces that first-visit cold-open experience with the ZERO-CLICK
// THESIS: a bare cold open opens the thesis card AND auto-plays the first tour beat. The nudge PRECEDENT is
// preserved verbatim — it still governs the DEEP-LINK first-visit path (see the ?run=e0 tour tests above,
// which still see the launcher) — and the auto-play retires that same NUDGE_KEY, so a returning visit is calm.
// Only the BARE cold open changed; every ?run= test is untouched (a deep link is never a cold open).
test('cold open: the zero-click thesis card + auto-played first tour beat; an interrupt keeps the card; a returning visit is calm', async ({ page }) => {
  // HERO SWITCH (dev/v0.6): a bare `/` now boots f1 (the cold-open star — a moving vehicle) not e0. f1 is a
  // golden DET-ONLY run, so its honesty voice is the SELF-CHECK (○), NOT the manifest-grade ✓ (two-voice truth,
  // F5/F6: self-check ≠ verified) — its trailer reproduces its own sealed hashes, but no external manifest backs it.
  await page.goto('/')
  await expect(page.locator('.provenance')).toContainText('(det-only)', { timeout: 15000 })
  // ZERO-CLICK THESIS (P2): the card shows the run's REAL verdict headline. f1 is det-only → the self-check ring
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
  // and the share card PERSISTS. CONSCIOUS RECONCILIATION (T5, critic R6): this interrupt lands during BEAT 0
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

test('the thesis card copy-link builds the current shareable view URL — with NO verification state (T6/P2, NEVER-list)', async ({ page }) => {
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

// ── T5 / critic R6: the cold-open card COLLAPSES to a header verdict chip once the auto-tour leaves beat 0 ──
// The card used to persist over the WHOLE tour (critic R6). Now the full card holds through beat 0 (its cold-
// open share moment) and collapses to a header chip once the first playback beat begins — the chip is the SAME
// verdict voice, × still dismisses. The full card is a once-per-browser first-visit surface: after collapse it
// never returns except via cleared storage, and a reload from the collapsed state is calm — no card, no chip
// (pinned by the dedicated reload test below). This preserves what the beat-0 interrupt test above proves while
// pinning the new collapse contract.
test('cold open: the full card collapses to a header verdict chip when the auto-tour reaches its first playback beat (R6)', async ({ page }) => {
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

// ── T5: after collapse, a RELOAD is CALM — the full card is once-per-browser (first visit) ──────
// The sibling collapse test proves the chip is a one-way SESSION latch (an interrupt never re-expands it). This
// pins the deeper PERSISTENCE invariant the docs used to misstate: the first cold open's auto-play retires
// NUDGE_KEY (startTour → dismissNudge), so a reload seeds nudgeSeen=true and the zero-click arming rejects — and
// the boot has already rewritten the URL to ?run=f1, a non-bare load that is not a cold open either. Either way
// a reload from the COLLAPSED state is a returning visit: NO full card AND NO chip, the calm posture (the plain
// ▶ tour launcher, no first-visit pulse). Only cleared storage would bring the full card back. Mirrors the
// cold-open test's returning-visit block; the difference is the pre-reload state — collapsed, never dismissed.
test('cold open: after the card collapses, a reload is calm — no card, no chip, the returning-visit posture (R6)', async ({ page }) => {
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

// ── T5 / #20: the copy-link has a PERMANENT home in the app chrome (the header), not just the cold-open card ──
// A deep link (?run=e0) is never a cold open, so no thesis card ever mounts — yet the share weapon must still be
// reachable. The header copy-link proves it: present with no card in sight, and it builds the same shareable
// view URL with NO verification state (the NEVER-list), exactly as the card's copy did.
test('the permanent header copy-link builds the shareable view URL with no card present (#20, NEVER-list)', async ({ page }) => {
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

// W1 — STALE-GREEN ON RUN SWITCH. The cold-open thesis card is a cold-open artifact: it reads the OPENING
// run's verdict and speaks the zero-click thesis. A run switch makes that narrative stale, and for the
// one-commit identity window it would otherwise paint the PRIOR run's ✓ under the NEW run's name (the
// seal-race twin). So the card must CLOSE on any run switch. (The verdict-withhold guard on the prop is the
// second belt, unit-pinned in thesis.test.ts / hangar.test.ts; this proves the card-close behavior end-to-end.)
test('a run switch closes the cold-open thesis card (no prior run’s ✓ under a new run’s name — W1)', async ({ page }) => {
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

// W4 — the deep-link tour-NUDGE treatment (restored). The T6 rewrite dropped the only test pinning the
// first-visit nudge TREATMENT (the pulse CTA on the ▶ tour button + the quiet dismiss ×). That precedent is
// NOT gone — it still governs the DEEP-LINK first-visit path, because a deep link (?run=…) is never a cold
// open, so the zero-click thesis is skipped BY DESIGN and the nudge is the discoverability voice there. This
// fresh-context deep link (Playwright isolates storage per test = a first visit) re-pins that treatment AND
// the design invariant that the deep-link path shows NO zero-click card / auto-tour.
test('a first-visit deep link shows the tour-nudge treatment (pulse CTA + dismiss ×) and NO zero-click open (W4)', async ({ page }) => {
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
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
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await page.getByRole('button', { name: '▶ tour' }).click()
  // Step 2 (tours.ts e0-hero) is a play step from tick 0 → 20. Under the witness-normalized base (1× covers
  // a whole run in ~WITNESS_RUN_SECONDS), that step sweeps visibly on BOTH counts: the base rate alone plays
  // ticks at a watchable pace, and the tour re-normalizes THIS step to ~WITNESS_SECONDS of wall time via its
  // witnessSpeed pacing — either way the readout passes THROUGH intermediate ticks. This test pins that
  // visible sweep: catching any mid-flight tick proves playback is witnessable, not an instant jump.
  // Timeout 12000 (was 8000): the 'exact replay' caption is gated by step 0's holdMs, now 7300ms (§5 resize).
  await expect(page.locator('.tour-caption')).toContainText('exact replay', { timeout: 12000 })
  await expect(page.locator('.readout')).toHaveText(/^tick (?:[1-9]|1[0-9]) \/ 75$/, { timeout: 6000 })
})

// ── Task v0.5b-3: natural-end finale ─────────────────────────────────────────────────────────────────

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

// ── Task v04-3: error-screen escape hatch ────────────────────────────────────────────────────────────

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

// ── Task v0.5c T1: raycast fix — click reaches the 3D subject at ANY corridor position ────────────────
// The pick/hover hit InstancedMesh's boundingSphere froze at the drone's first-picked position: three.js
// computes it ONCE (only when null) and never after setMatrixAt, so every ray early-returned once the
// subject travelled away and clicks selected nothing (diag symptom A). These are the suite's FIRST
// 3D-cone-click tests. The subject is sub-pixel-small at the establish distance, so we click its EXACT
// projected screen centre computed from the app's OWN three.js camera — captured in-browser via the
// standard __THREE_DEVTOOLS__ 'observe' hook (same technique as the diagnosis probes,
// .superpowers/sdd/verify/probeA.mjs). The browser source is passed as STRINGS on purpose: the e2e
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
// same devtools-hook capture as PROJECT_HEAD). Used to PROVE the scrub-from-finale re-fit (v0.5c ruling 3): at a
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
// T1 click tests FAIL; if they stay green with the fix removed, the seat has been eroded and must be re-armed.
async function seatEarlySphere(page: Page): Promise<void> {
  // SCENE-LIVE GATE (v0.5d T3, conscious timing fix — cited R1 follow-up). The readout turns
  // interactive BEFORE the r3f Canvas finishes its first (SwiftShader-slow) mount, and BOTH of this
  // helper's callers act within that window under the test runner: (1) the seeding pointer-moves here
  // raycast NOTHING until the hit mesh exists — the exact seat erosion the caveat above warns about —
  // and (2) a ▶ click in that window fires the play-rising-edge establish request BEFORE Entities
  // mounts, where the channel's deliberate mount-seed consumes it without acting (camera stays on the
  // load vantage). The pre-R1 canvas was wide enough to mask (2) geometrically; the R1 reserved-column
  // canvas is not. Waiting for the CAPTURE_SCENE latch (the first rendered cone frame) restores the
  // scenario the tests describe: a user acting on a visibly-live stage. The swallowed-establish
  // mount window itself is flagged in the T3 report for endgame adjudication (app behavior, not test).
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
// tolerance (T1) and the >10u move threshold (T2). Generous timeout; throws (a real regression, never silent
// flake) if the camera never stabilises. ONE helper, three call sites: T1 finale, T2 pre-scrub rest, T2 post-
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

// Wait for the finale close-up to be GENUINELY REACHED (v0.5d hotfix — CI run 28992396802). The finale close-up
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

// Wait for the tour-start RESET to actually LAND (v0.5d hotfix round 2 — CI run 28993785155). The reset is an
// INSTANT camera cut, but it is executed inside Scene's useFrame, and on a slow SwiftShader runner the tour
// click triggers a long SYNCHRONOUS React/r3f reflow (step-0 caption + tour overlay + inspector re-render)
// that STALLS the render loop for hundreds of ms — to seconds — BEFORE the next frame runs the cut. During
// that stall the camera is FROZEN on the finale close-up, so a plain waitForCameraStable (two consecutive
// still samples) is satisfied by the STALL and samples the PRE-reset close-up. That is exactly how CI run
// 28993785155 failed: it read the camera 25.0u off `before` (the finale ease's residual creep) instead of
// ~241u on the vantage, and the >100u assertion failed with Δ=25.0u — the same false-early symptom round 1's
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

// Wait for a camera move to LAND on an expected vantage (v0.6 T4 rider). The house pattern (waitForFinaleCloseUp
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

// Wait for a camera move to DEMONSTRABLY FIRE off a known origin (v0.6 T4 fix-wave). Same false-early-stable
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

test('3D click at the natural-end finale selects the celebrated head and KEEPS the finale (T1 raycast fix)', async ({ page }) => {
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

test('3D click far down-corridor (paused mid-play) selects the subject after it has travelled far (T1 raycast fix)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  await page.goto('/?run=f1')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 64', { timeout: 15000 })
  const viewport = page.locator('#viewport')

  // DEVIATIONS from the plan's "pause mid-corridor via scrub" — both forced by camera reality, verified with
  // a projection probe (.superpowers/sdd/verify/probe-midrun.mjs):
  //   1. A scrub moves ONLY the playhead, never the camera, so a scrubbed head projects wherever the mount
  //      establish frame happens to point. We PLAY then pause instead (still a mid-play pause).
  //   2. During UNSELECTED play the camera does NOT follow (follow is selected-play only; unselected
  //      mid-run presence is the known composition gap ruling 5 addresses in T3). The camera holds the
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

// ── Task v0.5c T2: scrub-from-finale context re-fit (ruling 3 amendment) ─────────────────────────────
// The v0.5b spec line "clearing the finale never re-frames" stranded the f1 scrubber at the empty sky where the
// celebrated head had been (dressing cleared correctly, camera parked on the close-up → a black void). Ruling 3
// reverses it NARROWLY: leaving a finale by a playhead MOVE hands back the wide establishing frame. This proves
// the camera MOVES (off the ~25u close-up to the whole-trajectory fit) — the direct anti-void assertion.
test('scrub-from-finale eases the camera to the establishing frame — the camera provably MOVES (no void, v0.5c ruling 3)', async ({ page }) => {
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

  // Scrub the playhead back (a drag past the click threshold): clears the finale AND — ruling 3 — hands back
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

// ── Task v0.5d T2: tour-start camera reset (ruling 6) ────────────────────────────────────────────────
// A guided tour's step-0 caption is authored against the CameraRig LOAD vantage, but the tour can be launched
// from ANY prior camera state. Entered from a natural-end finale, the camera was parked on the finale close-up
// (~230u down f1's corridor) and step 0 played over an empty horizon with the head stranded ~241u away — ~8s of
// the ~20s guided pitch broken (the critic's RULING). useTour.start() now cuts the camera to the composed load
// vantage first. This proves the from-finale entry — the money case — via the app's OWN camera: it moves a large
// distance OFF the close-up and lands on the composed default [6,4.5,9] where step 0 was authored to open.
test('tour-from-finale resets the camera to the composed load vantage (step 0 opens on the correct stage, v0.5d ruling 6)', async ({ page }) => {
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
  // is now a treatment of this same button (v0.5d R5c) so exact matching is simply harmless precision).
  // Ruling 6: start() cuts the camera to the load vantage so step 0's caption opens on the correct stage.
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

// ── Task v0.6 T4 rider: the e0 QUERY-STAGE tour-start reset frames the stage ──────────────────────────────
// The e0 tour-start reset frames the query stage via stageBounds/STAGE_FRAME_OPTS (the core-theatre vantage),
// but no e2e proved the POSITIONLESS path — the existing tour-reset test above is f1/positioned only. On e0 the
// stage frame IS the CameraRig load frame, so a bare "tour lands on the stage" assertion is trivially true even
// if the reset did nothing. To make it load-bearing we PERTURB the camera off the vantage first, then prove
// the reset re-frames the stage. The perturbation is the Observer's Eye preset (press O) — a PROGRAMMATIC ease
// to the drawn observer's POV, which (unlike an orbit-drag) leaves no OrbitControls damping residual to fight
// the reset — so it doubles as browser proof that the POV preset moves the camera. Then gate on a DEMONSTRATED
// state (settled AND back on the captured vantage — the house pattern, never mere stillness).
test('the e0 POV preset moves the camera and the query tour reframes the stage (T4b + T4 rider)', async ({ page }) => {
  await page.addInitScript(CAPTURE_SCENE)
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  // The e0 CameraRig frames the core-theatre stage at load; latch that vantage as the reset target.
  await page.waitForFunction('!!window.__scene', undefined, { timeout: 15000 })
  await waitForCameraStable(page)
  const vantage = (await page.evaluate(CAMERA_POS)) as [number, number, number] | null
  expect(vantage, 'camera latched at the e0 stage vantage').not.toBeNull()

  // OBSERVER'S EYE (T4b): press O to ease the camera to the drawn observer's POV (O ≈ n=−601, far off the
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

// ── Task v0.6 T5b: THE HANGAR + earned verdict voice ──────────────────────────────────────────────
// The run-library front door renders a card per published run. Verdict badges are SESSION-EARNED AND
// two-voice (F6): a card wears the attested • until its run is opened this session; a VISITED FULL-MANIFEST
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
  // The disclaimer chip is the surface's thesis (D4): the index is a map, not the authority.
  await expect(page.locator('.hangar-disclaimer')).toContainText('a tampered index can misdirect, never forge')
  // e0 (DET-ONLY) was opened this session → its card earned the SELF-CHECK voice (attested •, "self-verified this
  // session · no external oracle"), NEVER the manifest-grade ✓ (F6: det-only surfaces carry no ✓). f0 is unvisited
  // → attested • ("certified · on record"). The label distinguishes a sealed det-only card from an unvisited one.
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-verdict.attested')).toContainText('self-verified this session')
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-verdict.verified')).toHaveCount(0) // NEGATIVE: det-only NEVER the ✓
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.attested')).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.verified')).toHaveCount(0)
  // BINDING PROHIBITION (D4 Ruling 2 / W2): no OTHER-campaign wordmark touches the published f3a card —
  // not /robust/, and not the softer "statistical-acceptance / acceptance campaign" the old scan missed.
  // Scanned with the SHARED tripwire (single-sourced, closure item 2), never a local literal copy.
  await expect(page.locator('.hangar-card[data-run="f3a"]')).not.toContainText(PROFILE_CONFLATION_RE)
  // f3a shows real sim duration (12.0s); the det-only e0 card keeps the assumed voice.
  await expect(page.locator('.hangar-card[data-run="f3a"] .hangar-clock')).toContainText('0:12.0')
  await expect(page.locator('.hangar-card[data-run="e0"] .hangar-clock.assumed')).toContainText('assumed')
  // Viewport (not fullPage): a fixed modal overlay composites incorrectly under a fullPage capture.
  await page.screenshot({ path: '.superpowers/sdd/task-v06-5b-hangar.png' })

  // Open f0 from its card → the Hangar closes, f0's ceremony runs and seals. Reopen → f0 now wears ✓
  // (the attested→sealed cross-surface transition — the design's cheapest delight).
  await page.locator('.hangar-card[data-run="f0"]').getByRole('button', { name: 'open run' }).click()
  await expect(page.locator('.readout')).toHaveText('tick 0 / 2', { timeout: 15000 })
  await page.getByRole('button', { name: 'hangar', exact: true }).click()
  await expect(page.locator('.hangar-panel')).toBeVisible()
  await expect(page.locator('.hangar-card[data-run="f0"] .hangar-verdict.verified')).toBeVisible()
  await page.waitForTimeout(300) // let the open animation settle so the capture is the fully-painted modal
  await page.screenshot({ path: '.superpowers/sdd/task-v06-5b-hangar-sealed.png' })

  // Esc closes the modal front door (App's keydown owner modal-captures while it is open).
  await page.keyboard.press('Escape')
  await expect(page.locator('.hangar-panel')).toHaveCount(0)
  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── Task v0.6 T5c: the SIM-CLOCK reads real time on published runs, assumed elsewhere ──────────────
test('the readout shows real dt_us sim time on f3a and keeps the assumed tick readout on e0', async ({ page }) => {
  // f3a pins dt_us = 125000 → 96 ticks × 125000µs = 12.0s. At tick 0 the clock reads 0:00.0 / 0:12.0.
  await page.goto('/?run=f3a')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.readout')).toHaveText('0:00.0 / 0:12.0')
  // The provenance panel shows the real dt (not "(assumed)") for a full-manifest run.
  await expect(page.locator('.provenance')).toContainText('125000µs')
  await page.screenshot({ path: '.superpowers/sdd/task-v06-5b-simclock-real.png', fullPage: true })

  // e0 is det-only (KAT tier): the readout keeps the neutral tick voice — no false real-clock claim.
  await page.goto('/?run=e0')
  await expect(page.locator('.readout')).toHaveText('tick 0 / 75', { timeout: 15000 })
})

// ── Task v0.6 MUST-FIX (critic ruling 3): the query stage / honesty chip / origin anchor gate on kind-23 content ──
// buildQueryDraws never returns null (a run with no geometry queries yields an all-null seq-indexed array), so
// the old `positionless`-ALONE gate mounted the stage — its origin-anchor octahedron + scenario solids — AND
// painted the "occluder & region bodies are scenario constants" honesty chip on f4, a positionless run whose
// event kinds carry NO kind-23 draws: the app's one FALSE claim, over phantom furniture. All three now gate on
// hasQueryDraws. This pins the fix end-to-end: f4 wears NO honesty chip and speaks the honest empty-stage rail
// voice; e0 (a real query stage) still wears the chip — so a regression that drops the chip everywhere (or
// restores it everywhere) is caught by the contrast, not just its absence on one run.
test('f4 (positionless, no kind-23) wears NO honesty chip and speaks the honest empty-stage voice; e0 keeps the chip (ruling 3)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/?run=f4')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  // NO honesty chip — the "scenario constants" claim would be false for a run whose stage draws nothing.
  await expect(page.locator('.scene-chip')).toHaveCount(0)
  await expect(page.locator('#viewport')).not.toContainText('scenario constants')
  // The no-selection rail speaks the honest empty-stage voice (names the real surfaces), never inviting a
  // click on a cone that isn't the point here (the positioned "click the cone" copy must not appear).
  await expect(page.locator('.inspector-empty')).toContainText('no stage lens')
  await expect(page.locator('.inspector-empty')).not.toContainText('click the cone')

  // CONTRAST — e0 IS a real query stage: the honesty chip is present with its exact wording, proving the gate
  // NARROWS the chip to runs that actually draw those bodies rather than removing it wholesale.
  await page.goto('/?run=e0')
  await expect(page.locator('.provenance')).toContainText('trailer consistent ✓', { timeout: 15000 })
  await expect(page.locator('.scene-chip')).toContainText('occluder & region bodies are scenario constants')

  expect(errors, `no console errors: ${errors.join(' | ')}`).toEqual([])
})
