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
// Thinner than quote and invoice: no document actions cluster, because an order
// has no lifecycle with side effects. It is editable until something ships, then
// only through Edit; a synced order never (66 U7, `document-edit-lock.ts`).

import { getInstanceId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useState } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { DocumentSectionActions } from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useDocumentEditLane } from '~/components/money/ui/use-document-edit-lane'
import { useSystemValues } from '~/components/resources/hooks'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { FulfillOrderDialog } from './fulfill-order-dialog'

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
  const { can } = useAccess()
  const utils = api.useUtils()
  const [fulfillOpen, setFulfillOpen] = useState(false)
  const orderId = getInstanceId(recordId)

  // SINGLE_SELECT values arrive as arrays — take the first (see the
  // `use_system_values_single_select_arrays` convention).
  const financial = firstValue(values.order_financial_status)
  const fulfillment = firstValue(values.order_fulfillment_status)

  // The lock the server enforces; its `synced` is a connector read the client cannot make.
  const lane = useDocumentEditLane(recordId, 'order', 'order')
  const lock = api.documentEdit.lockState.useQuery(
    { family: 'order', recordId: orderId },
    { enabled: !!orderId }
  )
  // A shipment moves the order from open to locked.
  useEffect(() => {
    if (orderId)
      void utils.documentEdit.lockState.invalidate({ family: 'order', recordId: orderId })
  }, [fulfillment, orderId, utils])
  const readOnly = !lock.data?.open && !lane.editing
  const canEdit = !!lock.data?.editable && !lane.editing

  const financialBadge = financial ? FINANCIAL_BADGE[financial] : undefined
  const fulfillmentBadge = fulfillment ? FULFILLMENT_BADGE[fulfillment] : undefined

  // 🛑 An order bound to a data connector has its shipment log DERIVED at ingest
  // from the native fulfillment fields the channel sends (plans/money/tasks/49
  // §8.4 decision 4), and the log is append-only. Fulfilling one by hand writes
  // a second entry for a shipment the next sync will also describe, so the two
  // disagree and the order is recognised twice. Nothing in the drawer knew this
  // before, so it is asked for: `money.isOrderConnectorManaged`.
  //
  // ⚠️ Gated on `=== false`, not on `!== true`. While the answer is in flight
  // the button stays away: a Fulfill that appears for a beat on a connector
  // order is an irreversible ledger write somebody can reach, and a button that
  // arrives a moment late is not.
  const connectorManaged = api.money.isOrderConnectorManaged.useQuery(
    { orderId },
    { enabled: !!orderId && can('ledger.post'), staleTime: 60_000 }
  )
  const isConnectorManaged = connectorManaged.data === true

  // The sanctioned fulfillment action (HANDOFF decision 6.6): it carries what
  // shipped, flips `order_fulfillment_status`, and posts the revenue entry, so
  // it is a ledger write. Hidden once everything has shipped.
  const canFulfill =
    can('ledger.post') &&
    fulfillment !== 'fulfilled' &&
    connectorManaged.data === false &&
    !lane.editing

  // `variant='section'`: rendered inside a DetailViewSections <Section> on an
  // outer-owned scroll column instead of a `TabsContent` that grants `h-full`, so
  // the LineBuilder (a virtualized, scroll-owning table) needs the max-height +
  // internal-scroll treatment to avoid fighting the outer page.
  const isSection = variant === 'section'

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      {(financialBadge ||
        fulfillmentBadge ||
        canFulfill ||
        isConnectorManaged ||
        canEdit ||
        lane.editing) && (
        <DocumentSectionActions
          badge={
            <div className='flex items-center gap-1.5'>
              {lane.editing && (
                <Badge variant='amber' size='sm'>
                  Editing
                </Badge>
              )}
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
          }>
          {canEdit && (
            <Button variant='outline' size='xs' onClick={lane.openEdit}>
              Edit
            </Button>
          )}
          {lane.editing && (
            <>
              <Button variant='outline' size='xs' onClick={lane.cancelEdit}>
                Cancel changes
              </Button>
              <Button size='xs' onClick={lane.saveEdit} loading={lane.isSaving}>
                Save changes
              </Button>
            </>
          )}
          {canFulfill && (
            <Button variant='outline' size='xs' onClick={() => setFulfillOpen(true)}>
              Fulfill
            </Button>
          )}
          {isConnectorManaged && (
            <span className='text-muted-foreground text-xs'>
              Shipments arrive from the sales channel and are posted in bulk
            </span>
          )}
        </DocumentSectionActions>
      )}

      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder documentRecordId={recordId} documentType='order' readOnly={readOnly} />
      </div>

      <FulfillOrderDialog
        open={fulfillOpen}
        onOpenChange={setFulfillOpen}
        orderId={orderId}
        onFulfilled={() => {
          // The order's ledger card reads `listPostingsForSource` keyed on the
          // order (the fulfillment's `parent` link, TARGET §1), so this is the
          // query a fulfillment has just changed.
          void utils.ledger.listPostingsForSource.invalidate({
            sourceKind: 'order',
            sourceId: orderId,
          })
          void utils.money.orderForFulfillment.invalidate()
        }}
      />
      <lane.ConfirmDialog />
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
