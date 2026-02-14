'use client'

// apps/web/src/components/global/comments/drawer-comments.tsx

import { getDefinitionId, parseRecordId, type RecordId } from '@auxx/lib/field-values/client'
import { MessagesSquare } from 'lucide-react'
import React from 'react'
import CommentComposer from '~/components/global/comments/comment-composer'
import { CommentList } from '~/components/global/comments/comment-list'
import { EmptyState } from '~/components/global/empty-state'
import { isSystemEntityType } from '~/hooks/use-comments'
import { api } from '~/trpc/react'

/**
 * Props for the DrawerComments wrapper component.
 */
interface DrawerCommentsProps {
  recordId: RecordId
  emptyTitle?: string
  emptyDescription?: string
  headerTitle?: string
  composerPlaceholder?: string
  /** Optional focus trigger used to focus the comment composer. */
  focusComposerTrigger?: number
}

/**
 * Generic DrawerComments component displays all comments for an entity
 * with the ability to add new comments via CommentComposer.
 * Supports Contact, Ticket, Thread, and custom entity types.
 */
const DrawerComments = ({
  recordId,
  emptyTitle,
  emptyDescription,
  headerTitle,
  composerPlaceholder,
  focusComposerTrigger,
}: DrawerCommentsProps) => {
  // Parse recordId once for display logic
  const entityDefinitionId = getDefinitionId(recordId)

  // Smart default description based on entity type
  const defaultEmptyTitle = emptyTitle || 'No comments yet'
  const defaultEmptyDescription =
    emptyDescription ||
    (isSystemEntityType(entityDefinitionId)
      ? `Start a conversation about this ${entityDefinitionId.toLowerCase()}`
      : 'Start a conversation about this record')
  const defaultHeaderTitle = headerTitle || 'Comments'
  const defaultPlaceholder = composerPlaceholder || 'Add comment...'

  // Fetch comments using tRPC
  const { data: commentsData, isLoading } = api.comment.getByRecordId.useQuery(
    { recordId },
    { enabled: !!recordId }
  )

  // Loading state
  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={MessagesSquare}
          iconClassName='animate-spin'
          title='Loading comments'
          description='Fetching comments...'
        />
      </div>
    )
  }

  // Content state (including empty state)
  return (
    <div className='relative h-full w-full flex flex-col'>
      <div className='flex items-center justify-between px-4 sticky top-0 z-1 pt-3'>
        <h2 className='text-base flex items-center space-x-2 gap-2 text-[14px]'>
          <MessagesSquare className='size-4 text-muted-foreground/50' />
          {defaultHeaderTitle}
        </h2>
      </div>

      {/* Comments content area */}
      {!commentsData?.comments || commentsData.comments.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          className='h-full flex flex-1 items-center'
          title={defaultEmptyTitle}
          description={defaultEmptyDescription}
        />
      ) : (
        <div className='flex-1 overflow-y-auto pt-0 p-4'>
          <CommentList recordId={recordId} initialComments={commentsData.comments} />
        </div>
      )}

      {/* Comment Composer - always visible at bottom */}
      <div className='px-4 pb-4 pt-2'>
        <CommentComposer
          recordId={recordId}
          expanded
          expandHeight='100px'
          focusTrigger={focusComposerTrigger}
          placeholder={defaultPlaceholder}
          onSubmitted={() => {
            // Refetch comments after submission
            // tRPC will handle this automatically with cache invalidation
          }}
        />
      </div>
    </div>
  )
}

DrawerComments.displayName = 'DrawerComments'

export default DrawerComments
