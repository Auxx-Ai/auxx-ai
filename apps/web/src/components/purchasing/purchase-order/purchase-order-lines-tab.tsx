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

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { DocumentSectionActions } from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSystemValues } from '~/components/resources/hooks'

const PO_STATUS_ATTRS = ['purchase_order_status'] as const

/**
 * States worth calling out in the header. `draft` is the default so it is not
 * here, and `issued` is the ordinary working state.
 *
 * `partially_received` / `received` are driven by the `quantityReceived` roll-up
 * rather than set by hand, which is exactly why they are worth a badge: they are
 * the only two the person looking at the screen did not choose.
 */
const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'amber' | 'red' }> = {
  partially_received: { label: 'Partially received', variant: 'amber' },
  received: { label: 'Received', variant: 'green' },
  closed: { label: 'Closed', variant: 'green' },
  canceled: { label: 'Canceled', variant: 'red' },
}

export function PurchaseOrderLinesTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { values } = useSystemValues(recordId, [...PO_STATUS_ATTRS], { autoFetch: true })

  // SINGLE_SELECT values arrive as arrays — take the first (see the
  // `use_system_values_single_select_arrays` convention).
  const status = firstValue(values.purchase_order_status)
  const badge = status ? STATUS_BADGE[status] : undefined

  // `variant='section'`: rendered inside a DetailViewSections <Section> on an
  // outer-owned scroll column instead of a `TabsContent` that grants `h-full`, so
  // the LineBuilder (a scroll-owning table) needs the max-height + internal-scroll
  // treatment to avoid fighting the outer page.
  const isSection = variant === 'section'

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      {badge && (
        <DocumentSectionActions
          badge={
            <Badge variant={badge.variant} size='sm'>
              {badge.label}
            </Badge>
          }
        />
      )}

      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder documentRecordId={recordId} documentType='purchase_order' />
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
