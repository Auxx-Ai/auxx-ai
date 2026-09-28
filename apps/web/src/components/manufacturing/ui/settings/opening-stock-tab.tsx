// apps/web/src/components/manufacturing/ui/settings/opening-stock-tab.tsx
'use client'

// Stock setup step 3 (plans/mrp/17 §5.3): the count list on the left and the run on the right.
// `?parts=` / `?job=` prefilter the list (111 Q24). Below `lg` the pane is a drawer.

import { PartKind } from '@auxx/lib/resources/client'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
import { Boxes, X } from 'lucide-react'
import { useState } from 'react'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import { ListSelectionProvider } from '~/components/list-selection'
import { useMedia } from '~/hooks/use-media'
import { toOpeningStockKind, useOpeningStock } from '../../hooks/use-opening-stock'
import { OpeningStockList } from './opening-stock-list'
import { OpeningStockRun } from './opening-stock-run'

/** Matches `MasterDetailSplit`'s own desktop breakpoint. */
const DESKTOP_QUERY = '(min-width: 1024px)'

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
  const { KindConfirmDialog } = opening

  // One action per kind the write path takes; a fourth registry kind never renders a button.
  const kindActions: ActionBarAction[] = PartKind.values.flatMap((option) => {
    const kind = toOpeningStockKind(option.value)
    if (!kind) return []
    return [
      {
        id: `set-kind-${kind}`,
        label: option.label,
        disabled: opening.isSettingKind || opening.selectedCount === 0,
        onClick: () => opening.setSelectedKind(kind),
      },
    ]
  })

  const run = (
    <OpeningStockRun
      entryCount={opening.runSize}
      summary={opening.summary}
      exclusions={opening.exclusions}
      cutoffPeriod={opening.cutoffPeriod}
      occurredAt={opening.occurredAt}
      onOccurredAtChange={opening.setOccurredAt}
      canOpenStock={opening.canOpenStock}
      isRunning={opening.isRunning}
      onRun={opening.run}
    />
  )

  return (
    <>
      <MasterDetailSplit
        id='parts-opening-stock'
        scroll='columns'
        pane={run}
        paneTitle='Save counts'
        paneOpen={runOpen}
        onPaneClose={() => setRunOpen(false)}
        defaultWidth={480}>
        <div className='flex h-full min-h-0 flex-col'>
          {(!isDesktop || opening.prefilter) && (
            <div className='flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3'>
              {!isDesktop && (
                <Button variant='outline' size='sm' onClick={() => setRunOpen(true)}>
                  <Boxes />
                  Review and save ({opening.runSize})
                </Button>
              )}
              {opening.prefilter && (
                <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                  Showing {opening.prefilter.count}{' '}
                  {opening.prefilter.count === 1 ? 'part' : 'parts'}{' '}
                  {opening.prefilter.fromJob ? 'from the import' : 'you picked'}
                  <Button variant='ghost' size='xs' onClick={opening.clearPrefilter}>
                    <X />
                    Show all
                  </Button>
                </span>
              )}
            </div>
          )}
          <OpeningStockList
            rows={opening.rows}
            counts={opening.counts}
            kindCounts={opening.kindCounts}
            // Gate on the QUERY, never on an empty array: "No parts" is a claim about the org.
            isLoading={opening.isLoading}
            currencyCode={opening.currencyCode}
            canSetKind={opening.canSetKind}
            isSettingKind={opening.isSettingKind}
            onSetKind={opening.setKind}
            onQuantityChange={opening.setQuantity}
            onUnitCostChange={opening.setUnitCost}
            onUseSuggestions={opening.applySuggestions}
          />
        </div>
      </MasterDetailSplit>

      <ActionBar
        open={opening.canSetKind && (opening.bulkMode || opening.selectedCount > 0)}
        onOpenChange={(open) => {
          if (!open) opening.exitSelection()
        }}
        selectedCount={opening.selectedCount}
        selectedLabel='selected'
        actions={kindActions}
        showClose
      />
      <KindConfirmDialog />
    </>
  )
}
