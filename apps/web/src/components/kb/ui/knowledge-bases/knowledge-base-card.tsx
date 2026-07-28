// apps/web/src/components/kb/ui/knowledge-bases/knowledge-base-card.tsx
'use client'

// One knowledge base tile in the Knowledge Bases tab grid: a selectable
// ListCard with the Open / Settings / Delete menu. `name`/`slug` edits go
// through the same draft-vs-live split the KB editor uses (see
// use-draft-settings-autosave.ts) — name is staged via `updateDraftSettings`
// and never auto-published from here, matching the rest of the app.

import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { Book, Lock, Settings, Share2, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { useKnowledgeBaseMutations } from '../../hooks/use-knowledge-base-mutations'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormValues,
} from '../dialogs/kb-knowledge-base-dialog'

function publishStatusLabel(publishStatus: KnowledgeBase['publishStatus']) {
  if (publishStatus === 'PUBLISHED') return null
  return publishStatus === 'UNLISTED' ? 'Unlisted' : 'Private'
}

export function KnowledgeBaseCard({ knowledgeBase: kb }: { knowledgeBase: KnowledgeBase }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const { isRestrictedInstance, canAdminInstance } = useAccess()
  const isShared = isRestrictedInstance(kb.id)
  const canAdmin = canAdminInstance(toRecordId('kb', kb.id))

  const bulkMode = useBulkMode()
  const selected = useIsSelected(kb.id)
  const pending = useIsPending(kb.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const {
    updateKnowledgeBase,
    updateDraftSettings,
    deleteKnowledgeBase,
    isUpdating,
    isUpdatingDraft,
  } = useKnowledgeBaseMutations()

  const handleSettingsSubmit = async (values: KnowledgeBaseFormValues) => {
    if (values.slug !== kb.slug) {
      await updateKnowledgeBase(kb.id, { slug: values.slug })
    }
    if (values.name !== kb.name) {
      await updateDraftSettings(kb.id, { name: values.name })
    }
    setSettingsOpen(false)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete knowledge base?',
      description: `"${kb.name}" and all of its articles will be removed. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteKnowledgeBase(kb.id)
  }

  const statusLabel = publishStatusLabel(kb.publishStatus)

  return (
    <>
      <ConfirmDialog />
      {canAdmin && (
        <InstanceShareDialog
          recordId={toRecordId('kb', kb.id)}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
      <ListCard
        href={`/app/kb/${kb.id}/editor`}
        ariaLabel={kb.name}
        selectable
        selecting={bulkMode}
        selected={selected}
        onSelectChange={(_, e) => toggle(kb.id, { shiftKey: e.shiftKey })}
        pending={pending}
        pendingLabel={pendingLabel}
        title={kb.name}
        icon={<Book className='size-4' />}
        description={kb.description ?? undefined}
        descriptionLines={2}
        badges={
          <>
            {isShared && (
              <SimpleTooltip content='Shared with specific access'>
                <Badge variant='pill' size='sm' className='shrink-0'>
                  <Lock className='size-3' />
                  Shared
                </Badge>
              </SimpleTooltip>
            )}
            {renderBadgeChips(
              statusLabel ? [{ icon: <Lock className='size-3' />, label: statusLabel }] : []
            )}
          </>
        }
        menu={
          <>
            <DropdownMenuItem onClick={() => router.push(`/app/kb/${kb.id}/editor`)}>
              <Book />
              Open
            </DropdownMenuItem>
            {canAdmin && (
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings />
                Settings
              </DropdownMenuItem>
            )}
            {canAdmin && (
              <DropdownMenuItem onClick={() => setShareOpen(true)}>
                <Share2 />
                Share…
              </DropdownMenuItem>
            )}
            <FavoriteToggleMenuItem
              targetType='KNOWLEDGE_BASE'
              targetIds={{ knowledgeBaseId: kb.id }}
            />
            {canAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={() => void handleDelete()}>
                  <Trash />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />
      <KnowledgeBaseDialog
        mode='edit'
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialValues={{ name: kb.name, slug: kb.slug }}
        isSubmitting={isUpdating || isUpdatingDraft}
        onSubmit={(values) => void handleSettingsSubmit(values)}
      />
    </>
  )
}
