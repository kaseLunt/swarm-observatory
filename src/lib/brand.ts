declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }
export type Tick = Brand<number, 'Tick'>
export type Seq = Brand<number, 'Seq'>
export type EventKindId = Brand<number, 'EventKindId'>

// ── The tick/frame dual domain (v0.8 A3) ─────────────────────────────────────────────────────────────────
// Three integer axes that share a number line but mean DIFFERENT things — the dual-domain class that produced
// three real v0.7 bugs (verdict-vs-pose off-by-one, the "other drone" Entities lag, the fractional-half split).
// Compile-time brands, runtime-erased (no wrapper objects, no cost): the only job is to make the axes
// non-interchangeable in the type system, so a StateFrame can never silently stand in for an EventTick.
//
//   TransportTick — the store/URL PLAYHEAD: a plain scrub coordinate (viewStore.tick stays a bare number BY
//     DESIGN — the store never imports a brand). This brand names that domain at the boundary where a frame-loop
//     surface reinterprets the playhead as an EventTick (cursor.eventTickOf), and nowhere else.
//   EventTick    — the tick k the engine COMMITTED A STEP at: the domain of RunModel.eventsByTick, ticks[seq],
//     and the kind-22 verdicts. Where model semantics begin.
//   StateFrame   — a state-frame INDEX (0..tickCount): the domain of RunModel.entityStatesAt and the trail
//     vertices. A tick-k verdict is evaluated against StateFrame (k + TARGET_FRAME_OFFSET) — the offset the ONE
//     tick→frame map (evaluatedFrame) and the ONE cursor resolver (resolveCursor) apply, and the reason these
//     two axes MUST stay distinct.
export type TransportTick = Brand<number, 'TransportTick'>
export type EventTick = Brand<number, 'EventTick'>
export type StateFrame = Brand<number, 'StateFrame'>

const nonNegInt = (n: number, what: string): number => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer, got ${n}`)
  return n
}
export const asTick = (n: number): Tick => nonNegInt(n, 'Tick') as Tick
export const asSeq = (n: number): Seq => nonNegInt(n, 'Seq') as Seq
export const asKind = (n: number): EventKindId => nonNegInt(n, 'EventKindId') as EventKindId
export const asTransportTick = (n: number): TransportTick => nonNegInt(n, 'TransportTick') as TransportTick
export const asEventTick = (n: number): EventTick => nonNegInt(n, 'EventTick') as EventTick
export const asStateFrame = (n: number): StateFrame => nonNegInt(n, 'StateFrame') as StateFrame
