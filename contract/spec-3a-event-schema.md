# Spec 3a — Run Manifest · Determinism Hash · Event/State Model · Engine Boundary

> **Status: FROZEN (rev 15).** The contract is frozen: the independently-verified golden KAT (§7) is committed and the conformance spine ([[SPEC-003a-SPINE]]) runs green — the producer, the independent `bundle-verify`, and the subprocess `conformance-tests` all agree on the golden, with the sealed-API (CR-25) and live-identity (CR-26) gates required on `main` (CR-27). Hardened across five byte-level audits + two system-level passes; **rev 8** adds the normative **F0 byte-contract freeze appendix** (§6.5); **rev 9** (the EXP-F1 registry bump) adopts the Spec 3b §11 grammars — events **v3** / state **v2** (versions `3`/`2`) — updating §6.5.0/§6.5.2/§6.5.3/§6.5.7/§6.5.10 in place; the outgoing v2/v1 grammar remains provable via the Spec 3b §13.3 `compat-v2s1` vectors; **rev 10** (the EXP-E0 registry bump) adopts core kind 23 in-place — events **v4**; **rev 11** (the EXP-F2a registry bump) adopts core kinds 1 + 22 in-place — events **v5** (state stays `2`); **rev 12** (the EXP-F3a registry bump) adopts core kinds 2/3/4 in-place and fills `Cognitive.tracks` — events **v6** / state **s3** (versions `6`/`3`); **rev 13** (the EXP-F4 registry bump) adopts core kinds 5/6/7 in-place — events **v7** (state stays `3`), minting the first I64 type-tag use and binding `MessageDelivered.latency_us` `[(UNIT=MICROSECOND), (TIMESTAMP=SIM_TIME_US)]`; **rev 14** (the EXP-F6a registry bump) adopts core kinds 15/20/21 in-place — events **v8** (state stays `3`), ZERO new type-tag/§12 mints (`granted` reuses the existing `Bool` tag); **rev 15** (the EXP-F6b registry bump) adopts core kinds 17/18/19 in-place — events **v9** / state **s4** (versions `9`/`4`), carrying NONZERO `predicate_id`s 4/5/6 (the mutating-outcome keystone tails) and FILLING the `Weapon=6` state partition verbatim from Spec 3b §11.2 (7 fields — the FIRST state-schema move since F3a), ZERO new type-tag/§12 mints. Design:
> [D-005](../../../roadmap/decisions/D-005-spec-003a-decisions.md) ·
> [D-006](../../../roadmap/decisions/D-006-spec-003a-revision.md) ·
> [D-007](../../../roadmap/decisions/D-007-spec-003a-rev5-reshape.md) ·
> [D-008](../../../roadmap/decisions/D-008-spec-003a-rev5-deep.md) ·
> [D-009](../../../roadmap/decisions/D-009-spec-003a-rev6-formal.md) ·
> [D-010](../../../roadmap/decisions/D-010-engine-spine-architecture.md). Depends on
> [Spec 1](spec-1-dependency-graph.md), [Spec 2](spec-2-experiment-catalog.md), the work order
> `roadmap/work/SPEC-003a-event-schema.md`, `roadmap/decisions/D-002-evidence-invalidation.md`.
>
> **Thesis:** F0 proves deterministic **simulation** (events **+** full state trajectory bound into
> `result_id`) and **observation integrity** (engine-emitted outcomes verified against the state delta).
> It does **NOT** prove physical/algorithmic **correctness** — a green F0 ≠ "the simulator is faithful"
> (D-009 #7). **Non-goals (3b):** production payload/state *field layouts*; the framework freezes here.

---

## 0. Frozen constants & registries

| Constant | Value |
|----------|-------|
| `manifest_schema_version` / `event_schema_version` / `state_schema_version` | `1` / `9` / `4` |
| `HASH_ALGO` / `ENCODING` | `blake3-256` / `fixed-le/v1` |
| contexts (all distinct) | `CTX_EVENT`, `CTX_STATE`, `CTX_RESULT`, `CTX_INPUTS`, `CTX_EVIDENCE`, `CTX_RNG` (= `det-event-log/v1`, `det-state-traj/v1`, `det-result/v1`, `run-inputs/v1`, `evidence-fingerprint/v1`, `rng-substream/v1`) |
| `FrameTag:u8` | `Event=1, StateTick=2, Trailer=3` (hashed domain tag) |
| `SIM_TIME_UNIT`/`DT_UNIT` | `i64` µs (integral; `dt_us>0`) |
| `VARIANT_TAG`/`LEN_PREFIX` | `u16` LE / `u32` LE |
| `seq`/`tick` origin | `0`, +1 |
| `determinism_class` | `D1=1, D2=2` |
| `termination_reason` | `COMPLETED=1, STEP_LIMIT=2, GOAL=3, FROZEN=4` |
| resource budgets (framework; values in `config`) | `MAX_{FRAME,PAYLOAD,STATE_TICK}_BYTES, MAX_{ENTITIES,EVENTS,TICKS,STRING_LEN,COLLECTION_LEN}`; all conversions checked |

**`NamespaceTag:u16` (canonical-state partitions):** `Entity=1 … Weapon=6`, `Environment=7`,
`Cognitive=8`, **`Engine=9`** (engine control: next `seq`, per-namespace next-ID counters, pending
timers/scheduled deliveries, resolver queues, termination phase, retained causal handles — D-009 #2).
Canonical state = **full sufficiency state**: every partition s.t. `(state[t], capability-scoped inputs,
tick) → state[t+1]` is total + deterministic.

**On-disk wire format** (all multi-byte fields **little-endian**, matching `fixed-le`).
`FileHeader { magic:[u8;8]=b"DETBNDL1" (protocol-neutral, brand-free), format_version:u32=1,
event_schema_version:u32, state_schema_version:u32, header_crc32c:u32 }` (its own checksum over the
preceding header bytes — `u32` versions reconcile with `Inputs`) then `Frame { tag:u8, payload_len:u32,
payload:[u8], crc32c:u32 }`. **CRC32C** = Castagnoli, init `0xFFFFFFFF`, reflected, final-XOR
`0xFFFFFFFF`, over `tag ++ payload_len ++ payload`; `payload_len > MAX_PAYLOAD_BYTES` is rejected
**before allocation**. The `magic`/`len`/`crc`/header are **storage framing only** — the **canonical
hash** folds the frame's *canonical content* `tag ++ payload`, never the len/crc/header. `DecodeError`
covers `BadMagic, BadVersion, BadHeaderCrc, BadCrc, TruncatedFrame, UnknownFrameTag, OversizePayload, OversizeStateTick, FrameAfterTrailer, …`.

**`EventKind`** production `1..=19` + observation `20..=24` (`AuthorizationDecided, FireRejected,
EligibilityEvaluated, GeometryQueryResolved, AllocationStateUpdated`; kind `16 AuthorizationGranted` is
deprecated in favour of `20`). Test-only `F0_FIXTURE=0xF000`. `schema_registry_hash` over the
production `(discriminant,name)` set; **`state_registry_hash`** over the per-partition canonical-field
layouts **plus the state-projection and role-projection rule ids** (so a silent reinterpretation
changes identity).

**Frozen `struct Inputs`** (field order = encoding order): `event_schema_version:u32, state_schema_version:u32,
determinism_class:u16, schema_registry_hash:[u8;32], state_registry_hash:[u8;32],
capability_matrix_hash:[u8;32], toolchain_id:String, cargo_lock_hash:[u8;32], scenario_id:String,
scenario_hash:[u8;32], seed:u64, config:Config, resources:ResourceClosure`. `config` carries `dt_us:i64`
+ `sensor_effects_model:u16` + the budget values. `ResourceClosure` = 5 content hashes (§5.1). For F0
each closure hash = `blake3(fixed_le(0u32))`; `capability_matrix_hash` over the F0-stub matrix.

---

## 1. Scope & boundary
Canonical = `Event` frames + per-tick `StateTick` frames + the `Trailer`; only these feed `result_id`.
Provenance never does.

### 1.1 Hash domains
`event_hash` (`CTX_EVENT`, `Event` frames seq-ordered) · `state_trajectory_hash` (`CTX_STATE`,
`StateTick` frames tick-ordered) · **`result_id`** = `derive(CTX_RESULT)(FrameTag::Trailer ++
fixed_le(case_id, event_hash, state_trajectory_hash, event_count, tick_count, termination_reason))` —
**`case_id` is folded in** (it carries the schema/state/scenario/capability identities), so identical
content bytes under a different interpretation can never share a `result_id` ·
`inputs_digest`=`case_id` (`CTX_INPUTS`) · `evidence_fingerprint` (`CTX_EVIDENCE`). Reserved (not in
`result_id`): `event_stream_digest`, `state_checkpoint_stream_digest`, `evidence_bundle_digest`. The
manifest records `event_hash` + `state_trajectory_hash` separately → `{event|state|trailer}` triage.

---

## 2. Event & state model

### 2.1 Envelope & identity
Hashed: `seq:u64`(0,+1), `tick:Tick`(`<tick_count`), `kind:EventKind(u16)`, `causation_id:Option<EventId>`, `payload`. Derived
(excluded, each a deterministic function of hashed content): `event_id=seq`, `trace_id`,
`sim_time=tick×dt_us`, `span_id=None`, roles. Identity: semantic `(case_id, result_id, seq)`; physical `(case_id,build_id,attempt_id,seq)`.

### 2.2 Domain IDs
`DomainId = (NamespaceTag, u64)`. Per-namespace counters live in the **`Engine`** partition (hashed,
§0). Pure subsystems emit `IdRef::New` placeholders resolved at the chokepoint (§5.2).

### 2.3 Event ownership (every kind classified — D-009/audit-1 #6)
| Category | Emitter | Coupling | Kinds |
|---|---|---|---|
| **Decision/intent** | subsystem (cognitive) | bound to the agent's authorized view | `DecisionMade, BeliefUpdated, FireCommand, DesignationSent, TaskProposed, TaskBid` |
| **Resolver mutating-outcome** | engine resolver (module-private ctor) | **§2.6 state-predicate** over the same-tick state-delta | `TrackConfirmed, TrackUpdated, TrackDropped, MessageSent, MessageDelivered, MessageDropped, HandoffAccepted, TaskAssigned, WeaponLaunched, DamageApplied, TargetDestroyed` |
| **Resolver non-mutating fact** | engine resolver | bound to **verified resolver input→output** (no state mutation) | `AuthorizationDecided, FireRejected` |
| **Query/observation fact** | engine | bound to **verified query input→output** | `DetectionMade, EligibilityEvaluated, GeometryQueryResolved, AllocationStateUpdated` |

### 2.4 Roles — deterministic projection of `payload` (rules in `state_registry_hash`).

### 2.5 Causal guards + handle flow
`causation_id` hashed; `ParentRef::Relative(idx)` requires **`idx<j`** (strictly earlier; self/forward =
typed reject); `Absolute(s)` requires `s` committed ∧ `s<assigned_seq`. **Capability-derived lineage (not freely chosen):** authorized
views deliver **opaque `CausalToken`s** alongside the inputs a subsystem may consume; an `Intent` carries
`sources: NonEmpty<CausalToken>` and autonomy code **cannot construct arbitrary `EventId`s**. Resolvers
derive `causation_id` from the consumed tokens (Detection→Track→Message→Belief→Decision lineage), so a
subsystem can only reference causes it *actually consumed* — C1's chain is **provable**, not narrated.

### 2.6 Keystone (mutating outcomes only — audit-1 #6, audit-2)
Every **mutating-outcome** kind declares a predicate over the **same-tick state-delta** referencing the
**named subject**, e.g. `TargetDestroyed(subject=s)@t ⇔ entity s's digested alive-bit flips true→false
in State[t]→State[t+1]`. The engine validates it at commit; mutate-without-emit / emit-without-mutate is
a typed `FactualInconsistency` aborting the run. **Non-mutating facts** (cat 3/4) instead bind to their
resolver's verified `(input, output)` (e.g. `AuthorizationDecided` = pure function of the recorded ROE
state + `FireCommand`). Module-private constructors stop outsiders; the predicate stops the resolver
itself from decoupling log and reality. **Test-only `F0_FIXTURE` is itself a mutating outcome** with the
predicate `F0_FIXTURE(drawn=d)@t ⇔ Entity(0).value: prev→d in State[t]→State[t+1]`, so F0 actually
exercises the keystone machinery (its observation-integrity claim is not hollow).

---

## 3. Canonical hashing

### 3.1 In/out — `Event` frames (seq order) + `StateTick` frames (tick order) + `Trailer`; out: provenance, manifest, derived fields, Verdict stream.

### 3.2 `fixed-le/v1` + CanonicalState
Encoding: fixed-LE ints; bool 0/1; enum `u16` tag; `Option` tag+T; every variable-length field `u32`
length-prefixed; UTF-8 strings length-prefixed; floats NaN/±inf forbidden (release-active, emit **and**
inputs), `-0.0→+0.0`, `to_bits()` LE; `[u8;32]` raw; frozen order; no map/set iteration on any canonical
path. **CanonicalState:** entities keyed by the **full `(namespace_tag:u16, id:u64)`** key, **sorted by
that key**; each partition declares canonical fields + order. **Tombstones:** a destroyed entity is
retained with `alive=false` for the tick of death so `true→false` is provable in State[t]→State[t+1];
subsequent absence is the present→absent lifecycle. **The telemetry/Rerun stream IS the `StateTick`
canonical bytes** (one definition; F1/F3a/F6b recompute from the bytes `state_trajectory_hash` covers).

### 3.3 Streamable framed dual fold (audit-1 #1,#2; audit-2 #4,#5)
State frames are indexed `0..=tick_count`: **`State[0]` = the initial world**; step `t` reads `State[t]`,
stamps its events `tick=t`, produces `State[t+1]`; a run of `tick_count` steps emits **`tick_count+1`
`StateTick` frames**. The `StateTick` frame carries the **canonical state BYTES** (not a digest).
```
E=derive(CTX_EVENT); S=derive(CTX_STATE)
S.update(FrameTag::StateTick ++ fixed_le(0u64) ++ canonical_state_bytes(State[0]))     // initial leaf
per committed event e (seq order): assert e.seq==expected ∧ e.tick>=prev_tick ∧ e.tick<tick_count
    E.update(FrameTag::Event ++ fixed_le(e.seq,e.tick,e.kind,e.causation_id,e.payload)); event_count+=1
per tick t in 0..tick_count: S.update(FrameTag::StateTick ++ fixed_le((t+1) as u64) ++ canonical_state_bytes(State[t+1]))
result_id = derive(CTX_RESULT)(FrameTag::Trailer ++ fixed_le(case_id, E.finalize(),S.finalize(),event_count,tick_count,termination_reason))
```
**`canonical_state_bytes` — A1 (authoritative):** flat `fixed_le(u32 entity_count ++ for each (sorted
key): namespace_tag:u16 ++ id:u64 ++ u32 len ++ canonical fields)`. **A1 is the only canonical state
hash.** A2 (order-independent) / A3 (Merkle-map) are **storage/localization sidecars** — never in
`result_id`, never claimed to "reproduce A1's bytes" (a Merkle root ≠ a flat hash). The per-tick
**32-byte digest** is a derived sidecar for first-divergent-tick localization; the verifier re-folds the
state bytes and asserts the digest sidecar matches before trusting it.

### 3.4 D1 (REQUIRED)
No wall-clock/host/thread/pid/addr/os-rng in hashed content or order. No unordered iteration on any
draft/state/seq/ID path (deny-lint, §7). **Closed-world:** no unmanifested fs/env/net/clock/os-rng/
dlopen/process-static during `run()` (`ResourceResolver` sole chokepoint). **Capability noninterference:**
perturbing a partition outside a subsystem's authorized read view must not change its output (D-009 #1).
D1 holds across **fresh OS processes**, not only in-process repeats. Floats per §3.2.

### 3.5 D2/D3
D2 (same binary, diff machine) GATED: the rev-5/6 digest folds every entity's full state each tick, so
D2 additionally needs MXCSR pinning + no dynamic transcendental libm on the canonical path + explicit FMA
(`mul_add`) — demonstrated on a recorded pair, never class-asserted. D1 unconditional; D3 out of scope.

### 3.6 Normative byte-layout table (the reference encoder's target — any ambiguity surfaces as a byte mismatch)
**BLAKE3 modes:** registry hashes (`schema_registry_hash`, `state_registry_hash`, `capability_matrix_hash`,
the `ResourceClosure` members) use **regular** mode; the domain-separated hashes `derive(CTX_*)` use
**derive_key** mode with the CTX_* ASCII string as the derivation **context** and the data as input;
`keyed_hash(key, ..)` (RNG only) uses **keyed** mode with the 32-byte key. CRC32C is storage-only, never
hashed.
**Scalars (fixed little-endian):** `bool` = `u8 ∈ {0,1}` (else `DecodeError::InvalidBool`); enums = `u16`
tag (unknown → `InvalidEnumTag`); `Option<T>` = `u8` tag `{0=None, 1=Some}` ++ `T` iff Some (tag ∉ {0,1} →
`InvalidOptionTag`); `[u8;32]` = 32 raw bytes. **Widths:** `Tick=u64`, `EventId`/`seq`=`u64`,
`NamespaceTag=u16`, `DomainId.id=u64`, RNG `subsystem_id=u16`, `entity_id=u64`, `purpose_slot_id=u16`,
`elem=u64`, `seed=u64`, all schema/budget versions `u32`.
**`utf8` strings:** `u32` **byte**-length prefix ++ raw UTF-8 bytes; **no** Unicode normalization (length
is bytes, not code points); invalid UTF-8 → `InvalidUtf8`; `len > max_string_len` → `LimitExceeded`.
**Var-length collections:** `u32` count ++ elements; `count > max_collection_len` → `LimitExceeded`.
**Floats:** `f64.to_bits()` LE; `-0.0 → +0.0`; NaN/±inf forbidden (`InvalidFloat`), release-active.
**Frame canonical content (exactly what the fold covers): `FrameTag:u8 ++ payload`.** Payloads:
- **Event** = `fixed_le( seq:u64, tick:u64, kind:u16, causation_id:Option<u64>, payload:{u32 len ++ bytes} )`
  — `kind` is the `EventKind` discriminant; the verifier reads it to select the payload schema + §2.6
  predicate **before** decoding `payload`.
- **StateTick** = `fixed_le( tick_index:u64, canonical_state_bytes )`, where `canonical_state_bytes` (A1) =
  `u32 entity_count ++ for each entity sorted by (namespace_tag:u16, id:u64): namespace_tag:u16 ++ id:u64
  ++ u32 field_len ++ field_bytes`. **`field_len` covers ONLY the canonical field bytes** (not the
  `namespace_tag`+`id` key).
- **Trailer** = `fixed_le( case_id:[u8;32], event_hash:[u8;32], state_trajectory_hash:[u8;32],
  event_count:u64, tick_count:u64, termination_reason:u16 )` — the `result_id` preimage (§3.3).
**On-disk framing (NOT hashed):** `FileHeader` (§0) then each `Frame{ tag:u8, payload_len:u32 LE, payload,
crc32c:u32 LE }`; `crc32c` over `tag ++ payload_len ++ payload`.

---

## 4. Run manifest
`RunManifest { manifest_schema_version:u32, inputs:Inputs, outputs:Outputs, provenance:Provenance }`.
**outputs:** `event_hash, state_trajectory_hash, result_id` (hex64), hash-descriptors, `event_count,
tick_count, sim_time_*`, `run_complete:bool` + `termination_reason`, reserved digests (JSON `null`).
**provenance:** `case_id, build_id, attempt_id, commit`(recorded), `dirty`, `created_at` (the complete F0 set; all but `case_id` are run-variable — golden scope §6.5.11).
**§4.4 identity/evidence** (unchanged from rev 5): `case_id=derive(CTX_INPUTS)(fixed_le(Inputs))`;
`build_id`=exe digest; `attempt_id`=128-bit nonce (32-hex, `mkdir`-exclusive staging dir); `result_id`=§3.3; invariant
`case_id==∧build_id== ⇒ result_id==`. `evidence_fingerprint=derive(CTX_EVIDENCE)(fixed_le(inputs_digest,
build_id, invalidated_by_path_hash, contract_version))`; `contract_version`/`invalidated_by_path_hash` =
BLAKE3 (regular) over the glob set expanded to concrete files, **sorted byte-lexicographically** by
repo-relative POSIX path (UTF-8), then per file `u32 path_len ++ path ++ u32 content_len ++ committed
bytes` — content hashed **raw, no LF normalization** (it would corrupt golden **binary** fixtures; the repo
pins LF for text via `.gitattributes`). Empty glob **fails closed**.
**§4.5 JSON + publication.** `u64`/`i64` as decimal strings; `[u8;32]` 64-hex; enums `u16`;
`deny_unknown_fields`; hashes over `fixed-le` structs not text; F0 re-run reads in-memory `Inputs`.
Publication & on-disk layout are the **single protocol** frozen in §6.5.11/§6.5.14 (one directory, two
files, `mkdir` staging → atomic directory rename; **no** marker variant). A branch-1 bundle is
**published** when finalized **∧** decode+hash re-verify **∧** `run_complete:true`. **Citable** additionally
requires `dirty=false` **∧** valid evidence metadata — a **branch-2** predicate. `.partial-*` never parsed.

---

## 5. Engine boundary

### 5.1 Seams (CapturedRun + capability views — audit-1 #5, audit-2 #1)
```
capture_inputs(env) -> Result<CapturedRun, CaptureError>     // resolves + VALIDATES bytes vs Inputs hashes
struct CapturedRun { inputs: Inputs, scenario: ResolvedScenario, resources: ContentAddressedResources }
run(&CapturedRun, sink:&mut dyn FrameSink) -> Result<RunResult, RunError>   // PURE in CapturedRun; O(1) in event count
// capability-scoped read: a subsystem sees ONLY its declared view (frozen capability matrix, hashed)
fn step(view: &Self::ReadView, ctx: &StepCtx) -> StepProposal               // PURE; ReadView ⊂ {TruthGeometry|DetectionInbox|Belief+Message|PhysicalWorld|…}
struct StepProposal { own_state_delta, intents:Vec<Intent>, observations:Vec<Observation> }   // writes ONLY the declared partition
trait FrameSink { fn event(&mut self,&Event)->Result<(),SinkError>; fn state_tick(&mut self,tick:u64,bytes:&[u8])->Result<(),SinkError>; fn trailer(&mut self,..)->Result<(),SinkError>; }
trait ResourceResolver { /* sole load chokepoint; unmanifested -> RunError::UnmanifestedResource */ }
```
`capture_inputs` validates every resource/scenario byte against its `ResourceClosure`/`scenario_hash`
**before** the pure boundary, so `run` is pure in fully-materialized, pre-validated bytes.

### 5.2 Transactional tick (audit-2 #4) + ordering
Per tick `t` (atomic): (1) snapshot `State[t]`; (2) each subsystem `step`s on its capability view (pure);
(3) `resolve` → candidate `State[t+1]` + candidate events, assigning `seq` in the frozen order **(pinned
subsystem/resolver order) × (entities sorted by `DomainId`) × (observations after resolver events)**,
resolving `IdRef::New`/`ParentRef::Relative`, stamping `tick=t` (the deciding tick); (4) validate
conflicts + causality + the §2.6 predicates; (5) **commit** `State[t+1]`; (6) emit the whole tick's
frames. **No frame reaches the sink before step (4) passes**; a failed predicate discards the candidate
tick → typed `FactualInconsistency`, non-citable partial bundle.

**§5.2.1 Tick phases:** same beginning-of-tick snapshot for all; effects visible at `t+1`; two deltas on
one `(entity,field)` = typed `ConflictingDelta` (fail-closed; opt-in declared reducer, never silent LWW);
≥2 commands at one actuator = declared deterministic arbitration emitting a typed **rejection fact** for
the loser (default `ActuatorContention` — a *fact*, not a run error).

### 5.3 State vs events — `own_state_delta` is authoritative state; `intents`→resolvers; `observations`→observation events; outcomes only from resolvers.

### 5.4 RNG — counter-based, semantic slots (audit-2 #3)
`substream_key=derive(CTX_RNG)(fixed_le(seed, subsystem_id, entity_id, purpose_slot_id))`;
`sample(key, tick, elem_idx)=u64::from_le_bytes(keyed_hash(key, fixed_le(tick, elem_idx))[0..8])`.
`purpose_slot_id` is a **frozen per-subsystem semantic discriminant** (e.g. `MEASUREMENT, DELIVERY,
LATENCY`); `elem_idx` a **stable semantic index** (not a running counter) — so adding/skipping a draw
never shifts another stream (common-random-number pairing survives).

### 5.5 Typed failures + budgets (no panics)
`RunError{ InvalidFloat{tick,field}, IdExhausted{ns}, UnmanifestedResource, InvalidConfig, TimeOverflow,
ConflictingDelta, FactualInconsistency, ResourceBudget{which}, NonReproducibleProfile, Sink(SinkError), Internal }`;
`SinkError{ Io,Fsync,StagingCollision,PublishCollision }`; `DecodeError{ … }`. `Sink(SinkError)` is `run`'s
**typed propagation** of a streaming-sink IO failure (a sink may fail after accepting an `Event` but before
its `StateTick`) — it preserves the cause and is *not* a canonical-determinism error. `dt_us>0`; `tick×dt_us`
checked. **Budgets** (§0) are typed `ResourceBudget` aborts. An **external wall-clock watchdog** abort is
a non-citable partial — **never** canonical `STEP_LIMIT` (which comes from hashed `config`).

---

## 6. EXP-F0 contract + fixture
`F0FixturePayload{drawn:u64,value:f64,label:String}` (`F0_FIXTURE=0xF000`); **F0 state cell** = a counter
**`Engine`/`Entity`** with `value=drawn` (frozen key+layout) so `state_trajectory_hash` is non-trivial.
Stub: ≥2 fixture events over ≥2 ticks (event 0 root, event 1 `causation_id=Some(0)`), `drawn=sample(...)`.
- **Oracle:** §4.4 invariant; re-run from in-memory `CapturedRun.inputs`; pinned seeds `42..=51`.
- **Mutators** (the oracle detects each — outcomes are **per-mutant**, not uniform): `mutate_causal` /
  `mutate_state` → a **different `result_id`** (`mutate_state` flips it via `state_trajectory_hash` with
  `event_hash` unchanged); `mutate_trailer` (drop the trailer) → **typed rejection** (`TruncatedFrame` /
  missing-trailer — there is *no* valid `result_id` to compare); `mutate_rng` (unseeded draw) →
  **non-repeatability** across fresh processes **and** **forbidden-source detection** (the closed-world
  lint, §3.4). **`mutate_float` is a PRIMITIVE encoder mutation** (`-0.0`/NaN/∞ → normalization / typed
  `InvalidFloat`), **not a fixture-level mutator**: the F0 fixture path cannot reach a non-canonical float
  (`value = drawn as f64` is always finite), so a fixture-level float mutation is vacuous — coverage lives
  in the tier-a primitive golden (per the frozen EXP-F0 contract).
- **Coupling conformance (3a gate):** `trybuild` compile-fail (out-of-resolver crate can't construct
  `TargetDestroyed`); resolver-desync unit test (mutate-without-emit ⇒ `FactualInconsistency`).
- **Capability noninterference (3a gate):** perturb a partition outside the stub subsystem's view ⇒ its
  output is byte-identical.
- **Offline verification:** a verifier re-decodes the bundle and re-checks all hashes, the §2.6
  event⇔state predicates, **and the cross-stream inductive invariants** — `State[k].next_seq` == events
  committed before frame k; every next-ID counter > all retained/tombstoned IDs in its namespace; exactly
  `tick_count+1` state frames; event ticks align with state transitions; pending queues/timers reference
  existing IDs; termination phase agrees with the trailer; exactly one trailer; **no frame after the
  `Trailer`**; **cross-bindings** — `FileHeader` schema versions == `manifest.inputs`; the bundle directory
  name == `provenance.attempt_id`; recomputed `case_id` == `manifest` provenance `case_id` == the `Trailer`'s
  folded `case_id`; `manifest.outputs` == the values refolded from the decoded streams; each hash descriptor
  names its context string — all from the persisted bytes, not only live execution.
- **Metamorphic:** `A→A`, `A→B→A` (leaked-global), **fresh-process `A‖A'`** (D1 claimed here), serial-vs-
  parallel outer runs, different provenance→identical result, crash at each publication phase,
  first-divergent-tick localization.
- **Claim scope (D-009 #7):** F0 certifies **reproducibility + observation integrity**, not physical
  correctness.

### 6.5 F0 byte-contract freeze (rev 8, updated rev 9 — normative; makes Spec 3a self-sufficient to generate the KAT)
Everything an independent implementation needs to produce the F0 bundle byte-for-byte. All values here are
**frozen constants**; the F0 KAT uses **synthetic** identity inputs (6.5.9) so the golden artifact never
depends on live build state. Decisions/rationale: [[D-010]]; §6.5.5 honours [[D-008]]'s `ResourceClosure`.
Rev 9 (the EXP-F1 registry bump) updated §6.5.0/§6.5.2/§6.5.3/§6.5.7/§6.5.10 in place to the adopted
Spec 3b §11/§12 grammars (events v3 / state v2); Rev 10 (the EXP-E0 registry bump, 2026-07-03) adopted
core kind 23 in-place (events v4 / state v2); Rev 11 (the EXP-F2a registry bump, 2026-07-05) adopted
core kinds 1 and 22 in-place (events v5 / state v2); Rev 12 (the EXP-F3a registry bump, 2026-07-06)
adopts core kinds 2/3/4 in-place and fills the `Cognitive.tracks` `Collection` sublayout (events v6 /
state s3); Rev 13 (the EXP-F4 registry bump, 2026-07-07) adopts core kinds 5/6/7 in-place — events
v7 (state stays 3); mints the first I64 field-descriptor use (spec-3a §6.5.0) and reconciles Spec 3b
§11.1 row 6 `latency_us` to its two-pair binding; Rev 14 (the EXP-F6a registry bump, 2026-07-08)
adopts core kinds 15/20/21 in-place — events v8 (state stays 3), ZERO new type-tag/§12 mints
(`granted` reuses the existing Bool tag); Rev 15 (the EXP-F6b registry bump, 2026-07-09) adopts core
kinds 17/18/19 in-place — events v9 (state s3 → s4) — with NONZERO predicate_ids 4/5/6 and FILLS the
`Weapon=6` state partition (Spec 3b §11.2 baseline verbatim, 7 fields; the first state-schema move
since F3a), ZERO new type-tag/§12 mints; every other §6.5 value is unchanged.

**6.5.0 `type_tag` enum** (`u16`, for the registry layouts): `U16=1, U32=2, U64=3, I64=4, F64=5, Bool=6,
Bytes32=7, Utf8=8, VecU64=9, Collection=10` (`Collection` = a `u32` count-prefixed list of records),
`VecF64=11` (`u32` count ++ count × `f64`, §3.2 float rules per element — appended by Spec 3b §11.0 at
the F1 bump).

**6.5.1 `EventKind` table** (frozen discriminant→name; the `schema_registry_hash` domain). Production:
`1 DetectionMade, 2 TrackConfirmed, 3 TrackUpdated, 4 TrackDropped, 5 MessageSent, 6 MessageDelivered,
7 MessageDropped, 8 BeliefUpdated, 9 DesignationSent, 10 HandoffAccepted, 11 TaskProposed, 12 TaskBid,
13 TaskAssigned, 14 DecisionMade, 15 FireCommand, 16 AuthorizationGranted (DEPRECATED — excluded),
17 WeaponLaunched, 18 DamageApplied, 19 TargetDestroyed, 20 AuthorizationDecided, 21 FireRejected,
22 EligibilityEvaluated, 23 GeometryQueryResolved, 24 AllocationStateUpdated`. Test-only `F0_FIXTURE =
0xF000` is included **only** in the F0 `schema_registry_hash` (6.5.2) with its payload-layout descriptors —
its discriminant **and** field layout bind the interpretation. (Raw bytes alone do **not**: same-width
fields, swapped fields, or different units reinterpret the payload without changing a byte.)

**6.5.2 `schema_registry_hash`** (events **v9** — the Spec 3b §11.0 UNIFORM grammar) `= blake3( u32
prod_count=25 ++ for each production kind ascending over {1..=15, 17..=24, 0x0120, 0x0121} : u16
discriminant ++ u32 name_len ++ utf8 name ++ u32 field_count ++ field_desc* ++ u32 conversion_id ++ u32
predicate_id ; then the F0 fixture binding appended AFTER the counted entries: u16 0xF000 ++ u32 name_len
++ utf8 "F0_FIXTURE" ++ u32 payload_field_count=3 ++ field_desc(drawn,U64) ++ field_desc(value,F64) ++
field_desc(label,Utf8) — each `sem_count=0` ++ u32 conversion_id=1 (`value = drawn as f64`) ++ u32
predicate_id=1 (the §2.6 keystone predicate) )` (deprecated `16` excluded). `field_desc` is the Spec 3b
§12.0 sem-bearing form: `u32 name_len ++ utf8 name ++ u16 type_tag ++ u32 sem_count ++ sem_count ×
( u16 dimension_id ++ u16 value_id )`, pairs sorted ascending by `dimension_id`, dimensions distinct per
field. Baseline kinds adopt per-experiment (Spec 3b §11.1): at v4, kind `23 GeometryQueryResolved`
was ADOPTED in-place (EXP-E0, 2026-07-03 — 7 `field_desc`s per Spec 3b §11.1 row 23, with
`tiebreak_applied:Bool` carrying the single pair `(TIEBREAK=8, DECLARED_PREDICATE=3)` and the
`(conversion_id=0, predicate_id=0)` non-mutating tail); at v5, kinds `1 DetectionMade` and
`22 EligibilityEvaluated` are ADOPTED in-place (EXP-F2a, 2026-07-05 — kind 22 = the §11.1 row-22
baseline prefix verbatim plus the MAY-append rider `tiebreak_applied:Bool [(TIEBREAK=8,
DECLARED_PREDICATE=3)]`, 7 `field_desc`s; kind 1 = the §11.1 row-1 baseline verbatim, 4 `field_desc`s
with `meas:VecF64 [(UNIT=1, METER=1), (FRAME=2, NED=1), (HANDEDNESS=3, RIGHT=1)]` and `snr_db:F64
[(UNIT=1, DECIBEL=8)]`; both with `(conversion_id=0, predicate_id=0)` non-mutating tails); at v6, kinds
`2 TrackConfirmed` (4 `field_desc`s), `3 TrackUpdated` (5), and `4 TrackDropped` (2) are ADOPTED
in-place (EXP-F3a, 2026-07-06 — baseline verbatim, no appends; `cov`/`innovation_cov` bind the single
pair `(COV_ORDER=6, ROW_MAJOR_FULL=1)`, all with `(conversion_id=0, predicate_id=0)` non-mutating
tails); at v7, kinds `5 MessageSent` (6 `field_desc`s), `6 MessageDelivered` (5), and `7 MessageDropped`
(4) are ADOPTED in-place (EXP-F4, 2026-07-07 — baseline verbatim; `snr_db` binds `(UNIT=1, DECIBEL=8)`,
`tx_power_w` binds `(UNIT=1, WATT=9)`, `latency_us:I64` binds the two-pair `(UNIT=1, MICROSECOND=6)` +
`(TIMESTAMP=7, SIM_TIME_US=2)` sorted ascending by dimension_id; all with `(conversion_id=0,
predicate_id=0)` non-mutating tails — `prod_count=25` UNCHANGED, `I64=4` already in the §6.5.0 enum);
at v8, kinds `15 FireCommand` (4 `field_desc`s), `20 AuthorizationDecided` (5), and `21 FireRejected`
(3) are ADOPTED in-place (EXP-F6a, 2026-07-08 — baseline verbatim, no appends; every field carries
`sem_count=0` — ZERO new §12 mints, `granted:Bool` reuses `Bool=6` — all with `(conversion_id=0,
predicate_id=0)` non-mutating tails; `prod_count=25` UNCHANGED); at v9, kinds `17 WeaponLaunched`
(4 `field_desc`s), `18 DamageApplied` (4), and `19 TargetDestroyed` (2) are ADOPTED in-place (EXP-F6b,
2026-07-09 — baseline verbatim, no appends; `solution:VecF64` binds `[(UNIT=1, METER_PER_SECOND=2),
(FRAME=2, NED=1), (HANDEDNESS=3, RIGHT=1)]`, `point:VecF64` binds `[(UNIT=1, METER=1), (FRAME=2, NED=1),
(HANDEDNESS=3, RIGHT=1)]`, `outcome:U16` is an inline enum `sem_count=0` — ZERO new §12 mints; these are
the FIRST mutating-outcome kinds adopted with NONZERO keystone tails: `(conversion_id=0, predicate_id=4)`
for 17, `(0, 5)` for 18, `(0, 6)` for 19; `prod_count=25` UNCHANGED); the remaining 8 baseline kinds carry
`field_count=0` and a `(conversion_id=0, predicate_id=0)` tail. The two F1 kinds (EXP-F1; Spec 3b §11.4
k=1 block `0x0120..=0x013F`) carry: `0x0120 MotionSegmentStarted` = `seg_index:U16 [no pairs], v_cmd:F64
[(UNIT=1, METER_PER_SECOND=2)], w_cmd:F64 [(UNIT=1, RADIAN_PER_SECOND=5)]` with `(conversion_id=0,
predicate_id=2)`; `0x0121 MotionStepped` = `seg_index:U16 [no pairs]` with `(conversion_id=0,
predicate_id=3)` — predicate semantics bind at adoption per §2.6; their definitions are the EXP-F1
contract's keystone (implemented at the F1 motion step).
Plain `blake3`, no keyed context. The fixture's **discriminant, payload-layout, conversion, and predicate**
ids are bound — a reinterpretation (field swap, type/width change, different conversion or predicate)
changes the hash → `case_id` → `result_id` even when the raw payload bytes are unchanged. *(The F0 fixture
stays unit-less — `sem_count=0` on all three payload fields; the domain-semantics vocabulary is Spec 3b
§12.)*

**6.5.3 Canonical state partitions + `state_registry_hash`** (`state_schema_version = 4` = the Spec 3b
§11.2 fill, adopted at the EXP-F1 registry bump, extended by the EXP-F3a `Cognitive.tracks` fill and the
EXP-F6b `Weapon` fill).
Per-partition canonical field layout, declaration
order: `Entity=1` (the §11.2 fill; semantic pairs per Spec 3b §12.2 + D-015): `{ value:U64 [no pairs —
the frozen F0 cell, kept first], alive:Bool [no pairs], pos:VecF64 [(UNIT=1, METER=1), (FRAME=2, NED=1),
(HANDEDNESS=3, RIGHT=1)], vel:VecF64 [(UNIT=1, METER_PER_SECOND=2), (FRAME=2, NED=1), (HANDEDNESS=3,
RIGHT=1)], heading_rad:F64 [(ANGLE=4, HEADING_NORTH_CW=3) ONLY — an ANGLE value implies radian measure,
so no UNIT pair rides with it (D-015)], speed_mps:F64 [(UNIT=1, METER_PER_SECOND=2)], turn_rate_radps:F64
[(UNIT=1, RADIAN_PER_SECOND=5)], fuel:F64 [no pairs — the EXP-F1 contract's fuel is in abstract "units";
no honest §12.2 UNIT id exists, and a false KILOGRAM/JOULE claim would freeze into identity],
setpoint:VecF64 [no pairs — one field cannot carry two UNIT dimensions (§12.0 dimensions-distinct); the
per-component units live on the 0x0120 event's v_cmd/w_cmd] }`; `2,3,4,5, Environment=7`:
**0 fields** (reserved; later fills bump `state_schema_version`); `Weapon=6`: **7 fields** — `{ kind:U16
[no pairs — inline weapon-kind tag], state:U16 [no pairs — inline enum IDLE=0|LAUNCHED=1|EXPENDED=2],
shooter:U64 [no pairs], subject:U64 [no pairs], pos:VecF64 [(UNIT=1, METER=1), (FRAME=2, NED=1),
(HANDEDNESS=3, RIGHT=1)], vel:VecF64 [(UNIT=1, METER_PER_SECOND=2), (FRAME=2, NED=1), (HANDEDNESS=3,
RIGHT=1)], solution:VecF64 [(UNIT=1, METER_PER_SECOND=2), (FRAME=2, NED=1), (HANDEDNESS=3, RIGHT=1)] }` —
the Spec 3b §11.2 tag-6 baseline verbatim, ADOPTED at the EXP-F6b s3 → s4 bump (the FIRST state-schema
move since F3a's s3); `Cognitive=8`: **1 field** —
`tracks:Collection<TrackRecord>` with `TrackRecord = fixed_le(track:U64, subject:U64, mean:VecF64,
cov:VecF64 [(COV_ORDER=6, ROW_MAJOR_FULL=1)], nu:VecF64, s:VecF64 [(COV_ORDER=6, ROW_MAJOR_FULL=1)])` —
the FIRST recursive `Collection` sublayout, ADOPTED at the EXP-F3a s3 bump (the append-only
adoption-order fold; `belief`/`policy_state`/`cbba_*` stay reserved 0-field until F5/C2a); `Engine=9`: `{
next_seq:U64, next_id_1:U64 … next_id_9:U64 (nine, namespace order), termination_phase:U16,
pending_timers:Collection, scheduled_deliveries:Collection, resolver_queue:Collection,
retained_handles:VecU64 }` — the frozen v1 layout, unchanged, every field `sem_count=0`.
`state_registry_hash = blake3( u16 partition_count=9 ++ for each NamespaceTag 1..=9 ascending: u16 tag ++
u32 field_count ++ for each field in order: field_desc (the §6.5.2 / Spec 3b §12.0 sem-bearing form),
then once: u32 state_projection_rule_id=1 ++ u32 role_projection_rule_id=1 )`. Plain `blake3`, no keyed
context.

**6.5.4 `Config`** (fixed-le order = field order): `Config { dt_us:i64, step_limit:u64,
sensor_effects_model:u16, max_frame_bytes:u32, max_payload_bytes:u32, max_state_tick_bytes:u32,
max_entities:u32, max_events:u64, max_ticks:u64, max_string_len:u32, max_collection_len:u32 }`. **F0
values:** `dt_us=1000`, `step_limit=2`, `sensor_effects_model=0`(NONE), `max_payload_bytes=65536`,
`max_frame_bytes=65545` (= payload + 9-byte frame overhead), `max_state_tick_bytes=65536`,
`max_entities=16`, `max_events=64`, `max_ticks=16`, `max_string_len=256`, `max_collection_len=256`.
Invariants: `dt_us>0`, **`1 <= step_limit <= max_ticks`** (a zero `step_limit` is rejected at capture —
a run takes at least one step — and the offline verifier fails closed to match),
`max_frame_bytes == max_payload_bytes + 9`, every budget `<=` its §6.5.12 verifier ceiling.

**6.5.5 `ResourceClosure`** (restores [[D-008]] — fixed-le order; each `[u8;32]`): `{ dyn_dep_closure_hash,
resource_manifest_hash, termination_policy_hash, subsystem_schedule_hash, runtime_flags_hash }`. **F0:**
every field `= blake3(fixed_le(0u32))` (the empty-closure sentinel); `scenario_id="f0-fixture"`,
`scenario_hash = blake3(fixed_le(0u32))`.

**6.5.6 F0 capability matrix** (`capability_matrix_hash = blake3` of this serialization): one subsystem —
`u32 subsystem_count=1 ++ [ u32 name_len ++ utf8 "f0-fixture" ++ u16 subsystem_id=1 ++ read_view ++
write_partition ++ flows ]`, `read_view` = a list of `ReadCapability` = `u32 n ++ for each: u16 cap_kind ++ (Partition: u16
namespace_tag)`, `cap_kind {1=Partition, 2=CausalInbox}`. **F0:** `n=2 = [ Partition(Entity=1), CausalInbox ]`
— the fixture reads its `Entity` cell **and** an authorized `CausalInbox` (the retained causal tokens it
may consume, 6.5.7), so consuming event 0's token at tick 1 is **within its declared view**, not hidden
`Engine` state. `write_partition = u16 Entity=1`; `flows = { u32 n=0 }` (flows are CROSS-subsystem; F0's
self-causation is intra-subsystem). **Noninterference:** perturbing state **outside the
`{Entity, CausalInbox}` view** (other `Engine` counters, other partitions) must not change its output.

**6.5.7 F0 fixture entities, fields, and transitions** (resolves all prior ambiguities). Two canonical
entities — the `Engine` record **is** a canonical entity and **counts** in `entity_count`:
`(Entity=1, id=0)` and `(Engine=9, id=0)` → `entity_count=2`, sorted `(1,0) < (9,0)`. `F0FixturePayload {
drawn:u64, value:f64, label:String }` with **`value = drawn as f64`** (Rust `as`, round-to-nearest, always
finite — exercises the f64 canonical path in the **event** stream) and `label="f0"`; the **state** cell
`Entity(0).value:u64 = drawn` (exact counter). At `state_schema_version=3` the Entity(0) record encodes
**all nine** §6.5.3 Entity fields every `StateTick`, §11.2 order (the s3 `Cognitive.tracks` fill is a
registry declaration only — F0 emits no `Cognitive` entity, so this record and the whole F0 state stream
are byte-unchanged from s2), with the non-`value` fields **pinned** to the
fixture fill: `alive = true` (`u8` 1); `pos`/`vel`/`setpoint` = **empty** VecF64 (`u32 0` count);
`heading_rad`/`speed_mps`/`turn_rate_radps`/`fuel` = `+0.0` — a 53-byte record (8+1+4+4+8+8+8+8+4).
Only `value` varies (the keystone cell); any other fill has no valid producer at this version.
Transitions over `step_limit=2`:
`State[0]` (initial) — `Entity(0).value=0`; `Engine.next_seq=0`, `next_id_1=1` (Entity id 0 pre-allocated),
`next_id_9=1` (Engine singleton id 0), other `next_id=0`, `termination_phase=RUNNING(0)`, the three
`Collection`s empty (`u32 0`), `retained_handles=[]`. Step `t∈{0,1}`: `drawn_t = sample(key, tick=t,
elem=0)` (6.5.8); emit one `F0_FIXTURE` event `seq=t, tick=t, causation_id=(t==0 ? None : Some(0))`,
payload as above; then `State[t+1].Entity(0).value=drawn_t`, `Engine.next_seq=t+1`, `retained_handles=[t]`
(the engine retains the just-emitted handle so step `t+1` derives `causation_id=Some(0)` from a token it
**actually consumed** — delivered via the `CausalInbox` capability (6.5.6), not hidden `Engine` state, §2.5). After step 1: `termination_phase=TERMINATED(1)`,
`termination_reason=STEP_LIMIT(2)`. Result: `tick_count=2`, `event_count=2`, **3** `StateTick` frames.

**6.5.8 Fixture RNG ids:** `key = derive(CTX_RNG)( fixed_le( seed=Inputs.seed, subsystem_id=1,
entity_id=0, purpose_slot_id=1 ) )` (`purpose_slot_id=1 = FIXTURE_DRAW`); `sample(key, tick, elem) =
u64::from_le_bytes( keyed_hash(key, fixed_le(tick, elem))[0..8] )`, `elem=0` (one draw per tick). The KAT
instance fixes `Inputs.seed=42`; the robustness sweep varies it over `42..=51`. **Non-vacuity:** the key
folds `seed`, and conformance asserts distinct seeds yield distinct `drawn` sequences and distinct
`result_id` (the sweep is not vacuous).

**6.5.9 Synthetic KAT identity inputs** (breaks the build-state circular dependency). The golden artifact
must not move when engine/verifier dependencies change, so the F0 KAT pins **synthetic** identity inputs:
`toolchain_id = "SYNTHETIC-F0"`, `cargo_lock_hash = blake3(fixed_le(0u32))` — **not** read from the live
repo. *Separately*, a `live-capture` conformance test asserts the producer reads the **real** root
`Cargo.lock` + toolchain into `Inputs`, but it does **not** assert the golden `result_id` (it validates the
capture mechanism, not the frozen vector).

**6.5.10 Complete canonical `Inputs` (F0):** `event_schema_version=9, state_schema_version=4, determinism_class=1 (D1),
schema_registry_hash=(6.5.2), state_registry_hash=(6.5.3), capability_matrix_hash=(6.5.6),
toolchain_id="SYNTHETIC-F0", cargo_lock_hash=blake3(fixed_le(0u32)), scenario_id="f0-fixture",
scenario_hash=blake3(fixed_le(0u32)), seed=42, config=(6.5.4), resources=(6.5.5)`. `case_id =
derive(CTX_INPUTS)(fixed_le(Inputs))`. The KAT pins `case_id`, `event_hash`, `state_trajectory_hash`,
`result_id` — all functions of these frozen inputs only.

**6.5.11 Manifest, bundle layout, golden scope.** A finalized bundle is one directory named `<attempt_id>`
(32-hex) holding **exactly two** lowercase-ASCII files: `bundle.det` and `manifest.json`. `bundle.det` =
`FileHeader` (§0) ++ frames in **on-disk order** — `StateTick(0)`, then for each tick `t∈0..tick_count`:
`[ Event frames of tick t in seq order ++ StateTick(t+1) ]`, then `Trailer` (one frame file, never
several). The verifier separates the Event stream (seq order) from the StateTick stream (tick order) to
fold per §3.3. `manifest.json` (the §4 `RunManifest`) is written **last**: UTF-8, **no BOM**;
`deny_unknown_fields`; **duplicate object keys rejected**; `u64`/`i64` decimal strings; `[u8;32]` 64-hex
lowercase; enums `u16`; `<= MAX_MANIFEST_BYTES`. **Golden comparison scope:** `bundle.det` (full bytes) +
`manifest.inputs` + `manifest.outputs` + `provenance.case_id` are **exact**; `provenance.{build_id,
attempt_id, created_at, commit, dirty}` are **variable** (validated for shape/type only, never
byte-compared). The manifest is **never** folded into `result_id`. **F0 `outputs` (deterministic,
pinned):** `event_hash, state_trajectory_hash, result_id (hex64), event_count=2, tick_count=2,
sim_time_start_us=0, sim_time_end_us=2000, run_complete=true, termination_reason=STEP_LIMIT(2)`, reserved digests `null`. **Hash descriptors:** each output hash records
`{ algo:"blake3-256", encoding:"fixed-le/v1" }`. **Reserved-digest keys** (JSON `null` at F0):
`event_stream_digest, state_checkpoint_stream_digest, evidence_bundle_digest`. **Provenance formats:**
`case_id`/`build_id` = 64-hex lowercase; `attempt_id` = 32-hex; `commit` = 40-hex lowercase or `"UNKNOWN"`;
`dirty` = JSON bool; `created_at` = RFC-3339 UTC (`YYYY-MM-DDThh:mm:ssZ`).

**6.5.12 Hard verifier ceilings** (verifier-local, compiled-in, **independent of the bundle**). **Byte
ceilings:** `MAX_BUNDLE_BYTES=1<<30`, `MAX_FILE_COUNT=2`, `MAX_MANIFEST_BYTES=1<<16`,
`MAX_PAYLOAD_BYTES=1<<20`, `MAX_STATE_TICK_BYTES=1<<20`, `MAX_FRAME_BYTES=(1<<20)+9` (payload + frame
overhead, so it never equals the payload ceiling). **Count/length ceilings** (bound the cardinalities
§6.5.13 stage 6 enforces, so each referenced budget has a defined ceiling to subordinate to):
`MAX_ENTITIES=1<<20`, `MAX_EVENTS=1<<32`, `MAX_TICKS=1<<32`, `MAX_STRING_LEN=1<<16`,
`MAX_COLLECTION_LEN=1<<20`. **Subordination rule:** after the manifest is parsed (6.5.13 stage 3), every
budget in the bundle `config` must be `<=` the corresponding ceiling, else
`DecodeError::BudgetExceedsCeiling`. Every size check runs **before** the allocation it bounds. **Producer
duality:** a conforming producer subordinates `config` to these same ceilings at capture (§5.1) **and**
checks every emitted Event/StateTick/frame size, payload string length, and state cardinality against the
bundle's own `config` before folding/writing (`RunError::ResourceBudget{which}`) — so a tight-but-valid
`config` can never yield a bundle the verifier must reject.

**6.5.13 File-set + malformed-input error precedence** (total order; first applicable wins → the reported
error is deterministic). Budgets live in the manifest, so the manifest is parsed **before** budget
subordination: (1) **file-set** — exactly `{ bundle.det, manifest.json }` (lowercase ASCII; a case-variant
on a case-insensitive FS is still wrong): missing → `MissingFile`, extra/unknown → `UnexpectedFile`; both entries must be **regular files** —
symlinks, directories, and reparse points/junctions are rejected as `UnexpectedFile`. (2)
**file-size ceiling** (pre-read): `len(manifest.json) <= MAX_MANIFEST_BYTES` → else `OversizeManifest`;
`len(bundle.det) <=` the verifier's **frozen F0 bundle ceiling** → else `OversizeBundle`. That ceiling is
`header + (max_events + max_ticks + 2) × max_frame_bytes` computed from the **FROZEN** F0 `config` (exactly
`24 + 82×65545 = 5,374,714` bytes, itself `<= MAX_BUNDLE_BYTES`) — verifier-local and compiled-in, **not** the bundle's claimed budgets,
so a hostile manifest cannot inflate the read. Being a stage-2 pre-read check, an oversize `bundle.det` is
`OversizeBundle` here, **before** the stage-6 frame checks (so e.g. appending frames past this ceiling is
`OversizeBundle`, not `FrameAfterTrailer`). (3) **manifest parse** (bounded by stage 2):
`DuplicateKey`, unknown field, type/format. (4) **budget subordination** — each `config` budget `<=`
ceiling (6.5.12) → else `BudgetExceedsCeiling`. (5) **`FileHeader`** — `BadMagic`, bad `format_version`/
schema versions (`BadVersion`), `BadHeaderCrc`. (6) **`Frame`** in stream order. Because every size check
runs **before** the allocation it bounds (§6.5.12), `TruncatedFrame` **operationally splits** around the
pre-allocation bound: **(6a) header-truncation** `TruncatedFrame` (fewer than the 5 bytes for
`tag`+`payload_len`) → **(6b)** `OversizePayload` (`payload_len > config.max_payload_bytes`, the
pre-allocation bound, checked on the DECLARED length; for a `StateTick` also `> config.max_state_tick_bytes`
→ `OversizeStateTick`) → **(6c) payload/CRC-truncation** `TruncatedFrame` (fewer than `payload_len + 4`
remaining bytes) → `BadCrc` → `UnknownFrameTag` → the **structural position checks** (peeked from the
leading fixed-offset field, **before** any payload field-decode), which are **disjoint** and pinned in this
order: **`FrameAfterTrailer`** (any frame after the `Trailer` — the `Trailer` must be last) **then**
**`FrameOrderViolation`** (a PRE-`Trailer` §6.5.11 interleaving violation — the first frame is not
`StateTick(0)`, a `StateTick`'s `tick_index` is not the next in sequence, or an `Event`'s tick is not the
currently-open one) → the **payload field-decode** errors `InvalidEnumTag`/`InvalidOptionTag`/`InvalidUtf8`/
`InvalidFloat`/`MalformedPayload` and `LimitExceeded{which}` for
`max_entities/max_events/max_ticks/max_string_len/max_collection_len` (each count limit checked **before**
the corresponding allocation). Two consequences of this exact order: a frame whose declared `payload_len` is
oversized but whose body is absent is `OversizePayload` (6b), **not** the payload-truncation `TruncatedFrame`
(6c); and a misordered frame is `FrameOrderViolation` (or `FrameAfterTrailer` if post-`Trailer`) rather than
any field-decode error its payload would also trigger.
**`max_frame_bytes = max_payload_bytes + 9`** is the storage budget — bounding `payload_len` bounds the
frame, so there is **no separate `OversizeFrame`** error. (7) **canonical/semantic** — `event_count`/`tick_count` mismatch, `event_hash`/
`state_trajectory_hash`/`result_id` mismatch, an inductive-invariant (§6) or §2.6-predicate violation.
Within a stage: earliest byte offset / stream order wins.

**6.5.14 Publication protocol** (the single protocol — supersedes §4's "rename or marker"). The producer
creates the staging directory `.partial-<attempt_id>` with **`mkdir`** (atomic; fails if it exists) **on
the same filesystem** as the final location → writes `bundle.det`, flushes → writes `manifest.json` (last),
flushes → **publishes via the §6.5.15 platform rename primitive** (no-replace; on Linux it additionally
fsyncs the staging and parent directories — there is **no** portable Windows directory-fsync).
Directory-publication **atomicity is a tested platform assumption** (verified by the §6
crash-at-each-publication-phase test), not a documented OS guarantee on either platform. A `.partial-` directory is **never** parsed; recovery =
ignore/reap it. A branch-1 bundle is **PUBLISHED** when it is a finalized `<attempt_id>` directory whose
`bundle.det` decodes + re-hashes and whose manifest has `run_complete=true`. **"Citable"** is a stronger,
**branch-2** predicate (PUBLISHED **∧** `dirty=false` **∧** valid evidence metadata, §4) — branch-1 output
is never called "citable".

**6.5.15 Cross-platform fs semantics** (frozen as a **tested assumption**, not an OS guarantee; **no
`unsafe` FFI** — every call is a safe std / `rustix` wrapper, preserving `#![forbid(unsafe_code)]`).
Same-filesystem staging is **required** (publish is a rename, never a copy); the final `<attempt_id>` must
**not** pre-exist — **no-replace** on collision (a duplicate `attempt_id` is a typed error, never a
clobber). **Both OSes:** create the staging dir; write `bundle.det` then `manifest.json`; **`File::sync_all`
on each file before the rename** — durability comes from these file syncs, not from any write-through
rename flag. **Linux:** additionally `fsync` the staging + parent directories; publish with
`rustix::fs::renameat(.., RenameFlags::NOREPLACE)` (a safe wrapper over `renameat2`; fails if the target
exists; atomic within a filesystem). **Windows:** publish with **`std::fs::rename`**, which fails if the
target exists (no-replace by default) and maps to the OS atomic same-volume directory move; NTFS metadata
journaling persists the rename (no portable directory-fsync, and **`MOVEFILE_WRITE_THROUGH` is not
required** — the bytes are already synced). Microsoft documents the directory move but **not** atomic
*directory publication*, so atomicity is **asserted by the §6 crash-at-each-publication-phase test**. This
is the **single** protocol (two-file bundle); a platform that fails the test is **unsupported** for
canonical runs — there is **no** marker-based fallback. Any partially-written/`.partial-` state is treated
as absent (6.5.14).

---

## 7. Conformance
§0 constants + the §3.6 byte layout. **Golden KAT — independently verified** (a separate-language reference
encoder, never self-generated), in **two tiers**: **(a) primitive vectors** — boundary ints; UTF-8 + empty;
both `Option` arms; enum tag; `-0.0`; rejected NaN/±inf; `causation_id` `Some`/`None`; one `FileHeader` and
one of each `Event`/`StateTick`/`Trailer` frame (incl. crc32c); **(b) one COMPLETE F0 bundle** — the full
**2 events + 3 `StateTick` frames + `Trailer`** (the §6.5 fixture) with its `case_id`, `event_hash`,
`state_trajectory_hash`, and `result_id`, plus the committed malformed vectors (§6.5.13). **The committed
bytes + `result_id` are the freeze artifact.** Conformance: re-serialize→re-digest; encode/decode round-trip; binding invariant;
`--release` NaN/inf-reject; shuffle-map-seed → identical `result_id`; **digest round-trip sufficiency**
(serialize only digested fields, rebuild a fresh `World`, step one tick, assert byte-identical next tick).
CI lints: deny `HashMap`/`HashSet` + the closed-world syscall surface outside `ResourceResolver`. Decoder
fuzzing is a separate harness. Threat model: the digest protects event semantics + causal links +
termination + the full state trajectory, not file authenticity/replay.

---

## 8. Observability framework + E0–C2a matrix
**Frozen rule:** every experiment invariant must be recomputable from its bundle; discrete facts →
`event_hash` kinds (incl. `20..=24`); continuous env/cognitive/engine state → the state digest; nothing
invariant-bearing is telemetry-only. *(Matrix unchanged from rev 5 — E0 GeometryQueryResolved; F1 per-tick
kinematics+setpoints; F2a EligibilityEvaluated±; F3a Track{mean,P,ν,S}+Cognitive; F4 Message{snr,jam}+
Environment; F5 DecisionMade incl. non-engage+Cognitive; F6a AuthorizationDecided; F6b munition entity +
DamageApplied; C1 full chain + B-never-eligible via its authorized-view isolation; C2a per-agent CBBA z/y
as Cognitive + AllocationStateUpdated.)* Per-experiment payload **fields** are 3b.

---

## 9. Decision ledger & 3b/F0 obligations
D-005…D-009. **3b/F0 reservations:** independent certifier (producer ≠ verifier; EvidenceBundle records
verifier/oracle build-ids, contract version, run ids, verdict digest — the engine never certifies its own
output); anti-cherry-picking statistics (predeclared seeds/α/correction/bounds; every attempted run in the
ledger; no rerun-until-pass); exact resource-budget values; expanded digest-sufficiency property tests
(creation/deletion/tombstone, timers, ID-counter discontinuities, A→B→A) + decoder fuzz; EvidenceBundle +
`evidence_bundle_digest`; multi-cause `supporting_event_ids` payload; self-describing bundle;
role/state-projection versioning; decoder compat vectors + split unknown-kind; A2/A3 sidecars;
telemetry/BundleSink/compression/index; dynamic closed-world enforcement harness.
**Rev-6/7 formal-pass systems:** a precommitted **`CampaignPlan`** (contract/variants/controls/exact-seeds/
tests/thresholds/retry-policy; immutable `plan_id` before any attempt) + an **append-only `AttemptLedger`**
(an `AttemptRecord` written *before* each launch; crashes/freezes/failed-seeds become tombstones the reaper
preserves before deleting bytes — else GC biases evidence); **activation/vacuity coverage** (every
implication declares required antecedent counts/branches/witnessed transitions; invariant-truth and
activation-coverage reported separately); the **explicit verifier pipeline** (bounded decode → hash/count
→ structure → coupling → capability/noninterference → analytical contract → coverage → EvidenceBundle; a
producer-supplied verdict is never evidence); the **fault taxonomy** (modeled fault = citable event ·
contract failure = citable negative evidence · engine/instrumentation failure = failed attempt · infra
failure = retry-by-policy · debug `FROZEN` never substitutes for the full canonical run); the
**information-flow matrix** (the capability matrix declares permitted *flows* — Truth→Sensor→Track→Belief→
Decision→Intent, **no direct Truth→Policy** — and IDs/gaps/seq/timing must not become covert channels);
the **domain-semantics registry** (SI units, NED/ENU/ECEF frame, handedness, angle/quaternion convention,
covariance ordering, timestamp meaning, tie-break — bound into schema identity); a **protocol-conformance
corpus** (independent enc/dec, golden valid+malformed vectors, decoder fuzz, sink-independence,
model-checked publication+tick); **long-term reproducibility** (content-address scenario/schemas/
capability-matrix/contract/campaign + producer & verifier binaries + toolchain/container + FP-environment).

**Open: none.** Free to move only until the independently-verified golden KAT is committed and F0 runs
green — then Spec 3a **freezes**.
