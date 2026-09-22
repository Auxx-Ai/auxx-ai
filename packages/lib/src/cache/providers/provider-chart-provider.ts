// packages/lib/src/cache/providers/provider-chart-provider.ts

import type { CachedProviderChart } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/**
 * The active book's live chart, read through the raw seam call. Throws on a provider
 * error so nothing is cached and the reader surfaces the provider's own message.
 */
export const providerChartProvider: CacheProvider<CachedProviderChart | null> = {
  async compute(orgId, db) {
    // Lazy: the accounting modules import the cache singletons.
    const { readActiveBookCompanyId } = await import('../../accounting/providers/book-connections')
    const companyId = await readActiveBookCompanyId(db, orgId)
    if (!companyId) return null

    const { resolveAccountingProvider } = await import('../../accounting/providers/provider')
    const provider = await resolveAccountingProvider(orgId)
    const accounts = await provider.listProviderAccounts(orgId)
    if (accounts.isErr()) throw accounts.error
    return { companyId, accounts: accounts.value }
  },
}
