// apps/web/src/components/kopilot/ui/kopilot-panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Expand, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'
import { KopilotChat } from './kopilot-chat'
import { KopilotSessionPicker } from './kopilot-session-picker'

export interface KopilotPanelProps {
  /** Current page context (e.g. 'mail') */
  page: string
  /** Page-specific context */
  context?: Record<string, unknown>
}

export function KopilotPanel({ page, context }: KopilotPanelProps) {
  const router = useRouter()
  const setPanelOpen = useKopilotStore((s) => s.setPanelOpen)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const startNewSession = useKopilotStore((s) => s.startNewSession)

  const handleNewSession = useCallback(() => {
    startNewSession()
  }, [startNewSession])

  const handleExpand = useCallback(() => {
    const path = activeSessionId ? `/app/kopilot/${activeSessionId}` : '/app/kopilot/new'
    setPanelOpen(false)
    router.push(path)
  }, [activeSessionId, setPanelOpen, router])

  return (
    <div className='flex h-full flex-col'>
      <DrawerHeader
        title={<KopilotSessionPicker />}
        actions={
          <div className='flex items-center gap-0.5'>
            <Button variant='ghost' size='icon' className='size-7' onClick={handleNewSession}>
              <Plus className='size-3.5' />
            </Button>
            <Button variant='ghost' size='icon' className='size-7' onClick={handleExpand}>
              <Expand className='size-3.5' />
            </Button>
          </div>
        }
        onClose={() => setPanelOpen(false)}
      />
      <KopilotChat page={page} context={context} />
    </div>
  )
}
