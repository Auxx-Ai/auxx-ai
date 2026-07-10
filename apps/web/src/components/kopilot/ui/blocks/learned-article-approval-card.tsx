// apps/web/src/components/kopilot/ui/blocks/learned-article-approval-card.tsx

'use client'

import { LearnedArticlePreview } from '~/components/learned/ui/learned-article-preview'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

/**
 * Approval card for `upsert_learned_article` — the "remember this" write door.
 * Shows the light memory preview (title/category/description + rendered
 * markdown) instead of the generic stringified-args dump.
 */
export function LearnedArticleApprovalCard({
  args,
  status,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const isUpdate = Boolean(args.articleId)
  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: isUpdate ? 'Update' : 'Save', onClick: () => onApprove(), primary: true },
      ]
    : []

  return (
    <BlockCard
      data-slot='learned-article-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText={isUpdate ? 'Update memory' : 'Save memory'}
      hasFooter={isPending}
      actionLabel={isPending ? (isUpdate ? 'Update this memory?' : 'Save this memory?') : undefined}
      actions={actions}
      collapsible={status === 'rejected'}
      defaultCollapsed={status === 'rejected'}>
      <LearnedArticlePreview args={args} />
    </BlockCard>
  )
}
