// packages/lib/src/money/customer-money/client.ts
/** Customer money inspection shape; amounts remain decimal strings at API boundaries. */
export interface OrderMoneyTransaction {
  id: string
  hasMoneyTransaction: boolean
  purpose: 'customer_receipt' | 'customer_refund' | 'vendor_payment' | 'vendor_refund' | null
  amountMinor: string | null
  currency: string | null
  currencyExponent: number | null
  occurredAt: string | null
  occurredOn: string | null
  reportingProvider: string
  processorRouteId: string | null
  sourceExternalId: string
  status: 'pending' | 'accepted' | 'rejected' | 'blocked'
  reason: string | null
}
