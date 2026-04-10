// apps/web/src/components/drawers/base-entity-drawer.tsx
'use client'

import type { DrawerTabCardDefinition } from '@auxx/lib/resources/client'
import { getEntityDrawerConfig, parseRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { OverflowTabsList, type TabDefinition, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import {
  Clock,
  HouseIcon,
  Layers,
  ListTodo,
  Mail,
  MessagesSquare,
  Package,
  ShoppingBag,
  Ticket,
  Truck,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { useRecord, useResource } from '~/components/resources'
import { TasksSection } from '~/components/tasks/ui/tasks-section'
import { TimelineTab } from '~/components/timeline'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import {
  useDehydratedOrganizationId,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { getTabCardComponent, getTabComponent } from './drawer-tab-registry'

interface BaseEntityDrawerProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId | null
  /** Drawer open state */
  open: boolean
  /** Callback when drawer open state changes */
  onOpenChange: (open: boolean) => void
  /** Optional entity type override (for system entities like 'contact') */
  entityType?: string
  /** Optional additional actions in header */
  headerActions?: React.ReactNode
  /** Optional card content to render below tabs (e.g., person card, entity card) */
  cardContent?: React.ReactNode
  /** Optional custom header icon */
  headerIcon?: React.ReactNode
  /** Optional custom header title */
  headerTitle?: string
  /** Optional callback when drawer closes */
  onClose?: () => void
  /** Optional counter to trigger focus on comments composer */
  focusComposerTrigger?: number
  /** Optional isDocked state */
  isDocked?: boolean
  /** Optional docked width */
  dockedWidth?: number
  /** Optional callback when docked width changes */
  onWidthChange?: (width: number) => void
  /** Optional minWidth for dockable drawer */
  minWidth?: number
  /** Optional maxWidth for dockable drawer */
  maxWidth?: number
}

/**
 * Apply a saved tab order to a tabs array.
 * Tabs in savedOrder come first, in that order.
 * Tabs NOT in savedOrder (new tabs added after user last saved) are appended at the end.
 * Saved values that no longer exist are silently dropped.
 */
function applyTabOrder(tabs: TabDefinition[], savedOrder: string[]): TabDefinition[] {
  const tabMap = new Map(tabs.map((t) => [t.value, t]))
  const ordered: TabDefinition[] = []
  for (const value of savedOrder) {
    const tab = tabMap.get(value)
    if (tab) {
      ordered.push(tab)
      tabMap.delete(value)
    }
  }
  for (const tab of tabs) {
    if (tabMap.has(tab.value)) ordered.push(tab)
  }
  return ordered
}

/**
 * Base entity drawer that uses registry-based configuration
 * Supports both system entities (contact, part) and custom entities
 */
export function BaseEntityDrawer({
  recordId,
  open,
  onOpenChange,
  entityType: entityTypeOverride,
  headerActions,
  cardContent,
  headerIcon,
  headerTitle,
  onClose,
  focusComposerTrigger = 0,
  isDocked,
  dockedWidth,
  onWidthChange,
  minWidth = 400,
  maxWidth = 800,
}: BaseEntityDrawerProps) {
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })
  const { hasAccess } = useFeatureFlags()
  const organizationId = useDehydratedOrganizationId()
  const user = useDehydratedUser()

  // Parse recordId
  const { entityDefinitionId, entityInstanceId } = recordId
    ? parseRecordId(recordId)
    : { entityDefinitionId: null, entityInstanceId: null }

  // Get resource metadata
  const { resource } = useResource(entityDefinitionId)

  // Get record data
  const { record } = useRecord({
    recordId,
    enabled: !!open && !!recordId,
  })

  // Determine entity type (use override if provided, otherwise infer from resource)
  const entityType = React.useMemo(() => {
    if (entityTypeOverride) return entityTypeOverride
    if (!resource) return null
    // Check for entityType property first, fallback to id for system resources
    if (resource.entityType) return resource.entityType
    return resource.type === 'system' ? resource.id : 'custom'
  }, [entityTypeOverride, resource])

  // Get drawer config from registry
  const drawerConfig = React.useMemo(() => {
    if (!entityType) return null
    return getEntityDrawerConfig(entityType, entityDefinitionId ?? undefined)
  }, [entityType, entityDefinitionId])

  // Build tabs from registry + base tabs
  const tabs = React.useMemo(() => {
    if (!drawerConfig) return []

    const baseTabs = [
      { value: 'overview', label: 'Overview', icon: HouseIcon },
      { value: 'timeline', label: 'Timeline', icon: Clock },
      { value: 'comments', label: 'Comments', icon: MessagesSquare },
      { value: 'tasks', label: 'Tasks', icon: ListTodo },
    ]

    const additionalTabs = drawerConfig.additionalTabs
      .filter((tab) => !tab.featureGate || hasAccess(tab.featureGate))
      .map((tab) => ({
        value: tab.value,
        label: tab.label,
        icon: getIconComponent(tab.icon),
      }))

    return [...baseTabs, ...additionalTabs]
  }, [drawerConfig, hasAccess])

  // Tab order persistence
  const tabOrderStorageKey = React.useMemo(() => {
    if (!organizationId || !user?.id || !entityDefinitionId) return null
    return `tabOrder:${organizationId}:${user.id}:${entityDefinitionId}`
  }, [organizationId, user?.id, entityDefinitionId])

  const [savedTabOrder, setSavedTabOrder] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    if (!tabOrderStorageKey) {
      setSavedTabOrder(null)
      return
    }
    const raw = safeLocalStorage.get(tabOrderStorageKey)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setSavedTabOrder(parsed)
          return
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
    setSavedTabOrder(null)
  }, [tabOrderStorageKey])

  const orderedTabs = React.useMemo(() => {
    if (!savedTabOrder || savedTabOrder.length === 0) return tabs
    return applyTabOrder(tabs, savedTabOrder)
  }, [tabs, savedTabOrder])

  const handleTabReorder = React.useCallback(
    (newOrder: string[]) => {
      setSavedTabOrder(newOrder)
      if (tabOrderStorageKey) {
        safeLocalStorage.set(tabOrderStorageKey, JSON.stringify(newOrder))
      }
    },
    [tabOrderStorageKey]
  )

  const handleResetTabOrder = React.useCallback(() => {
    setSavedTabOrder(null)
    if (tabOrderStorageKey) {
      localStorage.removeItem(tabOrderStorageKey)
    }
  }, [tabOrderStorageKey])

  /** Handle close */
  const handleClose = React.useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      onOpenChange(false)
    }
  }, [onClose, onOpenChange])

  if (!open || !recordId || !drawerConfig || !entityType) return null

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={onWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title={headerTitle ?? resource?.label ?? 'Record'}>
      <DrawerHeader
        icon={headerIcon ?? resource?.icon}
        title={headerTitle ?? resource?.label ?? 'Record'}
        onClose={handleClose}
        actions={headerActions}
      />

      <div className='flex-1 overflow-y-auto'>
        <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full h-full'>
          <div className='w-full h-full flex gap-0'>
            <div className='w-full h-full flex flex-col overflow-auto justify-start'>
              <OverflowTabsList
                tabs={orderedTabs}
                value={activeTab}
                onValueChange={setActiveTab}
                variant='outline'
                canReorder={!!tabOrderStorageKey}
                onReorder={handleTabReorder}
                onResetOrder={handleResetTabOrder}
              />

              {/* Card content (person card, entity card, etc.) */}
              {cardContent}

              <div className='flex flex-1 overflow-hidden'>
                {/* Base tabs - static */}
                <TabsContent value='overview' className='w-full'>
                  <ScrollArea className='flex-1'>
                    <TabCards
                      tab='overview'
                      position='before'
                      entityType={entityType}
                      drawerConfig={drawerConfig}
                      entityInstanceId={entityInstanceId!}
                      recordId={recordId}
                      record={record}
                    />
                    <Section
                      title='Details'
                      initialOpen
                      collapsible={false}
                      icon={<HouseIcon className='size-4' />}>
                      <EntityFields recordId={recordId} />
                    </Section>
                    <TabCards
                      tab='overview'
                      position='after'
                      entityType={entityType}
                      drawerConfig={drawerConfig}
                      entityInstanceId={entityInstanceId!}
                      recordId={recordId}
                      record={record}
                    />
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='timeline' className='w-full h-full mt-0'>
                  <ScrollArea className='flex-1'>
                    <div className='p-3 flex-1 flex-col flex'>
                      <TimelineTab recordId={recordId} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='comments' className='w-full h-full mt-0'>
                  <ScrollArea className='flex-1'>
                    <DrawerComments
                      recordId={recordId}
                      focusComposerTrigger={focusComposerTrigger}
                    />
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='tasks' className='w-full h-full mt-0'>
                  <TasksSection recordId={recordId} />
                </TabsContent>

                {/* Dynamic tabs from registry */}
                {drawerConfig.additionalTabs
                  .filter((tab) => !tab.featureGate || hasAccess(tab.featureGate))
                  .map((tab) => (
                    <TabsContent key={tab.value} value={tab.value} className='w-full'>
                      <LazyTabComponent
                        entityType={entityType}
                        tabValue={tab.value}
                        entityInstanceId={entityInstanceId!}
                        recordId={recordId}
                        record={record}
                      />
                    </TabsContent>
                  ))}
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </DockableDrawer>
  )
}

/**
 * Lazy load and render a tab component
 */
function LazyTabComponent({
  entityType,
  tabValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  tabValue: string
  entityInstanceId: string
  recordId: string
  record?: Record<string, unknown>
}) {
  const componentLoader = getTabComponent(entityType, tabValue)

  if (!componentLoader) {
    return <div className='p-4 text-sm text-muted-foreground'>Tab component not found</div>
  }

  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!Component) {
    return <div className='p-4'>Loading...</div>
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}

/**
 * Renders tab cards for a given base tab at the specified position (before/after default content)
 */
function TabCards({
  tab,
  position,
  entityType,
  drawerConfig,
  entityInstanceId,
  recordId,
  record,
}: {
  tab: string
  position: 'before' | 'after'
  entityType: string
  drawerConfig: { tabCards?: Record<string, DrawerTabCardDefinition[]> }
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const cards = drawerConfig.tabCards?.[tab]?.filter((c) => (c.position ?? 'after') === position)
  if (!cards?.length) return null

  return (
    <>
      {cards.map((card) => (
        <Section key={card.value} title={card.label} initialOpen collapsible={false}>
          <LazyTabCard
            entityType={entityType}
            cardValue={card.value}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />
        </Section>
      ))}
    </>
  )
}

/**
 * Lazy load and render a tab card component
 */
function LazyTabCard({
  entityType,
  cardValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  cardValue: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const componentLoader = getTabCardComponent(entityType, cardValue)

  if (!componentLoader) return null

  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!Component) {
    return <div className='p-2'>Loading...</div>
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}

/**
 * Map icon name (string) to icon component
 */
function getIconComponent(iconName: string) {
  const icons: Record<string, any> = {
    ticket: Ticket,
    'shopping-bag': ShoppingBag,
    mail: Mail,
    package: Package,
    house: HouseIcon,
    clock: Clock,
    messages: MessagesSquare,
    layers: Layers,
    truck: Truck,
    'list-todo': ListTodo,
    // Add more as needed
  }
  return icons[iconName] ?? HouseIcon
}
