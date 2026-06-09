// apps/web/src/components/agents/ui/detail/setup/agent-setup-mode.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Sparkles } from 'lucide-react'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import { deriveSetupProgress } from './derive-setup-step'
import { SetupProgressBar } from './setup-progress-bar'

interface AgentSetupModeProps {
  agent: AgentDetail
}

/**
 * Setup-mode rail surface. Rendered in place of `AgentDetailTabs` while
 * `agent.setupCompletedAt == null`. The docked Kopilot chat stays mounted
 * alongside; this panel is a passive carousel that reflects the agent's
 * current setup phase.
 */
export function AgentSetupMode({ agent }: AgentSetupModeProps) {
  const utils = api.useUtils()
  const completeSetup = api.agent.completeSetup.useMutation()

  const handleMarkComplete = useCallback(async () => {
    try {
      await completeSetup.mutateAsync({ agentId: agent.id })
      await Promise.all([utils.agent.list.invalidate(), utils.agent.getById.invalidate()])
    } catch (error) {
      toastError({
        title: 'Could not complete setup',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }, [agent.id, completeSetup, utils.agent.getById, utils.agent.list])

  const { current, index, completeness } = deriveSetupProgress(agent)

  return (
    <ScrollArea className='flex-1 min-h-0'>
      <div className='mx-auto flex-1 flex max-w-2xl flex-col items-center justify-between gap-8 px-6 pt-12 pb-6 text-center'>
        <div className='flex flex-col items-center gap-1'>
          <p className='text-xs font-mono uppercase tracking-widest text-muted-foreground '>
            Step {index} of 4
          </p>
          <p className='text-sm font-mono'>{current.subtitle}</p>
        </div>
        <div className='flex flex-col items-center justify-center gap-4'>
          <SetupProgressBar value={completeness} />
          <p className='text-xs italic text-muted-foreground'>{current.description}</p>
        </div>
        <div className='pt-4'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={handleMarkComplete}
            loading={completeSetup.isPending}
            loadingText='Finalizing…'>
            Configure manually...
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
