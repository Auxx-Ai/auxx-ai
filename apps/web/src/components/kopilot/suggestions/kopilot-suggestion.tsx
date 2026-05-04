// apps/web/src/components/kopilot/suggestions/kopilot-suggestion.tsx

'use client'

import { useEffect, useId } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'
import type { SuggestionIcon } from './types'

interface KopilotSuggestionProps {
  /** Literal text inserted into the composer (or fired) on click. */
  text: string
  /** Optional icon for the suggestion row. */
  icon?: SuggestionIcon
  /** Sort priority. Higher numbers appear first. Default: 0. */
  priority?: number
  /** When true, click fires the turn immediately. When false (default), the
   * composer is populated and focused for the user to edit/send. */
  autoSubmit?: boolean
}

/**
 * Distributed page-suggestion contributor. Mount one (or many) on a page; each
 * mount registers a slice while alive and unregisters on unmount.
 *
 * Conditional rendering at the call site is the registration condition — wrap
 * each mount in the data check that proves the suggestion is relevant
 * (e.g. `{thread.linkedOrderId && <KopilotSuggestion ... />}`).
 */
export function KopilotSuggestion({
  text,
  icon,
  priority = 0,
  autoSubmit = false,
}: KopilotSuggestionProps): null {
  const id = useId()
  const setSlice = useKopilotStore((s) => s.setSuggestionSlice)
  const clearSlice = useKopilotStore((s) => s.clearSuggestionSlice)

  useEffect(() => {
    setSlice(id, { id, text, icon, priority, autoSubmit })
    return () => clearSlice(id)
  }, [id, text, icon, priority, autoSubmit, setSlice, clearSlice])

  return null
}
