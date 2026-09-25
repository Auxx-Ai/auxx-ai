// packages/lib/src/resources/aggregate/__tests__/mrp-plan-item-aggregate.test.ts
//
// The `mrp_plan_item` system source (plans/mrp/07-ui-plan.md §5.4) through `runAggregate`, with
// the real Drizzle schema so the emitted SQL can be rendered and read.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => ({ ...(await vi.importActual('@auxx/database')) }))

const h = vi.hoisted(() => ({
  cacheReads: [] as string[],
  queries: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
  entityNames: [] as Array<{ id: string; displayName: string }>,
}))

vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async () => FIELDS,
    getAggregateCache: () => ({
      read: async (key: string) => {
        h.cacheReads.push(key)
        return null
      },
      write: async () => {},
    }),
  }
})

import type { Database } from '@auxx/database'
import { toResourceFieldId } from '@auxx/types/field'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import { PermissionKey } from '../../../permissions/capabilities/registry'
import type { ResourceField } from '../../registry/field-types'
import { MRP_PLAN_ITEM_FIELDS } from '../../registry/resources/mrp-plan-item-fields'
import { runAggregate, runKpi } from '../run-aggregate'
import { isSystemAggregateTable } from '../system-aggregate-builder'
import type { AggregateQuery } from '../types'

const ORG = 'org_mrp_1'
const FIELDS: ResourceField[] = Object.values(MRP_PLAN_ITEM_FIELDS).map((f) => ({
  ...f,
  resourceFieldId: toResourceFieldId('mrp_plan_item', f.id),
}))
const field = (key: string) => toResourceFieldId('mrp_plan_item', key)
const dialect = new PgDialect()

/** Records every aggregate statement (skipping the `SET LOCAL`) and answers the label lookup. */
function stubDb(): Database {
  const selectChain = {
    from: () => selectChain,
    where: async () => h.entityNames,
  }
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async (q: unknown) => {
          const text = dialect.sqlToQuery(q as never).sql
          if (text.startsWith('SET LOCAL')) return { rows: [] }
          h.queries.push(text)
          return { rows: h.rows }
        },
      }),
    select: () => selectChain,
  } as unknown as Database
}

const latest = [
  {
    id: 'g1',
    logicalOperator: 'AND' as const,
    conditions: [{ id: 'c1', fieldId: field('isLatest'), operator: 'is' as const, value: true }],
  },
]

const base: Omit<AggregateQuery, 'metric'> = {
  source: { kind: 'system', tableId: 'mrp_plan_item' },
  timezone: 'America/New_York',
}

beforeEach(() => {
  h.cacheReads.length = 0
  h.queries.length = 0
  h.rows = []
  h.entityNames = []
})

describe('mrp_plan_item aggregate source', () => {
  it('is on the system allowlist', () => {
    expect(isSystemAggregateTable('mrp_plan_item')).toBe(true)
  })

  it('counts the latest run by the composite key, scoped by organizationId', async () => {
    h.rows = [{ value: 4 }]
    const result = await runKpi(stubDb(), ORG, 'u1', {
      base: { ...base, metric: { op: 'count' }, filters: latest },
    })

    expect(result._unsafeUnwrap().value).toBe(4)
    const q = h.queries[0] ?? ''
    expect(q).toContain(
      'COUNT(DISTINCT ("MrpPlanRunItem"."mrpPlanRunId", "MrpPlanRunItem"."partId"))'
    )
    expect(q).toContain('FROM "MrpPlanRunItem" WHERE "MrpPlanRunItem"."organizationId" = $1')
    expect(q).toContain('"MrpPlanRunItem"."isLatest" = $')
  })

  it('buckets a calendar date column by week without a timezone shift', async () => {
    h.rows = [{ g: '2026-09-21', value: 3 }]
    const result = await runAggregate(stubDb(), ORG, 'u1', {
      ...base,
      metric: { op: 'count' },
      groupBy: { fieldRef: field('orderByDate'), dateGranularity: 'week' },
      filters: latest,
    })

    const q = h.queries[0] ?? ''
    expect(q).toContain('date_trunc($1, ("MrpPlanRunItem"."orderByDate")::timestamp)')
    expect(q).not.toContain('AT TIME ZONE')
    expect(result._unsafeUnwrap().groups[0]).toMatchObject({ key: '2026-09-21', value: 3 })
  })

  it('sums suggested quantity by supplier and labels groups with company names', async () => {
    h.rows = [
      { g: 'co_1', value: 120 },
      { g: null, value: 5 },
    ]
    h.entityNames = [{ id: 'co_1', displayName: 'Acme Fasteners' }]
    const result = await runAggregate(stubDb(), ORG, 'u1', {
      ...base,
      metric: { op: 'sum', fieldRef: field('suggestedQty') },
      groupBy: { fieldRef: field('suggestedSupplierId') },
    })

    const q = h.queries[0] ?? ''
    expect(q).toContain('SUM("MrpPlanRunItem"."suggestedQty")')
    expect(q).toContain('"MrpPlanRunItem"."suggestedSupplierId" AS g')
    const groups = result._unsafeUnwrap().groups
    expect(groups.map((g) => [g.key, g.label, g.value])).toEqual([
      ['co_1', 'Acme Fasteners', 120],
      [null, '(empty)', 5],
    ])
  })

  it('groups the flags array by element, labelled from the flag vocabulary', async () => {
    h.rows = [
      { g: 'no_lead_time', value: 2 },
      { g: 'mirror_drift', value: 1 },
    ]
    const result = await runAggregate(stubDb(), ORG, 'u1', {
      ...base,
      metric: { op: 'count' },
      groupBy: { fieldRef: field('flags'), omitEmpty: true },
      filters: latest,
    })

    const q = h.queries[0] ?? ''
    expect(q).toContain(
      'LEFT JOIN LATERAL unnest("MrpPlanRunItem"."flags") AS "agg_g"("v") ON true'
    )
    expect(q).toContain('"agg_g"."v" AS g')
    expect(q).toContain('"agg_g"."v" IS NOT NULL')
    expect(result._unsafeUnwrap().groups.map((g) => g.label)).toEqual([
      'No lead time',
      'Movement history out of sync',
    ])
  })

  it('refuses a viewer without mrp.view before the cache, and admits one with it', async () => {
    const view = (keys: PermissionKey[]) =>
      ({ has: (k: PermissionKey) => keys.includes(k) }) as unknown as CapabilityView
    const query: AggregateQuery = { ...base, metric: { op: 'count' } }

    const denied = await runAggregate(stubDb(), ORG, 'u1', query, { capabilities: view([]) })
    expect(denied.isErr() && denied.error.name).toBe('ForbiddenError')
    expect(h.cacheReads).toHaveLength(0)

    h.rows = [{ value: 1 }]
    const allowed = await runAggregate(stubDb(), ORG, 'u1', query, {
      capabilities: view([PermissionKey.mrpView]),
    })
    expect(allowed.isOk()).toBe(true)
  })
})
