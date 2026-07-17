import type { Tour } from '../tour/tourTypes'

// Bottom-center floating caption bar for an active guided tour. Rendered from the useTour handle in
// App: a step-progress dot row, the current caption (aria-live so a screen reader announces each new
// step), and a × stop button that calls the hook's stop() directly. Returns null when no tour is
// active — the bar is hidden entirely, never a stale empty shell. Positioned above the timeline row
// (bottom offset clears it) and centered so it never reaches the bottom-right dev perf overlay corner.
export function TourOverlay({
  active, stepIndex, caption, onStop,
}: {
  active: Tour | null
  stepIndex: number
  caption: string | null
  onStop: () => void
}) {
  if (!active) return null
  const total = active.steps.length
  return (
    <div className="tour-overlay" role="group" aria-label={`guided tour: ${active.title}`}>
      {/* Tour TITLE — names the surface the tour is running on, shown here on the tour's own overlay
          (the Hangar's launch chips already name each lens they start). No new chrome — it just labels the
          surface. aria-hidden because the group's aria-label already announces the same title to assistive
          tech (no double read). */}
      <p className="tour-title" aria-hidden="true">{active.title}</p>
      <div className="tour-row">
        {/* Progress dots: filled for done+current (current accented), hollow for pending. Decorative —
            aria-hidden; the same progress is spoken via the aria-live caption below. */}
        <div className="tour-dots" aria-hidden="true">
          {active.steps.map((_, i) => (
            <span
              key={i}
              className={`tour-dot ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'pending'}`}
            />
          ))}
        </div>
        <p className="tour-caption" aria-live="polite">{caption}</p>
        <span className="tour-count" aria-hidden="true">{stepIndex + 1}/{total}</span>
        <button className="tour-stop" aria-label="stop tour" onClick={onStop}>×</button>
      </div>
    </div>
  )
}
