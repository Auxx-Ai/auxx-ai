// packages/lib/src/accounting/mirror/provider-vendors.ts

import type { Database } from '@auxx/database'
import { resolveProviderParties } from './provider-customers'

/** `providerVendorId -> company id`: a provider Vendor is one of our `company` records. */
export function resolveProviderVendors(
  db: Database,
  organizationId: string,
  providerId: string,
  providerVendorIds: readonly string[]
): Promise<Map<string, string>> {
  return resolveProviderParties(db, organizationId, providerId, 'vendor', providerVendorIds)
}
