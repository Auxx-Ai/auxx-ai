// packages/lib/src/accounting/money/invoice-payments/receipt-accounting.ts

/**
 * A confirmed customer receipt on the invoice lane.
 *
 * ```
 *   Dr <the cash endpoint: a rail's clearing, a bank account, or undeposited funds>
 *       Cr accounts_receivable
 * ```
 *
 * The credit is the movement's whole amount whatever it is applied to (91 §4.1):
 * a partial or unapplied receipt is a credit in A/R, and the applications are
 * links that aging reads, never inputs to the lines.
 *
 * Subject the `MoneyTransaction`, parent the invoice when the live applications
 * name exactly one, counterparty that invoice's contact (TARGET §5).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import type { GlPostingLineInput } from '../../ledger/types'
import { loadInvoiceForIssuance } from '../../sales/invoices/issuance-reads'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'
import { listLiveApplications } from '../reads'

export interface AcceptInvoiceReceiptInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  actorUserId?: string
  /** Kept for the sweep's call sites; the poster no longer branches on it. */
  automatic?: boolean
}

/**
 * The one invoice the movement's live applications name, when there is exactly one.
 *
 * Resolved through `EntityDefinition.entityType`, never trusted from the FK.
 */
async function readInvoiceLink(
  tx: Transaction,
  organizationId: string,
  money: typeof schema.MoneyTransaction.$inferSelect
) {
  const applications = await listLiveApplications(tx, organizationId, money.id)
  const invoiceIds = [...new Set(applications.flatMap((a) => a.invoiceInstanceId ?? []))]
  if (invoiceIds.length !== 1) return null
  const invoiceInstanceId = invoiceIds[0]!

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
  if (!invoice) return null

  const fields = await loadInvoiceForIssuance(tx, organizationId, invoice.id)
  return {
    invoiceInstanceId: invoice.id,
    invoiceNumber: fields?.number || null,
    // The invoice's own contact: `accounts_receivable` is a per-customer balance
    // and has to agree with the issuance entry.
    contactInstanceId: fields?.contactInstanceId ?? money.partyInstanceId ?? null,
  }
}

async function prepareInvoiceReceipt(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const invoice = await readInvoiceLink(tx, organizationId, loaded.money)
  const endpoint = await loaded.endpoint()
  const amountMinor = toLedgerMinor(loaded.money.amountMinor, 'USD', 2)
  const label = invoice?.invoiceNumber
    ? `Payment received on ${invoice.invoiceNumber}`
    : 'Payment received'
  const base = {
    ...loaded.base,
    ...(invoice?.contactInstanceId
      ? { counterpartyType: 'customer' as const, counterpartyId: invoice.contactInstanceId }
      : {}),
  }
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: endpoint.glAccountId,
      accountRole: endpoint.role,
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
  if (!invoice) return { lines }
  return {
    lines,
    parent: { sourceKind: 'invoice', sourceId: invoice.invoiceInstanceId },
    ...(invoice.contactInstanceId
      ? { counterparty: { sourceKind: 'contact', sourceId: invoice.contactInstanceId } }
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
