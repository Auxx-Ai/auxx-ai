// packages/lib/src/accounting/money/invoice-payments/receipt-accounting.ts

/**
 * A confirmed customer receipt against an ISSUED INVOICE.
 *
 * ```
 *   Dr <the cash endpoint: a rail's clearing, a bank account, or undeposited funds>
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
 * own contact (TARGET §5).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import type { GlPostingLineInput } from '../../ledger/types'
import { loadInvoiceForIssuance } from '../../sales/invoices/issuance-reads'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'
import { listMovementApplications } from '../reads'

export interface AcceptInvoiceReceiptInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  actorUserId?: string
  /** Kept for the sweep's call sites; the poster no longer branches on it. */
  automatic?: boolean
}

/**
 * The single invoice the movement's applications name, and that invoice's contact.
 *
 * 🛑 The invoice is resolved through `EntityDefinition.entityType`, never trusted
 * from the FK: crediting a receivable no invoice ever raised is not recoverable.
 */
async function readInvoiceReceiptSource(
  tx: Transaction,
  organizationId: string,
  money: typeof schema.MoneyTransaction.$inferSelect
) {
  const applications = await listMovementApplications(tx, organizationId, money.id)
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
    invoiceInstanceId,
    invoiceNumber: fields.number || null,
    // The invoice's own contact, not the movement's party: `accounts_receivable`
    // is a per-customer balance and has to agree with the issuance entry.
    contactInstanceId: fields.contactInstanceId ?? money.partyInstanceId ?? null,
  }
}

async function prepareInvoiceReceipt(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const source = await readInvoiceReceiptSource(tx, organizationId, loaded.money)
  const endpoint = await loaded.endpoint()
  const amountMinor = toLedgerMinor(loaded.money.amountMinor, 'USD', 2)
  const label = source.invoiceNumber
    ? `Payment received on ${source.invoiceNumber}`
    : 'Payment received'
  const base = {
    ...loaded.base,
    ...(source.contactInstanceId
      ? { counterpartyType: 'customer' as const, counterpartyId: source.contactInstanceId }
      : {}),
  }
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: endpoint.glAccountId,
      direction: 'debit',
      amount: amountMinor,
      sortOrder: 0,
      memo: label,
    },
    {
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount: amountMinor,
      sortOrder: 1,
      memo: label,
    },
  ]
  return {
    lines,
    parent: { sourceKind: 'invoice', sourceId: source.invoiceInstanceId },
    ...(source.contactInstanceId
      ? { counterparty: { sourceKind: 'contact', sourceId: source.contactInstanceId } }
      : {}),
  }
}

/**
 * Post one invoice receipt.
 *
 * **Never throws.** Every refusal comes back as a `blocked` result: a payment must
 * not fail because its bookkeeping did.
 */
export async function acceptInvoiceReceiptAccounting(
  db: Database,
  input: AcceptInvoiceReceiptInput
): Promise<MovementPostingResult> {
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'customer_receipt',
    label: 'Invoice receipt',
    actorUserId: input.actorUserId,
    prepare: (tx, loaded) => prepareInvoiceReceipt(tx, input.organizationId, loaded),
  })
}
