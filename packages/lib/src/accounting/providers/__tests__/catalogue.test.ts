// packages/lib/src/accounting/providers/__tests__/catalogue.test.ts

import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_PROVIDER_CATALOGUE,
  getAccountingProviderByAppSlug,
  getAccountingProviderEntry,
} from '../catalogue'
import { NONE_PROVIDER_ID } from '../provider'
import { QUICKBOOKS_PROVIDER_ID } from '../quickbooks/objects/shared'

describe('accounting provider catalogue', () => {
  it('lists QuickBooks under the id its adapter registers', () => {
    expect(getAccountingProviderEntry(QUICKBOOKS_PROVIDER_ID)?.label).toBe('QuickBooks Online')
    expect(getAccountingProviderByAppSlug('quickbooks')?.id).toBe(QUICKBOOKS_PROVIDER_ID)
  })

  it('has unique ids and never the null provider', () => {
    const ids = ACCOUNTING_PROVIDER_CATALOGUE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(NONE_PROVIDER_ID)
    expect(getAccountingProviderEntry(NONE_PROVIDER_ID)).toBeNull()
    expect(getAccountingProviderEntry(null)).toBeNull()
  })
})
