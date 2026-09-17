// packages/lib/src/payment-gateways/__tests__/settlement.test.ts

import type { Database } from '@auxx/database'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  lock: vi.fn(),
  update: vi.fn(),
  getBank: vi.fn(),
  gateway: {
    id: 'gateway-1',
    recordId: 'gateway-def:gateway-1',
    settlementSource: 'shopify_payments',
    name: 'Main store',
  },
  others: [] as { id: string; name: string }[],
  accounts: [] as {
    processorAccountId: string
    providerKey: string
    currencies: string[]
    requiresReauth?: boolean
  }[],
  chart: new Map<string, { isActive: boolean; accountType: string }>(),
  fields: {} as Record<string, { id: string } | null>,
  values: {} as Record<
    string,
    { fieldId: string; value: string | null; relatedEntityId: string | null }[]
  >,
  bank: null as null | {
    id: string
    recordId: string
    archivedAt: Date | null
    status: string
    currency: string
    glAccountId: string | null
  },
}))

vi.mock('@auxx/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withAccountingCommitLock: h.lock,
}))
vi.mock('../../banking/reads', () => ({ getBankAccount: h.getBank }))
vi.mock('../../money/fulfillments/field-context', () => ({ financialFields: async () => h.fields }))
vi.mock('../../postings/chart-accounts', () => ({
  loadChartAccountsById: async () => ({ accounts: h.chart }),
}))
vi.mock('../reads', () => ({
  requirePaymentGatewayFieldContext: async () => ({ paymentGatewayDefId: 'gateway-def' }),
  getPaymentGateway: async () => ({ isErr: () => false, value: selectedGateway(h.gateway) }),
  listPaymentGateways: async () => ({
    isErr: () => false,
    value: [h.gateway, ...h.others].map(selectedGateway),
  }),
}))
vi.mock('../settlement-discovery', () => ({
  listSettlementSourceAccounts: async () => h.accounts,
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    withDatabase() {
      return this
    }
    update = h.update
  },
}))

import { getGatewaySettlementReadiness, updateGatewaySettlementSettings } from '../settlement'

const organizationId = 'organization-1'
const attributes = [
  'payment_gateway_settlement_account',
  'payment_gateway_settlement_currency',
  'payment_gateway_settlement_bank_account',
] as const

function selectedValues(account = 'merchant-1', currency = 'USD', bank = 'bank-1') {
  return [
    { fieldId: 'field-0', value: account, relatedEntityId: null },
    { fieldId: 'field-1', value: currency, relatedEntityId: null },
    // A text value is deliberately present: only the actual bank relationship is authoritative.
    { fieldId: 'field-2', value: 'untrusted-text-bank-id', relatedEntityId: bank },
  ]
}

function selectedGateway(gateway: { id: string; name: string }) {
  const values = h.values[gateway.id] ?? []
  return {
    ...gateway,
    processorAccountId: values.find((row) => row.fieldId === 'field-0')?.value ?? null,
    settlementCurrency: values.find((row) => row.fieldId === 'field-1')?.value ?? null,
    bankAccountId: values.find((row) => row.fieldId === 'field-2')?.relatedEntityId ?? null,
  }
}

function database() {
  const dialect = new PgDialect()
  const tx = {
    select: () => ({
      from: () => ({
        where: async (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
          const params = dialect.sqlToQuery(predicate).params
          expect(params[0]).toBe(organizationId)
          return params
            .slice(1)
            .flatMap((id) =>
              (h.values[String(id)] ?? []).map((value) => ({ ...value, entityId: String(id) }))
            )
        },
      }),
    }),
  }
  const db = { ...tx, transaction: async <T>(run: (value: typeof tx) => Promise<T>) => run(tx) }
  return { db: db as unknown as Database, tx }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.gateway = {
    id: 'gateway-1',
    recordId: 'gateway-def:gateway-1',
    settlementSource: 'shopify_payments',
    name: 'Main store',
  }
  h.others = []
  h.accounts = [
    { processorAccountId: 'merchant-1', providerKey: 'shopify_payments', currencies: ['USD'] },
  ]
  h.chart = new Map([['chart-bank-1', { isActive: true, accountType: 'asset' }]])
  h.fields = Object.fromEntries(
    attributes.map((attribute, index) => [attribute, { id: `field-${index}` }])
  )
  h.values = { 'gateway-1': selectedValues() }
  h.bank = {
    id: 'bank-1',
    recordId: 'bank-def:bank-1',
    archivedAt: null,
    status: 'active',
    currency: 'USD',
    glAccountId: 'chart-bank-1',
  }
  h.getBank.mockImplementation(async (_db, input) => ({
    isErr: () => false,
    isOk: () => true,
    value:
      input.organizationId === organizationId && input.bankAccountId === h.bank?.id ? h.bank : null,
  }))
})

function save(patch: Parameters<typeof updateGatewaySettlementSettings>[1]['patch'] = {}) {
  const { db, tx } = database()
  return {
    db,
    tx,
    result: updateGatewaySettlementSettings(db, {
      organizationId,
      actorUserId: 'user-1',
      gatewayId: 'gateway-1',
      patch,
    }),
  }
}

describe('gateway settlement configuration', () => {
  it('reads the real bank relationship instead of a text lookalike', async () => {
    const { db } = database()
    const settings = await getGatewaySettlementReadiness(db, {
      organizationId,
      gatewayId: 'gateway-1',
    })
    expect(settings.configured).toBe(true)
    expect(h.getBank).toHaveBeenCalledWith(db, { organizationId, bankAccountId: 'bank-1' })
  })

  it('saves a typed bank record reference under the organization accounting lock', async () => {
    const { tx, result } = save()
    await result
    expect(h.lock).toHaveBeenCalledWith(tx, organizationId)
    expect(h.update).toHaveBeenCalledWith('gateway-def:gateway-1', {
      [attributes[0]]: 'merchant-1',
      [attributes[1]]: 'USD',
      [attributes[2]]: 'bank-def:bank-1',
    })
    expect(h.lock.mock.invocationCallOrder[0]).toBeLessThan(h.update.mock.invocationCallOrder[0]!)
  })

  it('refuses a bank outside the organization', async () => {
    await expect(save({ bankAccountId: 'foreign-bank' }).result).rejects.toThrow(
      'active receiving bank'
    )
    expect(h.getBank).toHaveBeenCalledWith(expect.anything(), {
      organizationId,
      bankAccountId: 'foreign-bank',
    })
    expect(h.update).not.toHaveBeenCalled()
  })

  it.each([
    ['archived', { archivedAt: new Date('2026-09-15') }, 'active receiving bank'],
    ['different currency', { currency: 'CAD' }, 'must use the settlement currency'],
    ['unmapped chart', { glAccountId: null }, 'Map the receiving bank account'],
  ])('refuses an %s bank selection', async (_label, patch, reason) => {
    Object.assign(h.bank!, patch)
    await expect(save().result).rejects.toThrow(reason)
    expect(h.update).not.toHaveBeenCalled()
  })

  it.each([
    { isActive: false, accountType: 'asset' },
    { isActive: true, accountType: 'liability' },
  ])('refuses an unsuitable receiving chart account: %j', async (chart) => {
    h.chart.set('chart-bank-1', chart)
    await expect(save().result).rejects.toThrow('active asset account')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('keeps mapping readiness separate from acquisition reauthentication', async () => {
    h.accounts[0]!.requiresReauth = true
    await save().result
    expect(h.update).toHaveBeenCalledOnce()
  })

  it('refuses a currency the selected merchant has not reported', async () => {
    await expect(save({ settlementCurrency: 'CAD' }).result).rejects.toThrow(
      'has not been reported'
    )
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses an account without settlement evidence in this organization', async () => {
    await expect(save({ processorAccountId: 'foreign-merchant' }).result).rejects.toThrow(
      'settlement account with imported'
    )
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses duplicate gateway ownership of a merchant and settlement currency', async () => {
    h.others = [{ id: 'gateway-other', name: 'Other store gateway' }]
    h.values['gateway-other'] = selectedValues()
    await expect(save().result).rejects.toThrow('already assigned to Other store gateway')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('allows another merchant to use the same bank and chart accounts', async () => {
    h.others = [{ id: 'gateway-other', name: 'Other store gateway' }]
    h.values['gateway-other'] = selectedValues('merchant-other')
    await save().result
    expect(h.update).toHaveBeenCalledOnce()
  })

  it.each([
    'manual',
    'stripe',
  ])('keeps the explicit merchant independent of the legacy %s reader', async (source) => {
    h.gateway.settlementSource = source
    await save().result
    expect(h.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ [attributes[0]]: 'merchant-1' })
    )
  })

  it('selects the exact merchant when several accounts use the same provider', async () => {
    h.accounts.unshift({
      processorAccountId: 'another-merchant',
      providerKey: 'shopify_payments',
      currencies: ['CAD'],
    })
    await save().result
    expect(h.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ [attributes[0]]: 'merchant-1' })
    )
  })

  it('reports incomplete settings without inventing selections', async () => {
    h.values['gateway-1'] = []
    const { db } = database()
    const settings = await getGatewaySettlementReadiness(db, {
      organizationId,
      gatewayId: 'gateway-1',
    })
    expect(settings).toMatchObject({
      configured: false,
    })
    expect(settings.issues).toEqual([
      'Select a settlement currency.',
      'Select the receiving bank account.',
    ])
  })

  it('refuses saving when required field metadata is missing', async () => {
    h.fields[attributes[2]] = null
    await expect(save().result).rejects.toThrow('Update the payment gateway fields')
    expect(h.update).not.toHaveBeenCalled()
  })
})
