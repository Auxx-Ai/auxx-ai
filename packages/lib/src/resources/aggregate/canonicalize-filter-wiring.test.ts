// packages/lib/src/resources/aggregate/canonicalize-filter-wiring.test.ts
//
// 🔴 READ BEFORE DELETING THIS FILE AS REDUNDANT.
//
// This test asserts only that `prepareAggregate` hands CANONICALIZED conditions
// to `systemConditionBuilder` — it inspects the builder's INPUT, not its output.
// On its own that is a weak assertion: it would stay green even if the canonical
// form resolved to nothing. It is acceptable here only because it composes with
// two stronger tests that already exist:
//
//   - `query-builder/__tests__/canonicalize-system-fields.test.ts` proves the
//     rewrite itself is correct (registry key, idempotence, no invented
//     resolutions).
//   - `run-aggregate.int.test.ts` proves the end-to-end narrowing against real
//     Article rows — 3 articles, 2 PUBLISHED, and a cuid-addressed filter
//     returning 2 rather than the unfiltered 3.
//
// Its narrow job is to make the WIRING itself impossible to delete silently.
// The integration file is the only end-to-end proof and CI does not run it: the
// workflow enumerates vitest projects and omits `integration`, which needs a
// live database. So without this file, removing the `canonicalizeSystemConditions`
// call from `run-aggregate.ts` is a green CI and a dashboard that quietly reports
// numbers that are too HIGH (a dropped filter does not narrow).
//
// Asserting on the builder's input is also the only option under the unit
// config: it mocks `@auxx/database` with a proxy whose table columns are `{}`,
// so `schema.Article.status` is undefined and no real predicate can be built
// here. That is precisely why the DB-backed proof lives in the `.int` file.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fields: [] as unknown[],
}))

// Partial mock — a full replacement of the `../../cache` module breaks at
// collection time as the import graph grows.
vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async () => h.fields,
    getAggregateCache: () => ({
      read: async () => null,
      write: async () => undefined,
    }),
  }
})

import type { Database } from '@auxx/database'
import type { ConditionGroup } from '../../conditions'
import { BaseType } from '../../workflow-engine/core/types'
import { systemConditionBuilder } from '../query-builder/system-condition-builder'
import type { ResourceField } from '../registry/field-types'
import { runAggregate } from './run-aggregate'
import type { AggregateQuery } from './types'

/** The org's materialized `CustomField` row id for the static `article:status` field. */
const STATUS_CUID = 'cf_article_status_00000001'
/** A cuid that matches no merged field — e.g. a widget saved against a retired one. */
const UNKNOWN_CUID = 'cf_retired_field_000000001'

/**
 * The merged shape `mergeSystemAndCustomFields` produces for a system resource:
 * `id` is the DB `CustomField.id` (the cuid the filter UIs send), while `key`
 * stays the static registry key the condition builder looks up.
 */
const MERGED_FIELDS: ResourceField[] = [
  {
    id: STATUS_CUID,
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

/** Nothing here reaches Postgres for real — the aggregate SQL is never executed. */
function stubDb(): Database {
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: async () => ({ rows: [{ value: 0 }] }) }),
  } as unknown as Database
}

const filterOn = (fieldRef: string): ConditionGroup[] => [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c1', fieldId: fieldRef, operator: 'is', value: 'PUBLISHED' }],
  },
]

const articleCount = (filters: ConditionGroup[]): AggregateQuery => ({
  source: { kind: 'system', tableId: 'article' },
  metric: { op: 'count' },
  timezone: 'UTC',
  filters,
})

describe('the system filter branch canonicalizes before the builder sees it', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    h.fields = MERGED_FIELDS
    spy = vi.spyOn(systemConditionBuilder, 'buildGroupedQueryWithDiagnostics').mockReturnValue({
      sql: undefined,
      requestedConditions: 1,
      droppedConditions: [],
      allConditionsDropped: false,
    })
  })

  /** The `fieldId` of the first condition of the first group the builder received. */
  async function fieldIdSeenByBuilder(fieldRef: string): Promise<unknown> {
    const result = await runAggregate(
      stubDb(),
      'org_1',
      undefined,
      articleCount(filterOn(fieldRef))
    )
    expect(result.isOk()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const groups = spy.mock.calls[0]?.[0] as ConditionGroup[]
    return groups[0]?.conditions[0]?.fieldId
  }

  it('rewrites a `<defId>:<cuid>` ref to the static registry key', async () => {
    // The shape the table filter builder sends. `RESOURCE_FIELD_REGISTRY.article`
    // is keyed by 'status', so this is the only form the builder can resolve.
    expect(await fieldIdSeenByBuilder(`article:${STATUS_CUID}`)).toBe('status')
  })

  it('rewrites a bare cuid too — the records searchbar shape', async () => {
    expect(await fieldIdSeenByBuilder(STATUS_CUID)).toBe('status')
  })

  it('passes an already-canonical ref through untouched', async () => {
    expect(await fieldIdSeenByBuilder('status')).toBe('status')
  })

  it('leaves an unresolvable cuid unchanged, so the builder still drops it visibly', async () => {
    // Deliberate: rewriting a guess here would trade today's recorded
    // `DroppedCondition` for a silent, confidently wrong predicate.
    expect(await fieldIdSeenByBuilder(UNKNOWN_CUID)).toBe(UNKNOWN_CUID)
  })

  it('still targets the article table', async () => {
    await fieldIdSeenByBuilder(STATUS_CUID)
    expect(spy.mock.calls[0]?.[1]).toBe('article')
  })
})
