// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-record-drawer.tsx
'use client'

import * as React from 'react'
import { Clock, Gauge, HouseIcon, MessagesSquare, Trash } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { useQueryState } from 'nuqs'
import { useParams } from 'next/navigation'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { EntityIcon } from '~/components/pickers/icon-picker'
import { useEntityRecords } from '~/components/custom-fields/context/entity-records-context'
import EntityFields from '~/components/fields/entity-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { TimelineTab } from '~/components/timeline'
import { createCustomEntityType } from '@auxx/lib/timeline/client'
import { getDisplayValue } from '@auxx/lib/field-values/client'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'

// Memoized components for performance
const MemoDrawerComments = React.memo(DrawerComments)
const MemoTimelineTab = React.memo(TimelineTab)

/** Pre-loaded field value from entity instance */
interface PreloadedFieldValue {
  id: string
  fieldId: string
  value: unknown
}

/** Entity row data from the table (avoids refetch) */
interface EntityRowData {
  id: string
  entityDefinitionId: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  _originalValues: PreloadedFieldValue[]
}

/** Props for EntityRecordDrawer */
interface EntityRecordDrawerProps {
  /** Whether the drawer is open (for controlled usage) */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Entity instance data (passed from table row - avoids refetch) */
  instance: EntityRowData | null
  /** Optional handler invoked when deleting the entity instance */
  onDeleteInstance?: (instanceId: string) => Promise<void> | void
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
}

/**
 * EntityRecordDrawer renders the right-side entity instance detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 */
export function EntityRecordDrawer({
  open,
  onOpenChange,
  instance,
  onDeleteInstance,
  onMutationSuccess,
}: EntityRecordDrawerProps) {
  const params = useParams<{ slug: string }>()
  const entitySlug = params.slug

  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })

  const { resource, entityDefinitionId, customFields } = useEntityRecords()

  // Counter for focusing comments composer
  const [focusComposerTrigger, setFocusComposerTrigger] = React.useState(0)

  // Handle switching to comments tab and focusing composer
  const handleCreateNoteClick = React.useCallback(() => {
    if (activeTab !== 'comments') {
      void setActiveTab('comments')
    }
    setFocusComposerTrigger((prev) => prev + 1)
  }, [activeTab, setActiveTab])

  /** Handle close */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  /**
   * Get display name using primaryDisplayField from resource
   * Values are now TypedFieldValue format (not legacy { data: x })
   */
  const displayName = React.useMemo(() => {
    if (!instance?._originalValues) return null

    // If resource has primaryDisplayField, use that field's value
    const primaryFieldId = resource?.display.primaryDisplayField?.id
    if (primaryFieldId) {
      const primaryValue = instance._originalValues.find((v) => v.fieldId === primaryFieldId)
      if (primaryValue?.value) {
        // Value is TypedFieldValue - use getDisplayValue
        const display = getDisplayValue(primaryValue.value as TypedFieldValue)
        if (display) return display
      }
    }

    // Fallback: use first non-empty value
    const firstValue = instance._originalValues.find((v) => {
      if (!v.value) return false
      const display = getDisplayValue(v.value as TypedFieldValue)
      return display != null && display !== ''
    })
    if (!firstValue) return null

    return getDisplayValue(firstValue.value as TypedFieldValue)
  }, [instance?._originalValues, resource?.display.primaryDisplayField?.id])

  /**
   * Get secondary display value (optional subtitle)
   * Values are now TypedFieldValue format (not legacy { data: x })
   */
  const secondaryDisplay = React.useMemo(() => {
    const secondaryFieldId = resource?.display.secondaryDisplayField?.id
    if (!instance?._originalValues || !secondaryFieldId) return null

    const secondaryValue = instance._originalValues.find((v) => v.fieldId === secondaryFieldId)
    if (!secondaryValue?.value) return null

    return getDisplayValue(secondaryValue.value as TypedFieldValue)
  }, [instance?._originalValues, resource?.display.secondaryDisplayField?.id])

  // Memoize the createdAt text to avoid recalculating on every render
  const createdAtText = React.useMemo(
    () =>
      instance
        ? `Created ${formatDistanceToNow(new Date(instance.createdAt), { addSuffix: true })}`
        : null,
    [instance]
  )

  // Create the entity type for timeline (entity:definitionId format)
  const timelineEntityType = React.useMemo(() => {
    return instance ? createCustomEntityType(instance.entityDefinitionId) : null
  }, [instance?.entityDefinitionId])

  if (!open || !instance) return null

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      title={resource?.label || 'Record'}>
      <DrawerHeader
        icon={
          <EntityIcon
            iconId={resource?.icon || 'circle'}
            color={resource?.color || 'gray'}
            className="size-6"
          />
        }
        title={resource?.label || 'Record'}
        onClose={handleClose}
        actions={
          <>
            <Tooltip content="Create note">
              <Button variant="ghost" size="icon-xs" onClick={handleCreateNoteClick}>
                <MessagesSquare />
              </Button>
            </Tooltip>
            <ManualTriggerButton
              resourceType="entity"
              entitySlug={entitySlug}
              resourceId={instance.id}
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
                  if (onDeleteInstance) {
                    void onDeleteInstance(instance.id)
                  }
                }}>
                <Trash className="text-bad-500" />
              </Button>
            </Tooltip>
            <DockToggleButton />
          </>
        }
      />
      <div className="flex-1 overflow-y-auto bg-background/80 backdrop-blur-sm rounded-b-xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
          <div className="w-full h-full flex gap-0">
            <div className="w-full h-full flex flex-col overflow-auto justify-start">
              <OverflowTabsList
                tabs={[
                  { value: 'overview', label: 'Overview', icon: HouseIcon },
                  { value: 'timeline', label: 'Timeline', icon: Clock },
                  { value: 'comments', label: 'Comments', icon: MessagesSquare },
                ]}
                value={activeTab}
                onValueChange={setActiveTab}
                variant="outline"
              />
              {/* Entity Card */}
              <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
                <EntityIcon
                  iconId={resource?.icon || 'circle'}
                  color={resource?.color || 'gray'}
                  className="size-10"
                />
                <div className="flex flex-col align-start w-full">
                  <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
                    {instance ? (
                      displayName || 'Untitled'
                    ) : (
                      <div className="mb-1">
                        <Skeleton className="h-6 w-80" />
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {instance ? (
                      secondaryDisplay || createdAtText
                    ) : (
                      <Skeleton className="h-4 w-40" />
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-1 overflow-hidden">
                <TabsContent value="overview" className="w-full">
                  <ScrollArea className="flex-1">
                    <Section
                      title="Overview"
                      collapsible={false}
                      icon={<Gauge className="size-4 text-muted-foreground/50" />}>
                      {resource && entityDefinitionId && (
                        <EntityFields
                          modelType={ModelTypes.ENTITY}
                          entityId={instance.id}
                          entityDefinitionId={entityDefinitionId}
                          preloadedValues={instance._originalValues}
                          preloadedFields={customFields}
                          createdAt={instance.createdAt}
                          updatedAt={instance.updatedAt}
                          onMutationSuccess={onMutationSuccess}
                          className=""
                        />
                      )}
                    </Section>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="timeline" className="w-full">
                  <ScrollArea className="flex-1">
                    <MemoTimelineTab entityType={timelineEntityType!} entityId={instance.id} />
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="comments" className="w-full h-full mt-0">
                  <MemoDrawerComments
                    entityId={instance.id}
                    entityType={instance.entityDefinitionId}
                    focusComposerTrigger={focusComposerTrigger}
                  />
                </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </DockableDrawer>
  )
}
