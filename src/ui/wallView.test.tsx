// @vitest-environment jsdom
import { StrictMode, act, startTransition } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CertificationWall } from './wallView'
import { censusLine } from './wall'
import { ROBUST_F3A, campaignSeedIds } from '../decode/campaignCatalog'
import { useCampaignStore } from '../state/campaignStore'
import type { RunSummary } from '../decode/campaignVerify'

// ── FIX: THE MOUNT SEED IS COMMIT-SAFE AND SURVIVES StrictMode's EFFECT REPLAY ──────────────────────────────
// The Wall seeds its module-scoped campaign store to '50 pending' on mount so the very first painted frame reads
// 0-of-50, never a 0-of-0 flash. That seed USED to run in a useState lazy initializer — a render-phase mutation of
// a shared external store (a React purity violation). The app root mounts under <StrictMode>, whose dev lifecycle
// replays effects setup → cleanup → setup: the fetch effect's cleanup runs stopSession() → reset(), zeroing the
// store, and the render-phase initializer never re-ran — so the mounted Wall SETTLED at 0-of-0. The fix moves the
// seed into a useLayoutEffect (commit-safe, before paint, re-run on every setup incl. the replay's second setup).
//
// These are REAL client mounts (jsdom + react-dom/client createRoot + React act), the only fidelity that exercises
// the StrictMode effect replay — a server render (renderToStaticMarkup) runs NO effects, so it can neither run nor
// witness the layout-effect seed. The premise is witnessed directly: mount under <StrictMode>, let act flush the
// setup → cleanup → setup replay, then assert the store census settles 0-of-50. Against the old render-seed version
// this same mount settles 0-of-0 (the cleanup-reset is never re-seeded) — so this is a genuine regression test.
//
// The manifest fetch is irrelevant to the seed lifecycle under test, but its effect's CLEANUP (stopSession → reset)
// is precisely the reset the seed must survive; we stub fetch to a never-settling promise so the effect + cleanup
// register while no async setLoad ever lands after unmount.

// react-dom/client + act require this flag set (otherwise act warns / no-ops).
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HEX = 'a'.repeat(64)
const verifiedSummary = (id: string, seed: number): RunSummary => ({
  id, seed, status: 'verified', basis: 'campaign-manifest',
  sha256Hex: HEX, sha256ok: true, caseIdHex: HEX, resultIdHex: HEX,
  caseIdOk: true, resultIdOk: true, matchesTrailer: true,
  timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
})

const REST_CENSUS = `0 of ${ROBUST_F3A.nSeeds} recomputed and matched here · ${ROBUST_F3A.nSeeds} on record · 0 contradicted`

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('fetch', () => new Promise<Response>(() => {})) // never settles — the seed lifecycle is what we test
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  useCampaignStore.getState().reset()
})

describe('CertificationWall: the mount seed is commit-safe under StrictMode', () => {
  test('under StrictMode effect replay, the seed survives the fetch cleanup-reset — the census settles 0-of-50, never the 0-of-0 the render-seed left', () => {
    // Premise: a just-closed session reset the module store to total=0 (the 0-of-0 source). The module store
    // survives a close; only a fresh mount re-seeds it.
    useCampaignStore.getState().reset()
    expect(useCampaignStore.getState().total).toBe(0)

    // A REAL client mount under StrictMode: act flushes the dev setup → cleanup → setup effect replay. The old
    // render-phase useState seed ran once and was NOT re-run after the fetch cleanup's stopSession() reset — so the
    // store settled total=0 → "0 of 0". The layout-effect seed re-runs on the replay setup, re-seeding after reset.
    act(() => { root.render(<StrictMode><CertificationWall onClose={() => {}} /></StrictMode>) })

    const rollup = useCampaignStore.getState().rollup
    expect(rollup).toEqual({ verified: 0, mismatched: 0, error: 0, pending: ROBUST_F3A.nSeeds, total: ROBUST_F3A.nSeeds })
    expect(censusLine(rollup)).toBe(REST_CENSUS)
    // And the PAINTED census (the DOM the user first sees, committed before paint) reflects 50, not the 0-of-0 flash.
    expect(container.textContent).toContain(REST_CENSUS)
  })

  test('the mount seed OVERRIDES a dirty store even under the StrictMode replay — a stale ✓ is wiped back to 0-of-50', () => {
    // A prior session left a landed ✓ (verified: 1, total: 3). The fresh mount must re-seed to rest, not inherit it,
    // AND that override must hold through the replay's cleanup-reset-then-reseed.
    useCampaignStore.getState().init(['42', '43', '44'])
    useCampaignStore.getState().record(verifiedSummary('42', 42))
    expect(useCampaignStore.getState().rollup.verified).toBe(1)

    act(() => { root.render(<StrictMode><CertificationWall onClose={() => {}} /></StrictMode>) })

    const rollup = useCampaignStore.getState().rollup
    expect(rollup.total).toBe(ROBUST_F3A.nSeeds)
    expect(rollup.verified).toBe(0) // the stale green did not survive the reopen
    expect(censusLine(rollup)).toBe(REST_CENSUS)
    expect(container.textContent).toContain(REST_CENSUS)
  })

  test('the first committed paint is the loading state + verify-all CTA, never a prior session\'s gauges or cancel button', () => {
    // A prior session left the store dirty MID-FETCH: an earned ✓, one seed still running — the stale UI the old
    // first paint could leak. Component-local state (the gauge load, the verifying flag) is fresh on mount.
    useCampaignStore.getState().init(['42', '43', '44'])
    useCampaignStore.getState().markRunning('44')
    useCampaignStore.getState().record(verifiedSummary('42', 42))

    act(() => { root.render(<CertificationWall onClose={() => {}} />) })

    const html = container.innerHTML
    // The LOADING paragraph, and the verify-all CTA (fetch is stubbed to never settle, so load stays 'loading').
    expect(html).toContain('is loading…')
    expect(html).toContain('wall-cta')
    expect(html).toContain(`verify all ${ROBUST_F3A.nSeeds}`)
    // Never stale GAUGES (no decoded band / pass-fail row exists in the loading state).
    expect(html).not.toContain('wall-gauge-track')
    expect(html).not.toContain('wall-gauge-pass')
    expect(html).not.toContain('wall-gauge-fail')
    // Never a stale CANCEL button (verifying is false on a fresh mount).
    expect(html).not.toContain('wall-cancel')
    // The census the fresh mount paints is 0-of-50 (the seed landed), not the dirty prior session's counts.
    expect(container.textContent).toContain(REST_CENSUS)
  })
})

// ── THE FIRST-FRAME FIX: SEEDING AT THE OPEN ACTION, NOT (ONLY) IN A LAYOUT EFFECT ────────────────────────────
// The Wall's layout-effect seed cannot own the FIRST painted frame: zustand registers its useSyncExternalStore
// subscription in a PASSIVE effect, so the layout-effect init() mutates a store the component is not yet subscribed
// to — React only NOTICES the changed snapshot at passive setup, which lands AFTER paint on a default/transition-lane
// mount. So render 1 reads whatever the store held at RENDER time, before any effect ran. App removes that timing
// dependence by seeding the store at the OPEN ACTION, synchronously, before the keyed Wall mounts.
//
// A render-phase PROBE witnesses exactly this: a component that reads the census DURING its own render and records
// what each render saw. sink[0] is what render 1 read. We mount it as a sibling of the real Wall (so the Wall's real
// layout-effect seed is present) and drive the mount on the transition lane via startTransition — a premise-first
// construction, pinned to React 19.2.7 + zustand 5.0.14.
//
// WHAT IS PROVEN BY TEST vs BY CONSTRUCTION. Proven by test (below): render 1 reads the store's value AT RENDER TIME
// — so with only the Wall's layout-effect seed, render 1 reads 0-of-0 (the layout effect has not run yet), whereas
// seeding before the mount makes render 1 read 0-of-50. That render-phase fact is the whole mechanism. NOT modelled
// by jsdom+act: the real browser PAINT between render and the post-paint passive catch-up — act drains all work with
// no paint, so the one-frame 0-of-0 FLASH itself is a by-construction consequence of the render-1 read, not a thing a
// unit test can observe. App wiring (init runs before the open flip) is verified by construction in App.onOpenWall.
function CensusProbe({ sink }: { sink: number[] }) {
  // Reading the store during render and recording it is the instrument: this is what the first render "sees".
  const total = useCampaignStore(s => s.rollup.total)
  sink.push(total)
  return null
}

describe('CertificationWall: the first painted frame is seeded at the open action, in any lane', () => {
  test('PREMISE — with ONLY the Wall\'s layout-effect seed, a transition-lane first render reads 0-of-0 (the flash)', () => {
    // A just-closed session left the module store at rest (total=0) — the 0-of-0 source.
    useCampaignStore.getState().reset()
    expect(useCampaignStore.getState().total).toBe(0)

    const seen: number[] = []
    // Mount the REAL Wall (its layout-effect seed is present) + the probe, on the TRANSITION lane. No open-action
    // seed precedes the mount, so render 1 reads the store BEFORE the Wall's layout effect commits.
    act(() => {
      startTransition(() => {
        root.render(<StrictMode><CertificationWall onClose={() => {}} /><CensusProbe sink={seen} /></StrictMode>)
      })
    })

    // Render 1 read 0 — the layout-effect seed had not run yet. This is the gap the open-action seed closes.
    expect(seen[0]).toBe(0)
    // And by the time act drained (layout seed ran, subscription caught up), the store settled at 50 — i.e. the
    // ONLY thing separating render 1's 0 from the final 50 was effect timing, exactly what a transition-lane paint
    // would have exposed as a one-frame flash.
    expect(useCampaignStore.getState().rollup.total).toBe(ROBUST_F3A.nSeeds)
  })

  test('FIX — seeding at the open action (before the mount) makes render 1 read 0-of-50, transition lane and all', () => {
    useCampaignStore.getState().reset()
    // App's open action: seed synchronously from the SHARED source, BEFORE the keyed Wall mounts.
    useCampaignStore.getState().init(campaignSeedIds(ROBUST_F3A))

    const seen: number[] = []
    act(() => {
      startTransition(() => {
        root.render(<StrictMode><CertificationWall onClose={() => {}} /><CensusProbe sink={seen} /></StrictMode>)
      })
    })

    // Render 1 ALREADY sees 50 — the store was seeded before render, so no lifecycle and no lane can flash 0-of-0.
    expect(seen[0]).toBe(ROBUST_F3A.nSeeds)
    expect(useCampaignStore.getState().rollup.total).toBe(ROBUST_F3A.nSeeds)
  })

  test('the shared seed-id source seeds the exact 50-id set the Wall renders (App and Wall cannot diverge)', () => {
    // campaignSeedIds is the ONE derivation App.onOpenWall and the Wall both seed from — it yields the catalog\'s
    // 50 canonical decimal seed ids, in seed order. Seeding the store from it produces the rest census verbatim.
    const ids = campaignSeedIds(ROBUST_F3A)
    expect(ids).toEqual(ROBUST_F3A.seeds.map(s => String(s.seed)))
    expect(ids.length).toBe(ROBUST_F3A.nSeeds)
    useCampaignStore.getState().reset()
    useCampaignStore.getState().init(ids)
    expect(censusLine(useCampaignStore.getState().rollup)).toBe(REST_CENSUS)
  })
})
