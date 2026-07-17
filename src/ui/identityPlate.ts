// ── THE IDENTITY PLATE — identity is typographic, not chromatic ──────────────────────────────────
// One plate, four registers, everywhere. The app used to say "agent 1:0" in the Inspector, "the cone" in
// empty-state copy, and "drone" in tours — three dialects for one subject, and the stage never said which
// shape was the vehicle. LAW 2 forbids the obvious wrong answer (a hue per drone: at swarm scale that is
// palette growth into illegibility). So: CLASS is carried by SHAPE (glyph), the INDIVIDUAL by a typographic
// plate (callsign + data-true key), EMPHASIS by the existing selection accent. Hue stays with event kinds
// and verdicts, where the constitution put it. CVD-safety comes free (shape + text, no hue channel).
//
// ZERO IMPORTS (the leaf idiom): pure string formatting. The URL keeps carrying the raw entity key
// (sel=1:0) — callsigns NEVER serialize (they are presentational display labels; the key is the data-true
// identity). A deep link shares the subject, never the label.

// ── The four actor registers — the register decides the plate voice and the ledger tier ───────────
// ENTITY   — state-backed, namespace-1, alive/pos/fuel (the drones). Present voice.
// APPARATUS— addressable but stateless scenario equipment: the sensor (it HAS a data-true id — kind-22
//            sensor:U64 — but its pose is a scenario constant), occluder, region bodies. Never an "alive"
//            pill, never a state table; its constants render WITH their anchors.
// MARKER   — data-read reference points that are neither: the origin anchor, a drawn observer. Quiet.
// BELIEF   — derived objects about entities (tracks, covariance ghosts). Always an echo-grammar voice,
//            never the present voice — designed-ahead; no belief surface builds at f2a.
export type ActorRegister = 'entity' | 'apparatus' | 'marker' | 'belief'

// ── The actor glyph alphabet — shape = class ──────────────────────────────────────────────────────
// These appear ONLY inside identity plates (always beside a callsign — context plus non-collision). They
// must NOT collide with the two shipped alphabets: event categories own ◆ ▲ ● ◇ ✳; provenance voices own
// ✓ • ○ ✗. ⌖ (marker) and ◌ (belief) are the render-risk glyphs — the plate size font-stack verification
// checks them; the fallbacks are ✛ and ◯ (GLYPH_FALLBACK), swapped by a one-line change here if
// the primary does not render.
export const ACTOR_GLYPH: Record<ActorRegister, string> = {
  entity: '▸',    // ▸ heading chevron — a vehicle points somewhere
  apparatus: '◎', // ◎ aperture — a watcher
  marker: '⌖',    // ⌖ position indicator — origin / observer (risk glyph; fallback ✛)
  belief: '◌',    // ◌ dotted circle — hollow, NOT-YET-compatible (risk glyph; fallback ◯)
}
// The scenario-body glyph (occluder / region solid) — a quiet hollow square; constants are quiet. Kept
// apart from ACTOR_GLYPH because a body is not a selectable actor, but it shares the plate typography.
export const SCENARIO_BODY_GLYPH = '▢' // ▢
// Fallbacks for the two render-risk glyphs — the font-stack verification swaps these in if ⌖ / ◌ tofu.
export const GLYPH_FALLBACK: Partial<Record<ActorRegister, string>> = { marker: '✛', belief: '◯' } // ✛ ◯

// ── NAMING PLACEHOLDERS (owner gate; each a one-line swap) ──────────────────────────────────────────
// The constitution reserves naming to the owner; these are the working defaults presented at the owner gate.
// Build with the NATO scheme as the safe default (zero owner decision needed); if the owner picks the squadron scheme (a squadron word),
// flip CALLSIGN_SCHEME to 'squadron' and set SQUADRON_WORD — one line, and the plate language updates
// everywhere it is consumed (Inspector, timeline hover, tour captions, the strip header).
export const CLASS_NOUN = 'drone'                          // options: drone (recommended) | agent | craft
export const SENSOR_NOUN = 'sensor'                        // data-true (kind-22 names sensor:U64)
export type CallsignScheme = 'nato' | 'squadron'
export const CALLSIGN_SCHEME: CallsignScheme = 'nato'      // the safe default; 'squadron' is the alternative if the owner picks it
export const SQUADRON_WORD = 'VANTA'                       // consumed only when CALLSIGN_SCHEME === 'squadron'
export const F2A_TOUR_TITLE = 'What the sensor admits'     // the lens's LAW-4 question in five words

// NATO phonetic alphabet — genre-true, Lattice register. Past 26 → "ALFA-2" (index / 26).
const NATO = [
  'ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIETT',
  'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO',
  'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY', 'YANKEE', 'ZULU',
] as const

// The numeric index inside an entity key "ns:id" (or a bare id). Deterministic, per-run: the derivation is
// scoped to the id, so '1:0' in f1 and '1:0' in f2a resolve the SAME way but name different scenario
// entities — the plate never implies a shared vehicle across runs.
function idOf(key: string): number {
  const raw = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// Callsign for a namespace-1 mobile entity — declared-presentational, deterministic from the id.
// NATO: ALFA, BRAVO, …, ZULU, then ALFA-2, BRAVO-2, … past 26. Squadron: "<WORD> 00", "<WORD> 01", …
// `scheme` defaults to the placeholder CALLSIGN_SCHEME (the one-line swap); the param exists so a test
// can prove BOTH schemes without mutating the module constant — flipping CALLSIGN_SCHEME is the real swap.
export function entityCallsign(key: string, scheme: CallsignScheme = CALLSIGN_SCHEME): string {
  const id = idOf(key)
  if (scheme === 'squadron') return `${SQUADRON_WORD} ${String(id).padStart(2, '0')}`
  const word = NATO[id % 26]!
  const wrap = Math.floor(id / 26)
  return wrap === 0 ? word : `${word}-${wrap + 1}`
}

// The apparatus (sensor) callsign — "SENSOR 0" (the watcher named plain; data-true, the events name it).
export function apparatusCallsign(key: string): string { return `${SENSOR_NOUN.toUpperCase()} ${idOf(key)}` }

// The class noun a register carries (retires "agent" and "the cone" from copy).
export function nounFor(register: ActorRegister): string {
  return register === 'apparatus' ? SENSOR_NOUN : CLASS_NOUN
}

function callsignFor(key: string, register: ActorRegister): string {
  return register === 'apparatus' ? apparatusCallsign(key) : entityCallsign(key)
}

// ── The plate: one formatter, full + compact forms, the raw key never out of reach ────────────────
export interface Plate {
  readonly glyph: string
  readonly callsign: string
  readonly noun: string
  readonly key: string       // the data-true entity key — always recoverable
  readonly register: ActorRegister
}

export function identityPlate(key: string, register: ActorRegister): Plate {
  return { glyph: ACTOR_GLYPH[register], callsign: callsignFor(key, register), noun: nounFor(register), key, register }
}

// Full plate (instruments — Inspector header, table/plot rows): "▸ ALFA — drone 1:0"
// (glyph · callsign · class noun · entity key; the key rides in tabular figures at the consumer).
export function fullPlate(p: Plate): string { return `${p.glyph} ${p.callsign} — ${p.noun} ${p.key}` }

// Compact plate (hover readouts, captions, chips): "▸ ALFA" (the key rides one hover away, or the same line
// where space allows — the consumer decides; this form omits it).
export function compactPlate(p: Plate): string { return `${p.glyph} ${p.callsign}` }

// The plate is itself a registered pixel-class (a joint ruling): tier `presentational`, this exact answer
// sentence. The two halves ship as one honesty system — the app may be charming, and must say the charm is
// paint. `{key}` is substituted by the consuming ledger entry (the class sentence carries no live values).
export const PLATE_LEDGER_ANSWER =
  'callsign — a per-run display label derived from the entity key; presentational, not in the bundle'
