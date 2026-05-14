// apps/web/src/components/agents/ui/detail/agent-hero.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail } from '../../store/agent-store'
import { AgentGeneralDialog, type AgentGeneralFormValues } from '../dialogs/agent-general-dialog'
import { AgentAvatar } from '../shared/agent-avatar'

interface AgentHeroProps {
  agent: AgentDetail
}

export function AgentHero({ agent }: AgentHeroProps) {
  const isArchived = !!agent.archivedAt
  const [editing, setEditing] = useState(false)
  const { updateAgent, isUpdating } = useAgentMutations()

  const handleSubmit = async (values: AgentGeneralFormValues) => {
    const ok = await updateAgent(agent.id, {
      name: values.name,
      description: values.description ? values.description : null,
    })
    if (ok) setEditing(false)
  }

  return (
    <>
      <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
        <AgentAvatar agent={agent} size={12} />
        <div className='flex flex-col align-start flex-1 min-w-0'>
          <div className='flex items-center gap-2'>
            <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate'>
              {agent.name || 'Untitled'}
            </div>
            {isArchived ? (
              <Badge variant='secondary'>Archived</Badge>
            ) : (
              <Badge variant='secondary'>Active</Badge>
            )}
          </div>
          <div className='text-xs text-neutral-500 truncate'>
            <code className='text-xs'>@{agent.slug}</code>
            {agent.description ? <span> · {agent.description}</span> : null}
          </div>
        </div>
        <Button variant='outline' size='sm' onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </div>

      <AgentGeneralDialog
        open={editing}
        onOpenChange={setEditing}
        mode='edit'
        lockSlug
        initialValues={{
          name: agent.name ?? '',
          slug: agent.slug,
          description: agent.description ?? '',
        }}
        isSubmitting={isUpdating}
        onSubmit={handleSubmit}
      />
    </>
  )
}
