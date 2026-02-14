// apps/web/src/components/detail-view/detail-view-sidebar.tsx
'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import React from 'react'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { DetailViewCardHeader } from './components/detail-view-card-header'
import type { DetailViewSidebarProps } from './types'

/** Memoized EntityFields for performance */
const MemoEntityFields = React.memo(EntityFields)

/**
 * DetailViewSidebar - sidebar component with card header and tabs (Overview, Comments)
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
          <MemoEntityFields recordId={recordId} className='m-4' />
        </TabsContent>

        <TabsContent value='comments' className='flex-1 overflow-y-auto'>
          <DrawerComments recordId={recordId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
