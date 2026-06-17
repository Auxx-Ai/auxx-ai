// apps/web/src/components/kbar/contextual/command-action.tsx
'use client'

import { useEffect, useId, useRef } from 'react'
import { useScopeGroupLabel } from './command-context'
import { useContextualActionsStore } from './contextual-store'

interface CommandActionProps {
  /**
   * Stable id. Optional — falls back to `useId()`. An explicit id helps when a
   * surface conditionally remounts the same logical row.
   */
  id?: string
  label: string
  subtitle?: string
  icon?: string
  keywords?: string
  /** Chord hint — rendered as a `Kbd` chip, bound to NO global hotkey. */
  shortcut?: string[]
  /** Group label override. Defaults to the enclosing scope, then `'Actions'`. */
  group?: string
  disabled?: boolean
  /** Higher = listed first within its group. Default 0. */
  priority?: number
  perform: () => void
}

/**
 * Distributed command-palette row contributor. Mount inside (or beside) a
 * `<CommandContext>`; registers a slice while alive and clears it on unmount.
 *
 * **Stable perform via ref:** the latest `perform` closure is kept in a ref and
 * the registered wrapper is `() => ref.current()`. `perform` is excluded from
 * the effect deps so a fresh closure each parent render does NOT thrash
 * register/clear — the row stays mounted while the page re-renders (e.g. typing
 * in a search box) and still reads live state at fire time.
 */
export function CommandAction({
  id: explicitId,
  label,
  subtitle,
  icon,
  keywords,
  shortcut,
  group,
  disabled,
  priority,
  perform,
}: CommandActionProps): null {
  const generatedId = useId()
  const id = explicitId ?? generatedId

  const performRef = useRef(perform)
  performRef.current = perform

  const setSlice = useContextualActionsStore((s) => s.setActionSlice)
  const clearSlice = useContextualActionsStore((s) => s.clearActionSlice)

  const inheritedGroup = useScopeGroupLabel()
  const resolvedGroup = group ?? inheritedGroup ?? 'Actions'

  const shortcutKey = shortcut?.join('|')

  // `perform` rides on `performRef` (excluded so a fresh closure each render
  // doesn't thrash register/clear); `shortcut` is tracked via the stable
  // `shortcutKey` to avoid array-identity churn; `explicitId` folds into `id`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see note above
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && explicitId !== undefined) {
      if (useContextualActionsStore.getState().actionSlices[id]) {
        console.warn(
          `[CommandAction] duplicate explicit id "${id}" — a surface is double-mounted; ` +
            'the rows will clobber each other. Use a unique id per mount.'
        )
      }
    }
    setSlice(id, {
      id,
      label,
      ...(subtitle ? { subtitle } : {}),
      ...(icon ? { icon } : {}),
      ...(keywords ? { keywords } : {}),
      ...(shortcut ? { shortcut } : {}),
      group: resolvedGroup,
      ...(disabled ? { disabled } : {}),
      ...(priority !== undefined ? { priority } : {}),
      perform: () => performRef.current(),
    })
    return () => clearSlice(id)
  }, [
    id,
    label,
    subtitle,
    icon,
    keywords,
    shortcutKey,
    resolvedGroup,
    disabled,
    priority,
    setSlice,
    clearSlice,
  ])

  return null
}
