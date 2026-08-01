// apps/web/src/components/dashboard/ui/widget/kpi-widget.tsx
'use client'

// KPI widget: one big formatted value + an optional trend row. No chart lib.
// Self-contained (owns its `useKpiData` fetch + loading/empty/error states).
// The value is formatted through the metric field's FieldType/FieldOptions —
// with the per-widget `valueFormat` override layered on (plan 10) — via
// `useMetricFieldMeta` → `formatMetricValue`, so it matches the records table.
// The trend row shows only when the server returns a `previousValue` (needs a
// bounded date range). When a trend IS configured but the window is unbounded, a
// small info tooltip explains the missing row. `prefix`/`suffix` remain free-text
// affixes on top of the formatted value.

import { isChartConfigured, type KpiConfig } from '@auxx/lib/dashboards/client'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { Info, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useKpiData } from '../../hooks/use-kpi-data'
import { useMetricFieldMeta } from '../../hooks/use-metric-field'
import { computeTrendDelta, formatMetricValue, formatTrendPercent } from '../../lib/format-value'
import { WidgetDroppedFilters } from './widget-dropped-filters'
import { WidgetError, WidgetSkeleton, WidgetUnconfigured } from './widget-states'

export function KpiWidget({
  config,
  widgetId,
  isEditMode,
  onConfigure,
}: {
  config: KpiConfig
  widgetId?: string
  isEditMode?: boolean
  onConfigure?: () => void
}) {
  const { data, isLoading, isError, error } = useKpiData(config, widgetId)
  const meta = useMetricFieldMeta(config.metric, config.valueFormat)

  if (!isChartConfigured(config)) {
    return (
      <WidgetUnconfigured
        message='Configure this widget'
        onConfigure={isEditMode ? onConfigure : undefined}
      />
    )
  }
  if (isLoading && !data) return <WidgetSkeleton variant='value' />
  if (isError) return <WidgetError message={error?.message} />
  if (!data) return <WidgetSkeleton variant='value' />

  const value = formatMetricValue(data.value, config.metric.op, meta)
  const trend = computeTrendDelta(data.value, data.previousValue)
  const hasTrendConfigured = Boolean(config.trend)

  return (
    <div className='flex flex-1 min-h-0 flex-col justify-center gap-1 p-1'>
      <div className='flex items-baseline gap-1 font-semibold text-3xl tabular-nums leading-none'>
        {config.prefix && <span className='text-muted-foreground text-lg'>{config.prefix}</span>}
        <span className='truncate'>{value}</span>
        {config.suffix && <span className='text-muted-foreground text-lg'>{config.suffix}</span>}
      </div>

      {trend ? (
        <TrendRow direction={trend.direction} percent={formatTrendPercent(trend.percent)} />
      ) : (
        hasTrendConfigured && (
          <SimpleTooltip content='Trend needs a bounded date range'>
            <span className='flex w-fit items-center gap-1 text-muted-foreground text-xs'>
              <Info className='size-3' />
              No trend
            </span>
          </SimpleTooltip>
        )
      )}

      {/* The single-number case: nothing on this tile hints that a filter was
          ignored, and the trend arrow is computed off the same widened set. */}
      <WidgetDroppedFilters
        source={config.source}
        droppedConditions={data.droppedConditions}
        droppedConditionCount={data.droppedConditionCount}
      />
    </div>
  )
}

function TrendRow({ direction, percent }: { direction: 'up' | 'down' | 'flat'; percent: string }) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs',
        direction === 'up' && 'text-good-600',
        direction === 'down' && 'text-destructive',
        direction === 'flat' && 'text-muted-foreground'
      )}>
      <Icon className='size-3.5' />
      <span className='tabular-nums'>{percent}</span>
    </div>
  )
}
