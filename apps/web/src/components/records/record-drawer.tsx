// apps/web/src/components/records/record-drawer.tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Expand, MessagesSquare, Trash } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useResource, useRecord } from '~/components/resources'
import { parseRecordId, type RecordId } from '@auxx/lib/field-values/client'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'

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

  // Fetch entity record from cache (populated by batch fetcher when list loads)
  const { record: cachedRecord, isLoading: isRecordLoading } = useRecord({
    recordId: recordId ?? null,
    enabled: !!open && !!recordId,
  })

  // Get display field configurations from resource
  const primaryDisplayFieldId = resource?.display.primaryDisplayField?.id ?? null
  const secondaryDisplayFieldId = resource?.display.secondaryDisplayField?.id ?? null

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

  /** Handle close */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  /** Handle create note - focus composer */
  const handleCreateNoteClick = React.useCallback(() => {
    setFocusComposerTrigger((prev) => prev + 1)
  }, [])

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
          className="size-6"
        />
      }
      headerTitle={resource?.label || 'Record'}
      headerActions={
        <>
          <Tooltip content="Create note">
            <Button variant="ghost" size="icon-xs" onClick={handleCreateNoteClick}>
              <MessagesSquare />
            </Button>
          </Tooltip>
          <ManualTriggerButton
            recordId={recordId}
            buttonVariant="ghost"
            buttonSize="icon-xs"
            buttonClassName="rounded-full"
            tooltipContent="Run workflow"
          />
          <Tooltip content={`Delete ${resource?.label?.toLowerCase() || 'record'}`}>
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => {
                if (onDeleteInstance && entityInstanceId) {
                  void onDeleteInstance(entityInstanceId)
                }
              }}>
              <Trash className="text-bad-500" />
            </Button>
          </Tooltip>
          <Tooltip content="Open full page">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                if (resource?.apiSlug && entityInstanceId) {
                  router.push(`/app/custom/${resource.apiSlug}/${entityInstanceId}`)
                }
              }}>
              <Expand />
            </Button>
          </Tooltip>
          <DockToggleButton />
        </>
      }
      cardContent={
        <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
          <EntityIcon
            iconId={resource?.icon || 'circle'}
            color={resource?.color || 'gray'}
            className="size-10"
          />
          <div className="flex flex-col align-start w-full">
            <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
              {isRecordLoading ? (
                <div className="mb-1">
                  <Skeleton className="h-6 w-80" />
                </div>
              ) : (
                displayName || 'Untitled'
              )}
            </div>
            <div className="text-xs text-neutral-500 truncate">
              {isRecordLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                secondaryDisplay || createdAtText
              )}
            </div>
          </div>
        </div>
      }
    />
  )
})
