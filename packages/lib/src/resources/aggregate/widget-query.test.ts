// packages/lib/src/resources/aggregate/widget-query.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../conditions'
import type { BarChartConfig, KpiConfig } from '../../dashboards/client'
import {
  buildAggregateQueryForWidget,
  resolveDateRangePreset,
  segmentForGroupKey,
  trendSpecForWidget,
} from './widget-query'

const ref = (s: string) => s as ResourceFieldId

const group = (id: string): ConditionGroup => ({
  id,
  logicalOperator: 'AND',
  conditions: [{ id: `${id}-c`, fieldId: ref('def1:status'), operator: 'is', value: 'x' }],
})

describe('buildAggregateQueryForWidget', () => {
  const cfg: BarChartConfig = {
    kind: 'barChart',
    source: { kind: 'entity', entityDefinitionId: 'def1' },
    metric: { op: 'count' },
    groupBy: { fieldRef: ref('def1:status') },
    filters: [group('w')],
    globalDateFieldRef: ref('def1:createdAt'),
  }

  it('concatenates widget filters with matching dashboard conditions only', () => {
    const query = buildAggregateQueryForWidget(cfg, {
      timezone: 'UTC',
      conditions: [
        { entityDefinitionId: 'def1', groups: [group('g1')] },
        { entityDefinitionId: 'other', groups: [group('g2')] },
      ],
    })
    expect(query.filters?.map((g) => g.id)).toEqual(['w', 'g1'])
  })

  it('binds the global date range to globalDateFieldRef', () => {
    const from = new Date('2026-07-01T00:00:00.000Z')
    const to = new Date('2026-07-08T00:00:00.000Z')
    const query = buildAggregateQueryForWidget(cfg, { timezone: 'UTC', dateRange: { from, to } })
    expect(query.dateWindow).toEqual({ fieldRef: ref('def1:createdAt'), from, to })
  })

  it('skips the date window when the widget opted out (null ref)', () => {
    const query = buildAggregateQueryForWidget(
      { ...cfg, globalDateFieldRef: null },
      { timezone: 'UTC', dateRange: { from: new Date(), to: new Date() } }
    )
    expect(query.dateWindow).toBeUndefined()
  })

  it('falls back to the KPI trend date field when globalDateFieldRef is absent', () => {
    const kpi: KpiConfig = {
      kind: 'kpi',
      source: { kind: 'entity', entityDefinitionId: 'def1' },
      metric: { op: 'count' },
      trend: { dateFieldRef: ref('def1:createdAt'), compare: 'previousPeriod' },
    }
    const from = new Date('2026-07-01T00:00:00.000Z')
    const to = new Date('2026-07-08T00:00:00.000Z')
    const query = buildAggregateQueryForWidget(kpi, { timezone: 'UTC', dateRange: { from, to } })
    expect(query.dateWindow?.fieldRef).toBe(ref('def1:createdAt'))
    expect(trendSpecForWidget(kpi)).toEqual({ compare: 'previousPeriod' })
  })
})

describe('resolveDateRangePreset', () => {
  const now = new Date('2026-07-07T15:30:00.000Z')

  it('allTime and absent are unbounded', () => {
    expect(resolveDateRangePreset('allTime', 'UTC', now)).toEqual({})
    expect(resolveDateRangePreset(undefined, 'UTC', now)).toEqual({})
  })

  it('last7d starts at local midnight 6 days back', () => {
    const range = resolveDateRangePreset('last7d', 'UTC', now)
    expect(range.from?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range.to).toBe(now)
  })

  it('thisMonth starts at the local month start', () => {
    const range = resolveDateRangePreset('thisMonth', 'America/New_York', now)
    expect(range.from?.toISOString()).toBe('2026-07-01T04:00:00.000Z')
  })

  it('custom ranges are local days with inclusive end date', () => {
    const range = resolveDateRangePreset({ from: '2026-07-01', to: '2026-07-03' }, 'UTC', now)
    expect(range.from?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range.to?.toISOString()).toBe('2026-07-04T00:00:00.000Z')
  })
})

describe('segmentForGroupKey', () => {
  it('maps keys by field storage type', () => {
    expect(segmentForGroupKey({ key: null, fieldType: 'TEXT', timezone: 'UTC' })).toEqual({
      kind: 'empty',
    })
    expect(
      segmentForGroupKey({ key: 'opt1', fieldType: 'SINGLE_SELECT', timezone: 'UTC' })
    ).toEqual({ kind: 'option', optionId: 'opt1' })
    expect(segmentForGroupKey({ key: 'rec1', fieldType: 'RELATIONSHIP', timezone: 'UTC' })).toEqual(
      { kind: 'related', relatedEntityId: 'rec1' }
    )
    expect(segmentForGroupKey({ key: 'true', fieldType: 'CHECKBOX', timezone: 'UTC' })).toEqual({
      kind: 'scalar',
      value: true,
    })
    expect(segmentForGroupKey({ key: '42', fieldType: 'NUMBER', timezone: 'UTC' })).toEqual({
      kind: 'scalar',
      value: 42,
    })
  })

  it('maps date buckets to half-open ranges and cyclic buckets to undefined', () => {
    expect(
      segmentForGroupKey({
        key: '2026-07-01',
        fieldType: 'DATE',
        dateGranularity: 'month',
        timezone: 'UTC',
      })
    ).toEqual({
      kind: 'dateBucket',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    })
    expect(
      segmentForGroupKey({
        key: '3',
        fieldType: 'DATE',
        dateGranularity: 'dayOfWeek',
        timezone: 'UTC',
      })
    ).toBeUndefined()
  })
})
