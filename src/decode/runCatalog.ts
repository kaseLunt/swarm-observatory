// ── THE TRUSTED RUN CATALOG (runs/index.json is a discovery convenience, NEVER authority) ───────────
// runs/index.json is fetched over the network and is unsigned. Letting its `base` field decide whose bytes
// load, and its `detOnly` field decide whether a manifest is fetched at all, hands an attacker the trust
// verdict: a tampered entry {id:'f0', base:'runs/e0', detOnly:true} would load e0's bytes, skip f0's manifest,
// and (with the store publishing the REQUESTED id) seal green AS f0. The index already disclaims "not the
// authority" — this module MAKES that true. It pins, IN THE APP BUNDLE (not over the wire), the base path and
// manifest policy of every CERTIFIED run id. useRun resolves its load plan from HERE, so:
//   • a certified id's bytes always come from ITS pinned base — the base-swap is closed at the source;
//   • a manifest-REQUIRED run can never be silently downgraded to det-only (a missing manifest is an ERROR,
//     never a false self-consistent green — see useRun).
// index.json keeps only its discovery/ordering role: the header switcher list and the Hangar card metadata.
// Identity beyond the base is the seal fold's job: the verdict already binds the loaded bytes to the
// manifest's pinned result_id/case_id, so the catalog need not re-pin hashes — it closes the base-swap, the
// verdict closes the byte-identity. (A drift test pins this catalog against the index generator's RUN_LIST.)

export interface CatalogEntry {
  readonly base: string
  // 'required': a full-manifest run — the manifest MUST fetch, parse, gate, and back a manifest-verified
  //             verdict. A missing/unfetchable manifest is an ERROR, never a silent det-only downgrade.
  // 'det-only': a KAT-tier golden with no manifest — its verdict can only ever be self-consistent (attested
  //             voice, never manifest-grade green).
  readonly manifest: 'required' | 'det-only'
}

// The certified library, pinned by id. Kept in agreement with tools/runIndex.mjs RUN_LIST by a drift test
// (publication.test.ts) — the same anti-divergence discipline as the index byte-identity gate.
export const RUN_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  f1: { base: 'runs/f1', manifest: 'det-only' },
  f0: { base: 'runs/f0', manifest: 'required' },
  e0: { base: 'runs/e0', manifest: 'det-only' },
  f2a: { base: 'runs/f2a', manifest: 'required' },
  f3a: { base: 'runs/f3a', manifest: 'required' },
  f4: { base: 'runs/f4', manifest: 'required' },
}

export interface LoadPlan {
  readonly base: string
  readonly manifestRequired: boolean
  readonly certified: boolean // true iff the id is a pinned catalog citizen (vs a future/dev id)
}

// A conforming run id is a SINGLE path segment: a lowercase-alnum lead then alnum/hyphen. Every certified id
// (f0/f1/e0/f2a/f3a/f4) matches; the grammar admits future ids (digits+letters, optional hyphens) while
// rejecting anything that could redirect a fetch. This is the traversal-safety fix: the unknown-id arm below derives its base
// as `runs/<id>`, so a traversal id like 'x/../f0' would normalize under fetch to ANOTHER run's bytes (an
// identity spoof — f0's bytes served under the label 'x/../f0'). A non-conforming id must therefore resolve to
// NO plan at all, never a base string.
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]*$/

// Prototype-shaped ids that CONFORM to the grammar. '__proto__'/'toString'/'valueOf'/'hasOwnProperty' carry
// chars outside RUN_ID_RE and are already rejected by the grammar test; 'constructor' and 'prototype' are all-
// lowercase and PASS it. Object.hasOwn keeps them off the certified path, but the unknown-id fallback below would
// still hand them a real det-only plan (base 'runs/constructor') → useRun issues a fetch. No run is ever named for
// a prototype key, so deny the whole family outright: the contract is then unambiguous — a prototype-shaped id
// resolves to NO plan and NO fetch, matching the "prototype keys never fetch" claim the tests assert.
const PROTOTYPE_DENYLIST: ReadonlySet<string> = new Set([
  'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', '__proto__',
])

// The resolved load plan for a run id, or NULL when the id is neither a certified citizen nor a grammar-
// conforming single segment (or is a denied prototype-shaped id). A CERTIFIED id resolves from the pinned
// catalog — base and manifest policy both come from the app bundle, never from index.json. An UNKNOWN id that
// CONFORMS to the id grammar gets the honest LOWEST-trust posture: load from its own id-derived base as det-only,
// so it can never mint manifest-grade green (its verdict is self-consistent at most). The base is derived from the
// id itself (`runs/<id>`), NEVER from index.json's `base`, so even an unknown id cannot be pointed at another
// run's bytes. A NON-conforming id (path traversal, a slash, an absolute/scheme-bearing string) OR a prototype-
// shaped id resolves to null — useRun then surfaces the unknown-run error, and NO fetch is issued.
export function resolveLoadPlan(runId: string): LoadPlan | null {
  // The grammar test runs FIRST, then the prototype denylist, then the catalog lookup as an OWN-property
  // check (Object.hasOwn). The old order indexed RUN_CATALOG[runId] BEFORE the grammar test and via bracket
  // access, so a prototype key resolved to an inherited member as a truthy "certified entry":
  // resolveLoadPlan('__proto__') returned Object.prototype with `.base` undefined → certified:true, base undefined
  // → useRun fetched 'undefined/bundle.det'. Grammar-first rejects '__proto__'/'toString'/'hasOwnProperty' (chars
  // outside the grammar) to null; the denylist then closes 'constructor'/'prototype' (which DO conform) so they
  // resolve to null too — never the uncertified 'runs/constructor' fetch the earlier fallback issued. Object.hasOwn
  // then admits ONLY real catalog entries.
  if (!RUN_ID_RE.test(runId)) return null
  if (PROTOTYPE_DENYLIST.has(runId)) return null
  if (Object.hasOwn(RUN_CATALOG, runId)) {
    const entry = RUN_CATALOG[runId]!
    return { base: entry.base, manifestRequired: entry.manifest === 'required', certified: true }
  }
  return { base: `runs/${runId}`, manifestRequired: false, certified: false }
}

// The TRUSTED det-only GRADE for a run id — sourced from the in-bundle catalog pin, NEVER from index.json's
// unsigned `detOnly` field. A manifest-REQUIRED certified run is full-manifest (false: it can earn the
// manifest-grade ✓); a det-only certified run and every uncertified/unknown id are det-only-grade (true) — an
// unknown id can never earn the manifest-grade green. cardVerdict keys the rendered trust grade on THIS, so a
// lying index entry (detOnly:false on a det-only run, or detOnly:true on a full-manifest one) cannot flip the
// grade a card renders. A non-resolvable id (null plan) is det-only-grade too — the lowest-trust default.
export function catalogDetOnly(runId: string): boolean {
  const plan = resolveLoadPlan(runId)
  return plan === null || !plan.manifestRequired
}
