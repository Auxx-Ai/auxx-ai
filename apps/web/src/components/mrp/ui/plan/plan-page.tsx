// apps/web/src/components/mrp/ui/plan/plan-page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { format } from 'date-fns'
import { Building2, CalendarClock, CircleAlert, Loader, Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { ListSelectionProvider, useListSelection } from '~/components/list-selection'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useMrpDrawer } from '../../hooks/use-mrp-drawer'
import { mrpListInput, useMrpFilters } from '../../hooks/use-mrp-filters'
import { type MrpRun, type MrpRunAttempt, useMrpRun } from '../../hooks/use-mrp-run'
import { MrpDrawerHost } from '../mrp-drawer-host'
import { MrpRunNowButton, mrpAsOfHint, useMrpToolbar } from '../mrp-toolbar-actions'
import { GroupRow } from '../rows/group-row'
import { MrpBulkBar } from '../rows/mrp-bulk-bar'
import { type MrpListRow, MrpRow } from '../rows/mrp-row'
import {
  ACTION_LIST_TABS,
  type ActionListTab,
  groupByFinishedGood,
  groupBySupplier,
  PLAN_TAB_ICON,
  PLAN_TAB_LABEL,
  planTabCount,
  planTabEmpty,
  suggestionTotal,
  toActionListTab,
} from './plan-tabs'
import { PlanToolbar } from './plan-toolbar'

const PAGE_SIZE = 100

/** `/app/parts/manage/plan`, the action list (07 §4.1). One selection per mount. */
export function PlanPage() {
  return (
    <ListSelectionProvider>
      <PlanBody />
    </ListSelectionProvider>
  )
}

function PlanBody() {
  const mrpRun = useMrpRun()
  const { runId, run, failedRun, isRunning } = mrpRun
  useMrpToolbar('Action list', mrpAsOfHint(run))

  const { filters, setFilters, clear, isDirty } = useMrpFilters()
  const tab = toActionListTab(filters.tab)
  const search = useDebounce(filters.search.trim(), 250)
  const searchPending = search !== filters.search.trim()
  const effective = { ...filters, tab }

  const summary = api.mrp.summary.useQuery({ runId: runId ?? null })
  const counts = summary.data?.counts

  const hasRun = !!run && !failedRun
  const list = api.mrp.list.useInfiniteQuery(
    mrpListInput(effective, { runId, search, limit: PAGE_SIZE }),
    { getNextPageParam: (page) => page.nextCursor, enabled: hasRun }
  )
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const listRunId = list.data?.pages[0]?.run?.id ?? run?.id

  const { partId: openPartId, openPart } = useMrpDrawer()

  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(items.map((item) => item.partId))
  }, [items, setItemIds])
  const filterKey = JSON.stringify([
    tab,
    search,
    filters.supplyType,
    filters.suggestionKind,
    filters.supplierIds,
    filters.buffered,
    filters.groupBy,
    filters.sort,
    filters.direction,
    runId,
  ])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a view change resets the selection
  useEffect(() => {
    exitSelection()
  }, [filterKey])

  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const groups = useMemo(
    () =>
      filters.groupBy === 'supplier'
        ? groupBySupplier(items)
        : filters.groupBy === 'finished_good'
          ? groupByFinishedGood(items)
          : null,
    [filters.groupBy, items]
  )
  const GroupIcon = filters.groupBy === 'finished_good' ? Package : Building2

  const renderRow = (item: MrpListRow, depth = 0) => (
    <MrpRow
      key={item.partId}
      item={item}
      depth={depth}
      active={item.partId === openPartId}
      onOpen={openPart}
    />
  )

  const loading = mrpRun.isLoading || (hasRun && list.isPending)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='shrink-0'>
        <ListToolbar sticky={false}>
          <ListToolbarGroup className='shrink-0'>
            <RadioTab
              value={tab}
              onValueChange={(value) => setFilters({ tab: value as ActionListTab })}
              size='sm'>
              {ACTION_LIST_TABS.map((value) => {
                const Icon = PLAN_TAB_ICON[value]
                const count = planTabCount(value, counts)
                return (
                  <RadioTabItem key={value} value={value}>
                    <Icon />
                    {PLAN_TAB_LABEL[value]}
                    {count > 0 && (
                      <span
                        title='Total before search and filters'
                        className='tabular-nums opacity-60'>
                        {count}
                      </span>
                    )}
                  </RadioTabItem>
                )
              })}
            </RadioTab>
          </ListToolbarGroup>
        </ListToolbar>
        <PlanToolbar
          filters={filters}
          onChange={setFilters}
          onClear={clear}
          isDirty={isDirty}
          counts={counts}
          supplierFacet={summary.data?.facets?.bySupplier}
          selectionDisabled={searchPending || !hasRun}
        />
      </div>

      {/* Keyed so a view change starts at the top instead of paging the new list's tail in. */}
      <ScrollArea key={filterKey} className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {!loading && !hasRun ? (
          <NoPlanState run={run} failedRun={failedRun} isRunning={isRunning} onPin={mrpRun.pin} />
        ) : list.isError ? (
          <p className='p-3 text-destructive text-xs'>
            The action list could not be read. {list.error.message}
          </p>
        ) : !loading && !searchPending && items.length === 0 ? (
          <div className='flex flex-1 flex-col p-3'>
            <EmptyState
              className='py-8'
              icon={PLAN_TAB_ICON[tab]}
              {...(isDirty
                ? { title: 'No matching parts', description: 'Try another search or filter.' }
                : planTabEmpty(tab))}
            />
          </div>
        ) : (
          <div className='flex flex-1 flex-col gap-px p-3 pb-16'>
            {groups ? (
              <TreeRowList
                items={groups}
                loading={loading}
                skeletonCount={6}
                className='gap-px'
                getKey={(group) => group.key}
                renderRow={(group) => (
                  <GroupRow
                    icon={<GroupIcon className='size-4 text-muted-foreground' />}
                    label={group.label}
                    count={`${group.items.length} ${group.items.length === 1 ? 'part' : 'parts'}`}
                    total={suggestionTotal(group.items)}
                    itemIds={group.items.map((item) => item.partId)}
                    open={!closedGroups.has(group.key)}
                    onToggle={() =>
                      setClosedGroups((prev) => {
                        const next = new Set(prev)
                        if (!next.delete(group.key)) next.add(group.key)
                        return next
                      })
                    }>
                    {group.items.map((item) => renderRow(item, 1))}
                  </GroupRow>
                )}
              />
            ) : (
              <TreeRowList
                items={items}
                loading={loading}
                skeletonCount={6}
                className='gap-px'
                getKey={(item) => item.partId}
                renderRow={(item) => renderRow(item)}
              />
            )}
            <InfiniteListTail
              hasNextPage={list.hasNextPage}
              isFetchingNextPage={list.isFetchingNextPage}
              fetchNextPage={list.fetchNextPage}
              loadingLabel='Loading more parts...'
            />
            <MrpBulkBar items={items} runId={listRunId} />
          </div>
        )}
      </ScrollArea>
      <MrpDrawerHost />
    </div>
  )
}

/** No completed run, or the newest attempt failed after it (07 §4.1 states). */
function NoPlanState({
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
  const canRun = can(PermissionKey.mrpManage)
  const runButton = canRun ? <MrpRunNowButton variant='outline' className='' /> : undefined

  if (failedRun)
    return (
      <div className='flex flex-1 flex-col p-3'>
        <EmptyState
          className='py-8'
          icon={CircleAlert}
          title='The last plan run failed'
          description={
            <>
              {failedRun.error ?? 'The run stopped without a reason.'}
              <br />
              {run
                ? `The previous plan is from ${format(run.asOf, 'MMM d, HH:mm')}.`
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
      </div>
    )

  return (
    <div className='flex flex-1 flex-col p-3'>
      <EmptyState
        className='py-8'
        icon={isRunning ? Loader : CalendarClock}
        title={isRunning ? 'The first plan is running' : 'No plan yet'}
        description={
          isRunning
            ? 'The action list fills in when it finishes.'
            : 'A plan run reads stock movements, open orders and lead times, and dates when each part needs ordering.'
        }
        button={isRunning ? undefined : runButton}
      />
    </div>
  )
}
