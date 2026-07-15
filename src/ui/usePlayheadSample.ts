import { useEffect, useState } from 'react'
import { useViewStore } from '../state/viewStore'

// Immediate-sample predicate (extracted pure so it is unit-testable without a DOM harness):
// sample off the interval throttle when the store changes while PAUSED — a scrub or a selection
// must feel instant — or when the play/pause flag itself just toggled, so the panel reflects the
// transport edge without waiting up to 1/hz. While playing steadily (playing true, unchanged) the
// interval alone throttles, so per-change sampling is suppressed and panels stay off the 60Hz path.
export function shouldSampleImmediately(playing: boolean, prevPlaying: boolean): boolean {
  return !playing || playing !== prevPlaying
}

// A tick readout that re-renders at most `hz` times/second while playing, and immediately on
// pause/scrub edges. Panels subscribe to THIS instead of a raw `s.tick` selector so they never
// re-render on the rAF frame loop's per-frame tick writes.
export function usePlayheadSample(hz = 8): number {
  const [tick, setTick] = useState(() => useViewStore.getState().tick)
  useEffect(() => {
    let last = useViewStore.getState().tick
    const read = () => { const t = useViewStore.getState().tick; if (t !== last) { last = t; setTick(t) } }
    const unsub = useViewStore.subscribe((s, prev) => {
      if (shouldSampleImmediately(s.playing, prev.playing)) read() // paused updates + play/pause edges are immediate
    })
    const id = setInterval(() => { if (useViewStore.getState().playing) read() }, 1000 / hz)
    return () => { unsub(); clearInterval(id) }
  }, [hz])
  return tick
}
