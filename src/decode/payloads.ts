import { asKind, asSeq, asTick, type EventKindId, type Seq, type Tick } from '../lib/brand'
import { ByteReader, DecodeError } from '../lib/bytes'

export const EVENT_KIND_NAMES: Record<number, string> = {
  1: 'DetectionMade', 2: 'TrackConfirmed', 3: 'TrackUpdated', 4: 'TrackDropped',
  5: 'MessageSent', 6: 'MessageDelivered', 7: 'MessageDropped', 8: 'BeliefUpdated',
  9: 'DesignationSent', 10: 'HandoffAccepted', 11: 'TaskProposed', 12: 'TaskBid',
  13: 'TaskAssigned', 14: 'DecisionMade', 15: 'FireCommand', 17: 'WeaponLaunched',
  18: 'DamageApplied', 19: 'TargetDestroyed', 20: 'AuthorizationDecided',
  21: 'FireRejected', 22: 'EligibilityEvaluated', 23: 'GeometryQueryResolved',
  24: 'AllocationStateUpdated',
  // EXP-F1 motion substrate — the registry's OWN names (spec-3a §6.5.2, spec-3b §11.4 k=1 block
  // 0x0120..=0x013F). DATA, not display taste: the Hangar front door renders these instead of the bare
  // integers flagged in review (289 × 96). Any kind still outside this table keeps the honest `kind N`.
  0x0120: 'MotionSegmentStarted', 0x0121: 'MotionStepped',
  0xf000: 'F0_FIXTURE',
}
export const GEOMETRY_QUERY_RESOLVED = 23
export const ELIGIBILITY_EVALUATED = 22
export const DETECTION_MADE = 1
export const GEOMETRY_QUERY_KIND_NAMES: Record<number, string> =
  { 1: 'POINT_IN_REGION', 2: 'RANGE_BEARING', 3: 'RAY_OCCLUDER', 4: 'LOS' }

export interface EventEnvelope { seq: Seq; tick: Tick; kind: EventKindId; causationId: Seq | null; payload: Uint8Array }
export function decodeEvent(payload: Uint8Array): EventEnvelope {
  const r = new ByteReader(payload)
  const seq = asSeq(r.safeU64())
  const tick = asTick(r.safeU64())
  const kind = asKind(r.u16())
  const causation = r.option(() => r.safeU64())
  const inner = r.bytes(r.u32())
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing event bytes')
  return { seq, tick, kind, causationId: causation === null ? null : asSeq(causation), payload: inner }
}

export interface EntityRecord { namespaceTag: number; id: bigint; fieldBytes: Uint8Array }
export interface StateTickFrame { tickIndex: number; entities: EntityRecord[] }
export function decodeStateTick(payload: Uint8Array): StateTickFrame {
  const r = new ByteReader(payload)
  const tickIndex = r.safeU64()
  const n = r.u32()
  const entities: EntityRecord[] = []
  for (let i = 0; i < n; i++) {
    const namespaceTag = r.u16()
    const id = r.u64()
    const fieldBytes = r.bytes(r.u32())
    entities.push({ namespaceTag, id, fieldBytes })
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing statetick bytes')
  return { tickIndex, entities }
}

export interface EntityV2 {
  value: bigint; alive: boolean; pos: number[]; vel: number[]
  headingRad: number; speedMps: number; turnRateRadps: number; fuel: number; setpoint: number[]
}
export function decodeEntityV2(fieldBytes: Uint8Array): EntityV2 {
  const r = new ByteReader(fieldBytes)
  const out: EntityV2 = {
    value: r.u64(), alive: r.bool(), pos: r.vecF64(), vel: r.vecF64(),
    headingRad: r.f64(), speedMps: r.f64(), turnRateRadps: r.f64(), fuel: r.f64(), setpoint: r.vecF64(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing entity bytes')
  return out
}

export interface Trailer {
  caseId: Uint8Array; eventHash: Uint8Array; stateTrajectoryHash: Uint8Array
  eventCount: number; tickCount: number; terminationReason: number
}
export function decodeTrailer(payload: Uint8Array): Trailer {
  const r = new ByteReader(payload)
  const t: Trailer = {
    caseId: r.bytes(32), eventHash: r.bytes(32), stateTrajectoryHash: r.bytes(32),
    eventCount: r.safeU64(), tickCount: r.safeU64(), terminationReason: r.u16(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing trailer bytes')
  return t
}

// kind-1 DetectionMade (spec-3b §11.1): `subject:U64, sensor:U64, meas:VecF64 [UNIT=METER, FRAME=NED],
// snr_db:F64 [DECIBEL]` — the ± detection with its NED-meter measurement position and signal-to-noise.
export interface Detection { subject: bigint; sensor: bigint; meas: number[]; snrDb: number }
export function decodeDetection(payload: Uint8Array): Detection {
  const r = new ByteReader(payload)
  const d: Detection = { subject: r.u64(), sensor: r.u64(), meas: r.vecF64(), snrDb: r.f64() }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing kind-1 bytes')
  return d
}

// The byte SPAN of the `meas` measurement VALUES inside a DetectionMade payload: the offset of meas[0]'s first byte
// (relative to the payload start) and the total byte length of the F64 values. This is the SINGLE SOURCE for "where
// meas lives", owned BESIDE decodeDetection — it walks the SAME reader over the SAME prefix fields the decoder walks
// (subject:U64, sensor:U64, then the VecF64 length prefix) and reads the reader's cursor, rather than a hand-summed
// `8 + 8 + 4` living in a downstream module. So a schema re-vendor that moves a field moves this span WITH the
// decoder; it can never leave a caller's offset silently retargeted at a different inner field while its own label
// still says 'meas'. Callers that must land a byte inside a recorded measurement (the tamper demo) consume THIS.
// Throws MalformedPayload on a payload too short to carry the prefix — the same failure decodeDetection raises.
export interface ByteSpan { readonly offset: number; readonly length: number }
export function detectionMeasSpan(payload: Uint8Array): ByteSpan {
  const r = new ByteReader(payload)
  r.u64() // subject:U64 — the two fixed-width fields decodeDetection reads before meas
  r.u64() // sensor:U64
  const count = r.u32() // meas:VecF64 length prefix — r.off now sits on meas[0]'s first byte
  return { offset: r.off, length: count * 8 } // each F64 measurement value is 8 bytes (r.f64)
}

// kind-22 EligibilityEvaluated (spec-3b §11.1): `subject:U64, sensor:U64, in_range:Bool, in_fov:Bool,
// los_clear:Bool, eligible:Bool, tiebreak_applied:Bool` — the ± sensing observation. tiebreak_applied is
// the appended 7th field (the EXP-F2a bump, D-017 "ties are reported, never silent" for the composition).
export interface Eligibility {
  subject: bigint; sensor: bigint
  inRange: boolean; inFov: boolean; losClear: boolean; eligible: boolean; tiebreakApplied: boolean
}
export function decodeEligibility(payload: Uint8Array): Eligibility {
  const r = new ByteReader(payload)
  const e: Eligibility = {
    subject: r.u64(), sensor: r.u64(),
    inRange: r.bool(), inFov: r.bool(), losClear: r.bool(), eligible: r.bool(), tiebreakApplied: r.bool(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing kind-22 bytes')
  return e
}

export interface GeometryQuery {
  queryKind: number; subject: bigint; object: bigint; argv: number[]
  resultFlag: boolean; resultScalars: number[]; tiebreakApplied: boolean
}
export function decodeGeometryQuery(payload: Uint8Array): GeometryQuery {
  const r = new ByteReader(payload)
  const q: GeometryQuery = {
    queryKind: r.u16(), subject: r.u64(), object: r.u64(), argv: r.vecF64(),
    resultFlag: r.bool(), resultScalars: r.vecF64(), tiebreakApplied: r.bool(),
  }
  if (r.remaining() !== 0) throw new DecodeError('MalformedPayload', 'trailing kind-23 bytes')
  return q
}
