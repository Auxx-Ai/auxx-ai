// apps/web/src/components/money/ui/fulfillment-posting/post-fulfillments-dialog.tsx
'use client'

// The bulk fulfillment posting dialog: the shared frame plus this source's
// registration (plans/accounting/tasks/25-batch-posting-and-credit-memos.md
// §5.1). Everything that used to live here is in
// `~/components/money/ui/batch-posting/`; what is genuinely fulfillment's is in
// `fulfillment-source.tsx` and `fulfillment-plan-table.tsx`.

import { BatchPostingDialog } from '~/components/money/ui/batch-posting'
import { FULFILLMENT_POSTING_SOURCE } from './fulfillment-source'

interface PostFulfillmentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function PostFulfillmentsDialog({
  open,
  onOpenChange,
  onCompleted,
}: PostFulfillmentsDialogProps) {
  return (
    <BatchPostingDialog
      source={FULFILLMENT_POSTING_SOURCE}
      open={open}
      onOpenChange={onOpenChange}
      onCompleted={onCompleted}
    />
  )
}
