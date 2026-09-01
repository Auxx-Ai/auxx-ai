// packages/lib/src/import/resolution/__tests__/resolve-column-currency-fields.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(),
}))
vi.mock('../../../field-values/org-currency', () => ({
  getOrgCurrencyCode: vi.fn(async () => 'EUR'),
}))

const { findCachedResource } = await import('../../../cache')
const { getOrgCurrencyCode } = await import('../../../field-values/org-currency')
const { resolveColumnCurrencyFields } = await import('../resolve-currency-code')

const findCachedResourceMock = vi.mocked(findCachedResource)
const getOrgCurrencyCodeMock = vi.mocked(getOrgCurrencyCode)

const db = {} as never
const scope = { organizationId: 'org_1', entityDefinitionId: 'vendor_part' }

/** A registry field with only what the helper reads. */
function field(key: string, type: string, options?: Record<string, unknown>) {
  return { key, type, options, isSystem: true } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  findCachedResourceMock.mockResolvedValue({
    fields: [
      field('unitPrice', 'currency', { decimals: 5 }),
      field('shippingCost', 'currency', { currencyCode: 'JPY' }),
      field('leadTime', 'number'),
      field('vendorSku', 'string'),
    ],
  } as never)
})

describe('resolveColumnCurrencyFields', () => {
  it('answers only for CURRENCY target fields, whatever the column is read as', async () => {
    const result = await resolveColumnCurrencyFields(db, {
      ...scope,
      targetFieldKeys: ['unitPrice', 'leadTime', 'vendorSku', 'missing'],
    })

    expect([...result.keys()]).toEqual(['unitPrice'])
  })

  it('carries the field precision and resolves the code through field then org', async () => {
    const result = await resolveColumnCurrencyFields(db, {
      ...scope,
      targetFieldKeys: ['unitPrice', 'shippingCost'],
    })

    // A rate field: five places, org currency.
    expect(result.get('unitPrice')).toEqual({ currencyCode: 'EUR', decimals: 5 })
    // A field with its own code and no declared precision.
    expect(result.get('shippingCost')).toEqual({ currencyCode: 'JPY', decimals: undefined })
  })

  it('does not read org settings when no money column is asked about', async () => {
    const result = await resolveColumnCurrencyFields(db, {
      ...scope,
      targetFieldKeys: ['leadTime'],
    })

    expect(result.size).toBe(0)
    expect(getOrgCurrencyCodeMock).not.toHaveBeenCalled()
  })

  it('is empty for an empty key list without touching the cache', async () => {
    const result = await resolveColumnCurrencyFields(db, { ...scope, targetFieldKeys: [] })

    expect(result.size).toBe(0)
    expect(findCachedResourceMock).not.toHaveBeenCalled()
  })
})
