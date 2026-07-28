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

const { redis, getRedisClient, findFirst, executeWorkflow, initializeWithDefaults } = vi.hoisted(
  () => {
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
      executeWorkflow: vi.fn(async () => ({ executionId: 'exec_1', status: 'completed' })),
      initializeWithDefaults: vi.fn(async () => undefined),
    }
  }
)

vi.mock('@auxx/redis', () => ({ getRedisClient }))
vi.mock('@auxx/database', () => ({ database: { query: { WorkflowApp: { findFirst } } } }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@auxx/lib/workflow-engine', () => ({
  WorkflowEngine: class {
    getNodeRegistry() {
      return { initializeWithDefaults }
    }
    executeWorkflow = executeWorkflow
  },
}))
vi.mock('@auxx/lib/workflow-engine/types', () => ({
  WorkflowNodeType: { WEBHOOK: 'webhook' },
  WorkflowTriggerType: { WEBHOOK: 'webhook' },
}))
vi.mock('~/components/workflow/utils/schema-to-variable', () => ({
  validateAgainstSchema: vi.fn(() => true),
}))

const { webhookTestArmKey, webhookTestEventsKey, WEBHOOK_TEST_WINDOW_TTL_SECONDS } = await import(
  '~/server/lib/webhook-test-window'
)
const { GET, POST } = await import('./route')

const WF_ID = 'wf_cuid0000000000000000000'
const ORG_ID = 'org_cuid000000000000000000000'

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
  executeWorkflow.mockClear()
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
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })

  it('behaves identically while a window IS armed', async () => {
    arm()
    const res = await POST(postRequest(false), params)
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('PUBLISHED-BODY')
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
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
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })
})
