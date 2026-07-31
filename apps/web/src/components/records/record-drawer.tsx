// apps/web/src/components/records/record-drawer.tsx
'use client'

import { formatToDisplayValue, parseRecordId, type RecordId } from '@auxx/lib/field-values/client'
import { getEntityDrawerConfig } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { Expand } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'
import { getHeaderActions } from '~/components/drawers/drawer-action-registry'
import { FavoriteStarButton } from '~/components/favorites/ui/favorite-star-button'
import { ConnectorSourceBadge } from '~/components/fields/connector-source-badge'
import { Tooltip } from '~/components/global/tooltip'
import { CommandContext, RecordCommandActions } from '~/components/kbar/contextual'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'
import { useIsNestedThread } from '~/components/mail/thread-provider'
import { GranularPermissionsGate } from '~/components/mail-permissions/ui/granular-permissions-gate'
import { RecordRequestAccessPopover } from '~/components/permissions/ui/record-request-access-popover'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import {
  resourceHasDetailPage,
  useRecord,
  useRecordAccess,
  useResource,
} from '~/components/resources'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { AvatarUploadIcon } from '~/components/resources/ui/avatar-upload-icon'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { useRecordShortcuts } from './hooks/use-record-shortcuts'
import { RecordActionsMenu } from './record-actions-menu'
import { useRecordDrawerReadOnly } from './use-record-drawer-read-only'

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

  // Restricted (read-only) mode — computed once here (the drawer root) and
  // threaded into BaseEntityDrawer + used to gate every write affordance in this
  // header. **Per ROW** since plan v3/03 P5: it reads this record's `_access`
  // stamp, so a row shared at `edit` on an otherwise-invisible def is editable
  // and a row shared at `read` is not, even where sibling rows are editable.
  const readOnly = useRecordDrawerReadOnly(
    entityDefinitionId || undefined,
    entityInstanceId || undefined
  )

  // Get resource with fields
  const { resource } = useResource(entityDefinitionId ?? null)

  // Resolve entity type once (used for both drawer config and action registry)
  const entityType = React.useMemo(
    () => resource?.entityType ?? (resource?.type === 'system' ? resource?.id : 'custom'),
    [resource]
  )

  // Get drawer config for entity-type-aware actions
  const _drawerConfig = React.useMemo(() => {
    return entityType ? getEntityDrawerConfig(entityType, entityDefinitionId || undefined) : null
  }, [entityType, entityDefinitionId])

  const headerActionComponents = React.useMemo(
    () => (entityType ? getHeaderActions(entityType) : []),
    [entityType]
  )

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

  // Merge, share and delete-confirm all moved into `RecordActionsMenu`, which
  // owns the dialogs it opens. Per-record sharing keeps its `_access` gate
  // there (plan v3/03 §6.2) — it is a different question from `readOnly`, since
  // an editable row that is NOT re-shareable is the common case.

  /**
   * Focus the inline title input for the Rename item.
   *
   * Drawer-only: nothing else in the app has a `#drawer-title-input`, which is
   * why {@link RecordActionsMenu} takes this as a callback rather than owning
   * it — an item whose target does not exist on a surface must not render there.
   */
  const handleRename = React.useCallback(() => {
    const input = document.getElementById('drawer-title-input') as HTMLInputElement | null
    input?.focus()
    input?.select()
  }, [])

  /** Handle close */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  /** Handle create note - focus composer */
  const handleCreateNoteClick = React.useCallback(() => {
    setFocusComposerTrigger((prev) => prev + 1)
  }, [])

  /** Handle expand to full page */
  const handleExpand = React.useCallback(() => {
    if (!resource?.apiSlug || !entityInstanceId) return
    if (resource.entityType) {
      router.push(`/app/${resource.apiSlug}/${entityInstanceId}`)
      return
    }
    router.push(`/app/custom/${resource.apiSlug}/${entityInstanceId}`)
  }, [resource?.apiSlug, resource?.entityType, entityInstanceId, router])

  /**
   * `R` / `F` / `W` / `Shift+S` / `E` for the record in this drawer.
   *
   * ⚠ **`isNestedThread` is what keeps the mailbox sane.** `mail-box.tsx` docks
   * this drawer (the ticket drawer) BESIDE a live thread rather than over it, and
   * mail binds `R` to reply-all, `F` to forward and `W` to its own workflow
   * dialog. Every one of those would double-fire — `conflictBehavior: 'allow'`
   * runs both handlers, it does not pick a winner. `NestedThreadProvider` already
   * wraps that mount and exists for exactly this class of collision.
   */
  const { access } = useRecordAccess(recordId)
  const isNestedThread = useIsNestedThread()
  const {
    requestAccessOpen,
    setRequestAccessOpen,
    shareOpen,
    setShareOpen,
    workflowOpen,
    setWorkflowOpen,
  } = useRecordShortcuts({
    recordId,
    enabled: !!open && !isNestedThread,
    onExpand: resource && resourceHasDetailPage(resource) ? handleExpand : undefined,
  })

  // Memoize the createdAt text to avoid recalculating on every render
  const createdAtText = React.useMemo(
    () =>
      cachedRecord?.createdAt
        ? `Created ${formatDistanceToNow(new Date(cachedRecord.createdAt as string), { addSuffix: true })}`
        : null,
    [cachedRecord?.createdAt]
  )

  if (!open || !recordId) return null

  return (
    <>
      <KopilotContext activeRecordId={recordId} activeRecordLabel={displayName ?? undefined} />
      <KopilotSuggestion text='Summarize this record' icon='sparkle' priority={10} autoSubmit />
      {/* Command-palette record scope — priority outranks the table scope so the
          record group leads cmd+k when a drawer is open over the live table. */}
      <CommandContext
        kind='record'
        label={displayName ?? resource?.label ?? 'Record'}
        recordId={recordId}
        entityDefinitionId={entityDefinitionId || undefined}
        priority={10}>
        <RecordCommandActions recordId={recordId} displayName={displayName ?? undefined} />
      </CommandContext>
      <KopilotSuggestion text='Show related records' icon='list' autoSubmit />
      <BaseEntityDrawer
        recordId={recordId}
        open={open}
        onOpenChange={onOpenChange ?? (() => {})}
        isDocked={isDocked}
        dockedWidth={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={800}
        readOnly={readOnly}
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
            {/* Entity-specific header actions (compose for contacts, reply for
                tickets, etc.) — write affordances, hidden in restricted mode. */}
            {!readOnly &&
              entityType &&
              headerActionComponents.map((Action, i) => (
                <Action
                  key={i}
                  recordId={recordId}
                  entityInstanceId={entityInstanceId}
                  entityType={entityType}
                  record={cachedRecord}
                  resource={resource}
                  onCreateNote={handleCreateNoteClick}
                />
              ))}

            {/* Everything else — run workflow, app actions, share, request
                access, rename, merge, archive, delete — is the SHARED menu, the
                same component the detail page and the records-table row render.
                It resolves its own per-row gate from the `_access` stamp, which
                is the same question `readOnly` above answers, so no extra
                restricted-mode term is needed here.

                Gone with it: an Archive item and a Link item whose onClick
                bodies were empty comments, and a standalone delete button that
                only appeared when the dropdown didn't. */}

            {/* Request access is PROMOTED back out of the menu, using the `icon`
                variant this shell always had for the drawer header's lock slot.
                Two reasons, and only the second is new:

                1. It is the one control here that ADDS capability, which is the
                   same argument that promoted it on the detail page.
                2. `R` has to anchor to it. Radix does not mount
                   `DropdownMenuContent` until the menu opens, so while the
                   trigger lived inside the kebab there was nothing on screen for
                   a keyboard-opened popover to attach to.

                ⚠ The lazy preflight (plan v3/04 §8.5 / D6) is UNCHANGED: the
                query keys off the popover being OPEN, never off this being
                mounted, so a member who never presses `R` or clicks still costs
                the server nothing. */}
            {access === 'read' && (
              <GranularPermissionsGate>
                <RecordRequestAccessPopover
                  entityDefinitionId={entityDefinitionId}
                  entityInstanceId={entityInstanceId}
                  variant='icon'
                  shortcut='R'
                  open={requestAccessOpen}
                  onOpenChange={setRequestAccessOpen}
                />
              </GranularPermissionsGate>
            )}

            <FavoriteStarButton
              targetType='ENTITY_INSTANCE'
              targetIds={{ entityDefinitionId, entityInstanceId }}
              size='icon-xs'
              className='rounded-full'
              shortcut='F'
            />
            <RecordActionsMenu
              recordId={recordId}
              entityType={entityType ?? ''}
              record={cachedRecord}
              surface='drawer'
              onEdit={() => setEditDialogOpen(true)}
              onRename={handleRename}
              onDeleted={handleClose}
              omitItems={['request-access']}
              // One share dialog for both paths — the menu item and `Shift+S`.
              shareOpen={shareOpen}
              onShareOpenChange={setShareOpen}
            />

            {/* Expand to full page — only for types that have a detail page
                (no catch-all route; page-less system types would 404) */}
            {resource && resourceHasDetailPage(resource) && (
              <Tooltip content='Open full page' shortcut='E'>
                <Button variant='ghost' size='icon-xs' onClick={handleExpand}>
                  <Expand />
                </Button>
              </Tooltip>
            )}
          </>
        }
        cardContent={
          <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
            {avatarField && recordId && avatarFieldDef?.fieldType === 'FILE' && !readOnly ? (
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
            <div className='flex flex-col align-start w-full min-w-0'>
              <div className='flex items-center gap-2 min-w-0'>
                <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate min-w-0'>
                  {isRecordLoading ? (
                    <div className='mb-1'>
                      <Skeleton className='h-6 w-80' />
                    </div>
                  ) : (
                    displayName || 'Untitled'
                  )}
                </div>
                {!isRecordLoading && (
                  <ConnectorSourceBadge
                    sources={cachedRecord?.sources}
                    variant='chip'
                    className='shrink-0'
                  />
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

      {/* Edit Dialog — resolves the custom editor per entity type (e.g. Parts). */}
      {editDialogOpen && entityDefinitionId && (
        <RecordEditorDialog
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

      {/* `W`'s target. The menu's "Run Workflow" submenu triggers a workflow the
          member has already picked; the shortcut has picked nothing yet, so it
          opens the picker — the same dialog mail's `W` opens for a thread. */}
      {workflowOpen && (
        <MassWorkflowTriggerDialog
          open={workflowOpen}
          onOpenChange={setWorkflowOpen}
          recordIds={[recordId]}
          onSuccess={onMutationSuccess}
        />
      )}
    </>
  )
})
