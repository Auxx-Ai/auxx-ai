// apps/web/src/components/kopilot/ui/blocks/draft-approval-card.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

export function DraftApprovalCard({
  args,
  status,
  onApprove,
  onReject,
  resolvedRecipients,
}: ApprovalCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const threadId = typeof args.threadId === 'string' ? args.threadId : undefined
  const body = (args.body as string) ?? ''
  const argTo = Array.isArray(args.to) ? (args.to as string[]) : []

  // Prefer resolved display names; fall back to whatever the LLM passed in `to`.
  // Raw emails / phones are user-friendly; recordIds and participantIds appear
  // as-is during pending state when the resolver hasn't run yet.
  const recipientLabels = resolvedRecipients?.map((r) => r.displayName ?? r.identifier) ?? argTo

  const handleEditInThread = () => {
    if (!threadId) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    router.push(`?${params.toString()}`)
  }

  const isPending = status === 'pending'

  const baseActions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Save as Draft', onClick: () => onApprove({ mode: 'draft' }) },
      ]
    : []

  const actions: BlockCardAction[] = isPending
    ? threadId
      ? [
          ...baseActions,
          { label: 'Edit in Thread', onClick: handleEditInThread },
          { label: 'Send', onClick: () => onApprove(), primary: true },
        ]
      : [...baseActions, { label: 'Send', onClick: () => onApprove(), primary: true }]
    : status === 'approved' && threadId
      ? [{ label: 'View in Thread', onClick: handleEditInThread, primary: true }]
      : []

  const secondaryText = recipientLabels.length > 0 ? `To: ${recipientLabels.join(', ')}` : undefined

  return (
    <BlockCard
      data-slot='draft-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText='Send Message'
      secondaryText={secondaryText}
      actionLabel={isPending ? 'Send message?' : undefined}
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
