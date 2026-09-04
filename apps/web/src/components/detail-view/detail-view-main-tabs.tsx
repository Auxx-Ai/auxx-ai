// apps/web/src/components/detail-view/detail-view-main-tabs.tsx
'use client'

import type { ResolvedLayoutTab, TabVisibilityContext } from '@auxx/lib/record-layout/client'
import { visibleLayoutTabs, visibleTabBlocks } from '@auxx/lib/record-layout/client'
import type { LayoutBlock } from '@auxx/lib/resources/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Circle } from 'lucide-react'
import * as React from 'react'
import { LayoutBlockSection } from '~/components/drawers/blocks'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
import { useBlockVisibility } from '~/components/records/layout/use-block-visibility'
import { useRecordLayout } from '~/components/records/layout/use-record-layout'
import { parseRecordId, type RecordId } from '~/components/resources'
import { getDetailViewTabComponent } from './detail-view-tab-registry'
import type { DetailViewMainTabsProps, DetailViewTabProps } from './types'

/**
 * DetailViewMainTabs - main content area with tabs loaded from registry
 *
 * Tabs and the blocks placed on them come from the RESOLVED LAYOUT
 * (`plans/drawer/record-layout-system.md` §5), the same resolver the drawer
 * uses, so a section placed once renders on both surfaces (§10: landing the
 * shared block on one surface only is how the two registries drift). The
 * sidebar is deliberately untouched: it is a separate region and out of scope
 * (§9.7).
 */
export function DetailViewMainTabs({
  recordId,
  entityType,
  config,
  activeTab,
  onTabChange,
  record,
}: DetailViewMainTabsProps) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const { layout } = useRecordLayout({
    entityDefinitionId,
    entityType,
    surface: 'detail',
    detailConfig: config,
  })

  const isBlockVisible = useBlockVisibility({ entityType })

  // `detail-view.tsx` has already applied each registry tab's own
  // `permissionKey` / `recordResource` to `config.mainTabs`, so a tab that
  // reaches here and mounts a component of its own is allowed by definition.
  // What is left is §7's derived rule for a tab that IS its blocks: it renders
  // only while one of them is visible for this viewer.
  const visibilityCtx = React.useMemo<TabVisibilityContext>(
    () => ({ isBlockVisible }),
    [isBlockVisible]
  )

  const tabs = React.useMemo(
    () => visibleLayoutTabs(layout, visibilityCtx),
    [layout, visibilityCtx]
  )

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className='flex-1 h-full flex flex-col min-h-0'>
      <TabsList
        className='border-b w-full justify-start rounded-b-none bg-primary-150'
        variant='outline'>
        {tabs.map((tab) => {
          const Icon = resolveLayoutIcon(tab.icon) ?? Circle
          return (
            <TabsTrigger key={tab.id} value={tab.id} variant='outline'>
              <Icon className='size-3.5 mr-1.5 opacity-70' />
              {tab.label}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {/* Render tab contents */}
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className='flex flex-col flex-1 min-h-0'>
          <MainTabBody
            tab={tab}
            blocks={visibleTabBlocks(tab, visibilityCtx)}
            entityType={entityType}
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
 * One main tab's body: its `before` blocks, its own lazy component when it has
 * one, then its `after` blocks.
 *
 * A tab that carries blocks scrolls them in its own `ScrollArea`, because a
 * block renders at intrinsic height and would otherwise grow the panel
 * unbounded. A tab that is only its registered component keeps today's markup
 * exactly, since those components own a full-height column and their own scroll and
 * wrapping them would collapse that height chain.
 */
function MainTabBody({
  tab,
  blocks,
  entityType,
  entityInstanceId,
  recordId,
  record,
}: {
  tab: ResolvedLayoutTab
  blocks: LayoutBlock[]
  entityType: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const renderBlock = (block: LayoutBlock) => (
    <LayoutBlockSection
      key={block.id}
      block={block}
      entityType={entityType}
      entityInstanceId={entityInstanceId}
      recordId={recordId}
      record={record}
    />
  )

  // A base tab (timeline, tasks) carries no registry entry of its own but DOES
  // have a component, from `DETAIL_VIEW_TAB_COMPONENTS`' `*:timeline` /
  // `*:tasks` wildcards, so `hasOwnComponent` alone would blank it out.
  const ownComponent =
    tab.hasOwnComponent || tab.isBaseTab ? (
      <LazyTabComponent
        entityType={entityType}
        tabValue={tab.id}
        entityInstanceId={entityInstanceId}
        recordId={recordId}
        record={record}
      />
    ) : null

  // No blocks means this tab is exactly what it was before the layout system.
  if (blocks.length === 0) return ownComponent

  return (
    <ScrollArea className='flex-1'>
      {blocks.filter((block) => block.position === 'before').map(renderBlock)}
      {ownComponent}
      {blocks.filter((block) => block.position !== 'before').map(renderBlock)}
    </ScrollArea>
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
  recordId: RecordId
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
