// apps/web/src/components/tags/ui/record-tag-chip.tsx
'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { TagBadge } from './tag-badge'
import { TagDialog } from './tag-dialog'

interface RecordTagChipProps {
  /** The tag RecordId (format: "entityDefinitionId:instanceId") */
  tagId: RecordId
  /**
   * Label used in the dropdown's first item: "Remove from {removeLabel}".
   * Examples: 'thread', 'article'.
   */
  removeLabel: string
  /** Callback to remove this tag from the parent record */
  onRemove?: () => void
  /** Display size for the underlying TagBadge */
  size?: 'sm' | 'md'
}

/**
 * Generic chip-with-dropdown for displaying a tag attached to any record type.
 * Renders a TagBadge with a dropdown that offers: remove from <X>, edit tag, delete tag.
 */
export function RecordTagChip({ tagId, removeLabel, onRemove, size = 'sm' }: RecordTagChipProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const { canEditEntity, canDeleteEntity } = useAccess()

  // "Edit Tag" / "Delete Tag" mutate the tag ORG-WIDE, so they ask what the
  // server asks of a record write: `assertEditEntity` on the tag def, and
  // `assertDeleteEntity` for the destructive one. "Remove from X" is NOT gated
  // here — it is a field-value write on the parent record, a different
  // permission that the host surface owns.
  const { entityDefinitionId: tagDefId } = parseRecordId(tagId)
  const canEditTag = canEditEntity(tagDefId)
  const canDeleteTag = canDeleteEntity(tagDefId)

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete tag',
        description: error.message,
      })
    },
  })

  function handleEdit() {
    setIsEditDialogOpen(true)
  }

  function handleEditSuccess() {
    utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
  }

  async function handleDeleteTag() {
    const confirmed = await confirm({
      title: 'Delete tag?',
      description:
        'This will permanently delete the tag from all records. This action cannot be undone.',
      confirmText: 'Delete Tag',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteRecord.mutateAsync({ recordId: tagId })
    }
  }

  function handleRemoveFromRecord() {
    if (onRemove) {
      onRemove()
    } else {
      console.warn('RecordTagChip: onRemove callback not provided')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className='cursor-pointer'>
            <TagBadge
              recordId={tagId}
              size={size}
              className='data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
            />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={handleRemoveFromRecord}>
            <X />
            Remove from {removeLabel}
          </DropdownMenuItem>
          {/* Separates the record-scoped action above from the org-wide tag
              actions below — so it only renders when at least one of those is
              permitted, never as a trailing rule. */}
          {(canEditTag || canDeleteTag) && <DropdownMenuSeparator />}
          {canEditTag && (
            <DropdownMenuItem onClick={handleEdit}>
              <Pencil />
              Edit Tag
            </DropdownMenuItem>
          )}
          {canDeleteTag && (
            <DropdownMenuItem variant='destructive' onClick={handleDeleteTag}>
              <Trash2 />
              Delete Tag
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isEditDialogOpen && (
        <TagDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          recordId={tagId}
          onSaved={handleEditSuccess}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
