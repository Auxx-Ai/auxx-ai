// apps/web/src/app/api/workflows/shared/[shareToken]/run/public-share-run-accounting.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The public-share door and the `workflowRuns` meter.
 *
 * This route used to hand-insert its own `WorkflowRun` row, duplicating the
 * sequence-number query, the node count and the system-user resolution that
 * `createWorkflowRun` already owns — and skipping the one thing only
 * `createWorkflowRun` does: consume `workflowRuns` quota. So a public share
 * link executed production workflows (AI nodes, HTTP calls, CRUD writes) for
 * free, forever. Same class as the webhook hole #1774 closed, but this door is
 * the one anonymous end users are *meant* to reach: the only thing in front of
 * it is `checkWorkflowRateLimit`, whose config is author-set and may be null.
 *
 * What is asserted here is that the route goes through the shared door and
 * hands it the two things that door could not previously express — the
 * `PUBLIC_SHARE` source and the `endUserId`. That the door itself meters and
 * writes those columns is asserted against the real `createWorkflowRun` in
 * `packages/lib/src/jobs/workflow/scheduled-trigger-job.test.ts`.
 */

const { findFirst, createWorkflowRun, incrementEndUserRunCount, updateSet, subscribe } = vi.hoisted(
  () => ({
    findFirst: vi.fn(),
    createWorkflowRun: vi.fn(),
    incrementEndUserRunCount: vi.fn(async () => undefined),
    updateSet: vi.fn(),
    subscribe: vi.fn(async () => 'handler_1'),
  })
)

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: {
      query: { WorkflowApp: { findFirst } },
      update: () => ({
        set: (values: unknown) => {
          updateSet(values)
          return { where: async () => undefined }
        },
      }),
    },
  })
)
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('@auxx/lib/workflows', () => ({ createWorkflowRun }))
vi.mock('@auxx/lib/utils/rate-limiter', () => ({
  getApiRateLimiter: () => ({
    getAvailableTokens: async () => 10,
    acquire: async () => undefined,
  }),
  getClientIp: () => '203.0.113.7',
}))
vi.mock('@auxx/lib/workflow-engine', () => ({
  checkWorkflowRateLimit: async () => ({ isOk: () => true, value: { isLimited: false } }),
  validateFormInputs: () => ({ valid: true, errors: [] }),
  safeJsonStringify: (value: unknown) => JSON.stringify(value),
  RedisWorkflowExecutionReporter: class {
    constructor(readonly workflowRunId: string) {}
  },
  WorkflowEngine: class {
    getNodeRegistry() {
      return { initializeWithDefaults: async () => undefined }
    }
    executeWorkflow = vi.fn(async () => ({ status: 'completed', context: { variables: {} } }))
  },
  WorkflowEventType: { RUN_CREATED: 'run-created', ERROR: 'error' },
  WorkflowExecutionStatus: { COMPLETED: 'completed' },
  WorkflowPausedException: class extends Error {},
  WorkflowTriggerType: { MANUAL: 'manual' },
}))
vi.mock('@auxx/redis', () => ({
  RedisEventRouter: {
    getInstance: () => ({
      subscribeToWorkflowEvents: subscribe,
      unsubscribe: async () => undefined,
    }),
  },
}))
vi.mock('@auxx/services/workflow-share', () => ({
  verifyWorkflowPassport: async () => ({
    isErr: () => false,
    value: { shareToken: SHARE_TOKEN, endUserId: END_USER_ID },
  }),
  getSharedWorkflowByToken: async () => ({
    isErr: () => false,
    value: {
      id: APP_ID,
      organizationId: ORG_ID,
      rateLimit: null,
      config: {},
    },
  }),
  incrementEndUserRunCount,
}))

const SHARE_TOKEN = 'shr_token00000000000000'
const END_USER_ID = 'eus_cuid00000000000000000'
const APP_ID = 'wfa_cuid00000000000000000'
const ORG_ID = 'org_cuid000000000000000000000'
const RUN_ID = 'wfr_cuid00000000000000000'

const { UsageLimitError } = await import('@auxx/lib/errors')
const { WorkflowTriggerSource } = await import('@auxx/database/enums')
const { POST } = await import('./route')

const publishedWorkflow = {
  id: 'wfv_published000000000000',
  workflowAppId: APP_ID,
  triggerType: 'form',
  version: 4,
  graph: { nodes: [{ id: 'n1', data: { type: 'start' } }], edges: [] },
}

const request = (inputs: Record<string, unknown> = { name: 'ada' }) =>
  new Request(`http://localhost/api/workflows/shared/${SHARE_TOKEN}/run`, {
    method: 'POST',
    headers: { authorization: 'Bearer passport', 'content-type': 'application/json' },
    body: JSON.stringify({ inputs }),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest shape is not needed here
  }) as any

const params = { params: Promise.resolve({ shareToken: SHARE_TOKEN }) }

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue({ id: APP_ID, totalRuns: 3, publishedWorkflow })
  createWorkflowRun.mockResolvedValue({
    id: RUN_ID,
    status: 'running',
    sequenceNumber: 4,
    createdBy: 'usr_org_system0000000000',
    createdAt: new Date(),
  })
  subscribe.mockResolvedValue('handler_1')
})

describe('a public-share run goes through the metered door', () => {
  it('creates it with `createWorkflowRun`, as a headless production run', async () => {
    await POST(request(), params)

    expect(createWorkflowRun).toHaveBeenCalledTimes(1)
    expect(createWorkflowRun.mock.calls[0]?.[1]).toMatchObject({
      workflow: publishedWorkflow,
      organizationId: ORG_ID,
      mode: 'production',
      // An anonymous visitor is not a `User` — the door resolves the org system
      // user for `createdBy`, and a placeholder id here would break that FK.
      userId: null,
      triggeredFrom: WorkflowTriggerSource.PUBLIC_SHARE,
      // The column the hand-insert existed for.
      endUserId: END_USER_ID,
    })
  })

  it('passes the submitted inputs as the run inputs', async () => {
    await POST(request({ email: 'ada@example.com' }), params)

    expect(createWorkflowRun.mock.calls[0]?.[1]).toMatchObject({
      inputs: { email: 'ada@example.com' },
    })
  })

  it('counts the run against the end user and the app once created', async () => {
    const res = await POST(request(), params)

    expect(res.headers.get('X-Run-Id')).toBe(RUN_ID)
    expect(incrementEndUserRunCount).toHaveBeenCalledWith({ endUserId: END_USER_ID })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ totalRuns: 4 }))
  })
})

describe('an org over its plan limit', () => {
  beforeEach(() => {
    createWorkflowRun.mockRejectedValue(
      new UsageLimitError({ metric: 'workflowRuns', current: 10, limit: 10 })
    )
  })

  it('is refused with 503, and no counter moves', async () => {
    const res = await POST(request(), params)

    expect(res.status).toBe(503)
    expect(incrementEndUserRunCount).not.toHaveBeenCalled()
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('tells the visitor nothing about the org’s plan', async () => {
    const res = await POST(request(), params)
    const body = (await res.json()) as { error: string }

    // The caller is a stranger on the internet, not the org. The real metric,
    // current and limit go to the log; the page gets a neutral sentence.
    expect(body.error).not.toMatch(/limit|upgrade|plan|quota/i)
    expect(body.error).toMatch(/unavailable/i)
  })

  it('does not swallow a real failure as a refusal', async () => {
    createWorkflowRun.mockRejectedValue(new Error('database is on fire'))

    await expect(POST(request(), params)).rejects.toThrow('database is on fire')
  })
})
