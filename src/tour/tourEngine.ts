import type { Tour, TourStep } from './tourTypes'

export interface TourState { stepIndex: number; status: 'idle' | 'stepping' | 'holding' | 'done' }

// Completion events ('actionsComplete', 'holdElapsed') are not step-scoped: the
// driver must ensure at most one pending actionsComplete/holdElapsed at a time
// (cancellable timers) -- stale double-delivery from a prior step is a driver
// defect, not something this state machine can detect or guard against.
export function advanceTour(state: TourState, tour: Tour, event: 'start' | 'actionsComplete' | 'holdElapsed' | 'stop'): TourState {
  if (event === 'stop') return { stepIndex: state.stepIndex, status: 'done' }
  if (event === 'start') {
    // Restart semantics: 'start' resets to stepping(0) from ANY status -- deliberate.
    // Exception: an empty tour has no steps[0] for a driver to index, so go straight to done.
    return tour.steps.length === 0 ? { stepIndex: 0, status: 'done' } : { stepIndex: 0, status: 'stepping' }
  }
  if (event === 'actionsComplete' && state.status === 'stepping') return { ...state, status: 'holding' }
  if (event === 'holdElapsed' && state.status === 'holding') {
    const next = state.stepIndex + 1
    return next >= tour.steps.length ? { stepIndex: state.stepIndex, status: 'done' } : { stepIndex: next, status: 'stepping' }
  }
  // No-op contract: every other (status, event) pair returns the same state
  // reference unchanged -- React drivers rely on this identity to skip re-renders.
  return state
}

// Driver contract: a driver executes all returned actions (possibly zero) and
// then dispatches 'actionsComplete' -- an empty list means dispatch immediately.
export function stepActions(step: TourStep) {
  const out: Array<{ kind: 'scrub'; tick: number } | { kind: 'play'; to: number; speed: number } | { kind: 'select'; entity: string | null | undefined; event: number | null | undefined } | { kind: 'focus' }> = []
  if (step.tick !== undefined) out.push({ kind: 'scrub', tick: step.tick })
  if (step.select) out.push({ kind: 'select', entity: step.select.entity, event: step.select.event })
  if (step.focus) out.push({ kind: 'focus' })
  if (step.play) out.push({ kind: 'play', to: step.play.to, speed: step.play.speed })
  return out
}

// Design ruling (cited in the test pin): DWELL IS NOT MOTION. Reduced motion converts
// flights to cuts (startPlay snaps the playhead; camera eases collapse to factor 1) — but a hold is
// CAPTION-READING time, authored 3500-6000ms for reading, and the old rm cap (min(holdMs, 1200)) gave
// rm users LESS reading time than everyone else. Ruled form: rm hold = max(authored, old behavior),
// which collapses to the authored hold exactly — so dwell no longer depends on rm at all and the
// parameter is retired (cuts stay cuts; holds don't compress). Non-rm timings are byte-identical.
export const holdFor = (step: TourStep): number => step.holdMs
