// apps/web/src/components/manufacturing/parts/standard-source-badge.tsx
'use client'

import { PartStandardCostOrigin } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Tooltip } from '~/components/global/tooltip'

const ORIGIN_LABEL = Object.fromEntries(
  PartStandardCostOrigin.values.map((option) => [option.value, option.label])
)

/** A standard's origin: amber while provisional, green once confirmed, outlined when unstamped. */
export function StandardSourceBadge({
  source,
  origin,
}: {
  source: string | null
  origin: string | null
}) {
  const originLabel = origin ? (ORIGIN_LABEL[origin] ?? origin) : null
  const from = originLabel ? `, from ${originLabel.toLowerCase()}` : ''
  const tooltip =
    source === 'provisional'
      ? `Provisional standard${from}. The first receipt replaces it with the price paid.`
      : source === 'confirmed'
        ? `Confirmed standard${from}.`
        : `Standard cost${from}.`
  const variant = source === 'provisional' ? 'amber' : source === 'confirmed' ? 'green' : 'outline'
  return (
    <Tooltip content={tooltip}>
      <Badge variant={variant} size='xs' className='shrink-0'>
        {originLabel ??
          (source === 'confirmed' ? 'Confirmed' : source ? 'Provisional' : 'Standard')}
      </Badge>
    </Tooltip>
  )
}
