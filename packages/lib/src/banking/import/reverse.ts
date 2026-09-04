// packages/lib/src/banking/import/reverse.ts

/**
 * Undo a statement import (plans/accounting/ui-plan.md §2.9,
 * plans/bank-connection/05-file-import.md §4).
 *
 * 🛑 **Two rows of the same batch get opposite treatment, and the split is the
 * whole design.** A bank line that has been reviewed is no longer a copy of a
 * statement: a `coded` one is the SOURCE DOCUMENT of a journal entry, and a
 * `matched` one is what says a vendor payment we already posted really cleared.
 * Deleting either is deleting evidence for a posting that stays in the books -
 * the movement ledger's rule, applied to cash
 * (plans/bank-connection/02-connection-architecture.md §5.1).
 *
 * So a reverse deletes the rows nobody has decided anything about, and REFUSES
 * the rest **by name**. Naming them is not a nicety: "3 rows could not be
 * removed" leaves a person with no way to find them, where "31 Jan, -$50.00,
 * FUEL STOP 12 - carries posting AUXX-BNK-0007" tells them exactly which
 * decision to reverse first.
 *
 * ⚠️ It is not all-or-nothing. Refusing the whole batch because one row was
 * coded would make the common case - import the wrong month, notice, undo -
 * impossible the moment anybody had started work.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { guard } from '../guard'
import { getBankAccount, readCoverage, requireBankAccountFieldContext } from '../reads'
import {
  type BankTransactionImportContext,
  type BankTransactionRow,
  readTransactionsByAccount,
  readTransactionsByBatch,
  requireBankTransactionImportContext,
} from './fields'
import type { ReverseImportRefusal, ReverseImportResult } from './types'
import { IMPORT_LINK_EXCLUSION_PREFIX } from './types'

const logger = createScopedLogger('banking')

/**
 * Delete what a batch wrote, as far as it is safe to.
 *
 * Throws `BadRequestError` when the batch id names nothing, rather than
 * answering "0 deleted": a typo and a batch that was already reversed must not
 * read the same.
 */
export async function reverseImport(
  db: Database,
  params: { organizationId: string; actorUserId: string; importBatchId: string }
): Promise<Result<ReverseImportResult, Error>> {
  const { organizationId, actorUserId, importBatchId } = params
  return guard(
    async () => {
      const ctx = await requireBankTransactionImportContext(organizationId)
      const rows = await readTransactionsByBatch(db, organizationId, ctx, importBatchId)
      if (rows.length === 0) {
        throw new BadRequestError(
          `No bank transactions carry the import batch ${importBatchId}. It may already have ` +
            'been reversed.'
        )
      }

      const refusals = rows.flatMap((row) => {
        const reason = refusalReason(row)
        return reason ? [describe(row, reason)] : []
      })
      const refusedIds = new Set(refusals.map((refusal) => refusal.id))
      const deletable = rows.filter((row) => !refusedIds.has(row.id))

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      for (const row of deletable) {
        await crud.delete(toRecordId(ctx.bankTransactionDefId, row.id))
      }

      const bankAccountId = rows.find((row) => row.bankAccountId)?.bankAccountId ?? null
      const coverage = bankAccountId
        ? await recomputeAfterDelete(db, { organizationId, actorUserId, bankAccountId, ctx })
        : { coverageFrom: null, gaps: [] }

      logger.info('Reversed a bank statement import', {
        organizationId,
        importBatchId,
        deleted: deletable.length,
        refused: refusals.length,
      })

      return {
        importBatchId,
        deleted: deletable.length,
        refused: refusals,
        coverageFrom: coverage.coverageFrom,
        gaps: coverage.gaps,
      } satisfies ReverseImportResult
    },
    'Failed to reverse a bank statement import',
    { organizationId, importBatchId }
  )
}

/**
 * Why this row survives a reverse, or `null` when it does not.
 *
 * Pure, and exported so the refusal rules can be tested exhaustively without a
 * database. The order matters only for the message: a row that is both posted
 * and matched is named for its posting, which is the harder thing to undo.
 */
export function refusalReason(row: BankTransactionRow): string | null {
  if (row.glPostingId) {
    return `carries posting ${row.glPostingId}, which has to be reversed in the ledger first`
  }
  if (row.reviewStatus === 'matched') {
    return 'is matched to a document, and the match is what says that document cleared'
  }
  if (row.reviewStatus === 'coded') {
    return 'was coded, so a posting may exist for it - un-code it first'
  }
  if (row.reviewStatus === 'excluded' && !isImportLinkExclusion(row.excludeReason)) {
    return (
      'was excluded by a person, and the reason on it is the record of that decision - undo ' +
      'the exclusion first if the row really should go'
    )
  }
  return null
}

/**
 * Was this exclusion written by the IMPORT, or by a person?
 *
 * The importer excludes a row it linked to a feed row that already held the same
 * transaction, and stamps {@link IMPORT_LINK_EXCLUSION_PREFIX} as the reason.
 * That one is the import's own bookkeeping and goes when the import does;
 * anything else is a human decision, and `crud.delete` is a HARD delete, so
 * reversing over it would destroy both the decision and the reason it was
 * required to carry.
 */
function isImportLinkExclusion(reason: string | null): boolean {
  return !!reason?.trimStart().startsWith(IMPORT_LINK_EXCLUSION_PREFIX)
}

/** One refusal, with enough of the row on it to find the line in a statement. */
function describe(row: BankTransactionRow, reason: string): ReverseImportRefusal {
  return {
    id: row.id,
    postedAt: row.postedAt,
    amountMinor: row.amountMinor,
    description: row.description,
    reason,
  }
}

/**
 * Pull `coverageFrom` back to the earliest row that is still there.
 *
 * 🛑 **No gap is WRITTEN here.** Deleting a fortnight of rows re-opens the hole,
 * and `readCoverage`'s derived half reports it the moment the rows are gone -
 * which is exactly what the heuristic is for. Writing a stored gap would turn an
 * inference into testimony that no later import could disprove without an
 * explicit edit.
 */
async function recomputeAfterDelete(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    bankAccountId: string
    ctx: BankTransactionImportContext
  }
): Promise<{ coverageFrom: string | null; gaps: ReverseImportResult['gaps'] }> {
  const { organizationId, actorUserId, bankAccountId, ctx } = params

  const account = await getBankAccount(db, { organizationId, bankAccountId })
  if (account.isErr()) throw account.error
  if (!account.value) return { coverageFrom: null, gaps: [] }

  const remaining = await readTransactionsByAccount(db, organizationId, ctx, bankAccountId)
  const earliestRemaining = remaining
    .map((row) => row.postedAt)
    .filter((key): key is string => !!key)
    .sort()[0]

  // `moveCoverage` only ever extends `coverageFrom` backwards, so the pull-back
  // is written here: the stored value is a claim about what we hold, and after a
  // reverse we may hold less.
  if (account.value.coverageFrom && account.value.coverageFrom !== (earliestRemaining ?? null)) {
    const accountCtx = await requireBankAccountFieldContext(organizationId)
    const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
    await crud.update(toRecordId(accountCtx.bankAccountDefId, bankAccountId), {
      bank_account_coverage_from: earliestRemaining ?? null,
    })
  }

  const coverage = await readCoverage(db, { organizationId, bankAccountId })
  if (coverage.isErr()) throw coverage.error
  return { coverageFrom: coverage.value.coverageFrom, gaps: coverage.value.gaps }
}
