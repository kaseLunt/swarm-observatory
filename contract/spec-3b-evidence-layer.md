# Spec 3b — Typed Payload/State Layouts · Domain-Semantics Registry · Evidence Layer (CampaignPlan · AttemptLedger · EvidenceBundle · Independent Certifier)

> **Status: FROZEN (rev 4).** The full [[SPEC-003b]]: the evidence substrate (§2–§9, built by
> [[SPEC-003b-EVIDENCE]] + the R2 ROBUST machinery) PLUS the payload/state layout grammars (§11), the
> domain-semantics registry (§12), the riders (§2.3 · §11.3 · §11.4), and the corridor/reproducibility
> dispositions (§13/§14). **Extends** the FROZEN [Spec 3a](spec-3a-event-schema.md) (rev 8): same
> `fixed-le/v1` encoding, same BLAKE3 `derive_key` domain separation, same framing/CRC + publication
> discipline (§6.5.13/.14/.15). The freeze trigger (substrate green + conformance-gated) is MET — ROBUST
> is earned + REQUIRED (`exp-f0-robust`, ubuntu+windows) — and §15 pins the F0 evidence KAT as the
> freeze artifact, mirroring Spec 3a §7. **What freezes:** every byte contract in §0–§9 incl.
> §5.2.1–.4, the §11/§12 vNEXT grammars, the ID partitions, and the extension rules. Per-experiment
> ADOPTIONS (layout values) land through the frozen §11.0 version-bump mechanism without amending this
> text.
>
> **Rev 4 (2026-07-02): full-3b closure + FREEZE.** Adds §5.2.1–.4 (`GateReport`/`GateWitness` byte
> contracts, the whole-report rule, same-build adoption as a [[D-012]] freshness invariant), §2.3 (the
> `stat_test` extension point), §10–§14 (scope dispositions · payload/state vNEXT grammars + riders ·
> domain-semantics registry + permitted flows · conformance corridor · reproducibility disposition +
> reserved-slot retirement), §15 (freeze appendix). Fixes residual staleness: the three-profile model
> (§2.1/§8), the §5.2 heading (witnessed vs live bits), the §6 taxonomy/ceilings (incl. REMOVING the
> never-implemented `LedgerDigestMismatch` and finalizing the as-built ceilings), §9 as-built
> mechanisms + gate tiers.
>
> **Rev 3 (2026-07-01): §5.2/§7 reconciled with the LANDED R2b ROBUST mechanism** ([[EXP-F0-R2-PLAN]] §10
> was the amendment of record until this edit). The certifier drives the dedicated **`robust-gate-runner`**
> binary — **not** `conformance-tests` — self-verifies the bit0/1/2 witnesses, and computes `gates_passed`
> in its own code; ROBUST is EARNED + REQUIRED-gated (`exp-f0-robust`, ubuntu+windows, main at 22 contexts).
> Offline verify ADOPTS the attestation from `bundle.json`'s `conformance` object (present iff
> `verdict_level = 2`) under the stage-7 `verdict_digest` proof (§7).
>
> **Rev 2 hardened against a 7-reviewer adversarial design review** (6 internal lenses + an external audit):
> resolved the tombstone disposal-channel hole, the unsatisfiable CORRECT floor, the `attempt_seq` conflation,
> the non-reproducible KAT, the trusted `ConformanceAttestation`, the `contract_version` §4.4 divergence,
> `plan.det`/`verdict.det` framing, and ~20 byte-layout pins. **Two decisions taken** (user-confirmed):
> the citable F0 campaign has a **zero disposal channel** (`max_infra_retries=0`), and the certifier
> **re-derives** the ROBUST gates rather than trusting an attestation.
>
> **Thesis.** Spec 3a proves a run is internally reproducible and observation-faithful, but a green spine is
> **non-citable** ([[D-002]]: evidence is never retroactive). This layer makes a verdict **citable**: the
> methodology is **precommitted** (`plan_id` before any attempt), every attempt is **append-only logged**,
> the artifact is **independently re-derived** (producer ≠ certifier), and the result is **content-addressed**
> (`evidence_bundle_digest`, the slot Spec 3a §1.1 reserved). **Scope honesty (§1.6):** the offline certifier
> proves *structural / internal-consistency* integrity; *temporal* precommit and *cross-campaign* disclosure
> are proven by **construction + conformance gates** here and deferred for cryptographic proof (§10).
> **Now in scope (rev 4):** the payload/state layout grammars (§11) and the domain-semantics registry
> (§12) are DEFINED here; per-experiment adopted values, covert-channel enforcement, decoder fuzz, and
> reproducibility sidecars remain deferred with owners (§10).

---

## 0. Frozen constants, contexts, magics, enums

Reuses every Spec 3a §0 constant (`HASH_ALGO=blake3-256`, `ENCODING=fixed-le/v1`, the CRC32C framing, the
identities `case_id`/`build_id`/`attempt_id`/`result_id`). Adds:

| Constant | Value |
|----------|-------|
| `plan_schema_version` / `ledger_schema_version` / `verdict_schema_version` / `bundle_schema_version` / `record_schema_version` | all `1` |
| `CTX_PLAN` | `campaign-plan/v1` → `plan_id` |
| `CTX_LEDGER` | `attempt-ledger/v1` → `ledger_digest` |
| `CTX_BUNDLE` | `evidence-bundle/v1` → **`evidence_bundle_digest`** (fills the Spec 3a §1.1 reserved slot) |
| `CTX_VERDICT` | `evidence-verdict/v1` → `verdict_digest` |
| `PlanMagic` / `LedgerMagic` / `VerdictMagic` | `b"DETPLAN1"` / `b"DETLEDG1"` / `b"DETVRDT1"` (8-byte, brand-free) |
| `bundle_content_digest`, `content_digest`, `oracle_digest`, `contract_version` | `blake3` **regular** mode (content-address; not a domain-separated identity) |
| `LedgerFrameTag:u8` | `Record=1` (hashed domain tag for a ledger frame; matches Spec 3a `FrameTag` being u8) |

**All new multi-value enums are `u16` tags** (Spec 3a §3.2/§3.6); an unknown tag → `InvalidEvidenceEnumTag{field}`:

| Enum (`u16`) | Values |
|------|--------|
| `variant_axis_field` | `SEED=1` (the only F0 axis; widened per-experiment via the §11.0 adoption mechanism) |
| `stat_test_id` | `D1_BYTEMATCH=1` |
| `fault_class` | `EngineFailure=1, ContractRejection=2, InfraFailure=3, Watchdog=4` (the §3 tombstone taxonomy) |
| `verdict_level` | `NONE=0, CORRECT=1, ROBUST=2` (cumulative — `ROBUST` ⊃ `CORRECT`) |
| `AttemptBody` tag | `Opened=1, Closed=2` |
| `AttemptOutcome` tag | `Completed=1, Tombstone=2` |
| `d2_status` | `NotClaimed=0, Gated=1, Demonstrated=2` |

**Conformance-gate bitset** (`gates_passed:u32`, folded into `verdict_digest`): `bit0=COUPLING_COMPILE_FAIL,
bit1=COUPLING_RESOLVER_DESYNC, bit2=CAPABILITY_NONINTERFERENCE, bit3=OFFLINE_REVERIFY, bit4=CRASH_AT_PUBLICATION`;
`REQUIRED_GATES_MASK = 0x0000_001F`; **reserved bits 5..31 MUST be 0** (else `InvalidEvidenceEnumTag{gates_passed}`).
"Full" means `gates_passed == REQUIRED_GATES_MASK`.

All four `CTX_*` are distinct from each other and from Spec 3a's six — a digest under one context can never
collide with the same bytes under another, so the evidence wrapper can never be mistaken for, or folded into,
a canonical run identity (P1).

---

## 1. Principles (normative)

**P1 — Reserved, never circular.** `evidence_bundle_digest` is **outside `result_id`** (Spec 3a §1.1). Run
identity is computed before and independently of the evidence wrapper; evidence binds runs, runs never bind
evidence.

**P2 — Precommit (`plan_id` before any attempt).** A **single** `CampaignPlan` (§2) fixes the contract, the
variant/seed set, the attempts-per-variant, the statistical test, the thresholds, and the (zero) retry
policy. `plan_id = derive(CTX_PLAN)` over its `fixed_le` encoding; any edit yields a different `plan_id`. The
first ledger record commits `plan_id`; the certifier rejects a ledger whose `plan_id` does not recompute from
the persisted plan bytes (`PlanIdMismatch`), and **re-derives `contract_version` from the immutable contract
file** (§2.2) so the plan cannot precommit against a fabricated contract.

**P3 — Append-only ledger.** Every attempt is `Opened` in the ledger **before** the producer is launched and
`Closed` after — crashes/rejections `Close` as **tombstones** (auditable, §3.3) the reaper preserves before
deleting `.partial-` bytes. The certifier enforces an **upper bound** tied to the precommitted retry policy
(§3.4): with the F0 `max_infra_retries=0` (§8) **every** attempt must complete and agree — there is no
disposal channel, so a divergent run cannot be parked.

**P4 — Producer ≠ certifier; nothing on the hashed path is trusted.** The `Verdict` (§5) is emitted by a
**separate binary** (`evidence-certify`, own `build_id` recorded) depending on neither `engine` nor
`f0-producer` (CI-asserted DAG, §9). It **reconstructs every digest preimage from the spec** ([[INS-006]]):
recomputes `case_id` from `Inputs(seed)`, **re-folds** each run bundle via `bundle-verify` to re-derive
`result_id` (never reads the manifest's claimed hash — [[INS-007]], and the re-fold checks *physical* frame
structure), **drives `robust-gate-runner`** and computes `gates_passed` itself from self-verified witnesses + live gate
results (rev 3, §5.2 — never `conformance-tests`, never the runner's own conclusions), recomputes
`contract_version`/`oracle_digest`/`plan_id`/`ledger_digest`/`evidence_bundle_digest`. **No field on a hashed
path may be read from the artifact** — §5/§6 enumerate each Verdict field's independent source.

**P5 — Activation before truth ([[INS-008]]).** A passing invariant over zero activations is vacuous. The
certifier reports invariant-truth and activation-coverage **separately** (§5.3); per-attempt and aggregate
floors (§2) must be met, else the verdict is `NONE`.

### 1.6 Scope honesty (what is, and is NOT, proven offline)
The offline certifier proves **structural / internal-consistency** integrity from the final bytes. It does
**not** prove, and this layer does **not** claim:
- **Temporal precommit** — that `plan.det` physically predated the runs. A non-trusted producer could, after
  seeing results, rewrite a self-consistent plan+ledger. *Proven instead by:* `f0-campaign` construction (the
  ledger append is the only gate to launch) **plus** a §9 conformance gate asserting
  producer-launch-count == ledger `Opened`-count. Cryptographic temporal proof (a signed/notarized
  attestation) is **deferred beyond this freeze** (§10).
- **Cross-campaign disclosure** — that no sibling campaign at the same `plan_id` was discarded (run 10×, cite
  the one CORRECT). Tamper-evidence holds **within a single certified campaign**; cross-campaign disclosure
  needs the **campaign registry**, deferred beyond this freeze (§10).

These limits are stated wherever the relevant guarantee is asserted; the layer never equates structural
integrity with temporal/disclosure proof.

---

## 2. `CampaignPlan` + `plan_id`

**One** precommitted plan per campaign. On disk `plan.det = FileHeader{ magic=PlanMagic, format_version:u32=1,
plan_schema_version:u32, reserved:u32=0, header_crc32c:u32 } ++ Frame{ tag:u8=1, payload_len:u32 LE,
payload=fixed_le(CampaignPlan), crc32c:u32 LE }`. `derive(CTX_PLAN)` folds **only** the Frame payload (the
`fixed_le` struct), never the header/len/CRC (Spec 3a's storage-framing-not-hashed rule). Trailing bytes after
the single frame → `TrailingBytes`.

```
CampaignPlan = fixed_le(
  plan_schema_version : u32,
  contract_id         : utf8,        // "EXP-F0-CONTRACT"
  contract_version    : [u8;32],     // §2.2 §4.4-framed hash of the immutable contract file
  determinism_class   : u16,         // D1=1
  expected_termination: u16,         // STEP_LIMIT=2 for F0 (§6 rejects any Completed whose trailer differs)
  base_inputs         : Inputs,      // the FULL canonical Spec 3a Inputs (§6.5.10) at the axis SENTINEL
  variant_axis        : VariantAxis, // the swept field + the ascending, distinct value set
  attempts_per_variant: u32,         // fresh-OS-process repeats per variant (>=2)
  stat_test           : StatTest,
  retry_policy        : RetryPolicy,
  coverage_floors     : CoverageFloors
)
VariantAxis    = fixed_le( field:u16(=SEED), values:{ u32 count ++ [u64; count] } )  // STRICTLY ASCENDING, DISTINCT
StatTest       = fixed_le( test_id:u16(=D1_BYTEMATCH), require_nonvacuous:bool, require_fresh_process:bool )
RetryPolicy    = fixed_le( max_infra_retries:u32, classify_watchdog_as_tombstone:bool )
CoverageFloors = fixed_le( min_events_per_attempt:u64, min_ticks_per_attempt:u64,
                           min_keystone_activations:u64 )   // distinct-result non-vacuity is RELATIONAL (§2.1)
```
`plan_id = derive(CTX_PLAN)( fixed_le(CampaignPlan) )`. **Precommit sanity (certifier, §6 stage 2):**
`variant_axis.values` strictly ascending + distinct (else `PlanAxisValuesNotCanonical`); `base_inputs.<axis
field>` == the axis SENTINEL (`SEED` sentinel = 0; else `PlanAxisSentinelViolation`); `attempts_per_variant >=
2`. Each swept value `v` defines `Inputs(v)=base_inputs{seed=v}` and `intended_case_id(v)=
derive(CTX_INPUTS)(fixed_le(Inputs(v)))` — so the plan binds the *entire* input identity per seed.

### 2.1 Statistical test (`D1_BYTEMATCH`) — per-profile plans, two derived verdicts
The canonical F0 campaigns are **per-profile plans** (§8: `kat` | `citable-f0` | `robust-f0`, with
**distinct `plan_id`s by construction** — widening a pinned plan would break its pins, [[INS-018]]);
**CORRECT is earned by the `citable-f0` campaign (seed 42), ROBUST by the `robust-f0` campaign over the
pinned sweep `42..=51`** — §5.1 derives each level from its own campaign's bundle (the `robust-f0`
seed-42 variant satisfies the CORRECT predicate *within that campaign*). For each variant `v`: launch
`attempts_per_variant` **fresh-process** producer runs at `seed=v`; the variant **passes** iff every attempt's
re-derived `result_id` is **byte-identical** (D1) **and** the §3.4 completion+budget rule holds.
**Non-vacuity is relational** (`require_nonvacuous`): across variants, `distinct(result_id) == variant_count`
(every swept value yields a distinct `result_id` — Spec 3a §6.5.8, now certified). A single-variant projection
(CORRECT) trivially satisfies relational non-vacuity; the 10-seed sweep needs 10 distinct results. **There is
no absolute `min_distinct_results`** — that conflated a relational property with a count and made CORRECT
unsatisfiable (review P0).

### 2.2 `contract_version` (exact Spec 3a §4.4 framing — re-derived, not trusted)
`contract_version = blake3( u32 path_len ++ "roadmap/work/EXP-F0-contract.md" (UTF-8, repo-relative POSIX) ++
u32 content_len ++ raw committed bytes )` — the §4.4 single-file framing (**no** LF normalization;
empty/missing fails closed). The EXP-F0 contract file **is** the canonical immutable subset by construction
(hypothesis/controls/seeds/thresholds/acceptance), so hashing its committed bytes via §4.4 IS the contract
version. The certifier (§6 stage 2) **recomputes this from the repo-pinned contract file** and asserts
`== plan.contract_version == Verdict.contract_version` (else `ContractVersionMismatch`); the pinned contract
input is named in the Verdict so the binding is explicit.

### 2.3 `stat_test` extension point (append-only verdict kinds — `D1_BYTEMATCH=1` frozen forever)
`StatTest` is an **append-only tagged union**: the `test_id:u16` tag SELECTS a **kind-local** fixed-le
params block that follows it inline in the `CampaignPlan` (the same tag-selects-schema pattern as
`EventKind` payloads). `D1_BYTEMATCH=1`'s params block is frozen forever as exactly
`( require_nonvacuous:bool ++ require_fresh_process:bool )` — its bytes never change. Rules:
- A **new** verdict kind is APPENDED behind a new `u16` tag with its own params block; tags are never
  renumbered, reused, or retired-then-reassigned (§11.4). A kind whose params must change is a NEW tag.
- Params are **kind-local fixed-le structs** folded into `plan_id` at the `StatTest` position — the
  methodology (α, N, dof policy, sidedness, acceptance interval) is precommitted by construction,
  before any attempt.
- **Statistical kinds MUST precommit their critical values as pinned numbers** (quantiles computed at
  plan-authoring time): the certifier's trusted path does exact comparisons over sufficient statistics
  it recomputes from the bundle (§11.3) and contains **no distribution functions, ever** (kills
  runner-vs-certifier float-library divergence). Enforcement lands with the first statistical kind: the
  certifier's dependency-DAG gate extends to reject statistics/special-function crates, and the kind's
  conformance suite carries an oracle-precomputed exact-comparison vector — until then a review
  obligation, recorded in §13.2. The kind taxonomy itself (`CHI2_NEES`, `CHI2_NIS`,
  `BINOMIAL_EXACT`, `KS_TWO_SAMPLE`, …) is [[PRE-P1-DOCTRINE]] / F3a content — this spec pins only the
  format rule.
- An unknown `test_id` → the typed stage-2 reject `UnsupportedStatTest{test_id}` (as built — decode
  reads the tag bare; fail-closed: a certifier never certifies a test it does not implement; under the
  vNEXT tagged-union grammar an unknown tag also leaves its params block undecodable, so the reject
  keeps this name and stage). `plan_schema_version` stays `1` — appending tags changes no existing
  plan's bytes.
- **Dual-claim semantics:** statistical acceptance composes ON TOP of D1 byte-identity (same seed →
  same bytes still holds, still checked); it never replaces `verdict_level`'s meaning.

---

## 3. `AttemptLedger` + `AttemptRecord` (append-only, auditable)

On disk `ledger.det = FileHeader{ magic=LedgerMagic, format_version:u32=1, ledger_schema_version:u32,
reserved:u32=0, header_crc32c:u32 } ++ Frame{ tag:u8=Record, payload_len:u32 LE, payload=fixed_le(AttemptRecord),
crc32c:u32 LE }*` — Spec 3a `bundle.det` framing/CRC discipline (CRC over `tag ++ payload_len ++ payload`,
storage-only). A record is appended and **fsync'd before** the producer it describes is launched (P3, §7
durability).

### 3.1 Record identity (the `record_seq` / `attempt_index` split — review P0)
```
AttemptRecord = fixed_le(
  record_schema_version : u32,
  plan_id               : [u8;32],     // binds every record to the precommit
  record_seq            : u64,         // DENSE append position, origin 0 +1 (file order)
  attempt_index         : u64,         // STABLE attempt identity; pairs an Opened with its Closed
  body                  : AttemptBody  // u16 tag + body
)
AttemptBody ∈ {
  Opened = 1 ( variant_index:u32, seed:u64, intended_case_id:[u8;32] ),  // written BEFORE launch
  Closed = 2 ( outcome:AttemptOutcome )                                  // written AFTER the producer returns
}
```
**Pairing (certifier §6 stage 3).** `record_seq` is dense from 0 (file order). `attempt_index` is dense from 0
over the set of `Opened`s. Each `attempt_index` has **exactly one `Opened`** and **at most one `Closed`**, the
`Closed` after its `Opened` in file order. An `Opened` with no `Closed` is an **in-flight tombstone** (the
campaign died mid-attempt) and counts toward the §3.4 budget exactly like a `Tombstone`.

### 3.2 Variant binding (certifier §6 stage 3)
For every `Opened`: `variant_index < variant_axis.count`; `seed == variant_axis.values[variant_index]`;
`intended_case_id == derive(CTX_INPUTS)(fixed_le(Inputs(values[variant_index])))` — else
`VariantBindingMismatch{attempt_index}`. Stops attempts being attributed to the wrong variant.

### 3.3 Auditable outcome (review P0 — the tombstone is no longer a trusted excuse)
```
AttemptOutcome ∈ {
  Completed = 1 ( attempt_id:[u8;16], case_id:[u8;32], result_id:[u8;32], bundle_content_digest:[u8;32] ),
  Tombstone = 2 ( fault_class:u16, detail:utf8, published:bool,
                  attempt_id:[u8;16], content_digest:[u8;32] )   // bundle_content_digest iff published, else 0^32
}
```
**A tombstone of a run that actually published is auditable, not trusted:**
- If `published`, the EvidenceBundle MUST include that attempt's run-bundle dir; the certifier re-folds it,
  recomputes `content_digest`, and:
  - rejects `fault_class ∈ {InfraFailure, Watchdog}` on a bundle whose manifest has `run_complete=true`
    (a clean published run cannot be infra-flake) → `TombstoneContradictsBundle{attempt_index}`;
  - feeds the re-derived `result_id` into the §2.1 agreement check — a divergent published run is
    `VariantDisagreement`, never relabeled out.
- A non-published tombstone carries `attempt_id=0` and **`content_digest = 0^32`**: this slice does **not**
  preserve partial canonical bytes (the `.partial-` reaper salvage + its digest preimage are **deferred
  beyond this freeze**, §10), only the ledger record of the death. A **published**
  tombstone (a finalized dir that is *not* a clean Completed — e.g. a contract rejection) carries the real
  `attempt_id` and `content_digest = bundle_content_digest` over its two files; its bytes are embedded in
  `attempts/` and re-folded in §6 stage 4. **A tombstone binds to `evidence_bundle_digest` through
  `ledger_digest`** (its whole record is folded), not through the §4 per-attempt tuple.

`bundle_content_digest = blake3( fixed_le(u32 len_det) ++ bundle.det ++ fixed_le(u32 len_manifest) ++
manifest.json )` over the published run bundle's two files (length-prefixed; binds the full persisted attempt
**incl. provenance** for tamper-evidence — live campaigns thus have run-unique digests by design; the **KAT**
pins synthetic provenance, §8, so the golden is reproducible).

### 3.4 Completion + budget rule (no rerun-until-pass) — certifier §6 stage 5
Per variant: let `C=attempts_completed`, `T=attempts_tombstoned` (incl. in-flight), `N=attempts_per_variant`,
`R=max_infra_retries`. The variant **passes** iff: every Completed (and every published Tombstone) re-derived
`result_id` is byte-identical (D1); **every** tombstone is `InfraFailure` (or `Watchdog` iff
`classify_watchdog_as_tombstone`) — **any `EngineFailure`/`ContractRejection` fails the variant**
(`CanonicalFaultInVariant{variant}`); `T <= R`; `C >= N - R`; and `attempts_total <= N + R`
(`AttemptsExceedRetryBudget{variant}`). **F0 sets `R=0`** (§8): every attempt must complete and agree; the
disposal channel is closed. (The certifier cannot witness *un*-recorded launches — that gap is closed by
construction + the §9 launch-count gate, §1.6.)

### 3.5 Ledger digest + crash-tail rule
`ledger_digest = derive(CTX_LEDGER)( fixed_le(record_count:u64) ++ for each record in file order:
(LedgerFrameTag::Record:u8 ++ AttemptRecord_canonical_bytes) )`. **Crash tail:** exactly ONE trailing frame
that fails the length/CRC check at EOF is a pre-fsync crash tail — truncated to the last CRC-valid frame
before folding (`record_count`/`ledger_digest` over the valid prefix); any **non-trailing** CRC/length
failure, or **>1** torn frame, is a hard `LedgerNotAppendOnly`. Sound because every `Opened` is fsync'd before
its producer launches, so the producer described by a torn (unacknowledged) frame never ran.

---

## 4. `EvidenceBundle` + `evidence_bundle_digest`

On disk: a directory **named `<evidence_bundle_digest>`** (64-hex lowercase; known at publish time, since
publication is post-certification), published via the §7 protocol. Top-level contents (typed allowlist, §6
stage 1): exactly the **four regular files** `{plan.det, ledger.det, verdict.det, bundle.json}` **plus exactly
one directory `attempts/`**. `attempts/` holds `0..=MAX_ATTEMPTS` subdirectories, each named `<attempt_id>`
(32-hex), each itself a regular-files-only **two-file Spec 3a run bundle** validated by the Spec 3a §6.5.13
pipeline. Any other top-level entry, any symlink/reparse/junction anywhere in the tree, or an `attempts/<id>`
not referenced by a Completed-or-published-Tombstone record → `BundleFileSetInvalid` / `AttemptDirSetInvalid`.
**Assemble BY the ledger, never by scanning** ([[INS-012]]): the assembler populates `attempts/` ONLY from
the ledger's embeddable records (`Completed`, or a **published** tombstone with a defined `content_digest`) --
a non-published tombstone embeds nothing, and a malformed/partial publication the driver **quarantined** out
of the campaign working dir (§7) is never copied in. The ledger is the authority on what happened; a
directory scan would trust crash/quarantine debris on the filesystem instead.

```
evidence_bundle_digest = derive(CTX_BUNDLE)( fixed_le(
  bundle_schema_version : u32,
  plan_id               : [u8;32],   // = recompute(plan.det)
  ledger_digest         : [u8;32],   // = recompute(ledger.det) — folds the FULL history incl. tombstones
  verdict_digest        : [u8;32],   // = recompute(verdict.det)
  attempt_count         : u64,       // total Opened
  completed_count       : u64,       // attempts with a clean run_complete=true bundle
  for each COMPLETED attempt in attempt_index order:
      ( attempt_index:u64, attempt_id:[u8;16], case_id:[u8;32], result_id:[u8;32], bundle_content_digest:[u8;32] )
) )
```
Binds the precommit, the complete attempt history (incl. tombstones, via `ledger_digest`), the conclusion, and
every **completed** run's identity + byte content (tombstones — incl. any published bytes — are bound through
`ledger_digest`). `bundle.json` (§7) is the human/derived view; the certifier
rejects any JSON value disagreeing with its recomputation.

---

## 5. `Verdict` + `verdict_digest` (every hashed field independently sourced)

On disk `verdict.det = FileHeader{ magic=VerdictMagic, … } ++ Frame{ tag=1, …, payload=fixed_le(Verdict), … }`
(same framing rule as plan.det; `derive(CTX_VERDICT)` folds only the payload).

```
Verdict = fixed_le(
  verdict_schema_version : u32,
  plan_id                : [u8;32],
  ledger_digest          : [u8;32],
  contract_id            : utf8, contract_version:[u8;32],
  certifier_build_id     : [u8;32],   // the running evidence-certify exe's OWN measured digest
  oracle_digest          : [u8;32],   // §5.4
  determinism_class      : u16,
  variant_count          : u32,
  for each variant in axis order: VariantVerdict {
     variant_index:u32, seed:u64, expected_case_id:[u8;32],
     canonical_result_id:[u8;32],         // the agreed re-derived result_id (0^32 iff no agreement)
     attempts_total:u32, attempts_completed:u32, attempts_tombstoned:u32,
     agreement:bool, nonvacuous:bool      // §5.3 defines nonvacuous
  },
  coverage               : ActivationCoverage,   // §5.3
  conformance            : ConformanceAttestation,// §5.2 (re-derived; zero-value when verdict_level < ROBUST)
  verdict_level          : u16                    // §5.1
)
verdict_digest = derive(CTX_VERDICT)( fixed_le(Verdict) )
```
**Independent source of every hashed field** (P4; §6 stage 7 builds the preimage entirely from these, reading
**no** hashed field from `verdict.det`): per-variant fields ← stage-4 re-derivation; `certifier_build_id` ←
the running exe's measured digest; `oracle_digest` ← §5.4; `contract_version` ← §2.2 re-derivation;
`conformance` ← §5.2 re-derivation. Stage 7 then asserts the recomputed `verdict_digest == recompute(verdict.det)`.

### 5.1 Verdict derivation (matches [[EXP-F0-CONTRACT]])
- **CORRECT** iff the `seed=42` `VariantVerdict` has `agreement ∧ nonvacuous`, its completion+budget rule
  (§3.4) holds with `require_fresh_process`, the keystone predicate held on every attempt (re-checked offline,
  Spec 3a §2.6), every Completed attempt's re-folded trailer `termination_reason == plan.expected_termination`
  (`UnexpectedTermination` else — so a `FROZEN` completion can never substitute), and `coverage` floors (§5.3)
  are met.
- **ROBUST** iff CORRECT **and** every variant over `42..=51` passes (relational non-vacuity ⇒ 10 distinct
  results) **and** the **re-derived** `ConformanceAttestation` (§5.2) is full **and** `d2_status ∈ {Gated,
  Demonstrated}`.
- Otherwise **NONE**. `verdict_level` cumulative.

### 5.2 `ConformanceAttestation` — re-derived, not trusted (bits 3/4 certifier-driven live; bits 0/1/2 CI-witnessed, certifier-verified)
```
ConformanceAttestation = fixed_le(
  producer_build_id:[u8;32], verifier_build_id:[u8;32], certifier_build_id:[u8;32],
  gates_passed:u32,                 // §0 bit table; REQUIRED_GATES_MASK=0x1F; reserved bits 0
  d2_status:u16,                    // NotClaimed/Gated/Demonstrated
  d2_a_result_id:[u8;32], d2_b_result_id:[u8;32],  // a byte-identical pair iff Demonstrated; else 0^32
  gating_note_hash:[u8;32],         // blake3(regular), §4.4 single-file framing of the pinning-work doc iff Gated; else 0^32
  toolchain_id:utf8
)
```
For **ROBUST** (rev 3 — the LANDED R2b mechanism, [[EXP-F0-R2-PLAN]] DECISION 2), `evidence-certify` drives
the dedicated **`robust-gate-runner`** binary as a subprocess (an explicit `CS_GATE_RUNNER_BIN` path, no
fallback) and trusts none of its conclusions: it decodes the runner's fixed-le gate report, re-validates the
whole-report shape + identity + all four `build_id`s against the build under test, **reads and re-verifies
every bit0/1/2 witness preimage itself** (recomputing the git-tracked source hash bound to `source_commit` —
never the report's claim), and **computes `gates_passed` in its own code** — the bitset is re-derived, not
read from the bundle or the runner. Bits 3/4 (`OFFLINE_REVERIFY`, `CRASH_AT_PUBLICATION`) are live subprocess
drives; bits 0/1/2 are witnessed from their canonical engine / engine-api-tests gates (a compile-fail cannot
be re-run at certify time). **Cross-machine D2 cannot be re-derived in one process**, so `d2_status` is recorded
(`Demonstrated` requires a byte-identical second-machine `result_id` pair carried in the bundle; otherwise
`Gated` with the pinning-work note hash — [[D-014]]: F0 ships `Gated`). **Offline `verify` cannot re-drive the
runner**, so a published ROBUST bundle's attestation is ADOPTED from `bundle.json`'s `conformance` object
(present iff `verdict_level = 2`) after the strict §5.2.4 adoption validation, and then PROVEN equal to `verdict.det`'s
attestation by the stage-7 `verdict_digest` fold — a manifest that lies about any field diverges the digest.
**For `verdict_level < ROBUST`** the whole struct MUST be the
**zero value** (`build_id`s = 0^32, `gates_passed=0`, `d2_status=NotClaimed`, hashes 0^32, `toolchain_id=""`)
so `verdict_digest` is deterministic at every level — and a below-ROBUST `bundle.json` MUST carry no
`conformance` object at all. **ROBUST is only earnable in the CI context that emits the witnesses** — a
local run earns bits 3/4 but never 0/1/2. §5.2.1–§5.2.4 pin the report/witness byte contracts, the
whole-report rule, and the offline adoption rule normatively.

#### 5.2.1 `GateReport` byte contract (fixed-le/v1) — normative
The runner's report is **bare fixed-le**: NO magic, NO header, NO CRC — `report_schema_version:u16` is
the first wire field. (Deliberate: the report is a **transient, never-published** artifact the certifier
consumes from its own scratch dir and re-validates field-by-field (§5.2.3); integrity comes from that
validation, not container framing — unlike the durable `.det` files.) Primitives are Spec 3a §3.6: ints
LE; `bool` = u8∈{0,1}; `utf8` = u32 byte-len ++ bytes; `[u8;32]` raw, no length prefix.

```
GateReport = fixed_le(
  report_schema_version : u16 = 1,        // FIRST field; unknown → reject before any other read
  identity {
    source_commit   : utf8,               // 40-lowercase-hex (enforced at emission + §5.2.3 equality)
    dirty           : bool,               // MUST be 0 (emitter hard-codes false; §5.2.3 rejects true)
    cargo_lock_hash : [u8;32],
    toolchain_id    : utf8,
  },
  build_ids { producer:[u8;32], verifier:[u8;32], certifier:[u8;32], fault_certifier:[u8;32] },
  records : [ GateRecord ; 5 ]            // EXACTLY five, gate_id 0..=4 positional in file order
)
GateRecord = fixed_le( gate_id:u16, source:u16 (LiveRun=1 | Witnessed=2),
                       result:u16 (Fail=0 | Pass=1 | NotRun=2), witness_rel:utf8 )
```

Decode order (first failure wins): unknown `report_schema_version` → `UnknownSchema` **before any other
field**; per-record `gate_id != position` → `BadTag` (non-ascending, duplicate, and out-of-range all
collapse into the positional check); out-of-domain `source`/`result` tag → `BadTag`; any byte after the
fifth record → `TrailingBytes`. Decode errors: `Short, BadBool, BadUtf8, UnknownSchema, BadTag,
TrailingBytes`. The certifier bounds the file **pre-read**: `MAX_REPORT_BYTES = 1<<20` (else
`RobustGateRunner`). **Runner contract:** `robust-gate-runner --emit-gate-report` requires env
`RGR_PRODUCER_BIN`, `RGR_VERIFY_BIN`, `RGR_FAULT_CERTIFIER_BIN`, `RGR_WITNESS_DIR` (explicit paths, no
fallback) PLUS the required flags — `--report-out`, `--source-commit` (40-lowercase-hex;
`dirty`/`UNKNOWN` rejected), `--cargo-lock-hash` (64-hex), `--toolchain-id` (nonempty),
`--certifier-build-id` (64-hex), `--work`, `--contract` — each exactly once (any missing / malformed /
duplicate / unknown flag = exit 2), and writes exactly the encoded bytes to `--report-out`; it
publishes nothing, mints no mask,
and never READS a witness (it only LOCATES `bit<N>.witness`; absent → `witness_rel=""`). It emits gates
0..=2 as `Witnessed/NotRun`, gates 3 (`OFFLINE_REVERIFY`) and 4 (`CRASH_AT_PUBLICATION`) as `LiveRun`
with the observed result — a FAILING gate is `result=Fail` inside a successfully written report (exit
0); exit 1 = drive error; exit 2 = usage (fail-closed). The codec/validator is implemented twice —
runner and certifier — as a **deliberate verbatim port** ([[D-010]] independence: do not DRY across the
trust boundary); byte-semantics equality across the two copies is a review obligation on every edit.

#### 5.2.2 `GateWitness` byte contract + `source_hash` framing — normative
Each witnessed bit (0/1/2) is proven by a witness file the witness-emitting CI jobs (the R2a smoke job
and the `exp-f0-robust` gate) emit **only after re-running that canonical gate to a pass** (emission is
sequenced after the test inside the same fail-fast job step). On disk the file IS the raw fixed-le
preimage (no stored digest); `witness_digest =
blake3(regular)` over the file bytes, recomputed by every consumer from the bytes it read.

```
GateWitness = fixed_le(
  gate_id          : u16,         // 0|1|2 is the witnessed domain — NOT decode-enforced (any u16
                                  // decodes; enforced at emission + by verify_witness's UnknownGate
                                  // keyed on the CALLER's gate)
  source_commit    : utf8,        // 40-lowercase-hex; == build under test
  dirty            : bool,        // MUST be 0
  cargo_lock_hash  : [u8;32],     // == build under test
  toolchain_id     : utf8,        // == build under test
  job_id           : u16,         // EngineApiTrybuild=0 | EngineResolverDesync=1 | EngineNoninterference=2
  command_target   : utf8,        // the EXACT pinned literal for job_id (table below)
  source_hash      : [u8;32],     // git-tracked-source hash (framing below)
  expected_outcome : u16,         // CompileFail=0 | FactualInconsistency=1 | ViewInvariant=2
  observed_outcome : u16          // MUST == expected_outcome
)
```

Witness files are named exactly `bit<gate_id>.witness` inside the witness dir (runner env
`RGR_WITNESS_DIR`; certifier flag `--witness-dir`, re-exported to the runner subprocess).

**Pinned per-gate literals (the normative appendix):**

| bit | job_id | `command_target` (exact literal) | expected_outcome | FILESET pathspecs |
|-----|--------|----------------------------------|------------------|-------------------|
| 0 | `EngineApiTrybuild=0` | `engine-api-tests::sealed_api::out_of_crate_code_cannot_bypass_the_sealed_engine_api` | `CompileFail=0` | `v2/engine-api-tests` ∪ `v2/engine` |
| 1 | `EngineResolverDesync=1` | `engine::run::tests::desync_rejects_and_commits_nothing_for_the_failed_tick` | `FactualInconsistency=1` | `v2/engine` |
| 2 | `EngineNoninterference=2` | `engine::run::tests::outside_view_perturbation_does_not_change_the_subsystem_output` | `ViewInvariant=2` | `v2/engine` |

**`source_hash`** `= blake3( for each git-tracked path p under the FILESET pathspecs at commit
source_commit, sorted byte-lexicographically by repo-relative POSIX path: u32 path_len ++ p (UTF-8) ++
u32 content_len ++ raw committed blob bytes )` — **no LF normalization**. The FILESET is enumerated from
the **commit tree** (`git ls-tree -r --name-only <source_commit> -- <pathspecs>`, blobs via
`git show <source_commit>:<path>`), never the index or worktree — so `source_hash` and `source_commit`
are two claims about ONE commit. An **empty FILESET fails closed** (a mis-scoped pathspec can never
produce a valid-looking witness). Verifiers recompute the expected `source_hash` at the **build under
test's** commit — never trusting the witness's claim.

**`verify_witness` check order (contract):** decode failure or digest mismatch → `Tampered`; unknown
caller gate → `UnknownGate`; then field checks in order `WrongGate, Dirty, StaleCommit, StaleLock,
StaleToolchain, OutcomeMismatch, WrongJob, WrongCommandTarget, WrongSourceHash`. A missing witness file
is simply an unearned bit (the `Missing` reject name is reserved). Every witness rejection is
FAIL-CLOSED: the bit stays 0 — never an error, never a substitute proof (§5.2.3).

**As-built limits (recorded; hardening candidates):** the canonical `expected_outcome`-per-`job_id`
mapping is enforced at emission (the emitter derives it from the pinned table) plus the
`observed == expected` / `job_id` / `command_target` equalities at verification — a verifier does not
additionally re-derive `expected_outcome` from `job_id`; and the witness file itself carries no size
ceiling (the report does).

#### 5.2.3 The whole-report rule (`validate_and_compute_mask`) — the check ORDER is contract
No bit computes until the WHOLE report is validated, in this exact order (first failure rejects the
report with a typed `ReportReject`):
1. **Position binding** — for every record `i ∈ 0..=4`: `records[i].gate_id == i`
   (`GateIdPositionMismatch{position, claimed}`). Runs first; hand-assembled reports get no shape trust.
2. **Witnessed shape** (gates 0..=2, ascending): `source==Witnessed ∧ result==NotRun`
   (`BadWitnessedShape{gate_id}`), then `witness_rel` equal to the EXACT literal `bit<gate_id>.witness`
   (`BadWitnessRel{gate_id}`) — the exact-string equality IS the path-traversal defense: `..`, absolute
   paths, and foreign separators all fail before any filesystem join.
3. **Live shape** (gates 3..=4): `source==LiveRun ∧ witness_rel==""` (`BadLiveShape{gate_id}`).
4. **Identity** — `source_commit`/`cargo_lock_hash`/`toolchain_id` equal the build under test ∧
   `dirty==false` (`IdentityMismatch`).
5. **Build ids** — all four equal the certifier's own measurements, in the pinned order
   `producer → verifier → certifier → fault_certifier` (`BuildIdMismatch{which}`).
6. Only then **the mask**: a LiveRun bit is set iff `result==Pass`; a Witnessed bit iff the witness file
   reads, the FILESET recomputes at the build-under-test's commit, and §5.2.2's `verify_witness` passes —
   EVERY witness failure silently leaves the bit 0 (fail-closed). The certifier then requires
   `mask == REQUIRED_GATES_MASK (0x1F)`, else `RobustMaskIncomplete{gates_passed}` — a partial mask is
   never a partial verdict.

The certifier's copy and the runner's copy of this rule are verbatim ports of one another ([[D-010]]);
the **certifier's** is authoritative for ROBUST.

#### 5.2.4 Offline adoption + the same-build rule (a [[D-012]] freshness invariant)
Offline `verify` cannot re-drive the runner (§5.2), so a published ROBUST bundle's attestation is
ADOPTED from `bundle.json`'s `conformance` object and then PROVEN by the stage-7 `verdict_digest` fold.
Normative adoption rule (each failure → `RobustAdoptionInvalid` carrying a static reason string —
a tuple payload, not a named field — in this exact order):
1. every digest field decodes as strict 64-lowercase-hex (fires before all shape checks);
2. `gates_passed == 0x1F`;
3. `d2_status ∈ {Gated, Demonstrated}` with the exact [[D-014]] shape — `Gated`: both `d2_*_result_id`
   zero ∧ `gating_note_hash` nonzero; `Demonstrated`: a nonzero, byte-identical `d2` pair;
4. `producer_build_id`/`verifier_build_id` nonzero;
5. **the same-build rule: the adopted `certifier_build_id` MUST equal the VERIFYING certifier's own
   measured `build_id`.** This is [[D-012]] derived-continuous citation as a byte rule: a ROBUST
   attestation is a property of the build that earned it — a future certifier build cannot green-verify
   an archived ROBUST bundle; **re-earning is the mechanism, not archival re-verification** (evidence is
   never retroactive, [[D-002]]);
6. `toolchain_id` nonempty.

Presence is two-sided: `conformance` present iff `verdict_level==2` (either violation →
`BundleJsonDisagrees{conformance}`); unknown keys rejected.
On BOTH paths the campaign's own re-derivation must already be CORRECT, else `RobustNotCorrect` — ROBUST
can never resurrect a non-CORRECT campaign. A below-ROBUST verify rebuilds with the zero attestation, so
a `verdict.det` or `bundle.json` forged to claim gates lands on `VerdictDigestMismatch` (the
`forged_gates_passed` gate). **Fault-certifier identity is a CI build-time discipline, never
runtime-provable:** the certifier equality-checks the report's `fault_certifier_build_id` against its
own measurement of the fault binary it was handed, but "same source at the same commit/lock/toolchain,
differing only by the `fault-injection` feature" rests on CI building both from one checkout (isolated
target dir) — two opaque exe hashes cannot prove it at verify time. Recorded as a CI build-job
obligation (the `exp-f0-robust` job's adjacent build steps; §9's independence bullet), not a §6
pipeline check.

### 5.3 `ActivationCoverage` + per-variant `nonvacuous` (anti-vacuity, P5)
```
ActivationCoverage = fixed_le(
  min_events_over_attempts:u64, min_ticks_over_attempts:u64,   // PER-ATTEMPT minima (not sums)
  keystone_activations:u64, distinct_results:u32,             // aggregate
  floors_met:bool
)
```
`floors_met = (min_events_over_attempts >= min_events_per_attempt) ∧ (min_ticks_over_attempts >=
min_ticks_per_attempt) ∧ (keystone_activations >= min_keystone_activations) ∧ (distinct_results ==
variant_count)`. The certifier recomputes the per-attempt minima from the re-decoded streams (stage 6) — a
single vacuous attempt cannot hide behind an aggregate sum. **`VariantVerdict.nonvacuous`** (per-variant) :=
`canonical_result_id != 0^32 ∧ keystone activations on the variant >= min_keystone_activations ∧
min events over the variant's attempts >= min_events_per_attempt`.

### 5.4 `oracle_digest` (defined preimage; recomputed)
`oracle_digest = blake3( the certifier's bundled reference-encoder golden file set, serialized via the §4.4
framing: sorted repo-relative POSIX paths, per file u32 path_len ++ path ++ u32 content_len ++ bytes )`. The
certifier recomputes it from its own bundled oracle and asserts it equals the KAT oracle digest
(`OracleDigestMismatch`); it is never read from `verdict.det`.

### 5.5 `require_fresh_process` (trusted by construction; gated)
The contract's "D1 across fresh OS processes" applies to **CORRECT and ROBUST**. Process identity is, by
closed-world determinism, *not* in the bundle, so the certifier cannot verify it from bytes; it is
**trusted-by-construction** in `f0-campaign` (each attempt is a fresh `f0-producer` subprocess) and **proven**
by the Spec 3a fresh-process `A‖A'` conformance gate (bound for ROBUST; a required Spec 3a spine gate,
inventoried in §13.1 — not an §9 evidence-harness gate). The
spec does not overclaim that the certifier independently proves freshness.

---

## 6. Certifier pipeline + ceilings + total error order

`evidence-certify` runs a **bounded, total-ordered** pipeline (first failing stage/offset wins → deterministic
error). **Verifier-local ceilings** (compiled-in, bundle-independent; every size/count check precedes the
allocation it bounds):

| Ceiling | Value |
|---------|-------|
| `MAX_VARIANTS` | `1024` (checked before allocating `VariantAxis.values`) |
| `MAX_ATTEMPTS` | `256` (bounds the `attempts/` enumeration — short-circuits on the first surplus entry, `BundleFileSetInvalid`; the working-dir certify path bounds attempts via `MAX_LEDGER_RECORDS`) |
| `MAX_LEDGER_RECORDS` | `2 × MAX_ATTEMPTS = 512` |
| `MAX_PLAN_BYTES` / `MAX_VERDICT_BYTES` / `MAX_LEDGER_BYTES` | `1<<16` / `1<<18` / `header + MAX_LEDGER_RECORDS × (frame_overhead + 1<<12)` |
| `MAX_BUNDLE_JSON_BYTES` | `1<<20` (the §7 `bundle.json`, pre-read → `OversizeManifest`; each **embedded attempt's** `manifest.json` is separately capped at Spec 3a's `MAX_MANIFEST_BYTES = 1<<16` — same variant — then re-enforced by the stage-4 re-fold) |
| `MAX_REPORT_BYTES` | `1<<20` (the §5.2.1 gate report — pre-read, certifier-side) |
| total-bundle bound (derived — **no aggregate constant or check exists**) | each file is capped individually; the implied bound is `MAX_PLAN_BYTES + MAX_LEDGER_BYTES + MAX_VERDICT_BYTES + MAX_BUNDLE_JSON_BYTES + MAX_ATTEMPTS × (MAX_ATTEMPT_BUNDLE_BYTES(=5,374,714 — the Spec 3a frozen F0 bundle ceiling) + MAX_MANIFEST_BYTES)` |

Per embedded run bundle, the Spec 3a §6.5.12 ceilings apply to its own two files. *(Values FINALIZED at
freeze (§15) to the as-built constants.)*

**Pipeline (each stage, then `Within a stage: lowest record_seq / attempt_index / variant_index, then earliest
byte offset, wins`):**
1. **file-set** — the typed §4 allowlist (4 files + `attempts/`), recursive symlink/reparse rejection,
   the `MAX_ATTEMPTS` bound enforced during a short-circuited enumeration (`BundleFileSetInvalid` on the
   first surplus entry). Per-file ceilings are checked **pre-read at the stage that consumes each file**
   (plan: 2, ledger: 3, attempt files: 4, `bundle.json`: pre-7, verdict: 7) — every size check still
   precedes the allocation it bounds.
2. **decode + plan precommit** — decode `plan.det` (magic/header-CRC/frame/trailing-bytes); recompute
   `plan_id`; §2 sanity (ascending-distinct values, axis sentinel, `attempts_per_variant>=2`); **re-derive
   `contract_version` from the contract file** (§2.2).
3. **ledger integrity** — decode `ledger.det` (crash-tail rule §3.5); recompute `ledger_digest`; per
   record in file order: dense `record_seq`, then `plan_id == stage-2` (`RecordPlanIdMismatch{record_seq}`),
   then the body checks — dense `attempt_index`, the §3.1 pairing rule, the §3.2 variant binding.
4. **per-attempt re-verification** — for each embedded attempt in `attempt_index` order, in the fixed
   as-built order: recompute `intended_case_id` and match **`case_id`**; match
   **`bundle_content_digest`** (both pre-re-fold); **citability** — manifest `dirty==false`
   (`DirtyAttempt{attempt_index}`) and one producer `build_id`/`toolchain_id`/`cargo_lock_hash` identity
   accumulated across attempts (`MixedProducerBuild`); re-decode + re-fold the run bundle via
   `bundle-verify` (`Reverify{attempt_index, detail}` on a subprocess reject) and match **`result_id`**
   (needs the re-fold, hence last of the tuple); re-check the trailer `termination_reason ==
   plan.expected_termination`. The **published-Tombstone** re-fold + §3.3 contradiction rules
   (`TombstoneContradictsBundle{attempt_index}`) are RESERVED — deferred to the first
   `max_infra_retries>0` profile; as built (`R=0`) any tombstone fails the stage-5 budget, and an
   `attempts/<id>` directory not referenced by a Completed record fails the [[INS-012]] file-set check
   (`AttemptDirSetInvalid{name}`), never embedded or re-folded.
5. **completion + budget + agreement** (§3.4) per variant (lowest `variant_index` wins).
6. **coverage** (§5.3) — recompute per-attempt minima + aggregates from the re-decoded streams; floors met.
7. **verdict** — build the Verdict preimage from independent sources (§5); for ROBUST at publish, **drive
   `robust-gate-runner`** + self-verify witnesses + compute `gates_passed` in the certifier (rev 3, §5.2); at
   offline verify, ADOPT the attestation from `bundle.json` under the §5.2.4 adoption validation — then derive
   `verdict_level` (§5.1) and recompute `verdict_digest == recompute(verdict.det)`.
8. **bundle digest** — recompute `evidence_bundle_digest`; assert `== bundle.json` value **and ==** the
   published directory basename.

**Typed errors — the as-built `CertifyError` surface** (brace payloads name the real Rust fields;
parenthesized payloads are unnamed tuple strings; decode-layer errors precede semantic ones, per file):
- **decode layer** — `Decode(DecodeError)` with the evidence-crate set `BadMagic, BadHeaderCrc,
  UnsupportedFormat{got}, UnsupportedSchema{got}, NonZeroReserved, BadCrc, TruncatedFrame,
  UnknownFrameTag, InvalidEvidenceEnumTag{field}, InvalidUtf8, TrailingBytes, LedgerNotAppendOnly,
  TooManyRecords` (the `MAX_LEDGER_RECORDS` decode-layer ceiling); `BadInputs(Truncated |
  NonCanonicalLength)` for the embedded base-`Inputs` blob; `Io(detail)` — fs failures AND the strict
  `bundle.json` parse (duplicate keys / unknown fields surface here; the typed `DuplicateKey` belongs
  to Spec 3a's `bundle-verify` manifest layer, not this one).
- **file-set + size** — `BundleFileSetInvalid{detail}, AttemptDirSetInvalid{name}, OversizePlan,
  OversizeLedger, OversizeVerdict, OversizeManifest` (the `bundle.json` ceiling AND each embedded
  manifest — one shared variant), `OversizeAttemptBundle`. There is no whole-bundle aggregate check
  (§6 table).
- **stage-2 plan/profile** — `NonCanonicalPlan, PlanAxisValuesNotCanonical, PlanAxisSentinelViolation,
  PlanUnknownAxis, PlanAttemptsTooFew, TooManyVariants, UnsupportedStatTest{test_id},
  UnsupportedDeterminismClass{class}, NonVacuityNotRequired, FreshProcessNotRequired,
  PlanNotF0Profile{field}, ContractVersionMismatch`. `plan_id` is DERIVED at stage 2, never compared —
  there is no `PlanIdMismatch`; a stale ledger binding is the per-record
  `RecordPlanIdMismatch{record_seq}`, and a lying `bundle.json` is `BundleJsonDisagrees{plan_id}`.
- **stage-3 ledger** — `RecordPlanIdMismatch{record_seq}, AttemptPairingViolation{attempt_index},
  VariantBindingMismatch{attempt_index}` — and deliberately **no** independent `LedgerDigestMismatch`:
  `ledger_digest` is *derived* (recomputed then folded), so re-sealed ledger bytes surface as the
  stage-3 violations and/or stage-7 `VerdictDigestMismatch` (the rebuilt verdict binds the recomputed
  `ledger_digest`) / stage-8 `EvidenceBundleDigestMismatch` — never as a free-standing digest compare.
- **stage-4 per-attempt** — `CaseIdMismatch{attempt_index}, BundleContentMismatch{attempt_index},
  DirtyAttempt{attempt_index}, MixedProducerBuild, Reverify{attempt_index, detail}` (the
  `bundle-verify` subprocess reject), `ResultIdMismatch{attempt_index},
  UnexpectedTermination{attempt_index}`, `TombstoneContradictsBundle{attempt_index}` (reserved —
  stage-4 note).
- **stage-5/6** — `VariantDisagreement{variant}, CanonicalFaultInVariant{variant},
  AttemptsExceedRetryBudget{variant}, AttemptsBelowFloor{variant}, VacuousCampaign`.
- **stage-7/8 + manifest agreement** — `VerdictDigestMismatch, EvidenceBundleDigestMismatch` (raised
  for both the directory basename and the `bundle.json` value), `BundleJsonDisagrees{field}` (any
  `bundle.json` value disagreeing with its recomputation, incl. the §5.2.4 `conformance` presence
  rule). A wrong `oracle_digest` has **no dedicated error** — it diverges the rebuilt verdict preimage
  and surfaces as `VerdictDigestMismatch`.
- **§7 publication** — `PublishCollision, StagingCollision`.
- **ROBUST (§5.2.1–.4)** — `RobustGateRunner(detail)` (spawn / non-zero exit / missing / oversize /
  undecodable report), `RobustReport(the stringified §5.2.3 ReportReject)`,
  `RobustMaskIncomplete{gates_passed}`, `RobustAdoptionInvalid(reason)`, `RobustNotCorrect`; the
  `ReportReject` (§5.2.3) and `WitnessReject` (§5.2.2) sub-taxonomies surface stringified inside
  `RobustReport` / as silently-unset mask bits.

---

## 7. Publication + on-disk durability

**EvidenceBundle publication** extends Spec 3a §6.5.14/.15 to the **nested** layout (a new tested assumption,
§9 gate — the flat-bundle crash test does not cover subdirectories):
- Stage the `attempts/<id>/` copies **first** inside `.partial-<evidence_bundle_digest>` (so the certifier's
  stage-4 re-fold runs over the **staged** bytes that get published — certified tree == published tree).
  Run bundles are **copied** (never hardlinked — a later source mutation would corrupt certified bytes) onto
  the **same filesystem** as the final location (publish is a rename).
- `File::sync_all` **every** file (4 top-level + all `attempts/<id>/*`); on **Linux** fsync the directory chain
  bottom-up: each `attempts/<id>/`, then `attempts/`, then the staging root, then the parent — in that order —
  **before** the `renameat(NOREPLACE)`. **Windows:** `sync_all` per file; NTFS journaling persists the rename;
  no portable directory-fsync (the bytes are pre-synced). The final `<evidence_bundle_digest>` must not
  pre-exist (no-replace; a duplicate content-address is a typed collision).

**Incremental `ledger.det` durability** (written live, before the bundle exists): at ledger **creation**,
after writing+fsyncing the header + first frame, **fsync the parent directory once** (Linux) so the file's
existence is durable; every subsequent appended frame is durable via file-`sync_all` alone (the dir entry is
unchanged). **Windows:** `File::sync_all` per appended record; NTFS journaling for the create. **Restart
contract:** the durable unit is the **`attempt_index`** (each `Opened` is a distinct attempt slot), **not** the
`(variant, seed)` — `attempts_per_variant` deliberately re-runs the same seed across fresh processes, each as a
new `attempt_index`. `f0-campaign` **never re-runs an acknowledged (fsync'd) `attempt_index`**; on restart it
only **appends** an in-flight tombstone for any `Opened` lacking a `Closed` — it never erases — so a crash can
never convert a failing attempt into a silent re-run, while the expected per-variant repeats each get a fresh
`attempt_index`. **Quarantine ([[INS-012]]):** a publication that the driver cannot read as a clean
`Completed` (malformed/partial) is recorded as a non-published tombstone AND its leftover directory is moved
out of `attempts/` to a `quarantine/` sibling -- so `attempts/` only ever holds embeddable bundles and the §4
assembler never copies debris.

`bundle.json` (the human/derived manifest, written last): UTF-8 no BOM, `deny_unknown_fields`, duplicate keys
rejected, `u64`/`i64` decimal strings, `[u8;32]` 64-hex, `[u8;16]` 32-hex; records `plan_id`, `ledger_digest`,
`verdict_digest`, `evidence_bundle_digest`, `verdict_level`, the per-attempt identity table, and (rev 3)
a `conformance` object **present iff `verdict_level = 2`** — the nine `ConformanceAttestation` fields
(§5.2), the offline-adoption source proven against `verdict.det` by the stage-7 digest fold; its presence
below ROBUST, absence at ROBUST, or any field disagreement is rejected — all **derived**;
the `.det` files are authoritative and the certifier rejects any JSON disagreement. **Citable** (Spec 3a §4:
PUBLISHED ∧ `dirty=false` ∧ valid evidence metadata) is realized here for **CORRECT and (rev 3) ROBUST**:
the CORRECT citation is pinned in `roadmap/evidence/EXP-F0-citable.json` (the `exp-f0-citable` gate) and the
ROBUST citation — `verdict_level=2`, `gates_passed=0x1F`, `d2_status=Gated`, `gating_note_hash` — in
`roadmap/evidence/EXP-F0-robust.json` (the `exp-f0-robust` gate), both REQUIRED and re-earned every commit
(cross-campaign disclosure remains the §1.6 deferred limit).

---

## 8. The F0 evidence instances (three profiles) + the evidence KAT (frozen)

**Three campaign profiles, distinct `plan_id`s by construction** ([[INS-018]]: widening a pinned plan
would break its pins) — two LIVE evidence records plus one KAT-mechanism record:

| profile | identity | axis × N | earns | record |
|---------|----------|----------|-------|--------|
| `kat` | `SYNTHETIC-F0` (Spec 3a §6.5.9); the **hermetic §15 golden** alone adds synthetic contract/attempt ids — the CI `--profile kat` campaign hashes the LIVE contract + real nonces, so its run-anchored `plan_id` deliberately differs from the §15 pin | `[42]` × 2 | the byte-reproducible MECHANISM proof (CORRECT path, zero attestation) | `roadmap/evidence/EXP-F0-correct.json` (golden-anchored) |
| `citable-f0` | LIVE (`toolchain_id` + root `Cargo.lock`, CR-26) | `[42]` × 2 | the SPEC-CITABLE **CORRECT** (`exp-f0-citable`, ubuntu+windows) | `roadmap/evidence/EXP-F0-citable.json` |
| `robust-f0` | LIVE | `[42..=51]` × 3 | the SPEC-CITABLE **ROBUST** (`exp-f0-robust`: witnesses + runner drive + `0x1F` + `Gated`) | `roadmap/evidence/EXP-F0-robust.json` |

Shared plan constants (every profile): `contract_id="EXP-F0-CONTRACT"`, `contract_version` = §2.2 over
the committed contract file (**synthetic only inside the hermetic §15 KAT artifact** — every CI
campaign, `kat` included, hashes the live contract file), `determinism_class=1`,
`expected_termination=STEP_LIMIT(2)`; `base_inputs` = the Spec 3a §6.5.10 canonical F0 `Inputs` at the
SEED sentinel (`seed=0`) — **live** identity for the live profiles, never the KAT identity;
`stat_test={ D1_BYTEMATCH, require_nonvacuous=true, require_fresh_process=true }`,
`retry_policy={ max_infra_retries=0, classify_watchdog_as_tombstone=true }` (**zero disposal channel**),
`coverage_floors={ min_events_per_attempt=2, min_ticks_per_attempt=2, min_keystone_activations=2 }`.
`variant_axis` values are ascending + distinct per §2; relational non-vacuity ⇒ 10 distinct results over
the `robust-f0` sweep; a single-variant campaign needs 1.

**Evidence KAT (the §15 freeze artifact):** a small **hermetic** EvidenceBundle (a 1-variant, 2-attempt synthetic
campaign) whose every input *and* **provenance** is pinned to constants — `attempt_id`, `build_id`,
`created_at`, `commit` are fixed synthetic values and `dirty=false`, exactly as Spec 3a §6.5.9 pins identity —
and a **synthetic `contract_version`** + **pinned synthetic `bundle_content_digest`** leaves (the real §2.2
contract hash and the two-file content fold — which depend on the committed contract file and the canonical
`manifest.json` serialization — are validated on the live/Rust path), while the F0 `case_id`/`result_id` are
the **real** fold. So `plan_id`, `ledger_digest`, `verdict_digest`, and `evidence_bundle_digest` are **fixed
and byte-reproducible** by the independent Python oracle (`tools/reference-encoder/evidence_encoder.py`).
(Live campaigns have run-unique digests by design; only the KAT must reproduce.)

---

## 9. Conformance gates (`evidence-conformance` → required CI)

No local lib deps; drives `f0-campaign` + `evidence-certify` as subprocesses. Proven and wired **required**
(the CR-27 pattern):
- **precommit immutability** — editing any `CampaignPlan` field changes `plan_id` (structural: the
  fixed-width / length-prefixed encoding is injective, so any field edit moves the digest; spot-proven
  per-field by the oracle's sensitivity checks over `attempts_per_variant` / axis values /
  `max_infra_retries` / `min_keystone_activations` plus the Rust field-sensitivity unit + harness gates);
  a stale-`plan_id` ledger → `RecordPlanIdMismatch` (the per-record binding check, §3.1 — it names the
  offending `record_seq`); a fabricated `contract_version` → `ContractVersionMismatch`.
- **append-only tamper-detection** — an in-place edit / non-trailing torn frame → `LedgerNotAppendOnly`;
  a drop/insert/reorder breaks the stage-3 dense-`record_seq`/pairing rules and, independently, diverges
  the recomputed-and-folded `ledger_digest` → stage-8 `EvidenceBundleDigestMismatch` (§6 — there is no
  free-standing ledger-digest compare); the crash-tail rule (§3.5) truncates exactly one pre-fsync
  trailing frame. *(Gate tiers: the in-place edit is a subprocess gate; the crash-tail rule is
  unit-proven; a CRC-resealed pure reorder is an open corridor item — §13.)*
- **anti-cherry-picking (real attack vectors)** — a published-but-divergent run relabeled `InfraFailure` →
  `TombstoneContradictsBundle`/`VariantDisagreement`; exceeding the budget → `AttemptsExceedRetryBudget`; a
  dropped failing attempt → `AttemptsBelowFloor`; a **refill** (drop the failing attempt, add a fresh passing
  one) is caught by the **launch-count gate**: `evidence-conformance` asserts
  producer-subprocess-launch-count == ledger `Opened`-count (closing the §1.6 temporal gap by construction).
- **certifier independence (DAG)** — the dependency-DAG gate pins each crate's **local-dependency
  closure by cargo-metadata equality** (and `engine`'s direct external deps to exactly `["blake3"]`):
  `evidence-certify` has no path to `engine`/`f0-producer`; the harness (and `robust-gate-runner`) have
  no local lib deps, each additionally proven by an own-workspace packaging gate. **Fault-certifier
  same-source discipline:** CI builds the `fault-injection` certifier from the same checkout into an
  isolated target dir, adjacent to the shipped binaries (§5.2.4 — a build-time obligation, not
  runtime-provable).
- **preimage reconstruction** ([[INS-006]]/[[INS-007]]) — mutate any embedded run bundle → `ResultIdMismatch`/
  `BundleContentMismatch`; a manifest hash that disagrees with the re-fold is ignored (re-derived, not trusted).
- **re-derived conformance** (rev 3) — at publish the certifier drives `robust-gate-runner` + self-verifies
  witnesses + computes `gates_passed` itself (§5.2); at offline verify a below-ROBUST rebuild keeps the zero
  attestation, so a `verdict.det` forged to claim gates lands on `VerdictDigestMismatch` (the
  `forged_gates_passed` conformance gate), and a forged ROBUST `bundle.json` diverges the same digest.
- **anti-vacuity** ([[INS-008]]) — a single 0-event attempt fails the per-attempt floor; `<variant_count`
  distinct results → `VacuousCampaign`. *(Gate tier: `VacuousCampaign`/`VariantDisagreement` are
  certifier UNIT-level proofs behind a re-verification fake — black-box-unreachable for an honest F0
  producer; recorded honestly in §13.)*
- **nested-publication crash** — crash-at-each-publication-phase over the **actual** EvidenceBundle layout
  (≥1 `attempts/` subdir), proving the nested-atomicity assumption rather than inheriting the flat-bundle test.
- **evidence KAT** — the §8 hermetic EvidenceBundle reproduces byte-for-byte (producer + Python oracle).

---

## 10. Scope disposition — what this spec now DEFINES vs what remains deferred
The [[SPEC-003b]] work-order scopes land as follows. **Defined normatively here:** Scope 1 (typed
payload + per-partition state layouts — §11, as versioned vNEXT grammars) · Scope 2 (the
domain-semantics registry, bound into schema identity — §12) · the three riders (ID-space partitioning
§11.4 · verdict-kind extension point §2.3 · sufficient-statistics requirement §11.3) · Scope 3 (the
evidence layer — §2–§9, built + conformance-gated) · Scope 4's corridor inventory + the
compatibility-vector and split unknown-kind rules (§13) · Scope 5's permitted-flow declaration (§12.4)
· Scope 6's disposition incl. the reserved-slot retirement (§14). **Still deferred, explicitly:**
decoder fuzz (§13.3) · covert-channel checks (IDs/gaps/seq/timing, §12.4) · long-term reproducibility
sidecars / container / FP-environment record (§14) · **the signed/notarized attestation channel**
(cryptographic *temporal* precommit) and **the campaign registry** (cross-campaign disclosure) — the
two §1.6 scope limits. Per-experiment layout ADOPTION (values, not grammar) rides with each
experiment's spec via the §11.0 version-bump mechanism.

---

## 11. Typed payload + per-partition state layouts (Scope 1 — the vNEXT grammars; riders a + c)

### 11.0 Versioning + grammar (identity-safe by construction)
**ADOPTED at EXP-F1 (2026-07-02): events v3 / state v2. CURRENT grammar:
`event_schema_version=9` / `state_schema_version=4` — the EXP-F6b bump (2026-07-09) adopted core
kinds 17/18/19 in-place (§11.1 rows 17/18/19; WeaponLaunched/DamageApplied/TargetDestroyed with NONZERO
`predicate_id`s 4/5/6 — the first mutating-outcome kinds adopted with nonzero §2.6 keystone tails;
`solution`/`point:VecF64` bind the §12.3 spatial semantics, ZERO new type-tag/§12 mints) and FILLED the
`Weapon=6` state partition (§11.2 tag-6 baseline verbatim, 7 fields; state s3→s4 — the FIRST state-schema
move since F3a); the EXP-F6a bump (2026-07-08) adopted core
kinds 15/20/21 in-place (§11.1 rows 15/20/21; FireCommand/AuthorizationDecided/FireRejected, all
fields `sem_count=0`, ZERO new type-tag/§12 mints — `granted` reuses the existing `Bool` tag; state s3
unmoved, F6a is D1-only); the EXP-F4 bump (2026-07-07) adopted core
kinds 5/6/7 in-place (§11.1 rows 5/6/7; the first I64 field_desc use + the WATT/MICROSECOND/TIMESTAMP
vocabulary; `Environment` stays deferred, state s3 unmoved); the EXP-F3a bump (2026-07-06) adopted core
kinds 2/3/4 in-place (§11.1 rows 2/3/4) and filled `Cognitive.tracks` (the first recursive `Collection`
sublayout, state s2→s3); the EXP-F2a bump (2026-07-05) adopted core
kinds 1 and 22 in-place (§11.1 rows 1 and 22; kind 22 with the appended `tiebreak_applied` via the
§11.1 MAY-append rider); the EXP-E0 bump (2026-07-03) adopted core kind 23 in-place (§11.1 row 23;
the first §11.1 baseline adoption).** The pre-bump F0 preimages (Spec 3a §6.5.2/§6.5.3 at v2/s1, triple-implemented
engine / bundle-verify / oracle) are retained VERBATIM as the §13.3 compatibility set
(`tools/reference-encoder/golden/compat-v2s1/`, freeze-checked on every oracle verify) — frozen as
HISTORY, no longer the live bytes. The adoption moved every F0 pin exactly as this section designs:
§11 defines the grammars a consuming experiment ADOPTS by bumping the schema version AND landing the
new registry content — the content moves `schema_registry_hash`/`state_registry_hash` (no version
integer sits inside either registry preimage), and both the bumped version integers and the moved
registry hashes fold into the `Inputs` preimage → `case_id` → every pin re-earns ([[D-002]]
auto-invalidation is the mechanism, not a side effect; the EXP-F1 bump was its first live exercise).

- **v3 event grammar (uniform):** every kind entry becomes
  `u16 discriminant ++ utf8 name ++ u32 field_count ++ field_desc*` — the count is ALWAYS present (`0`
  allowed). This removes v2's mixed shape (name-only production entries vs the full `F0_FIXTURE`
  binding); the version bump makes the change unambiguous. `field_desc` is the §12.0
  semantic-carrying form. EVERY v3 kind entry ends with `u32 conversion_id ++ u32 predicate_id`
  immediately after its last `field_desc` (`0,0` = none for non-mutating kinds) — uniform presence
  keeps the blob self-delimiting without the Spec 3a §2.3 kind-category table; the v2 `F0_FIXTURE`
  tail is the position precedent. The leading `u32` kind count keeps counting production kinds only;
  the test-fixture binding stays appended after the counted entries, as at v2.
- **v2 state grammar:** structure unchanged (`u16 partition_count ++ per-partition: u16 tag ++ u32
  field_count ++ field_desc*`, then the two rule ids) with the §11.2 fills and §12.0 `field_desc`.
  Count-prefix widths are as-built and deliberately asymmetric (kind count `u32`, partition count
  `u16`, field counts `u32`, capability/flow counts `u32`) — do not "normalize" them; they are frozen.
- **Adoption rules:** (1) a version bump adopts ALL layouts its experiment needs in ONE batch — every
  registry change is a 3-site implementation (engine + bundle-verify + oracle) + golden regen + pin
  re-precommit ([[INS-018]] cost expectation: budget one re-pin commit per identity change); (2)
  within a version, entries are APPEND-ONLY — never reorder, retype, rename, or renumber an existing
  field or kind; (3) removal = a new version that RETIRES the id permanently (never reused — kind 16's
  retirement is the precedent).
- **DECISION — hand-encoded per-kind; layout-DRIVEN encoding REJECTED.** Producers hand-encode each
  kind's payload; verifiers hand-decode with exact-consumption checks; the oracle mirrors both; the
  golden proves 3-site agreement (the as-built F0 pattern). A generic field_desc-walking encoder is
  rejected for the canonical path: it would put a schema interpreter inside the determinism boundary,
  turn every registry edit into a behavioral change to ALL kinds at once, and trade locally-auditable
  bytes for indirection. The registry DECLARES the layout (and folds it into identity); it never
  DRIVES the encoder.
- **Type-tag vocabulary:** the ten §6.5.0 tags are frozen; this spec APPENDS **`VecF64 = 11`**
  (`u32 count ++ count × f64`, §3.2 float rules per element: NaN/±inf typed-rejected, `-0.0 → +0.0`)
  for estimator/statistics payloads. As-built note: only the oracle declares the full tag table today;
  the Rust sites declare the referenced subset — the normative table is THIS spec's, and a site adds a
  tag's constant when it first references it.

### 11.1 Per-kind payload `field_desc` — the E0–C2a normative baseline
Adopted per-experiment (never all at once); an adopting experiment MAY append fields at its bump but
MUST NOT alter the baseline prefix below. The envelope stays Spec 3a §3.6 (`seq, tick, kind,
causation_id, payload{u32 len ++ bytes}`); `reject_reason`-class data is PAYLOAD, never envelope (Spec
2 bridge). §2.6 binding categories per Spec 3a §2.3; mutating-outcome kinds receive per-kind
`predicate_id`s at adoption.

| kind | baseline fields `(name : type_tag [§12 semantics])` | consumer |
|------|------------------------------------------------------|----------|
| 1 `DetectionMade` | `subject:U64, sensor:U64, meas:VecF64 [UNIT/FRAME at adoption], snr_db:F64 [UNIT=DECIBEL]` — ADOPTED at the EXP-F2a bump (2026-07-05), baseline verbatim, no appends: `meas` bound `(UNIT=METER, FRAME=NED, HANDEDNESS=RIGHT)` (the §12.3 first event-payload spatial vector), `snr_db` bound `(UNIT=DECIBEL)` | F2a (Pd=1 adapter), F3a harness, C1 |
| 2 `TrackConfirmed` | `track:U64, subject:U64, mean:VecF64, cov:VecF64 [COV_ORDER]` — ADOPTED at the EXP-F3a bump (2026-07-06), baseline verbatim, no appends (`cov` binds `COV_ORDER=ROW_MAJOR_FULL`, the §12.3 numeric adoption) | F3a |
| 3 `TrackUpdated` | `track:U64, mean:VecF64, cov:VecF64 [COV_ORDER], innovation:VecF64, innovation_cov:VecF64 [COV_ORDER]` — ADOPTED at the EXP-F3a bump (2026-07-06), baseline verbatim, no appends; the NEES/NIS sufficient statistics {mean, P, ν, S} (§11.3) | F3a |
| 4 `TrackDropped` | `track:U64, reason:U16 (TIMEOUT=1 \| MERGED=2 \| INVALIDATED=3)` — ADOPTED at the EXP-F3a bump (2026-07-06), baseline verbatim, no appends | F3a |
| 5 `MessageSent` | `msg:U64, src:U64, dst:U64, channel:U16, snr_db:F64 [DECIBEL], tx_power_w:F64 [WATT]` — ADOPTED at the EXP-F4 bump (2026-07-07), baseline verbatim, no appends (`snr_db` binds `(UNIT=1, DECIBEL=8)`, `tx_power_w` binds `(UNIT=1, WATT=9)` — the first WATT numeric adoption); channel-entry, distinct from app-level `DesignationSent` | F4, C1 |
| 6 `MessageDelivered` | `msg:U64, src:U64, dst:U64, latency_us:I64 [(UNIT=MICROSECOND), (TIMESTAMP=SIM_TIME_US)] (a delta), snr_db:F64 [DECIBEL]` — ADOPTED at the EXP-F4 bump (2026-07-07): the FIRST I64 `field_desc` use + the FIRST two-pair binding `(UNIT=1, MICROSECOND=6)` then `(TIMESTAMP=7, SIM_TIME_US=2)` sorted ascending by dimension_id (the OWNER-FREEZE first-consumer binding; §12.3) | F4, C1 |
| 7 `MessageDropped` | `msg:U64, reason:U16 (JAMMED=1 \| RANGE=2 \| LOSS=3), snr_db:F64 [DECIBEL], jam_state:U16` — ADOPTED at the EXP-F4 bump (2026-07-07), baseline verbatim (`snr_db` binds `(UNIT=1, DECIBEL=8)`; `reason`/`jam_state` are enum payload values, `sem_count=0`) | F4, C1 negative |
| 8 `BeliefUpdated` | `agent:U64, subject:U64, belief:VecF64, supporting_event_ids:VecU64` — the multi-cause slot (Spec 3a §9 reservation, placed here) | F3a/F5 |
| 9 `DesignationSent` | `designation:U64, subject:U64, from:U64, to:U64, track:U64` | C1 |
| 10 `HandoffAccepted` | `designation:U64, by:U64, subject:U64` | C1 |
| 11 `TaskProposed` | `task:U64, subject:U64, proposer:U64` | C2a |
| 12 `TaskBid` | `task:U64, bidder:U64, bid:F64, round:U64` | C2a |
| 13 `TaskAssigned` | `task:U64, executor:U64, round:U64` | C2a |
| 14 `DecisionMade` | `agent:U64, decision:U16 (ENGAGE=1 \| NON_ENGAGE=2), subject:U64, reject_reason:U16 (0 = none), supporting_event_ids:VecU64` — non-engage is a first-class outcome (F5 negative control) | F5, C1 |
| 15 `FireCommand` | `agent:U64, weapon_kind:U16, subject:U64, designation:U64` — ADOPTED at the EXP-F6a bump (2026-07-08), baseline verbatim, no appends (all fields `sem_count=0` — `weapon_kind` is an opaque tag, not a §12 id); scripted scenario stimulus with a `(conversion_id=0, predicate_id=0)` non-mutating tail | F6a, C1 |
| 17 `WeaponLaunched` | `weapon:U64, shooter:U64, subject:U64, solution:VecF64` — ADOPTED at the EXP-F6b bump (2026-07-09), baseline verbatim, no appends; `solution:VecF64` binds `[(UNIT=METER_PER_SECOND=2), (FRAME=NED=1), (HANDEDNESS=RIGHT=1)]` (§12.3); cat-2 MUTATING with a NONZERO `(conversion_id=0, predicate_id=4)` §2.6 keystone tail | F6b, C1 |
| 18 `DamageApplied` | `weapon:U64, subject:U64, outcome:U16 (INTERCEPT=1 \| MISS=2), point:VecF64 [(UNIT=METER=1), (FRAME=NED=1), (HANDEDNESS=RIGHT=1)]` — ADOPTED at the EXP-F6b bump (2026-07-09), baseline verbatim; `outcome` inline enum `sem_count=0`, intercept/miss explicit; cat-2 MUTATING with a NONZERO `(conversion_id=0, predicate_id=5)` tail | F6b, C1 |
| 19 `TargetDestroyed` | `subject:U64, weapon:U64` — ADOPTED at the EXP-F6b bump (2026-07-09), baseline verbatim, no vectors (both fields `sem_count=0`); cat-2 MUTATING KEYSTONE with a NONZERO `(conversion_id=0, predicate_id=6)` tail | F6b, C1 |
| 20 `AuthorizationDecided` | `request:U64, agent:U64, subject:U64, granted:Bool, roe_state:U16` — ADOPTED at the EXP-F6a bump (2026-07-08), baseline verbatim, no appends (all fields `sem_count=0` — `granted:Bool` reuses `Bool=6`, `roe_state` is an inline enum); F6a's keystone kind, one per request, with a `(conversion_id=0, predicate_id=0)` non-mutating tail | F6a, C1 |
| 21 `FireRejected` | `request:U64, agent:U64, reason:U16` — ADOPTED at the EXP-F6a bump (2026-07-08), baseline verbatim, no appends (all fields `sem_count=0` — `reason` is an inline enum); emitted iff `!granted`, with a `(conversion_id=0, predicate_id=0)` non-mutating tail | F6a |
| 22 `EligibilityEvaluated` | `subject:U64, sensor:U64, in_range:Bool, in_fov:Bool, los_clear:Bool, eligible:Bool` — the ± observation. ADOPTED at the EXP-F2a bump (2026-07-05) with the appended 7th field `tiebreak_applied:Bool [TIEBREAK=DECLARED_PREDICATE]` (the MAY-append rider; D-017 "ties are reported, never silent" for the composition) | F2a |
| 23 `GeometryQueryResolved` | `query_kind:U16 (POINT_IN_REGION=1 \| RANGE_BEARING=2 \| RAY_OCCLUDER=3 \| LOS=4), subject:U64, object:U64, argv:VecF64, result_flag:Bool, result_scalars:VecF64, tiebreak_applied:Bool [TIEBREAK]` | E0 |
| 24 `AllocationStateUpdated` | `agent:U64, round:U64, z:VecU64 (winner per task), y:VecF64 (winning bids)` — the CBBA z/y projection | C2a |

### 11.2 State-partition fills (per-experiment adoption baselines; `Entity` adopted at v2)
The EXP-F1 bump filled **`Entity` (tag 1) ONLY** — the §11.1 rule (adopted per-experiment, never all
at once) applies to state partitions identically. At the ADOPTED v2 registry, partitions **2–8 are
reserved, 0-field** (allocation governed by §11.4); the `Environment` row below is the
NORMATIVE BASELINE that partition adopts when its first consuming experiment lands its own bump
(F4's first DYNAMIC-jam rung — the EXP-F4 static-jam bump DEFERS the `Environment`
fill, contract Q2), not current content; the `Weapon` row was ADOPTED VERBATIM at the EXP-F6b bump
(2026-07-09, state s3→s4 — the FIRST state-schema move since F3a); and the `Cognitive` row is PARTIALLY
adopted — the EXP-F3a bump (2026-07-06) filled its `tracks` field ONLY (state s2→s3, the append-only
adoption-order fold), the remaining `Cognitive` fields (`belief`/`policy_state`/`cbba_*`) staying
reserved 0-field until F5/C2a. A partition's FIELDS are the identity
commitment — partition names never enter the preimage, only field names fold — so filling, and with it
informal naming, rides with the first consuming experiment. The fills:

| tag | partition | v2 baseline fields |
|-----|-----------|--------------------|
| 1 | `Entity` | `value:U64` (the frozen F0 cell, kept first) `++ alive:Bool, pos:VecF64 [METER, frame per doctrine], vel:VecF64 [METER_PER_SECOND], heading_rad:F64 [ANGLE], speed_mps:F64, turn_rate_radps:F64, fuel:F64, setpoint:VecF64` — F1 per-tick kinematics + setpoints, digested |
| 6 | `Weapon` | `kind:U16, state:U16 (IDLE=0 \| LAUNCHED=1 \| EXPENDED=2), shooter:U64, subject:U64, pos:VecF64 [METER, NED, RIGHT], vel:VecF64 [METER_PER_SECOND, NED, RIGHT], solution:VecF64 [METER_PER_SECOND, NED, RIGHT]` — the F6b munition entity; ADOPTED VERBATIM at the EXP-F6b bump (2026-07-09, state s3→s4 — the FIRST state-schema move since F3a); `pos`/`vel`/`solution` bind §12.3 spatial semantics, `kind`/`state` inline tags `sem_count=0` |
| 7 | `Environment` | `jam_active:Bool, jam_center:VecF64, jam_radius_m:F64 [METER], jam_power_w:F64 [WATT]` — the NORMATIVE BASELINE adopted at `Environment`'s first DYNAMIC-jam consumer; the EXP-F4 bump (2026-07-07) DEFERS this fill (F4's static jam is SCENARIO content, folds into `scenario_hash`), so `Environment` stays RESERVED 0-field at s3 (contract Q2; state s3 unmoved) |
| 8 | `Cognitive` | `belief:VecF64, policy_state:VecU64, tracks:Collection<TrackRecord>, cbba_round:U64, cbba_z:VecU64, cbba_y:VecF64` with `TrackRecord = fixed_le(track:U64, subject:U64, mean:VecF64, cov:VecF64 [COV_ORDER], nu:VecF64, s:VecF64 [COV_ORDER])` — F3a track store {mean,P,ν,S} (`cov`/`s` bind `COV_ORDER=ROW_MAJOR_FULL` per §12.3; `tracks` adopted at the EXP-F3a s3 bump) + C2a per-agent CBBA state (Spec 3a §8 matrix) |
| 9 | `Engine` | the frozen v1 layout, unchanged |

A `Collection` field DECLARES its record sublayout inline in the registry preimage: for a `field_desc`
whose `type_tag = Collection(10)`, the COMPLETE `field_desc` — including its `u32 sem_count` (and any
sem pairs) — is followed by `u32 record_field_count ++ record_field_count × field_desc` (the same §12.0
form, applied recursively), at that field's position. The subject of "is followed by
`record_field_count`" is the WHOLE `field_desc`, never the bare `type_tag`: `Collection(10)` EXTENDS the
uniform `name ++ type_tag ++ sem_count [++ sem_pairs]` field_desc with a sublayout suffix, it does not
fork the prefix — so `sem_count` sits BEFORE `record_field_count`. The nested descs fold into
`state_registry_hash` exactly where the Collection sits. A Collection whose record layout is undeclared
cannot be adopted. (The frozen v1 grammar is untouched: its three `Engine` Collections carry no
sublayout — their values MUST encode empty at v1; the recursive form first USED at the EXP-F3a s3 bump,
which filled `Cognitive.tracks`.)

### 11.3 Sufficient-statistics requirement (rider c — normative)
An experiment whose acceptance is STATISTICAL (F3a chi-square NEES/NIS; F4 binomial/KS; any §2.3
statistical kind) MUST emit, as TYPED events in its adopted layouts, the per-seed **sufficient
statistics** from which the certifier recomputes the test statistic **from the bundle alone** — a
producer-computed p-value/statistic is never on the trusted path, and the plan precommits the critical
value as a pinned number (§2.3). The §11.1 baseline places them: {mean, P, ν, S} on `TrackUpdated`;
snr/latency/drop-reason on the `Message*` kinds. An invariant-bearing statistic that is telemetry-only
violates the Spec 3a §8 frozen rule (recomputable-from-bundle) and is non-citable by construction.

### 11.4 ID-space partitioning + the no-renumber rule (rider a — normative)
Renumbering after entries exist is encoding-hash churn → mass pin invalidation; disjoint ranges also
remove the one shared-file merge hazard between parallel experiment cells. Frozen allocations:

| space | range | owner |
|-------|-------|-------|
| `EventKind` (u16) | `1..=24` | frozen core (`16` permanently retired — NEVER reused) |
| | `25..=99` | framework expansion (successors of this spec only) |
| | `0x0100+32k ..= 0x011F+32k` | per-experiment blocks of 32, `k` in ladder order: E0=0, F1=1, F2a=2, F2b=3, F3a=4, F4=5, F5=6, F6a=7, F6b=8, F6c=9, C1=10, C2a=11, C2b=12 (later experiments continue the sequence); **k ≤ 1911** — block 1911 ends at `0xEFFF`, immediately below the fixture range, so the sequence never enters `0xF000..=0xF0FF` nor overflows u16 (the same bound applies to the §12 semantic-value and `purpose_slot_id` k-blocks) |
| | `0xF000..=0xF0FF` | test-only fixtures (`F0_FIXTURE=0xF000`) |
| state partition tags (u16) | `1..=9` frozen; `10..=31` framework-reserved | experiments extend FIELDS of existing partitions, never mint private partitions |
| §12 semantic value ids (u16, per dimension) | `1..=0x00FF` framework core; `0x0100+32k …` per-experiment (same k-blocks) | |
| RNG `purpose_slot_id` (u16) | `1..=0x00FF` framework (`FIXTURE_DRAW=1`); `0x0100+32k …` per-experiment | the space is reserved HERE; the CRN scenario-vs-policy stream convention is [[PRE-P1-DOCTRINE]]. EXP-F6b RESERVED its k=8 block base `0x0200` (= `0x0100 + 32·8`) at the 2026-07-09 bump (the seed-axis draw; reserve-only — folds into NO registry hash) |

Rules: append-only within a range; no renumbering; no reuse of a retired id; an experiment writes ONLY
inside its block. The mechanical lint is [[IDEA-experiment-kit]] slice 1; the rule is normative now.

---

## 12. Domain-semantics registry (Scope 2 — bound into schema identity) + permitted flows (Scope 5)

### 12.0 Binding: semantics ride INSIDE `field_desc`
Spec 3a §6.5.2 proved that a layout reinterpretation must move identity; the same holds for MEANING:
meters read as feet, NED read as ENU, or a reordered covariance reinterpret payload bytes without
changing a single byte. The registry therefore binds interpretation into the SAME hashes:

```
field_desc(v3-event / v2-state) = utf8 name ++ u16 type_tag
                                ++ u32 sem_count ++ sem_count × ( u16 dimension_id ++ u16 value_id )
                                   // pairs sorted ascending by dimension_id; dimensions distinct
```

`sem_count=0` = no semantic claim (dimensionless counters, opaque ids). There is deliberately **no
separate `domain_semantics_hash`**: the pairs fold through `field_desc` into `schema_registry_hash` /
`state_registry_hash` → `case_id` → `result_id` — a semantic reinterpretation IS a schema change
(the work-order rule: "bound into schema identity"). This section's first adoption WAS the EXP-F1
§11.0 bump (events v3 / state v2; the current grammar is v9/s4 after the EXP-F6b kind-17/18/19 + the
`Weapon` state fill, EXP-F6a kind-15/20/21, EXP-F4
kind-5/6/7, EXP-F3a kind-2/3/4 + `Cognitive.tracks`, EXP-E0 kind-23 and EXP-F2a kind-1/22 adoptions — §11.0): the sem-bearing `field_desc` form
(`utf8 name ++ u16 type_tag ++ u32 sem_count ++ sem_count × (u16 dimension_id ++ u16 value_id)`)
is live, the D-015 pairs ride the Entity v2 fields, and the F0 fixture fields carry `sem_count=0`
(unit-less, the Spec 3a §6.5.2 note honored). At the RETIRED pre-bump versions (v2 events / v1
state, frozen under `compat-v2s1`) the `sem_count` slot did not exist — the old `field_desc` form
was `utf8 name ++ u16 type_tag` with no count. Inserting a zero `sem_count` into those retired
preimages would have moved their hashes in place — exactly the change §11.0 forbids; that is why
the sem-bearing form arrived only WITH the bump.

### 12.1 Dimension vocabulary (u16; append-only; 0 invalid)
`UNIT=1, FRAME=2, HANDEDNESS=3, ANGLE=4, QUATERNION=5, COV_ORDER=6, TIMESTAMP=7, TIEBREAK=8`.

### 12.2 Value vocabularies (u16 per dimension; append-only, no-renumber, 0 invalid; seeded minimal)
- `UNIT`: `METER=1, METER_PER_SECOND=2, METER_PER_SECOND_SQ=3, RADIAN=4, RADIAN_PER_SECOND=5,
  MICROSECOND=6, TICK=7, DECIBEL=8, WATT=9, PROBABILITY_UNIT_INTERVAL=10, COUNT=11, KILOGRAM=12,
  JOULE=13`
- `FRAME`: `NED=1, ENU=2, ECEF=3, BODY_FRD=4, BODY_FLU=5, SENSOR_BORESIGHT=6`
- `HANDEDNESS`: `RIGHT=1, LEFT=2`
- `ANGLE`: `RAD_PLUS_MINUS_PI=1, RAD_ZERO_TWO_PI=2, HEADING_NORTH_CW=3`
- `QUATERNION`: `HAMILTON_WXYZ=1, HAMILTON_XYZW=2, JPL=3`
- `COV_ORDER`: `ROW_MAJOR_FULL=1, UPPER_TRIANGULAR_PACKED=2` — the covariance's state-vector ordering
  is the declared field order of the mean it accompanies (one source of truth, no second declaration)
- `TIMESTAMP`: `SIM_TICK=1, SIM_TIME_US=2` — wall-clock has NO id and never will (closed world, Spec
  3a §3.4: unrepresentable by construction)
- `TIEBREAK`: `LOWEST_DOMAIN_ID=1, LEXICOGRAPHIC_KEY=2, DECLARED_PREDICATE=3` (E0's grazing/tangent
  resolution binds one of these)

### 12.3 Binding rules (normative at adoption)
A field carrying a physical quantity MUST bind `UNIT`; a spatial vector MUST bind `FRAME` (plus
`HANDEDNESS` where the frame does not imply it); a covariance MUST bind `COV_ORDER`; a time-meaning
field MUST bind `TIMESTAMP`; a geometry outcome subject to ties MUST bind `TIEBREAK`. Adding,
removing, or changing ANY pair on an existing field is a reinterpretation = a schema-version bump
(never silent). **Boundary:** this spec owns identity/bytes (which ids exist + how they fold);
[[PRE-P1-DOCTRINE]] decides which VALUES the ladder standardizes on (THE world frame, libm/FMA policy,
kinematic conventions); each experiment's spec declares which pairs its fields carry. Examples: F1's
`Entity.pos` adopts `(UNIT=METER, FRAME=<doctrine>, HANDEDNESS=RIGHT)`; F3a's `cov` adopts
`(COV_ORDER=ROW_MAJOR_FULL)` — the COV_ORDER numeric adoption landed at the EXP-F3a bump (2026-07-06);
F2a's kind-1 `meas` adopts `(UNIT=METER, FRAME=NED,
HANDEDNESS=RIGHT)` — the FIRST event-payload spatial vector to bind FRAME/UNIT pairs (the state
field `Entity.pos` bound its pairs at F1; the first-landing this section governs for EVENT payloads
is F2a's, per the frozen EXP-F2a contract's recorded correction). F4's `MessageDelivered.latency_us`
adopts the two-pair `(UNIT=MICROSECOND), (TIMESTAMP=SIM_TIME_US)` — the FIRST consumer of the
`TIMESTAMP` binding rule and the first two-pair event field (adopted at the EXP-F4 bump, 2026-07-07,
sorted ascending by dimension_id); F4's `MessageSent.tx_power_w` adopts `(UNIT=WATT)` — the first
WATT numeric adoption.

### 12.4 Permitted information flows (Scope 5 — declared now; enforced at first multi-subsystem adoption)
Capability-matrix **v2** (adopted with the first multi-subsystem experiment; F0's v1 stub — one
subsystem, `flows n=0`, no stage — stays frozen and valid): each subsystem entry gains `stage_id:u16`
after `subsystem_id`, and each flow entry is `( from_stage:u16 ++ to_stage:u16 )`:

- **Stage vocabulary (u16):** `TRUTH=1, SENSOR=2, TRACK=3, BELIEF=4, DECISION=5, INTENT=6` (policy is
  interior to DECISION).
- **The permitted edge set is EXACTLY the adjacent chain** `{(1,2),(2,3),(3,4),(4,5),(5,6)}`. A matrix
  declaring any other edge is invalid at capture (typed reject; adoption adds
  `CaptureError::InvalidFlowDeclaration`). In particular every `TRUTH→{BELIEF,DECISION,INTENT}` edge —
  the ground-truth-leak class, "no direct Truth→Policy" — is UNREPRESENTABLE, not merely forbidden.
- **Stage-consistency:** a subsystem's declared read view must be permitted for its stage (only
  SENSOR-stage subsystems read TRUTH-side partitions); cross-subsystem delivery must follow a declared
  edge. Enforced at capture + by the capability-noninterference gate once adopted.
- **Covert channels** (IDs/gaps/seq/timing as information paths) remain DEFERRED (§10) — declared
  honestly, not silently.

---

## 13. Protocol-conformance corridor (Scope 4 — established inventory + normative rules)

### 13.1 The corridor as built (what a conformance claim may cite today)
Independent enc/dec: the 3-site oracle discipline (engine / bundle-verify / Python) with
byte-identical preimages proven by shared goldens. Golden valid vectors: 26 primitive vectors + the
complete F0 bundle + the hermetic evidence KAT (§8). Malformed vectors: the 8-vector framing corpus,
driven BOTH in-process and through the shipped verifier binary. Crash/publication: flat 8-phase,
nested 3-phase + positive control, and a live concurrent-observer gate with its own positive control.
Fresh-process: A‖A′ ×6 barrier-released, serial-vs-parallel, the 10-seed sweep. Tamper: 5
self-consistent binary-level classes + 13 in-process + the 8 evidence-layer gates + forged
`gates_passed`. Independence: dependency-DAG closure equality + 4 own-workspace packaging gates.
Launch accounting: the out-of-band spawn-witness shim ([[INS-013]]).

### 13.2 Honest gaps (recorded, with triggers)
- A CRC-resealed **pure reorder** of intact ledger records is asserted by construction (dense
  `record_seq` + the folded digest, §9) but has no dedicated gate vector — corridor item for
  [[IDEA-experiment-kit]]'s gate stack.
- `TombstoneContradictsBundle` is declared (§3.3) and UNIMPLEMENTED — the certifier's stage-4
  published-tombstone re-fold is deferred to the first `max_infra_retries>0` campaign; as built ANY
  tombstone at `R=0` fails the §3.4 budget, and a published tombstone's directory is rejected by the
  [[INS-012]] file-set check (`AttemptDirSetInvalid{name}`), never embedded or re-folded.
- The §2.3 no-distribution-functions rule has no mechanical enforcement yet — a review obligation until
  the first statistical kind extends the dependency-DAG gate and lands its oracle-precomputed
  exact-comparison vectors.
- `VacuousCampaign` / `VariantDisagreement`: certifier UNIT-level only (behind a re-verification
  fake); black-box-unreachable for an honest F0 producer.
- Crash-tail truncation (§3.5): unit-level only.
- Plan-field sensitivity: structural injectivity + spot checks (4 fields oracle-side; 1 field
  unit+harness) — not a per-field sweep.

### 13.3 Normative corridor rules (bind now; bite at their triggers)
- **Compatibility vectors:** the FIRST §11.0 version bump MUST commit (a) the outgoing version's
  golden set, retained read-only; (b) the new version's golden set; (c) cross-version rejection
  vectors proving the old decoder rejects the new header (`BadVersion`) and vice versa — version
  detection is the header, never content sniffing.
- **Split unknown-kind policy:** on the CANONICAL/certification path an unknown `EventKind` is a typed
  reject (`InvalidEnumTag` — as built). A future telemetry/inspection consumer MAY skip-and-report
  unknown kinds, but a skipping consumer can never feed a hash, a verdict, or a citation. The split is
  by consumer class, pinned here.
- **Decoder fuzz:** DEFERRED — none exists anywhere today (no cargo-fuzz/proptest in the workspace).
  When built it is allocation-budgeted (the §6 + Spec 3a §6.5.12 ceilings are the fuzz harness's
  oracle) and lives beside the conformance suites; the deferral is recorded in §10.
- **Model-checked publication/tick:** NOT model-checked today — TESTED (crash-phase +
  concurrent-observer + transactional-tick suites). Any claim stronger than "tested platform
  assumption" (Spec 3a §6.5.15) requires the model-checking work first.

---

## 14. Long-term reproducibility (Scope 6 — disposition) + reserved-slot retirement

**Content-addressed TODAY** (the §1.6 structural-integrity envelope): schemas + state layouts + the
capability matrix (the three registry hashes) · scenario (`scenario_hash`) · contract
(`contract_version`, §2.2) · campaign (`plan_id`) · producer/verifier/certifier binaries (measured
`build_id`s; `certifier_build_id` inside `verdict_digest`) · toolchain + dependency closure
(`toolchain_id`, `cargo_lock_hash`) · the independent oracle (`oracle_digest` §5.4 + the emit-side
provenance seals).

**Deferred, explicitly** (each with its trigger): container-image digest + FP-environment record
(MXCSR/libm/FMA — [[PRE-P1-DOCTRINE]] terrain, D2 doctrine) · A2/A3 state-digest sidecars
(localization tooling; never in `result_id`) · role/state-projection versioning beyond the frozen rule
ids (=1) · telemetry layout + BundleSink/compression/index (first UI consumer) ·
`supporting_event_ids` is now PLACED (§11.1 `BeliefUpdated`/`DecisionMade`) and lands at its
consumer's adoption.

**Reserved-slot retirement (normative; zero byte change):** the three Spec 3a §6.5.11 manifest slots
`event_stream_digest`, `state_checkpoint_stream_digest`, `evidence_bundle_digest` are **permanently
`null` at `manifest_schema_version=1`**, and the verifier continues to REQUIRE them present-and-null.
If A2/A3 sidecars ever land they arrive via a manifest version bump — these keys are never
back-filled. The manifest's `evidence_bundle_digest` slot is retired on principle: **runs never bind
evidence** (P1); the evidence layer binds runs from the outside (`ledger_digest` → §4), and
back-writing the wrapper's digest into the run manifest would invert that arrow.

---

## 15. Freeze appendix — the F0 evidence KAT pin (the freeze artifact)

Mirrors Spec 3a §7: **the committed golden bytes + digests are the freeze artifact**, independently
produced by the Python oracle (`tools/reference-encoder/evidence_encoder.py`), re-verified on every
commit by `emit.py verify` (the REQUIRED `reference-encoder` gate) and byte-for-byte by the Rust path
(the evidence-KAT golden test). The KAT is the §8 hermetic 1-variant / 2-attempt CORRECT campaign;
every digest below is a function of the frozen struct grammars + pinned synthetic inputs ONLY — never
of this document's prose (a prose edit moves the golden's `spec_3b_blake3` provenance line, not one of
these pins):

| pin | value |
|-----|-------|
| `plan_id` | `4e7302bee5c88d7e6292fe54e9625c0488d122214286108164e3aea063daa6c8` (plan bytes: 536) |
| `ledger_digest` | `3a1041d59e9a08eade163232ac2c1258b3435455ac5786db57066dbec74400b1` (4 records: O0,C0,O1,C1) |
| `verdict_digest` | `9fe333126b18c1ccca758aa587cc3ee97c6ac8909f8dd6cd8c283cc936acad20` (verdict bytes: 512; the zero attestation) |
| `evidence_bundle_digest` | `a9e2b8cd565eb31c0a126626046c59de725d79084518d3be61de73746da1c7a0` |
| `case_id` / `result_id` | the REAL F0 seed-42 fold, = the Spec 3a golden: `12ce20780433ba2793c30f6d68b2fb9567e02f694746557fdaafad1fd58ce6ad` / `f6d63fbd6f14ae0bbe3dd2b4070435e13f66e11ef214d9339338fa00a7737f55` |
| synthetic sentinels | `contract_version = blake3("SYNTHETIC-F0-CONTRACT-v1")` · `certifier_build_id = blake3("kat-certifier")` · `oracle_digest = blake3("kat-oracle")` · `attempt_id`s `01…00` / `02…00` · `bundle_content_digest` leaves `blake3("kat-bcd" ++ attempt_id)` |

Golden file set: `tools/reference-encoder/golden/f0_evidence.json` (digests + provenance) plus the
byte artifacts f0_evidence_plan.det / f0_evidence_ledger.det / f0_evidence_verdict.det /
f0_evidence_bundle.json / f0_evidence_base_inputs.bin in the same directory. The citation chain: the
golden's sha256 is pinned in `roadmap/evidence/EXP-F0-correct.json` (`inputs_sha256`); doctor
cross-checks that record's pinned `case_id`/`result_id`/`verdict_level` against the golden; the live
records re-earn on every commit (`exp-f0-citable`, `exp-f0-robust`) — [[D-012]].

**Freeze discipline** ([[INS-014]]): every edit to this file regenerates the golden (`emit.py write`);
a conforming edit's diff is EXACTLY the `spec_3b_blake3` provenance line in the golden + the
`inputs_sha256` re-pin — if any pin above moves, the edit changed evidence SEMANTICS, not prose, and
must be reviewed as such. Draft-era ceilings are finalized (§6); enum tags, contexts, magics, the
§11.4 ID partitions, and the §12 vocabularies are frozen APPEND-ONLY spaces.
