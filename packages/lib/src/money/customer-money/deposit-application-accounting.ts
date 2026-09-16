// packages/lib/src/money/customer-money/deposit-application-accounting.ts

/**
 * A held customer prepayment being applied to an invoice, as a durable
 * accounting EFFECT — the last of D19's seven
 * (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3).
 *
 * ```
 *   Dr customer_deposits        the applied amount
 *       Cr accounts_receivable    the same
 * ```
 *
 * ## 🔑 Why the upstream is a `MoneyApplication`
 *
 * `AccountingWork` can name exactly two owners: an `EntityInstance` and a
 * `MoneyTransaction`. The dispatch-era deposit application is a
 * `PaymentAllocation` row, which is neither, and `MoneyTransaction.purpose` is
 * CHECK-constrained to four values none of which a `PaymentTransaction` mirrors
 * — so that lane genuinely cannot own an effect without a third owner column,
 * which is a permanent tax on every future reader of the effects model.
 *
 * ✅ `MoneyApplication` already models this exactly: `moneyTransactionId` plus
 * exactly one of `orderInstanceId`/`invoiceInstanceId`/`vendorBillInstanceId`
 * (`num_nonnulls(...) = 1`), an `operation`, an `amountMinor`, an
 * `effectiveDate` and a `reversesApplicationId`. Applying a customer prepayment
 * to an invoice IS a `MoneyApplication` with `invoiceInstanceId` set, and that
 * is the only upstream this module reads.
 *
 * ## 🛑 It is the MONEY that is the owner, not the invoice
 *
 * The obligation is money-owned — `moneyTransactionId` set, `entityInstanceId`
 * null — because the event is a customer's money changing character. The invoice
 * is what it was applied TO. The identity, though, is the APPLICATION: one
 * receipt applied to three invoices is three events, so `effectKey` comes from
 * the `MoneyApplication` id and `AccountingWork_money_original_key` is narrowed
 * to let a movement hold more than one of them.
 *
 * ## ⚠️ No traffic yet, and that is a producer gap, not a gap here
 *
 * The only writer of `MoneyApplication` today
 * (`money/customer-money/ingest.ts`) applies confirmed movements to ORDERS, so
 * {@link listDepositApplicationAccountingCandidates} legitimately returns
 * nothing until a customer-money command learns to apply money to an invoice.
 * The dispatch-era lane (`money/payments/post-deposit-application.ts`) keeps
 * posting its own `deposit_application` journals off `PaymentAllocation` in the
 * meantime; the two claim disjoint period keys and never post the same journal.
 *
 * @see plans/accounting/tasks/07-customer-deposits.md
 * @see docs/lib-module-guide.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  type AcceptedMoneyApplicationEffectBasisV1,
  acceptedMoneyApplicationEffectBasisSchema,
  MONEY_APPLICATION_POSTING_TYPE,
  MONEY_APPLICATION_RESOURCE_KIND,
  type MoneyApplicationBasisV1,
  type MoneyApplicationWorkBasisInput,
  moneyApplicationWorkBasisSchema,
} from '../../postings/application-effect-types'
import { captureMoneyApplicationWorkInTx } from '../../postings/application-effect-work'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { ACCOUNT_ROLES, buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import { accountingBasisHash, toLedgerMinor } from '../../postings/effect-basis'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { BuiltEntry, GlPostingLineInput, PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { loadInvoiceForIssuance } from '../invoices/issuance-reads'

const logger = createScopedLogger('money-deposit-application-accounting')

/** The `sourceType` every application line carries — the movement, as the receipt's lines do. */
const APPLICATION_SOURCE_TYPE = 'money_transaction'

export interface AcceptDepositApplicationInput {
  organizationId: string
  /** The `MoneyApplication` row to post. */
  moneyApplicationId: string
  actorUserId?: string
  /** A sweep posts `automatic` work; an operator-driven command posts `manual`. */
  automatic?: boolean
}

interface PreparedDepositApplication {
  entry: BuiltEntry
  moneyTransactionId: string
  workBasis: MoneyApplicationWorkBasisInput
  acceptedBasis: AcceptedMoneyApplicationEffectBasisV1
}

/**
 * The application, its movement and the invoice it names — or a refusal saying
 * which of the three is missing.
 *
 * 🛑 The invoice is resolved through `EntityDefinition.entityType`, not trusted
 * from `MoneyApplication`'s FK: the FK guarantees an `EntityInstance` in this
 * organization and nothing more, and a reclass against a record that is not an
 * invoice would credit a receivable no invoice ever raised.
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
    // The invoice's own contact, not the movement's party: the two balance-sheet
    // roles are per-customer balances and must agree with the receivable the
    // issuance entry raised.
    contactInstanceId: fields?.contactInstanceId ?? money.partyInstanceId ?? null,
  }
}

/**
 * Read the application, resolve its accounts and freeze both bases.
 *
 * 🛑 Called TWICE: once to prepare, and again inside `acceptEntryInTx` under the
 * commit lock as the revalidator. Both runs must produce the identical accepted
 * basis or acceptance refuses — an application re-dated, an invoice re-contacted
 * or a `customer_deposits` role repointed between the two is a change the ledger
 * must not absorb silently.
 */
async function prepareDepositApplication(
  tx: Transaction,
  input: AcceptDepositApplicationInput
): Promise<PreparedDepositApplication> {
  const source = await readApplicationSource(tx, input.organizationId, input.moneyApplicationId)

  const currency = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'organization.currency',
  })
  if (currency !== 'USD')
    throw new UnprocessableEntityError('Deposit application accounting requires USD')
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')

  const amountMinor = toLedgerMinor(source.application.amountMinor, 'USD', 2)
  // 🛑 The APPLICATION's own day, never the day the money arrived. The
  // prepayment changed character when it was applied.
  const effectiveDate = source.application.effectiveDate
  const memo = source.invoiceNumber
    ? `Customer deposit applied to ${source.invoiceNumber}`
    : 'Customer deposit applied to an invoice'
  const base = {
    sourceType: APPLICATION_SOURCE_TYPE,
    sourceId: source.money.id,
    memo,
    ...(source.contactInstanceId
      ? { counterpartyType: 'customer' as const, counterpartyId: source.contactInstanceId }
      : {}),
  }
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
      direction: 'debit',
      amount: amountMinor,
      sortOrder: 0,
    },
    {
      ...base,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'credit',
      amount: amountMinor,
      sortOrder: 1,
    },
  ]
  const entry = buildEntry({
    postingType: MONEY_APPLICATION_POSTING_TYPE,
    // Overwritten by `acceptEntryInTx` with the membership hash, as every
    // money-owned family's is — an application has no readable number of its own
    // to claim on.
    periodKey: effectiveDate,
    txnDate: effectiveDate,
    lines,
  })

  // An application carries no source axis, so every role resolves to the org
  // default and the scope is empty on both sides.
  const resolved = await resolveAccountLines(tx, input.organizationId, lines)
  if (resolved.isErr()) throw resolved.error

  // The resolved accounts are IN the source hash, as they are on every other
  // effect path: a role repointed in the chart is a new basis version to select,
  // not a silent restatement of an obligation somebody already approved.
  const sourceHash = accountingBasisHash({
    application: {
      id: source.application.id,
      movement: source.application.moneyTransactionId,
      invoice: source.invoiceInstanceId,
      amount: String(amountMinor),
      date: effectiveDate,
    },
    invoice: { number: source.invoiceNumber, contact: source.contactInstanceId },
    accounts: resolved.value.map((account) => account.glAccountId),
  })

  const calculation: MoneyApplicationBasisV1 = {
    version: 1,
    moneyApplicationId: source.application.id,
    moneyTransactionId: source.application.moneyTransactionId,
    invoiceInstanceId: source.invoiceInstanceId,
    invoiceNumber: source.invoiceNumber,
    contactInstanceId: source.contactInstanceId,
    sourceHash,
    effectiveDate,
    currency: 'USD',
    currencyExponent: 2,
    amountMinor: String(amountMinor),
    lines: lines.map((line, index) => ({
      lineKey: `line:${index}`,
      accountRole: line.accountRole ?? null,
      glAccountId: line.accountRole ? null : (line.glAccountId ?? null),
      direction: line.direction,
      amountMinor: String(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })),
  }

  const workBasis = moneyApplicationWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    moneyApplicationId: source.application.id,
    moneyTransactionId: source.application.moneyTransactionId,
    sourceHash,
    effectiveDate,
    calculation,
  })

  const acceptedBasis = acceptedMoneyApplicationEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'money_application_v1',
    policyVersion: 1,
    effectiveDate,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: MONEY_APPLICATION_RESOURCE_KIND, entityInstanceId: source.invoiceInstanceId },
      { resourceKind: 'money_transaction', entityInstanceId: source.money.id },
    ],
    calculation,
    accountResolution: lines.map((line, index) => ({
      lineKey: `line:${index}`,
      glAccountId: resolved.value[index]!.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.accountRole ? 'org_role' : 'document',
      configurationHash: accountingBasisHash(resolved.value[index]!),
    })),
    contribution: lines.map((line, index) => ({
      lineKey: `line:${index}`,
      glAccountId: resolved.value[index]!.glAccountId,
      direction: line.direction,
      amountMinor: String(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })),
  })

  return {
    entry,
    moneyTransactionId: source.application.moneyTransactionId,
    workBasis,
    acceptedBasis,
  }
}

/**
 * Capture the obligation and accept the reclass journal as one transaction.
 *
 * **Never throws.** Every refusal is a {@link PostResult}, for the reason
 * `post-deposit-application.ts` gives: an application must not fail because its
 * bookkeeping did.
 *
 * Idempotent: the work's `effectKey` is unique per application, and a second
 * call whose basis is unchanged returns the accepted effect's own journal rather
 * than claiming a second one.
 */
export async function acceptDepositApplicationAccounting(
  db: Database,
  input: AcceptDepositApplicationInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  let result: PostResult
  try {
    result = await db.transaction(async (tx) => {
      const prepared = await prepareDepositApplication(tx, input)
      const selected = await captureMoneyApplicationWorkInTx(tx, {
        organizationId: input.organizationId,
        moneyApplicationId: input.moneyApplicationId,
        moneyTransactionId: prepared.moneyTransactionId,
        eligibility: input.automatic ? 'automatic' : 'manual',
        basis: prepared.workBasis,
      })
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          memo: `Customer deposit applied - movement ${prepared.moneyTransactionId}`,
          entry: prepared.entry,
          members: [
            {
              workId: selected.work.id,
              expectedBasisVersion: selected.work.basisVersion,
              acceptedBasis: {
                ...prepared.acceptedBasis,
                sourceBasisVersion: selected.work.basisVersion,
              },
            },
          ],
          deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
            tx,
            input.organizationId,
            prepared.entry.txnDate
          ),
        },
        {
          revalidateMemberInTx: async (lockedTx, work) => ({
            ...(await prepareDepositApplication(lockedTx, input)).acceptedBasis,
            sourceBasisVersion: work.basisVersion,
          }),
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new UnprocessableEntityError('Deposit application accounting membership changed')
      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return {
        status: accepted.existing ? 'already_posted' : 'posted',
        glPostingId: accepted.glPostingId,
      } satisfies PostResult
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('A deposit application was not accepted into the ledger', {
      organizationId: input.organizationId,
      moneyApplicationId: input.moneyApplicationId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }

  if (result.glPostingId) {
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('An accepted deposit application awaits delivery recovery', {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
        error: String(error),
      })
    }
  }
  return result
}

/**
 * The invoice applications this organization owes a `deposit_application`
 * effect, oldest first.
 *
 * The same left-join shape `listCustomerReceiptAccountingCandidates` uses: an
 * application with no work at all, or with work still `pending`/`blocked` whose
 * retry window has opened. An `unapply` is excluded — reversing an application is
 * the correction of its effect, not a second reclass.
 */
export async function listDepositApplicationAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.MoneyApplication.id })
    .from(schema.MoneyApplication)
    .leftJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.moneyTransactionId, schema.MoneyApplication.moneyTransactionId),
        eq(schema.AccountingWork.effectKind, 'deposit_application'),
        eq(schema.AccountingWork.operation, 'original'),
        // 🛑 Joined on the effect KEY, not on the movement alone: a movement can
        // own several applications, so matching by movement would hide every
        // application after the first behind the first one's work row. The
        // literal is `moneyApplicationAccountingEffectKey` spelled in SQL — ids
        // are cuid2, so there is nothing for `JSON.stringify` to escape.
        sql`${schema.AccountingWork.effectKey} = 'deposit_application:["' || ${schema.MoneyApplication.id} || '","original"]'`
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.operation, 'apply'),
        isNotNull(schema.MoneyApplication.invoiceInstanceId),
        or(
          isNull(schema.AccountingWork.id),
          and(
            sql`${schema.AccountingWork.state} IN ('pending', 'blocked')`,
            or(
              isNull(schema.AccountingWork.nextAttemptAt),
              lte(schema.AccountingWork.nextAttemptAt, new Date())
            )
          )
        )
      )
    )
    .orderBy(
      sql`COALESCE(${schema.AccountingWork.updatedAt}, ${schema.MoneyApplication.createdAt})`,
      asc(schema.MoneyApplication.id)
    )
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
