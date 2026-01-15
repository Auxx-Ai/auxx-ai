// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-record-drawer.tsx
'use client'

import * as React from 'react'
import { MessagesSquare, Trash } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Button } from '@auxx/ui/components/button'
import { useParams } from 'next/navigation'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useResource, useRecord } from '~/components/resources'
import { parseResourceId, type ResourceId } from '@auxx/lib/field-values/client'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'

/** Props for EntityRecordDrawer */
interface EntityRecordDrawerProps {
  /** Whether the drawer is open (for controlled usage) */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId | undefined
  /** Optional handler invoked when deleting the entity instance */
  onDeleteInstance?: (instanceId: string) => Promise<void> | void
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
}

/**
 * EntityRecordDrawer renders the right-side entity instance detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 * Now uses BaseEntityDrawer with registry-based configuration.
 */
export const EntityRecordDrawer = React.memo(function EntityRecordDrawer({
  open,
  onOpenChange,
  resourceId,
  onDeleteInstance,
  onMutationSuccess,
}: EntityRecordDrawerProps) {
  const params = useParams<{ slug: string }>()
  const entitySlug = params.slug

  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Parse resourceId to get components
  const { entityDefinitionId, entityInstanceId } = resourceId
    ? parseResourceId(resourceId)
    : { entityDefinitionId: '', entityInstanceId: '' }

  // Get resource with fields
  const { resource } = useResource(entityDefinitionId ?? null)

  // Fetch entity record from cache (populated by batch fetcher when list loads)
  const { record: cachedRecord, isLoading: isRecordLoading } = useRecord({
    resourceId: resourceId ?? null,
    enabled: !!open && !!resourceId,
  })

  // Display values come directly from the cached record
  const displayName = (cachedRecord?.displayName as string) ?? null
  const secondaryDisplay = (cachedRecord?.secondaryDisplayValue as string) ?? null

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

  if (!open || !resourceId) return null

  return (
    <BaseEntityDrawer
      resourceId={resourceId}
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
            resourceId={resourceId}
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
