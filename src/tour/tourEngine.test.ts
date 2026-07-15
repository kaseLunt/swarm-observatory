import { describe, expect, test } from 'vitest'
import { advanceTour, stepActions, holdFor } from './tourEngine'
import type { TourState } from './tourEngine'
import type { Tour, TourStep } from './tourTypes'

const tour: Tour = { id: 't', runId: 'e0', title: 'T', steps: [
  { tick: 0, caption: 'a', holdMs: 2000 },
  { tick: 10, select: { event: 10 }, caption: 'b', holdMs: 3000 },
  { play: { to: 74, speed: 4 }, caption: 'c', holdMs: 1000 },
] }

describe('tour state machine', () => {
  test('start → stepping(0); actionsComplete → holding; holdElapsed → stepping(1)', () => {
    let s = advanceTour({ stepIndex: -1, status: 'idle' }, tour, 'start')
    expect(s).toEqual({ stepIndex: 0, status: 'stepping' })
    s = advanceTour(s, tour, 'actionsComplete')
    expect(s.status).toBe('holding')
    s = advanceTour(s, tour, 'holdElapsed')
    expect(s).toEqual({ stepIndex: 1, status: 'stepping' })
  })
  test('last step holdElapsed → done; stop from anywhere → done', () => {
    const s = { stepIndex: 2, status: 'holding' as const }
    expect(advanceTour(s, tour, 'holdElapsed').status).toBe('done')
    expect(advanceTour({ stepIndex: 1, status: 'stepping' }, tour, 'stop').status).toBe('done')
  })
  test('stepActions order: scrub, select, focus, play', () => {
    const step: TourStep = { tick: 5, select: { entity: '1:0' }, focus: true, play: { to: 20, speed: 4 }, caption: 'x', holdMs: 0 }
    expect(stepActions(step).map(a => a.kind)).toEqual(['scrub', 'select', 'focus', 'play'])
  })
  test('holdFor never compresses a hold — dwell is not motion (v0.5d bench R4, design ruling)', () => {
    // R4: reduced motion converts FLIGHT to cuts (startPlay snaps; eases collapse to factor 1), but a
    // hold is CAPTION-READING time — authored 3500-6000ms for reading. The old rm cap (min(holdMs,
    // 1200)) gave rm users LESS reading time than everyone else. Ruled: rm hold = max(authored, old
    // behavior) ≡ the authored hold exactly, so dwell no longer depends on rm at all — holdFor takes
    // only the step. Plain-tour (non-rm) timings stay byte-identical: the authored holdMs, verbatim.
    expect(holdFor(tour.steps[1]!)).toBe(3000)
    const longRead: TourStep = { caption: 'authored for reading', holdMs: 6000 }
    expect(holdFor(longRead)).toBe(6000) // > the retired 1200ms cap — never compressed again
    expect(holdFor(tour.steps[2]!)).toBe(1000) // under the old cap: unchanged in both worlds
  })
  test('start on an empty-step tour goes straight to done (no steps[0] for a driver to index)', () => {
    const emptyTour: Tour = { id: 'empty', runId: 'e0', title: 'Empty', steps: [] }
    expect(advanceTour({ stepIndex: 0, status: 'idle' }, emptyTour, 'start')).toEqual({ stepIndex: 0, status: 'done' })
  })
  test('stepActions returns [] for a step with only caption+holdMs', () => {
    const step: TourStep = { caption: 'no actions here', holdMs: 500 }
    expect(stepActions(step)).toEqual([])
  })
  test('stepActions passes the select payload through verbatim (event undefined = unchanged)', () => {
    const step: TourStep = { select: { entity: '1:0' }, caption: 'x', holdMs: 0 }
    expect(stepActions(step)).toEqual([{ kind: 'select', entity: '1:0', event: undefined }])
  })
})

describe('advanceTour transition table (every status × event pair)', () => {
  const statuses: TourState['status'][] = ['idle', 'stepping', 'holding', 'done']
  const events = ['start', 'actionsComplete', 'holdElapsed', 'stop'] as const

  for (const status of statuses) {
    for (const event of events) {
      test(`${status} --${event}-->`, () => {
        const state: TourState = { stepIndex: 1, status }
        const result = advanceTour(state, tour, event)

        if (event === 'start') {
          // Restart semantics: 'start' always resets to stepping(0) regardless of
          // the current status. Deliberate, not a bug -- the empty-tour exception
          // (start -> done when tour.steps.length === 0) is covered separately above.
          expect(result).toEqual({ stepIndex: 0, status: 'stepping' })
        } else if (event === 'stop') {
          // 'stop' finishes the tour from any status, preserving stepIndex.
          expect(result).toEqual({ stepIndex: state.stepIndex, status: 'done' })
        } else if (event === 'actionsComplete' && status === 'stepping') {
          expect(result).toEqual({ stepIndex: state.stepIndex, status: 'holding' })
        } else if (event === 'holdElapsed' && status === 'holding') {
          expect(result.status === 'stepping' || result.status === 'done').toBe(true)
        } else {
          // No-op contract: every other (status, event) pair must return the exact
          // same state reference, not just an equal-valued object -- React drivers
          // rely on this identity to skip re-renders.
          expect(Object.is(result, state)).toBe(true)
        }
      })
    }
  }
})
