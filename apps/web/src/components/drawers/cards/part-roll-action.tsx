// apps/web/src/components/drawers/cards/part-roll-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatCurrency } from '@auxx/utils/currency'
import { RollStandardCostPopover } from '~/components/manufacturing/parts/roll-standard-cost-popover'
import { api, type RouterOutputs } from '~/trpc/react'

type RollPlan = RouterOutputs['builds']['previewRoll']
type RollLine = RollPlan['lines'][number]

/** This part's own roll: its line and skip in a one-part preview (09 D-SC6). */
export function usePartRollPreview(partId: string, enabled: boolean) {
  const preview = api.builds.previewRoll.useQuery(
    { partIds: [partId] },
    { enabled, retry: false, refetchOnWindowFocus: false }
  )
  const plan = preview.data
  return {
    isLoading: enabled && preview.isPending,
    error: preview.error,
    line: plan?.lines.find((line) => line.partId === partId) ?? null,
    skip: plan?.skipped.find((skip) => skip.partId === partId) ?? null,
  }
}

type PartRollPreview = ReturnType<typeof usePartRollPreview>

/** A signed amount in minor units: "+$0.30", "-$2.00". */
function signed(minor: number, currencyCode: string): string {
  return `${minor > 0 ? '+' : ''}${formatCurrency(minor, { currencyCode })}`
}

/** Roll, labelled with the result, only when it changes this part; otherwise why not. */
export function PartRollAction({
  partId,
  preview,
  hasBom,
  currencyCode,
  onRolled,
}: {
  partId: string
  preview: PartRollPreview
  hasBom: boolean
  currencyCode: string
  onRolled?: () => void
}) {
  const { line, skip } = preview
  if (preview.isLoading) return <Skeleton className='ms-auto h-6 w-24' />

  if (line?.changed) {
    return (
      <RollStandardCostPopover partId={partId} onSuccess={onRolled}>
        <Button variant='outline' size='xs' className='ms-auto'>
          Roll &rarr; {formatCurrency(line.standardCost, { currencyCode })}
        </Button>
      </RollStandardCostPopover>
    )
  }

  let reason = 'Nothing to roll'
  if (preview.error) reason = preview.error.message
  else if (line) reason = hasBom ? 'Matches its bill of materials' : 'Matches supplier price'
  else if (skip?.reason === 'no-live-cost') reason = 'No supplier price to roll from'
  else if (skip?.reason === 'component-not-valuable') {
    reason = `Can't roll: ${skip.blockedByPartName ?? 'a component'} has no cost`
  }
  return <span className='ms-auto truncate text-muted-foreground text-xs'>{reason}</span>
}

/** "+$0.30 × 40 = +$12.00", or the first-standard note, under a changed line. */
export function PartRollDelta({ line, currencyCode }: { line: RollLine; currencyCode: string }) {
  if (line.isInitial) {
    return (
      <p className='text-muted-foreground text-xs'>Roll: first standard, prices pending rows</p>
    )
  }
  const perUnit = line.standardCost - (line.previousStandardCost ?? 0)
  return (
    <p className='text-muted-foreground text-xs tabular-nums'>
      Roll: {signed(perUnit, currencyCode)} &times; {line.quantityOnHand} ={' '}
      {signed(line.revaluationDelta, currencyCode)}
    </p>
  )
}
