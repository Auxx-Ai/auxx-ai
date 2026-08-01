// packages/lib/src/resources/crud/__tests__/list-filtered-dropped-conditions.test.ts
//
// `ListFilteredResult.droppedConditions` — the observability channel for this
// lane's deliberate fail-open.
//
// A filter condition the builder cannot compile is DROPPED and the query runs
// anyway, so the list silently widens. That is the right call for saved views,
// the mail list, unread counts and the workflow Find node, all of which depend on
// `baseScope` for a genuine empty filter — but it made the failure invisible by
// construction, and four separate fail-open bugs hid behind it (KB free-text
// search, the KB Tag/Status/Kind filters, dashboard thread widgets, and an
// unknown operator compiling to `eq(col, value)`).
//
// Four properties, and all four are the point:
//
//   1. Both lanes report. The `EntityInstance` path and the system-table path are
//      separate functions with separate builders; a UI must not have to branch on
//      which one served it, so the SHAPE is asserted identical for both.
//   2. Strictly additive. A clean build must not put the keys on the response at
//      all — an existing caller spreading the result must see no shape change.
//   3. Bounded. A pathological filter set must not put an unbounded array on
//      every list response, and the COUNT must stay exact past the cap so a UI
//      that renders it never *undercounts* what it is warning about.
//   4. It never changes the SQL. Reporting a drop must not also start filtering
//      on it — the whole contract is "widened, and said so".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The org's merged fields for `article`, swapped per test. Hoisted because the
 * `cache` factory closes over it.
 *
 * A FULL factory, never `importOriginal` + spread: the real `cache` barrel's
 * transitive graph re-enters `unified-handler-queries` while the factory is
 * still running, so a spread-based override binds the REAL helper in the module
 * under test and silently does nothing.
 */
const mergedFields = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => mergedFields.current),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

/** Diagnostics the two builder mocks below hand back, swapped per test. */
const entityBuild = {
  sql: undefined as unknown,
  requestedConditions: 0,
  droppedConditions: [] as unknown[],
  allConditionsDropped: false,
}
const systemBuild = {
  sql: undefined as unknown,
  requestedConditions: 0,
  droppedConditions: [] as unknown[],
  allConditionsDropped: false,
}

vi.mock('../../query-builder/entity-condition-builder', () => ({
  entityConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => entityBuild),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

vi.mock('../../query-builder/system-condition-builder', () => ({
  systemConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => systemBuild),
    // `inspectFilterConditions` reads this one; its errors reach `message`, so it
    // is as capable of a false refusal as the build is.
    validateConditionGroups: vi.fn(() => ({ valid: true, errors: [] })),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

import { systemConditionBuilder } from '../../query-builder/system-condition-builder'
import { RESOURCE_FIELD_REGISTRY } from '../../registry/field-registry'
import {
  inspectFilterConditions,
  MAX_REPORTED_DROPPED_CONDITIONS,
  queryEntityInstanceIdsPaged,
  querySystemResourceIdsPaged,
} from '../unified-handler-queries'

/** One internal drop record, in the shape `BaseConditionBuilder` produces. */
function drop(n: number) {
  return {
    conditionId: `cond_${n}`,
    fieldRef: `article:field_${n}`,
    operator: 'equals',
    reason: 'unresolved-field-or-operator' as const,
    // Builder internals — the class name that gave up. Must NOT reach a client.
    detail: 'SystemConditionBuilder',
  }
}

function setDrops(target: typeof entityBuild, drops: ReturnType<typeof drop>[]) {
  target.droppedConditions = drops
  target.requestedConditions = drops.length
  target.allConditionsDropped = drops.length > 0
}

/** Drizzle stand-in that records every `where()` argument; each chain is a thenable. */
function fakeDb(...results: unknown[][]) {
  const wheres: unknown[] = []
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = (w: unknown) => {
      wheres.push(w)
      return c
    }
    c.orderBy = () => c
    c.limit = () => c
    c.offset = () => c
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return c
  }
  let n = 0
  return { db: { select: () => chain(results[n++] ?? []) } as never, wheres }
}

const ids = (...v: string[]) => v.map((id) => ({ id }))

const entityBase = {
  entityDefinitionId: 'edf000000000000000000001',
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}
const systemBase = {
  tableId: 'article' as const,
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}

beforeEach(() => {
  setDrops(entityBuild, [])
  setDrops(systemBuild, [])
})

describe('a clean build stays byte-identical — no key appears at all', () => {
  it('omits both keys on the EntityInstance path', async () => {
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditions).toBeUndefined()
    expect(r.droppedConditionCount).toBeUndefined()
    // Not just `undefined` — ABSENT. A caller doing `'droppedConditions' in r`,
    // or serializing the page, must see the pre-change shape.
    expect(Object.keys(r).sort()).toEqual(['hasMore', 'ids'])
  })

  it('omits both keys on the system-resource path', async () => {
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(Object.keys(r).sort()).toEqual(['hasMore', 'ids'])
  })
})

describe('both lanes report the same shape', () => {
  it('reports drops on the EntityInstance path', async () => {
    setDrops(entityBuild, [drop(1)])
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions).toEqual([
      {
        conditionId: 'cond_1',
        fieldRef: 'article:field_1',
        operator: 'equals',
        reason: 'unresolved-field-or-operator',
      },
    ])
  })

  it('reports drops on the system-resource path — the lane where the KB filters drop today', async () => {
    setDrops(systemBuild, [drop(1)])
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions).toEqual([
      {
        conditionId: 'cond_1',
        fieldRef: 'article:field_1',
        operator: 'equals',
        reason: 'unresolved-field-or-operator',
      },
    ])
  })

  it('produces key-for-key identical notices from the two builders', async () => {
    setDrops(entityBuild, [drop(7)])
    setDrops(systemBuild, [drop(7)])

    const entity = await queryEntityInstanceIdsPaged({ ...entityBase, db: fakeDb(ids('i0')).db })
    const system = await querySystemResourceIdsPaged({ ...systemBase, db: fakeDb(ids('a0')).db })

    // The two paths are separate functions; drift between them is exactly what a
    // UI cannot absorb, so this asserts equality rather than "both non-empty".
    expect(entity.droppedConditions).toEqual(system.droppedConditions)
    expect(entity.droppedConditionCount).toBe(system.droppedConditionCount)
  })
})

describe('client-facing projection withholds builder internals', () => {
  it('strips `detail` — the builder class name / raw valueSource token', async () => {
    setDrops(systemBuild, [drop(1)])
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    const notice = r.droppedConditions?.[0]
    expect(notice).toBeDefined()
    expect(Object.keys(notice as object).sort()).toEqual([
      'conditionId',
      'fieldRef',
      'operator',
      'reason',
    ])
    expect(JSON.stringify(r)).not.toContain('SystemConditionBuilder')
  })
})

describe('the payload is bounded', () => {
  it(`caps the array at ${MAX_REPORTED_DROPPED_CONDITIONS} but keeps the count exact`, async () => {
    const many = Array.from({ length: MAX_REPORTED_DROPPED_CONDITIONS + 12 }, (_, i) => drop(i))
    setDrops(systemBuild, many)
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.droppedConditions).toHaveLength(MAX_REPORTED_DROPPED_CONDITIONS)
    // The count is the number a UI renders. Truncating it would make the notice
    // itself understate the problem — the same silence this field exists to end.
    expect(r.droppedConditionCount).toBe(MAX_REPORTED_DROPPED_CONDITIONS + 12)
  })

  it('keeps the array intact when it is under the cap', async () => {
    setDrops(entityBuild, [drop(1), drop(2), drop(3)])
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditions).toHaveLength(3)
    expect(r.droppedConditionCount).toBe(3)
  })
})

describe('reporting does not change the query', () => {
  it('still returns the WIDER page — the fail-open is preserved, not converted to an error', async () => {
    setDrops(systemBuild, [drop(1), drop(2)])
    const { db, wheres } = fakeDb(ids('a0', 'a1', 'a2'))

    // No throw, and the rows the dropped filters would have excluded still come
    // back. Callers that must refuse (AI tools) use `inspectFilterConditions`.
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.ids).toEqual(['a0', 'a1', 'a2'])
    expect(r.droppedConditionCount).toBe(2)
    // One WHERE was still built and issued — the org scope. Nothing about the
    // reporting path added or removed a predicate.
    expect(wheres).toHaveLength(1)
  })

  it('leaves `total` alone — it still describes the widened set the query actually ran', async () => {
    setDrops(entityBuild, [drop(1)])
    const { db } = fakeDb(ids('i0'), [{ count: 6470 }])
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db, includeTotal: true })

    expect(r.total).toBe(6470)
    expect(r.droppedConditionCount).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE CUID DROP ITSELF — the bug the reporting above made visible
// ─────────────────────────────────────────────────────────────────────────────
//
// The filter UIs address a field on a system resource by the org's merged
// `CustomField` **cuid**; the builder resolves against
// `RESOURCE_FIELD_REGISTRY[tableId]`, keyed by the STATIC key. So the KB
// articles table filtered by Tag / Status / Kind dropped every condition and
// returned everything. `canonicalizeSystemConditions` now runs first.
//
// These tests keep the builder mocked — the point is what this lane HANDS the
// builder — but the mock is made registry-aware, so a drop here is produced by
// the same rule the real `SystemConditionBuilder` applies (`custom_` prefix, or
// a hit in the registry after the `<defId>:` prefix is stripped). Asserting only
// on the forwarded arguments would pass even if the canonical form were one the
// builder still cannot resolve.

/** cuid of the org's materialized `CustomField` row for the static `tags` field. */
const TAGS_CUID = 'cf_tags_0000000000000001'
/** …and for `status`, which is also SORTABLE — the second half of the same bug. */
const STATUS_CUID = 'cf_status_00000000000001'
/** A cuid the org has no field for at all. */
const GHOST_CUID = 'cf_ghost_000000000000001'

const ARTICLE_DEF_ID = 'edf000000000000000000009'

/** The merged shape `mergeSystemAndCustomFields` produces: DB id, static key. */
const ARTICLE_MERGED_FIELDS = [
  { id: TAGS_CUID, key: 'tags', label: 'Tags', systemAttribute: 'article_tags' },
  { id: STATUS_CUID, key: 'status', label: 'Status', systemAttribute: 'article_status' },
]

/** `SystemConditionBuilder`'s actual resolution rule, in four lines. */
function resolves(fieldRef: unknown, tableId: string): boolean {
  const ref = Array.isArray(fieldRef) ? fieldRef[0] : fieldRef
  if (typeof ref !== 'string') return false
  if (ref.startsWith('custom_')) return true
  const stripped = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref
  return Boolean(RESOURCE_FIELD_REGISTRY[tableId as never]?.[stripped])
}

/** Registry-aware stand-in for `buildGroupedQueryWithDiagnostics`. */
function registryAwareBuild(groups: { conditions: unknown[] }[], tableId: string) {
  const conditions = groups.flatMap((g) => g.conditions) as {
    id: string
    fieldId: unknown
    operator: string
  }[]
  const droppedConditions = conditions
    .filter((c) => !resolves(c.fieldId, tableId))
    .map((c) => ({
      conditionId: c.id,
      fieldRef: c.fieldId,
      operator: c.operator,
      reason: 'unresolved-field-or-operator' as const,
      detail: 'SystemConditionBuilder',
    }))

  return {
    sql: undefined,
    requestedConditions: conditions.length,
    droppedConditions,
    allConditionsDropped: conditions.length > 0 && droppedConditions.length === conditions.length,
  }
}

/** Registry-aware stand-in for `validateConditionGroups`. */
function registryAwareValidate(groups: { conditions: unknown[] }[], tableId: string) {
  const errors = (groups.flatMap((g) => g.conditions) as { fieldId: unknown }[])
    .filter((c) => !resolves(c.fieldId, tableId))
    .map((c) => `Group 1: Unknown field: ${String(c.fieldId)}`)

  return { valid: errors.length === 0, errors }
}

/** One `article` filter group holding a single condition on `fieldId`. */
const articleFilter = (fieldId: unknown) => [
  {
    id: 'g1',
    logicalOperator: 'AND' as const,
    conditions: [{ id: 'c1', fieldId, operator: 'is', value: 'x' }],
  },
]

describe('a cuid-addressed filter on a system table now RESOLVES', () => {
  const build = vi.mocked(systemConditionBuilder.buildGroupedQueryWithDiagnostics)

  beforeEach(() => {
    mergedFields.current = ARTICLE_MERGED_FIELDS
    build.mockImplementation(registryAwareBuild as never)
  })

  // Restore the fixed-diagnostics stub the rest of the file drives by hand.
  afterEach(() => {
    mergedFields.current = []
    build.mockImplementation((() => systemBuild) as never)
  })

  it.each([
    ['bare cuid, as the records searchbar sends it', TAGS_CUID],
    ['prefixed cuid, as the table filter builder sends it', `${ARTICLE_DEF_ID}:${STATUS_CUID}`],
    ['relationship path head', [TAGS_CUID, 'tag:name']],
  ])('drops nothing for a %s', async (_label, fieldId) => {
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: articleFilter(fieldId) as never,
    })

    // Before the canonicalizer this was exactly one drop — and one drop means
    // the KB articles list returned every article in the org.
    expect(r.droppedConditions).toBeUndefined()
    expect(r.droppedConditionCount).toBeUndefined()
  })

  it('hands the builder the STATIC key, not the cuid', async () => {
    const { db } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: articleFilter(TAGS_CUID) as never,
    })

    const [groups, tableId] = build.mock.calls.at(-1) as [
      { conditions: { fieldId: unknown }[] }[],
      string,
    ]
    expect(groups[0]?.conditions[0]?.fieldId).toBe('tags')
    expect(tableId).toBe('article')
  })

  it('still resolves a condition already written in the static shape', async () => {
    // Stored views hold either shape; the pre-pass runs over both forever.
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: articleFilter('status') as never,
    })

    expect(r.droppedConditions).toBeUndefined()
  })

  it('reports an unresolvable cuid EXACTLY once — the fail-open stays visible', async () => {
    const { db, wheres } = fakeDb(ids('a0', 'a1'))
    const r = await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: articleFilter(`${ARTICLE_DEF_ID}:${GHOST_CUID}`) as never,
    })

    // Canonicalization must not invent a resolution: a cuid the org has no field
    // for comes back unchanged, so the builder still drops it and still says so.
    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions).toEqual([
      {
        conditionId: 'c1',
        fieldRef: `${ARTICLE_DEF_ID}:${GHOST_CUID}`,
        operator: 'is',
        reason: 'unresolved-field-or-operator',
      },
    ])
    // …and the page is still the WIDER one. Reported, not thrown.
    expect(r.ids).toEqual(['a0', 'a1'])
    expect(wheres).toHaveLength(1)
  })

  it('keeps the count exact when only SOME conditions resolve', async () => {
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: [
        {
          id: 'g1',
          logicalOperator: 'AND' as const,
          conditions: [
            { id: 'c1', fieldId: TAGS_CUID, operator: 'is', value: 'x' },
            { id: 'c2', fieldId: GHOST_CUID, operator: 'is', value: 'y' },
            { id: 'c3', fieldId: STATUS_CUID, operator: 'is', value: 'z' },
          ],
        },
      ] as never,
    })

    // Two of three now compile. A count of 3 here would mean the canonicalizer
    // ran but the builder still could not read what it produced.
    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions?.[0]?.conditionId).toBe('c2')
  })
})

describe('SORT — a cuid column header reaches the builder canonicalized', () => {
  const orderBy = vi.mocked(systemConditionBuilder.buildOrderBySql)

  beforeEach(() => {
    mergedFields.current = ARTICLE_MERGED_FIELDS
  })
  afterEach(() => {
    mergedFields.current = []
  })

  it('translates the cuid to the static key', async () => {
    const { db } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      sorting: [{ id: STATUS_CUID, desc: true }],
    })

    // `buildOrderBySql` reads the same registry as the conditions, so the same
    // cuid mismatch made it return `undefined` — clicking a column header on a
    // system table silently did nothing at all.
    expect(orderBy).toHaveBeenCalledWith('status', 'desc', 'article')
  })

  it('strips the `<defId>:` prefix the table filter builder adds', async () => {
    const { db } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      sorting: [{ id: `${ARTICLE_DEF_ID}:${TAGS_CUID}`, desc: false }],
    })

    expect(orderBy).toHaveBeenCalledWith('tags', 'asc', 'article')
  })

  it('passes an unresolvable sort id through untouched', async () => {
    // No dropped-sort channel exists, and inventing one here is out of scope —
    // an unsorted list is visibly odd in a way a widened one is not.
    const { db } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      sorting: [{ id: GHOST_CUID, desc: false }],
    })

    expect(orderBy).toHaveBeenCalledWith(GHOST_CUID, 'asc', 'article')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE AI BOUNDARY MUST AGREE WITH THE QUERY LANE
// ─────────────────────────────────────────────────────────────────────────────
//
// `inspectFilterConditions` is the fail-CLOSED half of this module: the list
// widens and says so, an AI tool refuses. That only works while preflight and
// the query lane answer identically for every input — the two are separate call
// sites into the same builder, so canonicalizing one and not the other is a bug
// in BOTH directions:
//
//   • preflight silent where the query drops  ⇒ a widened answer ships as fact;
//   • preflight refusing where the query applies ⇒ a working filter is rejected.
//
// The second is the one this change could introduce, so it is asserted first —
// and then the equivalence itself is asserted over the whole input space rather
// than sampled, because "both happen to be right about `tags`" is not the
// property.

describe('inspectFilterConditions agrees with the query lane', () => {
  const build = vi.mocked(systemConditionBuilder.buildGroupedQueryWithDiagnostics)
  const validate = vi.mocked(systemConditionBuilder.validateConditionGroups)

  beforeEach(() => {
    mergedFields.current = ARTICLE_MERGED_FIELDS
    build.mockImplementation(registryAwareBuild as never)
    validate.mockImplementation(registryAwareValidate as never)
  })

  afterEach(() => {
    mergedFields.current = []
    build.mockImplementation((() => systemBuild) as never)
    validate.mockImplementation((() => ({ valid: true, errors: [] })) as never)
  })

  const preflight = (fieldId: unknown) =>
    inspectFilterConditions({
      organizationId: 'org_1',
      entityDefinitionId: 'article',
      filters: articleFilter(fieldId) as never,
    })

  it('does NOT refuse a cuid the query lane successfully applies', async () => {
    const report = await preflight(TAGS_CUID)

    expect(report.dropped).toEqual([])
    // Validation is canonicalized too, or its `Unknown field:` error would refuse
    // via `message` even with an empty `dropped`.
    expect(report.validationErrors).toEqual([])
    expect(report.message).toBeUndefined()
  })

  it('does NOT refuse a `<defId>:`-prefixed cuid either', async () => {
    const report = await preflight(`${ARTICLE_DEF_ID}:${STATUS_CUID}`)

    expect(report.message).toBeUndefined()
    expect(report.allConditionsDropped).toBe(false)
  })

  it('STILL refuses a garbage cuid — the fail-closed contract is unchanged', async () => {
    const report = await preflight(GHOST_CUID)

    expect(report.dropped).toHaveLength(1)
    expect(report.allConditionsDropped).toBe(true)
    expect(report.message).toContain('do NOT match')
    expect(report.validationErrors).toEqual([`Group 1: Unknown field: ${GHOST_CUID}`])
  })

  it.each([
    ['a merged-field cuid', TAGS_CUID],
    ['a prefixed merged-field cuid', `${ARTICLE_DEF_ID}:${STATUS_CUID}`],
    ['an already-static key', 'status'],
    ['a garbage cuid', GHOST_CUID],
    ['a prefixed garbage cuid', `${ARTICLE_DEF_ID}:${GHOST_CUID}`],
    ['a relationship path head', [TAGS_CUID, 'tag:name']],
  ])('reports exactly what the query lane drops for %s', async (_label, fieldId) => {
    const report = await preflight(fieldId)
    const { db } = fakeDb(ids('a0'))
    const listed = await querySystemResourceIdsPaged({
      ...systemBase,
      db,
      filters: articleFilter(fieldId) as never,
    })

    // The invariant, stated directly: same inputs, same verdict. Refusing is
    // allowed; refusing where the list would have filtered correctly is not.
    expect(report.dropped).toHaveLength(listed.droppedConditionCount ?? 0)
    expect(Boolean(report.message)).toBe(Boolean(listed.droppedConditions))
  })
})
