// packages/lib/src/resources/aggregate/dropped-widget-filters.test.ts
//
// `AggregateResult` / `KpiResult` carry the dropped-filter report.
//
// The aggregate engine has always LOGGED a dropped widget filter and returned
// nothing about it, which is the fail-open at its most misleading: on a list a
// dropped filter shows extra rows, on an aggregate it shows no extra anything —
// the bar is just taller and the KPI is just bigger. Nobody reading the tile can
// tell, and the widget's filters are STORED, so they outlive the fields they
// name by design.
//
// Same projection, same cap, same exact count as the list lane, because a UI
// must not have to branch on which engine produced the number it annotates.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fields: [] as unknown[] }))

// Partial mock — a full replacement of `../../cache` breaks at collection time
// as the import graph grows (matching the sibling aggregate test).
vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async () => h.fields,
    // Reads must miss: a cached hit would return a result shaped before this
    // change and the assertions would describe the cache, not the engine.
    getAggregateCache: () => ({ read: async () => null, write: async () => undefined }),
  }
})

import type { Database } from '@auxx/database'
import type { ConditionGroup } from '../../conditions'
import { BaseType } from '../../workflow-engine/core/types'
import { MAX_REPORTED_DROPPED_CONDITIONS } from '../crud/unified-handler-queries'
import { systemConditionBuilder } from '../query-builder/system-condition-builder'
import type { ResourceField } from '../registry/field-types'
import { runAggregate, runKpi } from './run-aggregate'
import type { AggregateQuery } from './types'

const MERGED_FIELDS: ResourceField[] = [
  {
    id: 'cf_article_status_00000001',
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    dbColumn: 'status',
    systemAttribute: 'article_status',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  } as unknown as ResourceField,
]

function stubDb(): Database {
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: async () => ({ rows: [{ value: 7 }] }) }),
  } as unknown as Database
}

/** One internal drop record, in the shape `BaseConditionBuilder` produces. */
function drop(n: number) {
  return {
    conditionId: `c${n}`,
    fieldRef: `article:cf_retired_${n}`,
    operator: 'is',
    reason: 'unresolved-field-or-operator' as const,
    // Builder internals — must never reach a dashboard viewer.
    detail: 'SystemConditionBuilder',
  }
}

const filters: ConditionGroup[] = [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c1', fieldId: 'cf_retired_1', operator: 'is', value: 'PUBLISHED' }],
  },
]

const articleCount: AggregateQuery = {
  source: { kind: 'system', tableId: 'article' },
  metric: { op: 'count' },
  timezone: 'UTC',
  filters,
}

/** Point the mocked builder at a given drop list. */
function mockBuild(dropped: ReturnType<typeof drop>[]) {
  return vi.spyOn(systemConditionBuilder, 'buildGroupedQueryWithDiagnostics').mockReturnValue({
    sql: undefined,
    requestedConditions: Math.max(dropped.length, 1),
    droppedConditions: dropped,
    allConditionsDropped: dropped.length > 0,
  })
}

beforeEach(() => {
  h.fields = MERGED_FIELDS
  vi.restoreAllMocks()
})

describe('runAggregate reports the widget filters it could not apply', () => {
  it('omits both keys entirely when every condition compiled', async () => {
    mockBuild([])
    const result = await runAggregate(stubDb(), 'org_1', undefined, articleCount)

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    // Absent, not `undefined` — an existing widget consumer must see the
    // pre-change shape.
    expect(Object.keys(value).sort()).toEqual(['groups', 'hasMoreGroups', 'totalValue'])
  })

  it('reports the drop alongside the number it inflated', async () => {
    mockBuild([drop(1)])
    const result = await runAggregate(stubDb(), 'org_1', undefined, articleCount)

    const value = result._unsafeUnwrap()
    // Still ok(): the widget renders, as it did before. It just says so now.
    expect(value.totalValue).toBe(7)
    expect(value.droppedConditionCount).toBe(1)
    expect(value.droppedConditions).toEqual([
      {
        conditionId: 'c1',
        fieldRef: 'article:cf_retired_1',
        operator: 'is',
        reason: 'unresolved-field-or-operator',
      },
    ])
  })

  it('withholds builder internals', async () => {
    mockBuild([drop(1)])
    const result = await runAggregate(stubDb(), 'org_1', undefined, articleCount)

    expect(JSON.stringify(result._unsafeUnwrap())).not.toContain('SystemConditionBuilder')
  })

  it(`caps the array at ${MAX_REPORTED_DROPPED_CONDITIONS} and keeps the count exact`, async () => {
    mockBuild(Array.from({ length: MAX_REPORTED_DROPPED_CONDITIONS + 4 }, (_, i) => drop(i)))
    const result = await runAggregate(stubDb(), 'org_1', undefined, articleCount)

    const value = result._unsafeUnwrap()
    expect(value.droppedConditions).toHaveLength(MAX_REPORTED_DROPPED_CONDITIONS)
    expect(value.droppedConditionCount).toBe(MAX_REPORTED_DROPPED_CONDITIONS + 4)
  })
})

describe('runKpi reports too — the worst case for a silent drop', () => {
  it('carries the report on a single-value result', async () => {
    mockBuild([drop(1)])
    const result = await runKpi(stubDb(), 'org_1', undefined, { base: articleCount })

    const value = result._unsafeUnwrap()
    // One big number, no rows to eyeball. Without this there is no tell at all.
    expect(value.value).toBe(7)
    expect(value.droppedConditionCount).toBe(1)
  })

  it('stays byte-identical on a clean KPI', async () => {
    mockBuild([])
    const result = await runKpi(stubDb(), 'org_1', undefined, { base: articleCount })

    expect(Object.keys(result._unsafeUnwrap()).sort()).toEqual(['value'])
  })
})
