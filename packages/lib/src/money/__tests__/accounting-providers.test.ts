// packages/lib/src/money/__tests__/accounting-providers.test.ts
//
// plans/accounting/tasks/27-a-settlement-from-anywhere.md §1.5 and §13 test 7.
// `registerAccountingProviders()` is the ONLY thing standing between a posted
// entry and `not_required`: without it `resolveAccountingProvider` answers the
// null provider for every org, the entry is built and persisted, and it never
// reaches QuickBooks. The worker ran `payoutSyncJob` for weeks without calling
// it. What is pinned here:
//
//  - before registration an org WITH QuickBooks installed still resolves to
//    `none` - the failure mode, stated so the fix has something to be measured
//    against;
//  - after registration the same org resolves to the QuickBooks adapter, and
//    an org without it still resolves to `none`;
//  - the adapter is constructed lazily, on first resolution, never at
//    registration;
//  - the installed-apps read failing resolves to `none` rather than throwing.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  installedApps: vi.fn(async (_orgId: string) => [] as { app: { slug: string } }[]),
  createProvider: vi.fn(() => ({ id: 'quickbooks' })),
}))

vi.mock('../../cache', () => ({
  getCachedInstalledApps: h.installedApps,
}))
vi.mock('../quickbooks/quickbooks-accounting-provider', () => ({
  createQuickbooksAccountingProvider: h.createProvider,
}))

import {
  __resetAccountingProvidersForTests,
  NONE_PROVIDER_ID,
  resolveAccountingProvider,
} from '../../postings/provider'
import { registerAccountingProviders } from '../accounting-providers'

const WITH_QBO = 'org_with_quickbooks'
const WITHOUT = 'org_without'

beforeEach(() => {
  vi.clearAllMocks()
  __resetAccountingProvidersForTests()
  h.installedApps.mockImplementation(async (orgId) =>
    orgId === WITH_QBO ? [{ app: { slug: 'quickbooks' } }, { app: { slug: 'shopify' } }] : []
  )
})

describe('before registration', () => {
  it('resolves an org WITH QuickBooks installed to the null provider - the §1.5 defect', async () => {
    const provider = await resolveAccountingProvider(WITH_QBO)
    expect(provider.id).toBe(NONE_PROVIDER_ID)
    expect(h.installedApps).not.toHaveBeenCalled()
  })
})

describe('registerAccountingProviders', () => {
  it('makes an org with QuickBooks installed resolve to the QuickBooks adapter', async () => {
    registerAccountingProviders()

    const provider = await resolveAccountingProvider(WITH_QBO)

    expect(provider.id).toBe('quickbooks')
    expect(h.installedApps).toHaveBeenCalledWith(WITH_QBO)
  })

  it('still resolves an org without QuickBooks to the null provider', async () => {
    registerAccountingProviders()

    const provider = await resolveAccountingProvider(WITHOUT)

    expect(provider.id).toBe(NONE_PROVIDER_ID)
    expect(h.createProvider).not.toHaveBeenCalled()
  })

  it('constructs the adapter lazily, once, on first resolution', async () => {
    registerAccountingProviders()
    expect(h.createProvider).not.toHaveBeenCalled()

    await resolveAccountingProvider(WITH_QBO)
    await resolveAccountingProvider(WITH_QBO)

    expect(h.createProvider).toHaveBeenCalledTimes(1)
  })

  it('is idempotent across a hot reload', async () => {
    registerAccountingProviders()
    registerAccountingProviders()

    const provider = await resolveAccountingProvider(WITH_QBO)
    expect(provider.id).toBe('quickbooks')
  })

  it('keeps postings internal rather than throwing when the installed-apps read fails', async () => {
    registerAccountingProviders()
    h.installedApps.mockRejectedValueOnce(new Error('cache down'))

    const provider = await resolveAccountingProvider(WITH_QBO)

    expect(provider.id).toBe(NONE_PROVIDER_ID)
  })
})
