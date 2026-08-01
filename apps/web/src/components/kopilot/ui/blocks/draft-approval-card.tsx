// apps/web/src/components/kopilot/ui/blocks/draft-approval-card.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'
import { RecipientChip } from './recipient-chip'

/** Keep only the string entries of a model-authored list — the rest can't be rendered. */
function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function DraftApprovalCard({
  args,
  status,
  digest,
  onApprove,
  onReject,
  resolvedRecipients,
}: ApprovalCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // Prefer the post-execution digest values when present (subject/body can be
  // edited at approval time and the digest reflects what was actually sent).
  const d = (digest ?? {}) as {
    threadId?: string
    draftId?: string
    messageId?: string
    mode?: 'draft' | 'send'
    status?: string
    subject?: string
    body?: string
    recipients?: string[]
  }

  const threadId =
    (typeof d.threadId === 'string' && d.threadId) ||
    (typeof args.threadId === 'string' ? args.threadId : undefined)
  // Tool args reaching an approval card are only presence-checked, never type
  // validated (zod runs after approval), so every field here is raw model
  // output — a non-string rendered as a React child throws.
  const body = typeof d.body === 'string' ? d.body : typeof args.body === 'string' ? args.body : ''
  const argTo = toStringList(args.to)
  const argCc = toStringList(args.cc)

  // Post-execution: prefer resolved labels from the digest (real emails / phones).
  const resolvedLabels = Array.isArray(d.recipients)
    ? toStringList(d.recipients)
    : resolvedRecipients?.map((r) => r.displayName ?? r.identifier)

  const handleEditInThread = () => {
    if (!threadId) return
    const currentSearch = searchParams.toString()
    const onMailRoute = pathname?.startsWith('/app/mail/') ?? false
    const basePath = onMailRoute ? pathname : '/app/mail/inboxes/all/unassigned'
    const params = new URLSearchParams(onMailRoute ? currentSearch : '')
    params.set('tid', threadId)
    router.push(`${basePath}?${params.toString()}`)
  }

  const isPending = status === 'pending'
  const isApproved = status === 'approved'
  const isRejected = status === 'rejected'

  const completedLabel =
    d.mode === 'send'
      ? d.status === 'sent'
        ? 'Sent'
        : 'Sending…'
      : d.draftId
        ? 'Draft saved'
        : isApproved
          ? 'Working…'
          : ''

  let actions: BlockCardAction[]
  if (isPending) {
    const baseActions: BlockCardAction[] = [
      { label: 'Deny', onClick: onReject },
      { label: 'Save as Draft', onClick: () => onApprove({ mode: 'draft' }) },
    ]
    actions = threadId
      ? [
          ...baseActions,
          { label: 'Edit in Thread', onClick: handleEditInThread },
          { label: 'Send', onClick: () => onApprove({ mode: 'send' }), primary: true },
        ]
      : [
          ...baseActions,
          { label: 'Send', onClick: () => onApprove({ mode: 'send' }), primary: true },
        ]
  } else if (isApproved && threadId) {
    actions = [{ label: 'View in Thread', onClick: handleEditInThread, primary: true }]
  } else {
    actions = []
  }

  const primaryText = isApproved
    ? completedLabel || 'Done'
    : isRejected
      ? 'Cancelled'
      : 'Send Message'

  // Pre-approval: render badges from the raw args so contact recordIds resolve
  // to a contact's name instead of dumping the id. Post-approval: fall back to
  // the digest's already-resolved string list (real emails / phones).
  const secondaryText: ReactNode = resolvedLabels?.length ? (
    `To: ${resolvedLabels.join(', ')}`
  ) : argTo.length > 0 ? (
    <span className='inline-flex flex-wrap items-center gap-1'>
      <span>To:</span>
      {argTo.map((v, i) => (
        <RecipientChip key={`to-${i}-${v}`} value={v} />
      ))}
      {argCc.length > 0 && (
        <>
          <span className='ml-2'>Cc:</span>
          {argCc.map((v, i) => (
            <RecipientChip key={`cc-${i}-${v}`} value={v} />
          ))}
        </>
      )}
    </span>
  ) : undefined

  return (
    <BlockCard
      data-slot='draft-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText={primaryText}
      secondaryText={secondaryText}
      actionLabel={isPending ? 'Send message?' : undefined}
      hasFooter={actions.length > 0}
      actions={actions}
      collapsible={isRejected}
      defaultCollapsed={isRejected}>
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
