// apps/web/src/components/money/ui/quote/quote-line-items-tab.tsx
'use client'

// Custom detail-view tab registered as "quote:line-items" (money MQ1 build spec
// §H.3). Renders the status-driven header strip (Expired badge + lifecycle
// actions) + the edit-sent guard banner + the shared line builder (§H.1).
//
// Header actions are NOT wired through `DetailViewActions` — that component
// only exposes generic capability flags (enableArchive/enableMerge/…, see
// `detail-view-config-types.ts`) with no per-entity extension point, so the
// sanctioned fallback (per the build spec) is this tab's own header strip.

import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const QUOTE_STATUS_ATTRS = ['quote_status', 'quote_valid_until'] as const

/** Statuses where the quote can still expire — approved/declined/canceled are terminal. */
const EXPIRABLE_STATUSES = new Set(['draft', 'sent'])

export function QuoteLineItemsTab({ recordId }: DetailViewTabProps) {
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
      // work_order has no detail page yet (M2) — land on the records list with
      // the drawer open via the `?id=` convention (records-view.tsx).
      const { entityInstanceId } = parseRecordId(result.recordId)
      router.push(`/app/work-orders?id=${entityInstanceId}`)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const handleEditSent = async () => {
    const confirmed = await confirm({
      title: 'Edit this quote?',
      description: 'This quote was sent — editing returns it to draft.',
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

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <div className='flex items-center gap-2'>
          {isExpired && (
            <Badge variant='amber' size='sm'>
              Expired
            </Badge>
          )}
        </div>

        <div className='flex items-center gap-2'>
          {status === 'draft' && (
            <Button
              variant='outline'
              size='sm'
              loading={markSent.isPending}
              loadingText='Sending...'
              onClick={() => markSent.mutate({ quoteRecordId: recordId })}>
              Mark as sent
            </Button>
          )}

          {status === 'sent' && (
            <>
              <Button
                variant='outline'
                size='sm'
                loading={approveQuote.isPending}
                loadingText='Approving...'
                onClick={() => approveQuote.mutate({ quoteRecordId: recordId })}>
                Mark approved
              </Button>
              <Button
                variant='destructive'
                size='sm'
                loading={declineQuote.isPending}
                loadingText='Declining...'
                onClick={() => declineQuote.mutate({ quoteRecordId: recordId })}>
                Mark declined
              </Button>
            </>
          )}

          {status === 'approved' && (
            <Button
              variant='outline'
              size='sm'
              loading={convertToWorkOrder.isPending}
              loadingText='Converting...'
              onClick={handleConvert}>
              Convert to job
            </Button>
          )}
        </div>
      </div>

      {status === 'sent' && (
        <div className='mx-4 mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm'>
          <span className='text-amber-700 dark:text-amber-400'>
            This quote was sent — editing returns it to draft.
          </span>
          <Button variant='outline' size='sm' onClick={handleEditSent}>
            Edit
          </Button>
        </div>
      )}

      <div className='min-h-0 flex-1 px-4 pb-4'>
        <LineBuilder documentRecordId={recordId} documentType='quote' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
    </div>
  )
}
