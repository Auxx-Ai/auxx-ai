// apps/web/src/components/money/ui/credit-memo-posting/post-credit-memos-dialog.tsx
'use client'

// The bulk credit memo posting dialog: the shared frame plus this source's
// registration (plans/accounting/tasks/25-batch-posting-and-credit-memos.md
// §5.1). What is genuinely the credit memo poster's is in `credit-memo-source.tsx`
// and `credit-memo-plan-table.tsx`; everything else is
// `~/components/money/ui/batch-posting/`.

import { BatchPostingDialog } from '~/components/money/ui/batch-posting'
import { CREDIT_MEMO_POSTING_SOURCE } from './credit-memo-source'

interface PostCreditMemosDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function PostCreditMemosDialog({
  open,
  onOpenChange,
  onCompleted,
}: PostCreditMemosDialogProps) {
  return (
    <BatchPostingDialog
      source={CREDIT_MEMO_POSTING_SOURCE}
      open={open}
      onOpenChange={onOpenChange}
      onCompleted={onCompleted}
    />
  )
}
