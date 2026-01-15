// apps/web/src/components/drawers/base-entity-drawer.tsx
'use client'

import * as React from 'react'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { HouseIcon, Clock, MessagesSquare, Ticket, ShoppingBag, Mail, Package } from 'lucide-react'
import { getEntityDrawerConfig, parseResourceId } from '@auxx/lib/resources/client'
import { getTabComponent } from './drawer-tab-registry'
import { useResource, useRecord } from '~/components/resources'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { TimelineTab } from '~/components/timeline'
import { useQueryState } from 'nuqs'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { type ResourceId } from '@auxx/types/resource'

interface BaseEntityDrawerProps {
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId | null
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
 * Base entity drawer that uses registry-based configuration
 * Supports both system entities (contact, part) and custom entities
 */
export function BaseEntityDrawer({
  resourceId,
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

  // Parse resourceId
  const { entityDefinitionId, entityInstanceId } = resourceId
    ? parseResourceId(resourceId)
    : { entityDefinitionId: null, entityInstanceId: null }

  // Get resource metadata
  const { resource } = useResource(entityDefinitionId)

  // Get record data
  const { record } = useRecord({
    resourceId,
    enabled: !!open && !!resourceId,
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
    ]

    const additionalTabs = drawerConfig.additionalTabs.map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: getIconComponent(tab.icon),
    }))

    return [...baseTabs, ...additionalTabs]
  }, [drawerConfig])

  /** Handle close */
  const handleClose = React.useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      onOpenChange(false)
    }
  }, [onClose, onOpenChange])

  if (!open || !resourceId || !drawerConfig || !entityType) return null

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

      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
          <div className="w-full h-full flex gap-0">
            <div className="w-full h-full flex flex-col overflow-auto justify-start">
              <OverflowTabsList
                tabs={tabs}
                value={activeTab}
                onValueChange={setActiveTab}
                variant="outline"
              />

              {/* Card content (person card, entity card, etc.) */}
              {cardContent}

              <div className="flex flex-1 overflow-hidden">
                {/* Base tabs - static */}
                <TabsContent value="overview" className="w-full">
                  <ScrollArea className="flex-1">
                    <Section
                      title="Details"
                      initialOpen
                      collapsible={false}
                      icon={<HouseIcon className="size-4" />}>
                      <EntityFields resourceId={resourceId} />
                    </Section>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="timeline" className="w-full h-full mt-0">
                  <ScrollArea className="flex-1">
                    <div className="p-3 flex-1 flex-col flex">
                      <TimelineTab resourceId={resourceId} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="comments" className="w-full h-full mt-0">
                  <ScrollArea className="flex-1">
                    <DrawerComments
                      resourceId={resourceId}
                      focusComposerTrigger={focusComposerTrigger}
                    />
                  </ScrollArea>
                </TabsContent>

                {/* Dynamic tabs from registry */}
                {drawerConfig.additionalTabs.map((tab) => (
                  <TabsContent key={tab.value} value={tab.value} className="w-full">
                    <ScrollArea className="flex-1">
                      <LazyTabComponent
                        entityType={entityType}
                        tabValue={tab.value}
                        entityInstanceId={entityInstanceId!}
                        resourceId={resourceId}
                        record={record}
                      />
                    </ScrollArea>
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
  resourceId,
  record,
}: {
  entityType: string
  tabValue: string
  entityInstanceId: string
  resourceId: string
  record?: Record<string, unknown>
}) {
  const componentLoader = getTabComponent(entityType, tabValue)

  if (!componentLoader) {
    return <div className="p-4 text-sm text-muted-foreground">Tab component not found</div>
  }

  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!Component) {
    return <div className="p-4">Loading...</div>
  }

  return <Component entityInstanceId={entityInstanceId} resourceId={resourceId} record={record} />
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
    // Add more as needed
  }
  return icons[iconName] ?? HouseIcon
}
