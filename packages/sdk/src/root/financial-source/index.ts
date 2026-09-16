// packages/sdk/src/root/financial-source/index.ts

/**
 * `@auxx/sdk/financial-source` — the platform's financial-source contract,
 * expressed as field names.
 *
 * A financial source app (Shopify Payments, Affirm, ...) normalizes its own
 * provider shapes, then hands the platform ordinary record fields. This module
 * is that hand-off: the projection helpers that stamp source identity onto a
 * normalized row, and the connector field mappings that bind those rows onto
 * the platform `payout`, `processor_balance_entry` and `customer_transaction`
 * kinds. Nothing here is provider-specific — every source app imports the same
 * code so the emitted shapes cannot drift apart.
 *
 * Usage:
 * ```ts
 * import {
 *   payoutFieldMappings,
 *   payoutSourceFields,
 *   processorFieldMappings,
 * } from '@auxx/sdk/financial-source'
 *
 * const record = payoutSourceFields({
 *   externalId: deposit.id,
 *   sourceAccount: { providerKey: 'affirm', externalAccountId: accountId, environment: 'live' },
 *   acquisition,
 *   payout,
 *   raw,
 *   rejectionReason: null,
 *   membership,
 * })
 * ```
 */

export {
  customerTransactionFieldMappings,
  payoutFieldMappings,
  processorFieldMappings,
} from './field-mappings.js'
export {
  orderPaymentSourceFields,
  payoutSourceFields,
  processorSourceFields,
} from './source-fields.js'
export type {
  Acquisition,
  FinancialSourceFieldMapping,
  SourceAccount,
  SourceRow,
} from './types.js'
