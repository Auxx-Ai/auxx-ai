// packages/lib/src/accounting/money/customer-money/accounting.ts

/**
 * A channel customer receipt against an ORDER.
 *
 * ```
 *   Dr <the cash endpoint — the gateway's clearing account>   the receipt
 *       Cr accounts_receivable                                  the shipped part
 *       Cr customer_deposits                                    the advance part
 *       Cr sales_tax_payable                                    per jurisdiction
 * ```
 *
 * The split comes from the order's recognition timeline, which is what a
 * standalone invoice does not need - see `invoice-payments/receipt-accounting.ts`.
 *
 * Subject the `MoneyTransaction`, parent the order, counterparty the customer;
 * `storeId` is the feed's `FinancialSourceAccount`. The rail is stamped onto the
 * movement here, inside the posting transaction, because the feed link is set by
 * a person and may not exist when the movement arrives (task 71 §3).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import type { GlPostingLineInput } from '../../ledger/types'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'
import {
  listCustomerMoneyAccountingCandidates,
  POSTING_RETRY_INTERVAL_MS,
  readCustomerReceiptAccountingSource,
} from './receipt-accounting'
import { allocateRecognitionTaxComponents } from './recognition'
import { readOrderRecognitionFactsInTx } from './recognition-facts'
import {
  readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource,
} from './recognition-source'
import { postCustomerRefundAccounting } from './refund-accounting'

export type CustomerReceiptAccountingResult = MovementPostingResult

type Command = {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
  automatic?: boolean
}

async function prepareReceipt(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const source = await readCustomerReceiptAccountingSource(
    tx,
    organizationId,
    loaded.money.id,
    loaded.bookTimeZone
  )
  const facts = await readOrderRecognitionFactsInTx(tx, organizationId, source.orderId)
  if (source.money.partyInstanceId && source.money.partyInstanceId !== facts.customerInstanceId)
    throw new UnprocessableEntityError('Receipt customer differs from the order customer')
  const timeline = requireCompleteOrderRecognitionSource(
    await readOrderRecognitionSource(tx, {
      organizationId,
      orderId: source.orderId,
      orderNetMinor: (facts.subtotal + facts.shipping).toString(),
      orderTaxMinor: facts.tax.toString(),
      bookTimeZone: loaded.bookTimeZone,
      target: { kind: 'receipt', id: source.money.id },
    })
  )
  const allocation = timeline.target
  if (!allocation)
    throw new UnprocessableEntityError('Receipt is absent from the recognition timeline')
  const taxShares = allocateRecognitionTaxComponents(timeline.allocations, facts.taxComponents).get(
    source.money.id
  )!
  const taxComponents = facts.taxComponents.map((component) => ({
    ...component,
    amountMinor: taxShares.find((share) => share.componentKey === component.componentKey)!
      .amountMinor,
  }))
  // The handle (or, failing that, the feed link) is the rail: stamped onto the
  // movement here so the movement and its posting agree, then resolved through
  // the one cash endpoint. A reserved handle names no rail and lands in
  // undeposited funds.
  if (source.paymentGatewayId) await loaded.stampGateway(source.paymentGatewayId)
  const endpoint = await loaded.endpoint()

  const dimensions = {
    sourceProvider: source.sourceProvider,
    ...(facts.channel ? { channel: facts.channel } : {}),
    sourceStoreId: source.sourceStoreId,
    ...(source.paymentGatewayId ? { paymentGatewayId: source.paymentGatewayId } : {}),
    orderId: source.orderId,
  }
  const base = { sourceType: 'money_transaction', sourceId: source.money.id, dimensions }
  const money = (amount: string) => toLedgerMinor(amount, 'USD', 2)
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: endpoint.glAccountId,
      direction: 'debit',
      amount: money(allocation.amountMinor),
      sortOrder: 0,
      memo: 'Customer payment received',
    },
  ]
  if (BigInt(allocation.receivableMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount: money(allocation.receivableMinor),
      sortOrder: lines.length,
      counterpartyType: 'customer',
      counterpartyId: facts.customerInstanceId,
      memo: 'Payment applied to shipped order',
    })
  if (BigInt(allocation.depositMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'customer_deposits',
      direction: 'credit',
      amount: money(allocation.depositMinor),
      sortOrder: lines.length,
      memo: 'Advance payment held for shipment',
    })
  for (const tax of taxComponents)
    if (BigInt(tax.amountMinor) > 0n)
      lines.push({
        ...base,
        accountRole: 'sales_tax_payable',
        direction: 'credit',
        amount: money(tax.amountMinor),
        sortOrder: lines.length,
        dimensions: {
          ...dimensions,
          jurisdiction: tax.jurisdiction!,
          taxComponentId: tax.componentKey,
        },
        memo: 'Sales tax on advance payment',
      })
  const label = [source.storeDomain, source.sourceExternalId, source.gatewayName, facts.channel]
    .filter(Boolean)
    .join(' / ')
  for (const line of lines) line.memo = `${label}: ${line.memo}`

  return {
    lines,
    parent: { sourceKind: 'order', sourceId: source.orderId },
    counterparty: { sourceKind: 'contact', sourceId: facts.customerInstanceId },
    storeId: source.sourceStoreId,
  }
}

/**
 * Post one channel receipt. A refusal is a `blocked` result, never a throw: the
 * sweep retries it and the money model is unaffected either way.
 */
export async function postCustomerReceiptAccounting(
  db: Database,
  input: Command
): Promise<CustomerReceiptAccountingResult> {
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'customer_receipt',
    avenue: 'receipt',
    label: 'Customer payment',
    actorUserId: input.actorUserId,
    prepare: (tx, loaded) => prepareReceipt(tx, input.organizationId, loaded),
  })
}

/**
 * Bounded recovery retries repaired channel-money evidence without starving later
 * movements. One sweep over both purposes — a blocked receipt and a blocked refund
 * are the same repair with the same schedule (task 71 Q3).
 */
export async function sweepCustomerMoneyAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
) {
  const started = Date.now()
  // Hoisted, so the window is one settings read for the whole run rather than one
  // refusal per movement.
  const settings = await readOrganizationSettings(input.organizationId, [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  const candidates = await listCustomerMoneyAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500),
    {
      cutoffPeriod: settings['accounting.cutoffPeriod'],
      bookTimeZone: settings['accounting.bookTimeZone'] ?? 'UTC',
      retryBefore: new Date(started - POSTING_RETRY_INTERVAL_MS),
    }
  )
  const counts = { scanned: 0, accepted: 0, drafted: 0, blocked: 0, skipped: 0 }
  for (const candidate of candidates) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    const post =
      candidate.purpose === 'customer_refund'
        ? postCustomerRefundAccounting
        : postCustomerReceiptAccounting
    const result = await post(db, {
      organizationId: input.organizationId,
      moneyTransactionId: candidate.id,
    })
    counts.scanned++
    counts[result.status]++
  }
  return counts
}
