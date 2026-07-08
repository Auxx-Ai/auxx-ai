// packages/lib/src/resources/aggregate/cache-key.test.ts

import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../conditions'
import { aggregateCacheKey } from './cache-key'
import type { AggregateQuery } from './types'

const ORG = 'org_1'
const DEF = 'def_tickets'
const ref = (fieldId: string) => toResourceFieldId(DEF, fieldId)

function baseQuery(overrides: Partial<AggregateQuery> = {}): AggregateQuery {
  return {
    source: { kind: 'entity', entityDefinitionId: DEF },
    metric: { op: 'count' },
    timezone: 'UTC',
    ...overrides,
  }
}

function assigneeFilter(userId: string, groupId = 'g1', conditionId = 'c1'): ConditionGroup[] {
  return [
    {
      id: groupId,
      logicalOperator: 'AND',
      conditions: [{ id: conditionId, fieldId: ref('assignee'), operator: 'is', value: userId }],
    },
  ]
}

const key = (
  query: AggregateQuery,
  extra: { kind?: 'agg' | 'kpi'; compare?: 'previousPeriod' } = {}
) =>
  aggregateCacheKey({
    kind: extra.kind ?? 'agg',
    organizationId: ORG,
    query,
    compare: extra.compare,
  })

describe('aggregateCacheKey', () => {
  it('is deterministic and org-prefixed', () => {
    expect(key(baseQuery())).toBe(key(baseQuery()))
    expect(key(baseQuery()).startsWith(`${ORG}:`)).toBe(true)
  })

  it('is independent of object key insertion order', () => {
    const a: AggregateQuery = {
      source: { kind: 'entity', entityDefinitionId: DEF },
      metric: { op: 'count' },
      timezone: 'UTC',
    }
    const b: AggregateQuery = {
      timezone: 'UTC',
      metric: { op: 'count' },
      source: { entityDefinitionId: DEF, kind: 'entity' },
    }
    expect(key(a)).toBe(key(b))
  })

  it('treats absent and explicitly-undefined optionals identically', () => {
    expect(key(baseQuery())).toBe(
      key(baseQuery({ groupBy: undefined, filters: undefined, limit: undefined }))
    )
  })

  it('normalizes date-window Dates to instants (fresh Date instances match)', () => {
    const window = () => ({
      fieldRef: ref('createdAt'),
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
    })
    expect(key(baseQuery({ dateWindow: window() }))).toBe(key(baseQuery({ dateWindow: window() })))
    expect(key(baseQuery({ dateWindow: window() }))).not.toBe(
      key(baseQuery({ dateWindow: { ...window(), to: new Date('2026-03-01T00:00:00Z') } }))
    )
  })

  it('forks on organization, timezone, metric, group-by, and limit', () => {
    const base = key(baseQuery())
    expect(
      aggregateCacheKey({ kind: 'agg', organizationId: 'org_2', query: baseQuery() })
    ).not.toBe(base)
    expect(key(baseQuery({ timezone: 'America/New_York' }))).not.toBe(base)
    expect(key(baseQuery({ metric: { op: 'countNotEmpty', fieldRef: ref('subject') } }))).not.toBe(
      base
    )
    expect(key(baseQuery({ groupBy: { fieldRef: ref('status') } }))).not.toBe(base)
    expect(key(baseQuery({ limit: 5 }))).not.toBe(base)
  })

  it('forks on group-by granularity/sort while defaults stay stable', () => {
    const day = key(baseQuery({ groupBy: { fieldRef: ref('createdAt'), dateGranularity: 'day' } }))
    const week = key(
      baseQuery({ groupBy: { fieldRef: ref('createdAt'), dateGranularity: 'week' } })
    )
    expect(day).not.toBe(week)
  })

  it('forks on resolved filter values (viewer-resolved `me` placeholders)', () => {
    const userA = key(baseQuery({ filters: assigneeFilter('user_a') }))
    const userB = key(baseQuery({ filters: assigneeFilter('user_b') }))
    expect(userA).not.toBe(userB)
  })

  it('ignores condition/group ids and group metadata (UI bookkeeping)', () => {
    const a = baseQuery({ filters: assigneeFilter('user_a', 'g1', 'c1') })
    const b = baseQuery({ filters: assigneeFilter('user_a', 'g2', 'c2') })
    const withMeta = structuredClone(b)
    withMeta.filters![0]!.metadata = { collapsed: true }
    withMeta.filters![0]!.order = 3
    expect(key(a)).toBe(key(b))
    expect(key(a)).toBe(key(withMeta))
  })

  it('forks on kind and on KPI trend compare', () => {
    const agg = key(baseQuery())
    const kpi = key(baseQuery(), { kind: 'kpi' })
    const kpiTrend = key(baseQuery(), { kind: 'kpi', compare: 'previousPeriod' })
    expect(kpi).not.toBe(agg)
    expect(kpiTrend).not.toBe(kpi)
  })
})
