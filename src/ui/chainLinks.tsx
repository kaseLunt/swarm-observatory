// ChainLinks (extracted MOVE-ONLY from Scene.tsx): cross-entity causal-link segments
// for the selected event's chain, interpolated to track the moving deltas exactly.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import type { RunModel } from '../model/runModel'
import { useViewStore } from '../state/viewStore'
import { entityPosition, lerp3 } from './placement'
import { resolveCursorInto, eventTickOf, type FrameCursor } from './cursor'
import type { StateFrame, TransportTick } from '../lib/brand'
import { PALETTE } from './theme'
import { causalNeighborhood, HORIZON_OPTS } from './chain'

// Module-scope scratch OWNED by this file: the link-endpoint interpolation below reuses
// these tuples every frame with zero allocation (the load budget). Before the split ChainLinks borrowed Scene's scratch,
// which held together only because r3f runs Entities' frame callback first — an implicit cross-component
// ordering contract this file-local scratch retires (9 numbers buy the independence).
const scratchA: [number, number, number] = [0, 0, 0]
const scratchB: [number, number, number] = [0, 0, 0]
const scratchP: [number, number, number] = [0, 0, 0]
// The link frame-loop cursor: reused every frame (the load budget; file-local like the tuples above).
const linkCursor: FrameCursor = { t0: 0 as StateFrame, t1: 0 as StateFrame }

// The worst-case member count of the HORIZON_OPTS neighbourhood: self + maxHop single-parent ancestors +
// maxHop levels each capped at maxPerHop descendants. Every cross-entity link segment is owned by one member
// (its parent edge), so links ≤ members − 1 ≤ this — the buffer holds the whole bounded neighbourhood and there
// is NO second, buffer-level drop: the neighbourhood's maxPerHop is the ONE bound, and its summary declares any cut.
const MAX_LINK_MEMBERS = 1 + HORIZON_OPTS.maxHop * (1 + HORIZON_OPTS.maxPerHop)
export function ChainLinks({ model }: { model: RunModel }) {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  // Flat parallel arrays (not an array of [a, b] tuples): useFrame below iterates this by index,
  // so building tuples/pairs here (off the frame loop) keeps the frame path allocation-free —
  // `for (const [a, b] of pairs)` would allocate a fresh iterator (and destructure a fresh array)
  // every single frame.
  const chainRef = useRef<{ a: string[]; b: string[] } | null>(null)
  // Stable buffer identity: allocate the positions buffer once so re-renders can't churn the
  // attribute (a `new Float32Array(...)` inline in the JSX below would reallocate on every render).
  const positions = useMemo(() => new Float32Array(MAX_LINK_MEMBERS * 2 * 3), [])
  // Zero-fill the buffer's drawRange at mount: the geometry mounts with MAX_LINKS*2 zero-filled
  // vertices and Three's default drawRange (Infinity) would draw all of them — a flash of
  // degenerate lines at the origin — before the first useFrame tick narrows it down.
  useEffect(() => { geoRef.current?.setDrawRange(0, 0) }, [])
  // Recompute the cross-entity link pairs off the frame loop (subscription effect → ref); the
  // useFrame below only reads the ref and writes preallocated buffer positions.
  useEffect(() => {
    const compute = (ev: number | null) => {
      if (ev === null) { chainRef.current = null; return }
      // ONE bounded neighbourhood (HORIZON_OPTS) — the SAME call the timeline overlay (chainTicks) and the stage
      // route through, so the 3D links can never draw an edge the horizon lights don't (the disagreement class is
      // dead by construction). A cross-entity segment is drawn ONLY when BOTH endpoints are members, exactly the
      // both-endpoints rule chainTicks uses for its arcs — a boundary member whose parent fell past the horizon
      // draws no dangling link. The old unbounded causalChain + silent 256-cap drop is gone: membership is bounded
      // by maxPerHop and any cut is COUNTED into the neighbourhood summary (surfaced by the Inspector chainmeta chip).
      const { members } = causalNeighborhood(model, ev, HORIZON_OPTS)
      const a: string[] = []
      const b: string[] = []
      for (const m of members) {
        const p = model.parentOf(m)
        if (p === null || !members.has(p)) continue
        const sa = model.subjectOf(p); const sb = model.subjectOf(m)
        if (!sa || !sb || sa === sb) continue
        a.push(sa); b.push(sb)
      }
      chainRef.current = { a, b }
    }
    compute(useViewStore.getState().selectedEvent)
    return useViewStore.subscribe((s, prev) => { if (s.selectedEvent !== prev.selectedEvent) compute(s.selectedEvent) })
  }, [model])
  useFrame(() => {
    const geo = geoRef.current
    if (!geo) return
    const chain = chainRef.current
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    if (!chain || chain.a.length === 0) { geo.setDrawRange(0, 0); return }
    // Interpolate link endpoints identically to the deltas (same t0→t1 by the same `fraction`) so the
    // links track moving deltas exactly rather than snapping to tick-exact positions a fraction behind.
    // Reuses this file's OWN module scratch vectors (see top of file) — zero alloc, no cross-component ordering.
    const vs = useViewStore.getState()
    const fraction = vs.fraction
    // The accessor boundary: brand the store playhead (a plain TransportTick) into the event domain, then resolve the
    // cursor. ChainLinks tracks cross-entity links at the raw tick's committed frame — offset 0 (no sensing
    // evaluation shift; the links follow the SAME poses the non-sensing delta renders). This retires the second
    // copy of the hand-rolled successor-clamp cursor idiom (now owned solely by resolveCursor).
    const tick = eventTickOf(vs.tick as TransportTick)
    resolveCursorInto(linkCursor, tick, 0, model.tickCount as StateFrame)
    const s0 = model.entityStatesAt(linkCursor.t0)
    const s1 = model.entityStatesAt(linkCursor.t1)
    let n = 0
    for (let i = 0; i < chain.a.length; i++) {
      const a0 = s0.get(chain.a[i]!); const b0 = s0.get(chain.b[i]!)
      if (!a0 || !b0) continue
      const a1 = s1.get(chain.a[i]!) ?? a0; const b1 = s1.get(chain.b[i]!) ?? b0
      entityPosition(scratchA, a0, 0); entityPosition(scratchB, a1, 0)
      lerp3(scratchP, scratchA, scratchB, fraction)
      pos.setXYZ(n * 2, scratchP[0], scratchP[1], scratchP[2])
      entityPosition(scratchA, b0, 0); entityPosition(scratchB, b1, 0)
      lerp3(scratchP, scratchA, scratchB, fraction)
      pos.setXYZ(n * 2 + 1, scratchP[0], scratchP[1], scratchP[2])
      n++
    }
    pos.needsUpdate = true
    geo.setDrawRange(0, n * 2)
  })
  return (
    // renderOrder 1 (with the selection ring) so the transparent chain composites AFTER the opaque deltas
    // and the depth-writing scene; depthWrite:false so a half-opaque link never punches a hole in the
    // depth buffer that pops the trail / selection ring / grid drawn behind it.
    <lineSegments frustumCulled={false} renderOrder={1}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={PALETTE.timeCursor} transparent opacity={0.5} depthWrite={false} />
    </lineSegments>
  )
}
