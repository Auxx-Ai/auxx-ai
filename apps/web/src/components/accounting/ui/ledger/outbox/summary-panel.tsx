// apps/web/src/components/accounting/ui/ledger/outbox/summary-panel.tsx

'use client'

// Rollback deletes the provider's copy and frees the bucket to be sent again; nothing
// here reverses a posting - that stays the ledger's own drawer.

import {
  type ExportBatchTab,
  exportObjectTypeLabel,
  type OutboxGroupBy,
  type OutboxOrder,
  type SummaryRowStatus,
  type UnbuiltGroupKey,
  unbuiltGroupKeyString,
} from '@auxx/lib/accounting/export/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton, TreeRowEmpty } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import {
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Layers,
  Loader,
  RefreshCw,
  RotateCcw,
  Send,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import {
  type BulkRunWatch,
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { EntryBlockers } from '../entry-blockers'
import { exportAvenueLabel } from '../export-avenue-labels'
import { formatMinor } from '../format'
import { remainingFailureItems } from './export-failure-remedy'
import { dayKeyLabel, GroupRow, groupConsecutiveByDay, totalsLabel } from './group-row'
import { OutboxRow } from './outbox-row'
import { TAB_ICON } from './outbox-tabs'
import { type OutboxFilters, outboxCategoryInput } from './outbox-toolbar'
import { BADGE_ROW_CLASS } from './posting-links'
import { PostingRow } from './posting-row'
import { RailBadge } from './rail-badge'

type SummaryRow = RouterOutputs['ledger']['exportBatches']['summaryRows']['items'][number]

const STATUS_ICON: Record<SummaryRowStatus, typeof CheckCircle2> = {
  not_sent: Layers,
  ready: CheckCircle2,
  ready_new: CheckCircle2,
  sending: CheckCircle2,
  sent: CheckCheck,
  sent_new: CheckCheck,
  failed: CircleAlert,
}

const SENDABLE: readonly SummaryRowStatus[] = ['not_sent', 'ready', 'ready_new']

interface SummaryPanelProps {
  tab: ExportBatchTab
  filters: OutboxFilters
  order: OutboxOrder
  /** `day` renders a header over consecutive rows sharing a day; the server orders to match. */
  groupBy: OutboxGroupBy | null
  bookTimeZone: string
  providerLabel: string
  canRelease: boolean
  canRollback: boolean
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
  activeSummaryKey: string | null
  onSelectSummary: (key: string) => void
  /** A retry went to the worker; the header tallies its frames by `runId`. */
  onReleased?: (runId: string, total: number) => void
  /** Row-by-row settles for a run, keyed by batch id. */
  watchRun: BulkRunWatch
  emptyTitle: string
  emptyDescription: string
  emptyAction?: React.ReactNode
}

/** The Summary view (95 §3.2): one row per period bucket, whether or not a batch holds it. */
export function SummaryPanel({
  tab,
  filters,
  order,
  groupBy,
  bookTimeZone,
  providerLabel,
  canRelease,
  canRollback,
  activePostingId,
  onSelectPosting,
  activeSummaryKey,
  onSelectSummary,
  onReleased,
  watchRun,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: SummaryPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const list = api.ledger.exportBatches.summaryRows.useInfiniteQuery(
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
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const dayGroups = useMemo(() => groupConsecutiveByDay(rows), [rows])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  const {
    run: runBulk,
    enqueue: enqueueBulk,
    ConfirmDialog: BulkConfirmDialog,
    isRunning: bulkRunning,
  } = useBulkRunner()
  // Shallow: `setItemIds` hands back a fresh array on every list render.
  const pendingIds = useListSelection(useShallow((state) => state.pendingIds))
  useEffect(() => {
    setItemIds(rows.map((row) => row.key))
  }, [rows, setItemIds])
  const selectedRows = selectedIds.flatMap((id) => byKey.get(id) ?? [])

  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  function refresh() {
    void utils.ledger.exportBatches.summaryRows.invalidate()
    void utils.ledger.exportBatches.list.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  const sendBucket = api.ledger.exportBatches.sendBucket.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Could not send', description: error.message }),
  })
  const rebuildBucket = api.ledger.exportBatches.rebuildBucket.useMutation({
    onSuccess: (result) => {
      if (result.rollback.status === 'refused')
        toastError({
          title: `Not rolled back from ${providerLabel}`,
          description: result.rollback.message ?? 'Nothing was rebuilt.',
        })
      refresh()
    },
    onError: (error) => toastError({ title: 'Could not rebuild', description: error.message }),
  })
  const retry = api.ledger.exportBatches.retry.useMutation()
  const rollback = api.ledger.exportBatches.rollback.useMutation()

  async function runRollback(keys: string[]) {
    const targets = keys.flatMap((key) => {
      const batch = byKey.get(key)?.batch
      return batch ? [{ key, batch }] : []
    })
    if (targets.length === 0) return
    const single = targets.length === 1 ? targets[0]?.batch : null
    const title = single
      ? `Roll back ${single.providerObjectId ? `provider object ${single.providerObjectId}` : 'this summary'}?`
      : `Roll back ${targets.length} summaries?`
    const description = `The copy in ${providerLabel} is deleted. Your books are not changed - the postings stay posted and return to Ready, not sent.`

    if (single) {
      const confirmed = await confirm({
        title,
        description,
        confirmText: 'Roll back',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      rollback.mutate(
        { batchId: single.id },
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

    const batchIdOf = new Map(targets.map(({ key, batch }) => [key, batch.id]))
    await runBulk(
      targets.map(({ key }) => key),
      (key) => rollback.mutateAsync({ batchId: batchIdOf.get(key) as string }),
      {
        title,
        description,
        confirmText: 'Roll back',
        pendingLabel: 'Rolling back…',
        removesItem: false,
        failureTitle: 'Some summaries could not be rolled back',
        onDone: () => {
          refresh()
          exitSelection()
        },
      }
    )
  }

  async function runRebuild(row: SummaryRow) {
    const confirmed = await confirm({
      title: `Roll back from ${providerLabel} and resend with the ${row.newCount} new ${row.newCount === 1 ? 'posting' : 'postings'}?`,
      description: `The copy in ${providerLabel} is deleted, then this summary is rebuilt from every posting in it and sent again.`,
      confirmText: 'Rebuild',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) rebuildBucket.mutate({ key: groupKey(row) })
  }

  async function runSend(keys: string[]) {
    await runBulk(
      keys,
      async (key) => {
        const row = byKey.get(key)
        if (row) await sendBucket.mutateAsync({ key: groupKey(row) })
      },
      {
        title: `Send ${keys.length} ${keys.length === 1 ? 'summary' : 'summaries'}?`,
        description: `Each one is built if it needs to be and sent to ${providerLabel}, one at a time.`,
        confirmText: 'Send',
        destructive: false,
        pendingLabel: 'Sending…',
        removesItem: false,
        failureTitle: 'Some summaries could not be sent',
        onDone: () => {
          refresh()
          exitSelection()
        },
      }
    )
  }

  function retryOne(batchId: string) {
    retry.mutate(
      { batchIds: [batchId] },
      {
        onSuccess: (result) => {
          if ('runId' in result) {
            if (blockedCount(result) > 0) toastError({ title: 'Not retried: accounts unmapped' })
            onReleased?.(result.runId, result.released.length)
          }
          refresh()
        },
        onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
      }
    )
  }

  async function runRetry(keys: string[]) {
    const batchIdOf = new Map(
      keys.flatMap((key) => {
        const id = byKey.get(key)?.batch?.id
        return id ? [[key, id] as const] : []
      })
    )
    const keyOf = new Map([...batchIdOf].map(([key, id]) => [id, key]))
    // The frames carry batch ids; the selection and its overlays are row keys.
    const watchByKey: BulkRunWatch = (runId, watcher) =>
      watchRun(runId, {
        settle: (batchId) => watcher.settle(keyOf.get(batchId) ?? batchId),
        end: watcher.end,
      })
    await enqueueBulk(
      [...batchIdOf.keys()],
      async (ids) => {
        const result = await retry.mutateAsync({
          batchIds: ids.map((key) => batchIdOf.get(key) as string),
        })
        if (!('runId' in result)) throw new Error('The retry was not queued.')
        const blocked = blockedCount(result)
        if (blocked > 0) toastError({ title: `${blocked} not retried: accounts unmapped` })
        onReleased?.(result.runId, result.released.length)
        return {
          runId: result.runId,
          released: result.released.map((id: string) => keyOf.get(id) ?? id),
        }
      },
      {
        title: `Retry ${batchIdOf.size} ${batchIdOf.size === 1 ? 'summary' : 'summaries'}?`,
        description: `Each one is sent to ${providerLabel} again.`,
        confirmText: 'Retry',
        destructive: false,
        pendingLabel: 'Retrying…',
        failureTitle: 'Some summaries could not be retried',
        watch: watchByKey,
        onDone: () => {
          refresh()
          exitSelection()
        },
      }
    )
  }

  const renderRow = (row: SummaryRow, depth = 0) => {
    const { batch, status } = row
    const pending = pendingIds.includes(row.key)
    const sending =
      pending ||
      (sendBucket.isPending &&
        !!sendBucket.variables &&
        unbuiltGroupKeyString(sendBucket.variables.key) === row.key)
    const retrying =
      pending ||
      (retry.isPending &&
        !!batch &&
        !!retry.variables &&
        'batchIds' in retry.variables &&
        retry.variables.batchIds.includes(batch.id))
    const rebuilding =
      rebuildBucket.isPending &&
      !!rebuildBucket.variables &&
      unbuiltGroupKeyString(rebuildBucket.variables.key) === row.key
    const rollingBack =
      rollback.isPending && (rollback.variables?.batchId === batch?.id || bulkRunning)
    const StateIcon = STATUS_ICON[status]
    const dateLabel = dayKeyLabel(row.dayKey, bookTimeZone)

    // A failed batch carries the adapter's verdict, a ready one what the mapping table
    // already refuses; `blockers` is live, so an account mapped since drops out.
    const blockers = batch?.blockers ?? []
    const items = batch
      ? batch.state === 'failed'
        ? remainingFailureItems(batch.failureItems, blockers)
        : blockers
      : []
    const blockedSend = SENDABLE.includes(status) && blockers.length > 0
    const allMapped =
      batch?.state === 'failed' && batch.failureItems.length > 0 && items.length === 0

    const refusal =
      batch && items.length > 0 ? (
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

    // A bucket of one IS its posting, so it opens that posting's drawer; it still unfolds for a refusal.
    const onlyPostingId =
      row.memberCount === 1 && (!batch || batch.members.length <= 1)
        ? (batch?.members[0]?.glPostingId ?? row.firstPostingId)
        : null
    const expandable = !onlyPostingId || refusal !== null
    const isOpen = openKeys.has(row.key)
    const toggleOpen = () => setOpenKeys((prev) => flip(prev, row.key))
    const openRow = () =>
      onlyPostingId ? onSelectPosting(onlyPostingId) : onSelectSummary(row.key)

    return (
      <OutboxRow
        key={row.key}
        id={row.key}
        depth={depth}
        icon={<StateIcon className='size-4 text-muted-foreground' />}
        date={dateLabel}
        typeLabel={exportAvenueLabel(row.avenue)}
        typeCount={row.memberCount}
        title={
          <span className='flex min-w-0 items-center gap-1.5'>
            {batch?.docNumber && (
              <span className='shrink-0 font-mono text-xs'>{batch.docNumber}</span>
            )}
            <span className='truncate'>
              {exportObjectTypeLabel(batch?.objectType ?? 'journal')}
            </span>
          </span>
        }
        // The items say it better, and printing both says it twice.
        description={
          batch?.state === 'failed' && batch.failureItems.length === 0
            ? (batch.lastError ?? undefined)
            : undefined
        }
        secondary={
          <span className={BADGE_ROW_CLASS}>
            {row.railId && <RailBadge railId={row.railId} />}
            {batch && batch.attempts > 0 && (
              <Badge variant='outline' size='xs'>
                {batch.attempts} {batch.attempts === 1 ? 'attempt' : 'attempts'}
              </Badge>
            )}
            {batch?.providerObjectUrl && (
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
        amount={formatMinor(row.totalMinor, row.currency)}
        actions={
          <>
            {/* The tab already names the state; the drawer carries the full badge. */}
            {(status === 'ready_new' || status === 'sent_new') && (
              <Badge variant='blue' size='xs'>
                {row.newCount} new
              </Badge>
            )}
            {(status === 'sending' || (SENDABLE.includes(status) && canRelease)) && (
              <TreeRowButton
                persistent
                tooltipText={
                  sending || status === 'sending'
                    ? `Sending to ${providerLabel}…`
                    : blockedSend
                      ? 'Map the accounts first'
                      : `Send now to ${providerLabel}`
                }
                disabled={sending || status === 'sending' || blockedSend}
                onClick={() => sendBucket.mutate({ key: groupKey(row) })}>
                {sending || status === 'sending' ? <Loader className='animate-spin' /> : <Send />}
              </TreeRowButton>
            )}
            {status === 'failed' && batch && canRelease && (
              <TreeRowButton
                persistent
                tooltipText='Retry now'
                disabled={retrying}
                onClick={() => retryOne(batch.id)}>
                <RefreshCw className={cn(retrying && 'animate-spin')} />
              </TreeRowButton>
            )}
            {status === 'sent_new' && canRollback && (
              <TreeRowButton
                persistent
                tooltipText={`Rebuild with the ${row.newCount} new`}
                disabled={rebuilding}
                onClick={() => void runRebuild(row)}>
                <RotateCcw className={cn(rebuilding && 'animate-spin')} />
              </TreeRowButton>
            )}
            {/* A failed batch that names an object is the read-back orphan: it exists at
                the provider and this button is the only door to it. */}
            {(status === 'sent' ||
              status === 'sent_new' ||
              (status === 'failed' && batch?.providerObjectId)) &&
              canRollback && (
                <TreeRowButton
                  persistent
                  tooltipText={`Roll back from ${providerLabel}`}
                  disabled={rollingBack}
                  onClick={() => void runRollback([row.key])}>
                  <Undo2 className={cn(rollingBack && 'animate-pulse')} />
                </TreeRowButton>
              )}
          </>
        }
        onOpen={openRow}
        selectLabel={`Select ${exportAvenueLabel(row.avenue)} summary of ${dateLabel}`}
        active={onlyPostingId ? activePostingId === onlyPostingId : activeSummaryKey === row.key}
        expandable={expandable}
        isOpen={isOpen}
        {...(expandable ? { onToggleOpen: toggleOpen } : {})}
        onRowClick={openRow}>
        {refusal}
        {!onlyPostingId && (
          <div className='flex flex-col gap-px py-1'>
            {batch?.members.map((member) => (
              <PostingRow
                key={member.glPostingId}
                posting={member}
                depth={depth + 1}
                currencyCode={row.currency}
                bookTimeZone={bookTimeZone}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
              />
            ))}
            {isOpen && (row.newCount > 0 || !batch) && (
              <NewPostings
                row={row}
                depth={depth + 1}
                bookTimeZone={bookTimeZone}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
              />
            )}
          </div>
        )}
      </OutboxRow>
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

  const sendKeys = selectedRows
    .filter((row) => SENDABLE.includes(row.status) && !row.batch?.blockers.length)
    .map((row) => row.key)
  const retryKeys = selectedRows
    .filter((row) => row.batch?.state === 'failed')
    .map((row) => row.key)
  const rollbackKeys = selectedRows
    .filter((row) => row.batch?.state === 'sent')
    .map((row) => row.key)

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
              count={`${group.rows.length} ${group.rows.length === 1 ? 'summary' : 'summaries'}`}
              total={totalsLabel(group.rows)}
              itemIds={group.rows.map((row) => row.key)}
              open={!closedGroups.has(group.key)}
              onToggle={() => setClosedGroups((prev) => flip(prev, group.key))}>
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
          getKey={(row: SummaryRow) => row.key}
          renderRow={(row: SummaryRow) => renderRow(row)}
        />
      )}
      <InfiniteListTail
        hasNextPage={list.hasNextPage}
        isFetchingNextPage={list.isFetchingNextPage}
        fetchNextPage={list.fetchNextPage}
        loadingLabel='Loading more summaries...'
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
          ...(tab === 'ready' && canRelease && sendKeys.length > 0
            ? [
                {
                  id: 'send',
                  label: 'Send',
                  icon: Send,
                  disabled: sendBucket.isPending || bulkRunning,
                  onClick: () => void runSend(sendKeys),
                },
              ]
            : []),
          ...(tab === 'failed' && canRelease && retryKeys.length > 0
            ? [
                {
                  id: 'retry',
                  label: 'Retry',
                  icon: RefreshCw,
                  disabled: retry.isPending || bulkRunning,
                  onClick: () => void runRetry(retryKeys),
                },
              ]
            : []),
          ...(tab === 'sent' && canRollback && rollbackKeys.length > 0
            ? [
                {
                  id: 'rollback',
                  label: `Roll back from ${providerLabel}`,
                  icon: Undo2,
                  variant: 'destructive' as const,
                  disabled: rollback.isPending || bulkRunning,
                  onClick: () => void runRollback(rollbackKeys),
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

/** The bucket's postings no live batch holds, read when its row is opened. */
function NewPostings({
  row,
  depth,
  bookTimeZone,
  activePostingId,
  onSelectPosting,
}: {
  row: SummaryRow
  depth: number
  bookTimeZone: string
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}) {
  const members = api.ledger.exportBatches.unbuiltMembers.useQuery({ group: groupKey(row) })
  if (members.isPending) return <TreeRowEmpty depth={depth} loading />
  if (!row.batch && !members.data?.length) {
    return <TreeRowEmpty depth={depth} icon={<Layers />} title='No postings' />
  }
  return (
    <>
      {members.data?.map((member) => (
        <PostingRow
          key={member.glPostingId}
          posting={member}
          depth={depth}
          currencyCode={row.currency}
          bookTimeZone={bookTimeZone}
          activePostingId={activePostingId}
          onSelectPosting={onSelectPosting}
          isNew={!!row.batch}
        />
      ))}
    </>
  )
}

function groupKey(row: SummaryRow): UnbuiltGroupKey {
  return {
    avenue: row.avenue,
    grainKey: row.grainKey,
    storeId: row.storeId,
    railId: row.railId,
    currency: row.currency,
  }
}

/** How many of a retry the mapping table refused (89 D8). */
function blockedCount(result: unknown): number {
  const blocked = (result as { blocked?: unknown } | null)?.blocked
  return Array.isArray(blocked) ? blocked.length : 0
}
