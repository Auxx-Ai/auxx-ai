// apps/web/src/components/purchasing/vendor-bill/vendor-bill-lines-card.tsx
'use client'

// The vendor bill drawer's Overview "Lines" card — the `vendor_bill:lines` entry
// of `drawer-config.ts` (plans/purchasing/01-build-plan.md §5.1/§5.2).
//
// Drawer-only by design: a bill RECORDS something already settled, so there is
// nothing to iterate and it never earns a detail page. That is also why this is a
// card and not a tab — there is no second surface to share with.
//
// This WAS a 721-line bespoke editor with a modal line dialog. It is now a skin
// over the shared `LineBuilder`, the same cutover the purchase order made in
// #1918 — see plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md. The
// bill gains drag reorder, spreadsheet keyboard nav, phantom-draft rows and
// one-round-trip creates, none of which the dialog had.
//
// Three things about a bill line that the descriptor (`LINE_SCHEMAS.vendor_bill`)
// encodes, and that are the whole reason the cutover needed the builder changed
// rather than just pointed at:
//
//   - `lineTotal` is TRANSCRIBED from the vendor's document, never recomputed
//     from qty x price. That is `amountMode: 'stored'`: the amount is an input,
//     `crossFillAmount` fills only a BLANK rate or amount, and where the two
//     disagree the row MARKS it instead of reconciling. Recomputing would quietly
//     correct the vendor's own arithmetic, which is exactly the discrepancy the
//     three-way match exists to catch.
//   - `purchaseOrderLine` is the match key. It is nullable because a bill with no
//     PO is legal (a freight invoice, a one-off), but where it is set it is what
//     `vendor-bill-match-card.tsx` reads the received quantity and expected price
//     through. It lives in the row's `⋯` menu, and its picker is supplied from
//     here — `renderMatchKeyEditor` — because `LineBuilder` must not import from
//     `purchasing`, which already imports it.
// The header action is **Add lines from order** — the bill's structure raised
// from the order's received-but-unbilled lines, so the person holding the invoice
// types the numbers instead of rebuilding the line list. It prefills no match
// input; see `bill-lines-from-purchase-order.ts`.
//
//   - `part` is NULLABLE here, unlike a PO line's. That is why the builder's
//     draft-materialization guard is gated on `capabilities.draftRequiresPart`
//     and not on `partPicker`: a freight line with no part must still be able to
//     become a row.
//
// The "Lines" section title is rendered by the drawer's `TabCardSection` wrapper,
// so this card must not draw one.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { PurchaseOrderLinePicker } from '../purchase-order/purchase-order-line-picker'
import { AddPurchaseOrderLinesButton } from './add-purchase-order-lines-button'

const BILL_ORDER_ATTRS = ['vendor_bill_purchase_order'] as const

export function VendorBillLinesCard({ recordId }: DrawerTabProps) {
  const lineDefId = useResourceProperty('vendor_bill_line', 'id')
  // The bill's own order — the same attribute `LineSchema.matchScopeAttr` names,
  // read here for the header action. Read twice rather than threaded through the
  // builder: the action is a sibling of the builder, not a part of it, and the
  // second read is a cache hit on the value the builder already fetched.
  const { values } = useSystemValues(recordId as RecordId, [...BILL_ORDER_ATTRS], {
    autoFetch: true,
  })
  const purchaseOrderRecordId =
    extractRelationshipRecordIds(values.vendor_bill_purchase_order)[0] ?? null

  return (
    <div className='max-h-[60vh] overflow-auto ps-3 pe-3'>
      <DrawerCardActions>
        <AddPurchaseOrderLinesButton
          billRecordId={recordId as RecordId}
          purchaseOrderRecordId={purchaseOrderRecordId}
          lineDefId={lineDefId}
        />
      </DrawerCardActions>
      <LineBuilder
        documentRecordId={recordId}
        documentType='vendor_bill'
        // The order to offer lines from is resolved by the builder from
        // `schema.matchScopeAttr` (`vendor_bill_purchase_order`) and handed back
        // as `scopeRecordId`, so this never re-reads the bill it is rendered in.
        // With no order the picker disables itself rather than falling back to an
        // unscoped list — see its header for why that distinction is the fix.
        renderMatchKeyEditor={({ value, onChange, scopeRecordId, currencyCode }) => (
          <PurchaseOrderLinePicker
            purchaseOrderRecordId={scopeRecordId as RecordId | null}
            value={value as RecordId | null}
            onChange={(next) => onChange(next)}
            currencyCode={currencyCode}
          />
        )}
      />
    </div>
  )
}
