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
// It also owns the document actions cluster — Send/Resend plus the secondary
// dropdown — teleported into the wrapping <Section> header by
// `DocumentSectionActions`, exactly as quote and invoice do
// (plans/purchasing/07-purchase-order-send-and-status.md §5 step 6). A purchase
// order is the THIRD consumer of `useDocumentSendActions`, which needed no
// changes to take it.
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

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, Download, Send } from 'lucide-react'
import Link from 'next/link'
import { useCallback } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import type { PartPrefillLookup } from '~/components/money/ui/line-builder/line-rows'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const PO_STATUS_ATTRS = [
  'purchase_order_status',
  'purchase_order_receipt_status',
  'purchase_order_billing_status',
  'purchase_order_contact',
] as const

/**
 * Statuses a purchase order can still be (re)sent from. `closed` and `canceled` are the
 * two terminal decisions, so they drop the Send segment entirely and the cluster falls
 * back to a standalone "Actions" button — Download PDF is still reachable.
 */
const SENDABLE_STATUSES = new Set(['draft', 'issued'])

/**
 * Statuses a human can still close or cancel from — the `draft`/`issued` -> terminal
 * transitions of §3.3's action axis. Both are plain `saveSystemValues` writes because
 * neither is guarded: only `issued` has a sanctioned writer
 * (`field-hooks/pre/purchase-order-status-guard.ts`).
 */
const OPEN_STATUSES = new Set(['draft', 'issued'])

type BadgeSpec = { label: string; variant: 'green' | 'amber' | 'red' }

/**
 * The ACTION axis — what a person decided. `draft` is the default and `issued` is
 * the ordinary working state, so neither earns a badge; only the two terminal
 * decisions do. (`issued` is legible from the cluster anyway — the Send segment
 * reads "Resend".)
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
  const [closeConfirm, CloseConfirmDialog] = useConfirm()
  const [cancelConfirm, CancelConfirmDialog] = useConfirm()

  const { values, isLoading } = useSystemValues(recordId, [...PO_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)

  // SINGLE_SELECT values arrive as arrays — take the first (see the
  // `use_system_values_single_select_arrays` convention).
  const status = firstValue(values.purchase_order_status) ?? 'draft'
  const receiptStatus = firstValue(values.purchase_order_receipt_status)
  const billingStatus = firstValue(values.purchase_order_billing_status)
  // Order matters: the decision first, then what actually arrived, then what was
  // invoiced — the same left-to-right reading as the document's own lifecycle.
  const badges = [
    STATUS_BADGE[status],
    receiptStatus ? RECEIPT_BADGE[receiptStatus] : undefined,
    billingStatus ? BILLING_BADGE[billingStatus] : undefined,
  ].filter((b): b is BadgeSpec => !!b)

  // ⚠️ The addressee is the CONTACT, never the vendor: `purchase_order_vendor` targets a
  // `company` and a company carries no email field at all (§7.2).
  //
  // `purchase_order_contact` IS prefilled from the vendor's `company_primary_contact` —
  // `field-hooks/post/purchase-order-contact-prefill.ts`, two doors, one for creates through
  // `UnifiedCrudHandler` and one for later edits. But it stays nullable and the prefill has
  // nothing to copy when the vendor has no primary contact, so "no contact" remains a case
  // worth naming rather than a rarity — surfacing it as a disabled reason beats letting
  // `prepareDocumentEmail` reject the round trip.
  //
  // (This comment previously claimed nothing prefills the field. That was true before #1948
  // and false after it, and it misled a later reader into recording the gap as by-design.)
  const hasContact = extractRelationshipRecordIds(values.purchase_order_contact).length > 0

  // Shared send/download flow (compose + PDF + no-channel guard) — the same hook quote
  // and invoice use, unmodified.
  const { hasEmailChannel, handleSend, handleDownload, isSending } = useDocumentSendActions(
    recordId,
    'purchase order'
  )

  const markSent = api.purchasing.markPurchaseOrderSent.useMutation({
    onError: (error) =>
      toastError({ title: 'Error marking purchase order as sent', description: error.message }),
  })

  const handleClose = async () => {
    const confirmed = await closeConfirm({
      title: 'Close this purchase order?',
      description:
        'Closing says nothing further is expected against this order, even if some lines were never fully received or billed.',
      confirmText: 'Close order',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const ok = await saveSystemValues({ purchase_order_status: 'closed' })
    if (!ok) {
      toastError({
        title: 'Error closing purchase order',
        description: 'Could not update the purchase order status',
      })
    }
  }

  const handleCancel = async () => {
    const confirmed = await cancelConfirm({
      title: 'Cancel this purchase order?',
      description:
        'The order stays on file with its lines and any receipts intact — cancelling only records that it will not be fulfilled.',
      confirmText: 'Cancel order',
      cancelText: 'Keep open',
      destructive: true,
    })
    if (!confirmed) return
    const ok = await saveSystemValues({ purchase_order_status: 'canceled' })
    if (!ok) {
      toastError({
        title: 'Error canceling purchase order',
        description: 'Could not update the purchase order status',
      })
    }
  }

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

  // The channel guard comes first because it blocks every document; the contact guard
  // only applies once there IS somewhere to send from. `isLoading` suppresses the
  // contact reason until the field has actually been read, mirroring how the hook
  // treats "channels still loading" as available — neither may flash a disabled Send.
  const sendDisabledReason = !hasEmailChannel ? (
    <div className='flex flex-col gap-1 text-xs'>
      <span>Connect an email channel to send purchase orders.</span>
      <Link href='/app/settings/channels' className='underline'>
        Go to channel settings
      </Link>
    </div>
  ) : !isLoading && !hasContact ? (
    <div className='flex flex-col gap-1 text-xs'>
      <span>Set the Contact field to the person at the vendor who should receive this order.</span>
    </div>
  ) : undefined

  const sendSlot = SENDABLE_STATUSES.has(status)
    ? {
        label: status === 'draft' ? 'Send' : 'Resend',
        onClick: handleSend,
        isPending: isSending,
        disabledReason: sendDisabledReason,
      }
    : undefined

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      <DocumentSectionActions
        badge={
          badges.length > 0 ? (
            <span className='flex items-center gap-1.5'>
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant} size='sm'>
                  {b.label}
                </Badge>
              ))}
            </span>
          ) : undefined
        }>
        <DocumentActionsCluster send={sendSlot} menuLabel='Purchase order actions'>
          <DropdownMenuItem onClick={handleDownload}>
            <Download /> Download PDF
          </DropdownMenuItem>

          {/*
            The only writer of `issued` reachable without composing an email. Sending from
            the composer flips the status on a CONFIRMED send (thread.ts), so this is the
            "the order went out by phone/fax/portal" door — the same role "Mark as sent"
            plays for quote and invoice.
          */}
          {status === 'draft' && (
            <DropdownMenuItem
              onClick={() =>
                markSent.mutate({ purchaseOrderId: parseRecordId(recordId).entityInstanceId })
              }>
              <Send /> Mark as sent
            </DropdownMenuItem>
          )}

          {OPEN_STATUSES.has(status) && (
            <>
              <DropdownMenuSeparator />
              {/*
                `closed` is deliberately NOT derived (§3.6): an order whose short-shipped
                remainder has been forgiven must still be closeable, and no roll-up rule can
                decide that. So it is a human decision with a confirm, not a rollup.
              */}
              <DropdownMenuItem onClick={handleClose}>
                <Check /> Close order
              </DropdownMenuItem>
              <DropdownMenuItem variant='destructive' onClick={handleCancel}>
                <Ban /> Cancel order
              </DropdownMenuItem>
            </>
          )}
        </DocumentActionsCluster>
      </DocumentSectionActions>

      {/*
        🛑 No `readOnly` prop, and that is the rule rather than an omission (§6.5). Status is
        the wrong predicate in BOTH directions: an `issued` order nobody has shipped against
        is perfectly safe to edit (real orders get amended when a vendor substitutes a part),
        while a `draft` order that already carries receipts — legal since §6.1's pull-forward
        — is not. The lock is per-LINE and evidence-based, enforced server-side by
        `field-hooks/pre/purchase-order-line-evidence-lock.ts`: a line freezes its
        `quantity_ordered` and `expected_unit_price` once a `stock_movement` or
        `vendor_bill_line` points at it. Adding new lines stays open at any status.
      */}
      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder
          documentRecordId={recordId}
          documentType='purchase_order'
          resolvePartPrefill={resolvePartPrefill}
        />
      </div>

      <CloseConfirmDialog />
      <CancelConfirmDialog />
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
