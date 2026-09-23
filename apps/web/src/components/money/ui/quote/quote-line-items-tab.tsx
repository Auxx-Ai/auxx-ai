// apps/web/src/components/money/ui/quote/quote-line-items-tab.tsx
'use client'

// Custom detail-view tab registered as "quote:line-items" (money MQ1 build spec
// §H.3). Renders the shared document actions cluster (Send + lifecycle dropdown,
// §E.2/§E.4/§G) into the wrapping <Section> header, the edit-sent guard banner,
// and the shared line builder (§H.1).
//
// Header actions are teleported into the <Section> header via `DocumentSectionActions`
// (detail-page sections layout → title/actions slots; drawer card → actions slot).
// Two surfaces render this component: the detail page's Line-items section
// (DETAIL_VIEW_TAB_COMPONENTS, sections layout) and the quote drawer's Overview card
// (QuoteLinesOverviewCard below — records-view/dashboards open quotes in a drawer
// regardless of `hasDetailPage`).

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Download, Pencil, Save, Send, SquareArrowOutUpRight, Undo2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useDocumentEditLane } from '~/components/money/ui/use-document-edit-lane'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const QUOTE_STATUS_ATTRS = ['quote_status', 'quote_valid_until', 'quote_work_orders'] as const

/** Statuses where the quote can still expire — approved/declined/canceled are terminal. */
const EXPIRABLE_STATUSES = new Set(['draft', 'sent'])
/** Statuses where a quote can still be (re)sent (money MQ2 build spec §E.2). */
const SENDABLE_STATUSES = new Set(['draft', 'sent'])
/** A closed quote reopens as a draft to be revised; a sent one is edited in place (66 U5). */
const REVERTIBLE_STATUSES = new Set(['declined', 'canceled'])
/** Statuses a job can be created from (money plan 20 §2.1) — mirrors the server allowlist
 * in `convertQuoteToWorkOrder`; pre-approval converts get a confirm dialog first. */
const CONVERTIBLE_STATUSES = new Set(['draft', 'sent', 'approved'])

export function QuoteLineItemsTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const { values } = useSystemValues(recordId, [...QUOTE_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)

  const status = (values.quote_status as string | undefined) ?? 'draft'
  const validUntil = values.quote_valid_until as string | null | undefined
  // Job this quote was already converted into (the public accept page
  // auto-converts) — swaps "Convert to job" for "View job" below.
  const convertedWorkOrderRecordId = extractRelationshipRecordIds(values.quote_work_orders)[0]

  const isExpired = useMemo(() => {
    if (!validUntil || !EXPIRABLE_STATUSES.has(status)) return false
    return new Date(validUntil).getTime() < Date.now()
  }, [validUntil, status])

  // A draft is typed freely; a sent quote only while an edit is open. The server
  // enforces the same rule (`field-hooks/pre/document-edit-lock.ts`).
  const lane = useDocumentEditLane(recordId, 'quote', 'quote')
  const readOnly = status !== 'draft' && !lane.editing
  const canEdit = status === 'sent' && !lane.editing

  // Shared send/download flow (compose + PDF + no-channel guard).
  const { hasEmailChannel, handleSend, handleDownload, isSending } = useDocumentSendActions(
    recordId,
    'quote'
  )

  const markSent = api.money.markQuoteSent.useMutation({
    onError: (error) =>
      toastError({ title: 'Error marking quote as sent', description: error.message }),
  })
  const approveQuote = api.money.approveQuote.useMutation({
    onError: (error) => toastError({ title: 'Error approving quote', description: error.message }),
  })
  const declineQuote = api.money.declineQuote.useMutation({
    onError: (error) => toastError({ title: 'Error declining quote', description: error.message }),
  })
  const convertToWorkOrder = api.money.convertQuoteToWorkOrder.useMutation({
    onError: (error) =>
      toastError({ title: 'Error converting to job', description: error.message }),
  })

  const handleConvert = async () => {
    // Early convert (money plan 20 §F): allowed pre-acceptance, but confirmed — the
    // customer hasn't formally said yes yet.
    if (status !== 'approved') {
      const confirmed = await confirm({
        title: 'Create job before acceptance?',
        description: "This quote hasn't been accepted yet. Create the job anyway?",
        confirmText: 'Create job',
        cancelText: 'Cancel',
      })
      if (!confirmed) return
    }
    try {
      const result = await convertToWorkOrder.mutateAsync({ quoteRecordId: recordId })
      // work_order now has a detail page (dispatch M2 build spec §F.2) — land on
      // the job view directly instead of the records-list `?id=` drawer convention.
      const { entityInstanceId } = parseRecordId(result.recordId)
      router.push(`/app/work-orders/${entityInstanceId}`)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const handleReturnToDraft = async () => {
    const confirmed = await confirm({
      title: 'Return this quote to draft?',
      description: `This quote is ${status}. Returning it to draft lets you revise and send it again.`,
      confirmText: 'Return to draft',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const ok = await saveSystemValues({ quote_status: 'draft' })
    if (!ok) {
      toastError({
        title: 'Error returning quote to draft',
        description: 'Could not update the quote status',
      })
    }
  }

  // `variant='section'` (dispatch M2 §F.1/§G): rendered inside a DetailViewSections
  // <Section> on an outer-owned scroll column instead of a `TabsContent` that grants
  // `h-full`. The action cluster is teleported into that <Section>'s header (always
  // visible), so only the LineBuilder — a virtualized, scroll-owning table — needs
  // the max-height + internal-scroll treatment to avoid fighting the outer page.
  const isSection = variant === 'section'

  const sendSlot = lane.editing
    ? { label: 'Save changes', onClick: lane.saveEdit, isPending: lane.isSaving }
    : SENDABLE_STATUSES.has(status)
      ? {
          label: status === 'sent' ? 'Resend' : 'Send',
          onClick: handleSend,
          isPending: isSending,
          disabledReason: hasEmailChannel ? undefined : (
            <div className='flex flex-col gap-1 text-xs'>
              <span>Connect an email channel to send quotes.</span>
              <Link href='/app/settings/channels' className='underline'>
                Go to channel settings
              </Link>
            </div>
          ),
        }
      : undefined

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      <DocumentSectionActions
        badge={
          lane.editing ? (
            <Badge variant='amber' size='sm'>
              Editing
            </Badge>
          ) : isExpired ? (
            <Badge variant='amber' size='sm'>
              Expired
            </Badge>
          ) : undefined
        }>
        <DocumentActionsCluster send={sendSlot} menuLabel='Quote actions'>
          <DropdownMenuItem onClick={handleDownload}>
            <Download /> Download PDF
          </DropdownMenuItem>

          {status === 'draft' && (
            <DropdownMenuItem onClick={() => markSent.mutate({ quoteRecordId: recordId })}>
              <Send /> Mark as sent
            </DropdownMenuItem>
          )}

          {canEdit && (
            <DropdownMenuItem onClick={lane.openEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}

          {lane.editing && (
            <>
              <DropdownMenuItem onClick={lane.saveEdit}>
                <Save /> Save changes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={lane.cancelEdit}>
                <Undo2 /> Cancel changes
              </DropdownMenuItem>
            </>
          )}

          {status === 'sent' && !lane.editing && (
            <>
              <DropdownMenuItem onClick={() => approveQuote.mutate({ quoteRecordId: recordId })}>
                <Check /> Mark approved
              </DropdownMenuItem>
              <DropdownMenuItem
                variant='destructive'
                onClick={() => declineQuote.mutate({ quoteRecordId: recordId })}>
                <X /> Mark declined
              </DropdownMenuItem>
            </>
          )}

          {CONVERTIBLE_STATUSES.has(status) && !convertedWorkOrderRecordId && !lane.editing && (
            <DropdownMenuItem onClick={handleConvert}>
              <SquareArrowOutUpRight /> Convert to job
            </DropdownMenuItem>
          )}

          {convertedWorkOrderRecordId && (
            <DropdownMenuItem
              onClick={() =>
                router.push(
                  `/app/work-orders/${parseRecordId(convertedWorkOrderRecordId).entityInstanceId}`
                )
              }>
              <SquareArrowOutUpRight /> View job
            </DropdownMenuItem>
          )}

          {REVERTIBLE_STATUSES.has(status) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleReturnToDraft}>
                <Undo2 /> Return to draft
              </DropdownMenuItem>
            </>
          )}
        </DocumentActionsCluster>
      </DocumentSectionActions>
      {lane.editing && (
        <div className='border-amber-300 border-b bg-amber-50 px-1 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/40'>
          This quote was sent and is open for editing. Save when you are done.
        </div>
      )}

      <div className={cn(isSection ? 'max-h-[60vh] overflow-auto ps-3 pe-3' : 'min-h-0 flex-1')}>
        <LineBuilder documentRecordId={recordId} documentType='quote' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
      <lane.ConfirmDialog />
    </div>
  )
}

/**
 * Drawer Overview card variant — registered as `quote:lines` in
 * `DRAWER_TAB_CARD_COMPONENTS` (the `invoice:lines` pattern: the drawer's
 * Section wrapper renders the "Line items" title). Forces `variant='section'`
 * so the builder is height-capped inside the Overview scroll column. The full
 * detail page is untouched — it renders {@link QuoteLineItemsTab} through its
 * own `DETAIL_VIEW_TAB_COMPONENTS` registry and sections layout.
 */
export function QuoteLinesOverviewCard(props: DrawerTabProps) {
  return <QuoteLineItemsTab {...props} variant='section' />
}
