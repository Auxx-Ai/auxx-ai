// apps/web/src/components/accounting/ui/ledger/ledger-summary-panel.tsx

'use client'

// The Entries section's Summary mode (TARGET §6, step 3 part C): the same
// `ledger.summary` read in both export modes, grouped by avenue, grain bucket,
// store, rail and currency, each row expandable to its member postings. In
// Summary export mode a row IS an export batch; `exportBatches.list` for the
// same month is matched onto it by the identical grouping key so the state
// badge shows beside a row that has one, without a second column of state.

import type { PostingSummary } from '@auxx/lib/accounting/journals/client'
import type { LedgerSummaryRow } from '@auxx/lib/accounting/ledger'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ChartBar, PanelRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { firstDayOfPeriod, lastDayOfPeriod } from '../journal/period-helpers'
import { exportAvenueLabel } from './export-avenue-labels'
import { EMPTY_CELL, formatAccountingDate, formatMinor } from './format'
import { ExportBatchStateBadge } from './outbox/export-batch-badge'
import { useLedgerSources } from './use-ledger-sources'

interface LedgerSummaryPanelProps {
  periodKey: string
  currencyCode: string
  bookTimeZone: string
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * The grouping key `readLedgerSummary` and `listExportBatches` both bucket by -
 * reproduced here (not imported) because it is over plain fields either DTO
 * carries, and importing a lib grouping helper for one string join is not
 * worth the subpath.
 */
function groupKey(row: {
  avenue: string
  grainKey: string
  storeId: string | null
  railId: string | null
  currency: string
}): string {
  return [row.avenue, row.grainKey, row.storeId ?? '', row.railId ?? '', row.currency].join(' ')
}

export function LedgerSummaryPanel({
  periodKey,
  currencyCode,
  bookTimeZone,
  activePostingId,
  onSelectPosting,
}: LedgerSummaryPanelProps) {
  const { sourceName } = useLedgerSources()

  const summaryQuery = api.ledger.summary.useQuery(
    { from: firstDayOfPeriod(periodKey), to: lastDayOfPeriod(periodKey) },
    { enabled: !!periodKey }
  )
  // The same month's batches, to badge a row that IS one in Summary mode -
  // absent in Transaction mode, where nothing here has a live batch yet.
  const batchesQuery = api.ledger.exportBatches.list.useQuery(
    { month: periodKey },
    { enabled: !!periodKey }
  )
  // The month's postings, read once here rather than per member row - the same
  // query `useMonthEntries` already runs for the Detail list, so this rides
  // the shared cache instead of adding a fetch per drilldown.
  const postingsQuery = api.ledger.listPostings.useQuery({ periodKey }, { enabled: !!periodKey })

  const batchByKey = useMemo(() => {
    const map = new Map<string, NonNullable<typeof batchesQuery.data>[number]>()
    for (const batch of batchesQuery.data ?? []) map.set(groupKey(batch), batch)
    return map
  }, [batchesQuery.data])

  const postingById = useMemo(() => {
    const map = new Map<string, PostingSummary>()
    for (const posting of postingsQuery.data ?? []) map.set(posting.id, posting)
    return map
  }, [postingsQuery.data])

  const rows = summaryQuery.data ?? []
  const isLoading = summaryQuery.isPending

  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (summaryQuery.isError) {
    return (
      <p className='p-3 text-destructive text-xs'>
        The summary could not be read. {summaryQuery.error.message}
      </p>
    )
  }

  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState
        icon={ChartBar}
        title='Nothing posted this month'
        description='Summary groups posted entries by avenue, period, store, rail and currency, with member postings a drilldown away. Nothing has posted yet.'
      />
    )
  }

  return (
    <div className='flex flex-col gap-px p-3'>
      <TreeRowList
        items={rows}
        loading={isLoading}
        skeletonCount={4}
        className='gap-px'
        getKey={(row: LedgerSummaryRow) => groupKey(row)}
        renderRow={(row: LedgerSummaryRow) => {
          const key = groupKey(row)
          const batch = batchByKey.get(key)
          const isOpen = openKeys.has(key)
          return (
            <TreeRow
              className={TREE_SECONDARY_NOTRUNCATE}
              expandable
              isOpen={isOpen}
              onToggleOpen={() => toggleOpen(key)}
              title={
                <span className='flex min-w-0 items-center gap-1.5'>
                  <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs'>
                    {row.grainKey}
                  </span>
                  <span className='truncate text-sm'>{exportAvenueLabel(row.avenue)}</span>
                </span>
              }
              secondary={
                <span className='flex flex-wrap items-center gap-1.5'>
                  {row.storeId && (
                    <Badge variant='outline' size='xs'>
                      {sourceName(row.storeId)}
                    </Badge>
                  )}
                  {row.railId && (
                    <Badge variant='outline' size='xs'>
                      {sourceName(row.railId)}
                    </Badge>
                  )}
                  <Badge variant='outline' size='xs'>
                    {row.postingIds.length} {row.postingIds.length === 1 ? 'posting' : 'postings'}
                  </Badge>
                  {batch && <ExportBatchStateBadge state={batch.state} />}
                </span>
              }
              actions={
                <span className='font-mono text-xs tabular-nums'>
                  {formatMinor(row.totalMinor, row.currency)}
                </span>
              }>
              <div className='flex flex-col gap-px py-1'>
                {row.postingIds.map((id) => {
                  const posting = postingById.get(id)
                  return (
                    <TreeRow
                      key={id}
                      depth={1}
                      className={TREE_SECONDARY_NOTRUNCATE}
                      icon={<PanelRight className='size-3.5 text-muted-foreground' />}
                      title={
                        <span className='flex min-w-0 items-center gap-1.5'>
                          <span className='shrink-0 font-mono text-xs'>
                            {posting?.docNumber || EMPTY_CELL}
                          </span>
                          <span className='truncate text-muted-foreground text-xs'>
                            {posting ? posting.postingType.replace(/_/g, ' ') : id}
                          </span>
                        </span>
                      }
                      secondary={
                        posting && (
                          <span className='text-muted-foreground text-xs'>
                            {formatAccountingDate(posting.txnDate, bookTimeZone)}
                          </span>
                        )
                      }
                      actions={
                        posting && (
                          <span className='font-mono text-xs tabular-nums'>
                            {formatMinor(posting.totalMinor, currencyCode)}
                          </span>
                        )
                      }
                      onToggleOpen={() => onSelectPosting(id)}
                      rowClassName={
                        activePostingId === id
                          ? 'bg-primary-100 ring-1 ring-primary-200'
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </TreeRow>
          )
        }}
      />
    </div>
  )
}
