// apps/web/src/components/purchasing/purchase-order/purchase-order-bills-card.tsx
'use client'

// `purchase_order:bills` — the vendor bills charged against this PO, and paying
// them without leaving it (plans/purchasing/01-build-plan.md §4.4, P12).
//
// `purchase_order_bills` is `showInPanel: false` in `purchase-order-fields.ts`, so
// without this card the inverse edge has NO surface at all: a bill knew its PO and
// the PO could not show its bills. That asymmetry is what the card exists to close.
//
// Rows are built here rather than reused from `RelatedRecordRow` because each one
// carries its own **Pay** action. The question "is this order settled" is asked at
// the order, not bill by bill — a PO with three bills against it is exactly where a
// person notices one is still outstanding, and making them open each bill to act on
// that is the same friction that makes a control stop being run.
//
// 🛑 Paying here writes the bill's six P12 fields and does not post. See
// `mark-bill-paid-dialog.tsx` — `post-entry.ts` is phase 7.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getDefinitionId, type RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { formatCurrency } from '@auxx/utils/currency'
import { Banknote, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  EmptyRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecord, useResource } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useSettings } from '~/hooks/use-settings'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import { MarkBillPaidDialog } from '../vendor-bill/mark-bill-paid-dialog'
import { CreateBillFromPurchaseOrderDialog } from './create-bill-from-purchase-order-dialog'

const PO_ATTRS = [
  'purchase_order_bills',
  'purchase_order_total',
  'purchase_order_currency',
] as const

const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_amount_paid',
  'vendor_bill_status',
  'vendor_bill_number',
] as const

/** The bill a Pay click opened the dialog for. */
interface PayTarget {
  recordId: RecordId
  total: number
  amountPaid: number
}

export function PurchaseOrderBillsCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const openRecord = useOpenRecord()
  const invalidateResource = useFieldValueStore((state) => state.invalidateResource)
  const { values, isLoading } = useSystemValues(recordId, [...PO_ATTRS], { autoFetch: true })

  const billRecordIds = extractRelationshipRecordIds(values.purchase_order_bills)
  const { valuesById, isLoading: billsLoading } = useSystemValuesForRecords(
    billRecordIds,
    BILL_ATTRS,
    { autoFetch: true, enabled: billRecordIds.length > 0 }
  )

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const orderTotal = numberValue(values.purchase_order_total)
  const billed = billRecordIds.reduce(
    (sum, billRecordId) => sum + numberValue(valuesById[billRecordId]?.vendor_bill_total),
    0
  )
  // Signed, not clamped: over-billing against a PO is exactly the condition the
  // three-way match exists to surface, so a negative unbilled figure is the news.
  const unbilled = orderTotal - billed
  const owed = billRecordIds.reduce((sum, billRecordId) => {
    const bill = valuesById[billRecordId]
    const status = unwrapValue(bill?.vendor_bill_status)
    if (status === 'void') return sum
    return (
      sum +
      Math.max(0, numberValue(bill?.vendor_bill_total) - numberValue(bill?.vendor_bill_amount_paid))
    )
  }, 0)

  if (isLoading || (billRecordIds.length > 0 && billsLoading)) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <DrawerCardActions>
        <Button variant='ghost' size='xs' onClick={() => setAddOpen(true)}>
          <Plus />
          Add bill
        </Button>
      </DrawerCardActions>
      <CreateBillFromPurchaseOrderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        purchaseOrderRecordId={recordId}
        onCreated={(billRecordId) => {
          // No invalidation. The card lists the PO's `purchase_order_bills`
          // inverse, and since D-11 that mirror announces its own rewrite
          // (`field-values/relationship-sync.ts`), so the new bill arrives as a
          // `fieldValues:updated` frame and merges through `setValues` —
          // non-destructively, and for every viewer rather than only this tab.
          //
          // 🛑 Do not reinstate `invalidateResource(recordId)`. It DELETES every
          // cached field value on the order, which is what made the drawer's line
          // builder visibly reset itself; it was only ever here because the
          // inverse write was silent.
          openRecord?.(billRecordId)
        }}
      />
      <PurchasingSummaryStrip
        cells={[
          { label: 'Order total', value: formatCurrency(orderTotal, { currencyCode }) },
          { label: 'Billed', value: formatCurrency(billed, { currencyCode }) },
          {
            // Once a bill exists, "what is still owed" is the live question and
            // "what is unbilled" is the paperwork one. Show whichever is the news.
            label: billRecordIds.length > 0 ? 'Still owed' : 'Unbilled',
            value: formatCurrency(billRecordIds.length > 0 ? owed : unbilled, { currencyCode }),
            tone: (billRecordIds.length > 0 ? owed : unbilled) === 0 ? 'muted' : 'default',
          },
        ]}
      />
      {billRecordIds.length === 0 ? (
        <EmptyRow label='No bills yet' />
      ) : (
        billRecordIds.map((billRecordId) => (
          <BillRow
            key={billRecordId}
            billRecordId={billRecordId}
            values={valuesById[billRecordId]}
            currencyCode={currencyCode}
            onPay={setPayTarget}
          />
        ))
      )}

      {payTarget && (
        <MarkBillPaidDialog
          open
          onOpenChange={(next) => !next && setPayTarget(null)}
          billRecordId={payTarget.recordId}
          total={payTarget.total}
          amountPaid={payTarget.amountPaid}
          currencyCode={currencyCode}
          onSaved={() => {
            // The row reads the bill's own values, so drop that record's cache and
            // let `autoFetch` re-pull the new balance and status.
            invalidateResource(payTarget.recordId)
            setPayTarget(null)
          }}
        />
      )}
    </div>
  )
}

function BillRow({
  billRecordId,
  values,
  currencyCode,
  onPay,
}: {
  billRecordId: RecordId
  values: Record<string, unknown> | undefined
  currencyCode: string
  onPay: (target: PayTarget) => void
}) {
  const openRecord = useOpenRecord()
  const { record } = useRecord({ recordId: billRecordId, enabled: true })
  const { resource } = useResource(getDefinitionId(billRecordId))
  const statusField = useSystemField('vendor_bill_status', getDefinitionId(billRecordId))

  const total = numberValue(values?.vendor_bill_total)
  const amountPaid = numberValue(values?.vendor_bill_amount_paid)
  const balance = total - amountPaid
  const status = unwrapValue(values?.vendor_bill_status) as string | undefined
  const statusOption = statusField?.options?.options?.find((option) => option.value === status)

  // A void bill owes nothing by definition, and a zero-total bill has no amount to
  // settle — offering Pay on either is offering an action against a number nobody
  // has entered yet.
  const canPay = status !== 'void' && total > 0 && balance > 0

  return (
    <TreeRow
      rowClassName='hover:bg-primary-100'
      onDrill={() => openRecord?.(billRecordId)}
      icon={
        <RecordIcon
          avatarUrl={record?.avatarUrl}
          iconId={resource?.icon || 'receipt'}
          color={resource?.color || 'gray'}
          size='xs'
        />
      }
      title={<span className='truncate text-sm'>{record?.displayName ?? 'Untitled bill'}</span>}
      secondary={
        <span className='flex items-center gap-1.5 text-xs'>
          <span className='tabular-nums'>{formatCurrency(total, { currencyCode })}</span>
          {balance > 0 && balance !== total && (
            <span className='text-muted-foreground tabular-nums'>
              {formatCurrency(balance, { currencyCode })} left
            </span>
          )}
          {status && (
            <Badge variant={(statusOption?.color as Variant) ?? 'secondary'} size='xs'>
              {statusOption?.label ?? status}
            </Badge>
          )}
        </span>
      }
      actions={
        canPay ? (
          <TreeRowButton
            persistent
            tooltipText='Mark paid'
            onClick={() => onPay({ recordId: billRecordId, total, amountPaid })}>
            <Banknote />
          </TreeRowButton>
        ) : undefined
      }
    />
  )
}
