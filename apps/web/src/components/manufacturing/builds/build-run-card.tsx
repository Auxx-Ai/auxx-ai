// apps/web/src/components/manufacturing/builds/build-run-card.tsx
'use client'

// `build:run` — the run's numbers and its whole lifecycle, in one card
// (plans/products/build/01-build-plan.md §3.6, §1.6).
//
// This is the ONLY surface for the four lifecycle transitions, and that is by
// design rather than by omission. `build_status` is declared
// `showInDialogs: false` and every one of Start / Cancel / Complete / Reverse is
// a procedure with its own preconditions — `completeBuild` refuses a second
// completion (B8), `reverseBuild` refuses a second reversal and refuses to
// reverse a reversal (B6). A status dropdown would let a person claim a
// transition the server would then have to unpick, and would claim a completed
// build's movements exist when they do not.
//
// It is also the only place the five cost fields are read together. They ARE in
// the Details panel (§1.6 keeps them there — the variance is the number a person
// actually reads on a build), but a panel row per figure does not show the
// arithmetic, and the arithmetic is the point.

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyRow, RowSkeleton } from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { PurchasingSummaryStrip } from '~/components/purchasing/purchasing-summary-strip'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { CompleteBuildDialog } from './complete-build-dialog'

/** `build_status` → badge colour. Mirrors the `BuildStatus` enum's own colours. */
const STATUS_VARIANT: Record<string, Variant> = {
  planned: 'secondary',
  in_progress: 'blue',
  completed: 'green',
  canceled: 'red',
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
}

export function BuildRunCard({ entityInstanceId }: DrawerTabProps) {
  const [completeOpen, setCompleteOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const buildDefId = useResourceProperty('build', 'id')
  const movementDefId = useResourceProperty('stock_movement', 'id')
  const utils = api.useUtils()

  // The client mirror of what `builds.ts` asserts, so the button the UI hides and
  // the door the server closes are the same door. Raising and abandoning a run
  // needs `build` alone (B2: a planned build writes no movements); completing and
  // reversing also need `stock_movement`, because that is where the rest of
  // manufacturing puts the authority to move stock.
  const { canEditEntity } = useAccess()
  const canManageRun = !!buildDefId && canEditEntity(buildDefId)
  const canPostLedger = canManageRun && !!movementDefId && canEditEntity(movementDefId)
  const build = api.builds.get.useQuery(
    { buildId: entityInstanceId },
    { enabled: !!entityInstanceId, retry: false }
  )

  const reversal = useBuildReversal(entityInstanceId, build.data?.status === 'completed')
  const openRecord = useOpenRecord()

  /**
   * Every read this feature owns, plus the generic record list.
   *
   * 🛑 `reverseBuild` writes its new build on the quiet lane, so it emits **no**
   * `record:created` frame and no open list learns about it. `startBuild` and
   * `cancelBuild` do publish, but the acting tab is deliberately excluded from
   * its own realtime events. Either way the tab that pressed the button is the
   * one that has to invalidate — which is what this does, in the one place all
   * four mutations funnel through.
   */
  const refresh = async () => {
    await Promise.all([
      utils.builds.get.invalidate(),
      utils.builds.list.invalidate(),
      buildDefId
        ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
        : Promise.resolve(),
    ])
  }

  const startBuild = api.builds.start.useMutation({
    onError: (error) => toastError({ title: 'Failed to start build', description: error.message }),
    onSuccess: refresh,
  })

  const cancelBuild = api.builds.cancel.useMutation({
    onError: (error) => toastError({ title: 'Failed to cancel build', description: error.message }),
    onSuccess: refresh,
  })

  const reverseBuild = api.builds.reverse.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to reverse build', description: error.message }),
    onSuccess: refresh,
  })

  if (build.isPending) return <RowSkeleton />
  if (!build.data) return <EmptyRow label='This build could not be read' />

  const run = build.data
  const status = run.status
  const isCompleted = status === 'completed'
  const isReversal = !!run.reversalOfBuildId
  const alreadyReversed = reversal.reversedByBuildId != null
  const pending = startBuild.isPending || cancelBuild.isPending || reverseBuild.isPending

  const handleCancel = async () => {
    const confirmed = await confirm({
      title: 'Cancel this build?',
      description:
        'The run is abandoned. Nothing has been consumed or produced, so no stock movement is written or removed.',
      confirmText: 'Cancel build',
      cancelText: 'Keep it',
      destructive: true,
    })
    if (confirmed) cancelBuild.mutate({ buildId: entityInstanceId })
  }

  const handleReverse = async () => {
    const confirmed = await confirm({
      title: 'Reverse this build?',
      description:
        'Writes a second build that negates every movement this one wrote, at the costs frozen on the originals. This build is left exactly as it is — a completed build is never edited or deleted.',
      confirmText: 'Reverse build',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) reverseBuild.mutate({ buildId: entityInstanceId })
  }

  return (
    <div className='space-y-2'>
      <ConfirmDialog />

      <DrawerCardActions>
        <div className='flex items-center gap-1'>
          {status === 'planned' && canManageRun && (
            <Button
              variant='ghost'
              size='xs'
              disabled={pending}
              onClick={() => startBuild.mutate({ buildId: entityInstanceId })}>
              Start
            </Button>
          )}
          {(status === 'planned' || status === 'in_progress') && canManageRun && (
            <>
              <Button
                variant='outline'
                size='xs'
                disabled={pending || !run.partId || !canPostLedger}
                onClick={() => setCompleteOpen(true)}>
                Complete
              </Button>
              <Button variant='ghost' size='xs' disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
            </>
          )}
          {/* 🛑 Not offered on a reversal, and not offered twice. `reverseBuild`
              refuses both, but a button that exists only to fail is a worse
              answer than a button that is not there. */}
          {isCompleted && !isReversal && !alreadyReversed && canPostLedger && (
            <Button variant='ghost' size='xs' disabled={pending} onClick={handleReverse}>
              <Undo2 />
              Reverse
            </Button>
          )}
        </div>
      </DrawerCardActions>

      <div className='flex items-center gap-1.5'>
        <Badge variant={STATUS_VARIANT[status ?? ''] ?? 'secondary'} size='xs'>
          {STATUS_LABEL[status ?? ''] ?? 'Unknown'}
        </Badge>
        {run.source === 'order' && (
          <Badge variant='blue' size='xs'>
            From order
          </Badge>
        )}
        {isReversal && (
          <Badge variant='amber' size='xs'>
            Reversal
          </Badge>
        )}
        {alreadyReversed && (
          <Badge variant='amber' size='xs'>
            Reversed
          </Badge>
        )}
      </div>

      {/* §1.6: the two reversal relations are `showInPanel: false` on purpose —
          "surfaced as a banner/badge on a reversed build, not as two relationship
          rows". This is that banner. */}
      {isReversal && run.reversalOfBuildId && (
        <ReversalBanner
          label='Undoes an earlier build'
          onOpen={
            buildDefId && openRecord
              ? () => openRecord(toRecordId(buildDefId, run.reversalOfBuildId as string))
              : undefined
          }
        />
      )}
      {alreadyReversed && reversal.reversedByBuildId && (
        <ReversalBanner
          label='This build has been reversed'
          onOpen={
            buildDefId && openRecord
              ? () => openRecord(toRecordId(buildDefId, reversal.reversedByBuildId as string))
              : undefined
          }
        />
      )}

      <PurchasingSummaryStrip
        className='pt-1'
        cells={[
          { label: 'Planned', value: formatQuantity(run.quantityPlanned) },
          {
            label: 'Produced',
            value: formatQuantity(run.quantityProduced),
            tone: run.quantityProduced ? 'default' : 'muted',
          },
          {
            label: 'Scrapped',
            value: formatQuantity(run.quantityScrapped),
            tone: run.quantityScrapped ? 'default' : 'muted',
          },
        ]}
      />

      {isCompleted && (
        <div className='space-y-1 border-border/50 border-t pt-2 text-xs tabular-nums'>
          <CostLine label='Material' value={run.materialCost} currencyCode={currencyCode} />
          <CostLine label='Labour' value={run.laborCost} currencyCode={currencyCode} />
          <CostLine label='Overhead' value={run.overheadCost} currencyCode={currencyCode} />
          <CostLine
            label='Produced value'
            value={run.producedValue}
            currencyCode={currencyCode}
            className='border-border/50 border-t pt-1'
          />
          <CostLine
            label='Variance → 5090'
            value={run.varianceAmount}
            currencyCode={currencyCode}
            signed
            className='border-border/50 border-t pt-1 font-medium'
          />
        </div>
      )}

      {run.partId && (
        <CompleteBuildDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          buildId={entityInstanceId}
          partId={run.partId}
          quantityPlanned={run.quantityPlanned}
          number={run.number}
          onCompleted={refresh}
        />
      )}
    </div>
  )
}

/** The reversal pair, as a line a person can follow rather than two relation rows. */
function ReversalBanner({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <div className='flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-500'>
      <span>{label}</span>
      {onOpen && (
        <Button variant='ghost' size='xs' onClick={onOpen}>
          Open
        </Button>
      )}
    </div>
  )
}

function CostLine({
  label,
  value,
  currencyCode,
  signed,
  className,
}: {
  label: string
  value: number | null
  currencyCode: string
  signed?: boolean
  className?: string
}) {
  const sign = signed && value != null && value > 0 ? '+' : ''
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className ?? ''}`}>
      <span className='text-muted-foreground'>{label}</span>
      <span>{value == null ? '—' : `${sign}${formatCurrency(value, { currencyCode })}`}</span>
    </div>
  )
}

/**
 * The reversing build that points at this one, if there is one.
 *
 * `BuildRecord` carries `reversalOf` but not its inverse, so this reads the
 * `build_reversed_by` side through the generic record list rather than adding a
 * second shape to the lib. Enabled only for a completed build — nothing else can
 * have been reversed, and a `planned` build that was cancelled is corrected by
 * the cancellation, not by a negation.
 */
function useBuildReversal(buildId: string, enabled: boolean): { reversedByBuildId: string | null } {
  const buildDefId = useResourceProperty('build', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'reversal-of',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'reversal-of-match',
            fieldId: 'build:reversalOf' as ResourceFieldId,
            operator: 'is' as const,
            value: buildId,
          },
        ],
      },
    ],
    [buildId]
  )

  const { records } = useRecordList({
    entityDefinitionId: buildDefId ?? '',
    filters,
    limit: 1,
    enabled: enabled && !!buildId && !!buildDefId,
  })

  return { reversedByBuildId: records[0]?.id ?? null }
}

/** Trim a quantity's trailing zeros, and read absence as a dash rather than zero. */
function formatQuantity(value: number | null): string {
  if (value == null) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
