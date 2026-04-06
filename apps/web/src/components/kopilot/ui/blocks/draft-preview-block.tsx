// apps/web/src/components/kopilot/ui/blocks/draft-preview-block.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Pencil } from 'lucide-react'
import { useComposeStore } from '~/components/mail/store/compose-store'
import { BlockCard, type BlockCardAction } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { DraftPreviewData } from './block-schemas'

export function DraftPreviewBlock({ data }: BlockRendererProps<DraftPreviewData>) {
  const openCompose = useComposeStore((s) => s.open)

  const handleEditDraft = () => {
    const toRecipients = data.to.map((email) => ({
      id: email,
      identifier: email,
      identifierType: 'EMAIL' as const,
    }))
    const ccRecipients = data.cc?.map((email) => ({
      id: email,
      identifier: email,
      identifierType: 'EMAIL' as const,
    }))

    // If draftId looks real (from draft_reply tool), open in draft mode so it fetches from server
    if (data.draftId && data.draftId.length > 10) {
      openCompose({
        mode: 'draft',
        thread: { id: data.threadId },
        draft: { id: data.draftId } as any,
        displayMode: 'floating',
      })
      return
    }

    // Fallback: open as new compose with preset values (handles hallucinated IDs)
    openCompose({
      mode: data.threadId && data.threadId.length > 10 ? 'reply' : 'new',
      thread: data.threadId && data.threadId.length > 10 ? { id: data.threadId } : undefined,
      presetValues: {
        to: toRecipients,
        cc: ccRecipients,
        subject: data.subject,
        contentHtml: data.body,
      },
      displayMode: 'floating',
    })
  }

  const secondaryText = [
    `To: ${data.to.join(', ')}`,
    data.cc && data.cc.length > 0 ? `Cc: ${data.cc.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const actions: BlockCardAction[] = [
    { label: 'Edit Draft', onClick: handleEditDraft, primary: true },
  ]

  return (
    <div className='not-prose my-2'>
      <BlockCard
        indicator={<Pencil className='size-3 text-muted-foreground' />}
        primaryText='Draft Reply'
        secondaryText={<span className='text-xs text-muted-foreground'>{secondaryText}</span>}
        actions={actions}>
        {data.subject && (
          <div className='mb-2 text-xs text-muted-foreground'>Subject: {data.subject}</div>
        )}
        <div className='h-40'>
          <ScrollArea
            className='h-full'
            scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'
            allowScrollChaining>
            <div className='whitespace-pre-wrap text-sm'>{data.body}</div>
          </ScrollArea>
        </div>
      </BlockCard>
    </div>
  )
}
