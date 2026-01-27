// src/components/mail/thread-footer.tsx
'use client'

import React from 'react'
import CommentComposer from '../global/comments/comment-composer'
import { useThreadContext } from './thread-provider'
import { useThread } from '~/components/threads/hooks'
import { toRecordId } from '@auxx/lib/field-values/client'

/**
 * Footer component for thread details with comments section
 */
export function ThreadFooter() {
  const { threadId } = useThreadContext()
  const { thread } = useThread({ threadId })

  if (!thread) return null
  return (
    <>
      <div className="flex-0 sticky bottom-0 left-0 right-0 flex flex-col py-4">
        <div className="padding-[16px 14px 0px 6px] flex flex-[1_1_auto] flex-row px-5">
          <CommentComposer
            key={`composer-${thread.id}`} // Reset composer if thread changes
            recordId={toRecordId('thread', thread.id)}
          />
        </div>
      </div>
    </>
  )
}
