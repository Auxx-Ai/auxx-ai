// apps/web/src/components/accounting/ui/ledger/outbox/outbox-panel.tsx

'use client'

// Accounting > Ledger > the OUTBOX (TARGET §3, §4 gate 1 and 2, step 3 part C).
//
// One strip over the whole pipeline of work leaving the books: Drafts (posted
// with `autoPost` off, waiting for approval - `drafts-panel.tsx`) then the
// export-batch states. It was two rail items, "Drafts" and "Sync queue", which
// split one question ("what is outstanding?") across two screens.
//
// Rebuilt onto `ExportBatch`, which replaces the old `AccountingDelivery`
// pile this panel used to show (step 3 part B deleted that version). One row
// per batch now, not one row per posting: in Transaction mode a batch holds
// exactly one posting, and in Summary mode it holds every posting a period,
// store, rail and currency rolled up (TARGET §6) - either way this is the
// single read `ledger.exportBatches.list` returns, expandable to the postings
// each batch carries.
//
// 🛑 All periods, EVERY tab. Unlike the ledger page's own month-scoped
// sections, the outbox is a backlog that can span months, so every tab reads
// with no `month` bound and `OUTBOX_TABS` is the only filter. "Build batches
// for this month" is the one control that DOES take the month on screen -
// building freezes a payload out of POSTED entries, which is inherently a
// month's worth of work at a time.
//
// 🛑 Two verbs, never blurred: Release/Send hand a batch to (or push it
// straight at) the provider; Rollback deletes the provider's copy and frees
// the batch to be rebuilt. Nothing here reverses a posting - that stays the
// ledger's own drawer.

import type { ExportBatchMember } from '@auxx/lib/accounting/export'
import {
  exportBatchTabAdmits,
  isExportBatchTab,
  OUTBOX_TABS,
  type OutboxTab,
} from '@auxx/lib/accounting/export/client'
import { EXPORT_AVENUES } from '@auxx/lib/accounting/ledger/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
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
  FileClock,
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
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
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
import { DraftsPanel } from './drafts-panel'
import { ExportBatchStateBadge } from './export-batch-badge'

/** `ExportBatchRow` plus the server-computed deep link (plan 67 §5.6) - never built in the browser. */
type ExportBatchRow = RouterOutputs['ledger']['exportBatches']['list'][number]

const TAB_ICON: Record<OutboxTab, typeof CheckCircle2> = {
  drafts: FileClock,
  ready: CheckCircle2,
  sent: CheckCheck,
  failed: CircleAlert,
}

const TAB_LABEL: Record<OutboxTab, string> = {
  drafts: 'Drafts',
  ready: 'Ready',
  sent: 'Sent',
  failed: 'Failed',
}

interface OutboxPanelProps {
  tab: OutboxTab
  onTabChange: (tab: OutboxTab) => void
  /** The month on screen, for "Build batches for this month". `''` resolves none. */
  periodKey: string
  periodLabel: string
  bookTimeZone: string
  currencyCode: string
  /** 🔌 The provider's own tenant, for a `PostResultCallout` deep link. */
  connectedTenantId: string | null
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** So an open row reads as "the one you are looking at" the same as the rail strip does. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * The outbox. One `ListSelectionProvider` per mount, same as the banking review
 * queue - leaving the outbox disposes the selection.
 */
export function OutboxPanel(props: OutboxPanelProps) {
  return (
    <ListSelectionProvider>
      <OutboxBody {...props} />
    </ListSelectionProvider>
  )
}

function OutboxBody({
  tab,
  onTabChange,
  periodKey,
  periodLabel,
  bookTimeZone,
  currencyCode,
  connectedTenantId,
  providerLabel,
  activePostingId,
  onSelectPosting,
}: OutboxPanelProps) {
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

  // 🛑 Drafts is `ledgerPost`-gated on the server (`ledger.listDrafts`), so the
  // tab is absent, not disabled, for a read-only member - a tab that 403s on
  // click is worse than one that was never offered. `effectiveTab` catches the
  // pasted `?queue=drafts` link that member has no read for.
  const showDrafts = canRelease
  const effectiveTab: OutboxTab = tab === 'drafts' && !showDrafts ? 'ready' : tab
  const isDrafts = effectiveTab === 'drafts'
  /** The same tab, narrowed for the export-only copy below. `ready` is unreachable when `isDrafts`. */
  const exportTab = isExportBatchTab(effectiveTab) ? effectiveTab : 'ready'
  const tabs = useMemo(
    () => OUTBOX_TABS.filter((value) => showDrafts || value !== 'drafts'),
    [showDrafts]
  )

  // Count only - `DraftsPanel` runs the same query for its rows, and React Query
  // dedupes the two into one fetch.
  const draftsQuery = api.ledger.listDrafts.useQuery({}, { enabled: showDrafts })

  const visible = useMemo(
    () => (isDrafts ? [] : all.filter((batch) => exportBatchTabAdmits(exportTab, batch.state))),
    [all, exportTab, isDrafts]
  )
  const tally = useMemo(() => {
    const counts: Record<OutboxTab, number> = { drafts: 0, ready: 0, sent: 0, failed: 0 }
    for (const batch of all) {
      for (const value of OUTBOX_TABS) {
        if (isExportBatchTab(value) && exportBatchTabAdmits(value, batch.state)) counts[value]++
      }
    }
    counts.drafts = draftsQuery.data?.length ?? 0
    return counts
  }, [all, draftsQuery.data])

  // ⚠️ Free: `useSettings` rides the org cache the provider already hydrated.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const heldForRelease = EXPORT_AVENUES.every(
    (avenue) =>
      getSetting(`accounting.autoSend.${avenue}` as Parameters<typeof getSetting>[0]) !== true
  )
  const monthLabel = periodLabel || 'this month'

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const toggle = useListSelection((state) => state.toggle)
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  const { run: runBulk, ConfirmDialog: BulkConfirmDialog, isRunning: bulkRunning } = useBulkRunner()

  // Drafts select too: the provider is the same, the ids are the drafts' own.
  const visibleIds = useMemo(
    () =>
      isDrafts
        ? (draftsQuery.data ?? []).map((draft) => draft.id)
        : visible.map((batch) => batch.id),
    [isDrafts, draftsQuery.data, visible]
  )
  useEffect(() => {
    setItemIds(visibleIds)
  }, [visibleIds, setItemIds])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab is the trigger
  useEffect(() => {
    exitSelection()
  }, [effectiveTab])

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

  const selectable = effectiveTab === 'ready' || effectiveTab === 'sent' || isDrafts

  return (
    // `flex-1` + a full-bleed `ListToolbar`: the bar draws a `border-b` that has
    // to reach both edges, so the padding lives on the blocks around it, not here.
    <div className='flex flex-1 flex-col'>
      {/* `min-h-7` is the `size='sm'` Button's own height: the build control is
          absent for a read-only member, and without the floor the whole list
          shifted on every tab change. */}
      <div className='flex min-h-12 flex-wrap items-center justify-between gap-2 p-3 pb-2'>
        <p className='text-muted-foreground text-xs'>{introSentence(isDrafts, providerLabel)}</p>
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
        <p className='px-3 pb-2 text-muted-foreground text-xs'>
          {buildResultSentence(buildResult, monthLabel)}
        </p>
      )}

      <ListToolbar>
        <SelectAllCheckbox listPadding={12} disabled={!selectable} />
        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={effectiveTab}
            onValueChange={(value) => onTabChange(value as OutboxTab)}
            size='sm'>
            {tabs.map((value) => {
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

      {isDrafts ? (
        <DraftsPanel
          emptyDescription={emptyDescription('drafts', providerLabel, monthLabel, heldForRelease)}
          currencyCode={currencyCode}
          bookTimeZone={bookTimeZone}
          providerLabel={providerLabel}
          connectedTenantId={connectedTenantId}
          activePostingId={activePostingId}
          onSelectPosting={onSelectPosting}
        />
      ) : batchesQuery.isError ? (
        <p className='p-3 text-destructive text-xs'>
          The outbox could not be read. {batchesQuery.error.message}
        </p>
      ) : !isLoading && visible.length === 0 ? (
        <EmptyState
          icon={TAB_ICON[effectiveTab]}
          title={emptyTitle(exportTab)}
          description={
            <span>{emptyDescription(exportTab, providerLabel, monthLabel, heldForRelease)}</span>
          }
        />
      ) : (
        <div className='flex flex-col gap-px p-3 pb-16'>
          <TreeRowList
            items={visible}
            loading={isLoading}
            skeletonCount={4}
            className='gap-px'
            getKey={(batch: ExportBatchRow) => batch.id}
            renderRow={(batch: ExportBatchRow) => {
              const isOpen = openBatchIds.has(batch.id)
              const url = batch.providerObjectUrl
              const inFlight = batch.state === 'sending'
              const sending = send.isPending && send.variables?.batchId === batch.id
              const retrying = retry.isPending && retry.variables?.batchId === batch.id
              const releasing =
                release.isPending && release.variables?.batchIds.includes(batch.id) === true
              const rollingBack =
                rollback.isPending && (rollback.variables?.batchId === batch.id || bulkRunning)
              const StateIcon = TAB_ICON[batch.state as OutboxTab] ?? CheckCircle2

              return (
                <TreeRow
                  className={TREE_SECONDARY_NOTRUNCATE}
                  icon={<StateIcon className='size-4 text-muted-foreground' />}
                  expandable
                  isOpen={isOpen}
                  selectable={selectable}
                  selecting={selecting}
                  selected={selectedIds.includes(batch.id)}
                  onSelectChange={(_next, event) => toggle(batch.id, { shiftKey: event.shiftKey })}
                  selectLabel={`Select ${exportAvenueLabel(batch.avenue)} batch of ${batchDateLabel(batch, bookTimeZone)}`}
                  title={
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                        {batchDateLabel(batch, bookTimeZone)}
                      </span>
                      <span className='min-w-0 truncate text-sm'>
                        {exportAvenueLabel(batch.avenue)}
                      </span>
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
                      {inFlight && <Loader className='size-3.5 animate-spin text-primary-400' />}
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
                  }
                  rowClassName={cn(
                    'bg-primary-100/50 hover:bg-primary-100',
                    selectedIds.includes(batch.id) &&
                      'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25'
                  )}>
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

      {/* Drafts carry their own bar (`DraftsPanel`): approve and discard are its verbs. */}
      <ActionBar
        open={selecting && selectable && !isDrafts}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          ...(effectiveTab === 'ready' && canRelease
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
          ...(effectiveTab === 'sent' && canRollback
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
          title={
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                {formatAccountingDate(member.txnDate, bookTimeZone)}
              </span>
              <span className='shrink-0 font-mono text-xs'>{member.docNumber || EMPTY_CELL}</span>
              <span className='truncate text-muted-foreground text-xs'>
                {humanizePostingType(member.postingType)}
              </span>
            </span>
          }
          actions={
            <div className='flex items-center gap-2'>
              <span className='font-mono text-xs tabular-nums'>
                {formatMinor(member.totalMinor, currencyCode)}
              </span>
              <TreeRowButton
                persistent
                tooltipText='Open details'
                onClick={() => onSelectPosting(member.glPostingId)}>
                <PanelRight />
              </TreeRowButton>
            </div>
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

/** The posting's day in Transaction mode; the summary grain (a day or a month) otherwise. */
function batchDateLabel(batch: ExportBatchRow, bookTimeZone: string): string {
  if (batch.mode === 'transaction') {
    const day = batch.members[0]?.txnDate
    return day ? formatAccountingDate(day, bookTimeZone) : EMPTY_CELL
  }
  if (/^\d{4}-\d{2}$/.test(batch.grainKey)) return formatShortPeriodLabel(batch.grainKey)
  return formatAccountingDate(batch.grainKey, bookTimeZone)
}

function buildResultSentence(
  result: {
    built: number
    batchIds: string[]
    skippedBeforeCutover: number
    connected: boolean
  },
  monthLabel: string
): string {
  if (!result.connected) return 'No accounting system is connected, so nothing was built.'
  const skipped = result.skippedBeforeCutover
  const postings = `${skipped} posting${skipped === 1 ? '' : 's'}`
  if (result.built === 0) {
    return skipped > 0
      ? `Nothing built for ${monthLabel}: ${postings} dated before the export cutover.`
      : `${monthLabel} has no posted entry that is not already in a batch.`
  }
  const tail = skipped > 0 ? ` ${postings} skipped, dated before the cutover.` : ''
  return `Built ${result.built} batch${result.built === 1 ? '' : 'es'} for ${monthLabel}.${tail}`
}

/** What the tab on screen is a list OF. Every tab spans every period. */
function introSentence(isDrafts: boolean, providerLabel: string): string {
  return isDrafts
    ? 'Every posting waiting for approval, from any month - its avenue posts with autoPost switched off.'
    : `Every batch in the books that is not yet a settled copy in ${providerLabel}, or was refused. Every period, not only the month the build button names.`
}

/** ⚠️ An empty Ready tab is the HEALTHY state and has to read like one. */
function emptyTitle(tab: Exclude<OutboxTab, 'drafts'>): string {
  switch (tab) {
    case 'ready':
      return 'Nothing is waiting to be sent'
    case 'sent':
      return 'Nothing has been sent yet'
    case 'failed':
      return 'Nothing has been refused'
  }
}

/** ⚠️ Names WHICH month Build would take, and why a tab is empty (75-D7) - it used to read as a fault. */
function emptyDescription(
  tab: OutboxTab,
  providerLabel: string,
  monthLabel: string,
  heldForRelease: boolean
): string {
  const held = heldForRelease
    ? ' No avenue has auto-send switched on, so a batch that is built is held for release rather than sent.'
    : ''
  switch (tab) {
    case 'drafts':
      return `A draft is left here when its avenue posts with autoPost switched off (Settings › Posting). Approving one posts its entry; it does not build an export batch - "Build batches for ${monthLabel}" does, for that month alone.${held}`
    case 'ready':
      return `These tabs list every period, so nothing anywhere is waiting to be sent. "Build batches for ${monthLabel}" freezes that month's posted entries into batches, and nothing is built until somebody asks.${held}`
    case 'sent':
      return `Nothing has settled in ${providerLabel} yet, in any period. A batch is built one month at a time - ${monthLabel} is the one the button above takes - and then released.${held}`
    case 'failed':
      return `${providerLabel} has not refused a batch, in any period. A refusal shows the reason it gave, on the row.`
  }
}
