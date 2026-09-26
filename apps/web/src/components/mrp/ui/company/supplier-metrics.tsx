// apps/web/src/components/mrp/ui/company/supplier-metrics.tsx
'use client'

import { MRP_MIN_RECEIPTS } from '@auxx/lib/mrp/client'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { useMemo } from 'react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import type { RouterOutputs } from '~/trpc/react'
import { buildDeliveryRecord, formatLateness } from '../charts/delivery-record-data'
import { formatDay, formatDays, formatQty } from '../part/key-numbers'

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY_CELL : `${Math.round(value * 100)} %`
}

function lateness(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY_CELL : formatLateness(value)
}

/** The supplier's roll-up over every vendor part (plan 16 §5). */
export function SupplierMetrics({
  performance,
  loading = false,
}: {
  performance: RouterOutputs['mrp']['supplierPerformance'] | undefined
  loading?: boolean
}) {
  const stats = performance?.supplier.stats
  const noExpected = useMemo(
    () => (performance ? buildDeliveryRecord(performance).noExpected : 0),
    [performance]
  )
  // `onTimeRate` is over the receipts that had an expected date.
  const timed = stats ? stats.count - noExpected : 0
  const onTime = stats?.onTimeRate != null ? Math.round(stats.onTimeRate * timed) : null
  const thin = stats ? stats.count < MRP_MIN_RECEIPTS : false
  const open = performance?.openOnOrder
  const scheduled = performance?.supplier.orderMode === 'scheduled'

  return (
    <MetricGrid columns={3} className='overflow-hidden rounded-md border'>
      <MetricCell
        label='On time'
        loading={loading}
        value={percent(stats?.onTimeRate)}
        description={onTime !== null ? `${onTime} of ${timed} receipts` : undefined}
      />
      <MetricCell
        label='Median lateness'
        loading={loading}
        value={lateness(stats?.medianLatenessDays)}
        description={
          stats?.p90LatenessDays != null ? `p90 ${lateness(stats.p90LatenessDays)}` : undefined
        }
      />
      <MetricCell
        label='Fill rate'
        loading={loading}
        value={percent(stats?.avgFill)}
        description={stats ? `over ${stats.count} line${stats.count === 1 ? '' : 's'}` : undefined}
      />
      <MetricCell
        label='Clean receipts'
        loading={loading}
        value={<span className={thin ? 'text-amber-600' : undefined}>{stats?.count ?? 0}</span>}
        description={stats ? `${stats.excluded} excluded` : undefined}
      />
      <MetricCell
        label='Order rhythm'
        loading={loading}
        value={formatDays(performance?.medianOrderIntervalDays)}
        description={
          scheduled ? `stated ${formatDays(performance?.supplier.statedCycleDays)}` : 'when needed'
        }
      />
      <MetricCell
        label='On order'
        loading={loading}
        value={
          open && open.poCount > 0
            ? `${open.poCount} PO${open.poCount === 1 ? '' : 's'} · ${formatQty(open.quantity)} units`
            : EMPTY_CELL
        }
        description={
          open?.earliestExpectedAt ? `earliest ${formatDay(open.earliestExpectedAt)}` : EMPTY_CELL
        }
      />
    </MetricGrid>
  )
}
