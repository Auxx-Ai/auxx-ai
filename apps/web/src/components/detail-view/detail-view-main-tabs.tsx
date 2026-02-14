// apps/web/src/components/detail-view/detail-view-main-tabs.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import * as React from 'react'
import { parseRecordId } from '~/components/resources'
import { getDetailViewTabComponent } from './detail-view-tab-registry'
import type { DetailViewMainTabsProps, DetailViewTabProps } from './types'
import { getIconComponent } from './utils'

/**
 * DetailViewMainTabs - main content area with tabs loaded from registry
 */
export function DetailViewMainTabs({
  recordId,
  entityType,
  config,
  activeTab,
  onTabChange,
  record,
}: DetailViewMainTabsProps) {
  const { entityInstanceId } = parseRecordId(recordId)

  // Build tab definitions with icons
  const tabs = React.useMemo(
    () =>
      config.mainTabs.map((tab) => ({
        value: tab.value,
        label: tab.label,
        icon: getIconComponent(tab.icon),
      })),
    [config.mainTabs]
  )

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className='flex-1 h-full flex flex-col min-h-0'>
      <TabsList
        className='border-b w-full justify-start rounded-b-none bg-primary-150'
        variant='outline'>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} variant='outline'>
            <tab.icon className='size-3.5 mr-1.5 opacity-70' />
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Render tab contents */}
      {config.mainTabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className='flex flex-col flex-1 min-h-0'>
          <LazyTabComponent
            entityType={entityType}
            tabValue={tab.value}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

/**
 * Lazy load and render a tab component from registry
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
  const componentLoader = getDetailViewTabComponent(entityType, tabValue)
  const [Component, setComponent] = React.useState<React.ComponentType<DetailViewTabProps> | null>(
    null
  )
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    if (!componentLoader) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    componentLoader()
      .then((mod) => {
        setComponent(() => mod.default)
        setIsLoading(false)
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [componentLoader])

  if (isLoading) {
    return (
      <ScrollArea className='flex-1'>
        <div className='p-6 text-sm text-muted-foreground'>Loading...</div>
      </ScrollArea>
    )
  }

  if (!Component) {
    return (
      <ScrollArea className='flex-1'>
        <div className='p-6 text-sm text-muted-foreground'>
          Tab component not found for {entityType}:{tabValue}
        </div>
      </ScrollArea>
    )
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}
