// apps/web/src/components/accounting/ui/ledger/sync-queue/sync-queue-panel.tsx

'use client'

// Accounting > Ledger > the EXPORT QUEUE (TARGET §3, §4 gate 2, step 3 part C).
//
// Rebuilt onto `ExportBatch`, which replaces the old `AccountingDelivery`
// pile this panel used to show (step 3 part B deleted that version). One row
// per batch now, not one row per posting: in Transaction mode a batch holds
// exactly one posting, and in Summary mode it holds every posting a period,
// store, rail and currency rolled up (TARGET §6) - either way this is the
// single read `ledger.exportBatches.list` returns, expandable to the postings
// each batch carries.
//
// 🛑 All periods, always. Unlike the ledger page's own month-scoped sections,
// the queue is a backlog that can span months, so it reads with no `month`
// bound and the tabs (`EXPORT_BATCH_TABS`) are the only filter. "Build batches
// for this month" is the one control that DOES take the month on screen -
// building freezes a payload out of POSTED entries, which is inherently a
// month's worth of work at a time.
//
// 🛑 Two verbs, never blurred: Release/Send hand a batch to (or push it
// straight at) the provider; Rollback deletes the provider's copy and frees
// the batch to be rebuilt. Nothing here reverses a posting - that stays the
// ledger's own drawer.

import { PermissionKey } from '@auxx/lib/permissions/client'
import type { ExportBatchMember, ExportBatchRow } from '@auxx/lib/postings'
import { EXPORT_BATCH_TABS, type ExportBatchTab } from '@auxx/lib/postings/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import {
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Hammer,
  Loader,
  PanelRight,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { exportAvenueLabel } from '../export-avenue-labels'
import { EMPTY_CELL, formatAccountingDate, formatMinor } from '../format'
import { providerBatchObjectUrl } from '../post-result-callout'
import { useLedgerSources } from '../use-ledger-sources'
import { ExportBatchStateBadge } from './export-batch-badge'

const TAB_ICON: Record<ExportBatchTab, typeof CheckCircle2> = {
  ready: CheckCircle2,
  sending: Loader,
  sent: CheckCheck,
  failed: CircleAlert,
}

const TAB_LABEL: Record<ExportBatchTab, string> = {
  ready: 'Ready',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
}

interface SyncQueuePanelProps {
  tab: ExportBatchTab
  onTabChange: (tab: ExportBatchTab) => void
  /** The month on screen, for "Build batches for this month". `''` resolves none. */
  periodKey: string
  periodLabel: string
  bookTimeZone: string
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  providerConnected: boolean
  /** So an open row reads as "the one you are looking at" the same as the rail strip does. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * The queue. One `ListSelectionProvider` per mount, same as the banking review
 * queue and the old version of this panel - leaving the queue disposes the
 * selection.
 */
export function SyncQueuePanel(props: SyncQueuePanelProps) {
  return (
    <ListSelectionProvider>
      <SyncQueueBody {...props} />
    </ListSelectionProvider>
  )
}

function SyncQueueBody({
  tab,
  onTabChange,
  periodKey,
  periodLabel,
  bookTimeZone,
  providerLabel,
  providerConnected,
  activePostingId,
  onSelectPosting,
}: SyncQueuePanelProps) {
  const utils = api.useUtils()
  const { can } = useAccess()
  const [confirm, ConfirmDialog] = useConfirm()
  const { sourceName } = useLedgerSources()

  const canRelease = can(PermissionKey.ledgerPost)
  const canRollback = can(PermissionKey.ledgerControl)

  // Unbounded (every period), same query every tab reads - `ledger.exportBatches.list`
  // itself caps at 500, newest first. One fetch, filtered client-side per tab so
  // the tab badges can count without four separate reads.
  const batchesQuery = api.ledger.exportBatches.list.useQuery({})
  const all = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data])
  const isLoading = batchesQuery.isPending

  const visible = useMemo(() => all.filter((batch) => batch.state === tab), [all, tab])
  const tally = useMemo(() => {
    const counts: Record<ExportBatchTab, number> = { ready: 0, sending: 0, sent: 0, failed: 0 }
    for (const batch of all) {
      if (batch.state in counts) counts[batch.state as ExportBatchTab]++
    }
    return counts
  }, [all])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const toggle = useListSelection((state) => state.toggle)
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  const { run: runBulk, ConfirmDialog: BulkConfirmDialog, isRunning: bulkRunning } = useBulkRunner()

  const visibleIds = useMemo(() => visible.map((batch) => batch.id), [visible])
  useEffect(() => {
    setItemIds(visibleIds)
  }, [visibleIds, setItemIds])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab is the trigger
  useEffect(() => {
    exitSelection()
  }, [tab])

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
  }

  // ── Build batches for the month on screen ──────────────────────────────
  const build = api.ledger.exportBatches.build.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Error building batches', description: error.message }),
  })
  const [buildResult, setBuildResult] = useState<Awaited<
    ReturnType<typeof build.mutateAsync>
  > | null>(null)

  function handleBuild() {
    if (!periodKey) return
    setBuildResult(null)
    build.mutate({ periodKey }, { onSuccess: (result) => setBuildResult(result) })
  }

  // ── Per-batch actions ───────────────────────────────────────────────────
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
    const single = batchIds.length === 1 ? all.find((batch) => batch.id === batchIds[0]) : null
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

  function bulkRelease(batchIds: string[]) {
    release.mutate({ batchIds })
  }

  const selectable = tab === 'ready' || tab === 'sent'

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          Every batch in the books that is not yet a settled copy in {providerLabel}, or was
          refused. Every period, not only the month below.
        </p>
        {canRelease && (
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={!periodKey}
              loading={build.isPending}
              loadingText='Building…'
              onClick={handleBuild}>
              <Hammer />
              Build batches for {periodLabel || 'this month'}
            </Button>
          </div>
        )}
      </div>

      {buildResult && (
        <p className='text-muted-foreground text-xs'>{buildResultSentence(buildResult)}</p>
      )}

      <ListToolbar>
        {selectable && <SelectAllCheckbox listPadding={12} />}
        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={tab}
            onValueChange={(value) => onTabChange(value as ExportBatchTab)}
            size='sm'>
            {EXPORT_BATCH_TABS.map((value) => {
              const Icon = TAB_ICON[value]
              const count = tally[value]
              return (
                <RadioTabItem key={value} value={value}>
                  <Icon />
                  {TAB_LABEL[value]}
                  {count > 0 && <span className='tabular-nums opacity-60'>{count}</span>}
                </RadioTabItem>
              )
            })}
          </RadioTab>
        </ListToolbarGroup>
      </ListToolbar>

      {batchesQuery.isError ? (
        <p className='p-3 text-destructive text-xs'>
          The export queue could not be read. {batchesQuery.error.message}
        </p>
      ) : !isLoading && visible.length === 0 ? (
        <EmptyState
          icon={TAB_ICON[tab]}
          title={emptyTitle(tab)}
          description={<span>{emptyDescription(tab, providerLabel)}</span>}
        />
      ) : (
        <div className='flex flex-col gap-px pb-16'>
          <TreeRowList
            items={visible}
            loading={isLoading}
            skeletonCount={4}
            className='gap-px'
            getKey={(batch: ExportBatchRow) => batch.id}
            renderRow={(batch: ExportBatchRow) => {
              const isOpen = openBatchIds.has(batch.id)
              const url = providerBatchObjectUrl(providerConnected, batch.providerObjectId)
              const sending = send.isPending && send.variables?.batchId === batch.id
              const retrying = retry.isPending && retry.variables?.batchId === batch.id
              const releasing =
                release.isPending && release.variables?.batchIds.includes(batch.id) === true
              const rollingBack =
                rollback.isPending && (rollback.variables?.batchId === batch.id || bulkRunning)

              return (
                <TreeRow
                  className={TREE_SECONDARY_NOTRUNCATE}
                  expandable
                  isOpen={isOpen}
                  selectable={selectable}
                  selecting={selecting}
                  selected={selectedIds.includes(batch.id)}
                  onSelectChange={(_next, event) => toggle(batch.id, { shiftKey: event.shiftKey })}
                  selectLabel={`Select batch ${batch.grainKey}`}
                  title={
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs'>
                        {batch.grainKey}
                      </span>
                      <span className='truncate text-sm'>{exportAvenueLabel(batch.avenue)}</span>
                    </span>
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
                      <Badge variant='outline' size='xs' className='font-mono'>
                        {batch.objectType}
                      </Badge>
                      {batch.attempts > 0 && (
                        <Badge variant='outline' size='xs'>
                          {batch.attempts} {batch.attempts === 1 ? 'attempt' : 'attempts'}
                        </Badge>
                      )}
                      {batch.state === 'failed' && batch.lastError && (
                        <SimpleTooltip content={batch.lastError}>
                          <span
                            tabIndex={0}
                            role='img'
                            aria-label={batch.lastError}
                            className='inline-flex cursor-pointer items-center text-destructive'>
                            <CircleAlert className='size-3.5' />
                          </span>
                        </SimpleTooltip>
                      )}
                      {url && (
                        <a
                          href={url}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 text-primary-600 text-xs hover:underline'>
                          {batch.providerObjectId}
                          <ExternalLink className='size-3' />
                        </a>
                      )}
                    </span>
                  }
                  actions={
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-xs tabular-nums'>
                        {formatMinor(batch.totalMinor, batch.currency)}
                      </span>
                      <ExportBatchStateBadge state={batch.state} />
                      {batch.state === 'ready' && canRelease && (
                        <>
                          <TreeRowButton
                            persistent
                            tooltipText='Release to the export worker'
                            disabled={releasing}
                            onClick={() => bulkRelease([batch.id])}>
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
                      {batch.state === 'failed' && canRelease && (
                        <TreeRowButton
                          persistent
                          tooltipText='Retry now'
                          disabled={retrying}
                          onClick={() => retry.mutate({ batchId: batch.id })}>
                          <RefreshCw className={cn(retrying && 'animate-spin')} />
                        </TreeRowButton>
                      )}
                      {batch.state === 'sent' && canRollback && (
                        <TreeRowButton
                          persistent
                          tooltipText={`Roll back from ${providerLabel}`}
                          disabled={rollingBack}
                          onClick={() => void runRollback([batch.id])}>
                          <Undo2 className={cn(rollingBack && 'animate-pulse')} />
                        </TreeRowButton>
                      )}
                    </div>
                  }
                  onToggleOpen={() =>
                    selecting && selectable ? toggle(batch.id) : toggleOpen(batch.id)
                  }>
                  <BatchMembers
                    members={batch.members}
                    currencyCode={batch.currency}
                    bookTimeZone={bookTimeZone}
                    activePostingId={activePostingId}
                    onSelectPosting={onSelectPosting}
                  />
                </TreeRow>
              )
            }}
          />
        </div>
      )}

      <ActionBar
        open={selecting && selectable}
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
                  onClick: () => bulkRelease(selectedIds),
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

/** The postings inside one batch - opens the ledger's own `?posting=` drawer. */
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
        <TreeRow
          key={member.glPostingId}
          depth={1}
          className={TREE_SECONDARY_NOTRUNCATE}
          icon={<PanelRight className='size-3.5 text-muted-foreground' />}
          title={
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='shrink-0 font-mono text-xs'>{member.docNumber || EMPTY_CELL}</span>
              <span className='truncate text-muted-foreground text-xs'>
                {member.postingType.replace(/_/g, ' ')}
              </span>
            </span>
          }
          secondary={
            <span className='text-muted-foreground text-xs'>
              {formatAccountingDate(member.txnDate, bookTimeZone)}
            </span>
          }
          actions={
            <span className='font-mono text-xs tabular-nums'>
              {formatMinor(member.totalMinor, currencyCode)}
            </span>
          }
          onToggleOpen={() => onSelectPosting(member.glPostingId)}
          rowClassName={
            activePostingId === member.glPostingId
              ? 'bg-primary-100 ring-1 ring-primary-200'
              : undefined
          }
        />
      ))}
    </div>
  )
}

function buildResultSentence(result: {
  built: number
  batchIds: string[]
  skippedBeforeCutover: number
  connected: boolean
}): string {
  if (!result.connected) return 'No accounting system is connected, so nothing was built.'
  if (result.built === 0) {
    return result.skippedBeforeCutover > 0
      ? `Nothing built. ${result.skippedBeforeCutover} posting${result.skippedBeforeCutover === 1 ? '' : 's'} dated before the export cutover.`
      : 'Nothing to build - every posted entry this month is already in a batch.'
  }
  const tail =
    result.skippedBeforeCutover > 0
      ? ` ${result.skippedBeforeCutover} posting${result.skippedBeforeCutover === 1 ? '' : 's'} skipped, dated before the cutover.`
      : ''
  return `Built ${result.built} batch${result.built === 1 ? '' : 'es'}.${tail}`
}

/** ⚠️ An empty Ready tab is the HEALTHY state and has to read like one. */
function emptyTitle(tab: ExportBatchTab): string {
  switch (tab) {
    case 'ready':
      return 'Nothing is waiting to be sent'
    case 'sending':
      return 'Nothing is in flight'
    case 'sent':
      return 'Nothing has been sent yet'
    case 'failed':
      return 'Nothing has been refused'
  }
}

function emptyDescription(tab: ExportBatchTab, providerLabel: string): string {
  switch (tab) {
    case 'ready':
      return `Every batch is either sent or has not been built. "Build batches for this month" freezes posted entries into batches.`
    case 'sending':
      return `Nothing is leased by the export worker right now.`
    case 'sent':
      return `Nothing has settled in ${providerLabel} yet.`
    case 'failed':
      return `${providerLabel} has not refused a batch. A refusal shows the reason it gave, on the row.`
  }
}
