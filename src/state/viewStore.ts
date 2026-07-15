import { create } from 'zustand'
import { encodeLink, parseLink, type LinkState } from './url'
import { clampSpeed } from './speeds'
import { breakSeal, recordSeal, type SealRecord } from '../ui/hangar'

interface ViewState {
  runId: string; tick: number; fraction: number; playing: boolean; speed: number
  selectedEntity: string | null; selectedEvent: number | null; finale: boolean
  // SESSION-SEAL (T5b, D4 checkmark economy): the runs whose ceremony sealed green THIS session (opened
  // + trailer matched). Each record names the run AND the exact bytes its ✓ vouches for (resultId, W1);
  // `broken` marks a seal later CONTRADICTED by a mismatched re-load of the same run (closure item 1 —
  // rendered in the alarm ✗ register, session-terminal; the full state machine is documented on
  // recordSeal/breakSeal in ui/hangar.ts). The Hangar reads this to voice each card. In-memory ONLY —
  // never localStorage, never the URL (NEVER #12): a reload re-empties it, so every ✓ (and ✗) is
  // re-earned. This is why it lives in the store singleton (survives a run switch) and nowhere else.
  sealedRuns: SealRecord[]
  setTick(t: number): void; setPlaying(p: boolean): void; setSpeed(s: number): void
  select(entity: string | null, event: number | null): void
  recordSeal(id: string, resultId: string): void
  breakSeal(id: string): void
  applyLink(l: Partial<LinkState>): void
}

// Single source of truth for the default run. applyLink falls back to it (via the store's initial
// runId) whenever a ?run= is absent, so this is THE default-run identity — imported wherever the
// default must be named (e.g. App's error-screen escape hatch) rather than re-spelling the literal.
export const DEFAULT_RUN = 'f1'

export const useViewStore = create<ViewState>((set) => ({
  // Cold open (HERO SWITCH, dev/v0.6): the default run is f1 — a single agent with real recorded motion, so
  // the front door opens on a MOVING vehicle (a positioned run) rather than e0's positionless query stage.
  // f1 is a golden det-only bundle whose trailer self-consistency earns the same ✓ verified voice e0 did,
  // and it carries an authored tour so the zero-click cold open has a first beat to auto-play. e0 is NOT
  // gone — it stays a certified library run (its query stage remains its lens for Hangar visitors); it is
  // only demoted from the default. A ?run= deep link still overrides this (applyLink falls back to it only
  // when run is absent).
  runId: DEFAULT_RUN, tick: 0, fraction: 0, playing: false, speed: 1,
  selectedEntity: null, selectedEvent: null, sealedRuns: [],
  // FINALE (v0.5b T3): ephemeral stage-dressing state — true only at a NATURAL play-to-end rest (the Timeline
  // transport batch writes it at the natural-end edge; ruling 5). It drives the finale display (lit journey,
  // composed close-up, celebrated head / full spine). CLEARED here by any playhead MOVE — a scrub or arrow-key
  // step (setTick, move-guarded: a setTick that lands exactly where the playhead already rests — same tick,
  // fraction 0 — is zero motion and KEEPS it), a deep-link / history replay (applyLink), and starting play
  // (setPlaying(true)); a run-switch clears it atomically in App.selectRun. NOT cleared by a selection (it
  // re-lenses over the lit rest), a speed tap, a pause, or an orbit drag. NEVER serialized: `finale` is absent
  // from LinkState, so applyLink only ever CLEARS it (never SETS it) — a deep-link straight to
  // ?tick=<tickCount> does NOT fire the finale (natural-end is a play-path edge — an accepted asymmetry).
  finale: false,
  // MOVE-guard (final wave): clear the finale only when the playhead actually MOVES — the clamped
  // new tick differs from the resting tick, OR we were mid-fraction (landing on the tick boundary IS a move).
  // An arrow-key step clamped back onto the end rail (same tick, fraction 0) is zero motion → the finale rests.
  setTick: (tick) => set((s) => {
    const t = Math.max(0, Math.floor(tick))
    return { tick: t, fraction: 0, finale: t === s.tick && s.fraction === 0 ? s.finale : false }
  }),
  // Starting play clears the finale; pausing keeps it (a finale only ever rests at playing=false, so a pause
  // that coincides with it must not drop it). Play-at-rest (r1): this clear is RACED by the natural-end edge's
  // re-fire, which lands AFTER and re-sets the flag — net, play-at-rest keeps the finale (coherent).
  setPlaying: (playing) => set((s) => ({ playing, finale: playing ? false : s.finale })),
  setSpeed: (speed) => set({ speed: clampSpeed(speed) }),
  select: (selectedEntity, selectedEvent) => set({ selectedEntity, selectedEvent }),
  // Seal reconciliation wiring (closure item 1) — the pure state machine lives in ui/hangar.ts
  // (recordSeal/breakSeal); both actions preserve reference-stability so a no-op transition (the natural
  // re-fire on every ready re-render, a break on a never-sealed run) returns the unchanged state `s` and
  // fires no update. recordSeal appends a fresh seal, no-ops on the same resultId, REPLACES on a
  // different verified resultId, and never heals a broken record; breakSeal flags a contradicted seal.
  recordSeal: (id, resultId) => set((s) => {
    const next = recordSeal(s.sealedRuns, id, resultId)
    return next === s.sealedRuns ? s : { sealedRuns: next }
  }),
  breakSeal: (id) => set((s) => {
    const next = breakSeal(s.sealedRuns, id)
    return next === s.sealedRuns ? s : { sealedRuns: next }
  }),
  applyLink: (l) => set((s) => ({
    runId: l.run ?? s.runId, tick: l.tick ?? s.tick,
    selectedEntity: l.sel ?? s.selectedEntity, selectedEvent: l.ev ?? s.selectedEvent,
    // applyLink MOVES the playhead (l.tick), and a playhead move CLEARS the finale (the clear grammar, same as
    // setTick). Safe today (mount-only, finale already false) but latent once history nav replays a link over a
    // stale finale rest — the new playhead must not land under old finale dressing. finale is never serialized,
    // so this only ever clears (a deep-link never SETS it).
    finale: false,
    // Deep-link speed goes through the same clamp as setSpeed — a malformed ?speed= can't leave the
    // store on an off-ladder value (which would then fail Timeline's SPEEDS.indexOf-based notching).
    speed: l.speed !== undefined ? clampSpeed(l.speed) : s.speed,
  })),
}))

// -Infinity, not 0: the throttle gates against the last ACTUAL sync, so the very first unforced
// sync after load must never be suppressed by the page-load clock (performance.now() can still be
// < 500 when the first step fires). With step demoted to unforced (task-7 review), a lone ArrowRight
// on a fresh page must still write ?tick= immediately rather than wait for a second interaction.
let lastSync = -Infinity
let pendingFlush: ReturnType<typeof setTimeout> | null = null

// The single write path: always reflects the LATEST store state (the trailing flush reads it fresh
// at fire time, so a coalesced burst still lands on its final value). Records lastSync so the next
// throttle window is measured from a real write, not a dropped call.
function writeUrl(): void {
  const s = useViewStore.getState()
  lastSync = performance.now()
  const qs = encodeLink({ run: s.runId, tick: s.tick, sel: s.selectedEntity, ev: s.selectedEvent, speed: s.speed })
  history.replaceState(null, '', `?${qs}`)
}

export function syncUrl(force = false): void {
  const s = useViewStore.getState()
  if (s.playing) return
  // A forced write lands immediately AND cancels any pending trailing flush: it already carries the
  // latest state, so letting the queued flush fire afterwards would be a redundant duplicate write.
  if (force) {
    if (pendingFlush !== null) { clearTimeout(pendingFlush); pendingFlush = null }
    writeUrl()
    return
  }
  const elapsed = performance.now() - lastSync
  if (elapsed < 500) {
    // Throttled: drop this write but schedule ONE trailing flush for the tail of the window so the
    // last write of a rapid unforced burst isn't silently lost. A flush already queued is left as-is
    // (it reads fresh state when it fires, so it captures whatever the latest value turns out to be).
    if (pendingFlush === null) {
      pendingFlush = setTimeout(() => {
        pendingFlush = null
        if (!useViewStore.getState().playing) writeUrl()
      }, 500 - elapsed)
    }
    return
  }
  writeUrl()
}
export function applyUrlOnLoad(): void {
  useViewStore.getState().applyLink(parseLink(location.search.slice(1)))
}

// Test-only: reset the throttle sentinel and clear any pending trailing flush so timer-based syncUrl
// tests are order-independent. The module-level lastSync/pendingFlush persist across a test file;
// without this a stray timer scheduled by one test could fire during another. Not called in prod.
export function __resetSyncUrl(): void {
  lastSync = -Infinity
  if (pendingFlush !== null) { clearTimeout(pendingFlush); pendingFlush = null }
}
