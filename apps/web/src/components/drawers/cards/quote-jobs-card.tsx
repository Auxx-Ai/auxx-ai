// apps/web/src/components/drawers/cards/quote-jobs-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getInstanceId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tooltip } from '~/components/global/tooltip'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { DrawerCardActions } from '../drawer-card-actions'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

/** Statuses a job can be created from (money plan 20 §2.1) — mirrors the server allowlist
 * in `convertQuoteToWorkOrder`; pre-approval converts get a confirm dialog first. */
const CONVERTIBLE_STATUSES = new Set(['draft', 'sent', 'approved'])

/**
 * QuoteJobsCard — the work order(s) this quote was converted into (dispatch v5
 * build spec 01: the public accept page auto-converts, so the resulting job must
 * be visible from the quote). Resolves via the `quote_work_orders` inverse of
 * `work_order_quote` — the WorkOrderBillingCard read pattern.
 *
 * With no job yet, the card header carries a "Create job" action (money plan 20 §G) that
 * routes through `convertQuoteToWorkOrder` — a hand-created job that never sets
 * `work_order_quote` is invisible to the one-active-job guard and acceptance WOULD
 * duplicate it, so this action is how manual jobs stay on the linked path.
 */
export function QuoteJobsCard({ recordId }: DrawerTabProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const { values, isLoading } = useSystemValues(recordId, ['quote_work_orders', 'quote_status'], {
    autoFetch: true,
  })
  const workOrderRecordIds = extractRelationshipRecordIds(values.quote_work_orders)
  const status = (values.quote_status as string | undefined) ?? 'draft'

  const convertToWorkOrder = api.money.convertQuoteToWorkOrder.useMutation({
    onError: (error) => toastError({ title: 'Error creating job', description: error.message }),
  })

  const handleCreateJob = async () => {
    // Early convert (money plan 20 §F): allowed pre-acceptance, but confirmed.
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
      router.push(`/app/work-orders/${getInstanceId(result.recordId)}`)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const showCreateAction =
    !isLoading && workOrderRecordIds.length === 0 && CONVERTIBLE_STATUSES.has(status)

  return (
    <>
      {showCreateAction && (
        <DrawerCardActions>
          <Tooltip content='Create job' allowInteraction>
            <Button
              variant='ghost'
              size='icon-xs'
              loading={convertToWorkOrder.isPending}
              onClick={handleCreateJob}>
              <Plus />
            </Button>
          </Tooltip>
        </DrawerCardActions>
      )}
      <ConfirmDialog />
      {isLoading ? (
        <RowSkeleton />
      ) : workOrderRecordIds.length === 0 ? (
        <EmptyRow label='Not converted to a job yet' />
      ) : (
        <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
          {workOrderRecordIds.map((id) => (
            <RelatedRecordRow key={id} recordId={id} statusAttr='work_order_status' />
          ))}
        </div>
      )}
    </>
  )
}
