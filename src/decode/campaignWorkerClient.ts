import { deriveRunStatus, type RunStatus, type RunSummary, type VerifyJob } from './campaignVerify'
import { resolveAppBase } from './campaignCatalog'
import type { CampaignVerifyTransport } from './campaignQueue'

// ── THE WORKER-BACKED TRANSPORT (main-thread side of the persistent worker) ──────────────────────────────
// The production CampaignVerifyTransport: hand a job to the persistent worker and resolve with its RunSummary.
// One worker is shared across all in-flight jobs (PERSISTENT — constructed lazily on first use, never per job).
//
// CORRELATION (F3): responses are demultiplexed by a unique REQUEST TOKEN (a monotonic counter), NEVER by seed
// id. A seed id is REUSED after a restart, so a stale pre-cancel result could otherwise resolve the restarted
// job's promise (the epoch fence upstream sees a current-epoch completion and cannot reject it). The token map
// fixes correlation: `verify`/`cancel`/`result` all carry the token, the inflight map is keyed by it, and a
// result bearing an unknown/stale token (a cancelled or superseded dispatch) is DROPPED — counted in a debug
// stat — so it can never settle a live promise.
//
// FAULTS (F4): a Worker-construction or postMessage throw REJECTS the transport promise (the queue turns that
// into a terminal 'error' summary — a seed never sticks 'running'). An async worker crash ('error' /
// 'messageerror') REJECTS every outstanding request, TERMINATES the dead worker, and NULLs it so the next
// dispatch recreates a fresh one (no promise hangs forever; a subsequent start() runs on a clean worker).
//
// PROTOCOL (F1): a worker→client message is FAIL-CLOSED at TWO levels before it can settle a promise.
//   • ENVELOPE level. The worker's protocol posts NOTHING but {type:'result', requestToken, summary} (see
//     campaignWorker.post), so a message is either a correlatable result carrying a VALID token or it is skew —
//     no benign third category exists on this channel. A valid token is a FINITE INTEGER (a monotonic counter);
//     a string/undefined/NaN/Infinity/fractional token, a wrong `type`, or a non-object message is MALFORMED. A
//     malformed envelope while ANY request is live would STRAND those requests forever (no timeout; and
//     `messageerror` fires only on a structured-clone FAILURE — a cloneable-but-schema-invalid payload arrives on
//     a PLAIN 'message'), so it is routed to the crash path. With ZERO live requests nothing can strand, so a
//     malformed envelope stays a counted drop. A VALID finite-integer token that isn't inflight is split by
//     ISSUANCE (F2): a RETIRED token (0 < token < nextToken — issued, then cancelled/superseded) is the F3
//     correlation drop; a NEVER-ISSUED token (>= nextToken, <= 0, or a non-safe-integer — the worker mints tokens
//     ONLY from the client's monotonic counter, so it could not have produced it) is as unaddressable as a
//     malformed envelope and takes the SAME rule (crash while live, counted drop while idle). The bare "isn't
//     inflight → drop" of the prior round silently dropped a never-issued token while the real live token stranded.
//   • SUMMARY level (a LIVE token). A result whose summary is malformed (missing/ill-typed field, or a status
//     outside the RunStatus enum), whose id/seed does not match that token's EXPECTED job identity, or whose wire
//     status label CONTRADICTS its own evidence (F2 — see below) is a PROTOCOL CRASH: the SAME recovery path as an
//     async fault (reject ALL outstanding, terminate, recreate). A `summary:null` would otherwise hang the promise
//     forever; a `summary:{}` would settle a seed with a verdict the store ignores (stuck 'running').
//
// SEMANTICS (F1/F2): a certification surface must never trust a LABEL over its own EVIDENCE — but it must also not
// mistake an operational FAILURE for a contradicted verdict. validateSummary applies a THREE-WAY rule:
//   • VERIFICATION outcomes DERIVE — 'verified'/'mismatch', and the verify-core's OWN 'error' (certified bytes
//     that won't fold: sha256ok TRUE ∧ ids null, which deriveRunStatus maps to 'error'), must EQUAL
//     deriveRunStatus(summary), the one shared rule the verify core mints with. A 'verified' with sha256ok:false
//     or null ids, or a 'mismatch' whose flags all pass, is a mislabelled verdict → protocol crash.
//   • OPERATIONAL errors DECLARE — errorSummary (a FetchError / unknown-seed REFUSAL: NO verification ran, so its
//     sha256Hex is EMPTY) carries a well-formed {code,message} and the canonical no-evidence shape (sha256ok FALSE ∧
//     both id hexes null ∧ matchesTrailer false), which deriveRunStatus maps to 'mismatch'. THAT shape — EMPTY
//     sha256Hex + block — is EXEMPT from derivation equality; it can never mint a false green (its status is
//     'error'), so one seed's 404 resolves 'error' instead of crashing the SHARED worker and taking every concurrent
//     seed down with it (the prior round did). The exemption is TWO-WAY-GATED: an EMPTY sha256Hex OBLIGES exactly
//     this shape — a non-operational summary bearing an empty digest (a skewed 'verified', or a verify-core 'error'
//     with sha256ok TRUE) is skew and CRASHES; it can never fall through to derivation, which ignores the digest and
//     would green it. The digest field's FORMAT (empty, or a canonical 64-hex) is protocol the boundary ENFORCES,
//     not a value it passes through.
//   • CONTRADICTIONS crash — a NONEMPTY sha256Hex PROVES bytes were verified, so the outcome must DERIVE: an 'error'
//     whose bytes hashed (a relabelled mismatch: ¬sha256ok ∧ ids null → 'mismatch') or whose ids DECODED, and ANY
//     'error' missing its block, falls through the exemption and fails derivation equality → protocol crash.
// The store then re-derives at its own boundary as defence in depth (never greens a seed the evidence doesn't
// support).
//
// The worker is constructed LAZILY (a factory) so importing this module in a non-DOM context (a vitest node run)
// never touches `new Worker`, and so the token protocol + crash recovery are unit-testable against an injected
// fake worker. The worker URL uses the repo idiom (new Worker(new URL(..., import.meta.url), { type: 'module' })),
// matching src/source/bundleSource.ts.

// A minimal structural view of a Worker — just what the transport uses. Injectable so the message protocol and
// crash recovery can be exercised with a fake (a real `new Worker` cannot run under vitest/node).
export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (ev: { data?: unknown; message?: string }) => void): void
  removeEventListener(type: string, listener: (ev: { data?: unknown; message?: string }) => void): void
  terminate(): void
}

// The EXPECTED job identity retained per token — a result bearing a LIVE token must match THIS or it is a protocol
// fault. campaignId is not carried on a RunSummary (so it cannot be cross-checked against the wire), but it is
// retained for the protocol-crash diagnostic; seed/id ARE on the summary and ARE checked (validateSummary).
interface Expected {
  readonly campaignId: string
  readonly seed: number
}

interface Inflight {
  readonly signal: AbortSignal
  readonly onAbort: () => void
  readonly expected: Expected
  resolve(summary: RunSummary): void
  reject(err: unknown): void
}

// The RunStatus enum, as a runtime membership set (the type is erased). A status outside this set is malformed.
const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>(['verified', 'mismatch', 'error'])

// THE DIGEST-FORMAT LAW (F1/F2). Every hash field on the wire is a canonical digest — EXACTLY 64 LOWERCASE hex
// chars, the width toHex(sha256(bytes)) / toHex(blake3(...)) always mints (a 32-byte digest → 64 hex). The FORMAT
// is part of the PROTOCOL, not a passthrough: sha256Hex is EITHER '' (the operational no-fetch marker) OR this;
// each id hex is EITHER null (bytes did not decode) OR this. Any other string — wrong length, uppercase, non-hex —
// could not have come from the verify core and is worker skew. Enforcing this is what makes the empty-hash
// discriminator TWO-WAY: a skewed digest can no longer slip past deriveRunStatus, which ignores digest format.
const HEX64 = /^[0-9a-f]{64}$/

export interface WorkerTransport {
  readonly transport: CampaignVerifyTransport
  readonly stats: { droppedStale: number }
}

// Classify a worker→client message for CORRELATION. The result is one of two kinds: a correlatable 'result'
// carrying a VALID token (a FINITE INTEGER — the monotonic counter tokens are), whose RAW summary is returned for
// fail-closed validation against the LIVE entry's expected identity; or MALFORMED — a non-object message, a wrong
// `type`, or a missing/non-number/non-finite/non-integer token. A malformed envelope cannot address the inflight
// map, so it can never settle a promise and (unlike a valid stale token) is NOT attributable to a superseded
// dispatch: the caller crashes on it while any request is live (it would otherwise strand them), and only counts
// it as a drop when idle. Number.isInteger rejects strings/undefined/NaN/Infinity/fractions in one check.
type Envelope =
  | { readonly kind: 'result'; readonly requestToken: number; readonly summary: unknown }
  | { readonly kind: 'malformed' }

function readEnvelope(data: unknown): Envelope {
  if (typeof data !== 'object' || data === null) return { kind: 'malformed' }
  const d = data as { type?: unknown; requestToken?: unknown; summary?: unknown }
  if (d.type !== 'result') return { kind: 'malformed' }
  if (typeof d.requestToken !== 'number' || !Number.isInteger(d.requestToken)) return { kind: 'malformed' }
  return { kind: 'result', requestToken: d.requestToken, summary: d.summary }
}

// FAIL-CLOSED validation of a worker→client RunSummary against the token's EXPECTED identity. Returns the typed
// summary iff EVERY required field is present and well-typed, status is in the RunStatus enum, and id/seed match
// the expected job. ANY deviation → null (the caller treats a null on a LIVE token as a protocol crash). This is
// the whole point of F1: a partially-deserialisable result must never settle a promise or hang one.
function validateSummary(data: unknown, expected: Expected): RunSummary | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  // Identity: a result on a live token that names a DIFFERENT job is a protocol fault, not a silent mismatch.
  if (d.seed !== expected.seed) return null
  if (d.id !== String(expected.seed)) return null
  // Verdict + basis.
  if (typeof d.status !== 'string' || !RUN_STATUSES.has(d.status)) return null
  if (d.basis !== 'campaign-manifest') return null
  // Recompute fields — the digest FORMAT is enforced HERE (the two-way shape law), not merely typed. sha256Hex is
  // EITHER '' (the operational no-fetch marker) OR a canonical 64-hex digest; each id hex is EITHER null (bytes did
  // not decode) OR a canonical 64-hex digest. Any other string is worker skew → crash (null). Format-checking the
  // id hexes closes the SAME one-way gap the sha256Hex fix closes: caseIdOk/resultIdOk derive from these upstream,
  // so a non-null non-hex id that the boundary merely type-checked could ride a mislabelled 'verified' past
  // derivation (which reads the id hexes only for null-ness, never format). Same law, same regex.
  if (typeof d.sha256Hex !== 'string' || !(d.sha256Hex === '' || HEX64.test(d.sha256Hex))) return null
  if (!(d.caseIdHex === null || (typeof d.caseIdHex === 'string' && HEX64.test(d.caseIdHex)))) return null
  if (!(d.resultIdHex === null || (typeof d.resultIdHex === 'string' && HEX64.test(d.resultIdHex)))) return null
  if (typeof d.sha256ok !== 'boolean') return null
  if (typeof d.caseIdOk !== 'boolean') return null
  if (typeof d.resultIdOk !== 'boolean') return null
  if (typeof d.matchesTrailer !== 'boolean') return null
  // Timings block: three numbers.
  const t = d.timings
  if (typeof t !== 'object' || t === null) return null
  const tt = t as Record<string, unknown>
  if (typeof tt.fetchMs !== 'number' || typeof tt.verifyMs !== 'number' || typeof tt.totalMs !== 'number') return null
  // Optional error block, if present, must be {code:string, message:string}.
  if (d.error !== undefined) {
    if (typeof d.error !== 'object' || d.error === null) return null
    const e = d.error as Record<string, unknown>
    if (typeof e.code !== 'string' || typeof e.message !== 'string') return null
  }
  const summary = data as RunSummary
  // F1/F2 — CROSS-FIELD COHERENCE: the two producers' laws (campaignVerify.ts), encoded as BICONDITIONALS. The field
  // checks above pin each field's OWN shape; these pin the RELATIONSHIPS the producers guarantee ACROSS fields. This
  // is a DISTINCT axis from the label+digest one, and invisible to it: deriveRunStatus — the derive-don't-trust
  // authority — reads the id hexes ONLY for null-ness and IGNORES the error block entirely, so a summary can satisfy
  // derivation yet still be a shape NO producer emits (a green carrying an explicit error block). Enumerating the
  // complete producer-coherence table and REFUSING every row outside it closes the block×status / id-pairing axis.
  //
  //   PRODUCER-COHERENCE TABLE — the ONLY legal (status, sha256Hex, sha256ok, ids, [caseIdOk resultIdOk trailer],
  //   block) rows. The three OUTCOME FLAGS are now an EXPLICIT column: the null-ids rows (3–5) pin them ALL false —
  //   the fold never ran, so no recomputed check could pass (invariant III below); the decoded rows (1–2) vary.
  //     producer path                         status    sha256Hex   sha256ok  ids           caseIdOk resultIdOk trailer  block
  //     ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  //     verify: fold ok, all pins matched     verified  64-hex      true      both non-null  true     true       true     ABSENT
  //     verify: fold ok, a check failed       mismatch  64-hex      any       both non-null  any      any        any      ABSENT
  //     verify: fold THREW, sha pin matched   error     64-hex      true      both null      false    false      false    present
  //     verify: fold THREW, sha pin FAILED    mismatch  64-hex      false     both null      false    false      false    present
  //     errorSummary: operational refusal/IO  error     '' (empty)  false     both null      false    false      false    present
  //   Everything else is worker skew → protocol crash while live. NOTE the block is NOT "present ⟺ status 'error'":
  //   a fold that threw on bytes that ALSO fail the sha pin derives 'mismatch' (¬decoded ∧ ¬sha256ok) yet still
  //   carries its block (row 4). The true block discriminant is DECODED — both ids non-null iff foldAndVerify
  //   returned — not the status label. Three cross-field invariants collapse the table:
  //
  //   (I) ID PAIRING — foldAndVerify decodes BOTH ids or throws (→ both null); errorSummary nulls both. So the id
  //       hexes are BOTH null or BOTH non-null, NEVER mixed. `decoded` (both non-null) is exactly the bit
  //       deriveRunStatus keys on; a mixed-nullness summary is a shape no producer emits → crash.
  if ((summary.caseIdHex === null) !== (summary.resultIdHex === null)) return null // (I) ids paired, never mixed
  //   (II) BLOCK ⟺ ¬DECODED — the error block is set by EXACTLY the two paths that null both ids: the verify-core's
  //       `catch` (fold threw) and errorSummary (operational). A fold that SUCCEEDS leaves error undefined AND both
  //       ids non-null. So across BOTH producers `error present ⟺ both ids null`; with (I) enforcing pairing,
  //       "both ids null" ⟺ caseIdHex === null. This is the axis the false-green rode: a {'verified', canonical
  //       digest + ids, flags true, error:{code:'DecodeError'}} skew has both ids non-null (decoded) YET a block —
  //       no producer emits a decoded summary carrying a block, so it CRASHES here, BEFORE the block-blind
  //       derivation below would green it. (This subsumes the old "status 'error' ⇒ block present" guard: a blockless
  //       'error' has null ids by the table, so error-undefined ∧ ids-null trips this same biconditional.)
  if ((summary.error !== undefined) !== (summary.caseIdHex === null)) return null // (II) block ⟺ ¬decoded (both ids null)
  //   (III) FLAGS FALSE WHEN ¬DECODED — both ids null means foldAndVerify threw or never ran (errorSummary), so NO
  //       recomputed check can have passed: the verify core sets matchesTrailer=false, and null id hexes force
  //       caseIdOk=resultIdOk=false, on EVERY null-ids row (table rows 3–5, the now-explicit flag column). But
  //       deriveRunStatus is BLIND to these three flags when ¬decoded — it reads ONLY sha256ok — so a {ids null,
  //       matchesTrailer:true} 'error' and a {ids null, caseIdOk:true} 'mismatch' both DERIVE cleanly (label ==
  //       derived) and would SETTLE, though they are shapes NO producer emits. With (I) pinning "both ids null" to
  //       caseIdHex === null, REFUSE any null-ids summary whose three outcome flags are not all false. (The decoded
  //       rows 1–2 have non-null ids, so this never fires on them — their flags legitimately vary.)
  if (summary.caseIdHex === null && (summary.matchesTrailer || summary.caseIdOk || summary.resultIdOk)) return null // (III) ¬decoded ⇒ all flags false
  // (IV) THE DIGEST AXIS — a fail-closed surface must never trust a LABEL over its EVIDENCE, yet must not mistake an
  //   operational FAILURE (no bytes) for a contradicted verdict. errorSummary (an operational REFUSAL — NO
  //   verification ran) is the ONLY summary with an EMPTY sha256Hex; verifyBundleAgainstExpected ALWAYS hashes first
  //   (toHex(sha256(bytes)) is 64 hex chars), so a NONEMPTY sha256Hex PROVES bytes were verified. That partitions
  //   declare-vs-derive.
  if (summary.sha256Hex === '') {
    // EMPTY digest ⇒ the operational errorSummary shape is OBLIGATORY, not merely exempt. Its status is 'error' (it
    // can never mint a false green), so one seed's 404 resolves 'error' instead of crashing the SHARED worker. Any
    // OTHER summary with an empty digest — a skewed 'verified', or a verify-core 'error' whose sha256ok is TRUE — is
    // skew → crash; it never reaches the digest-blind derivation below. (Block presence guaranteed by (II) already.)
    const isOperationalError =
      summary.status === 'error' &&
      summary.sha256ok === false &&
      summary.caseIdHex === null &&
      summary.resultIdHex === null &&
      summary.matchesTrailer === false
    return isOperationalError ? summary : null
  }
  // NONEMPTY (⇒ canonical) sha256Hex forces derivation regardless of the label. 'verified'/'mismatch', the verify-
  // core's own 'error' (sha256ok TRUE ∧ ids null → 'error'), and a RELABELLED verdict must all EQUAL deriveRunStatus.
  // A mismatch whose bytes hashed (nonempty sha256Hex ∧ ¬sha256ok ∧ ids null → derives 'mismatch') but was relabelled
  // 'error' fails here → crash — an observed integrity failure is never concealed as an availability 'error'.
  if (summary.status !== deriveRunStatus(summary)) return null // (IV) nonempty canonical sha ⇒ always derives here
  return summary
}

// The transport factory. `makeWorker` builds the underlying worker; `base` is the ALREADY-RESOLVED absolute app
// base (getSingleton runs resolveAppBase on the main thread — F2), forwarded verbatim to the worker at init.
// Exported so tests inject a fake worker (and can assert the base is echoed on the init message unchanged).
export function createWorkerTransport(makeWorker: () => WorkerLike, base: string): WorkerTransport {
  let worker: WorkerLike | null = null
  // The monotonic request-token counter (F2/F3). Starts at 1 — so 0 (and any non-positive value) is NEVER-ISSUED —
  // and lives in THIS transport closure, NOT the worker. crash() nulls `worker` but never touches `nextToken`, so
  // tokens stay GLOBALLY monotonic across worker recreations: a token issued before a crash never collides with one
  // issued after. That is what keeps the "RETIRED iff 0 < token < nextToken" test sound across crashes — a replayed
  // pre-crash token is < nextToken and drops as stale, it can never masquerade as a fresh live dispatch.
  let nextToken = 1
  const inflight = new Map<number, Inflight>()
  const stats = { droppedStale: 0 }

  // Pull a token out of the inflight map and detach its abort listener; returns the entry (or null if already
  // gone — a double-settle / stale token).
  const settle = (token: number): Inflight | null => {
    const entry = inflight.get(token)
    if (entry === undefined) return null
    inflight.delete(token)
    entry.signal.removeEventListener('abort', entry.onAbort)
    return entry
  }

  // The recovery path shared by an ASYNC fault (F4: 'error' / 'messageerror') and a PROTOCOL fault (F1: a
  // malformed/mismatched result on a live token). The worker is unusable: reject EVERY outstanding request (the
  // queue makes each a terminal 'error' summary), terminate the dead worker, and NULL it so the next dispatch
  // recreates a fresh one — no promise hangs, and a subsequent start() runs clean.
  const crash = (reason: string): void => {
    const err = new Error(`campaign verify worker crashed: ${reason}`)
    const dead = worker
    worker = null
    const entries: Inflight[] = []
    for (const token of [...inflight.keys()]) {
      const entry = settle(token)
      if (entry !== null) entries.push(entry)
    }
    dead?.terminate()
    for (const entry of entries) entry.reject(err)
  }

  // A message that cannot settle a LIVE request — a malformed ENVELOPE (F1: no correlatable token) or a
  // NEVER-ISSUED token (F2: the worker could not have minted it) — is UNADDRESSABLE. While ANY request is live it
  // would strand that request forever (no timeout; `messageerror` fires only on a structured-clone FAILURE, and
  // this payload cloned fine), so fail-closed to the crash path. With ZERO live requests nothing can strand, so it
  // stays a counted drop. Both unaddressable kinds share this exact rule.
  const failClosedUnaddressable = (reason: string): void => {
    if (inflight.size > 0) { crash(reason); return }
    stats.droppedStale++
  }

  const onMessage = (ev: { data?: unknown }): void => {
    const env = readEnvelope(ev.data)
    if (env.kind === 'malformed') {
      // ENVELOPE-level skew (F1): a non-object message, wrong `type`, or a missing/non-integer requestToken — no
      // correlatable token at all.
      failClosedUnaddressable('malformed result envelope while requests are live (non-object message, wrong type, ' +
        'or missing/non-integer requestToken) — the worker cannot address any inflight request')
      return
    }
    const entry = inflight.get(env.requestToken)
    if (entry === undefined) {
      // A valid-integer token that isn't inflight is one of two DISJOINT things, and ISSUANCE tells them apart:
      //   • RETIRED — 0 < token < nextToken (a safe integer) — was issued, then resolved/cancelled/superseded. This
      //     is the F3 correlation drop: a stale result from a dispatch already settled. Counted stale drop, never a
      //     crash — even if its summary is malformed (we don't validate a retired token; it addresses nothing live).
      //   • NEVER-ISSUED — token >= nextToken, token <= 0, or a non-safe-integer. The worker mints tokens ONLY from
      //     this client's monotonic counter, so it could not have produced this; it is as unaddressable as a
      //     malformed envelope (F2), so it takes the SAME fail-closed rule (crash while live, counted drop idle).
      const retired = Number.isSafeInteger(env.requestToken) && env.requestToken > 0 && env.requestToken < nextToken
      if (retired) { stats.droppedStale++; return }
      failClosedUnaddressable(`never-issued token ${env.requestToken} (>= nextToken ${nextToken}, <= 0, or not a ` +
        `safe integer) — the worker mints tokens only from the client's monotonic counter, so it addresses no ` +
        `inflight request and would strand any live one`)
      return
    }
    // LIVE token: fail-closed. A malformed, identity-mismatched, or label-contradicts-evidence (F1/F2) result here
    // is a worker regression/skew — crash.
    const summary = validateSummary(env.summary, entry.expected)
    if (summary === null) {
      crash(`protocol violation on token ${env.requestToken}: result malformed, its id/seed did not match the ` +
        `expected job {campaign:'${entry.expected.campaignId}', seed:${entry.expected.seed}}, or its status ` +
        `label contradicted its own evidence`)
      return
    }
    settle(env.requestToken) // detach abort + remove; then settle the (still-held) entry
    entry.resolve(summary)
  }

  const onCrash = (ev: { message?: string }): void => crash(ev.message ?? 'unknown')

  const getWorker = (): WorkerLike => {
    if (worker === null) {
      const w = makeWorker()
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onCrash)
      w.addEventListener('messageerror', onCrash)
      w.postMessage({ type: 'init', base }) // trusted config, ONCE, before any verify (postMessage is FIFO)
      worker = w
    }
    return worker
  }

  const transport: CampaignVerifyTransport = (job, signal) =>
    new Promise<RunSummary>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      const token = nextToken++
      let w: WorkerLike
      try {
        w = getWorker() // Worker construction failure → reject (queue → terminal error, never a stuck seed)
      } catch (e) {
        reject(e)
        return
      }
      const onAbort = (): void => {
        settle(token)
        w.postMessage({ type: 'cancel', requestToken: token }) // relay: the worker aborts its in-flight fetch
        reject(new DOMException('aborted', 'AbortError'))
      }
      inflight.set(token, { signal, onAbort, expected: { campaignId: job.campaignId, seed: job.seed }, resolve, reject })
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        w.postMessage({ type: 'verify', requestToken: token, campaignId: job.campaignId, seed: job.seed })
      } catch (e) {
        settle(token) // postMessage failure → reject (queue → terminal error, never a stuck seed)
        reject(e)
      }
    })

  return { transport, stats }
}

// The lazily-constructed production singleton (one persistent worker, recreated after a crash). Kept out of
// module scope so importing this file never runs `new Worker` / reads import.meta.env / touches `document` — only
// the first dispatch does. The deploy base is RESOLVED to an absolute url HERE on the main thread (F2), against
// `document.baseURI`, so a relative Vite base ('' / './') — which the worker cannot interpret — is settled before
// init and the worker only ever joins an absolute base.
let singleton: WorkerTransport | null = null
function getSingleton(): WorkerTransport {
  singleton ??= createWorkerTransport(
    () => new Worker(new URL('./campaignWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    resolveAppBase(import.meta.env.BASE_URL, document.baseURI),
  )
  return singleton
}

export function workerTransport(job: VerifyJob, signal: AbortSignal): Promise<RunSummary> {
  return getSingleton().transport(job, signal)
}
