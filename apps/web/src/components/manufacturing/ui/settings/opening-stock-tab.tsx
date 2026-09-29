// apps/web/src/components/manufacturing/ui/settings/opening-stock-tab.tsx
'use client'

// Stock setup step 3 (plans/mrp/17 §5.3): the count list on the left and the run on the right.
// `?parts=` / `?job=` prefilter the list (111 Q24). Below `lg` the pane is a drawer.

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
import { PanelRightOpen, X } from 'lucide-react'
import { useState } from 'react'
import { MasterDetailSplit, useCollapsedPane } from '~/components/global/master-detail-split'
import { ListSelectionProvider } from '~/components/list-selection'
import { useMedia } from '~/hooks/use-media'
import { useOpeningStock } from '../../hooks/use-opening-stock'
import { OpeningStockList } from './opening-stock-list'
import { OpeningStockRun } from './opening-stock-run'

/** Matches `MasterDetailSplit`'s own desktop breakpoint. */
const DESKTOP_QUERY = '(min-width: 1024px)'

const SPLIT_ID = 'parts-opening-stock'

export function OpeningStockTab() {
  return (
    <ListSelectionProvider>
      <OpeningStockTabInner />
    </ListSelectionProvider>
  )
}

function OpeningStockTabInner() {
  const opening = useOpeningStock()
  const isDesktop = useMedia(DESKTOP_QUERY)
  const [runOpen, setRunOpen] = useState(false)
  const [collapsed, setCollapsed] = useCollapsedPane(SPLIT_ID)
  const collapsedOnDesktop = isDesktop && collapsed

  const bulkActions: ActionBarAction[] = [
    {
      id: 'count-as-zero',
      label: 'Count as 0',
      disabled: opening.selectedCount === 0,
      onClick: opening.countSelectedAsZero,
    },
  ]
  const reopenButton = (!isDesktop || collapsed) && (
    <Button
      variant='outline'
      size='sm'
      onClick={() => (isDesktop ? setCollapsed(false) : setRunOpen(true))}>
      <PanelRightOpen />
      Review and save ({opening.runSize})
    </Button>
  )

  const run = (
    <OpeningStockRun
      entryCount={opening.runSize}
      summary={opening.summary}
      onClearDrafts={opening.clearDrafts}
      cutoffPeriod={opening.cutoffPeriod}
      occurredAt={opening.occurredAt}
      onOccurredAtChange={opening.setOccurredAt}
      canOpenStock={opening.canOpenStock}
      isRunning={opening.isRunning}
      onRun={opening.run}
      onCollapse={isDesktop ? () => setCollapsed(true) : undefined}
    />
  )

  return (
    <>
      <MasterDetailSplit
        id={SPLIT_ID}
        scroll='columns'
        pane={run}
        paneTitle='Save counts'
        paneOpen={runOpen}
        onPaneClose={() => setRunOpen(false)}
        collapsed={collapsedOnDesktop}
        defaultWidth={380}>
        <div className='flex h-full min-h-0 flex-col'>
          {opening.prefilter && (
            <div className='flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3'>
              <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                Showing {opening.prefilter.count} {opening.prefilter.count === 1 ? 'part' : 'parts'}{' '}
                {opening.prefilter.fromJob ? 'from the import' : 'you picked'}
                <Button variant='ghost' size='xs' onClick={opening.clearPrefilter}>
                  <X />
                  Show all
                </Button>
              </span>
            </div>
          )}
          <OpeningStockList
            rows={opening.rows}
            counts={opening.counts}
            canSelect={opening.canOpenStock}
            // Gate on the QUERY, never on an empty array: "No parts" is a claim about the org.
            isLoading={opening.isLoading}
            onQuantityChange={opening.setQuantity}
            toolbarActions={reopenButton}
          />
        </div>
      </MasterDetailSplit>

      <ActionBar
        open={opening.canOpenStock && (opening.bulkMode || opening.selectedCount > 0)}
        onOpenChange={(open) => {
          if (!open) opening.exitSelection()
        }}
        selectedCount={opening.selectedCount}
        selectedLabel='selected'
        actions={bulkActions}
        showClose
      />
    </>
  )
}
