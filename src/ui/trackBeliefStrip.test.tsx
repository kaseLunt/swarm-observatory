// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { buildTrackBelief, type TrackBeliefSource } from './trackBelief'
import { TrackBeliefStrip } from './trackBeliefStrip'
import { requireGlyph } from './voices'
import type { TrackConfirmed, TrackUpdated, TrackDropped } from '../decode/payloads'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function detFixture(name: string): ArrayBuffer {
  const base = `contract/fixtures/${name}`
  const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
  const b = readFileSync(`${base}/${dir}/bundle.det`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const data = buildTrackBelief(new RunModel(decodeBundle(detFixture('f3a_seed42')), null))

const VERIFIED = requireGlyph('verified')     // ✓ — the belief lens must NEVER wear a verdict glyph (a derivation)
const MISMATCH = requireGlyph('mismatch')     // ✗
const SELF = requireGlyph('selfConsistent')   // ○

describe('TrackBeliefStrip — the 1σ readout, the reveal discipline, and the honest voice', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const renderAt = (tick: number) => act(() => root.render(<TrackBeliefStrip data={data} tick={tick} />))
  const tally = () => container.querySelector('.track-tally')!.getAttribute('data-track-tally')

  test('before the first update (ticks 0,1) the current 1σ is NOT-YET; the disc appears at tick 2', () => {
    renderAt(0)
    expect(container.querySelector('.track-notyet'), 'the not-yet line stands in').not.toBeNull()
    expect(container.querySelector('.track-sigma'), 'no 1σ before the first update').toBeNull()
    expect(container.querySelector('.track-notyet')!.textContent).toContain('the first is at tick 2')
    renderAt(2)
    const sigma = container.querySelector('.track-sigma')
    expect(sigma, 'the 1σ appears at tick 2').not.toBeNull()
    expect(sigma!.getAttribute('data-track-sigma')).toBe(data.samples[0]!.ellipse!.semiMajor.toFixed(3))
    expect(sigma!.textContent).toContain('1σ 1.83 m')
    expect(sigma!.textContent).toContain('disc')
  })

  test('the 1σ SHRINKS as the playhead advances and WIDENS on a scrub back (a pure function of the playhead)', () => {
    renderAt(2)
    const early = container.querySelector('.track-sigma')!.getAttribute('data-track-sigma')!
    renderAt(79)
    const late = container.querySelector('.track-sigma')!.getAttribute('data-track-sigma')!
    expect(container.querySelector('.track-sigma')!.textContent).toContain('1σ 0.44 m')
    expect(Number(late)).toBeLessThan(Number(early)) // tighter later
    // scrub BACK to tick 2 recovers the wider early disc — no sticky reveal
    renderAt(2)
    expect(container.querySelector('.track-sigma')!.getAttribute('data-track-sigma')).toBe(early)
  })

  test('the update tally is the reveal clock prefix count: 0 before, 1 at t2, 78 at full reveal', () => {
    renderAt(0); expect(tally()).toBe('0/78')
    renderAt(2); expect(tally()).toBe('1/78')
    renderAt(79); expect(tally()).toBe('78/78')
  })

  test('the two scopes name themselves: the current 1σ + tally say "so far" / "at the playhead", the shrink says "whole run"', () => {
    renderAt(40)
    expect(container.querySelector('.track-sigma')!.textContent).toContain('at the playhead')
    expect(container.querySelector('.track-tally')!.textContent).toContain('so far')
    const shrink = container.querySelector('.track-shrink')!
    expect(shrink.textContent).toContain('whole run')
    expect(shrink.textContent).toContain('1.83 m → 0.44 m') // run-scoped endpoints, stable across the scrub
  })

  // ── THE BELIEF-vs-REALITY HALF — the current actual error + the overconfidence, playhead-scoped ──────────────
  test('the current error line names the decoded gap to the true pose, and whether the truth is inside/outside the disc', () => {
    // tick 3 — the truth sits INSIDE the 1σ disc (gap 1.545 < σ 1.673): "within the disc".
    renderAt(3)
    const errEarly = container.querySelector('.track-error')
    expect(errEarly, 'the error line appears once the reality half is revealed').not.toBeNull()
    expect(errEarly!.textContent).toContain('within the disc')
    // tick 79 — the OVERCONFIDENCE: the reported 1σ shrank to 0.44 m but the actual error is ~2.43 m, ≈5.5σ OUTSIDE.
    renderAt(79)
    const errLate = container.querySelector('.track-error')!
    expect(errLate.textContent).toContain('error 2.43 m')
    expect(errLate.textContent).toContain('OUTSIDE the disc')
    expect(errLate.textContent).toContain('overconfident')
    expect(errLate.textContent).toContain('at the playhead')
    // the whole-run shrink line ALSO names the error growth (run-scoped, stable across the scrub).
    const shrink = container.querySelector('.track-shrink')!
    expect(shrink.textContent).toContain('actual error 0.23 m → 2.43 m')
    expect(shrink.textContent).toContain('the truth leaves the disc')
  })

  test('the lifecycle names the decoded confirm + drop (TIMEOUT), and the mechanism disclosure names each authority', () => {
    renderAt(79)
    expect(container.querySelector('.track-lifecycle')!.textContent).toMatch(/dropped t\d+ \(TIMEOUT\)/)
    const mech = container.querySelector('.track-mechanism')!.textContent!
    expect(mech).toContain('decoded mean')          // the ring centre is the decoded mean (the estimate)…
    expect(mech).toContain('decoded state truth')   // …the drone is the decoded state truth…
    expect(mech).toContain('actual error')          // …the line between them is the tracker's actual error…
    expect(mech).toContain('presentational')        // …the contour + line weight are presentational
  })

  test('the honesty line names BOTH halves + the gap as the actual error — a real belief-vs-reality comparison', () => {
    renderAt(40)
    const honesty = container.querySelector('.track-degenerate')!.textContent!
    expect(honesty).toContain('the tracker’s decoded estimate')
    expect(honesty).toContain('decoded state truth')
    expect(honesty).toContain('actual error')
    expect(honesty).toContain('a real belief-vs-reality comparison')
  })

  test('NO verdict alphabet: the whole strip renders no ✓, ✗, or ○ (the disc is a derivation, never an adjudication)', () => {
    for (const t of [0, 2, 40, 79]) {
      renderAt(t)
      const text = container.querySelector('.track-strip')!.textContent ?? ''
      expect(text, `no ✓ at t${t}`).not.toContain(VERIFIED)
      expect(text, `no ✗ at t${t}`).not.toContain(MISMATCH)
      expect(text, `no ○ at t${t}`).not.toContain(SELF)
    }
  })
})

// ── FAIL CLOSED — a non-renderable model discloses the mode and withholds the definitive 1σ ─────────────────────
function trackSource(updates: { tick: number; track: bigint; mean: number[]; cov: number[] }[]): TrackBeliefSource {
  type Ev = { kind: number; tick: number; upd?: TrackUpdated; conf?: TrackConfirmed; drop?: TrackDropped }
  const evs: Ev[] = updates.map(u => ({ kind: 3, tick: u.tick, upd: { track: u.track, mean: u.mean, cov: u.cov, innovation: [0, 0], innovationCov: [0, 0, 0, 0] } }))
  return {
    eventCount: evs.length, tickCount: 100, ticks: evs.map(e => e.tick),
    kindAt: (s) => evs[s]!.kind, entityKeys: () => ['1:0'],
    entityStatesAt: () => new Map<string, { pos: number[] }>(),
    trackConfirmedAt: () => null, trackUpdatedAt: (s) => evs[s]!.upd ?? null, trackDroppedAt: () => null,
  }
}
const isoCov = (v: number): number[] => { const c = new Array(16).fill(0); c[0] = v; c[5] = v; c[10] = 1; c[15] = 1; return c }

describe('TrackBeliefStrip — fail-closed disclosures (multi-track, malformed covariance)', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  test('MULTIPLE tracks: the disclosure names the mode and withholds the definitive 1σ', () => {
    const multi = buildTrackBelief(trackSource([
      { tick: 2, track: 1n, mean: [1, 0, 0, 0], cov: isoCov(3) },
      { tick: 3, track: 2n, mean: [2, 0, 0, 0], cov: isoCov(2) },
    ]))
    act(() => root.render(<TrackBeliefStrip data={multi} tick={5} />))
    const disc = container.querySelector('.track-disclosure')!
    expect(disc.getAttribute('data-track-mode')).toBe('multiple tracks')
    expect(disc.textContent).toContain('multiple tracks')
    expect(container.querySelector('.track-sigma'), 'the definitive 1σ is withheld').toBeNull()
    expect(container.querySelector('.track-error'), 'the error line is withheld too').toBeNull()
  })

  test('a MALFORMED covariance: the disclosure names the mode + count and withholds the 1σ', () => {
    const bad = isoCov(3); bad[1] = 2; bad[4] = 5 // non-symmetric → covEllipse null
    const malformed = buildTrackBelief(trackSource([
      { tick: 2, track: 1n, mean: [1, 0, 0, 0], cov: isoCov(3) },
      { tick: 3, track: 1n, mean: [2, 0, 0, 0], cov: bad },
    ]))
    act(() => root.render(<TrackBeliefStrip data={malformed} tick={5} />))
    const disc = container.querySelector('.track-disclosure')!
    expect(disc.getAttribute('data-track-mode')).toBe('malformed covariance')
    expect(disc.textContent).toContain('malformed')
    expect(disc.textContent).toContain('1 of 2') // the malformed count over the named population
    expect(container.querySelector('.track-sigma')).toBeNull()
  })
})
