import { useSyncExternalStore } from 'react'
import { headerTier, type HeaderTier } from './headerModel'

// Live viewport width → header tier, as a React external store. useSyncExternalStore returns a stable
// PRIMITIVE (the tier string), so a re-render fires ONLY when the width crosses a ladder threshold, not
// on every resize pixel — the classifier (headerTier) is the single source of the breakpoints, shared
// with the unit-tested pure model. getServerSnapshot returns 'full' as the render-time default (there
// is no SSR here; it is present only to satisfy the hook contract). Not on the frame path — the header
// re-renders at resize rate, never per animation frame.
function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function getSnapshot(): HeaderTier {
  return headerTier(window.innerWidth)
}

function getServerSnapshot(): HeaderTier {
  return 'full'
}

export function useHeaderTier(): HeaderTier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
