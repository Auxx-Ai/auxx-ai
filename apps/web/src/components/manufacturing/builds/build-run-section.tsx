// apps/web/src/components/manufacturing/builds/build-run-section.tsx
'use client'

import {
  canCancelBuild,
  canCompleteBuild,
  canReverseBuild,
  canStartBuild,
} from '@auxx/lib/inventory/builds/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { Hammer, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { PurchasingSummaryStrip } from '~/components/purchasing/purchasing-summary-strip'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { BUILD_STATUS_LABEL, BUILD_STATUS_VARIANT, formatBuildQuantity } from './build-format'
import type { BuildSheetData } from './build-sheet'
import { openBuildSheet } from './build-sheet-store'
import { CompleteBuildDialog } from './complete-build-dialog'

/**
 * The run's numbers and its lifecycle: Start, Complete, Cancel, Reverse. Each is a procedure with
 * its own preconditions (B6, B8), so there is no status picker anywhere.
 */
export function BuildRunSection({
  build,
  canManage,
}: {
  build: BuildSheetData
  canManage: boolean
}) {
  const [completeOpen, setCompleteOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const utils = api.useUtils()

  const refresh = async () => {
    await Promise.all([
      utils.builds.get.invalidate(),
      utils.builds.list.invalidate(),
      utils.builds.getBatchRun.invalidate(),
      utils.purchasing.listMovements.invalidate(),
      utils.mrp.partItem.invalidate(),
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

  const { status, buildId, reversalOf, reversedBy } = build
  const isReversal = !!build.reversalOfBuildId
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
    if (confirmed) cancelBuild.mutate({ buildId })
  }

  const handleReverse = async () => {
    const confirmed = await confirm({
      title: 'Reverse this build?',
      description:
        'Writes a second build that negates every movement this one wrote, at the costs frozen on the originals. This build is left exactly as it is: a completed build is never edited or deleted.',
      confirmText: 'Reverse build',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) reverseBuild.mutate({ buildId })
  }

  const actions = canManage ? (
    <div className='flex items-center gap-1'>
      {canStartBuild(status) && (
        <Button
          variant='ghost'
          size='xs'
          loading={startBuild.isPending}
          loadingText='Starting...'
          disabled={pending}
          onClick={() => startBuild.mutate({ buildId })}>
          Start
        </Button>
      )}
      {canCompleteBuild(status) && (
        <Button
          variant='outline'
          size='xs'
          disabled={pending}
          onClick={() => setCompleteOpen(true)}>
          Complete
        </Button>
      )}
      {canCancelBuild(status) && (
        <Button
          variant='ghost'
          size='xs'
          loading={cancelBuild.isPending}
          loadingText='Cancelling...'
          disabled={pending}
          onClick={handleCancel}>
          Cancel
        </Button>
      )}
      {/* Not offered on a reversal, nor twice: `reverseBuild` refuses both. */}
      {canReverseBuild(status) && !isReversal && !reversedBy && (
        <Button
          variant='ghost'
          size='xs'
          loading={reverseBuild.isPending}
          loadingText='Reversing...'
          disabled={pending}
          onClick={handleReverse}>
          <Undo2 />
          Reverse
        </Button>
      )}
    </div>
  ) : undefined

  return (
    <Section title='Run' icon={<Hammer className='size-4' />} actions={actions} collapsible={false}>
      <ConfirmDialog />
      <div className='space-y-2'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge variant={BUILD_STATUS_VARIANT[status]} size='xs'>
            {BUILD_STATUS_LABEL[status]}
          </Badge>
          {build.source === 'order' && (
            <Badge variant='blue' size='xs'>
              From order
            </Badge>
          )}
          {build.drifted && (
            <Badge variant='amber' size='xs'>
              Order changed
            </Badge>
          )}
          {isReversal && (
            <Badge variant='amber' size='xs'>
              Reversal
            </Badge>
          )}
          {reversedBy && (
            <Badge variant='amber' size='xs'>
              Reversed
            </Badge>
          )}
        </div>

        {build.source === 'order' && (
          <OrderTrackingNotice status={status} drifted={build.drifted} />
        )}

        {reversalOf && (
          <ReversalBanner
            label={`Undoes ${reversalOf.number}`}
            onOpen={() => openBuildSheet(reversalOf.buildId)}
          />
        )}
        {reversedBy && (
          <ReversalBanner
            label={`Reversed by ${reversedBy.number}`}
            onOpen={() => openBuildSheet(reversedBy.buildId)}
          />
        )}

        <PurchasingSummaryStrip
          cells={[
            { label: 'Planned', value: formatBuildQuantity(build.quantityPlanned) },
            {
              label: 'Produced',
              value: formatBuildQuantity(build.quantityProduced),
              tone: build.quantityProduced ? 'default' : 'muted',
            },
            {
              label: 'Scrapped',
              value: formatBuildQuantity(build.quantityScrapped),
              tone: build.quantityScrapped ? 'default' : 'muted',
            },
          ]}
        />

        {build.producedValue != null && (
          <div className='space-y-1 border-border/50 border-t pt-2 text-xs tabular-nums'>
            <CostLine label='Material' value={build.materialCost} currencyCode={currencyCode} />
            <CostLine label='Labour' value={build.laborCost} currencyCode={currencyCode} />
            <CostLine label='Overhead' value={build.overheadCost} currencyCode={currencyCode} />
            <CostLine
              label='Produced value'
              value={build.producedValue}
              currencyCode={currencyCode}
              className='border-border/50 border-t pt-1'
            />
            <CostLine
              label='Variance → 5090'
              value={build.varianceAmount}
              currencyCode={currencyCode}
              signed
              className='border-border/50 border-t pt-1 font-medium'
            />
          </div>
        )}
      </div>

      {completeOpen && (
        <CompleteBuildDialog
          open
          onOpenChange={setCompleteOpen}
          buildId={buildId}
          partId={build.partId}
          quantityPlanned={build.quantityPlanned}
          number={build.number}
          onCompleted={refresh}
        />
      )}
    </Section>
  )
}

/**
 * What an order-raised build's tie to its order means, said before anyone edits it
 * (plans/products/13 Q3, Q4): a planned one follows the order; a started or completed one no
 * longer does. A `manual` build is the escape hatch.
 */
function OrderTrackingNotice({ status, drifted }: { status: string; drifted: boolean }) {
  const tracked = status === 'planned'
  if (status === 'canceled') return null
  if (!drifted && !tracked) return null

  if (!drifted) {
    return (
      <p className='rounded-md bg-muted/50 px-2 py-1.5 text-muted-foreground text-xs'>
        This build tracks its order. Changes you make to it are replaced when the order changes —
        raise a build manually if you need one that stays.
      </p>
    )
  }

  return (
    <p className='rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-500'>
      {tracked
        ? 'The order has changed since this build was raised, and this build has not caught up. It is brought back into line the next time the order changes.'
        : `The order has changed since this build was raised. It is no longer updated automatically because it has ${
            status === 'completed' ? 'been completed' : 'started'
          }.`}
    </p>
  )
}

function ReversalBanner({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div className='flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-500'>
      <span>{label}</span>
      <Button variant='ghost' size='xs' onClick={onOpen}>
        Open
      </Button>
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
