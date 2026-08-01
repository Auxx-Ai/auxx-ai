// packages/lib/src/dashboards/query-input.test.ts
//
// Guards the Phase-0 invariant (plan 10): display-only edits project to an
// IDENTICAL ChartQueryInput (→ same query key → no re-fetch), while data edits
// project differently.

import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { BarChartConfig, KpiConfig } from './client'
import { toChartQueryInput } from './client'

const baseBar: BarChartConfig = {
  kind: 'barChart',
  source: { kind: 'entity', entityDefinitionId: 'def1' },
  metric: { op: 'sum', fieldRef: toResourceFieldId('def1', 'amount') },
  groupBy: { fieldRef: toResourceFieldId('def1', 'created'), dateGranularity: 'month' },
}

describe('toChartQueryInput', () => {
  it('projects only data-determining fields', () => {
    expect(toChartQueryInput(baseBar)).toEqual({
      kind: 'barChart',
      source: { kind: 'entity', entityDefinitionId: 'def1' },
      metric: { op: 'sum', fieldRef: toResourceFieldId('def1', 'amount') },
      groupBy: { fieldRef: toResourceFieldId('def1', 'created'), dateGranularity: 'month' },
    })
  })

  it('display-only edits produce an IDENTICAL projection', () => {
    const styled: BarChartConfig = {
      ...baseBar,
      color: 'violet',
      showLegend: false,
      showDataLabels: true,
      layout: 'horizontal',
      valueFormat: { decimals: 0, displayAs: 'compact' },
      labelFormat: 'long',
      description: 'a note',
      rangeMax: 100,
    }
    expect(toChartQueryInput(styled)).toEqual(toChartQueryInput(baseBar))
  })

  it('data edits produce a DIFFERENT projection', () => {
    const granChanged: BarChartConfig = {
      ...baseBar,
      groupBy: { ...baseBar.groupBy, dateGranularity: 'week' },
    }
    expect(toChartQueryInput(granChanged)).not.toEqual(toChartQueryInput(baseBar))

    const metricChanged: BarChartConfig = { ...baseBar, metric: { op: 'count' } }
    expect(toChartQueryInput(metricChanged)).not.toEqual(toChartQueryInput(baseBar))

    const filterChanged: BarChartConfig = {
      ...baseBar,
      filters: [{ id: 'g1', logicalOperator: 'AND', conditions: [] }],
    }
    expect(toChartQueryInput(filterChanged)).not.toEqual(toChartQueryInput(baseBar))
  })

  it('carries the kpi trend (data-determining) but not its prefix/suffix (display)', () => {
    const kpi: KpiConfig = {
      kind: 'kpi',
      source: { kind: 'entity', entityDefinitionId: 'def1' },
      metric: { op: 'count' },
      prefix: '$',
      suffix: 'hrs',
      valueFormat: { decimals: 2 },
      trend: { dateFieldRef: toResourceFieldId('def1', 'created'), compare: 'previousPeriod' },
    }
    expect(toChartQueryInput(kpi)).toEqual({
      kind: 'kpi',
      source: { kind: 'entity', entityDefinitionId: 'def1' },
      metric: { op: 'count' },
      trend: { dateFieldRef: toResourceFieldId('def1', 'created'), compare: 'previousPeriod' },
    })
  })

  it('omits groupBy/secondaryGroupBy for kpi/gauge', () => {
    const gauge = toChartQueryInput({
      kind: 'gauge',
      source: { kind: 'entity', entityDefinitionId: 'def1' },
      metric: { op: 'count' },
      rangeMax: 50,
    })
    expect(gauge).not.toHaveProperty('groupBy')
    expect(gauge).not.toHaveProperty('secondaryGroupBy')
  })
})
