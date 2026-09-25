// apps/web/src/components/mrp/ui/suppliers/suppliers-page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { format } from 'date-fns'
import { Building2, CalendarClock, CircleAlert, Loader } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useListSelection,
} from '~/components/list-selection'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useMrpDrawer } from '../../hooks/use-mrp-drawer'
import { type MrpRun, type MrpRunAttempt, useMrpRun } from '../../hooks/use-mrp-run'
import { MrpDrawerHost } from '../mrp-drawer-host'
import { MrpRunNowButton, mrpAsOfHint, useMrpToolbar } from '../mrp-toolbar-actions'
import { MRP_LIST_PADDING } from '../plan/plan-tabs'
import { MrpBulkBar } from '../rows/mrp-bulk-bar'
import type { SupplierCard } from './supplier-group'
import { SupplierOrderCard } from './supplier-order-card'

/** Scheduled suppliers first, each kind by next order date (07 §4.2). */
function orderCards(cards: readonly SupplierCard[]): SupplierCard[] {
  const rank = (card: SupplierCard) => (card.orderMode === 'scheduled' ? 0 : 1)
  return [...cards].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.nextOrderDate ?? '9999').localeCompare(b.nextOrderDate ?? '9999') ||
      (a.name ?? '').localeCompare(b.name ?? '')
  )
}

/** `/app/parts/manage/suppliers`: one block per supplier, in order of next order date. */
export function SuppliersPage() {
  return (
    <ListSelectionProvider>
      <SuppliersBody />
    </ListSelectionProvider>
  )
}

function SuppliersBody() {
  const mrpRun = useMrpRun()
  const { runId, run, failedRun, isRunning } = mrpRun
  useMrpToolbar('Suppliers', mrpAsOfHint(run))
  const hasRun = !!run && !failedRun

  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()

  const next = api.mrp.supplierNextOrder.useQuery({ runId: runId ?? null }, { enabled: hasRun })
  const cards = useMemo(() => orderCards(next.data?.suppliers ?? []), [next.data])
  const supplierIds = useMemo(() => cards.map((card) => card.supplierId), [cards])
  const list = api.mrp.list.useQuery(
    { runId: runId ?? null, tab: 'all', supplierIds, limit: 2000 },
    { enabled: hasRun && supplierIds.length > 0 }
  )
  const rows = useMemo(
    () => new Map((list.data?.items ?? []).map((row) => [row.partId, row])),
    [list.data]
  )

  const visible = useMemo(
    () => (term ? cards.filter((card) => (card.name ?? '').toLowerCase().includes(term)) : cards),
    [cards, term]
  )
  // Only when-needed rows are pickable; a scheduled card's ticks are its own state.
  const pickable = useMemo(
    () =>
      visible.flatMap((card) =>
        card.orderMode === 'scheduled' ? [] : card.parts.flatMap((p) => rows.get(p.partId) ?? [])
      ),
    [visible, rows]
  )

  const { partId: openPartId } = useMrpDrawer()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(pickable.map((row) => row.partId))
  }, [pickable, setItemIds])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a view change resets the selection
  useEffect(() => {
    exitSelection()
  }, [term, runId])

  const loading = mrpRun.isLoading || (hasRun && next.isPending)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='shrink-0'>
        <ListToolbar sticky={false}>
          <SelectAllCheckbox listPadding={MRP_LIST_PADDING} disabled={!hasRun} />
          <ListToolbarGroup className='min-w-40 flex-1'>
            <InputSearch
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
              placeholder='Search suppliers'
              className='h-7'
            />
          </ListToolbarGroup>
        </ListToolbar>
      </div>

      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {!loading && !hasRun ? (
          <NoRunState run={run} failedRun={failedRun} isRunning={isRunning} onPin={mrpRun.pin} />
        ) : next.isError ? (
          <p className='p-3 text-destructive text-xs'>
            The suppliers could not be read. {next.error.message}
          </p>
        ) : !loading && visible.length === 0 ? (
          <div className='flex flex-1 flex-col p-3'>
            <EmptyState
              className='py-8'
              icon={Building2}
              {...(term
                ? { title: 'No matching suppliers', description: 'Try another search.' }
                : {
                    title: 'No supplier orders',
                    description:
                      'No supplier is on a schedule and the run suggests no purchase from any supplier.',
                  })}
            />
          </div>
        ) : (
          <div className='flex flex-1 flex-col gap-px p-3 pb-16'>
            <TreeRowList
              items={visible}
              loading={loading}
              skeletonCount={6}
              className='gap-px'
              getKey={(card) => card.supplierId}
              renderRow={(card) => (
                <SupplierOrderCard
                  card={card}
                  rows={rows}
                  runId={runId}
                  activePartId={openPartId}
                />
              )}
            />
            <MrpBulkBar items={pickable} runId={next.data?.run?.id ?? run?.id} />
          </div>
        )}
      </ScrollArea>
      <MrpDrawerHost />
    </div>
  )
}

/** No completed run, or the newest attempt failed after it (07 §4.1 states). */
function NoRunState({
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
            ? 'The supplier orders fill in when it finishes.'
            : 'A plan run dates each supplier’s next order from stock, open orders and lead times.'
        }
        button={isRunning ? undefined : runButton}
      />
    </div>
  )
}
