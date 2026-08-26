// apps/web/src/components/money/ui/order/order-line-items-tab.tsx
'use client'

// The order's line-items surface, in both places an order is opened
// (plans/products/08-order-build.md §5.7/§5.8). Follows `quote-line-items-tab.tsx`,
// which is the precedent for an entity that has BOTH a detail page and a drawer:
//
//   OrderLineItemsTab      → the detail page's Line-items section
//                            (DETAIL_VIEW_TAB_COMPONENTS, sections layout)
//   OrderLinesOverviewCard → the drawer's Overview card, registered `order:lines`
//
// Kept in ONE file with two exports rather than the two files §5.8 lists, because
// the drawer variant is a single prop away from the tab and the quote — the shape
// §5.7 locked the order to — is written exactly this way.
//
// Deliberately thinner than quote and invoice: an order carries NO document
// actions cluster. Quote has Send / Mark approved / Convert-to-job and invoice has
// Send / Record payment / Void, and those exist because each has a lifecycle whose
// transitions carry side effects. `order_financial_status` and
// `order_fulfillment_status` are plain human-set fields with no sanctioned action
// behind them (which is also why `order-hooks.ts` registers no lifecycle guard),
// so there is nothing to teleport into the Section header and no read-only state:
// an order records what was sold and stays editable.

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { DocumentSectionActions } from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSystemValues } from '~/components/resources/hooks'

const ORDER_STATUS_ATTRS = ['order_financial_status', 'order_fulfillment_status'] as const

/** Financial states worth calling out in the header — `pending` is the default, so it is not. */
const FINANCIAL_BADGE: Record<string, { label: string; variant: 'green' | 'amber' | 'red' }> = {
  paid: { label: 'Paid', variant: 'green' },
  partially_refunded: { label: 'Partially refunded', variant: 'amber' },
  refunded: { label: 'Refunded', variant: 'red' },
  voided: { label: 'Voided', variant: 'red' },
}

/** Fulfillment states worth calling out — `unfulfilled` is the default, so it is not. */
const FULFILLMENT_BADGE: Record<string, { label: string; variant: 'green' | 'amber' }> = {
  partial: { label: 'Partially fulfilled', variant: 'amber' },
  fulfilled: { label: 'Fulfilled', variant: 'green' },
  restocked: { label: 'Restocked', variant: 'amber' },
}

export function OrderLineItemsTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { values } = useSystemValues(recordId, [...ORDER_STATUS_ATTRS], { autoFetch: true })

  // SINGLE_SELECT values arrive as arrays — take the first (see the
  // `use_system_values_single_select_arrays` convention).
  const financial = firstValue(values.order_financial_status)
  const fulfillment = firstValue(values.order_fulfillment_status)

  const financialBadge = financial ? FINANCIAL_BADGE[financial] : undefined
  const fulfillmentBadge = fulfillment ? FULFILLMENT_BADGE[fulfillment] : undefined

  // `variant='section'`: rendered inside a DetailViewSections <Section> on an
  // outer-owned scroll column instead of a `TabsContent` that grants `h-full`, so
  // the LineBuilder (a virtualized, scroll-owning table) needs the max-height +
  // internal-scroll treatment to avoid fighting the outer page.
  const isSection = variant === 'section'

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      {(financialBadge || fulfillmentBadge) && (
        <DocumentSectionActions
          badge={
            <div className='flex items-center gap-1.5'>
              {financialBadge && (
                <Badge variant={financialBadge.variant} size='sm'>
                  {financialBadge.label}
                </Badge>
              )}
              {fulfillmentBadge && (
                <Badge variant={fulfillmentBadge.variant} size='sm'>
                  {fulfillmentBadge.label}
                </Badge>
              )}
            </div>
          }
        />
      )}

      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder documentRecordId={recordId} documentType='order' />
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
 * Drawer Overview card variant — registered as `order:lines` in
 * `DRAWER_TAB_CARD_COMPONENTS` (the `quote:lines` / `invoice:lines` pattern: the
 * drawer's Section wrapper renders the "Line items" title). Forces
 * `variant='section'` so the builder is height-capped inside the Overview scroll
 * column. The detail page is untouched — it renders {@link OrderLineItemsTab}
 * through its own `DETAIL_VIEW_TAB_COMPONENTS` registry and sections layout.
 */
export function OrderLinesOverviewCard(props: DrawerTabProps) {
  return <OrderLineItemsTab {...props} variant='section' />
}
