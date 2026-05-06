// apps/homepage/src/app/platform/ai/_mocks/mock-blocks/draft-approval-card.tsx

'use client'

import { Mail } from 'lucide-react'
import { motion } from 'motion/react'
import { MockBlockCard } from './block-card'

interface DraftApprovalProps {
  recipient: string
  subject: string
  body: string
}

/**
 * Visual port of the real `draft-approval-card.tsx`. Pending status only.
 * Send/Edit footer renders but does nothing.
 */
export function MockDraftApprovalCard({ recipient, subject, body }: DraftApprovalProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className='not-prose my-2'>
      <MockBlockCard
        indicator={<span className='size-2 rounded-full bg-amber-500' />}
        primaryText='Draft reply'
        secondaryText={<span className='text-xs text-muted-foreground'>Pending</span>}
        hasFooter
        footer={
          <>
            <span className='text-xs font-semibold text-foreground/80'>Review draft</span>
            <div className='flex'>
              <span className='flex h-7 cursor-default items-center justify-center rounded-full px-2 text-xs font-medium text-foreground/65'>
                Edit
              </span>
              <span className='flex h-7 cursor-default items-center justify-center rounded-full px-2 text-xs font-medium text-blue-600 dark:text-blue-400'>
                Send
              </span>
            </div>
          </>
        }>
        <div className='space-y-2'>
          <div className='flex items-center gap-2 text-xs'>
            <span className='text-muted-foreground'>To</span>
            <span className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5'>
              <span className='size-1.5 rounded-full bg-blue-500' />
              <span className='font-medium'>{recipient}</span>
            </span>
          </div>
          <div className='flex items-center gap-2 text-xs'>
            <span className='text-muted-foreground'>Subject</span>
            <span className='truncate font-medium text-foreground'>{subject}</span>
          </div>
          <div className='flex gap-2 rounded-lg border bg-background/50 px-3 py-2 text-xs leading-relaxed text-foreground/80'>
            <Mail className='mt-0.5 size-3 shrink-0 text-muted-foreground' />
            <p className='whitespace-pre-line'>{body}</p>
          </div>
        </div>
      </MockBlockCard>
    </motion.div>
  )
}
