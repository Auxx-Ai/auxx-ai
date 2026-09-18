// packages/lib/src/resources/registry/resources/payout-source-fields.ts
import { financialSourceField, financialSourceRelationship } from './financial-source-fields'
/**
 * Normal mapped fields for payout source records.
 *
 * Deliberately NOT wrapped in `defineResourceFields`: `payout-fields.ts` maps
 * these keys under a `source_` prefix and needs the literal key shape a
 * declared map hides.
 */
export const PAYOUT_SOURCE_FIELDS = {
  sourceKey: financialSourceField(
    'source_sourceKey',
    'Reported source identity',
    'payout_source_source_key'
  ),
  providerKey: financialSourceField(
    'source_providerKey',
    'Reported source provider',
    'payout_source_provider_key'
  ),
  externalAccountId: financialSourceField(
    'source_externalAccountId',
    'Reported source account',
    'payout_source_account_id'
  ),
  environment: financialSourceField(
    'source_environment',
    'Reported environment',
    'payout_source_environment'
  ),
  externalId: financialSourceField(
    'source_externalId',
    'Reported source id',
    'payout_source_external_id'
  ),
  acquisitionId: financialSourceField(
    'source_acquisitionId',
    'Reported acquisition id',
    'payout_source_acquisition_id'
  ),
  acquiredAt: financialSourceField(
    'source_acquiredAt',
    'Reported acquired at',
    'payout_source_acquired_at'
  ),
  raw: financialSourceField('source_raw', 'Reported source payload', 'payout_source_raw', 'json'),
  rejectionReason: financialSourceField(
    'source_rejectionReason',
    'Reported source issue',
    'payout_source_rejection_reason'
  ),
  amount: financialSourceField('source_amount', 'Reported amount', 'payout_source_amount'),
  currency: financialSourceField('source_currency', 'Reported currency', 'payout_source_currency'),
  currencyExponent: financialSourceField(
    'source_currencyExponent',
    'Reported currency decimals',
    'payout_source_currency_exponent',
    'number'
  ),
  status: financialSourceField('source_status', 'Reported status', 'payout_source_status'),
  issuedAt: financialSourceField(
    'source_issuedAt',
    'Reported issued at',
    'payout_source_issued_at'
  ),
  issuedOn: financialSourceField(
    'source_issuedOn',
    'Reported issued on',
    'payout_source_issued_on'
  ),
  destinationExternalId: financialSourceField(
    'source_destinationExternalId',
    'Reported destination id',
    'payout_source_destination_id'
  ),
  membership: financialSourceField(
    'source_membership',
    'Reported membership history',
    'payout_source_membership',
    'json'
  ),
  processorEntries: financialSourceRelationship(
    'processorEntries',
    'Processor transactions',
    'payout_processor_entries',
    'processor_balance_entry',
    'payout',
    true
  ),
}
