// apps/web/src/components/manufacturing/ui/settings/opening-stock-tab.tsx
'use client'

// Parts > Settings > Costing, `?s=opening` (money 52-parts-costing-page.md
// §2.3): the opening-stock checklist on the left and THE RUN on the right.
//
// The split is `tariffs-settings-page.tsx`'s, with one deliberate departure:
// the right column is not a per-part editor. 495 parts selected one at a time
// into a right-hand form is the part create dialog with extra steps, and that
// dialog is exactly the door that is shut for every part that already exists.
//
// ⚠️ There is no selection driving the pane, so below `lg` - where the pane is
// a drawer rather than a column - it needs a trigger of its own. That is the
// button at the top of the list, and it is the only reason this file knows
// about the viewport at all.
//
// The bulk "set kind" is an ActionBar over the list's selection, not a control
// in the pane: the parts being classified are the rows somebody is looking at,
// and a button 480px away from them was a second place to hold a selection.

import { PartKind } from '@auxx/lib/resources/client'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
import { Boxes } from 'lucide-react'
import { useState } from 'react'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import { ListSelectionProvider } from '~/components/list-selection'
import { useMedia } from '~/hooks/use-media'
import { toOpeningStockKind, useOpeningStock } from '../../hooks/use-opening-stock'
import { OpeningStockList } from './opening-stock-list'
import { OpeningStockRun } from './opening-stock-run'

/** Matches `MasterDetailSplit`'s own desktop breakpoint. */
const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * The provider wraps BOTH columns, so the run pane and the list read one
 * selection store even though only the list renders checkboxes today.
 */
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

  /**
   * One action per part kind.
   *
   * Narrowed against the procedure's own enum rather than trusted: a kind added
   * to the registry that the write path does not take yet must not render as a
   * button that is refused on click. `flatMap` over `PartKind.values` so the
   * three names are never restated here.
   */
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
      accountTotals={opening.accountTotals}
      totalExtended={opening.totalExtended}
      countedByRole={opening.countedByRole}
      openingBaseline={opening.openingBaseline}
      onProposeBaseline={opening.proposeBaseline}
      isProposingBaseline={opening.isProposingBaseline}
      entryCount={opening.entries.length}
      exclusions={opening.exclusions}
      currencyCode={opening.currencyCode}
      cutoffPeriod={opening.cutoffPeriod}
      cutoffDate={opening.cutoffDate}
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
        pane={run}
        paneTitle='The run'
        paneOpen={runOpen}
        onPaneClose={() => setRunOpen(false)}
        defaultWidth={480}>
        <div className='flex flex-col'>
          {!isDesktop && (
            <div className='px-3 pt-3'>
              <Button variant='outline' size='sm' onClick={() => setRunOpen(true)}>
                <Boxes />
                Review the run ({opening.entries.length})
              </Button>
            </div>
          )}
          <OpeningStockList
            rows={opening.rows}
            counts={opening.counts}
            kindCounts={opening.kindCounts}
            // 🛑 Gate on the QUERY, never on an empty array. "No parts" is a claim
            // about the org, and rendering it mid-load makes it a false one.
            isLoading={opening.isLoading}
            currencyCode={opening.currencyCode}
            bulkMode={opening.bulkMode}
            onBulkModeChange={opening.setBulkMode}
            canSetKind={opening.canSetKind}
            isSettingKind={opening.isSettingKind}
            onSetKind={opening.setKind}
            onQuantityChange={opening.setQuantity}
            onUnitCostChange={opening.setUnitCost}
          />
        </div>
      </MasterDetailSplit>

      {/* Open while bulk mode is on OR anything is selected, so a checkbox
          clicked without the toggle still gets the bar (the store's implicit
          bulk mode). Closing it exits selection entirely. */}
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
