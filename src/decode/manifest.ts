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
    dtUs: Number(req(inputs.config?.dt_us, 'inputs.config.dt_us')),
    eventHash: hex64(req(hashes.event_hash?.value, 'outputs.hashes.event_hash.value'), 'event_hash'),
    stateTrajectoryHash: hex64(req(hashes.state_trajectory_hash?.value, 'outputs.hashes.state_trajectory_hash.value'), 'state_trajectory_hash'),
    resultId: hex64(req(hashes.result_id?.value, 'outputs.hashes.result_id.value'), 'result_id'),
    eventCount: Number(req(outputs.event_count, 'outputs.event_count')),
    tickCount: Number(req(outputs.tick_count, 'outputs.tick_count')),
    runComplete: req(outputs.run_complete, 'outputs.run_complete'),
    terminationReason: req(outputs.termination_reason, 'outputs.termination_reason'),
    simTimeStartUs: String(req(outputs.sim_time_start_us, 'outputs.sim_time_start_us')),
    simTimeEndUs: String(req(outputs.sim_time_end_us, 'outputs.sim_time_end_us')),
    caseId: hex64(req(prov.case_id, 'provenance.case_id'), 'case_id'),
    attemptId: req(prov.attempt_id, 'provenance.attempt_id'),
    commit: req(prov.commit, 'provenance.commit'),
    dirty: req(prov.dirty, 'provenance.dirty'),
    createdAt: req(prov.created_at, 'provenance.created_at'),
  }
}

export interface Identity { eventSchemaVersion: number; stateSchemaVersion: number; schemaRegistryHash: string; stateRegistryHash: string }
export type GateResult = { ok: true } | { ok: false; field: string; expected: string; actual: string }

export function gateManifest(m: RunManifest, id: Identity): GateResult {
  const checks: [string, string | number, string | number][] = [
    ['event_schema_version', id.eventSchemaVersion, m.eventSchemaVersion],
    ['state_schema_version', id.stateSchemaVersion, m.stateSchemaVersion],
    ['schema_registry_hash', id.schemaRegistryHash, m.schemaRegistryHash],
    ['state_registry_hash', id.stateRegistryHash, m.stateRegistryHash],
  ]
  for (const [field, expected, actual] of checks)
    if (expected !== actual) return { ok: false, field, expected: String(expected), actual: String(actual) }
  return { ok: true }
}
