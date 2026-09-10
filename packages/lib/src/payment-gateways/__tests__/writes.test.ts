// packages/lib/src/payment-gateways/__tests__/writes.test.ts
//
// The two refusals §5.3 names explicitly: two records sharing a normalised
// handle, and a clearing account that is not an active asset account. Mocks
// `./reads` and `../postings/chart-accounts` rather than a live db, the same
// boundary `banking/__tests__` draws around `UnifiedCrudHandler`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentGatewayRow } from '../client'

const state = vi.hoisted(() => ({
  existing: [] as PaymentGatewayRow[],
  createCalls: [] as unknown[],
  updateCalls: [] as unknown[],
  chartAccounts: new Map<
    string,
    { id: string; accountType: string; isActive: boolean; name: string }
  >(),
}))

function baseRow(overrides: Partial<PaymentGatewayRow> = {}): PaymentGatewayRow {
  return {
    id: 'pg_existing',
    recordId: 'payment_gateway:pg_existing',
    name: 'Affirm',
    handles: ['affirm'],
    clearingGlAccountId: 'acct_affirm',
    feeGlAccountId: null,
    settlementSource: 'manual',
    status: 'active',
    lastSettlementAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

vi.mock('../reads', () => ({
  requirePaymentGatewayFieldContext: async () => ({
    paymentGatewayDefId: 'def_pg',
    fields: {},
  }),
  listPaymentGateways: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: state.existing,
  }),
  getPaymentGateway: async (_db: unknown, _org: string, id: string) => {
    const row = state.existing.find((r) => r.id === id) ?? {
      ...baseRow({ id: 'pg_new', name: 'New gateway' }),
    }
    return { isErr: () => false, isOk: () => true, value: row }
  },
}))

vi.mock('../../postings/chart-accounts', () => ({
  loadChartAccountsById: async (_db: unknown, _org: string, ids: string[]) => {
    const accounts = new Map()
    for (const id of ids) {
      const account = state.chartAccounts.get(id)
      if (account) accounts.set(id, account)
    }
    return { accounts, malformed: ids.filter((id) => !state.chartAccounts.has(id)) }
  },
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    async create(_defId: string, values: unknown) {
      state.createCalls.push(values)
      return { instance: { id: 'pg_new' } }
    }
    async update(recordId: unknown, values: unknown) {
      state.updateCalls.push({ recordId, values })
    }
  },
}))

const { createPaymentGateway, updatePaymentGateway } = await import('../writes')

const ORG = 'org_1'
const ASSET_ACCOUNT = {
  id: 'acct_card_clearing',
  accountType: 'asset',
  isActive: true,
  name: '1200 Card Clearing',
}
const EXPENSE_ACCOUNT = {
  id: 'acct_fees',
  accountType: 'expense',
  isActive: true,
  name: '6100 Merchant Fees',
}
const LIABILITY_ACCOUNT = {
  id: 'acct_ap',
  accountType: 'liability',
  isActive: true,
  name: '2000 A/P',
}

beforeEach(() => {
  state.existing = []
  state.createCalls.length = 0
  state.updateCalls.length = 0
  state.chartAccounts = new Map([
    [ASSET_ACCOUNT.id, ASSET_ACCOUNT],
    [EXPENSE_ACCOUNT.id, EXPENSE_ACCOUNT],
    [LIABILITY_ACCOUNT.id, LIABILITY_ACCOUNT],
  ])
})

describe('createPaymentGateway', () => {
  it('refuses a clearing account that is not an active asset account', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: LIABILITY_ACCOUNT.id,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('liability')
  })

  it('refuses a clearing account that does not exist in the chart', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: 'acct_missing',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('does not exist')
  })

  it('refuses two records sharing a normalised handle, naming both', async () => {
    state.existing = [baseRow({ id: 'pg_1', name: 'Authorize.Net', handles: ['authorize_net'] })]
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Authorize.Net (dup)',
      // Same handle, different case - must still collide (trimmed + lower-cased).
      handles: [' Authorize_Net '],
      clearingAccountId: ASSET_ACCOUNT.id,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('Authorize.Net (dup)')
      expect(result.error.message).toContain('Authorize.Net')
    }
  })

  it('creates a gateway with a valid asset clearing account and expense fee account', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Shopify Payments',
      handles: ['shopify_payments'],
      clearingAccountId: ASSET_ACCOUNT.id,
      feeAccountId: EXPENSE_ACCOUNT.id,
      settlementSource: 'shopify_payments',
    })
    expect(result.isOk()).toBe(true)
    expect(state.createCalls).toHaveLength(1)
    expect(state.createCalls[0]).toMatchObject({
      payment_gateway_name: 'Shopify Payments',
      payment_gateway_handles: ['shopify_payments'],
      payment_gateway_clearing_account: ASSET_ACCOUNT.id,
      payment_gateway_fee_account: EXPENSE_ACCOUNT.id,
      payment_gateway_settlement_source: 'shopify_payments',
    })
  })

  it('refuses a fee account that is not an expense account', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Shopify Payments',
      handles: ['shopify_payments'],
      clearingAccountId: ASSET_ACCOUNT.id,
      feeAccountId: ASSET_ACCOUNT.id,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('asset')
  })

  it('refuses an empty handle list', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Nothing',
      handles: ['   '],
      clearingAccountId: ASSET_ACCOUNT.id,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('at least one handle')
  })
})

describe('updatePaymentGateway', () => {
  it('re-validates the clearing account on every write', async () => {
    state.existing = [baseRow()]
    const result = await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      clearingAccountId: LIABILITY_ACCOUNT.id,
    })
    expect(result.isErr()).toBe(true)
  })

  it('allows renaming without touching handles or accounts', async () => {
    state.existing = [baseRow()]
    const result = await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      name: 'Affirm (BNPL)',
    })
    expect(result.isOk()).toBe(true)
    expect(state.updateCalls[0]).toMatchObject({
      values: { payment_gateway_name: 'Affirm (BNPL)' },
    })
  })

  it('does not collide with itself when its own handle is unchanged', async () => {
    state.existing = [baseRow()]
    const result = await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      handles: ['affirm', 'Affirm'],
    })
    expect(result.isOk()).toBe(true)
  })
})
