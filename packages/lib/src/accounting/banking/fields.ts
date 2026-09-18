// packages/lib/src/accounting/banking/fields.ts

/**
 * The def-and-field contexts every banking read and write resolves before it
 * touches a row, picked from the registry rather than re-typed here.
 *
 * The `load*` variants return null when the org is short of entity migration
 * 125 or of the fields without which the surface is a constant — a LIST on such
 * an org renders empty rather than 500 — and the `require*` variants refuse
 * instead, because a write that silently did nothing would be worse.
 *
 * Four different slices of `bank_transaction` live here rather than one: the
 * coverage derivation is on the settings page's hot path and reads two fields,
 * where the review queue assembles nineteen. Resolving the queue's set for every
 * settings render would be work nothing on that page reads.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../errors'
import { BANK_ACCOUNT_FIELDS } from '../../resources/registry/resources/bank-account-fields'
import { BANK_RULE_FIELDS } from '../../resources/registry/resources/bank-rule-fields'
import { BANK_TRANSACTION_FIELDS } from '../../resources/registry/resources/bank-transaction-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { type SystemFieldContext, systemFields } from '../../resources/system-records'

type ReadDb = Database | Transaction | undefined

/** Every `bank_account` attribute a `BankAccountRow` is assembled from. */
export const BANK_ACCOUNT_ATTRIBUTES = pickSystemAttributes(BANK_ACCOUNT_FIELDS, [
  'bank_account_name',
  'bank_account_institution',
  'bank_account_last4',
  'bank_account_type',
  'bank_account_currency',
  'bank_account_gl_account',
  'bank_account_settlement_destinations',
  'bank_account_feed_start_date',
  'bank_account_coverage_from',
  'bank_account_coverage_gaps',
  'bank_account_connector_id',
  'bank_account_status',
  'bank_account_has_posted',
] as const)

export type BankAccountAttribute = (typeof BANK_ACCOUNT_ATTRIBUTES)[number]
export type BankAccountFieldContext = SystemFieldContext<BankAccountAttribute>

/** The `bank_transaction` attributes the coverage derivation reads. */
export const BANK_TRANSACTION_COVERAGE_ATTRIBUTES = pickSystemAttributes(BANK_TRANSACTION_FIELDS, [
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_review_status',
  // Read by `readAccountLinesByStatus` so a restore can tell the ARCHIVE's own
  // exclusions from a person's without a second query per row.
  'bank_transaction_exclude_reason',
] as const)

export type BankTransactionCoverageAttribute = (typeof BANK_TRANSACTION_COVERAGE_ATTRIBUTES)[number]
export type BankTransactionFieldContext = SystemFieldContext<BankTransactionCoverageAttribute>

/**
 * Every `bank_transaction` attribute a `BankTransactionRow` is assembled from.
 *
 * The two `suggest*` attributes were once read off `CustomField` by string
 * because slot 3C had not added them to `SystemAttribute` yet; it has, so they
 * are picked here like everything else and a missing one reads as unset.
 */
export const BANK_TRANSACTION_REVIEW_ATTRIBUTES = pickSystemAttributes(BANK_TRANSACTION_FIELDS, [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_bank_status',
  'bank_transaction_match_key',
  'bank_transaction_import_batch_id',
  'bank_transaction_source',
  'bank_transaction_review_status',
  'bank_transaction_gl_account',
  'bank_transaction_matched_record_id',
  'bank_transaction_matched_record_type',
  'bank_transaction_exclude_reason',
  'bank_transaction_reviewed_at',
  'bank_transaction_reviewed_by_user_id',
  'bank_transaction_rule_id',
  'bank_transaction_suggested_gl_account',
  'bank_transaction_suggestion_reason',
] as const)

export type BankTransactionReviewAttribute = (typeof BANK_TRANSACTION_REVIEW_ATTRIBUTES)[number]
export type ReviewFieldContext = SystemFieldContext<BankTransactionReviewAttribute>

/** The `bank_transaction` slice `suggestFromHistory` and `applySuggestions` match on. */
export const BANK_TRANSACTION_MATCH_ATTRIBUTES = pickSystemAttributes(BANK_TRANSACTION_FIELDS, [
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_match_key',
  'bank_transaction_review_status',
  'bank_transaction_gl_account',
] as const)

export type BankTransactionMatchAttribute = (typeof BANK_TRANSACTION_MATCH_ATTRIBUTES)[number]
export type RuleTransactionFieldContext = SystemFieldContext<BankTransactionMatchAttribute>

/** Every attribute the importer stamps, links on, or refuses on. */
export const BANK_TRANSACTION_IMPORT_ATTRIBUTES = pickSystemAttributes(BANK_TRANSACTION_FIELDS, [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_match_key',
  'bank_transaction_import_batch_id',
  'bank_transaction_source',
  'bank_transaction_review_status',
  'bank_transaction_exclude_reason',
  'bank_transaction_matched_record_id',
  'bank_transaction_matched_record_type',
] as const)

export type BankTransactionImportAttribute = (typeof BANK_TRANSACTION_IMPORT_ATTRIBUTES)[number]
export type BankTransactionImportContext = SystemFieldContext<BankTransactionImportAttribute>

/**
 * The raw columns the connector owns and the poster freezes.
 *
 * ⚠️ `matchKey` and `source` are deliberately NOT here. They are derived, not
 * transcribed: re-normalising a description the bank corrected is harmless, and a row's
 * source cannot change. Pinning them would only make a healed description disagree with
 * the key derived from it.
 *
 * 🛑 **`bankStatus` is deliberately NOT here either, and that is a correction.** The
 * fields that corrupt a posting are the ones the entry was BUILT from - the amount, the
 * date, the account, the identity - and `bankStatus` is none of them. What it does carry
 * is the bank withdrawing the transaction: a pending charge that was coded and then
 * VOIDED. The sink drops a pinned field silently (`entity-sink.ts` `buildWriteSet`), so
 * pinning it would leave the row reading `pending` forever, a posting standing in the
 * books for money that never moved, and no signal anywhere - where an unpinned status
 * flips the row to `void`, which is what the queue shows and what `undoReview` is for
 * (a void line is deliberately still undoable).
 */
export const BANK_TRANSACTION_PIN_ATTRIBUTES = pickSystemAttributes(BANK_TRANSACTION_FIELDS, [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
] as const)

export type BankTransactionPinAttribute = (typeof BANK_TRANSACTION_PIN_ATTRIBUTES)[number]
export type BankTransactionPinContext = SystemFieldContext<BankTransactionPinAttribute>

/** Every `bank_rule` attribute a `BankRuleRecord` is assembled from. */
export const BANK_RULE_ATTRIBUTES = pickSystemAttributes(BANK_RULE_FIELDS, [
  'bank_rule_name',
  'bank_rule_enabled',
  'bank_rule_auto_apply',
  'bank_rule_priority',
  'bank_rule_match_field',
  'bank_rule_match_operator',
  'bank_rule_match_value',
  'bank_rule_amount_min',
  'bank_rule_amount_max',
  'bank_rule_direction',
  'bank_rule_bank_account',
  'bank_rule_action',
  'bank_rule_gl_account',
  'bank_rule_counterpart_bank_account',
  'bank_rule_contact',
  'bank_rule_memo',
  'bank_rule_applied_count',
  'bank_rule_last_applied_at',
] as const)

export type BankRuleAttribute = (typeof BANK_RULE_ATTRIBUTES)[number]
export type BankRuleFieldContext = SystemFieldContext<BankRuleAttribute>

/**
 * The `bank_account` context, or `null` when the org has not run entity
 * migration 125 yet.
 *
 * `null` rather than a throw so the settings page on an unmigrated org renders
 * an empty state instead of 500ing. The WRITE paths call
 * {@link requireBankAccountFieldContext} instead: a write that silently did
 * nothing would be worse than a refusal.
 */
export async function loadBankAccountFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankAccountFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'bank_account', BANK_ACCOUNT_ATTRIBUTES)
  // Without `name` and `status` there is no account at all: the display value
  // and the "is this feed live" question both reduce to nothing.
  if (!ctx?.fields.bank_account_name || !ctx.fields.bank_account_status) return null
  return ctx
}

/** {@link loadBankAccountFieldContext}, as the refusal a write path needs. */
export async function requireBankAccountFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankAccountFieldContext> {
  const ctx = await loadBankAccountFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank accounts are not available until the bank account entity and its fields are ' +
        'provisioned (entity migration 125)'
    )
  }
  return ctx
}

/** The coverage slice of `bank_transaction`, or `null` on an unmigrated org. */
export async function loadBankTransactionFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankTransactionFieldContext | null> {
  const ctx = await systemFields(
    db,
    organizationId,
    'bank_transaction',
    BANK_TRANSACTION_COVERAGE_ATTRIBUTES
  )
  if (!ctx?.fields.bank_transaction_posted_at || !ctx.fields.bank_transaction_bank_account)
    return null
  return ctx
}

/** The pinnable slice of `bank_transaction`; no field is required, because the pin loop skips a missing one. */
export function loadBankTransactionPinContext(
  db: ReadDb,
  organizationId: string
): Promise<BankTransactionPinContext | null> {
  return systemFields(db, organizationId, 'bank_transaction', BANK_TRANSACTION_PIN_ATTRIBUTES)
}

/**
 * The review queue's slice of `bank_transaction`, or `null` on an unmigrated org.
 *
 * `null` rather than a throw so the queue on an unmigrated org renders an empty
 * state instead of 500ing. The WRITE paths call {@link requireReviewFieldContext}.
 */
export async function loadReviewFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReviewFieldContext | null> {
  const ctx = await systemFields(
    db,
    organizationId,
    'bank_transaction',
    BANK_TRANSACTION_REVIEW_ATTRIBUTES
  )
  // Without `review_status` and `amount` there is no queue at all: the state
  // filter and every figure on the stat strip both reduce to nothing.
  if (!ctx?.fields.bank_transaction_review_status || !ctx.fields.bank_transaction_amount)
    return null
  return ctx
}

/** {@link loadReviewFieldContext}, as the refusal a write path needs. */
export async function requireReviewFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReviewFieldContext> {
  const ctx = await loadReviewFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'The bank review queue is not available until the bank transaction entity and its ' +
        'fields are provisioned (entity migration 125)'
    )
  }
  return ctx
}

/** The matching slice of `bank_transaction`, or `null` on an unmigrated org. */
export async function loadRuleTransactionFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<RuleTransactionFieldContext | null> {
  const ctx = await systemFields(
    db,
    organizationId,
    'bank_transaction',
    BANK_TRANSACTION_MATCH_ATTRIBUTES
  )
  if (!ctx?.fields.bank_transaction_review_status || !ctx.fields.bank_transaction_amount)
    return null
  return ctx
}

/** {@link loadRuleTransactionFieldContext}, as the refusal a write path needs. */
export async function requireRuleTransactionFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<RuleTransactionFieldContext> {
  const ctx = await loadRuleTransactionFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank transactions are not available until the bank_transaction entity is provisioned ' +
        '(entity migration 125)'
    )
  }
  return ctx
}

/** The `bank_rule` context, or `null` when the org has not run migration 125 yet. */
export async function loadBankRuleFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankRuleFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'bank_rule', BANK_RULE_ATTRIBUTES)
  if (!ctx?.fields.bank_rule_name || !ctx.fields.bank_rule_enabled) return null
  return ctx
}

/** {@link loadBankRuleFieldContext}, as the refusal a write path needs. */
export async function requireBankRuleFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<BankRuleFieldContext> {
  const ctx = await loadBankRuleFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank rules are not available until the bank_rule entity is provisioned (entity ' +
        'migration 125)'
    )
  }
  return ctx
}

/**
 * The importer's slice of `bank_transaction`, or refuse.
 *
 * A refusal rather than `null`: every caller either writes or reports what a
 * write would do, and both are worse silent. The unmigrated-org empty state is
 * the settings page's job ({@link loadBankAccountFieldContext}).
 */
export async function requireBankTransactionImportContext(
  db: ReadDb,
  organizationId: string
): Promise<BankTransactionImportContext> {
  const ctx = await systemFields(
    db,
    organizationId,
    'bank_transaction',
    BANK_TRANSACTION_IMPORT_ATTRIBUTES
  )
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank transactions are not available until the bank transaction entity is provisioned ' +
        '(entity migration 125)'
    )
  }
  // Without the account link and the date there is no statement line at all:
  // nothing could be scoped to an account or placed in a period.
  if (!ctx.fields.bank_transaction_bank_account || !ctx.fields.bank_transaction_posted_at) {
    throw new UnprocessableEntityError(
      'The bank transaction entity is missing its account link or its date field. Re-run entity ' +
        'migration 125 for this organization.'
    )
  }
  return ctx
}
