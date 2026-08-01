// apps/web/src/components/dashboard/ui/widget/gauge-widget.tsx
'use client'

// Gauge widget: a half-circle `RadialBarChart` (startAngle 180 → endAngle 0).
// Single value clamped to `[rangeMin, rangeMax]`, drawn as a filled arc over a
// muted track, with the formatted value centered in the arc. Self-contained
// (owns its `useKpiData` fetch + states); gauges never carry a trend.

import {
  type GaugeConfig,
  isChartConfigured,
  normalizePaletteId,
} from '@auxx/lib/dashboards/client'
import { type ChartConfig, ChartContainer } from '@auxx/ui/components/chart'
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts'
import { useKpiData } from '../../hooks/use-kpi-data'
import { useMetricFieldMeta } from '../../hooks/use-metric-field'
import { seriesColors } from '../../lib/chart-palettes'
import { formatMetricValue } from '../../lib/format-value'
import { WidgetDroppedFilters } from './widget-dropped-filters'
import { WidgetError, WidgetSkeleton, WidgetUnconfigured } from './widget-states'

const GAUGE_CONFIG: ChartConfig = { value: { label: 'Value' } }

export function GaugeWidget({
  config,
  widgetId,
  isEditMode,
  onConfigure,
}: {
  config: GaugeConfig
  widgetId?: string
  isEditMode?: boolean
  onConfigure?: () => void
}) {
  const { data, isLoading, isError, error } = useKpiData(config, widgetId)
  const meta = useMetricFieldMeta(config.metric, config.valueFormat)

  // A gauge also needs a target (`rangeMax`) before it can draw its arc.
  if (!isChartConfigured(config) || config.rangeMax == null) {
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

  const min = config.rangeMin ?? 0
  const max = config.rangeMax
  const clamped = Math.min(Math.max(data.value, min), max)
  // A gauge is a single arc → the scheme's first color.
  const fill = seriesColors(normalizePaletteId(config.color), 1)[0]

  return (
    <div className='flex flex-1 min-h-0 flex-col'>
      <div className='relative flex flex-1 min-h-0 items-end justify-center'>
        <ChartContainer config={GAUGE_CONFIG} className='aspect-square h-full w-full max-h-full'>
          <RadialBarChart
            data={[{ value: clamped, fill }]}
            startAngle={180}
            endAngle={0}
            innerRadius='70%'
            outerRadius='100%'>
            <PolarAngleAxis type='number' domain={[min, max]} angleAxisId={0} tick={false} />
            <RadialBar dataKey='value' angleAxisId={0} background cornerRadius={8} />
          </RadialBarChart>
        </ChartContainer>
        <div className='absolute inset-x-0 bottom-[15%] flex flex-col items-center'>
          <span className='font-semibold text-2xl tabular-nums leading-none'>
            {formatMetricValue(data.value, config.metric.op, meta)}
          </span>
          {config.showDataLabels && (
            <span className='mt-1 text-muted-foreground text-xs tabular-nums'>
              {formatMetricValue(min, config.metric.op, meta)} –{' '}
              {formatMetricValue(max, config.metric.op, meta)}
            </span>
          )}
        </div>
      </div>
      {/* Outside the arc's positioning context so the absolute value overlay
          keeps its geometry — the gauge is unchanged when nothing dropped. */}
      <WidgetDroppedFilters
        source={config.source}
        droppedConditions={data.droppedConditions}
        droppedConditionCount={data.droppedConditionCount}
      />
    </div>
  )
}
