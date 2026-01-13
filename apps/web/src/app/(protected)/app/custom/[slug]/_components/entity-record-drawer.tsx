// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-record-drawer.tsx
'use client'

import * as React from 'react'
import { Clock, Gauge, HouseIcon, ListTodo, MessagesSquare, Trash } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { useQueryState } from 'nuqs'
import { useParams } from 'next/navigation'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { EntityIcon } from '@auxx/ui/components/icons'
import EntityFields from '~/components/fields/entity-fields'
import { useResource, useRecord, toResourceId } from '~/components/resources'
import type { ResourceField } from '@auxx/lib/resources/client'
import { parseResourceId, type ResourceId } from '@auxx/lib/field-values/client'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { TimelineTab } from '~/components/timeline'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { TasksSection } from '~/components/tasks'

// Memoized components for performance
const MemoDrawerComments = React.memo(DrawerComments)
const MemoTimelineTab = React.memo(TimelineTab)
const MemoTasksSection = React.memo(TasksSection)

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

  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })

  // Parse resourceId to get components
  const { entityDefinitionId, entityInstanceId } = resourceId
    ? parseResourceId(resourceId)
    : { entityDefinitionId: '', entityInstanceId: '' }

  // Get resource with fields
  const { resource } = useResource(entityDefinitionId ?? null)

  // Derive custom fields from resource.fields (filter to fields with id = custom fields only)
  // const customFields = React.useMemo(
  //   () => resource?.fields.filter((f): f is ResourceField & { id: string } => !!f.id) ?? [],
  //   [resource?.fields]
  // )

  // Fetch entity record from cache (populated by batch fetcher when list loads)
  // Returns displayName, secondaryDisplayValue, createdAt, updatedAt, and all field values
  const { record: cachedRecord, isLoading: isRecordLoading } = useRecord({
    resourceId: resourceId ?? null,
    enabled: !!open && !!resourceId,
  })

  // Display values come directly from the cached record
  const displayName = (cachedRecord?.displayName as string) ?? null
  const secondaryDisplay = (cachedRecord?.secondaryDisplayValue as string) ?? null

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
              resourceId={entityInstanceId!}
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
      />
      <div className="flex-1 overflow-y-auto bg-background/80 backdrop-blur-sm rounded-b-xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
          <div className="w-full h-full flex gap-0">
            <div className="w-full h-full flex flex-col overflow-auto justify-start">
              <OverflowTabsList
                tabs={[
                  { value: 'overview', label: 'Overview', icon: HouseIcon },
                  { value: 'tasks', label: 'Tasks', icon: ListTodo },
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
              <div className="flex flex-1 overflow-hidden">
                <TabsContent value="overview" className="w-full">
                  <ScrollArea className="flex-1">
                    <Section
                      title="Overview"
                      collapsible={false}
                      icon={<Gauge className="size-4 text-muted-foreground/50" />}>
                      {resource && resourceId && (
                        <EntityFields
                          resourceId={resourceId}
                          onMutationSuccess={onMutationSuccess}
                          className=""
                        />
                      )}
                    </Section>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="tasks" className="w-full">
                  {resourceId && <MemoTasksSection resourceId={resourceId} />}
                </TabsContent>

                <TabsContent value="timeline" className="w-full">
                  <ScrollArea className="flex-1">
                    <MemoTimelineTab resourceId={resourceId!} />
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="comments" className="w-full h-full mt-0">
                  <MemoDrawerComments
                    resourceId={resourceId!}
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
})
