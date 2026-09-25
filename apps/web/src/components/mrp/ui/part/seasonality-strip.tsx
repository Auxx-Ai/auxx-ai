// apps/web/src/components/mrp/ui/part/seasonality-strip.tsx
'use client'

import { MRP_SEASONAL_MONTHS } from '@auxx/lib/mrp/client'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { api } from '~/trpc/react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
        <MetricGrid columns={4} className='overflow-hidden rounded-md border'>
          {MONTHS.map((month, m) => (
            <MetricCell
              key={month}
              label={month}
              value={`×${(index[m] ?? 1).toFixed(2)}`}
              className={m === currentMonth ? 'ring-1 ring-primary ring-inset' : undefined}
            />
          ))}
        </MetricGrid>
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
