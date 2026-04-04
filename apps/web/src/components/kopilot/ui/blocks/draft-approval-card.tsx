// apps/web/src/components/kopilot/ui/blocks/draft-approval-card.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

export function DraftApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const threadId = args.threadId as string
  const body = args.body as string
  const toRecipients = (args.toRecipients as string[]) ?? []

  const handleEditInThread = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    router.push(`?${params.toString()}`)
  }

  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Save as Draft', onClick: () => onApprove({ saveAsDraft: true }) },
        { label: 'Edit in Thread', onClick: handleEditInThread },
        { label: 'Send', onClick: () => onApprove(), primary: true },
      ]
    : status === 'approved'
      ? [{ label: 'View in Thread', onClick: handleEditInThread, primary: true }]
      : []

  const secondaryText = toRecipients.length > 0 ? `To: ${toRecipients.join(', ')}` : undefined

  return (
    <BlockCard
      indicator={<StatusIndicator status={status} />}
      primaryText='Send Reply'
      secondaryText={secondaryText}
      actionLabel={isPending ? 'Send reply?' : undefined}
      hasFooter={actions.length > 0}
      actions={actions}>
      <div className='h-40'>
        <ScrollArea
          className='h-full'
          scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'
          allowScrollChaining>
          <div className='whitespace-pre-wrap text-sm'>{body}</div>
        </ScrollArea>
      </div>
    </BlockCard>
  )
}
