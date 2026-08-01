// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/find-condition-resolution.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ConditionGroup } from '../../../../conditions/types'
import { buildConditionGroupsQueryWithDiagnostics } from '../../../../mail-query/condition-query-builder'
import { canonicalizeSystemConditions } from '../../../../resources/query-builder/canonicalize-system-fields'
import { ConditionQueryBuilder } from '../../../../resources/query-builder/condition-query-builder'
import type { ResourceField } from '../../../../resources/registry/field-types'
import { createChainableDatabaseMock } from '../../../../test/database-mock'
import type { ExecutionContextManager } from '../../../core/execution-context'
import type { NodeExecutionResult, PreprocessedNodeData, WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { FindProcessor } from '../find'

/**
 * Pins the Find node's *field resolution*: that a condition the panel can build
 * either reaches the query builder in a form the builder resolves, or fails the
 * node — never widens it silently.
 *
 * The regression these exist for is the thread lane. `THREAD_FIELDS` declares
 * ten `filterable: true` fields the mail builder has no case for, so before
 * this change "Find Many Threads where Visit City is Berlin" returned *every
 * thread in the org's shared inboxes* — the dropped condition left the bare
 * base scope behind, and `limit` is optional.
 *
 * **Non-vacuity** (re-run this if you extend the file — an assertion that a ref
 * was *forwarded* passes even when it still fails to resolve). Each fix was
 * neutralized in turn and the expected tests went red:
 *
 * | neutralized | red |
 * |---|---|
 * | canonicalizer off in `executeNode` | 5 — every cuid case |
 * | drop-throws removed from both lanes | 6 — every `visit*`/`messages` case |
 * | `tags` case removed from the mail dispatcher | 2 |
 * | fold operator hard-coded to `AND` | 1 |
 *
 * The tests that survive all four are **controls**, and are named as such
 * below: they assert refs that must keep working unchanged, and the
 * system-lane "unresolvable reference" pair, which is caught by
 * `validateConditionValues` before the builder ever runs.
 */

// ── mocks ────────────────────────────────────────────────────────────────────

const { threadSelect } = vi.hoisted(() => ({ threadSelect: vi.fn() }))

/**
 * `@auxx/database`'s `schema` is a Proxy of empty objects under this package's
 * Vitest setup, so column-level SQL renders as nothing
 * (`project_drizzle_columns_undefined_in_vitest`). Pin the four tables these
 * assertions read through `createSchemaMock`, which keeps the auto-vivifying
 * proxy for every other table in the import graph — the same arrangement
 * `system-condition-builder.test.ts` uses.
 */
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../../test/database-mock'
  )
  const { integer, pgTable, text, timestamp } = await import('drizzle-orm/pg-core')

  // Several modules in this import graph build prepared statements at module
  // scope (`db.select().from(…).where(…).prepare(…)`), so `select` must be
  // chainable before any test runs.
  threadSelect.mockImplementation(() => createChainableDatabaseMock())

  return {
    // `select` is the one method these tests drive (the thread lane awaits its
    // `$dynamic()` chain directly); everything else keeps the chainable stub.
    database: new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'select') return threadSelect
        return createChainableDatabaseMock()
      },
    }),
    schema: createSchemaMock({
      Message: pgTable('Message', {
        id: text('id').primaryKey(),
        subject: text('subject'),
        organizationId: text('organizationId'),
      }),
      Thread: pgTable('Thread', {
        id: text('id').primaryKey(),
        subject: text('subject'),
        status: text('status'),
        inboxId: text('inboxId'),
        organizationId: text('organizationId'),
        mergedIntoThreadId: text('mergedIntoThreadId'),
        messageCount: integer('messageCount'),
        lastMessageAt: timestamp('lastMessageAt'),
      }),
      FieldValue: pgTable('FieldValue', {
        id: text('id').primaryKey(),
        fieldId: text('fieldId'),
        entityId: text('entityId'),
        relatedEntityId: text('relatedEntityId'),
        valueText: text('valueText'),
      }),
      CustomField: pgTable('CustomField', {
        id: text('id').primaryKey(),
        systemAttribute: text('systemAttribute'),
      }),
    }),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

/**
 * Merged fields as `mergeSystemAndCustomFields` emits them: a materialized
 * system field keeps the static `key` and carries the org's `CustomField.id`
 * as `id`. The filter UIs address the field by that cuid, which is the half of
 * this plan that is preventive — zero rows on the dev DB today.
 */
const mergedField = (id: string, key: string, systemAttribute: string) =>
  ({ id, key, systemAttribute }) as unknown as ResourceField

const MESSAGE_SUBJECT_CUID = 'msgsubjectcuidaaaaaaaaaa'
const THREAD_TAGS_CUID = 'thrtagscuidaaaaaaaaaaaaa'
const THREAD_STATUS_CUID = 'thrstatuscuidaaaaaaaaaaa'

const RESOURCES: Record<string, { plural: string; label: string; fields: ResourceField[] }> = {
  message: {
    plural: 'Messages',
    label: 'Message',
    fields: [mergedField(MESSAGE_SUBJECT_CUID, 'subject', 'message_subject')],
  },
  thread: {
    plural: 'Threads',
    label: 'Thread',
    fields: [
      mergedField(THREAD_TAGS_CUID, 'tags', 'thread_tags'),
      mergedField(THREAD_STATUS_CUID, 'status', 'thread_status'),
    ],
  },
}

vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_organizationId: string, resourceType: string) => {
    const resource = RESOURCES[resourceType]
    return resource ? { id: resourceType, ...resource } : null
  }),
}))

/** Configured automation: full on org inboxes, zero access to personal ones. */
vi.mock('../../../../permissions/visibility/automation-visibility', () => ({
  getAutomationVisibility: vi.fn(async () => ({
    kind: 'automation' as const,
    personalInboxIds: {},
  })),
}))

const { executeResourceQuery } = vi.hoisted(() => ({
  executeResourceQuery: vi.fn(async () => [] as unknown[]),
}))

vi.mock('../../../../resources/resource-fetcher', () => ({ executeResourceQuery }))

// ── harness ──────────────────────────────────────────────────────────────────

/** `executeNode` is the unit under test; `execute` wraps it in variable plumbing. */
class TestableFindProcessor extends FindProcessor {
  runNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    return this.executeNode(node, contextManager, preprocessedData)
  }
}

const dialect = new PgDialect()
const render = (clause: unknown) =>
  clause === undefined ? undefined : dialect.sqlToQuery(clause as never).sql

const condition = (fieldId: string, operator = 'is', value: unknown = 'x'): Condition =>
  ({ id: `cond-${fieldId}`, fieldId, operator, value }) as Condition

const group = (conditions: Condition[]): ConditionGroup[] => [
  { id: 'g1', logicalOperator: 'AND', conditions },
]

const findNode = (resourceType: string): WorkflowNode =>
  ({
    id: 'find_1',
    workflowId: 'workflow_1',
    nodeId: 'find_1',
    name: 'Find',
    type: WorkflowNodeType.FIND,
    data: { id: 'find_1', type: WorkflowNodeType.FIND, title: 'Find', resourceType },
    metadata: { position: { x: 0, y: 0 } },
  }) as unknown as WorkflowNode

const contextManager = () =>
  ({
    getContext: () => ({ organizationId: 'org_1', userId: 'user_1' }),
    getVariable: vi.fn(),
    setNodeVariable: vi.fn(),
    cacheRecordBase: vi.fn(),
    log: vi.fn(),
  }) as unknown as ExecutionContextManager

/** Thread rows come back through a `$dynamic()` chain the node awaits directly. */
let capturedThreadWhere: unknown
function stubThreadSelect(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    $dynamic: () => chain,
    where: (clause: unknown) => {
      capturedThreadWhere = clause
      return chain
    },
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    // biome-ignore lint/suspicious/noThenProperty: `findMany` awaits the drizzle chain itself (`const rows = await q`), so the stub has to be thenable to stand in for it.
    then: (onFulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onFulfilled),
  })
  threadSelect.mockReturnValue({ from: () => chain })
}

/** Configured automation viewer, matching the mocked `getAutomationVisibility`. */
const AUTOMATION_VIEWER = { kind: 'automation' as const, personalInboxIds: {} }

/**
 * The clause a fully-dropped thread filter collapses to — the viewer's whole
 * visible mailbox. Any built condition must render to something else; that
 * comparison is what tells "filtered" from "silently widened" apart, and it
 * holds whether or not a column name renders.
 */
const threadBaseScopeSql = () =>
  render(buildConditionGroupsQueryWithDiagnostics([], 'org_1', AUTOMATION_VIEWER).sql)

interface RunOptions {
  conditions?: Condition[]
  conditionGroups?: ConditionGroup[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  findMode?: 'findOne' | 'findMany'
}

async function run(resourceType: string, options: RunOptions = {}) {
  const processor = new TestableFindProcessor()
  return processor.runNode(findNode(resourceType), contextManager(), {
    inputs: {
      resourceType,
      findMode: options.findMode ?? 'findMany',
      conditions: options.conditions ?? [],
      conditionGroups: options.conditionGroups ?? [],
      orderBy: options.orderBy,
      limit: undefined,
    },
    metadata: {},
  } as unknown as PreprocessedNodeData)
}

/** The query the system lane handed to the resource fetcher. */
const systemQuery = () =>
  (executeResourceQuery.mock.calls[0] as unknown[] | undefined)?.[2] as
    | { where?: unknown; orderBy?: unknown[] }
    | undefined

const systemWhere = () => render(systemQuery()?.where)

beforeEach(() => {
  executeResourceQuery.mockClear()
  threadSelect.mockReset()
  threadSelect.mockImplementation(() => createChainableDatabaseMock())
  capturedThreadWhere = undefined
})

// ── system lane ──────────────────────────────────────────────────────────────

describe('system lane — cuid field references', () => {
  it('resolves a bare cuid to the static key and narrows the query', async () => {
    const result = await run('message', {
      conditionGroups: group([condition(MESSAGE_SUBJECT_CUID, 'is', 'Refunds')]),
    })

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    // The claim is *resolution*, not forwarding: an unresolved ref produces no
    // clause at all, so the column has to appear.
    expect(systemWhere()).toContain('"subject"')
  })

  it('resolves a `<resourceType>:<cuid>` reference identically', async () => {
    const bare = await run('message', {
      conditionGroups: group([condition(MESSAGE_SUBJECT_CUID, 'is', 'Refunds')]),
    })
    const bareSql = systemWhere()

    executeResourceQuery.mockClear()
    const prefixed = await run('message', {
      conditionGroups: group([condition(`message:${MESSAGE_SUBJECT_CUID}`, 'is', 'Refunds')]),
    })

    expect(bare.status).toBe(NodeRunningStatus.Succeeded)
    expect(prefixed.status).toBe(NodeRunningStatus.Succeeded)
    expect(systemWhere()).toBe(bareSql)
  })

  // CONTROL. On a system resource an unresolvable reference is refused by
  // `validateConditionValues`, which runs on the canonical groups *before* the
  // builder — so this pins the preflight guard, not the drop guard. It survives
  // every neutralization by design; the drop guard is pinned on the thread lane,
  // which is where a ref can pass preflight and still fail to build.
  it('fails the node on an unresolvable reference, naming it', async () => {
    const result = await run('message', {
      conditionGroups: group([condition('notAFieldAtAll')]),
    })

    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.error).toContain('Unknown field: notAFieldAtAll')
    expect(executeResourceQuery).not.toHaveBeenCalled()
  })

  // CONTROL, same path as above.
  it('never leaks builder internals into the run log', async () => {
    const result = await run('thread', {
      conditionGroups: group([condition('thread:visitCity', 'is', 'Berlin')]),
    })

    // #1475 pins that the builders' internal `detail` never reaches a
    // user-visible payload, and a workflow run log is user-visible.
    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.error).toContain('visitCity')
    expect(result.error).not.toContain('SystemConditionBuilder')
  })
})

// ── thread lane ──────────────────────────────────────────────────────────────

describe('thread lane — the mail builder vocabulary gap', () => {
  it('builds `tags`, the key THREAD_FIELDS declares', async () => {
    stubThreadSelect([{ id: 'thread_1' }])

    const result = await run('thread', {
      conditionGroups: group([condition('thread:tags', 'is', 'tag_refunds')]),
    })

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    // A dropped condition would leave the bare base scope; the tag subquery is
    // what tells the two apart.
    expect(render(capturedThreadWhere)).not.toBe(threadBaseScopeSql())
    expect(render(capturedThreadWhere)).toContain('"FieldValue"')
  })

  it('resolves a cuid-addressed `tags` to the same clause', async () => {
    stubThreadSelect([{ id: 'thread_1' }])
    await run('thread', { conditionGroups: group([condition('thread:tags', 'is', 'tag_refunds')]) })
    const byKey = render(capturedThreadWhere)

    stubThreadSelect([{ id: 'thread_1' }])
    const result = await run('thread', {
      conditionGroups: group([condition(THREAD_TAGS_CUID, 'is', 'tag_refunds')]),
    })

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(render(capturedThreadWhere)).toBe(byKey)
  })

  it.each([
    'visitCity',
    'visitIp',
    'visitCountry',
    'messages',
  ])('fails the node on `%s` instead of returning the whole mailbox', async (fieldKey) => {
    stubThreadSelect([{ id: 'thread_1' }, { id: 'thread_2' }])

    const result = await run('thread', {
      conditionGroups: group([condition(`thread:${fieldKey}`, 'is', 'Berlin')]),
    })

    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.error).toContain(fieldKey)
    expect(result.output).toBeUndefined()
  })

  it('fails on a partial drop, not only when every condition is dropped', async () => {
    stubThreadSelect([{ id: 'thread_1' }])

    const result = await run('thread', {
      conditionGroups: group([
        condition('thread:status', 'is', 'OPEN'),
        condition('thread:visitCity', 'is', 'Berlin'),
      ]),
    })

    // A partial drop widens an AND group and narrows an OR group — there is no
    // reading under which the node did what it was configured to do, and this
    // node has no channel to report a partial drop mid-run.
    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.error).toContain('visitCity')
  })
})

// ── preflight ≡ build ────────────────────────────────────────────────────────

/**
 * The invariant is the *agreement*, not either side's verdict: a reference the
 * node's own `validateConditionValues` accepts must be one the builder can
 * build, and vice versa. This node had exactly the divergence #1478 had to
 * close for `inspectFilterConditions`.
 */
describe('preflight and build agree', () => {
  const systemRefs = ['message:subject', MESSAGE_SUBJECT_CUID, 'notAFieldAtAll', 'message:id']

  it.each(systemRefs)('system lane: `%s`', async (fieldRef) => {
    const groups = group([condition(fieldRef, 'is', 'value')])
    const nodeSucceeded = (await run('message', { conditionGroups: groups })).status === 'succeeded'

    const built = ConditionQueryBuilder.buildGroupedQueryWithDiagnostics(
      canonicalizeSystemConditions(groups, 'message', RESOURCES.message!.fields),
      'message'
    )

    expect(nodeSucceeded).toBe(built.droppedConditions.length === 0)
  })

  const threadRefs = ['thread:status', 'thread:tags', THREAD_TAGS_CUID, 'thread:visitCity']

  it.each(threadRefs)('thread lane: `%s`', async (fieldRef) => {
    stubThreadSelect([])
    const groups = group([condition(fieldRef, 'is', 'OPEN')])
    const nodeSucceeded = (await run('thread', { conditionGroups: groups })).status === 'succeeded'

    const canonical = canonicalizeSystemConditions(groups, 'thread', RESOURCES.thread!.fields)
    const built = buildConditionGroupsQueryWithDiagnostics(
      canonical.map((g) => ({
        ...g,
        conditions: g.conditions.map((c) => ({
          ...c,
          fieldId: String(c.fieldId).includes(':')
            ? String(c.fieldId).split(':').slice(1).join(':')
            : String(c.fieldId),
        })),
      })) as ConditionGroup[],
      'org_1',
      AUTOMATION_VIEWER
    )

    expect(nodeSucceeded).toBe(built.droppedConditions.length === 0)
  })
})

// ── the flat-conditions fold ─────────────────────────────────────────────────

describe('flat conditions fold into one group', () => {
  it('produces the same SQL as the equivalent single AND group', async () => {
    const conditions = [
      condition('message:subject', 'is', 'Refunds'),
      condition('message:id', 'is', 'message_1'),
    ]

    await run('message', { conditions })
    const flatSql = systemWhere()

    executeResourceQuery.mockClear()
    await run('message', { conditionGroups: group(conditions) })

    expect(flatSql).toBeDefined()
    expect(systemWhere()).toBe(flatSql)
  })

  it('carries an OR across the fold', async () => {
    const conditions = [
      condition('message:subject', 'is', 'Refunds'),
      { ...condition('message:id', 'is', 'message_1'), logicalOperator: 'OR' as const },
    ]

    await run('message', { conditions })

    // `BaseConditionBuilder.deriveFlatOperator` reads the operator off
    // conditions *after the first*; folding to a hard-coded AND would silently
    // change which rows come back.
    expect(systemWhere()).toContain(' or ')
  })

  it('lets groups win over flat conditions, as validateNodeConfig warns', async () => {
    await run('message', {
      conditions: [condition('notAFieldAtAll')],
      conditionGroups: group([condition('message:subject', 'is', 'Refunds')]),
    })

    expect(systemWhere()).toContain('"subject"')
  })
})

// ── orderBy ──────────────────────────────────────────────────────────────────

describe('orderBy resolution', () => {
  it('sorts by a cuid-addressed field', async () => {
    await run('message', {
      orderBy: { field: MESSAGE_SUBJECT_CUID, direction: 'desc' },
    })

    expect(systemQuery()?.orderBy).toBeDefined()
    expect(render(systemQuery()?.orderBy?.[0])).toContain('"subject"')
  })

  it('no-ops on an unresolvable sort without failing the node', async () => {
    const result = await run('message', {
      orderBy: { field: 'notAFieldAtAll', direction: 'desc' },
    })

    // Carried forward from #1478: sort is deliberately not a reporting channel.
    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(systemQuery()?.orderBy).toBeUndefined()
  })
})
