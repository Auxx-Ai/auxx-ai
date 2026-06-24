// packages/lib/src/data-connectors/connection-webhook-registration.test.ts
// Reconcile logic for the connection-scoped webhook subscription set (Direction 2):
// the desired topic set is the UNION of every consumer on the connection, and the
// per-topic diff (un)subscribes only what changed. DB + services + provider are faked
// so the test is pure — it asserts the diff drives register/unregister correctly.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drizzle column refs are undefined under vitest — neutralize the query builders so the
// `where` clauses are inert and the faked db.query returns canned rows regardless.
vi.mock('drizzle-orm', () => ({ and: () => undefined, eq: () => undefined }))

// A self-referential proxy so any `schema.Table.column` access is a harmless object.
vi.mock('@auxx/database', () => {
  const schemaProxy: unknown = new Proxy({}, { get: () => schemaProxy })
  return { schema: schemaProxy }
})

const getConnectionWebhookHandler = vi.fn()
const upsertConnectionWebhookHandler = vi.fn()
const deleteConnectionWebhookHandler = vi.fn()
vi.mock('@auxx/services/app-webhook-handlers', () => ({
  getConnectionWebhookHandler: (...a: unknown[]) => getConnectionWebhookHandler(...a),
  upsertConnectionWebhookHandler: (...a: unknown[]) => upsertConnectionWebhookHandler(...a),
  deleteConnectionWebhookHandler: (...a: unknown[]) => deleteConnectionWebhookHandler(...a),
}))

const resolveConnectorCredential = vi.fn()
vi.mock('./connector-runtime', () => ({
  resolveConnectorCredential: (...a: unknown[]) => resolveConnectorCredential(...a),
}))

const resolveConnectionWebhookCapability = vi.fn()
vi.mock('./webhooks/registry', () => ({
  resolveConnectionWebhookCapability: (...a: unknown[]) => resolveConnectionWebhookCapability(...a),
}))

import { reconcileConnectionWebhooks } from './connection-webhook-registration'

const register = vi.fn()
const unregister = vi.fn()

function makeCapability(topics: string[]) {
  return {
    topics,
    register,
    unregister,
    verify: () => true,
    eventId: () => null,
    resolveWebhook: () => [],
    resolveTopic: () => '',
  }
}

/** A fake db whose query helpers return canned rows (the `where` is inert — mocked above). */
function makeDb(rows: {
  connectors?: unknown[]
  workflows?: { triggerTopic: string | null }[]
  agentTriggers?: { triggerTopic: string | null }[]
}) {
  return {
    query: {
      Credential: { findFirst: vi.fn().mockResolvedValue({ id: 'conn1', type: 'fixture' }) },
      DataConnector: { findMany: vi.fn().mockResolvedValue(rows.connectors ?? []) },
      Workflow: { findMany: vi.fn().mockResolvedValue(rows.workflows ?? []) },
      AgentTrigger: { findMany: vi.fn().mockResolvedValue(rows.agentTriggers ?? []) },
    },
  } as never
}

/** A handler-row Result with the given prior state metadata (or a not-found Result). */
function priorHandler(
  state: { secret: string; subscriptions: { topic: string; externalId: string }[] } | null
) {
  if (!state) return { isOk: () => false } as const
  return {
    isOk: () => true,
    value: {
      metadata: JSON.stringify({
        secret: state.secret,
        callbackUrl: 'https://x',
        subscriptions: state.subscriptions,
      }),
    },
  } as const
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveConnectionWebhookCapability.mockReturnValue(makeCapability(['t1', 't2']))
  resolveConnectorCredential.mockResolvedValue(null)
  // register subscribes one topic per call (the reconciler's contract) → one sub back.
  register.mockImplementation(async ({ topics }: { topics: string[] }) =>
    topics.map((t) => ({ topic: t, externalId: `sub:${t}` }))
  )
  unregister.mockResolvedValue(undefined)
  upsertConnectionWebhookHandler.mockResolvedValue({
    isErr: () => false,
    value: { id: 'h1', url: 'https://x/webhooks/connection/conn1' },
  })
  deleteConnectionWebhookHandler.mockResolvedValue({ isErr: () => false })
})

/** The subscriptions persisted by the final upsert call (the reconciled set). */
function persistedSubscriptions(): { topic: string }[] {
  const lastCall = upsertConnectionWebhookHandler.mock.calls.at(-1)?.[0] as {
    metadata: { subscriptions: { topic: string }[] }
  }
  return lastCall.metadata.subscriptions
}

describe('reconcileConnectionWebhooks', () => {
  it('subscribes the UNION of connector topics + workflow + agent trigger topics', async () => {
    getConnectionWebhookHandler.mockResolvedValue(priorHandler(null))
    const db = makeDb({
      connectors: [{ id: 'dc1' }], // contributes capability.topics t1, t2
      workflows: [{ triggerTopic: 'wf-topic' }],
      agentTriggers: [{ triggerTopic: 'agent-topic' }],
    })

    await reconcileConnectionWebhooks(db, 'org1', 'conn1')

    const topics = register.mock.calls.map((c) => c[0].topics[0]).sort()
    expect(topics).toEqual(['agent-topic', 't1', 't2', 'wf-topic'])
    expect(unregister).not.toHaveBeenCalled()
    expect(
      persistedSubscriptions()
        .map((s) => s.topic)
        .sort()
    ).toEqual(['agent-topic', 't1', 't2', 'wf-topic'])
  })

  it('adds exactly one subscription when a trigger enables a new topic', async () => {
    getConnectionWebhookHandler.mockResolvedValue(
      priorHandler({
        secret: 's',
        subscriptions: [
          { topic: 't1', externalId: 'sub:t1' },
          { topic: 't2', externalId: 'sub:t2' },
        ],
      })
    )
    // connectors present → t1, t2; plus a new workflow topic t3.
    const db = makeDb({ connectors: [{ id: 'dc1' }], workflows: [{ triggerTopic: 't3' }] })

    await reconcileConnectionWebhooks(db, 'org1', 'conn1')

    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0].topics).toEqual(['t3'])
    expect(unregister).not.toHaveBeenCalled()
  })

  it('removes the subscription when the last consumer of a topic disappears', async () => {
    getConnectionWebhookHandler.mockResolvedValue(
      priorHandler({
        secret: 's',
        subscriptions: [
          { topic: 't1', externalId: 'sub:t1' },
          { topic: 't2', externalId: 'sub:t2' },
          { topic: 't3', externalId: 'sub:t3' },
        ],
      })
    )
    // connectors present → t1, t2; t3 no longer wanted.
    const db = makeDb({ connectors: [{ id: 'dc1' }] })

    await reconcileConnectionWebhooks(db, 'org1', 'conn1')

    expect(register).not.toHaveBeenCalled()
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(unregister.mock.calls[0][0].externalIds).toEqual(['sub:t3'])
    expect(
      persistedSubscriptions()
        .map((s) => s.topic)
        .sort()
    ).toEqual(['t1', 't2'])
  })

  it('tears down the handler row + all subs when no consumers remain', async () => {
    getConnectionWebhookHandler.mockResolvedValue(
      priorHandler({ secret: 's', subscriptions: [{ topic: 't1', externalId: 'sub:t1' }] })
    )
    const db = makeDb({}) // no connectors, no triggers

    await reconcileConnectionWebhooks(db, 'org1', 'conn1')

    expect(unregister).toHaveBeenCalledWith(expect.objectContaining({ externalIds: ['sub:t1'] }))
    expect(deleteConnectionWebhookHandler).toHaveBeenCalledWith({ connectionId: 'conn1' })
    expect(register).not.toHaveBeenCalled()
  })

  it('is a no-op (no register) for a connection whose provider has no WebhookSpec', async () => {
    resolveConnectionWebhookCapability.mockReturnValue(null)
    getConnectionWebhookHandler.mockResolvedValue(priorHandler(null))
    const db = makeDb({ connectors: [{ id: 'dc1' }] })

    await reconcileConnectionWebhooks(db, 'org1', 'conn1')

    expect(register).not.toHaveBeenCalled()
    expect(upsertConnectionWebhookHandler).not.toHaveBeenCalled()
  })
})
