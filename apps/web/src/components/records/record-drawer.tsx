// apps/web/src/components/records/record-drawer.tsx
'use client'

import { formatToDisplayValue, parseRecordId, type RecordId } from '@auxx/lib/field-values/client'
import { getEntityDrawerConfig } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import {
  Archive,
  Edit,
  Expand,
  Link as LinkIcon,
  Merge,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  TextCursorInput,
  Trash,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { MergeDialog } from '~/components/merge'
import { useRecord, useResource } from '~/components/resources'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { AvatarUploadIcon } from '~/components/resources/ui/avatar-upload-icon'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

/** Props for RecordDrawer */
interface RecordDrawerProps {
  /** Whether the drawer is open (for controlled usage) */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId | undefined
  /** Optional handler invoked when deleting the entity instance */
  onDeleteInstance?: (instanceId: string) => Promise<void> | void
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
}

/**
 * RecordDrawer renders the right-side entity instance detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 * Uses BaseEntityDrawer with registry-based configuration.
 */
export const RecordDrawer = React.memo(function RecordDrawer({
  open,
  onOpenChange,
  recordId,
  onDeleteInstance,
  onMutationSuccess,
}: RecordDrawerProps) {
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Parse recordId to get components
  const { entityDefinitionId, entityInstanceId } = recordId
    ? parseRecordId(recordId)
    : { entityDefinitionId: '', entityInstanceId: '' }

  // Get resource with fields
  const { resource } = useResource(entityDefinitionId ?? null)

  // Get drawer config for entity-type-aware actions
  const drawerConfig = React.useMemo(() => {
    const entityType =
      resource?.entityType ?? (resource?.type === 'system' ? resource?.id : 'custom')
    return entityType ? getEntityDrawerConfig(entityType, entityDefinitionId || undefined) : null
  }, [resource, entityDefinitionId])

  // Fetch entity record from cache (populated by batch fetcher when list loads)
  const { record: cachedRecord, isLoading: isRecordLoading } = useRecord({
    recordId: recordId ?? null,
    enabled: !!open && !!recordId,
  })

  // Get display field configurations from resource
  const primaryDisplayFieldId = resource?.display.primaryDisplayField?.id ?? null
  const secondaryDisplayFieldId = resource?.display.secondaryDisplayField?.id ?? null
  const avatarField = resource?.display.avatarField ?? null
  const avatarFieldDef = React.useMemo(
    () => (avatarField ? resource?.fields.find((f) => f.id === avatarField.id) : null),
    [avatarField, resource?.fields]
  )

  // Get field definitions from resource
  const primaryField = React.useMemo(() => {
    if (!primaryDisplayFieldId || !resource?.fields) return null
    return resource.fields.find((f) => f.id === primaryDisplayFieldId)
  }, [primaryDisplayFieldId, resource?.fields])

  const secondaryField = React.useMemo(() => {
    if (!secondaryDisplayFieldId || !resource?.fields) return null
    return resource.fields.find((f) => f.id === secondaryDisplayFieldId)
  }, [secondaryDisplayFieldId, resource?.fields])

  // Subscribe to field values (reactive - updates when field values change)
  const primaryFieldValue = useFieldValue(recordId ?? ('' as RecordId), primaryDisplayFieldId ?? '')
  const secondaryFieldValue = useFieldValue(
    recordId ?? ('' as RecordId),
    secondaryDisplayFieldId ?? ''
  )

  // Format values for display
  const displayName = React.useMemo(() => {
    if (!recordId || !primaryDisplayFieldId) {
      return (cachedRecord?.displayName as string) ?? null
    }

    // Use field value if available and field type is known
    if (primaryFieldValue.value && primaryField?.fieldType) {
      return String(formatToDisplayValue(primaryFieldValue.value, primaryField.fieldType))
    }

    // Fall back to cached record
    return (cachedRecord?.displayName as string) ?? null
  }, [
    recordId,
    primaryDisplayFieldId,
    primaryFieldValue.value,
    primaryField?.fieldType,
    cachedRecord?.displayName,
  ])

  const secondaryDisplay = React.useMemo(() => {
    if (!recordId || !secondaryDisplayFieldId) {
      return (cachedRecord?.secondaryDisplayValue as string) ?? null
    }

    // Use field value if available and field type is known
    if (secondaryFieldValue.value && secondaryField?.fieldType) {
      return String(formatToDisplayValue(secondaryFieldValue.value, secondaryField.fieldType))
    }

    // Fall back to cached record
    return (cachedRecord?.secondaryDisplayValue as string) ?? null
  }, [
    recordId,
    secondaryDisplayFieldId,
    secondaryFieldValue.value,
    secondaryField?.fieldType,
    cachedRecord?.secondaryDisplayValue,
  ])

  // Counter for focusing comments composer
  const [focusComposerTrigger, setFocusComposerTrigger] = React.useState(0)

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)

  // Merge dialog state
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false)

  // Confirm dialog for delete
  const [confirm, ConfirmDialog] = useConfirm()

  const actions = drawerConfig?.actions

  /** Handle close */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  /** Handle create note - focus composer */
  const handleCreateNoteClick = React.useCallback(() => {
    setFocusComposerTrigger((prev) => prev + 1)
  }, [])

  /** Handle reply - navigate to detail page */
  const handleReply = React.useCallback(() => {
    if (resource?.apiSlug && entityInstanceId) {
      router.push(`/app/tickets/${entityInstanceId}#reply`)
      onOpenChange?.(false)
    }
  }, [resource?.apiSlug, entityInstanceId, router, onOpenChange])

  /** Handle delete with confirmation */
  const handleDelete = React.useCallback(async () => {
    if (!onDeleteInstance || !entityInstanceId) return
    const confirmed = await confirm({
      title: `Delete ${resource?.label?.toLowerCase() || 'record'}`,
      description: 'Are you sure? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await onDeleteInstance(entityInstanceId)
    }
  }, [confirm, onDeleteInstance, entityInstanceId, resource?.label])

  /** Handle expand to full page */
  const handleExpand = React.useCallback(() => {
    if (!resource?.apiSlug || !entityInstanceId) return
    if (resource.entityType) {
      router.push(`/app/${resource.apiSlug}/${entityInstanceId}`)
      return
    }
    router.push(`/app/custom/${resource.apiSlug}/${entityInstanceId}`)
  }, [resource?.apiSlug, resource?.entityType, entityInstanceId, router])

  // Memoize the createdAt text to avoid recalculating on every render
  const createdAtText = React.useMemo(
    () =>
      cachedRecord?.createdAt
        ? `Created ${formatDistanceToNow(new Date(cachedRecord.createdAt as string), { addSuffix: true })}`
        : null,
    [cachedRecord?.createdAt]
  )

  // Check if we need a "more actions" dropdown (for edit, rename, archive, link, merge)
  const hasMoreActions =
    actions?.enableEdit ||
    actions?.enableRename ||
    actions?.enableArchive ||
    actions?.enableLink ||
    actions?.enableMerge

  if (!open || !recordId) return null

  return (
    <>
      <BaseEntityDrawer
        recordId={recordId}
        open={open}
        onOpenChange={onOpenChange ?? (() => {})}
        isDocked={isDocked}
        dockedWidth={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={800}
        focusComposerTrigger={focusComposerTrigger}
        onClose={handleClose}
        headerIcon={
          <EntityIcon
            iconId={resource?.icon || 'circle'}
            color={resource?.color || 'gray'}
            className='size-6'
          />
        }
        headerTitle={resource?.label || 'Record'}
        headerActions={
          <>
            {/* Reply button (ticket-specific) */}
            {actions?.enableEmailCompose && (
              <Tooltip content='Reply'>
                <Button variant='ghost' size='icon-xs' onClick={handleReply}>
                  <MessageSquare />
                </Button>
              </Tooltip>
            )}

            {/* Create note */}
            <Tooltip content='Create note'>
              <Button variant='ghost' size='icon-xs' onClick={handleCreateNoteClick}>
                <MessagesSquare />
              </Button>
            </Tooltip>

            {/* Run workflow */}
            <ManualTriggerButton
              recordId={recordId}
              buttonVariant='ghost'
              buttonSize='icon-xs'
              buttonClassName='rounded-full'
              tooltipContent='Run workflow'
            />

            {/* More actions dropdown */}
            {hasMoreActions && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon-xs' className='rounded-full'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-48'>
                  {actions?.enableEdit && (
                    <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                      <Edit />
                      Edit {resource?.label?.toLowerCase() || 'record'}
                    </DropdownMenuItem>
                  )}

                  {entityDefinitionId && entityInstanceId && (
                    <FavoriteToggleMenuItem
                      targetType='ENTITY_INSTANCE'
                      targetIds={{ entityDefinitionId, entityInstanceId }}
                    />
                  )}

                  {actions?.enableRename && (
                    <DropdownMenuItem
                      onClick={() => {
                        // Focus the title input if it exists
                        const input = document.getElementById(
                          'drawer-title-input'
                        ) as HTMLInputElement
                        if (input) {
                          input.focus()
                          input.select()
                        }
                      }}>
                      <TextCursorInput />
                      Rename
                    </DropdownMenuItem>
                  )}

                  {actions?.enableArchive && (
                    <DropdownMenuItem
                      onClick={() => {
                        // Archive handled by parent via onDeleteInstance pattern
                      }}>
                      <Archive />
                      Archive
                    </DropdownMenuItem>
                  )}

                  {(actions?.enableEdit || actions?.enableRename || actions?.enableArchive) &&
                    (actions?.enableMerge || actions?.enableLink || actions?.enableDelete) && (
                      <DropdownMenuSeparator />
                    )}

                  {actions?.enableMerge && recordId && (
                    <DropdownMenuItem onClick={() => setMergeDialogOpen(true)}>
                      <Merge />
                      Merge
                    </DropdownMenuItem>
                  )}

                  {actions?.enableLink && (
                    <DropdownMenuItem
                      onClick={() => {
                        // Link dialog is rendered via tab card (relationships card has its own link button)
                      }}>
                      <LinkIcon />
                      Link {resource?.label?.toLowerCase() || 'record'}
                    </DropdownMenuItem>
                  )}

                  {actions?.enableDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant='destructive' onClick={handleDelete}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Delete (if no more actions dropdown, show standalone delete button) */}
            {!hasMoreActions && actions?.enableDelete !== false && (
              <Tooltip content={`Delete ${resource?.label?.toLowerCase() || 'record'}`}>
                <Button variant='outline' size='icon-xs' onClick={handleDelete}>
                  <Trash className='text-bad-500' />
                </Button>
              </Tooltip>
            )}

            {/* Expand to full page */}
            <Tooltip content='Open full page'>
              <Button variant='ghost' size='icon-xs' onClick={handleExpand}>
                <Expand />
              </Button>
            </Tooltip>

            <DockToggleButton />
          </>
        }
        cardContent={
          <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
            {avatarField && recordId ? (
              <AvatarUploadIcon
                recordId={recordId}
                avatarUrl={cachedRecord?.avatarUrl as string}
                avatarFieldId={avatarField.id}
                avatarFieldOptions={avatarFieldDef?.options}
                iconId={resource?.icon || 'circle'}
                color={resource?.color || 'gray'}
              />
            ) : (
              <RecordIcon
                avatarUrl={cachedRecord?.avatarUrl as string}
                iconId={resource?.icon || 'circle'}
                color={resource?.color || 'gray'}
                size='xl'
                inverse
              />
            )}
            <div className='flex flex-col align-start w-full'>
              <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate'>
                {isRecordLoading ? (
                  <div className='mb-1'>
                    <Skeleton className='h-6 w-80' />
                  </div>
                ) : (
                  displayName || 'Untitled'
                )}
              </div>
              <div className='text-xs text-neutral-500 truncate'>
                {isRecordLoading ? (
                  <Skeleton className='h-4 w-40' />
                ) : (
                  secondaryDisplay || createdAtText
                )}
              </div>
            </div>
          </div>
        }
      />

      {/* Edit Dialog */}
      {editDialogOpen && entityDefinitionId && (
        <EntityInstanceDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          entityDefinitionId={entityDefinitionId}
          recordId={recordId}
          onSaved={() => {
            setEditDialogOpen(false)
            onMutationSuccess?.()
          }}
        />
      )}

      {/* Merge Dialog */}
      {mergeDialogOpen && recordId && (
        <MergeDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          baseRecordIds={[recordId]}
          onMergeComplete={() => {
            setMergeDialogOpen(false)
            onMutationSuccess?.()
          }}
        />
      )}

      <ConfirmDialog />
    </>
  )
})
