// apps/homepage/src/app/platform/reporting/_mocks/mock-config-panel.tsx
'use client'

import { BarChart3, ChartLine, ChartPie, ChevronDown, Gauge, Hash, Rows3 } from 'lucide-react'
import { cn } from '~/lib/utils'

export type MockWidgetKind = 'bar' | 'line' | 'pie' | 'kpi' | 'gauge' | 'list'
export type MockSource = 'tickets' | 'contacts'
export type MockMetric = 'count' | 'aiRate'
export type MockCategory = 'team' | 'channel' | 'tag' | 'company'
export type MockSeriesOption = 'none' | 'channel'

export interface MockWidgetConfig {
  source: MockSource
  metric: MockMetric
  category: MockCategory
  series: MockSeriesOption
  kind: MockWidgetKind
}

export const WIDGET_KINDS: { kind: MockWidgetKind; label: string; icon: React.ElementType }[] = [
  { kind: 'bar', label: 'Bar', icon: BarChart3 },
  { kind: 'line', label: 'Line', icon: ChartLine },
  { kind: 'pie', label: 'Pie', icon: ChartPie },
  { kind: 'kpi', label: 'KPI', icon: Hash },
  { kind: 'gauge', label: 'Gauge', icon: Gauge },
  { kind: 'list', label: 'Record list', icon: Rows3 },
]

/** Valid options per source — switching source snaps the other fields to these. */
export const CONFIG_OPTIONS: Record<
  MockSource,
  {
    metrics: { value: MockMetric; label: string }[]
    categories: { value: MockCategory; label: string }[]
  }
> = {
  tickets: {
    metrics: [
      { value: 'count', label: 'Count of tickets' },
      { value: 'aiRate', label: 'AI-resolved %' },
    ],
    categories: [
      { value: 'team', label: 'Team' },
      { value: 'channel', label: 'Channel' },
      { value: 'tag', label: 'Tag' },
    ],
  },
  contacts: {
    metrics: [{ value: 'count', label: 'Count of contacts' }],
    categories: [
      { value: 'company', label: 'Company' },
      { value: 'tag', label: 'Tag' },
    ],
  },
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className='grid grid-cols-[5.5rem_1fr] items-center gap-2'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <div className='relative'>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className='bg-background ring-border hover:ring-foreground/25 w-full cursor-pointer appearance-none rounded-md py-1.5 pl-2.5 pr-7 text-xs font-medium outline-none ring-1 transition-shadow'>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className='text-muted-foreground pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2' />
      </div>
    </div>
  )
}

/**
 * Working replica of the widget config panel: source → metric → category →
 * series selects plus the six chart-type chips, all driving the live preview.
 */
export function MockConfigPanel({
  config,
  onChange,
  className,
}: {
  config: MockWidgetConfig
  onChange: (patch: Partial<MockWidgetConfig>) => void
  className?: string
}) {
  const options = CONFIG_OPTIONS[config.source]
  const seriesOptions =
    config.source === 'tickets' && config.metric === 'count'
      ? [
          { value: 'none', label: 'None' },
          { value: 'channel', label: 'Channel' },
        ]
      : [{ value: 'none', label: 'None' }]

  return (
    <div className={cn('space-y-2.5', className)}>
      <SelectRow
        label='Source'
        value={config.source}
        options={[
          { value: 'tickets', label: 'Tickets' },
          { value: 'contacts', label: 'Contacts' },
        ]}
        onChange={(source) => onChange({ source: source as MockSource })}
      />
      <SelectRow
        label='Metric'
        value={config.metric}
        options={options.metrics}
        onChange={(metric) => onChange({ metric: metric as MockMetric })}
      />
      <SelectRow
        label='Category'
        value={config.category}
        options={options.categories}
        onChange={(category) => onChange({ category: category as MockCategory })}
      />
      <SelectRow
        label='Series'
        value={config.series}
        options={seriesOptions}
        onChange={(series) => onChange({ series: series as MockSeriesOption })}
      />
      <div className='grid grid-cols-[5.5rem_1fr] items-start gap-2 pt-1'>
        <span className='text-muted-foreground pt-1 text-xs'>Chart type</span>
        <div className='flex flex-wrap gap-1.5'>
          {WIDGET_KINDS.map(({ kind: k, label, icon: Icon }) => (
            <button
              key={k}
              type='button'
              onClick={() => onChange({ kind: k })}
              aria-pressed={config.kind === k}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 transition-colors',
                config.kind === k
                  ? 'bg-foreground text-background ring-foreground'
                  : 'bg-background text-muted-foreground ring-border hover:text-foreground'
              )}>
              <Icon className='size-3' />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
