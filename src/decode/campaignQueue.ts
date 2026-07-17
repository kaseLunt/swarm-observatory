import { errorSummary, type RunSummary, type VerifyJob } from './campaignVerify'
import type { CampaignCatalog } from './campaignCatalog'

// Is a rejection a cancellation (an AbortError from an aborted signal) rather than a genuine fault? Structural,
// not `instanceof DOMException`, so it holds across environments (node/jsdom/browser).
const isAbortError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ── THE VERIFY-MANY QUEUE (small-concurrency, CANCELLABLE) ────────────────────────────────────────────────
// Feeds jobs to a transport at a small concurrency (2-3) and emits progress. Cancellation is the point (the
// decode-cancellation debt lands here): a run-switch / unmount must ABORT in-flight fetches and CLEAR the queue
// with NO late events. Each in-flight job has its own AbortController; cancel() aborts them all, clears the
// pending list, and bumps an EPOCH so any straggler resolution from the cancelled batch is dropped — no 'done'
// after a cancel, ever. The transport is injected so the queue is testable WITHOUT a worker or a network.

// A transport verifies ONE job, honouring an AbortSignal (aborting → reject). Production: the worker-backed
// transport (campaignWorkerClient.workerTransport). Tests: a controllable fake.
export type CampaignVerifyTransport = (job: VerifyJob, signal: AbortSignal) => Promise<RunSummary>

export type QueueEvent =
  | { type: 'queued'; id: string; seed: number }
  | { type: 'started'; id: string; seed: number }
  | { type: 'done'; summary: RunSummary }

export interface QueueOptions {
  concurrency?: number
  transport?: CampaignVerifyTransport
  onEvent?: (e: QueueEvent) => void
}

export interface CampaignQueue {
  start(jobs: readonly VerifyJob[]): void
  cancel(): void
  readonly running: boolean
}

// A job names a pinned seed by ITS IDS ONLY — {id, seed, campaignId}. The URL and the expected pins are NOT put
// on the wire here: the WORKER resolves them from the in-bundle catalog (the authority for those pins), so neither the queue
// nor a caller can point a seed at other bytes or other pins. `id` is the canonical decimal seed id.
export function buildCampaignJobs(cat: CampaignCatalog): VerifyJob[] {
  return cat.seeds.map(s => ({ id: String(s.seed), seed: s.seed, campaignId: cat.campaignId }))
}

// The default transport lazily dynamic-imports the worker client, so this module can be imported in a node test
// (which injects a fake transport) without ever touching `new Worker`.
const defaultTransport: CampaignVerifyTransport = (job, signal) =>
  import('./campaignWorkerClient').then(m => m.workerTransport(job, signal))

export function createCampaignQueue(opts: QueueOptions = {}): CampaignQueue {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 16))
  const transport = opts.transport ?? defaultTransport
  const emit = opts.onEvent ?? (() => {})

  // The EPOCH is the cancellation fence: every dispatch captures the epoch it belongs to; a completion whose
  // epoch is stale (a cancel/restart bumped it) is dropped WITHOUT emitting or touching `active`.
  let epoch = 0
  let pending: VerifyJob[] = []
  let active = 0
  const controllers = new Set<AbortController>()

  const pump = (myEpoch: number): void => {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!
      active++
      const ctrl = new AbortController()
      controllers.add(ctrl)
      emit({ type: 'started', id: job.id, seed: job.seed })
      transport(job, ctrl.signal).then(
        (summary) => {
          controllers.delete(ctrl)
          if (myEpoch !== epoch) return // stale (cancelled/restarted): no late 'done', no counter touch
          active--
          emit({ type: 'done', summary })
          pump(myEpoch)
        },
        (err) => {
          controllers.delete(ctrl)
          if (myEpoch !== epoch) return // aborted or restarted: swallow — the batch is fenced (no late event)
          active--
          // A CURRENT-EPOCH, non-cancellation rejection is a genuine TRANSPORT fault the worker never got to map
          // to a summary: a dynamic-import failure, a Worker construction throw, a postMessage throw, or a crashed
          // worker. Emit a TERMINAL error summary so the seed reaches 'error' and the rollup counts it —
          // never leave a seed stuck 'running' while the queue idles. (A stray in-epoch AbortError, which should
          // not occur since every abort bumps the epoch, is treated as cancellation: no event.)
          if (!isAbortError(err)) emit({ type: 'done', summary: errorSummary(job.id, job.seed, 'TransportError', errMessage(err)) })
          pump(myEpoch)
        },
      )
    }
  }

  const clearInflight = (): void => {
    controllers.forEach(c => c.abort())
    controllers.clear()
    active = 0
  }

  return {
    start(jobs) {
      epoch++
      const myEpoch = epoch
      clearInflight()       // a restart aborts any prior batch's fetches
      pending = [...jobs]
      for (const j of jobs) emit({ type: 'queued', id: j.id, seed: j.seed })
      pump(myEpoch)
    },
    cancel() {
      epoch++               // fence: strand every in-flight promise from the cancelled batch
      pending = []          // clear the queue
      clearInflight()       // abort in-flight fetches
    },
    get running() {
      return active > 0 || pending.length > 0
    },
  }
}
