// packages/lib/src/accounting/money/bank-deposits/fields.ts

/**
 * The def-and-field contexts every bank-deposit read and write resolves before
 * it touches a row, picked from the registry rather than re-typed here.
 *
 * Two entities: `bank_deposit` itself, and the `bank_account` slice a deposit
 * needs to name the account it is banked into.
 *
 * 🛑 The account is read through the entity layer rather than by importing
 * `banking/`. `banking/review/writes.ts` already imports `clearBankDeposit`
 * from this module, so a `money -> banking` import would close a cycle - the
 * same backwards edge `plans/bank-connection/09-data-connector-debt.md` D1 was
 * about, one feature over.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { BANK_DEPOSIT_FIELDS } from '../../../resources/registry/resources/bank-deposit-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import { type SystemFieldContext, systemFields } from '../../../resources/system-records'

type ReadDb = Database | Transaction | undefined

/** Every `bank_deposit` attribute a `BankDepositRecord` is assembled from. */
export const BANK_DEPOSIT_ATTRIBUTES = pickSystemAttributes(BANK_DEPOSIT_FIELDS, [
  'bank_deposit_number',
  'bank_deposit_date',
  'bank_deposit_bank_account',
  'bank_deposit_bank_account_record',
  'bank_deposit_reference',
  'bank_deposit_status',
  'bank_deposit_total',
  'bank_deposit_bank_transaction_id',
  'bank_deposit_cleared_at',
  'bank_deposit_reconciled_at',
] as const)

export type BankDepositAttribute = (typeof BANK_DEPOSIT_ATTRIBUTES)[number]

/** The resolved def and field ids every deposit read needs. */
export type BankDepositFieldContext = SystemFieldContext<BankDepositAttribute>

/** The `bank_account` slice a deposit reads to name and post the account it lands in. */
export const DEPOSIT_BANK_ACCOUNT_ATTRIBUTES = pickSystemAttributes(BANK_ACCOUNT_FIELDS, [
  'bank_account_name',
  'bank_account_gl_account',
] as const)

export type DepositBankAccountAttribute = (typeof DEPOSIT_BANK_ACCOUNT_ATTRIBUTES)[number]

/** The resolved `bank_account` def and the fields a deposit reads off it. */
export type DepositBankAccountContext = SystemFieldContext<DepositBankAccountAttribute>

/**
 * Resolve the `bank_deposit` def and its fields, or `null` when the org has not
 * run entity migration 125 yet.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty instead of 500ing. The WRITE paths call
 * {@link requireBankDepositFieldContext} instead: a write that silently did
 * nothing would be worse than a refusal.
 */
export async function loadBankDepositFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankDepositFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'bank_deposit', BANK_DEPOSIT_ATTRIBUTES)
  // Without `status` and `total` there is no deposit at all: the freeze rule and
  // the sum-must-equal-the-payments rule both reduce to "yes".
  if (!ctx?.fields.bank_deposit_status || !ctx.fields.bank_deposit_total) return null
  return ctx
}

/** {@link loadBankDepositFieldContext}, as the refusal a write path needs. */
export async function requireBankDepositFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankDepositFieldContext> {
  const ctx = await loadBankDepositFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank deposits are not available until the bank deposit entity and its fields are ' +
        'provisioned (entity migration 125)'
    )
  }
  return ctx
}

/**
 * {@link requireBankDepositFieldContext} plus the link to the bank account.
 *
 * 🛑 Separate from the plain require, and only the CREATE path asks for it. A
 * deposit written without the link records the GL code alone, and a code cannot
 * be resolved back to an account (several map to one), so the row would sit
 * permanently outside the removal gate - the hole entity migration 135 closes.
 *
 * ⚠️ Clearing and correcting must NOT go through here. Neither writes the link,
 * and refusing them on an org that has 125 but not yet 135 would break matching
 * a bank line to a deposit that already exists - a path this field has nothing
 * to do with, between a deploy and the migration run.
 */
export async function requireBankDepositWriteContext(
  db: ReadDb,
  organizationId: string
): Promise<BankDepositFieldContext> {
  const ctx = await requireBankDepositFieldContext(db, organizationId)
  if (!ctx.fields.bank_deposit_bank_account_record) {
    throw new UnprocessableEntityError(
      'Recording a bank deposit is not available until the deposit bank account link is ' +
        'provisioned (entity migration 135)'
    )
  }
  return ctx
}

/**
 * Resolve the `bank_account` def and the fields a deposit reads off it.
 *
 * `null` when the org has no `bank_account` def, which is every org short of
 * entity migration 125.
 */
export async function loadDepositBankAccountContext(
  db: ReadDb,
  organizationId: string
): Promise<DepositBankAccountContext | null> {
  return systemFields(db, organizationId, 'bank_account', DEPOSIT_BANK_ACCOUNT_ATTRIBUTES)
}

/**
 * {@link loadDepositBankAccountContext}, as the refusal a write path needs.
 *
 * 🛑 The chart mapping is required, not optional. Without
 * `bank_account_gl_account` there is no account to debit and a deposit could
 * only be posted by guessing at a code the operator never named.
 */
export async function requireDepositBankAccountContext(
  db: ReadDb,
  organizationId: string
): Promise<DepositBankAccountContext> {
  const ctx = await loadDepositBankAccountContext(db, organizationId)
  if (!ctx?.fields.bank_account_gl_account) {
    throw new UnprocessableEntityError(
      'Banking a payment is not available until the bank account entity and its chart mapping ' +
        'are provisioned (entity migration 125)'
    )
  }
  return ctx
}
