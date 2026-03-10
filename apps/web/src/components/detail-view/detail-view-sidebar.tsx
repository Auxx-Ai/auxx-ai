// apps/web/src/components/detail-view/detail-view-sidebar.tsx
'use client'

import { parseRecordId } from '@auxx/lib/field-values/client'
import type { DrawerTabCardDefinition } from '@auxx/lib/resources/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import React from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { getTabCardComponent } from '~/components/drawers/drawer-tab-registry'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { DetailViewCardHeader } from './components/detail-view-card-header'
import type { DetailViewSidebarProps } from './types'

/** Memoized EntityFields for performance */
const MemoEntityFields = React.memo(EntityFields)

/**
 * DetailViewSidebar - sidebar component with card header and tabs (Overview, Comments)
 * Supports sidebarCards from config for entity-specific cards (metrics, customer, relationships)
 */
export function DetailViewSidebar({
  recordId,
  record,
  config,
  activeTab,
  onTabChange,
  icon,
  color,
  displayName,
}: DetailViewSidebarProps) {
  const { entityInstanceId } = parseRecordId(recordId)
  const entityType = config.entityType
  const sidebarCards = config.sidebarCards

  const beforeCards = sidebarCards?.filter((c) => c.position === 'before') ?? []
  const afterCards = sidebarCards?.filter((c) => (c.position ?? 'after') === 'after') ?? []

  return (
    <div className='h-full flex flex-col'>
      {/* Card header */}
      <DetailViewCardHeader icon={icon} color={color} displayName={displayName} record={record} />

      {/* Sidebar tabs */}
      <Tabs value={activeTab} onValueChange={onTabChange} className='flex-1 flex flex-col min-h-0'>
        <TabsList
          className='border-b w-full justify-start rounded-b-none bg-primary-100'
          variant='outline'>
          {config.sidebarTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} variant='outline'>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value='overview' className='flex-1 overflow-y-auto'>
          {/* Before cards (e.g., metrics) */}
          <SidebarCards
            cards={beforeCards}
            entityType={entityType}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />

          <MemoEntityFields recordId={recordId} className='m-4' />

          {/* After cards (e.g., customer, relationships) */}
          <SidebarCards
            cards={afterCards}
            entityType={entityType}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />
        </TabsContent>

        <TabsContent value='comments' className='flex-1 overflow-y-auto'>
          <DrawerComments recordId={recordId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Renders sidebar card components for the given card definitions
 */
function SidebarCards({
  cards,
  entityType,
  entityInstanceId,
  recordId,
  record,
}: {
  cards: DrawerTabCardDefinition[]
  entityType: string
  entityInstanceId: string
  recordId: string
  record: Record<string, unknown>
}) {
  if (!cards.length) return null

  return (
    <>
      {cards.map((card) => (
        <div key={card.value} className='space-y-1 p-4'>
          <h4 className='text-sm'>{card.label}</h4>
          <LazySidebarCard
            entityType={entityType}
            cardValue={card.value}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />
        </div>
      ))}
    </>
  )
}

/**
 * Lazy load and render a sidebar card component from the shared drawer tab card registry
 */
function LazySidebarCard({
  entityType,
  cardValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  cardValue: string
  entityInstanceId: string
  recordId: string
  record: Record<string, unknown>
}) {
  const componentLoader = getTabCardComponent(entityType, cardValue)
  const [Component, setComponent] = React.useState<React.ComponentType<DrawerTabProps> | null>(null)

  React.useEffect(() => {
    if (!componentLoader) return
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!componentLoader || !Component) return null

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}
