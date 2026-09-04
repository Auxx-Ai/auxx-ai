// packages/lib/src/banking/import/finalize.ts

/**
 * What turns a generic import into a BANK import
 * (plans/accounting/ui-plan.md §2.9, plans/bank-connection/05-file-import.md §§4, 6, 7).
 *
 * The shared wizard writes the four raw columns a statement actually carries -
 * an id, a date, an amount and a description - and knows nothing about bank
 * accounts, coverage or the feed. Everything else a `bank_transaction` needs is
 * a property of the IMPORT, not of any column in the file, and is stamped here,
 * once, after the run:
 *
 * - **`bankAccount`** - chosen on the first card, before the file was picked.
 *   Not a column, because "which account is this?" is not something a bank
 *   writes in its own export.
 * - **`source: 'import'`** - which door the row came through. Not decoration:
 *   the two sources overlap by design, and a duplicate sweep argues from it.
 * - **`importBatchId`** - the import job's own id. This is what makes a bad
 *   statement import undoable as a unit (`reverseImport`).
 * - **`matchKey`** - `description` normalised. The ONLY thing that spans
 *   Stripe's `fctxn_…`, an OFX `FITID` and a CSV row hash.
 * - **`externalId`** where the file gave none - the deterministic composite from
 *   05 §4, with the per-day ordinal that stops two identical $50 fuel purchases
 *   collapsing into one.
 *
 * 🛑 **The rows are found through `ImportPlanRow.resultRecordId`,** the id the
 * executor recorded for every row it created or updated - never by "rows on this
 * def created since the job started". A timestamp window would sweep in a row
 * the feed wrote during the same minute and stamp it `source: 'import'` with
 * this batch's id, which `reverseImport` would then happily delete.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import type { CoverageGap } from '../client'
import { guard } from '../guard'
import { getBankAccount, readCoverage, requireBankAccountFieldContext } from '../reads'
import { runSuggestionsForAccount } from '../rules/writes'
import { earliest, withinWindow } from './coverage-effect'
import {
  type BankTransactionImportContext,
  type BankTransactionRow,
  hydrateTransactions,
  readTransactionsByAccount,
  requireBankTransactionImportContext,
} from './fields'
import { subtractCoveredRange } from './gaps'
import { buildImportedExternalId, normalizeMatchKey } from './match-key'
import type { FinalizeBankImportResult } from './types'
import { IMPORT_LINK_EXCLUSION_PREFIX } from './types'

const logger = createScopedLogger('banking')

/**
 * Stamp the rows an import job produced, link what the feed already had, and
 * move the account's coverage.
 *
 * Idempotent by construction: every write is a set-to-a-computed-value, and a
 * row that is already stamped produces the same values again. Re-running after a
 * partial failure is the intended recovery.
 */
export async function finalizeBankImport(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    bankAccountId: string
    importJobId: string
  }
): Promise<Result<FinalizeBankImportResult, Error>> {
  const { organizationId, actorUserId, bankAccountId, importJobId } = params
  return guard(
    async () => {
      const account = await getBankAccount(db, { organizationId, bankAccountId })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const ctx = await requireBankTransactionImportContext(organizationId)
      const producedIds = await readProducedRecordIds(db, organizationId, importJobId)
      if (producedIds.length === 0) {
        throw new BadRequestError(
          'This import produced no rows to file. Run the import first, then file it against ' +
            'the account.'
        )
      }

      // Every row already on the account, read ONCE, before anything is written.
      // The feed candidates and the "is this id already here" set both come from
      // it, and re-reading between writes would let a row this call just stamped
      // become its own duplicate candidate.
      const before = await readTransactionsByAccount(db, organizationId, ctx, bankAccountId)
      const beforeIds = new Set(before.map((row) => row.id))
      const knownExternalIds = new Set(
        before.map((row) => row.externalId).filter((id): id is string => !!id)
      )
      const feedRows = before.filter((row) => row.source === 'feed')

      const produced = await readProducedRows(db, organizationId, ctx, producedIds)
      const accountRecordId = toRecordId(
        (await requireBankAccountFieldContext(organizationId)).bankAccountDefId,
        bankAccountId
      )
      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

      let stamped = 0
      let externalIdsSynthesised = 0
      let linkedToFeed = 0
      // A feed row this import UPDATED (its id matched) is already spoken for and
      // may not also be claimed as some other row's cross-source counterpart.
      const claimedFeedRows = new Set<string>(producedIds)
      // The ordinal counter, over the WHOLE batch: it is what keeps two
      // identical same-day rows two rows (05 §4).
      const ordinals = new Map<string, number>()

      for (const row of produced) {
        const matchKey = normalizeMatchKey(row.description)
        const patch: Record<string, unknown> = {
          bank_transaction_bank_account: accountRecordId,
          bank_transaction_source: 'import',
          bank_transaction_import_batch_id: importJobId,
          bank_transaction_match_key: matchKey || null,
        }

        let externalId = row.externalId
        if (!externalId && row.postedAt && row.amountMinor != null) {
          const triple = `${row.postedAt}|${row.amountMinor}|${matchKey}`
          const ordinal = ordinals.get(triple) ?? 0
          ordinals.set(triple, ordinal + 1)
          externalId = buildImportedExternalId({
            bankAccountId,
            postedAt: row.postedAt,
            amountMinor: row.amountMinor,
            matchKey,
            ordinal,
          })
          patch.bank_transaction_external_id = externalId
          externalIdsSynthesised += 1
        }

        // Cross-source link. Only a row that was NOT already on this account
        // before the run is a candidate: an id the importer matched is the same
        // row updated, not a second sighting.
        const isNew = !beforeIds.has(row.id) && !(externalId && knownExternalIds.has(externalId))
        if (isNew && matchKey && row.glPostingId == null) {
          const counterpart = feedRows.find(
            (feed) =>
              !claimedFeedRows.has(feed.id) &&
              feed.matchKey === matchKey &&
              feed.amountMinor === row.amountMinor &&
              withinWindow(feed.postedAt, row.postedAt)
          )
          if (counterpart) {
            claimedFeedRows.add(counterpart.id)
            linkedToFeed += 1
            patch.bank_transaction_review_status = 'excluded'
            patch.bank_transaction_matched_record_id = counterpart.id
            patch.bank_transaction_matched_record_type = 'bank_transaction'
            patch.bank_transaction_exclude_reason = describeLink(counterpart)
          }
        }

        await crud.update(toRecordId(ctx.bankTransactionDefId, row.id), patch)
        stamped += 1
      }

      const coverage = await moveCoverage(db, {
        organizationId,
        actorUserId,
        bankAccountId,
        storedGaps: account.value.coverageGaps,
        currentCoverageFrom: account.value.coverageFrom,
        importedFrom: earliestDate(produced),
        importedTo: latestDate(produced),
      })

      logger.info('Filed a bank statement import', {
        organizationId,
        bankAccountId,
        importJobId,
        stamped,
        linkedToFeed,
        externalIdsSynthesised,
      })

      // Suggestions run AFTER the rows carry their matchKey and coverage has
      // moved (slot 3C's `runSuggestionsForAccount`). Best effort: a refusal
      // leaves the lines `for_review`, which is exactly what the queue shows.
      const suggested = await runSuggestionsForAccount(db, {
        organizationId,
        actorUserId,
        bankAccountId,
      })
      if (suggested.isErr()) {
        logger.warn('Suggestions did not run after a bank import', {
          organizationId,
          bankAccountId,
          error: suggested.error.message,
        })
      }

      return {
        importBatchId: importJobId,
        bankAccountId,
        stamped,
        externalIdsSynthesised,
        linkedToFeed,
        coverageFrom: coverage.coverageFrom,
        gaps: coverage.gaps,
      } satisfies FinalizeBankImportResult
    },
    'Failed to file a bank statement import',
    { organizationId, bankAccountId, importJobId }
  )
}

/**
 * Recompute and store an account's coverage.
 *
 * 🛑 **Only `coverageFrom` and the STORED gaps are written, and the stored gaps
 * are only ever SHRUNK by a range we now hold.** `readCoverage` folds the stored
 * list together with what the transactions imply, and the stored list wins on
 * overlap because it is testimony ("we imported January and it really was
 * empty") where the derived list is inference (`banking/client.ts`). Writing the
 * derived gaps back would launder a heuristic into testimony, after which the
 * heuristic can never be improved without rewriting history.
 */
export async function moveCoverage(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    bankAccountId: string
    storedGaps: readonly CoverageGap[]
    currentCoverageFrom: string | null
    importedFrom: string | null
    importedTo: string | null
  }
): Promise<{ coverageFrom: string | null; gaps: CoverageGap[] }> {
  const { organizationId, actorUserId, bankAccountId } = params

  const coverageFrom = earliest(params.currentCoverageFrom, params.importedFrom)
  const storedGaps = params.storedGaps.flatMap((gap) =>
    subtractCoveredRange(gap, params.importedFrom, params.importedTo)
  )

  const changedFrom = coverageFrom !== params.currentCoverageFrom
  const changedGaps = JSON.stringify(storedGaps) !== JSON.stringify(params.storedGaps)

  if (changedFrom || changedGaps) {
    const accountCtx = await requireBankAccountFieldContext(organizationId)
    const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
    await crud.update(toRecordId(accountCtx.bankAccountDefId, bankAccountId), {
      ...(changedFrom ? { bank_account_coverage_from: coverageFrom } : {}),
      ...(changedGaps ? { bank_account_coverage_gaps: storedGaps } : {}),
    })
  }

  const coverage = await readCoverage(db, { organizationId, bankAccountId })
  if (coverage.isErr()) throw coverage.error
  return { coverageFrom: coverage.value.coverageFrom, gaps: coverage.value.gaps }
}

/**
 * The ids of every record an import job actually wrote.
 *
 * `resultRecordId` is set by `executeStrategy` for both the create and the
 * update path, so this covers a re-import that matched existing rows as well as
 * a first one.
 */
export async function readProducedRecordIds(
  db: Database,
  organizationId: string,
  importJobId: string
): Promise<string[]> {
  const rows = await db
    .select({ resultRecordId: schema.ImportPlanRow.resultRecordId })
    .from(schema.ImportPlanRow)
    .innerJoin(
      schema.ImportPlanStrategy,
      eq(schema.ImportPlanRow.importPlanStrategyId, schema.ImportPlanStrategy.id)
    )
    .innerJoin(schema.ImportPlan, eq(schema.ImportPlanStrategy.importPlanId, schema.ImportPlan.id))
    .innerJoin(schema.ImportJob, eq(schema.ImportPlan.importJobId, schema.ImportJob.id))
    .where(
      and(
        eq(schema.ImportJob.id, importJobId),
        eq(schema.ImportJob.organizationId, organizationId),
        isNotNull(schema.ImportPlanRow.resultRecordId)
      )
    )

  return [...new Set(rows.map((row) => row.resultRecordId).filter((id): id is string => !!id))]
}

/** The produced rows, narrowed to the ones that really are `bank_transaction`s. */
async function readProducedRows(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  producedIds: string[]
): Promise<BankTransactionRow[]> {
  const instances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.bankTransactionDefId),
        inArray(schema.EntityInstance.id, producedIds)
      )
    )
  if (instances.length === 0) {
    throw new BadRequestError(
      'This import did not write bank transactions. Check that the wizard targeted the bank ' +
        'transaction entity before filing it against an account.'
    )
  }

  return hydrateTransactions(
    db,
    organizationId,
    ctx,
    instances.map((row) => row.id)
  )
}

/** The sentence a linked row carries in place of a review decision. */
function describeLink(counterpart: BankTransactionRow): string {
  const when = counterpart.postedAt ?? 'an unknown date'
  const id = counterpart.externalId ?? counterpart.id
  return (
    `${IMPORT_LINK_EXCLUSION_PREFIX} ${id} on ${when}. The feed row is the one to ` +
    'review: it updates as the bank re-states the transaction, where an imported statement ' +
    'is a frozen snapshot.'
  )
}

function earliestDate(rows: readonly BankTransactionRow[]): string | null {
  return rows.reduce<string | null>((acc, row) => earliest(acc, row.postedAt), null)
}

function latestDate(rows: readonly BankTransactionRow[]): string | null {
  return rows.reduce<string | null>(
    (acc, row) => (row.postedAt && (!acc || row.postedAt > acc) ? row.postedAt : acc),
    null
  )
}
