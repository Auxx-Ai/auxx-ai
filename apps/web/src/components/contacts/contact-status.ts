// apps/web/src/components/contacts/contact-status.ts

import type { Variant } from '@auxx/ui/components/badge'

/**
 * Maps customer status to Badge color variant
 */
export const customerStatusVariantMap: Record<string, Variant> = {
  ACTIVE: 'green',
  SPAM: 'red',
  MERGED: 'yellow',
}

/**
 * Default variant for unknown statuses
 */
export const defaultCustomerStatusVariant: Variant = 'outline'

/**
 * Get badge variant for a customer status
 */
export function getCustomerStatusVariant(status: string): Variant {
  return customerStatusVariantMap[status] ?? defaultCustomerStatusVariant
}
