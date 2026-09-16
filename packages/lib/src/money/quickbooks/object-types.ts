// packages/lib/src/money/quickbooks/object-types.ts
import type { DeliveryObjectType } from '@auxx/database'
import { UnprocessableEntityError } from '../../errors'

/**
 * The ONE place the platform's neutral object vocabulary becomes Intuit's.
 *
 * 🛑 Decision D14a: nothing above the `AccountingProvider` seam names
 * QuickBooks, and D14b made the delivery tables speak `journal` / `customer` /
 * `invoice` / `payment` / `credit_memo` rather than Intuit's `JournalEntry` /
 * `Customer` / …. The cost of that lands here, deliberately: a second adapter
 * writes its own map (Xero's `ManualJournal`, `Contact`,
 * `SalesCreditNote`) and every platform table keeps working unchanged.
 */
const TO_QUICKBOOKS = {
  journal: 'JournalEntry',
  customer: 'Customer',
  invoice: 'Invoice',
  payment: 'Payment',
  credit_memo: 'CreditMemo',
} as const satisfies Record<DeliveryObjectType, string>

type QuickbooksObjectType = (typeof TO_QUICKBOOKS)[DeliveryObjectType]

const FROM_QUICKBOOKS = Object.fromEntries(
  Object.entries(TO_QUICKBOOKS).map(([neutral, provider]) => [provider, neutral])
) as Record<string, DeliveryObjectType | undefined>

/**
 * Journal-line party vocabulary, which is a second QuickBooks spelling of the
 * same idea. The platform's own counterparty values are `customer` / `vendor`
 * (`postings/types.ts` `CounterpartyType`); `employee` exists on the QuickBooks
 * wire and has no platform counterparty today, so it translates to itself in
 * lower case rather than being dropped.
 */
const TO_QUICKBOOKS_PARTY = {
  customer: 'Customer',
  vendor: 'Vendor',
  employee: 'Employee',
} as const

const FROM_QUICKBOOKS_PARTY = Object.fromEntries(
  Object.entries(TO_QUICKBOOKS_PARTY).map(([neutral, provider]) => [provider, neutral])
) as Record<string, string | undefined>

/** Neutral platform object type to the QuickBooks entity name. */
export function toQuickbooksObjectType(type: DeliveryObjectType): QuickbooksObjectType {
  return TO_QUICKBOOKS[type]
}

/** QuickBooks entity name back to the neutral platform object type. */
export function toNeutralObjectType(type: string): DeliveryObjectType {
  const neutral = FROM_QUICKBOOKS[type]
  if (!neutral) throw new UnprocessableEntityError(`Unknown QuickBooks object type ${type}`)
  return neutral
}

/** Neutral counterparty type to the QuickBooks journal-line entity type. */
export function toQuickbooksPartyType(type: string): string {
  const provider = TO_QUICKBOOKS_PARTY[type as keyof typeof TO_QUICKBOOKS_PARTY]
  if (!provider) throw new UnprocessableEntityError(`Unknown counterparty type ${type}`)
  return provider
}

/**
 * QuickBooks journal-line entity type back to the neutral counterparty type.
 *
 * 🔑 Used by the delivery readback proof: prepared and remote lines are both
 * translated to neutral BEFORE they are compared, so the comparison is about
 * accounting identity rather than about which provider spelled the party.
 */
export function toNeutralPartyType(type: string): string {
  const neutral = FROM_QUICKBOOKS_PARTY[type]
  if (!neutral) throw new UnprocessableEntityError(`Unknown QuickBooks party type ${type}`)
  return neutral
}
