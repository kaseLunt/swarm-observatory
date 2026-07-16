import { describe, expect, test } from 'vitest'
import { createWorkerTransport, type WorkerLike } from './campaignWorkerClient'
import { deriveRunStatus, errorSummary } from './campaignVerify'
import type { RunStatus, RunSummary, VerifyJob } from './campaignVerify'

// ── The worker-backed transport, exercised against a FAKE worker (a real `new Worker` cannot run under
//    vitest/node). These pin the two protocol properties the review flagged: TOKEN correlation (F3 — a reused
//    seed id must not let a stale pre-cancel result settle a restarted job) and CRASH recovery (F4 — an async
//    worker fault rejects every outstanding request and lets a fresh worker be recreated). ──

type Listener = (ev: { data?: unknown; message?: string }) => void
interface PostedMsg { type?: string; requestToken?: number; base?: string; seed?: number; campaignId?: string }

class FakeWorker implements WorkerLike {
  readonly posted: PostedMsg[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()

  postMessage(message: unknown): void { this.posted.push(message as PostedMsg) }
  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (set === undefined) { set = new Set(); this.listeners.set(type, set) }
    set.add(listener)
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
  terminate(): void { this.terminated = true }

  // ── test drivers ──
  // `summary` is UNKNOWN (not RunSummary) so a test can post a malformed payload (null, {}, wrong id/status) and
  // exercise the fail-closed validation (F1).
  emitResult(requestToken: number, summary: unknown): void {
    this.fire('message', { data: { type: 'result', requestToken, summary } })
  }
  // Fire an ARBITRARY (possibly malformed) message envelope on the 'message' channel — used to exercise the
  // envelope-level fail-closed guard (F1): a non-object payload, a wrong `type`, or a missing/non-integer token.
  emitRaw(data: unknown): void { this.fire('message', { data }) }
  emitCrash(message = 'boom'): void { this.fire('error', { message }) }
  emitMessageError(message = 'structured-clone failed'): void { this.fire('messageerror', { message }) }
  messages(type: string): PostedMsg[] { return this.posted.filter(m => m.type === type) }
  private fire(type: string, ev: { data?: unknown; message?: string }): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l(ev)
  }
}

const job = (seed: number): VerifyJob => ({ id: String(seed), seed, campaignId: 'robust-f3a' })

// CANONICAL 64-char lowercase hex digests — the EXACT shape the verify core mints (toHex of a 32-byte digest). The
// classifier now enforces the digest FORMAT law (HEX64) on sha256Hex and the two id hexes, so a legitimate-path
// fixture MUST carry canonical digests or it would (correctly) crash as skew. These are real f0_seed42 pins, so a
// green fixture looks exactly like a real one; the classifier checks FORMAT, not value, so any valid 64-hex stands.
const HEX_SHA = 'd52942f3682a956b1e8ae6ef38546233ecadb16c6c479cebe070e88e82ddb5d3'    // a real bundle_det_sha256
const HEX_CASE = '12ce20780433ba2793c30f6d68b2fb9567e02f694746557fdaafad1fd58ce6ad'   // a real case_id
const HEX_RESULT = 'f6d63fbd6f14ae0bbe3dd2b4070435e13f66e11ef214d9339338fa00a7737f55' // a real result_id

function summary(id: string, status: RunStatus): RunSummary {
  return {
    id, seed: Number(id), status, basis: 'campaign-manifest',
    sha256Hex: HEX_SHA, sha256ok: status === 'verified', caseIdHex: HEX_CASE, resultIdHex: HEX_RESULT,
    caseIdOk: status === 'verified', resultIdOk: status === 'verified', matchesTrailer: status !== 'error',
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  }
}

describe('createWorkerTransport: the message protocol (F1 — ids only, F2 — base at init)', () => {
  test('inits the worker once with the app base and posts a verify carrying {requestToken, campaignId, seed} only', () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/swarm-observatory/')
    void transport(job(42), new AbortController().signal)

    const inits = w.messages('init')
    expect(inits).toHaveLength(1)
    expect(inits[0]!.base).toBe('/swarm-observatory/') // trusted config, passed once (F2)
    const verifies = w.messages('verify')
    expect(verifies).toHaveLength(1)
    expect(verifies[0]!.requestToken).toBe(1) // tokens are monotonic FROM 1 (0 is never-issued — F2)
    expect(verifies[0]!.campaignId).toBe('robust-f3a')
    expect(verifies[0]!.seed).toBe(42)
    // The wire carries NO url and NO expected pins — the worker owns those (F1).
    expect('url' in verifies[0]!).toBe(false)
    expect('expected' in verifies[0]!).toBe(false)
  })

  test('a second job reuses the one persistent worker (init posted only once)', () => {
    let made = 0
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => { made++; return w }, '/')
    void transport(job(42), new AbortController().signal)
    void transport(job(43), new AbortController().signal)
    expect(made).toBe(1)
    expect(w.messages('init')).toHaveLength(1)
    expect(w.messages('verify')).toHaveLength(2)
  })

  test('a result settles the matching request by token', async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal)
    const token = w.messages('verify')[0]!.requestToken!
    w.emitResult(token, summary('42', 'verified'))
    await expect(p).resolves.toMatchObject({ id: '42', status: 'verified' })
  })
})

describe('createWorkerTransport: TOKEN correlation drops stale results (F3)', () => {
  test('a stale pre-cancel result (reused seed id) is dropped by token; the restarted job gets its OWN result', async () => {
    const w = new FakeWorker()
    const { transport, stats } = createWorkerTransport(() => w, '/')

    // Job 1 for seed 42 → token 0; cancel it (a restart is coming).
    const ac1 = new AbortController()
    const p1 = transport(job(42), ac1.signal)
    const token0 = w.messages('verify')[0]!.requestToken!
    ac1.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    expect(w.messages('cancel').map(c => c.requestToken)).toContain(token0)

    // Restart: a NEW job for the SAME seed id 42 → token 1, a fresh promise/listener.
    const ac2 = new AbortController()
    const p2 = transport(job(42), ac2.signal)
    const token1 = w.messages('verify')[1]!.requestToken!
    expect(token1).not.toBe(token0)

    // The OLD in-flight fetch completes AFTER the restart, bearing the STALE token 0 with the wrong verdict.
    w.emitResult(token0, summary('42', 'mismatch'))
    expect(stats.droppedStale).toBe(1) // dropped — a stale token never settles a live promise

    // Only token 1's own result settles p2 (never the reused seed id).
    w.emitResult(token1, summary('42', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '42', status: 'verified' })
  })

  test('cancellation during folding: a late result for the aborted token is dropped, not delivered', async () => {
    const w = new FakeWorker()
    const { transport, stats } = createWorkerTransport(() => w, '/')
    const ac = new AbortController()
    const p = transport(job(42), ac.signal)
    const token = w.messages('verify')[0]!.requestToken!
    ac.abort() // cancel WHILE the worker is still folding
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(w.messages('cancel').map(c => c.requestToken)).toContain(token)
    // The fold finished a beat after the cancel and posted a result — it must be dropped.
    w.emitResult(token, summary('42', 'verified'))
    expect(stats.droppedStale).toBe(1)
  })

})

describe('createWorkerTransport: issuance-tracked stale vs never-issued tokens (F2)', () => {
  // Only a RETIRED token — one this client actually issued (0 < token < nextToken) then resolved/cancelled/
  // superseded — is a stale drop. A NEVER-ISSUED token (>= nextToken, <= 0, non-safe-integer) could not have been
  // minted by the worker (it mints from the client's monotonic counter), so while a real request is live it is
  // fail-closed to the crash path — a silent drop there would strand the live token forever (there is no timeout).

  test('a NEVER-ISSUED high token (9999) while a request is LIVE crashes and recovers', async () => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal) // token 1, LIVE (never settled)
    const w0 = workers[0]!
    w0.emitResult(9999, summary('42', 'verified')) // 9999 >= nextToken → never issued → would strand token 1 → crash
    await expect(p1).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
    // Recovery: the next dispatch recreates a fresh worker and settles normally.
    const p2 = transport(job(43), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    const token = w1.messages('verify')[0]!.requestToken!
    w1.emitResult(token, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })

  test('a NEVER-ISSUED non-positive token (-1) while a request is LIVE crashes and recovers', async () => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal) // token 1, LIVE
    const w0 = workers[0]!
    w0.emitResult(-1, summary('42', 'verified')) // token <= 0 → never issued → would strand token 1 → crash
    await expect(p1).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
    const p2 = transport(job(43), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    w1.emitResult(w1.messages('verify')[0]!.requestToken!, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })

  test('a genuinely RETIRED token (issued, resolved, then replayed) is a silent counted drop, never a crash', async () => {
    const w = new FakeWorker()
    const { transport, stats } = createWorkerTransport(() => w, '/')
    // Issue token 1 and RESOLVE it — it is now retired (0 < 1 < nextToken, not inflight).
    const p1 = transport(job(42), new AbortController().signal)
    const retiredToken = w.messages('verify')[0]!.requestToken!
    w.emitResult(retiredToken, summary('42', 'verified'))
    await expect(p1).resolves.toMatchObject({ id: '42', status: 'verified' })
    // A concurrent LIVE request, so a crash (were it to happen) would be observable via terminate().
    const p2 = transport(job(43), new AbortController().signal)
    // Replay the RETIRED token — issued and settled, so a stale drop, never a crash (even while p2 is live).
    w.emitResult(retiredToken, summary('42', 'mismatch'))
    expect(stats.droppedStale).toBe(1)
    expect(w.terminated).toBe(false) // the live request and the worker are untouched
    w.emitResult(w.messages('verify')[1]!.requestToken!, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })

  test('a NEVER-ISSUED token while IDLE (no request live) is a counted drop, never a crash', async () => {
    const w = new FakeWorker()
    const { transport, stats } = createWorkerTransport(() => w, '/')
    // Bring the worker up and DRAIN it so nothing is inflight.
    const p1 = transport(job(42), new AbortController().signal)
    w.emitResult(w.messages('verify')[0]!.requestToken!, summary('42', 'verified'))
    await expect(p1).resolves.toMatchObject({ id: '42', status: 'verified' })
    w.emitResult(9999, summary('42', 'verified')) // never issued, but idle → nothing to strand → counted drop
    expect(stats.droppedStale).toBe(1)
    expect(w.terminated).toBe(false)
  })

  test('token issuance stays GLOBALLY MONOTONIC across a crash-driven worker recreation (retired stays sound)', async () => {
    const workers: FakeWorker[] = []
    const { transport, stats } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    // First worker: issue token 1, then crash it.
    const p1 = transport(job(42), new AbortController().signal)
    const w0 = workers[0]!
    const preCrashToken = w0.messages('verify')[0]!.requestToken!
    w0.emitCrash('boom')
    await expect(p1).rejects.toThrow(/crashed/)
    // Second worker: its first token is preCrashToken + 1 — the counter did NOT reset on recreation (it lives in
    // the transport, not the worker), so a pre-crash token can never collide with a post-crash one.
    const p2 = transport(job(43), new AbortController().signal)
    const w1 = workers[1]!
    const postCrashToken = w1.messages('verify')[0]!.requestToken!
    expect(postCrashToken).toBe(preCrashToken + 1)
    // Replaying the pre-crash token on the NEW worker is retired (0 < preCrashToken < nextToken), so it drops — it
    // does NOT crash the fresh worker even though p2 is live (soundness of 'retired' across recreations).
    w1.emitResult(preCrashToken, summary('42', 'verified'))
    expect(stats.droppedStale).toBe(1)
    expect(w1.terminated).toBe(false)
    w1.emitResult(postCrashToken, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })
})

describe('createWorkerTransport: crash recovery (F4)', () => {
  test('a crash rejects ALL outstanding requests, terminates the worker, and the next job runs on a fresh one', async () => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')

    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    expect(workers).toHaveLength(1)
    const w0 = workers[0]!

    w0.emitCrash('segfault')
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)

    // A subsequent dispatch recreates a FRESH worker (init re-posted on the new one) and works normally.
    const p3 = transport(job(44), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    expect(w1.messages('init')).toHaveLength(1)
    const token = w1.messages('verify')[0]!.requestToken!
    w1.emitResult(token, summary('44', 'verified'))
    await expect(p3).resolves.toMatchObject({ id: '44', status: 'verified' })
  })

  test('a Worker construction failure rejects the transport promise (the queue turns it into a terminal error)', async () => {
    const { transport } = createWorkerTransport(() => { throw new Error('Worker ctor blew up') }, '/')
    await expect(transport(job(42), new AbortController().signal)).rejects.toThrow('Worker ctor blew up')
  })

  test('a pre-aborted signal rejects immediately without constructing a worker', async () => {
    let made = 0
    const { transport } = createWorkerTransport(() => { made++; return new FakeWorker() }, '/')
    const ac = new AbortController()
    ac.abort()
    await expect(transport(job(42), ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(made).toBe(0)
  })
})

describe('createWorkerTransport: fail-closed protocol validation (F1)', () => {
  // A malformed-but-deserialisable result on a LIVE token is a worker regression/skew. Under a `messageerror`-only
  // guard it would hang (summary:null → the promise never settles) or lie (summary:{} → a bogus verdict the store
  // ignores, seed stuck 'running'). Fail-closed routes it to the crash path: reject ALL outstanding, terminate,
  // recreate on the next dispatch.
  const missingTimings = (): unknown => {
    const s = summary('42', 'verified') as unknown as Record<string, unknown>
    delete s.timings
    return s
  }
  test.each<[string, unknown]>([
    ['summary=null (deserialisable but empty)', null],
    ['an empty-object summary (shallow-valid, zero fields)', {}],
    ['a status outside the RunStatus enum', { ...summary('42', 'verified'), status: 'bogus' }],
    ['a summary missing its timings block', missingTimings()],
  ])('a live-token result with %s is a protocol crash: all outstanding reject, next start runs fresh', async (_label, bad) => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!

    w0.emitResult(token0, bad) // LIVE token, malformed summary → fail-closed → crash
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)

    // The next dispatch recreates a FRESH worker (init re-posted) and settles normally.
    const p3 = transport(job(44), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    expect(w1.messages('init')).toHaveLength(1)
    const token = w1.messages('verify')[0]!.requestToken!
    w1.emitResult(token, summary('44', 'verified'))
    await expect(p3).resolves.toMatchObject({ id: '44', status: 'verified' })
  })

  test('a live-token result naming a DIFFERENT seed (id/seed mismatch) is a protocol crash', async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal) // token 0 EXPECTS seed 42
    const token0 = w.messages('verify')[0]!.requestToken!
    w.emitResult(token0, summary('43', 'verified')) // a result for seed 43 on seed 42's live token
    await expect(p).rejects.toThrow(/crashed/)
    expect(w.terminated).toBe(true)
  })

  test('a MALFORMED result on a STALE token stays a silent drop (counted), never a crash', async () => {
    const w = new FakeWorker()
    const { transport, stats } = createWorkerTransport(() => w, '/')
    const ac1 = new AbortController()
    const p1 = transport(job(42), ac1.signal) // token 0
    const token0 = w.messages('verify')[0]!.requestToken!
    ac1.abort()                               // token 0 now stale
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    const p2 = transport(job(43), new AbortController().signal) // token 1, LIVE

    w.emitResult(token0, null)                // malformed AND stale → drop, NOT crash
    expect(stats.droppedStale).toBe(1)
    expect(w.terminated).toBe(false)          // the live job and the worker are untouched

    const token1 = w.messages('verify')[1]!.requestToken!
    w.emitResult(token1, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })

  test('an actual messageerror event (structured-clone failure) rejects all outstanding and recreates', async () => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!

    w0.emitMessageError('clone failed')       // the ACTUAL messageerror path (distinct from schema-invalid 'message' data)
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)

    const p3 = transport(job(44), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const token = workers[1]!.messages('verify')[0]!.requestToken!
    workers[1]!.emitResult(token, summary('44', 'verified'))
    await expect(p3).resolves.toMatchObject({ id: '44', status: 'verified' })
  })
})

describe('createWorkerTransport: envelope-level fail-closed guard (F1)', () => {
  // A malformed result ENVELOPE has NO valid finite-integer token to correlate, so it can never settle a promise
  // and — unlike a valid-but-stale token — is not attributable to a superseded dispatch. While ANY request is
  // live it would strand it forever (no timeout; messageerror won't fire — the payload cloned fine), so it crashes
  // the shared recovery path. While idle nothing can strand, so it stays a counted drop.
  const malformed: [string, unknown][] = [
    ['a result missing its requestToken', { type: 'result', summary: summary('42', 'verified') }],
    ['a string requestToken', { type: 'result', requestToken: '0', summary: summary('42', 'verified') }],
    ['a NaN requestToken', { type: 'result', requestToken: NaN, summary: summary('42', 'verified') }],
    ['an Infinity requestToken', { type: 'result', requestToken: Infinity, summary: summary('42', 'verified') }],
    ['a non-integer requestToken', { type: 'result', requestToken: 1.5, summary: summary('42', 'verified') }],
    ['a non-object message', 42],
  ]

  test.each(malformed)('%s while a request is LIVE is a protocol crash: all outstanding reject, next start runs fresh', async (_label, bad) => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!

    w0.emitRaw(bad) // no valid token → cannot address either live request → fail-closed crash
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)

    // The next dispatch recreates a FRESH worker (init re-posted) and settles normally.
    const p3 = transport(job(44), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    expect(w1.messages('init')).toHaveLength(1)
    const token = w1.messages('verify')[0]!.requestToken!
    w1.emitResult(token, summary('44', 'verified'))
    await expect(p3).resolves.toMatchObject({ id: '44', status: 'verified' })
  })

  test.each(malformed)('%s while IDLE (no request live) is a counted drop, never a crash', async (_label, bad) => {
    const workers: FakeWorker[] = []
    const { transport, stats } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    // Bring the worker up and DRAIN it, so the message listener is attached but nothing is inflight.
    const p1 = transport(job(42), new AbortController().signal)
    const w0 = workers[0]!
    w0.emitResult(w0.messages('verify')[0]!.requestToken!, summary('42', 'verified'))
    await expect(p1).resolves.toMatchObject({ id: '42', status: 'verified' })

    w0.emitRaw(bad) // idle → nothing to strand → counted drop, worker untouched
    expect(stats.droppedStale).toBe(1)
    expect(w0.terminated).toBe(false)

    // The SAME worker keeps serving — no recreate.
    const p2 = transport(job(43), new AbortController().signal)
    expect(workers).toHaveLength(1)
    w0.emitResult(w0.messages('verify')[1]!.requestToken!, summary('43', 'verified'))
    await expect(p2).resolves.toMatchObject({ id: '43', status: 'verified' })
  })
})

describe('createWorkerTransport: semantic contradiction is fail-closed (F2)', () => {
  // A summary whose wire status LABEL contradicts its own EVIDENCE must never settle a promise. The derivation is
  // authoritative (deriveRunStatus), so a live-token result carrying such a label is a protocol crash — it rejects
  // (/crashed/) rather than resolving 'verified', so a mislabelled green can never reach the rollup.
  test.each<[string, unknown]>([
    ['verified with sha256ok:false', { ...summary('42', 'verified'), sha256ok: false }],
    ['verified with null id hexes', { ...summary('42', 'verified'), caseIdHex: null, resultIdHex: null }],
    ['verified with caseIdOk:false', { ...summary('42', 'verified'), caseIdOk: false }],
    ['mismatch whose every check passed', { ...summary('42', 'mismatch'), sha256ok: true, caseIdOk: true, resultIdOk: true, matchesTrailer: true }],
  ])('a live-token result labelled %s is a protocol crash (label ≠ derived), never delivered', async (_label, contradictory) => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!

    w0.emitResult(token0, contradictory) // live token, label contradicts evidence → crash, never a green
    await expect(p1).rejects.toThrow(/crashed/) // rejects — NOT resolves({ status: 'verified' })
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })
})

describe('createWorkerTransport: operational errors declare, contradictions crash (F1)', () => {
  // The three-way rule. An OPERATIONAL errorSummary (sha256ok false ∧ id hexes null ∧ matchesTrailer false ∧ a
  // well-formed {code,message}) DECLARES an operational failure — deriveRunStatus maps that shape to 'mismatch', so
  // it is exempt from derivation equality and is DELIVERED as 'error' rather than crashing the shared worker.
  // Contradictions (an 'error' whose evidence decoded, or one missing its error block) still crash.

  test("a canonical errorSummary (FetchError) beside a concurrent LIVE request resolves ONLY its seed; the peer and the worker SURVIVE", async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const pErr = transport(job(42), new AbortController().signal)  // token 1
    const pLive = transport(job(43), new AbortController().signal) // token 2 — stays live throughout
    const tokErr = w.messages('verify')[0]!.requestToken!
    const tokLive = w.messages('verify')[1]!.requestToken!

    // The worker's EXACT operational-error shape for a 404 (errorSummary, the real producer — not the test helper).
    w.emitResult(tokErr, errorSummary('42', 42, 'FetchError', 'fetch https://x/42.det: 404'))
    await expect(pErr).resolves.toMatchObject({ id: '42', status: 'error', error: { code: 'FetchError' } })
    expect(w.terminated).toBe(false) // one seed's 404 did NOT tear down the shared worker

    // The concurrent live request is untouched and settles on its own token.
    w.emitResult(tokLive, summary('43', 'verified'))
    await expect(pLive).resolves.toMatchObject({ id: '43', status: 'verified' })
  })

  test("an UnknownCampaignSeed refusal (the other errorSummary caller) also resolves as 'error', no crash", async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal)
    const tok = w.messages('verify')[0]!.requestToken!
    w.emitResult(tok, errorSummary('42', 42, 'UnknownCampaignSeed', "refused: no pinned seed '42'"))
    await expect(p).resolves.toMatchObject({ id: '42', status: 'error', error: { code: 'UnknownCampaignSeed' } })
    expect(w.terminated).toBe(false)
  })

  test('the verify-core error (certified bytes that will not fold: sha256ok TRUE, ids null) DERIVES to error and is delivered', async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal)
    const tok = w.messages('verify')[0]!.requestToken!
    // A REAL verify-core outcome (deriveRunStatus: ¬decoded ∧ sha256ok → 'error'), distinct from an operational
    // errorSummary. Its label EQUALS its derivation, so it is delivered (NOT the exemption path, NOT a crash).
    const coreError: RunSummary = {
      id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: true, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'certified bytes did not fold' },
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    }
    w.emitResult(tok, coreError)
    await expect(p).resolves.toMatchObject({ id: '42', status: 'error' })
    expect(w.terminated).toBe(false)
  })

  test("a fake 'error' whose evidence DECODED (non-null id hexes, sha256ok:true) is a contradiction and crashes", async () => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!
    // status 'error' WITH a well-formed block, but the ids DECODED and sha256ok:true — deriveRunStatus can never map
    // decoded evidence to 'error', so this is a mislabelled verdict, NOT an operational error → crash (all reject).
    // (The block is present so the crash is the decoded-evidence contradiction, not the mandatory-block rule.)
    w0.emitResult(token0, { ...summary('42', 'error'), sha256ok: true, error: { code: 'DecodeError', message: 'mislabelled' } })
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })

  test("an 'error' with the canonical no-evidence flags but NO error block is a contradiction and crashes", async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal)
    const tok = w.messages('verify')[0]!.requestToken!
    // Canonical no-evidence flags (sha256ok false, ids null, matchesTrailer false) but the {code,message} block is
    // ABSENT — deriveRunStatus maps this to 'mismatch', and without the operational declaration it is a mislabelled
    // 'error' → crash. (The exemption REQUIRES a present error block.)
    const noErrorBlock = { ...errorSummary('42', 42, 'X', 'y') } as Record<string, unknown>
    delete noErrorBlock.error
    w.emitResult(tok, noErrorBlock)
    await expect(p).rejects.toThrow(/crashed/)
    expect(w.terminated).toBe(true)
  })

  test("the verify-core error SHAPE (sha256ok TRUE, ids null) WITHOUT its error block is skew and crashes (mandatory block)", async () => {
    // COUNTEREXAMPLE 1. Nonempty sha256Hex ∧ sha256ok TRUE ∧ ids null → deriveRunStatus yields 'error', so the label
    // EQUALS the derivation: the prior classifier accepted it even with its {code,message} block STRIPPED. Every
    // status:'error' now REQUIRES a well-formed block (rule (a)) — a verify-core 'error' always carries one, so a
    // stripped block is worker skew → crash (not a silently-accepted blockless 'error').
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!
    const coreErrorNoBlock: RunSummary = {
      id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: true, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    } // NOTE: no `error` block — canonical digest, so the crash is attributable to rule (a), not the format law
    expect(deriveRunStatus(coreErrorNoBlock)).toBe('error') // label == derived, yet still crashes: block is mandatory
    w0.emitResult(token0, coreErrorNoBlock)
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })

  test("a REAL mismatch relabelled 'error' (nonempty sha256Hex ∧ ¬sha256ok ∧ ids null ∧ DecodeError block) crashes; the integrity failure is never concealed as availability", async () => {
    // COUNTEREXAMPLE 2. Bytes WERE fetched and hashed (nonempty sha256Hex) but the sha pin FAILED and the fold threw
    // — the honest verdict is 'mismatch' (deriveRunStatus: ¬decoded ∧ ¬sha256ok). Relabelling it 'error' satisfied
    // the OLD operational exemption (no-evidence flags + a block) and would have concealed a byte-level integrity
    // failure as an availability 'error' (rollup.error, not rollup.mismatched). The never-touched-bytes invariant
    // (nonempty sha256Hex ⇒ DERIVE) forces derivation → the 'error' label ≠ 'mismatch' → crash.
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!
    const relabelledMismatch: RunSummary = {
      id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: false, caseIdHex: null, resultIdHex: null, // canonical digest ⇒ crash is DERIVATION, not format
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'tampered bytes: sha pin failed and the fold threw' },
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    }
    // The honest classification of that evidence is 'mismatch', never 'error' — accepting the relabel would miscount
    // a rollup.mismatched as a rollup.error.
    expect(deriveRunStatus(relabelledMismatch)).toBe('mismatch')
    w0.emitResult(token0, relabelledMismatch)
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })
})

describe('createWorkerTransport: the two-way digest-format law is ENFORCED (F1/F2)', () => {
  // The empty-hash discriminator used to be ONE-WAY: it GATED the operational exemption, but a NON-operational
  // summary carrying sha256Hex:'' still fell through to deriveRunStatus, which IGNORES the digest — so a skewed
  // {'verified', sha256Hex:'', sha256ok:true, ids non-null, flags true} resolved verified and the store re-derived
  // it green (fail-OPEN under exactly the worker schema-skew this boundary contains). The boundary now ENFORCES the
  // shape the emitters merely EXHIBIT: an EMPTY digest OBLIGES the operational shape, a NONEMPTY digest MUST be a
  // canonical 64-hex, and the id hexes obey the same law. Each counterexample below is a LIVE-token protocol crash
  // (rejects /crashed/, all outstanding reject, worker terminated) — never a resolve, so a skew can never green.

  // (b) — an EMPTY digest OBLIGES exactly the operational errorSummary shape; nothing else may carry an empty digest.
  test.each<[string, unknown]>([
    // THE headline gap: the skewed green the one-way check let through. Empty digest, but status 'verified' with
    // sha256ok TRUE, non-null ids and all flags — deriveRunStatus (digest-blind) would have minted 'verified'.
    ['a skewed VERIFIED with an EMPTY digest (sha256ok true, ids non-null, flags true)',
      { ...summary('42', 'verified'), sha256Hex: '' }],
    // Empty digest but NOT operational: sha256ok TRUE is impossible without hashing bytes (which mints a 64-hex
    // digest). This is the verify-core-error SHAPE forced empty — it isn't the operational errorSummary, so it crashes.
    ['a verify-core-error shape with an EMPTY digest (status error, sha256ok TRUE, ids null, block present) — NOT operational',
      { id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
        sha256Hex: '', sha256ok: true, caseIdHex: null, resultIdHex: null,
        caseIdOk: false, resultIdOk: false, matchesTrailer: false,
        error: { code: 'DecodeError', message: 'impossible: sha256ok true with no digest' },
        timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 } }],
    // (c) — a NONEMPTY digest MUST be canonical 64-hex lowercase. The verify core only ever mints toHex(sha256(...)).
    ['a malformed NONEMPTY digest — 8 hex chars (deadbeef)',
      { ...summary('42', 'verified'), sha256Hex: 'deadbeef' }],
    ['a malformed NONEMPTY digest — 64 UPPERCASE hex (not lowercase)',
      { ...summary('42', 'verified'), sha256Hex: HEX_SHA.toUpperCase() }],
    ['a malformed NONEMPTY digest — 63 hex chars (one short)',
      { ...summary('42', 'verified'), sha256Hex: HEX_SHA.slice(0, 63) }],
    // (c) sweep — the id hexes obey the SAME law: non-null ⇒ canonical 64-hex. caseIdOk/resultIdOk derive from these,
    // so a non-null non-hex id could otherwise ride a mislabelled 'verified' past the digest-blind derivation.
    ['a VERIFIED whose caseIdHex is non-canonical (not 64-hex)',
      { ...summary('42', 'verified'), caseIdHex: 'c' }],
    ['a VERIFIED whose resultIdHex is 63-hex (one short)',
      { ...summary('42', 'verified'), resultIdHex: HEX_RESULT.slice(0, 63) }],
  ])('%s on a LIVE token is a protocol crash: all outstanding reject, next start runs fresh', async (_label, skew) => {
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!

    w0.emitResult(token0, skew) // live token, digest/id-format skew → crash, never a resolve
    await expect(p1).rejects.toThrow(/crashed/) // rejects — NOT resolves({ status: 'verified' })
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)

    // Recovery: the next dispatch recreates a FRESH worker (init re-posted) and settles normally.
    const p3 = transport(job(44), new AbortController().signal)
    expect(workers).toHaveLength(2)
    const w1 = workers[1]!
    expect(w1.messages('init')).toHaveLength(1)
    const token = w1.messages('verify')[0]!.requestToken!
    w1.emitResult(token, summary('44', 'verified'))
    await expect(p3).resolves.toMatchObject({ id: '44', status: 'verified' })
  })
})

describe('createWorkerTransport: cross-field coherence — block⟺¬decoded and id pairing (F1/F2)', () => {
  // The block×status / id-pairing axis, invisible to derivation (deriveRunStatus reads the id hexes only for
  // null-ness and IGNORES the error block). The producer law across BOTH emitters is `error block present ⟺ both
  // ids null (¬decoded)` and `ids are BOTH null or BOTH non-null`. Each illegal row below is a LIVE-token crash;
  // each legal row still resolves. NOTE: NOT "block ⟺ status 'error'" — a fold-threw MISMATCH legally carries a block.

  test("THE false-green: a 'verified' carrying a well-formed error block crashes on a live token — never greens", async () => {
    // The exact counterexample: canonical digest + non-null ids + all flags true (deriveRunStatus, block-blind, would
    // mint 'verified'), but an explicit {code,message} block rides along. Decoded ∧ block present is a row NO producer
    // emits → crash BEFORE the block-blind derivation greens it. This is the hole the block⟺¬decoded law closes.
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!
    const falseGreen = { ...summary('42', 'verified'), error: { code: 'DecodeError', message: 'certified bytes did not fold' } }
    expect(deriveRunStatus(falseGreen)).toBe('verified') // derivation (block-blind) WOULD green it — hence the crash below
    w0.emitResult(token0, falseGreen)
    await expect(p1).rejects.toThrow(/crashed/) // rejects — NOT resolves({ status: 'verified' })
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })

  test('MIXED id nullness (caseIdHex null, resultIdHex non-null) crashes on a live token — ids must be paired', async () => {
    // foldAndVerify decodes BOTH ids or throws (both null); errorSummary nulls both. A half-null pair is a shape no
    // producer emits → crash (Law I: id pairing fires first).
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!
    w0.emitResult(token0, { ...summary('42', 'verified'), caseIdHex: null }) // resultIdHex stays canonical → mixed nullness
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })

  test("a fold-threw MISMATCH carrying its block (sha pin FAILED, ids null) RESOLVES as 'mismatch' — a legal block-bearing non-error", async () => {
    // THE row the naive "block ⟺ status 'error'" reading would have wrongly crashed. Bytes hashed (nonempty digest)
    // but the sha pin failed AND the fold threw: deriveRunStatus(¬decoded ∧ ¬sha256ok) = 'mismatch', and the catch
    // set a block. block⟺¬decoded (ids null) holds, so it is DELIVERED, not crashed. Proves the true law is DECODED.
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const p = transport(job(42), new AbortController().signal)
    const tok = w.messages('verify')[0]!.requestToken!
    const foldThrewMismatch: RunSummary = {
      id: '42', seed: 42, status: 'mismatch', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: false, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'tampered bytes: sha pin failed and the fold threw' },
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    }
    expect(deriveRunStatus(foldThrewMismatch)).toBe('mismatch') // its label EQUALS its derivation
    w.emitResult(tok, foldThrewMismatch)
    await expect(p).resolves.toMatchObject({ id: '42', status: 'mismatch', error: { code: 'DecodeError' } })
    expect(w.terminated).toBe(false) // a legal block-bearing mismatch never tears down the shared worker
  })

  test('the decoded arms (verified / mismatch, NO block, non-null ids) still resolve unharmed', async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    const pv = transport(job(42), new AbortController().signal)
    const tokV = w.messages('verify')[0]!.requestToken!
    w.emitResult(tokV, summary('42', 'verified')) // decoded, no block → delivered green
    await expect(pv).resolves.toMatchObject({ id: '42', status: 'verified' })
    const pm = transport(job(43), new AbortController().signal)
    const tokM = w.messages('verify')[1]!.requestToken!
    w.emitResult(tokM, summary('43', 'mismatch')) // decoded, no block → delivered mismatch
    await expect(pm).resolves.toMatchObject({ id: '43', status: 'mismatch' })
    expect(w.terminated).toBe(false)
  })
})

describe('createWorkerTransport: cross-field coherence — ¬decoded ⇒ all outcome flags false (F1)', () => {
  // Invariant (III), the null-ids flag column. When both id hexes are null the fold threw (or never ran), so the verify
  // core sets caseIdOk/resultIdOk/matchesTrailer ALL false on every null-ids producer row. deriveRunStatus is BLIND to
  // those three flags when ¬decoded (it reads only sha256ok), so an impossible {ids null, some flag true} summary
  // derives cleanly (label == derived) yet is a shape NO producer emits — it must CRASH, not settle. Each illegal row
  // below is a LIVE-token crash; the legal all-false rows still resolve.
  const shaMatchedErrorBadTrailer: RunSummary = {
    id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
    sha256Hex: HEX_SHA, sha256ok: true, caseIdHex: null, resultIdHex: null,
    caseIdOk: false, resultIdOk: false, matchesTrailer: true, // impossible: fold threw yet the trailer 'matched'
    error: { code: 'DecodeError', message: 'certified bytes did not fold' },
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  }
  const shaFailedMismatchBadCaseFlag: RunSummary = {
    id: '42', seed: 42, status: 'mismatch', basis: 'campaign-manifest',
    sha256Hex: HEX_SHA, sha256ok: false, caseIdHex: null, resultIdHex: null,
    caseIdOk: true, resultIdOk: false, matchesTrailer: false, // impossible: fold threw yet a case-id 'matched'
    error: { code: 'DecodeError', message: 'tampered bytes: sha pin failed and the fold threw' },
    timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
  }

  test.each<[string, RunSummary, RunStatus]>([
    ["the sha-matched 'error' variant with matchesTrailer:true", shaMatchedErrorBadTrailer, 'error'],
    ["the sha-failed 'mismatch' variant with caseIdOk:true", shaFailedMismatchBadCaseFlag, 'mismatch'],
  ])('%s crashes on a live token — a null-ids row with a passed flag is a shape no producer emits', async (_label, skew, derived) => {
    // PREMISE: deriveRunStatus is flag-blind when ¬decoded, so the label EQUALS its derivation — the (IV) digest axis
    // would SETTLE this. Only invariant (III) catches the impossible flag.
    expect(deriveRunStatus(skew)).toBe(derived)
    const workers: FakeWorker[] = []
    const { transport } = createWorkerTransport(() => { const w = new FakeWorker(); workers.push(w); return w }, '/')
    const p1 = transport(job(42), new AbortController().signal)
    const p2 = transport(job(43), new AbortController().signal)
    const w0 = workers[0]!
    const token0 = w0.messages('verify')[0]!.requestToken!

    w0.emitResult(token0, skew) // live token, ¬decoded with a passed flag → crash, never a settle
    await expect(p1).rejects.toThrow(/crashed/)
    await expect(p2).rejects.toThrow(/crashed/)
    expect(w0.terminated).toBe(true)
  })

  test('the legal fold-threw rows (all flags false) still resolve — the error arm and the mismatch arm', async () => {
    const w = new FakeWorker()
    const { transport } = createWorkerTransport(() => w, '/')
    // Row 3: fold threw, sha pin matched → 'error', ALL flags false.
    const foldThrewError: RunSummary = {
      id: '42', seed: 42, status: 'error', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: true, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'certified bytes did not fold' },
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    }
    const pe = transport(job(42), new AbortController().signal)
    w.emitResult(w.messages('verify')[0]!.requestToken!, foldThrewError)
    await expect(pe).resolves.toMatchObject({ id: '42', status: 'error' })
    // Row 4: fold threw, sha pin FAILED → 'mismatch', ALL flags false.
    const foldThrewMismatch: RunSummary = {
      id: '43', seed: 43, status: 'mismatch', basis: 'campaign-manifest',
      sha256Hex: HEX_SHA, sha256ok: false, caseIdHex: null, resultIdHex: null,
      caseIdOk: false, resultIdOk: false, matchesTrailer: false,
      error: { code: 'DecodeError', message: 'tampered bytes: sha pin failed and the fold threw' },
      timings: { fetchMs: 1, verifyMs: 1, totalMs: 2 },
    }
    const pm = transport(job(43), new AbortController().signal)
    w.emitResult(w.messages('verify')[1]!.requestToken!, foldThrewMismatch)
    await expect(pm).resolves.toMatchObject({ id: '43', status: 'mismatch' })
    expect(w.terminated).toBe(false) // legal all-false rows never tear down the shared worker
  })
})
