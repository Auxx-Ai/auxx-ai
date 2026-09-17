// packages/lib/src/payment-gateways/__tests__/feeds.test.ts
//
// `linkFeed`/`unlinkFeed` write the one column task 58 §4.2 names
// (`FinancialSourceAccount.paymentGatewayId`) directly, no `UnifiedCrudHandler`
// involved - a `FinancialSourceAccount` is a plain Drizzle table, not an
// EAV entity. `readiness` (§6.2) is presence-only against the role rows -
// mocked here as `readRoleAssignments` - plus the linked feeds and any open
// destination mismatch, mocked as `listOpenDestinationMismatches`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentGatewayRow } from '../client'

const state = vi.hoisted(() => ({
  gateway: null as PaymentGatewayRow | null,
  updateRows: [] as { id: string }[],
  roleAssignments: [] as Record<string, unknown>[],
  linkedFeeds: [] as Record<string, unknown>[],
  mismatches: [] as { payoutId: string; number: string | null; message: string }[],
  updateCalls: [] as { table: string; values: unknown; wheres: unknown[] }[],
}))

function baseGateway(overrides: Partial<PaymentGatewayRow> = {}): PaymentGatewayRow {
  return {
    id: 'pg_1',
    recordId: 'payment_gateway:pg_1',
    name: 'Stripe',
    handles: ['stripe'],
    clearingGlAccountId: 'acct_clearing',
    feeGlAccountId: null,
    settlementSource: 'stripe',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    processorAccountId: null,
    settlementCurrency: null,
    bankAccountId: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

vi.mock('../reads', () => ({
  getPaymentGateway: async (_db: unknown, _org: string, id: string) => ({
    isErr: () => false,
    isOk: () => true,
    value: state.gateway && state.gateway.id === id ? state.gateway : null,
  }),
}))

vi.mock('../../postings/role-assignments', () => ({
  readRoleAssignments: async () => state.roleAssignments,
}))

vi.mock('../../money/payouts/reads', () => ({
  listOpenDestinationMismatches: async () => state.mismatches,
}))

/** A minimal Drizzle double: `.select().from(table).where()` and `.update(table).set().where().returning()`. */
function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: async () => state.linkedFeeds,
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (whereClause: unknown) => ({
          returning: async () => {
            state.updateCalls.push({ table: String(table), values, wheres: [whereClause] })
            return state.updateRows
          },
        }),
      }),
    }),
  } as never
}

const { linkFeed, unlinkFeed, readiness } = await import('../feeds')

const ORG = 'org_1'

beforeEach(() => {
  state.gateway = baseGateway()
  state.updateRows = [{ id: 'fsa_1' }]
  state.roleAssignments = []
  state.linkedFeeds = []
  state.mismatches = []
  state.updateCalls = []
})

describe('linkFeed', () => {
  it('refuses when the gateway is not a live payment gateway of this org', async () => {
    state.gateway = null
    const result = await linkFeed(fakeDb(), {
      organizationId: ORG,
      actorUserId: 'user_1',
      gatewayId: 'pg_missing',
      sourceAccountId: 'fsa_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('pg_missing')
  })

  it('refuses when the feed does not exist, is archived, or belongs to another org', async () => {
    state.updateRows = []
    const result = await linkFeed(fakeDb(), {
      organizationId: ORG,
      actorUserId: 'user_1',
      gatewayId: 'pg_1',
      sourceAccountId: 'fsa_gone',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('fsa_gone')
  })

  it('points the feed at the rail', async () => {
    const result = await linkFeed(fakeDb(), {
      organizationId: ORG,
      actorUserId: 'user_1',
      gatewayId: 'pg_1',
      sourceAccountId: 'fsa_1',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({ sourceAccountId: 'fsa_1', paymentGatewayId: 'pg_1' })
    }
    expect(state.updateCalls[0]?.values).toEqual({ paymentGatewayId: 'pg_1' })
  })
})

describe('unlinkFeed', () => {
  it('refuses when the feed does not exist or belongs to another org', async () => {
    state.updateRows = []
    const result = await unlinkFeed(fakeDb(), {
      organizationId: ORG,
      actorUserId: 'user_1',
      sourceAccountId: 'fsa_gone',
    })
    expect(result.isErr()).toBe(true)
  })

  it('clears the rail pointer', async () => {
    const result = await unlinkFeed(fakeDb(), {
      organizationId: ORG,
      actorUserId: 'user_1',
      sourceAccountId: 'fsa_1',
    })
    expect(result.isOk()).toBe(true)
    expect(state.updateCalls[0]?.values).toEqual({ paymentGatewayId: null })
  })
})

describe('readiness', () => {
  it('refuses when the gateway does not exist', async () => {
    state.gateway = null
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_missing' })
    expect(result.isErr()).toBe(true)
  })

  it('is not ready with nothing mapped and no feed linked', async () => {
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toMatchObject({
      clearingMapped: false,
      feeMapped: false,
      bankMapped: false,
      linkedFeeds: [],
      ready: false,
      mismatches: [],
    })
  })

  it('is ready with only clearing mapped and no feed linked - a manual rail never raises a payout', async () => {
    state.roleAssignments = [
      {
        role: 'clearing',
        paymentGatewayId: 'pg_1',
        markedUnused: false,
        glAccountId: 'acct_clearing',
      },
    ]
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    if (!result.isOk()) throw result.error
    expect(result.value.ready).toBe(true)
    expect(result.value.clearingMapped).toBe(true)
    expect(result.value.bankMapped).toBe(false)
  })

  it('is not ready when a feed is linked but bank is unmapped', async () => {
    state.roleAssignments = [
      {
        role: 'clearing',
        paymentGatewayId: 'pg_1',
        markedUnused: false,
        glAccountId: 'acct_clearing',
      },
    ]
    state.linkedFeeds = [
      { id: 'fsa_1', providerKey: 'stripe', externalAccountId: 'acct_stripe_1', name: null },
    ]
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    if (!result.isOk()) throw result.error
    expect(result.value.ready).toBe(false)
    expect(result.value.linkedFeeds).toEqual([
      {
        sourceAccountId: 'fsa_1',
        providerKey: 'stripe',
        externalAccountId: 'acct_stripe_1',
        name: null,
      },
    ])
  })

  it('is ready when clearing and bank are both mapped and a feed is linked', async () => {
    state.roleAssignments = [
      {
        role: 'clearing',
        paymentGatewayId: 'pg_1',
        markedUnused: false,
        glAccountId: 'acct_clearing',
      },
      { role: 'bank', paymentGatewayId: 'pg_1', markedUnused: false, glAccountId: 'acct_bank' },
    ]
    state.linkedFeeds = [
      { id: 'fsa_1', providerKey: 'stripe', externalAccountId: 'acct_stripe_1', name: null },
    ]
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    if (!result.isOk()) throw result.error
    expect(result.value.ready).toBe(true)
    expect(result.value.bankMapped).toBe(true)
  })

  it('ignores a marked-unused role row and a row scoped to a different gateway', async () => {
    state.roleAssignments = [
      {
        role: 'clearing',
        paymentGatewayId: 'pg_1',
        markedUnused: true,
        glAccountId: 'acct_clearing',
      },
      {
        role: 'clearing',
        paymentGatewayId: 'pg_other',
        markedUnused: false,
        glAccountId: 'acct_x',
      },
    ]
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    if (!result.isOk()) throw result.error
    expect(result.value.clearingMapped).toBe(false)
  })

  it('surfaces open destination mismatches', async () => {
    state.mismatches = [
      { payoutId: 'po_1', number: 'PAY-0001', message: 'reported destination is not confirmed' },
    ]
    const result = await readiness(fakeDb(), { organizationId: ORG, gatewayId: 'pg_1' })
    if (!result.isOk()) throw result.error
    expect(result.value.mismatches).toEqual(state.mismatches)
  })
})
