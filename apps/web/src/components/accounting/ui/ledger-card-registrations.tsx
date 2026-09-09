// apps/web/src/components/accounting/ui/ledger-card-registrations.tsx
//
// Per-entity wrappers that pin `sourceType` on `LedgerCard`, registered in
// `drawer-tab-registry.tsx` (plans/accounting/HANDOFF.md slot 2J, ui-plan §2.3
// and §4.4). The `sourceType` is what each writer files its lines under:
//
//   invoice       `writeOffInvoice` (money/invoices/write-off.ts)
//   payment       `postPaymentTransaction` (money/payments/ledger.ts)
//   bank_deposit  `createBankDeposit` (money/bank-deposits/writes.ts)
//
// Never inferred from the record: the registry key names the entity, and the
// writer names the source, and those two are the same string by convention,
// not by construction.

'use client'

import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { OrderFulfillmentLedgerCard } from '~/components/money/ui/order/order-fulfillment-ledger-card'
import { LedgerCard } from './ledger-card'

/**
 * 🛑 The ORDER is the exception: it reads its shipment stamps, not its source
 * lines (plans/money/tasks/49 §2.5). A bulk fulfillment summarises a day into
 * one entry filed under `fulfillment_batch` and the period key, so the source
 * lookup finds nothing for the orders inside it. The registration keeps its name
 * and its slot; only what it reads changed. See
 * `money/ui/order/order-fulfillment-ledger-card.tsx` for the whole argument.
 */
export function OrderLedgerCard(props: DrawerTabProps) {
  return <OrderFulfillmentLedgerCard {...props} />
}

export function InvoiceLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceType='invoice' />
}

export function PaymentLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceType='payment' />
}

export function BankDepositLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceType='bank_deposit' />
}
