// apps/web/src/components/kopilot/ui/blocks/draft-list-block.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { formatDistanceToNowStrict } from 'date-fns'
import { Clock, FileEdit } from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'next/navigation'
import type { DraftMessageType } from '~/components/mail/email-editor/types'
import { useCompose } from '~/hooks/use-compose'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { DraftListData, DraftSnapshotData } from './block-schemas'

export function DraftListBlock({ data, skipEntrance }: BlockRendererProps<DraftListData>) {
  const { draftIds, snapshot } = data

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='draft-list-block'
        indicator={<FileEdit className='size-3 text-muted-foreground' />}
        primaryText='Drafts'
        secondaryText={<span className='text-xs text-muted-foreground'>{draftIds.length}</span>}
        hasFooter={false}>
        <div className='divide-y'>
          {draftIds.map((id, i) => (
            <motion.div
              key={id}
              initial={skipEntrance ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: skipEntrance ? 0 : Math.min(i * 0.04, 0.3),
              }}>
              <DraftListRow id={id} snapshot={snapshot?.[id]} />
            </motion.div>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}

interface DraftListRowProps {
  id: string
  snapshot?: DraftSnapshotData
}

function DraftListRow({ id, snapshot }: DraftListRowProps) {
  const searchParams = useSearchParams()
  const { openDraft } = useCompose()

  if (!snapshot) {
    return (
      <div className='px-2 py-2 text-xs text-muted-foreground'>
        Draft unavailable — <span className='font-mono'>{id}</span>
      </div>
    )
  }

  const handleClick = () => {
    if (snapshot.kind === 'reply' && snapshot.threadId) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('threadId', snapshot.threadId)
      window.history.pushState(null, '', `?${params.toString()}`)
      return
    }
    if (snapshot.kind === 'standalone') {
      const draftId = id.startsWith('draft:') ? id.slice('draft:'.length) : id
      const updatedAt = snapshot.updatedAt ?? new Date().toISOString()
      openDraft({
        id: draftId,
        threadId: null,
        inReplyToMessageId: null,
        includePreviousMessage: false,
        subject: snapshot.subject ?? '',
        textHtml: '',
        textPlain: '',
        signatureId: null,
        participants: [],
        attachments: [],
        metadata: {},
        createdAt: updatedAt,
        updatedAt,
      } satisfies DraftMessageType)
    }
  }

  const subject = snapshot.subject ?? '(no subject)'
  const recipientSummary = snapshot.recipientSummary
  const updatedAt = snapshot.updatedAt
  const scheduledAt = snapshot.scheduledAt
  const kindLabel = snapshot.kind === 'reply' ? 'Reply' : 'New'

  return (
    <button
      type='button'
      onClick={handleClick}
      className='flex w-full items-start gap-3 px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50'>
      {scheduledAt ? (
        <Clock className='mt-1 size-3 shrink-0 text-amber-500' />
      ) : (
        <span className='mt-1.5 size-2 shrink-0 rounded-full bg-red-500' />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium'>{subject}</span>
          <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
            {kindLabel}
          </Badge>
        </div>
        <div className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
          {recipientSummary && <span className='truncate'>{recipientSummary}</span>}
          {scheduledAt ? (
            <>
              {recipientSummary && <span>·</span>}
              <span className='shrink-0 text-amber-600 dark:text-amber-400'>
                Scheduled {formatDistanceToNowStrict(new Date(scheduledAt), { addSuffix: true })}
              </span>
            </>
          ) : updatedAt ? (
            <>
              {recipientSummary && <span>·</span>}
              <span className='shrink-0'>
                {formatDistanceToNowStrict(new Date(updatedAt), { addSuffix: true })}
              </span>
            </>
          ) : null}
        </div>
        {snapshot.snippet && (
          <div className='mt-1 line-clamp-2 break-words text-xs text-muted-foreground'>
            {snapshot.snippet}
          </div>
        )}
      </div>
    </button>
  )
}
