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

import { Section } from '@auxx/ui/components/section'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { OrderFulfillmentLedgerCard } from '~/components/money/ui/order/order-fulfillment-ledger-card'
import { OrderPaymentsCard } from '~/components/money/ui/order/order-payments-card'
import { LedgerCard } from './ledger-card'

/** Order accounting combines actual money observations with durable fulfillment effect membership. */
export function OrderLedgerCard(props: DrawerTabProps) {
  return (
    <>
      <Section title='Payments and refunds' collapsible={false}>
        <OrderPaymentsCard {...props} />
      </Section>
      <Section title='Fulfillment accounting' collapsible={false}>
        <OrderFulfillmentLedgerCard {...props} />
      </Section>
    </>
  )
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
