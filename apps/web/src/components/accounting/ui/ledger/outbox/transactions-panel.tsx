// apps/web/src/components/accounting/ui/ledger/outbox/transactions-panel.tsx

'use client'

import type { ExportBatchTab, OutboxGroupBy, OutboxOrder } from '@auxx/lib/accounting/export/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarDays, Loader, RefreshCw, Send, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { ExportBatchStateBadge } from './export-batch-badge'
import { dayKeyLabel, GroupRow, groupConsecutiveByDay, totalsLabel } from './group-row'
import { TAB_ICON } from './outbox-tabs'
import { type OutboxFilters, outboxCategoryInput } from './outbox-toolbar'
import { PostingRow } from './posting-row'

type PostingListRow = RouterOutputs['ledger']['listExportPostings']['items'][number]
type ExportState = NonNullable<PostingListRow['exportState']>

interface TransactionsPanelProps {
  tab: ExportBatchTab
  filters: OutboxFilters
  order: OutboxOrder
  groupBy: OutboxGroupBy | null
  bookTimeZone: string
  currencyCode: string
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
  emptyTitle: string
  emptyDescription: string
  emptyAction?: React.ReactNode
}

/** The Transaction view (95 §3.3): one row per posting, with the live batch that holds it. */
export function TransactionsPanel({
  tab,
  filters,
  order,
  groupBy,
  bookTimeZone,
  currencyCode,
  activePostingId,
  onSelectPosting,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: TransactionsPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { can } = useAccess()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  // In summary mode the bucket is the unit, so a posting has no export action of its own (95 D2).
  const actionable = getSetting('accounting.exportMode') !== 'summary'
  const canRelease = actionable && can(PermissionKey.ledgerPost)
  const canRollback = actionable && can(PermissionKey.ledgerControl)

  const list = api.ledger.listExportPostings.useInfiniteQuery(
    {
      tab,
      order,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      categories: outboxCategoryInput(filters),
    },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const rows = useMemo(
    () =>
      (list.data?.pages.flatMap((page) => page.items) ?? []).map((row) => ({
        posting: {
          glPostingId: row.id,
          postingType: row.postingType,
          docNumber: row.docNumber,
          memo: row.memo,
          txnDate: row.txnDate,
          totalMinor: row.totalMinor,
        },
        exportState: row.exportState,
        dayKey: row.txnDate,
        totalMinor: row.totalMinor,
        currency: currencyCode,
      })),
    [list.data, currencyCode]
  )
  type Row = (typeof rows)[number]
  const byId = useMemo(() => new Map(rows.map((row) => [row.posting.glPostingId, row])), [rows])
  const dayGroups = useMemo(() => groupConsecutiveByDay(rows), [rows])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  const { run: runBulk, ConfirmDialog: BulkConfirmDialog, isRunning: bulkRunning } = useBulkRunner()
  // Shallow: `setItemIds` hands back a fresh array on every list render.
  const pendingIds = useListSelection(useShallow((state) => state.pendingIds))
  useEffect(() => {
    setItemIds(rows.map((row) => row.posting.glPostingId))
  }, [rows, setItemIds])

  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())

  function refresh() {
    void utils.ledger.listExportPostings.invalidate()
    void utils.ledger.exportBatches.summaryRows.invalidate()
    void utils.ledger.exportBatches.list.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  // Callbacks ride each single `mutate`, so a bulk run toasts once, not per row.
  const send = api.ledger.exportBatches.send.useMutation()
  const retry = api.ledger.exportBatches.retry.useMutation()
  const rollback = api.ledger.exportBatches.rollback.useMutation()

  const batchIdOf = (id: string) => byId.get(id)?.exportState?.batchId as string
  const idsIn = (state: ExportState['state']) =>
    selectedIds.filter((id) => byId.get(id)?.exportState?.state === state)
  const bulkDone = () => {
    refresh()
    exitSelection()
  }

  async function rollbackOne(row: Row) {
    const batchId = row.exportState?.batchId
    if (!batchId) return
    const confirmed = await confirm({
      title: `Roll back ${row.posting.docNumber || 'this posting'}?`,
      description:
        "The provider's copy is deleted. Your books are not changed - the posting stays posted and returns to Ready.",
      confirmText: 'Roll back',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    rollback.mutate(
      { batchId },
      {
        onSuccess: (result) => {
          if (result.status === 'refused')
            toastError({
              title: 'Not rolled back',
              description: result.message ?? 'It was not removed.',
            })
          refresh()
        },
        onError: (error) =>
          toastError({ title: 'Could not roll back', description: error.message }),
      }
    )
  }

  const runSend = (ids: string[]) =>
    runBulk(ids, (id) => send.mutateAsync({ batchId: batchIdOf(id) }), {
      title: `Send ${ids.length} ${ids.length === 1 ? 'posting' : 'postings'}?`,
      description: 'Each one is sent to the provider, one at a time.',
      confirmText: 'Send',
      destructive: false,
      pendingLabel: 'Sending…',
      failureTitle: 'Some postings could not be sent',
      onDone: bulkDone,
    })
  const runRetry = (ids: string[]) =>
    runBulk(ids, (id) => retry.mutateAsync({ batchId: batchIdOf(id) }), {
      title: `Retry ${ids.length} ${ids.length === 1 ? 'posting' : 'postings'}?`,
      description: 'Each one is sent to the provider again, one at a time.',
      confirmText: 'Retry',
      destructive: false,
      pendingLabel: 'Retrying…',
      failureTitle: 'Some postings could not be retried',
      onDone: bulkDone,
    })
  const runRollback = (ids: string[]) =>
    runBulk(
      ids,
      async (id) => {
        const result = await rollback.mutateAsync({ batchId: batchIdOf(id) })
        if (result.status === 'refused') throw new Error(result.message ?? 'Refused')
      },
      {
        title: `Roll back ${ids.length} ${ids.length === 1 ? 'posting' : 'postings'}?`,
        description:
          "The provider's copies are deleted. Your books are not changed - the postings stay posted and return to Ready.",
        confirmText: 'Roll back',
        pendingLabel: 'Rolling back…',
        failureTitle: 'Some postings could not be rolled back',
        onDone: bulkDone,
      }
    )

  const renderRow = (row: Row, depth = 0) => {
    const { exportState, posting } = row
    const state = exportState?.state ?? null
    const batchId = exportState?.batchId
    const pending = pendingIds.includes(posting.glPostingId)
    const sending = pending || (send.isPending && send.variables?.batchId === batchId)
    const retrying =
      pending ||
      (retry.isPending &&
        !!retry.variables &&
        'batchId' in retry.variables &&
        retry.variables.batchId === batchId)
    const rollingBack = pending || (rollback.isPending && rollback.variables?.batchId === batchId)

    return (
      <PostingRow
        key={posting.glPostingId}
        posting={posting}
        depth={depth}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        activePostingId={activePostingId}
        onSelectPosting={onSelectPosting}
        selectable
        actions={
          <>
            {state === 'sending' && <Loader className='size-3.5 animate-spin text-primary-400' />}
            {exportState?.docNumber && (
              <Badge variant='outline' size='xs' className='font-mono'>
                {exportState.docNumber}
              </Badge>
            )}
            {/* Silent when it would only restate the tab. */}
            {state === null ? (
              <SimpleTooltip content='No batch holds this posting yet'>
                <Badge variant='outline' size='xs'>
                  Not sent
                </Badge>
              </SimpleTooltip>
            ) : (
              state !== tab && <ExportBatchStateBadge state={state} />
            )}
            {state === 'ready' && batchId && canRelease && (
              <TreeRowButton
                persistent
                tooltipText='Send now'
                disabled={sending}
                onClick={() =>
                  send.mutate(
                    { batchId },
                    {
                      onSuccess: refresh,
                      onError: (error) =>
                        toastError({ title: 'Could not send', description: error.message }),
                    }
                  )
                }>
                <Send className={cn(sending && 'animate-pulse')} />
              </TreeRowButton>
            )}
            {state === 'failed' && batchId && canRelease && (
              <TreeRowButton
                persistent
                tooltipText='Retry now'
                disabled={retrying}
                onClick={() =>
                  retry.mutate(
                    { batchId },
                    {
                      onSuccess: refresh,
                      onError: (error) =>
                        toastError({ title: 'Could not retry', description: error.message }),
                    }
                  )
                }>
                <RefreshCw className={cn(retrying && 'animate-spin')} />
              </TreeRowButton>
            )}
            {state === 'sent' && canRollback && (
              <TreeRowButton
                persistent
                tooltipText='Roll back from the provider'
                disabled={rollingBack}
                onClick={() => void rollbackOne(row)}>
                <Undo2 className={cn(rollingBack && 'animate-pulse')} />
              </TreeRowButton>
            )}
          </>
        }
      />
    )
  }

  if (list.isError)
    return (
      <p className='p-3 text-destructive text-xs'>
        The outbox could not be read. {list.error.message}
      </p>
    )

  if (!list.isPending && rows.length === 0)
    return (
      <div className='flex flex-1 flex-col p-3'>
        <EmptyState
          className='py-8'
          icon={TAB_ICON[tab]}
          title={emptyTitle}
          description={emptyDescription}
          button={emptyAction}
        />
      </div>
    )

  const sendIds = idsIn('ready')
  const retryIds = idsIn('failed')
  const rollbackIds = idsIn('sent')

  return (
    <div className='flex flex-1 flex-col gap-px p-3 pb-16'>
      {groupBy === 'day' ? (
        <TreeRowList
          items={dayGroups}
          loading={list.isPending}
          skeletonCount={4}
          className='gap-px'
          getKey={(group) => group.key}
          renderRow={(group) => (
            <GroupRow
              icon={<CalendarDays className='size-4 text-muted-foreground' />}
              label={group.key ? dayKeyLabel(group.key, bookTimeZone) : 'No date'}
              count={`${group.rows.length} ${group.rows.length === 1 ? 'posting' : 'postings'}`}
              total={totalsLabel(group.rows)}
              itemIds={group.rows.map((row) => row.posting.glPostingId)}
              open={!closedGroups.has(group.key)}
              onToggle={() =>
                setClosedGroups((prev) => {
                  const next = new Set(prev)
                  if (!next.delete(group.key)) next.add(group.key)
                  return next
                })
              }>
              {group.rows.map((row) => renderRow(row, 1))}
            </GroupRow>
          )}
        />
      ) : (
        <TreeRowList
          items={rows}
          loading={list.isPending}
          skeletonCount={4}
          className='gap-px'
          getKey={(row: Row) => row.posting.glPostingId}
          renderRow={(row: Row) => renderRow(row)}
        />
      )}
      <InfiniteListTail
        hasNextPage={list.hasNextPage}
        isFetchingNextPage={list.isFetchingNextPage}
        fetchNextPage={list.fetchNextPage}
        loadingLabel='Loading more postings...'
      />

      {actionable && (
        <ActionBar
          open={selecting}
          onOpenChange={(open) => !open && exitSelection()}
          duration={Number.POSITIVE_INFINITY}
          position='bottom-center'
          selectedCount={selectedIds.length}
          selectedLabel='selected'
          showClose
          actions={[
            ...(tab === 'ready' && canRelease && sendIds.length > 0
              ? [
                  {
                    id: 'send',
                    label: 'Send',
                    icon: Send,
                    disabled: send.isPending || bulkRunning,
                    onClick: () => void runSend(sendIds),
                  },
                ]
              : []),
            ...(tab === 'failed' && canRelease && retryIds.length > 0
              ? [
                  {
                    id: 'retry',
                    label: 'Retry',
                    icon: RefreshCw,
                    disabled: retry.isPending || bulkRunning,
                    onClick: () => void runRetry(retryIds),
                  },
                ]
              : []),
            ...(tab === 'sent' && canRollback && rollbackIds.length > 0
              ? [
                  {
                    id: 'rollback',
                    label: 'Roll back from the provider',
                    icon: Undo2,
                    variant: 'destructive' as const,
                    disabled: rollback.isPending || bulkRunning,
                    onClick: () => void runRollback(rollbackIds),
                  },
                ]
              : []),
          ]}
        />
      )}
      <ConfirmDialog />
      <BulkConfirmDialog />
    </div>
  )
}
