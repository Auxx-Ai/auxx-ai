// apps/web/src/components/manufacturing/ui/settings/opening-stock-tab.tsx
'use client'

// Parts > Manage > Set counts (money 52 §2.3; 111 D21): the Set counts checklist
// on the left and THE RUN on the right. `?parts=` / `?job=` prefilter the list (111 Q24).
// Below `lg` the pane is a drawer, so the list carries its own trigger for it.

import { PartKind } from '@auxx/lib/resources/client'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
import { Boxes, X } from 'lucide-react'
import { useState } from 'react'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import { ListSelectionProvider } from '~/components/list-selection'
import { useMedia } from '~/hooks/use-media'
import { BackflushDialog, type BackflushDialogRange } from '../../builds/backflush-dialog'
import {
  type OpeningStockRow,
  toOpeningStockKind,
  useOpeningStock,
} from '../../hooks/use-opening-stock'
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
  const [backflush, setBackflush] = useState<BackflushDialogRange | null>(null)
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

  /** Q25: backflush runs org-wide, from the earliest movement of any listed part to today. */
  const openBackflush = (rows: OpeningStockRow[]) => {
    const earliest = rows.reduce<Date | null>(
      (min, row) => (row.earliest && (!min || row.earliest < min) ? row.earliest : min),
      null
    )
    setBackflush({ from: earliest ?? new Date(), to: new Date() })
  }

  const run = (
    <OpeningStockRun
      entryCount={opening.entries.length}
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
        paneTitle='The run'
        paneOpen={runOpen}
        onPaneClose={() => setRunOpen(false)}
        defaultWidth={480}>
        <div className='flex h-full min-h-0 flex-col'>
          {(!isDesktop || opening.prefilter) && (
            <div className='flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3'>
              {!isDesktop && (
                <Button variant='outline' size='sm' onClick={() => setRunOpen(true)}>
                  <Boxes />
                  Review the run ({opening.entries.length})
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
            onDateChange={opening.setDate}
            onBackflush={openBackflush}
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
      <BackflushDialog
        open={backflush !== null}
        onOpenChange={(open) => {
          if (!open) setBackflush(null)
        }}
        range={backflush ?? undefined}
      />
    </>
  )
}
