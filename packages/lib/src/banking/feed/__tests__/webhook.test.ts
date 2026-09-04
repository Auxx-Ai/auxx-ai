// packages/lib/src/banking/feed/__tests__/webhook.test.ts
//
// The `fca_...` → connector routing case (HANDOFF slot 3A item 4).
//
// This is the only lookup of its kind in the codebase: both existing webhook dispatch
// jobs key on org-scoped ids a PLATFORM Stripe event does not carry, so if this routing
// is wrong there is no fallback path and the feed simply never wakes up. What is pinned
// here is the DECISION per event type, not the SQL - a suspended connector must not be
// woken, a deactivation must flip the status rather than being ignored, and an event for
// an account nothing feeds from must be a silent no-op rather than a 500 that makes
// Stripe retry forever.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueConnectorSync = vi.fn(async () => {})
const refreshBankAccountCoverage = vi.fn(async () => 0)
const crudUpdate = vi.fn(async () => ({}))

vi.mock('../../../data-connectors/data-connector-queue', () => ({ enqueueConnectorSync }))
vi.mock('../coverage', () => ({ refreshBankAccountCoverage }))
vi.mock('../../reads', () => ({
  loadBankAccountFieldContext: async () => ({
    bankAccountDefId: 'def_bank_account',
    fields: { bank_account_connector_id: { id: 'field_connector' } },
  }),
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'system_user' }),
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = crudUpdate
  },
}))

const { applyFinancialConnectionsEvent, isFinancialConnectionsEvent } = await import('../webhook')

/** The narrow Drizzle surface the router touches, as a double. */
function fakeDb(feedRow: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const db = {
    updates,
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => (feedRow ? [feedRow] : []) }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values)
        },
      }),
    }),
    query: {
      FieldValue: { findFirst: async () => ({ entityId: 'inst_bank_account' }) },
    },
  }
  return db as unknown as Parameters<typeof applyFinancialConnectionsEvent>[1] & {
    updates: Record<string, unknown>[]
  }
}

const FEED = {
  organizationId: 'org_1',
  connectorId: 'conn_1',
  status: 'live',
  credentialId: 'cred_1',
}

function event(type: string, id: string | null = 'fca_1') {
  return { type, data: { object: { id } } }
}

beforeEach(() => {
  enqueueConnectorSync.mockClear()
  refreshBankAccountCoverage.mockClear()
  crudUpdate.mockClear()
})

describe('isFinancialConnectionsEvent', () => {
  it('claims exactly the four types the handler implements', () => {
    // The list and the switch live in one file so they cannot drift; this asserts they
    // have not. A case list that fell behind the handler would silently stop routing an
    // event type, and a bank feed that stops and says nothing is the worst failure here.
    expect(
      isFinancialConnectionsEvent('financial_connections.account.refreshed_transactions')
    ).toBe(true)
    expect(isFinancialConnectionsEvent('financial_connections.account.disconnected')).toBe(true)
    expect(isFinancialConnectionsEvent('financial_connections.account.deactivated')).toBe(true)
    expect(isFinancialConnectionsEvent('financial_connections.account.reactivated')).toBe(true)
    expect(isFinancialConnectionsEvent('financial_connections.account.created')).toBe(false)
    expect(isFinancialConnectionsEvent('payment_intent.succeeded')).toBe(false)
  })
})

describe('applyFinancialConnectionsEvent', () => {
  it('is a silent no-op for an account nothing feeds from', async () => {
    // An org can disconnect a bank in our UI and Stripe keeps reporting it for a while.
    // Throwing would 500 the route and make Stripe retry a delivery that can never work.
    await applyFinancialConnectionsEvent(
      event('financial_connections.account.disconnected'),
      fakeDb(null)
    )
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })

  it('ignores an event with no account id', async () => {
    await applyFinancialConnectionsEvent(
      event('financial_connections.account.disconnected', null),
      fakeDb(FEED)
    )
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })

  it('queues a sync on a refresh, and stamps the webhook liveness', async () => {
    const db = fakeDb(FEED)
    await applyFinancialConnectionsEvent(
      event('financial_connections.account.refreshed_transactions'),
      db
    )
    expect(enqueueConnectorSync).toHaveBeenCalledWith({
      connectorId: 'conn_1',
      organizationId: 'org_1',
      trigger: 'webhook',
    })
    expect(refreshBankAccountCoverage).toHaveBeenCalled()
    // A webhook writes no run, so `lastWebhookEventAt` is the only sign of life a
    // pure-webhook connector has.
    expect(db.updates[0]).toHaveProperty('lastWebhookEventAt')
  })

  it('refuses to wake a SUSPENDED connector', async () => {
    // 🛑 Gate on status, never on config completeness. A `disconnected` connector keeps
    // its credential and its streams, so every structural predicate says yes - and one
    // sync moves it to `error`, which discards the Disconnected banner and puts it
    // outside every repair path permanently (#2049/#2050/#2051).
    await applyFinancialConnectionsEvent(
      event('financial_connections.account.refreshed_transactions'),
      fakeDb({ ...FEED, status: 'disconnected' })
    )
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })

  it('flips the connector and the bank account on a deactivation, saying "Reconnect"', async () => {
    const db = fakeDb(FEED)
    await applyFinancialConnectionsEvent(event('financial_connections.account.deactivated'), db)
    const status = db.updates.find((u) => u.status === 'disconnected')
    expect(status).toBeDefined()
    // `classifyConnectorError` matches on the word, which is what routes the connector
    // to `action-needed` with a Reconnect rather than a Retry that cannot work.
    expect(String(status?.error)).toMatch(/Reconnect/i)
    expect(crudUpdate).toHaveBeenCalledWith('def_bank_account:inst_bank_account', {
      bank_account_status: 'disconnected',
    })
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })

  it('treats a disconnection the same way as a deactivation', async () => {
    const db = fakeDb(FEED)
    await applyFinancialConnectionsEvent(event('financial_connections.account.disconnected'), db)
    expect(db.updates.some((u) => u.status === 'disconnected')).toBe(true)
  })

  it('re-arms and pulls on a reactivation', async () => {
    const db = fakeDb({ ...FEED, status: 'disconnected' })
    await applyFinancialConnectionsEvent(event('financial_connections.account.reactivated'), db)
    // 🛑 Off `disconnected` deliberately and only here - anything else that moves a
    // connector off that status removes it from the repair path permanently.
    expect(db.updates.some((u) => u.status === 'pending' && u.error === null)).toBe(true)
    expect(crudUpdate).toHaveBeenCalledWith('def_bank_account:inst_bank_account', {
      bank_account_status: 'connected',
    })
    expect(enqueueConnectorSync).toHaveBeenCalled()
  })

  it('ignores an unrelated event type it was handed', async () => {
    await applyFinancialConnectionsEvent(
      event('financial_connections.account.created'),
      fakeDb(FEED)
    )
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })
})
