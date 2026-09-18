// packages/lib/src/accounting/money/payouts/fields.ts

/**
 * The def-and-field contexts every payout read and write resolves before it
 * touches a row, picked from the registry rather than re-typed here.
 *
 * Two entities: `payout` itself, and the `bank_account` slice the destination
 * check reads. The `bank_account` one lives here rather than in `banking/`
 * because a payout reading a neighbour's record asks for the attributes IT
 * wants, not for that module's shaped row.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { PAYOUT_FIELDS } from '../../../resources/registry/resources/payout-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import { type SystemFieldContext, systemFields } from '../../../resources/system-records'

type ReadDb = Database | Transaction | undefined

/** The reported source facts a payout carries alongside its accepted accounting values. */
export const PAYOUT_SOURCE_ATTRIBUTES = pickSystemAttributes(PAYOUT_FIELDS, [
  'payout_source_source_key',
  'payout_source_provider_key',
  'payout_source_account_id',
  'payout_source_environment',
  'payout_source_external_id',
  'payout_source_amount',
  'payout_source_currency',
  'payout_source_currency_exponent',
  'payout_source_status',
  'payout_source_issued_at',
  'payout_source_issued_on',
  'payout_source_rejection_reason',
] as const)

/** Every `payout` attribute a `PayoutRecord` is assembled from. */
export const PAYOUT_ATTRIBUTES = pickSystemAttributes(PAYOUT_FIELDS, [
  ...PAYOUT_SOURCE_ATTRIBUTES,
  'payout_number',
  'payout_gateway_id',
  'payout_status',
  'payout_paid_at',
  'payout_currency',
  'payout_deposited',
  'payout_gross',
  'payout_fees',
  'payout_net',
  'payout_unrecognised_net',
  'payout_unrecognised_count',
  'payout_blocked_reason',
  'payout_bank_transaction_id',
  'payout_payment_gateway',
  'payout_bank_account',
  'payout_source',
  'payout_destination_mismatch',
] as const)

export type PayoutAttribute = (typeof PAYOUT_ATTRIBUTES)[number]
/** The resolved def and field ids every payout read and write needs. */
export type PayoutFieldContext = SystemFieldContext<PayoutAttribute>

/** The `bank_account` slice the settlement-destination check reads. */
export const PAYOUT_BANK_ACCOUNT_ATTRIBUTES = pickSystemAttributes(BANK_ACCOUNT_FIELDS, [
  'bank_account_gl_account',
  'bank_account_settlement_destinations',
] as const)

export type PayoutBankAccountAttribute = (typeof PAYOUT_BANK_ACCOUNT_ATTRIBUTES)[number]
export type PayoutBankAccountFieldContext = SystemFieldContext<PayoutBankAccountAttribute>

/**
 * Resolve the `payout` def and its fields, or `null` when the org has not run
 * entity migration 133 yet.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty instead of 500ing. The WRITE path calls
 * {@link requirePayoutFieldContext}: a sync that silently did nothing would be
 * worse than a refusal, because the clearing account would keep filling and
 * nobody would be told why.
 */
export async function loadPayoutFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<PayoutFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'payout', PAYOUT_ATTRIBUTES)
  // Without the gateway id there is no idempotency key, and without the status
  // there is nothing to transition. Either missing means the def is half-seeded.
  if (!ctx?.fields.payout_gateway_id || !ctx.fields.payout_status) return null
  return ctx
}

/** {@link loadPayoutFieldContext}, as the refusal a write path needs. */
export async function requirePayoutFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<PayoutFieldContext> {
  const ctx = await loadPayoutFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Payouts are not available until the payout entity and its fields are provisioned ' +
        '(entity migration 133)'
    )
  }
  return ctx
}

/** The `bank_account` context, or `null` unless BOTH halves of the destination check exist. */
export async function loadPayoutBankAccountFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<PayoutBankAccountFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'bank_account', PAYOUT_BANK_ACCOUNT_ATTRIBUTES)
  if (!ctx?.fields.bank_account_gl_account || !ctx.fields.bank_account_settlement_destinations)
    return null
  return ctx
}
