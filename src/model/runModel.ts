import type { DecodedRun } from '../decode/decodeBundle'
import type { RunManifest } from '../decode/manifest'
import type { EventTick, StateFrame } from '../lib/brand'
import {
  GEOMETRY_QUERY_RESOLVED, ELIGIBILITY_EVALUATED, DETECTION_MADE, decodeEvent, decodeEntityV2,
  decodeGeometryQuery, decodeEligibility, decodeDetection, decodeStateTick,
  type EntityV2, type EventEnvelope, type GeometryQuery, type Eligibility, type Detection,
} from '../decode/payloads'

const EMPTY: readonly number[] = []

export class RunModel {
  readonly eventCount: number
  readonly tickCount: number
  readonly verify: DecodedRun['verify']
  readonly ticks: Float64Array
  readonly manifest: RunManifest | null
  private run: DecodedRun
  private det: Uint8Array
  private children: number[][]
  private byTick: number[][]
  private stateCache = new Map<number, Map<string, EntityV2>>() // insertion-ordered → LRU
  private static CACHE_CAP = 16
  private lastQuerySeq: number = -1
  private lastQuery: GeometryQuery | null = null
  private subjectSeqs = new Map<string, number[]>()
  private subjects: (string | null)[]
  private firstPopulated: number | null = null

  constructor(run: DecodedRun, manifest: RunManifest | null) {
    this.run = run
    this.manifest = manifest
    this.det = new Uint8Array(run.det)
    this.verify = run.verify
    this.ticks = run.tick
    this.eventCount = run.seq.length
    this.tickCount = run.stateOff.length - 1
    this.children = Array.from({ length: this.eventCount }, () => [])
    this.byTick = Array.from({ length: this.tickCount }, () => [])
    for (let i = 0; i < this.eventCount; i++) {
      const c = run.causation[i]!
      if (c >= 0) this.children[c]!.push(i)
      this.byTick[run.tick[i]!]!.push(i)
    }
    this.subjects = new Array(this.eventCount).fill(null)
    for (let i = 0; i < this.eventCount; i++) {
      if (run.kind[i] !== GEOMETRY_QUERY_RESOLVED) continue
      const q = decodeGeometryQuery(decodeEvent(this.payloadSpan(i)).payload)
      const key = `1:${q.subject}`
      this.subjects[i] = key
      const arr = this.subjectSeqs.get(key)
      if (arr) arr.push(i); else this.subjectSeqs.set(key, [i])
    }
  }

  private payloadSpan(seq: number): Uint8Array {
    return this.det.subarray(this.run.payloadOff[seq]!, this.run.payloadOff[seq]! + this.run.payloadLen[seq]!)
  }
  eventAt(seq: number): EventEnvelope { return decodeEvent(this.payloadSpan(seq)) }
  /** The event's kind, read from the already-decoded per-event kind array (populated at load, the same
   *  source geometryQueryAt keys off). A pure array index — NO envelope re-decode. Consumers that need
   *  only the kind (the timeline's per-event lane assignment, over eventCount events every model change)
   *  use this instead of eventAt(seq).kind, whose decodeEvent re-parses the whole payload span per call. */
  kindAt(seq: number): number { return this.run.kind[seq]! }
  parentOf(seq: number): number | null { const c = this.run.causation[seq]!; return c >= 0 ? c : null }
  childrenOf(seq: number): readonly number[] { return this.children[seq]! }
  // ACCEPTS the EVENT domain (v0.8): events are indexed by the tick the engine committed them at — never a
  // StateFrame. A raw playhead must be branded (cursor.eventTickOf) before it can index here.
  eventsByTick(tick: EventTick): readonly number[] { return this.byTick[tick] ?? EMPTY }

  /** First tick (0..tickCount inclusive) whose namespace-1 entity map is non-empty; -1 if none ever.
   *  Lazy + cached: worst case (a truly positionless run like e0) is one full state scan at load
   *  time — sanctioned load-path work, never on the frame path. Ticks are indexed 0..tickCount
   *  inclusive (stateOff/stateLen parallel arrays of tickCount+1 entries — same range buildTrail
   *  walks with n = tickCount + 1).
   *
   *  LOAD-PATH COST: a large run whose first populated tick k is LATE double-decodes ticks 0..k — once
   *  here (this scan) and once in buildTrail's own walk — with LRU eviction (CACHE_CAP=16) churning
   *  between the two whenever k exceeds the cap, so those early ticks re-decode from bytes rather than
   *  hit the cache. Acceptable for today's content (f0/f1 populate at tick 0 → k=0, a single decode; e0
   *  scans all ticks but is small). Revisit — memoise the scanned frames, or fold this scan into
   *  buildTrail's single walk — if late-spawn campaign bundles land where k is both large and common.
   *
   *  Scan-safe cache: accumulate into a LOCAL and commit to this.firstPopulated only after the scan
   *  completes without throwing. Assigning the field to -1 up front (as before) would let a mid-scan
   *  decode throw POISON the cache — the partial -1 survives, and a later retry returns "never populated"
   *  for a run that does populate. Leaving the field null on throw makes the next call re-attempt cleanly. */
  firstPopulatedTick(): number {
    if (this.firstPopulated === null) {
      let found = -1
      // The scan counter is a plain frame index (internal arrays stay unbranded); brand it StateFrame at
      // the accessor boundary it crosses.
      for (let t = 0; t <= this.tickCount; t++) {
        if (this.entityStatesAt(t as StateFrame).size > 0) { found = t; break }
      }
      this.firstPopulated = found
    }
    return this.firstPopulated
  }

  /** Entity keys at the FIRST POPULATED tick (decode order — deterministic from bundle bytes),
   *  not tick 0: a subject that spawns late still defines the trail/follow/positionless subject set.
   *  Entities appearing only after that tick are not in the set — single-subject presentation is a
   *  deliberate choice for current content (documented in trail.ts). */
  entityKeys(): readonly string[] {
    const f = this.firstPopulatedTick()
    return f < 0 ? [] : [...this.entityStatesAt(f as StateFrame).keys()]
  }
  // ACCEPTS the STATE-FRAME domain (v0.8): the decoded per-frame entity map is indexed by state-frame index,
  // NOT by a raw event/transport tick. On a sensing run a tick-k verdict rides frame (k + TARGET_FRAME_OFFSET),
  // so callers resolve the frame through evaluatedFrame / resolveCursor before reading here — the brand makes
  // "read the pose at the raw tick" (the verdict-vs-pose off-by-one) a compile error at this seam.
  entityStatesAt(frame: StateFrame): ReadonlyMap<string, EntityV2> {
    const hit = this.stateCache.get(frame)
    if (hit) { this.stateCache.delete(frame); this.stateCache.set(frame, hit); return hit }
    const m = this.decodeState(frame)
    this.stateCache.set(frame, m)
    if (this.stateCache.size > RunModel.CACHE_CAP)
      this.stateCache.delete(this.stateCache.keys().next().value!)
    return m
  }
  private decodeState(tick: number): Map<string, EntityV2> {
    const span = this.det.subarray(this.run.stateOff[tick]!, this.run.stateOff[tick]! + this.run.stateLen[tick]!)
    const frame = decodeStateTick(span)
    const m = new Map<string, EntityV2>()
    for (const e of frame.entities)
      if (e.namespaceTag === 1) m.set(`${e.namespaceTag}:${e.id}`, decodeEntityV2(e.fieldBytes))
    return m
  }
  geometryQueryAt(seq: number): GeometryQuery | null {
    if (seq === this.lastQuerySeq) return this.lastQuery
    const q = this.run.kind[seq] !== GEOMETRY_QUERY_RESOLVED ? null : decodeGeometryQuery(this.eventAt(seq).payload)
    this.lastQuerySeq = seq
    this.lastQuery = q
    return q
  }
  /** The decoded kind-22 EligibilityEvaluated payload for a seq, or null for any other kind — the sibling
   *  of geometryQueryAt, keyed off the same load-time per-event kind array. Load/interaction rate only. */
  eligibilityAt(seq: number): Eligibility | null {
    return this.run.kind[seq] !== ELIGIBILITY_EVALUATED ? null : decodeEligibility(this.eventAt(seq).payload)
  }
  /** The decoded kind-1 DetectionMade payload for a seq, or null for any other kind. */
  detectionAt(seq: number): Detection | null {
    return this.run.kind[seq] !== DETECTION_MADE ? null : decodeDetection(this.eventAt(seq).payload)
  }
  /** The FULL, UNBOUNDED causal chain of a seq — every ancestor (nearest-first) and every transitive descendant.
   *  EXPORT-TIER (v0.8): kept for tests/tools that genuinely need the whole chain (the causalHops oracle,
   *  runModel's own pins). The RENDER PLANE must NOT call this — it uses chain.ts `causalNeighborhood` (the bounded,
   *  count-true traversal every pixel surface shares), so the links, the timeline lights, the stage, and the
   *  chainmeta chip can never disagree and a wide chain can never enumerate unbounded. A migration guard in
   *  chain.test.ts asserts no render-plane file imports this. */
  causalChain(seq: number): { ancestors: readonly number[]; descendants: readonly number[] } {
    const ancestors: number[] = []
    let p = this.parentOf(seq)
    while (p !== null) { ancestors.push(p); p = this.parentOf(p) }
    const descendants: number[] = []
    const queue: number[] = [...this.childrenOf(seq)]
    for (let qi = 0; qi < queue.length; qi++) { descendants.push(queue[qi]!); queue.push(...this.childrenOf(queue[qi]!)) }
    return { ancestors, descendants }
  }
  eventsForSubject(entityKey: string): readonly number[] { return this.subjectSeqs.get(entityKey) ?? EMPTY }
  subjectOf(seq: number): string | null { return this.subjects[seq] ?? null }
  /** The namespace-1 entity an event is ABOUT, resolved on demand for the kinds that name a subject —
   *  kind-23 (tracked at load), kind-22 EligibilityEvaluated, kind-1 DetectionMade — else null. Used by
   *  the timeline hover to name the subject with its identity plate (hover rate; one payload decode). */
  subjectOfEvent(seq: number): string | null {
    const k = this.run.kind[seq]
    if (k === GEOMETRY_QUERY_RESOLVED) return this.subjects[seq] ?? null
    if (k === ELIGIBILITY_EVALUATED) { const e = this.eligibilityAt(seq); return e ? `1:${e.subject}` : null }
    if (k === DETECTION_MADE) { const d = this.detectionAt(seq); return d ? `1:${d.subject}` : null }
    return null
  }
}
