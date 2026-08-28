// apps/web/src/components/purchasing/purchase-order/purchase-order-lines-tab.tsx
'use client'

// The purchase order's Lines surface (plans/purchasing/01-build-plan.md §4.4).
//
// This WAS a 723-line bespoke editor with a modal line dialog, written because
// §4.4 said not to reuse `LineBuilder`. That decision was reversed and the
// builder generalized instead — see plans/purchasing/03-line-builder-reuse.md.
// The reversal is a descriptor, not a fifth arm on a union: `LINE_SCHEMAS` in
// `line-values.ts` now carries the line entity's slug, its attribute vocabulary
// and its capabilities, so a PO gets drag reorder, spreadsheet keyboard nav,
// phantom-draft rows and one-round-trip creates for free — every one of which
// the bespoke dialog either reimplemented or simply did not have.
//
// Rendered in both places a PO is opened, the `order`/`quote` relation:
//   PurchaseOrderLinesTab  -> the detail page's "Lines" section
//                             (DETAIL_VIEW_TAB_COMPONENTS, sections layout)
//   PurchaseOrderLinesCard -> the drawer's Overview card (see the sibling file)
//
// 🛑 A PO line's leading cell is a PART PICKER, not free text. `part` is
// `required: true` and leg 2 of the natural key `(purchaseOrder, part)`, so
// picking one is what materializes a draft row — a quantity or price typed first
// accumulates on the draft instead of firing a create the server must reject.
// That guard lives in `createDraft`, so it holds for any cell added later.

import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { DocumentSectionActions } from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import type { PartPrefillLookup } from '~/components/money/ui/line-builder/line-rows'
import { useSystemValues } from '~/components/resources/hooks'
import { api } from '~/trpc/react'

const PO_STATUS_ATTRS = [
  'purchase_order_status',
  'purchase_order_receipt_status',
  'purchase_order_billing_status',
] as const

type BadgeSpec = { label: string; variant: 'green' | 'amber' | 'red' }

/**
 * The ACTION axis — what a person decided. `draft` is the default and `issued` is
 * the ordinary working state, so neither earns a badge; only the two terminal
 * decisions do.
 *
 * 🛑 `partially_received` / `received` used to live here. They are no longer values
 * of this field at all — receiving and billing are independent axes and moved to
 * their own derived fields (plans/purchasing/07-purchase-order-send-and-status.md
 * §3.3). Keying them here after the split rendered nothing and failed no test,
 * because the map is indexed loosely.
 */
const STATUS_BADGE: Record<string, BadgeSpec> = {
  closed: { label: 'Closed', variant: 'green' },
  canceled: { label: 'Canceled', variant: 'red' },
}

/**
 * The two DERIVED axes — what the roll-up observed, which nobody chose. Only the
 * states that say something is outstanding or complete are shown; the "nothing has
 * happened yet" values are the default and would be noise on every draft order.
 */
const RECEIPT_BADGE: Record<string, BadgeSpec> = {
  partially_received: { label: 'Partially received', variant: 'amber' },
  received: { label: 'Received', variant: 'green' },
}

const BILLING_BADGE: Record<string, BadgeSpec> = {
  partially_billed: { label: 'Partially billed', variant: 'amber' },
  billed: { label: 'Billed', variant: 'green' },
}

export function PurchaseOrderLinesTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { values } = useSystemValues(recordId, [...PO_STATUS_ATTRS], { autoFetch: true })

  // SINGLE_SELECT values arrive as arrays — take the first (see the
  // `use_system_values_single_select_arrays` convention).
  const status = firstValue(values.purchase_order_status)
  const receiptStatus = firstValue(values.purchase_order_receipt_status)
  const billingStatus = firstValue(values.purchase_order_billing_status)
  // Order matters: the decision first, then what actually arrived, then what was
  // invoiced — the same left-to-right reading as the document's own lifecycle.
  const badges = [
    status ? STATUS_BADGE[status] : undefined,
    receiptStatus ? RECEIPT_BADGE[receiptStatus] : undefined,
    billingStatus ? BILLING_BADGE[billingStatus] : undefined,
  ].filter((b): b is BadgeSpec => !!b)

  // `variant='section'`: rendered inside a DetailViewSections <Section> on an
  // outer-owned scroll column instead of a `TabsContent` that grants `h-full`, so
  // the LineBuilder (a scroll-owning table) needs the max-height + internal-scroll
  // treatment to avoid fighting the outer page.
  const isSection = variant === 'section'

  const utils = api.useUtils()

  // Picking a part prefills the agreed price from what THIS order's vendor charges
  // (plans/purchasing/05-receiving-cost-and-corrections.md 5.2).
  //
  // Supplied as a prop rather than called from inside `LineBuilder` because that
  // module is document-agnostic and only a purchase order prefills — see
  // `PartPrefillLookup`.
  //
  // The two failure shapes are NOT the same and the builder treats them
  // differently. A successful lookup that finds no row returns a CLEARED link:
  // the line may still carry a `vendor_part` naming the PREVIOUSLY picked part's
  // supplier row, and leaving that in place would attach provenance to a price
  // it did not produce. A thrown lookup returns `null`, which changes nothing —
  // a network failure is not evidence that no catalogue entry exists.
  const resolvePartPrefill = useCallback<PartPrefillLookup>(
    async ({ partRecordId, vendorRecordId }) => {
      try {
        const found = await utils.purchasing.vendorPartForLine.fetch({
          partInstanceId: parseRecordId(partRecordId).entityInstanceId,
          vendorInstanceId: parseRecordId(vendorRecordId).entityInstanceId,
        })
        return {
          vendorPartRecordId: found?.vendorPartRecordId ?? null,
          unitPriceCents: found?.unitPrice ?? null,
        }
      } catch {
        return null
      }
    },
    [utils]
  )

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      {badges.length > 0 && (
        <DocumentSectionActions
          badge={
            <span className='flex items-center gap-1.5'>
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant} size='sm'>
                  {b.label}
                </Badge>
              ))}
            </span>
          }
        />
      )}

      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder
          documentRecordId={recordId}
          documentType='purchase_order'
          resolvePartPrefill={resolvePartPrefill}
        />
      </div>
    </div>
  )
}

/** SINGLE_SELECT reads come back as arrays; everything else as a scalar. */
function firstValue(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

/**
 * Drawer Overview card variant — kept as a named export here so the sibling
 * `purchase-order-lines-card.tsx` entry point (registered `purchase_order:lines`)
 * stays a one-line re-export, matching `order`/`quote`.
 */
export function PurchaseOrderLinesOverviewCard(props: DrawerTabProps) {
  return <PurchaseOrderLinesTab {...props} variant='section' />
}
