// packages/lib/src/accounting/money/customer-money/accounting.ts

/**
 * A channel customer receipt: `Dr <cash endpoint> / Cr accounts_receivable`, the
 * movement's amount, from the receipt's own facts only (91 D1). The order it paid
 * is a `parent` link when known, never an input to the lines.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import type { GlPostingLineInput } from '../../ledger/types'
import { withWorkItemCode } from '../../work-items/refusal'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'
import { readCustomerReceiptAccountingSource } from './receipt-accounting'

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
  const source = await readCustomerReceiptAccountingSource(tx, organizationId, loaded.money.id)
  const customerId =
    source.money.partyInstanceId ??
    (await readOrganizationSettings(organizationId, ['accounting.guestContactId'] as const))[
      'accounting.guestContactId'
    ]
  if (!customerId)
    throw new UnprocessableEntityError(
      'Receipt has no customer and the organization has no guest customer',
      // Minting the guest wakes this code (`parties/guest-contact.ts`).
      withWorkItemCode('CUSTOMER_UNRESOLVED')
    )
  // The handle (or, failing that, the feed link) is the rail, stamped so the
  // movement and its posting agree. A reserved handle lands in undeposited funds.
  if (source.paymentGatewayId) await loaded.stampGateway(source.paymentGatewayId)
  // A gift card redemption: the receipt's endpoint is the liability it spends down.
  if (source.giftCard) loaded.markGiftCard()
  const endpoint = await loaded.endpoint()

  const label = [source.storeDomain, source.sourceExternalId, source.gatewayName]
    .filter(Boolean)
    .join(' / ')
  const base = {
    sourceType: 'money_transaction',
    sourceId: source.money.id,
    dimensions: {
      sourceProvider: source.sourceProvider,
      sourceStoreId: source.sourceStoreId,
      ...(source.paymentGatewayId ? { paymentGatewayId: source.paymentGatewayId } : {}),
    },
  }
  const amount = toLedgerMinor(source.money.amountMinor.toString(), 'USD', 2)
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: endpoint.glAccountId,
      accountRole: endpoint.role,
      direction: 'debit',
      amount,
      sortOrder: 0,
      memo: `${label}: Customer payment received`,
    },
    {
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount,
      sortOrder: 1,
      counterpartyType: 'customer',
      counterpartyId: customerId,
      memo: `${label}: Customer payment`,
    },
  ]

  return {
    lines,
    ...(source.orderId ? { parent: { sourceKind: 'order', sourceId: source.orderId } } : {}),
    counterparty: { sourceKind: 'contact', sourceId: customerId },
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
    label: 'Customer payment',
    actorUserId: input.actorUserId,
    prepare: (tx, loaded) => prepareReceipt(tx, input.organizationId, loaded),
  })
}
