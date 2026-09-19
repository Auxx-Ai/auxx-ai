// apps/web/src/components/accounting/ui/ledger-card-registrations.tsx
//
// Per-entity wrappers that pin `sourceKind` on `LedgerCard`, registered in
// `drawer-tab-registry.tsx` (plans/accounting/HANDOFF.md slot 2J, ui-plan §2.3
// and §4.4, TARGET §1). The `sourceKind` is the `GlPostingSource.sourceKind`
// each builder's subject link carries:
//
//   invoice        `buildInvoiceEntry` (postings/build-invoice-entry.ts)
//   money_transaction  `postMovementEntry`/deposit-application writers
//   bank_deposit   `createBankDeposit` (money/bank-deposits/writes.ts)
//   fulfillment    `buildFulfillmentEntry` (money/orders/fulfill.ts)
//   payout         `buildPayoutEntry` (money/payouts/sync.ts)
//   credit_memo    `buildCreditMemoEntry` (postings/build-credit-memo-entry.ts)
//   order          the order is the fulfillment's `parent` link, not a subject
//   build          `build-inventory-movement-entry.ts` (MIGRATION step 5, not yet wired)
//
// Never inferred from the record: the registry key names the entity, and the
// writer names the source, and those two are the same string by convention,
// not by construction.

'use client'

import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { LedgerCard } from './ledger-card'

/** The fulfillment entries the order parents; its money is `order:payments`, its own card. */
export function OrderLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='order' />
}

export function InvoiceLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='invoice' />
}

export function CreditMemoLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='credit_memo' />
}

export function VendorCreditLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='vendor_credit' />
}

// 🛑 `sourceKind='money_transaction'`, not `'payment'` - `payment-fields.ts`
// (the hidden entity mirror this tab predates) went with the legacy payment
// lane in step 0, and every writer that pays or refunds a customer links its
// posting's subject to `sourceKind: 'money_transaction'` (TARGET §1). The
// entity/drawer key stays `payment` - renaming it is a resource-registry
// change, out of this step's scope.
export function PaymentLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='money_transaction' />
}

export function BankDepositLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='bank_deposit' />
}

export function FulfillmentLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='fulfillment' />
}

export function PayoutLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='payout' />
}

// The one wrapper that reads something beyond `GlPostingSource`: under an
// avenue with auto-post off a bill's entry is DRAFTED, and a draft writes no
// subject link, so `billEditState` hands the card the pointer the bill holds.
export function VendorBillLedgerCard(props: DrawerTabProps) {
  const { data } = api.purchasing.billEditState.useQuery(
    { vendorBillId: props.entityInstanceId },
    { enabled: !!props.entityInstanceId }
  )
  const { values } = useSystemValues(props.recordId, ['vendor_bill_status'], { autoFetch: true })
  // A `posted` bill with no entry lost its draft in the outbox. Post refuses a
  // bill that is not `draft`, so Save is the door back and the card says so.
  const stranded = values.vendor_bill_status === 'posted'
  return (
    <LedgerCard
      {...props}
      sourceKind='vendor_bill'
      draftPostingId={data?.draftGlPostingId ?? null}
      emptyLabel={stranded ? 'No entry — Edit then Save to post it again' : undefined}
    />
  )
}

// `build`'s own posting builder (`build-inventory-movement-entry.ts`) and its
// writer (`builds/complete-build.ts`) do not exist until MIGRATION step 5 -
// same "Nothing posted yet" fallback as `VendorBillLedgerCard` until then.
// Replaces the former `BuildLedgerCard`'s bespoke stock-movement tree; that
// audit trail has no home on this tab until step 5's `document / … / its
// stock_movements` member links land.
export function BuildLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceKind='build' />
}
