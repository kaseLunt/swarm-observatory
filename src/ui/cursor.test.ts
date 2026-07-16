import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { resolveCursor, resolveCursorInto, eventTickOf, type FrameCursor } from './cursor'
import { evaluatedFrame } from './sensingStage'
import { asEventTick, asStateFrame, asTransportTick } from '../lib/brand'

// resolveCursor — THE ONE cursor resolver. The (t0, t1) pair every interpolating frame-loop surface lerps
// between: t0 composes evaluatedFrame (the shared tick→frame map), t1 is its clamped successor. These pin the
// resolver's behavior byte-for-byte against evaluatedFrame at the 0 / terminal / offset edges the three
// deduplicated call-sites depend on.
describe('resolveCursor — the shared (t0, t1) frame cursor', () => {
  const LAST = 96
  const ticks = [0, 1, 55, 95, 96, 200] as const
  const offsets = [0, 1] as const

  test('t0 IS evaluatedFrame; t1 is the +1 successor clamped to lastFrame — at every 0/terminal/offset edge', () => {
    for (const offset of offsets) {
      for (const tick of ticks) {
        const c = resolveCursor(asEventTick(tick), offset, asStateFrame(LAST))
        expect(c.t0).toBe(evaluatedFrame(tick, offset, LAST))
        expect(c.t1).toBe(Math.min(evaluatedFrame(tick, offset, LAST) + 1, LAST))
      }
    }
  })

  test('offset 0 is the non-sensing identity — t0 === Math.min(tick, lastFrame) (byte-identical to pre-A3)', () => {
    for (const tick of ticks) {
      const c = resolveCursor(asEventTick(tick), 0, asStateFrame(LAST))
      expect(c.t0).toBe(Math.min(tick, LAST))
    }
  })

  test('offset 1 (sensing) rides one frame ahead and never overruns the terminal vertex', () => {
    expect(resolveCursor(asEventTick(0), 1, asStateFrame(96))).toEqual({ t0: 1, t1: 2 })
    expect(resolveCursor(asEventTick(95), 1, asStateFrame(96))).toEqual({ t0: 96, t1: 96 }) // terminal verdict tick
    expect(resolveCursor(asEventTick(96), 1, asStateFrame(96))).toEqual({ t0: 96, t1: 96 }) // finale rest clamps
  })

  test('the terminal tick collapses t0 === t1 (a zero-length lerp — no successor to interpolate toward)', () => {
    const c = resolveCursor(asEventTick(96), 0, asStateFrame(96))
    expect(c.t0).toBe(96)
    expect(c.t1).toBe(96)
  })
})

// resolveCursorInto — the zero-alloc out-param form the §8 frame paths use. Observable contract: it mutates the
// caller's cursor in place (identity preserved across calls, returns void) and agrees with the allocating form.
describe('resolveCursorInto — the §8 zero-alloc form', () => {
  test('writes into the caller-owned cursor (same reference across calls) and returns void', () => {
    const out: FrameCursor = { t0: asStateFrame(0), t1: asStateFrame(0) }
    const ret = resolveCursorInto(out, asEventTick(55), 1, asStateFrame(96))
    expect(ret).toBeUndefined()
    expect({ t0: out.t0, t1: out.t1 }).toEqual({ t0: 56, t1: 57 })
    const same = out
    resolveCursorInto(out, asEventTick(10), 0, asStateFrame(96)) // reuse — no new object minted
    expect(out).toBe(same)
    expect({ t0: out.t0, t1: out.t1 }).toEqual({ t0: 10, t1: 11 })
  })

  test('agrees with the allocating resolveCursor at every edge', () => {
    const out: FrameCursor = { t0: asStateFrame(0), t1: asStateFrame(0) }
    for (const offset of [0, 1] as const) {
      for (const tick of [0, 1, 55, 95, 96, 200] as const) {
        resolveCursorInto(out, asEventTick(tick), offset, asStateFrame(96))
        expect({ t0: out.t0, t1: out.t1 }).toEqual({ ...resolveCursor(asEventTick(tick), offset, asStateFrame(96)) })
      }
    }
  })
})

// eventTickOf — the ONE transport→event ingestion. Same integer, different domain; the brand is runtime-erased.
describe('eventTickOf — transport→event reinterpretation', () => {
  test('is the runtime identity (the brand carries no value — only the type domain changes)', () => {
    for (const n of [0, 1, 42, 95]) expect(eventTickOf(asTransportTick(n))).toBe(n)
  })
})

// Brand boundary — compile-level pins that the tick/frame axes are non-interchangeable. Each @ts-expect-error
// fires at typecheck (tsc -b, the gate); the runtime call still succeeds because brands erase. If any of these
// STOPPED erroring, tsc would flag the directive as unused — so this locks the domain separation both ways.
describe('brand boundary — the axes cannot cross', () => {
  test('a StateFrame cannot pass where resolveCursor expects an EventTick tick', () => {
    // @ts-expect-error StateFrame is not an EventTick
    expect(resolveCursor(asStateFrame(3), 0, asStateFrame(96)).t0).toBe(3)
  })
  test('an EventTick cannot pass where resolveCursor expects a StateFrame lastFrame', () => {
    // @ts-expect-error EventTick is not a StateFrame
    expect(resolveCursor(asEventTick(3), 0, asEventTick(96)).t0).toBe(3)
  })
  test('a raw number cannot pass for either branded axis', () => {
    // @ts-expect-error a bare number is not an EventTick
    expect(resolveCursor(3, 0, asStateFrame(96)).t0).toBe(3)
    // @ts-expect-error a bare number is not a StateFrame
    expect(resolveCursor(asEventTick(3), 0, 96).t0).toBe(3)
  })
})

// F3 — the OFFSET domain. The resolver asserts its (t0, t1) results StateFrame; if the offset could be any number,
// a fractional (or NaN) offset would mint a fractional/NaN branded frame that entityStatesAt would then accept.
// The offset is constrained to 0 | typeof TARGET_FRAME_OFFSET, so that is a COMPILE error — no runtime guard, and
// no runtime negative test, are needed: a non-integer offset is simply not representable. The @ts-expect-error
// below proves the compiler rejects 0.5; the runtime call still executes (the type is erased) and WOULD have
// produced the fractional 3.5 the type now forbids — that residual value is what the constraint exists to bar.
describe('offset domain (F3) — only 0 or TARGET_FRAME_OFFSET, so no fractional/NaN frame can be minted', () => {
  test('a fractional offset is a compile error (it would otherwise mint a fractional StateFrame)', () => {
    // @ts-expect-error 0.5 is not an allowed FrameOffset — evaluatedFrame(3, 0.5, 96) would brand 3.5 as a StateFrame
    expect(resolveCursor(asEventTick(3), 0.5, asStateFrame(96)).t0).toBe(3.5)
    // NaN is closed by the SAME union (any non-{0,1} number is rejected) — a raw number offset cannot reach here at all.
  })
})

// Identity pins — the THREE deduplicated sites route through the ONE resolver. Source-text pins (the idiom
// sensingStageView.test.ts already uses): each surface calls resolveCursorInto with its own scratch, and the
// triplicated `Math.min(t0 + 1 / f0 + 1, lastFrame)` cursor construction is GONE from every one of them.
describe('identity pins — every frame-loop cursor is the one resolver', () => {
  const scene = readFileSync('src/ui/Scene.tsx', 'utf8')
  const chain = readFileSync('src/ui/chainLinks.tsx', 'utf8')
  const head = readFileSync('src/ui/sensingStageView.tsx', 'utf8')

  test('Scene.Entities resolves through resolveCursorInto and no longer builds t1 by hand', () => {
    expect(scene).toMatch(/resolveCursorInto\(entitiesCursor,/)
    expect(scene).not.toMatch(/Math\.min\(t0 \+ 1/)
  })
  test('ChainLinks resolves through resolveCursorInto and no longer builds t1 by hand', () => {
    expect(chain).toMatch(/resolveCursorInto\(linkCursor,/)
    expect(chain).not.toMatch(/Math\.min\(t0 \+ 1/)
  })
  test('lerpHeadPosition resolves through resolveCursorInto and no longer builds f1 by hand', () => {
    expect(head).toMatch(/resolveCursorInto\(headCursor,/)
    expect(head).not.toMatch(/Math\.min\(f0 \+ 1/)
  })
})
