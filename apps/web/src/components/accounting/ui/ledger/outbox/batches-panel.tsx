// apps/web/src/components/accounting/ui/ledger/outbox/batches-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the READY, SENT and FAILED tabs: one row per
// `ExportBatch`, expandable to the postings it carries (TARGET §3, §6).
//
// 🛑 Two verbs, never blurred: Release/Send hand a batch to (or push it
// straight at) the provider; Rollback deletes the provider's copy and frees
// the batch to be rebuilt. Nothing here reverses a posting - that stays the
// ledger's own drawer.

import type { ExportBatchMember } from '@auxx/lib/accounting/export'
import type { ExportBatchTab, OutboxTab } from '@auxx/lib/accounting/export/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, ExternalLink, Loader, RefreshCw, Send, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { exportAvenueLabel } from '../export-avenue-labels'
import {
  EMPTY_CELL,
  formatAccountingDate,
  formatMinor,
  formatShortPeriodLabel,
  humanizePostingType,
} from '../format'
import { useLedgerSources } from '../use-ledger-sources'
import { ExportBatchStateBadge } from './export-batch-badge'
import { OutboxRow } from './outbox-row'
import { TAB_ICON } from './outbox-tabs'

/** `ExportBatchRow` plus the server-computed deep link (plan 67 §5.6) - never built in the browser. */
type ExportBatchRow = RouterOutputs['ledger']['exportBatches']['list']['items'][number]

interface BatchesPanelProps {
  tab: ExportBatchTab
  /** Owned by `outbox-panel.tsx` so every tab's empty copy is written in one place. */
  emptyTitle: string
  emptyDescription: string
  bookTimeZone: string
  providerLabel: string
  canRelease: boolean
  canRollback: boolean
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/** One tab's batches, newest first, paged; Release/Send, Retry or Roll back per row and over a selection. */
export function BatchesPanel({
  tab,
  emptyTitle,
  emptyDescription,
  bookTimeZone,
  providerLabel,
  canRelease,
  canRollback,
  activePostingId,
  onSelectPosting,
}: BatchesPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { sourceName } = useLedgerSources()

  const list = api.ledger.exportBatches.list.useInfiniteQuery(
    { tab },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  const { run: runBulk, ConfirmDialog: BulkConfirmDialog, isRunning: bulkRunning } = useBulkRunner()
  useEffect(() => {
    setItemIds(rows.map((batch) => batch.id))
  }, [rows, setItemIds])

  const [openBatchIds, setOpenBatchIds] = useState<Set<string>>(new Set())
  function toggleOpen(batchId: string) {
    setOpenBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }

  function refresh() {
    void utils.ledger.exportBatches.list.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  const send = api.ledger.exportBatches.send.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not send', description: error.message }),
  })
  const retry = api.ledger.exportBatches.retry.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })
  const release = api.ledger.exportBatches.release.useMutation({
    onSuccess: () => {
      exitSelection()
      refresh()
    },
    onError: (error) => toastError({ title: 'Could not release', description: error.message }),
  })
  const rollback = api.ledger.exportBatches.rollback.useMutation()

  async function runRollback(batchIds: string[]) {
    const single = batchIds.length === 1 ? rows.find((batch) => batch.id === batchIds[0]) : null
    const title =
      batchIds.length === 1
        ? `Roll back ${single?.providerObjectId ? `provider object ${single.providerObjectId}` : 'this batch'}?`
        : `Roll back ${batchIds.length} batches?`
    const description = `The copy in ${providerLabel} is deleted. Your books are not changed - the postings stay posted and return to Ready, and will not be sent again until the next build and release.`

    if (batchIds.length === 1) {
      const confirmed = await confirm({
        title,
        description,
        confirmText: 'Roll back',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      rollback.mutate(
        { batchId: batchIds[0] as string },
        {
          onSuccess: (result) => {
            if (result.status === 'refused') {
              toastError({
                title: `Not rolled back from ${providerLabel}`,
                description: result.message ?? 'It was not removed.',
              })
            }
            refresh()
          },
          onError: (error) =>
            toastError({ title: 'Could not roll back', description: error.message }),
        }
      )
      return
    }

    await runBulk(batchIds, (id) => rollback.mutateAsync({ batchId: id }), {
      title,
      description,
      confirmText: 'Roll back',
      pendingLabel: 'Rolling back…',
      failureTitle: 'Some batches could not be rolled back',
      onDone: () => {
        refresh()
        exitSelection()
      },
    })
  }

  async function runRetry(batchIds: string[]) {
    await runBulk(batchIds, (id) => retry.mutateAsync({ batchId: id }), {
      title: `Retry ${batchIds.length} batches?`,
      description: `Each one is sent to ${providerLabel} again, in turn.`,
      confirmText: 'Retry',
      destructive: false,
      pendingLabel: 'Retrying…',
      removesItem: false,
      failureTitle: 'Some batches could not be retried',
      onDone: () => {
        refresh()
        exitSelection()
      },
    })
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
        <EmptyState icon={TAB_ICON[tab]} title={emptyTitle} description={emptyDescription} />
      </div>
    )

  return (
    <div className='flex flex-1 flex-col gap-px p-3 pb-16'>
      <TreeRowList
        items={rows}
        loading={list.isPending}
        skeletonCount={4}
        className='gap-px'
        getKey={(batch: ExportBatchRow) => batch.id}
        renderRow={(batch: ExportBatchRow) => {
          const sending = send.isPending && send.variables?.batchId === batch.id
          const retrying = retry.isPending && retry.variables?.batchId === batch.id
          const releasing =
            release.isPending && release.variables?.batchIds.includes(batch.id) === true
          const rollingBack =
            rollback.isPending && (rollback.variables?.batchId === batch.id || bulkRunning)
          const StateIcon = TAB_ICON[batch.state as OutboxTab] ?? CheckCircle2
          const onlyMember = batch.members.length === 1 ? batch.members[0] : null

          return (
            <OutboxRow
              id={batch.id}
              icon={<StateIcon className='size-4 text-muted-foreground' />}
              date={batchDateLabel(batch, bookTimeZone)}
              title={exportAvenueLabel(batch.avenue)}
              description={batch.state === 'failed' ? (batch.lastError ?? undefined) : undefined}
              secondary={
                <span className='flex flex-wrap items-center gap-1.5'>
                  {batch.storeId && (
                    <Badge variant='outline' size='xs'>
                      {sourceName(batch.storeId)}
                    </Badge>
                  )}
                  {batch.railId && (
                    <Badge variant='outline' size='xs'>
                      {sourceName(batch.railId)}
                    </Badge>
                  )}
                  <Badge variant='outline' size='xs' className='font-mono'>
                    {batch.objectType}
                  </Badge>
                  {batch.attempts > 0 && (
                    <Badge variant='outline' size='xs'>
                      {batch.attempts} {batch.attempts === 1 ? 'attempt' : 'attempts'}
                    </Badge>
                  )}
                  {batch.providerObjectUrl && (
                    <a
                      href={batch.providerObjectUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex items-center gap-1 text-primary-600 text-xs hover:underline'>
                      {batch.providerObjectId}
                      <ExternalLink className='size-3' />
                    </a>
                  )}
                </span>
              }
              amount={formatMinor(batch.totalMinor, batch.currency)}
              actions={
                <>
                  {batch.state === 'sending' && (
                    <Loader className='size-3.5 animate-spin text-primary-400' />
                  )}
                  <ExportBatchStateBadge state={batch.state} />
                  {tab === 'ready' && canRelease && (
                    <>
                      <TreeRowButton
                        persistent
                        tooltipText='Release to the export worker'
                        disabled={releasing}
                        onClick={() => release.mutate({ batchIds: [batch.id] })}>
                        <RefreshCw className={cn(releasing && 'animate-spin')} />
                      </TreeRowButton>
                      <TreeRowButton
                        persistent
                        tooltipText={`Send now to ${providerLabel}`}
                        disabled={sending}
                        onClick={() => send.mutate({ batchId: batch.id })}>
                        <Send className={cn(sending && 'animate-pulse')} />
                      </TreeRowButton>
                    </>
                  )}
                  {tab === 'failed' && canRelease && (
                    <TreeRowButton
                      persistent
                      tooltipText='Retry now'
                      disabled={retrying}
                      onClick={() => retry.mutate({ batchId: batch.id })}>
                      <RefreshCw className={cn(retrying && 'animate-spin')} />
                    </TreeRowButton>
                  )}
                  {/* A failed batch that names an object is the read-back orphan: it exists at
                      the provider and this button is the only door to it. */}
                  {(tab === 'sent' || (tab === 'failed' && batch.providerObjectId)) &&
                    canRollback && (
                      <TreeRowButton
                        persistent
                        tooltipText={`Roll back from ${providerLabel}`}
                        disabled={rollingBack}
                        onClick={() => void runRollback([batch.id])}>
                        <Undo2 className={cn(rollingBack && 'animate-pulse')} />
                      </TreeRowButton>
                    )}
                </>
              }
              // A transaction-mode batch IS one posting, so the button opens it;
              // a summary batch opens its member list instead.
              onOpen={
                onlyMember
                  ? () => onSelectPosting(onlyMember.glPostingId)
                  : () => toggleOpen(batch.id)
              }
              selectLabel={`Select ${exportAvenueLabel(batch.avenue)} batch of ${batchDateLabel(batch, bookTimeZone)}`}
              expandable
              isOpen={openBatchIds.has(batch.id)}
              onToggleOpen={() => toggleOpen(batch.id)}>
              <BatchMembers
                members={batch.members}
                currencyCode={batch.currency}
                bookTimeZone={bookTimeZone}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
              />
            </OutboxRow>
          )
        }}
      />
      <InfiniteListTail
        hasNextPage={list.hasNextPage}
        isFetchingNextPage={list.isFetchingNextPage}
        fetchNextPage={list.fetchNextPage}
        loadingLabel='Loading more batches...'
      />

      <ActionBar
        open={selecting}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          ...(tab === 'ready' && canRelease
            ? [
                {
                  id: 'release',
                  label: 'Release',
                  icon: RefreshCw,
                  disabled: release.isPending,
                  onClick: () => release.mutate({ batchIds: selectedIds }),
                },
              ]
            : []),
          ...(tab === 'failed' && canRelease
            ? [
                {
                  id: 'retry',
                  label: 'Retry',
                  icon: RefreshCw,
                  disabled: retry.isPending || bulkRunning,
                  onClick: () => void runRetry(selectedIds),
                },
              ]
            : []),
          ...(tab === 'sent' && canRollback
            ? [
                {
                  id: 'rollback',
                  label: `Roll back from ${providerLabel}`,
                  icon: Undo2,
                  variant: 'destructive' as const,
                  disabled: rollback.isPending || bulkRunning,
                  onClick: () => void runRollback(selectedIds),
                },
              ]
            : []),
        ]}
      />
      <ConfirmDialog />
      <BulkConfirmDialog />
    </div>
  )
}

/** The postings inside one batch - each opens the ledger's own `?posting=` drawer. */
function BatchMembers({
  members,
  currencyCode,
  bookTimeZone,
  activePostingId,
  onSelectPosting,
}: {
  members: ExportBatchMember[]
  currencyCode: string
  bookTimeZone: string
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}) {
  if (members.length === 0) {
    return <p className='py-2 text-muted-foreground text-xs'>No member postings.</p>
  }
  return (
    <div className='flex flex-col gap-px py-1'>
      {members.map((member) => (
        <OutboxRow
          key={member.glPostingId}
          id={member.glPostingId}
          depth={1}
          selectable={false}
          selectLabel={`Open ${member.docNumber ?? humanizePostingType(member.postingType)}`}
          date={formatAccountingDate(member.txnDate, bookTimeZone)}
          title={
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='shrink-0 font-mono text-xs'>{member.docNumber || EMPTY_CELL}</span>
              <span className='truncate text-muted-foreground text-xs'>
                {humanizePostingType(member.postingType)}
              </span>
            </span>
          }
          amount={formatMinor(member.totalMinor, currencyCode)}
          onOpen={() => onSelectPosting(member.glPostingId)}
          active={activePostingId === member.glPostingId}
        />
      ))}
    </div>
  )
}

/** The posting's day in Transaction mode; the summary grain (a day or a month) otherwise. */
function batchDateLabel(batch: ExportBatchRow, bookTimeZone: string): string {
  if (batch.mode === 'transaction') {
    const day = batch.members[0]?.txnDate
    return day ? formatAccountingDate(day, bookTimeZone) : EMPTY_CELL
  }
  if (/^\d{4}-\d{2}$/.test(batch.grainKey)) return formatShortPeriodLabel(batch.grainKey)
  return formatAccountingDate(batch.grainKey, bookTimeZone)
}
