// packages/lib/src/money/invoices/receipt-accounting.ts

/**
 * A confirmed customer receipt against an ISSUED INVOICE, as a durable
 * accounting effect — the second policy under the `customer_receipt` family
 * (plans/accounting/tasks/54-one-money-model.md §7).
 *
 * ```
 *   Dr <the bank account the money landed in>   the receipt amount
 *       Cr accounts_receivable                    the same
 * ```
 *
 * ## 🔑 Why this is not `customer-money/accounting.ts`
 *
 * That module is the same family's ORDER policy, and it is order-shaped all the
 * way down: it requires a `FinancialSourceAcceptance` from a live source
 * account, a recognition timeline to allocate the receipt against, and a tax
 * component split. All three exist because a Shopify receipt can arrive before
 * anything has been recognized — the money may be a deposit, a receivable, or
 * partly tax, and only the timeline knows which.
 *
 * An issued invoice has already answered that question.
 * `buildInvoiceEntry` booked `Dr accounts_receivable / Cr revenue / Cr
 * sales_tax_payable` at issue (`postings/build-invoice-entry.ts:216-238`), so
 * money received against it recognizes nothing and splits nothing. It relieves
 * the receivable, in full, and that is the entire entry.
 *
 * ## 🛑 The receipt is never amended
 *
 * Ground rule 6, inherited from the lane this replaces
 * (`payments/post-deposit-application.ts:15`). If the money is later moved to a
 * different invoice that is a `MoneyApplication` `unapply` + `apply` pair and
 * its own journal, never a rewrite of this one.
 *
 * ## ⚠️ Reads and the revalidator live in one file, deliberately
 *
 * `docs/lib-module-guide.md` §5 splits reads from writes. The exception here is
 * the one `deposit-application-accounting.ts` already makes: `prepareReceipt`
 * is called twice — once to build, once INSIDE `acceptEntryInTx` under the
 * commit lock — and both runs must produce a byte-identical accepted basis or
 * acceptance refuses. Splitting the two callers across files hides the single
 * most important thing about the function.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 * @see docs/lib-module-guide.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { ACCOUNT_ROLES, buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import { accountingBasisHash, toLedgerMinor } from '../../postings/effect-basis'
import {
  type AcceptedCustomerReceiptEffectBasisV1,
  acceptedCustomerReceiptEffectBasisSchema,
  type CustomerReceiptWorkBasisInput,
  customerReceiptWorkBasisSchema,
  type InvoiceReceiptAccountingBasisV1,
} from '../../postings/effect-types'
import { captureCustomerReceiptWorkInTx } from '../../postings/effect-work'
import { periodKeyForDate } from '../../postings/periods'
import { resolveBankAccountGlAccountInTx } from '../../postings/resolve-cash-account'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { BuiltEntry, GlPostingLineInput, PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { loadInvoiceForIssuance } from './issuance-reads'

const logger = createScopedLogger('invoice-receipt-accounting')

/** Every line's `sourceType` is the movement, as the order policy's are. */
const RECEIPT_SOURCE_TYPE = 'money_transaction'

export interface AcceptInvoiceReceiptInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  actorUserId?: string
  /** A sweep posts `automatic` work; an operator-driven command posts `manual`. */
  automatic?: boolean
}

interface PreparedInvoiceReceipt {
  entry: BuiltEntry
  workBasis: CustomerReceiptWorkBasisInput
  acceptedBasis: AcceptedCustomerReceiptEffectBasisV1
}

/**
 * The movement, the single invoice its applications name, and what that invoice
 * still owed — or a refusal saying which is missing.
 *
 * 🛑 The invoice is resolved through `EntityDefinition.entityType`, never
 * trusted from the FK, for the reason `deposit-application-accounting.ts` gives:
 * the FK proves an `EntityInstance` in this org and nothing more, and crediting
 * a receivable no invoice ever raised is not recoverable by a later correction.
 */
async function readInvoiceReceiptSource(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string,
  bookTimeZone: string
) {
  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.id, moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt')
    ),
  })
  if (
    !money ||
    money.currency !== 'USD' ||
    money.currencyExponent !== 2 ||
    (!money.occurredAt && !money.occurredOn)
  )
    throw new UnprocessableEntityError(
      'Invoice receipt requires a confirmed USD amount and an occurrence date'
    )
  // 🔑 No bank account is NOT an error. `cashAccountInstanceId` null means the
  // money has not been banked yet and belongs in undeposited funds — which is
  // where `bank-deposits/route.ts` sends cash and cheque on purpose. See
  // `debitSelectedBy` on the basis.
  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
  const invoiceInstanceId = applications[0]?.invoiceInstanceId
  // The same completeness rule the order policy applies, against the other
  // document: one invoice, all applies, summing to the whole movement. A
  // partially applied receipt is held money and belongs to `deposit_application`.
  if (
    !invoiceInstanceId ||
    applications.some(
      (a) => a.operation !== 'apply' || a.invoiceInstanceId !== invoiceInstanceId
    ) ||
    applications.reduce((sum, a) => sum + a.amountMinor, 0n) !== money.amountMinor
  )
    throw new UnprocessableEntityError(
      'Invoice receipt needs complete applications to one invoice; unapplications require correction'
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
      'Invoice receipt requires a live invoice in this organization'
    )

  const fields = await loadInvoiceForIssuance(tx, organizationId, invoiceInstanceId)
  if (!fields?.totalMinor)
    throw new UnprocessableEntityError('Invoice receipt requires an invoice with a total')

  // What the invoice owed BEFORE this movement. Everything already applied to
  // it by any OTHER movement, netted — the ledger is the record of what is
  // settled, exactly as the lane this replaces read it.
  const others = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId)
    ),
  })
  const settledMinor = others
    .filter((a) => a.moneyTransactionId !== moneyTransactionId)
    .reduce((sum, a) => sum + (a.operation === 'apply' ? a.amountMinor : -a.amountMinor), 0n)

  return {
    money,
    invoiceInstanceId,
    invoiceNumber: fields.number || null,
    invoiceTotalMinor: BigInt(fields.totalMinor),
    invoiceOutstandingMinor: BigInt(fields.totalMinor) - settledMinor,
    // The invoice's own contact, not the movement's party: `accounts_receivable`
    // is a per-customer balance and has to agree with the issuance entry.
    contactInstanceId: fields.contactInstanceId ?? money.partyInstanceId ?? null,
    cashAccountInstanceId: money.cashAccountInstanceId,
    // An instant converts into the book's day; a date-precision receipt already
    // IS that day and must not be pushed through a timezone.
    effectiveDate: money.occurredAt
      ? periodKeyForDate(money.occurredAt, 'day', bookTimeZone)
      : money.occurredOn!,
    applications,
  }
}

/**
 * Read the movement, resolve its accounts and freeze both bases.
 *
 * 🛑 Called TWICE — see the file header. An invoice re-contacted, a bank
 * account repointed or an application re-dated between the two runs is a change
 * the ledger must refuse, not absorb.
 */
async function prepareInvoiceReceipt(
  tx: Transaction,
  input: AcceptInvoiceReceiptInput
): Promise<PreparedInvoiceReceipt> {
  const currency = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'organization.currency',
  })
  if (currency !== 'USD')
    throw new UnprocessableEntityError('Invoice receipt accounting requires USD')
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')

  const source = await readInvoiceReceiptSource(
    tx,
    input.organizationId,
    input.moneyTransactionId,
    zone
  )
  // Two ways in, one frozen answer. A named bank account resolves through its
  // `bank_account_gl_account` pointer; an unbanked receipt takes the
  // `undeposited_funds` ROLE and waits for a `bank_deposit` to move it.
  const bankAccountInstanceId = source.cashAccountInstanceId
  const debitSelectedBy = bankAccountInstanceId ? 'bank_account' : 'undeposited_funds'
  const debitGlAccountId = bankAccountInstanceId
    ? await resolveBankAccountGlAccountInTx(
        tx,
        input.organizationId,
        bankAccountInstanceId,
        'Invoice receipt'
      )
    : undefined
  const amountMinor = toLedgerMinor(source.money.amountMinor, 'USD', 2)
  const label = source.invoiceNumber
    ? `Payment received on ${source.invoiceNumber}`
    : 'Payment received'
  const base = {
    sourceType: RECEIPT_SOURCE_TYPE,
    sourceId: source.money.id,
    ...(source.contactInstanceId
      ? { counterpartyType: 'customer' as const, counterpartyId: source.contactInstanceId }
      : {}),
  }
  // ⚠️ `GlPostingLineInput` is a union with `never` on the unused half, so the
  // two debits are separate literals — a single object with one side
  // `undefined` does not satisfy either member.
  const debitLine: GlPostingLineInput = debitGlAccountId
    ? {
        ...base,
        glAccountId: debitGlAccountId,
        direction: 'debit',
        amount: amountMinor,
        sortOrder: 0,
        memo: label,
      }
    : {
        ...base,
        accountRole: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        direction: 'debit',
        amount: amountMinor,
        sortOrder: 0,
        memo: label,
      }
  const lines: GlPostingLineInput[] = [
    debitLine,
    {
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount: amountMinor,
      sortOrder: 1,
      memo: label,
    },
  ]
  const entry = buildEntry({
    postingType: 'payment',
    periodKey: source.effectiveDate,
    txnDate: source.effectiveDate,
    lines,
  })
  const resolved = await resolveAccountLines(tx, input.organizationId, lines)
  if (resolved.isErr()) throw resolved.error
  // Both destinations are assets — a bank account and `undeposited_funds`
  // alike (`build-entry.ts:380`). Debiting anything else means the chart has
  // been repointed at the wrong kind of account.
  if (resolved.value[0]?.accountType !== 'asset')
    throw new UnprocessableEntityError('Invoice receipt must debit an asset account')
  const cashGlAccountId = resolved.value[0].glAccountId

  // The resolved accounts are IN the hash, as on every other effect path: a role
  // repointed in the chart is a new basis version to select, never a silent
  // restatement of an obligation somebody already approved.
  const sourceHash = accountingBasisHash({
    movement: {
      id: source.money.id,
      amount: String(amountMinor),
      occurredAt: source.money.occurredAt?.toISOString() ?? null,
      occurredOn: source.money.occurredOn ?? null,
      date: source.effectiveDate,
    },
    invoice: {
      id: source.invoiceInstanceId,
      number: source.invoiceNumber,
      contact: source.contactInstanceId,
      total: String(source.invoiceTotalMinor),
      outstanding: String(source.invoiceOutstandingMinor),
    },
    applications: source.applications.map((a) => ({ id: a.id, amount: String(a.amountMinor) })),
    accounts: resolved.value.map((account) => account.glAccountId),
  })

  const calculation: InvoiceReceiptAccountingBasisV1 = {
    version: 1,
    kind: 'invoice_receipt',
    moneyTransactionId: source.money.id,
    invoiceInstanceId: source.invoiceInstanceId,
    sourceHash,
    occurredAt: source.money.occurredAt?.toISOString() ?? null,
    occurredOn: source.money.occurredOn ?? null,
    effectiveDate: source.effectiveDate,
    currency: 'USD',
    currencyExponent: 2,
    amountMinor: String(amountMinor),
    receiptAmountMinor: String(amountMinor),
    invoiceTotalMinor: String(source.invoiceTotalMinor),
    invoiceOutstandingMinor: String(source.invoiceOutstandingMinor),
    receivableMinor: String(amountMinor),
    cashGlAccountId,
    debitSelectedBy,
    bankAccountInstanceId: bankAccountInstanceId ?? null,
    applications: source.applications.map((a) => ({
      applicationId: a.id,
      invoiceInstanceId: source.invoiceInstanceId,
      amountMinor: String(a.amountMinor),
      effectiveDate: source.effectiveDate,
    })),
  }

  const workBasis = customerReceiptWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    moneyTransactionId: source.money.id,
    sourceHash,
    effectiveDate: source.effectiveDate,
    calculation,
  })

  const acceptedBasis = acceptedCustomerReceiptEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'invoice_receipt_v1',
    policyVersion: 1,
    effectiveDate: source.effectiveDate,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'invoice', entityInstanceId: source.invoiceInstanceId },
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

  return { entry, workBasis, acceptedBasis }
}

/**
 * Capture the obligation and accept the receipt journal as one transaction.
 *
 * **Never throws.** Every refusal comes back as a {@link PostResult}, for the
 * reason the whole money lane holds to: a payment must not fail because its
 * bookkeeping did.
 *
 * Idempotent — the work's `effectKey` is unique per movement, so a second call
 * whose basis is unchanged returns the accepted effect's own journal rather
 * than claiming a second one.
 */
export async function acceptInvoiceReceiptAccounting(
  db: Database,
  input: AcceptInvoiceReceiptInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  let result: PostResult
  try {
    result = await db.transaction(async (tx) => {
      const prepared = await prepareInvoiceReceipt(tx, input)
      const selected = await captureCustomerReceiptWorkInTx(tx, {
        organizationId: input.organizationId,
        moneyTransactionId: input.moneyTransactionId,
        eligibility: input.automatic ? 'automatic' : 'manual',
        basis: prepared.workBasis,
      })
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          memo: `Invoice payment - movement ${input.moneyTransactionId}`,
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
            ...(await prepareInvoiceReceipt(lockedTx, input)).acceptedBasis,
            sourceBasisVersion: work.basisVersion,
          }),
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new UnprocessableEntityError('Invoice receipt accounting membership changed')
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
    logger.warn('An invoice receipt was not accepted into the ledger', {
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }

  // Delivery is attempted OUTSIDE the transaction, as every other effect path
  // does it: a provider that is slow or down must not hold the commit lock, and
  // `sweepAccountingDeliveries` is the backstop for anything that never woke up.
  if (result.glPostingId) {
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('An accepted invoice receipt awaits delivery recovery', {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
        error: String(error),
      })
    }
  }
  return result
}
