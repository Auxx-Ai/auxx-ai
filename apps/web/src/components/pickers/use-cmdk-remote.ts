// apps/web/src/components/pickers/use-cmdk-remote.ts

'use client'

import { useCallback, useEffect } from 'react'

export interface CmdkRemoteHandle {
  /** Move list highlight up (-1) or down (+1). Returns whether handled. */
  moveHighlight: (direction: 1 | -1) => boolean
  /** Confirm the currently-highlighted item. Returns whether handled. */
  confirmHighlighted: () => boolean
}

/**
 * Drive a cmdk list WITHOUT focus. Picker chips (`@` / `/`) keep typing
 * focus inside the TipTap editor, so arrow/Enter keys never reach cmdk —
 * the chip's keyboard plugin forwards them here instead.
 *
 * cmdk children render their own `<Command>` roots, so we must not wrap
 * them in another one. To drive selection in the inner cmdk root we
 * dispatch native `pointermove` events on the target item; cmdk's
 * CommandItem reacts to pointer-over by setting itself as selected. This
 * path doesn't require focus on a CommandInput (which would steal focus
 * from the tiptap chip).
 *
 * `resetKey`: whenever it changes (tab switch, query change, drill), the
 * first visible item is re-highlighted once the (possibly async) list has
 * rendered — a microtask + MutationObserver covers react-query loads.
 */
export function useCmdkRemote(
  containerRef: React.RefObject<HTMLElement | null>,
  resetKey: string
): CmdkRemoteHandle {
  const getEnabledItems = useCallback(() => {
    const root = containerRef.current?.querySelector('[cmdk-root]')
    if (!root) return [] as HTMLElement[]
    return Array.from(root.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])'))
  }, [containerRef])

  const selectItemByPointer = useCallback((el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true }))
    el.scrollIntoView({ block: 'nearest' })
  }, [])

  // Auto-highlight the first visible item whenever the list might have
  // changed.
  useEffect(() => {
    // `resetKey` is an effect input by design: a tab switch / query change /
    // drill re-runs the highlight pass even though the value isn't read.
    void resetKey
    const root = containerRef.current
    if (!root) return
    const tryHighlight = () => {
      const items = getEnabledItems()
      if (items.length === 0) return
      // Only paint if nothing's selected yet.
      const cmdkRoot = root.querySelector('[cmdk-root]')
      const alreadySelected = cmdkRoot?.querySelector('[cmdk-item][data-selected="true"]')
      if (alreadySelected) return
      selectItemByPointer(items[0]!)
    }
    tryHighlight()
    const mo = new MutationObserver(tryHighlight)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [containerRef, getEnabledItems, selectItemByPointer, resetKey])

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      const items = getEnabledItems()
      if (items.length === 0) return false
      const currentEl = items.find((el) => el.getAttribute('data-selected') === 'true')
      const currentIdx = currentEl ? items.indexOf(currentEl) : -1
      const nextIdx = (currentIdx + direction + items.length) % items.length
      const next = items[nextIdx]
      if (!next) return false
      selectItemByPointer(next)
      return true
    },
    [getEnabledItems, selectItemByPointer]
  )

  const confirmHighlighted = useCallback(() => {
    const root = containerRef.current?.querySelector('[cmdk-root]')
    if (!root) return false
    const current = root.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')
    if (!current) return false
    // cmdk's CommandItem wires onSelect to a click handler internally.
    current.click()
    return true
  }, [containerRef])

  return { moveHighlight, confirmHighlighted }
}
