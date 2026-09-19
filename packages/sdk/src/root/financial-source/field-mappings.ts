// packages/sdk/src/root/financial-source/field-mappings.ts
// Provider facts use ordinary connector field mappings.

import type { FinancialSourceFieldMapping } from './types.js'

/** Maps a projected payout header (`payoutSourceFields`) onto the platform `payout` kind. */
export const payoutFieldMappings: readonly FinancialSourceFieldMapping[] = [
  { sourcePath: 'sourceKey', target: 'payout_source_source_key', match: true },
  { sourcePath: 'providerKey', target: 'payout_source_provider_key' },
  { sourcePath: 'externalAccountId', target: 'payout_source_account_id' },
  { sourcePath: 'environment', target: 'payout_source_environment' },
  { sourcePath: 'externalId', target: 'payout_source_external_id' },
  { sourcePath: 'acquisitionId', target: 'payout_source_acquisition_id' },
  { sourcePath: 'acquiredAt', target: 'payout_source_acquired_at' },
  { sourcePath: 'raw', target: 'payout_source_raw' },
  { sourcePath: 'rejectionReason', target: 'payout_source_rejection_reason' },
  { sourcePath: 'amount', target: 'payout_source_amount' },
  { sourcePath: 'currency', target: 'payout_source_currency' },
  { sourcePath: 'currencyExponent', target: 'payout_source_currency_exponent' },
  { sourcePath: 'status', target: 'payout_source_status' },
  { sourcePath: 'issuedAt', target: 'payout_source_issued_at' },
  { sourcePath: 'issuedOn', target: 'payout_source_issued_on' },
  { sourcePath: 'destinationExternalId', target: 'payout_source_destination_id' },
  { sourcePath: 'membership', target: 'payout_source_membership' },
]

/**
 * Maps a projected processor transaction (`processorSourceFields`) onto the
 * platform `processor_balance_entry` kind — as a stream root, or as the child
 * rows `payoutSourceFields` fans out.
 */
export const processorFieldMappings: readonly FinancialSourceFieldMapping[] = [
  { sourcePath: 'sourceKey', target: 'processor_balance_source_key', match: true },
  { sourcePath: 'providerKey', target: 'processor_balance_provider_key' },
  { sourcePath: 'externalAccountId', target: 'processor_balance_account_id' },
  { sourcePath: 'environment', target: 'processor_balance_environment' },
  { sourcePath: 'externalId', target: 'processor_balance_external_id' },
  { sourcePath: 'acquisitionId', target: 'processor_balance_acquisition_id' },
  { sourcePath: 'acquiredAt', target: 'processor_balance_acquired_at' },
  { sourcePath: 'raw', target: 'processor_balance_raw' },
  { sourcePath: 'rejectionReason', target: 'processor_balance_rejection_reason' },
  { sourcePath: 'type', target: 'processor_balance_type' },
  { sourcePath: 'providerType', target: 'processor_balance_provider_type' },
  { sourcePath: 'gross', target: 'processor_balance_gross' },
  { sourcePath: 'fee', target: 'processor_balance_fee' },
  { sourcePath: 'net', target: 'processor_balance_net' },
  { sourcePath: 'currency', target: 'processor_balance_currency' },
  { sourcePath: 'currencyExponent', target: 'processor_balance_currency_exponent' },
  { sourcePath: 'transactionDate', target: 'processor_balance_transaction_date' },
  { sourcePath: 'payoutId', target: 'processor_balance_payout_id' },
  { sourcePath: 'sourceTransactionId', target: 'processor_balance_transaction_id' },
  { sourcePath: 'sourceOrderId', target: 'processor_balance_order_id' },
  { sourcePath: 'sourceId', target: 'processor_balance_source_id' },
  { sourcePath: 'sourceType', target: 'processor_balance_source_type' },
  { sourcePath: 'sourceReference', target: 'processor_balance_source_reference' },
  { sourcePath: 'page', target: 'processor_balance_page' },
]

/**
 * Maps one projected order payment transaction (`orderPaymentSourceFields`
 * fans these out) onto the platform `customer_transaction` kind.
 */
export const customerTransactionFieldMappings: readonly FinancialSourceFieldMapping[] = [
  { sourcePath: 'sourceKey', target: 'customer_transaction_source_key', match: true },
  { sourcePath: 'providerKey', target: 'customer_transaction_provider_key' },
  { sourcePath: 'externalAccountId', target: 'customer_transaction_account_id' },
  { sourcePath: 'environment', target: 'customer_transaction_environment' },
  { sourcePath: 'externalId', target: 'customer_transaction_external_id' },
  { sourcePath: 'acquisitionId', target: 'customer_transaction_acquisition_id' },
  { sourcePath: 'acquiredAt', target: 'customer_transaction_acquired_at' },
  { sourcePath: 'raw', target: 'customer_transaction_raw' },
  { sourcePath: 'rejectionReason', target: 'customer_transaction_rejection_reason' },
  { sourcePath: 'kind', target: 'customer_transaction_kind' },
  { sourcePath: 'status', target: 'customer_transaction_status' },
  { sourcePath: 'amount', target: 'customer_transaction_amount' },
  { sourcePath: 'currency', target: 'customer_transaction_currency' },
  { sourcePath: 'processedAt', target: 'customer_transaction_processed_at' },
  { sourcePath: 'gateway', target: 'customer_transaction_gateway' },
  { sourcePath: 'settlementCurrency', target: 'customer_transaction_settlement_currency' },
  { sourcePath: 'parentTransactionId', target: 'customer_transaction_parent_transaction_id' },
  { sourcePath: 'creditMemoExternalId', target: 'customer_transaction_credit_memo_id' },
  { sourcePath: 'paymentId', target: 'customer_transaction_payment_id' },
  { sourcePath: 'authorizationCode', target: 'customer_transaction_authorization_code' },
  {
    sourcePath: 'gatewayTransactionId',
    target: 'customer_transaction_gateway_transaction_id',
  },
  { sourcePath: 'test', target: 'customer_transaction_test' },
  { sourcePath: 'sourceUpdatedAt', target: 'customer_transaction_source_updated_at' },
  { sourcePath: 'orderExternalId', target: 'customer_transaction_order_external_id' },
]
