// packages/lib/src/resources/registry/resources/processor-balance-entry-fields.ts
import { defineResourceFields } from '../system-attributes'
import { financialSourceField, financialSourceRelationship } from './financial-source-fields'
/** Normal mapped fields for processor balance records. */
export const PROCESSOR_BALANCE_ENTRY_FIELDS = defineResourceFields({
  sourceKey: financialSourceField('sourceKey', 'Source identity', 'processor_balance_source_key'),
  providerKey: financialSourceField(
    'providerKey',
    'Source provider',
    'processor_balance_provider_key'
  ),
  externalAccountId: financialSourceField(
    'externalAccountId',
    'Source account',
    'processor_balance_account_id'
  ),
  environment: financialSourceField('environment', 'Environment', 'processor_balance_environment'),
  externalId: financialSourceField('externalId', 'Source ID', 'processor_balance_external_id'),
  acquisitionId: financialSourceField(
    'acquisitionId',
    'Acquisition ID',
    'processor_balance_acquisition_id'
  ),
  acquiredAt: financialSourceField('acquiredAt', 'Acquired at', 'processor_balance_acquired_at'),
  raw: financialSourceField('raw', 'Source payload', 'processor_balance_raw', 'json'),
  rejectionReason: financialSourceField(
    'rejectionReason',
    'Source issue',
    'processor_balance_rejection_reason'
  ),
  type: financialSourceField('type', 'Type', 'processor_balance_type'),
  providerType: financialSourceField(
    'providerType',
    'Source type',
    'processor_balance_provider_type'
  ),
  gross: financialSourceField('gross', 'Gross', 'processor_balance_gross'),
  fee: financialSourceField('fee', 'Fee', 'processor_balance_fee'),
  net: financialSourceField('net', 'Net', 'processor_balance_net'),
  currency: financialSourceField('currency', 'Currency', 'processor_balance_currency'),
  currencyExponent: financialSourceField(
    'currencyExponent',
    'Currency decimals',
    'processor_balance_currency_exponent',
    'number'
  ),
  transactionDate: financialSourceField(
    'transactionDate',
    'Transaction date',
    'processor_balance_transaction_date'
  ),
  payoutId: financialSourceField('payoutId', 'Source payout ID', 'processor_balance_payout_id'),
  sourceTransactionId: financialSourceField(
    'sourceTransactionId',
    'Source payment ID',
    'processor_balance_transaction_id'
  ),
  sourceOrderId: financialSourceField(
    'sourceOrderId',
    'Source order ID',
    'processor_balance_order_id'
  ),
  sourceId: financialSourceField('sourceId', 'Related source ID', 'processor_balance_source_id'),
  sourceType: financialSourceField(
    'sourceType',
    'Related source type',
    'processor_balance_source_type'
  ),
  sourceReference: financialSourceField(
    'sourceReference',
    'Payment reference',
    'processor_balance_source_reference',
    'json'
  ),
  page: financialSourceField('page', 'Acquisition page', 'processor_balance_page', 'json'),
  payout: financialSourceRelationship(
    'payout',
    'Payout',
    'processor_balance_payout',
    'payout',
    'processorEntries'
  ),
})
