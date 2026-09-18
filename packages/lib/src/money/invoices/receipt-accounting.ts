// packages/lib/src/money/invoices/receipt-accounting.ts

/**
 * A confirmed customer receipt against an ISSUED INVOICE.
 *
 * ```
 *   Dr <the bank account the money landed in, or undeposited_funds>
 *       Cr accounts_receivable
 * ```
 *
 * ## 🔑 Why this is not `customer-money/accounting.ts`
 *
 * That module is the same avenue's ORDER policy: a Shopify receipt can arrive
 * before anything has been recognised, so it needs a recognition timeline and a
 * tax split to know whether the money is a deposit, a receivable or tax. An
 * issued invoice has already answered that question - the money relieves the
 * receivable, in full, and that is the entire entry.
 *
 * Subject the `MoneyTransaction`, parent the invoice, counterparty the invoice's
 * own contact (TARGET §5). `railId` is null for a hand-recorded receipt - that
 * money lands in a bank account or in undeposited funds - and names the gateway
 * for one collected online, which debits the rail's clearing account instead.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { getPaymentGateway } from '../../payment-gateways/reads'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { readAutoPostMode } from '../../postings/auto-post'
import { toLedgerMinor } from '../../postings/basis-hash'
import { ACCOUNT_ROLES, buildEntry } from '../../postings/build-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { postEntry } from '../../postings/post-entry'
import { resolveBankAccountGlAccountInTx } from '../../postings/resolve-cash-account'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type {
  BuiltEntry,
  GlPostingLineInput,
  GlPostingSourceInput,
  PostResult,
} from '../../postings/types'
import { readOrganizationSettings } from '../../settings/read'
import { loadInvoiceForIssuance } from './issuance-reads'

const logger = createScopedLogger('invoice-receipt-accounting')

/** Every line's `sourceType` is the movement, as the order policy's are. */
const RECEIPT_SOURCE_TYPE = 'money_transaction'

export interface AcceptInvoiceReceiptInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  actorUserId?: string
  /** Kept for the sweep's call sites; the poster no longer branches on it. */
  automatic?: boolean
  /**
   * The `payment_gateway` the money arrived through, for a receipt collected
   * online. The debit becomes that rail's clearing account - card settles NET
   * days later, so a gateway receipt must never claim a bank balance the bank
   * has not credited.
   */
  railId?: string
}

/**
 * The movement, the single invoice its applications name, and that invoice's
 * contact - or a refusal saying which is missing.
 *
 * 🛑 The invoice is resolved through `EntityDefinition.entityType`, never
 * trusted from the FK: the FK proves an `EntityInstance` in this org and nothing
 * more, and crediting a receivable no invoice ever raised is not recoverable.
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

  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
  const invoiceInstanceId = applications[0]?.invoiceInstanceId
  // One invoice, all applies, summing to the whole movement. A partially applied
  // receipt is held money and belongs to `deposit_application`.
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

  return {
    money,
    invoiceInstanceId,
    invoiceNumber: fields.number || null,
    // The invoice's own contact, not the movement's party: `accounts_receivable`
    // is a per-customer balance and has to agree with the issuance entry.
    contactInstanceId: fields.contactInstanceId ?? money.partyInstanceId ?? null,
    cashAccountInstanceId: money.cashAccountInstanceId,
    // An instant converts into the book's day; a date-precision receipt already
    // IS that day and must not be pushed through a timezone.
    effectiveDate: money.occurredAt
      ? periodKeyForDate(money.occurredAt, 'day', bookTimeZone)
      : money.occurredOn!,
  }
}

/** The clearing account a rail settles into, or a refusal naming the rail. */
async function resolveRailClearingAccount(
  tx: Transaction,
  organizationId: string,
  railId: string
): Promise<string> {
  const gateway = await getPaymentGateway(tx, organizationId, railId)
  if (gateway.isErr()) throw new UnprocessableEntityError(gateway.error.message)
  const clearing = gateway.value?.clearingGlAccountId?.trim()
  if (!clearing)
    throw new UnprocessableEntityError('That payment gateway names no clearing account')
  return clearing
}

interface PreparedInvoiceReceipt {
  entry: BuiltEntry
  sources: GlPostingSourceInput[]
}

async function prepareInvoiceReceipt(
  tx: Transaction,
  input: AcceptInvoiceReceiptInput
): Promise<PreparedInvoiceReceipt> {
  const settings = await readOrganizationSettings(input.organizationId, [
    'organization.currency',
    OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  ] as const)
  if (settings['organization.currency'] !== 'USD')
    throw new UnprocessableEntityError('Invoice receipt accounting requires USD')
  const zone = settings[OPENING_BASELINE_SETTING_KEYS.bookTimeZone]
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')

  const source = await readInvoiceReceiptSource(
    tx,
    input.organizationId,
    input.moneyTransactionId,
    zone
  )
  // A gateway receipt debits that rail's clearing account; a named bank account
  // resolves through its `bank_account_gl_account` pointer; an unbanked receipt
  // takes the `undeposited_funds` ROLE and waits for a `bank_deposit`.
  const debitGlAccountId = input.railId
    ? await resolveRailClearingAccount(tx, input.organizationId, input.railId)
    : source.cashAccountInstanceId
      ? await resolveBankAccountGlAccountInTx(
          tx,
          input.organizationId,
          source.cashAccountInstanceId,
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
  // two debits are separate literals.
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

  const sources: GlPostingSourceInput[] = [
    { sourceKind: RECEIPT_SOURCE_TYPE, sourceId: source.money.id, linkRole: 'subject' },
    { sourceKind: 'invoice', sourceId: source.invoiceInstanceId, linkRole: 'parent' },
    ...(source.contactInstanceId
      ? [
          {
            sourceKind: 'contact',
            sourceId: source.contactInstanceId,
            linkRole: 'counterparty' as const,
          },
        ]
      : []),
  ]
  return { entry, sources }
}

/**
 * Post one invoice receipt.
 *
 * **Never throws.** Every refusal comes back as a {@link PostResult}: a payment
 * must not fail because its bookkeeping did.
 */
export async function acceptInvoiceReceiptAccounting(
  db: Database,
  input: AcceptInvoiceReceiptInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  let prepared: PreparedInvoiceReceipt
  try {
    prepared = await db.transaction((tx) => prepareInvoiceReceipt(tx, input))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('An invoice receipt was not posted to the ledger', {
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

  const lock = await resolvePeriodLock(input.organizationId)
  return postEntry(db, {
    organizationId: input.organizationId,
    entry: prepared.entry,
    actorUserId: input.actorUserId,
    lock,
    memo: `Invoice payment - movement ${input.moneyTransactionId}`,
    sources: prepared.sources,
    ...(input.railId ? { railId: input.railId, scope: { rail: input.railId } } : {}),
    mode: await readAutoPostMode(db, input.organizationId, 'receipt'),
  })
}
