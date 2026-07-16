import { describe, expect, test } from 'vitest'
import {
  createCampaignQueue, buildCampaignJobs,
  type CampaignVerifyTransport, type QueueEvent,
} from './campaignQueue'
import { ROBUST_F3A } from './campaignCatalog'
import type { RunSummary, VerifyJob } from './campaignVerify'

// A controllable transport: it records each call (job + signal + resolve/reject) so a test can settle jobs in a
// chosen order and observe concurrency + cancellation. It rejects a call whose signal aborts (a real fetch's
// AbortError), and marks it aborted so a test can assert the in-flight fetch was cancelled.
interface Call {
  job: VerifyJob
  signal: AbortSignal
  aborted: boolean
  resolve: (s: RunSummary) => void
  reject: (e: unknown) => void
}
function makeFakeTransport(): { transport: CampaignVerifyTransport; calls: Call[] } {
  const calls: Call[] = []
  const transport: CampaignVerifyTransport = (job, signal) =>
    new Promise<RunSummary>((resolve, reject) => {
      const call: Call = { job, signal, aborted: false, resolve, reject }
      signal.addEventListener('abort', () => { call.aborted = true; reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      calls.push(call)
    })
  return { transport, calls }
}

function fakeSummary(job: VerifyJob): RunSummary {
  return {
    id: job.id, seed: job.seed, status: 'verified', basis: 'campaign-manifest',
    sha256Hex: 'sha', sha256ok: true, caseIdHex: 'case', resultIdHex: 'res',
    caseIdOk: true, resultIdOk: true, matchesTrailer: true, timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  }
}

const flush = () => new Promise<void>(r => setTimeout(r, 0))
const jobs = (n: number): VerifyJob[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), seed: i, campaignId: 'robust-f3a' }))

describe('buildCampaignJobs: jobs name pinned seeds by IDS ONLY (worker owns url + pins)', () => {
  test('one job per pinned seed, carrying {id, seed, campaignId} and NOTHING a caller could spoof', () => {
    const built = buildCampaignJobs(ROBUST_F3A)
    expect(built).toHaveLength(50)
    expect(built[0]!.id).toBe('42')
    expect(built[0]!.seed).toBe(42)
    expect(built[0]!.campaignId).toBe('robust-f3a')
    // The H1 closure: a job carries no url and no expected pins — the worker resolves both from the catalog, so
    // a caller cannot submit its own bytes/pins and mint a false 'verified'.
    expect('url' in built[0]!).toBe(false)
    expect('expected' in built[0]!).toBe(false)
  })
})

describe('createCampaignQueue: order + small concurrency', () => {
  test('dispatches in job order and never exceeds the concurrency', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 2, transport, onEvent: e => events.push(e) })

    q.start(jobs(4))
    // All 4 queued synchronously; exactly 2 started (concurrency).
    expect(events.filter(e => e.type === 'queued')).toHaveLength(4)
    expect(calls).toHaveLength(2)
    expect(calls.map(c => c.job.id)).toEqual(['0', '1'])
    expect(events.filter(e => e.type === 'started').map(e => (e as { id: string }).id)).toEqual(['0', '1'])

    // Complete job 0 → job 2 dispatches (still ≤ 2 in flight), in order.
    calls[0]!.resolve(fakeSummary(calls[0]!.job))
    await flush()
    expect(calls.map(c => c.job.id)).toEqual(['0', '1', '2'])
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)

    // Drain the rest.
    calls[1]!.resolve(fakeSummary(calls[1]!.job))
    await flush()
    calls[2]!.resolve(fakeSummary(calls[2]!.job))
    await flush()
    calls[3]!.resolve(fakeSummary(calls[3]!.job))
    await flush()

    expect(events.filter(e => e.type === 'done')).toHaveLength(4)
    expect(calls.map(c => c.job.id)).toEqual(['0', '1', '2', '3'])
    expect(q.running).toBe(false)
    // done events arrived for every job, no duplicates.
    const doneIds = events.filter(e => e.type === 'done').map(e => (e as { summary: RunSummary }).summary.id)
    expect(doneIds.sort()).toEqual(['0', '1', '2', '3'])
  })
})

describe('createCampaignQueue: cancellation (the decode-cancellation debt)', () => {
  test('cancel mid-queue aborts in-flight fetches, clears the queue, and emits no late events', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 2, transport, onEvent: e => events.push(e) })

    q.start(jobs(5))
    expect(calls).toHaveLength(2) // 2 in flight, 3 pending
    const startedBefore = events.filter(e => e.type === 'started').length
    expect(startedBefore).toBe(2)

    q.cancel()
    // In-flight fetches aborted; queue drained.
    expect(calls[0]!.aborted).toBe(true)
    expect(calls[1]!.aborted).toBe(true)
    expect(q.running).toBe(false)

    await flush()
    // No NEW started (the 3 pending never dispatch) and NO done events at all.
    expect(events.filter(e => e.type === 'started')).toHaveLength(2)
    expect(events.filter(e => e.type === 'done')).toHaveLength(0)
    expect(calls).toHaveLength(2) // no further jobs handed to the transport
  })

  test('a straggler resolution from a cancelled batch is dropped (the epoch fence), even if it ignores abort', async () => {
    // A transport that IGNORES the signal and resolves late — models a fetch that completed the instant cancel
    // fired. The epoch fence must still drop its 'done'.
    const late: { resolve: (s: RunSummary) => void; job: VerifyJob }[] = []
    const transport: CampaignVerifyTransport = (job) =>
      new Promise<RunSummary>((resolve) => { late.push({ resolve, job }) })
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 1, transport, onEvent: e => events.push(e) })

    q.start(jobs(3))
    expect(late).toHaveLength(1)
    q.cancel()
    // Resolve the stranded in-flight job AFTER cancel.
    late[0]!.resolve(fakeSummary(late[0]!.job))
    await flush()
    expect(events.filter(e => e.type === 'done')).toHaveLength(0) // dropped by the epoch fence
    expect(q.running).toBe(false)
  })

  test('restarting (start again) fences the prior batch: its stragglers emit nothing under the new run', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 1, transport, onEvent: e => events.push(e) })

    q.start(jobs(2))
    const firstCall = calls[0]!
    q.start(jobs(2)) // restart — bumps epoch, aborts the prior in-flight
    expect(firstCall.aborted).toBe(true)

    // A late resolution of the FIRST batch's job emits no 'done' (stale epoch).
    firstCall.resolve(fakeSummary(firstCall.job))
    await flush()
    const doneFromStale = events.filter(e => e.type === 'done')
    // Only the NEW batch's in-flight job exists now; the stale one contributed nothing.
    expect(doneFromStale).toHaveLength(0)
  })
})

describe('createCampaignQueue: a transport fault becomes a TERMINAL error (F4 — no stuck seeds)', () => {
  const doneEvents = (events: QueueEvent[]) =>
    events.filter((e): e is Extract<QueueEvent, { type: 'done' }> => e.type === 'done')

  test('a current-epoch non-abort rejection emits a terminal error `done` (the seed reaches error, not stuck running)', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 1, transport, onEvent: e => events.push(e) })

    q.start(jobs(1))
    expect(calls).toHaveLength(1)
    // A transport rejection the worker never mapped to a summary (dynamic-import / Worker ctor / postMessage).
    calls[0]!.reject(new Error('Worker construction failed'))
    await flush()

    const done = doneEvents(events)
    expect(done).toHaveLength(1)
    expect(done[0]!.summary.status).toBe('error')
    expect(done[0]!.summary.id).toBe('0')
    expect(done[0]!.summary.error?.code).toBe('TransportError')
    expect(q.running).toBe(false) // not wedged: pump ran, nothing left in flight
  })

  test('a worker-crash burst (every in-flight rejects) errors ALL in-flight seeds and the queue does not wedge', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 2, transport, onEvent: e => events.push(e) })

    q.start(jobs(4))
    expect(calls).toHaveLength(2) // 2 in flight, 2 pending
    // The client's crash handler rejects every outstanding request (F4).
    calls[0]!.reject(new Error('campaign verify worker crashed: boom'))
    calls[1]!.reject(new Error('campaign verify worker crashed: boom'))
    await flush()
    // The pump kept going: the 2 pending dispatched onto the (freshly recreated) worker.
    expect(calls).toHaveLength(4)
    calls[2]!.reject(new Error('campaign verify worker crashed: boom'))
    calls[3]!.reject(new Error('campaign verify worker crashed: boom'))
    await flush()

    const done = doneEvents(events)
    expect(done).toHaveLength(4)
    expect(done.every(d => d.summary.status === 'error')).toBe(true)
    expect(done.map(d => d.summary.id).sort()).toEqual(['0', '1', '2', '3'])
    expect(q.running).toBe(false)
  })

  test('a straggler rejection from a CANCELLED batch still emits nothing (the epoch fence beats the F4 error path)', async () => {
    const { transport, calls } = makeFakeTransport()
    const events: QueueEvent[] = []
    const q = createCampaignQueue({ concurrency: 2, transport, onEvent: e => events.push(e) })

    q.start(jobs(3))
    q.cancel() // bumps the epoch and aborts in-flight → the fake rejects with AbortError, fenced by the epoch
    await flush()
    expect(calls[0]!.aborted).toBe(true)
    expect(doneEvents(events)).toHaveLength(0) // no terminal error for a fenced (cancelled) seed
    expect(q.running).toBe(false)
  })
})
