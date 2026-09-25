// apps/web/src/components/mrp/ui/flags/flags-page.tsx

'use client'

import { MRP_FLAG_LABELS, type MrpFlag } from '@auxx/lib/mrp/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CalendarClock, Flag, FlagOff, Store } from 'lucide-react'
import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { ListSelectionProvider, useListSelection } from '~/components/list-selection'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { MRP_RECORD_TAB_PARAM, useMrpDrawer } from '../../hooks/use-mrp-drawer'
import { useMrpRun } from '../../hooks/use-mrp-run'
import { MrpDrawerHost } from '../mrp-drawer-host'
import { MrpRunNowButton, mrpAsOfHint, useMrpToolbar } from '../mrp-toolbar-actions'
import { GroupRow } from '../rows/group-row'
import { MrpBulkBar } from '../rows/mrp-bulk-bar'
import { type MrpListRow, MrpRow } from '../rows/mrp-row'
import { FLAG_EXPLANATIONS, FLAG_GROUP_ORDER } from './flag-groups'

const PAGE_SIZE = 100

/** `/app/parts/manage/flags` (07 §4.4): the run's flagged parts, one group per flag. */
export function FlagsPage() {
  return (
    <ListSelectionProvider>
      <FlagsBody />
    </ListSelectionProvider>
  )
}

function FlagsBody() {
  const mrpRun = useMrpRun()
  const { runId, run } = mrpRun
  useMrpToolbar('Flags', mrpAsOfHint(run))

  const summary = api.mrp.summary.useQuery({ runId: runId ?? null })
  const byFlag = summary.data?.counts?.byFlag
  const groups = useMemo(
    () => FLAG_GROUP_ORDER.filter((flag) => (byFlag?.[flag] ?? 0) > 0),
    [byFlag]
  )

  const { partId: openPartId, openPart } = useMrpDrawer()
  const openVendors = useOpenPartTab('vendors')

  const [openGroups, setOpenGroups] = useState<Set<MrpFlag>>(new Set())
  const toggleGroup = (flag: MrpFlag) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(flag)) next.add(flag)
      return next
    })

  // Each open group reports its loaded rows so the bulk bar and select-all see them.
  const [loaded, setLoaded] = useState<Map<MrpFlag, MrpListRow[]>>(new Map())
  const reportItems = useCallback(
    (flag: MrpFlag, items: MrpListRow[]) => setLoaded((prev) => new Map(prev).set(flag, items)),
    []
  )
  const items = useMemo(() => {
    const byPart = new Map<string, MrpListRow>()
    for (const flag of openGroups)
      for (const item of loaded.get(flag) ?? []) byPart.set(item.partId, item)
    return [...byPart.values()]
  }, [loaded, openGroups])

  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(items.map((item) => item.partId))
  }, [items, setItemIds])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a run change resets the selection
  useEffect(() => {
    exitSelection()
  }, [runId])

  const loading = mrpRun.isLoading || summary.isPending

  let body: React.ReactNode
  if (!loading && !run) {
    body = <NoRunState isRunning={mrpRun.isRunning} />
  } else if (summary.isError) {
    body = (
      <p className='p-3 text-destructive text-xs'>
        The flags could not be read. {summary.error.message}
      </p>
    )
  } else if (!loading && groups.length === 0) {
    body = (
      <div className='flex flex-1 flex-col p-3'>
        <EmptyState
          className='py-8'
          icon={FlagOff}
          title='Nothing is flagged'
          description='The plan found no data-quality problems in this run.'
        />
      </div>
    )
  } else {
    body = (
      <div className='flex flex-1 flex-col gap-px p-3 pb-16'>
        <TreeRowList
          items={groups}
          loading={loading}
          skeletonCount={6}
          className='gap-px'
          getKey={(flag) => flag}
          renderRow={(flag) => (
            <FlagGroup
              flag={flag}
              count={byFlag?.[flag] ?? 0}
              runId={runId ?? null}
              open={openGroups.has(flag)}
              onToggle={() => toggleGroup(flag)}
              onItems={reportItems}
              openPartId={openPartId}
              onOpen={openPart}
              onOpenVendors={openVendors}
            />
          )}
        />
        <MrpBulkBar items={items} runId={run?.id} />
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {body}
      </ScrollArea>
      <MrpDrawerHost />
    </div>
  )
}

interface FlagGroupProps {
  flag: MrpFlag
  count: number
  runId: string | null
  open: boolean
  onToggle: () => void
  onItems: (flag: MrpFlag, items: MrpListRow[]) => void
  openPartId: string | null
  onOpen: (partId: string) => void
  onOpenVendors: (partId: string) => void
}

/** One flag's header and, once opened, its parts from `mrp.list({ flags: [flag] })`. */
function FlagGroup({
  flag,
  count,
  runId,
  open,
  onToggle,
  onItems,
  openPartId,
  onOpen,
  onOpenVendors,
}: FlagGroupProps) {
  const list = api.mrp.list.useInfiniteQuery(
    { runId, flags: [flag], limit: PAGE_SIZE },
    { getNextPageParam: (page) => page.nextCursor, enabled: open }
  )
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  useEffect(() => {
    onItems(flag, items)
  }, [flag, items, onItems])

  return (
    <GroupRow
      icon={<Flag className='size-4 text-amber-600' />}
      label={MRP_FLAG_LABELS[flag]}
      count={`${count} ${count === 1 ? 'part' : 'parts'}`}
      description={FLAG_EXPLANATIONS[flag]}
      itemIds={items.map((item) => item.partId)}
      open={open}
      onToggle={onToggle}>
      {list.isPending ? (
        <TreeRowSkeleton depth={1} />
      ) : list.isError ? (
        <p className='py-1.5 ps-8 text-destructive text-xs'>{list.error.message}</p>
      ) : (
        <>
          {items.map((item) => (
            <MrpRow
              key={item.partId}
              item={item}
              depth={1}
              active={item.partId === openPartId}
              onOpen={onOpen}
              actions={<FlagDoor flag={flag} item={item} onOpenVendors={onOpenVendors} />}
            />
          ))}
          <InfiniteListTail
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
            loadingLabel='Loading more parts...'
          />
        </>
      )}
    </GroupRow>
  )
}

/** The fix a flag points at, where one exists; `null` for the rest. */
function FlagDoor({
  flag,
  item,
  onOpenVendors,
}: {
  flag: MrpFlag
  item: MrpListRow
  onOpenVendors: (partId: string) => void
}) {
  // TODO(111 X4): Adopt channel count, once `channel_drift` is a flag.
  // A made part's missing lead time is the build's, set on the Planning tab the row opens.
  if (flag !== 'no_lead_time' || item.supplyType === 'made') return null
  return (
    <Button
      variant='ghost'
      size='xs'
      onClick={(event) => {
        event.stopPropagation()
        onOpenVendors(item.partId)
      }}>
      <Store />
      Vendors
    </Button>
  )
}

/** Opens a part in the segment drawer on `tab` rather than the Planning tab `openPart` picks. */
function useOpenPartTab(tab: string) {
  const [, setParams] = useQueryStates({
    part: parseAsString,
    peek: parseAsArrayOf(parseAsString),
    panel: parseAsString,
    item: parseAsString,
    [MRP_RECORD_TAB_PARAM]: parseAsString,
  })
  return useCallback(
    (partId: string) =>
      void setParams({
        part: partId,
        peek: null,
        panel: null,
        item: null,
        [MRP_RECORD_TAB_PARAM]: tab,
      }),
    [setParams, tab]
  )
}

function NoRunState({ isRunning }: { isRunning: boolean }) {
  const { can } = useAccess()
  return (
    <div className='flex flex-1 flex-col p-3'>
      <EmptyState
        className='py-8'
        icon={CalendarClock}
        title={isRunning ? 'The first plan is running' : 'No plan yet'}
        description='Flags come from a plan run; they appear here when one completes.'
        button={
          !isRunning && can(PermissionKey.mrpManage) ? (
            <MrpRunNowButton variant='outline' className='' />
          ) : undefined
        }
      />
    </div>
  )
}
