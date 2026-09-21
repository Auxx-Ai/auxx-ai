// packages/lib/src/accounting/banking/reads.ts

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

import type { Database } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readConnectors } from '../../data-connectors/service'
import { NotFoundError } from '../../errors'
import { readSystemRecords, type SystemRecord } from '../../resources/system-records'
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
} from './client'
import {
  type BankAccountAttribute,
  type BankTransactionFieldContext,
  loadBankAccountFieldContext,
  loadBankTransactionFieldContext,
} from './fields'
import { guard } from './guard'
// The leaf, not `./rules`: the barrel drags the rule evaluator and the
// suggestion miner in to answer "which rules name this account".
import { listBankRules } from './rules/reads'

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
      const ctx = await loadBankAccountFieldContext(db, organizationId)
      if (!ctx) return []

      // 🛑 `includeArchived` defaults FALSE, so every existing caller is
      // unchanged. Only the settings list's "Show archived" toggle and the
      // pickers - which have to render an archived account that is still a
      // record's current value - ever ask for the other answer.
      const records = await readSystemRecords(db, organizationId, ctx, { includeArchived })
      if (records.length === 0) return []
      return hydrateBankAccounts(db, organizationId, records)
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
      const ctx = await loadBankAccountFieldContext(db, organizationId)
      if (!ctx) return null

      // Default false, as in `listBankAccounts`. `restoreBankAccount` and the
      // removal preview are the only readers that need an archived row back.
      const records = await readSystemRecords(db, organizationId, ctx, {
        ids: [bankAccountId],
        includeArchived,
      })
      if (records.length === 0) return null
      const [row] = await hydrateBankAccounts(db, organizationId, records)
      return row ?? null
    },
    'Failed to read bank account',
    { organizationId, bankAccountId }
  )
}

/** One bank account offered as a possible match for a payout's reported destination. */
export interface BankAccountSuggestion {
  bankAccountId: string
  recordId: string
  name: string | null
  last4: string | null
  /** An exact `settlementDestinations` match, or (weaker) a last-four match alone. */
  reason: 'destination' | 'last4'
}

/**
 * Bank accounts that might be the one a rail's payout destination named (task 58 §5.4 rule 3),
 * for the gateway editor's bank picker (U8 builds the UI). A SUGGESTION, never a resolution -
 * `setRoleAssignment` is the only write that maps a rail's `bank` role.
 *
 * Exact `settlementDestinations` matches come first and, when any exist, are the whole answer.
 * A last-four match is weaker evidence on its own (`settlementDestinations`'s own field comment:
 * two accounts at one bank can share a last four) and is offered only when nothing matched exactly.
 */
export async function suggestBankAccountsForDestination(
  db: Database,
  params: { organizationId: string; destination: string }
): Promise<Result<BankAccountSuggestion[], Error>> {
  const { organizationId, destination } = params
  return guard(
    async () => {
      const trimmed = destination.trim()
      if (!trimmed) return []

      const accounts = await listBankAccounts(db, { organizationId })
      if (accounts.isErr()) throw accounts.error

      const toSuggestion = (
        account: BankAccountRow,
        reason: BankAccountSuggestion['reason']
      ): BankAccountSuggestion => ({
        bankAccountId: account.id,
        recordId: account.recordId,
        name: account.name,
        last4: account.last4,
        reason,
      })

      const exact = accounts.value.filter((account) =>
        account.settlementDestinations.includes(trimmed)
      )
      if (exact.length > 0) return exact.map((account) => toSuggestion(account, 'destination'))

      const last4 = trimmed.slice(-4)
      if (last4.length !== 4) return []
      return accounts.value
        .filter((account) => account.last4 === last4)
        .map((account) => toSuggestion(account, 'last4'))
    },
    'Failed to suggest a receiving bank account',
    { organizationId, destination }
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
      // 🛑 `includeArchived`, because the settings list can SELECT an archived
      // account (that is what the "Show archived" toggle is for) and the editor
      // asks for its coverage the moment it is selected. Without this the click
      // answered 404 on a row the same page had just rendered.
      const account = await getBankAccount(db, {
        organizationId,
        bankAccountId,
        includeArchived: true,
      })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const asOf = params.today ?? toDateKey(new Date())
      const storedGaps = account.value.coverageGaps
      const txCtx = await loadBankTransactionFieldContext(db, organizationId)

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
 * the rows.** That is §5.1's whole point: reversing a line's posting (TARGET
 * §1: `reverseEntry` releases its `GlPostingSource` claim) makes a predicate
 * computed from the transactions flip back to false - while the `GlPosting` it
 * reversed and the reversal itself both stay in the books forever with a row on
 * this account as their source document. An account that permanently changed
 * the ledger would become deletable again the moment somebody undid the last
 * review.
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

      const txCtx = await loadBankTransactionFieldContext(db, organizationId)
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
      const ctx = await loadBankTransactionFieldContext(db, organizationId)
      if (!ctx?.fields.bank_transaction_bank_account) return { bankTransactionDefId: '', ids: [] }

      const records = await readSystemRecords(db, organizationId, ctx, {
        by: { attribute: 'bank_transaction_bank_account', in: [bankAccountId] },
        includeArchived: true,
        cells: false,
      })
      return { bankTransactionDefId: ctx.defId, ids: records.map((record) => record.id) }
    },
    'Failed to read the bank transactions on an account',
    { organizationId, bankAccountId }
  )
}

/**
 * Every live line on one account whose review status is one of `statuses`, with
 * the exclusion reason attached.
 *
 * 🛑 **Uncapped, deliberately.** `listForReview` clamps at `MAX_LIMIT` (500),
 * which is right for a queue a person is reading and wrong for a sweep that has
 * to touch every row or leave debris behind. An archive that swept 500 of 2,390
 * rows left the rest in the queue under an account the user could no longer see
 * or select (plans/bank-connection/08-removing-a-bank-account.md §6.1).
 *
 * 🛑 **A line with NO status row counts as `for_review`**, the same default
 * `resolveReviewStatus` applies everywhere else. Filtering on an inner join
 * against the status field would silently skip exactly the rows an archive
 * sweep exists to catch.
 *
 * Three queries, whatever the row count: the account link, the statuses, the
 * reasons. Nothing here is per-row.
 */
export async function readAccountLinesByStatus(
  db: Database,
  params: { organizationId: string; bankAccountId: string; statuses: readonly string[] }
): Promise<
  Result<
    { bankTransactionDefId: string; lines: { id: string; excludeReason: string | null }[] },
    Error
  >
> {
  const { organizationId, bankAccountId, statuses } = params
  return guard(
    async () => {
      const ctx = await loadBankTransactionFieldContext(db, organizationId)
      if (!ctx?.fields.bank_transaction_bank_account) return { bankTransactionDefId: '', lines: [] }

      // Live lines only - the reader drops an ARCHIVED one (a reversed import, a
      // duplicate the feed converged away) by default, which is what a sweep wants.
      const records = await readSystemRecords(db, organizationId, ctx, {
        by: { attribute: 'bank_transaction_bank_account', in: [bankAccountId] },
      })
      const lines = records
        .filter((record) =>
          statuses.includes(record.option('bank_transaction_review_status') ?? 'for_review')
        )
        .map((record) => ({
          id: record.id,
          excludeReason: record.text('bank_transaction_exclude_reason'),
        }))
      return { bankTransactionDefId: ctx.defId, lines }
    },
    'Failed to read the bank transactions on an account by status',
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
 * Counted over one account's live lines, never over the org: the reader is
 * asked for the children of this account and nothing else.
 */
async function readTransactionStatusCounts(
  db: Database,
  organizationId: string,
  ctx: BankTransactionFieldContext,
  bankAccountId: string
): Promise<{ total: number; matched: number; unreviewed: number }> {
  if (!ctx.fields.bank_transaction_bank_account) return { total: 0, matched: 0, unreviewed: 0 }

  // Archived lines are excluded by default - a reversed import or a duplicate the
  // feed converged away is not something a delete would take with it.
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'bank_transaction_bank_account', in: [bankAccountId] },
  })

  let matched = 0
  let unreviewed = 0
  for (const record of records) {
    // A line with no status row at all has not been reviewed - the same default
    // `resolveReviewStatus` applies everywhere else.
    const status = record.option('bank_transaction_review_status') ?? 'for_review'
    if (status === 'matched') matched += 1
    if (status === 'for_review' || status === 'suggested') unreviewed += 1
  }
  return { total: records.length, matched, unreviewed }
}

/**
 * Every `postedAt` date key on one account, ascending.
 *
 * The account's live children, then their dates off the cells the same read
 * already carries. An archived line - a reversed import, a duplicate the feed
 * converged away - neither counts nor closes a gap it no longer fills.
 */
async function readTransactionDateKeys(
  db: Database,
  organizationId: string,
  ctx: BankTransactionFieldContext,
  bankAccountId: string
): Promise<string[]> {
  if (!ctx.fields.bank_transaction_bank_account || !ctx.fields.bank_transaction_posted_at) return []

  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'bank_transaction_bank_account', in: [bankAccountId] },
  })
  return records
    .map((record) => {
      const posted = record.date('bank_transaction_posted_at')
      return posted ? toDateKey(posted) : null
    })
    .filter((key): key is string => key != null)
    .sort()
}

/** Turn a page of account records into full rows: one more query, for the connectors. */
async function hydrateBankAccounts(
  db: Database,
  organizationId: string,
  page: SystemRecord<BankAccountAttribute>[]
): Promise<BankAccountRow[]> {
  const connectorIds = [
    ...new Set(
      page
        .map((record) => record.text('bank_account_connector_id'))
        .filter((id): id is string => !!id)
    ),
  ]
  const connectors = await readConnectorHealth(db, organizationId, connectorIds)

  // `settlementDestinations` is TAGS (58 §4.4) - one `FieldValue` row per destination, written
  // with the typed text AS the `optionId`, mirroring `payment_gateway_handles`'s read. Read off
  // the stored rows because the open-tag fallback to `valueText` has no typed shape.
  const readSettlementDestinations = (record: SystemRecord<BankAccountAttribute>): string[] =>
    record
      .rows('bank_account_settlement_destinations')
      .map((value) => value.optionId ?? value.valueText)
      .filter((destination): destination is string => !!destination)

  return page.map((record) => {
    const connectorId = record.text('bank_account_connector_id')
    const coverageFrom = record.date('bank_account_coverage_from')
    const feedStartDate = record.date('bank_account_feed_start_date')
    return {
      id: record.id,
      recordId: record.recordId,
      name: record.text('bank_account_name'),
      institution: record.text('bank_account_institution'),
      last4: record.text('bank_account_last4'),
      type: resolveBankAccountType(record.option('bank_account_type')),
      currency: record.text('bank_account_currency'),
      glAccountId: record.text('bank_account_gl_account'),
      settlementDestinations: readSettlementDestinations(record),
      feedStartDate: feedStartDate ? toDateKey(feedStartDate) : null,
      coverageFrom: coverageFrom ? toDateKey(coverageFrom) : null,
      // The stored JSON is an ARRAY, and the typed `json` cell unwraps an
      // envelope object - so the raw column is the only shape that survives.
      coverageGaps: normalizeCoverageGaps(record.rows('bank_account_coverage_gaps')[0]?.valueJson),
      connectorId,
      status: resolveBankAccountStatus(record.option('bank_account_status')),
      // 🛑 Read STRAIGHT off the field, never derived from the rows. That is the
      // whole point of the field: `undoReview` nulls a line's posting id, so a
      // predicate computed off the transactions flips back to false while the
      // entry and its reversal both stay in the books (08 §5.1).
      hasEverPosted: record.boolean('bank_account_has_posted') === true,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
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
  const rows = await readConnectors(db, organizationId, connectorIds)
  return new Map(
    [...rows.values()].map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        status: row.status,
        lastSyncedAt: row.lastSyncedAt,
        lastWebhookEventAt: row.lastWebhookEventAt,
        itemCount: row.itemCount,
        error: row.error,
      } satisfies BankConnectorHealth,
    ])
  )
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
