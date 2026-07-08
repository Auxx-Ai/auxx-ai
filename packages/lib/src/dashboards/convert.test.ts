// packages/lib/src/dashboards/convert.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import {
  type BarChartConfig,
  convertWidgetConfiguration,
  DEFAULT_GAUGE_MAX,
  droppedFieldsOnConvert,
  type GaugeConfig,
  type KpiConfig,
  type RecordListConfig,
  type WidgetConfiguration,
  type WidgetKind,
} from './client'

const rf = (s: string) => s as ResourceFieldId
const source = { kind: 'entity' as const, entityDefinitionId: 'ticket' }
const groupBy = { fieldRef: rf('ticket:status') }
const metric = { op: 'sum' as const, fieldRef: rf('ticket:amount') }

const bar: BarChartConfig = {
  kind: 'barChart',
  source,
  metric,
  groupBy,
  secondaryGroupBy: { fieldRef: rf('ticket:priority') },
  stacked: true,
  color: 'blue',
  showLegend: true,
  filters: [],
}

const DATA_KINDS: WidgetKind[] = ['barChart', 'lineChart', 'pieChart', 'kpi', 'gauge', 'recordList']

describe('convertWidgetConfiguration', () => {
  it('is identity when the kind is unchanged', () => {
    expect(convertWidgetConfiguration(bar, 'barChart')).toBe(bar)
  })

  it('throws for richText/iframe as source or target', () => {
    expect(() => convertWidgetConfiguration(bar, 'richText')).toThrow()
    expect(() => convertWidgetConfiguration(bar, 'iframe')).toThrow()
    expect(() =>
      convertWidgetConfiguration({ kind: 'richText', content: null }, 'barChart')
    ).toThrow()
  })

  it('carries the shared spine into every data-widget target', () => {
    for (const toKind of DATA_KINDS) {
      const out = convertWidgetConfiguration(bar, toKind) as { source?: unknown; filters?: unknown }
      expect(out.source).toEqual(source)
      expect(out.filters).toEqual([])
    }
  })

  it('bar → line is near-lossless (metric, groupBy, secondary, appearance survive)', () => {
    const out = convertWidgetConfiguration(bar, 'lineChart')
    expect(out).toMatchObject({
      kind: 'lineChart',
      metric,
      groupBy,
      secondaryGroupBy: { fieldRef: 'ticket:priority' },
      stacked: true,
      color: 'blue',
      showLegend: true,
    })
  })

  it('bar → pie keeps metric/groupBy but drops secondary/stacked', () => {
    const out = convertWidgetConfiguration(bar, 'pieChart') as Record<string, unknown>
    expect(out).toMatchObject({ kind: 'pieChart', metric, groupBy, color: 'blue' })
    expect(out.secondaryGroupBy).toBeUndefined()
    expect(out.stacked).toBeUndefined()
  })

  it('bar → kpi drops the group-by, keeps source+metric', () => {
    const out = convertWidgetConfiguration(bar, 'kpi') as Record<string, unknown>
    expect(out).toMatchObject({ kind: 'kpi', source, metric })
    expect(out.groupBy).toBeUndefined()
  })

  it('any → gauge always ends with a rangeMax', () => {
    expect((convertWidgetConfiguration(bar, 'gauge') as GaugeConfig).rangeMax).toBe(
      DEFAULT_GAUGE_MAX
    )
    const withRange: BarChartConfig = { ...bar, rangeMax: 42 }
    expect((convertWidgetConfiguration(withRange, 'gauge') as GaugeConfig).rangeMax).toBe(42)
  })

  it('any → recordList always has columns and drops the metric', () => {
    const out = convertWidgetConfiguration(bar, 'recordList') as RecordListConfig & {
      metric?: unknown
    }
    expect(out.kind).toBe('recordList')
    expect(out.columns).toEqual([])
    expect(out.metric).toBeUndefined()
    expect(out.source).toEqual(source)
  })

  it('kpi → bar defaults the metric-count shell and leaves group-by empty (unconfigured)', () => {
    const kpi: KpiConfig = { kind: 'kpi', source, metric: { op: 'count' } }
    const out = convertWidgetConfiguration(kpi, 'barChart') as Record<string, unknown>
    expect(out).toMatchObject({ kind: 'barChart', metric: { op: 'count' } })
    expect(out.groupBy).toBeUndefined()
  })

  it('never writes undefined for absent optional fields', () => {
    const minimal: KpiConfig = { kind: 'kpi', source, metric: { op: 'count' } }
    const out = convertWidgetConfiguration(minimal, 'lineChart')
    expect(Object.values(out).every((v) => v !== undefined)).toBe(true)
  })

  it('every ordered pair of data kinds produces the matching kind', () => {
    const seed: Record<WidgetKind, WidgetConfiguration> = {
      barChart: bar,
      lineChart: { ...bar, kind: 'lineChart' } as WidgetConfiguration,
      pieChart: { kind: 'pieChart', source, metric, groupBy } as WidgetConfiguration,
      kpi: { kind: 'kpi', source, metric } as WidgetConfiguration,
      gauge: { kind: 'gauge', source, metric, rangeMax: 100 } as WidgetConfiguration,
      recordList: { kind: 'recordList', source, columns: [] } as WidgetConfiguration,
      richText: { kind: 'richText', content: null },
      iframe: { kind: 'iframe', url: null },
    }
    for (const from of DATA_KINDS) {
      for (const to of DATA_KINDS) {
        const out = convertWidgetConfiguration(seed[from], to)
        expect(out.kind).toBe(from === to ? from : to)
      }
    }
  })
})

describe('droppedFieldsOnConvert', () => {
  it('bar → line is lossless', () => {
    expect(droppedFieldsOnConvert(bar, 'lineChart')).toEqual([])
  })

  it('bar → kpi reports the category and series', () => {
    expect(droppedFieldsOnConvert(bar, 'kpi')).toEqual(
      expect.arrayContaining(['Category', 'Series'])
    )
  })

  it('kpi-with-trend → gauge reports the trend', () => {
    const kpi: KpiConfig = {
      kind: 'kpi',
      source,
      metric,
      trend: { dateFieldRef: rf('ticket:createdAt'), compare: 'previousPeriod' },
      prefix: '$',
    }
    const out = droppedFieldsOnConvert(kpi, 'gauge')
    expect(out).toEqual(expect.arrayContaining(['Trend', 'Prefix']))
  })

  it('chart → recordList reports the configured metric', () => {
    expect(droppedFieldsOnConvert(bar, 'recordList')).toContain('Metric')
  })

  it('recordList → bar reports columns/sort', () => {
    const list: RecordListConfig = {
      kind: 'recordList',
      source,
      columns: [rf('ticket:status')],
      sort: { fieldRef: rf('ticket:amount'), desc: true },
    }
    expect(droppedFieldsOnConvert(list, 'barChart')).toEqual(
      expect.arrayContaining(['Sort', 'Columns'])
    )
  })

  it('does not report a default count metric as lost', () => {
    const kpi: KpiConfig = { kind: 'kpi', source, metric: { op: 'count' } }
    expect(droppedFieldsOnConvert(kpi, 'recordList')).not.toContain('Metric')
  })
})
