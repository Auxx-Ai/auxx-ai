// packages/lib/src/banking/reads.ts

/**
 * Every READ over bank accounts and their coverage
 * (plans/bank-connection/02-connection-architecture.md §6, HANDOFF slot 2I).
 *
 * Reads only. The two writes the settings page needs live in `writes.ts`,
 * because a file that both queries and mutates is the first step back toward a
 * service class (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * or `ledgerPost` and hands the narrowed filters down (§6).
 *
 * 🛑 **Connector health is JOINED, never copied.** `bank_account.connectorId` is
 * a pointer at a `DataConnector` row, and that row is the only authority on
 * `status`, `lastSyncedAt`, `lastWebhookEventAt`, `itemCount` and `error`
 * (decision **B4**). A denormalized copy on the record would be a second answer
 * to "is this feed healthy", which is exactly the question that must not have
 * two answers.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import { toRecordId } from '../resources/resource-id'
import {
  type BankAccountCoverage,
  type BankAccountRemovalFacts,
  type BankAccountRow,
  type BankConnectorHealth,
  type CoverageGap,
  computeCoverageGaps,
  mergeCoverageGaps,
  resolveBankAccountStatus,
  resolveBankAccountType,
  toDateKey,
} from './client'
import { guard } from './guard'
// The leaf, not `./rules`: the barrel drags the rule evaluator and the
// suggestion miner in to answer "which rules name this account".
import { listBankRules } from './rules/reads'

/** Every `bank_account` attribute a {@link BankAccountRow} is assembled from. */
const BANK_ACCOUNT_ATTRIBUTES = [
  'bank_account_name',
  'bank_account_institution',
  'bank_account_last4',
  'bank_account_type',
  'bank_account_currency',
  'bank_account_gl_account',
  'bank_account_feed_start_date',
  'bank_account_coverage_from',
  'bank_account_coverage_gaps',
  'bank_account_connector_id',
  'bank_account_status',
  'bank_account_has_posted',
] as const

/** The `bank_transaction` attributes the coverage derivation reads. */
const BANK_TRANSACTION_ATTRIBUTES = [
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_review_status',
] as const

type BankAccountAttribute = (typeof BANK_ACCOUNT_ATTRIBUTES)[number]
type BankTransactionAttribute = (typeof BANK_TRANSACTION_ATTRIBUTES)[number]

type BankAccountFields = Record<BankAccountAttribute, { id: string } | null>
type BankTransactionFields = Record<BankTransactionAttribute, { id: string } | null>

/** The resolved def and field ids every bank-account read needs. */
export interface BankAccountFieldContext {
  bankAccountDefId: string
  fields: BankAccountFields
}

/** The resolved def and field ids the coverage derivation needs. */
export interface BankTransactionFieldContext {
  bankTransactionDefId: string
  fields: BankTransactionFields
}

/**
 * Resolve the `bank_account` def and its fields, or `null` when the org has not
 * run entity migration 125 yet.
 *
 * `null` rather than a throw so the settings page on an unmigrated org renders
 * an empty state instead of 500ing. The WRITE paths call
 * {@link requireBankAccountFieldContext} instead: a write that silently did
 * nothing would be worse than a refusal.
 */
export async function loadBankAccountFieldContext(
  organizationId: string
): Promise<BankAccountFieldContext | null> {
  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  if (!bankAccountDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BANK_ACCOUNT_ATTRIBUTES])) as BankAccountFields
  // Without `name` and `status` there is no account at all: the display value
  // and the "is this feed live" question both reduce to nothing.
  if (!fields.bank_account_name || !fields.bank_account_status) return null
  return { bankAccountDefId, fields }
}

/** {@link loadBankAccountFieldContext}, as the refusal a write path needs. */
export async function requireBankAccountFieldContext(
  organizationId: string
): Promise<BankAccountFieldContext> {
  const ctx = await loadBankAccountFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank accounts are not available until the bank account entity and its fields are ' +
        'provisioned (entity migration 125)'
    )
  }
  return ctx
}

/** Resolve the `bank_transaction` def, or `null` on an unmigrated org. */
export async function loadBankTransactionFieldContext(
  organizationId: string
): Promise<BankTransactionFieldContext | null> {
  const bankTransactionDefId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!bankTransactionDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BANK_TRANSACTION_ATTRIBUTES])) as BankTransactionFields
  if (!fields.bank_transaction_posted_at || !fields.bank_transaction_bank_account) return null
  return { bankTransactionDefId, fields }
}

/**
 * Every bank account in the org, oldest first, each joined to its connector's
 * live health.
 *
 * ⚠️ **One query for the accounts, one for their field values, one for the
 * connectors.** Never one per row: an org with two logins and six accounts is
 * the normal case, but the settings page must not degrade linearly for the one
 * with thirty.
 */
export async function listBankAccounts(
  db: Database,
  params: { organizationId: string; includeArchived?: boolean }
): Promise<Result<BankAccountRow[], Error>> {
  const { organizationId, includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadBankAccountFieldContext(organizationId)
      if (!ctx) return []

      const instances = await db
        .select({
          id: schema.EntityInstance.id,
          createdAt: schema.EntityInstance.createdAt,
          archivedAt: schema.EntityInstance.archivedAt,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.bankAccountDefId),
            // 🛑 Default FALSE, so every existing caller is unchanged. Only the
            // settings list's "Show archived" toggle and the pickers - which
            // have to render an archived account that is still a record's
            // current value - ever ask for the other answer.
            ...(includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
          )
        )
        .orderBy(asc(schema.EntityInstance.createdAt))

      if (instances.length === 0) return []
      return hydrateBankAccounts(db, organizationId, ctx, instances)
    },
    'Failed to list bank accounts',
    { organizationId }
  )
}

/**
 * One bank account by id, or `null` when it does not exist, is archived, or
 * belongs to another org.
 *
 * `null` rather than a throw: the settings page selects by id from a list it
 * already holds, and a stale selection after a delete is an ordinary state.
 */
export async function getBankAccount(
  db: Database,
  params: { organizationId: string; bankAccountId: string; includeArchived?: boolean }
): Promise<Result<BankAccountRow | null, Error>> {
  const { organizationId, bankAccountId, includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadBankAccountFieldContext(organizationId)
      if (!ctx) return null

      const [instance] = await db
        .select({
          id: schema.EntityInstance.id,
          createdAt: schema.EntityInstance.createdAt,
          archivedAt: schema.EntityInstance.archivedAt,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, bankAccountId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.bankAccountDefId),
            // Default false, as above. `restoreBankAccount` and the removal
            // preview are the only readers that need an archived row back.
            ...(includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
          )
        )
        .limit(1)

      if (!instance) return null
      const [row] = await hydrateBankAccounts(db, organizationId, ctx, [instance])
      return row ?? null
    },
    'Failed to read bank account',
    { organizationId, bankAccountId }
  )
}

/**
 * What this account has data for, and what it does not.
 *
 * `coverageFrom` is the stored value when there is one, and otherwise the
 * earliest `postedAt` we hold. The gaps are the STORED array folded together
 * with what {@link computeCoverageGaps} infers from the transactions.
 *
 * 🛑 **The derived half is a heuristic and the UI must say so.** Nothing in the
 * transactions can distinguish "we hold no rows for this fortnight" from "there
 * was no activity for a fortnight" - only the statement knows, and the statement
 * is the thing we do not have. The alternative (staying silent) is worse: a
 * balance sheet spanning a hole renders happily and is wrong, which
 * plans/bank-connection/01 §4.1 calls the coverage record's whole reason for
 * existing.
 *
 * Throws `NotFoundError` rather than answering empty, because "this account has
 * full coverage" and "this account does not exist" must never render the same.
 */
export async function readCoverage(
  db: Database,
  params: { organizationId: string; bankAccountId: string; today?: string }
): Promise<Result<BankAccountCoverage, Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const account = await getBankAccount(db, { organizationId, bankAccountId })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const asOf = params.today ?? toDateKey(new Date())
      const storedGaps = account.value.coverageGaps
      const txCtx = await loadBankTransactionFieldContext(organizationId)

      // An org whose `bank_transaction` def is missing has no rows to derive
      // from, so the stored record is the whole answer - not "no gaps".
      if (!txCtx) {
        return {
          bankAccountId,
          coverageFrom: account.value.coverageFrom,
          asOf,
          transactionCount: 0,
          storedGaps,
          derivedGaps: [],
          gaps: storedGaps,
        } satisfies BankAccountCoverage
      }

      const dateKeys = await readTransactionDateKeys(db, organizationId, txCtx, bankAccountId)
      const coverageFrom = account.value.coverageFrom ?? dateKeys[0] ?? null
      const derivedGaps = computeCoverageGaps({ dateKeys, coverageFrom, today: asOf })

      return {
        bankAccountId,
        coverageFrom,
        asOf,
        transactionCount: dateKeys.length,
        storedGaps,
        derivedGaps,
        gaps: mergeCoverageGaps(storedGaps, derivedGaps),
      } satisfies BankAccountCoverage
    },
    'Failed to read bank account coverage',
    { organizationId, bankAccountId }
  )
}

/**
 * Everything the removal gate and its confirm dialog need, in one pass
 * (plans/bank-connection/08-removing-a-bank-account.md §7.2).
 *
 * 🛑 **`hasEverPosted` is read STRAIGHT OFF THE FIELD and is never derived from
 * the rows.** That is §5.1's whole point: `undoReview` sets
 * `bank_transaction_gl_posting_id` back to `null`, so a predicate computed from
 * the transactions flips back to false - while the `GlPosting` it reversed and
 * the reversal itself both stay in the books forever with a row on this account
 * as their source document. An account that permanently changed the ledger would
 * become deletable again the moment somebody undid the last review.
 *
 * Every other fact here is for the dialog and DECIDES NOTHING. The counts say
 * how much a delete would take with it; the rules are named so a person knows
 * which configuration a delete leaves inert (`rules/evaluate.ts` skips a rule
 * whose `bankAccountId` does not match, so a dangling scope makes the rule
 * silently DEAD, not silently universal - a warning, never a blocker).
 *
 * Reads an ARCHIVED account too, because the preview is also what a restore
 * screen renders.
 */
export async function readRemovalFacts(
  db: Database,
  params: { organizationId: string; bankAccountId: string }
): Promise<Result<BankAccountRemovalFacts, Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const account = await getBankAccount(db, {
        organizationId,
        bankAccountId,
        includeArchived: true,
      })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const txCtx = await loadBankTransactionFieldContext(organizationId)
      const counts = txCtx
        ? await readTransactionStatusCounts(db, organizationId, txCtx, bankAccountId)
        : { total: 0, matched: 0, unreviewed: 0 }

      const rules = await listBankRules(db, { organizationId })
      if (rules.isErr()) throw rules.error

      return {
        hasEverPosted: account.value.hasEverPosted,
        transactionCount: counts.total,
        matchedCount: counts.matched,
        unreviewedCount: counts.unreviewed,
        connectorId: account.value.connectorId,
        rules: rules.value
          .filter(
            (rule) =>
              rule.bankAccountId === bankAccountId ||
              rule.counterpartBankAccountId === bankAccountId
          )
          .map((rule) => ({ id: rule.id, name: rule.name || 'Untitled rule' })),
      } satisfies BankAccountRemovalFacts
    },
    'Failed to read bank account removal facts',
    { organizationId, bankAccountId }
  )
}

/**
 * Every `bank_transaction` instance id on one account, **archived ones included**.
 *
 * 🛑 `listForReview` filters `archivedAt IS NULL`, which is right for a queue and
 * wrong for a cascade: a reversed import and a duplicate the feed converged away
 * both leave archived lines behind, and a "real delete" that stepped over them
 * would leave rows pointing at an `EntityInstance` that no longer exists.
 * `FieldValue.relatedEntityId` carries no foreign key, so nothing would ever
 * clean them up.
 *
 * Returns the def id alongside, because the caller needs it to build a
 * `RecordId` and resolving it twice is two cache reads for one answer.
 */
export async function readBankTransactionIdsForAccount(
  db: Database,
  params: { organizationId: string; bankAccountId: string }
): Promise<Result<{ bankTransactionDefId: string; ids: string[] }, Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const ctx = await loadBankTransactionFieldContext(organizationId)
      const linkField = ctx?.fields.bank_transaction_bank_account
      if (!ctx || !linkField) return { bankTransactionDefId: '', ids: [] }

      const rows = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, linkField.id),
            eq(schema.FieldValue.relatedEntityId, bankAccountId)
          )
        )

      return {
        bankTransactionDefId: ctx.bankTransactionDefId,
        ids: [...new Set(rows.map((row) => row.entityId))],
      }
    },
    'Failed to read the bank transactions on an account',
    { organizationId, bankAccountId }
  )
}

/**
 * How many live lines this account holds, and how they are split.
 *
 * `matched` is counted on its own because a delete destroys it and the dialog has
 * to name that: a match is what says a document we already posted really cleared,
 * and deleting it removes that evidence while the document's own entry stays in
 * the books. `unreviewed` is `for_review` + `suggested` - the rows an ARCHIVE
 * bulk-excludes (§6), which is the other sentence the dialog owes a person.
 *
 * Both filters run in SQL. A post-read `.filter()` would pull every statement
 * line in the org into memory to answer a question about one account.
 */
async function readTransactionStatusCounts(
  db: Database,
  organizationId: string,
  ctx: BankTransactionFieldContext,
  bankAccountId: string
): Promise<{ total: number; matched: number; unreviewed: number }> {
  const linkField = ctx.fields.bank_transaction_bank_account
  const statusField = ctx.fields.bank_transaction_review_status
  if (!linkField) return { total: 0, matched: 0, unreviewed: 0 }

  // Joined to the instance so an ARCHIVED line - a reversed import, a duplicate
  // the feed converged away - is not counted as something a delete would remove.
  const linked = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, linkField.id),
        eq(schema.FieldValue.relatedEntityId, bankAccountId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const ids = [...new Set(linked.map((row) => row.entityId))]
  if (ids.length === 0 || !statusField) {
    return { total: ids.length, matched: 0, unreviewed: 0 }
  }

  const statuses = await db
    .select({ entityId: schema.FieldValue.entityId, optionId: schema.FieldValue.optionId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, statusField.id),
        inArray(schema.FieldValue.entityId, ids)
      )
    )

  const byInstance = new Map(statuses.map((row) => [row.entityId, row.optionId]))
  let matched = 0
  let unreviewed = 0
  for (const id of ids) {
    // A line with no status row at all has not been reviewed - the same default
    // `resolveReviewStatus` applies everywhere else.
    const status = byInstance.get(id) ?? 'for_review'
    if (status === 'matched') matched += 1
    if (status === 'for_review' || status === 'suggested') unreviewed += 1
  }
  return { total: ids.length, matched, unreviewed }
}

/**
 * Every `postedAt` date key on one account, ascending.
 *
 * Two joins on `FieldValue` - the account link and the date - so the filter runs
 * in SQL. A post-read `.filter()` would pull every statement line in the org
 * into memory to answer a question about one account.
 */
async function readTransactionDateKeys(
  db: Database,
  organizationId: string,
  ctx: BankTransactionFieldContext,
  bankAccountId: string
): Promise<string[]> {
  const linkField = ctx.fields.bank_transaction_bank_account
  const dateField = ctx.fields.bank_transaction_posted_at
  if (!linkField || !dateField) return []

  // Joined to the instance so an ARCHIVED line (a reversed import, a duplicate
  // the feed converged away) neither counts nor closes a gap it no longer fills.
  const linked = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, linkField.id),
        eq(schema.FieldValue.relatedEntityId, bankAccountId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const ids = [...new Set(linked.map((row) => row.entityId))]
  if (ids.length === 0) return []

  const dates = await db
    .select({ valueDate: schema.FieldValue.valueDate })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, dateField.id),
        inArray(schema.FieldValue.entityId, ids)
      )
    )

  return dates
    .map((row) => (row.valueDate ? toDateKey(row.valueDate) : null))
    .filter((key): key is string => key != null)
    .sort()
}

/**
 * Turn a page of account ids into full rows with a bounded number of queries:
 * one for the field values, one for the connectors.
 */
async function hydrateBankAccounts(
  db: Database,
  organizationId: string,
  ctx: BankAccountFieldContext,
  page: { id: string; createdAt: Date | null; archivedAt: Date | null }[]
): Promise<BankAccountRow[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = fieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueBoolean: schema.FieldValue.valueBoolean,
          valueDate: schema.FieldValue.valueDate,
          valueJson: schema.FieldValue.valueJson,
          optionId: schema.FieldValue.optionId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, ids),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const read = (instanceId: string, attr: BankAccountAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id) ?? null) : null
  }

  const connectorIds = [
    ...new Set(
      page
        .map((row) => read(row.id, 'bank_account_connector_id')?.valueText)
        .filter((id): id is string => !!id)
    ),
  ]
  const connectors = await readConnectorHealth(db, organizationId, connectorIds)

  return page.map((row) => {
    const connectorId = read(row.id, 'bank_account_connector_id')?.valueText ?? null
    const coverageFrom = read(row.id, 'bank_account_coverage_from')?.valueDate
    const feedStartDate = read(row.id, 'bank_account_feed_start_date')?.valueDate
    return {
      id: row.id,
      recordId: toRecordId(ctx.bankAccountDefId, row.id),
      name: read(row.id, 'bank_account_name')?.valueText ?? null,
      institution: read(row.id, 'bank_account_institution')?.valueText ?? null,
      last4: read(row.id, 'bank_account_last4')?.valueText ?? null,
      type: resolveBankAccountType(read(row.id, 'bank_account_type')?.optionId),
      currency: read(row.id, 'bank_account_currency')?.valueText ?? null,
      glAccountCode: read(row.id, 'bank_account_gl_account')?.valueText ?? null,
      feedStartDate: feedStartDate ? toDateKey(feedStartDate) : null,
      coverageFrom: coverageFrom ? toDateKey(coverageFrom) : null,
      coverageGaps: normalizeCoverageGaps(read(row.id, 'bank_account_coverage_gaps')?.valueJson),
      connectorId,
      status: resolveBankAccountStatus(read(row.id, 'bank_account_status')?.optionId),
      // 🛑 Read STRAIGHT off the field, never derived from the rows. That is the
      // whole point of the field: `undoReview` nulls a line's posting id, so a
      // predicate computed off the transactions flips back to false while the
      // entry and its reversal both stay in the books (08 §5.1).
      hasEverPosted: read(row.id, 'bank_account_has_posted')?.valueBoolean === true,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      connector: connectorId ? (connectors.get(connectorId) ?? null) : null,
    } satisfies BankAccountRow
  })
}

/** The `DataConnector` rows behind a page of accounts, keyed by id. */
async function readConnectorHealth(
  db: Database,
  organizationId: string,
  connectorIds: string[]
): Promise<Map<string, BankConnectorHealth>> {
  if (connectorIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: schema.DataConnector.id,
      name: schema.DataConnector.name,
      status: schema.DataConnector.status,
      lastSyncedAt: schema.DataConnector.lastSyncedAt,
      lastWebhookEventAt: schema.DataConnector.lastWebhookEventAt,
      itemCount: schema.DataConnector.itemCount,
      error: schema.DataConnector.error,
    })
    .from(schema.DataConnector)
    .where(
      and(
        eq(schema.DataConnector.organizationId, organizationId),
        inArray(schema.DataConnector.id, connectorIds)
      )
    )
  return new Map(rows.map((row) => [row.id, row satisfies BankConnectorHealth]))
}

/**
 * The stored `coverageGaps` JSON, narrowed to well-formed `{ from, to }` pairs.
 *
 * ⚠️ Silently drops a malformed entry rather than throwing. This column is
 * written by an importer and by a future connector, and one bad row must not
 * make the settings page unreadable for every account beside it.
 */
function normalizeCoverageGaps(value: unknown): CoverageGap[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { from, to } = entry as { from?: unknown; to?: unknown }
    if (typeof from !== 'string' || typeof to !== 'string') return []
    return [{ from: from.slice(0, 10), to: to.slice(0, 10) }]
  })
}
