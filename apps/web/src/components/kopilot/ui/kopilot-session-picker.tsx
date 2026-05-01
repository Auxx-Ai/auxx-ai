// apps/web/src/components/kopilot/ui/kopilot-session-picker.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useKopilotSessions, useLoadSession } from '../hooks/use-kopilot-sessions'
import { useKopilotStore } from '../stores/kopilot-store'
import { KopilotSessionList } from './kopilot-session-list'

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

  const { sessionOptions } = useKopilotSessions()
  const loadSession = useLoadSession()

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

  const handleActiveDeleted = useCallback(() => {
    if (onNewSession) onNewSession()
    else startNewSession()
  }, [onNewSession, startNewSession])

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
        <KopilotSessionList
          onSelectSession={handleSelect}
          onActiveSessionDeleted={handleActiveDeleted}
        />
      </PopoverContent>
    </Popover>
  )
}
