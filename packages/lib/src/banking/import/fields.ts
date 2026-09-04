// packages/lib/src/banking/import/fields.ts

/**
 * The `bank_transaction` field ids the import path reads and writes.
 *
 * A local context rather than a widening of `banking/reads.ts`'s
 * {@link BankTransactionFieldContext}: that one resolves the two attributes the
 * COVERAGE derivation needs and is on the settings page's hot path, and adding
 * eleven more attributes to it would make every bank-accounts render resolve
 * fields nothing on that page reads.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toDateKey } from '../client'

/** Every attribute the importer stamps, links on, or refuses on. */
export const BANK_TRANSACTION_IMPORT_ATTRIBUTES = [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_match_key',
  'bank_transaction_import_batch_id',
  'bank_transaction_source',
  'bank_transaction_review_status',
  'bank_transaction_gl_posting_id',
  'bank_transaction_exclude_reason',
  'bank_transaction_matched_record_id',
  'bank_transaction_matched_record_type',
] as const

export type BankTransactionImportAttribute = (typeof BANK_TRANSACTION_IMPORT_ATTRIBUTES)[number]

/** The def id plus every resolved field, `null` for one the org has not got. */
export interface BankTransactionImportContext {
  bankTransactionDefId: string
  fields: Record<BankTransactionImportAttribute, { id: string } | null>
}

/**
 * Resolve the def and its fields, or refuse.
 *
 * A refusal rather than `null`: every caller here either writes or reports what
 * a write would do, and both are worse silent. The unmigrated-org empty state is
 * the settings page's job (`loadBankAccountFieldContext`).
 */
export async function requireBankTransactionImportContext(
  organizationId: string
): Promise<BankTransactionImportContext> {
  const bankTransactionDefId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!bankTransactionDefId) {
    throw new UnprocessableEntityError(
      'Bank transactions are not available until the bank transaction entity is provisioned ' +
        '(entity migration 125)'
    )
  }
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      ...BANK_TRANSACTION_IMPORT_ATTRIBUTES,
    ])) as BankTransactionImportContext['fields']

  // Without the account link and the date there is no statement line at all:
  // nothing could be scoped to an account or placed in a period.
  if (!fields.bank_transaction_bank_account || !fields.bank_transaction_posted_at) {
    throw new UnprocessableEntityError(
      'The bank transaction entity is missing its account link or its date field. Re-run entity ' +
        'migration 125 for this organization.'
    )
  }
  return { bankTransactionDefId, fields }
}

/** One `bank_transaction`, flattened to what the import path reasons about. */
export interface BankTransactionRow {
  id: string
  createdAt: Date | null
  externalId: string | null
  bankAccountId: string | null
  postedAt: string | null
  description: string | null
  /** Signed integer minor units. `null` when the row never got one. */
  amountMinor: number | null
  matchKey: string | null
  importBatchId: string | null
  /** `feed` or `import`; `null` on a row nothing has stamped yet. */
  source: string | null
  reviewStatus: string | null
  /**
   * Why a line was excluded, or null.
   *
   * Read here because `refusalReason` needs it: an `excluded` row is a person's
   * decision unless the IMPORT wrote the reason itself, and a reverse hard-deletes
   * what it does not refuse.
   */
  excludeReason: string | null
  glPostingId: string | null
}

/**
 * Every transaction on one account.
 *
 * Two queries: the link values, then every other field value for those ids. A
 * post-read `.filter()` would pull every statement line in the ORG into memory
 * to answer a question about one account.
 */
export async function readTransactionsByAccount(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  bankAccountId: string
): Promise<BankTransactionRow[]> {
  const linkFieldId = ctx.fields.bank_transaction_bank_account?.id
  if (!linkFieldId) return []

  const linked = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, linkFieldId),
        eq(schema.FieldValue.relatedEntityId, bankAccountId)
      )
    )

  return hydrateTransactions(db, organizationId, ctx, [
    ...new Set(linked.map((row) => row.entityId)),
  ])
}

/** Every transaction stamped with one import batch. */
export async function readTransactionsByBatch(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  importBatchId: string
): Promise<BankTransactionRow[]> {
  const batchFieldId = ctx.fields.bank_transaction_import_batch_id?.id
  if (!batchFieldId) return []

  const rows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, batchFieldId),
        eq(schema.FieldValue.valueText, importBatchId)
      )
    )

  return hydrateTransactions(db, organizationId, ctx, [...new Set(rows.map((r) => r.entityId))])
}

/** Turn a set of instance ids into full rows with a bounded number of queries. */
export async function hydrateTransactions(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  instanceIds: string[]
): Promise<BankTransactionRow[]> {
  if (instanceIds.length === 0) return []

  const instances = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.bankTransactionDefId),
        inArray(schema.EntityInstance.id, instanceIds)
      )
    )
  if (instances.length === 0) return []

  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(
          schema.FieldValue.entityId,
          instances.map((row) => row.id)
        ),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const read = (instanceId: string, attribute: BankTransactionImportAttribute) => {
    const fieldId = ctx.fields[attribute]?.id
    return fieldId ? (byInstance.get(instanceId)?.get(fieldId) ?? null) : null
  }

  return instances.map((instance) => {
    const postedAt = read(instance.id, 'bank_transaction_posted_at')?.valueDate
    const amount = read(instance.id, 'bank_transaction_amount')?.valueNumber
    return {
      id: instance.id,
      createdAt: instance.createdAt,
      externalId: read(instance.id, 'bank_transaction_external_id')?.valueText ?? null,
      bankAccountId: read(instance.id, 'bank_transaction_bank_account')?.relatedEntityId ?? null,
      postedAt: postedAt ? toDateKey(postedAt) : null,
      description: read(instance.id, 'bank_transaction_description')?.valueText ?? null,
      // `valueNumber` is a double and the column is minor units, so round rather
      // than truncate: a value that round-tripped as 12449.999999 must read 12450.
      amountMinor: amount == null ? null : Math.round(amount),
      matchKey: read(instance.id, 'bank_transaction_match_key')?.valueText ?? null,
      importBatchId: read(instance.id, 'bank_transaction_import_batch_id')?.valueText ?? null,
      source: read(instance.id, 'bank_transaction_source')?.optionId ?? null,
      reviewStatus: read(instance.id, 'bank_transaction_review_status')?.optionId ?? null,
      excludeReason: read(instance.id, 'bank_transaction_exclude_reason')?.valueText ?? null,
      glPostingId: read(instance.id, 'bank_transaction_gl_posting_id')?.valueText ?? null,
    } satisfies BankTransactionRow
  })
}
