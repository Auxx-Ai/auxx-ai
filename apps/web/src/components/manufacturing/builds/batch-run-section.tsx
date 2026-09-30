// apps/web/src/components/manufacturing/builds/batch-run-section.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Hammer, ListFilter, Undo2 } from 'lucide-react'
import { EmptyRow, RowSkeleton } from '~/components/drawers/cards/related-record-row'
import { PurchasingSummaryStrip } from '~/components/purchasing/purchasing-summary-strip'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BUILD_STATUS_LABEL, BUILD_STATUS_VARIANT, formatBuildQuantity } from './build-format'
import { openBatchRunSheet, openBuildSheet } from './build-sheet-store'
import {
  isUndoBackflushRunLive,
  UndoBackflushRunProgress,
  useUndoBackflushRun,
} from './undo-backflush-panel'

const RUN_PAGE_SIZE = 50

/**
 * One batch run's counts and its Undo (plans/money/tasks/45 §11). Undo acts on every build the
 * run raised, so its copy never says a bare "Undo" next to a build's own Reverse.
 */
export function BatchRunSummary({
  runNumber,
  showBuildsLink,
}: {
  runNumber: number
  /** Offer "Show all builds" (from a build); off on the run's own frame. */
  showBuildsLink?: boolean
}) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const canUndoRun = useAccess().can(PermissionKey.mrpManage)

  const run = api.builds.getBatchRun.useQuery({ runNumber }, { retry: false })

  const refresh = async () => {
    await Promise.all([
      utils.builds.get.invalidate(),
      utils.builds.list.invalidate(),
      utils.builds.getBatchRun.invalidate(),
      utils.purchasing.listMovements.invalidate(),
    ])
  }

  // The undo runs on the worker (plans/mrp/17 §8): a run of thousands is past any request.
  const undo = useUndoBackflushRun({
    enabled: canUndoRun,
    adopt: (live) => live.scope === 'run' && live.runNumbers.includes(runNumber),
    onFinished: () => void refresh(),
  })
  const startUndo = api.builds.startUndoBackflush.useMutation({
    onError: (error) => toastError({ title: 'Failed to undo the run', description: error.message }),
  })

  if (run.isPending) return <RowSkeleton />
  if (!run.data) return <EmptyRow label='This run could not be read' />

  const summary = run.data
  const nothingToUndo = summary.willCancel === 0 && summary.willReverse === 0

  const handleUndo = async () => {
    const confirmed = await confirm({
      title: `Undo run ${runNumber}?`,
      // §11.4: both counts lead, because only the second one writes to the ledger.
      description:
        `${plural(summary.willCancel, 'build')} will be cancelled, and ` +
        `${plural(summary.willReverse, 'completed build')} will be reversed. ` +
        'Only the reversals touch the ledger: each one appends movements that negate what the ' +
        "completion wrote, dated TODAY, in today's open period. This does not restate the month " +
        'the run was dated to. If the run covered January and January is closed, January stays ' +
        'exactly as posted. Nothing is deleted.',
      confirmText: `Undo run ${runNumber}`,
      cancelText: 'Keep the run',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const started = await startUndo.mutateAsync({ runNumber })
      undo.setRunId(started.runId)
    } catch {
      // Surfaced by the mutation's onError.
    }
  }

  return (
    <div className='space-y-2'>
      <ConfirmDialog />

      <div className='flex items-center gap-1.5'>
        <Badge variant='blue' size='xs'>
          Run {runNumber}
        </Badge>
        {summary.ranAt && (
          <span className='text-muted-foreground text-xs'>Ran {formatDay(summary.ranAt)}</span>
        )}
      </div>

      <PurchasingSummaryStrip
        cells={[
          { label: 'In this run', value: String(summary.total) },
          {
            label: 'Would cancel',
            value: String(summary.willCancel),
            tone: summary.willCancel ? 'default' : 'muted',
          },
          {
            label: 'Would reverse',
            value: String(summary.willReverse),
            tone: summary.willReverse ? 'warning' : 'muted',
          },
        ]}
      />

      <div className='flex flex-wrap items-center gap-1'>
        <StatusCount label='Planned' count={summary.planned} variant='secondary' />
        <StatusCount label='In progress' count={summary.inProgress} variant='blue' />
        <StatusCount label='Completed' count={summary.completed} variant='green' />
        <StatusCount label='Canceled' count={summary.canceled} variant='red' />
      </div>

      {(summary.periodStart || summary.periodEnd) && (
        <p className='text-muted-foreground text-xs'>
          Covers {formatDay(summary.periodStart)} to {formatDay(summary.periodEnd)}
        </p>
      )}

      <div className='flex flex-col gap-1'>
        {showBuildsLink && (
          <Button
            variant='outline'
            size='xs'
            className='w-full justify-start'
            onClick={() => openBatchRunSheet(runNumber)}>
            <ListFilter />
            Show all {summary.total} builds in run {runNumber}
          </Button>
        )}

        {undo.run && <UndoBackflushRunProgress run={undo.run} />}

        {canUndoRun &&
          !isUndoBackflushRunLive(undo.run) &&
          (nothingToUndo ? (
            <p className='px-1 text-muted-foreground text-xs'>
              Every build in this run has already been cancelled or reversed.
            </p>
          ) : (
            <Button
              variant='outline'
              size='xs'
              className='w-full justify-start text-destructive'
              loading={startUndo.isPending || (!!undo.runId && !undo.run)}
              loadingText={`Undoing run ${runNumber}...`}
              onClick={handleUndo}>
              <Undo2 />
              Undo run {runNumber} ({plural(summary.total, 'build')})
            </Button>
          ))}
      </div>
    </div>
  )
}

/** The builds a batch run raised, newest first; a row opens the build in the same sheet. */
export function BatchRunBuilds({ runNumber }: { runNumber: number }) {
  const builds = api.builds.list.useInfiniteQuery(
    { batchRun: runNumber, limit: RUN_PAGE_SIZE },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const items = builds.data?.pages.flatMap((page) => page.items) ?? []

  if (!builds.isLoading && items.length === 0) {
    return <EmptySection orientation='horizontal' title='No builds in this run' />
  }

  return (
    <div className='space-y-1'>
      <TreeRowList
        items={items}
        loading={builds.isLoading}
        skeletonCount={3}
        getKey={(build) => build.buildId}
        renderRow={(build) => (
          <TreeRow
            icon={<Hammer className='size-4' />}
            rowClassName='hover:bg-primary-100'
            onToggleOpen={() => openBuildSheet(build.buildId)}
            title={<span className='font-mono text-sm'>{build.number}</span>}
            secondary={
              <Badge variant={BUILD_STATUS_VARIANT[build.status]} size='xs'>
                {BUILD_STATUS_LABEL[build.status]}
              </Badge>
            }
            actions={
              <span className='pe-1 font-mono text-xs tabular-nums'>
                {formatBuildQuantity(build.quantityProduced ?? build.quantityPlanned)}
              </span>
            }
          />
        )}
      />
      {builds.hasNextPage && (
        <div className='flex justify-center'>
          <Button
            variant='ghost'
            size='xs'
            loading={builds.isFetchingNextPage}
            loadingText='Loading...'
            onClick={() => builds.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

/** A status count, dropped entirely when it is zero. */
function StatusCount({
  label,
  count,
  variant,
}: {
  label: string
  count: number
  variant: 'secondary' | 'blue' | 'green' | 'red'
}) {
  if (!count) return null
  return (
    <Badge variant={variant} size='xs'>
      {count} {label.toLowerCase()}
    </Badge>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function formatDay(value: Date | string | null): string {
  if (!value) return 'unknown'
  return new Date(value).toLocaleDateString()
}
