// packages/lib/src/payment-gateways/__tests__/writes.test.ts
//
// `createPaymentGateway`/`updatePaymentGateway` map clearing/fee through
// `setRoleAssignment` (task 58 §3) instead of writing the six retired gateway
// fields; account existence/type/subtype validation is `setRoleAssignment`'s
// job now and is mocked here, not re-asserted. What is pinned:
//
//  - the entity write carries only the KEPT fields (name, handles, fee
//    treatment, status, lastSettlementAt) - never a clearing/fee/settlement
//    field, which the registry no longer declares;
//  - `setRoleAssignment` is called with `role: 'clearing'`/`'payment_processing_fees'`,
//    `paymentGatewayId`, and the given account, and its refusal propagates;
//  - an update's `feeAccountId: null` clears the override with `useDefault: true`
//    rather than mapping to nothing;
//  - the handle-collision refusal (§5.1) is unchanged.
//
// Mocks `./reads`, `../../postings/role-map` and the CRUD handler rather than a
// live db, the same boundary `banking/__tests__` draws around `UnifiedCrudHandler`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'
import type { PaymentGatewayRow } from '../client'

const state = vi.hoisted(() => ({
  existing: [] as PaymentGatewayRow[],
  createCalls: [] as unknown[],
  updateCalls: [] as unknown[],
  roleAssignmentCalls: [] as Record<string, unknown>[],
  roleAssignmentError: null as Error | null,
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

vi.mock('../../postings/role-map', () => ({
  setRoleAssignment: async (_db: unknown, options: Record<string, unknown>) => {
    state.roleAssignmentCalls.push(options)
    if (state.roleAssignmentError) {
      return { isErr: () => true, isOk: () => false, error: state.roleAssignmentError }
    }
    return { isErr: () => false, isOk: () => true, value: { role: options.role } }
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
const CLEARING_ACCOUNT = 'acct_card_clearing'
const FEE_ACCOUNT = 'acct_fees'

beforeEach(() => {
  state.existing = []
  state.createCalls.length = 0
  state.updateCalls.length = 0
  state.roleAssignmentCalls.length = 0
  state.roleAssignmentError = null
})

describe('createPaymentGateway', () => {
  it('refuses an empty clearing account before ever calling setRoleAssignment', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: '   ',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('clearing account')
    expect(state.roleAssignmentCalls).toHaveLength(0)
  })

  it('propagates setRoleAssignment refusing the clearing account', async () => {
    state.roleAssignmentError = new BadRequestError('"2000 A/P" is a liability account.')
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: 'acct_ap',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('liability')
  })

  it('refuses two records sharing a normalised handle, naming both', async () => {
    state.existing = [baseRow({ id: 'pg_1', name: 'Authorize.Net', handles: ['authorize_net'] })]
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Authorize.Net (dup)',
      // Same handle, different case - must still collide (trimmed + lower-cased).
      handles: [' Authorize_Net '],
      clearingAccountId: CLEARING_ACCOUNT,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('Authorize.Net (dup)')
      expect(result.error.message).toContain('Authorize.Net')
    }
  })

  it('writes only the kept fields, and maps clearing and fee through the rail scope', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Shopify Payments',
      handles: ['shopify_payments'],
      clearingAccountId: CLEARING_ACCOUNT,
      feeAccountId: FEE_ACCOUNT,
    })
    expect(result.isOk()).toBe(true)
    expect(state.createCalls[0]).toMatchObject({
      payment_gateway_name: 'Shopify Payments',
      payment_gateway_handles: ['shopify_payments'],
    })
    for (const retired of [
      'payment_gateway_clearing_account',
      'payment_gateway_fee_account',
      'payment_gateway_settlement_source',
    ]) {
      expect(state.createCalls[0]).not.toHaveProperty(retired)
    }
    expect(state.roleAssignmentCalls).toEqual([
      expect.objectContaining({
        role: 'clearing',
        paymentGatewayId: 'pg_new',
        glAccountId: CLEARING_ACCOUNT,
      }),
      expect.objectContaining({
        role: 'payment_processing_fees',
        paymentGatewayId: 'pg_new',
        glAccountId: FEE_ACCOUNT,
      }),
    ])
  })

  it('maps only clearing when no fee account is given', async () => {
    await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Affirm',
      handles: ['affirm'],
      clearingAccountId: CLEARING_ACCOUNT,
    })
    expect(state.roleAssignmentCalls).toHaveLength(1)
    expect(state.roleAssignmentCalls[0]).toMatchObject({ role: 'clearing' })
  })

  it('refuses an empty handle list', async () => {
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Nothing',
      handles: ['   '],
      clearingAccountId: CLEARING_ACCOUNT,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('at least one handle')
  })
})

describe('updatePaymentGateway', () => {
  it('repoints clearing through setRoleAssignment', async () => {
    state.existing = [baseRow()]
    const result = await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      clearingAccountId: 'acct_new_clearing',
    })
    expect(result.isOk()).toBe(true)
    expect(state.roleAssignmentCalls[0]).toMatchObject({
      role: 'clearing',
      paymentGatewayId: 'pg_existing',
      glAccountId: 'acct_new_clearing',
    })
  })

  it('propagates setRoleAssignment refusing the repoint', async () => {
    state.existing = [baseRow()]
    state.roleAssignmentError = new BadRequestError('"2000 A/P" is a liability account.')
    const result = await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      clearingAccountId: 'acct_ap',
    })
    expect(result.isErr()).toBe(true)
  })

  it('maps a new fee account when given one', async () => {
    state.existing = [baseRow()]
    await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      feeAccountId: FEE_ACCOUNT,
    })
    expect(state.roleAssignmentCalls[0]).toMatchObject({
      role: 'payment_processing_fees',
      paymentGatewayId: 'pg_existing',
      glAccountId: FEE_ACCOUNT,
    })
  })

  it('clears the fee override back to the org default when given null', async () => {
    state.existing = [baseRow()]
    await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_existing',
      feeAccountId: null,
    })
    expect(state.roleAssignmentCalls[0]).toMatchObject({
      role: 'payment_processing_fees',
      paymentGatewayId: 'pg_existing',
      useDefault: true,
    })
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
    expect(state.roleAssignmentCalls).toHaveLength(0)
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

// ─────────────────────────────────────────────────────────────────────────────
// brief 26 §4: feeTreatment. It decides whether a payout entry for this rail
// carries a fee leg at all, so a bad value is a refusal and not a coercion.
// ─────────────────────────────────────────────────────────────────────────────

describe('feeTreatment', () => {
  it('stamps netted when the caller says nothing, so the record holds the default', async () => {
    // §10: the migration stamps every existing record and this stamps every new
    // one, so the default never lives only in the read path.
    await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: CLEARING_ACCOUNT,
    })
    expect(state.createCalls[0]).toMatchObject({ payment_gateway_fee_treatment: 'netted' })
  })

  it('writes billed through when the caller asks for it', async () => {
    await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Authorize.Net',
      handles: ['authorize_net'],
      clearingAccountId: CLEARING_ACCOUNT,
      feeTreatment: 'billed',
    })
    expect(state.createCalls[0]).toMatchObject({ payment_gateway_fee_treatment: 'billed' })
  })

  it('refuses a value that is not a fee treatment, naming the two that are', async () => {
    // 🛑 A refusal, never a coercion to netted. The READ side coerces because an
    // unmigrated record legitimately has no value; a write that coerced a typo
    // would silently put a billed rail back on the netted path and re-introduce
    // a fee leg its deposits never carried.
    const result = await createPaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      name: 'Stripe',
      handles: ['stripe'],
      clearingAccountId: CLEARING_ACCOUNT,
      feeTreatment: 'net' as never,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/netted or billed/)
  })

  it('is left alone on an update that does not mention it', async () => {
    state.existing = [baseRow({ id: 'pg_1', feeTreatment: 'billed' })]
    await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_1',
      name: 'Authorize.Net',
    })
    expect(state.updateCalls[0]).toMatchObject({
      values: { payment_gateway_name: 'Authorize.Net' },
    })
    expect((state.updateCalls[0] as { values: Record<string, unknown> }).values).not.toHaveProperty(
      'payment_gateway_fee_treatment'
    )
  })

  it('is patched on an update that does mention it', async () => {
    state.existing = [baseRow({ id: 'pg_1' })]
    await updatePaymentGateway({} as never, {
      organizationId: ORG,
      actorUserId: 'user_1',
      paymentGatewayId: 'pg_1',
      feeTreatment: 'billed',
    })
    expect(state.updateCalls[0]).toMatchObject({
      values: { payment_gateway_fee_treatment: 'billed' },
    })
  })
})
