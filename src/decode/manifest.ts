export interface RunManifest {
  eventSchemaVersion: number; stateSchemaVersion: number
  schemaRegistryHash: string; stateRegistryHash: string
  scenarioId: string; seed: string; dtUs: number
  eventHash: string; stateTrajectoryHash: string; resultId: string
  eventCount: number; tickCount: number; runComplete: boolean; terminationReason: number
  simTimeStartUs: string; simTimeEndUs: string
  caseId: string; attemptId: string; commit: string; dirty: boolean; createdAt: string
}

function req<T>(v: T | undefined | null, path: string): T {
  if (v === undefined || v === null) throw new Error(`manifest: missing ${path}`)
  return v
}
const hex64 = (v: string, path: string): string => {
  if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`manifest: ${path} is not 64-hex`)
  return v
}
// Strict JSON-boolean gate (fail-closed, same rejection idiom as req/hex64): the provenance `dirty` flag drives
// the alarm-voice row AND its build-hygiene/citability note, and the contract types it as a bool. An unvalidated
// field let a truthy/falsy non-boolean (0, "", "false", 1) slip through and silently mis-voice the row — so any
// value that is not exactly `true`/`false` is a malformed manifest and takes the existing malformed-manifest path.
const bool = (v: unknown, path: string): boolean => {
  if (v !== true && v !== false) throw new Error(`manifest: ${path} is not a boolean`)
  return v
}
// SHAPE gate for dt_us — validate the spec type, never coerce (fail-closed, same rejection idiom as bool/req).
// dt_us is a spec i64 microsecond tick period, integral and > 0 (spec-3a §3: `DT_UNIT: i64 µs (integral; dt_us>0)`;
// §6.5.4 `Config { dt_us:i64 }`). In the manifest JSON it is encoded as a CANONICAL DECIMAL STRING — the same
// u64/i64 stringification the schema uses for seed and sim_time (the f0/f4 fixtures carry `"dt_us":"1000"` /
// `"125000"`). The old gate COERCED (Number(v)) before validating, so `true`→1, `[1]`→1, `0.5`, and the subnormal
// `5e-324` (→ later 375×300/dt = Infinity) all slipped through. Admit ONLY the spec shape: a canonical positive-
// integer string (no sign, no leading zero, no fraction, no exponent), whose value is a positive safe integer.
// Anything else — a JSON number, a boolean, an array/object, `'1e5'`, `'0'`, `'01'` — is a malformed manifest and
// takes the existing rejection path, so a mis-shaped recorded clock can never reach the comms/provenance surfaces.
const i64Us = (v: unknown, path: string): number => {
  if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(Number(v)))
    throw new Error(`manifest: ${path} is not a canonical positive-integer string (spec i64 µs, dt_us>0)`)
  return Number(v)
}

export function parseManifest(jsonText: string): RunManifest {
  const j = JSON.parse(jsonText)
  const inputs = req(j.inputs, 'inputs')
  const outputs = req(j.outputs, 'outputs')
  const hashes = req(outputs.hashes, 'outputs.hashes')
  const prov = req(j.provenance, 'provenance')
  return {
    eventSchemaVersion: req(inputs.event_schema_version, 'inputs.event_schema_version'),
    stateSchemaVersion: req(inputs.state_schema_version, 'inputs.state_schema_version'),
    schemaRegistryHash: hex64(req(inputs.schema_registry_hash, 'inputs.schema_registry_hash'), 'schema_registry_hash'),
    stateRegistryHash: hex64(req(inputs.state_registry_hash, 'inputs.state_registry_hash'), 'state_registry_hash'),
    scenarioId: req(inputs.scenario_id, 'inputs.scenario_id'),
    seed: String(req(inputs.seed, 'inputs.seed')),
    dtUs: i64Us(req(inputs.config?.dt_us, 'inputs.config.dt_us'), 'inputs.config.dt_us'),
    eventHash: hex64(req(hashes.event_hash?.value, 'outputs.hashes.event_hash.value'), 'event_hash'),
    stateTrajectoryHash: hex64(req(hashes.state_trajectory_hash?.value, 'outputs.hashes.state_trajectory_hash.value'), 'state_trajectory_hash'),
    resultId: hex64(req(hashes.result_id?.value, 'outputs.hashes.result_id.value'), 'result_id'),
    eventCount: Number(req(outputs.event_count, 'outputs.event_count')),
    tickCount: Number(req(outputs.tick_count, 'outputs.tick_count')),
    runComplete: bool(req(outputs.run_complete, 'outputs.run_complete'), 'outputs.run_complete'),
    terminationReason: req(outputs.termination_reason, 'outputs.termination_reason'),
    simTimeStartUs: String(req(outputs.sim_time_start_us, 'outputs.sim_time_start_us')),
    simTimeEndUs: String(req(outputs.sim_time_end_us, 'outputs.sim_time_end_us')),
    caseId: hex64(req(prov.case_id, 'provenance.case_id'), 'case_id'),
    attemptId: req(prov.attempt_id, 'provenance.attempt_id'),
    commit: req(prov.commit, 'provenance.commit'),
    dirty: bool(req(prov.dirty, 'provenance.dirty'), 'provenance.dirty'),
    createdAt: req(prov.created_at, 'provenance.created_at'),
  }
}

export interface Identity { eventSchemaVersion: number; stateSchemaVersion: number; schemaRegistryHash: string; stateRegistryHash: string }
// A refusal carries an optional `headline` so the gate screen can state the RIGHT reason: a schema/registry
// mismatch is a dialect refusal (the default headline), an incomplete run is a not-published refusal. Same
// refusal shape — never a new verdict family.
export type GateResult = { ok: true } | { ok: false; field: string; expected: string; actual: string; headline?: string }

export function gateManifest(m: RunManifest, id: Identity): GateResult {
  const checks: [string, string | number, string | number][] = [
    ['event_schema_version', id.eventSchemaVersion, m.eventSchemaVersion],
    ['state_schema_version', id.stateSchemaVersion, m.stateSchemaVersion],
    ['schema_registry_hash', id.schemaRegistryHash, m.schemaRegistryHash],
    ['state_registry_hash', id.stateRegistryHash, m.stateRegistryHash],
  ]
  for (const [field, expected, actual] of checks)
    if (expected !== actual) return { ok: false, field, expected: String(expected), actual: String(actual) }
  // PUBLISHED-run admission (spec-3a §4.5: "published when finalized ∧ decode+hash re-verify ∧ run_complete:true").
  // A manifest declaring the run incomplete is not a published run — refuse admission through the SAME refusal
  // shape, so it never reaches the verify fold and can never mint a manifest-verified verdict or a session seal.
  if (m.runComplete !== true)
    return { ok: false, field: 'run_complete', expected: 'true', actual: String(m.runComplete), headline: 'this run is not published — its manifest declares the run incomplete' }
  return { ok: true }
}
