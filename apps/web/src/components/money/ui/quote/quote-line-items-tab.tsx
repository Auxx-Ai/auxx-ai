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

import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Download, Send, SquareArrowOutUpRight, Undo2, X } from 'lucide-react'
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
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const QUOTE_STATUS_ATTRS = ['quote_status', 'quote_valid_until'] as const

/** Statuses where the quote can still expire — approved/declined/canceled are terminal. */
const EXPIRABLE_STATUSES = new Set(['draft', 'sent'])
/** Statuses where a quote can still be (re)sent (money MQ2 build spec §E.2). */
const SENDABLE_STATUSES = new Set(['draft', 'sent'])
/** Post-draft statuses that can be returned to draft for editing (mirrors invoice SENT_STATUSES). */
const REVERTIBLE_STATUSES = new Set(['sent', 'approved', 'declined', 'canceled'])

export function QuoteLineItemsTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const { values } = useSystemValues(recordId, [...QUOTE_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)

  const status = (values.quote_status as string | undefined) ?? 'draft'
  const validUntil = values.quote_valid_until as string | null | undefined

  const isExpired = useMemo(() => {
    if (!validUntil || !EXPIRABLE_STATUSES.has(status)) return false
    return new Date(validUntil).getTime() < Date.now()
  }, [validUntil, status])

  // draft is the only editable state — sent/approved/declined/canceled are all read-only.
  const readOnly = status !== 'draft'

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
      title: 'Edit this quote?',
      description:
        status === 'sent'
          ? 'This quote was sent — editing returns it to draft.'
          : `This quote is ${status} — editing returns it to draft.`,
      confirmText: 'Edit',
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

  const sendSlot = SENDABLE_STATUSES.has(status)
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
          isExpired ? (
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

          {status === 'sent' && (
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

          {status === 'approved' && (
            <DropdownMenuItem onClick={handleConvert}>
              <SquareArrowOutUpRight /> Convert to job
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

      {REVERTIBLE_STATUSES.has(status) && (
        <div className='mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm'>
          <span className='text-amber-700 dark:text-amber-400'>
            {status === 'sent'
              ? 'This quote was sent — use “Return to draft” to edit it.'
              : `This quote is ${status} — use “Return to draft” to edit it.`}
          </span>
        </div>
      )}

      <div
        className={cn(
          'flex flex-col pb-4 pt-3',
          isSection ? 'max-h-[60vh] overflow-auto' : 'min-h-0 flex-1'
        )}>
        <LineBuilder documentRecordId={recordId} documentType='quote' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
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
