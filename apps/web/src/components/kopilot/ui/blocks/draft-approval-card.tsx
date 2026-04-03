// apps/web/src/components/kopilot/ui/blocks/draft-approval-card.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ExternalLink, Save, Send, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApprovalCardProps } from './approval-card-registry'

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

  return (
    <div className='rounded-lg border'>
      {/* Header */}
      <div className='flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground'>
        <Send className='size-3' />
        <span className='font-medium'>Send Reply</span>
        {status !== 'pending' && (
          <Badge variant={status === 'approved' ? 'default' : 'destructive'} className='ml-auto'>
            {status === 'approved' ? 'Approved' : 'Rejected'}
          </Badge>
        )}
      </div>

      {/* Email preview */}
      <div className='px-3 py-2'>
        {toRecipients.length > 0 && (
          <div className='text-xs text-muted-foreground'>To: {toRecipients.join(', ')}</div>
        )}
        <div className='mt-2 h-40'>
          <ScrollArea
            className='h-full'
            scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'
            allowScrollChaining>
            <div className='whitespace-pre-wrap text-sm'>{body}</div>
          </ScrollArea>
        </div>
      </div>

      {/* Pending: show action buttons */}
      {status === 'pending' && (
        <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
          <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={onReject}>
            <X />
            Deny
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='h-7 text-xs'
            onClick={() => onApprove({ saveAsDraft: true })}>
            <Save />
            Save as Draft
          </Button>
          <Button variant='outline' size='sm' className='h-7 text-xs' onClick={handleEditInThread}>
            <ExternalLink />
            Edit in Thread
          </Button>
          <Button size='sm' className='h-7 text-xs' onClick={() => onApprove()}>
            <Send />
            Send
          </Button>
        </div>
      )}

      {/* Approved: show view link */}
      {status === 'approved' && (
        <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
          <Button variant='outline' size='sm' className='h-7 text-xs' onClick={handleEditInThread}>
            <ExternalLink />
            View in Thread
          </Button>
        </div>
      )}
    </div>
  )
}
