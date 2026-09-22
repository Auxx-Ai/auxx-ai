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
import {
  type ExportBatchTab,
  exportObjectTypeLabel,
  type OutboxTab,
  unbuiltGroupKeyString,
} from '@auxx/lib/accounting/export/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import {
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader,
  PackagePlus,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react'
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
import { EntryBlockers } from '../entry-blockers'
import { exportAvenueLabel } from '../export-avenue-labels'
import { EMPTY_CELL, formatAccountingDate, formatMinor, formatShortPeriodLabel } from '../format'
import { postingTypeLabel } from '../type-labels'
import { useLedgerSources } from '../use-ledger-sources'
import { ExportBatchStateBadge } from './export-batch-badge'
import { remainingFailureItems } from './export-failure-remedy'
import { OutboxRow } from './outbox-row'
import { TAB_ICON } from './outbox-tabs'
import { type OutboxFilters, outboxCategoryInput } from './outbox-toolbar'

/** `ExportBatchRow` plus the server-computed deep link (plan 67 §5.6) - never built in the browser. */
type ExportBatchRow = RouterOutputs['ledger']['exportBatches']['list']['items'][number]
type UnbuiltRow = RouterOutputs['ledger']['exportBatches']['unbuilt']['items'][number]

interface BatchesPanelProps {
  filters: OutboxFilters
  emptyAction?: React.ReactNode

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
  /** A Release went to the worker; the header tallies its frames by `runId`. */
  onReleased?: (runId: string, total: number) => void
}

/** One tab's batches, newest first, paged; Release/Send, Retry or Roll back per row and over a selection. */
export function BatchesPanel({
  filters,
  emptyAction,
  tab,
  emptyTitle,
  emptyDescription,
  bookTimeZone,
  providerLabel,
  canRelease,
  canRollback,
  activePostingId,
  onSelectPosting,
  onReleased,
}: BatchesPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { sourceName } = useLedgerSources()

  const list = api.ledger.exportBatches.list.useInfiniteQuery(
    {
      tab,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      categories: outboxCategoryInput(filters),
    },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])

  // Summary mode only (empty otherwise): what Build would make of the posted,
  // unbatched entries, shown here so an approved draft has somewhere to be seen.
  // Read once the built batches are all on screen, so the page has one tail.
  const showUnbuilt = tab === 'ready' && !list.isPending && !list.hasNextPage
  const unbuiltList = api.ledger.exportBatches.unbuilt.useInfiniteQuery(
    {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      categories: outboxCategoryInput(filters),
    },
    { enabled: showUnbuilt, getNextPageParam: (page) => page.nextCursor }
  )
  const unbuilt = useMemo(
    () => unbuiltList.data?.pages.flatMap((page) => page.items) ?? [],
    [unbuiltList.data]
  )

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
    void utils.ledger.exportBatches.unbuilt.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  const build = api.ledger.exportBatches.build.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not build', description: error.message }),
  })

  const send = api.ledger.exportBatches.send.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not send', description: error.message }),
  })
  const retry = api.ledger.exportBatches.retry.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })
  const release = api.ledger.exportBatches.release.useMutation({
    onSuccess: (result) => {
      // 89 D8: the table refused some of them before a send was spent. The rows
      // already name which accounts, so the toast only carries the count.
      const blocked = blockedCount(result)
      if (blocked > 0) toastError({ title: `${blocked} not released: accounts unmapped` })
      onReleased?.(result.runId, result.released.length)
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

  if (showUnbuilt && !unbuiltList.isPending && rows.length === 0 && unbuilt.length === 0)
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
          const rollingBack =
            rollback.isPending && (rollback.variables?.batchId === batch.id || bulkRunning)
          const StateIcon = TAB_ICON[batch.state as OutboxTab] ?? CheckCircle2
          const onlyMember = batch.members.length === 1 ? batch.members[0] : null

          // 89 D6/D7: the refusal as the pieces of work it is made of. A failed
          // batch carries the adapter's verdict, a ready one what the mapping
          // table already refuses - one block, so both tabs refuse in one voice.
          // The verdict is last send's, so `blockers` re-checks it live and an
          // account mapped since then drops out of it.
          const items =
            batch.state === 'failed'
              ? remainingFailureItems(batch.failureItems, batch.blockers)
              : batch.blockers
          const blockedReady = batch.state === 'ready' && batch.blockers.length > 0
          const allMapped =
            batch.state === 'failed' && batch.failureItems.length > 0 && items.length === 0

          const refusal =
            items.length > 0 ? (
              <div className='ps-8 pb-1'>
                <EntryBlockers
                  blockers={[
                    {
                      status: batch.state === 'failed' ? 'export_refused' : 'export_blocked',
                      error: batch.lastError ?? '',
                      items,
                    },
                  ]}
                />
              </div>
            ) : allMapped ? (
              <p className='ps-8 pb-1 text-muted-foreground text-xs'>
                Every account this batch named is mapped now. Retry to send it.
              </p>
            ) : null

          // A batch of one IS its posting and has no member list to open, but a
          // refusal is still something to unfold - so it expands for that alone.
          const expandable = !onlyMember || refusal !== null

          return (
            <OutboxRow
              id={batch.id}
              icon={<StateIcon className='size-4 text-muted-foreground' />}
              date={batchDateLabel(batch, bookTimeZone)}
              typeLabel={exportAvenueLabel(batch.avenue)}
              title={
                <span className='flex min-w-0 items-center gap-1.5'>
                  {batch.docNumber && (
                    <span className='shrink-0 font-mono text-xs'>{batch.docNumber}</span>
                  )}
                  <span className='truncate'>{exportObjectTypeLabel(batch.objectType)}</span>
                </span>
              }
              // The items say it better, and printing both says it twice.
              description={
                batch.state === 'failed' && batch.failureItems.length === 0
                  ? (batch.lastError ?? undefined)
                  : undefined
              }
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
                  {/* Silent when it would only restate the tab; `sending` rides
                      the Ready tab (75-D6) and is the one that still says so. */}
                  {batch.state !== tab && (
                    <ExportBatchStateBadge state={batch.state} failureClass={batch.failureClass} />
                  )}
                  {tab === 'ready' && canRelease && (
                    <TreeRowButton
                      persistent
                      tooltipText={
                        blockedReady ? 'Map the accounts first' : `Send now to ${providerLabel}`
                      }
                      disabled={sending || blockedReady}
                      onClick={() => send.mutate({ batchId: batch.id })}>
                      <Send className={cn(sending && 'animate-pulse')} />
                    </TreeRowButton>
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
              // A batch of one IS the posting the drawer is showing, so the
              // highlight belongs on this row - it has no child row to carry it.
              active={!!onlyMember && activePostingId === onlyMember.glPostingId}
              expandable={expandable}
              isOpen={openBatchIds.has(batch.id)}
              {...(expandable ? { onToggleOpen: () => toggleOpen(batch.id) } : {})}
              // A batch of one is its posting, so its body click still opens
              // it even when the chevron is there for the refusal.
              {...(onlyMember
                ? { onRowClick: () => onSelectPosting(onlyMember.glPostingId) }
                : {})}>
              {refusal}
              {!onlyMember && (
                <BatchMembers
                  members={batch.members}
                  currencyCode={batch.currency}
                  bookTimeZone={bookTimeZone}
                  activePostingId={activePostingId}
                  onSelectPosting={onSelectPosting}
                />
              )}
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
      {/* After the last built batch, never between them: two paged lists stacked
          would put one list's Load more above the other's rows. */}
      {showUnbuilt && (
        <>
          {unbuilt.map((group) => {
            const building =
              build.isPending &&
              build.variables !== undefined &&
              'group' in build.variables &&
              unbuiltGroupKeyString(build.variables.group) === group.key
            const one = group.memberCount === 1
            return (
              <OutboxRow
                key={group.key}
                id={`unbuilt:${group.key}`}
                selectable={false}
                selectLabel={exportAvenueLabel(group.avenue)}
                icon={<Layers className='size-4 text-muted-foreground' />}
                date={grainDateLabel(group.grainKey, bookTimeZone, group.txnDateFrom)}
                typeLabel={exportAvenueLabel(group.avenue)}
                title={<span className='truncate'>{exportObjectTypeLabel('journal')}</span>}
                description='Posted here and not yet in a batch. Build makes the journal this row would send; approving more drafts in the same period adds to it until then.'
                secondary={
                  <span className='flex flex-wrap items-center gap-1.5'>
                    {group.storeId && (
                      <Badge variant='outline' size='xs'>
                        {sourceName(group.storeId)}
                      </Badge>
                    )}
                    {group.railId && (
                      <Badge variant='outline' size='xs'>
                        {sourceName(group.railId)}
                      </Badge>
                    )}
                    <Badge variant='outline' size='xs'>
                      {group.memberCount} {one ? 'posting' : 'postings'}
                    </Badge>
                  </span>
                }
                amount={formatMinor(group.totalMinor, group.currency)}
                actions={
                  <>
                    <Badge variant='outline' size='xs'>
                      Not built
                    </Badge>
                    {canRelease && (
                      <TreeRowButton
                        persistent
                        tooltipText='Build this batch'
                        disabled={building}
                        onClick={() =>
                          build.mutate({
                            from: group.txnDateFrom,
                            to: group.txnDateTo,
                            group: {
                              avenue: group.avenue,
                              grainKey: group.grainKey,
                              storeId: group.storeId,
                              railId: group.railId,
                              currency: group.currency,
                            },
                          })
                        }>
                        <PackagePlus className={cn(building && 'animate-pulse')} />
                      </TreeRowButton>
                    )}
                  </>
                }
                // A group of one IS its posting, so the row opens it; a wider group
                // opens its member list, read only then.
                onOpen={
                  one ? () => onSelectPosting(group.firstPostingId) : () => toggleOpen(group.key)
                }
                active={one && activePostingId === group.firstPostingId}
                expandable={!one}
                isOpen={openBatchIds.has(group.key)}
                {...(one ? {} : { onToggleOpen: () => toggleOpen(group.key) })}>
                {!one && openBatchIds.has(group.key) && (
                  <UnbuiltMembers
                    group={group}
                    bookTimeZone={bookTimeZone}
                    activePostingId={activePostingId}
                    onSelectPosting={onSelectPosting}
                  />
                )}
              </OutboxRow>
            )
          })}
          <InfiniteListTail
            hasNextPage={!!unbuiltList.hasNextPage}
            isFetchingNextPage={unbuiltList.isFetchingNextPage}
            fetchNextPage={unbuiltList.fetchNextPage}
            loadingLabel='Loading more groups...'
          />
        </>
      )}

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
          selectLabel={`Open ${member.docNumber ?? postingTypeLabel(member.postingType)}`}
          date={formatAccountingDate(member.txnDate, bookTimeZone)}
          typeLabel={postingTypeLabel(member.postingType)}
          title={
            <span className='shrink-0 font-mono text-xs'>{member.docNumber || EMPTY_CELL}</span>
          }
          amount={formatMinor(member.totalMinor, currencyCode)}
          onOpen={() => onSelectPosting(member.glPostingId)}
          active={activePostingId === member.glPostingId}
        />
      ))}
    </div>
  )
}

/** One unbuilt group's postings, read when its row is opened. */
function UnbuiltMembers({
  group,
  bookTimeZone,
  activePostingId,
  onSelectPosting,
}: {
  group: UnbuiltRow
  bookTimeZone: string
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}) {
  const members = api.ledger.exportBatches.unbuiltMembers.useQuery({
    group: {
      avenue: group.avenue,
      grainKey: group.grainKey,
      storeId: group.storeId,
      railId: group.railId,
      currency: group.currency,
    },
  })
  if (members.isPending) {
    return <p className='py-2 text-muted-foreground text-xs'>Loading postings...</p>
  }
  return (
    <BatchMembers
      members={members.data ?? []}
      currencyCode={group.currency}
      bookTimeZone={bookTimeZone}
      activePostingId={activePostingId}
      onSelectPosting={onSelectPosting}
    />
  )
}

/** How many of a Release the mapping table refused (89 D8); 0 before the server grows the list. */
function blockedCount(result: unknown): number {
  const blocked = (result as { blocked?: unknown } | null)?.blocked
  return Array.isArray(blocked) ? blocked.length : 0
}

/** The posting's day in Transaction mode; the summary grain (a day or a month) otherwise. */
function batchDateLabel(batch: ExportBatchRow, bookTimeZone: string): string {
  if (batch.mode === 'transaction') {
    const day = batch.members[0]?.txnDate
    return day ? formatAccountingDate(day, bookTimeZone) : EMPTY_CELL
  }
  return grainDateLabel(batch.grainKey, bookTimeZone, batch.members[0]?.txnDate)
}

/** A month grain reads as its period, a day grain as its date; a grain-less avenue's key is a posting id, so its day is the posting's. */
function grainDateLabel(grainKey: string, bookTimeZone: string, fallbackDay?: string): string {
  if (/^\d{4}-\d{2}$/.test(grainKey)) return formatShortPeriodLabel(grainKey)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(grainKey) ? grainKey : fallbackDay
  return day ? formatAccountingDate(day, bookTimeZone) : EMPTY_CELL
}
