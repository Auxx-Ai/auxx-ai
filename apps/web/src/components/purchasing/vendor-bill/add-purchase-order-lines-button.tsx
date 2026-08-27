// apps/web/src/components/purchasing/vendor-bill/add-purchase-order-lines-button.tsx
'use client'

// "Add lines from order" — the answer to entering a bill against an order and
// having to retype every line by hand (plans/purchasing/02-handoff.md §4 item 3c).
//
// Offered whether or not the goods have arrived: `selectBillableLines` gates on
// what is still uninvoiced, not on what has been received. See that file for why
// the receipt is the wrong gate — a vendor that will not ship until the invoice
// is paid makes bill-before-receipt the normal case, not the edge one.
//
// What it removes is the STRUCTURE, not the transcription: the part, the
// description, the GRNI account, and above all the `purchaseOrderLine` match key,
// which otherwise means opening the row's `..` menu and finding the right line in
// a picker for every line on the invoice. What it deliberately leaves is the
// quantity and the price, which are the two arms of the three-way match — see
// `bill-lines-from-purchase-order.ts` for that rule and why it is not negotiable.
//
// Hidden rather than disabled when there is nothing to add, so it is not a
// permanent dead control on the many bills that have no purchase order at all.

import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ListPlus } from 'lucide-react'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { usePurchaseOrderLines } from '../purchase-order/use-purchase-order-lines'
import { billLinesFromPurchaseOrder, selectBillableLines } from './bill-lines-from-purchase-order'
import { useVendorBillLines } from './use-vendor-bill-lines'

export function AddPurchaseOrderLinesButton({
  billRecordId,
  purchaseOrderRecordId,
  lineDefId,
  onAdded,
}: {
  billRecordId: RecordId
  /** The bill's own order. `null` ⇒ nothing to offer; the button does not render. */
  purchaseOrderRecordId: RecordId | null
  /** `vendor_bill_line` entity definition id — absent while resources load. */
  lineDefId: string | undefined
  onAdded?: () => void
}) {
  const { lines: purchaseOrderLines } = usePurchaseOrderLines(purchaseOrderRecordId)
  const { rows, refresh } = useVendorBillLines(billRecordId)

  const billable = selectBillableLines(
    purchaseOrderLines,
    rows.map((row) => row.values.purchaseOrderLineRecordId)
  )
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.values.sortOrder ?? 0), 0)

  const createMany = api.record.createMany.useMutation({
    onError: (error) => toastError({ title: 'Error adding lines', description: error.message }),
  })

  const handleClick = useCallback(async () => {
    if (!lineDefId || billable.length === 0) return
    await createMany.mutateAsync({
      entityDefinitionId: lineDefId,
      records: billLinesFromPurchaseOrder(billable, billRecordId, nextSortOrder),
    })
    refresh()
    onAdded?.()
  }, [lineDefId, billable, createMany, billRecordId, nextSortOrder, refresh, onAdded])

  if (!purchaseOrderRecordId || billable.length === 0) return null

  return (
    <Button
      variant='ghost'
      size='xs'
      loading={createMany.isPending}
      loadingText='Adding...'
      onClick={handleClick}>
      <ListPlus />
      {/* Says how many, because the count IS the check: it should equal the number
          of lines on the invoice in front of you, and a surprise is worth seeing
          before the press rather than after. */}
      Add {billable.length} line{billable.length === 1 ? '' : 's'} from order
    </Button>
  )
}
