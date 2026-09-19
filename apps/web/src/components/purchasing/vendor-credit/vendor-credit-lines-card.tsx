// apps/web/src/components/purchasing/vendor-credit/vendor-credit-lines-card.tsx
'use client'

// The vendor credit drawer's Overview "Lines" card — the `vendor_credit:lines`
// entry of `drawer-config.ts` (71 §5 U7).
//
// A skin over the shared `LineBuilder`, like `vendor-bill-lines-card.tsx`, with
// `LINE_SCHEMAS.vendor_credit` supplying the vocabulary. The one thing worth
// saying here: a credit line names its GL account by id, and on a PO-backed
// credit that account arrives prefilled with the org's GRNI — the person is
// recoding a prefill, not filling a blank.
//
// The "Lines" section title is rendered by the drawer's `TabCardSection`
// wrapper, so this card must not draw one.

import { VENDOR_CREDIT_EDITABLE_STATUSES } from '@auxx/lib/purchasing/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { PurchaseOrderLinePicker } from '../purchase-order/purchase-order-line-picker'

export function VendorCreditLinesCard({ recordId }: DrawerTabProps) {
  // Issuing posts the entry and — on a line flagged `returnsStock` — moves the
  // goods, so the lines stop being editable there rather than at `settled`.
  const { values } = useSystemValues(recordId, ['vendor_credit_status'], { autoFetch: true })
  const status = typeof values.vendor_credit_status === 'string' ? values.vendor_credit_status : ''
  const readOnly = !!status && !VENDOR_CREDIT_EDITABLE_STATUSES.has(status)

  return (
    <div className='max-h-[60vh] overflow-auto ps-3 pe-3'>
      <LineBuilder
        documentRecordId={recordId}
        documentType='vendor_credit'
        readOnly={readOnly}
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
