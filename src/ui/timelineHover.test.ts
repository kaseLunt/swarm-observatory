import { describe, expect, test } from 'vitest'
import { hoverIdentity, type HoverTarget } from './timelineHover'

// Injected kind-name table mirroring EVENT_KIND_NAMES's fallback-to-number contract.
const kindName = (k: number): string => (k === 23 ? 'GeometryQueryResolved' : String(k))

describe('hoverIdentity — every timeline mark answers on hover (constitution §5)', () => {
  test('an event tick answers with seq · kind · tick', () => {
    const t: HoverTarget = {
      tick: 37,
      event: { seq: 37, kind: 23, tick: 37, parentSeq: null },
      aggregate: null,
      chapter: { label: 'run', startTick: 0, endTick: 75 },
    }
    expect(hoverIdentity(t, kindName)).toBe('event #37 · GeometryQueryResolved · tick 37')
  })

  test('a chained event appends its causal arc (arcs reserved for selection → parentSeq set)', () => {
    const t: HoverTarget = {
      tick: 37,
      event: { seq: 37, kind: 23, tick: 37, parentSeq: 36 },
      aggregate: null,
      chapter: null,
    }
    expect(hoverIdentity(t, kindName)).toBe(
      'event #37 · GeometryQueryResolved · tick 37 · causal arc #36 → #37',
    )
  })

  test('the event mark wins over the chapter band when both are under the cursor (most-specific first)', () => {
    const t: HoverTarget = {
      tick: 30,
      event: { seq: 30, kind: 23, tick: 30, parentSeq: null },
      aggregate: null,
      chapter: { label: 'segment 2', startTick: 24, endTick: 48 },
    }
    expect(hoverIdentity(t, kindName)).toBe('event #30 · GeometryQueryResolved · tick 30')
  })

  test('a heat-mode bin holding >1 event answers as an AGGREGATE with its chapter (never one name)', () => {
    const t: HoverTarget = {
      tick: 130,
      event: null,
      aggregate: { count: 12, startTick: 120, endTick: 139 },
      chapter: { label: 'segment 2', startTick: 100, endTick: 200 },
    }
    expect(hoverIdentity(t, kindName)).toBe('12 events · ticks 120–139 · segment 2')
  })

  test('an aggregate without a chapter still answers count + span', () => {
    const t: HoverTarget = {
      tick: 130,
      event: null,
      aggregate: { count: 3, startTick: 120, endTick: 139 },
      chapter: null,
    }
    expect(hoverIdentity(t, kindName)).toBe('3 events · ticks 120–139')
  })

  test('a resolved single event outranks an aggregate (callers set at most one; precedence pinned)', () => {
    const t: HoverTarget = {
      tick: 130,
      event: { seq: 41, kind: 23, tick: 130, parentSeq: null },
      aggregate: { count: 2, startTick: 120, endTick: 139 },
      chapter: null,
    }
    expect(hoverIdentity(t, kindName)).toBe('event #41 · GeometryQueryResolved · tick 130')
  })

  test('a gap (no event under the cursor) answers with the chapter band identity', () => {
    const t: HoverTarget = {
      tick: 30,
      event: null,
      aggregate: null,
      chapter: { label: 'segment 2', startTick: 24, endTick: 48 },
    }
    expect(hoverIdentity(t, kindName)).toBe('chapter: segment 2 · ticks 24–48')
  })

  test('an uncategorized kind falls back to its numeric id via the injected namer', () => {
    const t: HoverTarget = {
      tick: 5, event: { seq: 5, kind: 0x0120, tick: 5, parentSeq: null }, aggregate: null, chapter: null,
    }
    expect(hoverIdentity(t, kindName)).toBe('event #5 · 288 · tick 5')
  })

  test('a mute pixel is impossible: with nothing else under the cursor, the bare tick still answers', () => {
    expect(hoverIdentity({ tick: 12, event: null, aggregate: null, chapter: null }, kindName)).toBe('tick 12')
  })
})
