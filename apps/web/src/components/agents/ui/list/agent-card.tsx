// apps/web/src/components/agents/ui/list/agent-card.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ListCard } from '@auxx/ui/components/list-card'
import { Archive, ArchiveRestore, Eye, MessageCircle, Pencil, Share2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { useAgentAccess } from '../../hooks/use-agent-access'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentListItem } from '../../store/agent-store'
import { AgentAvatar } from '../shared/agent-avatar'

interface AgentCardProps {
  agent: AgentListItem
}

export function AgentCard({ agent }: AgentCardProps) {
  const router = useRouter()
  const { archiveAgent, unarchiveAgent, deleteAgent, deleteSetupDraft } = useAgentMutations()
  const [confirm, ConfirmDialog] = useConfirm()
  const [shareOpen, setShareOpen] = useState(false)
  // Per-agent instance access (plan 25 §4.2). Share…, Archive/Unarchive and
  // Delete are the `admin` rung; discarding an unfinished setup draft is
  // authoring (`edit`). Opening the agent stays at `view` — `agent.list`
  // already filters to what this member may see, so every card here is at
  // least viewable.
  const { canEdit, canAdmin } = useAgentAccess(agent.id)
  const bulkMode = useBulkMode()
  const selected = useIsSelected(agent.id)
  const pending = useIsPending(agent.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const archived = agent.archivedAt != null
  const isDraft = agent.setupCompletedAt == null && !archived
  const statusLabel = archived ? 'Archived' : 'Active'
  const displayName = agent.name ?? 'Untitled agent'

  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  const handleNavigate = () => router.push(`/app/agents/${agent.slug}`)

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

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete agent permanently?',
      description: `"${displayName}" and its triggers will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) await deleteAgent(agent.id)
  }

  const handleDiscardDraft = async () => {
    const ok = await confirm({
      title: 'Discard draft?',
      description: `"${displayName}" hasn't been finished. This permanently deletes it.`,
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) await deleteSetupDraft(agent.id)
  }

  return (
    <>
      <ConfirmDialog />
      {canAdmin && (
        <InstanceShareDialog
          recordId={toRecordId('agent', agent.id)}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
      <ListCard
        href={`/app/agents/${agent.slug}`}
        ariaLabel={displayName}
        selectable
        selecting={bulkMode}
        selected={selected}
        onSelectChange={(_, e) => toggle(agent.id, { shiftKey: e.shiftKey })}
        pending={pending}
        pendingLabel={pendingLabel}
        title={displayName}
        titleLines={1}
        classNames={agent.name ? undefined : { title: 'font-medium italic text-muted-foreground' }}
        media={<AgentAvatar agent={agent} size={8} />}
        status={{ tone: archived ? 'muted' : 'good', label: statusLabel }}
        headerEnd={
          isDraft ? (
            <Badge variant='outline' size='sm' className='shrink-0'>
              Setting up
            </Badge>
          ) : undefined
        }
        subtitle={<LastUpdated timestamp={agent.updatedAt} prefix='' includeSeconds={true} />}
        description={agent.description ?? ''}
        descriptionLines={1}
        badges={
          <>
            <Badge variant='pill' size='sm' className='shrink-0'>
              {agent.modelId ?? 'Default model'}
            </Badge>
            {agent.kind === 'chat' ? (
              <Badge variant='outline' size='sm' className='shrink-0'>
                <MessageCircle />
                Chat
              </Badge>
            ) : null}
          </>
        }
        menu={
          <>
            <DropdownMenuItem onClick={wrap(handleNavigate)}>
              {canEdit ? <Pencil /> : <Eye />}
              {isDraft ? 'Continue setup' : canEdit ? 'Edit' : 'Open'}
            </DropdownMenuItem>
            {canAdmin && !isDraft && (
              <DropdownMenuItem onClick={wrap(() => setShareOpen(true))}>
                <Share2 />
                Share…
              </DropdownMenuItem>
            )}
            {isDraft ? (
              canEdit && (
                <DropdownMenuItem onClick={wrap(handleDiscardDraft)}>
                  <Trash2 />
                  Discard draft
                </DropdownMenuItem>
              )
            ) : (
              <>
                {canAdmin &&
                  (archived ? (
                    <DropdownMenuItem onClick={wrap(() => unarchiveAgent(agent.id))}>
                      <ArchiveRestore />
                      Unarchive
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={wrap(handleArchive)}>
                      <Archive />
                      Archive
                    </DropdownMenuItem>
                  ))}
                {canAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant='destructive' onClick={wrap(handleDelete)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </>
            )}
          </>
        }
      />
    </>
  )
}
