// apps/web/src/components/agents/ui/list/agent-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentListItem } from '../../store/agent-store'
import { AgentAvatar } from '../shared/agent-avatar'

interface AgentCardProps {
  agent: AgentListItem
}

export function AgentCard({ agent }: AgentCardProps) {
  const router = useRouter()
  const { archiveAgent, unarchiveAgent, discardDraft } = useAgentMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  const archived = agent.archivedAt != null
  const isDraft = agent.setupCompletedAt == null && !archived
  const statusColor = archived ? 'bg-muted-foreground/40' : 'bg-good-500'
  const statusLabel = archived ? 'Archived' : 'Active'
  const displayName = agent.name ?? 'Untitled agent'

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  const handleNavigate = () => router.push(`/app/agents/${agent.slug}`)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleNavigate()
    }
  }

  const handleArchive = async () => {
    const ok = await confirm({
      title: 'Archive agent?',
      description: `"${displayName}" will stop responding to mentions and triggers.`,
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: false,
    })
    if (ok) await archiveAgent(agent.id)
  }

  const handleDiscardDraft = async () => {
    const ok = await confirm({
      title: 'Discard draft?',
      description: `"${displayName}" hasn't been finished. This permanently deletes it.`,
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) await discardDraft(agent.id)
  }

  return (
    <>
      <ConfirmDialog />
      <div
        role='button'
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={handleKeyDown}
        className='text-left rounded-2xl bg-background dark:bg-primary-50 hover:bg-primary-50/50 hover:outline-5 dark:hover:outline-primary-50/50 hover:outline-primary-100 flex flex-col p-3 gap-2 border cursor-pointer group/agent-card relative focus-visible:outline-2 focus-visible:outline-info'>
        <div className='flex flex-row items-start gap-2 w-full'>
          <div className='relative shrink-0'>
            <AgentAvatar agent={agent} size={8} />
            <Tooltip content={statusLabel}>
              <div
                className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-primary-50 ${statusColor}`}
              />
            </Tooltip>
          </div>

          <div className='flex flex-col flex-1 min-w-0'>
            <div className='flex flex-row justify-between items-start gap-1'>
              <p
                className={`text-sm line-clamp-1 group-hover/agent-card:text-info ${
                  agent.name ? 'font-semibold' : 'font-medium italic text-muted-foreground'
                }`}>
                {displayName}
              </p>
              {isDraft ? (
                <Badge variant='outline' size='sm' className='shrink-0'>
                  Setting up
                </Badge>
              ) : null}
            </div>
            <LastUpdated
              timestamp={agent.updatedAt}
              prefix=''
              includeSeconds={true}
              className='text-xs text-muted-foreground'
            />
          </div>
        </div>

        <p className='text-xs text-muted-foreground line-clamp-1 min-h-4'>
          {agent.description ?? ''}
        </p>

        <div className='flex items-center justify-between mt-auto gap-2'>
          <Badge variant='pill' size='sm' className='shrink-0'>
            {agent.modelId ?? 'Default model'}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='opacity-0 group-hover/agent-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-lg'
                variant='ghost'
                size='icon-xs'
                onClick={stop}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' onClick={stop}>
              <DropdownMenuItem onClick={wrap(handleNavigate)}>
                <Pencil />
                {isDraft ? 'Continue setup' : 'Edit'}
              </DropdownMenuItem>
              {isDraft ? (
                <DropdownMenuItem onClick={wrap(handleDiscardDraft)}>
                  <Trash2 />
                  Discard draft
                </DropdownMenuItem>
              ) : archived ? (
                <DropdownMenuItem onClick={wrap(() => unarchiveAgent(agent.id))}>
                  <ArchiveRestore />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={wrap(handleArchive)}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  )
}
