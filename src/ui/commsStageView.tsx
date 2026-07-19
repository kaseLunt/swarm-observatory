import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useViewStore } from '../state/viewStore'
import { CATEGORY, PALETTE, hexToThree, BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { eventTickOf } from './cursor'
import { WITNESS_RUN_SECONDS } from '../state/transport'
import type { TransportTick } from '../lib/brand'
import {
  COMMS_PAD_SRC, COMMS_PAD_DST, COMMS_MID_SPAN,
  buildPulseInstances, dropRevealAt, pulseDuration, anchorLabel, HERO_PRESENT_TICKS, type CommsData,
} from './commsStage'

// ── THE CONTESTED-LINK STAGE — f4's stage voice (the duet + the one fizzle) ──────────────────────────────────
// The instrument voice is the latency lane + the ledger (the strip); THIS is the drama on the 3D stage (LAW 3):
// the DUET — two presentational station pads (src low-left, dst right with lead room) joined by a quiet link —
// with message PULSES crossing left→right, and the HERO: the t30 fizzle, the run's ONE bloom and its ONE
// persistent, always-findable anchor. Everything else stays quiet so the loss reads (one emphasis budget).
//
// THE FRAME-PATH LAW (the highest-risk surface — the only comms surface on the frame path), IN ITS TRUE IN-SHADER
// FORM. Every message's flight is STATIC per run (its window, its from→to path, drop-ness, hero-ness), so the whole
// spawn set is PRECOMPILED into instanced buffer ATTRIBUTES at stage build (buildPulseInstances), bound once, and
// the material compiles at the Scene's warmup (gl.compile) WITH those attributes present. The frame loop then
// writes ONE uniform — the playhead (tick+fraction) — and the vertex shader derives each instance's position along
// its path and its VISIBILITY (playhead ∈ [t0, t0+dur)) purely from the attributes + that uniform; the fragment
// picks the sub-bloom or HDR-hero colour. There is NO per-frame CPU buffer write and NO lazy shader variant:
//   • the old InstancedMesh + setColorAt allocated instanceColor and compiled the instancing-COLOUR variant on the
//     FIRST active pulse — a shader compile DURING playback at the first t2 crossing (the binding GPU rule
//     violated). A raw ShaderMaterial has ONE program, compiled up front with its colour carried as a uniform.
//   • motion + visibility are a pure function of the uniform, so scrubs / pauses / the terminal frame need NO
//     special-casing — a pulse renders whenever the playhead is inside its window and rests otherwise. This retires
//     the old interval-aware CPU pool and its terminal-settle machinery (a per-frame recompute cannot latch a
//     transient). The reveal-clock-driven ANCHOR (and the strip's ledger) are untouched — only the pulse RENDERING
//     moved in-shader.
//
// PRESENTATIONAL PLACEMENT (the honesty chip / the ledger): the pads are PADS, not decoded drone poses — the
// endpoints are Engine-only scenario content, so their placement encodes no datum (chip-declared). The pulse
// TIMING is decoded (latency_us, tick); the pulse PATH and the ×300 stretch are presentational.

const t3 = (p: readonly [number, number, number]): [number, number, number] => [p[0], p[1], p[2]]

// Colour vocabulary — TOKENS ONLY (LAW 2), the comms category violet. Derived once at module scope.
const COMMS = new THREE.Color(hexToThree(CATEGORY.comms.hue))
const DIM = new THREE.Color(hexToThree(PALETTE.textDim))

// ── THE STAGE CHROMA HIERARCHY (chroma = hierarchy — the anchor out-ranks the scaffolding) ──────────────────
// The hero-check §4 finding: at rest the loss anchor wore the SAME comms violet as the two PRESENTATIONAL pads,
// so the ONE data-true conclusion read as a third station — and, worse, carried LESS chroma than the decorative
// endpoints (the pads' full-chroma violet vs the anchor's dimmed ×0.6). The re-weight, TOKEN-ROUTED (LAW 2 — no
// new hue, only an EXISTING token re-assigned): the two station pads RECEDE to the neutral textDim the link
// baseline already wears (grey, desaturated presentational chrome — the same DIM), so the whole scaffolding
// (pads + spine) reads as ONE quiet grey system, and the ANCHOR alone keeps the comms category violet
// (ANCHOR_QUIET, still sub-bloom). Chroma now tracks evidentiary rank, not decoration. Exported so the re-weight
// is pinned at the TOKEN level (PAD_SCAFFOLD ≠ ANCHOR_QUIET; the pad is desaturated vs the chromatic anchor).
export const PAD_SCAFFOLD = DIM // the receded presentational pads — the neutral textDim scaffold (was the comms violet)
// The pads recede FURTHER than before (was 0.5): dimmer as well as greyer, so the violet anchor is unmistakably
// the stage's one emphasized conclusion at rest. Sub-bloom by construction (a faint grey wireframe).
export const PAD_OPACITY = 0.35
// The luminance-graded colours (the "one bloom per run" discipline — the sensing MARK_LIVE / MARK_SPENT
// precedent). A DELIVERED pulse and the persistent anchor sit BELOW the bloom cutoff (quiet, unbloomed); the
// DROP pulse clears it (the single emphasis). Exported so the bloom-threshold test binds the ACTUAL colours the
// shader draws (the uDelivered / uHero uniforms), and the anchor mesh reads ANCHOR_QUIET.
export const PULSE_DELIVERED = COMMS.clone().multiplyScalar(0.6) // quiet crossing pulse — sub-bloom
export const PULSE_DROP = COMMS.clone().multiplyScalar(2.2)      // the fizzle — HDR, blooms (the one emphasis)
export const ANCHOR_QUIET = COMMS.clone().multiplyScalar(0.6)    // the persistent anchor — findable, sub-bloom

// THE AFTERGLOW SUB-BLOOM CAP — the emphasis intensity the hero's afterglow STEPS DOWN to at the collapse→afterglow
// boundary, then decays cap → 0. DERIVED from the actual arithmetic (never a guessed magic number): the afterglow
// must sit BELOW the bloom threshold from its FIRST frame, so cap × luminance(PULSE_DROP) < BLOOM_LUMINANCE_THRESHOLD.
// We take 90% of that ceiling for a clear margin. The visual grammar: ONE bloom (the collapse at full intensity 1),
// then a visible-but-quiet fading ember (the capped afterglow). The shader carries this as uAfterglowMax; the model
// mirror heroPresentationAt takes it as its afterglowMax parameter, so both agree by construction.
const REC709 = [0.2126729, 0.7151522, 0.0721750] as const
const lumOf = (c: THREE.Color): number => REC709[0] * c.r + REC709[1] * c.g + REC709[2] * c.b
export const AFTERGLOW_MAX_INTENSITY = 0.9 * BLOOM_LUMINANCE_THRESHOLD / lumOf(PULSE_DROP)

// The presentational pad radius + the pulse/anchor radii.
const PAD_R = 1.6
const PULSE_R = 0.7
const ANCHOR_R = 1.0

// ── THE ANCHOR LABEL (SDF) — reuses the entity-plate infrastructure EXACTLY (troika crisp text) ─────────────
// The decoded "t30 · LOSS" billboard the persistent anchor wears at rest, so the resting stage names the loss on
// its own (the hero-check §4 highest-leverage win). Same drei <Text> (troika SDF) the ▸ ALFA entity plate uses:
// a SUB-BLOOM neutral fill, a bgVoid outline halo for legibility, fontSize 0.5. LAW 2 / identity-is-typographic:
// the label carries NO chroma (the ANCHOR MESH carries the comms hue); the text is the neutral primary voice.
const LABEL_LIFT = ANCHOR_R + 0.8 // sit the label just above the octahedron's top vertex (+ANCHOR_R), clear of it
const LABEL_SIZE = 0.5            // matches the entity plate's fontSize (one reused type scale)
// THE SUB-BLOOM LABEL FILL — the one-bloom law applies to the label too. textPrimary's OWN linear luminance
// (≈0.737) sits ABOVE the 0.4 Bloom cutoff, and the renderer is untone-mapped before Bloom — so a raw textPrimary
// glyph would GLOW continuously from t30, a second bloom beside the hero's one. DERIVE the fill the SAME way the
// afterglow cap is derived (never a magic number): scale textPrimary so its Rec.709 linear luminance lands at 90%
// of the threshold — the BRIGHTEST legal neutral, kept legible by the bgVoid SDF outline halo against the void.
// lumOf/REC709 are the exact Rec.709 weights the Bloom LuminanceMaterial uses (ColorManagement is on → the stored
// values ARE the linear ones Bloom reads), so the test binds to the fill the shader actually draws.
const TEXT_PRIMARY = new THREE.Color(hexToThree(PALETTE.textPrimary))
export const LABEL_FILL_CAP = 0.9 * BLOOM_LUMINANCE_THRESHOLD / lumOf(TEXT_PRIMARY)
export const LABEL_FILL = TEXT_PRIMARY.clone().multiplyScalar(LABEL_FILL_CAP)
// The SDF glyph atlas the label needs, pre-built at mount (never on first reveal): the 't' tick prefix, digits,
// the space + middot separator, and A–Z for the decoded reason word (LOSS / JAMMED / RANGE / DROP — all uppercase).
const ANCHOR_LABEL_CHARS = 't0123456789 ·ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// The pulse's world position at a 0..1 fraction ALONG the link (src → dst), written into the caller's vector.
// Pure, zero allocation. This is the CPU MIRROR of the vertex shader's `mix(aFrom, aTo, frac)` — kept and tested
// so the position derivation the shader performs is pinned in a node test (a vitest cannot see into GLSL).
export function pulseWorldInto(out: THREE.Vector3, along: number): void {
  const s = COMMS_PAD_SRC, d = COMMS_PAD_DST
  out.set(
    s[0] + (d[0] - s[0]) * along,
    s[1] + (d[1] - s[1]) * along,
    s[2] + (d[2] - s[2]) * along,
  )
}

// ── THE PULSE SHADER — motion + visibility + the one bloom, all in-shader from the playhead uniform ──────────
// vertex: a delivery / non-hero drop is visible in [aT0, aT0+aDur), progress p = (playhead−aT0)/aDur, spatial
// fraction p (runs to dst) or easeOut(p)·0.5 for a drop (collapses AT mid-span — mirrors commsStage.spatialAlong).
// THE HERO gets a WIDER, cadence-safe window [aT0, aT0 + max(aDur, uHeroPresentTicks)): the collapse completes FIRST
// at full intensity 1 (the ONE bloom; position frozen at mid-span after aDur via the clamp), then a declared
// AFTERGLOW STEPS DOWN to uAfterglowMax (a sub-bloom cap) and decays cap → 0 across the linger (heroPresentationAt
// mirrors this). TWO clocks feed the hero: uPlayhead, PLUS a bounded uTerminalFade added to the hero's playhead
// ONLY so a hero whose window extends PAST the run's end (uPlayhead clamps at maxTick) still completes its decay to
// zero at terminal rest instead of blooming forever (the effective playhead reaches the window end → clipped).
// OUTSIDE the window the vertex is pushed out of clip space (not rasterized).
const PULSE_VERT = /* glsl */ `
  attribute float aT0;
  attribute float aDur;
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aIsDrop;
  attribute float aIsHero;
  uniform float uPlayhead;
  uniform float uHeroPresentTicks;
  uniform float uTerminalFade;
  uniform float uAfterglowMax;
  varying float vIsHero;
  varying float vIntensity;
  void main() {
    float ph = uPlayhead + aIsHero * uTerminalFade;       // the hero's effective playhead (terminal fade completes its decay)
    float window = aIsHero > 0.5 ? max(aDur, uHeroPresentTicks) : aDur; // the hero lingers; others are exact-current
    float inWindow = (ph >= aT0 && ph < aT0 + window) ? 1.0 : 0.0;
    float p = clamp((ph - aT0) / aDur, 0.0, 1.0);         // the COLLAPSE progress (freezes at 1 through the afterglow)
    float ease = 1.0 - (1.0 - p) * (1.0 - p);             // ease-out (matches spatialAlong's easeOut)
    float frac = aIsDrop > 0.5 ? ease * 0.5 : p;          // drop collapses at mid-span (→0.5); delivered runs to dst (→1)
    vec3 center = mix(aFrom, aTo, frac);
    // INTENSITY: full 1 during the collapse [aT0, aT0+aDur) — the bloom; then STEP DOWN to uAfterglowMax and decay to
    // zero across the linger (the sub-bloom ember). collapsePhase gates the step so the afterglow never re-blooms.
    float linger = window - aDur;
    float afterglow = linger > 0.0 ? clamp((ph - (aT0 + aDur)) / linger, 0.0, 1.0) : 0.0;
    float collapsePhase = ph < aT0 + aDur ? 1.0 : 0.0;
    vIsHero = aIsHero;
    vIntensity = collapsePhase > 0.5 ? 1.0 : uAfterglowMax * (1.0 - afterglow);
    if (inWindow < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);              // effective playhead outside the window → clipped, no fragments
    } else {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position + center, 1.0);
    }
  }
`
// fragment: the sub-bloom delivered colour, or the HDR hero colour SCALED by the intensity (full during the
// collapse — the bloom — then the sub-bloom ember fading across the linger). Written straight to gl_FragColor — a
// raw ShaderMaterial is untone-mapped, so the HDR hero reaches the composer's Bloom at full and stays below its
// threshold from the afterglow's first frame (the cap) through zero.
const PULSE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uDelivered;
  uniform vec3 uHero;
  varying float vIsHero;
  varying float vIntensity;
  void main() {
    vec3 color = mix(uDelivered, uHero * vIntensity, step(0.5, vIsHero));
    gl_FragColor = vec4(color, 1.0);
  }
`

// Build the instanced pulse mesh ONCE per model: a sphere (radius PULSE_R) instanced over the precompiled
// per-message attributes, with the ShaderMaterial above. instanceCount 0 on a non-renderable mapping (the
// withhold). Nothing here runs on the frame path — the attributes are static; only uPlayhead moves per frame.
function buildPulseMesh(data: CommsData): { obj: THREE.Mesh; geo: THREE.InstancedBufferGeometry; mat: THREE.ShaderMaterial } {
  const inst = buildPulseInstances(data)
  const base = new THREE.SphereGeometry(PULSE_R, 14, 12)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('aT0', new THREE.InstancedBufferAttribute(inst.t0, 1))
  geo.setAttribute('aDur', new THREE.InstancedBufferAttribute(inst.dur, 1))
  geo.setAttribute('aFrom', new THREE.InstancedBufferAttribute(inst.from, 3))
  geo.setAttribute('aTo', new THREE.InstancedBufferAttribute(inst.to, 3))
  geo.setAttribute('aIsDrop', new THREE.InstancedBufferAttribute(inst.isDrop, 1))
  geo.setAttribute('aIsHero', new THREE.InstancedBufferAttribute(inst.isHero, 1))
  geo.instanceCount = inst.count
  const mat = new THREE.ShaderMaterial({
    vertexShader: PULSE_VERT,
    fragmentShader: PULSE_FRAG,
    uniforms: {
      uPlayhead: { value: 0 },
      uHeroPresentTicks: { value: HERO_PRESENT_TICKS }, // the declared cadence-safe hero linger (one source: commsStage)
      uTerminalFade: { value: 0 },                      // added to the hero's playhead ONLY at terminal rest (see terminalFadeStep)
      uAfterglowMax: { value: AFTERGLOW_MAX_INTENSITY }, // the sub-bloom cap the afterglow steps down to
      uDelivered: { value: PULSE_DELIVERED.clone() },
      uHero: { value: PULSE_DROP.clone() },
    },
    fog: false,
  })
  const obj = new THREE.Mesh(geo, mat)
  obj.frustumCulled = false // pulses move along the link; never cull the pool
  obj.renderOrder = 4
  return { obj, geo, mat }
}

// ── THE TERMINAL RENDER CLOCK — a bounded, self-extinguishing supplement for exactly ONE state ────────────────
// A hero whose linger window extends PAST the run's end is stranded when uPlayhead clamps at maxTick: the afterglow
// freezes at a positive intensity — visible forever. This advances a SECOND scalar (added to the hero's playhead in
// the shader) to complete the decay to zero at terminal rest. It is NOT the retired settle machinery — no store
// subscription, no scheduling, no rAF: it is one float write per frame in the existing useFrame, active ONLY while
// the playhead is clamped at the run end AND a hero window extends past it, and it STOPS advancing the moment the
// effective playhead reaches the window end (heroWindowEnd − maxTick — the fade self-extinguishes). A scrub AWAY
// from the end RESETS it to 0, so returning restarts the decay from the same clamped point (exact-current-honest:
// the linger you'd have seen had the run continued). `deltaTicks` is the frame's tick advance at the 1× rate.
export function terminalFadeStep(opts: {
  playhead: number; maxTick: number; heroWindowEnd: number | null; fade: number; deltaTicks: number;
}): number {
  const { playhead, maxTick, heroWindowEnd, fade, deltaTicks } = opts
  if (heroWindowEnd === null || playhead < maxTick) return 0 // no past-end hero, or not at terminal rest → reset
  const remaining = heroWindowEnd - maxTick                  // the linger left to drive to zero at the clamp
  return Math.min(fade + Math.max(deltaTicks, 0), remaining) // advance, bounded so the effective playhead never overshoots
}

// The hero's linger window END iff it extends PAST the run's end (else null — no terminal fade needed). Pure.
function heroWindowPastEnd(data: CommsData, maxTick: number): number | null {
  if (!data.hero) return null
  const end = data.hero.send.tick + Math.max(pulseDuration(data.hero, data.dtUs, data.dtKnown), HERO_PRESENT_TICKS)
  return end > maxTick ? end : null
}

export function CommsStage({ data, maxTick }: { data: CommsData; maxTick: number }) {
  // The persistent anchor is a GROUP (the violet octahedron + its decoded SDF label), toggled AS ONE by the
  // reveal clock; labelRef billboards the text toward the camera. Both were one mesh before the label landed.
  const anchorGroupRef = useRef<THREE.Group>(null)
  const labelRef = useRef<THREE.Group>(null)
  const fadeRef = useRef(0) // the accumulated terminal fade (ticks); a ref — it must never trigger a React render
  // The instanced pulse pool + its ShaderMaterial, built ONCE per model (the attributes are static per run). The
  // material compiles at the Scene's gl.compile warmup because this mesh is in the scene at mount, WITH its
  // instanced attributes bound — so the first t2 crossing writes only the uPlayhead uniform, never a shader compile.
  const pulse = useMemo(() => buildPulseMesh(data), [data])
  // Whether a hero's linger extends past the run end (→ the terminal fade guards it), computed once per model.
  const heroPastEnd = useMemo(() => heroWindowPastEnd(data, maxTick), [data, maxTick])
  // The quiet presentational link spine between the pads (a raw-colour line, unlit). Built once.
  const linkLine = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...t3(COMMS_PAD_SRC), ...t3(COMMS_PAD_DST)]), 3))
    const m = new THREE.LineBasicMaterial({ color: DIM, transparent: true, opacity: 0.28, toneMapped: false, fog: false, depthWrite: false })
    const l = new THREE.Line(g, m); l.renderOrder = 1; l.frustumCulled = false
    return l
  }, [])
  // <primitive> objects are ours, not auto-disposed by r3f — release GPU buffers on model change / unmount (the
  // Canvas remounts per run switch, so this also covers run changes).
  useEffect(() => () => { pulse.geo.dispose(); pulse.mat.dispose() }, [pulse])
  useEffect(() => () => { linkLine.geometry.dispose(); (linkLine.material as THREE.Material).dispose() }, [linkLine])

  // THE PER-FRAME WRITES — the playhead uniform (the whole animation), PLUS the bounded terminal fade for the one
  // past-end-hero state (usually inert: heroPastEnd is null for f4, whose hero window closes at t34 ≪ maxTick).
  // Motion + visibility are pure functions of these in the shader. The persistent ANCHOR (octahedron + label) stays
  // reveal-clock driven: revealed once the drop's tick is written and holding thereafter (constitution §4), the
  // whole group toggled here from dropRevealAt (exactly as the anchor did before). The label BILLBOARDS toward the
  // camera EXACTLY as the entity plate does — a single zero-alloc quaternion copy, §8-clean (no allocation, no
  // React, no compile), and ONLY while revealed; its string + colours are static (built once at React render /
  // module scope), never recomputed per frame.
  useFrame((state, delta) => {
    const { tick, fraction } = useViewStore.getState()
    const playhead = tick + fraction
    pulse.mat.uniforms.uPlayhead!.value = playhead
    // the terminal render clock (self-extinguishing; 0 unless clamped at maxTick with a hero window past the end).
    const deltaTicks = delta * (maxTick / WITNESS_RUN_SECONDS) // the frame's tick advance at the 1× rate
    fadeRef.current = terminalFadeStep({ playhead, maxTick, heroWindowEnd: heroPastEnd, fade: fadeRef.current, deltaTicks })
    pulse.mat.uniforms.uTerminalFade!.value = fadeRef.current
    const a = anchorGroupRef.current
    if (a) {
      const anchored = dropRevealAt(data, eventTickOf(tick as TransportTick)) === 'anchored'
      a.visible = anchored
      if (anchored && labelRef.current) labelRef.current.quaternion.copy(state.camera.quaternion)
    }
  })

  return (
    <group>
      {/* THE TWO STATION PADS — presentational placement (PADS, not decoded drone poses); RECEDED to the neutral
          grey scaffold (was the comms violet), so the data-true anchor out-ranks them in chroma (hero-check §4). */}
      <mesh position={t3(COMMS_PAD_SRC)} renderOrder={2}>
        <octahedronGeometry args={[PAD_R]} />
        <meshBasicMaterial color={PAD_SCAFFOLD} wireframe transparent opacity={PAD_OPACITY} toneMapped={false} fog={false} />
      </mesh>
      <mesh position={t3(COMMS_PAD_DST)} renderOrder={2}>
        <octahedronGeometry args={[PAD_R]} />
        <meshBasicMaterial color={PAD_SCAFFOLD} wireframe transparent opacity={PAD_OPACITY} toneMapped={false} fog={false} />
      </mesh>

      {/* THE LINK BASELINE — a quiet presentational spine between the pads. */}
      <primitive object={linkLine} />

      {/* THE PULSE POOL — one instanced mesh, its motion/visibility/colour computed in-shader from uPlayhead; the
          attributes are precompiled and bound at build, so the frame path writes ONE uniform and allocates nothing.
          Delivered instances are sub-bloom; the hero instance blooms (the one emphasis). */}
      <primitive object={pulse.obj} />

      {/* THE PERSISTENT DROP ANCHOR — the always-findable conclusion at mid-span: the violet octahedron (the ONE
          chromatic object at rest, out-ranking the grey pads) plus its DECODED "t30 · LOSS" label, so the resting
          stage names the loss on its own. Revealed at the drop's tick and holding thereafter (constitution §4);
          the whole group is born hidden and toggled AS ONE by the reveal clock. Quiet (sub-bloom); no hero → the
          group never reveals and the label is empty (no anchor, no label — the withhold holds). */}
      <group ref={anchorGroupRef} position={t3(COMMS_MID_SPAN)} visible={false}>
        <mesh renderOrder={3}>
          <octahedronGeometry args={[ANCHOR_R]} />
          <meshBasicMaterial color={ANCHOR_QUIET} wireframe toneMapped={false} fog={false} />
        </mesh>
        {/* The decoded SDF label — reuses the ▸ ALFA entity-plate infra EXACTLY (troika crisp text): a SUB-BLOOM
            neutral fill (LABEL_FILL — derived from textPrimary so it never clears the Bloom cut; see above), a
            bgVoid outline halo, fontSize LABEL_SIZE. Billboarded per frame (labelRef; see the frame loop). Text is
            DERIVED from the decoded hero (anchorLabel — tick + reason word), NEVER a literal; empty when there is
            no hero, so a no-hero mapping renders nothing. */}
        <group ref={labelRef} position={[0, LABEL_LIFT, 0]}>
          <Text
            characters={ANCHOR_LABEL_CHARS}
            fontSize={LABEL_SIZE}
            color={LABEL_FILL}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor={PALETTE.bgVoid}
          >
            {data.hero ? anchorLabel(data.hero) : ''}
          </Text>
        </group>
      </group>
    </group>
  )
}
