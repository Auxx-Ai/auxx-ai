// packages/lib/src/accounting/banking/feed/coverage.ts

/**
 * Keeping `bank_account.coverageFrom` honest as the feed brings history in.
 *
 * 🛑 **This is the record plans/bank-connection/01 §4.1 (4c) calls "the one most likely
 * to be skipped and most expensive to add later".** Without a coverage floor, a balance
 * sheet spanning a hole renders happily and is wrong - arithmetically right,
 * financially meaningless, and silent. `readCoverage` derives the floor live for the
 * UI, so nothing a person looks at is ever stale; this function is what STORES it, and
 * the stored value is what the setup wizard's gap number and a future reconciliation
 * refusal read without walking every transaction in the org.
 *
 * ⚠️ It only ever moves the floor EARLIER. Stripe reaches back up to 180 days from the
 * day you connect and the window accumulates from there, so the first sync typically
 * lands six months of history behind whatever a person typed as the feed start. A later
 * sync that only sees this week must not then claim coverage begins this week.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { toRecordId } from '../../../resources/resource-id'
import { readSystemRecords } from '../../../resources/system-records'
import {
  type BankTransactionFieldContext,
  loadBankAccountFieldContext,
  loadBankTransactionFieldContext,
} from '../fields'

const logger = createScopedLogger('banking-feed')

export interface RefreshCoverageInput {
  organizationId: string
  /** Refresh only the account this connector feeds. Omit to sweep the whole org. */
  connectorId?: string
}

/**
 * Recompute and store `coverageFrom` for one connector's account, or for every bank
 * account in the org.
 *
 * Returns the number of records whose floor actually moved, so a nightly sweep can log
 * something meaningful rather than "ran".
 */
export async function refreshBankAccountCoverage(
  db: Database,
  input: RefreshCoverageInput
): Promise<number> {
  const { organizationId, connectorId } = input
  const accountCtx = await loadBankAccountFieldContext(db, organizationId)
  const txCtx = await loadBankTransactionFieldContext(db, organizationId)
  if (!accountCtx || !txCtx) return 0

  const connectorField = accountCtx.fields.bank_account_connector_id
  const coverageField = accountCtx.fields.bank_account_coverage_from
  const linkField = txCtx.fields.bank_transaction_bank_account
  const dateField = txCtx.fields.bank_transaction_posted_at
  if (!coverageField || !linkField || !dateField) return 0

  // Which accounts to look at: the one this connector feeds, or all of them.
  // The connector id is a stored VALUE, so that half stays a raw lookup.
  let connectorAccountIds: string[] | undefined
  if (connectorId) {
    if (!connectorField) return 0
    const rows = await db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, connectorField.id),
          eq(schema.FieldValue.valueText, connectorId)
        )
      )
    connectorAccountIds = rows.map((row) => row.entityId)
    if (connectorAccountIds.length === 0) return 0
  }

  // Archived accounts included, as this sweep has always included them: an
  // archived account's stored floor is still read back by a restore.
  const accounts = await readSystemRecords(db, organizationId, accountCtx, {
    ids: connectorAccountIds,
    includeArchived: true,
  })
  if (accounts.length === 0) return 0

  const storedByAccount = new Map(
    accounts.map((account) => {
      const stored = account.date('bank_account_coverage_from')
      return [account.id, stored ? toDateKey(stored) : null]
    })
  )
  const accountIds = accounts.map((account) => account.id)

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const crud = new UnifiedCrudHandler(organizationId, systemUserId, db)
  let moved = 0

  for (const accountId of accountIds) {
    const earliest = await earliestTransactionDate(db, {
      organizationId,
      txCtx,
      bankAccountId: accountId,
    })
    if (!earliest) continue

    const current = storedByAccount.get(accountId) ?? null
    if (current && current <= earliest) continue

    await crud.update(toRecordId(accountCtx.defId, accountId), {
      bank_account_coverage_from: earliest,
    })
    moved += 1
    logger.info('Bank account coverage floor moved earlier', {
      organizationId,
      bankAccountId: accountId,
      from: current,
      to: earliest,
    })
  }

  return moved
}

/**
 * The earliest `postedAt` on one account, as a `YYYY-MM-DD` key.
 *
 * Two queries, both in SQL: the link cells, then the min over the date cells. A
 * post-read `.filter()` would pull every statement line in the org into memory to
 * answer a question about one account.
 *
 * 🛑 **Joined to the instance and filtered on `archivedAt`, exactly as
 * `readTransactionDateKeys` is.** An archived line - a reversed import, a
 * duplicate the feed converged away - leaves its `FieldValue` rows behind, so
 * without the join the floor is dragged back to a date we no longer hold. And
 * `refreshBankAccountCoverage` only ever moves the floor EARLIER, so a wrong
 * floor is sticky: it claims coverage over a hole and no later sync can take it
 * back.
 */
async function earliestTransactionDate(
  db: Database,
  args: {
    organizationId: string
    txCtx: BankTransactionFieldContext
    bankAccountId: string
  }
): Promise<string | null> {
  const records = await readSystemRecords(db, args.organizationId, args.txCtx, {
    by: { attribute: 'bank_transaction_bank_account', in: [args.bankAccountId] },
  })
  const keys = records
    .map((record) => {
      const posted = record.date('bank_transaction_posted_at')
      return posted ? toDateKey(posted) : null
    })
    .filter((key): key is string => key != null)
    .sort()
  return keys[0] ?? null
}
