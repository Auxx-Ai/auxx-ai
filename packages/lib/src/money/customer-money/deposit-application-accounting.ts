// packages/lib/src/money/customer-money/deposit-application-accounting.ts

/**
 * A held customer prepayment being applied to an invoice.
 *
 * ```
 *   Dr customer_deposits        the applied amount
 *       Cr accounts_receivable    the same
 * ```
 *
 * Subject the `MoneyApplication`, parent the invoice (TARGET §5). One receipt
 * applied to three invoices is three applications, three claims and three
 * entries; `unapply-money.ts` reverses one of them.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { readAutoPostMode } from '../../postings/auto-post'
import { toLedgerMinor } from '../../postings/basis-hash'
import { buildDepositApplicationEntry } from '../../postings/build-deposit-application-entry'
import { findLiveSubjectPosting } from '../../postings/list-postings'
import { resolvePeriodLock } from '../../postings/period-lock'
import { postEntry } from '../../postings/post-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import type { GlPostingSourceInput, PostResult } from '../../postings/types'
import { loadInvoiceForIssuance } from '../invoices/issuance-reads'

const logger = createScopedLogger('money-deposit-application-accounting')

/** The `sourceKind` the application's subject row carries. */
export const MONEY_APPLICATION_SOURCE_KIND = 'money_application'

export interface AcceptDepositApplicationInput {
  organizationId: string
  /** The `MoneyApplication` row to post. */
  moneyApplicationId: string
  actorUserId?: string
  /** Kept for the sweep's call sites; the poster no longer branches on it. */
  automatic?: boolean
}

/**
 * The application, its movement and the invoice it names.
 *
 * 🛑 The invoice is resolved through `EntityDefinition.entityType`, not trusted
 * from the FK: a reclass against a record that is not an invoice would credit a
 * receivable no invoice ever raised.
 */
async function readApplicationSource(
  tx: Transaction,
  organizationId: string,
  moneyApplicationId: string
) {
  const application = await tx.query.MoneyApplication.findFirst({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.id, moneyApplicationId),
      eq(schema.MoneyApplication.operation, 'apply'),
      isNotNull(schema.MoneyApplication.invoiceInstanceId)
    ),
  })
  if (!application)
    throw new UnprocessableEntityError(
      'Deposit application accounting requires a live invoice application'
    )
  const invoiceInstanceId = application.invoiceInstanceId!

  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.id, application.moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt')
    ),
  })
  if (!money || money.currency !== 'USD' || money.currencyExponent !== 2)
    throw new UnprocessableEntityError(
      'Deposit application accounting requires a confirmed USD customer receipt'
    )

  const [invoice] = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, invoiceInstanceId),
        eq(schema.EntityDefinition.entityType, 'invoice'),
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  if (!invoice)
    throw new UnprocessableEntityError(
      'Deposit application accounting requires a live invoice in this organization'
    )

  const fields = await loadInvoiceForIssuance(tx, organizationId, invoiceInstanceId)
  return {
    application,
    money,
    invoiceInstanceId,
    invoiceNumber: fields?.number ? fields.number : null,
    // The invoice's own contact, not the movement's party: both balance-sheet
    // roles are per-customer and must agree with the receivable the issuance
    // entry raised.
    contactInstanceId: fields?.contactInstanceId ?? money.partyInstanceId ?? null,
  }
}

/**
 * Post one deposit application.
 *
 * **Never throws.** Every refusal is a {@link PostResult}: an application must
 * not fail because its bookkeeping did.
 */
export async function acceptDepositApplicationAccounting(
  db: Database,
  input: AcceptDepositApplicationInput
): Promise<PostResult> {
  const { organizationId, moneyApplicationId, actorUserId } = input
  if (!(await isAccountingEnabled(db, organizationId))) return { status: 'not_enabled' }

  let prepared: {
    entry: ReturnType<typeof buildDepositApplicationEntry>
    sources: GlPostingSourceInput[]
  }
  try {
    prepared = await db.transaction(async (tx) => {
      const source = await readApplicationSource(tx, organizationId, moneyApplicationId)
      const entry = buildDepositApplicationEntry({
        allocationId: source.application.id,
        transactionId: source.application.moneyTransactionId,
        amountMinor: toLedgerMinor(source.application.amountMinor, 'USD', 2),
        // 🛑 The APPLICATION's own day, never the day the money arrived.
        appliedAt: source.application.effectiveDate,
        invoiceNumber: source.invoiceNumber,
        contactInstanceId: source.contactInstanceId,
      })
      const sources: GlPostingSourceInput[] = [
        {
          sourceKind: MONEY_APPLICATION_SOURCE_KIND,
          sourceId: source.application.id,
          linkRole: 'subject',
        },
        { sourceKind: 'invoice', sourceId: source.invoiceInstanceId, linkRole: 'parent' },
      ]
      return { entry, sources }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('A deposit application was not posted to the ledger', {
      organizationId,
      moneyApplicationId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }

  const lock = await resolvePeriodLock(organizationId)
  return postEntry(db, {
    organizationId,
    entry: prepared.entry.entry,
    actorUserId,
    lock,
    memo: `Customer deposit applied - application ${moneyApplicationId}`,
    sources: prepared.sources,
    mode: await readAutoPostMode(db, organizationId, 'receipt'),
  })
}

/**
 * Reverse one application's live posting, freeing its claim. `null` when the
 * application never posted or its posting was already reversed.
 */
export async function reverseDepositApplicationAccounting(
  db: Database,
  input: {
    organizationId: string
    moneyApplicationId: string
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, moneyApplicationId, actorUserId, memo } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: MONEY_APPLICATION_SOURCE_KIND,
    sourceId: moneyApplicationId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: memo ?? `Reversal of ${live.value.docNumber} - payment taken back off this invoice`,
  })
}

/**
 * Invoice applications with no live subject posting, oldest first. An `unapply`
 * is excluded - reversing an application is the undo of its entry, not a second
 * reclass.
 */
export async function listDepositApplicationAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.MoneyApplication.id })
    .from(schema.MoneyApplication)
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.operation, 'apply'),
        isNotNull(schema.MoneyApplication.invoiceInstanceId),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.GlPostingSource} link
        WHERE link."organizationId" = ${organizationId}
        AND link."sourceKind" = ${MONEY_APPLICATION_SOURCE_KIND}
        AND link."sourceId" = ${schema.MoneyApplication.id}
        AND link."linkRole" = 'subject')`
      )
    )
    .orderBy(asc(schema.MoneyApplication.createdAt), asc(schema.MoneyApplication.id))
    .limit(limit)
  return rows.map((row) => row.id)
}

/** Bounded recovery: retry repaired applications without starving later ones. */
export async function sweepDepositApplicationAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
) {
  const started = Date.now()
  const ids = await listDepositApplicationAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500)
  )
  const counts = { scanned: 0, posted: 0, skipped: 0 }
  for (const moneyApplicationId of ids) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    const result = await acceptDepositApplicationAccounting(db, {
      organizationId: input.organizationId,
      moneyApplicationId,
      automatic: true,
    })
    counts.scanned++
    if (result.status === 'posted' || result.status === 'already_posted') counts.posted++
    else counts.skipped++
  }
  return counts
}
