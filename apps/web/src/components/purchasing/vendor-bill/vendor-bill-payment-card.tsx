// apps/web/src/components/purchasing/vendor-bill/vendor-bill-payment-card.tsx
'use client'

// `vendor_bill:payment` — what this bill still owes, and what settled it
// (plans/purchasing/01-build-plan.md §5.3, decision P12).
//
// The work-order Billing card's shape: a summary strip, a header action, then rows.
// The AR-side twin (`invoice-payments-card.tsx`) lists `payment` RECORDS; this one
// cannot, because `vendor_payment` is inert under P13 — the bill's own six fields
// are the whole ledger, so the card renders those.
//
// 🛑 `vendor_bill_balance` is declared `creatable: false` "computed from total and
// amountPaid" and NOTHING WRITES IT — there is no balance hook in
// `purchasing-hooks.ts`, which registers only the two numbering hooks. That is the
// same shape as the latent defect 02-handoff.md §1 documents (a field unwritable by
// a hook that does not exist and unwritable by a human), so every row's stored
// balance is NULL. This card therefore computes `total − amountPaid` for display and
// never reads the stored field. See 02-handoff.md §4.

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatCurrency } from '@auxx/utils/currency'
import { Banknote, CircleCheck, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import { MarkBillPaidDialog } from './mark-bill-paid-dialog'

const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_amount_paid',
  'vendor_bill_paid_at',
  'vendor_bill_payment_method',
  'vendor_bill_payment_reference',
  'vendor_bill_paid_source',
  'vendor_bill_status',
  'vendor_bill_currency',
] as const

/** How the payment was established — P12's "not decoration" distinction, surfaced. */
const PAID_SOURCE_BADGE: Record<string, { label: string; variant: Variant }> = {
  manual: { label: 'Confirmed', variant: 'green' },
  provider: { label: 'From accounting', variant: 'blue' },
  bank_import: { label: 'From bank', variant: 'blue' },
  rule: { label: 'Presumed', variant: 'amber' },
}

export function VendorBillPaymentCard({ recordId }: DrawerTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { getSetting } = useSettings({})
  const { values, isLoading } = useSystemValues(recordId, [...BILL_ATTRS], { autoFetch: true })

  const currencyValue = unwrapValue(values.vendor_bill_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const total = numberValue(values.vendor_bill_total)
  const amountPaid = numberValue(values.vendor_bill_amount_paid)
  const balance = total - amountPaid

  const status = stringValue(values.vendor_bill_status)
  const paidAt = stringValue(values.vendor_bill_paid_at)
  const method = stringValue(values.vendor_bill_payment_method)
  const reference = stringValue(values.vendor_bill_payment_reference)
  const paidSource = stringValue(values.vendor_bill_paid_source)
  const sourceBadge = paidSource ? PAID_SOURCE_BADGE[paidSource] : undefined

  // A void bill owes nothing by definition; a zero-total bill has nothing to settle
  // and would otherwise offer a payment against an amount nobody has entered yet.
  const canMarkPaid = status !== 'void' && total > 0 && balance > 0

  if (isLoading) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {canMarkPaid && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setDialogOpen(true)}>
            <Plus /> Mark paid
          </Button>
        </DrawerCardActions>
      )}

      <PurchasingSummaryStrip
        className='pb-2'
        cells={[
          { label: 'Bill total', value: formatCurrency(total, { currencyCode }) },
          { label: 'Paid', value: formatCurrency(amountPaid, { currencyCode }) },
          {
            label: 'Balance',
            value: formatCurrency(balance, { currencyCode }),
            tone: balance === 0 ? 'muted' : 'default',
          },
        ]}
      />

      {paidAt ? (
        <TreeRow
          rowClassName='hover:bg-primary-100'
          icon={<Banknote className='size-4' />}
          title={<span className='truncate text-sm'>{method || 'Payment'}</span>}
          secondary={
            <span className='flex items-center gap-1.5 text-xs'>
              <span className='text-muted-foreground'>{formatDate(paidAt)}</span>
              {reference && <span className='truncate text-muted-foreground'>· {reference}</span>}
              {sourceBadge && (
                <Badge variant={sourceBadge.variant} size='xs'>
                  {sourceBadge.label}
                </Badge>
              )}
            </span>
          }
        />
      ) : (
        <TreeRow
          rowClassName='hover:bg-primary-100'
          icon={<CircleCheck className='size-4' />}
          title={<span className='text-muted-foreground text-sm'>Unpaid</span>}
          secondary={
            <span className='text-xs'>
              {total > 0 ? `${formatCurrency(balance, { currencyCode })} owed` : 'No total entered'}
            </span>
          }
        />
      )}

      <MarkBillPaidDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        billRecordId={recordId}
        total={total}
        amountPaid={amountPaid}
        currencyCode={currencyCode}
      />
    </div>
  )
}

function stringValue(value: unknown): string | null {
  const raw = unwrapValue(value)
  return typeof raw === 'string' && raw ? raw : null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
