// packages/lib/src/accounting/sales/marketplace-tax/classify.ts

import type { WorkItemCode } from '../../work-items/codes'
import type { MarketplaceTaxBalance } from './reads'

/** Days after an order's last shipment, memo or withholding before a gap is flagged (116 §6). */
export const MARKETPLACE_TAX_GRACE_DAYS = 30

export type MarketplaceTaxCode = Extract<
  WorkItemCode,
  'MARKETPLACE_TAX_NOT_RETURNED' | 'MARKETPLACE_TAX_MISMATCH' | 'MARKETPLACE_TAX_NOT_WITHHELD'
>

export const MARKETPLACE_TAX_CODES: readonly MarketplaceTaxCode[] = [
  'MARKETPLACE_TAX_NOT_RETURNED',
  'MARKETPLACE_TAX_MISMATCH',
  'MARKETPLACE_TAX_NOT_WITHHELD',
]

/** The flag an order's balance earns on `today` (`YYYY-MM-DD`), or `null` when it meets or is in grace. */
export function classifyMarketplaceTax(
  balance: Pick<
    MarketplaceTaxBalance,
    'bookedMinor' | 'returnedMinor' | 'withheldMinor' | 'lastActivityOn'
  >,
  today: string,
  graceDays = MARKETPLACE_TAX_GRACE_DAYS
): MarketplaceTaxCode | null {
  const held = balance.bookedMinor - balance.returnedMinor
  if (held === balance.withheldMinor) return null
  const days = (Date.parse(today) - Date.parse(balance.lastActivityOn)) / 86_400_000
  if (days < graceDays) return null
  if (balance.withheldMinor === 0 && held > 0) return 'MARKETPLACE_TAX_NOT_WITHHELD'
  if (balance.returnedMinor > 0 && balance.withheldMinor > held)
    return 'MARKETPLACE_TAX_NOT_RETURNED'
  return 'MARKETPLACE_TAX_MISMATCH'
}
