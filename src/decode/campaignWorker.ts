import { verifyBundleAgainstExpected, errorSummary, type RunSummary } from './campaignVerify'
import { getCampaign, resolveCampaignSeed, campaignBundleUrl } from './campaignCatalog'

// ── THE PERSISTENT CAMPAIGN VERIFY WORKER ────────────────────────────────────────────────────────────────
// One long-lived worker verifies MANY seed bundles off the main thread. Per {type:'verify', requestToken,
// campaignId, seed} it RESOLVES the seed's pin + load URL from the IN-BUNDLE catalog (campaignCatalog — the
// authority), FETCHES the bytes, runs the pure verify core (campaignVerify — fold + sha256 vs the pins),
// DISCARDS the bytes, and posts back a small RunSummary. It NEVER decodes a RunModel and NEVER posts bytes/
// models back — the main thread holds 50 flat summaries, never 50 decoded runs (the verify-many-without-useRun×N
// goal).
//
// AUTHORITY: the job carries ONLY {requestToken, campaignId, seed} — NEVER a caller-chosen url or expected
// pins. The worker owns the url+pins by resolving them here from CAMPAIGN_CATALOG. A caller therefore cannot
// submit arbitrary bytes with matching pins and receive verified/basis:'campaign-manifest' (the fetched-manifest
// -as-authority hole, closed at the worker boundary). An UNKNOWN campaign or seed is a terminal REFUSAL — an
// 'error' summary that NAMES the refusal, never a 'verified'. campaignCatalog is pure data with ZERO imports, so
// importing it here drags no React/DOM into the worker chunk.
//
// BASE: a worker's RELATIVE fetch resolves against the WORKER SCRIPT url (/swarm-observatory/assets/… under
// Pages), so 'campaigns/…' would 404. A RELATIVE Vite base ('' / './') also cannot be interpreted here — the
// worker has no view of the document base. So the MAIN THREAD resolves the deploy base to an ABSOLUTE url
// (campaignCatalog.resolveAppBase over import.meta.env.BASE_URL + document.baseURI) and posts THAT once
// ({type:'init', base}) — TRUSTED config, not per-job data. The worker joins it to the catalog's seed path by URL
// semantics (campaignBundleUrl → new URL(path, absoluteBase)), never string concatenation. init lands before any
// verify (postMessage is FIFO); the placeholder default below is only a valid-URL stand-in until it arrives.
//
// CORRELATION: each request carries a unique requestToken (the client's monotonic counter), echoed in the
// result and used to key `inflight`. A {type:'cancel', requestToken} aborts THAT fetch. Correlation is by token,
// never by seed id — a seed id is reused after a restart, but a token never is.
//
// CANCELLATION: each in-flight fetch has its own AbortController, keyed by requestToken. An aborted job posts
// NOTHING back — the queue has already cleared it, so a late event would be a lie.
//
// Instantiated via the repo's worker idiom (new Worker(new URL('./campaignWorker.ts', import.meta.url),
// { type: 'module' })) in campaignWorkerClient — the SAME form src/source/bundleSource.ts uses.

type InMessage =
  | { type: 'init'; base: string }
  | { type: 'verify'; requestToken: number; campaignId: string; seed: number }
  | { type: 'cancel'; requestToken: number }

// The RESOLVED absolute app base, set ONCE by the init message (main-thread resolveAppBase output). A valid
// ABSOLUTE-url placeholder (the worker origin root) until then, so the URL join can never throw even if a verify
// somehow preceded init — it cannot (postMessage is FIFO), so this value is never actually joined against.
let appBase = `${self.location.origin}/`

const inflight = new Map<number, AbortController>()

function post(requestToken: number, summary: RunSummary): void {
  self.postMessage({ type: 'result', requestToken, summary })
}

self.onmessage = (msg: MessageEvent<InMessage>) => {
  const data = msg.data
  if (data.type === 'init') {
    appBase = data.base
    return
  }
  if (data.type === 'cancel') {
    inflight.get(data.requestToken)?.abort()
    inflight.delete(data.requestToken)
    return
  }
  void runJob(data.requestToken, data.campaignId, data.seed)
}

async function runJob(requestToken: number, campaignId: string, seed: number): Promise<void> {
  const seedId = String(seed)
  // AUTHORITY: url + expected pins come from the in-bundle catalog, NEVER from the caller. An unknown campaign or
  // seed (or a non-canonical/prototype-shaped seed id — resolveCampaignSeed's grammar rejects those) is a
  // terminal refusal: 'error', never 'verified'. No fetch is issued for a seed with no pin.
  const cat = getCampaign(campaignId)
  const pin = cat ? resolveCampaignSeed(campaignId, seedId) : null
  if (!cat || !pin) {
    post(requestToken, errorSummary(seedId, seed, 'UnknownCampaignSeed',
      `refused: no pinned seed '${seedId}' in campaign '${campaignId}' (in-bundle catalog)`))
    return
  }
  const url = campaignBundleUrl(cat, pin, appBase)
  const expected = { caseId: pin.caseId, resultId: pin.resultId, sha256: pin.sha256 }

  const ctrl = new AbortController()
  inflight.set(requestToken, ctrl)
  const t0 = performance.now()
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
    const buf = await res.arrayBuffer()
    const fetchMs = performance.now() - t0
    // Verify + DISCARD. `buf` falls out of scope at function end; nothing decoded is retained.
    const v0 = performance.now()
    const outcome = verifyBundleAgainstExpected(new Uint8Array(buf), expected)
    const verifyMs = performance.now() - v0
    post(requestToken, { ...outcome, id: seedId, seed, timings: { fetchMs, verifyMs, totalMs: performance.now() - t0 } })
  } catch (e) {
    // Cancelled → emit NOTHING (the queue cleared this job; a late event would contradict the cleared state).
    if (ctrl.signal.aborted) return
    // A genuine fetch/IO failure: an 'error' summary (distinct from a byte-level 'mismatch').
    post(requestToken, errorSummary(seedId, seed, 'FetchError',
      e instanceof Error ? e.message : String(e),
      { fetchMs: performance.now() - t0, verifyMs: 0, totalMs: performance.now() - t0 }))
  } finally {
    inflight.delete(requestToken)
  }
}
