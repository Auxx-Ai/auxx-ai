// apps/web/src/app/api/workflows/[workflowId]/webhook/webhook-draft-test-window.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The anonymous draft-test hole on `/api/workflows/[workflowId]/webhook`.
 *
 * The PRODUCTION path is unauthenticated by design — URL secrecy is the normal
 * webhook contract — and nothing here may change it. `?test=true` is different:
 * it swaps `publishedWorkflow` for `draftWorkflow`, echoes the DRAFT node's
 * configured response, and appends an attacker-controlled entry (headers, query,
 * body) to `webhook:test:<id>:events`, which the author's editor renders live.
 * Before this slice the route contained no secret, token, signature or session
 * check of any kind, so a workflow id was the whole of the authorisation.
 *
 * It is now gated on a TTL'd listening window that an editor arms via
 * `workflow.armWebhookTest` (instance `edit`). Unarmed, the route must behave as
 * if no draft test path existed — including returning the SAME 404 as a missing
 * draft, so it never becomes an oracle for "this workflow id exists".
 *
 * Behavioural: the real handlers are driven, and the REAL
 * `isWebhookTestWindowArmed` runs against a fake Redis. The observed side
 * effects are the draft lookup (`findFirst`), the event-log write (`lpush`), and
 * the response body/status, which is read off whichever graph the route
 * resolved.
 */

const { redis, getRedisClient, findFirst, createRun, executeWorkflowAsync } = vi.hoisted(() => {
  const store = new Map<string, string | string[]>()
  const client = {
    store,
    /** Flip to model an unreachable Redis (the fail-closed case). */
    available: true,
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    lpush: vi.fn(async (key: string, ...values: string[]) => {
      const list = (store.get(key) as string[] | undefined) ?? []
      list.unshift(...values)
      store.set(key, list)
      return list.length
    }),
    ltrim: vi.fn(async () => 'OK'),
    expire: vi.fn(async () => 1),
  }
  return {
    redis: client,
    // Mirrors the real contract: `required` throws, optional hands back undefined.
    getRedisClient: vi.fn(async (required = true) => {
      if (client.available) return client
      if (required) throw new Error('Redis connection required but failed')
      return undefined
    }),
    findFirst: vi.fn(),
    createRun: vi.fn(async () => ({ id: 'wfr_cuid00000000000000000' })),
    executeWorkflowAsync: vi.fn(async () => undefined),
  }
})

vi.mock('@auxx/redis', () => ({ getRedisClient }))
vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: { query: { WorkflowApp: { findFirst } } },
  })
)
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('@auxx/lib/workflow-engine', () => ({
  RedisWorkflowExecutionReporter: class {
    constructor(readonly workflowRunId: string) {}
  },
}))
vi.mock('@auxx/lib/workflows', () => ({
  WorkflowExecutionService: class {
    createRun = createRun
    executeWorkflowAsync = executeWorkflowAsync
  },
}))
vi.mock('@auxx/lib/workflow-engine/types', () => ({
  WorkflowNodeType: { WEBHOOK: 'webhook' },
}))
vi.mock('~/components/workflow/utils/schema-to-variable', () => ({
  validateAgainstSchema: vi.fn(() => true),
}))

const { webhookTestArmKey, webhookTestEventsKey, WEBHOOK_TEST_WINDOW_TTL_SECONDS } = await import(
  '~/server/lib/webhook-test-window'
)
const { UsageLimitError } = await import('@auxx/lib/errors')
const { WorkflowTriggerSource } = await import('@auxx/database/enums')
const { GET, POST } = await import('./route')

const WF_ID = 'wf_cuid0000000000000000000'
const ORG_ID = 'org_cuid000000000000000000000'
const RUN_ID = 'wfr_cuid00000000000000000'

const webhookNode = (method: 'GET' | 'POST', body: string, statusCode: number) => ({
  nodes: [{ id: 'n1', data: { type: 'webhook', method, responseConfig: { body, statusCode } } }],
  edges: [],
})

/**
 * Draft and published carry DIFFERENT response bodies on purpose — the body the
 * route hands back is the proof of which graph it resolved.
 */
const workflowApp = {
  id: WF_ID,
  organizationId: ORG_ID,
  createdById: 'usr_cuid000000000000000000000',
  draftWorkflow: {
    id: 'wfv_draft0000000000000000',
    name: 'Draft',
    version: 2,
    graph: webhookNode('POST', 'DRAFT-BODY', 201),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  publishedWorkflow: {
    id: 'wfv_published000000000000',
    name: 'Published',
    version: 1,
    graph: webhookNode('POST', 'PUBLISHED-BODY', 200),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}

const params = { params: Promise.resolve({ workflowId: WF_ID }) }

function postRequest(test: boolean, body: Record<string, unknown> = { hello: 'world' }) {
  return {
    url: `http://localhost/api/workflows/${WF_ID}/webhook${test ? '?test=true' : ''}`,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as never
}

function getRequest(test: boolean) {
  return {
    url: `http://localhost/api/workflows/${WF_ID}/webhook${test ? '?test=true' : ''}`,
    headers: new Headers(),
  } as never
}

/** What `workflow.armWebhookTest` writes — the real key, the real TTL. */
const arm = (workflowId = WF_ID) => redis.store.set(webhookTestArmKey(workflowId), '1')
/** Model the TTL elapsing: Redis drops the key, nothing else changes. */
const expireWindow = (workflowId = WF_ID) => redis.store.delete(webhookTestArmKey(workflowId))

beforeEach(() => {
  redis.store.clear()
  redis.available = true
  redis.set.mockClear()
  redis.exists.mockClear()
  redis.lpush.mockClear()
  getRedisClient.mockClear()
  createRun.mockClear().mockResolvedValue({ id: RUN_ID })
  executeWorkflowAsync.mockClear().mockResolvedValue(undefined)
  findFirst.mockReset().mockResolvedValue(workflowApp)
})

describe('?test=true without an armed window — the hole', () => {
  it('404s and never resolves the draft', async () => {
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'No draft workflow found' })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('does not pollute the author’s event log', async () => {
    // The other half of the harm: an unarmed caller could push arbitrary
    // headers/query/body into `webhook:test:<id>:events`, which the editor renders.
    await POST(postRequest(true), params)
    expect(redis.lpush).not.toHaveBeenCalled()
    expect(redis.store.has(webhookTestEventsKey(WF_ID))).toBe(false)
  })

  it('is not an oracle — an unknown workflow id answers identically', async () => {
    findFirst.mockResolvedValue(undefined)
    const unknown = await POST(postRequest(true), params)
    findFirst.mockResolvedValue(workflowApp)
    const known = await POST(postRequest(true), params)

    expect(unknown.status).toBe(known.status)
    await expect(unknown.json()).resolves.toEqual(await known.json())
  })

  it('closes the GET path too', async () => {
    const res = await GET(getRequest(true), params)
    expect(res.status).toBe(404)
    expect(findFirst).not.toHaveBeenCalled()
  })
})

describe('?test=true with an armed window', () => {
  it('resolves the DRAFT graph and answers with its configured response', async () => {
    arm()
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(201)
    await expect(res.text()).resolves.toBe('DRAFT-BODY')
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it('captures the event into the author’s log at the shared TTL', async () => {
    arm()
    await POST(postRequest(true), params)
    expect(redis.lpush).toHaveBeenCalledTimes(1)
    expect(redis.lpush.mock.calls[0]?.[0]).toBe(webhookTestEventsKey(WF_ID))
    expect(redis.expire).toHaveBeenCalledWith(
      webhookTestEventsKey(WF_ID),
      WEBHOOK_TEST_WINDOW_TTL_SECONDS
    )
    const captured = JSON.parse((redis.lpush.mock.calls[0]?.[1] as string) ?? '{}')
    expect(captured.body).toEqual({ hello: 'world' })
  })

  it('a window on ANOTHER workflow does not open this one', async () => {
    arm('wf_othercuid0000000000000')
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(404)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('an EXPIRED window behaves exactly like an unarmed one', async () => {
    arm()
    await expect(POST(postRequest(true), params).then((r) => r.status)).resolves.toBe(201)
    expireWindow()
    findFirst.mockClear()
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'No draft workflow found' })
    expect(findFirst).not.toHaveBeenCalled()
  })
})

describe('the PUBLISHED path is unaffected — with and without a window', () => {
  it('executes the published graph with no window armed', async () => {
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('PUBLISHED-BODY')
    expect(executeWorkflowAsync).toHaveBeenCalledTimes(1)
  })

  it('behaves identically while a window IS armed', async () => {
    arm()
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('PUBLISHED-BODY')
    expect(executeWorkflowAsync).toHaveBeenCalledTimes(1)
  })

  it('never consults the arm key when there is no `test` param', async () => {
    // The gate must cost the production path nothing — not even a round trip.
    arm()
    await POST(postRequest(false), params)
    expect(redis.exists).not.toHaveBeenCalled()
  })

  it('a missing published workflow still says so (its own 404 shape is untouched)', async () => {
    findFirst.mockResolvedValue({ ...workflowApp, publishedWorkflow: null })
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'No published workflow found' })
  })

  it('an unknown workflow app still 404s with its own shape on the production path', async () => {
    findFirst.mockResolvedValue(undefined)
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Workflow app not found' })
  })
})

describe('an unavailable Redis fails CLOSED', () => {
  it('refuses the draft path rather than reinstating the hole', async () => {
    redis.available = false
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(404)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('still serves the production path', async () => {
    // Failing closed must not take the real webhook surface down with it.
    redis.available = false
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(200)
    expect(executeWorkflowAsync).toHaveBeenCalledTimes(1)
  })
})

/**
 * The production path used to hand-build a workflow object and call
 * `WorkflowEngine.executeWorkflow` directly. That created NO `WorkflowRun` row,
 * so a webhook execution was invisible: absent from run history, absent from the
 * `workflowRuns` usage counter, and — because a run id is what a paused node
 * resumes against — unresumable. Every other headless trigger (scheduled,
 * resource, message, polling, app) already went through `createRun`; this route
 * was the one door that did not.
 */
describe('a production webhook hit creates a real run', () => {
  /**
   * This replaces the old "hands the engine a payload the graph builder can
   * actually read" assertion. That guarded #1764: the route sent top-level
   * `nodes`/`edges` with no `graph` key, and `WorkflowGraphBuilder.buildGraph`
   * reads `workflow.graph` and nothing else, so the engine built an EMPTY graph.
   * The route no longer builds a payload at all — `createRun` loads the
   * `Workflow` row itself — so the shape is not expressible any more. The
   * builder-side half of that contract still lives in
   * `workflow-graph-builder.test.ts` → "reads the graph off `workflow.graph`".
   */
  it('creates it through `createRun`, as a headless production run', async () => {
    await POST(postRequest(false), params)

    expect(createRun).toHaveBeenCalledTimes(1)
    expect(createRun.mock.calls[0]?.[0]).toMatchObject({
      workflowId: workflowApp.publishedWorkflow.id,
      organizationId: ORG_ID,
      mode: 'production',
      // Headless — an external caller is not a user. `createWorkflowRun`
      // resolves the org system user; a placeholder id here would violate the
      // `WorkflowRun.createdBy` FK.
      userId: null,
      triggeredFrom: WorkflowTriggerSource.WEBHOOK,
    })
  })

  it('passes the webhook envelope as the run inputs', async () => {
    await POST(postRequest(false, { hello: 'world' }), params)

    const { inputs } = createRun.mock.calls[0]?.[0] as { inputs: Record<string, unknown> }
    expect(inputs).toMatchObject({ method: 'POST', body: { hello: 'world' } })
    expect(inputs).toHaveProperty('headers')
    expect(inputs).toHaveProperty('query')
  })

  it('executes THAT run, with a reporter bound to its id', async () => {
    await POST(postRequest(false), params)

    const [run, reporter] = executeWorkflowAsync.mock.calls[0] as [
      { id: string },
      { workflowRunId: string },
    ]
    expect(run.id).toBe(RUN_ID)
    // No reporter at all was passed before, so a webhook run had no per-node trace.
    expect(reporter.workflowRunId).toBe(RUN_ID)
  })

  it('a failed execution still answers the author’s configured response', async () => {
    // `executeWorkflowAsync` records the failure on the run row before it
    // rethrows. The sender still gets its contract — a non-2xx would make
    // senders like Shopify or Stripe retry a request that fails again.
    executeWorkflowAsync.mockRejectedValue(new Error('node blew up'))

    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('PUBLISHED-BODY')
  })

  it('an org over its plan limit is refused, and nothing executes', async () => {
    createRun.mockRejectedValue(
      new UsageLimitError({ metric: 'workflowRuns', current: 100, limit: 100 })
    )

    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('limit') })
    expect(executeWorkflowAsync).not.toHaveBeenCalled()
  })

  it('the ?test=true path creates no run and consumes no quota', async () => {
    arm()
    const res = await POST(postRequest(true), params)
    expect(res.status).toBe(201)
    expect(createRun).not.toHaveBeenCalled()
    expect(executeWorkflowAsync).not.toHaveBeenCalled()
  })
})
