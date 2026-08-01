// apps/web/src/components/dashboard/ui/widget/chart-widget.tsx
'use client'

// Fetching container for the grouped charts (bar / line / pie). Owns the
// `useChartData` call + loading/empty/error/unconfigured states, transforms the
// aggregate result into recharts rows via `chart-transform`, and dispatches to
// the presentational per-kind body. KPI + gauge are single-value and fetch
// through `useKpiData` in their own components — they don't route through here.

import {
  type BarChartConfig,
  formatBucketLabel,
  isChartConfigured,
  type LineChartConfig,
  type PieChartConfig,
  resolveDefaultDateLabelFormat,
} from '@auxx/lib/dashboards/client'
import { isFieldPath } from '@auxx/types/field'
import { useField } from '~/components/resources/hooks/use-field'
import { useChartData } from '../../hooks/use-chart-data'
import { useMetricFieldMeta } from '../../hooks/use-metric-field'
import { remapGroupLabels, toChartRows } from '../../lib/chart-transform'
import { effectiveFieldTypeOf } from '../../lib/field-meta'
import { formatMetricValue, formatMetricValueCompact } from '../../lib/format-value'
import { BarChartWidget } from './bar-chart-widget'
import { LineChartWidget } from './line-chart-widget'
import { PieChartWidget } from './pie-chart-widget'
import { WidgetDroppedFilters } from './widget-dropped-filters'
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
  const meta = useMetricFieldMeta(config.metric, config.valueFormat)

  // Resolve the primary group-by field type to know if the category axis is a
  // DATE bucket — only then is `labelFormat` meaningful (plan 10).
  const groupRef = config.groupBy?.fieldRef
  const groupLeaf = groupRef
    ? isFieldPath(groupRef)
      ? groupRef[groupRef.length - 1]
      : groupRef
    : null
  const groupField = useField(groupLeaf)
  const groupFieldType = groupField ? effectiveFieldTypeOf(groupField) : undefined
  const isDateDim = groupFieldType === 'DATE' || groupFieldType === 'DATETIME'

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
  // Restyle date-bucket labels off their raw keys — pure client re-render, no
  // re-query. An explicit `labelFormat` override wins; otherwise a smarter
  // default kicks in (same-year day buckets drop the redundant year: `Jul 10`).
  const granularity = config.groupBy.dateGranularity ?? 'day'
  const labelFormat = isDateDim
    ? (config.labelFormat ??
      resolveDefaultDateLabelFormat(
        data.groups.map((g) => g.key),
        granularity
      ))
    : undefined
  const displayData = labelFormat
    ? remapGroupLabels(data, (key) => formatBucketLabel(key, granularity, labelFormat))
    : data
  const { rows, series } = toChartRows(displayData, { cumulative })
  // Tooltips / pie totals get the full field display; axis ticks + data labels
  // get the compact variant (`$12K` instead of a clipped `$12,000.00`).
  const formatValue = (n: number) => formatMetricValue(n, config.metric.op, meta)
  const formatAxisValue = (n: number) => formatMetricValueCompact(n, config.metric.op, meta)

  return (
    <div className='flex flex-1 min-h-0 flex-col'>
      <div className='min-h-0 flex-1'>
        {config.kind === 'barChart' && (
          <BarChartWidget
            config={config}
            rows={rows}
            series={series}
            formatValue={formatValue}
            formatAxisValue={formatAxisValue}
          />
        )}
        {config.kind === 'lineChart' && (
          <LineChartWidget
            config={config}
            rows={rows}
            series={series}
            formatValue={formatValue}
            formatAxisValue={formatAxisValue}
          />
        )}
        {config.kind === 'pieChart' && (
          <PieChartWidget config={config} result={displayData} formatValue={formatValue} />
        )}
      </div>
      {data.hasMoreGroups && (
        <p className='shrink-0 pt-1 text-center text-[10px] text-muted-foreground'>
          Top {rows.length} shown
        </p>
      )}
      {/* A dropped widget filter does not add visible rows here — it inflates
          every bar. This strip is the only tell. */}
      <WidgetDroppedFilters
        source={config.source}
        droppedConditions={data.droppedConditions}
        droppedConditionCount={data.droppedConditionCount}
      />
    </div>
  )
}
