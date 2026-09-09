// apps/web/src/components/manufacturing/builds/build-batch-run-card.tsx
'use client'

// `build:batch-run`: the run a build belongs to, and the ONE verb whose blast
// radius is the whole run (plans/money/tasks/45 §11).
//
// 🛑 **Its own card, never folded into `build:run`** (§11.1). Every verb on the
// lifecycle card (Start / Cancel / Complete / Reverse) acts on the one build in
// front of you. Undo acts on every build the run raised, which is routinely
// hundreds. Two scopes, two cards: a run section folded into the lifecycle card
// would put a four-figure blast radius inside the box a person reads to answer
// "what is this build doing".
//
// 🛑 **Renders nothing when the build carries no run.** An order-raised or
// hand-raised build belongs to no batch, and `build_batch_run` is null on
// reversing builds too (§4.1: a reversal must not inherit the run number, or
// run N would contain its own undo). Returning null hides the whole Section:
// `base-entity-drawer.tsx` wraps every card in
// `[&:has([data-slot=section-content]:empty)]:hidden`.
//
// A run is not a record (§3.1), so there is no run detail page. This card IS the
// run's detail view, reached through any of its members.

import type { Operator } from '@auxx/lib/conditions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ListFilter, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EmptyRow, RowSkeleton } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { PurchasingSummaryStrip } from '~/components/purchasing/purchasing-summary-strip'
import { useRecordsSearchStore } from '~/components/records/records-search-store'
import { useFieldByKey, useResourceProperty } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** Where the builds list lives, and where the "see the run" link goes. */
const BUILDS_PATH = '/app/builds'

export function BuildBatchRunCard({ entityInstanceId }: DrawerTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const router = useRouter()
  const utils = api.useUtils()

  const buildDefId = useResourceProperty('build', 'id')
  const movementDefId = useResourceProperty('stock_movement', 'id')

  // The org's own `build_batch_run` field, resolved by system attribute rather
  // than by key: the builds list filters on the materialized CustomField id, not
  // on the registry ref, so the link below needs the org's id for it.
  const batchRunField = useFieldByKey(buildDefId, 'build_batch_run')

  // The client mirror of what `builds.undoBatchRun` asserts (§11.5). Undo
  // cancels AND reverses, and the reversal arm appends stock movements, so it
  // takes both halves: edit on `build` and edit on `stock_movement`. The server
  // enforces regardless; this only avoids a click-then-403.
  const { canEditEntity } = useAccess()
  const canUndoRun =
    !!buildDefId && canEditEntity(buildDefId) && !!movementDefId && canEditEntity(movementDefId)

  const build = api.builds.get.useQuery(
    { buildId: entityInstanceId },
    { enabled: !!entityInstanceId, retry: false }
  )
  const runNumber = build.data?.batchRun ?? null

  const run = api.builds.getBatchRun.useQuery(
    { runNumber: runNumber ?? 1 },
    { enabled: runNumber != null, retry: false }
  )

  /**
   * Undo touches every member of the run, so it invalidates the same three reads
   * `build-run-card.tsx` does rather than just this build's.
   *
   * 🛑 The reversing builds are written on the quiet lane and emit no
   * `record:created` frame, and the cancellations exclude the acting tab from
   * their own realtime events. Either way the tab that pressed the button is the
   * one that has to invalidate.
   */
  const refresh = async () => {
    await Promise.all([
      utils.builds.get.invalidate(),
      utils.builds.list.invalidate(),
      utils.builds.getBatchRun.invalidate(),
      buildDefId
        ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
        : Promise.resolve(),
    ])
  }

  const undoBatchRun = api.builds.undoBatchRun.useMutation({
    onError: (error) => toastError({ title: 'Failed to undo the run', description: error.message }),
    onSuccess: refresh,
  })

  // 🛑 §11.3's first rule, and the reason this returns before any skeleton: the
  // common build carries no run at all, and a card that flashed a placeholder on
  // every order-raised build would be the empty section this rule forbids.
  if (runNumber == null) return null
  if (run.isPending) return <RowSkeleton />
  if (!run.data) return <EmptyRow label='This run could not be read' />

  const summary = run.data
  const nothingToUndo = summary.willCancel === 0 && summary.willReverse === 0

  const handleUndo = async () => {
    const confirmed = await confirm({
      title: `Undo run ${runNumber}?`,
      // 🛑 §11.4: BOTH counts lead, because they differ and only the second one
      // writes to the ledger. Then §4.2's rule, in §4.2's own words.
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
    if (confirmed) undoBatchRun.mutate({ runNumber })
  }

  /**
   * "See the builds this run raised", which is §4.3's first affordance.
   *
   * The context is set before the condition: `RecordsSearchBar` calls
   * `setContext(entityDefinitionId)` on mount, and that CLEARS the conditions
   * whenever the key changes. Setting it here first makes the list's own call a
   * no-op, so the filter survives the navigation.
   */
  const openRunInList = () => {
    if (!buildDefId || !batchRunField) return
    const store = useRecordsSearchStore.getState()
    store.setContext(buildDefId)
    store.setConditions([
      {
        id: 'build-batch-run',
        fieldId: batchRunField.id,
        operator: 'is' as Operator,
        value: runNumber,
      },
    ])
    router.push(BUILDS_PATH)
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
            // The one figure that writes to the ledger, so it does not read as
            // flat as the two beside it.
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
        <Button
          variant='outline'
          size='xs'
          className='w-full justify-start'
          disabled={!buildDefId || !batchRunField}
          onClick={openRunInList}>
          <ListFilter />
          Show all {summary.total} builds in run {runNumber}
        </Button>

        {canUndoRun &&
          (nothingToUndo ? (
            <p className='px-1 text-muted-foreground text-xs'>
              Every build in this run has already been cancelled or reversed.
            </p>
          ) : (
            // 🛑 §11.4: never a bare "Undo". `build:run`'s Reverse button sits
            // inches away in the same drawer and undoes THIS build only. Nothing
            // about their shape says which is which, so the copy has to.
            <Button
              variant='outline'
              size='xs'
              className='w-full justify-start text-destructive'
              loading={undoBatchRun.isPending}
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

/** A status count, dropped entirely when it is zero: a zero is not news. */
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

/** `1 build` / `412 builds`, so no count in this card reads as a template slot. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** A run's period bounds and its timestamp, as a day. The time of day is noise here. */
function formatDay(value: Date | string | null): string {
  if (!value) return 'unknown'
  return new Date(value).toLocaleDateString()
}
