// apps/web/src/components/dashboard/ui/widget/paginated-chart-legend.tsx
'use client'

// Recharts adapter for `PaginatedLegend`: replaces shadcn's single-row
// `ChartLegendContent` (which never wraps and overflows on many series). Fed as
// `<ChartLegend content={<PaginatedChartLegend />} />`; resolves labels/colors
// from the chart config via the shared `useChart`/`getPayloadConfigFromPayload`.

import { getPayloadConfigFromPayload, useChart } from '@auxx/ui/components/chart'
import { useMemo } from 'react'
import type { LegendProps } from 'recharts'
import { PaginatedLegend, type PaginatedLegendItem } from '~/components/charts/paginated-legend'

/** Max label width before ellipsis, matching Twenty's ~80px cap. */
const LABEL_MAX_WIDTH = 96

export function PaginatedChartLegend({
  payload,
  nameKey,
  verticalAlign = 'bottom',
}: Pick<LegendProps, 'payload' | 'verticalAlign'> & { nameKey?: string }) {
  const { config } = useChart()

  const items = useMemo<PaginatedLegendItem[]>(() => {
    if (!payload?.length) return []
    return payload.map((item) => {
      const key = `${nameKey || item.dataKey || 'value'}`
      const itemConfig = getPayloadConfigFromPayload(config, item, key)
      const resolved = itemConfig?.label ?? item.value
      const label = typeof resolved === 'string' ? resolved : `${item.value}`
      return {
        key: `${item.value}`,
        node: (
          <span className='flex items-center gap-1.5'>
            <span
              className='h-2 w-2 shrink-0 rounded-[2px]'
              style={{ backgroundColor: item.color ?? 'var(--muted-foreground)' }}
              aria-hidden
            />
            <span className='truncate' style={{ maxWidth: LABEL_MAX_WIDTH }} title={label}>
              {label}
            </span>
          </span>
        ),
      }
    })
  }, [payload, nameKey, config])

  return <PaginatedLegend items={items} className={verticalAlign === 'top' ? 'pb-3' : 'pt-3'} />
}
