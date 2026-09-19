// packages/lib/src/resources/registry/resources/customer-transaction-fields.ts
import { financialSourceField, financialSourceRelationship } from './financial-source-fields'
/** Normal mapped fields for customer transaction records. */
export const CUSTOMER_TRANSACTION_FIELDS = {
  sourceKey: financialSourceField(
    'sourceKey',
    'Source identity',
    'customer_transaction_source_key'
  ),
  providerKey: financialSourceField(
    'providerKey',
    'Source provider',
    'customer_transaction_provider_key'
  ),
  externalAccountId: financialSourceField(
    'externalAccountId',
    'Source account',
    'customer_transaction_account_id'
  ),
  environment: financialSourceField(
    'environment',
    'Environment',
    'customer_transaction_environment'
  ),
  externalId: financialSourceField('externalId', 'Source ID', 'customer_transaction_external_id'),
  acquisitionId: financialSourceField(
    'acquisitionId',
    'Acquisition ID',
    'customer_transaction_acquisition_id'
  ),
  acquiredAt: financialSourceField('acquiredAt', 'Acquired at', 'customer_transaction_acquired_at'),
  raw: financialSourceField('raw', 'Source payload', 'customer_transaction_raw', 'json'),
  rejectionReason: financialSourceField(
    'rejectionReason',
    'Source issue',
    'customer_transaction_rejection_reason'
  ),
  kind: financialSourceField('kind', 'Kind', 'customer_transaction_kind'),
  status: financialSourceField('status', 'Status', 'customer_transaction_status'),
  amount: financialSourceField('amount', 'Amount', 'customer_transaction_amount'),
  currency: financialSourceField('currency', 'Currency', 'customer_transaction_currency'),
  processedAt: financialSourceField(
    'processedAt',
    'Processed at',
    'customer_transaction_processed_at'
  ),
  gateway: financialSourceField('gateway', 'Gateway', 'customer_transaction_gateway'),
  settlementCurrency: financialSourceField(
    'settlementCurrency',
    'Settlement currency',
    'customer_transaction_settlement_currency'
  ),
  parentTransactionId: financialSourceField(
    'parentTransactionId',
    'Parent transaction ID',
    'customer_transaction_parent_transaction_id'
  ),
  creditMemoExternalId: financialSourceField(
    'creditMemoExternalId',
    'Source credit memo ID',
    'customer_transaction_credit_memo_id'
  ),
  paymentId: financialSourceField(
    'paymentId',
    'Payment reference',
    'customer_transaction_payment_id'
  ),
  // Authorize.net's own two ids, carried on a Shopify transaction: the gateway id
  // is derived from `receiptJson` and is the join §6 of the Authorize.net plan needs.
  authorizationCode: financialSourceField(
    'authorizationCode',
    'Authorization code',
    'customer_transaction_authorization_code'
  ),
  gatewayTransactionId: financialSourceField(
    'gatewayTransactionId',
    'Gateway transaction ID',
    'customer_transaction_gateway_transaction_id'
  ),
  test: financialSourceField('test', 'Test', 'customer_transaction_test', 'boolean'),
  sourceUpdatedAt: financialSourceField(
    'sourceUpdatedAt',
    'Source updated at',
    'customer_transaction_source_updated_at'
  ),
  orderExternalId: financialSourceField(
    'orderExternalId',
    'Source order ID',
    'customer_transaction_order_external_id'
  ),
  order: financialSourceRelationship(
    'order',
    'Order',
    'customer_transaction_order',
    'order',
    'paymentTransactions'
  ),
}
