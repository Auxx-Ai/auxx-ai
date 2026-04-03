// apps/web/src/components/kopilot/ui/blocks/draft-preview-block.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Pencil } from 'lucide-react'
import { useComposeStore } from '~/components/mail/store/compose-store'
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

  return (
    <div className='not-prose my-2 rounded-lg border'>
      <div className='flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground'>
        <Pencil className='size-3' />
        <span className='font-medium'>Draft Reply</span>
      </div>
      <div className='px-3 py-2'>
        <div className='text-xs text-muted-foreground'>
          To: {data.to.join(', ')}
          {data.cc && data.cc.length > 0 && <span> · Cc: {data.cc.join(', ')}</span>}
        </div>
        {data.subject && (
          <div className='mt-1 text-xs text-muted-foreground'>Subject: {data.subject}</div>
        )}
        <div className='mt-2 h-40'>
          <ScrollArea
            className='h-full'
            scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'
            allowScrollChaining>
            <div className='whitespace-pre-wrap text-sm'>{data.body}</div>
          </ScrollArea>
        </div>
      </div>
      <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
        <Button variant='outline' size='sm' className='h-7 text-xs' onClick={handleEditDraft}>
          <Pencil className='size-3' />
          Edit Draft
        </Button>
      </div>
    </div>
  )
}
