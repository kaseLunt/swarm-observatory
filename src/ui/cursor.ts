// ── THE ONE CURSOR RESOLVER (v0.8) ────────────────────────────────────────────────────────────────────
// A single home for the `(t0, t1)` frame-cursor idiom that was triplicated across the render surfaces — the
// `Math.min(t0 + 1, lastFrame)` shape at Scene.tsx (the interactive cone), chainLinks.tsx (the causal-link
// endpoints), and sensingStageView's lerpHeadPosition (the sensing head). Every interpolating frame-loop
// surface resolves its lerp endpoints HERE, so the offset/clamp truth cannot fork: change the shape once and
// all three move together. Composes evaluatedFrame (the ONE tick→frame map) — it does not re-derive it.
import type { EventTick, StateFrame, TransportTick } from '../lib/brand'
import { evaluatedFrame, TARGET_FRAME_OFFSET } from './sensingStage'

// A FRAME CURSOR — the two adjacent state-frame indices a fractional playhead lerps between. t0 is the
// EVALUATED frame of the current tick; t1 is its successor, clamped to the terminal vertex so the finale tick
// never indexes past the trajectory. Both are StateFrame: the cursor's whole purpose is to hand the render
// path frame-domain values that RunModel.entityStatesAt will accept without a further cast.
export interface FrameCursor { t0: StateFrame; t1: StateFrame }

// THE FRAME-OFFSET DOMAIN — the ONLY tick→frame shifts the sensing dual-domain sanctions: 0 (non-sensing —
// the frame IS the tick) or TARGET_FRAME_OFFSET (the kind-22 verdict rides frame k+1). The resolver ASSERTS its
// results StateFrame, and evaluatedFrame is plain integer arithmetic, so the assertion is only sound when the
// offset is itself a non-negative INTEGER: a raw `number` offset of 0.5 (or any non-{0,1} value, NaN included)
// would mint a fractional/NaN branded StateFrame that entityStatesAt would then accept. Constraining the offset
// to this literal union closes that at compile time — no runtime guard needed, because no non-integer offset is
// representable. The union is pinned to TARGET_FRAME_OFFSET's own type so it moves in lockstep if that constant
// ever changes. (Production only ever passes 0 or TARGET_FRAME_OFFSET; this names that fact in the type.)
export type FrameOffset = 0 | typeof TARGET_FRAME_OFFSET

// TRANSPORT → EVENT: the store/URL playhead is a plain scrub coordinate (the TransportTick domain — the store
// never brands it). It becomes an EventTick only HERE, at the model boundary, where "the tick k the engine
// committed a step at" starts to mean something. Same integer, different domain; this reinterpretation is the
// ONE sanctioned ingestion each frame-loop surface performs before it resolves a cursor. Runtime-erased.
export const eventTickOf = (playhead: TransportTick): EventTick => playhead as unknown as EventTick

// THE CURSOR RESOLVER — allocating form, for non-frame callers (tests, event-rate reads). Frame-loop callers
// MUST use resolveCursorInto with an owned scratch (no allocation on the useFrame path).
export function resolveCursor(tick: EventTick, offset: FrameOffset, lastFrame: StateFrame): FrameCursor {
  const out: FrameCursor = { t0: 0 as StateFrame, t1: 0 as StateFrame }
  resolveCursorInto(out, tick, offset, lastFrame)
  return out
}

// THE CURSOR RESOLVER — zero-alloc out-param form: writes the (t0, t1) pair into the caller's owned cursor.
// t0 composes evaluatedFrame(tick, offset, lastFrame); t1 is the clamped successor. This is the SOLE home of
// the `Math.min(t0 + 1, lastFrame)` shape. evaluatedFrame accepts a plain number, so the branded tick /
// lastFrame widen into it for free; the two writes brand the results back into the StateFrame domain. The
// FrameOffset constraint is what makes that re-brand sound: with an integer offset the results are integers,
// so `as StateFrame` never mints a fractional/NaN frame the way a raw `number` offset (0.5, NaN) would.
export function resolveCursorInto(out: FrameCursor, tick: EventTick, offset: FrameOffset, lastFrame: StateFrame): void {
  const t0 = evaluatedFrame(tick, offset, lastFrame)
  out.t0 = t0 as StateFrame
  out.t1 = Math.min(t0 + 1, lastFrame) as StateFrame
}
