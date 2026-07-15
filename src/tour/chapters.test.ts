import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { chapterAt, chapterBands, chapterLabel, deriveChapters, normalizeStarts } from './chapters'

const load = (n: string) => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
const f1 = new RunModel(decodeBundle(load('f1_seed42.det')), null)
const e0 = new RunModel(decodeBundle(load('e0_seed42.det')), null)

describe('chapter derivation', () => {
  // Observed once against the real fixture (2026-07-06): F1 carries 3 MotionSegmentStarted
  // events at ticks 0, 24, 48, over a 64-tick run -- pinned exactly rather than left as
  // `toBeGreaterThan(1)`; a future fixture regen that changes segmenting should fail loud here.
  test('F1: one chapter per MotionSegmentStarted, contiguous, covering the run', () => {
    const ch = deriveChapters(f1)
    expect(ch.length).toBe(3)
    expect(ch).toEqual([
      { startTick: 0, endTick: 24, label: 'segment 1' },
      { startTick: 24, endTick: 48, label: 'segment 2' },
      { startTick: 48, endTick: 64, label: 'segment 3' },
    ])
    expect(ch[0]!.startTick).toBe(0)
    expect(ch.at(-1)!.endTick).toBe(f1.tickCount)
    for (let i = 1; i < ch.length; i++) expect(ch[i]!.startTick).toBe(ch[i - 1]!.endTick)
    expect(ch[0]!.label).toBe('segment 1')
  })
  test('E0 (no segment kinds): single run-spanning chapter', () => {
    expect(deriveChapters(e0)).toEqual([{ startTick: 0, endTick: e0.tickCount, label: 'run' }])
  })
})

describe('chapter labeling (pure, lead-in branch)', () => {
  // F1's first MotionSegmentStarted lands at tick 0, so no real fixture exercises the
  // lead-in branch (prelude === true) inside deriveChapters. chapterLabel is extracted so
  // that path gets direct coverage without a hand-built RunModel stub.
  test('prelude=true: index 0 is lead-in, subsequent indices are segment N (1-based off the prelude)', () => {
    expect(chapterLabel(true, 0)).toBe('lead-in')
    expect(chapterLabel(true, 1)).toBe('segment 1')
    expect(chapterLabel(true, 2)).toBe('segment 2')
  })
  test('prelude=false: segment N is 1-based from index 0', () => {
    expect(chapterLabel(false, 0)).toBe('segment 1')
    expect(chapterLabel(false, 1)).toBe('segment 2')
  })
})

describe('normalizeStarts (defensive normalization of segment starts)', () => {
  // The upstream decoder does NOT enforce tick monotonicity and duplicate segment ticks
  // are representable, so deriveChapters must sort+dedupe before mapping -- otherwise
  // degenerate input yields zero-width ([0,0)) or negative-width ([8,3)) chapters. These
  // pin the helper in isolation, independent of any RunModel plumbing.
  test('dedupes duplicate ticks (ascending): [0,0,5] -> [0,5]', () => {
    expect(normalizeStarts([0, 0, 5])).toEqual([0, 5])
  })
  test('sorts out-of-order ticks: [8,3] -> [3,8]', () => {
    expect(normalizeStarts([8, 3])).toEqual([3, 8])
  })
  test('empty input -> empty output', () => {
    expect(normalizeStarts([])).toEqual([])
  })
  test('already-sorted, no-duplicates input passes through by value as a NEW array', () => {
    const input = [0, 24, 48]
    const out = normalizeStarts(input)
    expect(out).toEqual([0, 24, 48])
    expect(out).not.toBe(input) // spec: always returns a new array, never the input reference
  })
  test('does not mutate the caller array', () => {
    const input = [8, 3, 3, 0]
    const snapshot = [...input]
    const out = normalizeStarts(input)
    expect(input).toEqual(snapshot) // original contents untouched
    expect(out).not.toBe(input) // returned a distinct array
    expect(out).toEqual([0, 3, 8])
  })
})

describe('chapterBands (pure tick-span → pixel-band geometry)', () => {
  // Pure geometry: x = startTick/tickCount * width, w = (endTick-startTick)/tickCount * width.
  // Timeline calls this with width=1 to precompute fraction-domain bands, then scales by the live
  // canvas width in the rAF loop (arithmetic only, zero per-frame allocation).
  test('F1-shaped: three tick spans map to contiguous pixel bands over a given width', () => {
    const chapters = [
      { startTick: 0, endTick: 24, label: 'segment 1' },
      { startTick: 24, endTick: 48, label: 'segment 2' },
      { startTick: 48, endTick: 64, label: 'segment 3' },
    ]
    const bands = chapterBands(chapters, 64, 1200)
    expect(bands).toEqual([
      { x: 0, w: 450, label: 'segment 1' },
      { x: 450, w: 450, label: 'segment 2' },
      { x: 900, w: 300, label: 'segment 3' },
    ])
    // contiguous: each band starts where the previous ended; the run fills the full width edge-to-edge
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.x).toBe(bands[i - 1]!.x + bands[i - 1]!.w)
    expect(bands.at(-1)!.x + bands.at(-1)!.w).toBe(1200)
  })
  test('single chapter (E0-shaped) spans the full width', () => {
    expect(chapterBands([{ startTick: 0, endTick: 40, label: 'run' }], 40, 800)).toEqual([
      { x: 0, w: 800, label: 'run' },
    ])
  })
  // Adversarial finding: x and w were independently derived (start/tc*width, span/tc*width), so a
  // shared boundary tick (chapter i's endTick === chapter i+1's startTick) could round to two
  // different float64 values -- x+w drifting a ULP past the next band's x -- which shows up as a
  // visible seam under the alternating tint. [1,3)/[3,5) over tickCount=5 at width=100.5 is a
  // pinned repro: the naive (start/tc*width, span/tc*width) form yields 60.300000000000004 !==
  // 60.3. The fix derives w from a shared END expression (endTick/tc*width -- textually identical
  // to the next band's x expression) so adjacent bands butt EXACTLY, not just visually-close.
  test('shared boundary ticks produce EXACTLY touching bands (no float-ULP seam) at a non-round width', () => {
    const chapters = [
      { startTick: 1, endTick: 3, label: 'a' },
      { startTick: 3, endTick: 5, label: 'b' },
    ]
    const bands = chapterBands(chapters, 5, 100.5)
    expect(bands[0]!.x + bands[0]!.w).toBe(bands[1]!.x)
  })
})

describe('chapterAt (hover-identity chapter lookup)', () => {
  const chapters = [
    { startTick: 0, endTick: 24, label: 'segment 1' },
    { startTick: 24, endTick: 48, label: 'segment 2' },
    { startTick: 48, endTick: 64, label: 'segment 3' },
  ]
  test('an interior tick resolves to its containing band; boundaries belong to the later band', () => {
    expect(chapterAt(chapters, 0)!.label).toBe('segment 1')
    expect(chapterAt(chapters, 23)!.label).toBe('segment 1')
    expect(chapterAt(chapters, 24)!.label).toBe('segment 2') // boundary tick opens the next segment
    expect(chapterAt(chapters, 47)!.label).toBe('segment 2')
    expect(chapterAt(chapters, 48)!.label).toBe('segment 3')
  })
  test('the extreme-right tick (tick === tickCount, clamped by tickAtX) falls through to the last band', () => {
    expect(chapterAt(chapters, 64)!.label).toBe('segment 3') // no endTick exceeds 64 → last band owns it
  })
  test('an empty chapter list answers null (nothing to identify)', () => {
    expect(chapterAt([], 5)).toBeNull()
  })
})

describe('deriveChapters regression guard (well-ordered F1 input unchanged by normalization)', () => {
  // Normalization must be a no-op for well-formed, monotonic input. This re-pins the exact
  // F1 chaptering so the sort+dedupe refactor is proven not to perturb the happy path.
  test('F1: chaptering is byte-for-byte identical after normalization', () => {
    expect(deriveChapters(f1)).toEqual([
      { startTick: 0, endTick: 24, label: 'segment 1' },
      { startTick: 24, endTick: 48, label: 'segment 2' },
      { startTick: 48, endTick: 64, label: 'segment 3' },
    ])
  })
})
