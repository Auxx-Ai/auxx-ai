// packages/lib/src/jobs/workflow/scheduled-trigger-job.test.ts
// Regression guard for the FK that used to drop every scheduled run of a workflow
// whose author had been offboarded.
//
// `WorkflowApp.createdById` is `ON DELETE SET NULL`, so deleting a workflow's author
// nulls it. This job used to paper over that with `workflowApp.createdById || 'system'`.
// `'system'` is truthy, so `createWorkflowRun`'s own
// `userId || getSystemUserForActions(orgId)` fallback never fired, and the literal
// landed in `WorkflowRun.createdBy` — itself an FK to `User.id`, with no `'system'`
// row to point at. The insert 23503'd and the run was never created.
//
// The assertion is therefore on the value that reaches the INSERT, not on what the
// job hands to `createRun`: the whole point is that no layer between the two invents
// an id. `createWorkflowRun` runs for real here; only the engine, the queue-side
// reporter and the two collaborators that would need a live database
// (`SystemUserService`, the usage guard) are faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const APP = 'app_1'
const WORKFLOW = 'wf_1'
const NODE = 'node_1'
const AUTHOR = 'user_alice'
/** What `SystemUserService.getSystemUserForActions` resolves to for {@link ORG}. */
const SYSTEM_USER = 'user_org_system'

/** A column reference as the local `@auxx/database` mock materialises it. */
interface ColumnMarker {
  table: string
  column: string
}

/**
 * One `db` response, in call order. `from` is asserted rather than assumed so a
 * reordered/extra query surfaces as a failure instead of silently reusing rows.
 */
interface Response {
  from: string
  rows: unknown[]
}

/** What the fake `db` recorded about the single `INSERT` the run creation issued. */
interface InsertSpy {
  into?: string
  values?: Record<string, unknown>
}

const insertSpy: InsertSpy = {}
let responses: Response[] = []
let workflowRow: Record<string, unknown> | undefined

const getSystemUserForActions = vi.fn(async (_orgId: string) => SYSTEM_USER)

vi.mock('@auxx/database', () => {
  const tables = new Map<string, Record<string, ColumnMarker>>()
  const table = (name: string) => {
    let columns = tables.get(name)
    if (!columns) {
      columns = new Proxy({} as Record<string, ColumnMarker>, {
        get: (_t, column: string) =>
          column === '__table' ? name : ({ table: name, column } satisfies ColumnMarker),
      })
      tables.set(name, columns)
    }
    return columns
  }

  /**
   * A select builder answering from {@link responses}. Every read under test ends
   * at `.limit(n)`, so that is where it resolves — no thenable needed.
   */
  const selectChain = () => {
    let from = ''
    const chain: Record<string, unknown> = {
      from: (t: { __table: string }) => {
        from = t.__table
        return chain
      },
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => {
        const next = responses.shift()
        if (!next) throw new Error(`unexpected db.select from ${from}`)
        if (next.from !== from) {
          throw new Error(`expected db.select from ${next.from}, got ${from}`)
        }
        return next.rows
      },
    }
    return chain
  }

  const database = {
    select: () => selectChain(),
    insert: (t: { __table: string }) => ({
      values: (values: Record<string, unknown>) => {
        insertSpy.into = t.__table
        insertSpy.values = values
        return {
          returning: async () => [{ id: 'run_1', ...values }],
        }
      },
    }),
    query: {
      Workflow: { findFirst: async () => workflowRow },
    },
  }

  return { database, schema: new Proxy({}, { get: (_t, name: string) => table(name) }) }
})

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => ({ __eq: [left, right] }),
    and: (...args: unknown[]) => ({ __and: args }),
    desc: (col: unknown) => ({ __desc: col }),
  }
})

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions },
}))

/**
 * The guard needs a live database, so it is faked. `null` is the real fail-open
 * shape (Redis unavailable) and is the default for every test here that is not
 * about metering; the metering tests swap in a stub for the call they assert on.
 */
const consume = vi.fn(async () => ({ allowed: true, current: 1, limit: 10 }))
let usageGuard: { consume: typeof consume } | null = null
vi.mock('../../usage/create-usage-guard', () => ({ createUsageGuard: async () => usageGuard }))

vi.mock('../../workflow-engine', () => ({
  RedisWorkflowExecutionReporter: class {
    constructor(readonly runId: string) {}
  },
}))

vi.mock('../../workflow-engine/core/workflow-engine', () => ({
  WorkflowEngine: class {
    getNodeRegistry() {
      return { initializeWithDefaults: async () => {} }
    }
  },
}))

vi.mock('../../workflows/scheduled-trigger-service', () => ({
  ScheduledTriggerService: class {
    unscheduleWorkflowTriggers = vi.fn()
  },
}))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const { WorkflowExecutionService } = await import('../../workflows/workflow-execution-service')
const { executeScheduledTrigger } = await import('./scheduled-trigger-job')

const graph = {
  nodes: [{ id: NODE, type: 'scheduled', data: { type: 'scheduled', isEnabled: true } }],
  edges: [],
}

/** Queue the three reads the happy path makes, for a workflow authored by `createdById`. */
function arrangeHappyPath(createdById: string | null) {
  workflowRow = {
    id: WORKFLOW,
    workflowAppId: APP,
    organizationId: ORG,
    triggerType: 'scheduled',
    version: 3,
    graph,
  }
  responses = [
    // 1. existence probe
    { from: 'WorkflowApp', rows: [{ id: APP, enabled: true }] },
    // 2. published + enabled join
    {
      from: 'WorkflowApp',
      rows: [
        {
          workflowApp: { id: APP, organizationId: ORG, createdById },
          publishedWorkflow: { id: WORKFLOW, graph },
          organization: { name: 'Acme' },
        },
      ],
    },
    // 3. last sequence number, inside createWorkflowRun
    { from: 'WorkflowRun', rows: [{ sequenceNumber: 7 }] },
  ]
}

function ctx() {
  const data = {
    workflowAppId: APP,
    organizationId: ORG,
    nodeId: NODE,
    triggerConfig: { cron: '0 * * * *' } as never,
  }
  return { throwIfCancelled: () => {}, data, job: { id: 'job_1', data } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  getSystemUserForActions.mockResolvedValue(SYSTEM_USER)
  vi.spyOn(WorkflowExecutionService.prototype, 'executeWorkflowAsync').mockResolvedValue(undefined)
  insertSpy.into = undefined
  insertSpy.values = undefined
})

describe('executeScheduledTrigger — WorkflowRun.createdBy', () => {
  it('stores the resolved org system user when the workflow author was deleted', async () => {
    arrangeHappyPath(null)

    const result = await executeScheduledTrigger(ctx())

    // The run exists at all — the FK violation used to abort the whole job.
    expect(result).toMatchObject({ success: true, workflowRunId: 'run_1' })
    expect(insertSpy.into).toBe('WorkflowRun')
    // A real `User.id`, resolved for THIS org — not a literal, not null, not absent.
    expect(getSystemUserForActions).toHaveBeenCalledWith(ORG)
    expect(insertSpy.values?.createdBy).toBe(SYSTEM_USER)
  })

  it('never substitutes a placeholder id for the absent author', async () => {
    arrangeHappyPath(null)
    // A distinct id per org proves the value is resolved, not a constant that
    // happens to equal the fixture.
    getSystemUserForActions.mockResolvedValue('user_other_org_system')

    await executeScheduledTrigger(ctx())

    expect(insertSpy.values?.createdBy).toBe('user_other_org_system')
    expect(insertSpy.values?.createdBy).not.toBe('system')
  })

  it('passes a surviving author through verbatim, resolving nothing', async () => {
    arrangeHappyPath(AUTHOR)

    await executeScheduledTrigger(ctx())

    expect(insertSpy.values?.createdBy).toBe(AUTHOR)
    // The org system user is a fallback, not an override.
    expect(getSystemUserForActions).not.toHaveBeenCalled()
  })

  it('creates the run against the published workflow either way', async () => {
    arrangeHappyPath(null)

    await executeScheduledTrigger(ctx())

    expect(insertSpy.values).toMatchObject({
      organizationId: ORG,
      workflowAppId: APP,
      workflowId: WORKFLOW,
      sequenceNumber: 8,
      type: 'scheduled',
    })
  })
})

describe('createWorkflowRun — the sink that owns the resolution', () => {
  const workflow = {
    id: WORKFLOW,
    workflowAppId: APP,
    triggerType: 'scheduled' as string | null,
    version: 3,
    graph,
  }

  async function create(
    userId: string | null | undefined,
    extra: { endUserId?: string | null } = {}
  ) {
    const { createWorkflowRun } = await import('../../workflows/workflow-execution-service')
    const { database } = await import('@auxx/database')
    responses = [{ from: 'WorkflowRun', rows: [] }]
    return createWorkflowRun(database as never, {
      workflow,
      organizationId: ORG,
      inputs: {},
      mode: 'production',
      userId,
      ...extra,
    })
  }

  beforeEach(() => {
    usageGuard = null
    consume.mockClear()
    consume.mockResolvedValue({ allowed: true, current: 1, limit: 10 })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('accepts %s as a legal "no acting user" and resolves the org system user', async (_l, id) => {
    await create(id as null | undefined)

    expect(getSystemUserForActions).toHaveBeenCalledWith(ORG)
    expect(insertSpy.values?.createdBy).toBe(SYSTEM_USER)
  })

  it('does not resolve anything when an acting user is supplied', async () => {
    await create(AUTHOR)

    expect(insertSpy.values?.createdBy).toBe(AUTHOR)
    expect(getSystemUserForActions).not.toHaveBeenCalled()
  })

  /**
   * `endUserId` is an FK to `EndUser.id`, not `User.id`, and exists for exactly
   * one door: a public share link. The public-share route used to hand-insert
   * its own row *because* this parameter did not exist — which is how that door
   * skipped the metering below. Every other door must keep writing `null`.
   */
  describe('endUserId', () => {
    it('is null when the caller does not pass one', async () => {
      await create(AUTHOR)

      expect(insertSpy.values?.endUserId).toBeNull()
    })

    it('is written through for a public-share run', async () => {
      await create(null, { endUserId: 'eus_1' })

      expect(insertSpy.values?.endUserId).toBe('eus_1')
      // Still the system user — an end user is not a `User`.
      expect(insertSpy.values?.createdBy).toBe(SYSTEM_USER)
    })
  })

  /**
   * The metering every production door inherits by coming through here. This is
   * the whole reason a door may not hand-insert its own `WorkflowRun`.
   */
  describe('the usage guard', () => {
    it('consumes one `workflowRuns` before inserting', async () => {
      usageGuard = { consume }

      await create(AUTHOR)

      expect(consume).toHaveBeenCalledWith(ORG, 'workflowRuns', { userId: AUTHOR })
      expect(insertSpy.values).toBeDefined()
    })

    it('refuses over the limit — UsageLimitError, and no row', async () => {
      usageGuard = { consume }
      consume.mockResolvedValue({ allowed: false, current: 10, limit: 10 })
      const { UsageLimitError } = await import('../../errors')

      await expect(create(AUTHOR)).rejects.toBeInstanceOf(UsageLimitError)
      expect(insertSpy.values).toBeUndefined()
    })

    it('meters an anonymous public-share run against the org, with no user', async () => {
      usageGuard = { consume }

      await create(null, { endUserId: 'eus_1' })

      expect(consume).toHaveBeenCalledWith(ORG, 'workflowRuns', { userId: undefined })
    })
  })
})
