// src/components/mail/thread-footer.tsx
'use client'

import React from 'react'
import CommentComposer from '../global/comments/comment-composer'
import { useThreadData } from './thread-provider'

/**
 * Footer component for thread details with comments section
 */
export function ThreadFooter() {
  const { thread } = useThreadData()

  if (!thread) return null
  return (
    <>
      <div className="flex-0 sticky bottom-0 left-0 right-0 flex flex-col py-4">
        <div className="padding-[16px 14px 0px 6px] flex flex-[1_1_auto] flex-row px-5">
          <CommentComposer
            key={`composer-${thread.id}`} // Reset composer if thread changes
            entityType="Thread"
            entityId={thread.id}
          />
        </div>
      </div>
    </>
  )
}
