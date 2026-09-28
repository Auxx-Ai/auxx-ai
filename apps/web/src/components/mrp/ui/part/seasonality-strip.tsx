// apps/web/src/components/mrp/ui/part/seasonality-strip.tsx
'use client'

import { MRP_SEASONAL_MONTHS } from '@auxx/lib/mrp/client'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Peak vs quiet season, not good vs bad, so no red/green; within ±0.05 of 1 stays neutral.
function toneOf(value: number): string | undefined {
  if (value >= 1.05) return 'text-orange-600 dark:text-orange-400'
  if (value <= 0.95) return 'text-sky-600 dark:text-sky-400'
  return undefined
}

interface SeasonalityStripProps {
  partId: string
  runId: string | null
}

/** Twelve monthly indexes (02 §6.5); a component's is the blend of its parents', named in the header. */
export function SeasonalityStrip({ partId, runId }: SeasonalityStripProps) {
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const whereUsed = api.mrp.whereUsed.useQuery({ partId, runId })

  const item = partItem.data?.item
  if (!partItem.isLoading && !item) return null

  const index = item?.seasonalIndex ?? null
  const asOfDay = partItem.data?.run?.asOfDay
  const currentMonth = asOfDay ? Number(asOfDay.slice(5, 7)) - 1 : new Date().getMonth()

  // The run blends a part's index from its parents whenever history names one (02 §6.5 step 3).
  const parents = (whereUsed.data?.parents ?? []).filter((p) => p.share > 0)
  const inherited = parents.some((p) => !p.isDirectSale)
  const secondary =
    index && inherited
      ? `inherited from ${parents
          .map(
            (p) =>
              `${p.isDirectSale ? 'own sales' : (p.name ?? 'Unnamed')} ${Math.round(p.share * 100)} %`
          )
          .join(', ')}`
      : undefined

  return (
    <Section title='Seasonality' secondary={secondary}>
      {partItem.isLoading ? (
        <EmptySection loading />
      ) : index ? (
        // Twelve in a row once each cell gets its 3.5rem minimum (12 × 3.5 = 42rem), else two rows of six.
        <div className='@container'>
          <div className='grid grid-cols-6 gap-px overflow-hidden rounded-md border bg-border @min-[42rem]:grid-cols-12'>
            {MONTHS.map((month, m) => (
              <div
                key={month}
                className={cn(
                  'bg-background px-2 py-1.5 text-center',
                  m === currentMonth && 'ring-1 ring-primary ring-inset'
                )}>
                <div className='text-xs text-muted-foreground'>{month}</div>
                <div className={cn('text-sm font-semibold tabular-nums', toneOf(index[m] ?? 1))}>
                  ×{(index[m] ?? 1).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptySection
          orientation='horizontal'
          // TODO(mrp): show the month count once the run item stores it ("7 months of history").
          title={`Seasonality off: fewer than ${MRP_SEASONAL_MONTHS.min} months of history, ${MRP_SEASONAL_MONTHS.min} needed`}
        />
      )}
    </Section>
  )
}
