import { useEffect, useState } from 'react'
import { fetchBundle, fetchDet, decodeInWorker } from '../source/bundleSource'
import { gateManifest, parseManifest, type GateResult, type Identity, type RunManifest } from '../decode/manifest'
import { comparableManifestPins, verdictAgainstManifest, type ManifestPinComparison, type TrailerPins, type TrustVerdict } from '../decode/verify'
import { resolveLoadPlan } from '../decode/runCatalog'
import { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'
import { prefersReducedMotion } from './motion'
import identity from '../../contract/identity.json'

// Enriched by the publish step (tools/runIndex.mjs): `ticks` + `kinds` are DECLARED metadata decoded
// from the published bytes (proven true by publication.test.ts); `dtUs` is present only for full-
// manifest runs (absent for det-only e0/f1); `supersedesPlanId` is surfaced only when a manifest
// carries a non-zero chain (none today). The Hangar reads these to render cards without decoding.
export interface RunEntry {
  id: string; title: string; base: string; detOnly?: boolean
  ticks: number; kinds: Record<string, number>; dtUs?: number; supersedesPlanId?: string
}

// Single-fetch seam for runs/index.json. App's run switcher and useRun's entry lookup both
// need the index; each used to fetch it independently, so a cold load hit the network TWICE for one
// static file. This memoizes the parsed result: the first caller starts the fetch and concurrent/later
// callers share the same in-flight (then resolved) promise — exactly ONE request. A FAILURE is NOT
// cached (the slot is cleared on rejection) so a later run switch retries — preserving useRun's original
// per-load fetch semantics. The !ok→throw keeps useRun's exact 'fetch runs/index.json: <status>' error;
// App wraps its call in a catch, so a failure still lands it on an empty switcher, exactly as before.
let runIndexCache: Promise<RunEntry[]> | null = null
export function loadRunIndex(): Promise<RunEntry[]> {
  if (runIndexCache) return runIndexCache
  const pending = fetch('runs/index.json').then(res => {
    if (!res.ok) throw new Error('fetch runs/index.json: ' + res.status)
    return res.json() as Promise<RunEntry[]>
  })
  runIndexCache = pending
  pending.catch(() => { if (runIndexCache === pending) runIndexCache = null })
  return pending
}

// The staged load phases (spec §6 verification ceremony). These are DISPLAY-staging of REAL
// arrival events, not a fabricated pipeline: 'fetching' before the network fetches, 'decoding'
// on the first worker progress message, 'verifying' when the worker's done message arrives (the
// recomputed hashes now EXIST — this beat displays them), 'ready' once the model is published.
// Verification is NOT a separable async stage: foldAndVerify runs inside the worker's decode and
// its result lands WITH 'done'. See PHASE_FLOOR_MS for why 'verifying' is nonetheless perceptible.
export type RunPhase = 'idle' | 'fetching' | 'decoding' | 'verifying' | 'ready'
// matchesTrailer is threaded alongside the hex so the ceremony's event_hash tick binds to the in-bundle
// self-consistency verdict (foldAndVerify over the recomputable fields) — a trailer-inconsistent bundle
// ticks ✗ on that row, not a false ✓. `verdict` is the TRUST verdict (the seal fold), a DISCRIMINATED
// value, not a boolean: 'manifest-verified' folds every manifest pin for a full-manifest run; 'self-consistent'
// for a det-only run (no external oracle — the attested voice, never a green ✓); 'mismatch' when a pin
// disagrees. The surfaces that could mint a green "verified" — the thesis card, the Hangar seal, the ceremony's
// result_id tick + step — bind to `verdict`, never matchesTrailer alone, so a manifest-mismatching run can
// never seal green while Provenance shows its row red, and a det-only run never earns the manifest-grade green.
//   `pins` is the per-manifest-pin comparison list — THE SAME comparableManifestPins ProvenancePanel
// renders row-by-row — threaded so the ceremony's NAMED hash rows (event_hash, result_id) grade from THEIR OWN
// pin, not the aggregate verdict: when ONLY the manifest's event_hash is corrupted (bundle clean, verdict
// 'mismatch') the event_hash row must red while result_id stays ✓ — the true per-pin picture Provenance shows,
// not the inverse the aggregate grading painted. null on a det-only run (no manifest to compare a pin against).
//   `trailerPins` is the per-field trailer comparison so the ceremony's event_hash row grades from its OWN
// in-bundle reproduction, not the aggregate matchesTrailer: a trailer whose stored STATE hash is corrupt reds the
// state comparison (matchesTrailer false) without falsely ✗-ing the event_hash row, whose own bytes reproduced fine.
export interface CeremonyHashes { eventHash: string; resultId: string; matchesTrailer: boolean; verdict: TrustVerdict; pins: ManifestPinComparison[] | null; trailerPins: TrailerPins }

interface RunState {
  model: RunModel | null
  gate: GateResult | null
  error: string | null
  progress: number
  phase: RunPhase
  hashes: CeremonyHashes | null
  // Identity of the run whose bytes are CURRENTLY published (the seal-race fix). Set to `runId`
  // ONLY in the final ready-state update that publishes model+hashes, and nulled on every reset. This is
  // the identity CARRIED WITH THE DATA: during a run switch the store runId flips synchronously while this
  // (and model/hashes) still name the PRIOR run for one commit, so a seal must gate on loadedRunId===runId
  // — join async state by identity, never by effect timing. null until the first run reaches ready.
  loadedRunId: string | null
  // Settle beat (Task v04-7): true for the ~400ms payoff hold where the verification ceremony rests on
  // the COMPLETED double-✓ (both hash rows confirmed, the confirm line marked done) before the model
  // publishes and the ceremony dissolves. Purely a DISPLAY beat on real, already-computed hashes —
  // reduced-motion skips it (like the phase floors). Ceremony reads it to force the confirm line 'done'.
  settling: boolean
}

// Perceptibility floor: a fast fixture can decode+verify faster than the eye can read, flashing
// the ceremony past. We defer only the DISPLAY swap to the next phase so each visible beat lingers
// ~600ms — the work has already happened and the data shown is always the real recomputed result;
// we are not faking a stage, only holding an honest one on screen long enough to be witnessed.
// Gated behind NOT reduced-motion: reduced-motion cuts straight through (floors skipped entirely).
const PHASE_FLOOR_MS = 600
// Settle-beat duration: the payoff hold on the completed ✓✓ before dissolve. Short enough to feel like
// a beat, not a stall; long enough to be witnessed as "verified" landing before the app takes over.
const SETTLE_MS = 400
// Shared cancellable timer (the floors pattern): resolves after `ms`, and registers the timer so an
// unmount (run switch / navigate-away) clears it via the effect cleanup — never a leaked setState.
function hold(ms: number, timers: Set<ReturnType<typeof setTimeout>>): Promise<void> {
  return new Promise<void>(resolve => {
    const id = setTimeout(() => {
      timers.delete(id)
      resolve()
    }, ms)
    timers.add(id)
  })
}
async function floorPhase(startedAt: number, timers: Set<ReturnType<typeof setTimeout>>): Promise<void> {
  if (prefersReducedMotion()) return
  const remaining = PHASE_FLOOR_MS - (performance.now() - startedAt)
  if (remaining > 0) await hold(remaining, timers)
}
// The completed-✓✓ payoff hold. Reduced-motion cuts straight through (like the phase floors).
async function settleBeat(timers: Set<ReturnType<typeof setTimeout>>): Promise<void> {
  if (prefersReducedMotion()) return
  await hold(SETTLE_MS, timers)
}

// Pure consumer-seam invariant: parseLink can validate ev/sel as finite/non-negative at parse time,
// but NOT against an event/entity range it can't know yet (the model doesn't exist until it decodes) —
// so an out-of-range ev (e.g. a deep link's ev=9999 on a 75-event run) or a stale entity key from a
// prior run/deep-link must be clamped HERE, once a real model exists, before either value ever reaches
// chain code. An out-of-range seq crashes causalChain (childrenOf(seq) spreads undefined past the end
// of `children`); a stale entity key is not crash-prone (eventsForSubject/lookups fall back safely) but
// is meaningless against this model, so it is cleared too. Exported so the invariant is unit-testable
// without a live Zustand store — see useRun.test.ts.
export function clampSelection(
  model: RunModel, entity: string | null, event: number | null,
): { entity: string | null; event: number | null } {
  const clampedEvent = event !== null && (event < 0 || event >= model.eventCount) ? null : event
  const clampedEntity = entity !== null && !model.entityKeys().includes(entity) ? null : entity
  return { entity: clampedEntity, event: clampedEvent }
}

// Enforce the selection invariant BEFORE a freshly-constructed model is published to component state.
// The children (Inspector/Timeline) render synchronously against the new model on the very same
// commit; a stale selectedEvent (carried in from a deep link or a prior run) pointing past this
// model's event range would reach chain code (childrenOf(seq) spreads undefined) and crash on that
// first render — before App's belt-and-suspenders clamp effect ever gets to run. Clamping here (via
// the pure clampSelection above) guarantees the model is never observed in an inconsistent state.
function enforceSelectionInvariant(model: RunModel): void {
  const st = useViewStore.getState()
  const { entity, event } = clampSelection(model, st.selectedEntity, st.selectedEvent)
  if (entity !== st.selectedEntity || event !== st.selectedEvent) st.select(entity, event)
}

export function useRun(runId: string) {
  const [state, setState] = useState<RunState>({ model: null, gate: null, error: null, progress: 0, phase: 'idle', hashes: null, settling: false, loadedRunId: null })
  useEffect(() => {
    let alive = true
    const timers = new Set<ReturnType<typeof setTimeout>>()
    setState({ model: null, gate: null, error: null, progress: 0, phase: 'fetching', hashes: null, settling: false, loadedRunId: null })

    // Shared decode → verify → ready staging for both the manifest and det-only paths. The header
    // schema gate runs the instant 'done' arrives (before we display 'verifying' as confirmed), so a
    // newer-dialect bundle routes to the gate screen rather than pretending to confirm its hashes.
    const stageDecode = async (det: ArrayBuffer, manifest: RunManifest | null, gate: GateResult): Promise<void> => {
      let decodeStart = 0
      const run = await decodeInWorker(det, f => {
        if (!alive) return
        if (decodeStart === 0) decodeStart = performance.now()
        setState(s => ({ ...s, phase: 'decoding', progress: f }))
      })
      if (decodeStart === 0) decodeStart = performance.now()
      const idn = identity as Identity
      if (manifest === null) {
        if (run.header.eventSchemaVersion !== idn.eventSchemaVersion || run.header.stateSchemaVersion !== idn.stateSchemaVersion) {
          if (alive) setState(s => ({ ...s, gate: { ok: false, field: 'bundle.det schema versions', expected: `${idn.eventSchemaVersion}/${idn.stateSchemaVersion}`, actual: `${run.header.eventSchemaVersion}/${run.header.stateSchemaVersion}` } }))
          return
        }
      } else {
        if (run.header.eventSchemaVersion !== idn.eventSchemaVersion) {
          if (alive) setState(s => ({ ...s, gate: { ok: false, field: 'bundle.det event_schema_version', expected: String(idn.eventSchemaVersion), actual: String(run.header.eventSchemaVersion) } }))
          return
        }
        if (run.header.stateSchemaVersion !== idn.stateSchemaVersion) {
          if (alive) setState(s => ({ ...s, gate: { ok: false, field: 'bundle.det state_schema_version', expected: String(idn.stateSchemaVersion), actual: String(run.header.stateSchemaVersion) } }))
          return
        }
      }
      // Hashes now exist. Hold 'decoding' to its floor, then reveal the recomputed short-hex as the
      // 'verifying' beat, then hold that to its floor before publishing the model as 'ready'.
      await floorPhase(decodeStart, timers)
      if (!alive) return
      const pins = manifest ? comparableManifestPins(run.verify, manifest) : null
      const hashes: CeremonyHashes = { eventHash: run.verify.eventHashHex, resultId: run.verify.resultIdHex, matchesTrailer: run.verify.matchesTrailer, verdict: verdictAgainstManifest(run.verify, manifest), pins, trailerPins: run.verify.trailerPins }
      const verifyStart = performance.now()
      setState(s => ({ ...s, phase: 'verifying', progress: 1, hashes }))
      await floorPhase(verifyStart, timers)
      if (!alive) return
      // Payoff settle beat: flip to the completed double-✓ (confirm line 'done', both hashes ✓✓) and
      // hold ~400ms BEFORE the model publishes — the ceremony rests on the resolved verdict rather than
      // snapping straight to the app. The model is built AFTER the beat so the app takes over on dissolve.
      setState(s => ({ ...s, settling: true }))
      await settleBeat(timers)
      if (!alive) return
      const model = new RunModel(run, manifest)
      enforceSelectionInvariant(model)
      // loadedRunId is published HERE, atomically with model+hashes — the identity that lets App's seal
      // effect know these exact hashes belong to THIS runId, never the run we just switched from.
      setState({ model, gate, error: null, progress: 1, phase: 'ready', hashes, settling: false, loadedRunId: runId })
    }

    ;(async () => {
      try {
        // The load plan comes from the TRUSTED CATALOG (in-app, pinned), never from unsigned
        // runs/index.json: a certified id's base is fixed here, so a tampered index entry cannot point this
        // run at another run's bytes, and a manifest-required run cannot be silently downgraded to det-only.
        // A NON-conforming id (path traversal, a slash) resolves to NO plan: throw the unknown-run error
        // (the existing error-screen path) rather than issue a fetch against a spoofable normalized path.
        const plan = resolveLoadPlan(runId)
        if (plan === null) throw new Error(`unknown run '${runId}'`)
        if (!plan.manifestRequired) {
          // Catalog det-only (e0/f1) OR an uncertified future/dev id — self-consistent at most, never a manifest
          // oracle. The base is the catalog's / the id's own, not index.json's `base`.
          if (!plan.certified) {
            // An UNCERTIFIED id is not a catalog citizen. Optimistically load its own base, but a failure to fetch
            // OR decode real bundle bytes means the run does not exist — surface "unknown run", not a raw fetch/
            // BadMagic error (a nonexistent run's `.det` resolves to the SPA shell, so the decode fails BadMagic,
            // not the fetch). A CERTIFIED det-only run (e0/f1) below keeps its real error: it IS a known run, so an
            // unloadable bundle is a genuine fault, never "unknown run".
            try {
              const det = await fetchDet(plan.base)
              await stageDecode(det, null, { ok: true })
            } catch {
              throw new Error(`unknown run '${runId}'`)
            }
            return
          }
          const det = await fetchDet(plan.base)
          await stageDecode(det, null, { ok: true })
          return
        }
        // Manifest REQUIRED (a certified full-manifest run): a missing/unfetchable manifest is an ERROR
        // (fetchBundle throws on a non-ok manifest fetch), surfaced on the error screen — never a silent
        // det-only downgrade that would mint a false self-consistent green.
        const { det, manifestText } = await fetchBundle(plan.base)
        const manifest = parseManifest(manifestText)
        const gate = gateManifest(manifest, identity as Identity)
        if (!gate.ok) { if (alive) setState(s => ({ ...s, gate })); return }
        await stageDecode(det, manifest, gate)
      } catch (e) {
        if (alive) setState(s => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
      }
    })()
    return () => {
      alive = false
      timers.forEach(id => clearTimeout(id))
      timers.clear()
    }
  }, [runId])
  return state
}
