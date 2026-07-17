// A small header disclosure — a trigger button that opens a popup of menu items. ONE component backs
// both the ladder's `run ▾` picker and the `⋯` overflow menu (the two narrow-width condensations),
// so the open/close, focus, and keyboard behavior are defined once and cannot drift between them. DOM
// only — no WebGL, no frame path.
//
// KEYBOARD OWNERSHIP — the modal idiom, mirrored, IDENTITY-KEYED and SYNCHRONOUS. While open the
// disclosure claims the keyboard the SAME way the Hangar/Wall modals do, but ownership is a token keyed
// by this instance's stable `menuId` (App holds `activeMenu: 'picker' | 'overflow' | null`). Claim and
// release fire SYNCHRONOUSLY from the event handlers themselves (open / Esc / outside-press / focus-exit
// / child-action / unmount) — never from a passive effect, so App's window keydown owner sees a close the
// instant it happens. Release is CONDITIONAL on identity (App only clears the token if THIS menu holds
// it), so a second instance mounting or unmounting can never clear another's claim — the exact tier-change
// bug where the newly-mounted `⋯` cleared the still-open picker's ownership. The popup ALSO stops
// propagation as a second belt for the window.
//
// CLOSE-ON-FOCUS-EXIT — the robust close. The menu is only ever open while focus lives inside its subtree:
// a Tab past the last item, or a menu item opening a modal (focus moves into the modal), fires `focusout`
// leaving the wrapper and closes the menu, so no stale-open menu lingers behind another surface. Esc
// (caught at the document in the capture phase so it beats the window owner) closes and returns focus to
// the trigger; an outside pointer press (for clicks on non-focusable canvas, which fire no blur) closes
// too. Every listener lives in the open-gated effect, so all of them UNREGISTER the moment the menu closes.
//
// FOCUS RESTORE ON CHILD ACTION — an item that opens a modal/panel (Hangar, the mobile panel toggles)
// closes the menu through `close`, which SYNCHRONOUSLY restores focus to the trigger FIRST. So the modal
// snapshots the trigger (a stable element) as its opener — not `document.body`, which a bare popup unmount
// would leave focused — and its Esc returns focus to the trigger; a panel action leaves focus on the
// trigger, never on body. Items call `close()` BEFORE their action so the restore precedes the snapshot.
//
// Items are native <button>s, so Enter/Space/click activate them normally.

import { useEffect, useId, useRef, useState, type ReactNode, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export function HeaderMenu({ menuId, label, ariaLabel, className, onOwnership, children }: {
  menuId: string                // stable ownership identity ('picker' | 'overflow') — App keys the token on this
  label: ReactNode              // the trigger's visible content (e.g. `run ▾` or `⋯`)
  ariaLabel: string             // the trigger's complete accessible name (the visible label may be a glyph)
  className?: string            // an extra class on the wrapper (e.g. 'run-picker' / 'header-overflow')
  onOwnership?: (id: string, open: boolean) => void // claim (open=true) / release (open=false), keyed by menuId
  children: (close: () => void) => ReactNode // the menu items, given a `close` that restores focus to the trigger
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popupId = useId()

  const items = (): HTMLButtonElement[] => Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])

  // The transition paths — each updates BOTH the popup state and the ownership token SYNCHRONOUSLY.
  const openMenu = () => { setOpen(true); onOwnership?.(menuId, true) }
  const closeMenu = () => { setOpen(false); onOwnership?.(menuId, false) }               // no focus move (outside-press / focus-exit)
  const closeToTrigger = () => { triggerRef.current?.focus(); setOpen(false); onOwnership?.(menuId, false) } // Esc / child-action

  // Release ownership on UNMOUNT (a tier change that unmounts this menu while it is open). App's release
  // is identity-conditional, so this is a no-op when this instance does not hold the token — an unmounting
  // menu never clears another's claim.
  // (unmount-only cleanup; onOwnership + menuId are stable, this config does not enforce exhaustive-deps)
  useEffect(() => () => onOwnership?.(menuId, false), [])

  // On open: move focus to the first item, and close on Esc (return focus to the trigger) or on any outside
  // pointer press. Esc is caught at the document in the capture phase so it closes THIS menu before the
  // app's window keydown owner could read it. Every listener is torn down on close/unmount.
  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeToTrigger() }
    }
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (!popupRef.current?.contains(t) && !triggerRef.current?.contains(t)) closeMenu()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open])

  // Close when focus leaves the disclosure subtree (Tab away, or an item that opened a modal moved focus
  // into it). React's onBlur bubbles, so this fires for any descendant losing focus; relatedTarget is the
  // element gaining focus (null = focus left to nowhere). The programmatic first-item focus on open, and
  // the child-action focus restore to the trigger, both keep relatedTarget inside the wrapper — so neither
  // self-closes here (the explicit close paths own those transitions).
  const onWrapBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (!open) return
    const next = e.relatedTarget as Node | null
    if (!next || !wrapRef.current?.contains(next)) closeMenu()
  }

  // The trigger's open keys. Enter is unmapped by the transport grammar, so it activates the trigger
  // natively (→ onClick → openMenu); Space and the arrows are shielded (stopPropagation) so they open the
  // menu here instead of reaching the window owner (Space would otherwise toggle playback and blur this).
  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation(); openMenu()
    }
  }

  // The open popup owns the keyboard (a second belt beside App's explicit-state guard). Every key stops
  // propagating to the window transport owner; the navigation keys are handled here, and Enter/Space fall
  // through to activate the focused item natively (no preventDefault on them, so the native click fires).
  const onPopupKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const it = items()
      if (it.length === 0) return
      const i = it.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        e.key === 'Home' ? 0 :
        e.key === 'End' ? it.length - 1 :
        e.key === 'ArrowDown' ? (i + 1) % it.length :
        (i - 1 + it.length) % it.length
      it[next]?.focus()
    }
  }

  return (
    <div ref={wrapRef} className={className ? `header-menu ${className}` : 'header-menu'} onBlur={onWrapBlur}>
      <button
        ref={triggerRef}
        className="header-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKey}
      >{label}</button>
      {open && (
        <div ref={popupRef} id={popupId} className="header-menu-popup" role="menu" onKeyDown={onPopupKey}>
          {children(closeToTrigger)}
        </div>
      )}
    </div>
  )
}
