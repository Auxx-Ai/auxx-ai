// apps/web/src/components/mrp/ui/all-parts/all-parts-page.tsx

'use client'

import type { MrpListSort } from '@auxx/lib/mrp/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  Boxes,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  Loader,
  Package,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { ReportGrid, type RowIconRenderer } from '~/components/global/report-grid/report-grid'
import type { ReportGridRow } from '~/components/global/report-grid/report-grid-layout'
import { ReportMessage, ReportPageLayout } from '~/components/global/report-grid/report-page-layout'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useMrpDrawer } from '../../hooks/use-mrp-drawer'
import { type MrpFilters, mrpListInput, useMrpFilters } from '../../hooks/use-mrp-filters'
import { type MrpRun, type MrpRunAttempt, useMrpRun } from '../../hooks/use-mrp-run'
import { MrpDrawerHost } from '../mrp-drawer-host'
import {
  formatMrpAsOf,
  formatMrpRunStarted,
  MrpRunNowButton,
  mrpAsOfHint,
  useMrpToolbar,
} from '../mrp-toolbar-actions'
import {
  ALL_PARTS_COLUMNS,
  flatAllParts,
  groupAllPartsByFinishedGood,
  LOADING_ROWS,
} from './all-parts-rows'

/** The router's cap; the grid virtualises, so every page is fetched. */
const PAGE_SIZE = 2000

/** A part row gets the part glyph; a group heading gets none. */
const partRowIcon: RowIconRenderer = (_row, hasChildren) =>
  hasChildren ? null : <Package className='size-4 text-muted-foreground' />

const SORT_LABEL: Record<MrpListSort, string> = {
  priority: 'Urgency',
  orderByDate: 'Order by',
  stockoutDate: 'Stockout',
  partName: 'Part name',
}

/** `/app/parts/manage/all-parts`: every part in the run as one grid (07 §4.3, D36). */
export function AllPartsPage() {
  const mrpRun = useMrpRun()
  const { runId, run, failedRun, isRunning } = mrpRun
  useMrpToolbar('All parts', mrpAsOfHint(run))

  const { filters, setFilters } = useMrpFilters({ defaultTab: 'all' })
  const { partId: openPartId, openPart } = useMrpDrawer()

  // Only the order comes from the URL; the action list's filters never narrow this grid.
  const input = mrpListInput(gridFilters(filters), { runId, limit: PAGE_SIZE })
  const hasRun = !!run && !failedRun
  const list = api.mrp.list.useInfiniteQuery(input, {
    getNextPageParam: (page) => page.nextCursor,
    enabled: hasRun,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const term = filters.search.trim().toLowerCase()
  const grouped = filters.groupBy === 'finished_good'
  const matches = useMemo(() => {
    if (!term) return items
    return items.filter(
      (item) =>
        (item.partName ?? 'Unnamed part').toLowerCase().includes(term) ||
        !!item.partSku?.toLowerCase().includes(term)
    )
  }, [items, term])
  const { rows, partIdByRowId, sectionIds } = useMemo(() => {
    const today = new Date()
    return grouped
      ? groupAllPartsByFinishedGood(matches, today, items)
      : flatAllParts(matches, today)
  }, [grouped, matches, items])

  const handleRowClick = useCallback(
    (row: ReportGridRow) => {
      const partId = partIdByRowId.get(row.id)
      if (partId) openPart(partId)
    },
    [openPart, partIdByRowId]
  )
  const canRowDrill = useCallback(
    (row: ReportGridRow) => partIdByRowId.has(row.id),
    [partIdByRowId]
  )
  const isRowActive = useCallback(
    (row: ReportGridRow) => !!openPartId && partIdByRowId.get(row.id) === openPartId,
    [openPartId, partIdByRowId]
  )
  const search = useMemo(
    () => ({ value: filters.search, onChange: (value: string) => setFilters({ search: value }) }),
    [filters.search, setFilters]
  )

  const listRun = list.data?.pages[0]?.run ?? run
  const loading = mrpRun.isLoading || (hasRun && list.isPending)

  let body: ReactNode
  if (!loading && !hasRun) {
    body = (
      <ReportMessage>
        <NoPlanMessage run={run} failedRun={failedRun} isRunning={isRunning} onPin={mrpRun.pin} />
      </ReportMessage>
    )
  } else if (list.isError) {
    body = (
      <ReportMessage>
        <Alert variant='destructive'>
          <TriangleAlert />
          <AlertTitle>The plan could not be read</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      </ReportMessage>
    )
  } else if (!loading && items.length === 0) {
    body = (
      <ReportMessage>
        <EmptyState
          icon={CalendarClock}
          title='No parts in this run'
          description='The run planned no parts. Parts appear here once they have stock movements or open orders.'
        />
      </ReportMessage>
    )
  } else {
    body = (
      <ReportGrid
        // Remounted once every page is in, so `defaultOpenIds` opens every section.
        key={`${grouped}:${loading || hasNextPage}`}
        reportKey='mrp-all-parts'
        columns={[]}
        textColumns={ALL_PARTS_COLUMNS}
        rows={loading ? LOADING_ROWS : rows}
        currency=''
        labelHeading='Part'
        defaultLabelWidth={260}
        rowIcon={partRowIcon}
        search={search}
        openAll={!!term}
        defaultOpenIds={sectionIds}
        canRowDrill={canRowDrill}
        onRowClick={handleRowClick}
        isRowActive={isRowActive}
        footer={
          <div className='flex items-center justify-between gap-3 text-muted-foreground text-xs'>
            <span className='tabular-nums'>
              {loading
                ? 'Loading'
                : `${term ? `${matches.length} of ` : ''}${items.length} ${items.length === 1 ? 'part' : 'parts'}${hasNextPage ? ', loading more' : ''}`}
              {listRun && ` · as of ${formatMrpAsOf(listRun)}`}
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='ghost'
                size='sm'
                className={cn('h-7', grouped && 'bg-muted')}
                aria-pressed={grouped}
                onClick={() => setFilters({ groupBy: grouped ? 'none' : 'finished_good' })}>
                <Boxes />
                Group by product
              </Button>
              <SortControl filters={filters} onChange={setFilters} />
            </div>
          </div>
        }
      />
    )
  }

  return (
    <>
      <ReportPageLayout>{body}</ReportPageLayout>
      <MrpDrawerHost />
    </>
  )
}

/** The list input's filters with only the order kept. */
function gridFilters(filters: MrpFilters): MrpFilters {
  return {
    ...filters,
    tab: 'all',
    search: '',
    supplyType: [],
    suggestionKind: [],
    supplierIds: [],
    buffered: null,
  }
}

/** The grid has no column sort, so the order is the list's `?sort=` and `?direction=`. */
function SortControl({
  filters,
  onChange,
}: {
  filters: MrpFilters
  onChange: (patch: Partial<MrpFilters>) => void
}) {
  return (
    <div className='flex items-center gap-1'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='sm' className='h-7'>
            <ArrowUpDown />
            {SORT_LABEL[filters.sort]}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuRadioGroup
            value={filters.sort}
            onValueChange={(value) => onChange({ sort: value as MrpListSort })}>
            {(Object.keys(SORT_LABEL) as MrpListSort[]).map((sort) => (
              <DropdownMenuRadioItem key={sort} value={sort}>
                {SORT_LABEL[sort]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={filters.direction === 'asc' ? 'Ascending' : 'Descending'}
        onClick={() => onChange({ direction: filters.direction === 'asc' ? 'desc' : 'asc' })}>
        {filters.direction === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
      </Button>
    </div>
  )
}

/** No completed run, or the newest attempt failed after it (07 §8.1). */
function NoPlanMessage({
  run,
  failedRun,
  isRunning,
  onPin,
}: {
  run: MrpRun | null | undefined
  failedRun: MrpRunAttempt | null
  isRunning: boolean
  onPin: (runId: string) => void
}) {
  const { can } = useAccess()
  const runButton = can(PermissionKey.mrpManage) ? (
    <MrpRunNowButton variant='outline' className='' />
  ) : undefined

  if (failedRun)
    return (
      <EmptyState
        icon={CircleAlert}
        title='The last plan run failed'
        description={
          <>
            {failedRun.error ?? 'The run stopped without a reason.'}
            <br />
            {run
              ? `The previous plan is from ${formatMrpRunStarted(run)}.`
              : 'There is no earlier plan to fall back on.'}
          </>
        }
        button={
          <div className='flex items-center gap-2'>
            {run && (
              <Button variant='ghost' size='sm' onClick={() => onPin(run.id)}>
                Show the previous plan
              </Button>
            )}
            {runButton}
          </div>
        }
      />
    )

  return (
    <EmptyState
      icon={isRunning ? Loader : CalendarClock}
      title={isRunning ? 'The first plan is running' : 'No plan yet'}
      description={
        isRunning
          ? 'Every part fills in when it finishes.'
          : 'A plan run reads stock movements, open orders and lead times, and dates when each part needs ordering.'
      }
      button={isRunning ? undefined : runButton}
    />
  )
}
