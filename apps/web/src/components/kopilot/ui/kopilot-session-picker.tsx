// apps/web/src/components/kopilot/ui/kopilot-session-picker.tsx

'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useKopilotSessions, useLoadSession } from '../hooks/use-kopilot-sessions'
import { useKopilotStore } from '../stores/kopilot-store'

export interface KopilotSessionPickerProps {
  variant?: 'ghost' | 'outline'
  /** Called when user selects a session. If not provided, uses loadSession directly. */
  onSessionChange?: (sessionId: string) => void
  /** Called when user creates a new session */
  onNewSession?: () => void
}

export function KopilotSessionPicker({
  variant = 'ghost',
  onSessionChange,
  onNewSession,
}: KopilotSessionPickerProps) {
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const startNewSession = useKopilotStore((s) => s.startNewSession)

  const [open, setOpen] = useState(false)

  const {
    sessionOptions,
    isLoading: isLoadingSessions,
    deleteSession,
    updateTitle,
  } = useKopilotSessions()
  const loadSession = useLoadSession()

  const prevSessionOptionsRef = useRef<SelectOption[]>(sessionOptions)
  useEffect(() => {
    prevSessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  const handleSelect = useCallback(
    (sessionId: string) => {
      if (onSessionChange) {
        onSessionChange(sessionId)
      } else {
        loadSession(sessionId)
      }
      setOpen(false)
    },
    [onSessionChange, loadSession]
  )

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
            if (onNewSession) {
              onNewSession()
            } else {
              startNewSession()
            }
          }
        }
      }
    },
    [activeSessionId, deleteSession, updateTitle, startNewSession, onNewSession]
  )

  const activeSessionTitle = useMemo(() => {
    if (!activeSessionId) return 'New session'
    const match = sessionOptions.find((o) => o.value === activeSessionId)
    return match?.label || 'New session'
  }, [activeSessionId, sessionOptions])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size='sm' className='h-7 max-w-full gap-1'>
          <span className='truncate'>{activeSessionTitle}</span>
          <ChevronDown className='size-3 shrink-0' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-0' align='start'>
        <MultiSelectPicker
          options={sessionOptions}
          value={activeSessionId ? [activeSessionId] : []}
          onChange={() => {}}
          multi={false}
          onSelectSingle={handleSelect}
          canManage={true}
          canAdd={false}
          manageLabel='Manage chats'
          placeholder='Search chats...'
          isLoading={isLoadingSessions}
          onOptionsChange={handleOptionsChange}
        />
      </PopoverContent>
    </Popover>
  )
}
