import { useSyncExternalStore } from 'react'
import { headerTier, headerLayout, runSwitcherForm, type HeaderLayout } from './headerModel'

// Live viewport width → header layout, as a React external store. The layout is a STEP function of width
// (the tier ladder plus the button-row fit floor inside the full tier), so the header must re-render when
// the width crosses ANY of those breakpoints — including the switcher floor, which lives inside the full
// tier and so is invisible to a tier-only classifier. useSyncExternalStore compares snapshots by reference,
// so getSnapshot returns the SAME layout object while the width stays in one band and a fresh one only when
// a crossing changes the layout: cache on the (tier, switcher-form) discriminant — the only two inputs to
// the layout — so an unchanged discriminant yields a stable reference (no re-render) and a crossing flips
// it. The header thus re-renders at breakpoints, never per resize pixel or per animation frame.
// getServerSnapshot returns the wide-end default (no SSR here; present only to satisfy the hook contract).
function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

let discriminant = ''
let cached: HeaderLayout = headerLayout('full')

function getSnapshot(): HeaderLayout {
  const width = window.innerWidth
  const tier = headerTier(width)
  const key = `${tier}:${runSwitcherForm(width)}`
  if (key !== discriminant) {
    discriminant = key
    cached = headerLayout(tier, width)
  }
  return cached
}

function getServerSnapshot(): HeaderLayout {
  return headerLayout('full')
}

export function useHeaderLayout(): HeaderLayout {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
