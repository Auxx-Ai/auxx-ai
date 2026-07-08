// apps/web/src/components/dashboard/ui/widget/chart-widget.tsx
'use client'

// Fetching container for the grouped charts (bar / line / pie). Owns the
// `useChartData` call + loading/empty/error/unconfigured states, transforms the
// aggregate result into recharts rows via `chart-transform`, and dispatches to
// the presentational per-kind body. KPI + gauge are single-value and fetch
// through `useKpiData` in their own components — they don't route through here.

import {
  type BarChartConfig,
  isChartConfigured,
  type LineChartConfig,
  type PieChartConfig,
} from '@auxx/lib/dashboards/client'
import { useChartData } from '../../hooks/use-chart-data'
import { useMetricFieldMeta } from '../../hooks/use-metric-field'
import { toChartRows } from '../../lib/chart-transform'
import { formatMetricValue } from '../../lib/format-value'
import { BarChartWidget } from './bar-chart-widget'
import { LineChartWidget } from './line-chart-widget'
import { PieChartWidget } from './pie-chart-widget'
import { WidgetEmpty, WidgetError, WidgetSkeleton, WidgetUnconfigured } from './widget-states'

type GroupedChartConfig = BarChartConfig | LineChartConfig | PieChartConfig

export function ChartWidget({
  config,
  widgetId,
  isEditMode,
  onConfigure,
}: {
  config: GroupedChartConfig
  widgetId?: string
  isEditMode: boolean
  onConfigure?: () => void
}) {
  const { data, isLoading, isError, error } = useChartData(config, widgetId)
  const meta = useMetricFieldMeta(config.metric)

  if (!isChartConfigured(config)) {
    return (
      <WidgetUnconfigured
        message='Configure this widget'
        onConfigure={isEditMode ? onConfigure : undefined}
      />
    )
  }
  if (isLoading && !data) return <WidgetSkeleton variant='chart' />
  if (isError) return <WidgetError message={error?.message} />
  if (!data || data.groups.length === 0) return <WidgetEmpty />

  const cumulative = config.kind !== 'pieChart' ? config.cumulative : undefined
  const { rows, series } = toChartRows(data, { cumulative })
  // Format axis ticks / totals like the metric field displays elsewhere.
  const formatValue = (n: number) => formatMetricValue(n, config.metric.op, meta)

  return (
    <div className='flex flex-1 min-h-0 flex-col'>
      <div className='min-h-0 flex-1'>
        {config.kind === 'barChart' && (
          <BarChartWidget config={config} rows={rows} series={series} formatValue={formatValue} />
        )}
        {config.kind === 'lineChart' && (
          <LineChartWidget config={config} rows={rows} series={series} formatValue={formatValue} />
        )}
        {config.kind === 'pieChart' && (
          <PieChartWidget config={config} result={data} formatValue={formatValue} />
        )}
      </div>
      {data.hasMoreGroups && (
        <p className='shrink-0 pt-1 text-center text-[10px] text-muted-foreground'>
          Top {rows.length} shown
        </p>
      )}
    </div>
  )
}
