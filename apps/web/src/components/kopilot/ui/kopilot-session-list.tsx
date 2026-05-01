// apps/web/src/components/kopilot/ui/kopilot-session-list.tsx

'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { useCallback, useEffect, useRef } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useKopilotSessions } from '../hooks/use-kopilot-sessions'
import { useKopilotStore } from '../stores/kopilot-store'

export interface KopilotSessionListProps {
  /** Called when the user picks a session. */
  onSelectSession: (sessionId: string) => void
  /**
   * Called when the user deletes the currently active session. The host is
   * responsible for moving the user somewhere sensible (e.g. /app/kopilot/new).
   * If omitted, the store's `startNewSession` runs.
   */
  onActiveSessionDeleted?: () => void
}

/**
 * Reusable session-switcher body — search, select, rename, delete. Designed
 * to mount inside any container (popover, breadcrumb dropdown, etc.).
 *
 * Note: must live inside a Popover (not a Radix DropdownMenu) because the
 * underlying MultiSelectPicker is built on `cmdk`, which manages its own
 * arrow-key navigation.
 */
export function KopilotSessionList({
  onSelectSession,
  onActiveSessionDeleted,
}: KopilotSessionListProps) {
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const startNewSession = useKopilotStore((s) => s.startNewSession)

  const { sessionOptions, isLoading, deleteSession, updateTitle } = useKopilotSessions()

  const prevSessionOptionsRef = useRef<SelectOption[]>(sessionOptions)
  useEffect(() => {
    prevSessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  const handleOptionsChange = useCallback(
    (updatedOptions: SelectOption[]) => {
      const previous = prevSessionOptionsRef.current

      for (const opt of updatedOptions) {
        const prev = previous.find((p) => p.value === opt.value)
        if (prev && prev.label !== opt.label) {
          updateTitle.mutate({ sessionId: opt.value, title: opt.label })
        }
      }

      for (const prev of previous) {
        if (!updatedOptions.find((o) => o.value === prev.value)) {
          deleteSession.mutate({ sessionId: prev.value })
          if (prev.value === activeSessionId) {
            if (onActiveSessionDeleted) onActiveSessionDeleted()
            else startNewSession()
          }
        }
      }
    },
    [activeSessionId, deleteSession, updateTitle, startNewSession, onActiveSessionDeleted]
  )

  return (
    <MultiSelectPicker
      options={sessionOptions}
      value={activeSessionId ? [activeSessionId] : []}
      onChange={() => {}}
      multi={false}
      onSelectSingle={onSelectSession}
      canManage={true}
      canAdd={false}
      manageLabel='Manage chats'
      placeholder='Search chats...'
      isLoading={isLoading}
      onOptionsChange={handleOptionsChange}
    />
  )
}
