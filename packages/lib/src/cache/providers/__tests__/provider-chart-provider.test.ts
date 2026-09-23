// packages/lib/src/cache/providers/__tests__/provider-chart-provider.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readActiveBookCompanyId = vi.fn()
vi.mock('../../../accounting/providers/book-connections', () => ({
  readActiveBookCompanyId: (...a: unknown[]) => readActiveBookCompanyId(...a),
}))

const listProviderAccounts = vi.fn()
const resolveAccountingProvider = vi.fn()
const registerAccountingProviders = vi.fn()
vi.mock('../../../accounting/providers/accounting-providers', () => ({
  registerAccountingProviders: (...a: unknown[]) => registerAccountingProviders(...a),
}))
vi.mock('../../../accounting/providers/provider', () => ({
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

import { providerChartProvider } from '../provider-chart-provider'

const db = {} as never
const ACCOUNTS = [
  {
    id: '92',
    name: 'Inventory',
    fullyQualifiedName: 'Inventory',
    number: null,
    accountType: 'Other Current Asset',
    classification: 'asset',
    active: true,
    parentId: null,
  },
  {
    id: '11',
    name: 'Retired',
    fullyQualifiedName: 'Retired',
    number: null,
    accountType: 'Other Current Asset',
    classification: 'asset',
    active: false,
    parentId: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  resolveAccountingProvider.mockResolvedValue({ id: 'quickbooks', listProviderAccounts })
})

describe('providerChartProvider', () => {
  it('caches null without asking the provider when no book is active', async () => {
    readActiveBookCompanyId.mockResolvedValue(null)

    expect(await providerChartProvider.compute('org1', db)).toBeNull()
    expect(resolveAccountingProvider).not.toHaveBeenCalled()
    expect(registerAccountingProviders).not.toHaveBeenCalled()
  })

  it('stamps the active company and keeps inactive accounts', async () => {
    readActiveBookCompanyId.mockResolvedValue('realm1')
    listProviderAccounts.mockResolvedValue(ok(ACCOUNTS))

    expect(await providerChartProvider.compute('org1', db)).toEqual({
      companyId: 'realm1',
      accounts: ACCOUNTS,
    })
    expect(listProviderAccounts).toHaveBeenCalledWith('org1')
    expect(registerAccountingProviders.mock.invocationCallOrder[0]).toBeLessThan(
      resolveAccountingProvider.mock.invocationCallOrder[0]!
    )
  })

  it('does not cache an empty chart when the active book provider is unavailable', async () => {
    readActiveBookCompanyId.mockResolvedValue('realm1')
    resolveAccountingProvider.mockResolvedValue({ id: 'none', listProviderAccounts })

    await expect(providerChartProvider.compute('org1', db)).rejects.toThrow(
      'The active accounting book provider is unavailable'
    )
    expect(listProviderAccounts).not.toHaveBeenCalled()
  })

  it("throws the provider's own error so nothing is cached", async () => {
    readActiveBookCompanyId.mockResolvedValue('realm1')
    listProviderAccounts.mockResolvedValue(err(new Error('Could not read the chart')))

    await expect(providerChartProvider.compute('org1', db)).rejects.toThrow(
      'Could not read the chart'
    )
  })
})
