import { existsSync, readFileSync } from 'node:fs'

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// runs/index.json enrichment (T5b — the Hangar's data layer).
//
// The published run library is DESCRIBED here at publish time: title, kind histogram, real tick
// count, and (where a manifest carries it) the integration step dt_us. The Hangar (src/ui/Hangar)
// reads ONLY this file to render its cards — it never decodes six bundles on open (§8: the front
// door pays no decode/WebGL cost).
//
// TWO-VOICE SPLIT (D4 Certification Wall, Part 6.2): the kind histogram is DECLARED publish-time
// metadata — data-true but NOT a runtime-recomputed certification. It must never wear a voice glyph.
// The declaration is PROVEN true by src/publication.test.ts, which decodes every published bundle
// with the REAL decoder and asserts the declared histogram + tick count match, byte for byte. The
// card shows the declaration; the test proves it. This split IS the design (declared vs decoded).
//
// This module owns a small, self-contained bundle reader so the publish path (a plain .mjs) needs no
// TS toolchain. Its correctness is not trusted — the publication test's real-decoder cross-check is
// the guarantee, exactly as the two-voice split intends.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// The published run library, in Hangar display order. id/title/base/detOnly are AUTHORED; the rest of
// each entry is DERIVED by enrichEntry from the published bytes. Single source of truth for the list.
// f1 LEADS (HERO SWITCH, dev/v0.6): it is the cold-open default AND the Hangar's featured first card; e0
// remains a certified library run (its query stage is its lens for Hangar visitors), just no longer the hero.
// serializeIndex owns public/runs/index.json, so a reorder here is regenerated into byte-identical bytes.
//
// F3a title carries NO robust/statistical wordmark: the vendored f3a_seed42 is the CORRECT
// single-target-track campaign (case 5dc77bdf, EXP-F3a-correct.json); the ROBUST 50-seed statistical
// acceptance is a DIFFERENT bundle (case e8dcdb33, EXP-F3a-robust.json). Pinned by
// src/publication.test.ts (T5 rider — Certification Wall D4 consult).
export const RUN_LIST = [
  { id: 'f1', title: 'F1 motion lifecycle (golden, det-only)', base: 'runs/f1', detOnly: true },
  { id: 'f0', title: 'F0 determinism fixture (seed 42)', base: 'runs/f0' },
  { id: 'e0', title: 'E0 geometry sweep (golden, det-only)', base: 'runs/e0', detOnly: true },
  { id: 'f2a', title: 'F2a scene & sensing (seed 42)', base: 'runs/f2a' },
  { id: 'f3a', title: 'F3a single-target track (seed 42)', base: 'runs/f3a' },
  { id: 'f4', title: 'F4 comms link (seed 42)', base: 'runs/f4' },
]

const FILE_HEADER_LEN = 24
const FRAME_EVENT = 1
const FRAME_STATE = 2
const FRAME_TRAILER = 3
// Event frame payload layout (decode/payloads.ts decodeEvent): seq u64 (8) · tick u64 (8) · kind u16.
// So the event kind sits at a fixed offset of 16 bytes into the frame payload. This is the ONLY field
// this reader extracts; everything else (CRC validation, full envelope) is the real decoder's job and
// is re-run by the publication test over the same bytes.
const EVENT_KIND_OFFSET = 16

// Walk the DETBNDL1 frame stream and count event kinds + state frames. Frame layout
// (decode/frames.ts): [tag:1][len:u32 LE][payload:len][crc:4]. tickCount = state frames − 1.
export function decodeRunFacts(detBytes) {
  const b = detBytes instanceof Uint8Array ? detBytes : new Uint8Array(detBytes)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const kinds = {}
  let off = FILE_HEADER_LEN
  let stateFrames = 0
  while (off < b.byteLength) {
    const tag = b[off]
    const len = dv.getUint32(off + 1, true)
    const payloadOff = off + 5
    if (tag === FRAME_EVENT) {
      const kind = dv.getUint16(payloadOff + EVENT_KIND_OFFSET, true)
      kinds[kind] = (kinds[kind] ?? 0) + 1
    } else if (tag === FRAME_STATE) {
      stateFrames += 1
    }
    off = payloadOff + len + 4
    if (tag === FRAME_TRAILER) break
  }
  // Ascending-numeric key order is JS's own object-iteration order for integer-like keys, so the
  // serialized histogram is deterministic regardless of encounter order — a stable published artifact.
  const ordered = {}
  for (const k of Object.keys(kinds).map(Number).sort((a, c) => a - c)) ordered[k] = kinds[k]
  return { kinds: ordered, tickCount: stateFrames - 1 }
}

// Optional manifest-sourced fields. dt_us is present only for full-manifest runs (f0/f2a/f3a/f4);
// det-only runs (e0/f1) omit it entirely — their Hangar card and sim-clock keep the assumed voice.
// supersedes_plan_id is surfaced ONLY when a manifest carries a non-zero chain (D4: always visible,
// never buried — the anti-p-hacking tripwire). None of today's manifests carry one, so it is omitted.
function manifestExtras(id) {
  const path = `public/runs/${id}/manifest.json`
  if (!existsSync(path)) return {}
  const m = JSON.parse(readFileSync(path, 'utf8'))
  const out = {}
  const dt = m?.inputs?.config?.dt_us
  if (dt !== undefined && dt !== null) out.dtUs = Number(dt)
  const sup = m?.provenance?.supersedes_plan_id ?? m?.supersedes_plan_id
  if (typeof sup === 'string' && !/^0+$/.test(sup.replaceAll('-', ''))) out.supersedesPlanId = sup
  return out
}

// Enrich one authored entry with derived facts from its PUBLISHED bytes (public/runs/<id>/…).
export function enrichEntry(entry) {
  const det = readFileSync(`public/${entry.base}/bundle.det`)
  const { kinds, tickCount } = decodeRunFacts(det)
  const extras = manifestExtras(entry.id)
  // Field order: authored identity first, then derived facts. dtUs/supersedesPlanId spread last so
  // they only appear when present (undefined keys are dropped by JSON.stringify).
  return { ...entry, ticks: tickCount, kinds, ...extras }
}

export function buildIndex() {
  return RUN_LIST.map(enrichEntry)
}

// Serialize exactly as the committed artifact: 2-space, no trailing newline (chore 0dfb204 — the
// committed bytes must equal the generator's output exactly).
export function serializeIndex(index = buildIndex()) {
  return JSON.stringify(index, null, 2)
}
