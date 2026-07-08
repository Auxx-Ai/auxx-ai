// apps/web/src/components/workflow/nodes/core/answer/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BlockCard, type BlockCardAction } from '~/components/kopilot/ui/blocks/block-card'
import { RecipientChip } from '~/components/kopilot/ui/blocks/recipient-chip'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface AnswerOutputs {
  sent?: boolean
  isDraft?: boolean
  draftId?: string
  dryRun?: boolean
  messageId?: string
  threadId?: string
  messageType?: string
  subject?: string
  to?: string[]
  cc?: string[]
  text?: string
  timestamp?: string
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  new: 'New Message',
  reply: 'Reply',
  replyAll: 'Reply All',
}

/**
 * Email preview for the Answer node's execution output — renders the drafted /
 * dry-run / sent email (recipients, subject, body) instead of raw JSON.
 */
export function AnswerTraceRenderer({ execution }: TraceRendererProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const outputs = (execution.outputs ?? {}) as AnswerOutputs

  const handleOpenThread = () => {
    if (!outputs.threadId) return
    const onMailRoute = pathname?.startsWith('/app/mail/') ?? false
    const basePath = onMailRoute ? pathname : '/app/mail/inboxes/all/unassigned'
    const params = new URLSearchParams(onMailRoute ? searchParams.toString() : '')
    params.set('tid', outputs.threadId)
    router.push(`${basePath}?${params.toString()}`)
  }

  // Pre-enrichment runs (draft/live sends persisted before subject/text landed
  // in every branch) have nothing to preview — show the raw outputs instead.
  if (!outputs.text && !outputs.subject) {
    return <TraceRawJson value={execution.outputs} />
  }

  const badge = outputs.dryRun ? (
    <Badge variant='amber'>Dry run</Badge>
  ) : outputs.isDraft ? (
    <Badge variant='blue'>Draft</Badge>
  ) : outputs.sent ? (
    <Badge variant='green'>Sent</Badge>
  ) : null

  const indicatorColor = outputs.dryRun
    ? 'bg-amber-500'
    : outputs.isDraft
      ? 'bg-blue-500'
      : 'bg-emerald-500'

  const time = outputs.timestamp
    ? new Date(outputs.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const actions: BlockCardAction[] =
    outputs.isDraft && outputs.threadId
      ? [{ label: 'Open draft in thread', onClick: handleOpenThread, primary: true }]
      : []

  return (
    <BlockCard
      data-slot='answer-trace-renderer'
      indicator={<div className={`size-2 rounded-full ${indicatorColor}`} />}
      primaryText={MESSAGE_TYPE_LABELS[outputs.messageType ?? ''] ?? 'Email'}
      secondaryText={
        <span className='inline-flex items-center gap-1.5 text-xs'>
          {badge}
          {time && <span>{time}</span>}
        </span>
      }
      hasFooter={actions.length > 0}
      actions={actions}>
      <div className='space-y-2 p-1'>
        {!!(outputs.to?.length || outputs.cc?.length) && (
          <div className='inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
            {!!outputs.to?.length && (
              <>
                <span>To:</span>
                {outputs.to.map((v, i) => (
                  <RecipientChip key={`to-${i}-${v}`} value={v} />
                ))}
              </>
            )}
            {!!outputs.cc?.length && (
              <>
                <span className='ml-2'>Cc:</span>
                {outputs.cc.map((v, i) => (
                  <RecipientChip key={`cc-${i}-${v}`} value={v} />
                ))}
              </>
            )}
          </div>
        )}
        {outputs.subject && <div className='text-sm font-medium'>{outputs.subject}</div>}
        {outputs.text && (
          <div className='h-40 rounded-xl bg-background p-2 ring-1 ring-border'>
            <ScrollArea
              className='h-full'
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'
              allowScrollChaining>
              <div className='whitespace-pre-wrap text-sm'>{outputs.text}</div>
            </ScrollArea>
          </div>
        )}
      </div>
    </BlockCard>
  )
}
