// packages/lib/src/accounting/providers/provider-chart.ts

import { err, ok, type Result } from 'neverthrow'
import { getCachedProviderChart } from '../../cache'
import type { ProviderAccount } from '../ledger/types'
import { resolveAccountingProvider } from './provider'

/**
 * The connected provider's chart, inactive rows included, from the org cache when a
 * book is active; without one, the live seam call as before (see plans/accounting/tasks/84 §7).
 */
export async function readProviderChart(
  organizationId: string
): Promise<Result<ProviderAccount[], Error>> {
  let cached: Awaited<ReturnType<typeof getCachedProviderChart>>
  try {
    cached = await getCachedProviderChart(organizationId)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
  // A copy: the local cache hands the same array to every reader in its window.
  if (cached) return ok([...cached.accounts])

  const provider = await resolveAccountingProvider(organizationId)
  return provider.listProviderAccounts(organizationId)
}
